/* ================= REGISTER ENGINE: one definition → form + list + edit + export ================= */
// Field: {k, l, t:text|number|date|select|textarea|check|users|projects|file, o:[options], req, w:"half"}
function registerScreen(cfg) {
  return async (editId) => {
    // Load activities if this form uses them (so project → activity cascade has data)
    if (cfg.fields && cfg.fields.some(f => f.t === "activities")) await ensureActivities();
    if (cfg.fields && cfg.fields.some(f => f.t === "orgEvents")) { const s = await db.collection("orgEvents").orderBy("date").get().catch(()=>({docs:[]})); state._orgEvents = s.docs.map(d=>({id:d.id,...d.data()})); }
    setTitle(cfg.title);
    const col = db.collection(cfg.col);
    const canEdit = !isObserver() && (has("super_admin") || (cfg.canEdit ? cfg.canEdit() : isAdmin()));
    let q = col; if (cfg.orderBy) q = q.orderBy(cfg.orderBy, cfg.dir || "desc");
    const snap = await q.limit(cfg.limit || 300).get().catch(e => { console.error("registerScreen load failed:", cfg.col, e.code, e.message); return {docs:[]}; });
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Scope by reporting line unless the screen is organisation-wide by nature
    const wide = cfg.orgWide || seesWholeOrg()
      || (["advances", "expenseClaims", "expenses", "requisitions", "travelRequests"].includes(cfg.col) && isAccounts()) || (["advances", "requisitions"].includes(cfg.col) && has("procurement"))
      || (["incidents", "grievances"].includes(cfg.col) && isSafeguardingLead());
    if (cfg.scopeByArea) rows = rows.filter(inMyArea);
    /* Whoever runs an office sees that office's work, whether or not those people
       report to them on paper — a field coordinator cannot run a district on the
       strength of their own records alone. */
    else if (runsAnOffice()) rows = rows.filter(r => ofMyOffice(r) || inMyLine(r));
    else if (!wide) rows = rows.filter(inMyLine);
    /* An Admin Assistant keeps the office running and sees that office's records only —
       its dak, its assets, its visitors, its staff. Not another office's. */
    if (onlyMyOffice()) rows = rows.filter(ofMyOffice);
    let editing = editId ? rows.find(r => r.id === editId) : null;
  if (!editing && typeof cfg.prefill === "function") { const pre = cfg.prefill(); if (pre && Object.keys(pre).length) editing = pre; }
    const fieldHtml = f => {
      const v = editing ? (editing[f.k] ?? "") : (f.d ?? "");
      const inner = f.t === "textarea" ? `<textarea name="${f.k}" ${f.req ? "required" : ""}>${esc(v)}</textarea>`
        : f.t === "select" ? `<select name="${f.k}">${(f.o || []).map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : f.t === "myAdvances" ? `<select name="${f.k}"><option value="">No — I paid from my own pocket</option>${(state.myAdvances || []).map(a => `<option value="${a.id}" ${(a.id === v || a.id === state.spendAgainst) ? "selected" : ""}>${esc(a.purpose || "Advance")} · ₹${Number(a.left || a.amount).toLocaleString("en-IN")} left</option>`).join("")}</select>`
        : f.t === "programmes" ? `<select name="${f.k}"><option value="">—</option>${(state.programmes || []).map(p => `<option value="${p.id}" ${p.id === v ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`
        : f.t === "orgEvents" ? `<select name="${f.k}"><option value="">— none —</option>${(state._orgEvents||[]).filter(e=>e.date>=today()).map(e=>`<option value="${e.id}" ${v===e.id?"selected":""}>${fmtD(e.date)} · ${esc(e.title)}</option>`).join("")}</select>`
        : f.t === "activities" ? `<select name="${f.k}" data-acts="1"><option value="">—</option>${(state.activities || []).map(a => `<option value="${a.id}" data-proj="${a.projectId || ""}" ${v === a.id ? "selected" : ""}>${esc(projectName(a.projectId))} · ${esc(a.name || "")}</option>`).join("")}</select>`
        : f.t === "projects" ? `<select name="${f.k}"><option value="">${f.req ? "—" : "— organisation work, not project-funded —"}</option>${(state.projects || []).filter(isLiveProject).map(p => `<option value="${p.id}" ${v === p.id ? "selected" : ""}>${esc(p.code || p.name)}</option>`).join("")}</select>` : f.t === "projectsOld" ? `<select name="${f.k}"><option value="">—</option>${activeProjects().map(p => `<option value="${p.id}" ${p.id === v ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`
        : f.t === "staff" ? `<select name="${f.k}"><option value="">—</option>${staffList().map(u => `<option value="${u.id}" ${u.id === v ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select>`
        : f.t === "team" ? (() => {
            const line = lineUids();
            const myTeam = state.users.filter(u => u.active && u.id !== state.user.uid && line.has(u.id));
            const canAssignOthers = myTeam.length > 0 || has("super_admin","founder");
            const others = canAssignOthers ? state.users.filter(u => u.active && u.id !== state.user.uid && !line.has(u.id)) : [];
            const opt = u => `<option value="${u.id}" ${u.id === v ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`;
            return `<select name="${f.k}" required>
              <option value="${state.user.uid}" ${(!v || v === state.user.uid) ? "selected" : ""}>Myself — my own task</option>
              ${myTeam.length ? `<optgroup label="My team">${myTeam.map(opt).join("")}</optgroup>` : ""}
              ${others.length ? `<optgroup label="Others">${others.map(opt).join("")}</optgroup>` : ""}
            </select>`; })()
        : f.t === "users" ? `<select name="${f.k}"><option value="">—</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === v ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`
        : f.t === "state" ? `<select name="${f.k}" data-geo="state">${stateOptions(v || "Haryana")}</select>`
        : f.t === "district" ? `<select name="${f.k}" data-geo="district" data-selected="${esc(v || "")}">${districtOptions(editing ? (editing.state || "Haryana") : "Haryana", v)}</select>`
        : f.t === "offices" ? `<select name="${f.k}"><option value="">—</option>${state.offices.map(o => `<option value="${o.id}" ${o.id === v ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`
        : f.t === "check" ? `<label class="check"><input type="checkbox" name="${f.k}" ${v ? "checked" : ""}> ${esc(f.l)}</label>`
        : f.t === "files" ? `<input type="file" name="${f.k}" accept="image/*,.pdf" multiple>` : f.t === "file" ? `<input type="file" name="${f.k}" accept="image/*,.pdf">`
        : `<input type="${f.t || "text"}" name="${f.k}" value="${esc(v)}" ${f.req ? "required" : ""} ${f.t === "number" ? `inputmode="decimal" step="${f.step || "any"}"${f.min !== undefined ? ` min="${f.min}"` : ""}` : ""} ${f.ph ? `placeholder="${esc(f.ph)}"` : ""}>`;
      return f.t === "check" ? `<div class="field">${inner}</div>` : `<label class="field"><span>${esc(f.l)}</span>${inner}</label>`;
    };
    const pairs = []; let cur = [];
    cfg.fields.forEach(f => { if (f.w === "half") { cur.push(f); if (cur.length === 2) { pairs.push(cur); cur = []; } } else { if (cur.length) { pairs.push(cur); cur = []; } pairs.push([f]); } }); if (cur.length) pairs.push(cur);
    const formHtml = pairs.map(p => p.length === 2 ? `<div class="two">${p.map(fieldHtml).join("")}</div>` : fieldHtml(p[0])).join("");
    const cell = (r, c) => { const v = r[c.k]; if (c.f) return c.f(v, r); if (c.t === "projects") return esc(projectName(v)); if (c.t === "users") return esc(userName(v)); if (c.t === "offices") return esc(officeName(v)); if (c.t === "date") return v ? fmtD(v) : ""; if (c.t === "money") return v ? Number(v).toLocaleString("en-IN") : ""; if (c.t === "check") return v ? "✓" : "";
    if (c.t === "file") {
      if (!v) return "";
      if (typeof v === "string" && v.startsWith("data:")) return "📎 image";
      if (typeof v === "object" && v.url) return `<a href="${esc(v.url)}" target="_blank" rel="noopener">📎 ${esc(v.name||"file")}</a>`;
      if (Array.isArray(v)) return v.map(f2 => `<a href="${esc(f2.url||f2.data||"#")}" target="_blank" rel="noopener">📎 ${esc(f2.name||"file")}</a>`).join(" ");
      return "📎";
    }
    return esc(v ?? ""); };
    const stats = cfg.stats ? `<div class="grid">${cfg.stats(rows).map(([l, v]) => `<div class="card stat"><span class="muted small">${esc(l)}</span><b>${v}</b></div>`).join("")}</div>` : "";
    const top = cfg.topCard ? await cfg.topCard() : "";
    html(`${top}${cfg.intro ? `<div class="card"><p class="small muted">${cfg.intro}</p></div>` : ""}${stats}
      ${canEdit ? `<div class="card" id="formCard"><h2>${editing ? "Edit" : (cfg.addTitle || "Add")}</h2><form id="rf">${formHtml}
        <div style="display:flex;gap:8px;margin-top:6px"><button class="btn small" type="submit">${editing ? "Save changes" : (cfg.addLabel || "Save")}</button>${editing ? `<button class="btn small quiet" type="button" id="rcancel">Cancel</button>` : ""}</div>
        ${cfg.flow ? `<p class="small muted" style="margin-top:8px">${cfg.flow}</p>` : ""}</form></div>` : ""}
      ${cfg.scopeByArea && !seesAllAreas() ? `<div class="card"><p class="small muted">You see the groups of the state you work in. Programme leadership sees them all.</p></div>` : ""}
      ${isObserver() ? `<div class="card"><p class="small muted">You are signed in as an observer — everything is visible, nothing can be changed.</p></div>` : ""}
      ${!cfg.orgWide && !seesWholeOrg() ? `<div class="card"><p class="small muted">You see your own entries and those of everyone reporting to you. The reporting authority for this area sees all of it.</p></div>` : ""}
      <div class="card"><h2>${cfg.listTitle || cfg.title} (${rows.length})</h2><div class="tablewrap"><table class="table"><tr>${cfg.cols.map(c => `<th>${esc(c.l)}</th>`).join("")}${canEdit ? "<th></th>" : ""}</tr>
        ${rows.map(r => { const canEditThis = canEdit && (!cfg.canEditRow || cfg.canEditRow(r)); return `<tr>${cfg.cols.map(c => `<td>${cell(r, c)}</td>`).join("")}${canEdit ? `<td style="white-space:nowrap">${(cfg.actions || []).map(a => a.show && !a.show(r) ? "" : `<button class="btn small quiet" data-act="${a.k}" data-id="${r.id}">${esc(a.l)}</button> `).join("")}${canEditThis ? `<button class="btn small quiet" data-edit="${r.id}">Edit</button>` : ""}${has("super_admin") ? ` <button class="btn small danger" data-del="${r.id}" title="Delete (App Super Admin)">✕</button>` : ""}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${cfg.cols.length + 1}" class="empty">${cfg.empty || "Nothing here yet"}</td></tr>`}</table></div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn small quiet" id="rexport">Export CSV</button>${cfg.extraButtons || ""}</div></div>`);
    wireActivityCascade();   // project chosen → only that project's activities
    if ($("rf")) $("rf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = {};
      const _submitBtn = $("rf").querySelector("button[type=submit],button.btn:last-of-type");
      const _origTxt = _submitBtn ? _submitBtn.textContent : "";
      if (_submitBtn) { _submitBtn.disabled = true; _submitBtn.textContent = "Saving…"; }
      const FILE_FOLDERS = { dak:"admin", incidents:"governance", assets:"admin", handovers:"admin", letters:"admin",
        registrations:"compliance", policies:"compliance", meetings:"governance", advances:"accounts", expenses:"accounts",
        incomeReceipts:"accounts", persons:"program", groups:"program", eventReports:"program",
        assignments:"program",
        proposals:"fundraising", opportunities:"fundraising", obligations:"fundraising", outreach:"fundraising" };
      let _uploadFailed = false;
      for (const f of cfg.fields) { if (f.t === "check") d[f.k] = fd.get(f.k) === "on"; else if (f.t === "file") {
      const file = fd.get(f.k); if (file && file.size) {
        if (_submitBtn) _submitBtn.textContent = "Uploading " + file.name + "…";
        try {
          const folder = FILE_FOLDERS[cfg.col] || "admin";
          const res = await uploadToDrive(file, folder, file.name);
          if (res) { d[f.k] = { name: file.name, url: res.webViewLink || res.url || "" }; }
          else { toast("Could not save " + file.name + " — please try again or use a smaller file"); _uploadFailed = true; }
        } catch(e) { toast("Upload failed: " + file.name + " — " + (e.message || "check your connection")); _uploadFailed = true; }
      }
    }
        else if (f.t === "number") d[f.k] = fd.get(f.k) === "" ? null : Number(fd.get(f.k)); else d[f.k] = fd.get(f.k); }
      for(var _mf=0;_mf<(cfg.fields||[]).length;_mf++){var _mfc=cfg.fields[_mf];if(_mfc.t!=='files')continue;var _mfi=document.querySelector('form#rf [name="'+_mfc.k+'"]');var _mffs=[].slice.call((_mfi&&_mfi.files)||[]);if(!_mffs.length)continue;var _mffolder={dak:'admin',incidents:'governance',eventReports:'program'}[cfg.col]||'admin';var _mfurls=[];for(var _mfj=0;_mfj<_mffs.length;_mfj++){try{var _mfup=await uploadToDrive(_mffs[_mfj],_mffolder,_mffs[_mfj].name);if(_mfup&&_mfup.link)_mfurls.push({name:_mffs[_mfj].name,link:_mfup.link,url:_mfup.link,at:today()});else{toast('Could not upload '+_mffs[_mfj].name+' — try again');_uploadFailed=true;}}catch(_mfe){toast('Upload failed: '+_mffs[_mfj].name+' — '+(_mfe.message||'check your connection'));_uploadFailed=true;}}
if(_mfurls.length)d[_mfc.k]=_mfurls;}
if(!editing&&(cfg.col==='projects'||cfg.col==='programmes')){var _dfn=d.code||d.name||'New';var _dfd=new FormData();_dfd.append('action','createFolder');_dfd.append('name',_dfn);_dfd.append('parent','program');fetch('https://script.google.com/macros/s/AKfycbyHwQzfONM_-tDwvfvTBN5qe-GYz-NhnWFCwdJTusPAwvAX0PvoWqui9TQgoFzJwJDe/exec',{method:'POST',body:_dfd}).catch(function(e){console.warn('Drive folder create failed:',e);});}
if (cfg.assigneeScope && d.assigneeId) {
        const target = state.users.find(u => u.id === d.assigneeId);
        const line = lineUids();
        if (d.assigneeId !== state.user.uid && !line.has(d.assigneeId)) { toast("You can only assign work to yourself or to someone who reports to you."); return; }
        if ((target?.roles || []).some(r => ["board", "super_admin", "management"].includes(r))) { toast("Work cannot be assigned to the Founder or to Board members."); return; }
      }
      if (_uploadFailed) { if (_submitBtn) { _submitBtn.disabled = false; _submitBtn.textContent = _origTxt; } return; }
      if (typeof canWrite === "function" && !canWrite()) { toast("You are viewing as someone else — exit View As to make changes."); if (_submitBtn) { _submitBtn.disabled = false; _submitBtn.textContent = _origTxt; } return; }
      if (_submitBtn) _submitBtn.textContent = "Saving…";
      if (cfg.before) await cfg.before(d, editing);
      if (editing) { await col.doc(editing.id).update({ ...d, updatedBy: state.user.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), changedAt: new Date().toISOString() }); audit("update", cfg.col, editing.id, d[cfg.nameKey || "name"] || ""); if (cfg.after) await cfg.after(editing.id, d); }
      else { const ref = await col.add({ ...stamp(d), createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp(), changedAt: new Date().toISOString() }); audit("create", cfg.col, ref.id, d[cfg.nameKey || "name"] || ""); if (cfg.after) await cfg.after(ref.id, d);
        // Auto-log to day report
        if (typeof autoLogActivity === "function") {
          const logMap = { eventReports: "Filed an event report" + (d.heading?" · "+d.heading:""), dayReports: null, caseUpdates: "Recorded a case update" + (d.notes?" · "+(d.notes||"").slice(0,60):""), dak: "Entered a dak record", journeys: "Submitted a journey report", handovers: "Filed a handover", incomeReceipts: "Recorded an income receipt · ₹"+(d.amount||""), expenses: "Filed an expense claim · "+(d.head||d.category||"")+(d.amount?" · ₹"+d.amount:""), advances: "Requested an advance · "+(d.purpose||"")+(d.amount?" · ₹"+d.amount:""), requisitions: "Raised a requisition · "+(d.item||d.purpose||""), pettyCash: "Recorded a cash entry · "+(d.particulars||"")+(d.outAmt?" · ₹"+d.outAmt:""), assignments: "Completed task · "+(d.title||d.what||"") };
          const logText = logMap[cfg.col]; if (logText) autoLogActivity(logText).catch(()=>{});
        }
      }
      successFlash("Saved"); if (cfg.reloadMasters) await loadMasters(); routes[cfg.route](); };
    if ($("rcancel")) $("rcancel").onclick = () => routes[cfg.route]();
    $("content").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { routes[cfg.route](b.dataset.edit); setTimeout(() => $("formCard")?.scrollIntoView({ behavior: "smooth" }), 50); });
    $("content").querySelectorAll("[data-act]").forEach(b => b.onclick = async () => { const a = cfg.actions.find(x => x.k === b.dataset.act); const r = rows.find(x => x.id === b.dataset.id); await a.run(r, col.doc(r.id)); if (state.route === cfg.route) routes[cfg.route](); });
    $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this record permanently? This is logged in the audit trail.")) return; const r = rows.find(x => x.id === b.dataset.del); await col.doc(b.dataset.del).delete(); audit("delete", cfg.col, b.dataset.del, r?.[cfg.nameKey || "name"] || ""); toast("Deleted"); routes[cfg.route](); });
    $("rexport").onclick = () => { const cols = cfg.cols; const csv = [cols.map(c => c.l).join(",")].concat(rows.map(r => cols.map(c => `"${String(cell(r, c)).replace(/<[^>]+>/g, "").replace(/"/g, '""')}"`).join(","))).join("\n"); download(`${cfg.col}-${today()}.csv`, new Blob([csv], { type: "text/csv" })); };
  };
}
const statusTag = v => `<span class="tag ${/approved|done|paid|active|verified|complete|received|closed|current|ok/i.test(v) ? "ok" : /reject|overdue|blocked|lost|bad|needs|missing/i.test(v) ? "bad" : "warn"}">${esc(v || "")}</span>`;
const nextStatus = (k, list) => ({ k: "st", l: "Change status", run: async (r, ref) => {
  const v = prompt(`Status (${list.join(" / ")}):`, r[k]); if (v === null) return;
  /* Rejecting, or undoing a payment, is not a small thing — it needs a reason,
     and a warning where money has already moved. */
  const hard = /reject|return|cancel/i.test(v);
  const paid = /issued|paid|settled/i.test(r[k] || "") || r.issuedOn || r.paidOn;
  if (hard && paid && !confirm(`This record already shows money paid${r.issuedOn ? " on " + fmtD(r.issuedOn) : ""}.\n\nMarking it "${v}" does not undo the payment — the bank entry stands. Change it anyway?`)) return;
  let note = prompt(hard ? `Why "${v}"? (required — it stays on the record)` : "Note (optional):") || "";
  if (hard && !note.trim()) return alert("A reason is needed before a record can be rejected or returned.");
  await ref.update({ [k]: v, history: [...(r.history || []), { at: today(), status: v, by: state.me.name, note }] });
  audit("status", ref.parent.id, r.id, v + (note ? " · " + note : "")); } });
const inDept = (...roles) => () => has("super_admin", ...roles);
const isAdminDept = inDept("admin", "admin");
const isAccounts = inDept("director_acf", "accountant");   // recording a payment is Accounts work
const isCompliance = inDept("compliance_head", "admin");
const isProgramDept = inDept("admin", "program_officer", "field_staff");

/* ================= ADMIN ================= */
routes.posts = registerScreen({ route: "posts", col: "posts", orgWide: true, title: "Posts & organigram", orderBy: "department", dir: "asc", nameKey: "title", reloadMasters: false, canEdit: () => has("super_admin"),
  intro: "Posts first; the holder is shown separately. <b>Line of reporting</b> is where approvals go; <b>functional supervision</b> sees the work but does not approve. Load the organigram here once, then change it from Change structure.",
  fields: [{ k: "title", l: "Post title", req: true, w: "half" }, { k: "department", l: "Department", t: "select", o: ["Admin", "Program", "Accounts", "Fund raising", "Compliance", "Governance"], w: "half" },
    { k: "reportsTo", l: "Line of reporting (post title)", w: "half" }, { k: "functional", l: "Functional supervision (post titles)", w: "half" },
    { k: "officeId", l: "Office", t: "offices", w: "half" }, { k: "holderId", l: "Current holder (app user)", t: "users", w: "half" }, { k: "holderName", l: "Holder name (if not yet signed in)", w: "half" },
    { k: "taCategory", l: "TA category (FP §5A)", t: "select", o: ["III", "II", "I"], w: "half" }, { k: "limit", l: "Proactive financial limit ₹ (FP §9)", t: "number", w: "half" },
    { k: "purpose", l: "Purpose of the post", t: "textarea" }, { k: "responsibilities", l: "Responsibilities", t: "textarea" }, { k: "authority", l: "Authority (what this post may and may not approve)", t: "textarea" }, { k: "chargeOut", l: "Charge-out (project · head · %)", ph: "SAMPURNA 1101-1 50%; ASAP ORG-3 50%" }],
  cols: [{ k: "title", l: "Post" }, { k: "department", l: "Dept" }, { k: "reportsTo", l: "Line of reporting" }, { k: "functional", l: "Functional" }, { k: "holderId", l: "Holder", f: (v, r) => esc(userName(v) || r.holderName || "vacant") }, { k: "officeId", l: "Office", t: "offices" }, { k: "taCategory", l: "TA" }, { k: "limit", l: "Limit ₹", t: "money" }, { k: "authority", l: "Authority", f: v => esc((v || "").slice(0, 70)) }],
  stats: rows => [["Posts", rows.length], ["Vacant", rows.filter(r => !r.holderId).length], ["Departments", new Set(rows.map(r => r.department)).size]],
  after: async (id, d) => {
    const allPosts = state.posts || [];
    // Update holder's postId and postTitle
    if (d.holderId) {
      await db.collection("users").doc(d.holderId).update({ postId: id, postTitle: d.title || "" }).catch(()=>{});
    }
    // Resolve reportsTo → manager uid → update holder's managerIds
    if (d.holderId && d.reportsTo) {
      const mgrPost = allPosts.find(p => p.title === d.reportsTo);
      if (mgrPost?.holderId) {
        await db.collection("users").doc(d.holderId).update({ managerIds: [mgrPost.holderId] }).catch(()=>{});
      }
    }
    // If this post's holder changed, update everyone who reports to this post
    if (d.holderId && d.title) {
      const subordinatePosts = allPosts.filter(p => p.reportsTo === d.title && p.holderId && p.holderId !== d.holderId);
      for (const sp of subordinatePosts) {
        await db.collection("users").doc(sp.holderId).update({ managerIds: [d.holderId] }).catch(()=>{});
      }
    }
    await loadMasters();
  },
  extraButtons: has("super_admin") ? `<button class="btn small quiet" onclick="syncReportingLines()">Sync all reporting lines</button>` : "" });

async function syncReportingLines() {
  const posts = (await db.collection("posts").get()).docs.map(d=>({id:d.id,...d.data()}));
  let count = 0;
  // Group by holderId so multi-post holders get merged managerIds
  const byHolder = {};
  for (const p of posts) {
    if (!p.holderId) continue;
    if (!byHolder[p.holderId]) byHolder[p.holderId] = { postId: p.id, postTitle: p.title || "", managerIds: [] };
    if (p.reportsTo) {
      const mgrPost = posts.find(x => x.title === p.reportsTo);
      if (mgrPost?.holderId && !byHolder[p.holderId].managerIds.includes(mgrPost.holderId))
        byHolder[p.holderId].managerIds.push(mgrPost.holderId);
    }
  }
  for (const [uid, patch] of Object.entries(byHolder)) {
    const update = { postId: patch.postId, postTitle: patch.postTitle };
    if (patch.managerIds.length) update.managerIds = patch.managerIds;
    await db.collection("users").doc(uid).update(update).catch(()=>{});
    count++;
  }
  toast("Synced " + count + " reporting lines ✓");
  await loadMasters();
}

routes.profileApprovals = async () => {
  setTitle("Profile approvals");
  const SUPER = has("super_admin"), PDRI = has("fundraising");
  if (!SUPER && !PDRI) return html(`<div class="card"><div class="empty">New profiles are approved by the Founder &amp; General Secretary; volunteers by Project Development, Research &amp; Innovations.</div></div>`);
  const snap = await db.collection("users").where("active", "==", false).get();
  const VOL = ["volunteer", "community"];
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status === "pending");
  // Volunteers and community leaders are verified by Project Development, Research & Innovations;
  // staff, consultants and board members by the Founder & General Secretary.
  const volQueue = all.filter(u => VOL.includes(u.joinAs || "staff"));
  const pend = SUPER ? all : volQueue;
  const posts = (await db.collection("posts").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const SUGGEST = { staff: ["field_staff"], volunteer: ["volunteer"], community: ["volunteer"], board: ["board"], consultant: ["field_staff"] };
  const JOINLABEL = { staff: "Staff member", volunteer: "Volunteer", community: "Community leader", board: "Board / Advisory", consultant: "Consultant / Intern" };
  const DEPTROLE = { Program: "field_staff", Admin: "admin", Accounts: "accountant", "Fund raising": "fundraising", Compliance: "compliance_head" };
  html(`${SUPER && volQueue.length ? `<div class="card"><p class="small muted">${volQueue.length} volunteer profile(s) are with Project Development, Research &amp; Innovations. You can approve them here too if needed.</p></div>` : ""}
    <div class="card"><h2>${PDRI && !SUPER ? "Volunteers awaiting verification" : "New profiles awaiting approval"} (${pend.length})</h2>
    <p class="small muted">${PDRI && !SUPER ? "Volunteers and community leaders sign in and fill a profile; they can do nothing in the app until you verify them and say who supervises them." : "Anyone can sign in and create a profile; nothing works until it is approved. Staff and board profiles come to you; volunteers go to Project Development, Research &amp; Innovations."}</p><div class="list">
    ${pend.map(u => `<div class="item"><div class="grow"><div class="t">${u.photo ? `<img src="${u.photo}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px">` : ""}${esc(u.name)} · ${esc(u.email)}</div>
      <div class="s"><span class="tag">${esc(JOINLABEL[u.joinAs] || "Staff member")}</span> ${esc(u.department || "")} · ${esc(officeName(u.officeId))} · joined ${esc(u.joined || "—")}</div>
      <div class="s">Wrote: <b>"${esc(u.designation || "")}"</b>${u.body ? " · " + esc(u.body) : ""}${u.projectId ? " · project: " + esc(projectName(u.projectId)) : ""}${u.managerId ? " · line manager: " + esc(userName(u.managerId)) : ""}${u.availability ? " · available: " + esc(u.availability) : ""} · phone ${esc(u.phone || "—")}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select data-post="${u.id}" style="width:auto;padding:4px 8px;border-radius:8px;font-size:14px"><option value="">${u.joinAs === "volunteer" || u.joinAs === "community" ? "No post (volunteer)" : u.joinAs === "board" ? "No post (board member)" : "Match to post…"}</option>${posts.map(p => `<option value="${p.id}">${esc(p.title)}${p.holderId ? " (held)" : " (vacant)"}</option>`).join("")}</select>
      <select data-roles="${u.id}" multiple size="4" style="width:auto;padding:4px 8px;border-radius:8px;font-size:12px">${Object.entries(ROLES).map(([k, v]) => { const want = [...(SUGGEST[u.joinAs] || ["field_staff"]), ...(u.joinAs === "staff" && DEPTROLE[u.department] ? [DEPTROLE[u.department]] : [])]; return `<option value="${k}" ${want.includes(k) ? "selected" : ""}>${v}</option>`; }).join("")}</select>
      <button class="btn small" data-approve="${u.id}">Approve</button><button class="btn small quiet" data-ask="${u.id}">Ask for changes</button><button class="btn small danger" data-decline="${u.id}">Decline</button></div></div></div>`).join("") || `<div class="empty">Nobody waiting</div>`}</div></div>`);
  $("content").querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => { const id = b.dataset.approve; const u = pend.find(x => x.id === id) || {}; const postId = $("content").querySelector(`[data-post="${id}"]`).value; const roles = [...$("content").querySelector(`[data-roles="${id}"]`).selectedOptions].map(o => o.value);
    const post = posts.find(p => p.id === postId); const mgr = post ? posts.find(p => p.title === post.reportsTo) : null;
    const managerIds = u.managerId ? [u.managerId] : (mgr?.holderId ? [mgr.holderId] : []);
    await db.collection("users").doc(id).update({ active: true, status: "approved", roles: roles.length ? roles : ["field_staff"], postId: postId || null, postTitle: post?.title || null, managerIds, approvedBy: state.user.uid, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if (post) await db.collection("posts").doc(post.id).update({ holderId: id });
    if (u.joinAs === "volunteer" || u.joinAs === "community") {
      const already = await db.collection("volunteers").where("userId", "==", id).limit(1).get().catch(() => ({ empty: true }));
      if (already.empty) await db.collection("volunteers").add({ name: u.name, userId: id, projectId: u.projectId || null, officeId: u.officeId || null,
        supervisorId: u.managerId || null, role: u.designation || "", days: u.availability || "", till: u.till || null,
        since: u.joined || today(), phone: u.phone || "", status: "Active", createdBy: state.user.uid }).catch(() => {});
    }
    audit("approve_profile", "users", id, post?.title || ""); toast("Approved"); await loadMasters(); routes.profileApprovals(); });
  $("content").querySelectorAll("[data-ask]").forEach(b => b.onclick = async () => { const note = prompt("What should they change?"); if (!note) return; await db.collection("users").doc(b.dataset.ask).update({ status: "changes", note }); routes.profileApprovals(); });
  $("content").querySelectorAll("[data-decline]").forEach(b => b.onclick = async () => { if (!confirm("Decline this profile?")) return; await db.collection("users").doc(b.dataset.decline).update({ status: "declined" }); routes.profileApprovals(); });
};

routes.structure = async () => {
  setTitle("Change structure");
  if (!has("super_admin")) return html(`<div class="card"><div class="empty">Only the App Super Admin changes the organisational structure.</div></div>`);
  const posts = (await db.collection("posts").orderBy("department").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  html(`<div class="card"><h2>Move a person or change a post</h2><p class="small muted">Every change is dated with a reason and kept in the post's history. Approvals follow the new line immediately.</p>
    <form id="sf"><div class="two"><label class="field"><span>Post</span><select name="postId" required>${posts.map(p => `<option value="${p.id}">${esc(p.title)} — ${esc(userName(p.holderId) || "vacant")}</option>`).join("")}</select></label>
    <label class="field"><span>New holder</span><select name="holderId"><option value="">(leave as is)</option><option value="__vacant">— make vacant —</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>New line of reporting (post title)</span><input name="reportsTo" placeholder="(leave blank to keep)"></label><label class="field"><span>Effective from</span><input type="date" name="from" value="${today()}"></label></div>
    <label class="field"><span>Reason</span><input name="reason" required></label><button class="btn small" type="submit">Save change</button></form></div>
    <div class="card"><h2>History</h2><div class="list">${posts.flatMap(p => (p.history || []).map(h => ({ ...h, post: p.title }))).sort((a, b) => (b.from || "").localeCompare(a.from || "")).slice(0, 40).map(h => `<div class="item"><div class="grow"><div class="t">${esc(h.post)} · ${esc(h.what)}</div><div class="s">by ${esc(h.by)} · effective ${esc(h.from)} · ${esc(h.reason)}</div></div></div>`).join("") || `<div class="empty">No changes yet</div>`}</div></div>`);
  $("sf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const p = posts.find(x => x.id === d.postId); const patch = {}; const what = [];
    if (d.holderId === "__vacant") { patch.holderId = null; what.push(`holder ${userName(p.holderId) || "—"} → vacant`); } else if (d.holderId) { patch.holderId = d.holderId; what.push(`holder ${userName(p.holderId) || "vacant"} → ${userName(d.holderId)}`); await db.collection("users").doc(d.holderId).update({ postId: p.id, postTitle: p.title }); }
    if (d.reportsTo) { patch.reportsTo = d.reportsTo; what.push(`line ${p.reportsTo || "—"} → ${d.reportsTo}`); const mgr = posts.find(x => x.title === d.reportsTo); const holder = patch.holderId ?? p.holderId; if (holder && mgr?.holderId) await db.collection("users").doc(holder).update({ managerIds: [mgr.holderId] }); }
    patch.history = [...(p.history || []), { what: what.join("; ") || "no change", by: state.me.name, from: d.from, reason: d.reason }];
    await db.collection("posts").doc(p.id).update(patch); audit("structure", "posts", p.id, what.join("; ")); successFlash("Saved"); await loadMasters(); routes.structure(); };
};

routes.assets = registerScreen({ route: "assets", col: "assets", orgWide: true, title: "Office assets (stock)", orderBy: "createdAt", nameKey: "item", canEdit: () => has("super_admin", "director_acf", "procurement", "admin"),
  intro: "Kept by Procurement, with the Coordinator – Administration &amp; Communication. Stock, not units — add a quantity once, then assign. Tag is generated on save (EP-LAP-0007 / EP-FUR-0058 / EP-OTH-0061). Items ≥ ₹5,000 are capitalised (FP §8).",
  fields: [{ k: "item", l: "Item name", req: true, w: "half" }, { k: "category", l: "Category", t: "select", o: ["Laptop (LAP)", "Furniture (FUR)", "Stationery (STA)", "Phone (PHN)", "Vehicle (VEH)", "Other (OTH)"], w: "half" },
    { k: "fundSource", l: "How it came", t: "select", o: FUND_SOURCES, w: "half" }, { k: "assetType", l: "Asset type", t: "select", o: ["Fixed Asset", "Consumable"], w: "half" },
    { k: "qty", l: "Total quantity", t: "number", d: 1, w: "half" }, { k: "cost", l: "Cost per unit ₹", t: "number", w: "half" }, { k: "projectId", l: "Project it was bought under", t: "projects", w: "half" }, { k: "donorCode", l: "Donor code (only if donated in kind)", ph: "ANAND, TATATRUST", w: "half" }, { k: "boughtOn", l: "Bought / received on", t: "date", w: "half" }, { k: "officeId", l: "Office", t: "offices", w: "half" },
    { k: "assignedTo", l: "Issued to", t: "users", w: "half" }, { k: "condition", l: "Condition", t: "select", o: ["Good", "Needs repair", "Written off"], w: "half" }, { k: "notes", l: "Notes (vendor, purchase date, serial)" }, { k: "invoice", l: "Invoice / photo", t: "file" }],
  before: async d => {
    if (!d.serial) { try { d.serial = await nextAssetSerial(); } catch(e) { throw new Error("Could not generate asset serial — try again."); } }
    if (d.fundSource === "Donated in kind") { d.projectId = null; if (!d.donorCode) throw new Error("A donated item needs the donor's short code, so the tag says who gave it."); }
    else { d.donorCode = null; }
    d.fy = fyOfDate(d.boughtOn); d.tag = assetTag(d); d.capitalise = (d.cost || 0) >= 5000; },
  after: async (id, d) => { toast(`Asset registered as ${d.tag} ✅`); setTimeout(()=>{ if(typeof printLabels==="function" && window.confirm(`Print label for ${d.tag}?`)) printLabels([{id,...d}]); },200); },
  cols: [{ k: "tag", l: "Code", f: (v, r) => `<span style="font-family:monospace">${esc(v || "")}</span>` }, { k: "item", l: "Item" }, { k: "category", l: "Category" }, { k: "qty", l: "Qty" }, { k: "assignedTo", l: "Issued to", t: "users" }, { k: "officeId", l: "Office", t: "offices" }, { k: "cost", l: "Cost ₹", t: "money" }, { k: "fundSource", l: "How it came" }, { k: "fy", l: "FY" }, { k: "condition", l: "Condition", f: statusTag }, { k: "capitalise", l: "Cap.", t: "check" }],
  actions: [{ k: "open", l: "Open", run: async r => { state.assetId = r.id; go("asset"); } }, { k: "label", l: "Label", run: async r => printLabels([r]) }],
  stats: rows => [["Items", rows.length], ["Units", rows.reduce((a, r) => a + (r.qty || 0), 0)],
    ["FCRA assets", rows.filter(r => /under an FCRA/.test(r.fundSource || "")).length],
    ["Donated", rows.filter(r => r.fundSource === "Donated in kind").length],
    ["Capitalised", rows.filter(r => r.capitalise).length]],
  extraButtons: `<button class="btn small quiet" onclick="go('assetVerify')">Verification round &amp; labels</button>` });

routes.vendors = registerScreen({ route: "vendors", col: "vendors", orgWide: true, title: "Vendors", orderBy: "name", dir: "asc", canEdit: () => has("super_admin", "director_acf", "procurement"),
  fields: [{ k: "name", l: "Vendor / supplier", req: true, w: "half" }, { k: "category", l: "Category", t: "select", o: ["Printing", "Stationery", "Travel / transport", "Venue / catering", "IT & electronics", "Furniture", "Professional services", "Other"], w: "half" },
    { k: "contact", l: "Contact person", w: "half" }, { k: "phone", l: "Phone", w: "half" }, { k: "email", l: "Email", w: "half" }, { k: "status", l: "Status", t: "select", o: ["Active", "Preferred", "Blacklisted"], w: "half" },
    { k: "gstin", l: "GSTIN", w: "half" }, { k: "pan", l: "PAN", w: "half" }, { k: "bankHolder", l: "Bank account holder", w: "half" }, { k: "bankAcc", l: "Bank account number (Accounts only)", w: "half" }, { k: "bankName", l: "Bank", w: "half" }, { k: "ifsc", l: "IFSC", w: "half" }, { k: "notes", l: "Notes (rates, past work)", t: "textarea" }],
  cols: [{ k: "name", l: "Name" }, { k: "category", l: "Category" }, { k: "contact", l: "Contact" }, { k: "phone", l: "Phone" }, { k: "status", l: "Status", f: statusTag }, { k: "gstin", l: "GST" }, { k: "pan", l: "PAN" }, { k: "bankName", l: "Bank" }] });

routes.handover = registerScreen({ route: "handover", col: "handovers", orgWide: true, title: "File handovers", orderBy: "createdAt", nameKey: "file",
  canEdit: () => isActive(), intro: "The receiver confirms receipt separately. When a post is vacated, every file, asset and cash item it holds must be handed over first.",
  fields: [{ k: "file", l: "File / folder / item", req: true, w: "half" }, { k: "type", l: "Record type", t: "select", o: ["Physical file", "Digital file", "Asset", "Keys / cash box"], w: "half" },
    { k: "fromId", l: "Handed over by", t: "users", w: "half" }, { k: "toId", l: "Received by", t: "users", w: "half" }, { k: "date", l: "Date", t: "date", d: today(), w: "half" }, { k: "reason", l: "Reason", t: "select", o: ["Case escalation", "Leave / absence", "Transfer", "Exit from post", "Audit", "Monthly"], w: "half" },
    { k: "notes", l: "Notes / checklist", t: "textarea", ph: "Pages, annexures, seal, USB, signature requirement" }, { k: "proof", l: "Receipt / proof photo", t: "file" }],
  before: d => { d.status = "awaiting receipt"; },
  cols: [{ k: "file", l: "File" }, { k: "type", l: "Type" }, { k: "fromId", l: "From", t: "users" }, { k: "toId", l: "To", t: "users" }, { k: "date", l: "Date", t: "date" }, { k: "reason", l: "Reason" }, { k: "status", l: "Status", f: statusTag }],
  actions: [{ k: "confirm", l: "Confirm receipt", show: r => r.status !== "received" && (r.toId === state.user.uid || isAdmin()), run: async (r, ref) => { await ref.update({ status: "received", receivedAt: today(), confirmedBy: state.user.uid }); audit("received", "handovers", r.id, r.file); } }] });

routes.itinerary = registerScreen({ route: "itinerary", col: "travelRequests", orgWide: true, title: "Itinerary & travel", orderBy: "createdAt", nameKey: "purpose", canEdit: () => isActive(),
  flow: "→ your manager verifies → the Director ACF approves → advance issued → trip closes with a travel claim (TA by post category, FP §5A)",
  fields: [{ k: "purpose", l: "Purpose", req: true }, { k: "projectId", l: "Project / activity", t: "projects", w: "half" }, { k: "travellerId", l: "Traveller", t: "users", w: "half" },
    { k: "from", l: "From (date)", t: "date", d: today(), w: "half" }, { k: "to", l: "To (date)", t: "date", w: "half" }, { k: "legs", l: "Legs (date · from → to · mode · depart · arrive · est ₹)", t: "textarea" },
    { k: "advance", l: "Advance requested ₹", t: "number", w: "half" }, { k: "perDiemDays", l: "Per-diem days", t: "number", w: "half" }, { k: "contacts", l: "People to meet", t: "textarea" }],
  before: d => { d.status = "submitted";
    d.travellerId = d.travellerId || state.user.uid;
    /* Without these the request belongs to nobody: it reaches no manager,
       appears in no inbox, and cannot be found by whoever is to book it. */
    d.uid = state.user.uid;
    const traveller = state.users.find(u => u.id === d.travellerId) || state.me;
    d.managerIds = [...new Set([...(mgrs(state.me) || []), ...(mgrs(traveller) || [])])];
    d.raisedBy = state.me.name;
  },
  cols: [{ k: "travellerId", l: "Traveller", t: "users" }, { k: "purpose", l: "Purpose" }, { k: "from", l: "From", t: "date" }, { k: "to", l: "To", t: "date" }, { k: "projectId", l: "Project", t: "projects" }, { k: "advance", l: "Advance ₹", t: "money" }, { k: "status", l: "Status", f: statusTag }],
  actions: [
    nextStatus("status", ["submitted", "verified", "approved", "advance issued", "completed", "returned", "rejected"]),
    { k: "dlF06", l: "↓ F-06", show: r => ["approved","completed"].includes(r.status),
      run: async (r) => { await downloadFilledForm("F-06","travelRequests",r.id,{...r,byName:userName(r.uid||r.travellerId),travellerName:userName(r.travellerId),projectName:projectName(r.projectId),officeName:officeName(r.officeId)}); } }
  ] });

/* A journey records how somebody travelled. What came of the visit is the part worth
   keeping, and the part a donor report is written from — so it is asked for once the
   date has passed. */
const visitActions = [
  { k: "report", l: "Report on the visit",
    show: r => (r.uid === state.user.uid || r.travellerId === state.user.uid) && !r.visitReport
      && String(r.date || "") <= today(),
    run: async (r, ref) => {
      const what = prompt("What came of this visit?\n\nWho you met, what was decided, what is still to do.");
      if (!what || !what.trim()) return;
      const met = prompt("Who you met, and how many? (optional)") || "";
      await ref.update({ visitReport: what.trim(), metWhom: met, reportedOn: today() });
      audit("visit_report", "journeys", r.id, what.slice(0, 60));
      successFlash("Saved");
    } }];

routes.travelog = async () => {
  setTitle("My journeys");
  const uid = viewUid();
  const isManager = seesWholeOrg() || isAdmin() || has("director_acf","program_officer","program_coord","program_lead");

  // Fetch journeys
  const mySnap = await db.collection("journeys")
    .where("travellerId","==",uid).limit(30)
    .get().catch(()=>({docs:[]}));
  const all = mySnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const active = all.find(j=>j.status==="on the way");
  const past = all.filter(j=>j.status!=="on the way");

  // Build "What is this journey for?" — my programmes + projects only, then Organisation
  const me = (state.users||[]).find(u=>u.id===uid) || state.me || {};
  const myProgIds = me.programmeIds || [];
  const myProjIds = me.projectIds || [];
  const allProgs = state.programmes || [];
  const allProjs = state.projects || [];
  const myProgs = allProgs.filter(p=>myProgIds.includes(p.id));
  const myProjs = allProjs.filter(p=>myProjIds.includes(p.id));
  const orgCategories = ["Organisational work","Admin & coordination","Training / capacity building","Government liaison","Community outreach","Meeting / event","Other"];
  const workOptions = `
    ${myProgs.length?`<optgroup label="My programmes">${myProgs.map(p=>`<option value="prog:${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>`:""}
    ${myProjs.length?`<optgroup label="My projects">${myProjs.map(p=>`<option value="proj:${p.id}">${esc(p.code||p.name)}</option>`).join("")}</optgroup>`:""}
    <optgroup label="Organisation">${orgCategories.map(c=>`<option value="org:${c}">${esc(c)}</option>`).join("")}</optgroup>
  `;

  // GPS helper
  const getGPS = () => new Promise(res => {
    if(!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy)}),
      ()=>res(null), {timeout:8000,enableHighAccuracy:true}
    );
  });

  const actLine = a => `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line)">
    <span class="small muted" style="min-width:40px">${a.time||""}</span>
    <span class="small">${esc(a.text)}</span>
  </div>`;

  if(active) {
    // ── ACTIVE JOURNEY VIEW ──────────────────────────────────────────
    const log = (active.activityLog||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
    html(`<div class="card" style="border:2px solid var(--green)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0">🚶 Journey in progress</h2>
          <div class="small muted" style="margin-top:4px">
            To <b>${esc(active.toPlace||"")}</b> · ${esc(active.purpose||"")}
            ${active.workLabel?" · "+esc(active.workLabel):""}
          </div>
          <div class="small muted">Started ${active.startedAt||""} · ${fmtD(active.date)}</div>
          ${active.startGPS?`<div class="small muted">📍 Started at ${active.startGPS.lat.toFixed(4)}, ${active.startGPS.lng.toFixed(4)}</div>`:""}
        </div>
        <span class="tag ok">On the way</span>
      </div>

      <div style="margin-top:12px">
        <div class="small muted" style="margin-bottom:4px">Activity log — updates as you work</div>
        ${log.length ? log.map(actLine).join("") : `<div class="empty small">No activity recorded yet — register a Sakhi, file a benefit, or submit an event report and it will appear here.</div>`}
      </div>
    </div>

    <div class="card">
      <h2>I'm back</h2>
      <p class="small muted">Tap when you have returned. The app will capture your location and save the journey report.</p>
      <label class="field"><span>Add a note (optional — anything not captured above)</span>
        <textarea id="visitNote" rows="3" placeholder="Who you met, challenges, what still needs to be done…"></textarea></label>
      <label class="field" style="margin-top:8px"><span>Time you actually returned (leave blank for now)</span>
        <input type="time" id="returnedAt" value="${new Date().toTimeString().slice(0,5)}"></label>
      <button class="btn" id="endBtn">✅ End journey</button>
    </div>

    <div class="card">
      <button class="btn small quiet" id="checkInBtn">📍 Check in (mid-point)</button>
    </div>

    ${past.length?`<div class="card"><h2>Past journeys</h2><div class="list">${past.slice(0,5).map(j=>`<div class="item">
      <div class="grow"><div class="t">${esc(j.toPlace||"")} · ${esc(j.purpose||"")}</div>
        <div class="s">${fmtD(j.date)}${j.startedAt?" · "+j.startedAt:""} → ${j.reachedAt||"?"}</div>
        ${(j.activityLog||[]).length?`<div class="s muted">${(j.activityLog||[]).map(a=>a.text).join(" · ").slice(0,80)}</div>`:""}
      </div><span class="tag ok">reached</span>
    </div>`).join("")}</div></div>`:""}
    `);

    $("endBtn").onclick = async () => {
      $("endBtn").disabled = true; $("endBtn").textContent = "Saving…";
      const gps = await getGPS();
      const note = $("visitNote")?.value||"";
      const log2 = (active.activityLog||[]);
      const summary = log2.map(a=>a.text).join(". ");
      await db.collection("journeys").doc(active.id).update({
        status:"reached", reachedAt:($("returnedAt")?.value||new Date().toTimeString().slice(0,5)),
        returnedDate:today(),
        endGPS:gps||null, visitNote:note||null,
        visitReport:summary+(note?"\n"+note:""),
        changedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      state.activeJourney = null;
      audit("journey_end","journeys",active.id,"reached");
      toast("Journey saved ✅"); routes.travelog();
    };

    $("checkInBtn").onclick = async () => {
      const where = prompt("Where are you now?")||"";
      const gps = await getGPS();
      const checkText = `Check-in: ${where}${gps?` (${gps.lat.toFixed(3)},${gps.lng.toFixed(3)})`:""}`;
      await db.collection("journeys").doc(active.id).update({
        activityLog:firebase.firestore.FieldValue.arrayUnion({text:checkText,time:new Date().toTimeString().slice(0,5),ts:Date.now()}),
        lastCheck:new Date().toTimeString().slice(0,5)
      });
      toast("Checked in"); routes.travelog();
    };

  } else {
    // ── START JOURNEY FORM ───────────────────────────────────────────
    const me = state.me||{};
    html(`<div class="card">
      <h2>Start a journey</h2>
      <p class="small muted">Fill in where you're going — the app fills the rest and tracks your activity during the journey.</p>
      <form id="startForm">
        <div class="two">
          <label class="field"><span>Where are you going?</span>
            <input name="toPlace" placeholder="Village, block, office, district" required></label>
          <label class="field"><span>Purpose</span>
            <select name="purpose">
              <option>Home visit</option><option>Community meeting</option>
              <option>Government office</option><option>Awareness camp</option>
              <option>Training / workshop</option><option>CBO / group meeting</option>
              <option>Field survey</option><option>Other</option>
            </select></label>
        </div>
        <div class="two">
          <label class="field"><span>Starting from</span>
            <input name="fromPlace" placeholder="Your current location" value="${esc((state.offices||[]).find(o=>o.id===me.officeId)?.name||"")}" required></label>
          <label class="field"><span>What is this journey for?</span>
            <select name="workFor" required>${workOptions}</select></label>
        </div>
        <div class="two">
          <label class="field"><span>Expected arrival time</span>
            <input type="time" name="expected"></label>
          <label class="field"><span>Mode of travel</span>
            <select name="mode"><option>Shared auto</option><option>Bus</option><option>Train</option>
            <option>Two-wheeler</option><option>Office vehicle</option><option>Taxi</option><option>Walk</option></select></label>
        </div>
        <label class="field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" name="sensitive" style="width:auto">
          <span>Safety-sensitive — alert my manager if I haven't marked reached within 60 minutes of expected arrival</span>
        </label>
        <button class="btn" type="submit" id="startBtn">🚶 Start journey</button>
      </form>
    </div>

    ${past.length?`<div class="card"><h2>My journeys</h2><div class="list">
    ${past.slice(0,8).map(j=>`<div class="item">
      <div class="grow"><div class="t">${esc(j.toPlace||"")} · ${esc(j.purpose||"")}</div>
        <div class="s">${fmtD(j.date)}${j.startedAt?" · "+j.startedAt:""} → ${j.reachedAt||"?"}${j.projectId?" · "+esc(projectName(j.projectId)):""}</div>
        ${(j.activityLog||[]).length?`<div class="s muted">📋 ${(j.activityLog||[]).map(a=>a.text).join(" · ").slice(0,100)}</div>`:""}
        ${j.visitNote?`<div class="s muted">📝 ${esc(j.visitNote.slice(0,80))}</div>`:""}
      </div>
      <span class="tag ${j.status==="reached"?"ok":"warn"}">${esc(j.status||"planned")}</span>
    </div>`).join("")}
    </div></div>`:"<div class='card'><div class='empty'>No journeys yet — start one above.</div></div>"}
    `);

    $("startForm").onsubmit = async e => {
      e.preventDefault();
      const btn = $("startBtn"); btn.disabled=true; btn.textContent="Getting location…";
      const d = Object.fromEntries(new FormData(e.target));
      // Parse workFor into programmeId / projectId / orgCategory
      const wf = d.workFor||"";
      const programmeId = wf.startsWith("prog:") ? wf.slice(5) : null;
      const projectId = wf.startsWith("proj:") ? wf.slice(5) : null;
      const orgCategory = wf.startsWith("org:") ? wf.slice(4) : null;
      const workLabel = wf.startsWith("prog:") ? myProgs.find(p=>p.id===programmeId)?.name :
                        wf.startsWith("proj:") ? myProjs.find(p=>p.id===projectId)?.code||myProjs.find(p=>p.id===projectId)?.name :
                        orgCategory;
      const gps = await getGPS();
      const now = new Date();
      const ref = await db.collection("journeys").add({
        travellerId: uid, name: me.name||"", date: today(),
        toPlace: d.toPlace, fromPlace: d.fromPlace, purpose: d.purpose,
        programmeId, projectId, orgCategory, workLabel,
        mode: d.mode,
        expected: d.expected||null, sensitive: !!d.sensitive,
        startedAt: now.toTimeString().slice(0,5),
        startGPS: gps||null, status:"on the way",
        activityLog:[], managerIds: me.managerIds||[],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      state.activeJourney = ref.id;
      audit("journey_start","journeys",ref.id,d.toPlace);
      autoLogActivity && autoLogActivity(`Started journey to ${d.toPlace} · ${d.purpose}`).catch(()=>{});
      toast("Journey started 🚶"); routes.travelog();
    };
  }

  // Manager view: if viewing someone else's journeys
  if(isManager && uid !== state.user.uid) {
    const teamSnap = await db.collection("journeys")
      .where("travellerId","==",uid).limit(10)
      .get().catch(()=>({docs:[]}));
    const teamActive = teamSnap.docs.map(d=>({id:d.id,...d.data()})).find(j=>j.status==="on the way");
    if(teamActive) {
      const tj = teamActive;
      const tlog = (tj.activityLog||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
      $("content").insertAdjacentHTML("afterbegin",`<div class="card" style="border:2px solid var(--ok)">
        <h2>🚶 ${esc(tj.name||userName(tj.travellerId))} is on the way to ${esc(tj.toPlace||"")}</h2>
        <div class="small muted">Started ${tj.startedAt} · Expected ${tj.expected||"not set"}${tj.sensitive?"<span class='tag warn' style='margin-left:8px'>Safety-sensitive</span>":""}</div>
        <div style="margin-top:8px">${tlog.length?tlog.map(actLine).join(""):`<div class="empty small">No activity yet.</div>`}</div>
      </div>`);
    }
  }

  // ── Team journeys (managers / admins only) ──────────────────────────────
  if (isManager && !seesWholeOrg()) {
    // Manager: show direct reports' journeys
    const teamUids = (state.users||[]).filter(u=>(u.managerIds||[]).includes(state.user.uid)).map(u=>u.id);
    if (teamUids.length) {
      const tSnap = await db.collection("journeys").limit(200).get().catch(()=>({docs:[]}));
      const teamJ = tSnap.docs.map(d=>({id:d.id,...d.data()})).filter(j=>teamUids.includes(j.travellerId));
      _renderTeamJourneys(teamJ, "My team's journeys");
    }
  } else if (seesWholeOrg()) {
    // Admin / super admin: show all journeys
    const allSnap = await db.collection("journeys").limit(300).get().catch(()=>({docs:[]}));
    _renderTeamJourneys(allSnap.docs.map(d=>({id:d.id,...d.data()})), "All journeys");
  }
};

function _renderTeamJourneys(journeys, title) {
  if (!journeys.length) return;
  const fmtStatus = s => s==="reached"?"Returned":s==="on the way"?"🚶 Travelling":s||"—";
  const statusTag = s => `<span class="tag ${s==="reached"?"ok":s==="on the way"?"warn":""}">${fmtStatus(s)}</span>`;
  const rows = journeys.map(j => {
    const u = (state.users||[]).find(x=>x.id===j.travellerId);
    const hrs = j.status==="on the way" ? Math.round((Date.now()-new Date(j.date+"T"+(j.startedAt||"00:00")+":00+05:30"))/3600000) : null;
    return `<tr>
      <td><b>${esc(u?.name||j.name||"—")}</b></td>
      <td>${esc(j.fromPlace||"—")}</td>
      <td>${esc(j.toPlace||"—")}</td>
      <td>${esc(j.purpose||"—")}</td>
      <td>${fmtD(j.date)}${j.startedAt?" · "+j.startedAt:""}</td>
      <td>${j.reachedAt||"—"}</td>
      <td>${statusTag(j.status)}${hrs!==null&&hrs>=12?` <span class="tag warn">${hrs}h</span>`:""}
      ${j.visitNote?`<div class="small muted" style="margin-top:4px">${esc(j.visitNote.slice(0,60))}</div>`:""}</td>
    </tr>`;
  }).join("");
  const el = document.getElementById("content");
  if (el) el.insertAdjacentHTML("beforeend", `<div class="card" style="margin-top:16px">
    <h2>${esc(title)} (${journeys.length})</h2>
    <div class="tablewrap"><table class="table">
      <tr><th>Name</th><th>From</th><th>To</th><th>Purpose</th><th>Date</th><th>Returned</th><th>Status</th></tr>
      ${rows}
    </table></div>
  </div>`);
}



routes.volunteers = registerScreen({ route: "volunteers", col: "volunteers", orgWide: true, title: "Volunteers", orderBy: "name", dir: "asc",
  canEdit: () => has("super_admin", "fundraising", "admin", "program_officer", "program_coord", "program_lead"),
  intro: "Kept by Project Development, Research &amp; Innovations. Give each volunteer the project they work on and the person who supervises them day to day — without a supervisor their work shows up for nobody.",
  fields: [{ k: "name", l: "Name", req: true, w: "half" }, { k: "projectId", l: "Project", t: "projects", w: "half" }, { k: "officeId", l: "Office", t: "offices", w: "half" }, { k: "since", l: "Since", t: "date", w: "half" },
    { k: "supervisorId", l: "Supervised day to day by", t: "users", w: "half" }, { k: "userId", l: "Their app account (if they have signed in)", t: "users", w: "half" },
    { k: "role", l: "What they do", ph: "Teaching support, community media, field help", w: "half" }, { k: "days", l: "Days or hours a week", w: "half" },
    { k: "till", l: "Until (if time-bound)", t: "date", w: "half" }, { k: "allowanceHead", l: "Allowance head (if any)", w: "half" },
    { k: "phone", l: "Phone", w: "half" }, { k: "status", l: "Status", t: "select", o: ["Active", "Inactive"], w: "half" }, { k: "notes", l: "Notes" }],
  cols: [{ k: "name", l: "Name" }, { k: "role", l: "What they do" }, { k: "projectId", l: "Project", f: (v) => v ? esc(projectName(v)) : `<span class="tag warn">no project</span>` },
    { k: "officeId", l: "Office", t: "offices" }, { k: "since", l: "Since", t: "date" },
    { k: "supervisorId", l: "Supervisor", f: (v) => v ? esc(userName(v)) : `<span class="tag warn">nobody</span>` },
    { k: "days", l: "Days a week" }, { k: "status", l: "Status", f: statusTag }],
  after: async (id, d) => { if (d.userId) await db.collection("users").doc(d.userId).update({ managerIds: d.supervisorId ? [d.supervisorId] : [], projectsText: projectName(d.projectId) || "" }).catch(() => {}); },
  stats: rows => [["Volunteers", rows.filter(r => r.status !== "Inactive").length],
    ["Without a project", rows.filter(r => !r.projectId && r.status !== "Inactive").length],
    ["Without a supervisor", rows.filter(r => !r.supervisorId && r.status !== "Inactive").length]] });

routes.advance = registerScreen({ route: "advance", col: "advances", title: "Advance / requisition", orderBy: "createdAt", nameKey: "purpose", canEdit: () => isActive(),
  flow: "→ your manager verifies → the Director ACF approves → advance issued → settle within 30 days of the period or it is deducted (FP §5B); no new advance while one is open",
  fields: [
    { k: "neededBy", l: "Date needed by", t: "date", w: "half" }, { k: "projectId", l: "Project", t: "projects", w: "half" }, { k: "purpose", l: "Program / purpose", t: "select", o: ["TA / DA", "Home visit", "Poster / banner", "Meeting / event", "Training", "Sakhi support", "Office supplies", "Other", "Advance against my salary"],
      note: "Choose \u201cAdvance against my salary\u201d only if the money is being lent to you — it is taken back from your pay, not settled with bills." },
    { k: "items", l: "What do you need? One line each — say if it is money for you to hold, or a thing for someone to arrange",
      t: "textarea", req: true,
      ph: "money · ₹10,000 · food and lodging for 5 people, 16–17 Oct\narrange · 5-seater cab for 2 days, 16–17 Oct" },
    { k: "amount", l: "Of that, how much money do you need in hand? ₹", t: "number", req: true,
      note: "Only the money you will hold and settle with bills. What someone else books or buys is not part of this." },
    { k: "issuedOn", l: "Date money was paid out", t: "date", w: "half", show: () => isAccounts() || has("super_admin","founder") },
    { k: "mode", l: "How it was paid", t: "select", o: ["NEFT / RTGS / IMPS","UPI","Cash","Cheque","Petty cash"], w: "half", show: () => isAccounts() || has("super_admin","founder") }],
  before: async d => { d.status = "submitted"; d.uid = state.user.uid; d.managerIds = mgrs(state.me);
    /* An advance against salary is lent, not spent: no project, no bills, and it is
       taken back from pay rather than settled. */
    d.againstSalary = /against my salary/i.test(d.purpose || "");
    if (d.againstSalary) { d.recoverOver = Number(d.recoverOver) || 1; d.projectId = ""; d.items = "Advance against salary"; }
    /* Split the lines so the two halves can be followed separately. */
    const lines = String(d.items || "").split("\n").map(s => s.trim()).filter(Boolean);
    d.moneyLines = lines.filter(l => /^money\b|^cash\b/i.test(l));
    d.arrangeLines = lines.filter(l => /^arrange\b|^book\b|^buy\b|^hire\b/i.test(l));
    d.unsorted = lines.filter(l => !d.moneyLines.includes(l) && !d.arrangeLines.includes(l));
    if (d.arrangeLines.length) d.needsArranging = true; const open = await db.collection("advances").where("uid", "==", state.user.uid).where("status", "in", ["issued", "approved"]).get(); if (!open.empty) throw new Error("An earlier advance is still unsettled (FP §4)."); },
  cols: [{ k: "uid", l: "Who", t: "users" }, { k: "neededBy", l: "Needed by", t: "date" }, { k: "purpose", l: "Purpose" },
    { k: "projectId", l: "Project", t: "projects" }, { k: "amount", l: "Advance ₹", t: "money" },
    { k: "spent", l: "Spent ₹", t: "money" },
    { k: "returned", l: "Returned ₹", f: (v, r) => v === undefined || v === null ? "" : (v < 0 ? `<span class="tag bad">owed ₹${Math.abs(v).toLocaleString("en-IN")}</span>` : Number(v).toLocaleString("en-IN")) },
    { k: "issuedOn", l: "Paid on", f: (v, r) => v ? `${fmtD(v)}<div class="s">${esc(paidByLine(r))}</div>` : "" },
    { k: "status", l: "Status", f: (v, r) => v === "issued" && r.neededBy && (Date.now() - new Date(r.neededBy)) / 86400000 > 30
        ? `<span class="tag bad">unsettled ${Math.round((Date.now() - new Date(r.neededBy)) / 86400000)} days</span>` : statusTag(v) },
    { k: "settledOn", l: "Settled", t: "date" }],
  cols2: null,
  actions: [
    { k: "form", l: "Form F-01", run: async r => downloadFilledForm("F-01", "advances", r.id, r) },
    { k: "sform", l: "Settlement F-08", show: r => /settled/.test(r.status || ""), run: async r => downloadFilledForm("F-08", "advances", r.id, r) },
    { k: "issue", l: "Mark as issued", show: r => (isAccounts() || has("super_admin","founder")) && r.status === "Approved by Director ACF",
      run: async (r, ref) => {
        const dateStr = prompt("Date paid out (YYYY-MM-DD):", today()) || today();
        const mode = prompt("How was it paid?\n1 Cash\n2 UPI\n3 NEFT/RTGS\n4 Cheque\n\nType the method:", "Cash") || "Cash";
        await ref.update({ status: "issued", issuedOn: dateStr, issuedBy: state.user.uid, issuedByName: state.me.name, mode: mode,
          history: firebase.firestore.FieldValue.arrayUnion({ by: state.me.name, status: "issued", at: today(), note: "Advance issued by accountant — " + mode }) });
        toast("Advance marked as issued ✓"); } },
    { k: "sbills", l: "Bills", show: r => (r.uid === state.user.uid || isAccounts()) && /issued|settled/.test(r.status || ""),
      run: async (r, ref) => { const files = await askBills({ ...r, items: (r.settleItems || []).map(x => x.d).join("\n") || r.items });
        if (!files) return; await ref.update({ files, bills: files.length ? "Yes" : "No" }); toast(files.length + " bill(s) attached"); } },
    { k: "retref", l: "Return / reimburse reference", show: r => /settled/.test(r.status || "") && isAccounts() && Number(r.returned) !== 0,
      run: async (r, ref) => { const p = await askPaymentRef({ ...r, amount: Math.abs(Number(r.returned) || 0),
          particulars: (Number(r.returned) > 0 ? "Balance returned by " : "Reimbursed to ") + userName(r.uid) });
        if (!p) return; await ref.update({ returnRef: p, returnedOn: p.valueDate || today() });
        audit("advance_return", "advances", r.id, paidByLine(p)); successFlash("Saved"); } },
    { k: "verify1", l: "Verify", show: r => /^submitted|^applied/i.test(r.status || "")
        && (mgrs({ id: r.uid, managerIds: r.managerIds }).includes(state.user.uid) || (r.managerIds || []).includes(state.user.uid)),
      run: async (r, ref) => { const note = prompt("Anything to add? (optional)") || "";
        await ref.update({ status: "verified by manager", verifiedBy: state.user.uid, verifiedOn: today(), verifyNote: note });
        audit("verify", "advances", r.id, userName(r.uid)); toast(
          (Number(r.amount) || 0) > 50000 ? "Verified — it goes to the Founder & General Secretary to approve"
            : "Verified — it goes to the Director ACF to approve"); } },
    { k: "appr2", l: "Approve", show: r => /verified/i.test(r.status || "")
        && ((Number(r.amount) || 0) > 50000 ? has("super_admin") : has("director_acf", "super_admin")),
      run: async (r, ref) => approveAndRoute("advances", r, ref, `Advance to ${userName(r.uid)} — ${r.purpose || ""}`) },
    { k: "acted", l: "What I did", show: r => /approved|with .* to pay|to arrange/i.test(r.status || "")
        && (r.payerId === state.user.uid || r.ownerId === state.user.uid || isAccounts() || isProcurement && isProcurement()),
      run: async (r) => recordActionTaken("advances", r) },
    { k: "fixPay", l: "Correct payment details",
      show: r => /issued|part|settled/i.test(r.status || "") && (isAccounts() || has("super_admin","founder")),
      run: async (r, ref) => {
        const p = await askPaymentRef({ ...r, particulars: `Advance to ${userName(r.uid)} — ${r.purpose||""}`, valueDate: r.issuedOn || today() });
        if (!p) return;
        await ref.update({ ...p, issuedOn: p.valueDate || today(),
          payCorrectedBy: state.user.uid, payCorrectedOn: today(),
          payCorrectionNote: `Payment details corrected on ${today()} by ${state.me.name}` });
        audit("advance_pay_fixed", "advances", r.id, paidByLine(p));
        toast("Payment details updated"); } },
    { k: "issue", l: "Pay it", show: r => /approved/i.test(r.status || "") && (isAccounts() || r.payerId === state.user.uid),
      run: async (r, ref) => {
        const p = await askPaymentRef({ ...r, particulars: `Advance to ${userName(r.uid)} — ${r.purpose || ""}` });
        if (!p) return;
        await ref.update({ ...p, status: "issued", issuedOn: p.valueDate || today(), issuedBy: state.user.uid });
        audit("issue_advance", "advances", r.id, `${userName(r.uid)} · ${paidByLine(p)}`);
        successFlash("Marked as paid"); } },
    { k: "vch", l: "Voucher F-04", show: r => /issued|settled/.test(r.status || ""),
      run: async r => printVoucher({ ...r, particulars: `Advance — ${r.purpose || ""}`, payee: userName(r.uid),
        voucher: r.voucher || "", date: r.issuedOn || r.neededBy, head: r.head || "Advance",
        preparedBy: r.issuedBy, approvedBy: r.approvedBy || r.facApprovedBy }) },
    { k: "report", l: "Report on the visit",
      show: r => r.uid === state.user.uid && !r.visitReport && String(r.date || "") <= today(),
      run: async (r, ref) => { const what = prompt("What came of this visit?\n\nWho you met, what was decided, what is still to do.");
        if (!what || !what.trim()) return;
        const met = prompt("Who you met, and how many? (optional)") || "";
        await ref.update({ visitReport: what.trim(), metWhom: met, reportedOn: today() });
        audit("visit_report", "journeys", r.id, what.slice(0, 60)); successFlash("Saved"); } },
    { k: "recover", l: "Record a recovery", show: r => r.againstSalary && /issued|part/i.test(r.status || "") && isAccounts(),
      run: async (r, ref) => {
        const taken = Number(r.recovered) || 0, left = (Number(r.amount) || 0) - taken;
        const amt = Number(prompt(`Recovered from this month's salary.\n\nAdvance ₹${Number(r.amount).toLocaleString("en-IN")}, already taken back ₹${taken.toLocaleString("en-IN")}, ₹${left.toLocaleString("en-IN")} left.\n\nHow much this month?`, Math.min(left, Math.ceil((Number(r.amount) || 0) / (Number(r.recoverOver) || 1)))));
        if (!amt || amt <= 0) return;
        const now = taken + amt, done = now >= (Number(r.amount) || 0);
        await ref.update({ recovered: now, status: done ? "settled — recovered from salary" : "part recovered",
          recoveries: [...(r.recoveries || []), { amount: amt, on: today(), by: state.user.uid }],
          settledOn: done ? today() : null });
        audit("recover", "advances", r.id, `₹${amt} from salary`);
        toast(done ? "Fully recovered" : `₹${(Number(r.amount) - now).toLocaleString("en-IN")} still to recover`); } },
    { k: "dlF08", l: "↓ F-08", show: r => r.status === "settled",
      run: async (r) => { await downloadFilledForm("F-08","advances",r.id,{...r,byName:userName(r.uid),projectName:projectName(r.projectId),officeName:officeName(r.officeId)}); } },
    { k: "settle", l: "Settle", show: r => !r.againstSalary && r.status === "issued" && (r.uid === state.user.uid || isAccounts()),
      run: async (r, ref) => { const s = await askSettlement(r); if (!s) return;
        const spent = Number(s.spent) || 0, ret = Number(s.returned) || 0, adv = Number(r.amount) || 0;
        await ref.update({ status: ret < 0 ? "settled — to reimburse" : "settled",
          spent, returned: ret, excess: Math.max(0, spent - adv), settledOn: s.date || today(),
          settleItems: s.items || [], settleNote: s.note || "", bills: s.bills, settledBy: state.user.uid });
        audit("settle", "advances", r.id, `spent ₹${spent}, ${ret >= 0 ? "returned ₹" + ret : "to reimburse ₹" + Math.abs(ret)}`);
        toast(ret >= 0 ? `Settled — ₹${ret.toLocaleString("en-IN")} returned · upload your bills, then wait for the accountant to confirm` : `Settled — ₹${Math.abs(ret).toLocaleString("en-IN")} to be reimbursed · upload bills, then wait for accountant`); } },
    { k: "confirmSettle", l: "✓ Confirm settlement", show: r => /^settled/.test(r.status||"") && !r.againstSalary && isAccounts() && !r.settleConfirmedBy,
      run: async (r, ref) => {
        const spent = Number(r.spent||0), ret = Number(r.returned||0);
        if (!confirm(`Confirm settlement by ${userName(r.uid)}?\n\nSpent: ₹${spent.toLocaleString("en-IN")}\n${ret >= 0 ? "Returned: ₹" + ret.toLocaleString("en-IN") : "To reimburse: ₹" + Math.abs(ret).toLocaleString("en-IN")}\nBills: ${r.bills||"—"}`)) return;
        await ref.update({ settleConfirmedBy: state.user.uid, settleConfirmedOn: today(), status: "settled — confirmed" });
        try { await downloadFilledForm("F-08","advances",r.id,{ ...r,
          byName: userName(r.uid), projectName: projectName(r.projectId), officeName: officeName(r.officeId||state.me.officeId),
          settledByName: userName(r.settledBy||r.uid), settleConfirmedByName: userName(state.user.uid), settleConfirmedOn: today()
        }); } catch(e) { console.warn("F-08 failed", e); }
        audit("confirm_settle","advances",r.id,`${userName(r.uid)} · ₹${spent}`);
        successFlash("Settlement confirmed\nF-08 generated"); } },
    { k: "deduct", l: "Deduct from salary", show: r => r.status === "issued" && isAccounts() && r.neededBy && (Date.now() - new Date(r.neededBy)) / 86400000 > 30,
      run: async (r, ref) => { if (!confirm(`Unsettled for more than 30 days. Deduct ₹${Number(r.amount).toLocaleString("en-IN")} from ${userName(r.uid)}'s salary (FP §5B)?`)) return;
        await ref.update({ status: "deducted", deductedOn: today(), deductedBy: state.user.uid });
        audit("deduct", "advances", r.id, userName(r.uid)); } },
    nextStatus("status", ["submitted", "verified by manager", "approved by Director ACF", "issued", "settled", "settled — confirmed", "deducted", "rejected"])],
  stats: rows => { const open = rows.filter(r => r.status === "issued");
    const overdue = open.filter(r => r.neededBy && (Date.now() - new Date(r.neededBy)) / 86400000 > 30);
    return [["Outstanding", open.length], ["₹ outstanding", open.reduce((a, r) => a + (Number(r.amount) || 0), 0).toLocaleString("en-IN")],
      ["Overdue past 30 days", overdue.length], ["Settled this year", rows.filter(r => /settled/.test(r.status || "")).length]]; } });

routes.incident = registerScreen({ route: "incident", col: "incidents", title: "Incident report", orderBy: "createdAt", nameKey: "nature", canEdit: () => isActive(),
  flow: "Case incidents alert the case worker's manager, the Program Officer and the General Secretary immediately; follow-up is tracked here and on the case (Policy Manual §5.7).",
  fields: [{ k: "reportedAt", l: "Date & time of report", t: "datetime-local", w: "half" }, { k: "incidentAt", l: "Date & time of incident", t: "datetime-local", w: "half" }, { k: "type", l: "Incident type", t: "select", o: ["Case incident (concerns a Sakhi)", "Office / staff incident", "Safety incident during travel", "Child protection concern"], w: "half" }, { k: "caseId", l: "Linked Sakhi ID (if any)", w: "half" },
    { k: "relation", l: "Relation to victim", w: "half" }, { k: "location", l: "Location", w: "half" }, { k: "nature", l: "Nature of incident", t: "select", o: ["Threat / intimidation", "Physical violence", "Attempted re-trafficking", "Missing person", "Property / theft", "Accident", "Other"] },
    { k: "details", l: "Incident details", t: "textarea", req: true }, { k: "motive", l: "Possible motive", t: "textarea" }, { k: "police", l: "Police report filed?", t: "select", o: ["No", "Yes", "Planned"], w: "half" }, { k: "arrests", l: "Any arrests?", t: "select", o: ["No", "Yes"], w: "half" }, { k: "comments", l: "Further comments", t: "textarea" }, { k: "file", l: "Photo / document", t: "file" }],
  before: async d => {
    d.status = "open"; d.uid = state.user.uid;
    /* Who this goes to, worked out now and written on the record, so it reaches them
       even if roles change afterwards. */
    const leads = (state.users || []).filter(u => u.active
      && (/^dso$|^cpo$/.test((u.roles || []).join(" "))
        || /designated safeguarding officer|child protection officer/i.test(u.postTitle || "")));
    const gs = (state.users || []).filter(u => u.active && (u.roles || []).includes("super_admin"));
    d.goesTo = (leads.length ? leads : gs).map(u => u.id);
    d.goesToNames = (leads.length ? leads : gs).map(u => String(u.name || "").trim());
    d.reportedAt = new Date().toISOString();
    d.safeguardingNotified = false;
    if (!leads.length) d.note = "No safeguarding officer was appointed when this was reported — it went to the General Secretary.";
  },
  after: async (id, d) => {
    /* A copy in the shared drive, under Governance, so the record survives the app. */
    try {
      const lines = [`Safeguarding concern`, `Reported: ${fmtD(today())}`,
        `By: ${state.me.name}`, `Goes to: ${(d.goesToNames || []).join(", ") || "—"}`,
        ``, `Nature: ${d.nature || ""}`, `Where: ${d.place || ""}`, `When: ${d.when || d.date || ""}`,
        ``, `What happened:`, d.what || d.detail || "", ``,
        `Action taken at the time:`, d.action || "", ``,
        `This is the record as filed. Anything added later is in the app.`].join("\n");
      await uploadToDrive(new Blob([lines], { type: "text/plain" }), "governance",
        `Safeguarding — ${today()} — ${String(id).slice(0, 6)}.txt`);
    } catch (e) { successFlash("Saved\n(Drive copy failed — tell Admin)"); }
  },
  cols: [{ k: "reportedAt", l: "Reported" }, { k: "uid", l: "By", t: "users" }, { k: "type", l: "Type" }, { k: "nature", l: "Nature" }, { k: "location", l: "Location" }, { k: "caseId", l: "Case" }, { k: "police", l: "Police" }, { k: "status", l: "Status", f: statusTag }],
  actions: [nextStatus("status", ["open", "under follow-up", "escalated", "closed"])] });

routes.harassment = registerScreen({ route: "harassment", col: "grievances",
  before: async d => {
    d.status = "open"; d.uid = state.user.uid; d.reportedAt = new Date().toISOString();
    const chair = (state.users || []).filter(u => u.active
      && ((u.roles || []).includes("posh_chair") || /presiding officer/i.test(u.postTitle || "")));
    const gs = (state.users || []).filter(u => u.active && (u.roles || []).includes("super_admin"));
    d.goesTo = (chair.length ? chair : gs).map(u => u.id);
    d.goesToNames = (chair.length ? chair : gs).map(u => String(u.name || "").trim());
    d.safeguardingNotified = false;
    if (!chair.length) d.note = "No Presiding Officer was appointed when this was made — it went to the General Secretary.";
  }, title: "Harassment complaint", orderBy: "createdAt", nameKey: "respondent", canEdit: () => isActive(),
  intro: "Goes to the Internal Committee (POSH) only — not the respondent, not the complainant's manager. Resolution within 15 working days (HR §10). Can be anonymous.",
  fields: [{ k: "anonymous", l: "File anonymously", t: "check" }, { k: "supervisor", l: "Your supervisor", w: "half" }, { k: "respondent", l: "Respondent", req: true, w: "half" }, { k: "relationship", l: "Relationship to respondent", t: "select", o: ["Supervisor", "Colleague", "Subordinate", "Vendor / visitor", "Other"], w: "half" }, { k: "dates", l: "Date(s) of incident", w: "half" }, { k: "ongoing", l: "Is it ongoing?", t: "select", o: ["Yes", "No"], w: "half" }, { k: "details", l: "Details", t: "textarea", req: true }, { k: "file", l: "Files (optional)", t: "file" }],
  before: d => { d.status = "received"; d.uid = d.anonymous ? null : state.user.uid; d.due = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10); },
  cols: [{ k: "createdAt", l: "Filed", f: v => v ? new Date(v.seconds * 1000).toLocaleDateString("en-IN") : "" }, { k: "uid", l: "Complainant", f: (v, r) => r.anonymous ? "anonymous" : esc(userName(v)) }, { k: "respondent", l: "Respondent" }, { k: "relationship", l: "Relation" }, { k: "ongoing", l: "Ongoing" }, { k: "due", l: "Resolve by", t: "date" }, { k: "status", l: "Status", f: statusTag }],
  actions: [nextStatus("status", ["received", "under inquiry", "resolved", "closed"])] });

routes.appointment = registerScreen({ route: "appointment", col: "appointments", title: "Appointment", orderBy: "date", dir: "asc", nameKey: "reason", canEdit: () => isActive(),
  fields: [{ k: "withWhom", l: "Department / person", t: "select", o: ["Founder & General Secretary", "Program Officer", "Director ACF", "Coordinator – Fundraising, Research & Innovation"], w: "half" }, { k: "date", l: "Date", t: "date", w: "half" }, { k: "slot", l: "Time slot", t: "select", o: ["10:00–10:30", "11:00–11:30", "12:00–12:30", "15:00–15:30", "16:00–16:30"], w: "half" }, { k: "mode", l: "Mode", t: "select", o: ["In person (Delhi HQ)", "Video call", "Phone"], w: "half" }, { k: "reason", l: "Reason", t: "textarea", req: true }],
  before: d => { d.status = "requested"; d.uid = state.user.uid; },
  cols: [{ k: "date", l: "Date", t: "date" }, { k: "slot", l: "Slot" }, { k: "uid", l: "Who", t: "users" }, { k: "withWhom", l: "With" }, { k: "mode", l: "Paid by", f: (v, r) => esc(paidByLine(r)) }, { k: "reason", l: "Reason" }, { k: "status", l: "Status", f: statusTag }],
  actions: [nextStatus("status", ["requested", "confirmed", "rescheduled", "done", "cancelled"])] });

routes.assignments = registerScreen({ route: "assignments", col: "assignments", title: "Assignments", orderBy: "createdAt", nameKey: "title", canEdit: () => isActive(),
  canEditRow: r => has("super_admin","admin","director_acf") || r.assignerId === state.user.uid,
  assigneeScope: true,
  intro: "Set yourself a task, or give work to anyone in the organisation. A task you set yourself is yours to close — nobody else has to verify it.",
  flow: "assignee marks done with a note and evidence → assigner verifies → closed. Verified assignments linked to an activity count toward its target.",
  fields: [{ k: "title", l: "Title", req: true }, { k: "assigneeId", l: "For whom", t: "team", w: "half" }, { k: "projectId", l: "Project", t: "projects", w: "half" },
    { k: "activityId", l: "Which activity in the work plan does this deliver?", t: "activities", ph: "A1.2", w: "half" }, { k: "programmeId", l: "Programme", t: "programmes", w: "half" }, { k: "due", l: "Due", t: "date", w: "half" },
    { k: "priority", l: "Priority", t: "select", o: ["2 – Normal", "1 – High", "3 – Low"], w: "half" }, { k: "repeat", l: "Repeats", t: "select", o: ["Once", "Weekly", "Monthly", "Quarterly"], w: "half" },
    { k: "target", l: "Quantity target (how many?)", t: "number", w: "half", ph: "e.g. 20" },
    { k: "targetUnit", l: "Unit", t: "select", o: ["— none (qualitative task) —","Sakhis","Events","Camps","Cases","Benefits","Journeys","Updates","Visits","Documents","Other"], w: "half" },
    { k: "instructions", l: "Instructions", t: "textarea" }, { k: "evidence", l: "Evidence expected" },
    { k: "instructionDoc", l: "Instruction document (PDF, Word, image)", t: "file" }],
  before: (d, editing) => {
    if (editing && !has("super_admin","admin","director_acf") && editing.assignerId !== state.user.uid)
      throw new Error("Only the person who created this assignment can edit it.");
    d.assignerId = editing ? editing.assignerId : state.user.uid;
    d.assignerPostId = editing ? editing.assignerPostId : myPost();
    d.own = d.assigneeId === state.user.uid; d.status = editing ? (editing.status||"assigned") : "assigned";
    const target = state.users.find(u => u.id === d.assigneeId); d.assigneePostId = target ? (target.postId || null) : null;
    d.assigneePostTitle = target ? (target.postTitle || null) : null; },
  cols: [{ k: "title", l: "Task" }, { k: "assigneeId", l: "Assigned to", t: "users" }, { k: "assignerId", l: "By", f: (v, r) => r.own || v === r.assigneeId ? `<span class="tag">own task</span>` : esc(userName(v)) },
    { k: "updates", l: "Latest update", f: (v) => { if (!v?.length) return "—"; const u = v[v.length-1]; return `<div class="t" style="font-size:13px">${esc(String(u.text||"").slice(0,60))}</div><div class="s">${fmtD(u.at)} · ${esc(userName(u.by))}</div>`; } },
    { k: "instructionDoc", l: "Doc", f: (v) => v?.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="btn small quiet">📄 Open</a>` : "" },
    { k: "due", l: "Due", t: "date" }, { k: "status", l: "Status", f: statusTag }],
  actions: [
    { k: "pass", l: "Pass on", show: r => r.status === "assigned" && r.assigneeId === state.user.uid,
      run: async (r, ref) => {
        const line = lineUids();
        const team = state.users.filter(u => u.active && u.id !== state.user.uid && line.has(u.id));
        if (!team.length) return alert("Nobody reports to you, so there is no one to pass this to.");
        const pick = await askWhoDoes(r, team);
        if (!pick) return;
        const who = state.users.find(u => u.id === pick.id) || {};
        await ref.update({
          assigneeId: who.id, assigneePostId: who.postId || null, assigneePostTitle: who.postTitle || null,
          accountableId: r.accountableId || r.assigneeId,            // whoever was given it stays answerable
          verifyBy: r.assignerId,                                     // it still goes back to the person who set it
          due: pick.due || r.due,
          passedTo: who.id, passedAt: today(),
          chain: [...(r.chain || [{ to: r.assigneeId, by: r.assignerId, at: r.createdAt ? fmtD(today()) : today(), note: "" }]),
            { to: who.id, by: state.user.uid, at: today(), note: pick.note || "" }],
          instructions: (r.instructions || "") + (pick.note ? `\n\nPassed on by ${state.me.name}: ${pick.note}` : "")
        });
        audit("pass_on", "assignments", r.id, `${state.me.name} → ${who.name}`);
        toast("Passed to " + who.name + " — you still answer for it"); } },
    { k: "done", l: "It is done", show: r => r.status === "assigned" && r.assigneeId === state.user.uid,
      run: async (r, ref) => {
        const a = await askActionTaken({ id: r.id, item: r.title, purpose: r.title });
        if (!a) return;
        const own = r.assignerId === state.user.uid && !r.accountableId;
        await ref.update({ status: own ? "verified" : "done – to verify",
          doneNote: a.what, doneAt: a.on || today(), doneBy: state.user.uid,
          cost: a.cost || null, vendor: a.from || "", billRef: a.ref || "", bill: a.bill || null,
          ...(own ? { verifiedBy: state.user.uid } : {}) });
        /* If the task was given against an activity, finishing it is reported there too,
           so the plan moves without anybody filing the same work twice. */
        if (r.activityId) {
          try { await db.collection("eventReports").add({
            activityId: r.activityId, projectId: r.projectId || null,
            heading: r.title || "Task completed", report: a.what,
            date: a.on || today(), place: a.from || "", participants: 0,
            uid: state.user.uid, status: "submitted", fromTask: r.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp() }); } catch { }
        }
        audit("task_done", "assignments", r.id, a.what.slice(0, 60));
        toast(own ? "Recorded" : "Sent to " + (userName(r.assignerId) || "whoever gave it to you")); } },
    { k: "recall", l: "Recall", show: r => r.status !== "verified" && (r.accountableId||r.assignerId) === state.user.uid && r.assigneeId !== state.user.uid,
      run: async (r, ref) => {
        if (!confirm("Recall this task? It will come back to you.")) return;
        const original = r.accountableId || state.user.uid;
        await ref.update({
          assigneeId: original,
          assigneePostId: (state.users.find(u=>u.id===original)||{}).postId||null,
          assigneePostTitle: (state.users.find(u=>u.id===original)||{}).postTitle||null,
          accountableId: firebase.firestore.FieldValue.delete(),
          passedTo: firebase.firestore.FieldValue.delete(),
          passedAt: firebase.firestore.FieldValue.delete(),
          chain: [...(r.chain||[]), { to: original, by: state.user.uid, at: today(), note: "Recalled" }]
        });
        audit("recall", "assignments", r.id, state.me.name+" recalled from "+userName(r.assigneeId));
        toast("Task recalled"); } },
    { k: "verify", l: "Verify", show: r => r.status === "done – to verify" && (r.assignerId === state.user.uid || isAdmin()), run: async (r, ref) => ref.update({ status: "verified", verifiedBy: state.user.uid }) },
    { k: "ret", l: "Return", show: r => r.status === "done – to verify" && (r.assignerId === state.user.uid || isAdmin()), run: async (r, ref) => { const note = prompt("Why returned?") || ""; await ref.update({ status: "assigned", returnNote: note }); } }] });

/* ================= ACCOUNTS ================= */
routes.banks = registerScreen({ route: "banks", col: "banks", orgWide: true, title: "Bank accounts", orderBy: "bank", dir: "asc", nameKey: "bank", canEdit: () => has("super_admin", "director_acf"),
  intro: "FCRA receipts only into the designated FCRA account, spent through the FCRA utilisation account. Foreign money that is not FCRA (for example a UN agency paying for services) and domestic money follow their own accounts. New accounts need Executive Committee approval (FP §7). Full numbers visible to Accounts posts only.",
  fields: [{ k: "bank", l: "Bank", req: true, w: "half" }, { k: "branch", l: "Branch", w: "half" }, { k: "accNo", l: "Account number", w: "half" }, { k: "ifsc", l: "IFSC", w: "half" }, { k: "type", l: "Type", t: "select", o: ["FCRA · designated", "FCRA · utilisation", "Non-FCRA (foreign source)", "Domestic · designated", "Domestic · utilisation"], w: "half" }, { k: "usedFor", l: "Used for", w: "half" }, { k: "interestRate", l: "Annual interest rate (%)", t: "number", w: "half" }, { k: "interestType", l: "Account type for interest", t: "select", o: ["Savings account", "Current account (no interest)", "Fixed deposit", "Recurring deposit", "No interest"], w: "half" }, { k: "rateEffectiveFrom", l: "Rate effective from", t: "date", w: "half" }, { k: "ecRef", l: "Executive Committee reference (new accounts)" }],
  cols: [{ k: "bank", l: "Bank" }, { k: "branch", l: "Branch" }, { k: "accNo", l: "Account", f: v => v ? "•••• " + String(v).slice(-4) : "" }, { k: "ifsc", l: "IFSC" }, { k: "type", l: "Type", f: statusTag }, { k: "usedFor", l: "Used for" }] });

routes.heads = registerScreen({ route: "heads", col: "budgetHeads", orgWide: true, title: "Budget heads", orderBy: "code", dir: "asc", nameKey: "line", canEdit: () => has("super_admin", "director_acf", "accountant"),
  intro: "Entered by the Accountant. The project coordinator and the team can see their own project\u2019s heads and what is spent against them. One row per budget line per project, as in the Fund Tracker sheets. ORG-* heads are organisation-borne and excluded from the fund balance. 10% variation per head is flagged.",
  fields: [{ k: "projectId", l: "Project", t: "projects", w: "half" }, { k: "code", l: "Head code", req: true, ph: "1101-1", w: "half" }, { k: "line", l: "Budget line", req: true }, { k: "y1", l: "Year 1 ₹", t: "number", w: "half" }, { k: "y2", l: "Year 2 ₹", t: "number", w: "half" }, { k: "total", l: "Total budget ₹", t: "number", w: "half" }, { k: "orgBorne", l: "Organisation-borne (ORG head, not from fund)", t: "check" }],
  cols: [{ k: "projectId", l: "Project", t: "projects" }, { k: "code", l: "Head" }, { k: "line", l: "Budget line" }, { k: "y1", l: "Y1 ₹", t: "money" }, { k: "y2", l: "Y2 ₹", t: "money" }, { k: "total", l: "Total ₹", t: "money" }, { k: "orgBorne", l: "ORG", t: "check" }] });

routes.receipts = registerScreen({ route: "receipts", col: "incomeReceipts", title: "Receipts", orderBy: "date", nameKey: "description", canEdit: isAccounts,
  intro: "A receipt voucher for every donation, recorded within 3 days (FP §6). Each one prints as a numbered donation receipt carrying the 12A and 80G registration numbers. Fund type comes from the project.",
  fields: [{ k: "date", l: "Date", t: "date", d: today(), w: "half" }, { k: "projectId", l: "Project", t: "projects", w: "half" }, { k: "type", l: "Type", t: "select", o: ["Donor tranche", "Opening balance / carry-forward", "Interest", "Other income", "Individual donation", "CSR"], w: "half" }, { k: "description", l: "Tranche / description", req: true, w: "half" },
    { k: "foreign", l: "Foreign amount & currency", w: "half" }, { k: "rate", l: "Rate", t: "number", w: "half" }, { k: "amount", l: "Amount ₹", t: "number", req: true, w: "half" }, { k: "bank", l: "Bank credited", w: "half" }, { k: "ref", l: "FIRC / bank reference", w: "half" }, { k: "remitter", l: "Donor's name (as it should read on the receipt)", w: "half" },
    { k: "donorAddress", l: "Donor's address", w: "half" }, { k: "donorPan", l: "Donor's PAN (needed for 80G)", w: "half" },
    { k: "mode", l: "Received by", t: "select", o: ["Bank transfer / NEFT", "Cheque", "Demand draft", "UPI", "Foreign remittance", "Cash"], w: "half" },
    { k: "purpose", l: "Purpose, as it should read", ph: "General donation, or towards the Coaching Centre", w: "half" },
    { k: "proof", l: "Bank advice / FIRC scan", t: "file" }],
  before: async d => { d.fcra = (state.projects.find(p => p.id === d.projectId) || {}).fundType || "";
    if (!d.receiptNo) { const y = fyOfDate(d.date); const n = await nextCode("RCPT-" + y); d.receiptNo = `EP/${y}/${String(n.split("-").pop()).padStart(4, "0")}`; } },
  cols: [{ k: "receiptNo", l: "Receipt no.", f: v => `<span style="font-family:monospace">${esc(v || "")}</span>` }, { k: "date", l: "Date", t: "date" },
    { k: "remitter", l: "Donor" }, { k: "projectId", l: "Project", t: "projects" }, { k: "amount", l: "₹", t: "money" },
    { k: "fcra", l: "Fund type" }, { k: "mode", l: "Received by" }, { k: "ref", l: "Bank reference" }],
  actions: [{ k: "print", l: "Receipt", run: async r => printDonationReceipt(r) }, { k: "dlF05", l: "↓ F-05", run: async r => { await downloadFilledForm("F-05","incomeReceipts",r.id,{...r,from:r.remitter,projectName:projectName(r.projectId),officeName:officeName(r.officeId),receiptNo:r.receiptNo,receivedByName:userName(r.createdBy)}); } }],
  stats: rows => [["Receipts", rows.length], ["Total ₹", rows.reduce((a, r) => a + (r.amount || 0), 0).toLocaleString("en-IN")]] });

routes.ledger = registerScreen({ route: "ledger", col: "expenses", title: "Expenses (ledger)", orderBy: "date", nameKey: "particulars", canEdit: isAccounts,
  flow: "Vouchers ≥ ₹10,000 need two approvers; > ₹50,000 Executive Committee (FP §3, §9). A payee cannot approve their own voucher. Paid staff claims post here automatically.",
  fields: [{ k: "date", l: "Date", t: "date", d: today(), w: "half" }, { k: "projectId", l: "Project (blank = unallocated)", t: "projects", w: "half" }, { k: "head", l: "Head code", ph: "1102-1", w: "half" }, { k: "voucher", l: "Voucher no.", ph: "SAM/09/014", w: "half" },
    { k: "particulars", l: "Particulars", req: true, w: "half" }, { k: "payee", l: "Payee", w: "half" }, { k: "amount", l: "Amount ₹", t: "number", req: true, w: "half" }, { k: "mode", l: "Mode · from account", t: "select", o: ["NEFT · FCRA utilisation (UBI)", "NEFT · Domestic (Kotak)", "NEFT · Domestic (IDFC)", "Cheque", "UPI", "Petty cash"], w: "half" },
    { k: "bills", l: "Bills filed", t: "select", o: ["Yes", "No"], w: "half" }, { k: "category", l: "Unallocated category (if no project)", t: "select", o: ["", "Office rent", "Unfunded salaries", "Audit & legal", "Utilities", "Other"], w: "half" }, { k: "bill", l: "Bill / voucher scan", t: "file" }],
  before: d => {
    // the payment process: which flow it follows, and it starts at stage 1
    d.payFlow = d.payFlow || (/salary|pf|esi|tds/i.test(d.head || d.particulars || "") ? "salary"
      : /vendor|purchase|procure|equipment|furniture/i.test(d.particulars || "") ? "procurement"
      : d.projectId ? "programme" : "other");
    d.payStage = d.payStage || "requested";
    d.at_requested = today(); d.by_requested = state.user.uid;
    // Financial Procedures: the Accountant prepares vouchers; approval sits with the Director ACF.
    const preparerOnly = has("accountant") && !has("super_admin", "director_acf");
    d.status = preparerOnly ? "prepared — awaiting Director FAC"
      : d.amount >= 50000 ? "needs EC approval" : d.amount >= 10000 ? "needs 2nd approver" : "approved";
    d.preparedBy = state.user.uid; d.month = String(d.date || "").slice(0, 7);
    d.fcra = (state.projects.find(p => p.id === d.projectId) || {}).fundType || "Domestic"; },
  cols: [{ k: "date", l: "Date", t: "date" }, { k: "projectId", l: "Project", f: (v, r) => v ? esc(projectName(v)) : `<span class="tag warn">unallocated</span> ${esc(r.category || "")}` }, { k: "head", l: "Head" }, { k: "particulars", l: "Particulars" }, { k: "payee", l: "Payee" }, { k: "voucher", l: "Voucher" }, { k: "amount", l: "₹", t: "money" }, { k: "mode", l: "Paid by", f: (v, r) => esc(paidByLine(r)) }, { k: "bills", l: "Bills", f: (v, r) => (r.files || []).length ? `${(r.files || []).length} 📎` : (v === "Yes" ? "✓" : `<span class="tag warn">none</span>`) }, { k: "status", l: "Status", f: statusTag }],
  actions: [{ k: "vch", l: "↓ F-04 Voucher", run: async r => { await downloadFilledForm("F-04","expenses",r.id,{...r,byName:userName(r.uid),projectName:projectName(r.projectId),officeName:officeName(r.officeId),preparedByName:userName(r.preparedBy),voucherNo:r.voucher||r.id?.slice(0,8)}); } },
    { k: "bills", l: "Bills", show: r => isAccounts(),
      run: async (r, ref) => { const files = await askBills(r); if (!files) return;
        await ref.update({ files, bills: files.length ? "Yes" : "No" }); toast(files.length + " bill(s) attached"); } },
    { k: "paidref", l: "Payment reference", show: r => isAccounts(),
      run: async (r, ref) => { const p = await askPaymentRef(r); if (!p) return;
        await ref.update({ ...p, paidOn: p.valueDate || today() }); audit("payref", "expenses", r.id, paidByLine(p)); successFlash("Saved"); } },
    { k: "appr", l: "Approve", show: r => /prepared|needs/.test(r.status || "") && has("super_admin", "director_acf"),
    run: async (r, ref) => { if (r.preparedBy === state.user.uid && !has("super_admin")) return alert("A voucher cannot be approved by the person who prepared it (Financial Procedures §3).");
      if (r.payeeId === state.user.uid) return alert("Nobody may approve a payment to themselves (Financial Procedures §3).");
      const next = r.amount >= 50000 ? "needs EC approval" : "approved";
      await ref.update({ status: next, approvedBy: state.user.uid, approvedAt: today() }); audit("approve", "expenses", r.id, next); } },
    nextStatus("status", ["prepared — awaiting Director FAC", "approved", "needs 2nd approver", "needs EC approval", "paid", "returned", "rejected"])],
  stats: rows => [["Entries", rows.length], ["Spent ₹", rows.reduce((a, r) => a + (r.amount || 0), 0).toLocaleString("en-IN")], ["Unallocated ₹", rows.filter(r => !r.projectId).reduce((a, r) => a + (r.amount || 0), 0).toLocaleString("en-IN")]] });

routes.petty = async () => {
  if (!isAccounts() && !has("director_acf","super_admin")) return html(`<div class="card"><div class="empty">Staff advances belong to Accounts.</div></div>`);
  setTitle("Staff advances");
  const snap = await db.collection("advances").orderBy("createdAt","desc").get().catch(()=>({docs:[]}));
  const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
  const outstanding = rows.filter(r=>!["settled","cancelled"].includes(r.status||""));
  const totalOut = outstanding.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const statusColor = s=>({requested:"#C8922F",issued:"#1F4D8C",paid:"#2E6B4F","partially settled":"#C8922F",settled:"#1C7A3E",cancelled:"#999"})[s]||"#999";

  const voucherCard = r => {
    const canPay = (isAccounts()||has("super_admin","director_acf")) && ["issued","requested"].includes(r.status||"");
    const canSettle = (isAccounts()||has("super_admin","director_acf")) && r.status==="paid";
    const canCancel = (isAccounts()||has("super_admin")) && ["requested","issued"].includes(r.status||"");
    const bills = (r.settlementBills||[]).map(b=>`<a href="${esc(b.url)}" target="_blank" class="btn small quiet">📎 ${esc(b.name||"Bill")}</a>`).join("");
    return `<div class="card" style="border-left:4px solid ${statusColor(r.status||"")}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><div style="font-weight:700;font-size:15px">${esc(userName(r.uid))} · ${ftINR(r.amount)}</div>
          <div class="small muted">${esc(r.purpose||"")}${r.projectId?" · "+esc(projectName(r.projectId)):""}</div></div>
        <span class="tag" style="background:${statusColor(r.status||"")};color:#fff">${esc(r.status||"requested")}</span>
      </div>
      <div style="margin-top:10px;font-size:13px;display:flex;flex-direction:column;gap:4px">
        ${r.requestedOn||r.createdAt?`<div>📋 <b>Requested</b> ${fmtD(r.requestedOn||"")} by ${esc(userName(r.uid))}</div>`:""}
        ${r.issuedOn?`<div>💸 <b>Issued</b> ${fmtD(r.issuedOn)} via ${esc(r.how||"cash")}${r.ref?" · ref "+esc(r.ref):""}</div>`:""}
        ${r.issuedBy&&r.issuedBy!==r.uid?`<div class="muted small">   by ${esc(userName(r.issuedBy))}</div>`:""}
        ${r.paidOn?`<div>✅ <b>Marked paid</b> ${fmtD(r.paidOn)} via ${esc(r.payMode||"")}${r.payRef?" · "+esc(r.payRef):""}</div>`:""}
        ${r.settledOn?`<div>🧾 <b>Settled</b> ${fmtD(r.settledOn)} · spent ${ftINR(r.amountSpent||0)}${r.amountReturned?" · returned "+ftINR(r.amountReturned):""}</div>`:""}
        ${r.voucherNo?`<div>📄 Voucher: <b>${esc(r.voucherNo)}</b></div>`:""}
        ${bills?`<div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">${bills}</div>`:""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${canPay?`<button class="btn small" data-pay="${r.id}">Mark paid</button>`:""}
        ${canSettle?`<button class="btn small" data-settle="${r.id}">Settle</button>`:""}
        ${(isAccounts()||has("super_admin"))&&r.status!=="settled"?`<button class="btn small quiet" data-editadv="${r.id}">Edit</button>`:""}
        ${canCancel?`<button class="btn small danger" data-cancel="${r.id}">Cancel</button>`:""}
      </div>
      <div id="af_${r.id}"></div>
    </div>`;
  };

  const filter = state.advFilter||"all";
  const filtered = rows.filter(r=>filter==="all"||(r.status||"")===filter);

  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Total</span><b>${rows.length}</b></div>
    <div class="card stat"><span class="muted small">Outstanding</span><b>${outstanding.length}</b></div>
    <div class="card stat"><span class="muted small">Outstanding ₹</span><b>${ftINR(totalOut)}</b></div>
  </div>
  <div class="card"><h2>Issue new advance</h2><form id="newAdvForm">
    <div class="two">
      <label class="field"><span>Staff member</span><select name="uid" required><option value="">— select —</option>
        ${staffList().map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Amount ₹</span><input type="number" name="amount" required min="1" step="any" inputmode="decimal"></label>
    </div>
    <label class="field"><span>Purpose</span><input name="purpose" required placeholder="Travel, field expenses, programme materials…"></label>
    <div class="two">
      <label class="field"><span>Project</span><select name="projectId"><option value="">— none —</option>
        ${activeProjects().map(p=>`<option value="${p.id}">${esc(p.code||p.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Settle by</span><input type="date" name="settleby"></label>
    </div>
    <div class="two">
      <label class="field"><span>How paid</span><select name="how"><option>Cash</option><option>Bank transfer</option><option>UPI</option><option>Cheque</option></select></label>
      <label class="field"><span>Reference (UTR / UPI / Cheque no.)</span><input name="ref" placeholder="Optional"></label>
    </div>
    <label class="field"><span>Date paid out</span><input type="date" name="issuedOn" value="${today()}"></label>
    <label class="field"><span>Supporting document <span class="small muted">(required if paid before today or outside the app)</span></span>
      <input type="file" id="advSupportDoc"></label>
    <p class="small muted" id="advDocNote" style="display:none;color:var(--bad)">⚠ This is a backdated entry — a supporting document (email, requisition, approval letter) is required.</p>
    <button class="btn" type="submit">Issue advance</button>
  </form></div>
  <div class="card"><h2>All advances (${rows.length})</h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${["all","issued","paid","settled","cancelled"].map(s=>`<button class="btn small ${filter===s?"":"quiet"}" data-af="${s}">${s==="all"?"All":s.charAt(0).toUpperCase()+s.slice(1)}</button>`).join("")}
    </div>
    <div id="advList">${filtered.map(voucherCard).join("")||`<div class="empty">No advances.</div>`}</div>
  </div>`);

  // Show warning when date is in the past
  $("newAdvForm").querySelector("[name=issuedOn]").addEventListener("change", function() {
    const past = this.value && this.value < today();
    $("advDocNote").style.display = past ? "" : "none";
  });

  $("newAdvForm").onsubmit = async e => { e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.amount = Number(d.amount); d.issuedBy = state.user.uid; d.status = "issued"; d.requestedOn = today();
    const isBackdated = d.issuedOn && d.issuedOn < today();
    const isForOther = d.uid !== state.user.uid;
    const docFile = $("advSupportDoc")?.files?.[0];
    // Require supporting doc for backdated or out-of-app entries
    if ((isBackdated || isForOther) && !docFile) {
      toast("Please attach a supporting document (email, requisition, approval letter)."); return;
    }
    let supportingDoc = null;
    if (docFile) {
      try { supportingDoc = await uploadToDrive(docFile, "accounts", docFile.name); } catch {}
    }
    if (isBackdated || isForOther) {
      const ackDue = new Date(); ackDue.setDate(ackDue.getDate()+7);
      d.outOfApp = true;
      d.supportingDoc = supportingDoc;
      d.ackStatus = "pending";
      d.ackDue = ackDue.toISOString().slice(0,10);
      d.status = "paid";
    }
    await db.collection("advances").add({...d, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    audit("advance_issue","advances",null,`${userName(d.uid)} ₹${d.amount}${isBackdated?" (backdated)":""}`);
    toast("Advance issued"); routes.petty(); };

  $("content").querySelectorAll("[data-af]").forEach(b=>b.onclick=()=>{
    state.advFilter = b.dataset.af;
    const f2 = rows.filter(r=>b.dataset.af==="all"||(r.status||"")===b.dataset.af);
    $("advList").innerHTML = f2.map(voucherCard).join("")||`<div class="empty">No advances.</div>`;
    $("content").querySelectorAll("[data-af]").forEach(x=>x.classList.toggle("quiet",x.dataset.af!==b.dataset.af));
    attachActions(); });

  function attachActions() {
    $("content").querySelectorAll("[data-pay]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.pay;
      $("af_"+id).innerHTML=`<form class="af" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <h3 style="margin:0 0 8px">Mark paid</h3>
        <div class="two">
          <label class="field"><span>Date paid</span><input type="date" name="paidOn" value="${today()}" required></label>
          <label class="field"><span>Mode</span><select name="payMode"><option>Cash</option><option>Bank transfer</option><option>UPI</option><option>Cheque</option></select></label>
        </div>
        <label class="field"><span>Reference (UTR / UPI / Cheque no.)</span><input name="payRef"></label>
        <div style="display:flex;gap:8px"><button class="btn small" type="submit">Confirm paid</button>
          <button class="btn small quiet" type="button" onclick="this.closest('.af').remove()">Cancel</button></div>
      </form>`;
      $("af_"+id).querySelector("form").onsubmit = async e => { e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        await db.collection("advances").doc(id).update({...d,status:"paid",paidBy:state.user.uid});
        audit("advance_paid","advances",id,"marked paid"); toast("Marked paid"); routes.petty(); }; });

    $("content").querySelectorAll("[data-settle]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.settle;
      $("af_"+id).innerHTML=`<form class="af" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <h3 style="margin:0 0 8px">Settle advance</h3>
        <div class="two">
          <label class="field"><span>Amount spent ₹</span><input type="number" name="amountSpent" step="any" required></label>
          <label class="field"><span>Amount returned ₹</span><input type="number" name="amountReturned" step="any" placeholder="0"></label>
        </div>
        <div class="two">
          <label class="field"><span>Settlement date</span><input type="date" name="settledOn" value="${today()}" required></label>
          <label class="field"><span>Voucher number (can add later)</span><input name="voucherNo" placeholder="e.g. EP/2026-27/048"></label>
        </div>
        <label class="field"><span>Bills / receipts (attach multiple)</span><input type="file" id="settleBills_${id}" accept="image/*,.pdf" multiple></label>
        <div style="display:flex;gap:8px"><button class="btn small" type="submit">Mark settled</button>
          <button class="btn small quiet" type="button" onclick="this.closest('.af').remove()">Cancel</button></div>
      </form>`;
      $("af_"+id).querySelector("form").onsubmit = async e => { e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        d.amountSpent = Number(d.amountSpent)||0; d.amountReturned = Number(d.amountReturned)||0;
        const fileInput = document.getElementById("settleBills_"+id);
        const bills = [];
        if(fileInput?.files?.length) for(const f of fileInput.files) {
          const up = await uploadToDrive(f,"advance",f.name).catch(()=>null);
          if(up?.link) bills.push({name:f.name,url:up.link});
        }
        await db.collection("advances").doc(id).update({...d,status:"settled",settledBy:state.user.uid,settlementBills:bills,changedAt:firebase.firestore.FieldValue.serverTimestamp()});
        audit("advance_settle","advances",id,`₹${d.amountSpent} spent`); toast("Advance settled"); routes.petty(); }; });

    $("content").querySelectorAll("[data-editadv]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.editadv; const r=rows.find(x=>x.id===id)||{};
      $("af_"+id).innerHTML=`<form class="af" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <h3 style="margin:0 0 8px">Edit</h3>
        <div class="two">
          <label class="field"><span>Voucher number</span><input name="voucherNo" value="${esc(r.voucherNo||"")}"></label>
          <label class="field"><span>Settle by</span><input type="date" name="settleby" value="${r.settleby||""}"></label>
        </div>
        <label class="field"><span>Purpose</span><input name="purpose" value="${esc(r.purpose||"")}" required></label>
        <div style="display:flex;gap:8px"><button class="btn small" type="submit">Save</button>
          <button class="btn small quiet" type="button" onclick="this.closest('.af').remove()">Cancel</button></div>
      </form>`;
      $("af_"+id).querySelector("form").onsubmit = async e => { e.preventDefault();
        await db.collection("advances").doc(id).update(Object.fromEntries(new FormData(e.target)));
        toast("Saved"); routes.petty(); }; });

    $("content").querySelectorAll("[data-cancel]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Cancel this advance?")) return;
      await db.collection("advances").doc(b.dataset.cancel).update({status:"cancelled",cancelledBy:state.user.uid});
      audit("advance_cancel","advances",b.dataset.cancel,"cancelled"); toast("Cancelled"); routes.petty(); });
  }
  attachActions();
}

routes.salary = registerScreen({ route: "salary", col: "salaryStructures", orgWide: true, title: "Salary structures", orderBy: "createdAt", nameKey: "staffId", canEdit: isAccounts,
  intro: "Set once per person (Basic, Special Allowance, Conveyance), with statutory flags and charge-out. The monthly sheet computes Total, Payable Days, Earned, Advances and Net from attendance, leave and advances; salaries release on the 5th after monthly reports are verified (FP §5). Figures are visible to Accounts posts only.",
  fields: [{ k: "staffId", l: "Employee", t: "staff", w: "half" }, { k: "staffType", l: "Type of Staff", t: "select", o: ["Full Time Staff", "Part Time Staff", "Consultant", "Intern", "Volunteer", "Sakhi Leader"], w: "half" }, { k: "basic", l: "Basic Salary ₹", t: "number", w: "half" }, { k: "special", l: "Special Allowance ₹", t: "number", w: "half" }, { k: "conveyance", l: "Conveyance Allowance ₹", t: "number", w: "half" }, { k: "from", l: "Effective from", t: "date", w: "half" },
    { k: "pf", l: "PF applies", t: "check" }, { k: "esi", l: "ESI applies", t: "check" }, { k: "tds", l: "TDS applies", t: "check" }, { k: "chargeOut", l: "Charge-out (project · head · %)", ph: "SAMPURNA 1101-1 50%; Core 50%" }],
  before: d => { d.total = (d.basic || 0) + (d.special || 0) + (d.conveyance || 0); },
  cols: [{ k: "staffId", l: "Employee", t: "users" }, { k: "staffType", l: "Type" }, { k: "total", l: "Total ₹", t: "money" }, { k: "pf", l: "PF", t: "check" }, { k: "esi", l: "ESI", t: "check" }, { k: "tds", l: "TDS", t: "check" }, { k: "chargeOut", l: "Charge-out" }, { k: "from", l: "From", t: "date" }],
  extraButtons: `<button class="btn small quiet" onclick="salarySheet()">Salary sheet for this month</button>` });
async function salarySheet() {
  const m = today().slice(0, 7); const structs = (await db.collection("salaryStructures").get()).docs.map(d => d.data());
  const att = (await db.collection("attendance").where("date", ">=", m + "-01").where("date", "<=", m + "-31").get()).docs.map(d => d.data());
  const lv = (await db.collection("leaveRequests").where("status", "==", "approved").get()).docs.map(d => d.data());
  const adv = (await db.collection("advances").where("status", "==", "issued").get()).docs.map(d => d.data());
  const rows = structs.map((s, i) => { const days = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate(); const lwp = lv.filter(l => l.uid === s.staffId && l.type === "Leave without pay" && l.from.startsWith(m)).reduce((a, l) => a + (l.days || 0), 0);
    const payable = days - lwp; const earned = Math.round((s.total || 0) * payable / days); const advances = adv.filter(a => a.uid === s.staffId).reduce((a, x) => a + (x.amount || 0), 0);
    const pfE = s.pf ? Math.round(Math.min(s.basic || 0, 15000) * 0.12) : 0, pfR = pfE, esiE = s.esi ? Math.round(earned * 0.0075) : 0, esiR = s.esi ? Math.round(earned * 0.0325) : 0;
    return { "S.No": i + 1, "Name of Employee": userName(s.staffId), "Type of Staff": s.staffType, "Basic Salary": s.basic, "Special Allowance": s.special, "Conveyance Allowance": s.conveyance, Total: s.total, "Total Days": days, Leaves: lv.filter(l => l.uid === s.staffId && String(l.from || "").startsWith(m) && !/work from home/i.test(l.type || "")).reduce((a, l) => a + (l.days || 0), 0), LWP: lwp, "Payable Days": payable, Arrears: 0, "Earned Basic": earned, Advances: advances, "Payable Amt": earned - advances, "PF EMP": pfE, "PF EMPR": pfR, "ESI EMP": esiE, TDS: 0, "ESI EMPR": esiR, "NET PAYABLE": earned - advances - pfE - esiE, "Charge-out": s.chargeOut || "" }; });
  if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Salary " + m); XLSX.writeFile(wb, `salary-sheet-${m}.xlsx`); toast("Salary sheet downloaded (TDS to be entered by Accounts)");
}

routes.funds = async () => {
  setTitle("Fund position");
  const [rc, ex, hd] = await Promise.all([db.collection("incomeReceipts").get(), db.collection("expenses").get(), db.collection("budgetHeads").get()]);
  const R = rc.docs.map(d => d.data()), E = ex.docs.map(d => d.data()), H = hd.docs.map(d => d.data());
  const sum = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0); const inr = n => n.toLocaleString("en-IN");
  const rows = activeProjects().map(p => { const rec = sum(R.filter(r => r.projectId === p.id), "amount"), sp = sum(E.filter(e => e.projectId === p.id), "amount"), san = p.budget || sum(H.filter(h => h.projectId === p.id && !h.orgBorne), "total"); return { p, san, rec, sp, bal: rec - sp, pct: san ? Math.round(sp / san * 100) : 0 }; });
  const byF = {}; rows.forEach(r => { const k = r.p.fundType || "Domestic"; byF[k] = byF[k] || { rec: 0, sp: 0 }; byF[k].rec += r.rec; byF[k].sp += r.sp; });
  const unalloc = sum(E.filter(e => !e.projectId), "amount");
  const months = {}; R.forEach(r => { const m = String(r.date || "").slice(0, 7); months[m] = months[m] || { r: 0, s: 0 }; months[m].r += r.amount || 0; }); E.forEach(e => { const m = String(e.date || "").slice(0, 7); months[m] = months[m] || { r: 0, s: 0 }; months[m].s += e.amount || 0; });
  html(`<div class="grid"><div class="card stat"><span class="muted small">Sanctioned</span><b>₹${inr(sum(rows, "san"))}</b></div><div class="card stat"><span class="muted small">Received</span><b>₹${inr(sum(rows, "rec"))}</b></div><div class="card stat"><span class="muted small">Spent from funds</span><b>₹${inr(sum(rows, "sp"))}</b></div><div class="card stat"><span class="muted small">Balance</span><b>₹${inr(sum(rows, "bal"))}</b></div><div class="card stat"><span class="muted small">Unallocated</span><b>₹${inr(unalloc)}</b></div></div>
  <div class="card"><h2>By project · as on ${fmtD(today())}</h2><div class="tablewrap"><table class="table"><tr><th>Project</th><th>Donor</th><th>FCRA</th><th>Sanctioned</th><th>Received</th><th>Yet to receive</th><th>Spent</th><th>Balance</th><th>% used</th></tr>
    ${rows.map(r => `<tr><td>${esc(r.p.name)}</td><td>${esc(r.p.donor || "")}</td><td>${esc(r.p.fundType || "")}</td><td>${inr(r.san)}</td><td>${inr(r.rec)}</td><td>${inr(Math.max(0, r.san - r.rec))}</td><td>${inr(r.sp)}</td><td>${inr(r.bal)}</td><td>${r.pct >= 90 ? `<span class="tag warn">${r.pct}%</span>` : r.pct + "%"}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">No projects yet</td></tr>`}</table></div></div>
  <div class="grid"><div class="card"><h2>By fund type</h2><table class="table"><tr><th></th><th>Received</th><th>Spent</th><th>Balance</th></tr>${Object.entries(byF).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${inr(v.rec)}</td><td>${inr(v.sp)}</td><td>${inr(v.rec - v.sp)}</td></tr>`).join("")}</table></div>
    <div class="card"><h2>Month-wise</h2><table class="table"><tr><th>Month</th><th>Received</th><th>Spent</th></tr>${Object.keys(months).sort().map(m => `<tr><td>${m}</td><td>${inr(months[m].r)}</td><td>${inr(months[m].s)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">—</td></tr>`}</table></div></div>
  <div class="card"><button class="btn small quiet" id="ft">Export Fund Tracker workbook</button></div>`);
  $("ft").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({ Project: r.p.name, Donor: r.p.donor, FCRA: r.p.fundType, Sanctioned: r.san, Received: r.rec, "Yet to receive": Math.max(0, r.san - r.rec), Spent: r.sp, Balance: r.bal, "% used": r.pct }))), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.map(r => ({ Date: r.date, Project: projectName(r.projectId), Type: r.type, Description: r.description, Foreign: r.foreign, Rate: r.rate, INR: r.amount, Bank: r.bank, Ref: r.ref, Remitter: r.remitter }))), "Receipts");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(E.map(e => ({ Date: e.date, Project: projectName(e.projectId) || "Unallocated", Head: e.head, Particulars: e.particulars, Payee: e.payee, Voucher: e.voucher, Amount: e.amount, Mode: e.mode, Bills: e.bills, Month: e.month, FCRA: e.fcra }))), "Expenses");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(E.filter(e => !e.projectId).map(e => ({ Date: e.date, Particulars: e.particulars, Category: e.category, Payee: e.payee, Amount: e.amount, Status: e.status }))), "Unallocated");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(H.map(h => ({ Project: projectName(h.projectId), Head: h.code, Line: h.line, Y1: h.y1, Y2: h.y2, Total: h.total, ORG: h.orgBorne ? "Yes" : "" }))), "Budget heads");
    XLSX.writeFile(wb, `Empower_People_Fund_Tracker_${today()}.xlsx`); };
};

/* ================= COMPLIANCE ================= */
routes.registrations = registerScreen({ route: "registrations", col: "registrations", orgWide: true, title: "Registrations & renewals", orderBy: "name", dir: "asc", canEdit: () => has("super_admin", "director_acf", "admin", "compliance_head"),
  fields: [{ k: "name", l: "Registration", req: true, w: "half" }, { k: "number", l: "Number", w: "half" }, { k: "validTill", l: "Valid till (blank = perpetual)", t: "date", w: "half" }, { k: "renewal", l: "Renewal action", w: "half" }, { k: "certificate", l: "Certificate scan", t: "file" }, { k: "notes", l: "Notes" }],
  cols: [{ k: "name", l: "Registration" }, { k: "number", l: "Number" }, { k: "validTill", l: "Valid till", f: v => v ? (new Date(v) < new Date() ? `<span class="tag bad">${fmtD(v)} expired</span>` : (new Date(v) - Date.now()) / 86400000 < 180 ? `<span class="tag warn">${fmtD(v)}</span>` : fmtD(v)) : "Perpetual" }, { k: "renewal", l: "Renewal action" }, { k: "certificate", l: "Cert.", f: v => v ? "📎" : "" }] });

routes.statutory = registerScreen({ route: "statutory", col: "statutory", orgWide: true, title: "Statutory calendar", orderBy: "due", dir: "asc", nameKey: "filing", canEdit: () => isCompliance() || isAccounts(),
  fields: [{ k: "due", l: "Due", t: "date", req: true, w: "half" }, { k: "filing", l: "Filing", req: true, w: "half" }, { k: "authority", l: "Authority", w: "half" }, { k: "ownerId", l: "Owner", t: "users", w: "half" }, { k: "repeat", l: "Repeats", t: "select", o: ["Once", "Monthly", "Quarterly", "Annual"], w: "half" }, { k: "status", l: "Status", t: "select", o: ["Upcoming", "Due", "Filed"], w: "half" }, { k: "proof", l: "Acknowledgement", t: "file" }],
  cols: [{ k: "due", l: "Due", t: "date" }, { k: "filing", l: "Filing" }, { k: "authority", l: "Authority" }, { k: "ownerId", l: "Owner", t: "users" }, { k: "repeat", l: "Repeats" }, { k: "status", l: "Status", f: statusTag }],
  actions: [{ k: "filed", l: "Mark filed", show: r => r.status !== "Filed", run: async (r, ref) => ref.update({ status: "Filed", filedOn: today() }) }] });

routes.policies = registerScreen({ route: "policies", col: "policies", orgWide: true, title: "Documents & certificates", orderBy: "name", dir: "asc", canEdit: () => has("super_admin", "director_acf", "admin"),
  intro: "Every organisational document in one place — registration and tax certificates, FCRA papers, audited accounts, board resolutions, donor agreements, policies, insurance and leases. Administration, HR &amp; Communication holds and files them; Compliance watches the renewal dates.",
  fields: [{ k: "name", l: "Policy / document", req: true, w: "half" }, { k: "type", l: "Type", t: "select", o: ["Registration certificate", "Tax certificate (12A / 80G / PAN)", "FCRA document", "Audited accounts", "Annual return", "Board resolution", "Donor agreement", "MoU / partnership", "Policy", "Insurance", "Lease / rent agreement", "Licence or permission", "Other"], w: "half" }, { k: "adopted", l: "Adopted / dated", t: "date", w: "half" }, { k: "reviewDue", l: "Review due", t: "date", w: "half" }, { k: "version", l: "Version", w: "half" }, { k: "owner", l: "Owner (post)", w: "half" }, { k: "refNo", l: "Reference / certificate number", w: "half" }, { k: "validTill", l: "Valid till (if it expires)", t: "date", w: "half" }, { k: "file", l: "File", t: "file" }, { k: "link", l: "Or a Drive link", w: "half" }, { k: "notes", l: "Notes" }],
  cols: [{ k: "name", l: "Document" }, { k: "type", l: "Type" }, { k: "version", l: "Version" }, { k: "adopted", l: "Adopted", t: "date" }, { k: "reviewDue", l: "Review due", f: v => v ? (new Date(v) < new Date() ? `<span class="tag warn">${fmtD(v)}</span>` : fmtD(v)) : "" }, { k: "refNo", l: "Reference" }, { k: "validTill", l: "Valid till", f: v => v ? (new Date(v) < new Date() ? `<span class="tag bad">${fmtD(v)}</span>` : (new Date(v) - Date.now()) / 86400000 < 180 ? `<span class="tag warn">${fmtD(v)}</span>` : fmtD(v)) : "—" }, { k: "owner", l: "Owner" }, { k: "file", l: "File", f: (v, r) => v ? "📎" : r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">link</a>` : `<span class="tag warn">missing</span>` }],
  stats: rows => [["Documents", rows.length], ["Expiring in 6 months", rows.filter(r => r.validTill && (new Date(r.validTill) - Date.now()) / 86400000 < 180 && new Date(r.validTill) >= new Date()).length], ["Expired", rows.filter(r => r.validTill && new Date(r.validTill) < new Date()).length], ["No file attached", rows.filter(r => !r.file && !r.link).length]] });

routes.board = registerScreen({ route: "board", col: "meetings", orgWide: true, title: "Board & meetings", orderBy: "date", nameKey: "title", canEdit: isCompliance,
  intro: "Board of Trustees quarterly · Executive Committee monthly (quorum 50%, President casting vote) · AGM by 30 Sept (Policy Manual §3).",
  fields: [{ k: "body", l: "Body", t: "select", o: ["Governing Board / Trustees", "Executive Committee", "Annual General Meeting", "Finance Committee", "Advisory Board", "Internal Committee (POSH)"], w: "half" }, { k: "date", l: "Date", t: "date", w: "half" }, { k: "title", l: "Title / agenda", req: true }, { k: "attendees", l: "Attendees", t: "textarea" }, { k: "decisions", l: "Decisions / resolutions", t: "textarea" }, { k: "minutes", l: "Minutes (file)", t: "file" }],
  cols: [{ k: "date", l: "Date", t: "date" }, { k: "body", l: "Body" }, { k: "title", l: "Title" }, { k: "decisions", l: "Decisions" }, { k: "minutes", l: "Minutes", f: v => v ? "📎" : "" }] });

/* ================= BULK IMPORT (Excel / CSV → any register) ================= */
const IMPORT_SETS = {
  admin: { label: "1 · Admin department", can: () => has("super_admin", "admin", "procurement"),
    tables: { posts: "Posts (organigram)", users: "Staff records", leaveRequests: "Leave records", attendance: "Attendance", dayReports: "Day reports",
      expenseClaims: "Expense claims", assets: "Office assets", vendors: "Vendors", volunteers: "Volunteers", offices: "Offices",
      letters: "Appointment letters", handovers: "File handovers", journeys: "Travel log", requisitions: "Requisitions" } },
  program: { label: "2 · Program", can: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff"),
    tables: { persons: "Sakhis (Sakhi Profile)", benefits: "Beneficiary list", cases: "Cases", caseUpdates: "Case updates", groups: "Groups (Sakhi Mandal)", activities: "Activities / work plan", eventReports: "Event reports", assignments: "Assignments (monthly plan)" } },
  accounts: { label: "3 · Accounts", can: () => has("super_admin", "director_acf", "accountant", "admin"),
    tables: { projects: "Projects", budgetHeads: "Budget heads", incomeReceipts: "Receipts", expenses: "Expenses (ledger)", pettyCash: "Petty cash", salaryStructures: "Salary structures", banks: "Bank accounts", advances: "Advances" } },
  fundraising: { label: "4 · Fund raising", can: () => has("super_admin", "admin", "fundraising"),
    tables: { proposals: "Proposals sent", opportunities: "Funder calls / opportunity calendar", outreach: "Collaboration outreach", obligations: "Reporting obligations" } },
  compliance: { label: "5 · Compliance", can: () => has("super_admin", "compliance_head", "admin", "director_acf"),
    tables: { registrations: "Registrations & renewals", statutory: "Statutory calendar", policies: "Policies & documents", meetings: "Board & meetings" } }
};
const IMPORT_COLS = {
  persons: ["code", "registeredOn", "state", "district", "block", "firstName", "lastName", "slaveryType", "phone", "sex", "marital", "presentAddress", "nativeAddress", "children", "workStatus", "guardianFirst", "guardianLast", "sinceWhen", "hasId", "medical", "skills", "notes", "source", "status"],
  benefits: ["date", "name", "personCode", "age", "sex", "marital", "phone", "state", "district", "village", "address", "service", "description", "value", "projectId", "activityCode"],
  cases: ["personCode", "type", "openedAt", "status", "summary", "assignedTo", "projectId", "outcome", "closedAt"],
  caseUpdates: ["personCode", "date", "kind", "notes", "projectId"],
  groups: ["name", "type", "village", "state", "district", "leaderName", "formedOn", "memberCount", "savings", "meetingDay", "projectId"],
  activities: ["projectId", "code", "name", "objective", "head", "start", "end", "target", "unit", "q1", "q2", "q3", "q4", "leadId", "status", "milestones", "means"],
  eventReports: ["date", "activity", "heading", "place", "participants", "projectId", "report"],
  assignments: ["assigneeName", "title", "due", "target", "targetUnit", "instructions", "programmeId", "projectId"],
  posts: ["title", "department", "reportsTo", "functional", "responsibilities", "purpose", "authority", "taCategory", "limit", "chargeOut", "holderName"],
  users: ["name", "email", "phone", "designation", "postTitle", "department", "officeId", "joined", "bankAcc", "ifsc", "emergency"],
  leaveRequests: ["name", "employment", "department", "type", "from", "to", "days", "reason", "status", "approvedBy"],
  attendance: ["name", "date", "checkIn", "checkOut", "hours", "officeId", "remarks"],
  dayReports: ["name", "date", "location", "projectId", "text", "remarks", "status"],
  expenseClaims: ["name", "date", "amount", "category", "payment", "description", "projectId", "status"],
  requisitions: ["item", "category", "qty", "estimate", "neededBy", "purpose", "goesTo", "status"],
  assets: ["tag", "item", "category", "assetType", "fundSource", "qty", "cost", "condition", "notes"],
  vendors: ["name", "category", "contact", "phone", "email", "gstin", "pan", "status", "notes"],
  volunteers: ["name", "projectId", "officeId", "since", "phone", "allowanceHead", "status", "notes"],
  offices: ["name", "state", "district", "address"],
  letters: ["name", "type", "post", "department", "from", "till", "ref"],
  handovers: ["file", "type", "date", "reason", "notes"],
  journeys: ["date", "fromPlace", "toPlace", "purpose", "mode", "projectId"],
  projects: ["name", "code", "donor", "start", "end", "budget", "fundType", "restriction", "geography", "cycle", "objectives"],
  budgetHeads: ["projectId", "code", "line", "y1", "y2", "total", "orgBorne"],
  incomeReceipts: ["date", "projectId", "type", "description", "foreign", "rate", "amount", "bank", "ref", "remitter"],
  expenses: ["date", "projectId", "head", "voucher", "particulars", "payee", "amount", "mode", "bills", "category"],
  pettyCash: ["date", "officeId", "particulars", "projectId", "head", "inAmt", "outAmt"],
  salaryStructures: ["staffId", "staffType", "basic", "special", "conveyance", "pf", "esi", "tds", "chargeOut", "from"],
  banks: ["bank", "branch", "accNo", "ifsc", "type", "usedFor"],
  advances: ["neededBy", "projectId", "purpose", "items", "amount", "status"],
  proposals: ["sentOn", "name", "type", "org", "ask", "status", "expectedBy", "approvedAmount", "notes"],
  opportunities: ["month", "funder", "deadline", "route", "link", "contact", "notes"],
  outreach: ["org", "email", "sentOn", "theme", "reply"],
  obligations: ["due", "projectId", "what", "to", "owner", "repeat"],
  registrations: ["name", "number", "validTill", "renewal", "notes"],
  statutory: ["due", "filing", "authority", "repeat", "status"],
  policies: ["name", "type", "version", "adopted", "reviewDue", "owner"],
  meetings: ["date", "body", "title", "attendees", "decisions"]
};
routes.bulk = async (dept) => {
  const mine = Object.entries(IMPORT_SETS).filter(([, s]) => s.can());
  if (!mine.length) return html(`<div class="card"><div class="empty">Bulk import is available to department heads and the App Super Admin.</div></div>`);
  dept = dept || state.bulkDept || mine[0][0]; if (!IMPORT_SETS[dept] || !IMPORT_SETS[dept].can()) dept = mine[0][0];
  state.bulkDept = dept;
  const set = IMPORT_SETS[dept];
  setTitle("Bulk import · " + set.label);
  html(`<div class="card"><h2>Bulk import</h2><p class="small muted">Upload a spreadsheet and map its columns to the app's fields. Nothing is saved until you press Import. Every import is stamped with the file name and written to the audit log.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${mine.map(([k, s]) => `<button class="btn small ${k === dept ? "" : "quiet"}" data-dept="${k}">${esc(s.label)}</button>`).join("")}</div></div>
    <div class="card"><div class="two">
      <label class="field"><span>What are you importing?</span><select id="tgt">${Object.entries(set.tables).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
      <label class="field"><span>Excel or CSV file</span><input type="file" id="file" accept=".xlsx,.xls,.csv"></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small quiet" id="tpl">Download a blank template</button>
        <button class="btn small quiet" id="recent">Recent imports</button></div>
      <div id="map"></div><div class="err" id="bErr"></div></div>
    <div id="recentBox"></div>`);
  $("content").querySelectorAll("[data-dept]").forEach(b => b.onclick = () => routes.bulk(b.dataset.dept));
  const colsFor = t => IMPORT_COLS[t] || ["name", "notes"];
  $("tpl").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const t = $("tgt").value; const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([colsFor(t)]), t.slice(0, 28));
    XLSX.writeFile(wb, `template-${t}.xlsx`); };
  $("recent").onclick = async () => { const s = await db.collection("audit").where("action", "==", "import").orderBy("at", "desc").limit(20).get().catch(() => ({ docs: [] }));
    $("recentBox").innerHTML = `<div class="card"><h2>Recent imports</h2><div class="list">${s.docs.map(d => { const a = d.data();
      return `<div class="item"><div class="grow"><div class="t">${esc(a.target || "")} · ${esc(a.detail || "")}</div><div class="s">${esc(userName(a.by))} · ${a.at ? new Date(a.at.seconds * 1000).toLocaleString("en-IN") : ""}</div></div></div>`; }).join("") || `<div class="empty">None yet</div>`}</div></div>`; };
  $("file").onchange = async () => { const f = $("file").files[0]; if (!f) return; $("bErr").textContent = "";
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    let wb;
    try {
      wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    } catch(e) {
      return $("bErr").textContent = "Could not read the file. If it is from Google Drive or WhatsApp, save it to your device first then upload from Downloads. " + e.message;
    }
    $("bErr").textContent = "";
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }).map(tidyDates);
    if (!data.length) return $("bErr").textContent = "That sheet has no rows.";
    const tgt = $("tgt").value, want = colsFor(tgt), cols = Object.keys(data[0]);
    const guess = c => { const n = c.toLowerCase().replace(/[^a-z0-9]/g, "");
      return want.find(w => w.toLowerCase() === n) || want.find(w => n.includes(w.toLowerCase()) || w.toLowerCase().includes(n)) || ""; };
    $("map").innerHTML = `<h3 class="small" style="font-weight:700;margin:12px 0 6px">${data.length} rows found in “${esc(f.name)}” · map the columns</h3>
      <div class="tablewrap"><table class="table"><tr><th>Column in your file</th><th>Goes to</th><th>First row</th></tr>
      ${cols.map(c => `<tr><td>${esc(c)}</td>
        <td><select data-col="${esc(c)}"><option value="">— skip —</option>${want.map(w => `<option value="${w}" ${guess(c) === w ? "selected" : ""}>${w}</option>`).join("")}<option value="__custom">(keep as “${esc(c)}”)</option></select></td>
        <td class="small muted">${esc(String(data[0][c]).slice(0, 40))}</td></tr>`).join("")}</table></div>
      <div class="small muted" style="margin-top:8px">⚠ Duplicate rows are blocked automatically and will not be imported.</div>
      <button class="btn" id="go" style="margin-top:8px">Import ${data.length} rows</button>`;
    $("go").onclick = async () => { $("go").disabled = true; $("go").textContent = "Importing…";
      const m = {}; $("map").querySelectorAll("[data-col]").forEach(i => { if (i.value === "__custom") m[i.dataset.col] = i.dataset.col.replace(/[^a-zA-Z0-9]+/g, "_"); else if (i.value) m[i.dataset.col] = i.value; });
      toast("Checking for duplicates…");
      let existing = new Set();
      { const cur = await db.collection(tgt).limit(3000).get().catch(() => ({ docs: [] }));
        cur.docs.forEach(d => { const x = d.data();
          if (tgt === "persons") existing.add((squash(x.name||"")+"|"+squash(x.guardian||x.guardianFirst||"")+"|"+squash(x.district||"")));
          else existing.add(((x.code||x.name||x.title||"")+"|"+( x.date||x.sentOn||x.registeredOn||"" )).toLowerCase());
        }); }
      let n = 0, skipped = 0; const blockedRows = [];
      for (let i = 0; i < data.length; i += 400) { const batch = db.batch();
        data.slice(i, i + 400).forEach(row => { const doc = {};
          Object.entries(m).forEach(([c, k]) => { let v = row[c]; if (v instanceof Date) v = v.toISOString().slice(0, 10); doc[k] = v === "" ? null : v; });
          const key = tgt==="persons" ? (squash(doc.name||"")+"|"+squash(doc.guardian||doc.guardianFirst||"")+"|"+squash(doc.district||"")) : ((doc.code||doc.name||doc.title||"")+"|"+(doc.date||doc.sentOn||doc.registeredOn||"")).toLowerCase();
          if (key.trim() !== "||" && key.trim() !== "|" && existing.has(key)) { skipped++; blockedRows.push({row: i+1, name: doc.name||doc.code||"", reason: "matches an existing record"}); return; }
          if (doc.firstName || doc.lastName) doc.name = [doc.firstName, doc.lastName].filter(Boolean).join(" ");
          if (tgt === "persons") { doc.consent = true; doc.status = doc.status || "open"; doc.registeredBy = state.user.uid; doc.tokens = tokens(doc); }
          if (tgt === "benefits") doc.recordedBy = state.user.uid;
          if (!doc.officeId && state.me.officeId) doc.officeId = state.me.officeId;
          // a misspelt district splits every count and every Sakhi ID — put it right on the way in
          if (doc.district) { const f = fixPlace(doc.state, doc.district);
            if (f.corrected) { doc.districtAsGiven = doc.district; doc.district = f.district; doc.state = f.state; } }
          // assignments: match assigneeName to a user, set assigner as importer
          if (tgt === "assignments" && doc.assigneeName) {
            const who = state.users.find(u => String(u.name||"").trim().toLowerCase() === String(doc.assigneeName).trim().toLowerCase());
            if (who) { doc.assigneeId = who.id; doc.assignerId = state.user.uid; doc.status = doc.status || "assigned"; doc.own = who.id === state.user.uid; }
            else { doc.unmatchedName = doc.assigneeName; }
            delete doc.assigneeName;
          }
          // leave, attendance, day reports and claims are filed against a person: match the name to their account
          if (["leaveRequests", "attendance", "dayReports", "expenseClaims"].includes(tgt) && doc.name) {
            const who = state.users.find(u => String(u.name || "").trim().toLowerCase() === String(doc.name).trim().toLowerCase());
            if (who) { doc.uid = who.id; doc.managerIds = mgrs(who); doc.officeId = doc.officeId || who.officeId || null; }
            else { doc.unmatchedName = doc.name; }
          }
          if (tgt === "leaveRequests") { doc.status = doc.status || "approved";
            if (!doc.days && doc.from && doc.to) doc.days = Math.max(1, Math.round((new Date(doc.to) - new Date(doc.from)) / 86400000) + 1); }
          if (tgt === "attendance" && doc.date && doc.uid) doc._id = `${doc.uid}_${String(doc.date).slice(0, 10)}`;
          doc.importedFrom = f.name; doc.importedAt = firebase.firestore.FieldValue.serverTimestamp(); doc.createdBy = state.user.uid;
          const ref = doc._id ? db.collection(tgt).doc(doc._id) : db.collection(tgt).doc();
          delete doc._id; batch.set(ref, doc, { merge: true }); n++; });
        await batch.commit(); }
      audit("import", tgt, null, `${f.name} · ${n} rows imported${skipped ? `, ${skipped} duplicates skipped` : ""}`);
      if (["leaveRequests", "attendance", "dayReports", "expenseClaims"].includes(tgt)) {
        const names = [...new Set(data.map(r => r[Object.keys(m).find(k => m[k] === "name")]).filter(Boolean))];
        const unknown = names.filter(nm => !state.users.some(u => String(u.name || "").trim().toLowerCase() === String(nm).trim().toLowerCase()));
        if (unknown.length) $("map").innerHTML += `<p class="small" style="color:#9A6A2F;margin-top:6px">These names did not match anyone in the app, so those rows are not attached to a person yet: ${unknown.slice(0, 20).map(esc).join(", ")}${unknown.length > 20 ? " and more" : ""}. Approve their profiles, then import again.</p>`;
      }
      toast(`${n} rows imported${skipped ? `, ${skipped} blocked` : ""}`);
      if (["projects", "offices"].includes(tgt)) await loadMasters();
      $("go").textContent = `Imported ${n} rows`;
      const blockedHtml = blockedRows.length ? `<div class="card" style="border-left:4px solid var(--bad);margin-top:8px"><h2>${blockedRows.length} rows blocked — duplicates</h2><p class="small muted">These rows already exist in the app and were not imported. Fix them in your file and re-import if needed.</p><div class="tablewrap"><table class="table"><tr><th>Row</th><th>Name / ID</th><th>Reason</th></tr>${blockedRows.map(b => `<tr><td>${b.row}</td><td>${esc(b.name)}</td><td>${esc(b.reason)}</td></tr>`).join("")}</table></div></div>` : "";
      $("map").innerHTML += `<p class="small" style="color:var(--green);margin-top:8px">Done — ${n} rows imported. Open the register to check before importing anything else.</p>` + blockedHtml; }; };
};

/* ================= SEED: load the September 2026 organigram ================= */
const EP_ORGANIGRAM = [
  { title: "Governing Board", department: "Governance", reportsTo: "", responsibilities: "Governance, compliance and overall accountability",
    purpose: "To oversee governance, compliance and the overall accountability of the organisation.", authority: "Approves annual budgets and audited accounts, appoints key staff and auditors, approves major policies and programmes." },
  { title: "Advisory Board", department: "Governance", reportsTo: "", responsibilities: "Strategic guidance and oversight; fundraising and partnerships; policy and governance advice; risk assessment and mitigation; organisational growth and sustainability",
    purpose: "To provide strategic guidance, technical expertise, partnerships and advice to the Founder.", authority: "Advisory only; no executive or financial authority." },
  { title: "Founder & General Secretary", department: "Governance", reportsTo: "Governing Board", functional: "Advisory Board", taCategory: "I", limit: 50000,
    responsibilities: "Overall leadership, vision, decision-making; represents the organisation", holderName: "Mohd. Shafiqur Rahman Khan",
    purpose: "To provide overall strategic, institutional and organisational leadership to Empower People and ensure the organisation remains mission-driven, accountable, sustainable and Sakhi-centred.", authority: "Final organisational authority within the powers assigned by the Governing Board. Approves major strategic, financial, staffing and structural decisions." },

  { title: "Director ACF", department: "Accounts", reportsTo: "Founder & General Secretary", taCategory: "II", limit: 50000,
    responsibilities: "Manages finance, administration, compliance, audits and systems", holderName: "Bhumish Khudkhudia",
    purpose: "To lead financial management, administration, statutory compliance, procurement, HR administration and internal organisational systems.", authority: "Approves expenditure up to ₹50,000 and countersigns above it; second signatory on payments of ₹10,000 and above; approves procurement within the Financial Procedures. Expenditure above ₹50,000 goes to the Executive Committee." },
  { title: "Accountant", department: "Accounts", reportsTo: "Director ACF", taCategory: "III", limit: 5000,
    responsibilities: "Bookkeeping and accounting; bank reconciliation; payroll support; financial documentation; utilisation certificates; support audits and compliance", holderName: "Jitendra Thakur",
    purpose: "To maintain accurate financial records and support the organisation's accounting, reporting, audit and compliance systems.", authority: "No independent authority to approve expenditure outside delegated financial procedures. Prepares vouchers and records transactions; every payment he prepares is approved by the Director ACF." },
  { title: "Procurement", department: "Admin", reportsTo: "Director ACF", taCategory: "III", limit: 5000,
    responsibilities: "Receive procurement requests; obtain quotations; maintain vendor records and procurement files; prepare procurement documentation and purchase orders; maintain asset and procurement registers; support vendor evaluation; allocate daily tasks to support staff; coordinate drivers and organisational vehicles; monitor attendance and availability; maintain vehicle logbooks; support field logistics", holderName: "Salauddin Ali",
    purpose: "To manage procurement processes and provide operational supervision of support staff and drivers.", authority: "Raises purchase orders within approved budgets and limits; does not approve payments. Allocates daily tasks to support staff and drivers." },
  { title: "Coordinator – Administration & Communication", department: "Admin", reportsTo: "Director ACF", taCategory: "III", limit: 5000,
    responsibilities: "Office administration; HR support; internal communication; documentation and filing; scheduling and logistics; website and communication support", holderName: "Zainab Khan",
    purpose: "To coordinate administration, documentation, internal communication and organisational office systems.", authority: "Approves leave and routine administrative requests of the Admin Assistants; no financial approval authority beyond petty cash within the Financial Procedures." },

  { title: "Program Officer", department: "Program", reportsTo: "Founder & General Secretary", taCategory: "II", limit: 5000,
    responsibilities: "Overall oversight of all programmes, ensuring quality implementation, monitoring, reporting and team coordination", holderName: "Alishika Raj",
    purpose: "To provide overall programme leadership, quality oversight, planning, monitoring and coordination for Empower People's programme portfolio.", authority: "Approves programme plans, workplans and programme reports; verifies programme expenditure against budgets; escalates significant programme issues to the Founder." },
  { title: "Program Coordination Lead", department: "Program", reportsTo: "Program Officer", taCategory: "III", limit: 5000,
    responsibilities: "Coordinates all programme teams; programme planning and implementation; monitoring, reporting and documentation; team coordination and capacity building; supports programme quality across all thematic areas", holderName: "Anjule Shaym Maurya",
    purpose: "To coordinate programme implementation across Empower People and serve as the principal link between the Program Officer and programme implementation teams.", authority: "Approves activity plans, day reports, leave and claims of the programme teams reporting to this post, within the Financial Procedures." },

  { title: "Program Lead – Sakhi Mandal Programme", department: "Program", reportsTo: "Program Coordination Lead", taCategory: "III", limit: 1000,
    responsibilities: "Leads the Sakhi Mandal collective and related initiatives", holderName: "Rajbala",
    purpose: "To lead the Sakhi Mandal programme structure and coordinate Sakhi-led community, leadership and livelihood activities.", authority: "Approves activity-level decisions and the reports of the team reporting to this post; recommends expenditure to the Program Coordination Lead." },
  { title: "Lead – Paro Voice & Community Media", department: "Program", reportsTo: "Program Lead – Sakhi Mandal Programme", taCategory: "III",
    responsibilities: "Community media; awareness campaigns; Sakhi storytelling; content creation", holderName: "Shilpa",
    purpose: "To lead Sakhi-led community media, storytelling and communication activities within the Sakhi Mandal structure.", authority: "Publishes only with recorded informed consent; no financial authority. Coordinates with Fundraising, Research & Innovation on external communication." },
  { title: "Azaad Women Enterprise (Community Collective)", department: "Program", reportsTo: "Program Lead – Sakhi Mandal Programme",
    responsibilities: "200 women members; women-led economic activities; livelihoods and market linkages; collective enterprise development; leadership and skill development",
    purpose: "To strengthen women-led economic activity, collective enterprise and livelihood opportunities among approximately 200 women members.", authority: "Collective decision-making on enterprise matters; organisational expenditure follows the Financial Procedures through the Program Lead – Sakhi Mandal." },

  { title: "Program Lead – Nari Nusrat Programme", department: "Program", reportsTo: "Program Coordination Lead", taCategory: "III", limit: 1000,
    responsibilities: "Leads the Nari Nusrat collective and related initiatives", holderName: "Noor Yasmin",
    purpose: "To lead Nari Nusrat and coordinate its community mobilisation, leadership, outreach and programme activities.", authority: "Approves activity-level decisions and the reports of the team reporting to this post; recommends expenditure to the Program Coordination Lead." },
  { title: "President – Nari Nusrat", department: "Program", reportsTo: "Program Lead – Nari Nusrat Programme",
    responsibilities: "Elected community leader; provides leadership and guidance to Nari Nusrat members", holderName: "Basiron Nessa",
    purpose: "To provide community-level leadership to Nari Nusrat.", authority: "Community leadership role; no financial or staff authority within the organisation." },
  { title: "Lead – Ami Paro & Community Media", department: "Program", reportsTo: "Program Lead – Nari Nusrat Programme",
    responsibilities: "Community media; awareness campaigns; Sakhi storytelling; community engagement", holderName: "Akiya Khatoon",
    purpose: "To coordinate community media, Sakhi-led storytelling and outreach within Nari Nusrat.", authority: "Publishes only with recorded informed consent; no financial authority." },

  { title: "Program Coordinator – Coaching Centre Programme", department: "Program", reportsTo: "Program Lead – Nari Nusrat Programme", taCategory: "III", limit: 1000,
    responsibilities: "Coordinates coaching centre activities; training support; beneficiary tracking; education support for children and young people of Sakhis", holderName: "Shah Alam",
    purpose: "To coordinate the day-to-day operation of the Coaching Centre.", authority: "No independent financial authority; coordinates teachers, students and centre documentation and reports to the Program Lead – Nari Nusrat." },

  { title: "Coordinator – Field Operations (Haryana)", department: "Program", reportsTo: "Program Coordination Lead", taCategory: "III", limit: 1000,
    responsibilities: "Manages field implementation and community engagement; field implementation and supervision; community engagement; case support and referrals; linkages with services; monitoring and field reporting", holderName: "Rajendra Prasad",
    purpose: "To lead field operations and ensure effective, ethical and timely implementation of field activities.", authority: "Approves field plans and field reports; escalates urgent cases and risks; recommends field expenditure to the Program Coordination Lead." },
  { title: "Field Coordinator (Haryana)", department: "Program", reportsTo: "Program Coordination Lead", taCategory: "III", limit: 1000,
    responsibilities: "Field implementation and coordination in Haryana; community mobilisation; participant support and tracking; logistics and travel coordination; reporting and documentation", holderName: "Dildar Hussain",
    purpose: "To ensure smooth day-to-day field and office functioning in Haryana and provide operational support to programme teams.", authority: "No independent financial authority; holds petty cash within the Financial Procedures and reports operational issues to the Program Coordination Lead." },
  { title: "Admin Assistant – Yamunanagar", department: "Admin", reportsTo: "Coordinator – Administration & Communication", taCategory: "III",
    responsibilities: "Office support and facilities; documentation and filing; day-to-day operations; petty cash holder", holderName: "Minakshi",
    purpose: "To support the day-to-day administration, records and logistics of the Yamunanagar office.", authority: "Holds petty cash within the limits of the Financial Procedures (₹2,000 per transaction, ₹10,000 balance); no approval authority." },

  { title: "Field Coordinator – M3-SAGE (Bihar)", department: "Program", reportsTo: "Program Coordination Lead", taCategory: "III",
    responsibilities: "Field implementation and coordination; community mobilisation; participant support and tracking; reporting and documentation", holderName: "Raushan Kumar",
    purpose: "To coordinate field implementation of M3-SAGE and support participating women and enterprises.", authority: "No independent financial authority; implements within the approved activity plan and reports to the Program Coordination Lead." },
  { title: "Admin Assistant – Bihar", department: "Admin", reportsTo: "Coordinator – Administration & Communication", taCategory: "III",
    responsibilities: "Programme administration support; documentation and filing; logistics and travel coordination; field office support", holderName: "Mohammad Iqbal",
    purpose: "To provide administrative and logistical support to Empower People's Bihar programme operations.", authority: "Holds petty cash within the limits of the Financial Procedures; no approval authority." },

  { title: "Support Staff (office & field)", department: "Admin", reportsTo: "Procurement", taCategory: "III",
    responsibilities: "Office support; field support; meeting and event setup; movement of materials; office maintenance support; logistics assistance; maintain entrusted equipment; follow safety and safeguarding procedures; maintain confidentiality",
    purpose: "To provide essential operational and logistical support to Empower People.", authority: "No financial or approval authority. Bound by organisational safety, safeguarding and confidentiality procedures." },
  { title: "Drivers / Transport Support", department: "Admin", reportsTo: "Procurement", taCategory: "III",
    responsibilities: "Operate organisational vehicles safely; transport staff and authorised persons; support field visits and programme travel; maintain vehicle cleanliness and logbooks; report maintenance requirements; follow traffic laws and safety procedures; maintain confidentiality",
    purpose: "To provide safe, reliable and timely transportation support.", authority: "No financial or approval authority. Bound by traffic law, organisational safety procedures and confidentiality regarding activities and passengers." },
  { title: "Coordinator – Fundraising, Research & Innovation", department: "Fund raising", reportsTo: "Founder & General Secretary", taCategory: "II", limit: 5000,
    responsibilities: "Proposal development and fundraising; research and innovation; donor reporting and communication; partnership development; external communication and media; knowledge management and publications; website and social media coordination; representation in networks and events", holderName: "Zubana Azhar",
    purpose: "To lead proposal development, fundraising, research, donor reporting, partnerships and external communication.", authority: "Signs off proposals and donor reports before submission by the Founder; no expenditure approval authority." }
];
routes.seedOrg = async () => {
  if (!has("super_admin")) return html(`<div class="card"><div class="empty">App Super Admin only</div></div>`);
  setTitle("Load the organigram");
  const existing = (await db.collection("posts").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const have = new Set(existing.map(p => (p.title || "").toLowerCase()));
  const toAdd = EP_ORGANIGRAM.filter(p => !have.has(p.title.toLowerCase()));
  html(`<div class="card"><h2>Empower People organigram · September 2026</h2>
    <p class="small muted">Loads the posts from the signed organigram: title, department, line of reporting, functional supervision, responsibilities, TA category and financial limit. Holders are recorded by name; each person is attached to their post when you approve their profile. You can change anything afterwards in Posts and Change structure.</p>
    <p><span class="tag">${EP_ORGANIGRAM.length} posts in the chart</span> <span class="tag ${existing.length ? "warn" : ""}">${existing.length} already in the app</span> <span class="tag ok">${toAdd.length} would be added</span></p>
    ${toAdd.length ? `<button class="btn" id="load">Load ${toAdd.length} posts</button>` : `<div class="empty">Everything from the chart is already loaded.</div>`}
    <button class="btn small quiet" onclick="go('posts')">Open Posts</button> <button class="btn small quiet" onclick="go('orgchart')">Organigram chart</button></div>
  <div class="card"><h2>What will be added</h2><div class="tablewrap"><table class="table"><tr><th>Post</th><th>Department</th><th>Reports to</th><th>Functional</th><th>Holder (name)</th><th>TA</th><th>Limit ₹</th></tr>
    ${(toAdd.length ? toAdd : EP_ORGANIGRAM).map(p => `<tr><td><b>${esc(p.title)}</b><div class="s">${esc(String(p.responsibilities || "").slice(0, 90))}</div></td><td>${esc(p.department)}</td>
      <td>${esc(p.reportsTo || "—")}</td><td>${esc(p.functional || "—")}</td><td>${esc(p.holderName || "vacant")}</td><td>${esc(p.taCategory || "")}</td><td>${p.limit ? p.limit.toLocaleString("en-IN") : ""}</td></tr>`).join("")}</table></div></div>`);
  if ($("load")) $("load").onclick = async () => { $("load").disabled = true; $("load").textContent = "Loading…";
    const batch = db.batch();
    toAdd.forEach(p => { const { holderName, ...rest } = p;
      batch.set(db.collection("posts").doc(), { ...rest, holderName: holderName || null, holderId: null, effectiveFrom: "2026-09-01",
        history: [{ what: "Loaded from the September 2026 organigram", by: state.me.name, from: today(), reason: "Initial load" }],
        createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); });
    await batch.commit(); audit("seed", "posts", null, `${toAdd.length} posts from the Sept 2026 organigram`);
    toast(`${toAdd.length} posts loaded`); routes.seedOrg(); };
};

/* ================= DAK REGISTER: post and courier, in and out ================= */
routes.dak = registerScreen({
  route: "dak", col: "dak", orgWide: true, title: "Dak register", orderBy: "date", nameKey: "subject",
  canEdit: () => has("super_admin", "director_acf", "admin", "admin_assistant", "procurement"),
  intro: "Every letter, courier, summons and parcel that comes in or goes out. Inward dak is given a number, acknowledged and handed to the person it concerns; outward dak carries the consignment number so it can be traced.",
  flow: "Received or sent → entered the same day → handed over and acknowledged → closed",
  fields: [
    { k: "direction", l: "Inward or outward", t: "select", o: ["Inward — received", "Outward — sent"], w: "half" },
    { k: "date", l: "Date", t: "date", d: today(), w: "half" },
    { k: "mode", l: "How", t: "select", o: ["Speed post", "Registered post", "Ordinary post", "Courier", "By hand", "Email (hard copy filed)", "Other"], w: "half" },
    { k: "kind", l: "Kind of dak", t: "select", o: ["Letter", "Notice or summons", "Government or department letter", "Donor or grant paper", "Bank paper", "Invoice or bill", "Cheque or demand draft", "Legal paper", "Parcel", "Other"], w: "half" },
    { k: "fromTo", l: "From (inward) or To (outward)", req: true, w: "half" },
    { k: "address", l: "Their address", w: "half" },
    { k: "subject", l: "Subject", req: true },
    { k: "consignment", l: "Consignment / tracking number", w: "half" },
    { k: "officeId", l: "Office", t: "offices", w: "half" },
    { k: "forWhomId", l: "Who it concerns", t: "users", w: "half" }, { k: "forPostTitle", l: "Which post it concerns", ph: "Coordinator – Administration & Communication", w: "half" },
    { k: "projectId", l: "Project, if any", t: "projects", w: "half" },
    { k: "dueBy", l: "Reply needed by", t: "date", w: "half" },
    { k: "charges", l: "Postage or courier charge ₹", t: "number", w: "half" },
    { k: "notes", l: "Notes" },
    { k: "scan", l: "Scan or photograph of the dak", t: "file" }],
  before: async d => {
    if (!d.dakNo) { const y = fyOfDate(d.date); const pre = d.direction === "Outward — sent" ? "OUT" : "IN";
      const n = await nextCode(`DAK-${pre}-${y}`);
      d.dakNo = `${pre}/${y}/${String(n.split("-").pop()).padStart(4, "0")}`; }
    d.status = d.direction === "Outward — sent" ? "Sent" : "Received";
    d.enteredBy = state.user.uid;
  },
  cols: [
    { k: "dakNo", l: "Dak no.", f: v => `<span style="font-family:monospace">${esc(v || "")}</span>` },
    { k: "date", l: "Date", t: "date" },
    { k: "direction", l: "In / out", f: v => /Outward/.test(v || "") ? `<span class="tag">out</span>` : `<span class="tag ok">in</span>` },
    { k: "fromTo", l: "From / to" }, { k: "subject", l: "Subject" }, { k: "kind", l: "Kind" }, { k: "mode", l: "How" },
    { k: "consignment", l: "Tracking" },
    { k: "forWhomId", l: "Concerns", t: "users" },
    { k: "dueBy", l: "Reply by", f: v => v ? (new Date(v) < new Date() ? `<span class="tag bad">${fmtD(v)}</span>` : `<span class="tag warn">${fmtD(v)}</span>`) : "" },
    { k: "status", l: "Status", f: statusTag }],
  actions: [
    { k: "hand", l: "Handed over", show: r => r.status === "Received",
      run: async (r, ref) => { const who = prompt("Handed to whom? (name)") || ""; if (!who) return;
        await ref.update({ status: "Handed over", handedTo: who, handedOn: today(), handedBy: state.user.uid }); } },
    { k: "ack", l: "Acknowledged", show: r => r.status === "Handed over" || r.status === "Sent",
      run: async (r, ref) => ref.update({ status: "Acknowledged", ackOn: today() }) },
    { k: "close", l: "Close", show: r => /Acknowledged|Replied/.test(r.status || ""), run: async (r, ref) => ref.update({ status: "Closed" }) },
    { k: "reply", l: "Replied", show: r => r.direction === "Inward — received" && r.status !== "Closed",
      run: async (r, ref) => { const note = prompt("How was it replied to? (dak number of the reply, if any)") || "";
        await ref.update({ status: "Replied", replyNote: note, repliedOn: today() }); } }],
  stats: rows => [
    ["Inward this year", rows.filter(r => /Inward/.test(r.direction || "") && (r.date || "") >= fyOfDate() .slice(0, 4) + "-04-01").length],
    ["Outward this year", rows.filter(r => /Outward/.test(r.direction || "") && (r.date || "") >= fyOfDate().slice(0, 4) + "-04-01").length],
    ["Awaiting handover", rows.filter(r => r.status === "Received").length],
    ["Reply overdue", rows.filter(r => r.dueBy && r.dueBy < today() && !/Replied|Closed/.test(r.status || "")).length]]
});


/* A record may be filed long after the work happened — a session held in July, entered
   in October. The date given is the one that counts, so the form shows which month it
   will fall in, and the activity list follows the project chosen. */
function wireActivityCascade() {
  // the register form is "rf"; some hand-written forms use "f"
  const form = document.getElementById("rf") || document.getElementById("f");
  if (!form) return;
  const actSel = form.querySelector("[data-acts]");
  const projSel = form.elements.projectId;
  if (actSel && projSel) {
    const all = [...actSel.options].map(o => ({ v: o.value, t: o.textContent, p: o.dataset.proj || "" }));
    const fill = () => {
      const pid = projSel.value, keep = actSel.value;
      actSel.innerHTML = all.filter(o => !o.v || !pid || o.p === pid)
        .map(o => `<option value="${o.v}" data-proj="${o.p}">${o.v ? o.t.split(" · ").slice(1).join(" · ") || o.t : (pid ? "— none of them —" : "— organisation work, no activity —")}</option>`).join("");
      if ([...actSel.options].some(o => o.value === keep)) actSel.value = keep;
    };
    projSel.addEventListener("change", () => { fill();
      // the programme follows the project, since the project exists to deliver it
      const prog = form.elements.programmeId;
      if (prog && !prog.value) {
        const p = (state.projects || []).find(x => x.id === projSel.value);
        const first = (p && p.programmeIds || [])[0];
        if (first && [...prog.options].some(o => o.value === first)) prog.value = first;
      }
    });
    fill();
  }
  const dateF = form.elements.date;
  if (dateF) {
    let note = form.querySelector("#dateNote");
    if (!note) { note = document.createElement("span"); note.id = "dateNote"; note.className = "small muted";
      if (dateF.parentElement) dateF.parentElement.appendChild(note); }
    const say = () => { const v = dateF.value; if (!v) { note.textContent = ""; return; }
      const d = new Date(v), now = new Date();
      const month = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      const back = d < new Date(now.getFullYear(), now.getMonth(), 1);
      note.textContent = back ? `Counts in ${month} — the month it happened, not today.` : `Counts in ${month}.`;
      note.style.color = back ? "#8A5A00" : ""; };
    dateF.addEventListener("change", say); say();
  }
}


/* The person in charge at an office: a field or office coordinator posted there. */
function runsAnOffice() {
  if (!state.me.officeId) return false;
  if (has("super_admin", "admin", "director_acf", "accountant", "program_officer", "program_coord", "board", "observer")) return false;
  return has("program_lead") || /coordinator|in-?charge|lead/i.test(state.me.postTitle || "");
}
/* True when this person's view should be limited to their own office. */
function onlyMyOffice() {
  return has("admin_assistant") && !has("super_admin", "admin", "director_acf", "accountant",
    "program_officer", "program_coord", "board", "observer", "compliance_head");
}
/* Does this record belong to my office? Either stamped with it, or filed by someone
   posted there. A record with no office at all stays visible — hiding it would lose it. */
function ofMyOffice(r) {
  const mine = state.me.officeId;
  if (!mine) return true;
  if (r.officeId) return r.officeId === mine;
  const who = r.uid || r.createdBy || r.by || r.recordedBy || r.assigneeId;
  if (who) { const u = (state.users || []).find(x => x.id === who);
    if (u && u.officeId) return u.officeId === mine; }
  return true;
}


/* ---------- dates out of a spreadsheet ----------
   Excel stores a date as a number counted from 30 December 1899, and shows it as a
   date on screen. Read without converting, 15 June 2022 arrives as 44719. Anything
   that looks like a date is turned into YYYY-MM-DD here, whatever shape it came in. */
function excelSerialToDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000);
  return isNaN(d) ? null : d;
}
function readAnyDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00Z");
  /* a bare 5-digit number in a date column is an Excel serial, not a year */
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); if (n > 20000 && n < 60000) return excelSerialToDate(n); }
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);      // 17/10/2022, day first
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(s);                                              // "Jan 21, 2026"
  return isNaN(d) ? null : d;
}
const DATE_COLUMNS = /date|registeredon|joined|dob|birth|due|from|to|issued|paidon|start|end|deadline|on$/i;
/** Every column that looks like a date is written as YYYY-MM-DD before it is saved. */
function tidyDates(row) {
  const out = {};
  Object.keys(row).forEach(k => {
    const v = row[k];
    if (DATE_COLUMNS.test(k.replace(/[^a-z]/gi, ""))) {
      const d = readAnyDate(v);
      out[k] = d ? d.toISOString().slice(0, 10) : v;
      if (d && String(v) !== out[k]) out[k + "AsGiven"] = String(v);   // keep what the sheet said
    } else out[k] = v;
  });
  return out;
}


