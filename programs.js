/* ================= PROGRAMS: persons, cases, benefits ================= */
// Search token generator — produces lowercase word array for array-contains-any search
function tokens(d) {
  var words = new Set();
  ['firstName','lastName','phone','state','district','block','presentAddress','nativeAddress','guardianFirst','guardianLast','code'].forEach(function(k){
    if(d&&d[k]) String(d[k]).toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g,' ').split(/\s+/).forEach(function(w){ if(w.length>=2) words.add(w); });
  });
  return Array.from(words);
}
const CATEGORIES = ["Sakhi of trafficking", "At risk", "Family member of Sakhi", "Community member", "Migrant worker", "Child"];
const CASE_TYPES = ["Bride trafficking", "Child marriage", "Labour trafficking", "Missing person", "Domestic violence", "Legal aid", "Repatriation", "Other"];
const SERVICES = ["Counselling", "Legal aid", "Rescue", "Repatriation", "Shelter", "Medical support", "Education support", "Livelihood support", "Documentation (ID, ration, Aadhaar)", "Cash support", "Linkage to government scheme", "Sakhi Mandal membership", "Other"];
/* Case access is limited to the states a person works in.
   Programme leadership and the App Super Admin see every state. */
const seesAllStates = () => has("super_admin", "admin", "program_officer", "program_coord", "board", "compliance_head");
const myStates = () => {
  if (seesAllStates()) return null;                    // null = no limit
  const set = new Set();
  const off = state.offices.find(o => o.id === state.me.officeId); if (off && off.state) set.add(off.state);
  (state.me.states || []).forEach(s => set.add(s));    // extra states granted by the office
  return [...set];
};
/* Who may open a Sakhi's file. Her name, telephone number and present address are how
   a person can be found, so the file opens only for those actually working on it —
   not for everyone who happens to hold a programme role. */
/* Who may add or change a Sakhi's record, and who may run the case registers. */
const isProgram = () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff");
const canEditPersons = () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff");
const canManageCases = () => has("super_admin", "program_officer", "program_coord");
const canAssignCases = () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead");
/* An observer reads the work without reading the women: no names, only case numbers. */
const maskName = (n, code) => isObserver() ? (code ? String(code).split("/").pop() : "Sakhi") : n;
/** Options for a dropdown, with one marked as chosen. */
const opt = (list, chosen) => ["", ...list].map(v =>
  `<option value="${esc(v)}" ${v === (chosen || "") ? "selected" : ""}>${esc(v || "—")}</option>`).join("");
/** The people who can be given a case: programme and field staff, by name. */
const caseWorkerChoices = () => (state.users || []).filter(u => u.active && isStaff(u)
  && (u.roles || []).some(r => ["field_staff", "program_lead", "program_coord", "program_officer", "admin"].includes(r)))
  .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

/* Words on the Sakhi screens, in the language the person has chosen. */
const P_WORDS = {
  en: { programs: "Programmes", persons: "Sakhis", register: "Register a Sakhi",
        search: "Search by name, phone or village", found: "Already registered — open instead of registering again",
        overview: "Overview", cases: "Cases", benefits: "Support given", summary: "Summary",
        category: "Category", caseType: "Type of case", district: "District", date: "Date",
        service: "Type of support", value: "Value ₹", notes: "Notes", save: "Save", export: "Export",
        openCase: "Open a case", noOpenCase: "No open case — open one first", closeCase: "Close the case",
        opened: "Opened", assigned: "Case worker", funding: "Funded by", split: "Share (₹)",
        addProject: "Add another project", recordBenefit: "Record support", outcome: "Outcome" },
  hi: { programs: "कार्यक्रम", persons: "सखियाँ", register: "सखी दर्ज करें",
        search: "नाम, फ़ोन या गाँव से खोजें", overview: "सारांश", cases: "मामले",
        benefits: "दी गई सहायता", district: "ज़िला", date: "दिनांक", save: "सहेजें" }
};
const pt = k => (P_WORDS[state.lang] && P_WORDS[state.lang][k]) || P_WORDS.en[k] || k;

/** Text for searching: lower case, no punctuation, so "Jelatan  Nessa" matches "jelatan nessa". */
const norm = s => String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

/** A quiet line saying which states this person's access covers. */
const stateNote = () => {
  const st = myStates();
  if (!st) return "";
  return st.length
    ? `<p class="small muted">You see cases in ${st.map(esc).join(", ")}, and any case given to you.</p>`
    : `<p class="small muted">No state is set against your office, so you see only the cases given to you. Ask Administration to set it.</p>`;
};

const canOpenCase = p => {
  const uid = state.user.uid;
  if (p.caseWorkerId === uid || (p.assignedTo || []).includes(uid)) return true;         // hers to carry
  if (has("counsellor")) {
    // Counsellors see cases in their assigned offices OR directly assigned to them
    const myOffices = state.me?.officeIds || [state.me?.officeId].filter(Boolean);
    return myOffices.includes(p.officeId) || p.counsellorId === uid;
  }
  if (p.caseWorkerPostId && state.me.postId && p.caseWorkerPostId === state.me.postId) return true;
  if (p.salahSakhiId === uid) return true;                                               // her own Salah Sakhi
  if (isVolunteerOnly()) return false;
  if (has("super_admin", "program_officer")) return true;                                // programme leadership — always all-access
  if (has("program_coord", "program_lead") && state.me.officeId === "1Eua9iYpocrxhUi0nTEo") return true; // Delhi leads/coords see all
  /* The office holding the case. A worker in Yamunanagar has no business in a Dhubri
     file, however much a state-wide rule once allowed it. */
  const sameOffice = p.officeId && state.me.officeId && p.officeId === state.me.officeId;
  const sameDistrict = p.district && state.me.district
    && String(p.district).trim().toLowerCase() === String(state.me.district).trim().toLowerCase();
  if (sameOffice || sameDistrict) return true;
  /* Until every case carries an office, a programme or field lead keeps the state-wide
     view — narrowed from everybody to those who lead. */
  const st = typeof myStates === "function" ? myStates() : null;
  if (has("program_lead", "admin") && (!st || st.includes(p.state))) return true;
  return false;
};

routes.persons = async () => {
  setTitle(pt("persons"));
  const canBrowse = seesAllStates() || (state.me.states||[]).length > 0;
  const myStates = seesAllStates() ? null : (state.me.states||[]).filter(Boolean);

  html(`<div class="card">
    <div class="tabs" style="margin-bottom:12px">
      <button class="tab active" id="tabSearch">🔍 Search</button>
      ${canBrowse ? `<button class="tab" id="tabBrowse">📋 Browse by district</button>` : ""}
      ${canEditPersons() ? `<button class="btn small" style="margin-left:auto" id="newP">${pt("register")}</button>` : ""}
    </div>
    <div id="panelSearch">
      <label class="field"><span>${pt("search")}</span><input id="q" autofocus></label>
      ${stateNote()}
    </div>
    ${canBrowse ? `<div id="panelBrowse" class="hidden">
      <div class="two">
        <label class="field"><span>State</span><select id="browseState">
          ${myStates ? myStates.map(s=>`<option>${esc(s)}</option>`).join("") : ["Assam","Bihar","Delhi","Haryana","Himachal Pradesh","Jharkhand","Punjab","Rajasthan","Uttar Pradesh","West Bengal"].map(s=>`<option>${s}</option>`).join("")}
        </select></label>
        <label class="field"><span>District</span><select id="browseDist"><option value="">— select —</option></select></label>
      </div>
      <div id="browseCount" style="color:var(--dim);font-size:13px;margin-bottom:8px"></div>
    </div>` : ""}
  </div>
  <div class="card"><div class="list" id="res"></div></div>`);

  const render = (list, msg) => {
    $("res").innerHTML = list.length ? list.map(p => personRow(p)).join("") : `<div class="empty">${msg||t("nothing")}</div>`;
    $("res").querySelectorAll("[data-open]").forEach(b => b.onclick = () => routes.person(b.dataset.open));
  };

  // --- Search tab ---
  $("res").innerHTML = `<div class="empty">Search for the woman you are working with — her name, her number, her village or her Sakhi ID.<br><span class="small">Nothing is listed here until you do.</span></div>`;
  let timer; $("q").oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = norm($("q").value);
    if (q.length < 3) { $("res").innerHTML = `<div class="empty">${q.length ? "Keep typing — three letters at least." : "Search for the woman you are working with."}</div>`; return; }
    const hits = (await searchPersons(q)).filter(canOpenCase);
    if (hits.length) render(hits);
    else $("res").innerHTML = `<div class="empty">Nothing found that you can open. If she is on another team's list, ask the Program Officer.</div>`;
  }, 300); };

  // --- Browse tab ---
  if (canBrowse && $("tabBrowse")) {
    const switchTab = tab => {
      $("panelSearch").classList.toggle("hidden", tab !== "search");
      $("panelBrowse").classList.toggle("hidden", tab !== "browse");
      $("tabSearch").classList.toggle("active", tab === "search");
      $("tabBrowse").classList.toggle("active", tab === "browse");
      if (tab === "search") { $("res").innerHTML = `<div class="empty">Search for the woman you are working with.</div>`; $("q").focus(); }
    };
    $("tabSearch").onclick = () => switchTab("search");
    $("tabBrowse").onclick = () => switchTab("browse");

    const loadDistricts = () => {
      const st = $("browseState").value;
      const dists = districtsOf(st) || [];
      $("browseDist").innerHTML = `<option value="">— select —</option>` + dists.map(d=>`<option>${esc(d)}</option>`).join("");
      $("browseCount").textContent = "";
      $("res").innerHTML = `<div class="empty">Select a district to see its Sakhis.</div>`;
    };

    const loadDistrict = async () => {
      const st = $("browseState").value;
      const di = $("browseDist").value;
      if (!di) return;
      $("browseCount").textContent = "Loading…";
      $("res").innerHTML = `<div class="empty">Loading…</div>`;
      try {
        const snap = await db.collection("persons").where("state","==",st).where("district","==",di).get();
        const list = snap.docs.map(d=>({id:d.id,...d.data()})).filter(canOpenCase).sort((a,b)=>(b.registeredOn||"").localeCompare(a.registeredOn||""));
        $("browseCount").textContent = `${list.length} Sakhi${list.length!==1?"s":""} registered in ${di}, ${st}`;
        render(list, `No Sakhis registered in ${di} yet.`);
      } catch(e) { $("browseCount").textContent = ""; $("res").innerHTML = `<div class="empty">Could not load — ${e.message||e.code}</div>`; }
    };

    $("browseState").onchange = loadDistricts;
    $("browseDist").onchange = loadDistrict;
    loadDistricts();
  }

  if ($("newP")) $("newP").onclick = () => routes.personNew();
};
async function searchPersons(q) {
  const words = q.split(" ").filter(w => w.length > 1).slice(0, 3); if (!words.length) return [];
  const snap = await (async()=>{
    // Try direct code lookup first
    if(q.length>5&&/^EP-/i.test(q.trim())){
      const cs=await db.collection("persons").where("code","==",q.trim().toUpperCase()).limit(1).get().catch(()=>({docs:[]}));
      if(cs.docs&&cs.docs.length) return cs;
    }
    return db.collection("persons").where("tokens","array-contains-any",words).limit(40).get();
  })();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => score(b, words) - score(a, words));
}
const score = (p, words) => words.filter(w => norm(p.name).includes(w)).length * 2 + words.filter(w => (p.tokens || []).includes(w)).length;
const personRow = p => `<div class="item"><div class="grow"><div class="t">${esc(maskName(p.name, p.code))} <span class="tag">${esc(p.code || "")}</span></div>
  <div class="s">${esc(p.category || "")} · ${[p.village, p.block, p.district, p.state].filter(Boolean).map(esc).join(", ")}${p.age ? ` · ${p.age} yrs` : ""}</div></div>
  <button class="btn small quiet" data-open="${p.id}">Open</button></div>`;

