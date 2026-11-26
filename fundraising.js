/* ================= FUND RAISING: calendar, proposals, outreach, obligations ================= */
const FR_TYPES = ["Proposal / Grant", "Letter of Interest", "Concept / Idea", "Partnership", "Eligibility inquiry"];
const FR_STATUS = ["Waiting for response", "Approved", "Approved – under communication", "Rejected", "Declined – not taking new grantees", "Rejected – compliance / certification", "No response", "Withdrawn"];
const FR_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December","Rolling / no deadline"];
const canFR = () => has("super_admin", "admin", "fundraising", "board");
const canEditFR = () => has("super_admin", "admin", "fundraising");
const frTag = st => { const ok = /^Approved/.test(st), bad = /Rejected|Declined|Withdrawn/.test(st); return `<span class="tag ${ok ? "ok" : bad ? "bad" : "warn"}">${esc(st)}</span>`; };
const fmtD = s => s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* ---- Opportunity calendar ---- */
routes.frCalendar = async () => {
  setTitle("Opportunity calendar");
  const snap = await db.collection("opportunities").orderBy("monthIndex").get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byMonth = {}; rows.forEach(r => (byMonth[r.month] = byMonth[r.month] || []).push(r));
  const soon = rows.filter(r => r.deadline && (new Date(r.deadline) - Date.now()) / 86400000 <= 30 && new Date(r.deadline) >= new Date()).length;
  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Open calls tracked</span><b>${rows.length}</b></div>
    <div class="card stat"><span class="muted small">Deadlines next 30 days</span><b>${soon}</b></div>
    <div class="card stat"><span class="muted small">Rolling / no deadline</span><b>${rows.filter(r => !r.deadline).length}</b></div>
    <div class="card stat"><span class="muted small">Applied from this list</span><b>${rows.filter(r => r.proposalId).length}</b></div></div>
  ${canEditFR() ? `<div class="card"><h2>Add a call</h2><form id="f">
    <div class="two"><label class="field"><span>Funder / call</span><input name="funder" required></label><label class="field"><span>Month</span><select name="month">${FR_MONTHS.map(m => `<option>${m}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Deadline (leave blank if rolling)</span><input type="date" name="deadline"></label><label class="field"><span>How to apply</span><input name="route" placeholder="Online portal, email, concept note…"></label></div>
    <div class="two"><label class="field"><span>Link</span><input name="link" type="url"></label><label class="field"><span>Contact email</span><input name="contact"></label></div>
    <label class="field"><span>Notes</span><input name="notes"></label>
    <label class="check"><input type="checkbox" name="recurring"> Recurs every year</label>
    <button class="btn small" type="submit">Add call</button></form></div>` : ""}
  <div class="card"><h2>Grant calls by month</h2><div class="tablewrap"><table class="table"><tr><th>Month</th><th>Funder / call</th><th>Deadline</th><th>How to apply</th><th>Contact</th><th></th></tr>
    ${FR_MONTHS.filter(m => byMonth[m]).map(m => byMonth[m].map((r, i) => `<tr>${i === 0 ? `<td rowspan="${byMonth[m].length}"><b>${esc(m)}</b></td>` : ""}<td>${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.funder)}</a>` : esc(r.funder)}${r.recurring ? ' <span class="tag">yearly</span>' : ""}${r.notes ? `<div class="s">${esc(r.notes)}</div>` : ""}</td><td>${r.deadline ? fmtD(r.deadline) : "No deadline"}</td><td>${esc(r.route || "")}</td><td class="small">${esc(r.contact || "")}</td>
      <td>${r.proposalId ? `<span class="tag ok">applied</span>` : canEditFR() ? `<button class="btn small quiet" data-start="${r.id}">Start proposal</button>` : ""} ${canEditFR() ? `<button class="btn small quiet" data-del="${r.id}">✕</button>` : ""}</td></tr>`).join("")).join("") || `<tr><td colspan="6" class="empty">No calls yet — add one above or import the tracker</td></tr>`}</table></div></div>`);
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.recurring = e.target.recurring.checked; d.monthIndex = FR_MONTHS.indexOf(d.month);
    const r = await db.collection("opportunities").add({ ...d, addedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); audit("create", "opportunities", r.id, d.funder); routes.frCalendar(); };
  $("content").querySelectorAll("[data-start]").forEach(b => b.onclick = () => { const r = rows.find(x => x.id === b.dataset.start); routes.frProposals({ org: r.funder, opportunityId: r.id }); });
  $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("Remove this call?")) return; await db.collection("opportunities").doc(b.dataset.del).delete(); routes.frCalendar(); });
};

/* ---- Proposals sent & status ---- */
routes.frProposals = async (prefill = {}) => {
  setTitle("Proposals sent & status");
  const snap = await db.collection("proposals").orderBy("sentOn", "desc").get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const n = rows.length, appr = rows.filter(r => /^Approved/.test(r.status)).length, wait = rows.filter(r => /Waiting|No response/.test(r.status)).length, rej = rows.filter(r => /Rejected|Declined/.test(r.status)).length;
  const filter = state.frFilter || "all";
  const editing = state.frEdit ? rows.find(r => r.id === state.frEdit) : null;
  const shown = rows.filter(r => filter === "all" || (filter === "wait" && /Waiting|No response/.test(r.status)) || (filter === "ok" && /^Approved/.test(r.status)) || (filter === "bad" && /Rejected|Declined|Withdrawn/.test(r.status)));
  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Sent</span><b>${n}</b></div><div class="card stat"><span class="muted small">Approved</span><b>${appr}</b></div>
    <div class="card stat"><span class="muted small">Waiting</span><b>${wait}</b></div><div class="card stat"><span class="muted small">Rejected / declined</span><b>${rej}</b></div>
    <div class="card stat"><span class="muted small">Success rate</span><b>${n ? Math.round(appr / n * 100) : 0}%</b></div></div>
  ${canEditFR() ? `<div class="card" id="frForm"><h2>${editing ? "Correct this entry" : "Log a submission"}</h2>
    ${editing ? `<p class="small muted">Correcting <b>${esc(editing.name)}</b> sent to ${esc(editing.org)}. The history is kept and the correction is recorded.
      <button class="btn small quiet" id="frCancel">Leave it as it is</button></p>` : ""}<form id="f">
    <div class="two"><label class="field"><span>Proposal / project name</span><input name="name" required value="${esc(editing?.name || "")}"></label><label class="field"><span>Type</span><select name="type">${FR_TYPES.map(x => `<option ${editing && x === editing.type ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Organisation / funder</span><input name="org" required value="${esc(editing?.org || prefill.org || "")}"></label><label class="field"><span>Sent on</span><input type="date" name="sentOn" value="${esc(editing?.sentOn || today())}" required></label></div>
    <div class="two"><label class="field"><span>Ask (₹ or currency)</span><input name="ask" placeholder="₹18,00,000 or CHF 60,000"></label><label class="field"><span>Geography / theme</span><input name="theme" value="${esc(editing?.theme || "")}"></label></div>
    <div class="two"><label class="field"><span>Amount (if approved)</span><input name="approvedAmount" type="number" step="any" inputmode="decimal" value="${esc(editing?.approvedAmount || "")}"></label><label class="field"><span>Files — proposal, budget, MOU, acknowledgement (PDF, Word, image)</span><input type="file" name="files" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" multiple id="prFiles"><div class="small muted" id="prFileSt" style="margin-top:4px"></div></label></div>
    <div class="two"><label class="field"><span>Response expected by</span><input type="date" name="expectedBy" value="${esc(editing?.expectedBy || "")}"></label><label class="field"><span>Status</span><select name="status">${FR_STATUS.map(x => `<option ${editing && x === editing.status ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <label class="field"><span>Notes</span><textarea name="notes">${esc(editing?.notes || "")}</textarea></label>
    <input type="hidden" name="opportunityId" value="${esc(prefill.opportunityId || "")}">
    <button class="btn small" type="submit">${editing ? "Save the correction" : "Save"}</button></form></div>` : ""}
  <div class="card"><h2>Status log</h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[["all", `All (${n})`], ["wait", `Waiting (${wait})`], ["ok", `Approved (${appr})`], ["bad", `Rejected (${rej})`]].map(([k, l]) => `<button class="btn small ${filter === k ? "" : "quiet"}" data-filter="${k}">${l}</button>`).join("")}</div>
    <div class="tablewrap"><table class="table"><tr><th>Sent</th><th>Proposal</th><th>Type</th><th>Organisation</th><th>Status</th><th>Next</th></tr>
    ${shown.map(r => `<tr><td>${fmtD(r.sentOn)}</td><td>${esc(r.name)}${r.notes ? `<div class="s">${esc(r.notes)}</div>` : ""}</td><td>${esc(r.type)}</td><td>${esc(r.org)}${r.ask ? `<div class="s">ask ${esc(r.ask)}</div>` : ""}${r.approvedAmount ? `<div class="s">approved ₹${Number(r.approvedAmount).toLocaleString("en-IN")}</div>` : ""}${(r.files||[]).map(f2=>`<a href="${esc(f2.url||f2.data||"#")}" target="_blank" rel="noopener" style="margin-left:4px">📎 ${esc(f2.name||"file")}</a>`).join("")}${r.file&&!r.files?`<a href="${esc(r.file)}" target="_blank" rel="noopener" style="margin-left:4px">📎</a>`:""}</td>
      <td>${canEditFR() ? `<select data-status="${r.id}" style="width:auto;padding:4px 8px;border-radius:8px;font-size:14px">${FR_STATUS.map(x => `<option ${x === r.status ? "selected" : ""}>${x}</option>`).join("")}</select>` : frTag(r.status)}</td>
      <td class="small">${/^Approved/.test(r.status) ? (r.projectId ? `→ project` : canEditFR() ? `<button class="btn small quiet" data-proj="${r.id}">Create project</button>` : "") : /Waiting/.test(r.status) ? (r.expectedBy && new Date(r.expectedBy) < new Date() ? `<span class="tag warn">follow up</span>` : `expected ${fmtD(r.expectedBy)}`) : ""}
      ${r.history && r.history.length ? `<details><summary class="small muted">history (${r.history.length})</summary>${r.history.map(h => `<div class="s">${fmtD(h.at)} · ${esc(h.status)} · ${esc(h.by)}${h.note ? ` · ${esc(h.note)}` : ""}</div>`).join("")}</details>` : ""}
      ${canEditFR() ? `<div style="display:flex;gap:4px;margin-top:4px"><button class="btn small quiet" data-edit="${r.id}">Edit</button>
        <button class="btn small quiet" data-del="${r.id}">Remove</button></div>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No submissions logged yet</td></tr>`}</table></div></div>`);
  if ($("frCancel")) $("frCancel").onclick = () => { state.frEdit = null; routes.frProposals(); };
  $("content").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { state.frEdit = b.dataset.edit; routes.frProposals(); });
  $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === b.dataset.del);
    const why = prompt(`Remove "${r.name}" from the log?\n\nWhy? (it is kept in the audit log)`);
    if (!why) return;
    await db.collection("proposals").doc(r.id).delete();
    audit("delete", "proposals", r.id, `${r.name} · ${why}`); toast("Removed"); routes.frProposals(); });
  // Show selected file names
  if ($("prFiles")) $("prFiles").onchange = e => {
    const names = [...e.target.files].map(f => f.name).join(", ");
    $("prFileSt").textContent = names || "";
  };
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault(); const fd2 = new FormData(e.target); const d = Object.fromEntries(fd2); delete d.files;
    const fls = [...($("prFiles")?.files || [])];
    const uploaded = [];
    for (const fl of fls) {
      try {
        if (fl.type.startsWith("image/")) {
          const imgR = await uploadToDrive(fl, "fundraising", fl.name).catch(()=>null); if(imgR) uploaded.push({ name: fl.name, url: imgR.webViewLink||imgR.url||"", type: "drive" }); //was: 1300, 0.6)), type: "image" });
        } else {
          const res = await uploadToDrive(fl, "fundraising", fl.name);
          uploaded.push({ name: fl.name, url: res.webViewLink || res.url || "", type: "drive" });
        }
      } catch(err) { toast("Could not upload " + fl.name + " — check Drive connection"); }
    }
    // Merge with existing files when editing
    if (editing && editing.files) d.files = [...(editing.files || []), ...uploaded];
    else if (uploaded.length) d.files = uploaded;
    d.approvedAmount = d.approvedAmount ? Number(d.approvedAmount) : null;
    /* Correcting an entry keeps its history and records that it was corrected. */
    if (editing) {
      await db.collection("proposals").doc(editing.id).update({ ...d,
        files: [...(editing.files || []), ...uploaded].filter(function(f){ return f && f.url; }),
        history: [...(editing.history || []), { at: today(), status: d.status, by: state.me.name, note: "entry corrected" }],
        correctedBy: state.user.uid, correctedOn: today() });
      audit("update", "proposals", editing.id, d.name);
      state.frEdit = null; toast("Corrected"); return routes.frProposals();
    }
    const doc = { ...d, files: uploaded.filter(function(f){ return f && f.url; }),
      history: [{ at: today(), status: d.status, by: state.me.name, note: "logged" }], loggedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const r = await db.collection("proposals").add(doc); audit("create", "proposals", r.id, d.name);
    if (d.opportunityId) await db.collection("opportunities").doc(d.opportunityId).update({ proposalId: r.id }).catch(() => {});
    toast("Logged"); routes.frProposals(); };
  $("content").querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { state.frFilter = b.dataset.filter; routes.frProposals(); });
  $("content").querySelectorAll("[data-status]").forEach(sel => sel.onchange = async () => {
    const note = prompt(`Status → ${sel.value}\nNote (what happened, who said it, next step):`) ?? ""; if (note === null) return routes.frProposals();
    const r = rows.find(x => x.id === sel.dataset.status);
    await db.collection("proposals").doc(r.id).update({ status: sel.value, history: [...(r.history || []), { at: today(), status: sel.value, by: state.me.name, note }] });
    audit("status", "proposals", r.id, sel.value); toast(sel.value); routes.frProposals(); });
  $("content").querySelectorAll("[data-proj]").forEach(b => b.onclick = async () => { const r = rows.find(x => x.id === b.dataset.proj);
    const ref = await db.collection("projects").add({ name: r.name, donor: r.org, status: "active", fundType: "", budget: 0, createdBy: state.user.uid, fromProposal: r.id });
    await db.collection("proposals").doc(r.id).update({ projectId: ref.id }); audit("create", "projects", ref.id, r.name); await loadMasters(); toast("Project created — complete it in Project register"); routes.frProposals(); });
};

/* ---- Collaboration outreach ---- */
routes.frOutreach = async () => {
  setTitle("Collaboration outreach");
  const snap = await db.collection("outreach").orderBy("sentOn", "desc").get(); const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  html(`${canEditFR() ? `<div class="card"><h2>Add contact</h2><form id="f">
    <div class="two"><label class="field"><span>Company / organisation</span><input name="org" required></label><label class="field"><span>Email</span><input name="email"></label></div>
    <div class="two"><label class="field"><span>Sent on</span><input type="date" name="sentOn" value="${today()}"></label><label class="field"><span>Geography & theme</span><input name="theme"></label></div>
    <label class="field"><span>Reply / notes</span><input name="reply"></label><button class="btn small" type="submit">Add</button></form></div>` : ""}
  <div class="card"><h2>CSR / partnership emails (${rows.length})</h2><div class="tablewrap"><table class="table"><tr><th>Organisation</th><th>Email</th><th>Sent</th><th>Geography & theme</th><th>Reply</th>${canEditFR() ? "<th></th>" : ""}</tr>
    ${rows.map(r => `<tr><td>${esc(r.org)}</td><td class="small">${esc(r.email || "")}</td><td>${fmtD(r.sentOn)}</td><td>${esc(r.theme || "")}</td><td>${esc(r.reply || "—")}</td>${canEditFR() ? `<td><button class="btn small quiet" data-fu="${r.id}">Follow up</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="6" class="empty">Nothing yet</td></tr>`}</table></div></div>`);
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await db.collection("outreach").add({ ...d, addedBy: state.user.uid }); routes.frOutreach(); };
  $("content").querySelectorAll("[data-fu]").forEach(b => b.onclick = async () => { const reply = prompt("Follow-up note / reply received:"); if (reply === null) return; await db.collection("outreach").doc(b.dataset.fu).update({ reply, lastFollowUp: today() }); routes.frOutreach(); });
};

/* ---- Reporting calendar (obligations on live grants) ---- */
routes.frObligations = async () => {
  setTitle("Reporting calendar");
  const snap = await db.collection("obligations").orderBy("due").get(); const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const days = d => Math.ceil((new Date(d) - Date.now()) / 86400000);
  html(`${canEditFR() ? `<div class="card"><h2>Add obligation</h2><form id="f">
    <div class="two"><label class="field"><span>Project</span><select name="projectId">${projectOptions()}</select></label><label class="field"><span>Due</span><input type="date" name="due" required></label></div>
    <div class="two"><label class="field"><span>What</span><input name="what" required placeholder="4-monthly progress and financial report"></label><label class="field"><span>To</span><input name="to" placeholder="UNODC"></label></div>
    <div class="two"><label class="field"><span>Owner (post / name)</span><input name="owner"></label><label class="field"><span>Repeats</span><select name="repeat"><option>Once</option><option>Monthly</option><option>Quarterly</option><option>4-monthly</option><option>Half-yearly</option><option>Annual</option></select></label></div>
    <button class="btn small" type="submit">Add</button></form></div>` : ""}
  <div class="card"><h2>Reporting and renewal calendar</h2><div class="tablewrap"><table class="table"><tr><th>Due</th><th>Project</th><th>What</th><th>To</th><th>Owner</th><th>Status</th>${canEditFR() ? "<th></th>" : ""}</tr>
    ${rows.map(r => { const dd = days(r.due); const st = r.done ? `<span class="tag ok">done ${fmtD(r.done)}</span>` : dd < 0 ? `<span class="tag bad">overdue ${-dd}d</span>` : dd <= 30 ? `<span class="tag warn">due in ${dd} days</span>` : `<span class="tag">upcoming</span>`;
      return `<tr><td>${fmtD(r.due)}</td><td>${esc(projectName(r.projectId))}</td><td>${esc(r.what)}${r.repeat && r.repeat !== "Once" ? ` <span class="tag">${esc(r.repeat)}</span>` : ""}</td><td>${esc(r.to || "")}</td><td>${esc(r.owner || "")}</td><td>${st}</td>${canEditFR() ? `<td>${r.done ? "" : `<button class="btn small quiet" data-done="${r.id}">Mark done</button>`}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="7" class="empty">Nothing due yet</td></tr>`}</table></div></div>`);
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await db.collection("obligations").add({ ...d, addedBy: state.user.uid }); routes.frObligations(); };
  $("content").querySelectorAll("[data-done]").forEach(b => b.onclick = async () => { await db.collection("obligations").doc(b.dataset.done).update({ done: today(), doneBy: state.user.uid }); routes.frObligations(); });
};