/** Whoever holds the safeguarding, child protection or POSH posts. The post carries
 *  this, not the person's role — she gains it on appointment and loses it when the
 *  post passes to somebody else. */
function isSafeguardingLead() {
  const t = String(state.me.postTitle || "");
  return has("dso", "cpo", "posh_chair", "posh", "posh_external")
    || /designated safeguarding officer|child protection officer|presiding officer/i.test(t);
}

/* ---- roles the organisation adds for itself ----
   The built-in roles cannot be changed, because the app's own rules are written
   against them. A role added here names what it is and which screens it opens, and
   can then be given to anybody in People & sign-ins like any other. */
routes.roles = async () => {
  setTitle("Roles");
  if (!has("super_admin")) return html(`<div class="card"><div class="empty">Only the App Super Admin changes roles.</div></div>`);
  const own = (await db.collection("roles").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const users = state.users || [];
  const built = Object.entries(ROLES).filter(([k]) => !own.some(o => o.key === k));
  const count = k => users.filter(u => u.active && (u.roles || []).includes(k)).length;
  const SCREENS = Object.keys(routes).sort();
  html(`<div class="card"><h2>Roles</h2>
      <p class="small muted">A role says what somebody is and what they may open. One person may hold several —
        a Board member who is also the safeguarding officer, or a volunteer who is also field staff.</p></div>

    <div class="card"><h2>Add a role</h2>
      <form id="rf"><div class="two">
        <label class="field"><span>What it is called</span><input name="label" required placeholder="Lead – Salah Sakhi programme"></label>
        <label class="field"><span>Short key</span><input name="key" required placeholder="salah_lead"
          pattern="[a-z][a-z0-9_]{2,24}" title="lower case letters, numbers and underscores"></label></div>
      <label class="field"><span>Which screens does it open?</span>
        <select name="screens" multiple size="8">${SCREENS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
        <span class="small muted">Hold Ctrl (or Cmd) to choose several. It opens these in addition to whatever else the person holds.</span></label>
      <label class="field"><span>What it is for</span><textarea name="purpose" rows="2"></textarea></label>
      <button class="btn" type="submit">Add it</button></form></div>

    <div class="card"><h2>Roles you have added (${own.length})</h2>
      <div class="list">${own.length ? own.map(r => `<div class="item"><div class="grow">
        <div class="t">${esc(r.label)} <span class="muted small">${esc(r.key)}</span></div>
        <div class="s">${count(r.key)} ${count(r.key) === 1 ? "person" : "people"} · opens ${(r.screens || []).length} screen${(r.screens || []).length === 1 ? "" : "s"}${r.purpose ? " · " + esc(r.purpose) : ""}</div></div>
        <button class="btn small quiet" data-del="${r.id}">Remove</button></div>`).join("")
        : `<div class="empty">None yet. The built-in roles below cover most of what an office needs.</div>`}</div></div>

    <div class="card"><h2>Built in (${built.length})</h2>
      <p class="small muted">These cannot be removed — the app's own rules are written against them. Anyone may hold any of them.</p>
      <div class="list">${built.map(([k, l]) => `<div class="item"><div class="grow">
        <div class="t">${esc(l)}</div><div class="s">${esc(k)} · ${count(k)} ${count(k) === 1 ? "person" : "people"}</div></div></div>`).join("")}</div></div>`);

  $("rf").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const key = String(fd.get("key") || "").trim().toLowerCase();
    if (ROLES[key]) return alert(`"${key}" is already a role — ${ROLES[key]}.`);
    await db.collection("roles").add({ key, label: String(fd.get("label") || "").trim(),
      screens: fd.getAll("screens"), purpose: String(fd.get("purpose") || "").trim(),
      addedBy: state.user.uid, addedOn: today() });
    audit("role_add", "roles", null, key);
    await loadOwnRoles(); toast("Added"); routes.roles();
  };
  $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const r = own.find(x => x.id === b.dataset.del);
    const held = count(r.key);
    if (held && !confirm(`${held} ${held === 1 ? "person holds" : "people hold"} this role.\n\nRemoving it takes the screens away from them. Go on?`)) return;
    await db.collection("roles").doc(r.id).delete();
    audit("role_remove", "roles", r.id, r.key);
    await loadOwnRoles(); toast("Removed"); routes.roles();
  });
};