/* ---- Register ---- */
const SLAVERY_TYPES = ["Trafficked for marriage", "Sold into brothel", "Forced marriage", "Physical violence", "Labour trafficking", "Child marriage", "Other"];
const ST_CODE = { Haryana: "HR", Assam: "AS", Bihar: "BR", Delhi: "DL", "Himachal Pradesh": "HP", "Uttar Pradesh": "UP", Rajasthan: "RJ", Punjab: "PB", "West Bengal": "WB", Jharkhand: "JH", Other: "XX" };
routes.personNew = async (prefill = {}) => {
  setTitle("Sakhi Profile — register");
  html(`<div class="card"><p class="small muted">Same intake as the Sakhi Profile form. Sakhi ID is generated on save as EP-&lt;state&gt;/&lt;district&gt;/&lt;block&gt;/&lt;serial&gt;-&lt;year&gt; — e.g. EP-HR/YN/NA/187-2023.</p><form id="pf">
    <div class="two">${(() => {
      const myStates = seesAllStates() ? null : (state.me.states||[]).filter(Boolean);
      const locked = myStates && myStates.length === 1 ? myStates[0] : null;
      const defState = locked || prefill.state || (myStates&&myStates[0]) || "Haryana";
      const stSel = locked
        ? `<div class="field"><span>State</span><div style="padding:9px 0;font-weight:500">${esc(locked)}</div><input type="hidden" name="state" value="${esc(locked)}"></div>`
        : `<label class="field"><span>State</span><select name="state">${myStates ? myStates.map(s=>`<option${s===defState?" selected":""}>${esc(s)}</option>`).join("") : stateOptions(defState)}</select></label>`;
      const diSel = `<label class="field"><span>District</span><select name="district">${districtOptions(defState)}</select></label>`;
      return stSel + diSel;
    })()}</div>
    <div class="two"><label class="field"><span>Cluster / block</span><input name="block"></label><label class="field"><span>Date of registration</span><input type="date" name="registeredOn" value="${today()}"></label></div>
    <div class="two"><label class="field"><span>Name of the Sakhi — first</span><input name="firstName" required value="${esc(prefill.name || "")}"></label><label class="field"><span>Last name</span><input name="lastName"></label></div>
    <div class="two"><label class="field"><span>Type of slavery they have gone through</span><select name="slaveryType">${opt(SLAVERY_TYPES)}</select></label><label class="field"><span>Phone number</span><input name="phone" inputmode="tel"></label></div>
    <div class="two"><label class="field"><span>Gender</span><select name="sex">${opt(["Female", "Male", "Other"])}</select></label><label class="field"><span>Marital status</span><select name="marital">${opt(["Married", "Divorced", "Single", "Other"])}</select></label></div>
    <label class="field"><span>Present address</span><textarea name="presentAddress"></textarea></label>
    <label class="field"><span>Native address</span><textarea name="nativeAddress"></textarea></label>
    <div class="two"><label class="field"><span>Do you have children?</span><select name="children">${opt(["Yes", "No"])}</select></label><label class="field"><span>Current status</span><select name="workStatus">${opt(["Able to work but not working", "Current worker", "Former worker"])}</select></label></div>
    <div class="two"><label class="field"><span>Weight (kg)</span><input name="weight" type="number" inputmode="numeric"></label><label class="field"><span>Height (cm)</span><input name="height" type="number" inputmode="numeric"></label></div>
    <div class="two"><label class="field"><span>Guardian — first name</span><input name="guardianFirst"></label><label class="field"><span>Guardian — last name</span><input name="guardianLast"></label></div>
    <div class="two"><label class="field"><span>Since when are you here</span><input type="date" name="sinceWhen"></label><label class="field"><span>Do you have any ID with you?</span><select name="hasId">${opt(["Yes", "No"])}</select></label></div>
    <label class="field"><span>Medical conditions (if any — leave blank if none)</span><textarea name="medical"></textarea></label>
    <label class="field"><span>Skills, attributes and personal qualities</span><textarea name="skills" placeholder="Languages, sports, harvest experience, teamwork, hard labour…"></textarea></label>
    <label class="field"><span>Anything more you want to mention</span><textarea name="notes"></textarea></label>
    <label class="field"><span>Photo</span><input type="file" name="photo" accept="image/*" capture="environment"><span class="small muted">Optional — upload when consent given. Never printed on the case file.</span></label>
    <div class="two"><label class="field"><span>Assigned case worker</span><select name="caseWorkerId"><option value="">—</option>${(state.users||[]).filter(u => u.active && (isStaff(u)||(u.roles||[]).includes("counsellor"))).map(u => `<option value="${u.id}" ${u.id === state.user.uid ? "selected" : ""}>${esc(u.name)} ${(u.roles||[]).includes("counsellor")?"(Counsellor)":""}</option>`).join("")}</select></label><label class="field"><span>Referral source</span><input name="source" placeholder="Helpline, field visit, community report…"></label></div>
    <label class="field"><span>Linked report (optional)</span><input name="linkedReport" placeholder="Event or day report reference"></label>
    <div id="dup" class="empty hidden"></div>
    <label class="check"><input type="checkbox" name="consent" required> Consent given for recording information</label>
    <label class="check"><input type="checkbox" name="caseStudy"> Willing to share story as a case study (anonymised)</label>
    <button class="btn" type="submit">Register case</button></form></div>`);
  const f = $("pf");
  const dupCheck = async () => { const q = norm(f.firstName.value); if (q.length < 3) return;
    try {
      const m = (await searchPersons(q)).filter(canOpenCase); const dup = $("dup"); dup.classList.toggle("hidden", !m.length);
      dup.innerHTML = m.length ? `<b>Possible match already registered</b><div class="list">${m.slice(0, 3).map(personRow).join("")}</div>` : "";
      dup.querySelectorAll("[data-open]").forEach(b => b.onclick = () => routes.person(b.dataset.open));
    } catch(_) {} };
  if (f && f.firstName) f.firstName.onblur = dupCheck;
  f.onsubmit = async e => { e.preventDefault(); const fd = new FormData(f); const d = Object.fromEntries(fd); delete d.photo;
    d.consent = true; d.caseStudy = f.caseStudy.checked; d.name = `${d.firstName} ${d.lastName || ""}`.trim(); d.guardian = `${d.guardianFirst || ""} ${d.guardianLast || ""}`.trim(); d.village = d.block || d.district;
    ["weight", "height"].forEach(k => d[k] = d[k] ? Number(d[k]) : null);
    const photo = fd.get("photo"); if (photo && photo.size) { try { const pR = await fileToStore(photo, 1200, 0.75, "program"); if (pR && pR.url) d.photo = pR.url; else toast("Photo could not be saved — the record will save without it. Add the photo from her profile later."); } catch(photoErr) { console.warn("Sakhi photo save failed:", photoErr); } }
    try {
      const yr = (d.registeredOn || today()).slice(0, 4);
      const st = ST_CODE[d.state] || "XX";
      const di = (d.district || "XX").slice(0, 2).toUpperCase();
      const bl = (d.block || "NA").slice(0, 2).toUpperCase();
      let n; try { n = await nextSerial("EP-OT"); } catch(e) { throw new Error("Counter write failed — " + (e.message||e.code)); }
      const code = `EP-${st}/${di}/${bl}/${n}-${yr}`;
      // Auto-assign by district
      const DISTRICT_ASSIGN = { "yamunanagar":"2f3rDlYeYAfhLuuvcboItc0U8qh1", "karnal":"JmUETTS9UIb6sjl3qSFWSOhMl1V2", "panipat":"GSCelpc826ObZa4cw8x111lncZk2" };
      const _distKey = (d.district||"").toLowerCase().replace(/\s+/g,"");
      const _autoAssign = Object.keys(DISTRICT_ASSIGN).find(k=>_distKey.includes(k));
      const p = { ...d, code, status: "open", tokens: tokens(d), registeredBy: state.user.uid, officeId: state.me.officeId || null, createdAt: firebase.firestore.FieldValue.serverTimestamp(), ...(_autoAssign?{assignedTo:DISTRICT_ASSIGN[_autoAssign]}:{}) };
      let ref; try { ref = await db.collection("persons").add(p); } catch(e) { throw new Error("Person save failed — " + (e.message||e.code)); }
      audit("create", "persons", ref.id, code);
      const regLogText = d.registeredOn && d.registeredOn < today() ? `Registered Sakhi ${code} dated ${fmtD(d.registeredOn)} (entered today — backdated)` : `Registered Sakhi ${code}`;
      if (typeof autoLogActivity === "function") autoLogActivity(regLogText).catch(()=>{});
      successFlash("Registered\n" + code); routes.person(ref.id);
    } catch(err) { toast("Could not register — " + (err.message || err.code || err)); console.error("personNew error:", err); } };
};
async function nextSerial(prefix) { const ref = db.collection("counters").doc(prefix); return db.runTransaction(async tx => { const s = await tx.get(ref); const n = (s.exists ? s.data().n : 2089) + 1; tx.set(ref, { n }); return n; }); }
async function nextCode(prefix) {
  const ref = db.collection("counters").doc(prefix);
  return db.runTransaction(async tx => { const s = await tx.get(ref); const n = (s.exists ? s.data().n : 0) + 1; tx.set(ref, { n }); return `${prefix}-${String(n).padStart(5, "0")}`; });
}

