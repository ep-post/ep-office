/* ============================================================
   programmes-v2.js
   Overrides routes.programme defined in collab.js.
   Load this AFTER collab.js in index.html.
   Changes in this version:
     1. Resources tab on every programme (after Team)
     2. Updates — photo/PDF attachment
     3. Sakhi Mandal beneficiaries — resolves Sakhi ID from Firestore
     4. NK Fellowship (code NKF) — purpose-built Fellows tab
     5. Beneficiaries — Add and Edit forms
   ============================================================ */

routes.programme = async (id, tab) => {
  id = id || state.programmeId;
  state.programmeId = id;
  tab = tab || state.progTab || "overview";
  state.progTab = tab;

  const snap = await db.collection("programmes").doc(id).get().catch(() => null);
  if (!snap || !snap.exists) return routes.programmes();
  const p = snap.data();

  // Programme leads can only open their own programme
  if (!has("super_admin","program_officer","program_coord","director_acf","admin") &&
      p.leadId !== state.user.uid &&
      !(p.team||[]).some(m => m === state.user.uid || (m && m.id === state.user.uid))) {
    toast("You can only access your own programme");
    return routes.programmes();
  }

  setTitle(p.name || "Programme");
  const isNKF = (p.code || "").toUpperCase() === "NKF";

  const canEdit = has("super_admin", "program_officer", "program_coord", "director_acf", "program_lead", "admin") ||
    p.leadId === state.user.uid || (p.leadIds || []).includes(state.user.uid);

  // Fetch benefits first so we can derive missing Sakhi IDs in the same parallel batch
  const allBens = (await db.collection("benefits").limit(900).get()
    .catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const mine = allBens.filter(b => b.programmeId === id || !b.programmeId);
  const missingCodeIds = [...new Set(
    mine.filter(b => b.personId && !b.personCode).map(b => b.personId)
  )].slice(0, 30);

  const q    = (col, field) => db.collection(col).where(field, "==", id).limit(400)
    .get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const qSub = (sub) => db.collection("programmes").doc(id).collection(sub)
    .get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);

  const [groups, acts, ups, fellows, resources, personsSnap] = await Promise.all([
    q("groups",            "programmeId"),
    q("activities",        "programmeId"),
    q("programmeUpdates",  "programmeId"),
    isNKF ? qSub("fellows")   : Promise.resolve([]),
    qSub("resources"),
    missingCodeIds.length
      ? db.collection("persons")
          .where(firebase.firestore.FieldPath.documentId(), "in", missingCodeIds)
          .get().catch(() => ({ docs: [] }))
      : Promise.resolve({ docs: [] })
  ]);

  // Map personId → Sakhi code for the beneficiary Sakhi ID fix
  const personCodeMap = {};
  (personsSnap.docs || []).forEach(d => { personCodeMap[d.id] = d.data().code || ""; });

  const visible = groups.filter(inMyArea);
  const members = visible.reduce((a, g) => a + (g.memberCount || 0), 0);
  const savings = visible.reduce((a, g) => a + (Number(g.savings) || 0), 0);
  const byState = {};
  visible.forEach(g => { const s = g.state || "—"; byState[s] = (byState[s] || 0) + 1; });
  const inr    = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const recent = [...ups].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const overviewOnly = has("board") || isVolunteerOnly();
  if (overviewOnly) tab = "overview";

  const TABS = overviewOnly
    ? [["overview", "Overview"]]
    : isNKF
    ? [["overview", "Overview"], ["fellows", "Fellows"], ["updates", "Updates"],
       ["resources", "Resources"],
       ...(canEdit ? [["team", "Team"]] : [])]
    : [["overview", "Overview"], ["groups", "Groups / CC"], ["activities", "Activities"],
       ["beneficiaries", "Beneficiaries"], ["updates", "Updates"],
       ["resources", "Resources"],
       ...(canEdit ? [["team", "Team"]] : [])];

  // Guard: stale tab state from previous programme
  if (!TABS.some(([k]) => k === tab)) tab = TABS[0][0];

  // ── helpers ────────────────────────────────────────────────
  const fileIcon = type => ({ pdf: "📄", image: "🖼️", doc: "📝", video: "🎬" }[type] || "📎");
  const fmtRes  = r => {
    const when = r.addedAt?.seconds
      ? new Date(r.addedAt.seconds * 1000).toISOString().slice(0, 10) : "";
    return `<div class="item" style="align-items:center">
      <div style="font-size:1.5rem;margin-right:12px;flex-shrink:0">${fileIcon(r.type)}</div>
      <div class="grow">
        <div class="t">${esc(r.name)}</div>
        ${r.description ? `<div class="s">${esc(r.description)}</div>` : ""}
        <div class="s muted">Added ${fmtD(when)} · ${esc(userName(r.addedBy))}</div>
      </div>
      <a href="${esc(r.fileUrl || "#")}" target="_blank" rel="noopener"
         class="btn small quiet" style="flex-shrink:0">Open</a></div>`;
  };

  // ── tab bodies ─────────────────────────────────────────────
  const body = {

    // ── Overview ───────────────────────────────────────────
    overview: () => `
      <div class="grid">
        <div class="card stat"><span class="muted small">${isNKF ? "Fellows" : "Groups / CC"}</span>
          <b>${isNKF ? fellows.length : visible.length}</b></div>
        ${isNKF ? "" : `<div class="card stat"><span class="muted small">Members</span><b>${members}</b></div>
        <div class="card stat"><span class="muted small">Group savings</span><b>${inr(savings)}</b></div>`}
        <div class="card stat"><span class="muted small">Activities</span><b>${acts.length}</b></div>
        <div class="card stat"><span class="muted small">Updates this year</span>
          <b>${ups.filter(u => (u.date || "") >= new Date().getFullYear() + "-01-01").length}</b></div>
      </div>
      ${p.aim ? `<div class="card"><h2>What it is for</h2><p class="small">${esc(p.aim)}</p></div>` : ""}
      ${isNKF && fellows.length ? (() => {
          const latest = [...fellows].sort((a, b) => (b.year || 0) - (a.year || 0))[0];
          return `<div class="card"><h2>Current fellow · ${latest.year || ""}</h2>
            <div style="display:flex;gap:16px;align-items:center">
              ${latest.photoUrl ? `<img src="${esc(latest.photoUrl)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">` : `<div style="width:64px;height:64px;border-radius:50%;background:var(--surface2,#e0e0e0);display:flex;align-items:center;justify-content:center;font-size:2rem">🎓</div>`}
              <div><div style="font-weight:600;font-size:1.05rem">${esc(latest.name)}</div>
                ${latest.institution ? `<div class="small muted">${esc(latest.institution)}</div>` : ""}
                ${latest.district ? `<div class="small muted">${esc(latest.district)}</div>` : ""}
              </div></div></div>`;
        })() : ""}
      <div class="card"><h2>Where it runs</h2>
        <table class="table">${Object.entries(byState).sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `<tr><td>${esc(s)}</td><td>${n} group${n > 1 ? "s" : ""}</td></tr>`).join("")
          || `<tr><td class="empty">No groups yet</td></tr>`}</table>
        <p class="small muted" style="margin-top:8px">
          ${p.leadId ? `Led by <b>${esc(userName(p.leadId))}</b>` : `<span class="tag warn">No lead named</span>`}
          ${p.startedOn ? " · running since " + fmtD(p.startedOn) : ""}</p></div>
      ${recent.length ? `<div class="card"><h2>Latest update</h2>
        <p class="small muted">${fmtD(recent[0].date)} · ${esc(userName(recent[0].by))}</p>
        <p>${esc(recent[0].text)}</p></div>` : ""}`,

    // ── Groups / CC ────────────────────────────────────────
    groups: () => `<div class="card"><h2>Groups / CC in this programme (${visible.length})</h2>
      <div class="tablewrap"><table class="table">
        <tr><th>Group</th><th>Village</th><th>District</th><th>State</th><th>Leader</th><th>Members</th><th>Savings</th><th></th></tr>
        ${visible.map(g => `<tr>
          <td>${esc(g.name)}</td><td>${esc(g.village || "")}</td>
          <td>${esc(g.district || "")}</td><td>${esc(g.state || "")}</td>
          <td>${esc(g.leaderName || "")}</td><td>${g.memberCount || 0}</td>
          <td>${g.savings ? inr(g.savings) : ""}</td>
          <td><button class="btn small quiet" data-g="${g.id}">Open</button></td></tr>`).join("")
          || `<tr><td colspan="8" class="empty">No groups yet in your area</td></tr>`}
      </table></div>
      <button class="btn small" style="margin-top:8px" onclick="go('groups')">Add a group / CC</button></div>`,

    // ── Activities ─────────────────────────────────────────
    activities: () => `<div class="card"><h2>Activities (${acts.length})</h2>
      <div class="tablewrap"><table class="table">
        <tr><th>Code</th><th>Activity</th><th>Target</th><th>Period</th><th>Lead</th><th>Status</th></tr>
        ${acts.map(a => `<tr>
          <td>${esc(a.code || "")}</td><td>${esc(a.name)}</td>
          <td>${a.target || ""} ${esc(a.unit || "")}</td>
          <td>${esc(a.period || "")}</td>
          <td class="small">${esc(userName(a.leadId))}</td>
          <td>${statusTag(a.status)}</td></tr>`).join("")
          || `<tr><td colspan="6" class="empty">Nothing planned yet</td></tr>`}
      </table></div>
      <button class="btn small" style="margin-top:8px" onclick="go('activities')">Add an activity</button></div>`,

    // ── Beneficiaries (with Add form and Sakhi ID fix) ─────
    beneficiaries: () => {
      const byPerson = {};
      mine.forEach(b => {
        const k = b.personId || b.personCode || b.name;
        if (!k) return;
        const code = b.personCode || (b.personId ? (personCodeMap[b.personId] || "") : "");
        if (!byPerson[k]) byPerson[k] = { id: b.personId, code, name: b.name,
          village: b.village, district: b.district, services: [], last: "" };
        if (code && !byPerson[k].code) byPerson[k].code = code;
        byPerson[k].services.push(b.service);
        if (String(b.date || "") > byPerson[k].last) byPerson[k].last = b.date;
      });
      const rows = Object.values(byPerson)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      const addForm = canEdit ? `<div class="card"><h2>Add a beneficiary</h2>
        <form id="benAdd">
          <div class="two">
            <label class="field"><span>Name</span><input type="text" name="name" required></label>
            <label class="field"><span>Sakhi ID (if registered)</span>
              <input type="text" name="personCode" placeholder="EP-HR/…"></label>
          </div>
          <div class="two">
            <label class="field"><span>District</span><input type="text" name="district" required></label>
            <label class="field"><span>Village</span><input type="text" name="village"></label>
          </div>
          <div class="two">
            <label class="field"><span>Service provided</span>
              <select name="service">${["Counselling","Legal aid","Rescue","Repatriation","Shelter",
                "Medical support","Education support","Livelihood support",
                "Documentation (ID, ration, Aadhaar)","Cash support",
                "Linkage to government scheme","Sakhi Mandal membership","Other"]
                .map(s => `<option>${esc(s)}</option>`).join("")}</select></label>
            <label class="field"><span>Date</span>
              <input type="date" name="date" value="${today()}" required></label>
          </div>
          <label class="field"><span>Notes (optional)</span>
            <input type="text" name="notes"></label>
          <button class="btn small" type="submit">Add</button>
        </form></div>` : "";

      const table = `<div class="card"><h2>Beneficiaries (${rows.length})</h2>
        <p class="small muted">Everyone this programme has helped, by name and Sakhi ID.</p>
        <div class="tablewrap"><table class="table">
          <tr><th>Name</th><th>Sakhi ID</th><th>Village</th><th>District</th>
              <th style="text-align:center">Services</th><th>Last</th><th></th></tr>
          ${rows.map(r => `<tr>
            <td>${esc(maskName(r.name, r.code))}</td>
            <td class="small">${esc(r.code || "—")}</td>
            <td>${esc(r.village || "")}</td><td>${esc(r.district || "")}</td>
            <td style="text-align:center"><b>${r.services.length}</b></td>
            <td class="small">${fmtD(r.last)}</td>
            <td>${r.id ? `<button class="btn small quiet" data-sk="${r.id}">Open</button>` : ""}</td></tr>`).join("")
            || `<tr><td colspan="7" class="empty">No beneficiary recorded against this programme yet</td></tr>`}
        </table></div></div>`;

      return addForm + table;
    },

    // ── Fellows (NKF only) ─────────────────────────────────
    fellows: () => {
      const byYear = {};
      fellows.forEach(f => {
        const y = f.year || "?";
        (byYear[y] = byYear[y] || []).push(f);
      });
      const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

      const cards = years.map(y => {
        const ff = byYear[y];
        return ff.map(f => `<div class="card" id="fellow-card-${esc(f.id)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
            <div class="tag" style="font-size:0.85rem">Fellowship ${esc(String(y))}</div>
            ${canEdit ? `<button class="btn small quiet" data-editfellow="${esc(f.id)}">Edit</button>` : ""}
          </div>
          <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
            ${f.photoUrl
              ? `<img src="${esc(f.photoUrl)}" alt="${esc(f.name)}"
                   style="width:88px;height:88px;border-radius:50%;object-fit:cover;flex-shrink:0;border:3px solid var(--accent,#1a6b3c)">`
              : `<div style="width:88px;height:88px;border-radius:50%;background:var(--surface2,#e8f5e9);
                   display:flex;align-items:center;justify-content:center;font-size:2.5rem;flex-shrink:0">🎓</div>`}
            <div class="grow">
              <div style="font-size:1.2rem;font-weight:700;margin-bottom:2px">${esc(f.name)}</div>
              ${f.institution ? `<div class="small muted">${esc(f.institution)}${f.fieldOfStudy ? " · " + esc(f.fieldOfStudy) : ""}</div>` : ""}
              ${f.district    ? `<div class="small muted">${esc(f.district)}${f.state ? ", " + esc(f.state) : ""}</div>` : ""}
              ${f.scholarshipAmount ? `<div class="small" style="margin-top:6px">Fellowship: <b>${inr(f.scholarshipAmount)}</b></div>` : ""}
              ${f.selectionNote ? `<div style="margin-top:10px;font-size:0.9rem;line-height:1.6;color:var(--text,#222)">${esc(f.selectionNote)}</div>` : ""}
            </div>
          </div>
        </div>`).join("");
      }).join("") || `<div class="card"><div class="empty">No fellows added yet. Add the first fellow below.</div></div>`;

      const addForm = canEdit ? `<div class="card"><h2>Add a fellow</h2>
        <p class="small muted">Each year, the NK Fellowship is awarded to one person. Add her record here. She can be given app access later to post her own updates.</p>
        <form id="fellowAdd">
          <div class="two">
            <label class="field"><span>Name</span><input type="text" name="name" required></label>
            <label class="field"><span>Year</span>
              <input type="number" name="year" value="${new Date().getFullYear()}" required min="2000" max="2100"></label>
          </div>
          <div class="two">
            <label class="field"><span>Institution / School</span><input type="text" name="institution"></label>
            <label class="field"><span>Field of study</span><input type="text" name="fieldOfStudy"></label>
          </div>
          <div class="two">
            <label class="field"><span>District</span><input type="text" name="district"></label>
            <label class="field"><span>State</span>
              <select name="state" data-geo="state">${stateOptions("Haryana")}</select></label>
          </div>
          <div class="two">
            <label class="field"><span>Fellowship amount (₹)</span>
              <input type="number" name="scholarshipAmount" inputmode="decimal" placeholder="0"></label>
            <label class="field"><span>Photo</span>
              <input type="file" name="photo" accept="image/*"></label>
          </div>
          <label class="field"><span>Why she was selected</span>
            <textarea name="selectionNote" rows="3"></textarea></label>
          <button class="btn small" type="submit">Save fellow</button>
        </form></div>` : "";

      return cards + addForm;
    },

    // ── Team ────────────────────────────────────────────────
    team: () => {
      const currentTeam = p.team || [];
      // Leader dropdown: salaried staff only
      const activeStaff = (state.users || []).filter(u => u.active && isStaff(u));
      // Checkbox list: everyone who works — includes field_staff+volunteer and pure volunteers
      // Exclude board-only / compliance-only accounts who have no programme role
      const teamCandidates = (state.users || [])
        .filter(u => u.active && u.name && u.id &&
          !(u.roles || []).every(r => ['board','dso','observer','compliance_head'].includes(r)))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return `<div class="card"><h2>Team assigned to this programme</h2>
        <p class="small muted">Everyone on this list can see the programme in their nav and their work counts toward it. Includes staff, field workers, and community leaders.</p>
        ${canEdit ? `<form id="progTeam">
          ${has("program_officer","super_admin","founder","director_acf")
            ? `<label class="field" style="margin-bottom:8px"><span>Programme lead</span>
               <select name="leadId"><option value="">— unassigned —</option>
               ${activeStaff.map(u => `<option value="${u.id}" ${u.id === p.leadId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
               </select></label>` : ""}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:4px;margin-bottom:10px">
            ${teamCandidates.map(u =>
              `<label class="check"><input type="checkbox" name="team" value="${u.id}"
                ${currentTeam.includes(u.id) ? "checked" : ""}> ${esc(u.name)}
                <span class="small muted" style="display:block;margin-left:20px">${esc((u.roles||[]).join(', '))}</span>
              </label>`).join("")}
          </div>
          <button class="btn small" type="submit">Save team & lead</button>
        </form>`
        : `<div class="list">${currentTeam.map(uid =>
            `<div class="item"><div class="grow"><div class="t">${esc(userName(uid))}</div></div></div>`
          ).join("") || `<div class="empty">No one assigned yet</div>`}</div>`}
      </div>`;
    },

    // ── Updates (with verification workflow) ───────────────
    updates: () => {
      // Who can post and have their update go straight to the record (no pending queue)
      // Includes programme leads and coordinators — they are trusted to report correctly
      const canAutoApprove = has("super_admin","admin","director_acf","program_officer",
        "program_coord","program_lead","founder") || isManager();
      // Who can approve, edit, or REMOVE any update — including a manager's own post
      // Deliberately narrower: only Founder, Director ACF, and Program Officer
      // Programme leads cannot moderate (they can still post, but not edit others' work)
      const canModerate = has("super_admin","founder","director_acf","program_officer","admin");

      const renderUpdate = u => {
        const isPending = u.status === 'pending';
        const isRemoved = u.status === 'removed';
        const edits = u.editHistory || [];
        const borderStyle = isPending
          ? 'border-left:3px solid #f59e0b'
          : isRemoved ? 'border-left:3px solid #ef4444;opacity:0.7' : '';
        return `<div class="item" id="upd-${u.id}" style="${borderStyle}">
          <div class="grow">
            <div class="t">
              ${esc(u.kind || "Update")} · ${fmtD(u.date)}${u.state ? " · " + esc(u.state) : ""}
              ${isPending ? `<span class="tag warn" style="margin-left:6px;font-size:0.75rem">Pending</span>` : ""}
              ${isRemoved ? `<span class="tag bad" style="margin-left:6px;font-size:0.75rem">Removed</span>` : ""}
              ${edits.length ? `<span class="tag" style="margin-left:6px;font-size:0.75rem">Edited</span>` : ""}
            </div>
            ${!isRemoved ? `<div class="s">${esc(u.text)}</div>` :
              `<div class="s muted">[Removed — ${esc(u.removedReason || "no reason given")}]</div>`}
            ${u.fileUrl && !isRemoved ? `<div class="s" style="margin-top:4px">
              <a href="${esc(u.fileUrl)}" target="_blank" rel="noopener" class="btn small quiet">
                📎 ${esc(u.fileName || "Attachment")}</a></div>` : ""}
            <div class="s muted">${esc(userName(u.by))}${u.reached ? " · " + u.reached + " women reached" : ""}
              ${u.verifiedBy ? ` · approved by ${esc(userName(u.verifiedBy))}` : ""}
              ${isRemoved ? ` · removed by ${esc(userName(u.removedBy))}` : ""}
            </div>
            ${edits.length ? `<div class="s muted" style="margin-top:2px;font-size:0.78rem">
              Last edit by ${esc(userName(edits[edits.length-1].by))} — ${esc(edits[edits.length-1].reason || "no reason given")}</div>` : ""}
          </div>
          ${canModerate && !isRemoved ? `
            <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;margin-left:8px">
              ${isPending ? `<button class="btn small" data-upd-approve="${u.id}">Approve</button>` : ""}
              <button class="btn small quiet" data-upd-edit="${u.id}">Edit</button>
              <button class="btn small quiet" style="color:#c00" data-upd-remove="${u.id}">Remove</button>
            </div>` : ""}
        </div>`;
      };

      const pending  = recent.filter(u => u.status === 'pending');
      const approved = recent.filter(u => !u.status || u.status === 'approved');
      const removed  = canModerate ? recent.filter(u => u.status === 'removed') : [];

      return `
        ${(canEdit || has("fellow")) ? `<div class="card"><h2>Add an update</h2>
          <p class="small muted">What happened, what changed, what is stuck.${
            !canAutoApprove ? " Your update will appear after the line manager approves it." : ""}</p>
          <form id="pu">
            <div class="two">
              <label class="field"><span>Date</span>
                <input type="date" name="date" value="${today()}" required></label>
              <label class="field"><span>Kind</span>
                <select name="kind">${["Progress","Meeting","Milestone","Problem","Change of plan","Visit","Learning"]
                  .map(x => `<option>${x}</option>`).join("")}</select></label>
            </div>
            <div class="two">
              <label class="field"><span>State</span>
                <select name="state" data-geo="state">${stateOptions((myStates()||["Haryana"])[0])}</select></label>
              <label class="field"><span>Women reached (if counted)</span>
                <input type="number" step="any" inputmode="decimal" name="reached"></label>
            </div>
            <label class="field"><span>The update</span>
              <textarea name="text" rows="4" required></textarea></label>
            <label class="field"><span>Attach a photo or PDF (optional)</span>
              <input type="file" name="attachment" accept="image/*,.pdf,.doc,.docx"></label>
            <button class="btn small" type="submit">Save</button>
          </form></div>` : ""}
        ${canModerate && pending.length ? `
          <div class="card" style="border-top:3px solid #f59e0b">
            <h2>Pending verification (${pending.length})</h2>
            <p class="small muted">These need your approval before they appear in the main record.</p>
            <div class="list">${pending.map(renderUpdate).join("")}</div>
          </div>` : ""}
        <div class="card"><h2>What has happened (${approved.length})</h2>
          <div class="list">
            ${approved.map(renderUpdate).join("") || `<div class="empty">No updates yet</div>`}
          </div></div>
        ${removed.length ? `<div class="card">
          <h2 style="color:#888">Removed updates (${removed.length})</h2>
          <div class="list">${removed.map(renderUpdate).join("")}</div>
        </div>` : ""}`;
    },

    // ── Resources ──────────────────────────────────────────
    resources: () => {
      const resSorted = [...resources].sort((a, b) =>
        (b.addedAt?.seconds || 0) - (a.addedAt?.seconds || 0));
      const uploadForm = has("super_admin","founder") ? `<div class="card"><h2>Add a resource</h2>
        <p class="small muted">Training guides, field manuals, templates, referral directories — anything the team needs to implement this programme. Visible to everyone on the team.</p>
        <form id="resAdd">
          <label class="field"><span>Name</span>
            <input type="text" name="name" required placeholder="e.g. Field Worker Handbook 2026"></label>
          <label class="field"><span>What it is for (optional)</span>
            <input type="text" name="description" placeholder="Who needs this and when to use it"></label>
          <label class="field"><span>File (PDF, Word, image or other)</span>
            <input type="file" name="file" required></label>
          <button class="btn small" type="submit">Upload</button>
        </form></div>` : "";
      const list = resSorted.length
        ? `<div class="card"><h2>Resources (${resSorted.length})</h2>
           <div class="list">${resSorted.map(fmtRes).join("")}</div></div>`
        : `<div class="card"><div class="empty">No resources uploaded yet.</div></div>`;
      return uploadForm + list;
    },

    // ── Settings (canEdit only) — metadata edit + resource management ──
    settings: () => {
      const resSorted = [...resources].sort((a, b) =>
        (b.addedAt?.seconds || 0) - (a.addedAt?.seconds || 0));
      return `
        <div class="card"><h2>Edit programme details</h2>
          <p class="small muted">These fields appear on the programme overview and reports.</p>
          <form id="progSettings">
            <label class="field"><span>What it is for</span>
              <textarea name="aim" rows="3">${esc(p.aim || "")}</textarea></label>
            <div class="two">
              <label class="field"><span>States it runs in</span>
                <input type="text" name="statesText" value="${esc(p.statesText || "")}"
                  placeholder="e.g. Haryana, Assam"></label>
              <label class="field"><span>Status</span>
                <select name="status">
                  ${["Running","Paused","Closed"].map(s =>
                    `<option${s === (p.status||"Running") ? " selected" : ""}>${esc(s)}</option>`).join("")}
                </select></label>
            </div>
            <button class="btn small" type="submit">Save details</button>
          </form>
        </div>

        <div class="card"><h2>Resources</h2>
          <p class="small muted">Training guides, field manuals, templates and referral directories for the team. Visible to everyone on the Resources tab.</p>
          ${has("super_admin","founder") ? `<form id="resAdd">
            <label class="field"><span>Name</span>
              <input type="text" name="name" required placeholder="e.g. Field Worker Handbook 2026"></label>
            <label class="field"><span>What it is for (optional)</span>
              <input type="text" name="description" placeholder="Who needs this and when to use it"></label>
            <label class="field"><span>File (PDF, Word, image or other)</span>
              <input type="file" name="file" required></label>
            <button class="btn small" type="submit">Upload</button>
          </form>` : `<p class="small muted">Contact the Founder &amp; General Secretary to upload resources.</p>`}
          ${resSorted.length ? `<div class="list" style="margin-top:12px">
            ${resSorted.map(r => {
              const when = r.addedAt?.seconds
                ? new Date(r.addedAt.seconds * 1000).toISOString().slice(0,10) : "";
              return `<div class="item" style="align-items:center">
                <div style="font-size:1.3rem;margin-right:10px;flex-shrink:0">${fileIcon(r.type)}</div>
                <div class="grow">
                  <div class="t">${esc(r.name)}</div>
                  ${r.description ? `<div class="s">${esc(r.description)}</div>` : ""}
                  <div class="s muted">Added ${fmtD(when)} · ${esc(userName(r.addedBy))}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <a href="${esc(r.fileUrl||"#")}" target="_blank" rel="noopener" class="btn small quiet">Open</a>
                  <button class="btn small quiet" style="color:#c00" data-res-delete="${r.id}">Remove</button>
                </div>
              </div>`;
            }).join("")}
          </div>` : `<p class="small muted" style="margin-top:8px">No resources yet — upload the first one above.</p>`}
        </div>`;
    }
  };

  // ── Render shell + active tab ───────────────────────────
  html(`<div class="card">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0">${esc(p.name)}${p.code ? ` <span class="tag">${esc(p.code)}</span>` : ""}</h2>
        <p class="small muted" style="margin:3px 0">${esc(p.statesText || "")}${p.status ? " · " + esc(p.status) : ""}</p>
      </div>
      <button class="btn small quiet" onclick="go('programmes')">All programmes</button>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px">
      ${TABS.map(([k, l]) =>
        `<button class="btn small ${k === tab ? "" : "quiet"}" data-pt="${k}">${l}</button>`).join("")}
    </div></div>
    ${(body[tab] || body.overview)()}`);

  // ── Wire tab buttons ────────────────────────────────────
  $("content").querySelectorAll("[data-pt]").forEach(b =>
    b.onclick = () => routes.programme(id, b.dataset.pt));
  $("content").querySelectorAll("[data-g]").forEach(b =>
    b.onclick = () => { state.groupId = b.dataset.g; go("group"); });
  $("content").querySelectorAll("[data-sk]").forEach(b =>
    b.onclick = () => { state.personId = b.dataset.sk; go("person"); });

  // ── Team form ────────────────────────────────────────────
  if ($("progTeam")) $("progTeam").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const team      = fd.getAll("team");
    const newLeadId = fd.get("leadId") || p.leadId || null;
    const leadU     = newLeadId ? (state.users||[]).find(u => u.id === newLeadId) : null;
    await db.collection("programmes").doc(id).update({
      team, leadId: newLeadId || null,
      ...(leadU ? { leadName: leadU.name } : {}) });
    await loadMasters();
    audit("team", "programmes", id, team.length + " members");
    toast("Team & lead saved");
    routes.programme(id, "team");
  };

  // ── Update form (with attachment) ────────────────────────
  if ($("pu")) $("pu").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const fd   = new FormData(e.target);
      const autoApprove = has("super_admin","admin","director_acf","program_officer",
        "program_coord","founder") || isManager();
      const data = {
        date: fd.get("date"), kind: fd.get("kind"), state: fd.get("state"),
        text: fd.get("text"),
        reached: fd.get("reached") ? Number(fd.get("reached")) : null,
        status: autoApprove ? "approved" : "pending",
        programmeId: id, programmeName: p.name, by: state.user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const file = fd.get("attachment");
      if (file && file.size) {
        try {
          const res  = await uploadToDrive(file, "program", file.name);
          data.fileUrl  = res.webViewLink || res.url || res || "";
          data.fileName = file.name;
        } catch (fe) {
          toast("File could not be uploaded — update saved without it");
        }
      }
      await db.collection("programmeUpdates").add(data);
      audit("create", "programmeUpdates", null, p.name);
      toast("Saved");
      routes.programme(id, "updates");
    } catch (err) {
      btn.disabled = false; btn.textContent = "Save";
      toast("Could not save — " + (err.code === "permission-denied" ? "speak to admin" : err.message));
    }
  };

  // ── Add beneficiary form ─────────────────────────────────
  if ($("benAdd")) $("benAdd").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const d = Object.fromEntries(new FormData(e.target));
      await db.collection("benefits").add({
        ...d, programmeId: id, programmeName: p.name,
        recordedBy: state.user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("create", "benefits", null, d.name + " · " + p.name);
      toast("Beneficiary added");
      routes.programme(id, "beneficiaries");
    } catch (err) {
      btn.disabled = false; btn.textContent = "Add";
      toast("Could not save — " + err.message);
    }
  };

  // ── Add fellow form (NKF) ────────────────────────────────
  if ($("fellowAdd")) $("fellowAdd").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const fd = new FormData(e.target);
      const data = {
        name:             fd.get("name"),
        year:             Number(fd.get("year")),
        institution:      fd.get("institution") || null,
        fieldOfStudy:     fd.get("fieldOfStudy") || null,
        district:         fd.get("district")  || null,
        state:            fd.get("state")     || null,
        scholarshipAmount: fd.get("scholarshipAmount") ? Number(fd.get("scholarshipAmount")) : null,
        selectionNote:    fd.get("selectionNote") || null,
        addedBy: state.user.uid,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const photo = fd.get("photo");
      if (photo && photo.size) {
        try {
          const res     = await uploadToDrive(photo, "program", photo.name);
          data.photoUrl = res.webViewLink || res.url || res || "";
        } catch {}
      }
      await db.collection("programmes").doc(id).collection("fellows").add(data);
      audit("create", "fellows", id, data.name + " " + data.year);
      toast("Fellow saved");
      routes.programme(id, "fellows");
    } catch (err) {
      btn.disabled = false; btn.textContent = "Save fellow";
      toast("Could not save — " + err.message);
    }
  };

  // ── Approve update ──────────────────────────────────────
  $("content").querySelectorAll("[data-upd-approve]").forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Approving…";
      const updId = btn.dataset.updApprove;
      try {
        await db.collection("programmeUpdates").doc(updId).update({
          status: "approved",
          verifiedBy: state.user.uid,
          verifiedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        audit("approve", "programmeUpdates", updId, p.name);
        toast("Update approved");
        routes.programme(id, "updates");
      } catch(e) { btn.disabled = false; btn.textContent = "Approve"; toast("Error: " + e.message); }
    };
  });

  // ── Edit update (with reason) ────────────────────────────
  $("content").querySelectorAll("[data-upd-edit]").forEach(btn => {
    btn.onclick = async () => {
      const updId = btn.dataset.updEdit;
      // Find current text from the DOM
      const item = document.getElementById("upd-" + updId);
      const currentText = item ? item.querySelector(".s")?.textContent || "" : "";
      // Replace the item with an inline edit form
      if (item) {
        item.innerHTML = `
          <div class="grow">
            <label class="field" style="margin-bottom:6px"><span>Updated text</span>
              <textarea id="edit-text-${updId}" rows="4" style="width:100%">${esc(currentText)}</textarea></label>
            <label class="field"><span>Reason for edit</span>
              <input id="edit-reason-${updId}" type="text" placeholder="e.g. Factual correction, typo fix…" style="width:100%"></label>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn small" id="edit-save-${updId}">Save edit</button>
              <button class="btn small quiet" onclick="routes.programme('${id}','updates')">Cancel</button>
            </div>
          </div>`;
        document.getElementById("edit-save-" + updId).onclick = async () => {
          const newText = document.getElementById("edit-text-" + updId).value.trim();
          const reason  = document.getElementById("edit-reason-" + updId).value.trim();
          if (!newText) { toast("Text cannot be empty"); return; }
          if (!reason)  { toast("Please give a reason for the edit"); return; }
          try {
            // Fetch current doc to preserve old text in history
            const snap = await db.collection("programmeUpdates").doc(updId).get();
            const oldText = snap.data().text || "";
            await db.collection("programmeUpdates").doc(updId).update({
              text: newText,
              status: "approved",
              editHistory: firebase.firestore.FieldValue.arrayUnion({
                by: state.user.uid,
                reason,
                oldText,
                editedAt: new Date().toISOString()
              })
            });
            audit("edit", "programmeUpdates", updId, reason);
            toast("Update edited");
            routes.programme(id, "updates");
          } catch(e) { toast("Error: " + e.message); }
        };
      }
    };
  });

  // ── Remove update (soft delete with reason) ──────────────
  $("content").querySelectorAll("[data-upd-remove]").forEach(btn => {
    btn.onclick = async () => {
      const updId = btn.dataset.updRemove;
      const reason = window.prompt("Reason for removing this update:");
      if (reason === null) return; // cancelled
      if (!reason.trim()) { toast("Please give a reason"); return; }
      try {
        await db.collection("programmeUpdates").doc(updId).update({
          status: "removed",
          removedBy: state.user.uid,
          removedReason: reason.trim(),
          removedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        audit("remove", "programmeUpdates", updId, reason);
        toast("Update removed");
        routes.programme(id, "updates");
      } catch(e) { toast("Error: " + e.message); }
    };
  });

  // ── Settings — save programme details ───────────────────
  if ($("progSettings")) $("progSettings").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const fd = new FormData(e.target);
      await db.collection("programmes").doc(id).update({
        aim:        fd.get("aim")        || null,
        statesText: fd.get("statesText") || null,
        status:     fd.get("status")     || "Running"
      });
      await loadMasters();
      audit("update", "programmes", id, "settings updated");
      toast("Programme details saved");
      routes.programme(id, "settings");
    } catch(err) {
      btn.disabled = false; btn.textContent = "Save details";
      toast("Could not save — " + err.message);
    }
  };

  // ── Resource delete (from Settings tab) ─────────────────
  $("content").querySelectorAll("[data-res-delete]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Remove this resource? The file link will stop working.")) return;
      btn.disabled = true; btn.textContent = "Removing…";
      try {
        await db.collection("programmes").doc(id).collection("resources").doc(btn.dataset.resDelete).delete();
        audit("delete", "resources", btn.dataset.resDelete, p.name);
        toast("Resource removed");
        routes.programme(id, "settings");
      } catch(err) { btn.disabled = false; btn.textContent = "Remove"; toast("Error: " + err.message); }
    };
  });

  // ── Upload resource form ─────────────────────────────────
  if ($("resAdd")) $("resAdd").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Uploading…";
    try {
      const fd   = new FormData(e.target);
      const file = fd.get("file");
      if (!file || !file.size) {
        toast("Please choose a file");
        btn.disabled = false; btn.textContent = "Upload";
        return;
      }
      const res     = await uploadToDrive(file, "program", file.name);
      const fileUrl = res.webViewLink || res.url || res || "";
      const ext     = file.name.split(".").pop().toLowerCase();
      const type    = ["pdf"].includes(ext) ? "pdf"
        : ["jpg","jpeg","png","gif","webp"].includes(ext) ? "image"
        : ["doc","docx","odt"].includes(ext) ? "doc"
        : "other";
      await db.collection("programmes").doc(id).collection("resources").add({
        name:        fd.get("name"),
        description: fd.get("description") || null,
        fileUrl, fileName: file.name, type,
        addedBy: state.user.uid,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("create", "resources", id, fd.get("name"));
      toast("Resource uploaded");
      routes.programme(id, "resources");
    } catch (err) {
      btn.disabled = false; btn.textContent = "Upload";
      toast("Upload failed — " + err.message);
    }
  };
};