/* ---- Person view: details, cases, benefits ---- */
routes.person = async (id, tab) => {
  id = id || state.personId; state.personId = id; tab = tab || state.personTab || "profile"; state.personTab = tab;
  const snap = await db.collection("persons").doc(id).get(); if (!snap.exists) return routes.persons();
  const p = { id, ...snap.data() };
  if (!canOpenCase(p)) return html(`<div class="card"><h2>Not your state</h2><p class="small muted">This case is registered in ${esc(p.state || "another state")}. Cases are visible to the team working in that state. If this woman has been repatriated or referred to you, ask the Program Officer to share the case with your office.</p><button class="btn small quiet" onclick="go('persons')">Back to Sakhis</button></div>`);
  setTitle("Case · " + (isObserver() ? (p.code || "Sakhi") : (p.name || "")));
  const q = (c, f) => db.collection(c).where(f, "==", id).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [cases, bens, ups, incs] = await Promise.all([q("cases", "personId"), q("benefits", "personId"), q("caseUpdates", "personId"),
    db.collection("incidents").where("caseId", "==", p.code || "~").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => [])]);
  const open = cases.filter(c => c.status === "open");
  const inr = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");
  const line = (l, v) => v ? `<tr><td class="small muted" style="width:42%">${l}</td><td>${esc(v)}</td></tr>` : "";
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob)) / (365.25 * 86400000)) : p.age;
  const TABS = [["profile", "Profile"], ["cases", "Cases"], ["timeline", "Timeline"], ["benefits", "Benefits"], ["family", "Family"], ["docs", "Documents"], ["safety", "Safety"], ["study", "Case study"]];
  const body = {
    profile: () => `<div class="grid">
        <div class="card"><h2>Identity</h2><table class="table">
          ${line("Sakhi ID", p.code)}${line("Registered on", p.registeredOn)}${isObserver() ? "" : line("Name", p.name) + line("Guardian", p.guardian)}
          ${line("Gender", p.sex)}${line("Age", age)}${line("Marital status", p.marital)}${line("Children", p.children)}
          ${isObserver() ? "" : line("Phone", p.phone)}${line("ID with them", p.hasId)}${line("Weight (kg)", p.weight)}${line("Height (cm)", p.height)}</table></div>
        <div class="card"><h2>Where</h2><table class="table">
          ${line("State", p.state)}${line("District", p.district)}${line("Cluster / block", p.block)}
          ${isObserver() ? "" : line("Present address", p.presentAddress) + line("Native address", p.nativeAddress)}${line("Here since", p.sinceWhen)}</table></div>
        <div class="card"><h2>Case</h2><table class="table">
          ${line("Type of slavery", p.slaveryType)}${line("Referral source", p.source)}${line("Case worker", userName(p.caseWorkerId))}
          ${line("Registered by", userName(p.registeredBy))}${line("Work status", p.workStatus)}${line("Status", p.status || "open")}
          ${p.outcome ? line("Outcome on closing", p.outcome) : ""}${line("Consent to record", p.consent ? "Given" : "")}${line("Case study consent", p.caseStudy ? "Yes" : "No")}</table></div>
        <div class="card"><h2>Her words</h2>
          ${p.skills ? `<p class="small"><b>Skills and qualities</b><br>${esc(p.skills)}</p>` : ""}
          ${p.medical ? `<p class="small"><b>Medical conditions</b><br>${esc(p.medical)}</p>` : ""}
          ${p.notes ? `<p class="small"><b>Anything else</b><br>${esc(p.notes)}</p>` : ""}
          ${!p.skills && !p.medical && !p.notes ? `<div class="empty">Nothing recorded</div>` : ""}</div></div>
      ${(canEditPersons() || (p && p.caseWorkerId === state.user.uid)) ? `<div class="card"><h2>Correct the profile</h2><form id="pe">
        <div class="two"><label class="field"><span>Phone</span><input name="phone" value="${esc(p.phone || "")}"></label>
          <label class="field"><span>Type of slavery</span><select name="slaveryType">${SLAVERY_TYPES.map(x => `<option ${x === p.slaveryType ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
        <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions(p.state || "Haryana")}</select></label>
          <label class="field"><span>District</span><select name="district" data-geo="district" data-selected="${esc(p.district || "")}">${districtOptions(p.state || "Haryana", p.district)}</select></label></div>
        <div class="two"><label class="field"><span>Cluster / block</span><input name="block" value="${esc(p.block || "")}"></label>
          <label class="field"><span>Case worker</span><select name="caseWorkerId"><option value="">—</option>${(state.users||[]).filter(u => u.active && (isStaff(u)||(u.roles||[]).includes("counsellor"))).map(u => `<option value="${u.id}" ${u.id === p.caseWorkerId ? "selected" : ""}>${esc(u.name)} ${(u.roles||[]).includes("counsellor")?"(Counsellor)":""}</option>`).join("")}</select></label></div>
        <label class="field"><span>Present address</span><textarea name="presentAddress">${esc(p.presentAddress || "")}</textarea></label>
        <button class="btn small" type="submit">Save corrections</button></form></div>` : ""}`,
    cases: () => `<div class="card"><h2>Cases (${cases.length})</h2><div class="list">
        ${cases.map(c => `<div class="item"><div class="grow"><div class="t">${esc(c.type || "Case")} · ${esc(projectName(c.projectId))}</div>
          <div class="s">opened ${fmtD(c.openedAt)} · assigned to ${esc(userName(c.assignedTo))}${c.closedAt ? ` · closed ${fmtD(c.closedAt)}: ${esc(c.outcome || "")}` : ""}</div>
          ${c.summary ? `<div class="s">${esc(c.summary)}</div>` : ""}</div>
          <span class="tag ${c.status === "open" ? "ok" : ""}">${esc(c.status)}</span>
          ${c.status === "open" && canManageCases() ? `<button class="btn small quiet" data-close="${c.id}">Close</button>` : ""}</div>`).join("") || `<div class="empty">No case opened yet</div>`}</div>
        ${canManageCases() ? `<button class="btn small" style="margin-top:8px" id="newCase">Open a case</button>` : ""}</div>`,
    timeline: () => `<div class="card"><h2>What has happened (${ups.length})</h2><div class="list">
        ${[...ups].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(u => `<div class="item"><div class="grow">
          <div class="t">${esc(u.kind)} · ${fmtD(u.date)}</div><div class="s">${esc(u.notes)}</div>
          <div class="s muted">${esc(userName(u.by))}${u.projectId ? " · " + esc(projectName(u.projectId)) : ""}${u.file ? ` · <a href="${u.file}" target="_blank" rel="noopener">attachment</a>` : ""}</div></div></div>`).join("") || `<div class="empty">No updates yet</div>`}</div>
        <button class="btn small" style="margin-top:8px" id="addUp">Add an update</button></div>`,
    benefits: () => { const cEB = isProgramDept() || has("program_lead"); return `<div class="card"><h2>Benefits (${bens.length}) · ${inr(bens.reduce((a, b) => a + (Number(b.value) || 0), 0))}</h2>
        <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Service</th><th>Description</th><th>₹</th><th>Project</th><th>Voucher</th><th>By</th>${cEB ? "<th></th>" : ""}</tr>
        ${bens.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(b => `<tr><td>${fmtD(b.date)}</td><td>${esc(b.service || "")}</td><td>${esc(b.description || b.notes || "")}</td>
          <td>${b.value ? Number(b.value).toLocaleString("en-IN") : ""}</td><td>${esc(projectName(b.projectId || (b.funding || [])[0]?.projectId))}</td>
          <td class="small">${b.fromAccounts ? `<span class="tag">${esc(b.voucher || "from Accounts")}</span>` : ""}${b.receiptUrl ? `<a href="${esc(b.receiptUrl)}" target="_blank" rel="noopener" style="margin-left:4px" title="Open receipt">📎</a>` : ""}</td><td class="small">${esc(b.recordedByName || userName(b.recordedBy))}</td>${cEB ? `<td><button class="btn small quiet" data-bedit="${b.id}">Edit</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="7" class="empty">None recorded</td></tr>`}</table></div>
        <button class="btn small" style="margin-top:8px" id="newBen">Record a benefit</button></div>`; },
    family: () => isObserver() ? `<div class="card"><h2>Family and dependents</h2><div class="empty">Family details are not shown to an observer.</div></div>` : `<div class="card"><h2>Family and dependents</h2>
        <div class="list">${(p.family || []).map((f, i) => `<div class="item"><div class="grow"><div class="t">${esc(f.name)} · ${esc(f.relation)}</div>
          <div class="s">${f.age ? f.age + " years · " : ""}${esc(f.note || "")}</div></div>${canEditPersons() ? `<button class="btn small quiet" data-fdel="${i}">✕</button>` : ""}</div>`).join("") || `<div class="empty">Nobody recorded</div>`}</div>
        ${canEditPersons() ? `<form id="ff" style="margin-top:10px"><div class="two"><label class="field"><span>Name</span><input name="name" required></label>
          <label class="field"><span>Relation</span><select name="relation">${["Daughter", "Son", "Husband", "Mother", "Father", "Sister", "Brother", "Mother-in-law", "Other"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
          <div class="two"><label class="field"><span>Age</span><input type="number" step="any" inputmode="decimal" name="age"></label><label class="field"><span>Note (school, health, work)</span><input name="note"></label></div>
          <button class="btn small" type="submit">Add</button></form>` : ""}</div>`,
    docs: () => isObserver() ? `<div class="card"><h2>Documents and photographs</h2><div class="empty">Identifying documents are not shown to an observer.</div></div>` : `<div class="card"><h2>Documents and photographs</h2>
        <p class="small muted">Visible only to staff with case access. Consent for a photograph must be recorded before it is used anywhere.</p>
        <div class="grid">${(p.files || []).map((f, i) => `<div class="card" style="padding:8px">
          ${/^data:image/.test(f.data || "") ? `<img src="${f.data}" style="width:100%;border-radius:8px">` : `<div class="empty">${f.link ? "🗂️ in the drive" : "📎"}</div>`}
          <div class="small" style="margin-top:4px">${f.link||f.url||f.data?`<a href="${esc(f.link||f.url||f.data||'#')}" target="_blank" rel="noopener">${esc(f.name)}</a>`:esc(f.name)}<div class="muted">${esc(f.at)}</div></div>
          <div style="display:flex;gap:4px;margin-top:4px"><a class="btn small quiet" href="${f.link || f.data}" ${f.link ? 'target="_blank" rel="noopener"' : `download="${esc(f.name)}"`}>Open</a>${canEditPersons() ? `<button class="btn small danger" data-ddel="${i}">✕</button>` : ""}</div></div>`).join("") || `<div class="empty">No documents yet</div>`}</div>
        ${canEditPersons() ? `<p class="small muted" style="margin-top:10px">Large files go into <b>01 Programmes / Sakhi case documents</b> in the shared drive, filed under her case number. Small photographs stay with the record.</p>
        <div class="two" style="margin-top:4px"><label class="field"><span>What is it?</span><select id="dkind">${["Photograph", "Aadhaar / ID", "Consent form", "FIR / police document", "Court paper", "Medical record", "Scheme application", "Bank passbook", "Consent form", "Other"].map(x => `<option>${x}</option>`).join("")}</select></label>
          <label class="field"><span>File</span><input type="file" id="dfile" accept="image/*,.pdf" capture="environment"></label></div>` : ""}</div>`,
    study: () => {
      const cs = p.caseStudy === true || p.caseStudy === "Yes";
      if (isObserver()) {
        const s = p.study || {};
        if (!cs) return `<div class="card"><h2>Case study</h2><div class="empty">No case study — she has not given consent.</div></div>`;
        const alias = s.alias || "Meena";
        const scrub = txt => { let o = String(txt || "");
          [p.name, p.firstName, p.lastName, p.guardian, p.guardianFirst, p.phone, p.presentAddress, p.nativeAddress]
            .filter(Boolean).forEach(x => { o = o.split(x).join(x === p.phone ? "[removed]" : alias); });
          return o; };
        const sec = (h, t) => t ? `<h3 class="small" style="font-weight:700;margin:10px 0 2px">${h}</h3><p class="small">${esc(scrub(t))}</p>` : "";
        return `<div class="card"><h2>${esc(s.title || "Case study")}</h2>
          <p class="small muted">${esc(p.code || "")} · ${esc(p.district || "")}${p.state ? ", " + esc(p.state) : ""} · ${esc(p.slaveryType || "")}</p>
          <p><span class="tag ok">consent recorded ${esc(fmtD(s.consentAt) || "")}</span>${s.clearedBy ? ` <span class="tag">cleared by ${esc(userName(s.clearedBy))}</span>` : ` <span class="tag warn">draft — not yet cleared for use</span>`}</p>
          <p class="small muted">Names and identifying details are replaced throughout. She is called ${esc(alias)} here.</p>
          ${sec("Background", s.background)}${sec("What happened", s.what)}${sec("How she was reached", s.reached)}
          ${sec("What was done", s.intervention)}${sec("Where she is now", s.outcome)}
          ${s.quote ? `<h3 class="small" style="font-weight:700;margin:10px 0 2px">In her words</h3><p class="small" style="font-style:italic">“${esc(scrub(s.quote))}”</p>` : ""}
          ${sec("What this tells us", s.pattern)}
          ${!s.background && !s.what && !s.outcome ? `<div class="empty">Consent is recorded but nothing has been written yet.</div>` : ""}</div>`;
      }
      const s = p.study || {};
      const alias = s.alias || (p.sex === "Male" ? "Rahul" : "Meena");
      const facts = [
        p.registeredOn ? `Registered ${fmtD(p.registeredOn)}${p.code ? " (" + p.code + ")" : ""}` : "",
        p.slaveryType ? `Type: ${p.slaveryType}` : "",
        [p.block, p.district, p.state].filter(Boolean).length ? `Where: ${[p.block, p.district, p.state].filter(Boolean).join(", ")}` : "",
        p.sinceWhen ? `Here since ${fmtD(p.sinceWhen)}` : "",
        p.source ? `Identified through: ${p.source}` : "",
        bens.length ? `${bens.length} benefit(s) recorded, ${bens.filter(b => b.service).map(b => b.service).filter((v, i, a) => a.indexOf(v) === i).join(", ")}` : "",
        ups.length ? `${ups.length} follow-up(s) between ${fmtD([...ups].sort((a, b) => (a.date||"").localeCompare(b.date||""))[0]?.date)} and ${fmtD([...ups].sort((a, b) => (b.date||"").localeCompare(a.date||""))[0]?.date)}` : ""
      ].filter(Boolean);
      if (!cs) return `<div class="card"><h2>Case study</h2>
        <p class="small muted">She has not given consent for her story to be used as a case study, so nothing can be written or exported here.</p>
        <p class="small">Consent is asked at registration and can be recorded later, in person, by the case worker. It is hers to give and hers to withdraw.</p>
        ${canManageCases() ? `<button class="btn small" id="askConsent">Record that consent has now been given</button>` : ""}</div>`;
      return `<div class="card"><h2>Case study</h2>
          <p class="small"><span class="tag ok">consent given</span> ${s.consentBy ? `recorded by ${esc(userName(s.consentBy))}` : ""} ${s.consentAt ? "· " + fmtD(s.consentAt) : ""}
          ${canManageCases() ? `<button class="btn small quiet" id="revoke">She has withdrawn consent</button>` : ""}</p>
          <p class="small muted">Write it in her words where you can. The export replaces her name and anything identifying with the alias below — check it yourself before it leaves the office.</p></div>
        <div class="card"><h2>What the record already shows</h2><ul class="small" style="margin:0 0 0 18px;line-height:1.8">${facts.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div>
        ${canEditPersons() ? `<div class="card"><form id="csf">
          <div class="two"><label class="field"><span>Name to use instead of hers</span><input name="alias" value="${esc(alias)}"></label>
            <label class="field"><span>Title</span><input name="title" value="${esc(s.title || "")}" placeholder="“I did not know I could say no”"></label></div>
          <label class="field"><span>Background — her life before</span><textarea name="background" rows="3">${esc(s.background || "")}</textarea></label>
          <label class="field"><span>What happened</span><textarea name="what" rows="4">${esc(s.what || "")}</textarea></label>
          <label class="field"><span>How she was identified or reached us</span><textarea name="reached" rows="2">${esc(s.reached || "")}</textarea></label>
          <label class="field"><span>What was done — the intervention</span><textarea name="intervention" rows="4">${esc(s.intervention || "")}</textarea></label>
          <label class="field"><span>Where she is now — the outcome</span><textarea name="outcome" rows="3">${esc(s.outcome || "")}</textarea></label>
          <label class="field"><span>In her words (a quotation she has agreed to)</span><textarea name="quote" rows="2">${esc(s.quote || "")}</textarea></label>
          <label class="field"><span>What this case tells us about the pattern</span><textarea name="pattern" rows="3">${esc(s.pattern || "")}</textarea></label>
          <div class="two"><label class="field"><span>Written by</span><input value="${esc(userName(s.by) || state.me.name)}" disabled></label>
            <label class="field"><span>Cleared for use by</span><select name="clearedBy"><option value="">— not yet cleared —</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === s.clearedBy ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div>
          <button class="btn small" type="submit">Save the case study</button>
          <button class="btn small quiet" type="button" id="csExport">Export anonymised</button>
          <p class="small muted" style="margin-top:6px">Nothing here is shown on her profile to anyone without case access, and the export carries no name, no phone, no address and no photograph.</p></form></div>` : ""}`;
    },
    safety: () => `<div class="card"><h2>Safety and risk</h2>
        ${canManageCases() ? `<form id="sf"><div class="two"><label class="field"><span>Risk level</span><select name="risk">${["Not assessed", "Low", "Medium", "High"].map(x => `<option ${x === (p.risk || "Not assessed") ? "selected" : ""}>${x}</option>`).join("")}</select></label>
          <label class="field"><span>Safe to contact by phone?</span><select name="safePhone">${["Yes", "No — call only this number", "No — do not call"].map(x => `<option ${x === p.safePhone ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
          <label class="field"><span>Who must not be told about her case</span><input name="doNotTell" value="${esc(p.doNotTell || "")}"></label>
          <label class="field"><span>Safe contact person and number</span><input name="safeContact" value="${esc(p.safeContact || "")}"></label>
          <label class="field"><span>Risk notes</span><textarea name="riskNotes">${esc(p.riskNotes || "")}</textarea></label>
          <button class="btn small" type="submit">Save</button></form>` : `<table class="table">${line("Risk level", p.risk)}${line("Safe to call", p.safePhone)}${line("Notes", p.riskNotes)}</table>`}</div>
      ${seesAllStates() ? `<div class="card"><h2>Share this case with another office</h2>
        <p class="small muted">Use this when a woman is repatriated or referred — for example a Haryana case followed up by the Bihar team. Sharing is recorded in the audit log.</p>
        <div class="list">${(p.sharedWith || []).map(oid => `<div class="item"><div class="grow"><div class="t">${esc(officeName(oid))}</div></div><button class="btn small quiet" data-unshare="${oid}">Remove</button></div>`).join("") || `<div class="empty">Not shared with any other office</div>`}</div>
        <div class="two" style="margin-top:8px"><label class="field"><span>Share with</span><select id="shOff">${state.offices.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></label>
          <label class="field"><span>&nbsp;</span><button class="btn small" id="shBtn">Share</button></label></div></div>` : ""}
      ${incs.length ? `<div class="card"><h2>Incidents linked to this case</h2><div class="list">${incs.map(i => `<div class="item"><div class="grow"><div class="t">${esc(i.nature || i.type)}</div>
        <div class="s">${esc(i.incidentAt || "")} · ${esc(i.location || "")} · ${escString(i.details || "").slice(0, 120)}</div></div><span class="tag ${i.status === "closed" ? "ok" : "bad"}">${esc(i.status)}</span></div>`).join("")}</div></div>` : ""}` };
  html(`<div class="card"><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      ${p.photo && !isObserver() ? `
        <div style="position:relative;display:inline-block">
          <img src="${(ph=>{const m=ph.match(/\/file\/d\/([^\/\?]+)/);if(m)return'https://lh3.googleusercontent.com/d/'+m[1];const m2=ph.match(/[?&]id=([^&]+)/);if(m2)return'https://lh3.googleusercontent.com/d/'+m2[1];if(ph.startsWith('data:'))return ph;if(ph.startsWith('http'))return ph;return'data:image/jpeg;base64,'+ph;})(p.photo)}" style="width:72px;height:88px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">
          ${canEditPersons() ? `<label style="position:absolute;bottom:0;right:0;background:rgba(0,0,0,.6);color:#fff;border-radius:0 0 10px 0;padding:2px 4px;font-size:10px;cursor:pointer">
            📷<input type="file" accept="image/*" capture="environment" id="updPhoto" class="hidden"></label>` : ""}
        </div>` :
        !p.photo && canEditPersons() ? `<label style="width:72px;height:88px;border:2px dashed var(--line);border-radius:10px;display:grid;place-items:center;cursor:pointer;font-size:11px;color:var(--muted);text-align:center">
          📷 Add photo<input type="file" accept="image/*" capture="environment" id="updPhoto" class="hidden"></label>` : ""}
      <div style="flex:1;min-width:200px"><h2 style="margin:0">${esc(maskName(p.name, p.code))}</h2>
        <p class="small muted" style="margin:3px 0">${esc(p.code || "")} · ${esc(p.slaveryType || "")} · ${esc(p.district || "")}${p.block ? ", " + esc(p.block) : ""}</p>
        <p style="margin:4px 0"><span class="tag ${(p.status || "open") === "open" ? "ok" : ""}">${esc(p.status || "open")}</span>
          ${p.risk && p.risk !== "Not assessed" ? `<span class="tag ${p.risk === "High" ? "bad" : "warn"}">risk: ${esc(p.risk)}</span>` : ""}
          ${p.caseWorkerId ? `<span class="tag">${esc(userName(p.caseWorkerId))}</span>` : `<span class="tag warn">no case worker</span>`}
          <span class="tag">${bens.length} benefits</span><span class="tag">${ups.length} updates</span></p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${canEditPersons() ? `<button class="btn small" id="addBen">Record support</button>` : ""}<button class="btn small quiet" id="back">All Sakhis</button><button class="btn small quiet" id="printCase">Print case file</button></div></div>
    ${canAssignCases() ? `<div class="card"><h2>Who is working on this case</h2>
      <div class="two"><label class="field"><span>Case worker (the person responsible)</span><select id="cw"><option value="">— nobody yet —</option>${caseWorkerChoices().map(u => `<option value="${u.id}" ${u.id === p.caseWorkerId ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select></label>
        <label class="field"><span>&nbsp;</span><button class="btn small" id="assignBtn">Assign</button></label></div>
      ${(p.assignHistory || []).length ? `<div class="list">${(p.assignHistory || []).slice().reverse().slice(0, 5).map(h => `<div class="item"><div class="grow"><div class="s">${esc(h.at)} · ${esc(userName(h.to))} assigned by ${esc(userName(h.by))}${h.note ? " · " + esc(h.note) : ""}</div></div></div>`).join("")}</div>` : ""}
      <p class="small muted">The person assigned sees this case on <b>Cases assigned to me</b> and can add updates and benefits, whichever team they are in.</p></div>` : ""}
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px">${TABS.map(([k, l]) => `<button class="btn small ${k === tab ? "" : "quiet"}" data-tab="${k}">${l}</button>`).join("")}</div></div>
    ${body[tab]()}<div class="card hidden" id="formCard"></div>`);
  $("back").onclick = routes.persons;
  if ($("addBen")) $("addBen").onclick = () => { state.benPrefill = { personCode: p.code, personId: id, name: p.name,
    age: p.age, phone: p.phone, village: p.block, district: p.district, state: p.state, address: p.presentAddress };
    go("beneficiaryNew"); };
  if ($("assignBtn")) $("assignBtn").onclick = async () => { const to = $("cw").value; if (!to) return toast("Choose someone first");
    const note = prompt("Anything to tell them? (optional)") || "";
    const target = state.users.find(u => u.id === to) || {};
    await db.collection("persons").doc(id).update({ caseWorkerId: to, caseWorkerPostId: target.postId || null, caseWorkerPostTitle: target.postTitle || null,
      assignedAt: today(), assignedBy: state.user.uid,
      assignHistory: [...(p.assignHistory || []), { to, by: state.user.uid, at: today(), note }] });
    audit("assign_case", "persons", id, userName(to)); toast("Assigned to " + userName(to)); routes.person(id, tab); };
  $("content").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => routes.person(id, b.dataset.tab));
  if ($("updPhoto")) $("updPhoto").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.closest("label").textContent = "Uploading…";
    try {
      // Compress to max 400px, 0.75 quality before uploading
      const _pimg = await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(f);});
      const _pcv = document.createElement("canvas");
      const _psc = Math.min(1, 400/Math.max(_pimg.width,_pimg.height));
      _pcv.width=Math.round(_pimg.width*_psc); _pcv.height=Math.round(_pimg.height*_psc);
      _pcv.getContext("2d").drawImage(_pimg,0,0,_pcv.width,_pcv.height);
      const _blob = await new Promise(res=>_pcv.toBlob(res,"image/jpeg",0.75));
      const _file = new File([_blob],`${p.code||id}.jpg`,{type:"image/jpeg"});
      // Upload to Drive — fileToStore handles fallback to Firebase Storage if Drive unavailable
      const _drv = await fileToStore(_file, 1200, 0.75, "program");
      let _photoUrl;
      if (_drv && _drv.id) {
        // Store as CDN URL using Drive file ID — renders directly as <img>
        _photoUrl = "https://lh3.googleusercontent.com/d/" + _drv.id;
      } else if (_drv && _drv.url) {
        _photoUrl = _drv.url; // Firebase Storage URL (fallback) or base64
      } else {
        // Last resort — store compressed base64 (smaller than original)
        _photoUrl = _pcv.toDataURL("image/jpeg", 0.75);
      }
      await db.collection("persons").doc(id).update({photo:_photoUrl});
  audit("photo_update","persons",id,p.code||""); toast("Photo saved ✔"); routes.person(id, tab);
} catch(err) { toast("Could not save — "+err.message); routes.person(id, tab); }
  };
  if ($("newCase")) $("newCase").onclick = () => caseForm(p);
  if ($("newBen")) $("newBen").onclick = () => benefitForm(p, open);
  if ($("addUp")) $("addUp").onclick = () => routes.caseUpdate(id);
  $("content").querySelectorAll("[data-close]").forEach(b => b.onclick = async () => { const outcome = prompt("Outcome on closing:") || "";
    await db.collection("cases").doc(b.dataset.close).update({ status: "closed", closedAt: today(), outcome, closedBy: state.user.uid });
    audit("close", "cases", b.dataset.close, outcome); routes.person(id, "cases"); });
  if ($("pe")) $("pe").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await db.collection("persons").doc(id).update({ ...d, tokens: tokens({ ...p, ...d }) }); audit("update", "persons", id, p.code || ""); toast("Saved"); routes.person(id, "profile"); };
  if ($("ff")) $("ff").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.age = d.age ? Number(d.age) : null;
    await db.collection("persons").doc(id).update({ family: [...(p.family || []), d] }); toast("Added"); routes.person(id, "family"); };
  $("content").querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => { const fam = [...(p.family || [])]; fam.splice(Number(b.dataset.fdel), 1);
    await db.collection("persons").doc(id).update({ family: fam }); routes.person(id, "family"); });
  if ($("dfile")) $("dfile").onchange = async e => { const f = e.target.files[0]; if (!f) return;
    const kind = $("dkind") ? $("dkind").value : "Document";
    const note = $("dfile_s");
    if (note) note.textContent = "Creating folder in Drive\u2026";
    try {
      // Create Sakhis/{code} folder in Drive
      const _sUrl = (state.drive||{}).uploadUrl || "";
      let _destId = null;
      if (_sUrl && p.code) {
        try {
          const _r1 = await fetch(_sUrl, { method:"POST", body: new URLSearchParams({ action:"createFolder", parent:"program", name:"Sakhis" }) });
          const _j1 = await _r1.json();
          if (_j1.ok && _j1.id) {
            const _r2 = await fetch(_sUrl, { method:"POST", body: new URLSearchParams({ action:"createFolder", parentId:_j1.id, name:p.code }) });
            const _j2 = await _r2.json(); if (_j2.ok) _destId = _j2.id;
          }
        } catch(_e) {}
      }
      if (note) note.textContent = "Uploading\u2026";
      const _up = await fileToStore(f, 1200, 0.75, _destId ? null : "program");
      if (_up) {
        const _lnk = _up.id ? "https://drive.google.com/file/d/"+_up.id+"/view" : (_up.url||_up.link||"");
        const _files = [...(p.files||[]), { name: kind + " \u2014 " + f.name, at: today(), by: state.user.uid, link: _lnk, driveId: _up.id||null, _pending: _up._pending||false }];
        await db.collection("persons").doc(id).update({ files: _files });
      } else { toast("Could not save \u2014 check your connection and try again"); return; }
      audit("upload", "persons", id, f.name); toast("Added"); routes.person(id, "docs");
        // Override dfile for sensitive docs: Aadhaar/ID and Consent form → base64 in Firestore
        if($("dfile") && !$("dfile")._sakhiDocOverride) {
          $("dfile")._sakhiDocOverride = true;
          const _dfileOrig = $("dfile").onchange;
          $("dfile").onchange = async function(e) {
            const _kind = $("dkind")?.value || "";
            const _f = e.target.files && e.target.files[0];
            if(_f && /^Aadhaar|^Consent form/.test(_kind)) {
              toast("Saving "+_kind+"…");
              try {
                const _r = new FileReader();
                const _b64 = await new Promise(function(res,rej){_r.onload=function(){res(_r.result.split(",")[1]);};_r.onerror=rej;_r.readAsDataURL(_f);});
                const _field = /^Aadhaar/.test(_kind) ? "idDoc" : "consentDoc";
                await db.collection("persons").doc(id).update({[_field]:_b64,[_field+"Name"]:_f.name,[_field+"On"]:today()});
                audit("upload","persons",id,_f.name); toast(_kind+" saved ✔"); routes.person(id,"docs");
              } catch(_de){ toast("Could not save — "+(_de&&_de.message)); routes.person(id,"docs"); }
              return;
            }
            if(_dfileOrig) return _dfileOrig.call(this, e);
          };
        }
    } catch (err) { note.textContent = err.message; } };
  $("content").querySelectorAll("[data-ddel]").forEach(b => b.onclick = async () => { if (!confirm("Remove this document?")) return;
    const files = [...(p.files || [])]; files.splice(Number(b.dataset.ddel), 1); await db.collection("persons").doc(id).update({ files }); routes.person(id, "docs"); });
  if ($("askConsent")) $("askConsent").onclick = async () => {
    if (!confirm("Confirm that " + (p.name || "she") + " has given informed consent, in a language she understands, for her story to be used as an anonymised case study.")) return;
    await db.collection("persons").doc(id).update({ caseStudy: true, study: { ...(p.study || {}), consentBy: state.user.uid, consentAt: today() } });
    audit("consent", "persons", id, "case study"); toast("Consent recorded"); routes.person(id, "study"); };
  if ($("revoke")) $("revoke").onclick = async () => { if (!confirm("Withdraw consent? The case study stays on file but cannot be exported.")) return;
    await db.collection("persons").doc(id).update({ caseStudy: false, study: { ...(p.study || {}), withdrawnAt: today(), withdrawnBy: state.user.uid } });
    audit("consent_withdrawn", "persons", id, "case study"); toast("Consent withdrawn"); routes.person(id, "study"); };
  if ($("csf")) $("csf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await db.collection("persons").doc(id).update({ study: { ...(p.study || {}), ...d, by: state.user.uid, at: today() } });
    audit("update", "persons", id, "case study"); toast("Saved"); routes.person(id, "study"); };
  if ($("csExport")) $("csExport").onclick = async () => {
    if (!(p.caseStudy === true || p.caseStudy === "Yes")) return alert("Consent has not been given, so this cannot be exported.");
    const s = p.study || {}; const alias = (s.alias || "Meena").trim();
    const scrub = txt => { let o = String(txt || "");
      [p.name, p.firstName, p.lastName, p.guardian, p.guardianFirst, p.phone, p.presentAddress, p.nativeAddress, p.code]
        .filter(Boolean).forEach(x => { o = o.split(x).join(x === p.phone ? "[phone removed]" : alias); });
      return o; };
    if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const doc = new jspdf.jsPDF({ unit: "mm", format: "a4" }); let y = 18;
    const W = (t, size, bold) => { doc.setFontSize(size || 11); doc.setFont(undefined, bold ? "bold" : "normal");
      doc.splitTextToSize(scrub(t), 175).forEach(l => { if (y > 275) { doc.addPage(); y = 18; } doc.text(l, 18, y); y += size > 12 ? 7 : 5.6; }); };
    W("EMPOWER PEOPLE", 10); W(s.title || "A case study", 15, true); y += 2;
    W(`${alias} · ${p.district || ""}${p.state ? ", " + p.state : ""} · ${p.slaveryType || ""}`, 10); y += 4;
    const sec = (h, t) => { if (!t) return; W(h, 12, true); W(t); y += 2; };
    sec("Background", s.background); sec("What happened", s.what); sec("How she was reached", s.reached);
    sec("What was done", s.intervention); sec("Where she is now", s.outcome);
    if (s.quote) { W("In her words", 12, true); doc.setFont(undefined, "italic"); W("\u201c" + s.quote + "\u201d"); doc.setFont(undefined, "normal"); y += 2; }
    sec("What this tells us", s.pattern);
    y += 4; W(`Names and identifying details have been changed. Published with informed consent recorded on ${fmtD((p.study || {}).consentAt)}. ${s.clearedBy ? "Cleared for use by " + userName(s.clearedBy) + "." : "NOT YET CLEARED FOR USE."}`, 8);
    doc.save(`case-study-${alias.replace(/\s+/g, "-")}.pdf`); };
  if ($("shBtn")) $("shBtn").onclick = async () => { const oid = $("shOff").value;
    await db.collection("persons").doc(id).update({ sharedWith: [...new Set([...(p.sharedWith || []), oid])] });
    audit("share", "persons", id, officeName(oid)); toast("Shared with " + officeName(oid)); routes.person(id, "safety"); };
  // Inline benefit edit panel
var _benPanel = document.getElementById("benEditPanel");
if(!_benPanel){
  _benPanel = document.createElement("div");
  _benPanel.id = "benEditPanel";
  _benPanel.className = "card";
  _benPanel.style.cssText = "display:none;margin-bottom:12px";
  _benPanel.innerHTML = '<h2>Edit benefit</h2><form id="benEditForm"><div class="two"><label class="field"><span>Service</span><select name="service">' + opt(SERVICES) + '</select></label><label class="field"><span>Date</span><input type="date" name="date"></label></div><div class="two"><label class="field"><span>Value ₹</span><input name="value" type="number" min="0" inputmode="decimal"></label><label class="field"><span>Receipt / voucher</span><input type="file" name="receipt" accept="image/*,.pdf" capture="environment"></label></div><label class="field"><span>Description</span><input name="description"></label><div style="margin-top:8px"><button class="btn small" type="submit">Save</button> <button class="btn small quiet" type="button" id="benCancel">Cancel</button></div></form>';
  var _bnt = $("content").querySelector(".tablewrap");
  _bnt && _bnt.parentNode ? _bnt.parentNode.insertBefore(_benPanel, _bnt) : $("content").appendChild(_benPanel);
}
var _bc = document.getElementById("benCancel");
if(_bc) _bc.onclick = function(){ _benPanel.style.display="none"; };
$("content").querySelectorAll("[data-bedit]").forEach(function(eb){
  eb.onclick = function(){
    var bid=eb.dataset.bedit; var ben=bens.find(function(x){return x.id===bid;}); if(!ben) return;
    _benPanel.dataset.bid=bid; _benPanel.style.display="";
    var form=document.getElementById("benEditForm");
    if(form.elements.service)     form.elements.service.value     = ben.service||"";
    if(form.elements.date)        form.elements.date.value        = ben.date||"";
    if(form.elements.value)       form.elements.value.value       = ben.value||"";
    if(form.elements.description) form.elements.description.value = ben.description||ben.notes||"";
    _benPanel.scrollIntoView({behavior:"smooth"});
  };
});
var _benF = document.getElementById("benEditForm");
if(_benF) _benF.onsubmit = async function(e){
  e.preventDefault();
  var bid=_benPanel.dataset.bid; if(!bid) return;
  var fd=new FormData(e.target);
  var upd={service:fd.get("service"),date:fd.get("date"),value:+fd.get("value")||null,description:fd.get("description"),editedBy:state.user.uid,editedAt:today()};
  var file=fd.get("receipt");
  if(file&&file.size>0){
    try{
      toast("Uploading receipt…");
      var r=await uploadToDrive(file,"program",file.name);
      if(r&&r.link) upd.receiptUrl=r.link;
    } catch(err){toast("Receipt upload failed: "+err.message);}
  }
  await db.collection("benefits").doc(bid).update(upd);
  audit("update","benefits",bid,upd.service||"");
  _benPanel.style.display="none";
  toast("Saved"); routes.person(id,"benefits");
};
  $("content").querySelectorAll("[data-unshare]").forEach(b => b.onclick = async () => {
    await db.collection("persons").doc(id).update({ sharedWith: (p.sharedWith || []).filter(x => x !== b.dataset.unshare) });
    audit("unshare", "persons", id, officeName(b.dataset.unshare)); routes.person(id, "safety"); });
  if ($("sf")) $("sf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await db.collection("persons").doc(id).update(d); audit("update", "persons", id, "safety"); toast("Saved"); routes.person(id, "safety"); };
  $("printCase").onclick = async () => { if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const doc = new jspdf.jsPDF({ unit: "mm", format: "a4" }); let y = 16;
    const W = (t, size, bold) => { doc.setFontSize(size || 10); doc.setFont(undefined, bold ? "bold" : "normal");
      doc.splitTextToSize(String(t), 180).forEach(l => { if (y > 280) { doc.addPage(); y = 16; } doc.text(l, 15, y); y += size > 12 ? 7 : 5; }); };
    W("EMPOWER PEOPLE — CASE FILE", 14, true); W(p.code || "No Sakhi ID", 13, true); y += 2;
    W(`${p.slaveryType || ""} · ${p.sex || ""}${age ? ", " + age : ""} · ${p.marital || ""} · registered ${p.registeredOn || ""}`);
    W(`${[p.block, p.district, p.state].filter(Boolean).join(", ")}`);
    W(`Case worker: ${userName(p.caseWorkerId) || "—"} · status ${p.status || "open"} · risk ${p.risk || "not assessed"}`); y += 3;
    if (p.presentAddress) { W("Present address", 11, true); W(p.presentAddress); }
    if (p.nativeAddress) { W("Native address", 11, true); W(p.nativeAddress); }
    if (p.skills) { W("Skills and qualities", 11, true); W(p.skills); }
    if (p.medical) { W("Medical", 11, true); W(p.medical); }
    y += 2; W(`Benefits (${bens.length})`, 12, true);
    bens.forEach(b => W(`${b.date || ""} · ${b.service || ""} · ${b.description || ""} ${b.value ? "₹" + b.value : ""}`));
    y += 2; W(`Timeline (${ups.length})`, 12, true);
    [...ups].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(u => W(`${u.date || ""} · ${u.kind || ""} — ${u.notes || ""}`));
    y += 4; W("Confidential. Prepared " + today() + " by " + state.me.name + ". Not to be shared outside Empower People without written consent.", 8);
    doc.save(`case-${(p.code || p.name || "file").replace(/[^\w-]+/g, "-")}.pdf`); };
};
function caseForm(p) {
  const c = $("formCard"); c.classList.remove("hidden");
  c.innerHTML = `<h2>${pt("openCase")}</h2><form id="cf">
    <div class="two"><label class="field"><span>${pt("caseType")}</span><select name="type">${opt(CASE_TYPES)}</select></label>
    <label class="field"><span>${t("project")}</span><select name="projectId" required>${projectOptions()}</select></label></div>
    <div class="two"><label class="field"><span>${pt("opened")}</span><input type="date" name="openedAt" value="${today()}"></label>
    <label class="field"><span>${pt("assigned")}</span><select name="assignedTo">${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === state.user.uid ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div>
    <label class="field"><span>${pt("summary")}</span><textarea name="summary" required></textarea></label>
    <button class="btn small" type="submit">${pt("save")}</button></form>`;
  c.scrollIntoView({ behavior: "smooth" });
  $("cf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const ref = await db.collection("cases").add({ ...d, personId: p.id, personName: p.name, status: "open", openedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("create", "cases", ref.id, d.type); routes.person(p.id); };
}
function benefitForm(p, openCases) {
  const c = $("formCard"); c.classList.remove("hidden");
  const fundRow = () => `<div class="two fund"><select name="fp">${projectOptions()}</select><input name="fa" type="number" inputmode="numeric" placeholder="${pt("split")}"></div>`;
  c.innerHTML = `<h2>${pt("recordBenefit")}</h2>${openCases.length ? "" : `<p class="err">${pt("noOpenCase")}</p>`}<form id="bf">
    <div class="two"><label class="field"><span>${pt("cases")}</span><select name="caseId">${openCases.map(x => `<option value="${x.id}">${esc(x.type)} (${x.openedAt})</option>`).join("")}<option value="">— none / general —</option></select></label>
    <label class="field"><span>${pt("date")}</span><input type="date" name="date" value="${today()}"></label></div>
    <div class="two"><label class="field"><span>${pt("service")}</span><select name="service">${opt(SERVICES)}</select></label>
    <label class="field"><span>${pt("value")}</span><input name="value" type="number" inputmode="numeric" min="0"></label></div>
    <span class="small" style="font-weight:600">${pt("funding")}</span><div id="funds">${fundRow()}</div>
    <button class="btn small quiet" type="button" id="addFund">${pt("addProject")}</button>
    <label class="field" style="margin-top:10px"><span>${pt("notes")}</span><textarea name="notes"></textarea></label>
    <button class="btn small" type="submit">${pt("save")}</button></form>`;
  c.scrollIntoView({ behavior: "smooth" });
  $("addFund").onclick = () => $("funds").insertAdjacentHTML("beforeend", fundRow());
  $("bf").onsubmit = async e => { e.preventDefault(); const f = e.target; const fd = new FormData(f);
    const fps = fd.getAll("fp"), fas = fd.getAll("fa");
    const funding = fps.map((pid, i) => ({ projectId: pid, amount: Number(fas[i]) || 0 })).filter(x => x.projectId);
    if (!funding.length) return toast(pt("funding"));
    const d = { personId: p.id, personName: p.name, caseId: fd.get("caseId") || null, date: fd.get("date"), service: fd.get("service"), value: Number(fd.get("value")) || 0, notes: fd.get("notes"),
      funding, projectIds: funding.map(x => x.projectId), recordedBy: state.user.uid, officeId: state.me.officeId || null, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref = await db.collection("benefits").add(d); audit("create", "benefits", ref.id, d.service); routes.person(p.id); };
}

/* ---- Programs overview ---- */
routes.programs = async () => {
  setTitle(pt("overview"));
  const [ps, cs, bs] = await Promise.all([db.collection("persons").get(), db.collection("cases").get(), db.collection("benefits").get()]);
  const persons = ps.docs.map(d => d.data()), cases = cs.docs.map(d => d.data()), bens = bs.docs.map(d => d.data());
  const by = (arr, k) => arr.reduce((m, x) => (m[x[k] || "—"] = (m[x[k] || "—"] || 0) + 1, m), {});
  const byProj = {}; bens.forEach(b => (b.funding || []).forEach(f => { const n = projectName(f.projectId) || "—"; byProj[n] = byProj[n] || { count: 0, amount: 0 }; byProj[n].count++; byProj[n].amount += f.amount || 0; }));
  const tbl = (obj, h1, h2) => `<div class="tablewrap"><table class="table"><tr><th>${h1}</th><th>${h2}</th></tr>${Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("")}</table></div>`;
  html(`<div class="grid">
    <div class="card stat"><span class="muted small">${pt("persons")}</span><b>${persons.length}</b></div>
    <div class="card stat"><span class="muted small">Open ${pt("cases").toLowerCase()}</span><b>${cases.filter(c => c.status === "open").length} / ${cases.length}</b></div>
    <div class="card stat"><span class="muted small">${pt("benefits")}</span><b>${bens.length}</b></div>
    <div class="card stat"><span class="muted small">Case-study consent</span><b>${persons.filter(p => p.caseStudy).length}</b></div></div>
  <div class="grid"><div class="card"><h2>${pt("persons")} by ${pt("category").toLowerCase()}</h2>${tbl(by(persons, "category"), pt("category"), "#")}</div>
    <div class="card"><h2>${pt("persons")} by ${pt("district").toLowerCase()}</h2>${tbl(by(persons, "district"), pt("district"), "#")}</div>
    <div class="card"><h2>${pt("cases")} by type</h2>${tbl(by(cases, "type"), pt("caseType"), "#")}</div>
    <div class="card"><h2>${pt("benefits")} by service</h2>${tbl(by(bens, "service"), pt("service"), "#")}</div></div>
  <div class="card"><h2>${pt("benefits")} by project</h2><div class="tablewrap"><table class="table"><tr><th>Project</th><th>Benefits</th><th>Amount ₹</th></tr>
    ${Object.entries(byProj).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.count}</td><td>${v.amount.toLocaleString("en-IN")}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">${t("nothing")}</td></tr>`}</table></div></div>`);
};

/* ---- Backup: every collection to Excel + JSON, download or save to shared Drive ---- */
const BACKUP_COLS = ["allowlist", "users", "offices", "projects", "persons", "cases", "benefits", "attendance", "dayReports", "leaveRequests", "expenseClaims", "receipts", "proposals", "opportunities", "outreach", "obligations", "posts", "assets", "vendors", "volunteers", "handovers", "travelRequests", "journeys", "advances", "incidents", "appointments", "assignments", "banks", "budgetHeads", "incomeReceipts", "expenses", "pettyCash", "registrations", "statutory", "policies", "meetings", "channels", "caseUpdates", "groups", "activities", "eventReports", "settings", "audit"];
async function collectBackup() {
  const all = {}; for (const c of BACKUP_COLS) { const s = await db.collection(c).get(); all[c] = s.docs.map(d => ({ id: d.id, ...flat(d.data()) })); }
  if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  const wb = XLSX.utils.book_new(); for (const c of BACKUP_COLS) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all[c].map(r => { const o = { ...r }; delete o.image; return o; })), c.slice(0, 31));
  const xlsx = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const json = new Blob([JSON.stringify(all)], { type: "application/json" });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  return { xlsx, json, stamp, counts: Object.fromEntries(BACKUP_COLS.map(c => [c, all[c].length])) };
}
routes.backup = async () => {
  setTitle(pt("export"));
  const cfg = (await db.collection("settings").doc("backup").get()).data() || {};
  html(`<div class="card"><h2>${pt("export")}</h2>
    <p class="muted small">Every table goes into one Excel workbook (a sheet per table) and one JSON file. The JSON is what a restore would use; receipt images are in the JSON only.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="dl">Download to this computer</button><button class="btn small" id="drive">Save to shared Drive</button></div>
    <div class="err" id="bErr"></div><div class="small muted" id="bLast">${cfg.lastAt ? `Last Drive backup: ${new Date(cfg.lastAt.seconds * 1000).toLocaleString("en-IN")} by ${esc(cfg.lastBy || "")}` : ""}</div></div>
    <div class="card"><h2>Shared Drive folder</h2><p class="muted small">Open the folder in Google Drive and copy the long ID from the address bar (after <code>/folders/</code>). The person who clicks "Save to shared Drive" must have edit access to it and be signed in here with Google.</p>
    <form id="cf"><label class="field"><span>Folder ID</span><input name="driveFolderId" value="${esc(cfg.driveFolderId || "")}" placeholder="1AbC…"></label><button class="btn small quiet" type="submit">Save setting</button></form></div>`);
  $("cf").onsubmit = async e => { e.preventDefault(); await db.collection("settings").doc("backup").set({ driveFolderId: new FormData(e.target).get("driveFolderId").trim() }, { merge: true }); toast("Saved"); };
  $("dl").onclick = async () => { $("dl").disabled = true; try { const b = await collectBackup();
    download(`ep-office-backup-${b.stamp}.json`, b.json); download(`ep-office-backup-${b.stamp}.xlsx`, b.xlsx); audit("backup_download", "all", null, b.stamp); toast("Backup downloaded");
  } catch (e) { $("bErr").textContent = e.message; } finally { $("dl").disabled = false; } };
  $("drive").onclick = async () => { $("drive").disabled = true; $("bErr").textContent = "";
    try {
      const folder = ((await db.collection("settings").doc("backup").get()).data() || {}).driveFolderId; if (!folder) throw new Error("Set the shared Drive folder ID first.");
      const token = await driveToken();
      const b = await collectBackup();
      await driveUpload(token, folder, `ep-office-backup-${b.stamp}.xlsx`, b.xlsx);
      await driveUpload(token, folder, `ep-office-backup-${b.stamp}.json`, b.json);
      await db.collection("settings").doc("backup").set({ lastAt: firebase.firestore.FieldValue.serverTimestamp(), lastBy: state.me.email, lastCounts: b.counts }, { merge: true });
      audit("backup_drive", "all", null, b.stamp); toast("Saved to Drive"); routes.backup();
    } catch (e) { $("bErr").textContent = e.message; } finally { $("drive").disabled = false; } };
};
async function driveToken() {
  if (!state.user.providerData.some(p => p.providerId === "google.com")) throw new Error("Sign in with Google to save to Drive.");
  const provider = new firebase.auth.GoogleAuthProvider(); provider.addScope("https://www.googleapis.com/auth/drive.file"); provider.addScope("https://www.googleapis.com/auth/drive");
  provider.setCustomParameters({ login_hint: state.user.email, prompt: "consent" });
  const res = await state.user.reauthenticateWithPopup(provider); return res.credential.accessToken;
}
async function driveUpload(token, folderId, name, blob) {
  const meta = new Blob([JSON.stringify({ name, parents: [folderId] })], { type: "application/json" });
  const body = new FormData(); body.append("metadata", meta); body.append("file", blob);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { Authorization: "Bearer " + token }, body });
  if (!r.ok) throw new Error("Drive upload failed: " + (await r.text()).slice(0, 200));
}
const flat = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.seconds ? new Date(v.seconds * 1000).toISOString() : Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v]));
const download = (name, blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src)); document.head.appendChild(s); });


/* ---- Cases assigned to me ---- */
routes.mycases = async () => {
  setTitle("Cases assigned to me");
  const uid = state.user.uid;
  const byPerson = await db.collection("persons").where("caseWorkerId", "==", uid).limit(300).get().catch(() => ({ docs: [] }));
  const byPost = state.me.postId
    ? await db.collection("persons").where("caseWorkerPostId", "==", state.me.postId).limit(300).get().catch(() => ({ docs: [] }))
    : { docs: [] };
  const seen = {};
  const mine = [...byPerson.docs, ...byPost.docs].map(d => ({ id: d.id, ...d.data() })).filter(x => !seen[x.id] && (seen[x.id] = 1));
  const handover = mine.filter(x => x.caseWorkerId !== uid);
  const open = mine.filter(p => (p.status || "open") === "open");
  const stale = open.filter(p => !p.lastUpdateAt || p.lastUpdateAt < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  html(`<div class="grid">
      <div class="card stat"><span class="muted small">Cases with me</span><b>${mine.length}</b></div>
      <div class="card stat"><span class="muted small">Open</span><b>${open.length}</b></div>
      <div class="card stat"><span class="muted small">No update in a month</span><b>${stale.length}</b></div></div>
    ${handover.length ? `<div class="card" style="border-left:4px solid #C8922F"><h2>Came to you with the post (${handover.length})</h2>
      <p class="small muted">These cases were being worked by whoever held your post before you. Speak to her before you visit — she has told her story to someone else.</p>
      <div class="list">${handover.map(x => `<div class="item"><div class="grow"><div class="t">${esc(maskName(x.name, x.code))}</div>
        <div class="s">${esc(x.code || "")} · last worked by ${esc(userName(x.caseWorkerId) || "—")}</div></div>
        <button class="btn small quiet" data-open="${x.id}">Open</button><button class="btn small" data-took="${x.id}">I have spoken to her</button></div>`).join("")}</div></div>` : ""}
    ${stale.length ? `<div class="card"><h2>These need a visit or a call</h2><div class="list">
      ${stale.map(p => `<div class="item"><div class="grow"><div class="t">${esc(maskName(p.name, p.code))}</div>
        <div class="s">${esc(p.code || "")} · ${esc(p.district || "")}${p.lastUpdateAt ? " · last update " + fmtD(p.lastUpdateAt) : " · no update yet"}</div></div>
        <button class="btn small" data-open="${p.id}">Open</button></div>`).join("")}</div></div>` : ""}
    <div class="card"><h2>All my cases</h2><div class="list">
      ${mine.map(p => `<div class="item"><div class="grow"><div class="t">${esc(maskName(p.name, p.code))} ${p.status === "closed" ? `<span class="tag">closed</span>` : `<span class="tag ok">open</span>`}</div>
        <div class="s">${esc(p.code || "")} · ${esc(p.slaveryType || "")} · ${esc([p.block, p.district].filter(Boolean).join(", "))}${p.phone ? " · " + esc(p.phone) : ""}</div></div>
        <button class="btn small quiet" data-open="${p.id}">Open</button></div>`).join("") || `<div class="empty">No cases assigned to you yet. A programme lead assigns them.</div>`}</div></div>`);
  $("content").querySelectorAll("[data-open]").forEach(b => b.onclick = () => { state.personId = b.dataset.open; go("person"); });
  $("content").querySelectorAll("[data-took]").forEach(b => b.onclick = async () => {
    await db.collection("persons").doc(b.dataset.took).update({ caseWorkerId: state.user.uid, handoverDoneAt: today() });
    audit("case_handover", "persons", b.dataset.took, state.me.name); toast("Noted"); routes.mycases(); });
};

/* ================= POSSIBLE DUPLICATES =================
   Common names repeat across villages — JAINAB, Sunita, KANCHAN all appear several
   times and are different women. So a pair is only suggested when more than the name
   agrees: the guardian, the village, a phone number, an age within two years.
   Nothing is ever merged automatically. */
const dupNorm = s => String(s || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, "");
const fullName = p => dupNorm((p.name || `${p.firstName || ""} ${p.lastName || ""}`).trim());
function dupScore(a, b) {
  const reasons = []; let score = 0;
  const na = fullName(a), nb = fullName(b);
  if (!na || !nb) return { score: 0, reasons };
  if (na === nb) { score += 40; reasons.push("same name"); }
  else if (na.length > 4 && (na.includes(nb) || nb.includes(na))) { score += 25; reasons.push("one name contains the other"); }
  else return { score: 0, reasons };
  const ga = dupNorm(a.guardian || a.guardianFirst), gb = dupNorm(b.guardian || b.guardianFirst);
  if (ga && ga === gb) { score += 30; reasons.push("same guardian"); }
  const pa = String(a.phone || "").replace(/\D/g, "").slice(-10), pb = String(b.phone || "").replace(/\D/g, "").slice(-10);
  if (pa && pa.length === 10 && pa === pb) { score += 35; reasons.push("same phone"); }
  const va = dupNorm(a.block || a.village), vb = dupNorm(b.block || b.village);
  if (va && va === vb) { score += 20; reasons.push("same village"); }
  const da = dupNorm(a.district), db2 = dupNorm(b.district);
  if (da && da === db2) { score += 10; reasons.push("same district"); }
  else if (da && db2) { score -= 15; reasons.push("different district"); }
  if (a.age && b.age && Math.abs(Number(a.age) - Number(b.age)) <= 2) { score += 15; reasons.push("age within two years"); }
  else if (a.age && b.age && Math.abs(Number(a.age) - Number(b.age)) > 6) { score -= 20; reasons.push("ages far apart"); }
  const sa = dupNorm(a.slaveryType), sb = dupNorm(b.slaveryType);
  if (sa && sa === sb) { score += 5; }
  return { score, reasons };
}
routes.duplicates = async (forceRecalc) => {
  if (!canManageCases()) return html(`<div class="card"><div class="empty">Checking for duplicates belongs to the programme team.</div></div>`);
  setTitle("Possible duplicates");
  html(`<div class="card"><div class="empty">Loading…</div></div>`);

  const cacheRef = db.collection("appSettings").doc("dupPairs");
  const settledRef = db.collection("settings").doc("notDuplicates");
  const settled = new Set(((await settledRef.get().catch(() => null))?.data()?.pairs) || []);

  let pairs = [], sameName = 0, fromCache = false;

  // Try cache first (saves 900 reads every open)
  if (!forceRecalc) {
    try {
      const cached = await cacheRef.get();
      if (cached.exists && cached.data().date === today()) {
        pairs = (cached.data().pairs || []).filter(p => !settled.has(p.key));
        sameName = cached.data().sameName || 0;
        fromCache = true;
      }
    } catch(_) {}
  }

  // Calculate if no valid cache
  if (!fromCache) {
    html(`<div class="card"><div class="empty">Scanning all records… this takes a moment.</div></div>`);
    const all = (await db.collection("persons").limit(900).get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(canOpenCase);
    const byName = {};
    all.forEach(p => { const n = fullName(p); if (n) (byName[n] = byName[n] || []).push(p); });
    const rawPairs = [];
    Object.values(byName).forEach(group => {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const key = [group[i].id, group[j].id].sort().join("|");
        const { score, reasons } = dupScore(group[i], group[j]);
        if (score >= 50) rawPairs.push({ a: group[i], b: group[j], score, reasons, key });
      }
    });
    rawPairs.sort((x, y) => y.score - x.score);
    sameName = Object.values(byName).filter(g => g.length > 1).reduce((a, g) => a + g.length, 0);
    // Save to cache — store only fields needed for display + merge
    const slim = p => { const o = { id: p.id, name: p.name||null, firstName: p.firstName||null, lastName: p.lastName||null,
      code: p.code||null, guardian: p.guardian||null, guardianFirst: p.guardianFirst||null, phone: p.phone||null,
      age: p.age||null, block: p.block||null, district: p.district||null, state: p.state||null,
      slaveryType: p.slaveryType||null, registeredOn: p.registeredOn||null,
      altCodes: p.altCodes||[], files: p.files||[], notes: p.notes||"",
      officeId: p.officeId||null, caseWorkerId: p.caseWorkerId||null };
      Object.keys(o).forEach(k=>{ if(o[k]===undefined) o[k]=null; }); return o; };
    const cachePairs = rawPairs.map(p => ({ a: slim(p.a), b: slim(p.b), score: p.score, reasons: p.reasons, key: p.key }));
    db.collection("appSettings").doc("dupPairs").set({ pairs: cachePairs, sameName, date: today(), count: cachePairs.length }).catch(() => {});
    pairs = rawPairs.filter(p => !settled.has(p.key));
  }
  const line = (l, x, y) => `<tr><td class="small muted">${l}</td><td>${esc(x || "—")}</td><td>${esc(y || "—")}</td></tr>`;
  html(`<div class="card"><h2>Possible duplicates</h2>
      <p class="small muted">${sameName} records share a name with another, but a name alone means little —
        JAINAB, Sunita and KANCHAN each appear several times in different villages and are different women.
        Only pairs where more than the name agrees are shown here.</p>
      <p><span class="tag ${pairs.length ? "warn" : "ok"}">${pairs.length} to look at</span>
        <span class="tag">900 records</span>
        ${fromCache ? `<span class="tag muted small">From today's cache</span>` : `<span class="tag ok small">Freshly calculated</span>`}
        <button class="btn small quiet" id="recalcDup" style="margin-left:4px">↻ Recalculate</button></p></div>
    ${pairs.slice(0, 40).map(p => `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <b>${esc(maskName(p.a.name, p.a.code))}</b>
        <span class="tag ${p.score >= 85 ? "bad" : "warn"}">${p.score >= 85 ? "very likely the same" : "might be the same"} · ${p.reasons.join(", ")}</span></div>
      <div class="tablewrap"><table class="table">
        <tr><th></th><th>${esc(p.a.code)}</th><th>${esc(p.b.code)}</th></tr>
        ${line("Name", p.a.name, p.b.name)}
        ${line("Guardian", p.a.guardian || p.a.guardianFirst, p.b.guardian || p.b.guardianFirst)}
        ${line("Age", p.a.age, p.b.age)}
        ${line("Phone", p.a.phone, p.b.phone)}
        ${line("Village / block", p.a.block, p.b.block)}
        ${line("District", p.a.district, p.b.district)}
        ${line("Type", p.a.slaveryType, p.b.slaveryType)}
        ${line("Registered", fmtD(p.a.registeredOn), fmtD(p.b.registeredOn))}</table></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn small quiet" data-open="${p.a.id}">Open ${esc(p.a.code)}</button>
        <button class="btn small quiet" data-open="${p.b.id}">Open ${esc(p.b.code)}</button>
        <button class="btn small" data-merge="${p.a.id}|${p.b.id}">They are the same woman</button>
        <button class="btn small quiet" data-not="${p.key}">Different women</button></div></div>`).join("")
      || `<div class="card"><div class="empty">Nothing that looks like a duplicate.</div></div>`}
    ${pairs.length > 40 ? `<div class="card"><p class="small muted">Showing the 40 most likely of ${pairs.length}.</p></div>` : ""}`);
  $("content").querySelectorAll("[data-open]").forEach(b => b.onclick = () => { state.personId = b.dataset.open; go("person"); });
  if ($("recalcDup")) $("recalcDup").onclick = () => routes.duplicates(true);
  $("content").querySelectorAll("[data-not]").forEach(b => b.onclick = async () => {
    const ref = db.collection("settings").doc("notDuplicates");
    const cur = (await ref.get().catch(() => null))?.data()?.pairs || [];
    await ref.set({ pairs: [...cur, b.dataset.not] }, { merge: true });
    toast("Noted — they will not be suggested again"); routes.duplicates(); });
  $("content").querySelectorAll("[data-merge]").forEach(b => b.onclick = async () => {
    const [idA, idB] = b.dataset.merge.split("|");
    const pair = pairs.find(p => (p.a.id===idA&&p.b.id===idB)||(p.a.id===idB&&p.b.id===idA));
    const a = pair?.a, bb = pair?.b;
    const keep = prompt(`Which Sakhi ID should the merged file keep?\n\n1 — ${a.code}\n2 — ${bb.code}\n\nType 1 or 2.`);
    if (keep !== "1" && keep !== "2") return;
    const master = keep === "1" ? a : bb, other = keep === "1" ? bb : a;
    if (!confirm(`Merge ${other.code} into ${master.code}?\n\nEverything recorded against ${other.code} — benefits, updates, documents — moves to ${master.code}. The old Sakhi ID is kept on the file so papers still match. This cannot be undone.`)) return;
    try {
      b.disabled = true; b.textContent = "Merging…";
      await mergeCases(master, other);
      successFlash("Merged"); window.scrollTo({top:0,behavior:"smooth"}); setTimeout(()=>routes.duplicates(), 600);
    } catch(e) {
      b.disabled = false; b.textContent = "They are the same woman";
      toast("Could not merge — " + (e.message || e.code || e));
      console.error("mergeCases error:", e);
    }
  });
};
/* Move everything from one case file to another, keeping the old ID on the record. */
async function mergeCases(master, other) {
  for (const col of ["benefits", "caseUpdates", "cases", "groupMembers"]) {
    const rows = await db.collection(col).where("personId", "==", other.id).limit(400).get().catch(() => ({ docs: [] }));
    if (!rows.docs.length) continue;
    const b = db.batch();
    rows.docs.forEach(d => b.update(d.ref, { personId: master.id, movedFrom: other.code }));
    await b.commit();
  }
  const merged = {
    altCodes: [...new Set([...(master.altCodes || []), other.code, ...(other.altCodes || [])])].filter(Boolean),
    files: [...(master.files || []), ...(other.files || [])],
    notes: [master.notes, other.notes && `— from ${other.code}: ${other.notes}`].filter(Boolean).join("\n"),
    phone: master.phone || other.phone, age: master.age || other.age,
    guardian: master.guardian || other.guardian, block: master.block || other.block,
    mergedAt: today(), mergedBy: state.user.uid
  };
  Object.keys(merged).forEach(k => { if (merged[k] === undefined || merged[k] === null) delete merged[k]; });
  await db.collection("persons").doc(master.id).update(merged);
  await db.collection("persons").doc(other.id).delete();
  audit("merge", "persons", master.id, `${other.code} → ${master.code}`);
}

/* ================= CASE IDs =================
   Your own format: EP-HR/YN/MW/01-2022
     EP   Empower People
     HR   state
     YN   district
     MW   where she was found or the block
     01   the serial within that district and year
     2022 the year she was registered
   A record arriving without an ID — from an import or a hurried entry — is given
   one in the same shape, so nothing sits in the register unfindable. */
const STATE_CODE = { Haryana: "HR", Bihar: "BR", Assam: "AS", Delhi: "DL", "Uttar Pradesh": "UP",
  "West Bengal": "WB", Jharkhand: "JH", Punjab: "PB", Rajasthan: "RJ", "Himachal Pradesh": "HP" };
const DISTRICT_CODE = { Yamunanagar: "YN", Panipat: "PT", Jind: "JD", Mahendragarh: "MG", Karnal: "KA",
  Gaya: "GY", Katihar: "KT", Dhubri: "DH", Kokrajhar: "KK", Sherghati: "SG", Bilaspur: "BP" };
/* Two letters for anything not in the list: first letter, then the next consonant. */
function twoLetterCode(name, fallback) {
  const s = String(name || "").trim();
  if (!s) return fallback || "XX";
  const up = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (!up) return fallback || "XX";
  const second = up.slice(1).split("").find(c => !"AEIOU".includes(c)) || up[1] || "X";
  return (up[0] + second).slice(0, 2);
}
const districtCode = d => DISTRICT_CODE[String(d || "").trim()] || twoLetterCode(d, "XX");
const stateCode = s => STATE_CODE[String(s || "").trim()] || twoLetterCode(s, "XX");
/** Work out the next Sakhi ID for a person, counting what already exists. */
function buildCaseId(p, existing, counters) {
  const st = stateCode(p.state), di = districtCode(p.district);
  const where = p.block ? twoLetterCode(p.block) : (p.source && /rescue|raid/i.test(p.source) ? "RS" : "GN");
  const year = String(p.registeredOn || "").slice(0, 4) || String(p.registeredYear || "") || String(new Date().getFullYear());
  const key = `${st}/${di}/${year}`;
  if (counters[key] === undefined) {
    // start after the highest serial already used in that district and year
    counters[key] = existing.filter(x => String(x.code || "").includes(`${st}/${di}/`) && String(x.code || "").endsWith("-" + year))
      .reduce((max, x) => { const m = String(x.code).match(/\/(\d+)-\d{4}$/); return m ? Math.max(max, Number(m[1])) : max; }, 0);
  }
  counters[key] += 1;
  return `EP-${st}/${di}/${where}/${String(counters[key]).padStart(2, "0")}-${year}`;
}
routes.caseIds = async () => {
  if (!canManageCases()) return html(`<div class="card"><div class="empty">Case IDs are given by the programme team.</div></div>`);
  setTitle("Records without a Sakhi ID");
  const all = (await db.collection("persons").limit(900).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const missing = all.filter(p => !String(p.code || "").trim());
  const counters = {};
  const proposed = missing.map(p => ({ p, code: buildCaseId(p, all, counters) }));
  /* Anything that is not the official spelling for its state, with what it should be. */
  const offSpelling = [...new Set(all.map(p => `${p.state || ""}|${p.district || ""}`))]
    .map(k => { const [st, di] = k.split("|"); if (!di) return null;
      const f = fixPlace(st, di); return f.corrected ? { state: st, was: di, right: f.district, rightState: f.state,
        count: all.filter(p => (p.district || "") === di && (p.state || "") === st).length } : null; })
    .filter(Boolean);
  const likeThis = [...new Set(all.map(p => p.district).filter(Boolean))].slice(0, 8)
    .map(d => `${esc(d)} → <b>${districtCode(d)}</b>`).join(" · ");
  html(`<div class="card"><h2>Records without a Sakhi ID</h2>
      <p class="small muted">A record with no ID cannot be found by its number, printed as a case file, or matched when support is recorded.
        These are given an ID in your own shape — <b>EP-HR/YN/MW/01-2022</b> — numbered after the highest already used in that district and year.</p>
      <p><span class="tag ${missing.length ? "warn" : "ok"}">${missing.length} without an ID</span>
        <span class="tag">${all.length - missing.length} already have one</span></p>
      <p class="small muted">District letters: ${likeThis}</p></div>
    ${offSpelling.length ? `<div class="card" style="border-left:4px solid #C8922F"><h2>District names that are not the official spelling</h2>
      <p class="small muted">Checked against the district list for each state. A misspelling splits every count and gives a different Sakhi ID.</p>
      <div class="list">${offSpelling.map(x => `<div class="item"><div class="grow">
        <div class="t">${esc(x.was)} → <b>${esc(x.right)}</b>${x.rightState !== x.state ? ` <span class="tag">${esc(x.rightState)}</span>` : ""}</div>
        <div class="s">${x.count} record${x.count === 1 ? "" : "s"}${x.state ? " · " + esc(x.state) : ""}</div></div>
        <button class="btn small" data-fixsp="${esc(x.state + "|" + x.was + "|" + x.right + "|" + x.rightState)}">Put it right</button></div>`).join("")}</div>
      <button class="btn small" id="fixAllSp" style="margin-top:8px">Put all ${offSpelling.length} right</button></div>` : ""}
    ${missing.length ? `<div class="card"><h2>What they would be given</h2>
      <div class="tablewrap"><table class="table"><tr><th>Name</th><th>District</th><th>Village / block</th><th>Proposed Sakhi ID</th></tr>
        ${proposed.slice(0, 25).map(x => `<tr><td>${esc(maskName(x.p.name || `${x.p.firstName || ""} ${x.p.lastName || ""}`, x.code))}</td>
          <td>${esc(x.p.district || "—")}</td><td>${esc(x.p.block || "—")}</td>
          <td style="font-family:monospace">${esc(x.code)}</td></tr>`).join("")}</table></div>
      ${proposed.length > 25 ? `<p class="small muted">Showing 25 of ${proposed.length}.</p>` : ""}
      <button class="btn" id="giveIds" style="margin-top:10px">Give all ${missing.length} an ID</button>
      <p class="small muted" style="margin-top:6px">The ID is written onto the record and never changes afterwards.</p></div>`
      : `<div class="card"><div class="empty">Every record has a Sakhi ID.</div></div>`}`);
  const putRight = async list => { let n = 0;
    for (const x of list) {
      const rows = all.filter(p => (p.district || "") === x.was && (p.state || "") === x.state);
      for (let i = 0; i < rows.length; i += 400) { const b2 = db.batch();
        rows.slice(i, i + 400).forEach(p => b2.update(db.collection("persons").doc(p.id),
          { district: x.right, state: x.rightState, districtAsGiven: x.was })); await b2.commit(); n += rows.length; }
      audit("spelling", "persons", null, `${x.was} → ${x.right}`);
    }
    toast(`${n} record${n === 1 ? "" : "s"} corrected`); routes.caseIds(); };
  $("content").querySelectorAll("[data-fixsp]").forEach(b => b.onclick = () => {
    const [st, was, right, rightState] = b.dataset.fixsp.split("|");
    putRight([{ state: st, was, right, rightState }]); });
  if ($("fixAllSp")) $("fixAllSp").onclick = () => {
    if (!confirm(`Put ${offSpelling.length} district spellings right across every record?`)) return;
    putRight(offSpelling); };
  if ($("giveIds")) $("giveIds").onclick = async () => {
    if (!confirm(`Give ${missing.length} records a Sakhi ID?\n\nEach keeps it permanently. Nothing else about them changes.`)) return;
    $("giveIds").disabled = true; $("giveIds").textContent = "Writing…";
    for (let i = 0; i < proposed.length; i += 400) { const b = db.batch();
      proposed.slice(i, i + 400).forEach(x => b.update(db.collection("persons").doc(x.p.id),
        { code: x.code, codeGivenBy: state.user.uid, codeGivenOn: today() }));
      await b.commit(); }
    audit("case_ids", "persons", null, `${proposed.length} given an ID`);
    toast(`${proposed.length} given a Sakhi ID`); routes.caseIds(); };
};
