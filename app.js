
/** What to show where a post would go. A volunteer or community leader holds no post
 *  by design — saying "no post" against her name makes a settled arrangement look
 *  like an oversight. */
function standingOf(u) {
  if (!u) return "";
  /* The roles a person holds, in the words of the roles list, with the post first if
     they hold one. Somebody can be a Board member and the safeguarding officer, or a
     volunteer and field staff at once — all of it shows. */
  const QUIET = ["observer"];                       // says nothing useful on a name
  const named = (u.roles || []).filter(r => !QUIET.includes(r))
    .map(r => (typeof ROLES !== "undefined" && ROLES[r]) || "")
    .filter(Boolean);
  const bits = [];
  if (u.postTitle) bits.push(u.postTitle);
  named.forEach(n => { if (!bits.some(b => b.toLowerCase() === n.toLowerCase())) bits.push(n); });
  return bits.join(" · ") || u.designation || "";
}

/* ---------- taking a file from a form ----------
   Images are compressed so they travel on a village connection; a PDF or anything else
   is kept whole. Never silently: if it cannot be taken, the person is told. */
async function fileToStore(f, px, q, folder) {
  if (!f || !f.size) return null;
  folder = folder || "admin";
  // Try Apps Script proxy first — runs as post@empowerpeople.in, no user OAuth needed
  const scriptUrl = (state.drive || {}).uploadUrl || (state.settings || {}).uploadUrl || "";
  if (scriptUrl) {
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      const fd = new FormData();
      fd.append("folder", folder);
      fd.append("name", f.name);
      fd.append("mime", f.type || "application/octet-stream");
      fd.append("data", b64.includes(",") ? b64.split(",").slice(1).join(",") : b64);
      const resp = await fetch(scriptUrl, { method: "POST", body: fd });
      const j = await resp.json();
      if (j.ok) return { name: j.name, link: j.link, url: j.link, webViewLink: j.link, id: j.id };
      throw new Error(j.error || "Script upload failed");
    } catch (scriptErr) {
      console.warn("Script upload failed, falling back to Drive OAuth:", scriptErr.message);
    }
  }
  // Fallback: save to Firebase Storage → driveQueue for Sunday migration
  try {
    const path = "pending/" + folder + "/" + Date.now() + "_" + f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ref = firebase.storage().ref(path);
    await ref.put(f);
    const url = await ref.getDownloadURL();
    // Queue for retryDriveQueue (runs every Sunday) to move to Drive
    await db.collection("driveQueue").add({
      storagePath: path, driveFolder: folder, driveName: f.name,
      driveMime: f.type || "application/octet-stream",
      status: "pending", createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("Saved locally — will move to Drive when connection improves ☁️");
    return { name: f.name, url: url, link: url, webViewLink: url, _pending: true };
  } catch (storErr) {
    console.error("fileToStore: Drive and Firebase Storage both failed:", storErr.message);
    toast("Could not save " + f.name + " — check your connection and try again");
    return null;
  }
}
/* Upload a file input by id to Drive, return {name,link,id} or null */
async function uploadField(inputId, folderKey, nameHint) {
  const el = typeof inputId === "string" ? $(inputId) : inputId;
  if (!el || !el.files || !el.files[0]) return null;
  const note = $(inputId + "_note");
  if (note) note.textContent = "Uploading…";
  try {
    const res = await uploadToDrive(el.files[0], folderKey || "admin", nameHint || "");
    if (note) note.innerHTML = `<a href="${res.link}" target="_blank" rel="noopener">uploaded ✓</a>`;
    return res;
  } catch(e) {
    if (note) note.textContent = "Upload failed: " + e.message;
    toast("Could not upload — " + e.message);
    return null;
  }
}
/* ===== 1. CONFIGURE — paste from Firebase console → Project settings → Your apps → Web app ===== */
const firebaseConfig = {
  apiKey: "AIzaSyBz7Uqepe_qjOzLtL7myh6wNtAbF73th8I",
  authDomain: "ep-office-a9d09.firebaseapp.com",
  projectId: "ep-office-a9d09",
  storageBucket: "ep-office-a9d09.firebasestorage.app",
  messagingSenderId: "21622493707",
  appId: "1:21622493707:web:d40ae29de42f2c8d7d6d0e"
};
/* ============================================================================================= */

const ROLES = {
  super_admin: "App Super Admin",
  director_acf: "Director ACF", founder: "Founder & General Secretary", counsellor: "Counsellor",
  accountant: "Accountant",
  procurement: "Procurement",
  admin: "Coordinator – Administration & Communication",
  admin_assistant: "Admin Assistant",
  program_officer: "Program Officer",
  program_coord: "Program Coordination Lead",
  program_lead: "Programme Lead / Coordinator",
  field_staff: "Field staff",
  fundraising: "Coordinator – Fundraising, Research & Innovation",
  compliance_head: "Compliance",
  board: "Governing Board / Advisory Board",
  volunteer: "Volunteer / Community leader",
  posh: "Internal Committee (POSH)",
  dso: "Designated Safeguarding Officer",
  cpo: "Child Protection Officer",
  posh_chair: "Presiding Officer – POSH",
  posh_external: "External Member – POSH",
  observer: "Observer (read only)",
  support_staff: "Support staff / driver",
  fellow: "Fellow"
};
// Earlier names keep working so nobody loses access on the day of the change
const ROLE_ALIAS = { hr_manager: "admin", program_manager: "program_coord", program_head: "program_officer",
  program_staff: "field_staff", finance_manager: "director_acf", director_acf: "director_acf", management: "board", founder: "founder", counsellor: "counsellor",
  fundraising_head: "fundraising", grievance_committee: "posh" };
const isActive = () => !!(state.me && state.me.active);
/* Where an office is, and how close you must be to check in there. */
function parseLatLng(d) { const m = String(d.latlng || "").match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  d.lat = m ? Number(m[1]) : null; d.lng = m ? Number(m[2]) : null; d.radius = d.radius ? Number(d.radius) : null; delete d.latlng; return d; }
function metresBetween(a, b, c, d) { const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h))); }
/* ================= ASSET TAGS, QR LABELS AND VERIFICATION =================
   Tag: EP / LAP / F / LBF / 2026-27 / 0007
   EP       Empower People
   LAP      type of asset
   F        how it came — F purchased under an FCRA project · N purchased from non-FCRA foreign funds
            · D purchased from domestic funds · G donated in kind · O the organisation's own funds
   LBF      the donor: who paid for it, or who gave it. ORG where the organisation itself paid.
   2026-27  the financial year it came in
   0007     the serial                                                                            */
const FUND_LETTER = { "Purchased under an FCRA project": "F", "FCRA": "F",
  "Purchased from non-FCRA foreign funds": "N", "Non-FCRA (foreign source)": "N", "Non-FCRA (foreign source, e.g. UN)": "N",
  "Purchased from domestic funds": "D", "Domestic": "D",
  "Donated in kind": "G", "Own funds of the organisation": "O", "Own fund": "O" };
const FUND_SOURCES = ["Purchased under an FCRA project", "Purchased from non-FCRA foreign funds",
  "Purchased from domestic funds", "Donated in kind", "Own funds of the organisation"];
const CAT_LETTER = s => (String(s || "").match(/\((\w+)\)/) || [])[1] || "OTH";
const shortCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
const fyOfDate = d => { const x = d ? new Date(d) : new Date(); const y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`; };
/* The donor is taken from the project it was bought under, so nobody types it twice.
   A donated item carries the giver's code; ORG where the organisation paid itself. */
function donorCodeFor(a) {
  if (a.fundSource === "Donated in kind") return shortCode(a.donorCode || a.donor) || "DONATED";
  if (a.fundSource === "Own funds of the organisation" || a.fundSource === "Own fund") return "ORG";
  const p = state.projects.find(x => x.id === a.projectId);
  return shortCode(p && (p.donorCode || p.donor)) || "ORG";
}
function assetTag(a) {
  return `EP/${CAT_LETTER(a.category)}/${FUND_LETTER[a.fundSource] || "D"}/${donorCodeFor(a)}/${fyOfDate(a.boughtOn)}/${String(a.serial || "").padStart(4, "0")}`;
}

const FUND_TYPES = ["FCRA", "Non-FCRA (foreign source, e.g. UN)", "Domestic"];
const RESTRICTIONS = ["Project", "Core support / unrestricted"];
const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Leave without pay"];
const COST_HEADS = ["Travel and conveyance", "Travel and accommodation", "Refreshment and meeting", "Office consumables", "Printing", "Beneficiary support", "Banners and materials", "Telephone and mobile", "Other"];

/* ---------- Strings (Staff screens carry Hindi; management screens are English in phase 1) ---------- */
const T = {
  en: { signInPhone:"Phone number", signInPhoneSub:"A code comes to you by SMS", signInGoogle:"Google", signInGoogleSub:"Use your Google account", signInEmail:"Email", signInEmailSub:"Email address and password", yourNumber:"Your mobile number", theCode:"The code from the SMS", home:"Home", checkin:"Check in", checkout:"Check out", checkedIn:"Checked in at", dayReport:"Day report", leave:"Leave", expense:"Expense claim",
        approvals:"Approvals", profile:"Profile", todayActions:"Today", waiting:"Waiting on you", myRecent:"My recent entries",
        location:"Where were you", activities:"What did you do", persons:"Whom did you meet", followups:"Follow-ups", submit:"Submit",
        from:"From", to:"To", type:"Type", reason:"Reason", amount:"Amount (₹)", description:"Description", project:"Project", costHead:"Cost head", receipt:"Receipt photo",
        saved:"Saved", pending:"Pending", approved:"Approved", rejected:"Rejected", cancelled:"Cancelled", submitted:"Submitted", manager_approved:"Manager approved", paid:"Paid", returned:"Returned",
        nothing:"Nothing here yet", cancel:"Cancel", approve:"Approve", reject:"Reject", return:"Return", markPaid:"Mark paid", days:"days", useLocation:"Use my location", locationOff:"Location not shared" },
  hi: { signInPhone:"फ़ोन नंबर", signInPhoneSub:"कोड एसएमएस से आएगा", signInGoogle:"गूगल", signInGoogleSub:"अपना गूगल खाता", signInEmail:"ईमेल", signInEmailSub:"ईमेल और पासवर्ड", yourNumber:"अपना मोबाइल नंबर", theCode:"एसएमएस में आया कोड", home:"होम", checkin:"चेक-इन", checkout:"चेक-आउट", checkedIn:"चेक-इन हुआ", dayReport:"दिन की रिपोर्ट", leave:"छुट्टी", expense:"खर्च का दावा",
        approvals:"मंज़ूरी", profile:"प्रोफ़ाइल", todayActions:"आज", waiting:"आपके इंतज़ार में", myRecent:"मेरी हाल की एंट्री",
        location:"आप कहाँ थे", activities:"आपने क्या किया", persons:"किनसे मिले", followups:"आगे का काम", submit:"जमा करें",
        from:"से", to:"तक", type:"प्रकार", reason:"कारण", amount:"राशि (₹)", description:"विवरण", project:"प्रोजेक्ट", costHead:"खर्च का मद", receipt:"रसीद की फ़ोटो",
        saved:"सहेजा गया", pending:"लंबित", approved:"मंज़ूर", rejected:"अस्वीकृत", cancelled:"रद्द", submitted:"जमा", manager_approved:"मैनेजर से मंज़ूर", paid:"भुगतान हुआ", returned:"वापस",
        nothing:"अभी यहाँ कुछ नहीं", cancel:"रद्द करें", approve:"मंज़ूर करें", reject:"अस्वीकार", return:"वापस भेजें", markPaid:"भुगतान दर्ज करें", days:"दिन", useLocation:"मेरी लोकेशन लें", locationOff:"लोकेशन साझा नहीं" }
};
let lang = localStorage.getItem("ep.lang") || "en";  // kept for date formatting; the picker lives in i18n.js
/* A language the dictionary does not carry must never break the app —
   fall back to English for anything missing, word by word. */
/* Words on the sign-in page, before anyone has signed in. */
function paintSignInWords() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const v = t(el.dataset.i18n); if (v && v !== el.dataset.i18n) el.textContent = v; });
}
const t = k => (T[lang] && T[lang][k]) ?? T.en[k] ?? k;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Convert a Google Drive view link to a direct-renderable image URL
const driveImg = url => {
  if (!url) return "";
  if (url.startsWith('data:')) return url;
  const s = String(url);
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w800" : url;
};
// Force app update — clears service worker cache and reloads
async function forceAppUpdate() {
  const btn = document.getElementById("updateAppBtn");
  if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(()=>null);
      if (reg) await reg.update().catch(()=>{});
    }
    if ("caches" in window) {
      const keys = await caches.keys().catch(()=>[]);
      await Promise.all(keys.map(k => caches.delete(k))).catch(()=>{});
    }
  } catch(e) {}
  window.location.reload(true);
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); window.deferredPrompt = e; });
// Surface all silent failures — catches any unhandled promise rejection anywhere in the app
// Auto-log activity to day report — called after every key save, no button needed
// Like autoLogActivity but only adds to an EXISTING day report stub — never creates one.
// Use this for activity logging that should not trigger report creation (benefits, case updates, etc.)
async function autoLogActivityIfExists(text) {
  try {
    if (!state.user?.uid || !state.me) return;
    const uid = state.user.uid;
    const dateStr = today();
    const existing = await db.collection("dayReports")
      .where("uid","==",uid).where("date","==",dateStr).limit(1).get().catch(()=>({docs:[]}));
    if (!existing.docs.length) return; // no stub yet — do nothing
    const doc = existing.docs[0];
    const items = doc.data().items || [];
    if (!items.includes(text)) {
      await db.collection("dayReports").doc(doc.id).update({
        items: [...items, text],
        lastAutoAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(()=>{});
    }
  } catch(e) {}
}

async function autoLogActivity(text) {
  try {
    if (!state.user?.uid || !state.me) return;
    const uid = state.user.uid;
    const dateStr = today();
    const existing = await db.collection("dayReports")
      .where("uid","==",uid).where("date","==",dateStr).limit(1).get().catch(()=>({docs:[]}));
    if (existing.docs.length) {
      const doc = existing.docs[0];
      const items = doc.data().items || [];
      // Avoid exact duplicates
      if (!items.includes(text)) {
        await db.collection("dayReports").doc(doc.id).update({
          items: [...items, text],
          status: doc.data().status || "submitted",
          lastAutoAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(()=>{});
      }
    } else {
      // Use deterministic ID to prevent race-condition duplicates when many events fire at once
      const docId = `dr_${uid}_${dateStr}`;
      await db.collection("dayReports").doc(docId).set({
        uid, date: dateStr, name: state.me.name,
        managerIds: (state.me.managerIds||[]),
        items: firebase.firestore.FieldValue.arrayUnion(text), narrative: "",
        status: "auto", autoGenerated: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastAutoAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(()=>{});
    }
    // Also append to active journey if one is in progress
    if (state.activeJourney) {
      await db.collection("journeys").doc(state.activeJourney).update({
        activityLog: firebase.firestore.FieldValue.arrayUnion({
          text, time: new Date().toTimeString().slice(0,5), ts: Date.now()
        })
      }).catch(()=>{});
    }
  } catch(_) {}
}

function logError(err, context) {
  try {
    if (!err || !db || !firebase?.auth?.().currentUser) return;
    const msg = err.message || String(err);
    if (msg.includes("TEST_DELETE")) return; // skip test writes
    db.collection("appLogs").add({
      uid: firebase.auth().currentUser?.uid || null,
      name: state.me?.name || "Unknown",
      roles: state.me?.roles || [],
      route: state.route || "unknown",
      error: msg.slice(0, 500),
      errorCode: err.code || null,
      context: context || null,
      device: navigator.userAgent.slice(0, 150),
      resolved: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {}); // never let logging itself cause an error
  } catch(_) {}
}

window.addEventListener("unhandledrejection", event => {
  const err = event.reason;
  if (!err) return;
  const msg = err.code === "permission-denied" ? "Could not save — you don't have permission. Contact your administrator."
    : err.code === "unavailable" ? "No connection — please check your internet and try again."
    : err.code === "not-found" ? "Record not found — it may have been deleted."
    : (err.message || String(err));
  if (typeof toast === "function") toast("⚠ " + msg);
  logError(err, "unhandled");
  console.error("Unhandled rejection:", err);
  event.preventDefault();
});
const friendlyAuth = e => ({
  "auth/invalid-phone-number": "That mobile number doesn't look right. Enter the 10 digits only.",
  "auth/invalid-email": "That mobile number doesn't look right. Enter the 10 digits only.",
  "auth/billing-not-enabled": "SMS sign-in isn't available. Use your mobile number with a password instead.",
  "auth/too-many-requests": "Too many attempts from this device. Wait a few minutes and try again.",
  "auth/invalid-verification-code": "That code is wrong. Check the SMS and type it again.",
  "auth/code-expired": "The code has expired — send a new one.",
  "auth/quota-exceeded": "The daily SMS limit has been reached. Sign in with Google or email today, or ask the office.",
  "auth/wrong-password": "Wrong password.", "auth/user-not-found": "No account with that email yet — use 'Create an account'.",
  "auth/email-already-in-use": "That email already has an account — sign in instead.",
  "auth/weak-password": "Choose a password of at least 6 characters.",
  "auth/captcha-check-failed": "The robot check failed. Reload the page and try again."
}[e.code] || e.message);
const today = () => new Date().toLocaleString("sv-SE",{timeZone:"Asia/Kolkata"}).slice(0,10);
const fmtDate = d => d ? new Date(d.seconds ? d.seconds*1000 : d).toLocaleDateString("en-IN", {day:"numeric", month:"short", year:"numeric"}) : "";
const toast = m => { const el = $("toast"); el.textContent = m; el.classList.remove("hidden"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add("hidden"), 2500); };
const successFlash = (msg) => {
  const existing = document.getElementById("successFlash");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "successFlash";
  el.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);animation:sfIn .2s ease";
  el.innerHTML = `<div style="background:#fff;border-radius:20px;padding:36px 48px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.18);min-width:220px;animation:sfPop .25s cubic-bezier(.34,1.56,.64,1)">
    <div style="font-size:72px;line-height:1;margin-bottom:12px">✅</div>
    <div style="font-size:17px;font-weight:600;color:#1a1a1a;max-width:260px">${msg||"Done"}</div>
  </div>`;
  if (!document.getElementById("sfStyle")) {
    const s = document.createElement("style"); s.id = "sfStyle";
    s.textContent = "@keyframes sfIn{from{opacity:0}to{opacity:1}}@keyframes sfPop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}";
    document.head.appendChild(s);
  }
  document.body.appendChild(el);
  el._t = setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2500);
  el.onclick = () => { clearTimeout(el._t); el.remove(); };
};

/* ---------- Firebase ---------- */
let auth, db;
const state = { user: null, me: null, offices: [], projects: [], users: [], route: "home" };
/* The Founder can look at the app through someone else's role, to see what they see.
   It changes what the screens show, never what the database allows, and nothing can
   be saved while looking. */
/* Somebody checking an identity card is not a member of staff and has no account. */
const isCardCheck = () => /^#card=/.test(location.hash || "");
const viewingAs = () => state.viewAs || null;
/* When looking as a named person, their reporting line is used too, so "my team"
   means their team and not yours. Looking as a bare role keeps your own line. */
const viewUid = () => (state.viewAs && state.viewAs.uid) || state.user.uid;
const has = (...r) => {
  const v = viewingAs();
  const src = v ? v.roles : (state.me?.roles || []);
  const mine = new Set(src.map(x => ROLE_ALIAS[x] || x));
  return r.some(x => mine.has(ROLE_ALIAS[x] || x));
};
const reallySuper = () => new Set((state.me?.roles || []).map(x => ROLE_ALIAS[x] || x)).has("super_admin");
const isSuper = () => has("super_admin");
/* Procurement: the people who buy and arrange things. */
const isProcurement = () => has("super_admin", "procurement", "admin");
const isAdmin = () => has("super_admin", "admin");           // department-level Office Admin
const HATS = { founder: "Founder & General Secretary", appAdmin: "App Super Admin" };
const hat = () => localStorage.getItem("ep.hat") || (has("founder") ? "founder" : "appAdmin");
function wearHat(h) { localStorage.setItem("ep.hat", h); audit("hat", "session", null, HATS[h] || h);
  buildNav(); paintHat(); go("home"); }
function paintHat() {
  /* A small word in the header, only while the administrator's hat is on, so nobody
     forgets they are in the mode that can change the organigram. The switch itself
     lives in the menu. */
  const old = document.getElementById("hatBar"); if (old) old.remove();
  document.body.classList.remove("hatted");
  let mark = document.getElementById("hatMark");
  const on = has("super_admin") && hat() === "appAdmin";
  if (!on) { if (mark) mark.remove(); return; }
  if (!mark) { mark = document.createElement("span"); mark.id = "hatMark"; mark.className = "hatmark";
    const who = document.querySelector(".who, #whoami, header .sub") || document.querySelector("header");
    if (who) who.appendChild(mark); }
  mark.textContent = "App Super Admin";
}
/* App administration belongs to the App Super Admin hat. Approving payments, authorising
   above ₹50,000 and everything else of the organisation stays with the Founder's hat. */
const isApp = () => has("super_admin") && hat() === "appAdmin";

/* Roles the organisation has added for itself. Loaded at sign-in and folded into the
   built-in list, so a new role behaves exactly like one written into the app. */
async function loadOwnRoles() {
  try {
    const s = await db.collection("roles").get();
    state.ownRoles = s.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ownRoles.forEach(r => { if (r.key && r.label) ROLES[r.key] = r.label; });
  } catch { state.ownRoles = []; }
}
/** The screens a person's own-added roles open, beyond the built-in rules. */
function ownRoleScreens() {
  const mine = (state.me.roles || []);
  return (state.ownRoles || []).filter(r => mine.includes(r.key))
    .flatMap(r => r.screens || []);
}
/* An observer may open the app and read it, and change nothing at all.
   Enforced in the database too, not only by hiding buttons. */
const isObserver = () => has("observer") && !has("super_admin");
const progTop = () => has("super_admin", "program_officer");                       // Program Officer and above
const progCoord = () => has("super_admin", "program_officer", "program_coord");    // + Coordination Lead
const progLead = () => has("super_admin", "program_officer", "program_coord", "program_lead"); // + programme leads
const progAny = () => progLead() || has("field_staff");

/* Scope by reporting line: you see your own work and the work of everyone below you.
   The reporting authority of a programme or function sees everything within it. */
const mgrsOf = u => (u && (u.managerIds || (u.managerId ? [u.managerId] : []))) || [];
function myLine() {                       // uids of me and everyone reporting up to me, at any depth
  const out = new Set([state.user.uid]);
  let grew = true;
  while (grew) { grew = false;
    state.users.forEach(u => { if (!out.has(u.id) && mgrsOf(u).some(m => out.has(m))) { out.add(u.id); grew = true; } }); }
  return out;
}
let _lineCache = null, _lineAt = 0;
const lineUids = () => { const now = Date.now(); if (!_lineCache || now - _lineAt > 20000) { _lineCache = myLine(); _lineAt = now; } return _lineCache; };
const seesWholeOrg = () => has("super_admin", "board");
/* Who may be named as somebody's reporting manager: an approved person holding a post.
   Volunteers, community leaders and people with no post are not reporting authorities. */
const canBeManager = u => !!u && u.active === true && u.status !== "pending"
  && !(u.roles || []).map(r => ROLE_ALIAS[r] || r).includes("volunteer")
  && (!!u.postId || (u.roles || []).map(r => ROLE_ALIAS[r] || r).some(r => ["super_admin", "founder", "director_acf", "program_head", "fundraising", "admin", "accountant", "procurement", "compliance_head", "board"].includes(r)));
const managerChoices = () => state.users.filter(canBeManager);
/* Staff = people employed or engaged in a post. Volunteers, community leaders and
   board or advisory members are not staff and stay out of HR listings. */
const NON_STAFF_ROLES = ["volunteer", "board", "super_admin", "founder"];
const NON_STAFF_JOIN = ["volunteer", "community", "board"];
const canWrite = () => !isObserver() && !viewingAs();
/* Records belong to the post; the person who acted is stamped on them.
   When a post changes hands, everything the post owns moves with it. */
const myPost = () => state.me.postId || null;
const stamp = d => ({ ...d, postId: myPost(), postTitle: state.me.postTitle || null, byPerson: state.user.uid, byName: state.me.name });
/* A record is mine if my post owns it, or I am named on it. */
/* A record that belongs to a place: seen by the team working in that state,
   and by programme leadership. Used by groups, and by anything else tied to an area. */
const seesAllAreas = () => has("super_admin", "admin", "program_officer", "program_coord", "board", "compliance_head");
const inMyArea = r => {
  if (seesAllAreas()) return true;
  // If the record belongs to a programme where the user is lead or team member,
  // grant access regardless of geographic state — being on the team is the credential.
  if (r && r.programmeId) {
    const prog = (state.programmes || []).find(p => p.id === r.programmeId);
    if (prog && (prog.leadId === state.user.uid || (prog.team || []).includes(state.user.uid))) return true;
  }
  const st = (typeof myStates === "function" ? myStates() : null);
  if (!st) return true;
  if (!r || !r.state) return true;                       // not yet given a place
  return st.includes(r.state);
};
const ownedByMyPost = r => !!myPost() && (r.postId === myPost() || r.ownerPostId === myPost() || r.assigneePostId === myPost());
const isStaff = u => !!u && u.active === true
  && !(u.roles || []).map(r => ROLE_ALIAS[r] || r).some(r => NON_STAFF_ROLES.includes(r))
  && !NON_STAFF_JOIN.includes(u.joinAs || "staff");
const staffList = () => state.users.filter(isStaff);
/* A record is mine if I made it, it is assigned to me, or it belongs to someone below me. */
const isVolunteerOnly = () => has("volunteer") && !has("super_admin", "admin", "director_acf", "program_officer", "program_coord", "program_lead", "field_staff", "fundraising", "accountant", "procurement", "compliance_head", "board");
const inMyLine = r => { if (seesWholeOrg()) return true;
  if (ownedByMyPost(r)) return true;
  if (isVolunteerOnly()) { const mine = [r.uid, r.createdBy, r.assigneeId, r.assignerId, r.supervisorId].filter(Boolean);
    return mine.includes(state.user.uid); }
  const line = lineUids();
  const owners = [r.uid, r.createdBy, r.recordedBy, r.by, r.leadId, r.assigneeId, r.assignerId, r.travellerId, r.registeredBy, r.staffId, r.supervisorId, r.caseWorkerId, r.holderId].filter(Boolean);
  if (!owners.length) return true;        // records with no owner stay visible until corrected
  return owners.some(o => line.has(o)); };
/* Functions inside Finance, Administration & Compliance.
   The Director ACF supervises all three, so he sees all three; the others see only their own. */
const fnAccounts = () => has("super_admin", "director_acf", "accountant");
const fnAdminComm = () => has("super_admin", "director_acf", "admin");
/* Field admin assistants — admin_assistant role in a non-Delhi office */
const fnAdminField = () => {
  if (!has("admin_assistant")) return false;
  const office = (state.offices || []).find(o => o.id === state.me.officeId) || {};
  return !/delhi/i.test(office.name || "");
};
const fnProcurement = () => has("super_admin", "director_acf", "procurement", "admin_assistant");
const fnCompliance = () => has("super_admin", "director_acf", "compliance_head");                       // app-level authority: posts, structure, profile approvals, roles
const isFinance = () => has("super_admin", "director_acf", "accountant");
const isHR = () => has("super_admin", "admin");
const mgrs = u => u.managerIds || (u.managerId ? [u.managerId] : []);
const isManager = () => state.users.some(u => mgrs(u).includes(state.user.uid));

async function audit(action, table, id, detail) {
  try { await db.collection("audit").add({ action, table, recordId: id || null, detail: detail || null, uid: state.user.uid, email: state.user.email, at: firebase.firestore.FieldValue.serverTimestamp() }); } catch {}
}

/* ---------- Auth flow ---------- */
function show(id) { ["v-login", "v-denied", "v-main"].forEach(v => $(v).classList.toggle("hidden", v !== id)); }

async function onSignedIn(user) {
  state.user = user;
  const uref = db.collection("users").doc(user.uid);
  let snap = await uref.get();
  if (!snap.exists) {
    const allow = user.email ? await db.collection("allowlist").doc(user.email.toLowerCase()).get().catch(() => null) : null;
    if (!allow || !allow.exists || !allow.data().active) return showProfileForm(user, uref);
    const a = allow.data();
    await uref.set({ email: (user.email || "").toLowerCase(), phoneAuth: user.phoneNumber || null, name: user.displayName || a.name || user.email.split("@")[0], roles: a.roles || ["field_staff"],
      officeId: a.officeId || null, managerIds: a.managerIds || (a.managerId ? [a.managerId] : []), active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    snap = await uref.get();
  }
  state.me = { id: user.uid, ...snap.data() };
  if (!state.me.active) return showWaiting(state.me, uref, user);
  await loadMasters();
  buildNav(); // rebuild after masters so programmes/projects appear for all roles
  await loadOwnRoles();
  try { state.drive = (await db.collection("settings").doc("drive").get()).data() || {}; } catch { state.drive = {}; }
  show("v-main");
  if (typeof startChatNotifications === "function") startChatNotifications().catch(() => {});
  $("userLine").textContent = state.me.name;
  $("navName").textContent = state.me.name;
  $("navRoles").textContent = state.me.roles.map(r => ROLES[r] || r).join(", ");
  // Ensure programmes load for program_officer, programme_coord etc.
  if (!(state.programmes||[]).length && (state.me?.roles||[]).some(r=>["program_officer","program_coord","program_lead","field_staff","super_admin","admin","board"].includes(r))) {
    try { const gp = await db.collection("programmes").get(); state.programmes = gp.docs.map(d=>({id:d.id,...d.data()})); } catch {}
  }
  buildNav();
  if ($("bell")) { $("bell").classList.remove("hidden"); $("bell").onclick = () => go("whatsNew"); if (typeof paintBell === "function") paintBell(); }
  // Restore active journey if any in progress
  db.collection("journeys").where("travellerId","==",state.user.uid).limit(10).get()
    .then(s=>{ const active=s.docs.map(d=>({id:d.id,...d.data()})).find(j=>j.status==="on the way"); if(active){ state.activeJourney=active.id; state.activeJourneyData=active; }}).catch(()=>{});
  const scanned = (location.hash.match(/^#asset=(.+)$/) || [])[1];
  if (scanned) { state.assetId = scanned; go("asset"); }
  else go("home");
}
async function showProfileForm(user, uref, existing = {}) {
  show("v-main"); $("drawer").classList.add("hidden"); $("userLine").textContent = user.email; setTitle("Create your profile");
  const [offices, posts, projects, staff] = await Promise.all([
    db.collection("offices").orderBy("name").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("posts").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("projects").orderBy("name").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("users").where("active", "==", true).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => [])]);
  const JOIN = [["staff", "Staff member", "I work for Empower People in one of the departments"],
    ["volunteer", "Volunteer", "I give my time to a project, without salary"],
    ["board", "Board / Advisory member", "I serve on the Governing Board, Executive Committee or Advisory Board"],
    ["consultant", "Consultant / Intern", "I am engaged for a defined piece of work or period"],
    ["community", "Community leader (Sakhi leader)", "I lead a Sakhi Mandal, Nari Nusrat or other collective"]];
  const sel = existing.joinAs || "staff";
  html(`<div class="card"><h2>Create your profile</h2><p class="small muted">Fill this once. The office approves it and matches you to a post; until then the app waits.</p>
    ${!offices.length ? `<p class="small" style="color:#9A6A2F">The office list could not be loaded, so type where you work instead — the office will set it properly when they approve you.</p>` : ""}
    <form id="pr">
    <label class="field"><span>I am joining as</span><div id="joinbox">${JOIN.map(([k, l, d]) => `<label class="joinopt ${k === sel ? "on" : ""}" data-j="${k}"><input type="radio" name="joinAs" value="${k}" ${k === sel ? "checked" : ""}><div><b>${l}</b><div class="small muted">${d}</div></div></label>`).join("")}</div></label>

    <div class="two"><label class="field"><span>Full name</span><input name="name" required value="${esc(existing.name || user.displayName || "")}"></label>
      <label class="field"><span>Photo (required)</span><input type="file" name="photo" accept="image/*" capture="user" ${existing.photo ? "" : "required"}></label></div>
    <div class="two"><label class="field"><span>Phone</span><input name="phone" inputmode="tel" required value="${esc(existing.phone || "")}"></label>
      <label class="field"><span>Email</span><input value="${esc(user.email)}" disabled></label></div>

    <div id="forStaff">
      <div class="two"><label class="field"><span>Department</span><select name="department">${["Program", "Admin", "Accounts", "Fund raising", "Compliance"].map(x => `<option ${x === existing.department ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Designation (as you know it)</span><input name="designation" value="${esc(existing.designation || "")}"></label></div>
      <label class="field"><span>Which post do you hold? (if you know it)</span>${posts.length
        ? `<select name="postId"><option value="">— the office will match me —</option>${posts.map(p => `<option value="${p.id}" ${p.id === existing.postId ? "selected" : ""}>${esc(p.title)}${p.holderId ? "" : " — Vacant post"}</option>`).join("")}</select>`
        : `<input name="postName" value="${esc(existing.postName || "")}" placeholder="Your post, if you know it">`}</label>
    </div>

    <div id="forVol" class="hidden">
      <div class="two"><label class="field"><span>Project you will work with</span><select name="projectId"><option value="">—</option>${projects.map(p => `<option value="${p.id}" ${p.id === existing.projectId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Role you will play</span><input name="designation" placeholder="Community media, teaching support, field help…" value="${esc(existing.designation || "")}"></label></div>
      <div class="two"><label class="field"><span>Days / hours you can give</span><input name="availability" value="${esc(existing.availability || "")}"></label>
        <label class="field"><span>Until (if time-bound)</span><input type="date" name="till" value="${esc(existing.till || "")}"></label></div>
    </div>

    <div id="forBoard" class="hidden">
      <div class="two"><label class="field"><span>Body</span><select name="body">${["Governing Board / Trustees", "Executive Committee", "Advisory Board", "Internal Committee (POSH)"].map(x => `<option ${x === existing.body ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Position</span><input name="designation" placeholder="President, Treasurer, Member, Advisor" value="${esc(existing.designation || "")}"></label></div>
      <p class="small muted">Board and advisory members see the organisation dashboard and the organigram. No Sakhi records, no staff files.</p>
    </div>

    <div class="two"><label class="field"><span>Line manager (who you report to)</span>${staff.length
      ? `<select name="managerId"><option value="">— not sure —</option>${staff.map(u => `<option value="${u.id}" ${u.id === existing.managerId ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select>`
      : `<input name="reportsToName" value="${esc(existing.reportsToName || "")}" placeholder="Their name">`}</label>
      <label class="field"><span>Also sees cases in these states</span><input name="statesText" placeholder="e.g. Bihar, Assam — leave blank for their own office's state only"></label>
        <label class="field"><span>Office</span>${offices.length
        ? `<select name="officeId"><option value="">— the office will set this —</option>${offices.map(o => `<option value="${o.id}" ${o.id === existing.officeId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`
        : `<input name="officeName" value="${esc(existing.officeName || "")}" placeholder="Where you work — Delhi HQ, Yamunanagar…">`}</label></div>
    <div class="two"><label class="field"><span>Date of joining</span><input type="date" name="joined" value="${esc(existing.joined || "")}"></label>
      <label class="field"><span>Projects you work on</span><input name="projectsText" value="${esc(existing.projectsText || "")}"></label></div>

    <div id="forPay"><div class="two"><label class="field"><span>Bank account (salary / claims)</span><input name="bankAcc" value="${esc(existing.bankAcc || "")}"></label>
      <label class="field"><span>IFSC</span><input name="ifsc" value="${esc(existing.ifsc || "")}"></label></div></div>
    <label class="field"><span>Emergency contact</span><input name="emergency" value="${esc(existing.emergency || "")}"></label>
    <div class="two"><label class="field"><span>Front page of your bank passbook</span><input type="file" name="docBank" accept="image/*,.pdf"></label>
      <label class="field"><span>Aadhaar / voter card / driving licence</span><input type="file" name="docId" accept="image/*,.pdf"></label></div>
    <div class="two"><label class="field"><span>Address proof</span><input type="file" name="docAddr" accept="image/*,.pdf"></label>
      <label class="field"><span>Signed contract (if you have it)</span><input type="file" name="docContract" accept="image/*,.pdf"></label></div>
    <label class="field"><span>CV</span><input type="file" name="docCV" accept="image/*,.pdf"></label>

    <label class="check"><input type="checkbox" required> I have read the Organization Policy Manual v5.0 and sign the Commitment Statement</label>
    <label class="check"><input type="checkbox" required> I accept the Non-Disclosure Agreement and the Child Protection and POSH policies</label>
    ${existing.note ? `<div class="empty"><b>Requested changes:</b> ${esc(existing.note)}</div>` : ""}
    <button class="btn" type="submit">Submit for approval</button></form><div class="err" id="prErr"></div></div>`);
  const applyJoin = v => { $("forStaff").classList.toggle("hidden", v !== "staff" && v !== "consultant");
    $("forVol").classList.toggle("hidden", v !== "volunteer" && v !== "community");
    $("forBoard").classList.toggle("hidden", v !== "board");
    $("forPay").classList.toggle("hidden", v === "board");
    $("content").querySelectorAll(".joinopt").forEach(l => l.classList.toggle("on", l.dataset.j === v)); };
  applyJoin(sel);
  $("content").querySelectorAll('input[name="joinAs"]').forEach(r => r.onchange = () => applyJoin(r.value));
  $("pr").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); delete d.photo;
    const ph = fd.get("photo"); if (ph && ph.size) { const s = await uploadToDrive(ph,"program",ph.name); if (s) d.photo = s.link; } else if (existing.photo) d.photo = existing.photo;
    const docs = [...(existing.docs || [])];
    for (const [k, label] of [["docBank", "Bank passbook (front page)"], ["docId", "Aadhaar / voter card / driving licence"], ["docAddr", "Address proof"], ["docContract", "Signed contract"], ["docCV", "CV"]]) {
      const f = fd.get(k); delete d[k]; if (f && f.size) { const s = await uploadToDrive(f,"admin",f.name); if (s) docs.push({ ...s, name: label + " — " + f.name }); } }
    d.docs = docs;
    if (d.joinAs === "board") { d.department = "Governance"; }
    if (d.joinAs === "volunteer" || d.joinAs === "community") { d.department = "Volunteer"; }
    const signInEmail = (user.email || "");
    try { await uref.set({ ...d, email: (signInEmail.endsWith("@phone.empowerpeople.in") ? (d.emailTyped || "") : signInEmail).toLowerCase(),
      signInId: signInEmail, phoneAuth: signInEmail.endsWith("@phone.empowerpeople.in") ? "+91" + signInEmail.split("@")[0] : (user.phoneNumber || null), roles: [], managerIds: d.managerId ? [d.managerId] : [], active: false, status: "pending",
      createdAt: existing.createdAt || firebase.firestore.FieldValue.serverTimestamp(), submittedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); onSignedIn(user); }
    catch (err) { $("prErr").textContent = err.message; } };
}
function showWaiting(me, uref, user) {
  show("v-main"); $("drawer").classList.add("hidden"); $("userLine").textContent = me.name || ""; setTitle("Waiting for approval");
  if (me.status === "changes") return showProfileForm(user, uref, me);
  html(`<div class="card" style="text-align:center"><h2>${me.status === "declined" ? "Profile declined" : "Thank you, " + esc(me.name)}</h2>
    <p class="small muted">${me.status === "declined" ? "Please contact the office." : "Your profile has been sent to the General Secretary for approval. You will be able to use the app once it is approved and matched to a post."}</p>
    <p><span class="tag ok">1 · Profile submitted</span> <span class="tag ${me.status === "pending" ? "warn" : ""}">2 · Approval</span> <span class="tag">3 · Post matched</span></p>
    <button class="btn small quiet" onclick="location.reload()">Check again</button> <button class="btn small quiet" onclick="auth.signOut()">Sign out</button></div>`);
}
async function loadMasters() {
  const CACHE_KEY = "ep_masters_v1";
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour
  // Try localStorage cache first
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL && (cached.users||[]).length > 0) {
      state.offices    = cached.offices    || [];
      state.projects   = cached.projects   || [];
      state.users      = cached.users      || [state.me];
      state.programmes = cached.programmes || [];
      state.posts      = cached.posts      || [];
      if (!state.activities) state.activities = [];
      return; // served from cache — 0 Firestore reads
    }
  } catch (_) {}
  // Cache miss or stale — load from Firestore
  const [o, p] = await Promise.all([db.collection("offices").orderBy("name").get(), db.collection("projects").orderBy("name").get()]);
  state.offices = o.docs.map(d => ({ id: d.id, ...d.data() }));
  state.projects = p.docs.map(d => ({ id: d.id, ...d.data() }));
  try { const u = await db.collection("users").get(); state.users = u.docs.map(d => ({ id: d.id, ...d.data() })); } catch { state.users = [state.me]; }
  if (!state.activities) state.activities = [];
  try { const g = await db.collection("programmes").get(); state.programmes = g.docs.map(d => ({ id: d.id, ...d.data() })); } catch { state.programmes = state.programmes || []; }
  try { const g = await db.collection("posts").get(); state.posts = g.docs.map(d => ({ id: d.id, ...d.data() })); } catch { state.posts = state.posts || []; }
  // Save to localStorage for next session
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(), offices: state.offices, projects: state.projects,
      users: state.users, programmes: state.programmes, posts: state.posts
    }));
  } catch (_) {}
}
// Call this when staff records change (new user, role change, etc.) to bust the cache
function bustMastersCache() { try { localStorage.removeItem("ep_masters_v1"); } catch(_){} }
async function ensureActivities() {
  if (state.activities && state.activities.length) return; // already loaded
  try {
    const a = await db.collection("activities").limit(400).get();
    state.activities = a.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
  } catch { state.activities = []; }
}

/* ---------- Navigation ---------- */
const routes = {};
/* One place that decides who may open what. The menu is built from it, and go() checks it,
   so a tab a person may not use is never shown and never reachable. */
/* The Board and advisers: their own work, the organisation's dashboard, the organigram,
   the policies, and the board's own papers. Nothing operational, and nothing editable. */
const BOARD_MAY = ["home", "profile", "idcard", "mywork", "myPlan", "myMonth", "assignments",
  "lead", "orgchart", "board", "policy", "whatsNew", "incident", "harassment"];
const SUPPORT_MAY = ["home", "checkin", "dayreport", "myMonth", "assignments", "mywork",
  "travelog", "itinerary", "leave", "profile", "idcard", "requisition", "advance", "expense",
  "whatsNew", "handover", "cashBox", "myAssets", "cashBox", "myAssets"];
const VOLUNTEER_MAY = ["home", "profile", "dayreport", "myMonth", "assignments", "mywork",
  "myActivities", "myPlan", "chat", "whatsNew", "calendar", "events", "mycases",
  "incident", "harassment", "idcard", "leave", "itinerary", "travelog", "handover"];
const CAN = {
  // M3-SAGE baseline routes — open to program_officer, super_admin, founder, admin + M3-SAGE team
  m3baseline: () => { const m3p=(state.projects||[]).find(p=>(p.code||p.name||"").toUpperCase().includes("M3-SAGE")); return has("super_admin","founder","admin","program_officer")||(m3p&&(m3p.leadId===state.user.uid||(m3p.team||[]).includes(state.user.uid))); },
  m3responses: () => has("super_admin","founder","program_officer"),
  m3form_household:     () => CAN.m3baseline(),
  m3form_village:       () => CAN.m3baseline(),
  m3form_kii:           () => CAN.m3baseline(),
  m3form_fgd:           () => CAN.m3baseline(),
  m3form_survivor:      () => CAN.m3baseline(),
  m3form_market:        () => CAN.m3baseline(),
  m3form_institutional: () => CAN.m3baseline(),
  whatsNew: () => isActive(),
  lead: () => has("super_admin", "board") || (isManager() && atHeadquarters()),
  dashboard: () => has("super_admin", "admin", "director_acf"),
  calendar: () => isActive(), orgchart: () => isActive(), chat: () => isActive(),
  teamReports: () => isManager() || has("super_admin", "admin"),

  team: () => isManager(), teamsummary: () => isManager(), teamfeedback: () => isManager() || has("super_admin","admin"),
  inbox: () => isManager() || has("super_admin", "director_acf", "admin", "program_officer", "program_coord", "fundraising", "accountant", "procurement"),
  approvals: () => false,   // replaced by the single Approvals & verification inbox
  profileApprovals: () => has("super_admin", "fundraising"), postClaims: () => has("super_admin"),
  posts: () => has("super_admin"), seedOrg: () => has("super_admin"), structure: () => has("super_admin"),
  users: () => has("super_admin", "admin", "director_acf"),
  handoverPost: () => has("super_admin", "admin", "director_acf"), override: () => has("super_admin"), roles: () => has("super_admin"),
  audit: () => has("super_admin"), backup: () => has("super_admin"), drive: () => has("super_admin", "admin"),
  // Programmes
  persons: () => isProgram() || has("counsellor"), beneficiaries: () => isProgram() || has("counsellor"), caseIds: () => canManageCases(), duplicates: () => canManageCases(), personNew: () => canEditPersons(), person: () => isProgram(), caseUpdate: () => isProgram(),
  programs: () => has("super_admin", "admin", "program_officer", "program_coord", "board"),
  programmes: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "board", "observer"),
  programme: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "board", "observer", "fundraising", "director_acf", "accountant") || (state.programmes||[]).some(p => p.id === state.programmeId && (p.leadId === state.user?.uid || (p.leadIds||[]).includes(state.user?.uid) || (p.team||[]).includes(state.user?.uid))),
  seedProgrammes: () => has("super_admin", "program_officer"),
  mycases: () => isActive(),
  supportRequest: () => isProgram() || isAdmin() || has("director_acf"),
  beneficiaryNew: () => isActive(),
  groups: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "board", "observer"),
  group: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "board", "observer"),
  activities: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff"),
  plan: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "board"),
  events: () => has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff", "fundraising", "board", "observer") || isVolunteerOnly(),
  project: () => isActive(), projects: () => has("super_admin", "director_acf", "admin", "program_officer", "fundraising", "accountant"),
  // Accounts
  funds: () => has("super_admin", "director_acf", "accountant", "board"),
  bankInterest: () => has("super_admin", "director_acf", "accountant", "finance_manager"),
  tracker: () => has("super_admin", "director_acf", "accountant", "board", "program_officer"),
  monthlyAccount: () => isActive(),
  myMonth: () => isActive(),
  monthlyReports: () => isActive(),
  myActivities: () => isStaff(state.me) || has("super_admin","admin","director_acf"),
  whoToday: () => isStaff(state.me) || has("super_admin","admin","director_acf"),
  policy: () => isActive(),   // every member of the team may read the policy
  petty: () => has("accountant", "director_acf", "super_admin"),       // Accounts give money out
  financialTrail: () => isAccounts() || has("super_admin", "founder"),
  /* The box appears once somebody has actually been given money — not before. */
  cashBox: () => isStaff(state.me) || has("super_admin","admin","director_acf"),
  myPlan: () => isActive(),
  payments: () => isActive(),
  ledgerDesk: () => has("super_admin", "director_acf", "accountant"),
  trackerImport: () => has("super_admin", "director_acf", "accountant"),
  // Budget heads: the Program Officer, the Accountant and the Director ACF, and the
  // Founder & General Secretary. Nobody else needs the allocations.
  heads: () => has("super_admin", "director_acf", "accountant", "program_officer"),
  receipts: () => has("super_admin", "director_acf", "accountant"),
  bankInterest: () => has("super_admin", "director_acf", "accountant", "finance_manager"),
  teamfeedback: () => isManager() || has("super_admin", "admin"),
  ledger: () => has("super_admin", "director_acf", "accountant"),
  unalloc: () => has("super_admin", "director_acf", "accountant"),
  petty: () => has("super_admin", "director_acf", "accountant", "admin"),
  salary: () => has("super_admin", "director_acf"), banks: () => has("super_admin", "director_acf"),
  // Administration, HR & Communication
  letters: () => has("super_admin", "director_acf", "admin"), idcards: () => has("super_admin", "director_acf", "admin"),
  leaveRegister: () => has("super_admin", "director_acf", "admin"),
  holidays: () => isActive(),
  manual: () => isActive(),
  offices: () => has("super_admin", "director_acf", "admin"),
  assets: () => has("super_admin", "director_acf", "procurement", "admin"),
  asset: () => isActive(),
  assetVerify: () => has("super_admin", "director_acf", "procurement", "admin"),
  operations: () => has("super_admin", "director_acf", "program_officer"),
  staffRecord: () => has("super_admin", "admin", "director_acf") || isManager(),
  forms: () => true,
  verifyForm: () => true,
  resources: () => true,
  myAssets: () => isStaff(state.me) || has("super_admin","admin","director_acf"),
  dak: () => has("super_admin", "director_acf", "admin", "admin_assistant", "procurement", "observer"),
  policies: () => has("super_admin", "director_acf", "admin", "compliance_head", "board"), registrations: () => has("super_admin", "director_acf", "admin", "compliance_head", "board"),
  statutory: () => has("super_admin", "director_acf", "compliance_head", "accountant"),
  board: () => has("super_admin", "director_acf", "compliance_head", "board"),
  vendors: () => has("super_admin", "director_acf", "procurement", "accountant"),
  volunteers: () => has("super_admin", "admin", "fundraising", "program_officer", "program_coord"),
  // Fund raising
  frCalendar: () => canFR(), frProposals: () => canFR(), frOutreach: () => canFR(), frObligations: () => canFR(),
  // everyone
  home: () => true, mywork: () => isActive(), performance: () => isActive(), checkin: () => isActive(),
  dayreport: () => isActive(), leave: () => isStaff(state.me) || has("super_admin","founder","admin","director_acf","accountant"), expense: () => isStaff(state.me) || has("super_admin","founder","admin","director_acf","accountant"), advance: () => isStaff(state.me) || has("super_admin","founder","admin","director_acf","accountant"),
  travelog: () => isStaff(state.me) || has("super_admin","admin","director_acf"), itinerary: () => isStaff(state.me) || has("super_admin","admin","director_acf"), assignments: () => isActive(),
  requisition: () => isActive(), handover: () => isActive(), incident: () => isActive(),
  harassment: () => isActive(), appointment: () => isActive(), profile: () => true,
  claimPost: () => false,   // posts are appointed, not claimed
  idcard: () => isActive() && !has("volunteer", "board"),
  checkin: () => isActive(), performance: () => isStaff(state.me) || has("super_admin","founder","admin","director_acf"),
  handover: () => isStaff(state.me) || has("super_admin","admin","director_acf"), harassment: () => isActive(), incident: () => isActive(),
  bulk: () => has("super_admin", "director_acf", "admin", "accountant", "program_officer", "program_coord", "fundraising", "procurement", "compliance_head")
};
const WRITE_ONLY_SCREENS = ["personNew", "ledgerDesk", "trackerImport", "bulk", "seedOrg", "override", "structure", "claimPost", "postClaims", "profileApprovals", "harassment", "incident", "checkin", "dayreport", "leave", "expense", "advance", "requisition", "itinerary"];
const mayOpen = r => {
  /* Own salary slip: every active non-board staff member */
  if (r === "mySlip" && isStaff(state.me)) return true;
  /* A role the organisation added may open the screens it was given. */
  if (typeof ownRoleScreens === "function" && ownRoleScreens().includes(r) && isActive()) return true;
  /* A volunteer sees their own work and the team they are helping — nothing else:
     no money, no registers, no other people's records. */
  if (typeof isVolunteerOnly === "function" && isVolunteerOnly() && !VOLUNTEER_MAY.includes(r)) return false;
  /* Support staff — drivers, office helpers — need their own day, their journeys and
     anything to do with money they are holding. Nothing else. */
  if (has("support_staff") && !has("super_admin", "admin", "director_acf", "accountant") && !SUPPORT_MAY.includes(r)) return false;
  /* The Board and advisers oversee; they do not operate. They read the dashboard and
     the organigram and change nothing. */
  if (has("board") && !has("super_admin", "admin", "director_acf", "program_officer") && !BOARD_MAY.includes(r)) return false;
  const f = CAN[r];
  try {
    if (isObserver()) return !WRITE_ONLY_SCREENS.includes(r) && r !== "grievances";
    return f ? !!f() : has("super_admin");
  } catch (e) { return true; }
};

function buildNav() {
  const links = [];
  /* Under the App Super Admin hat the organisation's own sections step aside: what is
     on screen then matches what the hat is for. Everything returns on switching back. */
  const APPHAT = has("super_admin") && hat() === "appAdmin";
  const SUPER = APPHAT ? false : has("super_admin");
  /* The menu had grown past a hundred lines, with a person's own work at the bottom.
     Sections now fold shut, the person's own work and their department open first,
     and typing filters the lot. */
  const sections = [];
  const add = (title, items) => { if (!items.length) return;
    const allowed = items.filter(([r]) => mayOpen(r));
    if (!allowed.length) return;
    sections.push({ title, items: allowed }); };
  const LEAD = has("super_admin");

  if (!LEAD && !has("counsellor")) { add(LEAD ? "My own work" : "My day", [["home", t("home")], ["mywork", "My work"], ["dayreport", t("dayReport")], ["myPlan", "My plan"], ["cashBox", "Cash box"], ["leave", t("leave")], ["mySlip", "My salary slip"], ["requisition", "Ask for something"], ["handover", "File handovers"], ["myAssets", "My assets"], ["profile", t("profile")], ["idcard", "My ID card"]]); // Reporting a concern is always reachable, kept apart from everyday work
  add("Report a concern", [["incident", "Incident report"], ["harassment", "Harassment complaint"], ["appointment", "My appointment"]]); }
  if (has("board") && !SUPER) { add("Report a concern", [["incident", "Incident report"], ["harassment", "Harassment complaint"]]); }

  // The Founder, the Governing Board and the Advisory Board open on the organisation dashboard.
  // Everyone else opens on their own work.
  const canSeeOverview = LEAD || has("board") || (isManager() && atHeadquarters());
  if (!APPHAT && canSeeOverview) add("Overview", [["lead", "Organisation dashboard"], ["tracker", "Fund Tracker"], ["calendar", "Calendar"], ["orgchart", "Organigram"], ...(SUPER || isAdmin() || isFinance() ? [["dashboard", "Office Ops dashboard"]] : []), ...(SUPER || has("director_acf","director_acf","program_officer") ? [["operations", "Operations"]] : [])]);
  if (!APPHAT && (SUPER || isManager() || isHR() || isAdmin())) add("Team", [["team", "My team"], ["teamReports", "Reports from my team"], ["inbox", "Approvals & verification"], ["teamsummary", "Team activity summary"], ["teamfeedback", "Performance notes"], ...(SUPER ? [["profileApprovals", "Profile approvals"], ["postClaims", "Post claims"]] : [])]);
  if (!APPHAT && has("director_acf") && !SUPER) add("Director ACF",
    [["inbox", "Approvals & verification"],
     ["leaveRegister", "Leave register"], ["whoToday", "Who is where today"],
     ["holidays", "Holidays & events"], ["users", "Staff records"],
     ["supportRequest", "Support requests"], ["requisition", "Requisitions to fulfil"],
     ["assetVerify", "Verification round & labels"], ["vendors", "Vendors"],
     ["itinerary", "Travel requests"], ["monthlyReports", "Monthly reports"]]);

  // ---- Three departments ----
  // Programmes, in two parts: what the Program Officer runs, and what the field teams do
  if (SUPER || has("program_officer", "program_coord")) add("Programmes · Program Officer",
    [["programmes", "Programmes"], ["programs", "Programmes overview"], ["project", "Project page"],
     ["plan", "Implementation plan"], ["activities", "Activities"],
     ["persons", "Sakhis"], ["duplicates", "Possible duplicates"], ["caseIds", "Records without a Sakhi ID"], ["beneficiaries", "Beneficiary list"],
     ["groups", "Groups / CC"], ["events", "Event reports"], ["supportRequest", "Support requests"], ["holidays", "Holidays & events"], ["bulk", "Bulk import"]]);
  if (SUPER || has("founder")) add("M3-SAGE Baseline Survey",
    [["m3baseline", "Survey forms"], ["m3responses", "Responses & download"]]);
  if ((SUPER || has("program_lead", "field_staff", "program_coord", "program_officer") || isVolunteerOnly()) && !has("support_staff", "procurement")) add("Field work",
    [["mycases", "Cases assigned to me"], ["personNew", "Register a Sakhi"], ["beneficiaryNew", "Register a beneficiary"],
     ["groups", "Groups / CC"], ["events", "Event report"], ["persons", "Sakhis"],
     ["supportRequest", "Support requests"], ["beneficiaryNew", "Register a beneficiary"], ["travelog", "Travel log"], ["incident", "Incident report"],
     ...((state.projects||[]).some(p=>(p.code||p.name||"").toUpperCase().includes("M3-SAGE")&&(p.leadId===state.user.uid||(p.team||[]).includes(state.user.uid)))||has("super_admin","founder","program_officer")?[["m3baseline","📋 M3-SAGE Baseline"]]:[])]); 

  // Finance, Administration & Compliance — shown by function, so each team sees its own work
  if (SUPER || fnAccounts()) add("· Accounts", [
    // Daily work
    ["ledgerDesk", "Entry desk"], ["monthlyAccount", "Monthly account"], ["payments", "Payments"],
    // Staff advances
    ...(SUPER || has("accountant","director_acf") ? [["advance", "Staff advance requests"]] : []),
    // Staff finance
    ["petty", "Staff advances"], ...(SUPER || has("director_acf") ? [["salary", "Salary"], ["salarySlips", "Salary slips"]] : []),
    // Project finance
    ["tracker", "Fund Tracker"], ["funds", "Fund position"], ["receipts", "Receipts"], ["ledger", "Expenses (ledger)"], ["unalloc", "Unallocated"], ["heads", "Budget heads"],
    // Records
    ["financialTrail", "Financial trail"], ["bankInterest", "Bank interest"], ...(SUPER || has("director_acf") ? [["banks", "Bank accounts"]] : []),
    ["bulk", "Bulk import"]]);
  if (SUPER || fnAdminComm()) add("· Administration, HR & Communication", [["users", "Staff records"], ["posts", "Posts & organigram"], ["letters", "Appointment letters & contracts"], ["idcards", "Staff ID cards"], ["leaveRegister", "Leave register"], ["holidays", "Holidays"], ["whoToday", "Who is where today"], ["monthlyReports", "Monthly reports"], ["dak", "Dak register"], ["policies", "Documents & certificates"], ["offices", "Offices"], ["handover", "File handovers"], ["requisition", "Requisitions to fulfil"], ["itinerary", "Travel requests"], ["travelog", "Travel log"], ["drive", "Drive & attachments"], ["bulk", "Bulk import"]]);
  if (fnAdminField()) add("· Administration", [["dak", "Dak register"], ["offices", "Offices"], ["policies", "Documents & certificates"], ["drive", "Drive & attachments"]]);
  if (SUPER || fnProcurement()) add("· Procurement & Logistics", [["assets", "Office assets"], ["assetVerify", "Verification round & labels"], ["vendors", "Vendors"], ["requisition", "Requisitions to fulfil"], ["bulk", "Bulk import"]]);
  if (has("board") && !SUPER && !fnAccounts()) add("· Finance (view)", [["tracker", "Fund Tracker"], ["funds", "Fund position"]]);
  if (SUPER || fnCompliance() || has("board")) add("· Compliance", [["statutory", "Statutory calendar"], ["registrations", "Registrations & renewals (dates)"], ["board", "Board & meetings"], ["policies", "Documents & certificates (view)"], ["bulk", "Bulk import"]]);

  if (SUPER || canFR()) add("Project Development, Research & Innovations · Coordinator – PDRI", [["frCalendar", "Opportunity calendar"], ["frProposals", "Proposals sent & status"], ["frOutreach", "Partnerships & outreach"], ["frObligations", "Donor relations & reporting"], ["volunteers", "Volunteers"], ["profileApprovals", "Volunteer verification"], ["projects", "Project register"], ["requisition", "Volunteer & other requests"], ["bulk", "Bulk import"]]);

  if (!APPHAT) add("Chat", [["chat", "Chat & calls"]]);
  if (!LEAD && !APPHAT) add("Calendar", [["calendar", "Calendar"]]);


  if (APPHAT) add("App administration", [["posts", "Posts & organigram"], ["seedOrg", "Load the organigram"], ["seedProgrammes", "Load our programmes"], ["structure", "Change structure"], ["roles", "Roles"], ["users", "People & sign-ins"], ["persons", "Sakhis (update records)"], ["viewAs", "See as someone else"], ["handoverPost", "Exit handover"], ["profileApprovals", "Profile approvals"], ["override", "App Super Admin tools"], ["audit", "Audit log"], ["bulk", "Bulk import"], ["backup", "Backup"], ["drive", "Drive & attachments"]]);
  /* Counsellor nav — simple: their cases + record support + resources + profile */
  if (has("counsellor")) {
    add("My cases", [["mycases","My cases"],["persons","All Sakhis (read)"]]);
    add("My account", [["profile","My profile"],["resources","Resources"]]);
  }
  if (!has("counsellor") && LEAD) { add(LEAD ? "My own work" : "My day", [["home", t("home")], ["mywork", "My work"], ["dayreport", t("dayReport")], ["myPlan", "My plan"], ["cashBox", "Cash box"], ["leave", t("leave")], ["mySlip", "My salary slip"], ["requisition", "Ask for something"], ["handover", "File handovers"], ["myAssets", "My assets"], ["profile", t("profile")], ["idcard", "My ID card"]]); // Reporting a concern is always reachable, kept apart from everyday work
  add("Report a concern", [["incident", "Incident report"], ["harassment", "Harassment complaint"], ["appointment", "My appointment"]]); }
  /* The projects and programmes this person works on, named one after another —
     no nesting, no register to hunt through. Someone sees only their own. */
  const mineProj = (typeof visibleProjects === "function" ? visibleProjects() : []).filter(isLiveProject);
  const mineProg = (typeof visibleProgrammes === "function" ? visibleProgrammes() : []);
  const showProgSection = mineProj.length || mineProg.length || has("program_officer","program_coord","program_lead","field_staff","director_acf","super_admin","fellow");
  if (showProgSection) {
    sections.push({ title: "Programmes & projects", items: [
      ...mineProj.map(p => ["project:" + p.id, p.code || p.name]),
      ...mineProg.map(g => ["programme:" + g.id, g.name]),
      ...(mineProg.length === 0 && has("program_officer","program_coord") ? [["programmes","All programmes"]] : [])
    ] });
  }

  /* What belongs to this person comes first: their own work, then their department. */
  const mineFirst = s => /my own work|my day|my work/i.test(s.title) ? 0
    : /programmes & projects/i.test(s.title) ? 1
    : state.me.department && s.title.toLowerCase().includes(String(state.me.department).toLowerCase().slice(0, 6)) ? 1
    : /overview/i.test(s.title) ? 2 : 3;
  sections.sort((x, y) => mineFirst(x) - mineFirst(y));
  const openByDefault = s => mineFirst(s) <= 1;
  const h = hat();
  const html2 = [
    `<div class="navtop">
       ${has("founder") ? `<button class="navhat ${h === "appAdmin" ? "on" : ""}" id="hatSwap">
          <span>Acting as</span><b>${esc(HATS[h])}</b>
          <i>${h === "founder" ? "Switch to App Super Admin" : "Back to Founder & General Secretary"}</i></button>` : has("super_admin") ? `<span class="small muted" style="display:block;padding:6px 12px">App Super Admin</span>` : ""}
       <button class="navout" id="navResources" style="text-align:left">🗂 Resources<span class="small muted" style="display:block">Forms, verify a form, policy assistant</span></button>
       ${(isManager() || SUPER || isAdmin()) ? `<button class="navout" id="navAssign" style="text-align:left">✏️ Assign work<span class="small muted" style="display:block">Give a task to someone</span></button>` : ""}
     </div>
     <div class="navsearch"><input id="navFind" placeholder="Find a screen…" autocomplete="off"></div>`];
  sections.forEach((s, i) => {
    const open = openByDefault(s);
    html2.push(`<details class="navgroup" ${open ? "open" : ""}><summary>${esc(s.title)}<span class="navcount">${s.items.length} screens</span></summary>`
      + s.items.map(([r, l]) => `<button class="navlink" data-r="${r}" data-label="${esc(String(l).toLowerCase())}">${esc(l)}</button>`).join("")
      + `</details>`);
  });
  $("navLinks").innerHTML = html2.join("");
  if ($("hatSwap")) $("hatSwap").onclick = () => wearHat(hat() === "founder" ? "appAdmin" : "founder");
  if ($("navResources")) $("navResources").onclick = () => go("resources");
  if ($("navAssign")) $("navAssign").onclick = () => go("assignments");
  const find = $("navFind");
  if (find) find.oninput = () => {
    const q = find.value.trim().toLowerCase();
    $("navLinks").querySelectorAll(".navgroup").forEach(g => {
      let shown = 0;
      g.querySelectorAll(".navlink").forEach(b => {
        const hit = !q || (b.dataset.label || "").includes(q);
        b.style.display = hit ? "" : "none"; if (hit) shown++;
      });
      g.style.display = shown ? "" : "none";
      if (q) g.setAttribute("open", ""); else if (!openByDefault({ title: g.querySelector("summary").textContent })) g.removeAttribute("open");
    });
  };
  $("navLinks").querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const r = b.dataset.r;
    if (r.startsWith("project:")) { state.projectId = r.slice(8); state.projectTab = "overview"; go("project"); }
    else if (r.startsWith("programme:")) { state.programmeId = r.slice(10); go("programme"); }
    else go(r);
    closeDrawer(); });
}
function closeDrawer() { if (window.innerWidth < 900) $("drawer").classList.add("hidden"); }
// A scanned identity card arrives as #card=<id> and needs no account
window.addEventListener("hashchange", () => { const m = location.hash.match(/^#card=(.+)$/); if (m) { state.cardId = m[1]; show("v-main"); routes.cardCheck(m[1]); } });
// A scanned asset sticker arrives as #asset=<id>
window.addEventListener("hashchange", () => { const m = location.hash.match(/^#asset=(.+)$/); if (m) { state.assetId = m[1]; go("asset"); } });
function paintViewAs() {
  let bar = document.getElementById("viewAsBar");
  const v = viewingAs();
  if (!v) { if (bar) bar.remove(); document.body.classList.remove("viewing"); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "viewAsBar"; bar.className = "viewasbar"; document.body.appendChild(bar); }
  bar.innerHTML = `<span>Looking at the app as <b>${esc(v.label)}</b> — nothing can be saved while you do</span>
    <button class="btn small" id="viewAsOut">Back to my own view</button>`;
  document.body.classList.add("viewing");
  document.getElementById("viewAsOut").onclick = () => { state.viewAs = null; buildNav(); paintViewAs(); go("viewAs"); };
}
/* Where this person has been, so there is always a way back. The app is a drawer of
   screens with no browser chrome on a phone, and without this a wrong tap is a dead end. */
const trail = [];
function goBack() {
  trail.pop();                        // the screen we are on
  const prev = trail.pop();
  if (!prev) return go("home");
  go(prev);
}
function paintBack() {
  const b = document.getElementById("backBtn");
  if (!b) return;
  b.classList.toggle("hidden", trail.length < 2 || state.route === "home");
  b.onclick = goBack;
}
async function go(route) {
  // Clean up chat listener when leaving chat screen
  if (route !== "chat" && typeof chatUnsub === "function") { try { chatUnsub(); } catch(_){} chatUnsub = null; }
  // Reset cash box person selection when navigating away
  if (route !== "cashBox") { state.cbWho = null; state._cbFromDropdown = false; }
  if (route === "expense" || route === "home" || route === "profile") {
    try { const acc = await advanceAccount(state.user.uid);
      state.myAdvances = acc.lines.map(l => ({ id: l.a.id, purpose: l.a.purpose, amount: l.drawn, left: l.left }));
      state.inHand = acc.inHand; } catch { }
  }
  if (!mayOpen(route)) { state.route = route; setTitle("Not available");
    return html(`<div class="card"><h2>Not your area</h2><p class="small muted">This part of the app belongs to another post. If you need it, ask the Founder &amp; General Secretary to change your role or your post.</p><button class="btn small quiet" onclick="go('home')">Back</button></div>`); }
  if (trail[trail.length - 1] !== route) trail.push(route);
  if (trail.length > 30) trail.shift();
  state.route = route;
  if (typeof paintBell === "function") paintBell();
  paintBack();
  paintViewAs();
  if (typeof paintHat === "function") paintHat();
  $("navLinks").querySelectorAll("[data-r]").forEach(b => b.classList.toggle("on", b.dataset.r === route));
  $("content").innerHTML = `<div class="empty">…</div>`;
  try { await routes[route](); } catch (e) { $("content").innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`; }
}
const setTitle = s => $("pageTitle").textContent = s;
const html = s => $("content").innerHTML = s;
const tag = st => `<span class="tag ${["approved","paid"].includes(st) ? "ok" : ["rejected","cancelled"].includes(st) ? "bad" : ["pending","submitted","manager_approved","returned"].includes(st) ? "warn" : ""}">${t(st)}</span>`;

/* ================= STAFF SCREENS ================= */
routes.home = async () => {
  /* What is still on this person's hands: money they hold, things they asked for and
     have not received, reports they owe, tasks past their date. Only what will not
     finish unless they do something. */
  const myOutstanding = [];
  let cashBox = null;
  if (has("procurement", "accountant", "director_acf", "super_admin")) {
    try {
      const rows = (await db.collection("pettyCash").limit(400).get()).docs.map(d => d.data())
        .filter(r => !r.deleted && !r.voided && (isAccounts() || r.officeId === state.me.officeId));
      const inA = rows.reduce((s, r) => s + (Number(r.inAmt) || 0), 0);
      const outA = rows.filter(r => r.status === "accepted" && !r.rejected).reduce((s, r) => s + (Number(r.outAmt) || 0), 0);
      const noBill = rows.filter(r => r.status === "accepted" && !r.rejected && (Number(r.outAmt) || 0) > 0 && !r.bill).length;
      cashBox = { left: inA - outA, noBill, entries: rows.length };
    } catch { }
  }
  try {
    const meUid = viewUid(), dayNow = today();
    const gg = async (c, n = 200) => (await db.collection(c).limit(n).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
    const [advO, asgO, jourO, reqO, clmO] = await Promise.all(
      ["advances", "assignments", "journeys", "requisitions", "expenseClaims"].map(c => gg(c)))
    const pendingAssets = (await db.collection("assets").where("assignedTo", "==", meUid).limit(50).get().catch(() => ({docs:[]}))).docs.map(d => ({id:d.id,...d.data()})).filter(a => !a.acceptedAt);;
    advO.filter(r => r.uid === meUid && /issued/i.test(r.status || "")).forEach(r => {
      const late = r.issuedOn && (new Date(dayNow) - new Date(r.issuedOn)) / 86400000 > 30;
      myOutstanding.push({ what: `₹${Number(r.amount || 0).toLocaleString("en-IN")} advance to settle`,
        sub: `${r.purpose || ""} · paid ${fmtD(r.issuedOn)} · bills and balance`, route: "advance",
        tag: late ? "over 30 days" : "to settle", tone: late ? "bad" : "warn", on: r.issuedOn,
        due: r.issuedOn ? new Date(new Date(r.issuedOn).getTime() + 30 * 86400000).toISOString().slice(0, 10) : null }); });
    asgO.filter(t => t.assigneeId === meUid && t.status === "assigned").forEach(t => {
      const late = t.due && t.due < dayNow;
      myOutstanding.push({ what: t.title || "A task", sub: `from ${userName(t.assignerId)}${t.due ? " · due " + fmtD(t.due) : ""}`,
        route: "mywork", tag: late ? "late" : "to do", tone: late ? "bad" : "", on: t.due, due: t.due }); });
    jourO.filter(j => (j.uid === meUid || j.travellerId === meUid) && !j.visitReport && String(j.date || "") <= dayNow).forEach(j => {
      myOutstanding.push({ what: `Report on the visit to ${j.toPlace || ""}`, sub: `${fmtD(j.date)} · what came of it`,
        route: "travelog", tag: "to write", tone: "warn", on: j.date,
        due: new Date(new Date(j.date).getTime() + 7 * 86400000).toISOString().slice(0, 10) }); });
    reqO.filter(r => r.uid === meUid && /^arranged/i.test(r.status || "")).forEach(r => {
      myOutstanding.push({ what: `Did you get it? ${String(r.item || "").slice(0, 40)}`, sub: "say whether it arrived, and what came of it",
        route: "requisition", tag: "to confirm", tone: "warn", on: r.doneOn }); });
    pendingAssets.forEach(a => {
      myOutstanding.push({ what: `${a.item || "Asset"} — acknowledge receipt`, sub: `${a.tag ? "Code: " + a.tag + " · " : ""}issued to you — open My assets to acknowledge`, route: "myAssets", tag: "pending", tone: "warn" });
    });
    clmO.filter(r => r.uid === meUid && /returned/i.test(r.status || "")).forEach(r => {
      myOutstanding.push({ what: `Claim returned — ₹${Number(r.amount || 0).toLocaleString("en-IN")}`,
        sub: r.returnNote || "sent back for a correction", route: "expense", tag: "to correct", tone: "bad", on: r.date }); });
    // Check for unfiled day reports in the last 7 working days — not for founders
    if (isActive() && !has("board","observer","volunteer","founder","super_admin")) {
      try {
        const drSnap = await db.collection("dayReports").where("uid","==",meUid).orderBy("date","desc").limit(14).get().catch(()=>({docs:[]}));
        const filedDates = new Set(drSnap.docs.map(d=>d.data().date));
        const lvSnap = await db.collection("leaveRequests").where("uid","==",meUid).where("status","==","approved").get().catch(()=>({docs:[]}));
        const leaveDates = new Set();
        lvSnap.docs.forEach(d=>{ let d0=new Date(d.data().from); const d1=new Date(d.data().to); while(d0<=d1){leaveDates.add(d0.toISOString().slice(0,10));d0.setDate(d0.getDate()+1);} });
        const unfiled = [];
        for (let i=1; i<=7; i++) {
          const dt = new Date(dayNow); dt.setDate(dt.getDate()-i);
          const ds = dt.toLocaleString("sv-SE",{timeZone:"Asia/Kolkata"}).slice(0,10);
          if (dt.getDay()===0 || dt.getDay()===6) continue; // skip Sat & Sun
          if (leaveDates.has(ds)) continue;
          if (!filedDates.has(ds)) unfiled.push(fmtD(ds));
        }
        if (unfiled.length) myOutstanding.unshift({ what: `Day report${unfiled.length>1?"s":""} not filed`, sub: unfiled.slice(0,3).join(", ")+(unfiled.length>3?" and "+(unfiled.length-3)+" more":""), route: "dayReport", tag: unfiled.length>2?"several missing":"missing", tone: "bad" });
      } catch(e) {}
    }
    // Profile completeness — signature and key documents
    if (isActive() && !has("board","observer","volunteer","super_admin","founder")) {
      const me = state.me || {};
      if (!me.signature) myOutstanding.push({ what: "Signature not uploaded", sub: "Your signature is printed on forms you approve — please upload it in your Profile", route: "profile", tag: "required", tone: "bad" });
      const docs = me.docs || [];
      const docNames = docs.map(d => (d.name||"").toLowerCase());
      const needsContract = !docNames.some(n => n.includes("contract") || n.includes("appointment"));
      const needsId = !docNames.some(n => n.includes("aadhaar") || n.includes("aadhar") || n.includes("voter") || n.includes("driving") || n.includes("licence") || n.includes("license") || n.includes("identity"));
      if (needsContract) myOutstanding.push({ what: "Signed contract not uploaded", sub: "Please upload your signed appointment letter or contract in Profile → Documents", route: "profile", tag: "required", tone: "warn" });
      if (needsId) myOutstanding.push({ what: "ID proof not uploaded", sub: "Upload Aadhaar, voter card or driving licence in Profile → Documents", route: "profile", tag: "required", tone: "warn" });
    }
    myOutstanding.sort((x, y) => String(x.on || "9").localeCompare(String(y.on || "9")));
  } catch { }
  try { const w = await db.collection("leaveRequests").where("uid", "==", viewUid()).limit(60).get();
    state.wfhToday = w.docs.map(d => ({ id: d.id, ...d.data() })); } catch { state.wfhToday = []; }
  setTitle(t("home"));
  const uid = viewUid();
  const [att, lv, ex, dr, asg, props] = await Promise.all([
    db.collection("attendance").doc(`${uid}_${today()}`).get().catch(() => ({ exists: false })),
    db.collection("leaveRequests").where("uid", "==", uid).orderBy("createdAt", "desc").limit(5).get().catch(() => ({ docs: [] })),
    db.collection("expenseClaims").where("uid", "==", uid).orderBy("createdAt", "desc").limit(5).get().catch(() => ({ docs: [] })),
    db.collection("dayReports").where("uid", "==", uid).orderBy("date", "desc").limit(3).get().catch(() => ({ docs: [] })),
    db.collection("assignments").where("assigneeId", "==", uid).limit(50).get().catch(() => ({ docs: [] })),
    db.collection("proposals").where("loggedBy", "==", uid).limit(10).get().catch(() => ({ docs: [] }))
  ]);
  const a = att.exists ? att.data() : null;
  const openTasks = asg.docs.map(d => d.data()).filter(x => x.status !== "verified");
  const overdue = openTasks.filter(x => x.due && x.due < today()).length;
  const returnedTasks = openTasks.filter(x => x.doneAt && x.status === "assigned");
  const overdueTasks = openTasks.filter(x => x.due && x.due < today() && !x.doneAt);
  const recent = [
    ...lv.docs.map(d => ({ k: t("leave"), s: `${d.data().type} · ${d.data().from} → ${d.data().to}`, st: d.data().status })),
    ...ex.docs.map(d => ({ k: t("expense"), s: `₹${d.data().amount} · ${d.data().description}`, st: d.data().status })),
    ...dr.docs.filter(d => d.data().status !== "missing").map(d => ({ k: t("dayReport"), s: `${d.data().date} · ${d.data().location || ""}`, st: d.data().status || "saved", on: d.data().date })),
    ...(props&&props.docs?props.docs:[]).map(function(d){var p=d.data();return{k:"Proposal sent",s:(p.name||"").slice(0,55)+(p.org?" · "+p.org:""),st:p.status||"sent",on:p.correctedOn||p.sentOn||""};}).filter(function(x){return x.on;})
  ].sort(function(a,b){return(b.on||"").localeCompare(a.on||"");});
  let waiting = 0;
  if (isManager() || isHR() || isFinance()) { try { waiting = (await pendingForMe()).length; } catch { } }
  const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const canAttend = isActive() && !has("volunteer", "board");
  /* Working from home applies to desk-based staff at the headquarters. Field teams
     work from where the work is, which is a field check-in, not working from home. */
  const myOffice = (state.offices || []).find(o => o.id === state.me.officeId) || {};
  const canWFH = /delhi/i.test(myOffice.name || "") || myOffice.allowWFH === true;
  const wfhToday = (state.wfhToday || []).find(l => /work from home/i.test(l.type || "")
    && String(l.from || "") <= today() && String(l.to || l.from || "") >= today()
    && !/rejected|returned|cancel/i.test(l.status || ""));
  const wfhOk = wfhToday && /approved/i.test(wfhToday.status || "");

  // Stuck journey — active journey not ended for 12+ hours (own alert)
  const activeJ = state.activeJourneyData || null;
  let stuckJourneyHtml = "";
  const journeySnoozedUntil = Number(sessionStorage.getItem("journeySnoozed") || 0);
  if (activeJ && activeJ.status === "on the way") {
    const jStart = new Date(activeJ.date + "T" + (activeJ.startedAt || "00:00") + ":00+05:30");
    const hoursElapsed = (Date.now() - jStart) / 3600000;
    if (hoursElapsed >= 12 && Date.now() > journeySnoozedUntil) {
      const hrsText = hoursElapsed >= 24 ? Math.floor(hoursElapsed/24) + " day" + (Math.floor(hoursElapsed/24)>1?"s":"") : Math.round(hoursElapsed) + " hours";
      stuckJourneyHtml = `<div class="card" id="stuckJourneyCard" style="border:2px solid var(--red,#c0392b);background:rgba(192,57,43,.07)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:1.5em">🔴</span>
          <b style="font-size:1.05em">Are you still travelling?</b>
        </div>
        <p class="small" style="margin:0 0 12px">You left for <b>${esc(activeJ.toPlace||"field")}</b> <b>${hrsText} ago</b> and haven't ended your journey.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn quiet" id="stillTravellingBtn">Yes, still on the way</button>
          <button class="btn" id="endJourneyNowBtn" style="background:var(--red,#c0392b);color:#fff">No, I'm back — End journey →</button>
        </div>
      </div>`;
    }
  }
  // Manager alert — anyone in my team with an open journey 12+ hours old
  let managerJourneyHtml = "";
  if (isManager()) {
    try {
      const teamIds = (state.users||[]).filter(u=>(u.managerIds||[]).includes(viewUid())).map(u=>u.id);
      if (teamIds.length) {
        const tSnap = await db.collection("journeys").where("status","==","on the way").get().catch(()=>({docs:[]}));
        const stuck = tSnap.docs.map(d=>({id:d.id,...d.data()})).filter(j=>{
          if(!teamIds.includes(j.travellerId)) return false;
          const jStart = new Date(j.date+"T"+(j.startedAt||"00:00")+":00+05:30");
          return (Date.now()-jStart)/3600000 >= 12;
        });
        if (stuck.length) {
          managerJourneyHtml = `<div class="card" style="border:2px solid var(--red,#c0392b);background:rgba(192,57,43,.07)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:1.3em">🔴</span><b>${stuck.length} team member${stuck.length>1?"s":""} still travelling</b></div>
            ${stuck.map(j=>{
              const u=(state.users||[]).find(x=>x.id===j.travellerId);
              const hrs=Math.round((Date.now()-new Date(j.date+"T"+(j.startedAt||"00:00")+":00+05:30"))/3600000);
              return `<p class="small" style="margin:4px 0"><b>${esc(u?.name||"Staff")}</b> — left for ${esc(j.toPlace||"field")} ${hrs} hrs ago, journey not ended</p>`;
            }).join("")}
            <p class="small muted" style="margin-top:6px">Ask them to open the app — it will ask if they're still travelling.</p>
          </div>`;
        }
      }
    } catch {}
  }

  html(`${stuckJourneyHtml}${managerJourneyHtml}
    ${canAttend ? `<div class="card" id="attCard">
      <h2>${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h2>
      ${!a ? `<p class="small muted">Tap once when you start work. Say where you are working from — your location is saved with a field or office check-in.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 8px">
          ${[["office", "At the office"], ["field", "In the field"], ...(canWFH && wfhToday ? [["home", "Working from home"]] : [])]
            .map(([k, l]) => `<button class="btn small ${(state.whereToday || "office") === k ? "" : "quiet"}" data-where="${k}">${l}</button>`).join("")}</div>
        <button class="btn" id="inBtn">📍 Check in · ${now}</button>
        ${canWFH && !wfhToday ? `<p class="small muted" style="margin-top:6px">Working from home today?
          <button class="btn small quiet" onclick="go('leave')">Apply for it</button> — your line manager decides, and you may apply the same morning.</p>` : ""}
        ${wfhToday && !wfhOk ? `<p class="small" style="color:#8A5A00;margin-top:6px">Your request to work from home today is with ${esc(userName(mgrs(state.me)[0]) || "your manager")}.
          You may check in from home; the day is recorded as awaiting approval.</p>` : ""}`
      : !a.checkOut ? `<p><span class="tag ${a.where === "home" ? "" : a.away ? "warn" : "ok"}">Checked in at ${esc(a.checkIn)}${a.where === "home" ? " · working from home" : a.where === "field" ? " · in the field" : a.away ? " · away from the office" : ""}</span>${a.place ? ` <span class="small muted">${esc(a.place)}</span>` : ""}${a.checkInMetres !== undefined && !a.away ? ` <span class="small muted">${a.checkInMetres} m from the office</span>` : ""}</p>
        <button class="btn quiet" id="checkOutBtn" style="margin-top:6px">🏁 Check out · ${now}</button>`
      : `<p><span class="tag ok">Checked in ${esc(a.checkIn)}</span> <span class="tag">Checked out ${esc(a.checkOut)}</span>
        ${a.hours ? `<span class="tag">${esc(a.hours)} hours</span>` : ""}</p>
        <p class="small muted">That is your day recorded. Write your day report before you finish.</p>`}
      <div class="err" id="attErr"></div></div>` : ""}

    ${returnedTasks.length ? `<div class="card" style="border-left:4px solid var(--bad)"><h2>⚠ ${returnedTasks.length} task${returnedTasks.length>1?"s":""} returned — needs revision</h2>
      <div class="list">${returnedTasks.map(t=>`<div class="item" onclick="go('mywork')" style="cursor:pointer"><div class="grow"><div class="t">${esc(t.title||"Task")}</div><div class="s">Returned by ${userName(t.assignerId)}${t.verifyNote?" · "+esc(t.verifyNote.slice(0,60)):""}</div></div><span class="tag bad">returned</span></div>`).join("")}</div></div>` : ""}
    ${overdueTasks.length ? `<div class="card" style="border-left:4px solid var(--bad)"><h2>⚠ ${overdueTasks.length} overdue task${overdueTasks.length>1?"s":""}</h2>
      <div class="list">${overdueTasks.map(t=>`<div class="item" onclick="go('mywork')" style="cursor:pointer"><div class="grow"><div class="t">${esc(t.title||"Task")}</div><div class="s">Due ${fmtD(t.due)} · from ${userName(t.assignerId)}</div></div><span class="tag bad">overdue</span></div>`).join("")}</div></div>` : ""}
    ${openTasks.length ? `<div class="card"><h2>Your tasks (${openTasks.length})</h2>
      <div class="list">${openTasks.sort((a,b)=>{const ov=x=>x.due&&x.due<today()?0:1; return ov(a)-ov(b)||(a.due||"9").localeCompare(b.due||"9");}).map(t => {
        const late = t.due && t.due < today();
        const sys = t.systemGenerated || t.auto;
        return `<div class="item" style="cursor:pointer" onclick="go('mywork')">
          <div class="grow">
            <div class="t">${esc(t.title||"Task")}${sys?` <span class="tag" style="font-size:10px;padding:1px 5px;vertical-align:middle">auto</span>`:""}</div>
            <div class="s">${t.due?`Due ${fmtD(t.due)} · `:""}from ${userName(t.assignerId)}</div>
            ${t.instructions?`<div class="s muted" style="margin-top:2px">${esc(t.instructions.slice(0,80))}${t.instructions.length>80?"…":""}</div>`:""}
          </div>
          <span class="tag ${late?"bad":""}">${late?"overdue":t.due?fmtD(t.due):"to do"}</span>
        </div>`;}).join("")}</div>
      <button class="btn small quiet" style="margin-top:8px" onclick="go('mywork')">Open My work →</button></div>` : ""}

    ${(typeof myOutstanding !== "undefined" && myOutstanding.filter(o=>o.route!=="mywork").length) ? `<div class="card"><h2>Waiting on you</h2>
      <p class="small muted">Everything of yours that is not finished, oldest first.</p>
      <div class="list">${myOutstanding.filter(o=>o.route!=="mywork").map(o => `<div class="item" style="cursor:pointer" data-go="${o.route}">
        <div class="grow"><div class="t">${esc(o.what)}</div><div class="s">${esc(o.sub || "")}</div></div>
        <span class="tag ${o.tone || ""}">${esc(o.tag)}</span></div>`).join("")}</div></div>` : ""}
  <div class="card"><h2>${t("todayActions")}</h2>
      <div class="actions" style="margin-top:4px">
        <button class="action" data-go="mywork"><span class="ic">🗂️</span>My work${openTasks.length ? ` (${openTasks.length})` : ""}</button>
        ${cashBox ? (() => {
          const low = cashBox.left < 2000, bad = cashBox.left < 0 || cashBox.noBill > 0;
          const col = bad ? "#B3451F" : low ? "#C8922F" : "#1C7A3E";
          return `<button class="action" data-go="cashBox" style="border-color:${col};color:${col}"
            title="${cashBox.noBill ? cashBox.noBill + " spent with no bill" : "What is in the cash box"}">
            <span class="ic">🧰</span>Cash box · ₹${Number(cashBox.left).toLocaleString("en-IN")}${cashBox.noBill ? ` · ${cashBox.noBill} without a bill` : ""}</button>`;
        })() : ""}
        ${(() => {
          const list = (typeof myOutstanding !== "undefined") ? myOutstanding : [];
          const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
          /* Pressing means a real deadline within three days, or already past. */
          const pressing = list.some(o => o.tone === "bad" || (o.due && String(o.due) <= soon));
          const col = !list.length ? { b: "var(--line)", c: "var(--muted)", i: "○" }
            : pressing ? { b: "#B3451F", c: "#B3451F", i: "⏰" }
            : { b: "#1C7A3E", c: "#1C7A3E", i: "⏳" };
          const to = list.length ? list[0].route : "mywork";
          return `<button class="action" data-go="${to}" title="${list.length ? "What is on your hands" : "Nothing outstanding"}"
            style="border-color:${col.b};color:${col.c}"><span class="ic">${col.i}</span>Due with you (${list.length})</button>`;
        })()}
        ${mayOpen("dayreport") ? `<button class="action" data-go="dayreport"><span class="ic">📝</span>${t("dayReport")}</button>` : ""}
        ${mayOpen("leave") ? `<button class="action" data-go="leave"><span class="ic">🌴</span>${t("leave")}</button>` : ""}
        ${mayOpen("expense") ? `<button class="action" data-go="expense"><span class="ic">🧾</span>${t("expense")}</button>` : ""}
        ${mayOpen("requisition") ? `<button class="action" data-go="requisition"><span class="ic">📦</span>Ask for something</button>` : ""}
        ${mayOpen("persons") ? `<button class="action" data-go="persons"><span class="ic">👤</span>${pt("persons")}</button>` : ""}
        ${mayOpen("chat") ? `<button class="action" data-go="chat"><span class="ic">💬</span>Chat</button>` : ""}
        ${waiting ? `<button class="action" data-go="inbox"><span class="ic">✅</span>${t("approvals")} (${waiting})</button>` : ""}
        ${(()=>{ const m3p=(state.projects||[]).find(p=>(p.code||p.name||"").toUpperCase().includes("M3-SAGE")); const onM3=m3p&&(m3p.leadId===state.user.uid||(m3p.team||[]).includes(state.user.uid)||has("super_admin","founder","program_officer","admin")); return onM3?`<button class="action" onclick="routes.m3baseline()" style="border-color:#0d4a7c;color:#0d4a7c"><span class="ic">📋</span>M3-SAGE Baseline</button>`:""; })()}
      </div></div>

    ${overdue ? `<div class="card"><h2>Overdue</h2><p class="small">You have <b>${overdue}</b> task${overdue > 1 ? "s" : ""} past their date.</p><button class="btn small" data-go="mywork">Open my work</button></div>` : ""}

    ${await (async () => {
      try {
        const todayD = today(); const ahead = new Date(); ahead.setDate(ahead.getDate()+30); const aheadStr = ahead.toISOString().slice(0,10);
        // National holidays built-in
        const NATL = [
          // National holidays
          {date:"2026-11-15",name:"Guru Nanak Jayanti",type:"National holiday"},
          {date:"2026-12-25",name:"Christmas Day",type:"National holiday"},
          {date:"2027-01-01",name:"New Year's Day",type:"National holiday"},
          {date:"2027-01-26",name:"Republic Day",type:"National holiday"},
          {date:"2027-03-14",name:"Holi",type:"National holiday"},
          {date:"2027-03-26",name:"Eid ul-Fitr",type:"National holiday"},
          {date:"2027-04-02",name:"Good Friday",type:"National holiday"},
          {date:"2027-04-14",name:"Dr. Ambedkar Jayanti",type:"National holiday"},
          {date:"2027-08-15",name:"Independence Day",type:"National holiday"},
          {date:"2027-10-02",name:"Gandhi Jayanti",type:"National holiday"},
          // International days aligned with Empower People's work
          {date:"2026-11-19",name:"International Men's Day",type:"Observance"},
          {date:"2026-11-20",name:"World Children's Day",type:"Observance"},
          {date:"2026-11-25",name:"Int'l Day for Elimination of Violence Against Women",type:"Observance"},
          {date:"2026-12-01",name:"World AIDS Day",type:"Observance"},
          {date:"2026-12-10",name:"Human Rights Day",type:"Observance"},
          {date:"2026-12-18",name:"International Migrants Day",type:"Observance"},
          {date:"2027-01-15",name:"Makar Sankranti / Lohri",type:"Observance"},
          {date:"2027-02-04",name:"World Cancer Day",type:"Observance"},
          {date:"2027-02-06",name:"Int'l Day of Zero Tolerance for FGM",type:"Observance"},
          {date:"2027-02-20",name:"World Day of Social Justice",type:"Observance"},
          {date:"2027-03-08",name:"International Women's Day",type:"Observance"},
          {date:"2027-03-21",name:"Int'l Day for Elimination of Racial Discrimination",type:"Observance"},
          {date:"2027-03-22",name:"World Water Day",type:"Observance"},
          {date:"2027-04-07",name:"World Health Day",type:"Observance"},
          {date:"2027-05-01",name:"International Labour Day",type:"Observance"},
          {date:"2027-05-18",name:"World AIDS Orphans Day",type:"Observance"},
          {date:"2027-06-12",name:"World Day Against Child Labour",type:"Observance"},
          {date:"2027-06-20",name:"World Refugee Day",type:"Observance"},
          {date:"2027-07-18",name:"Nelson Mandela International Day",type:"Observance"},
          {date:"2027-07-30",name:"World Day Against Trafficking in Persons",type:"Observance"},
          {date:"2027-08-12",name:"International Youth Day",type:"Observance"},
          {date:"2027-09-05",name:"Teachers' Day",type:"Observance"},
          {date:"2027-10-11",name:"International Day of the Girl Child",type:"Observance"},
          {date:"2027-10-16",name:"World Food Day",type:"Observance"},
          {date:"2027-10-17",name:"Int'l Day for Eradication of Poverty",type:"Observance"},
          {date:"2027-11-02",name:"Int'l Day to End Impunity for Crimes Against Journalists",type:"Observance"},
        ];
        const orgSnap = await db.collection("holidays").get().catch(()=>({docs:[]}));
        const orgHols = orgSnap.docs.map(d=>({...d.data(),org:true})).filter(h=>!h.officeId||h.officeId===state.me?.officeId);
        const all = [...NATL.map(h=>({...h,type:"National holiday",org:false})),...orgHols]
          .filter(h=>h.date>=todayD&&h.date<=aheadStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8);
        if(!all.length) return "";
        const isObs = h => /observance|campaign|awareness/i.test(h.type||"");
        const icon = h => isObs(h)?"🗓":h.type==="National holiday"?"🇮🇳":"🏖";
        return `<div class="card"><h2>Coming up · next 30 days</h2><div class="list">
          ${all.map(h=>`<div class="item" style="cursor:pointer" data-go="calendar">
            <div class="grow"><div class="t">${icon(h)} ${esc(h.name)}</div>
              <div class="s">${fmtD(h.date)} · ${esc(h.type||"Holiday")}${h.officeId?" · "+esc((state.offices||[]).find(o=>o.id===h.officeId)?.name||""):" · All offices"}</div></div>
            <span class="small muted">${Math.ceil((new Date(h.date)-new Date())/86400000)}d</span>
          </div>`).join("")}
        </div><button class="btn small quiet" style="margin-top:8px" data-go="holidays">Manage holidays</button></div>`;
      } catch { return ""; }
    })()}

    ${(() => {
      const newTasks = openTasks.filter(a => a.status === "assigned" && a.assignerId !== state.user.uid);
      if (!newTasks.length) return "";
      return `<div class="card" style="border-left:3px solid var(--green)">
        <h2>Tasks assigned to you · ${newTasks.length}</h2>
        <div class="list">${newTasks.map(a=>`<div class="item" style="cursor:pointer" data-go="mywork">
          <div class="grow">
            <div class="t">${esc(a.title)}</div>
            <div class="s">from ${esc(userName(a.assignerId))}${a.due?" · due "+fmtD(a.due):""}${a.instructions?` · ${esc(String(a.instructions).slice(0,60))}`:""}</div>
          </div>
          <span class="tag warn">New</span>
        </div>`).join("")}</div>
        <button class="btn small quiet" style="margin-top:8px" data-go="mywork">Go to My work →</button>
      </div>`;
    })()}

    ${(() => {
      const newTasks = openTasks.filter(a => a.status === "assigned" && a.assignerId !== state.user.uid);
      if (!newTasks.length) return "";
      return `<div class="card" style="border-left:3px solid var(--green)">
        <h2>Task${newTasks.length>1?"s":""} assigned to you</h2>
        <div class="list">${newTasks.map(a=>`<div class="item" style="cursor:pointer" data-go="mywork">
          <div class="grow">
            <div class="t">${esc(a.title)}</div>
            <div class="s">from ${esc(userName(a.assignerId))}${a.due?" · due "+fmtD(a.due):""}${a.instructions?` · ${esc(String(a.instructions).slice(0,60))}`:""}</div>
          </div>
          <span class="tag warn">New</span>
        </div>`).join("")}</div>
      </div>`;
    })()}

    ${state.inHand ? `<div class="card"><h2>Money in hand</h2>
      <p><b style="font-size:19px">₹${Math.round(state.inHand).toLocaleString("en-IN")}</b> <span class="small muted">from advances you are holding</span></p>
      <button class="btn small" data-go="expense">Report what you spent</button>
      <button class="btn small quiet" data-go="advance">See the advances</button></div>` : ""}
    <div class="card"><h2>Recent</h2><div class="list">
      ${recent.slice(0, 8).map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.k)}</div><div class="s">${esc(r.s)}</div></div><span class="tag ${/approved|verified|paid/.test(r.st) ? "ok" : /reject/.test(r.st) ? "bad" : "warn"}">${esc(r.st)}</span></div>`).join("") || `<div class="empty">Nothing yet</div>`}
    </div></div>
    ${has("super_admin") && hat() !== "appAdmin" ? `<div class="card" id="opsWidget"><div class="small muted" style="padding:4px 0">Loading pipeline…</div></div>` : ""}`);

  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));

  /* Save this month's karma score to permanent history */
  if (typeof calcKarma === "function" && isActive()) {
    const curMonth = today().slice(0, 7);
    db.collection("karmaHistory").where("uid","==",state.user.uid).where("month","==",curMonth).limit(1).get()
      .then(snap => {
        if (snap.empty) {
          calcKarma(state.user.uid, curMonth).then(res => { if(!res) return; const score = typeof res==="object"?res.score:res;
            db.collection("karmaHistory").add({ uid: state.user.uid, month: curMonth, score,
              name: state.me.name, savedAt: firebase.firestore.FieldValue.serverTimestamp() })
              .catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    // Annual appraisal record — save FY summary every April (first login of the FY)
    const now = new Date(); const isApril = now.getMonth() === 3;
    if (isApril) {
      const prevFY = `${now.getFullYear()-1}-${now.getFullYear()}`;
      db.collection("karmaAnnual").where("uid","==",state.user.uid).where("fy","==",prevFY).limit(1).get()
        .then(async snap => {
          if (snap.empty) {
            const hist = await db.collection("karmaHistory").where("uid","==",state.user.uid).get().catch(()=>({docs:[]}));
            const rows = hist.docs.map(d=>d.data()).filter(r=>(r.month||"").startsWith(String(now.getFullYear()-1)));
            if (rows.length) {
              const avg = Math.round(rows.reduce((s,r)=>s+(r.score||0),0)/rows.length);
              const best = Math.max(...rows.map(r=>r.score||0));
              await db.collection("karmaAnnual").add({ uid: state.user.uid, fy: prevFY, name: state.me.name,
                avgScore: avg, bestScore: best, months: rows.length,
                savedAt: firebase.firestore.FieldValue.serverTimestamp() });
            }
          }
        }).catch(()=>{});
    }
  }

  /* Karma meter + Employee of Month — deferred so home loads fast */
  if (typeof calcKarma === "function" && isActive() && !has("board", "observer")) {
    const karmaWrap = document.createElement("div");
    karmaWrap.id = "karmaSection";
  karmaWrap.innerHTML = '<div class="card" style="opacity:.5;min-height:60px"><p class="small muted" style="padding:12px">Calculating karma…</p></div>';
    $("content").prepend(karmaWrap);
    (async () => {
      const curMonth = today().slice(0, 7);
      const viewKarmaUid = state.karmaViewUid || state.user.uid;
      const [myScoreRaw, eom, team] = await Promise.all([
        calcKarma(viewKarmaUid, curMonth),
        getEmployeeOfMonth().catch(() => null),
        Promise.resolve([]) /* each person sees only their own karma */
      ]);

      if (myScoreRaw === null) { karmaWrap.innerHTML = ""; return; } // super_admin excluded
      const myScore = myScoreRaw;
      const eomHtml = eom ? `
        <div class="card" style="background:linear-gradient(135deg,#1F4D3A 0%,#276650 100%);color:#fff;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            ${(()=>{const u=(state.users||[]).find(x=>x.id===eom.uid);const ph=u?.photo||u?.photoUrl||eom.photo||"";const src=ph?(ph.startsWith('http')||ph.startsWith('data:')?ph:'data:image/jpeg;base64,'+ph):"";return src?`<img src="${esc(src)}" style="width:60px;height:60px;border-radius:50%;border:3px solid rgba(255,255,255,.4);object-fit:cover;flex-shrink:0">`:`<div style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:26px;flex-shrink:0">👤</div>`;})()}
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.8;margin-bottom:2px">✨ Employee of ${esc(eom.label)}</div>
              <div style="font-size:20px;font-weight:700">${esc(eom.name)}</div>
              ${eom.post ? `<div style="font-size:13px;opacity:.8;margin-top:1px">${esc(eom.post)}</div>` : ""}
            </div>
            <div style="text-align:center;flex-shrink:0">
              <div style="font-size:32px;font-weight:700">${eom.score}</div>
              <div style="font-size:11px;opacity:.7">karma</div>
            </div>
          </div>
        </div>` : "";

      const viewName = viewKarmaUid === state.user.uid ? "" : userName(viewKarmaUid);
      const myGaugeHtml = `
        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <h2 style="margin:0">${viewName ? esc(viewName) + "'s karma" : "My karma"} · ${new Date(curMonth+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</h2>
            ${has("super_admin") ? `<select id="karmaPersonPick" style="width:auto;padding:4px 8px;border-radius:8px;font-size:13px">
              <option value="${state.user.uid}">My karma</option>
              ${(state.users||[]).filter(u=>u.active&&isStaff(u)&&u.id!==state.user.uid&&!((u.roles||[]).includes("super_admin")&&!(u.roles||[]).includes("founder"))).map(u=>`<option value="${u.id}" ${u.id===viewKarmaUid?"selected":""}>${esc(u.name)}</option>`).join("")}
            </select>` : ""}
          </div>
          ${karmaGauge(typeof myScore==="object"?myScore.score:myScore, "", viewName||userName(state.user.uid), 220)}
          ${typeof myScore==="object"&&myScore.detail ? `<div style="display:grid;grid-template-columns:repeat(${myScore.wCoord>0?3:2},1fr);gap:6px;margin:8px 4px 0;font-size:13px">
            <div style="border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:2px">Attendance & reports</div>
              <div style="font-size:18px;font-weight:700;color:${myScore.basePct<40?"#E74C3C":myScore.basePct<80?"#E67E22":"#27AE60"}">${myScore.basePct}</div>
              <div style="font-size:10px;color:#aaa">${Math.round(myScore.wBase*100)}% weight</div>
              <div style="font-size:10px;color:#666;margin-top:3px">${myScore.detail.daysWithCO}/${myScore.detail.workingDays} days present · ${myScore.detail.productiveDays||0} with app activity${myScore.detail.drMissed?" · "+myScore.detail.drMissed+" no report":""}</div>
            </div>
            <div style="border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:2px">Work outputs</div>
              <div style="font-size:18px;font-weight:700;color:${myScore.outputPct<40?"#E74C3C":myScore.outputPct<80?"#E67E22":"#27AE60"}">${myScore.outputPct}</div>
              <div style="font-size:10px;color:#aaa">${Math.round(myScore.wOut*100)}% weight</div>
              <div style="font-size:10px;color:#666;margin-top:3px">${esc(myScore.detail.outputBreakdown||myScore.detail.outputs+" items")}</div>
            </div>
            ${myScore.wCoord>0 ? `<div style="border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:2px">Coordination</div>
              <div style="font-size:18px;font-weight:700;color:${myScore.coordPct<40?"#E74C3C":myScore.coordPct<80?"#E67E22":"#27AE60"}">${myScore.coordPct}</div>
              <div style="font-size:10px;color:#aaa">${Math.round(myScore.wCoord*100)}% weight</div>
              <div style="font-size:10px;color:#666;margin-top:3px">${myScore.detail.coordBreakdown||myScore.detail.coordItems+" items from your team"}</div>
            </div>` : ""}
          </div>` : ""}
        </div>`;

const teamHtml = ""; // each person sees only their own karma

      karmaWrap.innerHTML = eomHtml + myGaugeHtml + teamHtml;

      // EOM flash announcement — show once per month per user
      if (eom) {
        const seenKey = "ep_eom_seen_" + eom.month;
        const alreadySeen = localStorage.getItem(seenKey);
        if (!alreadySeen) {
          const u = (state.users||[]).find(x=>x.id===eom.uid);
          const ph = u?.photo||u?.photoUrl||eom.photo||"";
          const src = ph ? (ph.startsWith("http")||ph.startsWith("data:") ? ph : "data:image/jpeg;base64,"+ph) : "";
          const flash = document.createElement("div");
          flash.id = "eomFlash";
          flash.style.cssText = "position:fixed;inset:0;z-index:9999;background:linear-gradient(135deg,#1F4D3A 0%,#276650 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;text-align:center;animation:fadeIn .4s ease";
          flash.innerHTML = `<style>#eomFlash{color:#fff}@keyframes fadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}@keyframes fadeOut{from{opacity:1}to{opacity:0;transform:scale(.96)}}</style>
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:.12em;opacity:.7">✨ Employee of ${esc(eom.label)}</div>
            ${src ? `<img src="${esc(src)}" style="width:100px;height:100px;border-radius:50%;border:4px solid rgba(255,255,255,.5);object-fit:cover">` : `<div style="width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:48px">👤</div>`}
            <div style="font-size:28px;font-weight:700">${esc(eom.name)}</div>
            ${eom.post ? `<div style="font-size:14px;opacity:.8">${esc(eom.post)}</div>` : ""}
            <div style="font-size:48px;font-weight:800;line-height:1">${eom.score}<span style="font-size:16px;opacity:.7;margin-left:4px">karma</span></div>
            <button onclick="document.getElementById('eomFlash').style.animation='fadeOut .3s ease forwards';setTimeout(()=>document.getElementById('eomFlash')?.remove(),300)" style="margin-top:8px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;padding:10px 28px;border-radius:24px;font-size:14px;cursor:pointer">🎉 Congratulations!</button>`;
          document.body.appendChild(flash);
          localStorage.setItem(seenKey, "1");
        }
      }

      // Error log widget — super_admin / founder only
      if (has("super_admin", "founder")) {
        const since = new Date(Date.now() - 24*3600000);
        db.collection("appLogs").where("resolved","==",false).orderBy("createdAt","desc").limit(50).get().then(snap => {
          const logs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.createdAt?.toDate?.()>=since||!l.createdAt);
          if (!logs.length) return;
          const errWrap = document.createElement("div");
          errWrap.id = "errorLog";
          const rows = logs.slice(0,8).map(l=>`
            <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)">
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600">${esc(l.name||"Unknown")} <span class="tag">${esc(l.route||"?")}</span></div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc((l.error||"").slice(0,120))}</div>
              </div>
              <button class="btn small quiet" data-resolve="${l.id}" style="font-size:11px;flex-shrink:0">Resolve</button>
            </div>`).join("");
          errWrap.innerHTML = `<div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">⚠ App errors · last 24h</h2><span class="tag" style="background:#e53935;color:#fff">${logs.length} unresolved</span></div>${rows}${logs.length>8?`<p class="small muted" style="margin-top:8px">${logs.length-8} more…</p>`:""}</div>`;
          document.getElementById("content").appendChild(errWrap);
          errWrap.querySelectorAll("[data-resolve]").forEach(b => b.onclick = async () => {
            await db.collection("appLogs").doc(b.dataset.resolve).update({resolved:true});
            b.closest("div[style]").style.opacity=".4"; b.textContent="✓";
          });
        }).catch(()=>{});
      }

      // Wire admin karma person picker
      setTimeout(() => {
        const pick = document.getElementById("karmaPersonPick");
        if (pick) pick.onchange = e => { state.karmaViewUid = e.target.value; routes.home(); };
      }, 300);
      // Animate all karma gauges using data attributes (inline scripts don't run in innerHTML)
      setTimeout(() => {
        karmaWrap.querySelectorAll("[data-kuid]").forEach(el => {
          const uid = el.dataset.kuid;
          const pct = parseFloat(el.dataset.kpct);
          const arc = parseFloat(el.dataset.karc);
          const angle = parseFloat(el.dataset.kangle);
          const col = el.dataset.kcolour;
          const prog = el.querySelector("#prog" + uid);
          const ndl  = el.querySelector("#ndl"  + uid);
          const txt  = el.querySelector("text");
          if (prog) { prog.style.transition = "stroke-dashoffset 1.3s cubic-bezier(.4,0,.2,1)"; prog.style.strokeDashoffset = arc * (1 - pct); }
          if (ndl)  { ndl.style.transition  = "transform 1.3s cubic-bezier(.4,0,.2,1)"; ndl.style.transform = `rotate(${angle}deg)`; }
          if (txt)  { txt.style.transition  = "fill 1.3s"; txt.style.fill = col; }
        });
      }, 200);
    })();
  }
  if (typeof wireAdvanceCard === "function") wireAdvanceCard({ lines: [] });

  $("content").querySelectorAll("[data-where]").forEach(b => b.onclick = () => {
    state.whereToday = b.dataset.where;
    $("content").querySelectorAll("[data-where]").forEach(x => x.classList.toggle("quiet", x.dataset.where !== b.dataset.where));
  });
  const mark = async (field) => {
    const btn = $(field === "checkIn" ? "inBtn" : "checkOutBtn"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    const ref = db.collection("attendance").doc(`${uid}_${today()}`);
    const stamp = new Date().toTimeString().slice(0, 5);
    const patch = { uid, name: state.me.name, date: today(), officeId: state.me.officeId || null, [field]: stamp };
    let where = state.whereToday || "office";
    if (where === "home" && !canWFH) { where = "field";
      alert(`Working from home is for staff at the headquarters. You are posted at ${myOffice.name || "a field office"}, so this is recorded as a field check-in.`); }
    patch.where = where;
    const office = where === "home" ? null : state.offices.find(o => o.id === state.me.officeId);
    if (where === "home" && field === "checkIn") {
      if (!wfhToday) { alert("Working from home needs your line manager's agreement. Apply under Leave — you may do it this morning."); 
        if (btn) { btn.disabled = false; btn.textContent = "📍 Check in"; } return; }
      const why = prompt("Working from home today — what will you be doing?\n\n(It is recorded for your manager, like a day report.)");
      if (why === null) { if (btn) { btn.disabled = false; btn.textContent = "📍 Check in"; } return; }
      patch.place = "Working from home"; patch.wfhNote = why;
      patch.wfhStatus = wfhOk ? "approved" : "awaiting approval";
      patch.wfhRequestId = wfhToday.id || null;
    }
    try {
      const pos = await new Promise(res => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(p => res(p), () => res(null), { timeout: 8000, enableHighAccuracy: true })
        : res(null));
      if (pos) {
        patch[field + "At"] = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), accuracy: Math.round(pos.coords.accuracy || 0) };
        // Only offices with a radius are fenced — Delhi HQ. Everywhere else is recorded, not restricted.
        if (office && office.radius && office.lat) {
          const away = metresBetween(pos.coords.latitude, pos.coords.longitude, office.lat, office.lng);
          patch[field + "Metres"] = away;
          if (field === "checkIn" && away > office.radius) {  // checkout is never blocked
            if (where === "office") {
              // Hard block — must select "In the field" if working away
              alert(`You are ${away} m from ${office.name}. Office check-in requires you to be within ${office.radius} m.\n\nIf you are doing field work, go back and select "In the field".`);
              if (btn) { btn.disabled = false; btn.textContent = "📍 Check in"; }
              return;
            }
            // Field check-in from outside radius — allowed, record distance
            patch.away = true; patch.place = patch.place || "Field";
          }
        }
      } else if (office && office.radius && field === "checkIn") {
        const why = prompt(`Your phone did not give a location, and ${office.name} expects check-in on site.\n\nSay where you are — it will be recorded for your manager.\n\n(Leave blank to cancel.)`);
        if (!why) { if (btn) { btn.disabled = false; btn.textContent = "📍 Check in"; } return; }
        patch.noLocation = true; patch.place = why;
      }
    } catch { }
    if (field === "checkOut" && a && a.checkIn) {
      const [h1, m1] = a.checkIn.split(":").map(Number), [h2, m2] = stamp.split(":").map(Number);
      patch.hours = Math.max(0, Math.round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 6) / 10);
    }
    try { await ref.set(patch, { merge: true }); audit(field === "checkIn" ? "check_in" : "check_out", "attendance", ref.id, stamp);

      if (field === "checkIn") autoLogActivity(`Checked in at ${stamp}${where ? " · " + where : ""}`).catch(()=>{});
      else autoLogActivity(`Checked out at ${stamp}`).catch(()=>{});
      toast(field === "checkIn" ? "Checked in at " + stamp : "Checked out at " + stamp);
      if (field === "checkIn" && where === "field") { toast("Opening journeys — start one when you're ready"); routes.travelog(); } else { routes.home(); } }
    catch (e) { $("attErr").textContent = e.message; if (btn) { btn.disabled = false; btn.textContent = "Try again"; } }
  };
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  if ($("inBtn")) $("inBtn").onclick = () => mark("checkIn");
  if ($("checkOutBtn")) $("checkOutBtn").onclick = () => mark("checkOut");

  // Stuck journey — "Yes still on the way" snoozes 4 hrs; "No I'm back" goes to travelog
  if ($("stillTravellingBtn")) {
    $("stillTravellingBtn").onclick = () => {
      sessionStorage.setItem("journeySnoozed", String(Date.now() + 4*60*60*1000));
      $("stuckJourneyCard").style.display = "none";
      toast("OK — we'll check in again later 👍");
    };
  }
  if ($("endJourneyNowBtn")) $("endJourneyNowBtn").onclick = () => go("travelog");

  /* Operations pipeline widget — Shafiq only, loads after page */
  if (has("super_admin") && hat() !== "appAdmin" && $("opsWidget")) {
    (async () => {
      try {
        const [lvSnap, ecSnap, advSnap, reqSnap] = await Promise.all([
          db.collection("leaveRequests").where("status","==","pending").limit(50).get().catch(()=>({docs:[]})),
          db.collection("expenseClaims").where("status","in",["submitted","manager_approved"]).limit(50).get().catch(()=>({docs:[]})),
          db.collection("advances").where("status","in",["requested","issued"]).limit(50).get().catch(()=>({docs:[]})),
          db.collection("requisitions").where("status","in",["Awaiting department head","Verified — awaiting Director ACF","Awaiting Director ACF","Awaiting the General Secretary"]).limit(50).get().catch(()=>({docs:[]})),
        ]);
        const items = [];
        lvSnap.docs.forEach(d => {
          const r = d.data();
          const before = (r.managerIds||[]).map(id=>userName(id)).filter(Boolean).join(", ")||"—";
          items.push({ what:"Leave · "+esc(r.name||userName(r.uid))+" · "+esc(r.type||"")+" "+(r.days||"")+"d", before, when:r.from, tone:r.from<today()?"bad":"warn" });
        });
        ecSnap.docs.forEach(d => {
          const r = d.data();
          const before = r.status==="manager_approved" ? (userName((r.managerIds||[])[0])||"Director ACF") : (r.managerIds||[]).map(id=>userName(id)).filter(Boolean).join(", ")||"—";
          items.push({ what:"Expense · "+esc(r.name||userName(r.uid))+" · ₹"+Number(r.amount||0).toLocaleString("en-IN"), before, when:r.date, tone:"warn" });
        });
        advSnap.docs.forEach(d => {
          const r = d.data();
          if (r.status==="issued" && r.settleby && r.settleby>=today()) return;
          const before = r.status==="requested" ? (r.managerIds||[]).map(id=>userName(id)).filter(Boolean).join(", ")||"—" : "Accounts";
          items.push({ what:"Advance · "+esc(r.name||userName(r.uid))+" · ₹"+Number(r.amount||0).toLocaleString("en-IN")+(r.purpose?" · "+esc(r.purpose):""), before, when:r.settleby||"", tone:r.status==="issued"?"bad":"warn" });
        });
        reqSnap.docs.forEach(d => {
          const r = d.data();
          const before = /General Secretary/i.test(r.status||"") ? "General Secretary" : /Director ACF/i.test(r.status||"") ? "Director ACF" : esc(r.forDept||"department head");
          items.push({ what:"Requisition · "+esc(r.item||"")+" × "+(r.qty||1)+" · "+esc(userName(r.uid)||r.name||""), before, when:r.neededBy||"", tone:"warn" });
        });
        items.sort((a,b)=>String(a.when||"").localeCompare(String(b.when||"")));
        const el = $("opsWidget"); if (!el) return;
        const rows = items.map(x =>
          "<div class=\"item\"><div class=\"grow\"><div class=\"t\">"+x.what+"</div>"+
          "<div class=\"s\">Pending before: <b>"+esc(x.before)+"</b></div></div>"+
          (x.when?"<span class=\"tag "+(x.tone||"warn")+"\">"+(fmtD(x.when)||"")+"</span>":"")+"</div>").join("");
        const hdr = "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px\"><h2 style=\"margin:0\">Pipeline ("+(items.length||"all clear")+")</h2><button class=\"btn small quiet\" onclick=\"go('operations')\">Full view ↗</button></div>";
        // May annual review alert
        let mayAlert = "";
        if (new Date().getMonth() === 4) { // May
          try {
            const staff = (state.users||[]).filter(u => u.active && isStaff(u) && u.id !== state.user.uid);
            const reviews = await db.collection("serviceReviews").where("year","==",fyOfDate(today())).get().catch(()=>({docs:[]}));
            const reviewed = new Set(reviews.docs.map(d=>d.data().uid));
            const pending = staff.filter(u => !reviewed.has(u.id));
            if (pending.length) mayAlert = `<div class="card" style="border:2px solid var(--warn);margin-bottom:8px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="flex:1"><b>Annual reviews due — ${pending.length} staff</b><div class="small muted">May is the annual review month. Line managers should submit reviews for: ${pending.slice(0,3).map(u=>esc(u.name)).join(", ")}${pending.length>3?" and "+(pending.length-3)+" more":""}.</div></div><button class="btn small" onclick="go('users')">Go to staff records</button></div></div>`;
          } catch(e){}
        }
        el.innerHTML = mayAlert + hdr + (rows ? "<div class=\"list\">"+rows+"</div>" : "<div class=\"empty\">Nothing waiting — all clear.</div>");
      } catch(e) { if ($("opsWidget")) $("opsWidget").innerHTML = ""; }
    })();
  }
};

// routes.checkin → home screen handles check-in with full geofencing via mark()
routes.checkin = () => routes.home();

/* ================= REPORTS FROM MY TEAM =================
   Everything the people reporting to you have written — the day's work, event
   reports, case updates, journeys and programme updates — in one place.
   Each line manager sees their own people; nobody sees sideways. */
const REPORT_KINDS = {
  dayReports:       { label: "Day report",       by: "uid",         date: "date",  text: "text",     verify: true },
  events:           { label: "Event report",     by: "createdBy",   date: "date",  text: "summary" },
  caseUpdates:      { label: "Case update",      by: "by",          date: "date",  text: "note",     sensitive: true },
  journeys:         { label: "Journey",          by: "uid",         date: "date",  text: "purpose" },
  programmeUpdates: { label: "Programme update", by: "by",          date: "date",  text: "text" },
  activityReports:  { label: "Activity report",  by: "createdBy",   date: "date",  text: "text" }
};
routes.teamReports = async () => {
  setTitle("Reports from my team");
  const uid = viewUid();
  const line = state.users.filter(u => u.active && mgrs(u).includes(uid)).map(u => u.id);
  const wide = has("super_admin", "admin", "program_officer", "director_acf");
  const mineToo = [...line, uid];
  const kind = state.rtKind || "all";
  const month = state.rtMonth || "";
  const pull = async (col, cfg) => {
    try {
      const snap = await db.collection(col).limit(300).get();
      return snap.docs.map(d => ({ id: d.id, col, cfg, ...d.data() }))
        .filter(r => { const who = r[cfg.by]; return who && (wide ? true : mineToo.includes(who)) && who !== uid; });
    } catch { return []; }
  };
  const all = (await Promise.all(Object.entries(REPORT_KINDS).map(([c, cfg]) => pull(c, cfg)))).flat()
    .filter(r => !month || String(r[r.cfg.date] || "").startsWith(month))
    .sort((a, b) => String(b[b.cfg.date] || "").localeCompare(String(a[a.cfg.date] || "")));
  const byKind = {}; all.forEach(r => { byKind[r.col] = (byKind[r.col] || 0) + 1; });
  const unread = all.filter(r => r.cfg.verify && r.status !== "verified");
  const list = kind === "all" ? all : kind === "unread" ? unread : all.filter(r => r.col === kind);
  const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const silent = state.users.filter(u => u.active && mgrs(u).includes(uid) &&
    !all.some(r => r[r.cfg.by] === u.id && String(r[r.cfg.date] || "") >= week));
  const canExport = has("super_admin", "admin", "director_acf", "program_officer");
  html(`<div class="card"><h2>Reports from my team</h2>
      <p class="small muted">${wide ? "Everything written across the organisation." : "Written by the people who report to you."}
        Open one to read it in full; a day report can be marked as read so they know you have.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn small ${kind === "unread" ? "" : "quiet"}" data-rk="unread">Not yet read (${unread.length})</button>
        <button class="btn small ${kind === "all" ? "" : "quiet"}" data-rk="all">Everything (${all.length})</button>
        ${Object.entries(byKind).map(([c, n]) => `<button class="btn small ${kind === c ? "" : "quiet"}" data-rk="${c}">${esc(REPORT_KINDS[c].label)} (${n})</button>`).join("")}</div>
      <div class="two" style="margin-top:10px"><label class="field"><span>Month</span><input type="month" id="rtMonth" value="${esc(month)}"></label>
        ${canExport ? `<label class="field"><span>&nbsp;</span><button class="btn small" id="rtExport">Export the month for the report</button></label>` : ""}</div></div>

    ${silent.length ? `<div class="card" style="border-left:4px solid #C8922F"><h2>Nothing in a week</h2>
      <p class="small muted">These people report to you but have written nothing in the last seven days.</p>
      <div class="list">${silent.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="s">${esc(u.postTitle || "")}${u.officeId ? " · " + esc(officeName(u.officeId)) : ""}</div></div></div>`).join("")}</div></div>` : ""}

    <div class="card"><div class="list">${list.slice(0, 120).map(r => { const c = r.cfg;
      const body = (() => {
        // Day reports store content in items[] + narrative, not a single text field
        if (c.label === "Day report") {
          const parts = [];
          if (r.narrative) parts.push(r.narrative);
          if ((r.items||[]).length) parts.push((r.items).map(i=>"· "+i).join("\n"));
          if (r.checkIn) parts.push(`Checked in: ${r.checkIn}${r.checkOut?" · Out: "+r.checkOut:""}`);
          return parts.join("\n\n") || "(No content yet)";
        }
        return r[c.text] || r.text || r.note || r.summary || "";
      })();
      return `<div class="item" style="flex-wrap:wrap">
        <div class="grow"><div class="t">${esc(userName(r[c.by]))} · ${fmtDate(r[c.date])} <span class="tag">${esc(c.label)}</span></div>
          <div class="s">${esc(r.location || r.place || projectName(r.projectId) || "")}${r.photo ? " · 📎" : ""}${r.audio ? " · 🎤" : ""}</div>
          <div class="hidden" id="rd_${r.id}" style="margin-top:8px;padding:10px 12px;background:var(--bg);border-radius:10px">
            ${r.taskProgress ? `<p class="small"><b>Task progress</b><br>${esc(r.taskProgress)}</p>` : ""}
            <p style="white-space:pre-wrap;margin:0">${esc(body)}</p>
            ${r.blockers ? `<p class="small" style="margin-top:6px;color:#8A5A00"><b>In the way</b><br>${esc(r.blockers)}</p>` : ""}
            ${r.photo ? `<img src="${r.photo}" style="max-width:100%;border-radius:8px;margin-top:8px">` : ""}
            ${r.managerNote ? `<p class="small" style="margin-top:8px"><b>You said back:</b> ${esc(r.managerNote)}</p>` : ""}
            <div id="rd_details_${r.id}"></div></div></div>
        <div style="display:flex;gap:6px;align-items:center">
          ${c.verify ? `<span class="tag ${r.status === "verified" ? "ok" : "warn"}">${r.status === "verified" ? "read" : "not read"}</span>` : ""}
          <button class="btn small quiet" data-rd="${r.id}">Read</button>
          ${c.verify && r.status !== "verified" ? `<button class="btn small" data-verify="${r.id}">Mark read</button>` : ""}</div></div>`; }).join("")
      || `<div class="empty">${kind === "unread" ? "Everything has been read." : "Nothing here"}</div>`}</div>
      ${list.length > 120 ? `<p class="small muted">Showing the most recent 120 of ${list.length}. Narrow by month or by kind.</p>` : ""}</div>`);
  $("content").querySelectorAll("[data-rk]").forEach(b => b.onclick = () => { state.rtKind = b.dataset.rk; routes.teamReports(); });
  $("rtMonth").onchange = e => { state.rtMonth = e.target.value; routes.teamReports(); };
  $("content").querySelectorAll("[data-rd]").forEach(b => b.onclick = async () => {
    const box = document.getElementById("rd_" + b.dataset.rd);
    const opening = box.classList.contains("hidden");
    box.classList.toggle("hidden"); b.textContent = opening ? "Close" : "Read";
    if (!opening) return;
    // For day reports — fetch full activity details from source collections
    const r = all.find(x => x.id === b.dataset.rd);
    if (!r || r.col !== "dayReports") return;
    // Show loading
    const detailsDiv = document.getElementById("rd_details_" + r.id);
    if (!detailsDiv || detailsDiv.dataset.loaded) return;
    detailsDiv.innerHTML = `<div class="small muted" style="margin-top:8px">Loading full details…</div>`;
    try {
      const [cuSnap, evSnap, benSnap] = await Promise.all([
        db.collection("caseUpdates").where("by","==",r.uid).where("date","==",r.date).get().catch(()=>({docs:[]})),
        db.collection("eventReports").where("uid","==",r.uid).where("date","==",r.date).get().catch(()=>({docs:[]})),
        db.collection("benefits").where("recordedBy","==",r.uid).where("date","==",r.date).get().catch(()=>({docs:[]}))
      ]);
      let html2 = "";
      if (cuSnap.docs.length) {
        html2 += `<div style="margin-top:10px"><b style="font-size:12px">Case updates (${cuSnap.docs.length})</b>`;
        cuSnap.docs.forEach(d => {
          const cu = d.data();
          html2 += `<div style="margin-top:8px;padding:8px;background:var(--bg2);border-radius:8px">
            <div class="small" style="font-weight:600">${esc(cu.kind||"Update")}${cu.personId||cu.name?" · "+esc(cu.name||cu.personId):""}${cu.projectId?" · "+esc(projectName(cu.projectId)):""}</div>
            <div style="margin-top:4px;white-space:pre-wrap;line-height:1.5">${esc(cu.notes||cu.note||cu.text||"")}</div>
            ${cu.outcome?`<div class="small muted" style="margin-top:4px">Outcome: ${esc(cu.outcome)}</div>`:""}
          </div>`;
        });
        html2 += `</div>`;
      }
      if (evSnap.docs.length) {
        html2 += `<div style="margin-top:10px"><b style="font-size:12px">Event reports (${evSnap.docs.length})</b>`;
        evSnap.docs.forEach(d => {
          const ev = d.data();
          html2 += `<div style="margin-top:8px;padding:8px;background:var(--bg2);border-radius:8px">
            <div class="small" style="font-weight:600">${esc(ev.heading||ev.title||"Event")}</div>
            <div style="margin-top:4px;white-space:pre-wrap">${esc(ev.report||ev.summary||ev.text||"")}</div>
          </div>`;
        });
        html2 += `</div>`;
      }
      if (benSnap.docs.length) {
        html2 += `<div style="margin-top:10px"><b style="font-size:12px">Benefits recorded (${benSnap.docs.length})</b><div style="margin-top:4px">`;
        benSnap.docs.forEach(d => {
          const bn = d.data();
          html2 += `<div class="small" style="margin-top:4px">· ${esc(bn.type||bn.category||"Benefit")} — ${esc(bn.name||bn.personName||"")}${bn.value?" · ₹"+bn.value:""}</div>`;
        });
        html2 += `</div></div>`;
      }
      detailsDiv.innerHTML = html2 || `<div class="small muted" style="margin-top:6px">No linked case updates or events for this date.</div>`;
      detailsDiv.dataset.loaded = "1";
    } catch(e) { detailsDiv.innerHTML = ""; }
  });
  $("content").querySelectorAll("[data-verify]").forEach(b => b.onclick = async () => {
    const id = b.dataset.verify;
    const wrap = b.closest(".item");
    if (wrap.querySelector(".verify-box")) return;
    const vbox = document.createElement("div");
    vbox.className = "verify-box";
    vbox.style.cssText = "margin-top:10px;width:100%;display:flex;flex-direction:column;gap:8px";
    vbox.innerHTML = `<textarea rows="2" placeholder="Note back to them (optional)" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px;resize:vertical"></textarea>
      <div style="display:flex;gap:8px">
        <button class="btn small" id="vok_${id}">✓ Mark verified</button>
        <button class="btn small quiet" id="vcancel_${id}">Cancel</button>
      </div>`;
    wrap.appendChild(vbox);
    document.getElementById("vcancel_"+id).onclick = () => vbox.remove();
    document.getElementById("vok_"+id).onclick = async () => {
      const rep = await db.collection("dayReports").doc(id).get();
      const note = vbox.querySelector("textarea").value.trim();
      document.getElementById("vok_"+id).disabled = true;
      await db.collection("dayReports").doc(id).update({ status: "verified", verifiedBy: state.user.uid, verifiedOn: today(), managerNote: note || null });
      audit("verify", "dayReports", id, ""); toast("Verified ✓"); routes.teamReports(); }; });
  if ($("rtExport")) $("rtExport").onclick = () => exportMonth(state.rtMonth || today().slice(0, 7));
};

/* Everything of a month, in one workbook, for writing the monthly report. */
async function exportMonth(month) {
  if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  toast("Gathering the month…");
  const g = async c => (await db.collection(c).limit(900).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  const inMonth = (r, f) => String(r[f] || "").startsWith(month);
  const [day, ev, cu, jr, pu, ben, act, req, exp, lv, adv, dak, asg, ir, per, pc, ec, tr, sr] = await Promise.all(
    ["dayReports", "eventReports", "caseUpdates", "journeys", "programmeUpdates", "benefits", "activities",
     "requisitions", "expenses", "leaveRequests", "advances", "dak", "assignments", "incomeReceipts",
     "persons", "pettyCash", "expenseClaims", "travelRequests", "supportRequests"].map(g));
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 28)); };
  // Extract a clickable URL from a file field — handles string URL, Drive object {link,url,id}, or array
  const fileLink = f => {
    if (!f) return "";
    if (typeof f === "string") return f;
    if (Array.isArray(f)) return f.map(fileLink).filter(Boolean).join(", ");
    return f.link || f.url || (f.id ? "https://drive.google.com/file/d/" + f.id + "/view" : "") || "";
  };
  sheet("Day reports", day.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, Who: userName(r.uid),
    Place: r.location, Project: projectName(r.projectId),
    "What was done": [...(r.items||[]), r.narrative||"", r.text||""].filter(Boolean).join(" | "),
    "Task progress": r.taskProgress, "In the way": r.blockers,
    "Attachments": (r.attachments||[]).map(a=>fileLink(a)).filter(Boolean).join(", "),
    "Bills / vouchers": (r.attachments||[]).filter(a=>!String(a.type||"").startsWith("image/")&&!(a.name||"").match(/\.(jpg|jpeg|png|gif|webp)$/i)).map(a=>fileLink(a)||a.name).join(", "),
    Read: r.status === "verified" ? "Yes" : "No", "Manager said": r.managerNote })));
  sheet("Event reports", ev.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date,
    Heading: r.heading || r.name || r.title, Activity: r.activity || "",
    Place: r.place || r.location, State: r.state || "", District: r.district || "",
    Participants: r.participants, Women: r.women, "Sakhis present": r.Sakhis || r.sakhis || "",
    Sessions: r.sessions || "", Project: projectName(r.projectId),
    Report: r.report || r.summary || "", Outcome: r.outcome || "", "Next step": r.nextStep || "",
    Status: r.status || "", "Filed by": r.filedByName || userName(r.uid) || userName(r.createdBy),
    "Evidence": fileLink(r.evidenceFile) || fileLink(r.files) || fileLink(r.driveUrl) || (r.evidenceId||"") })));
  sheet("Case updates", cu.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, "Sakhi ID": r.personCode || "",
    Kind: r.kind, Note: r.note, By: userName(r.by), "Attachment": fileLink(r.file)||fileLink(r.attachment)||"" })));
  sheet("Benefits", ben.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, Service: r.service,
    Description: r.description, "Value ₹": r.value, Project: projectName(r.projectId), "Sakhi ID": r.personCode || "",
    By: userName(r.recordedBy), "Receipt": fileLink(r.receiptUrl)||fileLink(r.receipt)||fileLink(r.bill)||"" })));
  sheet("Journeys", jr.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, Who: userName(r.uid),
    From: r.fromPlace, To: r.toPlace, Purpose: r.purpose, "Km": r.km, "Cost ₹": r.cost })));
  sheet("Programme updates", pu.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, Programme: r.programmeName,
    Kind: r.kind, State: r.state, "Women reached": r.reached, Update: r.text, By: userName(r.by) })));
  sheet("Activities", act.map(r => ({ Project: projectName(r.projectId), Code: r.code, Activity: r.name,
    Target: r.target, Unit: r.unit, Status: r.status, Lead: userName(r.leadId) })));
  sheet("Tasks", asg.filter(r => inMonth(r, "due") || inMonth(r, "doneAt")).map(r => ({ Title: r.title,
    Assigned: userName(r.assigneeId), By: userName(r.assignerId), Due: r.due, Status: r.status,
    Done: r.doneAt, "What was done": r.doneNote })));
  sheet("Requisitions", req.filter(r => inMonth(r, "neededBy")).map(r => ({ Item: r.item, "₹": r.estimate,
    Asked: userName(r.uid), "Goes to": r.goesTo, Status: r.status, With: r.ownerName })));
  sheet("Expenses", exp.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, Particulars: r.particulars,
    Payee: r.payee, "₹": r.amount, Head: r.head, Project: projectName(r.projectId), Voucher: r.voucher,
    "Paid by": r.mode, Status: r.status, "Bill": fileLink(r.billUrl)||fileLink(r.bill)||"" })));
  sheet("Income receipts", ir.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date, "Receipt no.": r.receiptNo,
    Remitter: r.remitter, "₹": r.amount, Type: r.type, Purpose: r.purpose, Description: r.description,
    Mode: r.mode, Bank: r.bank, Project: projectName(r.projectId), FCRA: r.fcra ? "Yes" : "No",
    Foreign: r.foreign ? "Yes" : "No", "Exchange rate": r.rate || "", "Filed by": r.byName || userName(r.createdBy) })));
  sheet("Advances", adv.filter(r => inMonth(r, "neededBy") || inMonth(r, "settledOn")).map(r => ({ Who: userName(r.uid),
    Purpose: r.purpose, "Advance ₹": r.amount, "Spent ₹": r.spent, "Returned ₹": r.returned, Status: r.status, Settled: r.settledOn })));
  sheet("Leave", lv.filter(r => inMonth(r, "from")).map(r => ({ Who: userName(r.uid), Type: r.type,
    From: r.from, To: r.to, Days: r.days, Status: r.status })));
  sheet("Dak", dak.filter(r => inMonth(r, "date")).map(r => ({ "Dak no.": r.dakNo, Date: r.date,
    Direction: r.direction, "From / to": r.fromTo, Subject: r.subject, Status: r.status })));
  sheet("Sakhis registered", per.filter(r => inMonth(r, "registeredOn")).map(r => ({ "Sakhi ID": r.code,
    Name: r.name || [r.firstName, r.lastName].filter(Boolean).join(" "),
    "Registered on": r.registeredOn, Block: r.block, District: r.district, State: r.state,
    Programme: r.programmeName || "", Project: projectName(r.projectId),
    "Registered by": userName(r.registeredBy) })));
  sheet("Petty cash", pc.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date,
    Particulars: r.particulars, Payee: r.payee,
    "In ₹": r.inAmt || 0, "Out ₹": r.outAmt || 0,
    Project: projectName(r.projectId), Programme: r.programmeName || "",
    "Bill": fileLink(r.bill)||fileLink(r.billUrl)||"", "No-bill note": r.noBillNote || "",
    "Approved by": userName(r.approvedBy) })));
  sheet("Expense claims", ec.filter(r => inMonth(r, "date")).map(r => ({ Date: r.date,
    Who: r.name || userName(r.uid), Category: r.category,
    Description: r.description || r.purpose || "", "₹": r.amount,
    Status: r.status, "Bill": fileLink(r.bill)||fileLink(r.billUrl)||"",
    "Approved by": userName(r.approvedBy) })));
  sheet("Travel requests", tr.filter(r => inMonth(r, "from") || inMonth(r, "to")).map(r => ({ "From": r.from,
    "To date": r.to, Who: userName(r.travellerId),
    Purpose: r.purpose, Advance: r.advance || "", Status: r.status })));
  sheet("Support requests", sr.filter(r => inMonth(r, "date") || inMonth(r, "createdAt")).map(r => ({ Date: r.date || r.createdAt,
    Title: r.title, Category: r.category || r.type || "",
    Description: r.description || r.note || "", Status: r.status,
    "Requested by": userName(r.uid) || r.byName, "Assigned to": userName(r.assignedTo) })));
  const label = new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Organisation: "Empower People", Month: label,
    "Prepared by": state.me.name, "Prepared on": today(),
    "Day reports": day.filter(r => inMonth(r, "date")).length,
    "Event reports": ev.filter(r => inMonth(r, "date")).length,
    "Benefits delivered": ben.filter(r => inMonth(r, "date")).length,
    "Sakhis registered": per.filter(r => inMonth(r, "registeredOn")).length,
    "Case updates": cu.filter(r => inMonth(r, "date")).length,
    "Income ₹": ir.filter(r => inMonth(r, "date")).reduce((a, r) => a + (Number(r.amount) || 0), 0),
    "Expenses ₹": exp.filter(r => inMonth(r, "date")).reduce((a, r) => a + (Number(r.amount) || 0), 0),
    "Petty cash out ₹": pc.filter(r => inMonth(r, "date")).reduce((a, r) => a + (Number(r.outAmt) || 0), 0),
    "Tasks completed": asg.filter(r => inMonth(r, "doneAt")).length,
    "Journeys": jr.filter(r => inMonth(r, "date")).length }]), "Cover");
  XLSX.writeFile(wb, `Empower-People-${month}-monthly.xlsx`);
  audit("export", "month", null, month);
  toast("Downloaded");
}


/* ── Monthly reports — downloadable Excel for each department ── */
async function buildMonthExcel(month, sheets, filename) {
  if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  toast("Building report for " + month + "…");
  const wb = XLSX.utils.book_new();
  const inM = (r,k) => ((r[k]||r.date||r.sentOn||"")).startsWith(month);
  const g = col => db.collection(col).where("date",">=",month+"-01").where("date","<=",month+"-31").limit(500).get().catch(()=>({docs:[]})).then(s=>s.docs.map(d=>({id:d.id,...d.data()})));
  const gA = col => db.collection(col).limit(500).get().catch(()=>({docs:[]})).then(s=>s.docs.map(d=>({id:d.id,...d.data()})));
  const addS = (name,rows) => { if(rows.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name.slice(0,31)); };
  const lnk = arr => (arr||[]).map(f=>f.url||f.link||"").filter(Boolean).join(", ");
  if(sheets.prog){
    const [ev,cu,ben,pu]=await Promise.all([g("eventReports"),g("caseUpdates"),g("benefits"),g("programmeUpdates")]);
    addS("Event reports",ev.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, Heading:r.heading||r.name||"",
      Activity:r.activity||"", Place:r.place||"",
      Participants:r.participants||"", Women:r.women||"",
      "Session type":r.sessionType||"", Duration:r.duration||"",
      Report:r.report||r.summary||"",
      "Key outcomes":r.outcomes||"",
      "Challenges":r.challenges||"",
      Project:projectName(r.projectId),
      Files:lnk(r.files),
      By:r.byName||userName(r.createdBy)
    })));
    addS("Case updates",cu.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, "Sakhi ID":r.personCode||r.personCode||"",
      "Person name":r.name||"",
      Kind:r.kind||"", Note:r.notes||r.note||"",
      Outcome:r.outcome||"", "Next step":r.nextStep||"",
      Project:projectName(r.projectId),
      Attachment:r.file||"",
      By:userName(r.by)
    })));
    addS("Benefits given",ben.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, "Sakhi ID":r.personCode||"",
      "Person name":r.name||"",
      Service:r.service||"", Description:r.description||"",
      "₹ value":r.value||"",
      "Benefit type":r.type||"",
      Project:projectName(r.projectId),
      Programme:r.programmeName||"",
      Receipt:r.receiptUrl||"",
      "Recorded by":r.recordedByName||userName(r.recordedBy)
    })));
    addS("Programme updates",pu.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, Programme:r.programmeName||"",
      Kind:r.kind||"", "Women reached":r.reached||"",
      Update:r.text||"",
      Files:lnk(r.files),
      By:userName(r.by)
    })));
    // Sakhis registered this month
    const persons = await gA("persons");
    const personsInMonth = persons.filter(p=>{
      const d = p.registeredOn || p.createdAt?.toDate?.()?.toISOString?.()?.slice(0,10) || "";
      return d.startsWith(month);
    });
    // Cross-reference activity for each Sakhi
    // caseUpdates link by personId (doc ID), benefits link by personCode
    const cuByPerson = {};
    cu.forEach(c=>{ if(!c.personId) return; if(!cuByPerson[c.personId]) cuByPerson[c.personId]=[]; cuByPerson[c.personId].push(c); });
    const benByCode = {};
    ben.forEach(b=>{ if(!b.personCode) return; if(!benByCode[b.personCode]) benByCode[b.personCode]=[]; benByCode[b.personCode].push(b); });

    addS("Sakhis registered", personsInMonth.map(p=>{
      const pCU = (cuByPerson[p.id]||[]).filter(c=>inM(c,"date"));
      const pBen = (benByCode[p.code]||[]).filter(b=>inM(b,"date"));
      return {
        "Sakhi ID": p.code || "",
        "Name": p.name || "",
        "Sex": p.sex || "",
        "Block": p.block || "",
        "District": p.district || "",
        "State": p.state || "",
        "Phone": p.phone || "",
        "Work status": p.workStatus || "",
        "Source": p.source || "",
        "Registered by": userName(p.registeredBy),
        "Date registered": p.registeredOn || "",
        "Case updates": pCU.length || "",
        "Case update details": pCU.map(c=>`${c.date} · ${c.kind||""}: ${(c.notes||"").slice(0,100)}`).join(" || "),
        "Benefits": pBen.length || "",
        "Benefits details": pBen.map(b=>`${b.date} · ${b.service||b.description||""}`).join(" || ")
      };
    }));

    // All Sakhi activity this month (newly registered + existing with any activity)
    const allActiveIds = new Set([
      ...cu.filter(c=>inM(c,"date")).map(c=>c.personId).filter(Boolean),
      ...ben.filter(b=>inM(b,"date")).map(b=>b.personCode).filter(Boolean)
    ]);
    const allPersonsMap = {};
    persons.forEach(p=>{ allPersonsMap[p.id]=p; allPersonsMap[p.code]=p; });
    const sakhibActivity = [...allActiveIds].map(id=>{
      const p = allPersonsMap[id] || {};
      const pCU = (cuByPerson[id]||[]).filter(c=>inM(c,"date"));
      const pBen = (benByCode[id]||[]).filter(b=>inM(b,"date"));
      return {
        "Sakhi ID": p.code || id,
        "Name": p.name || "",
        "District": p.district || "",
        "State": p.state || "",
        "Case updates this month": pCU.length || 0,
        "Case update details": pCU.map(c=>`${c.date} · ${c.kind||""}: ${(c.notes||"").slice(0,120)}`).join(" || "),
        "Benefits this month": pBen.length || 0,
        "Benefits details": pBen.map(b=>`${b.date} · ${b.service||b.description||""}`).join(" || ")
      };
    }).filter(r=>r["Case updates this month"]||r["Benefits this month"]);
    addS("Sakhi activity", sakhibActivity);
    // Attendance this month
    const att = await g("attendance");
    addS("Attendance", att.map(a=>({
      Date: a.date || "",
      Name: a.name || userName(a.uid),
      "Check in": a.checkIn || "",
      "Check out": a.checkOut || "",
      Hours: a.hours || "",
      Location: a.location || a.place || "",
      "Work from": a.workFrom || ""
    })).sort((a,b)=>(a.Date||"").localeCompare(b.Date||"")));
  }
  if(sheets.accounts){
    const [exp,claims,petty,adv,inc,reqs]=await Promise.all([
      gA("expenses"),gA("expenseClaims"),gA("pettyCash"),
      gA("advances"),gA("incomeReceipts"),gA("requisitions")
    ]);
    addS("Expenses",exp.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, Particulars:r.particulars||"", Payee:r.payee||"",
      "₹":r.amount, Head:r.head||"", Category:r.category||"",
      Project:projectName(r.projectId), "Payment mode":r.mode||"",
      Voucher:r.voucher||"", "Pay stage":r.payStage||"",
      Status:r.status||"", FCRA:r.fcra?"Yes":"",
      "Prepared by":r.preparedBy||userName(r.createdBy),
      "Approved by":userName(r.approvedBy),
      "Approved on":r.approvedAt?.toDate?.()?.toISOString?.()?.slice(0,10)||"",
      Bill:lnk(r.bills)||(typeof r.bill==="string"?r.bill:"")
    })));
    addS("Reimbursement claims",claims.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, Name:r.name||userName(r.uid),
      Description:r.description||"", "₹":r.amount,
      Category:r.category||"", Project:projectName(r.projectId),
      "Fund type":r.fundType||"", Status:r.status||"",
      "Against advance":r.againstAdvance?"Yes":"",
      "Payment ref":r.payment||"",
      "Approved by":userName(r.approvedBy),
      "Approve note":r.approveNote||"",
      Bill:r.bill||"", F02:r.form_F02_url||""
    })));
    addS("Cash box (petty)",petty.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, Particulars:r.particulars||"",
      "Out ₹":r.outAmt||"", "In ₹":r.inAmt||"",
      Payee:r.payee||"", "By":userName(r.by),
      Project:projectName(r.projectId),
      "Money type":r.moneyType||"",
      Status:r.status||"", "Accepted":r.accepted?"Yes":"",
      "Approve note":r.approveNote||"",
      "No-bill note":r.noBillNote||"",
      Bill:typeof r.bill==="string"?r.bill:"",
      F05:r.form_F05_url||""
    })));
    addS("Staff advances",adv.filter(r=>inM(r,"date")||inM(r,"issuedOn")).map(r=>({
      Date:r.issuedOn||r.date||"", Name:r.name||userName(r.uid),
      Purpose:r.purpose||"", "₹":r.amount,
      "Issued by":r.byName||userName(r.issuedBy),
      Mode:r.mode||"", "From account":r.fromAccount||"",
      "Voucher no":r.voucherNo||"", UTR:r.utr||"",
      Project:projectName(r.projectId),
      Status:r.status||"", "Settle by":r.settleby||"",
      "Correction note":r.correctionNote||""
    })));
    addS("Income receipts",inc.filter(r=>inM(r,"date")).map(r=>({
      Date:r.date, "Receipt no":r.receiptNo||"",
      Donor:r.remitter||"", "Donor address":r.donorAddress||"",
      "Donor PAN":r.donorPan||"",
      "₹":r.amount, "Foreign currency":r.foreign?"Yes":"",
      "Exchange rate":r.rate||"",
      Description:r.description||"", Purpose:r.purpose||"",
      Mode:r.mode||"", Bank:r.bank||"",
      Project:projectName(r.projectId),
      FCRA:r.fcra?"Yes":"", Type:r.type||"",
      "Recorded by":r.byName||userName(r.createdBy)
    })));
    addS("Requisitions",reqs.filter(r=>inM(r,"date")||inM(r,"neededBy")).map(r=>({
      Item:r.item||"", Category:r.category||"",
      Purpose:r.purpose||"", Qty:r.qty||"",
      "Estimated ₹":r.estimate||"",
      "Needed by":r.neededBy||"", "Requested by":userName(r.uid),
      "Office":r.officeId||"", Project:projectName(r.projectId),
      Status:r.status||"", "Head approved by":userName(r.headApprovedBy),
      "Fulfilled on":r.fulfilledOn||"", "Fulfilled note":r.fulfilledNote||""
    })));
  }
  if(sheets.admin){
    const [lv,dak,jny]=await Promise.all([gA("leaveRequests"),g("dak"),g("journeys")]);
    addS("Leave",lv.filter(r=>inM(r,"from")).map(r=>({Who:userName(r.uid),Type:r.type,From:r.from,To:r.to,Days:r.days,Status:r.status})));
    const attA = await g("attendance");
    addS("Attendance",attA.map(a=>({Date:a.date||"",Name:a.name||userName(a.uid),"Check in":a.checkIn||"","Check out":a.checkOut||"",Hours:a.hours||"",Location:a.location||a.place||""})).sort((a,b)=>(a.Date||"").localeCompare(b.Date||"")));
    addS("Dak",dak.filter(r=>inM(r,"date")).map(r?(r=>({Dak:r.dakNo,Date:r.date,Direction:r.direction,"From/to":r.fromTo,Subject:r.subject||""})):r=>r));
    addS("Journeys",jny.filter(r=>inM(r,"date")).map(r=>({Date:r.date,Who:userName(r.uid),From:r.fromPlace||"",To:r.toPlace||"",Purpose:r.purpose||"",Km:r.km||""})));
  }
  if(sheets.pdri){
    const props=await gA("proposals");
    addS("Proposals",props.filter(r=>inM(r,"sentOn")||inM(r,"correctedOn")).map(r=>({Sent:r.sentOn,Proposal:r.name||"",Org:r.org||"",Ask:r.ask||"",Status:r.status,Files:lnk(r.files),Notes:r.notes||""})));
  }
  if(sheets.day){
    const [dr,asg,cuAll,benAll,evAll,attAll,jnyAll]=await Promise.all([
      g("dayReports"),gA("assignments"),
      g("caseUpdates"),g("benefits"),g("eventReports"),
      g("attendance"),g("journeys")
    ]);
    const byUD=(arr,uf,df)=>{const m={};arr.forEach(r=>{const k=(r[uf]||"")+"_"+(r[df]||"");(m[k]=m[k]||[]).push(r);});return m;};
    const cuMap=byUD(cuAll,"by","date"),benMap=byUD(benAll,"recordedBy","date"),evMap=byUD(evAll,"uid","date"),attMap=byUD(attAll,"uid","date"),jnyMap=byUD(jnyAll,"travellerId","date");
    addS("Day reports",dr.filter(r=>inM(r,"date")).map(r=>{
      const uid=r.uid||"",date=r.date||"",k=uid+"_"+date;
      const cus=cuMap[k]||[],bens=benMap[k]||[],evs=evMap[k]||[],att=(attMap[k]||[])[0],jnys=jnyMap[k]||[];
      return {
        Date:date, Who:r.name||userName(uid),
        "Check in":att?.checkIn||"", "Check out":att?.checkOut||"",
        Status:r.status||"submitted",
        "Verified by":r.verifiedBy?userName(r.verifiedBy):"",
        "Manager note":r.managerNote||"",
        Place:r.location||"",
        Narrative:r.narrative||"",
        "Activities logged":(r.items||[]).join(" | "),
        "Case updates (count)":cus.length||"",
        "Case updates detail":cus.map(c=>"["+( c.kind||"update")+"] "+(c.personCode||c.name||"")+" — "+(c.notes||c.note||"").slice(0,150)).join(" || "),
        "Sakhis supported":[...new Set(bens.map(b=>b.personCode||b.name).filter(Boolean))].join(", "),
        "Benefits given (count)":bens.length||"",
        "Benefits detail":bens.map(b=>(b.service||b.type||"")+" to "+(b.personCode||b.name||"")+(b.value?" (₹"+b.value+")":"")).join(" | "),
        "Events filed":evs.map(e=>(e.heading||e.title||"Event")+" ("+( e.participants||0)+" participants)").join(" | "),
        "Journeys":jnys.map(j=>(j.fromPlace||"")+"→"+(j.toPlace||"")+" ("+(j.purpose||"")+")").join(" | "),
        Attachments:lnk(r.attachments)
      };
    }));
    const asgInMonth = asg.filter(a=>inM(a,"createdAt")||inM(a,"doneAt")||inM(a,"due")||(a.due||"").startsWith(month));
    if(asgInMonth.length) addS("Assignments",asgInMonth.map(a=>({
      Title:a.title||"",
      "Given to":userName(a.assigneeId),
      "Given by":userName(a.assignerId),
      Due:a.due||"",
      Status:a.status||"",
      Target:a.target?(a.target+" "+a.targetUnit):"—",
      "Done note":a.doneNote||"",
      "Completed on":a.doneAt||""
    })));
  }
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{Organisation:"Empower People",Month:month,"Prepared by":state.me.name,"Prepared on":today()}]),"Cover");
  XLSX.writeFile(wb,filename||("EP-"+month+"-report.xlsx"));
  toast("Downloaded ✓");
}

routes.monthlyReports = async () => {
  setTitle("Monthly reports");
  const cur=today().slice(0,7);
  const isProg=has("super_admin","admin","program_officer","program_coord","program_lead","field_staff");
  const isAcc=has("super_admin","admin","accounts");
  const isAdm=has("super_admin","admin");
  const isPDRI=has("super_admin","admin","fundraising","fundraising_coord");
  html(`<div class="card"><h2>Monthly reports</h2>
    <p class="small muted">Excel workbook for the selected month — all data with Drive links to every uploaded file, bill and receipt.</p>
    <div class="two" style="margin-bottom:16px"><label class="field"><span>Month</span><input type="month" id="rptM" value="${cur}" max="${cur}"></label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${isProg?'<button class="btn" id="dlProg">📊 Programme report</button>':""}
      ${isAcc?'<button class="btn" id="dlAcc">💰 Accounts report</button>':""}
      ${isAdm?'<button class="btn" id="dlAdm">🏢 Admin report</button>':""}
      ${isPDRI?'<button class="btn" id="dlPDRI">📋 PDRI report</button>':""}
      ${isAdm?'<button class="btn quiet" id="dlAll">📁 Full report</button>':""}
    </div></div>`);
  const m=()=>document.getElementById("rptM")?.value||cur;
  if($("dlProg")) $("dlProg").onclick=()=>buildMonthExcel(m(),{prog:true,day:true},"EP-Programme-"+m()+".xlsx");
  if($("dlAcc"))  $("dlAcc").onclick=()=>buildMonthExcel(m(),{accounts:true},"EP-Accounts-"+m()+".xlsx");
  if($("dlAdm"))  $("dlAdm").onclick=()=>buildMonthExcel(m(),{admin:true,day:true},"EP-Admin-"+m()+".xlsx");
  if($("dlPDRI")) $("dlPDRI").onclick=()=>buildMonthExcel(m(),{pdri:true},"EP-PDRI-"+m()+".xlsx");
  if($("dlAll"))  $("dlAll").onclick=()=>buildMonthExcel(m(),{prog:true,accounts:true,admin:true,pdri:true,day:true},"EP-Full-"+m()+".xlsx");
};

routes.dayreport = async () => {
  setTitle("Day report");
  const uid = viewUid();
  const todayStr = today();

  // Fetch today's activity from app for auto-preview
  const [asg, mine, myAtt, myPersons, myBenefits, myEvents, myCases, myDak, myTasks, myJourneys, myProgUpdates, myOutreach, myProposals, myExpenses, myPettyCash, teamReports] = await Promise.all([
    Promise.resolve([]), // assignments TO them: not day-report content (ongoing state, not today's additions)
    db.collection("dayReports").where("uid","==",uid).orderBy("date","desc").limit(8).get().then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]),
    db.collection("attendance").where("uid","==",uid).where("date","==",todayStr).limit(1).get().catch(()=>({docs:[]})),
    db.collection("persons").where("registeredBy","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("benefits").where("recordedBy","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("eventReports").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("cases").where("openedBy","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("dak").where("enteredBy","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("assignments").where("createdBy","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("journeys").where("travellerId","==",uid).limit(20).get().catch(()=>({docs:[]})),
    db.collection("programmeUpdates").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("outreach").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("proposals").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("expenses").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    db.collection("pettyCash").where("uid","==",uid).limit(50).get().catch(()=>({docs:[]})),
    // Team reports for manager verification
    isManager() ? Promise.all([
      db.collection("dayReports").where("status","==","submitted").limit(50).get().catch(()=>({docs:[]})),
      db.collection("dayReports").where("status","==","auto").limit(50).get().catch(()=>({docs:[]}))
    ]).then(([a,b])=>({docs:[...a.docs,...b.docs]})) : Promise.resolve({docs:[]})
  ]);

  // Build auto-activity items for today
  const autoItems = [];
  const att = myAtt.docs[0]?.data();
  if (att?.checkIn) autoItems.push(`Checked in at ${att.checkIn}${att.checkOut?" · checked out at "+att.checkOut:""}`);
  const todaySakhis = myPersons.docs.filter(d=>d.data().registeredOn===todayStr||d.data().createdAt?.seconds&&new Date(d.data().createdAt.seconds*1000).toISOString().slice(0,10)===todayStr);
  if (todaySakhis.length) autoItems.push(`Registered ${todaySakhis.length===1?"a Sakhi":""+todaySakhis.length+" Sakhis"}: ${todaySakhis.map(d=>d.data().name||"unnamed").join(", ")}`);
  const todaySvcs = myBenefits.docs.filter(d=>d.data().date===todayStr);
  if (todaySvcs.length) { const names=[...new Set(todaySvcs.map(d=>d.data().name).filter(Boolean))].slice(0,3); autoItems.push(`Recorded ${todaySvcs.length} benefit${todaySvcs.length>1?"s":""}${names.length?" for "+names.join(", "):""}`); }
  const todayEvts = myEvents.docs.filter(d=>d.data().date===todayStr);
  if (todayEvts.length) { const evtNames=todayEvts.map(d=>d.data().heading||d.data().title).filter(Boolean).slice(0,2); autoItems.push(`Filed ${todayEvts.length===1?"an event report":""+todayEvts.length+" event reports"}${evtNames.length?": "+evtNames.join(", "):""}`); }
  const todayCases = myCases.docs.filter(d=>d.data().date===todayStr);
  if (todayCases.length) autoItems.push(`Opened ${todayCases.length} case${todayCases.length>1?"s":""}`);
  const todayDak = myDak.docs.filter(d=>d.data().date===todayStr);
  if (todayDak.length) autoItems.push(`Entered ${todayDak.length} dak item${todayDak.length>1?"s":""}`);
  const todayAssigned = myTasks.docs.filter(d=>d.data().createdOn===todayStr||d.data().createdAt?.seconds&&new Date(d.data().createdAt.seconds*1000).toISOString().slice(0,10)===todayStr);
  if (todayAssigned.length) autoItems.push(`Assigned ${todayAssigned.length} task${todayAssigned.length>1?"s":""}: ${todayAssigned.map(d=>d.data().title||"task").join(", ")}`);
  // Tasks they assigned to others today
  if (todayAssigned.length) { /* already added above */ }
  // Journeys
  const todayJourneys = myJourneys.docs.map(d=>d.data()).filter(j=>j.date===todayStr);
  todayJourneys.forEach(j=>{
    const status = j.status==="reached"?"returned":(j.status||"on the way");
    autoItems.push(`Travel: ${j.fromPlace||""}${j.toPlace?" → "+j.toPlace:""}${j.purpose?" · "+j.purpose:""} [${status}]`);
  });
  // Programme updates
  const todayProgUpdates = myProgUpdates.docs.map(d=>d.data()).filter(p=>p.date===todayStr||(p.createdAt?.seconds&&new Date(p.createdAt.seconds*1000).toISOString().slice(0,10)===todayStr));
  if (todayProgUpdates.length) { const names=todayProgUpdates.map(p=>p.programmeName||p.programme||"").filter(Boolean).slice(0,2); autoItems.push(`Filed ${todayProgUpdates.length} programme update${todayProgUpdates.length>1?"s":""}${names.length?" · "+names.join(", "):""}`); }
  // Outreach contacts
  const todayOutreach = myOutreach.docs.map(d=>d.data()).filter(o=>o.date===todayStr||(o.createdAt?.seconds&&new Date(o.createdAt.seconds*1000).toISOString().slice(0,10)===todayStr));
  if (todayOutreach.length) { const names=todayOutreach.map(o=>o.name||o.organisation||"").filter(Boolean).slice(0,3); autoItems.push(`Outreach: ${todayOutreach.length} contact${todayOutreach.length>1?"s":""}${names.length?" — "+names.join(", "):""}`); }
  // Proposals
  const todayProposals = myProposals.docs.map(d=>d.data()).filter(p=>p.date===todayStr||(p.createdAt?.seconds&&new Date(p.createdAt.seconds*1000).toISOString().slice(0,10)===todayStr));
  if (todayProposals.length) { const names=todayProposals.map(p=>p.title||p.name||"").filter(Boolean).slice(0,2); autoItems.push(`Submitted ${todayProposals.length} proposal${todayProposals.length>1?"s":""}${names.length?": "+names.join(", "):""}`); }
  // Expense claims
  const todayExpenses = myExpenses.docs.map(d=>d.data()).filter(e=>e.date===todayStr||(e.createdAt?.seconds&&new Date(e.createdAt.seconds*1000).toISOString().slice(0,10)===todayStr));
  if (todayExpenses.length) { const total=todayExpenses.reduce((s,e)=>s+(Number(e.amount)||0),0); autoItems.push(`Filed ${todayExpenses.length} expense claim${todayExpenses.length>1?"s":""}${total?" · ₹"+total.toLocaleString("en-IN"):""}`); }
  // Petty cash
  const todayPetty = myPettyCash.docs.map(d=>d.data()).filter(e=>e.date===todayStr||(e.createdAt?.seconds&&new Date(e.createdAt.seconds*1000).toISOString().slice(0,10)===todayStr));
  if (todayPetty.length) { const total=todayPetty.reduce((s,e)=>s+(Number(e.amount)||0),0); autoItems.push(`Petty cash: ${todayPetty.length} entr${todayPetty.length>1?"ies":"y"}${total?" · ₹"+total.toLocaleString("en-IN"):""}`); }

  // Team reports pending manager verification
  const myTeam = (state.users||[]).filter(u=>(u.managerIds||[]).includes(uid)).map(u=>u.id);
  const eightHoursAgo = new Date(Date.now() - 8*60*60*1000);
  const pendingVerify = teamReports.docs.map(d=>({id:d.id,...d.data()})).filter(r => {
    if (!myTeam.includes(r.uid) || r.verified) return false;
    if (r.status === "auto") return true; // auto reports need no grace period
    const submitted = r.createdAt?.toDate ? r.createdAt.toDate() : r.createdAt ? new Date(r.createdAt) : null;
    return !submitted || submitted <= eightHoursAgo;
  });
  // Check if current user (manager) is on approved leave — warn that reports are waiting
  const myLeave = await db.collection("leaveRequests").where("uid","==",uid).where("status","==","approved").limit(10).get().catch(()=>({docs:[]}));
  const onLeaveNow = myLeave.docs.some(d=>{const l=d.data();return l.from<=todayStr&&l.to>=todayStr;});
  const managerOnLeave = onLeaveNow && pendingVerify.length > 0;
  // Escalation: find reports from staff whose direct manager is on leave today — route to their manager (me)
  // Check if any active user's manager is on leave and that manager reports to me
  const escalatedReports = [];
  if (isManager()) {
    const mySubManagers = (state.users||[]).filter(u=>u.active&&mgrs(u).includes(uid)&&isManager(u));
    for (const subMgr of mySubManagers) {
      const subLeave = await db.collection("leaveRequests").where("uid","==",subMgr.id).where("status","==","approved").limit(5).get().catch(()=>({docs:[]}));
      const subOnLeave = subLeave.docs.some(d=>{const l=d.data();return l.from<=todayStr&&l.to>=todayStr;});
      if (subOnLeave) {
        const subTeam = (state.users||[]).filter(u=>u.active&&mgrs(u).includes(subMgr.id)).map(u=>u.id);
        const subReports = teamReports.docs.map(d=>({id:d.id,...d.data()})).filter(r=>subTeam.includes(r.uid)&&!r.verified);
        subReports.forEach(r=>escalatedReports.push({...r, _escalatedFrom: subMgr.name}));
      }
    }
  }

  const todaysReport = mine.find(r=>r.date===todayStr);
  html(`
    ${todaysReport ? `<div class="card" style="border:2px solid var(--green)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1"><h2 style="margin:0">Today's report — ${fmtD(todayStr)}</h2>
          <p class="small muted" style="margin:4px 0 0">Auto-recorded from your app activity${todaysReport.status==="verified"?" · ✓ verified by "+esc(userName(todaysReport.verifiedBy)):""}</p></div>
        <span class="tag ${todaysReport.status==="verified"?"ok":"warn"}">${esc(todaysReport.status||"submitted")}</span>
      </div>
      ${todaysReport.items?.length?`<div class="list" style="margin-top:8px">${todaysReport.items.map(i=>`<div class="item"><div class="t">${esc(i)}</div></div>`).join("")}</div>`:`<div class="empty" style="margin:8px 0">No activity recorded yet today — will fill as you work.</div>`}
      ${todaysReport.narrative?`<p class="small" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><b>Note:</b> ${esc(todaysReport.narrative)}</p>`:""}
      ${todaysReport.status!=="verified" ? `<form id="f" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="two">
          <label class="field"><span>Where you worked</span><input name="location" placeholder="Village, block, office" value="${esc(todaysReport.location||"")}"></label>
          <label class="field"><span>Programme / Project</span><select name="projectId">${programmeProjectOptions(todaysReport.projectId)}</select></label>
        </div>
        <label class="field"><span>Narrative — field visits, meetings, calls, challenges, anything outside the app</span>
          <textarea name="narrative" rows="3" placeholder="e.g. Visited 3 households in Dhubri block, met with ASHA worker, attended gram sabha…">${esc(todaysReport.narrative||"")}</textarea></label>
        ${asg.length ? `<label class="field"><span>Open tasks</span>
          <div class="list">${asg.map(a=>`<div class="item"><div class="grow"><div class="t">${esc(a.title)}</div>
            <div class="s">from ${esc(userName(a.assignerId))}${a.due?" · due "+fmtD(a.due):""}</div></div>
            <select data-task="${a.id}" style="width:auto;padding:4px 8px;border-radius:8px;font-size:13px">
              <option>Not started</option>
              <option ${a.progress==="In progress"?"selected":""}>In progress</option>
              <option ${a.progress==="Completed"?"selected":""}>Completed</option>
              <option ${a.progress==="Blocked"?"selected":""}>Blocked</option>
            </select></div>`).join("")}</div></label>` : ""}
        <div class="two">
          <label class="field"><span>Evidence</span>
            <input type="file" id="drFiles" accept="image/*,video/*,.pdf,.doc,.docx" multiple>
            <div id="drList" class="small muted" style="margin-top:4px"></div></label>
          <label class="field"><span>Voice note</span>
            <div class="chips"><button type="button" class="btn small quiet" id="vrec">🎤 Record</button>
            <span class="small muted" id="vst"></span></div></label>
        </div>
        <button class="btn" type="submit">Save</button>
      </form>` : ""}
    </div>` : `

    <!-- Today's auto-activity preview -->
    <div class="card">
      <h2>Today's activity — ${fmtD(todayStr)}</h2>
      <p class="small muted">Your report builds automatically as you work in the app. It is sent to your line manager at the end of the day.</p>
      ${autoItems.length ? `<div class="list" style="margin:8px 0">${autoItems.map(i=>`<div class="item"><div class="t">${esc(i)}</div></div>`).join("")}</div>`
        : `<div class="empty" style="margin:8px 0">No activity yet today — start working and it will appear here.</div>`}

      <form id="f" style="margin-top:12px">
        <input type="hidden" name="date" value="${todayStr}">
        <div class="two">
          <label class="field"><span>Where you worked</span><input name="location" placeholder="Village, block, office"></label>
          <label class="field"><span>Programme / Project</span><select name="projectId">${programmeProjectOptions()}</select></label>
        </div>
        <label class="field"><span>Add a note — anything not captured above</span>
          <textarea name="narrative" rows="3" placeholder="Field visits, community meetings, informal work outside the app, challenges faced…"></textarea></label>
        ${asg.length ? `<label class="field"><span>Open tasks</span>
          <div class="list">${asg.map(a=>`<div class="item"><div class="grow"><div class="t">${esc(a.title)}</div>
            <div class="s">from ${esc(userName(a.assignerId))}${a.due?" · due "+fmtD(a.due):""}</div></div>
            <select data-task="${a.id}" style="width:auto;padding:4px 8px;border-radius:8px;font-size:13px">
              <option>Not started</option>
              <option ${a.progress==="In progress"?"selected":""}>In progress</option>
              <option ${a.progress==="Completed"?"selected":""}>Completed</option>
              <option ${a.progress==="Blocked"?"selected":""}>Blocked</option>
            </select></div>`).join("")}</div></label>` : ""}
        <div class="two">
          <label class="field"><span>Evidence</span>
            <input type="file" id="drFiles" accept="image/*,video/*,.pdf,.doc,.docx" multiple>
            <div id="drList" class="small muted" style="margin-top:4px"></div></label>
          <label class="field"><span>Voice note</span>
            <div class="chips"><button type="button" class="btn small quiet" id="vrec">🎤 Record</button>
            <span class="small muted" id="vst"></span></div></label>
        </div>
        <button class="btn" type="submit">Add note to today's report</button>
        <span class="small muted">Report auto-submits at 8pm — saving adds your narrative now.</span>
      </form>
    </div>`}

    ${managerOnLeave ? `<div class="card" style="border-left:4px solid #C8922F"><p class="small" style="margin:0">⚠️ You are on approved leave. ${pendingVerify.length} team report${pendingVerify.length>1?"s":""} will wait until you return — or you can still verify them here.</p></div>` : ""}
    ${escalatedReports.length ? `<div class="card" style="border-left:4px solid #1a6b4a"><h2>Escalated — manager on leave (${escalatedReports.length})</h2>
      <p class="small muted" style="margin-top:0">These reports are from staff whose line manager is on leave today. You can verify them in their absence.</p>
      <div class="list">${escalatedReports.map(r=>`<div class="item" style="flex-direction:column;align-items:flex-start;gap:0;padding:10px 0">
        <div style="display:flex;width:100%;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer" data-rdtoggle="${r.id}">
          <b>${esc(userName(r.uid))}</b>
          <span class="small muted">${fmtD(r.date)}</span>
          <span class="tag warn">via ${esc(r._escalatedFrom)}</span>
          <span class="small" style="margin-left:auto;color:var(--green)">▼ Read</span></div>
        <div id="rd_${r.id}_e" class="hidden" style="width:100%;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          ${r.items?.length?`<ul style="margin:0 0 8px;padding-left:18px">${r.items.map(i=>`<li class="small">${esc(i)}</li>`).join("")}</ul>`:""}
          ${r.narrative?`<p class="small" style="margin:4px 0"><b>Narrative:</b> ${esc(r.narrative)}</p>`:""}
          <div style="display:flex;gap:6px;margin-top:10px">
            <button class="btn small" data-verify="${r.id}">✓ Verify</button></div></div></div>`).join("")}</div></div>` : ""}
    ${pendingVerify.length ? `<div class="card">
      <h2>Team reports to verify (${pendingVerify.length})</h2>
      <div class="list">${pendingVerify.map(r=>`<div class="item" style="flex-direction:column;align-items:flex-start;gap:0;padding:10px 0">
        <div style="display:flex;width:100%;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer" data-rdtoggle="${r.id}">
          <b>${esc(userName(r.uid))}</b>
          <span class="small muted">${fmtD(r.date)}</span>
          ${r.autoGenerated?`<span class="tag">auto</span>`:""}
          ${r.location?`<span class="small muted">📍 ${esc(r.location)}</span>`:""}
          <span class="small" style="margin-left:auto;color:var(--green)">▼ Read</span>
        </div>
        <div id="rd_${r.id}" class="hidden" style="width:100%;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          ${r.items?.length?`<ul style="margin:0 0 8px;padding-left:18px">${r.items.map(i=>`<li class="small">${esc(i)}</li>`).join("")}</ul>`:""}
          ${r.narrative?`<p class="small" style="margin:4px 0"><b>Narrative:</b> ${esc(r.narrative)}</p>`:""}
          ${!r.items?.length&&!r.narrative&&r.text?`<p class="small" style="margin:4px 0;white-space:pre-wrap">${esc(r.text)}</p>`:""}
          ${r.taskProgress?`<p class="small muted" style="margin:4px 0"><b>Task progress:</b> ${esc(r.taskProgress)}</p>`:""}
          ${r.remarks?`<p class="small muted" style="margin:4px 0"><b>Remarks:</b> ${esc(r.remarks)}</p>`:""}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)">
            ${`<button class="btn small" data-verify="${r.id}">✓ Verify</button>`}
            <button class="btn small quiet" data-return="${r.id}">Return with note</button>
            <button class="btn small quiet" data-addnote="${r.id}">Add narrative</button>
          </div>
        </div>
      </div>`).join("")}</div>
    </div>` : ""}

    <div class="card"><h2>My recent day reports</h2><div class="list">
      ${mine.filter(r => r.status !== "missing").map(r => `<div class="item"><div class="grow"><div class="t">${fmtDate(r.date)} · ${esc(r.location || "")}</div>
        <div class="s">${esc(String(r.text || "").slice(0, 120))}${r.photo ? " · 📎" : ""}${r.audio ? " · 🎤" : ""}</div>
        ${r.verifyNote ? `<div class="s" style="color:var(--bad)">${esc(r.verifyNote)}</div>` : ""}</div>
        <span class="tag ${r.status === "verified" ? "ok" : r.status === "returned" ? "bad" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("") || `<div class="empty">None yet</div>`}</div></div>

`);
  $("content").querySelectorAll("[data-task]").forEach(sel => sel.onchange = async () => {
    await db.collection("assignments").doc(sel.dataset.task).update({ progress: sel.value, progressAt: today() });
    if (sel.value === "Completed") { const note = prompt("Mark this assignment done? Add a note for your manager:"); if (note !== null) await db.collection("assignments").doc(sel.dataset.task).update({ status: "done – to verify", doneNote: note, doneAt: today() }); }
    toast("Updated"); });
  let audio = null;
  if ($("vrec")) $("vrec").onclick = async () => { const b = $("vrec");
    if (b.dataset.rec) { b.dataset.rec = ""; b.textContent = "🎤 Record"; window.__drec?.stop(); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const rec = new MediaRecorder(stream); const ch = [];
      rec.ondataavailable = e => ch.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(ch, { type: "audio/webm" });
        if (blob.size > 900000) { $("vst").textContent = "too long — keep under a minute"; return; }
        audio = await blobToDataUrl(blob); $("vst").textContent = "voice note attached ✓"; };
      window.__drec = rec; rec.start(); b.dataset.rec = "1"; b.textContent = "⏹ Stop"; $("vst").textContent = "recording…";
      setTimeout(() => { if (b.dataset.rec) { b.dataset.rec = ""; b.textContent = "🎤 Record"; rec.stop(); } }, 60000);
    } catch { $("vst").textContent = "microphone not available"; } };
  if (typeof teamReportsHtml === "function") { /* placeholder */ }
  
  /* My month — view this month's reports in full and print F-09 */
  const _dm = today().slice(0, 7);
  const _monthLabel = new Date(_dm + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const _drMonth = await db.collection("dayReports").where("uid", "==", state.user.uid)
    .where("date", ">=", _dm + "-01").limit(31).get().catch(() => ({ docs: [] }));
  const _monthDocs = _drMonth.docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date));
  if (_monthDocs.length) {
    const el = document.getElementById("content");
    if (el) el.insertAdjacentHTML("beforeend",
      `<div class="card"><h2>${_monthLabel} · ${_monthDocs.length} day report${_monthDocs.length===1?"":"s"}</h2>
        <div class="list">${_monthDocs.map(r => `<div class="item"><div class="grow">
          <div class="t">${fmtD(r.date)}${r.location?" · "+esc(r.location):""}</div>
          <div class="s">${esc((r.text||"").slice(0,120))}</div></div>
          <span class="tag ${r.status==="verified"?"ok":"warn"}">${esc(r.status||"submitted")}</span></div>`).join("")}</div>
        <button class="btn small" id="drPrintMonth" style="margin-top:8px">Print this month (F-09)</button></div>`);
  if ($("drPrintMonth")) $("drPrintMonth").onclick = () => {
    openForm("Monthly sheet – F-09",
      formHead("DAY REPORTS", FORM_NUMS.monthlyReport || "F-09") +
      `<div class="meta"><div><b>Name:</b> ${esc(state.me.name)}</div><div><b>Month:</b> ${esc(_monthLabel)}</div></div>` +
      `<table class="t"><tr><th>Date</th><th>Where</th><th>Report</th><th>Attachments</th><th>Status</th></tr>` +
      _monthDocs.map(r => {
        const lines = [...(r.items||[])]; if (r.narrative) lines.push(r.narrative); if (!lines.length && r.text) lines.push(r.text);
        const atts = r.attachments || [];
        const attHtml = atts.map(a => {
          const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name||a.url||"") || String(a.type||"").startsWith("image/");
          return isImg && a.url ? `<div style="margin:2px 0"><img src="${esc(a.url)}" style="max-width:120px;max-height:90px;border-radius:4px;display:block"></div>`
            : a.url ? `<div style="margin:2px 0"><a href="${esc(a.url)}" target="_blank" style="font-size:11px">📎 ${esc(a.name||"attachment")}</a></div>` : "";
        }).join("");
        return `<tr><td style="white-space:nowrap">${fmtD(r.date)}</td><td>${esc(r.location||"")}</td>
          <td style="font-size:12px">${lines.map(l=>esc(l)).join("<br>")}</td>
          <td>${attHtml||"—"}</td>
          <td><span style="font-size:11px;color:${r.status==="verified"?"green":"#888"}">${esc(r.status||"submitted")}</span></td></tr>`;
      }).join("") +
      `</table>` + formSigs(state.user.uid, null, null, today(), null, null));
  };
  }
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault();
    const fd = new FormData(e.target); const d = Object.fromEntries(fd);
    const files = ($("drFiles")?.files) ? [...$("drFiles").files] : [];
    const attachments = [];
    for (const f of files) {
      if (!f?.size) continue;
      try { const _a=await uploadToDrive(f,"program",f.name); if(_a&&_a.url) attachments.push(_a); else toast("Could not upload "+f.name+" — Drive unavailable"); } catch(e){toast("Upload error: "+e.message);}
    }
    if (audio) d.audio = audio;
    // Check if auto-report already exists for today — if so, update it; otherwise create
    const existing = mine.find(r => r.date === todayStr);
    if (existing) {
      const editLog = [...(existing.editLog||[]), { by: state.user.uid, at: new Date().toISOString(), action: "narrative added" }];
      await db.collection("dayReports").doc(existing.id).update({
        narrative: d.narrative, location: d.location, projectId: d.projectId,
        ...(attachments.length?{attachments}:{}), ...(audio?{audio}:{}),
        status: "submitted",
        editLog, lastEditBy: state.user.uid, lastEditAt: today()
      });
      if (!attachments.length && (state.me.roles||[]).some(r=>["field_staff","program_coord","program_lead","program_coord_lead"].includes(r)))
        setTimeout(()=>toast("📎 Tip: attach an attendance sheet or photo as evidence for your manager"),2600);
      successFlash("Narrative saved");
    } else {
      // Manual report (before Nov 1 or if auto didn't run)
      await db.collection("dayReports").add({
        uid, date: todayStr, name: state.me.name, managerIds: mgrs(state.me),
        items: autoItems, narrative: d.narrative, location: d.location, projectId: d.projectId,
        ...(attachments.length?{attachments}:{}), ...(audio?{audio}:{}),
        status: "submitted", autoGenerated: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // Nudge if field role and no attachments
      if (!attachments.length && (state.me.roles||[]).some(r=>["field_staff","program_coord","program_lead","program_coord_lead"].includes(r)))
        setTimeout(()=>toast("📎 Tip: attach an attendance sheet or photo as evidence for your manager"),2600);
      successFlash("Report saved");
    }
    audit("create","dayReports",null,todayStr); routes.dayreport(); };
  $("content").querySelectorAll("[data-rd]").forEach(b => b.onclick = () => {
    const box = document.getElementById("rd_" + b.dataset.rd);
    box.classList.toggle("hidden"); b.textContent = box.classList.contains("hidden") ? "Read" : "Close"; });
  $("content").querySelectorAll("[data-rdtoggle]").forEach(el => el.onclick = () => {
    const box = document.getElementById("rd_" + el.dataset.rdtoggle);
    if (!box) return;
    box.classList.toggle("hidden");
    const arrow = el.querySelector("span[style*='margin-left:auto']");
    if (arrow) arrow.textContent = box.classList.contains("hidden") ? "▼ Read" : "▲ Close";
  });
  $("content").querySelectorAll("[data-verify]").forEach(b => b.onclick = async () => {
    const id = b.dataset.verify;
    const wrap = b.closest("div") || b.parentElement;
    if (document.getElementById("vb_"+id)) return;
    const vbox = document.createElement("div");
    vbox.id = "vb_"+id;
    vbox.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:8px";
    vbox.innerHTML = `<textarea rows="2" placeholder="Note back to them (optional)" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px"></textarea>
      <div style="display:flex;gap:8px">
        <button class="btn small" id="dvok_${id}">✓ Verify</button>
        <button class="btn small quiet" onclick="this.closest('[id]').remove()">Cancel</button>
      </div>`;
    b.insertAdjacentElement("afterend", vbox);
    document.getElementById("dvok_"+id).onclick = async () => {
      const note = vbox.querySelector("textarea").value.trim();
      document.getElementById("dvok_"+id).disabled = true;
      await db.collection("dayReports").doc(id).update({
        status: "verified", verified: true, verifiedBy: state.user.uid, verifiedOn: today(), managerNote: note || null });
      audit("verify","dayReports",id,""); toast("Verified ✓"); routes.dayreport(); }; });

  $("content").querySelectorAll("[data-return]").forEach(b => b.onclick = async () => {
    const note = prompt("What should they correct or add?") || "";
    if (!note) return;
    const editLog = [{ by: state.user.uid, at: new Date().toISOString(), action: "returned: " + note }];
    await db.collection("dayReports").doc(b.dataset.return).update({
      status: "returned", verifyNote: note, returnedBy: state.user.uid, returnedOn: today(), editLog });
    toast("Returned"); routes.dayreport(); });

  $("content").querySelectorAll("[data-addnote]").forEach(b => b.onclick = async () => {
    const note = prompt("Add narrative to this report:") || "";
    if (!note) return;
    const r = pendingVerify.find(x=>x.id===b.dataset.addnote);
    const editLog = [...(r?.editLog||[]), { by: state.user.uid, at: new Date().toISOString(), action: "narrative added by manager" }];
    await db.collection("dayReports").doc(b.dataset.addnote).update({
      narrative: note, editLog, lastEditBy: state.user.uid, lastEditAt: today() });
    toast("Narrative added"); routes.dayreport(); });
};


/* ---------- Leave entitlement ----------
   The annual leaves accrue across the financial year, so somebody who joined in
   October is entitled to the months they are here, not a full year. Paid leave and
   paternity leave are special provisions granted case by case and are not part of
   this pool. Work from home is not leave at all. */
const LEAVE_ANNUAL = { "Casual leave": 12, "Sick leave": 10, "Menstrual leave (opt-in)": 12, "Trauma / emotional health leave": 5 };
const LEAVE_SPECIAL = { "Paid leave": 6, "Paternity leave": 7 };
function fyWindow(d) { const n = d ? new Date(d) : new Date();
  const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31), label: `${y}-${String(y + 1).slice(2)}` }; }
/** Whole months this person is on the rolls within the current financial year. */
function monthsOnRolls(person) {
  const fy = fyWindow();
  const joined = person && person.joined ? new Date(person.joined) : null;
  const start = joined && joined > fy.from ? joined : fy.from;
  if (start > fy.to) return 0;
  let m = (fy.to.getFullYear() - start.getFullYear()) * 12 + (fy.to.getMonth() - start.getMonth()) + 1;
  if (joined && joined > fy.from && joined.getDate() > 15) m -= 1;   // joined after mid-month: that month does not count
  return Math.max(0, Math.min(12, m));
}
/** What this person is entitled to this year, rounded down to a half day. */
function leaveEntitlement(person) {
  const m = monthsOnRolls(person), out = {};
  Object.entries(LEAVE_ANNUAL).forEach(([k, full]) => {
    /* Menstrual leave is opt-in, as its name says: it appears for whoever chooses it,
       and the app assumes nothing about anybody. */
    if (/menstrual/i.test(k) && (!(person && person.menstrualOptIn) || person.sex === "Male")) return;
    out[k] = Math.floor((full * m / 12) * 2) / 2;
  });
  return out;
}
routes.leave = async () => {
  setTitle("Vacation, leave and WFH");
  const uid = viewUid();
  const mine = (await db.collection("leaveRequests").where("uid", "==", uid).orderBy("createdAt", "desc").limit(20).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  /* Work from home is where the work was done, not time off — it has no entitlement
     and is never counted against a balance. */
  const ENT = leaveEntitlement(state.me);
  const isWFH = t => /work from home/i.test(t || "");
  const fyFrom = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const taken = t => mine.filter(l => l.type === t && l.status === "approved" && (l.from || "") >= fyFrom).reduce((a, l) => a + (Number(l.days) || 0), 0);
  const fy = fyWindow(), months = monthsOnRolls(state.me);
  const already = Number(state.me.leaveTakenBefore) || 0;
  html(`<div class="card"><h2>My leave · ${fy.label}</h2>
      <p class="small muted">${months === 12 ? "Full year." : `You are on the rolls for ${months} of the 12 months this year${state.me.joined ? `, having joined on ${fmtD(state.me.joined)}` : ""}, so the annual leaves are counted for those months.`}</p>
      <div class="tablewrap"><table class="table"><tr><th>Leave</th><th style="text-align:center">Entitled</th><th style="text-align:center">Taken</th><th style="text-align:center">Left</th></tr>
        ${Object.entries(ENT).map(([k, v]) => { const t = taken(k), left = Math.max(0, v - t);
          return `<tr><td>${esc(k.split(" (")[0])}</td><td style="text-align:center">${v}</td>
            <td style="text-align:center">${t}</td>
            <td style="text-align:center"><b style="color:${left === 0 ? "var(--bad)" : left <= v * 0.3 ? "#8A5A00" : "var(--ok)"}">${left}</b></td></tr>`; }).join("")}
      </table></div>
      ${already ? `<p class="small muted" style="margin-top:6px"><b>${already} day${already === 1 ? "" : "s"}</b> were already taken this year before the app was in use. These are not split by kind, so they are shown here rather than against a line above.</p>` : ""}
      <p class="small muted" style="margin-top:8px"><b>Paid leave and paternity leave are not in this pool.</b>
        Paid leave (up to 6 days) is at your line manager's discretion. Paternity leave (7 days) is a special provision, granted case by case. Work from home is not leave and is not counted.</p></div>
    <div class="card"><p>${Object.entries(ENT).map(([k, v]) => `<span class="tag ${taken(k) >= v ? "bad" : taken(k) > v * 0.7 ? "warn" : ""}">${esc(k.split(" (")[0])} ${taken(k)}/${v}</span>`).join(" ")}
      <span class="tag">WFH ${mine.filter(l => l.type === "Work from home" && l.status === "approved").length} days</span></p>
    <p class="small muted">Maternity leave as per statutory norms · compensatory off earned for approved weekend or holiday work (HR Policy §7).</p></div>

  <div class="card"><h2>Apply</h2><form id="f">
    <div class="two"><label class="field"><span>Name</span><input value="${esc(state.me.name)}" disabled></label>
      <label class="field"><span>Employment type</span><select name="employment">${["Full Time Staff", "Part Time Staff", "Consultant", "Intern", "Volunteer", "Sakhi Leader"].map(x => `<option ${x === state.me.engagement ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Department</span><input value="${esc(state.me.department || "")}" disabled></label>
      <label class="field"><span>Leave type</span><select name="type" id="lvType">${[...(/delhi/i.test(((state.offices || []).find(o => o.id === state.me.officeId) || {}).name || "") ? ["Work from home (not leave)"] : []), "Casual leave", "Sick leave", "Half day", "Paid leave", "Compensatory off",
        ...(state.me.menstrualOptIn && state.me.sex !== "Male" ? ["Menstrual leave (opt-in)"] : []),
        "Trauma / emotional health leave", "Maternity leave", "Paternity leave", "Leave without pay"]
        .map(x => `<option>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>From</span><input type="date" name="from" id="lvFrom" required></label>
      <label class="field"><span>To</span><input type="date" name="to" id="lvTo" required></label></div>
    <div id="lvHolInfo" class="small muted" style="margin:-8px 0 8px"></div>
    <div class="two"><label class="field"><span>Start time</span><input type="time" name="fromTime" value="09:30"></label>
      <label class="field"><span>End time</span><input type="time" name="toTime" value="17:30"></label></div>
    <label class="field"><span>Reason</span><textarea name="reason" required></textarea></label>
    <label class="field"><span>Document (medical certificate etc.)</span><input type="file" name="doc" accept="image/*,.pdf"></label>
    <button class="btn" type="submit">Submit</button> <span class="small muted">→ your reporting manager approves</span></form></div>

  ${isManager() || has("super_admin","admin","program_officer","program_coord") ? `<div class="card"><h2>Apply on behalf of a team member</h2>
    <p class="small muted">File leave for someone in your team — it is recorded as approved immediately since you are their line manager.</p>
    <form id="fob">
      <div class="two"><label class="field"><span>Staff member</span><select name="staffId" required><option value="">— select —</option>${staffList().filter(u=>u.id!==state.user.uid&&(u.managerIds||[]).includes(state.user.uid)).map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Leave type</span><select name="type">${["Casual leave","Sick leave","Half day","Paid leave","Compensatory off","Trauma / emotional health leave","Maternity leave","Paternity leave","Leave without pay","Absent without leave"].map(x=>`<option>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>From</span><input type="date" name="from" required></label>
        <label class="field"><span>To</span><input type="date" name="to" required></label></div>
      <label class="field"><span>Reason / note</span><input name="reason" placeholder="Informed by WhatsApp, medical certificate received…" required></label>
      <button class="btn small" type="submit">Apply & approve</button>
    </form></div>` : ""}
  <div class="card"><h2>My requests</h2><div class="list">
    ${mine.map(l => `<div class="item"><div class="grow"><div class="t">${esc(l.type)} · ${l.days || ""} day(s)</div>
      <div class="s">${fmtDate(l.from)} → ${fmtDate(l.to)} · ${esc(l.reason || "")}</div>${l.returnNote || l.rejectNote ? `<div class="s" style="color:var(--bad)">${esc(l.returnNote || l.rejectNote)}</div>` : ""}</div>
      <span class="tag ${l.status === "approved" ? "ok" : l.status === "rejected" ? "bad" : "warn"}">${esc(l.status)}</span>
      ${l.status === "pending" ? `<button class="btn small quiet" data-cancel="${l.id}">Cancel</button>` : l.status === "approved" ? `<button class="btn small quiet" data-dlf07="${l.id}">↓ F-07</button>` : ""}</div>`).join("") || `<div class="empty">None yet</div>`}</div></div>`);
  // Holiday-aware date picker
  const holSnap = await db.collection("holidays").get().catch(()=>({docs:[]}));
  const orgHolDates = holSnap.docs.map(d=>d.data()).filter(h=>!h.officeId||h.officeId===state.me?.officeId);
  const NATL_HOL = [{date:"2026-11-15",name:"Guru Nanak Jayanti"},{date:"2026-12-25",name:"Christmas Day"},{date:"2027-01-01",name:"New Year's Day"},{date:"2027-01-26",name:"Republic Day"},{date:"2027-03-14",name:"Holi"},{date:"2027-03-26",name:"Eid ul-Fitr"},{date:"2027-04-02",name:"Good Friday"},{date:"2027-04-14",name:"Dr. Ambedkar Jayanti"},{date:"2027-08-15",name:"Independence Day"},{date:"2027-10-02",name:"Gandhi Jayanti"}];
  const allHols = [...NATL_HOL,...orgHolDates].filter(h=>/Gazetted|National|Regional|Office closure/i.test(h.type||"National holiday"));
  const updateHolInfo = () => {
    const from=$("lvFrom")?.value, to=$("lvTo")?.value;
    if(!from||!to||from>to){if($("lvHolInfo"))$("lvHolInfo").textContent="";return;}
    const inPeriod=allHols.filter(h=>h.date>=from&&h.date<=to);
    const calDays=Math.round((new Date(to)-new Date(from))/86400000)+1;
    if($("lvHolInfo")) $("lvHolInfo").innerHTML=inPeriod.length?`<span style="color:var(--ok)">ℹ ${calDays} calendar days — includes ${inPeriod.length} holiday${inPeriod.length>1?"s":""}: <b>${inPeriod.map(h=>h.name).join(", ")}</b>. These will not be counted against your leave balance.</span>`:`${calDays} calendar day${calDays!==1?"s":""} — no holidays in this period.`;
  };
  if($("lvFrom")) { $("lvFrom").onchange=updateHolInfo; $("lvTo").onchange=updateHolInfo; }

  $("f").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); delete d.doc;
    const doc = fd.get("doc"); if (doc && doc.size) { const s = await uploadToDrive(doc,"admin",doc.name); if (s) { d.doc = s.link; d.docName = s.name; d.docType = s.type; } }
    const inPeriod = allHols.filter(h=>h.date>=d.from&&h.date<=d.to);
    const calDays = Math.round((new Date(d.to) - new Date(d.from)) / 86400000) + 1;
    d.days = d.type === "Half day" ? 0.5 : Math.max(1, calDays - inPeriod.length);
    if(inPeriod.length) d.holidaysInPeriod = inPeriod.map(h=>h.name);
    /* Balance check — warn if over entitlement; auto-convert to leave without pay */
    if (ENT[d.type] !== undefined) {
      const alreadyTaken = taken(d.type);
      const remaining = Math.max(0, ENT[d.type] - alreadyTaken);
      if (d.days > remaining) {
        const over = d.days - remaining;
        const msg = remaining > 0
          ? `You have ${remaining} day(s) of ${d.type} left. The extra ${over} day(s) will be recorded as leave without pay. Continue?`
          : `Your ${d.type} balance is used up. This will be recorded as leave without pay. Continue?`;
        if (!confirm(msg)) return;
        if (remaining > 0) {
          // Split: file the entitled portion as the requested type, the rest as LWP
          await db.collection("leaveRequests").add({ ...d, days: remaining, uid, name: state.me.name, managerIds: mgrs(state.me), status: "pending", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          d.type = "Leave without pay"; d.days = over;
        } else {
          d.type = "Leave without pay";
        }
      }
    }
    await db.collection("leaveRequests").add({ ...d, uid, name: state.me.name, managerIds: mgrs(state.me), status: "pending", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast(/work from home/i.test(d.type || "") ? "Sent to your manager — this is recorded as attendance, not leave" : "Submitted");
    routes.leave(); };
  $("content").querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => { await db.collection("leaveRequests").doc(b.dataset.cancel).update({ status: "cancelled" }); routes.leave(); });
  if ($("fob")) $("fob").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]"); btn.disabled=true; btn.textContent="Saving…";
    const d = Object.fromEntries(new FormData(e.target));
    const staffMember = staffList().find(u=>u.id===d.staffId);
    if(!staffMember){ toast("Staff member not found"); btn.disabled=false; btn.textContent="Apply & approve"; return; }
    const from = new Date(d.from), to = new Date(d.to);
    const days = Math.max(1, Math.round((to-from)/86400000)+1);
    await db.collection("leaveRequests").add({ uid: d.staffId, name: staffMember.name, type: d.type, from: d.from, to: d.to, days,
      reason: d.reason, status: "approved", approvedBy: state.user.uid, approvedOn: today(),
      filedBy: state.user.uid, filedByName: state.me.name, onBehalf: true,
      managerIds: mgrs(staffMember), createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("create","leaveRequests","",staffMember.name+" — "+d.type+" (filed by manager)");
    toast(staffMember.name+" — "+d.type+" recorded and approved"); routes.leave(); };
  $("content").querySelectorAll("[data-dlf07]").forEach(b => b.onclick = async () => {
    const r = mine.find(x=>x.id===b.dataset.dlf07); if(!r) return;
    b.textContent="Generating…"; b.disabled=true;
    await downloadFilledForm("F-07","leaveRequests",r.id,{...r,byName:state.me.name,postTitle:state.me.postTitle,department:state.me.department,officeName:officeName(state.me.officeId),managerName:userName((state.me.managerIds||[])[0]),approvedByName:userName(r.approvedBy),appliedOn:r.createdAt?.seconds?new Date(r.createdAt.seconds*1000).toISOString().slice(0,10):""});
    b.textContent="↓ F-07"; b.disabled=false; });
};

routes.expense = async () => {
  setTitle("Expense report");
  const uid = viewUid();
  const mine = (await db.collection("expenseClaims").where("uid", "==", uid).orderBy("createdAt", "desc").limit(20).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  html(`<div class="card"><h2>Expense Report</h2><form id="f">
    <div class="two"><label class="field"><span>Name</span><input value="${esc(state.me.name)}" disabled></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label></div>
    <div class="two"><label class="field"><span>Cost (₹)</span><input type="number" step="any" inputmode="decimal" name="amount" min="1" step="1" inputmode="numeric" required></label>
      <label class="field"><span>Payment type</span><select name="payment">${["Cash", "UPI", "Card", "Bank transfer", "Paid by office"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Expense type</span><select name="category">${["Travel & conveyance", "Accommodation", "Food & refreshment", "Meeting / event", "Printing & stationery", "Phone & internet", "Beneficiary support", "Medical / emergency", "Other"].map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Project</span><select name="projectId">${projectOptions()}</select></label></div>
    <label class="field"><span>Description</span><input name="description" required placeholder="What it was for"></label>
    <label class="field"><span>Against advance (if any)</span><input name="againstAdvance" placeholder="Advance reference, or leave blank"></label>
    <label class="field"><span>Documents / bills / photo</span><input type="file" id="bill" name="bill" accept="image/*,.pdf"><span class="small muted" id="bill_note"></span></label>
    <button class="btn" type="submit">Submit</button>
    <p class="small muted" style="margin-top:6px">→ your manager verifies → Accounts checks the bills → the Director ACF approves → paid (above ₹50,000 the General Secretary authorises, FP §9)</p></form></div>

  <div class="card"><h2>My claims</h2><div class="list">
    ${mine.map(c => `<div class="item"><div class="grow"><div class="t">₹${Number(c.amount || 0).toLocaleString("en-IN")} · ${esc(c.description || "")}</div>
      <div class="s">${fmtDate(c.date)} · ${esc(projectName(c.projectId))} · ${esc(c.category || "")}${c.bill ? " · 📎" : ""}</div>
      ${c.returnNote || c.rejectNote ? `<div class="s" style="color:var(--bad)">${esc(c.returnNote || c.rejectNote)}</div>` : ""}</div>
      <span class="tag ${c.status === "paid" ? "ok" : /reject/.test(c.status || "") ? "bad" : "warn"}">${esc(c.status || "submitted")}</span>
      ${c.status === "paid" ? `<button class="btn small quiet" data-dlf02="${c.id}">↓ F-02</button>` : ""}</div>`).join("") || `<div class="empty">None yet</div>`}</div></div>`);
  $("content").querySelectorAll("[data-dlf02]").forEach(b => b.onclick = async () => {
    const c = mine.find(x=>x.id===b.dataset.dlf02); if(!c) return;
    b.textContent="…"; b.disabled=true;
    await downloadFilledForm("F-02","expenseClaims",c.id,{...c,byName:state.me.name,postTitle:state.me.postTitle,department:state.me.department,officeName:officeName(state.me.officeId),projectName:projectName(c.projectId)});
    b.textContent="↓ F-02"; b.disabled=false; });
  $("f").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); delete d.bill;
    const billFile = fd.get("bill"); if (billFile && billFile.size) { const s = await uploadToDrive(billFile,"accounts",billFile.name); if (s) { d.bill = s.link; d.billName = s.name; d.billId = s.id; } }
    d.amount = Number(d.amount);
    // Spending authority: check post limit OR user spendLimit — if amount within authority, skip approval
    const myPost = (state.posts||[]).find(p => p.holderId === uid);
    const authority = Number(myPost?.limit || state.me.spendLimit || 0);
    const claimAmt = Number(d.amount || 0);
    const withinAuthority = authority > 0 && claimAmt <= authority;
    const claimStatus = withinAuthority ? "approved" : "submitted"; // within authority → straight to accountant
    await db.collection("expenseClaims").add({ ...d, uid, name: state.me.name, managerIds: mgrs(state.me), fundType: fundTypeOf(d.projectId), status: claimStatus, withinAuthority, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    successFlash("Submitted"); routes.expense(); };
};

routes.profile = async () => {
  const advAcc = await advanceAccount(state.user.uid).catch(() => ({ lines: [], inHand: 0 }));
  setTitle("Profile");
  const m = state.me; const mgrNames = mgrs(m).map(id => userName(id)).filter(Boolean).join(", ");
  html(`<div class="card"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <div style="position:relative"><img id="pv" src="${m.photo || ""}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--bg);border:2px solid var(--line)">
      <label style="position:absolute;bottom:0;right:0;background:var(--green);color:#fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;cursor:pointer">✎<input type="file" id="ph" accept="image/*" capture="user" hidden></label></div>
      <div><h2 style="margin:0">${esc(m.name)}${(() => { const sa = m.starredAt; if(!sa) return ""; const days = Math.floor((new Date(today()) - new Date(sa)) / 86400000); if(days > 10) return ""; const streak = m.streakWeeks || 1; return ` <span title="${streak} week${streak>1?" streak":""} of great work" style="font-size:20px;cursor:default">⭐${streak>1?`<sup style="font-size:11px;vertical-align:super">${streak}</sup>`:""}</span>`; })()}</h2><p class="muted small" style="margin:2px 0">${esc(standingOf(m))}${m.department ? " · " + esc(m.department) : ""}</p>
      <p class="small" style="margin:0">${esc(m.email)} · ${esc(m.phone || "no phone")}</p></div></div>
    <p style="margin-top:10px">${(m.roles || []).map(r => `<span class="tag">${ROLES[r] || r}</span>`).join(" ")}</p>
    <p class="small">Office: ${esc(officeName(m.officeId)) || "—"} · Reports to: ${esc(mgrNames || "—")} ·
      Joined: ${m.joined ? esc(fmtD(m.joined)) : `<span class="tag warn">not set</span>`} · Staff ID: <b>${esc(staffId(m))}</b></p>
    ${state.inHand ? `<p style="margin:6px 0"><span class="tag ${advAcc.lines.some(l => l.days > 30) ? "bad" : "warn"}">money in hand ₹${Math.round(advAcc.inHand).toLocaleString("en-IN")}</span></p>` : ""}
    ${!m.joined ? `<p class="small muted">Your staff number uses the year you joined. Set the date below and it corrects itself.</p>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn small" onclick="go('idcard')">My ID card</button><button class="btn small quiet" onclick="go('claimPost')">${m.postTitle ? "Claim a different post" : "Claim my post"}</button><button class="btn small quiet" id="instBtn" style="display:none">Install app</button><button class="btn small quiet" id="linkGoogleBtn" style="display:none">🔗 Link Google account</button><button class="btn small quiet" id="linkPhoneBtn" style="display:none">🔗 Link phone number</button></div></div>

    <div class="card"><h2>My details</h2><form id="f">
      <label class="field"><span>Your name, as it should appear on letters and your ID card</span>
        ${m.nameChanged ? `<input value="${esc(m.name || "")}" disabled>
          <span class="small muted">You have already corrected your name once. Ask Administration if it needs changing again.</span>`
        : `<input name="name" value="${esc(m.name || "")}" required>
          <span class="small muted">You can correct this yourself once — spelling, or a fuller form such as Mohd. Shafiqur Rahman Khan. After that the office makes the change.</span>`}</label>
      <div class="two"><label class="field"><span>Phone</span><input name="phone" value="${esc(m.phone || "")}"></label><label class="field"><span>Emergency contact</span><input name="emergency" value="${esc(m.emergency || "")}"></label></div>
      <div class="two"><label class="field"><span>Address</span><input name="address" value="${esc(m.address || "")}"></label><label class="field"><span>Date of birth</span><input type="date" name="dob" value="${esc(m.dob || "")}"></label>
      <label class="field"><span>Sex</span><select name="sex"><option value="">—</option>${["Female","Male","Prefer not to say"].map(x=>`<option ${m.sex===x?"selected":""}>${x}</option>`).join("")}</select></label></div>
      <label class="field"><span>Your signature</span>
        ${m.signature ? `<img src="${m.signature}" alt="" style="height:54px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:5px 8px;display:block;margin-bottom:6px">` : ""}
        <input type="file" id="sigFile" accept="image/*">
        <span class="small muted">Photograph your signature on plain white paper. It is printed on the vouchers and letters you approve, beside the line recording that you approved them in this app. It is never offered to anyone as a file.</span></label>
      <div class="two"><label class="field"><span>Date of joining</span>
          <input type="date" name="joined" value="${esc(m.joined || "")}" ${m.joined && !isAdmin() ? "disabled" : ""}>
          <span class="small muted">${m.joined
            ? (isAdmin() ? "" : "Set by Administration. It decides your leave for the year, so ask Administration if it is wrong.")
            : "Tell Administration your date of joining — it decides your leave for the year, and cannot be changed once set."}</span></label>
        ${m.sex !== "Male" ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" name="menstrualOptIn" ${m.menstrualOptIn ? "checked" : ""}>
          Include menstrual leave in my leave for the year</label>` : ""}
          <span class="small muted" style="display:block;margin-left:26px">12 days a year, counted like any other leave. Nobody is told you have chosen it; it simply appears on your leave screen.</span></label>
        <label class="field"><span>Blood group</span><select name="blood"><option value="">—</option>${["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map(x => `<option ${x === m.blood ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Bank account (salary / claims)</span><input name="bankAcc" value="${esc(m.bankAcc || "")}"></label><label class="field"><span>IFSC</span><input name="ifsc" value="${esc(m.ifsc || "")}"></label></div>
      <label class="field"><span>Projects you work on</span><input name="projectsText" value="${esc(m.projectsText || "")}"></label>
      <p class="small muted">Changes to bank details are sent to the General Secretary for approval before they take effect.</p>
      <button class="btn small" type="submit">Save</button></form></div>

    ${(m.letters || []).length ? `<div class="card"><h2>My letters</h2><div class="list">${(m.letters || []).map(l => `<div class="item"><div class="grow"><div class="t">${esc(l.title)}</div><div class="s">issued ${esc(l.at)}</div></div><button class="btn small quiet" data-letter="${l.id}">Open</button></div>`).join("")}</div></div>` : ""}
    <div class="card"><h2>Documents</h2><p class="small muted">Bank passbook front page, Aadhaar or voter card or driving licence, address proof, signed contract, CV, Commitment Statement and NDA.</p>
      <div class="two"><label class="field"><span>What is this document?</span><select id="dockind">${["Bank passbook (front page)", "Aadhaar / voter card / driving licence", "Address proof", "Signed contract", "CV", "Commitment Statement", "Non-Disclosure Agreement", "Other"].map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="field"><span>File</span><input type="file" id="doc" accept="image/*,.pdf"></label></div><div style="margin-top:8px"><button class="btn" type="button" id="docUpload">📎 Upload document</button></div><div class="list" id="docs">${(m.docs || []).map((d, i) => `<div class="item"><div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${esc(d.at)}</div></div><a class="btn small quiet" href="${d.data}" download="${esc(d.name)}">Open</a></div>`).join("") || `<div class="empty">No documents yet</div>`}</div></div>

    <div class="card"><h2>App</h2><p class="small muted">${navigator.onLine ? "Online" : "Offline"} · ${esc(state.me.email)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small quiet" onclick="auth.signOut()">Sign out</button><button class="btn small quiet" id="updateAppBtn" onclick="forceAppUpdate()">🔄 Update app</button></div></div>`);
  $("content").querySelectorAll("[data-letter]").forEach(b => b.onclick = async () => { const d = await db.collection("letters").doc(b.dataset.letter).get(); if (d.exists) { state.letter = { id: d.id, ...d.data() }; go("letter"); } });
  $("ph").onchange = async e => { const f = e.target.files[0]; if (!f) return;
    const res = await uploadToDrive(f, "admin", state.me.name+"-photo."+f.name.split(".").pop()).catch(()=>null);
    const data = res?.webViewLink||res?.url||null;
    if (!data) { toast("Could not upload photo to Drive"); return; }
    await db.collection("users").doc(m.id).update({ photo: data }); state.me.photo = data; $("pv").src = data; toast("Photo updated"); };
  if($("docUpload")) $("docUpload").onclick = async function() {
    var file=$("doc")&&$("doc").files[0];
    if(!file){toast("Please choose a file first");return;}
    if(!file.type.startsWith('image/') && file.size > 200000){toast("PDF/Word files must be under 200 KB to save in your profile. Please compress it first.");return;}
    var dn=($("dockind")&&$("dockind").value||"Document")+" — "+file.name;
    this.disabled=true;this.textContent="Uploading…";var self=this;
    try{var du=await new Promise(function(res,rej){var fr=new FileReader();fr.onerror=rej;fr.onload=function(x){var raw=x.target.result;if(file.type.startsWith('image/')){var img=new Image();img.onload=function(){var max=800,w=img.width,h=img.height;if(w>max||h>max){if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}var cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);res(cv.toDataURL('image/jpeg',0.6));};img.onerror=function(){res(raw);};img.src=raw;}else{res(raw);}};fr.readAsDataURL(file);});var ex=Array.isArray(state.me.docs)?JSON.parse(JSON.stringify(state.me.docs)):[];ex.push({data:du,name:dn,at:today()});await db.collection("users").doc(m.id).update({docs:ex});bustMastersCache(); await loadMasters();successFlash("Document saved");routes.profile();}catch(e){toast("Could not save: "+(e&&e.message||e));self.disabled=false;self.textContent="📎 Upload document";}
  };
  if($("doc")) $("doc").onchange=function(){if(this.files[0]&&$("docUpload"))$("docUpload").textContent="📎 Upload: "+this.files[0].name.slice(0,30);};
  // Note: docUpload click and doc change are handled by the direct handlers above (lines ~2795 and ~2803)
if ($("sigFile")) $("sigFile").onchange = async e => {
    var f = e.target.files[0]; if(!f) return;
    toast("Processing signature…");
    try {
      var sigData;
      try {
        var s = await trimSignature(f);
        if(!s || !s.data) throw new Error("processing failed");
        sigData = s.data;
      } catch(trimErr) {
        // Fallback: trimSignature is strict about ink detection — use compressed photo instead
        var img = await new Promise(function(res,rej){
          var i=new Image(), u=URL.createObjectURL(f);
          i.onload=function(){res(i);URL.revokeObjectURL(u);};
          i.onerror=rej; i.src=u;
        });
        var cv=document.createElement("canvas");
        var sc=Math.min(600/img.width,300/img.height,1);
        cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
        cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
        sigData=cv.toDataURL("image/jpeg",0.8);
        if(!sigData) throw new Error("Could not process the photo — try again in better light.");
      }
      await db.collection("users").doc(m.id).update({ signature: sigData, signatureOn: today() });
      bustMastersCache(); await loadMasters();
      audit("signature","users",m.id,"signature uploaded");
      successFlash("Signature saved");
      routes.profile();
    } catch(err) { alert("The signature did not save: " + (err.message || err)); }
  };
  $("f").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
  if (m.joined && !isAdmin()) delete d.joined;
    d.menstrualOptIn = d.menstrualOptIn === "on" || d.menstrualOptIn === true;
    if (!m.joined && d.joined) { d.joinedSetBy = state.user.uid; d.joinedSetOn = today(); }

    const bankChanged = d.bankAcc !== (m.bankAcc || "") || d.ifsc !== (m.ifsc || "");
    const patch = { phone: d.phone, emergency: d.emergency, address: d.address, dob: d.dob,
      joined: d.joined || null, blood: d.blood || null, projectsText: d.projectsText };
    // a name correction, allowed once, and carried everywhere the name is shown
    const newName = (d.name || "").trim();
    let renamed = false;
    if (!m.nameChanged && newName && newName !== (m.name || "").trim()) {
      if (newName.length < 3) return alert("That name looks too short.");
      if (!confirm(`Change your name from "${m.name}" to "${newName}"?\n\nThis is the name that will appear on your ID card, on letters and on anything you approve. You can only do this once yourself.`)) return;
      patch.name = newName; patch.previousName = m.name || null; patch.nameChanged = true; patch.nameChangedAt = today();
      renamed = true;
    }
    if (bankChanged) { patch.pendingBank = { bankAcc: d.bankAcc, ifsc: d.ifsc, at: today() }; successFlash("Saved\nBank change sent for approval"); } else successFlash("Saved");
    await db.collection("users").doc(m.id).update(patch); Object.assign(state.me, patch);
    if (renamed) {
      if (m.postId) await db.collection("posts").doc(m.postId).update({ holderName: patch.name }).catch(() => {});
      await db.collection("idCards").doc(m.id).set({ name: patch.name }, { merge: true }).catch(() => {});
      audit("rename", "users", m.id, `${patch.previousName} → ${patch.name}`);
      toast("Name changed"); bustMastersCache(); await loadMasters(); return routes.profile();
    }
    if (d.joined !== (m.joined || "")) routes.profile();          // the staff number carries the year
  };
  if (window.deferredPrompt) { const b = $("instBtn"); b.style.display = ""; b.onclick = async () => { window.deferredPrompt.prompt(); window.deferredPrompt = null; b.style.display = "none"; }; }
  // Link Google account — shown only if Google is not already linked
  const linkBtn = $("linkGoogleBtn");
  if (linkBtn) {
    const providers = (firebase.auth().currentUser?.providerData||[]).map(p=>p.providerId);
    if (!providers.includes("google.com")) {
      linkBtn.style.display = "";
      linkBtn.onclick = async () => {
        try {
          linkBtn.disabled = true; linkBtn.textContent = "Linking…";
          const provider = new firebase.auth.GoogleAuthProvider();
          await firebase.auth().currentUser.linkWithPopup(provider);
          toast("Google account linked ✓ — you can now sign in with Google too");
          linkBtn.style.display = "none";
        } catch(e) {
          linkBtn.disabled = false; linkBtn.textContent = "🔗 Link Google account";
          toast("Could not link: " + (e.message || e.code));
        }
      };
    }
  }
  // Link phone number — shown only if phone is not already linked
  const linkPhoneBtn = $("linkPhoneBtn");
  if (linkPhoneBtn) {
    const providers = (firebase.auth().currentUser?.providerData||[]).map(p=>p.providerId);
    if (!providers.includes("phone")) {
      linkPhoneBtn.style.display = "";
      linkPhoneBtn.onclick = async () => {
        const phone = prompt("Enter your phone number with country code (e.g. +919523815806):");
        if (!phone) return;
        try {
          linkPhoneBtn.disabled = true; linkPhoneBtn.textContent = "Sending OTP…";
          if (!window._recaptcha) window._recaptcha = new firebase.auth.RecaptchaVerifier("linkPhoneBtn", {size:"invisible"});
          const confirmResult = await firebase.auth().currentUser.linkWithPhoneNumber(phone, window._recaptcha);
          const otp = prompt("Enter the OTP sent to " + phone + ":");
          if (!otp) { linkPhoneBtn.disabled = false; linkPhoneBtn.textContent = "🔗 Link phone number"; return; }
          await confirmResult.confirm(otp);
          toast("Phone number linked ✓ — you can now sign in with your phone too");
          linkPhoneBtn.style.display = "none";
        } catch(e) {
          window._recaptcha = null;
          linkPhoneBtn.disabled = false; linkPhoneBtn.textContent = "🔗 Link phone number";
          toast("Could not link: " + (e.message || e.code));
        }
      };
    }
  }
};
const DEPT_CODE = { "Governance": "GOV", "Accounts": "ACC", "Admin": "ADM",
  "Administration, HR & Communication": "ADM", "Program": "PRG", "Programmes": "PRG",
  "Fund raising": "PDR", "Project Development, Research & Innovations": "PDR", "Compliance": "CMP" };
/* EP/PRG/2026/4F2A — department, the year they joined, and a short unique tail. */
const staffId = m => {
  /* Given once and kept for life. A transfer changes the department, not the number —
     otherwise every printed card and every QR would stop matching. */
  if (m && m.staffNo) return m.staffNo;
  const dept = DEPT_CODE[m.department] || (m.department ? String(m.department).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() : "EPO");
  const yr = String(m.joined || "").slice(0, 4) || String(new Date().getFullYear());
  const tail = String(m.id || "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase() || "0001";
  return `EP/${dept}/${yr}/${tail}`;
};

/* The card as it is printed. Whoever checks a card must see the same thing they are
   holding, or the check is worth nothing. Used by the holder's own screen and by the
   public check page alike. */
function cardArtHtml(c, opts) {
  const o = opts || {};
  return `<div id="${o.id || "cardArt"}" style="font-family:Mukta,system-ui,sans-serif;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#fff">
      <div style="background:linear-gradient(135deg,#1F4D3A,#2E6B4F);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px">
        <img src="logo.png" alt="" style="height:34px;background:#fff;border-radius:7px;padding:3px 6px">
        <div style="line-height:1.15"><div style="font-weight:700;font-size:15px;letter-spacing:.3px">EMPOWER PEOPLE</div>
          <div style="font-size:9.5px;opacity:.9">Sakhi-Centred · Community-Led · Rights-Based</div></div></div>
      <div style="padding:16px;display:flex;gap:14px">
        <div><img src="${c.photo || ""}" alt="" style="width:92px;height:112px;object-fit:cover;border-radius:10px;background:#eef2ee;border:2px solid #1F4D3A">
          <div style="font-family:ui-monospace,monospace;font-size:10px;text-align:center;margin-top:5px;color:#1F4D3A;font-weight:700">${esc(c.staffId || "")}</div></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:19px;font-weight:700;line-height:1.2">${esc(c.name || "")}</div>
          <div style="font-size:12.5px;color:#1F4D3A;font-weight:600;margin-top:2px">${esc(c.post || "")}</div>
          <div style="font-size:11px;color:#6B7772;margin-top:1px">${esc(c.department || "")}${c.office ? " · " + esc(c.office) : ""}</div>
          <table style="font-size:11px;margin-top:8px;border-collapse:collapse">
            ${c.phone ? `<tr><td style="color:#6B7772;padding-right:8px">Phone</td><td>${esc(c.phone)}</td></tr>` : ""}
            <tr><td style="color:#6B7772;padding-right:8px">Valid till</td><td>${esc(c.until || "")}</td></tr></table>
          ${o.qr ? `<img src="${o.qr}" alt="" style="width:66px;height:66px;margin-top:8px">` : ""}
        </div></div>
      <div style="background:#F3F6F3;padding:8px 16px;font-size:9.5px;color:#4A5751;text-align:center">
        A-131, Sarita Vihar, New Delhi-110076 · 011-40671714 · empowerpeople.in</div></div>`;
}
routes.idcard = async () => {
  setTitle("My ID card");
  const m = state.me;
  const until = `31 March ${new Date().getMonth() >= 3 ? new Date().getFullYear() + 1 : new Date().getFullYear()}`;
  // the card is verified by a public page, so anyone can check it without an account
  const card = { name: m.name, post: m.postTitle || m.designation || "", department: m.department || "",
    office: officeName(m.officeId) || "", staffId: staffId(m), photo: m.photo || "", until, active: true, updatedAt: today() };
  try { await db.collection("idCards").doc(m.id).set(card); } catch { }
  if (!m.staffNo && card.staffId) { m.staffNo = card.staffId;
    try { await db.collection("users").doc(m.id).update({ staffNo: card.staffId }); } catch { } }
  /* A printed card outlives whatever address it was made on. The QR always points at
     the organisation's own domain, never at the hosting address of the moment. */
  const HOME = "https://app.empowerpeople.in/";
  const url = `${HOME}#card=${m.id}`;
  let qr = ""; try { qr = await qrDataUrl(url, 180); } catch { }
  html(`<div class="card" style="max-width:430px;margin:0 auto">
    <div id="cardArt" style="font-family:Mukta,system-ui,sans-serif;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#fff">
      <div style="background:linear-gradient(135deg,#1F4D3A,#2E6B4F);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px">
        <img src="logo.png" alt="" style="height:34px;background:#fff;border-radius:7px;padding:3px 6px">
        <div style="line-height:1.15"><div style="font-weight:700;font-size:15px;letter-spacing:.3px">EMPOWER PEOPLE</div>
          <div style="font-size:9.5px;opacity:.9">Sakhi-Centred · Community-Led · Rights-Based</div></div></div>
      <div style="padding:16px;display:flex;gap:14px">
        <div><img src="${m.photo || ""}" alt="" style="width:92px;height:112px;object-fit:cover;border-radius:10px;background:#eef2ee;border:2px solid #1F4D3A">
          <div style="font-family:ui-monospace,monospace;font-size:10px;text-align:center;margin-top:5px;color:#1F4D3A;font-weight:700">${esc(card.staffId)}</div></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:19px;font-weight:700;line-height:1.2">${esc(m.name)}</div>
          <div style="font-size:12.5px;color:#1F4D3A;font-weight:600;margin-top:2px">${esc(card.post)}</div>
          <div style="font-size:11px;color:#6B7772;margin-top:1px">${esc(card.department)}${card.office ? " · " + esc(card.office) : ""}</div>
          <table style="font-size:11px;margin-top:8px;border-collapse:collapse">
            <tr><td style="color:#6B7772;padding-right:8px">Phone</td><td>${esc(m.phone || "—")}</td></tr>
            <tr><td style="color:#6B7772;padding-right:8px">Valid till</td><td>${until}</td></tr></table>
          </div></div>
      <div style="display:flex;align-items:center;gap:12px;padding:0 16px 14px">
        ${qr ? `<img src="${qr}" alt="QR code" style="width:76px;height:76px;border:1px solid var(--line);border-radius:8px;padding:3px;background:#fff">`
             : `<div style="width:76px;height:76px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9AA8A1;text-align:center;padding:4px">QR could not load</div>`}
        <div style="font-size:9.5px;color:#6B7772;line-height:1.5;text-align:left">
          <b style="color:#1F4D3A">Scan to verify this card</b><br>
          Point any phone camera at the code. It shows the holder's name,<br>post and photograph, and whether the card is still valid.</div></div>
      <div style="padding:0 16px 10px;font-size:9px;color:#6B7772;line-height:1.5">
        A-131, Sarita Vihar, New Delhi-110076 · post@empowerpeople.in · 011-40671714<br>
        If found, please return to the above address.</div>
      <div style="background:#eef3ee;padding:6px 16px;font-size:8.5px;color:#44584f">
        This card remains the property of Empower People and must be returned on leaving. Report loss to the Admin department at once.</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn small" id="dl">Download PDF</button><button class="btn small quiet" id="pr">Print</button>
      <button class="btn small quiet" id="copy">Copy the verify link</button></div>
    ${m.photo ? "" : `<p class="small" style="color:var(--bad);margin-top:8px">Add a photo in Profile — the card needs one.</p>`}
    <p class="small muted" style="margin-top:8px">Anyone who scans the code sees your name, post and photograph, and whether the card is still valid. Nothing else — no phone number, no address, no records.</p></div>`);
  $("pr").onclick = () => { const card = $("cardArt"); if (!card) return; const w = window.open("", "_blank", "width=500,height=400"); w.document.write(`<!DOCTYPE html><html><head><title>EP ID Card</title><style>body{margin:0;padding:16px;background:#fff;display:flex;justify-content:center;align-items:flex-start;}</style></head><body>${card.outerHTML}</body></html>`); w.document.close(); w.onload = () => { w.focus(); w.print(); }; };
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Verify link:", url); } };
  $("dl").onclick = async () => {
    if (!window.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const c = await html2canvas($("cardArt"), { scale: 3, backgroundColor: "#fff" });
    const w = 86, h = w * c.height / c.width;                      // ID-1 card width
    const pdf = new jspdf.jsPDF({ unit: "mm", format: [w, h], orientation: h > w ? "portrait" : "landscape" });
    pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, w, h);
    pdf.save(`EP-ID-${(m.name || "").replace(/\s+/g, "-")}.pdf`); };
};

/* ---- what a stranger sees when they scan the card ---- */
routes.cardCheck = async (id) => {
  id = id || state.cardId;
  setTitle("Identity check");
  let c = null;
  try { const d = await db.collection("idCards").doc(id).get(); if (d.exists) c = d.data(); } catch { }
  /* A QR may be smudged or a camera broken, so the number printed on the card works too. */
  if (!c && /\//.test(String(id))) {
    try { const q = await db.collection("idCards").where("staffId", "==", String(id).toUpperCase()).limit(1).get();
      if (!q.empty) c = q.docs[0].data(); } catch { }
  }
  const good = c && c.active !== false && (!c.until || new Date(String(c.until).replace("31 March ", "31 Mar ")) >= new Date(today()));
  html(`<div style="max-width:430px;margin:0 auto">
    ${!c ? `<div class="card" style="text-align:center"><img src="logo.png" alt="" style="height:44px;margin-bottom:10px">
        <h2>No such card</h2><p class="small muted">This code does not match any identity card issued by Empower People.
        If someone has shown it to you, please telephone the office on <b>011-40671714</b>.</p></div>`
      : `<div class="card" style="text-align:center;border-left:5px solid ${good ? "#1C7A3E" : "#B3451F"}">
          <div style="font-size:22px;font-weight:800;color:${good ? "#1C7A3E" : "#B3451F"}">${good ? "Valid identity card" : "Not valid"}</div>
          <div class="small muted">${good ? "Issued by Empower People and in force today." : "This card has been withdrawn or has expired. Please telephone the office."}</div></div>
        ${cardArtHtml(c, { id: "checkArt" })}
        <p class="small muted" style="text-align:center;margin-top:12px">Checked on ${fmtD(today())}.
          If you have any doubt, telephone <b>011-40671714</b> or write to post@empowerpeople.in.</p>`}
  </div>`);
};

routes.idcards = async () => {
  setTitle("Staff ID cards");
  const users = staffList();
  html(`<div class="card"><h2>Issue ID cards (${users.length})</h2><p class="small muted">Everyone can download their own from Profile → My ID card. Here you can print a batch or check who still has no photo.</p>
    <div class="tablewrap"><table class="table"><tr><th>Name</th><th>Post</th><th>Office</th><th>Staff ID</th><th>Photo</th></tr>
    ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.postTitle || u.designation || "")}</td><td>${esc(officeName(u.officeId))}</td><td>${esc(staffId(u))}</td><td>${u.photo ? "✓" : `<span class="tag warn">missing</span>`}</td></tr>`).join("")}</table></div></div>`);
};

routes.viewAs = async () => {
  if (!reallySuper()) return html(`<div class="card"><div class="empty">Only the Founder &amp; General Secretary can do this.</div></div>`);
  setTitle("See the app as someone else");
  const v = viewingAs();
  const people = (state.users || []).filter(u => u.active && u.id !== state.user.uid);
  const screensFor = roles => { const keep = state.viewAs; state.viewAs = { roles, label: "x" };
    const n = Object.keys(routes).filter(r => { try { return mayOpen(r); } catch { return false; } }).length;
    state.viewAs = keep; return n; };
  html(`<div class="card"><h2>See the app as someone else</h2>
      <p class="small muted">Useful for checking what a person can actually reach before you ask them to use it.
        It changes only what you see — the database still answers to you, and <b>nothing can be saved</b> while you look.
        It does not show you their private records; it shows your own data through their menu.</p>
      ${v ? `<p><span class="tag warn">Currently looking as ${esc(v.label)}</span></p>` : ""}</div>
    <div class="card"><h2>By role</h2><div class="list">
      ${Object.entries(ROLES).filter(([k]) => k !== "super_admin").map(([k, label]) => `<div class="item">
        <div class="grow"><div class="t">${esc(label)}</div><div class="s">${screensFor([k])} screens</div></div>
        <button class="btn small" data-role="${k}">Look as this</button></div>`).join("")}</div></div>
    <div class="card"><h2>By person</h2>
      <p class="small muted">Uses that person's own roles, so you see exactly the menu they get.</p>
      <div class="list">${people.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="s">${esc(u.postTitle || "")}${u.department ? " · " + esc(u.department) : ""} · ${(u.roles || []).map(r => ROLES[ROLE_ALIAS[r] || r] || r).join(", ")}</div></div>
        <button class="btn small quiet" data-person="${u.id}">Look as ${esc((u.name || "").split(" ")[0])}</button></div>`).join("") || `<div class="empty">No other staff yet</div>`}</div></div>`);
  $("content").querySelectorAll("[data-role]").forEach(b => b.onclick = () => {
    state.viewAs = { roles: [b.dataset.role], label: ROLES[b.dataset.role] };
    audit("view_as", "roles", b.dataset.role, ""); buildNav(); paintViewAs(); go("home"); });
  $("content").querySelectorAll("[data-person]").forEach(b => b.onclick = () => {
    const u = people.find(x => x.id === b.dataset.person);
    state.viewAs = { roles: u.roles || ["field_staff"], uid: u.id, label: u.name + (u.postTitle ? " · " + u.postTitle : "") };
    audit("view_as", "users", u.id, ""); buildNav(); paintViewAs(); go("home"); });
};

routes.override = async () => {
  if (!has("super_admin")) return html(`<div class="card"><div class="empty">App Super Admin only</div></div>`);
  setTitle("App Super Admin tools");
  const COLS = ["users", "posts", "persons", "cases", "caseUpdates", "benefits", "groups", "activities", "eventReports", "projects", "offices", "budgetHeads", "incomeReceipts", "expenses", "pettyCash", "salaryStructures", "banks", "assets", "vendors", "volunteers", "handovers", "travelRequests", "journeys", "advances", "incidents", "appointments", "assignments", "proposals", "opportunities", "outreach", "obligations", "registrations", "statutory", "policies", "meetings", "dayReports", "leaveRequests", "expenseClaims", "attendance", "channels", "settings", "allowlist", "counters"];
  html(`<div class="card"><h2>Everything, editable</h2><p class="small muted">As App Super Admin you can open any record in the database, change any field and delete it. Every action is written to the audit log. Nothing here asks another person's permission.</p>
    <div class="two"><label class="field"><span>Table</span><select id="col">${COLS.map(c => `<option>${c}</option>`).join("")}</select></label><label class="field"><span>Search (any field contains)</span><input id="q" placeholder="name, code, status…"></label></div>
    <button class="btn small" id="load">Load</button></div>
  <div id="res"></div>
  <div class="card"><h2>Reset and rebuild</h2><div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn small quiet" id="unlockAll">Approve every waiting profile</button>
    <button class="btn small quiet" id="makeAdmin">Give someone Super Admin</button>
    <button class="btn small quiet" id="rebuildChan">Rebuild chat channels</button>
    <button class="btn small danger" id="wipe">Empty a table</button></div>
    <p class="small muted" style="margin-top:8px">Use with care — emptying a table cannot be undone, though last night's backup in the shared drive still has the data.</p></div>`);
  const render = async () => { const c = $("col").value, q = ($("q").value || "").toLowerCase();
    const snap = await db.collection(c).limit(300).get(); let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => k !== "id").slice(0, 10);
    $("res").innerHTML = `<div class="card"><h2>${esc(c)} (${rows.length})</h2><div class="tablewrap"><table class="table"><tr><th>id</th>${keys.map(k => `<th>${esc(k)}</th>`).join("")}<th></th></tr>
      ${rows.map(r => `<tr><td class="small muted">${esc(r.id.slice(0, 6))}</td>${keys.map(k => `<td class="small">${esc(typeof r[k] === "object" ? JSON.stringify(r[k]).slice(0, 40) : String(r[k] ?? "").slice(0, 40))}</td>`).join("")}
        <td style="white-space:nowrap"><button class="btn small quiet" data-ed="${r.id}">Edit JSON</button> <button class="btn small danger" data-rm="${r.id}">✕</button></td></tr>`).join("") || `<tr><td colspan="${keys.length + 2}" class="empty">Nothing found</td></tr>`}</table></div></div>`;
    $("res").querySelectorAll("[data-ed]").forEach(b => b.onclick = async () => { const r = rows.find(x => x.id === b.dataset.ed); const { id, ...rest } = r;
      const v = prompt("Edit any field (JSON). Save to apply:", JSON.stringify(rest, null, 1)); if (v === null) return;
      try { await db.collection(c).doc(id).set(JSON.parse(v)); audit("super_edit", c, id, ""); successFlash("Saved"); render(); } catch (e) { alert(e.message); } });
    $("res").querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (!confirm("Delete permanently?")) return; await db.collection(c).doc(b.dataset.rm).delete(); audit("super_delete", c, b.dataset.rm, ""); render(); }); };
  $("load").onclick = render; $("q").onkeydown = e => { if (e.key === "Enter") render(); };
  $("unlockAll").onclick = async () => { const s = await db.collection("users").where("active", "==", false).get(); let n = 0;
    for (const d of s.docs) if (d.data().status === "pending") { await d.ref.update({ active: true, status: "approved", roles: d.data().roles?.length ? d.data().roles : ["field_staff"] }); n++; }
    audit("super_approve_all", "users", null, String(n)); toast(`${n} approved`); bustMastersCache(); await loadMasters(); };
  $("makeAdmin").onclick = async () => { const name = prompt("Give App Super Admin to (name):"); if (!name) return;
    const u = state.users.find(x => x.name.toLowerCase().includes(name.toLowerCase())); if (!u) return toast("Not found");
    if (!confirm(`Give ${u.name} full App Super Admin powers (every department, every record)?`)) return;
    await db.collection("users").doc(u.id).update({ roles: [...new Set([...(u.roles || []), "super_admin"])] }); audit("super_grant", "users", u.id, u.name); toast("Granted"); bustMastersCache(); await loadMasters(); };
  $("rebuildChan").onclick = async () => { const s = await db.collection("channels").where("kind", "!=", "dm").get().catch(() => null);
    if (s) { const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit(); } await ensureChannels(); toast("Channels rebuilt"); };
  $("wipe").onclick = async () => { const c = prompt("Empty which table? (type the exact name)"); if (!c) return;
    if (prompt(`Type DELETE to empty "${c}" permanently`) !== "DELETE") return;
    const s = await db.collection(c).limit(500).get(); const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
    audit("super_wipe", c, null, String(s.size)); toast(`${s.size} records deleted`); };
};

/* ================= APPROVALS (managers, HR, finance) ================= */
async function pendingForMe() {
  const uid = viewUid(); const out = [];
  const team = state.users.filter(u => mgrs(u).includes(uid)).map(u => u.id);
  // Query leave by managerIds.array-contains — no composite index needed
  const [lvDirect, ecAll] = await Promise.all([
    db.collection("leaveRequests").where("managerIds","array-contains",uid).get().catch(()=>({docs:[]})),
    db.collection("expenseClaims").where("managerIds","array-contains",uid).get().catch(()=>({docs:[]}))
  ]);
  lvDirect.docs.filter(d=>d.data().status==="pending").forEach(d => out.push({ kind: "leave", id: d.id, ...d.data() }));
  // Director ACF sees pending leave from GS-reporting staff (routed to them, not GS)
  if (has("director_acf")) {
    const gsIds = (state.users||[]).filter(u=>(u.roles||[]).some(r=>["super_admin","founder"].includes(r))).map(u=>u.id);
    const gsStaff = (state.users||[]).filter(u=>u.active&&(u.managerIds||[]).some(id=>gsIds.includes(id))).map(u=>u.id);
    for (let i=0;i<gsStaff.length;i+=10) {
      const ch=gsStaff.slice(i,i+10); if (!ch.length) continue;
      const s=await db.collection("leaveRequests").where("uid","in",ch).get().catch(()=>({docs:[]}));
      s.docs.filter(d=>{const ld=d.data();return ld.status==="pending"&&/^\d{4}-\d{2}-\d{2}$/.test(ld.from||"")&&!out.find(o=>o.id===d.id);}).forEach(d=>out.push({kind:"leave",id:d.id,...d.data()}));
    }
  }
  ecAll.docs.filter(d=>["submitted","manager_approved"].includes(d.data().status||"")).forEach(d => out.push({ kind: "expense", id: d.id, ...d.data() }));
  // Use single-field queries to avoid composite index requirement, filter status in JS
  const chunks = []; for (let i = 0; i < team.length; i += 10) chunks.push(team.slice(i, i + 10));
  for (const c of chunks) {
    const [l, e] = await Promise.all([
      db.collection("leaveRequests").where("uid","in",c).get().catch(()=>({docs:[]})),
      db.collection("expenseClaims").where("uid","in",c).get().catch(()=>({docs:[]}))]);
    l.docs.filter(d=>{const ld=d.data();return ld.status==="pending"&&/^\d{4}-\d{2}-\d{2}$/.test(ld.from||"")&&!out.find(o=>o.id===d.id);}).forEach(d => out.push({ kind: "leave", id: d.id, ...d.data() }));
    e.docs.filter(d=>["submitted","manager_approved"].includes(d.data().status||"")&&!out.find(o=>o.id===d.id)).forEach(d => out.push({ kind: "expense", id: d.id, ...d.data() }));
  }
  if (isHR()) { const l = await db.collection("leaveRequests").where("status", "==", "pending").get(); l.docs.forEach(d => { if (!out.find(o => o.id === d.id)) out.push({ kind: "leave", id: d.id, ...d.data() }); }); }
  if (isFinance()) { const e = await db.collection("expenseClaims").where("status","==","manager_approved").get().catch(()=>({docs:[]})); e.docs.forEach(d => { const r = d.data(); if (!out.find(o=>o.id===d.id)) out.push({ kind: "expense", id: d.id, ...r }); }); }
  // Advances needing acknowledgement by current user (payee)
  const ackSnap = await db.collection("advances").where("uid","==",uid).where("ackStatus","==","pending").get().catch(()=>({docs:[]}));
  ackSnap.docs.forEach(d => { if (!out.find(o=>o.id===d.id)) out.push({ kind:"advance_ack", id:d.id, _c:"advances", ...d.data() }); });
  // Escalation: advances past ackDue unacknowledged — Director ACF sees ≤50k, Founder sees all
  const escalated = await db.collection("advances").where("ackStatus","==","pending").get().catch(()=>({docs:[]}));
  escalated.docs.filter(d=>{ const r=d.data(); return r.ackDue&&r.ackDue<today()&&(has("founder","super_admin")||(has("director_acf")&&Number(r.amount||0)<=50000)); }).forEach(d=>{ if(!out.find(o=>o.id===d.id)) out.push({kind:"advance_ack_escalated",id:d.id,_c:"advances",...d.data()}); });
  return out;
}
routes.approvals = async () => {
  setTitle(t("approvals"));
  const items = await pendingForMe();
  html(`<div class="card"><div class="list">${items.length ? items.map(x => `<div class="item"><div class="grow">
      <div class="t">${esc(userName(x.uid))} · ${x.kind === "leave" ? `${esc(x.type)} ${x.days} ${t("days")}` : `₹${x.amount} · ${esc(x.description)}`}</div>
      <div class="s">${x.kind === "leave" ? `${x.from} → ${x.to} · ${esc(x.reason)}` : `${x.date} · ${esc(projectName(x.projectId))} · ${esc(x.costHead)}${x.hasReceipt ? ` · <a href="#" data-receipt="${x.id}">receipt</a>` : ""}`}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${x.kind === "leave" ? `<button class="btn small" data-act="approved" data-k="leave" data-id="${x.id}">${t("approve")}</button><button class="btn small danger" data-act="rejected" data-k="leave" data-id="${x.id}">${t("reject")}</button>`
        : x.status === "submitted" ? `<button class="btn small" data-act="manager_approved" data-k="expense" data-id="${x.id}">${t("approve")}</button><button class="btn small quiet" data-act="returned" data-k="expense" data-id="${x.id}">${t("return")}</button><button class="btn small danger" data-act="rejected" data-k="expense" data-id="${x.id}">${t("reject")}</button>`
        : `<button class="btn small" data-act="paid" data-k="expense" data-id="${x.id}">${t("markPaid")}</button><button class="btn small quiet" data-act="returned" data-k="expense" data-id="${x.id}">${t("return")}</button>`}
      </div></div>${tag(x.status)}</div>`).join("") : `<div class="empty">${t("nothing")}</div>`}</div></div>`);
  $("content").querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
    const note = ["returned", "rejected"].includes(b.dataset.act) ? (prompt("Note for the staff member") || "") : "";
    const col = b.dataset.k === "leave" ? "leaveRequests" : "expenseClaims";
    await db.collection(col).doc(b.dataset.id).update({ status: b.dataset.act, note, decidedBy: state.user.uid, decidedAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit(b.dataset.act, col, b.dataset.id, note); toast(t(b.dataset.act)); routes.approvals(); });
};

/* ================= OFFICE OPS MANAGER ================= */
routes.dashboard = async () => {
  setTitle("Dashboard");
  const d = today();
  const [att, dr, lp, ep, em] = await Promise.all([
    db.collection("attendance").where("date", "==", d).get().catch(() => ({ size: 0 })),
    db.collection("dayReports").where("date", "==", d).get().catch(() => ({ size: 0 })),
    db.collection("leaveRequests").where("status", "==", "pending").get().catch(() => ({ size: 0 })),
    db.collection("expenseClaims").where("status", "==", "submitted").get().catch(() => ({ size: 0 })),
    db.collection("expenseClaims").where("status", "==", "manager_approved").get().catch(() => ({ size: 0 }))
  ]);
  const active = state.users.filter(u => u.active).length;
  let pendProfiles = 0; try { pendProfiles = (await db.collection("users").where("active", "==", false).get()).docs.filter(d => d.data().status === "pending").length; } catch {}
  let dueSoon = []; try { const ob = await db.collection("obligations").orderBy("due").limit(50).get(); dueSoon = ob.docs.map(x => x.data()).filter(o => !o.done && (new Date(o.due) - Date.now()) / 86400000 <= 30); } catch {}
  const activeProjects = state.projects.filter(p => p.status === "active");
  let feed = [];
  if (isAdmin()) { const a = await db.collection("audit").orderBy("at", "desc").limit(15).get(); feed = a.docs.map(x => x.data()); }
  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Staff checked in today</span><b>${att.size} / ${active}</b></div>
    <div class="card stat"><span class="muted small">Day reports filed today</span><b>${dr.size}</b></div>
    <div class="card stat"><span class="muted small">Leave awaiting approval</span><b>${lp.size}</b></div>
    <div class="card stat"><span class="muted small">Claims awaiting manager / finance</span><b>${ep.size} / ${em.size}</b></div>
    <div class="card stat"><span class="muted small">Active projects</span><b>${activeProjects.length}</b></div>
  </div>
  ${pendProfiles ? `<div class="card"><h2>Profile approvals</h2><div class="item"><div class="grow"><div class="t">${pendProfiles} new profile(s) waiting for your approval</div></div><button class="btn small" onclick="go('profileApprovals')">Open</button></div></div>` : ""}


  ${dueSoon.length ? `<div class="card"><h2>Reports due to donors</h2><div class="list">${dueSoon.map(o => `<div class="item"><div class="grow"><div class="t">${esc(o.what)}</div><div class="s">${esc(projectName(o.projectId))} · to ${esc(o.to || "")} · due ${esc(o.due)}</div></div><span class="tag ${new Date(o.due) < new Date() ? "bad" : "warn"}">${new Date(o.due) < new Date() ? "overdue" : "due soon"}</span></div>`).join("")}</div></div>` : ""}
  <div class="card"><h2>Projects</h2><div class="tablewrap"><table class="table"><tr><th>Project</th><th>Donor</th><th>Fund</th><th>Ends</th><th>Budget ₹</th></tr>
    ${activeProjects.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.donor || "")}</td><td>${esc(p.fundType || "")}</td><td>${p.end || ""}</td><td>${p.budget ? Number(p.budget).toLocaleString("en-IN") : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No active projects</td></tr>`}</table></div></div>
  ${isAdmin() ? `<div class="card"><h2>Activity</h2><div class="list">${feed.map(f => `<div class="item"><div class="grow"><div class="t">${esc(f.action)} · ${esc(f.table)}</div><div class="s">${esc(f.email)} · ${f.at ? new Date(f.at.seconds*1000).toLocaleString("en-IN") : ""}${f.detail ? ` · ${esc(f.detail)}` : ""}</div></div></div>`).join("") || `<div class="empty">No activity yet</div>`}</div></div>` : ""}`);
};

routes.users = async () => {
  setTitle("People & sign-ins");
  const allow = (await db.collection("allowlist").get()).docs.map(d => ({ email: d.id, ...d.data() }));
  const users = (await db.collection("users").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const pending = users.filter(u => !u.active && u.status === "pending");
  const changes = users.filter(u => !u.active && u.status === "changes");
  const declined = users.filter(u => !u.active && u.status === "declined");
  const active = users.filter(u => u.active);
  const roleChecks = (sel = []) => Object.entries(ROLES).map(([k, v]) => `<label class="check"><input type="checkbox" name="roles" value="${k}" ${sel.includes(k) ? "checked" : ""}> ${v}</label>`).join("");
  const JOIN = { staff: "Staff", volunteer: "Volunteer", board: "Board / Advisory", consultant: "Consultant / Intern", community: "Community leader" };
  html(`<div class="grid">
      <div class="card stat"><span class="muted small">Working in the app</span><b>${active.length}</b></div>
      <div class="card stat"><span class="muted small">Waiting for your approval</span><b>${pending.length}</b></div>
      <div class="card stat"><span class="muted small">Asked to change something</span><b>${changes.length}</b></div>
      <div class="card stat"><span class="muted small">Pre-approved emails</span><b>${allow.length}</b></div></div>

    ${pending.length ? `<div class="card" style="border-left:4px solid var(--warn,#C8922F)"><h2>Waiting for your approval (${pending.length})</h2>
      <p class="small muted">These people have signed in and filled a profile. They cannot use the app until you approve them and match them to a post.</p>
      <div class="list">${pending.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)} <span class="tag warn">not approved</span> <span class="tag">${esc(JOIN[u.joinAs] || "Staff")}</span></div>
        <div class="s">${esc(u.email || u.phone || "")} · wrote: "${esc(u.designation || "")}" · ${esc(u.department || "")}${u.projectsText ? " · " + esc(u.projectsText) : ""}</div></div>
        <button class="btn small" onclick="go('profileApprovals')">Review</button></div>`).join("")}</div></div>` : ""}

    ${changes.length ? `<div class="card"><h2>Asked to change something (${changes.length})</h2><div class="list">
      ${changes.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)}</div><div class="s">${esc(u.email || "")} · you wrote: "${esc(u.note || "")}"</div></div><span class="tag warn">waiting on them</span></div>`).join("")}</div></div>` : ""}

    <div class="card"><h2>People working in the app (${active.length})</h2><div class="list">
      ${active.map(u => `<div class="item"><div class="grow">
        <div class="t">${esc(u.name)}${standingOf(u) ? ` · ${esc(standingOf(u))}` : ` <span class="tag warn">no post</span>`}</div>
        <div class="s">${esc(u.email || u.phone || "")} · ${(u.roles || []).map(r => ROLES[r] || ROLES[ROLE_ALIAS[r]] || r).join(", ") || "no role"} · ${esc(officeName(u.officeId)) || "no office"} · reports to ${esc(mgrs(u).map(id => userName(id)).filter(Boolean).join(", ")) || "—"}</div>
        ${(u.roles || []).some(r => ROLE_ALIAS[r]) ? `<div class="s" style="color:#9A6A2F">old role names — open and re-tick to update</div>` : ""}</div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <button class="btn small quiet" data-sr="${u.id}">Full record</button>
          <button class="btn small quiet" data-euser="${u.id}">Edit roles</button>
          ${(u.roles || []).map(r => ROLE_ALIAS[r] || r).includes("super_admin") || u.id === state.user.uid
            ? `<span class="tag">${u.id === state.user.uid ? "you" : "protected"}</span>`
            : `<button class="btn small danger" data-off="${u.id}">Suspend</button>`}
        </div></div>`).join("") || `<div class="empty">Nobody yet</div>`}</div></div>

    <div class="card"><h2>Pre-approved emails (${allow.length})</h2>
      <p class="small muted">An email listed here skips the approval queue — the person signs in and is active at once with the roles set here. Use it only for yourself and for people you are certain of; everyone else should go through Profile approvals.</p>
      <div class="list">${allow.map(x => `<div class="item"><div class="grow"><div class="t">${esc(x.name || x.email)} ${users.find(u => u.email === x.email) ? "" : '<span class="tag warn">not signed in yet</span>'}</div>
        <div class="s">${esc(x.email)} · ${(x.roles || []).map(r => ROLES[r] || ROLES[ROLE_ALIAS[r]] || r).join(", ")}</div></div>
        <button class="btn small quiet" data-edit="${esc(x.email)}">Edit</button><button class="btn small danger" data-rm="${esc(x.email)}">Remove</button></div>`).join("") || `<div class="empty">None</div>`}</div>
      <details style="margin-top:10px"><summary class="small">Add a pre-approved email</summary><form id="f" style="margin-top:8px">
        <div class="two"><label class="field"><span>Email</span><input name="email" type="email" required></label><label class="field"><span>Name</span><input name="name"></label></div>
        <div class="rolebox">${roleChecks([])}</div><button class="btn small" type="submit">Add</button></form></details></div>
    <div class="card hidden" id="editCard"></div>`);
  if ($("f")) $("f").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const email = fd.get("email").trim().toLowerCase();
    await db.collection("allowlist").doc(email).set({ name: fd.get("name"), roles: fd.getAll("roles"), active: true, addedBy: state.user.uid });
    audit("allowlist_add", "allowlist", email); toast("Added"); routes.users(); };
  $("content").querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (!confirm("Remove this pre-approved email? They would then need approval like everyone else.")) return;
    await db.collection("allowlist").doc(b.dataset.rm).delete(); audit("allowlist_remove", "allowlist", b.dataset.rm); routes.users(); });
  $("content").querySelectorAll("[data-sr]").forEach(b => b.onclick = () => { state.viewStaff = b.dataset.sr; go("staffRecord"); });
  $("content").querySelectorAll("[data-off]").forEach(b => b.onclick = async () => {
    const target = users.find(u => u.id === b.dataset.off) || {};
    if ((target.roles || []).map(r => ROLE_ALIAS[r] || r).includes("super_admin"))
      return alert("The Founder & General Secretary cannot be suspended from within the app.");
    if (b.dataset.off === state.user.uid) return alert("You cannot suspend yourself.");
    if (!confirm(`Suspend ${target.name}? They stay in the app but cannot use it.`)) return;
    await db.collection("users").doc(b.dataset.off).update({ active: false, status: "suspended" }); audit("suspend", "users", b.dataset.off); bustMastersCache(); await loadMasters(); routes.users(); });
  const openEditor = (u) => { const card = $("editCard"); card.classList.remove("hidden");
    card.innerHTML = `<h2>${esc(u.name || u.email)}</h2><form id="ef">
      ${u.id ? `<label class="field"><span>Name</span><input name="name" value="${esc(u.name || "")}">
        <span class="small muted">${u.nameChanged ? `They corrected it themselves on ${esc(fmtD(u.nameChangedAt))}${u.previousName ? ` — was "${esc(u.previousName)}"` : ""}.` : "They have not used their own one-time correction yet."}</span></label>` : ""}
      <div class="two"><label class="field"><span>Office</span><select name="officeId"><option value="">—</option>${state.offices.map(o => `<option value="${o.id}" ${o.id === u.officeId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Also sees cases in these states</span><input name="statesText" value="${esc((u.states || []).join(", "))}" placeholder="Bihar, Assam"></label></div>
      <label class="field"><span>Reporting managers (tick one or more)</span><div class="rolebox" style="border:1.5px solid var(--line);border-radius:10px;padding:6px 10px">${managerChoices().filter(x => x.id !== u.id).map(x => `<label class="check"><input type="checkbox" name="managerIds" value="${x.id}" ${mgrs(u).includes(x.id) ? "checked" : ""}> ${esc(x.name)}${x.postTitle ? ` <span class="small muted">· ${esc(x.postTitle)}</span>` : ""}</label>`).join("") || `<span class="small muted">Nobody holds a post yet — approve people against their posts first.</span>`}</div></label>
      ${(u.roles||[]).includes("counsellor") ? `<label class="field"><span>Assigned offices (counsellors — tick all that apply)</span><div class="rolebox" style="border:1.5px solid var(--line);border-radius:10px;padding:6px 10px">${(state.offices||[]).map(o => `<label class="check"><input type="checkbox" name="officeIds" value="${o.id}" ${(u.officeIds||[]).includes(o.id) ? "checked" : ""}> ${esc(o.name)}</label>`).join("")}</div></label>` : ""}
      <span class="small" style="font-weight:600">Roles</span><div class="rolebox">${roleChecks((u.roles || []).map(r => ROLE_ALIAS[r] || r))}</div>
      <button class="btn small" type="submit">Save</button> <button class="btn small quiet" type="button" id="ecancel">Close</button></form>`;
    card.scrollIntoView({ behavior: "smooth" });
    $("ecancel").onclick = () => card.classList.add("hidden");
    $("ef").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target);
      const patch = { roles: fd.getAll("roles"), officeId: fd.get("officeId") || null, managerIds: fd.getAll("managerIds"),
        states: (fd.get("statesText") || "").split(",").map(x => x.trim()).filter(Boolean) };
      const nm = (fd.get("name") || "").trim();
      if (u.id && nm && nm !== (u.name || "").trim()) { patch.name = nm; patch.previousName = u.name || null; patch.renamedBy = state.user.uid; patch.renamedOn = today();
        if (u.postId) await db.collection("posts").doc(u.postId).update({ holderName: nm }).catch(() => {});
        await db.collection("idCards").doc(u.id).set({ name: nm }, { merge: true }).catch(() => {});
        audit("rename", "users", u.id, `${u.name} → ${nm}`); }
      const wasSuper = (u.roles || []).map(r => ROLE_ALIAS[r] || r).includes("super_admin");
      if (wasSuper && !patch.roles.includes("super_admin") && u.id !== state.user.uid)
        return alert("Only the Founder & General Secretary can give up that role.");
      const officeIds = [...fd.getAll("officeIds")];
      if (officeIds.length) patch.officeIds = officeIds;
      if (u.id) await db.collection("users").doc(u.id).update(patch);
      else await db.collection("allowlist").doc(u.email).set({ ...patch, name: u.name || "", active: true }, { merge: true });
      audit("update", u.id ? "users" : "allowlist", u.id || u.email, (patch.roles || []).join(",")); successFlash("Saved"); bustMastersCache(); await loadMasters(); routes.users(); }; };
  $("content").querySelectorAll("[data-euser]").forEach(b => b.onclick = () => openEditor(users.find(u => u.id === b.dataset.euser)));
  $("content").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openEditor(allow.find(a => a.email === b.dataset.edit)));
};

routes.offices = async () => {
  setTitle("Offices");
  const canEdit = has("super_admin", "director_acf", "admin");
  const snap = await db.collection("offices").orderBy("name").get();
  const offices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const staffAt = id => state.users.filter(u => u.active && u.officeId === id).length;
  html(`${canEdit ? `<div class="card"><h2>Add an office</h2><form id="of">
      <div class="two"><label class="field"><span>Office name</span><input name="name" required placeholder="Delhi HQ, Haryana Office"></label>
        <label class="field"><span>Type</span><select name="type">${["Head office", "State office", "Field office", "Coaching centre", "Registered office"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions("Haryana")}</select></label>
        <label class="field"><span>District</span><select name="district" data-geo="district">${districtOptions("Haryana")}</select></label></div>
      <label class="field"><span>Address</span><textarea name="address"></textarea></label>
      <div class="two"><label class="field"><span>Phone</span><input name="phone"></label>
        <label class="field"><span>Office in charge</span><select name="inChargeId"><option value="">—</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Rent (₹ per month, if rented)</span><input type="number" step="any" inputmode="decimal" name="rent"></label>
        <label class="field"><span>Status</span><select name="status">${["Open", "Closed"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Location (latitude, longitude)</span><input name="latlng" placeholder="28.5352456, 77.28768"></label>
        <label class="field"><span>Check-in must be within (metres, blank = anywhere)</span><input type="number" step="any" inputmode="decimal" name="radius" placeholder="100"></label></div>
      <p class="small muted">Set a radius only where staff are expected at a desk. Field teams attached to this office can still check in from where they are; it is recorded as a field check-in with a reason.</p>
      <button class="btn small" type="submit">Add office</button></form></div>` : ""}
    <div class="card"><h2>Offices (${offices.length})</h2><div class="tablewrap"><table class="table">
      <tr><th>Office</th><th>Type</th><th>District</th><th>State</th><th>In charge</th><th>Staff</th><th>Phone</th><th>Status</th>${canEdit ? "<th></th>" : ""}</tr>
      ${offices.map(o => `<tr><td><b>${esc(o.name)}</b>${o.address ? `<div class="s">${esc(o.address)}</div>` : ""}</td>
        <td>${esc(o.type || "")}</td><td>${esc(o.district || "")}</td><td>${esc(o.state || "")}</td>
        <td>${esc(userName(o.inChargeId) || "—")}</td><td>${staffAt(o.id)}</td><td class="small">${esc(o.phone || "")}</td>
        <td>${o.status === "Closed" ? `<span class="tag">closed</span>` : `<span class="tag ok">open</span>`}</td>
        ${canEdit ? `<td style="white-space:nowrap"><button class="btn small quiet" data-oedit="${o.id}">Edit</button>${has("super_admin") ? ` <button class="btn small danger" data-odel="${o.id}">✕</button>` : ""}</td>` : ""}</tr>`).join("") || `<tr><td colspan="9" class="empty">No offices yet</td></tr>`}</table></div></div>
    <div class="card hidden" id="oeditCard"></div>`);
  if ($("of")) $("of").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    d.rent = d.rent ? Number(d.rent) : null; parseLatLng(d);
    const r = await db.collection("offices").add({ ...d, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("create", "offices", r.id, d.name); toast("Office added"); bustMastersCache(); await loadMasters(); routes.offices(); };
  $("content").querySelectorAll("[data-odel]").forEach(b => b.onclick = async () => {
    const o = offices.find(x => x.id === b.dataset.odel);
    if (staffAt(o.id)) return alert("People are attached to this office. Move them first.");
    if (!confirm(`Remove ${o.name}?`)) return;
    await db.collection("offices").doc(o.id).delete(); audit("delete", "offices", o.id, o.name); bustMastersCache(); await loadMasters(); routes.offices(); });
  $("content").querySelectorAll("[data-oedit]").forEach(b => b.onclick = () => { const o = offices.find(x => x.id === b.dataset.oedit);
    const card = $("oeditCard"); card.classList.remove("hidden");
    card.innerHTML = `<h2>${esc(o.name)}</h2><form id="oe">
      <div class="two"><label class="field"><span>Office name</span><input name="name" value="${esc(o.name)}" required></label>
        <label class="field"><span>Type</span><select name="type">${["Head office", "State office", "Field office", "Coaching centre", "Registered office"].map(x => `<option ${x === o.type ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions(o.state || "Haryana")}</select></label>
        <label class="field"><span>District</span><select name="district" data-geo="district" data-selected="${esc(o.district || "")}">${districtOptions(o.state || "Haryana", o.district)}</select></label></div>
      <label class="field"><span>Address</span><textarea name="address">${esc(o.address || "")}</textarea></label>
      <div class="two"><label class="field"><span>Phone</span><input name="phone" value="${esc(o.phone || "")}"></label>
        <label class="field"><span>Office in charge</span><select name="inChargeId"><option value="">—</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === o.inChargeId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Rent ₹ per month</span><input type="number" step="any" inputmode="decimal" name="rent" value="${o.rent || ""}"></label>
        <label class="field"><span>Status</span><select name="status">${["Open", "Closed"].map(x => `<option ${x === o.status ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Location (latitude, longitude)</span><input name="latlng" value="${o.lat ? o.lat + ", " + o.lng : ""}" placeholder="28.5352456, 77.28768"></label>
        <label class="field"><span>Check-in must be within (metres, blank = anywhere)</span><input type="number" step="any" inputmode="decimal" name="radius" value="${o.radius || ""}"></label></div>
      <label class="check"><input type="checkbox" name="allowWFH" ${o.allowWFH ? "checked" : ""}> Staff posted here may work from home</label>
      <button class="btn small" type="submit">Save</button> <button class="btn small quiet" type="button" id="ocancel">Close</button></form>`;
    card.scrollIntoView({ behavior: "smooth" });
    $("ocancel").onclick = () => card.classList.add("hidden");
    $("oe").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.rent = d.rent ? Number(d.rent) : null;
      parseLatLng(d); d.allowWFH = d.allowWFH === "on" || d.allowWFH === true;
      await db.collection("offices").doc(o.id).update(d); audit("update", "offices", o.id, d.name); successFlash("Saved"); bustMastersCache(); await loadMasters(); routes.offices(); }; });
};

routes.projects = async () => {
  setTitle("Project register");
  const canMakeProject = has("super_admin", "fundraising");      // Project Development, Research & Innovations
  const canSetLead = has("super_admin");                        // the coordinator is named by the General Secretary
  const staff = state.users.filter(u => u.active);
  const form = (p = {}) => `<form id="pf" data-id="${p.id || ""}">
    <div class="two"><label class="field"><span>Project name</span><input name="name" value="${esc(p.name || "")}" required></label><label class="field"><span>Project code</span><input name="code" value="${esc(p.code || "")}" placeholder="SAMPURNA, M3-SAGE"></label></div>
    <div class="two"><label class="field"><span>Donor</span><input name="donor" value="${esc(p.donor || "")}"></label><label class="field"><span>Donor short code (used on asset tags)</span><input name="donorCode" value="${esc(p.donorCode || "")}" placeholder="LBF, UNODC, OHCHR, LOREAL"></label></div>
    <label class="field"><span>Which of our programmes does this project deliver?</span>
      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">
        ${(state.programmes || []).map(g => `<label class="check" style="margin:0"><input type="checkbox" name="programmeIds" value="${g.id}" ${(p.programmeIds || []).includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`).join("")
          || `<span class="small muted">No programmes loaded yet — add them under App administration.</span>`}</div>
      <span class="small muted">A project pays for programme work; the programme is what the work is. Choosing one here fills it in on every event report and benefit recorded against the project.</span></label>
    <div class="two"><label class="field"><span>Status</span><select name="status">${["active", "closed", "proposed"].map(x => `<option ${x === (p.status || "active") ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Start</span><input type="date" name="start" value="${p.start || ""}"></label><label class="field"><span>End</span><input type="date" name="end" value="${p.end || ""}"></label></div>
    <div class="two"><label class="field"><span>Budget (₹)</span><input type="number" step="any" inputmode="decimal" name="budget" value="${p.budget || ""}"></label>
      <label class="field"><span>Fund type</span><select name="fundType">${FUND_TYPES.map(x => `<option ${x === p.fundType ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Restriction</span><select name="restriction">${RESTRICTIONS.map(x => `<option ${x === p.restriction ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Reporting cycle</span><select name="cycle">${["Quarterly", "4-monthly", "Half-yearly", "Annual", "On completion"].map(x => `<option ${x === p.cycle ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Project coordinator (owner, accountable)</span>${canSetLead
        ? `<select name="leadId"><option value="">— to be named —</option>${staff.map(u => `<option value="${u.id}" ${u.id === p.leadId ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select>`
        : `<input value="${esc(userName(p.leadId) || "named by the General Secretary")}" disabled>`}</label>
      <label class="field"><span>Finance focal point</span><select name="financeId"><option value="">—</option>${staff.map(u => `<option value="${u.id}" ${u.id === p.financeId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div>
    <p class="small muted">The coordinator is named by the Founder &amp; General Secretary, and builds the project team themselves from the project page.</p>
    <div class="two"><label class="field"><span>Geography</span><input name="geography" value="${esc(p.geography || "")}" placeholder="State, districts">
      <label class="field"><span>Primary office</span><select name="officeId"><option value="">— all / HQ —</option>${(state.offices||[]).map(o=>`<option value="${o.id}" ${o.id===p.officeId?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label></div>
    <div class="two"><label class="field"><span>Bank account</span><input name="bank" value="${esc(p.bank || "")}" placeholder="SBI •••• 2031 (FCRA)"></label></div>
    <div class="two"><label class="field"><span>Foreign amount & currency (if FCRA)</span><input name="foreignAmount" value="${esc(p.foreignAmount || "")}" placeholder="CHF 120,000"></label>
      <label class="field"><span>Voucher prefix</span><input name="voucherPrefix" value="${esc(p.voucherPrefix || "")}" placeholder="SAM, LBF"></label></div>
    <label class="field"><span>Objectives</span><textarea name="objectives">${esc(p.objectives || "")}</textarea></label>
    <label class="field"><span>Attachments (agreement, approved budget, proposal)</span><input type="file" name="attach" accept="image/*,.pdf"></label>
    <button class="btn small" type="submit">${p.id ? "Save changes" : "Register project"}</button> ${p.id ? `<button class="btn small quiet" type="button" id="pcancel">Cancel</button>` : ""}</form>`;
  html(`${canMakeProject ? `<div class="card" id="formCard"><h2>Register a project</h2><p class="small muted">Projects are opened by Project Development, Research &amp; Innovations. Every project has one accountable coordinator who, with the team listed here, can open the project and its budget. Budget heads are entered by the Accountant.</p>${form()}</div>` : `<div class="card"><p class="small muted">You can open the projects you lead or work on.</p></div>`}
    <div class="card"><h2>Projects (${state.projects.length})</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[["live", "Running"], ["closed", "Closed"], ["all", "All"]]
        .map(([k, l]) => `<button class="btn small ${(state.projFilter || "live") === k ? "" : "quiet"}" data-pf="${k}">${l}${k === "closed" ? ` (${state.projects.filter(p => !isLiveProject(p)).length})` : ""}</button>`).join("")}</div><div class="tablewrap"><table class="table"><tr><th>Project</th><th>Donor</th><th>Coordinator</th><th>Team</th><th>Period</th><th>Fund</th><th>Budget ₹</th><th>Status</th><th></th></tr>
    ${state.projects.filter(p => { const f = state.projFilter || "live"; return f === "all" || (f === "live" ? isLiveProject(p) : !isLiveProject(p)); })
      .map(p => `<tr><td><b>${esc(p.name)}</b>${p.code ? `<div class="s">${esc(p.code)}</div>` : ""}</td><td>${esc(p.donor || "")}</td>
      <td>${p.leadId ? esc(userName(p.leadId)) : `<span class="tag warn">to be named</span>`}</td><td>${(p.team || []).length || "—"}</td>
      <td class="small">${p.start || ""} → ${p.end || ""}</td><td>${esc(p.fundType || "")}</td><td>${p.budget ? Number(p.budget).toLocaleString("en-IN") : ""}</td><td>${tag(p.status)}</td>
      <td style="white-space:nowrap"><button class="btn small quiet" data-open="${p.id}">Open</button>${canMakeProject ? ` <button class="btn small quiet" data-edit="${p.id}">Edit</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">No projects yet</td></tr>`}</table></div></div>`);
  const bind = () => { if (!$("pf")) return; $("pf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd);
      d.budget = Number(d.budget) || 0;
      d.programmeIds = fd.getAll("programmeIds");
      d.grantAmount = d.grantAmount ? Number(d.grantAmount) : null;
      d.exchangeRate = d.exchangeRate ? Number(d.exchangeRate) : null;
      d.currency = "INR";
      if (!d.budget && d.grantAmount && d.exchangeRate) d.budget = Math.round(d.grantAmount * d.exchangeRate);
      const id = e.target.dataset.id;
      if (!canSetLead) delete d.leadId;                         // only the General Secretary names the coordinator
      if (!id) d.team = [];                                      // the coordinator builds the team afterwards
      const at = fd.get("attach"); delete d.attach;
      if (at && at.size) { const s = await uploadToDrive(at,"program",at.name); if (s) { const cur = (state.projects.find(x => x.id === id) || {}).docs || []; d.docs = [...cur, s]; } }
      if (id) { await db.collection("projects").doc(id).update(d); audit("update", "projects", id, d.name); }
      else { const r = await db.collection("projects").add({ ...d, createdBy: state.user.uid }); audit("create", "projects", r.id, d.name);
        await db.collection("channels").add({ kind: "project", name: d.name, projectId: r.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {}); }
      successFlash("Saved"); bustMastersCache(); await loadMasters(); routes.projects(); };
    if ($("pcancel")) $("pcancel").onclick = routes.projects; };
  bind();
  $("content").querySelectorAll("[data-pf]").forEach(b => b.onclick = () => { state.projFilter = b.dataset.pf; routes.projects(); });
  $("content").querySelectorAll("[data-open]").forEach(b => b.onclick = () => { state.projectId = b.dataset.open; go("project"); });
  $("content").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { const p = state.projects.find(x => x.id === b.dataset.edit); $("formCard").innerHTML = `<h2>Edit project</h2>${form(p)}`; bind(); $("formCard").scrollIntoView({ behavior: "smooth" }); });
};

routes.audit = async () => {
  setTitle("Audit log");
  const a = await db.collection("audit").orderBy("at", "desc").limit(200).get();
  html(`<div class="card"><div class="tablewrap"><table class="table"><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Record</th><th>Detail</th></tr>
    ${a.docs.map(d => { const f = d.data(); return `<tr><td>${f.at ? new Date(f.at.seconds*1000).toLocaleString("en-IN") : ""}</td><td>${esc(f.email)}</td><td>${esc(f.action)}</td><td>${esc(f.table)}</td><td class="small">${esc(f.recordId || "")}</td><td>${esc(f.detail || "")}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">Nothing logged yet</td></tr>`}</table></div></div>`);
};

async function showReceipt(id) {
  const snap=await db.collection("expenseClaims").doc(id).get().catch(()=>null);
  const bill=snap&&snap.data?snap.data().bill:null;
  if(!bill){toast("No bill on this record");return;}
  const url=typeof bill==="object"?(bill.link||bill.url||""):String(bill||"");
  if(url) window.open(url,"_blank","noopener"); else toast("Bill saved but URL missing");
}
document.addEventListener("click", e => { const a = e.target.closest("[data-receipt]"); if (a) { e.preventDefault(); showReceipt(a.dataset.receipt); } });

/* ---------- Helpers ---------- */
const projectOptions = () => `<option value="">—</option>` + (state.projects||[]).filter(p => p.status === "active").map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
// Project + programme dropdown for day report and beneficiary forms
const programmeProjectOptions = (selected) => {
  const isFieldOnly = has("field_staff") || isVolunteerOnly();
  const myOffice = state.me?.officeId;
  const myState = ((state.offices||[]).find(o=>o.id===myOffice)||{}).state || state.me?.state || "";
  // Programmes: team-based for field staff, with office fallback if none assigned
  let progs = typeof visibleProgrammes==="function" ? visibleProgrammes() : (state.programmes||[]);
  if(isFieldOnly && progs.length === 0) {
    // Fallback: office/state match
    progs = (state.programmes||[]).filter(g =>
      (myOffice && (g.officeId===myOffice||(g.offices||[]).includes(myOffice))) ||
      (myState && g.statesText && g.statesText.toLowerCase().includes(myState.toLowerCase()))
    );
  }
  if(!isFieldOnly) progs = state.programmes||[];
  // Projects: visible projects for field staff, all active otherwise
  const allProjs = (state.projects||[]).filter(p=>p.status==="active");
  const projs = isFieldOnly ? (typeof visibleProjects==="function" ? visibleProjects().filter(p=>p.status==="active") : allProjs) : allProjs;
  const progOpts = progs.map(g=>`<option value="prog:${g.id}" ${selected==="prog:"+g.id?"selected":""}>${esc(g.name)}</option>`).join("");
  const projOpts = projs.map(p=>`<option value="${p.id}" ${selected===p.id?"selected":""}>${esc(p.name)}</option>`).join("");
  const groups = [progOpts?`<optgroup label="Programmes">${progOpts}</optgroup>`:"", projOpts?`<optgroup label="Projects">${projOpts}</optgroup>`:""].filter(Boolean).join("");
  return `<option value="">—</option>${groups}`;
};
/* A closed project stays in its own register and on its own page, for the record.
   Everywhere else — pickers, dashboards, plans, calendars — only the live ones. */
const isLiveProject = p => !/closed|completed|dropped/i.test(String(p.status || "active"));
const activeProjects = () => (state.projects || []).filter(isLiveProject);
const myActiveProjects = () => {
  if (has("super_admin","admin","director_acf","accountant","founder")) return activeProjects();
  const uid = state.user.uid;
  return activeProjects().filter(p => (p.team||[]).includes(uid) || (p.teamMembers||[]).includes(uid) || p.leadId === uid || p.coordinatorId === uid);
};
const programmeName = id => (state.programmes || []).find(p => p.id === id)?.name || '';
const projectName = id => state.projects.find(p => p.id === id)?.name || "";
const fundTypeOf = id => state.projects.find(p => p.id === id)?.fundType || null;
const officeName = id => state.offices.find(o => o.id === id)?.name || "";
const userName = id => id === "system" ? "System" : (state.users.find(u => u.id === id)?.name || "");
/* Turn a photograph of a signature into clean ink on a transparent background,
   and crop away the empty paper around it. */
async function trimSignature(blob) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0, ink = 0;
  for (let i = 0; i < px.length; i += 4) {
    const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    if (lum > 165) { px[i + 3] = 0; }                               // paper becomes transparent
    else { px[i] = px[i + 1] = px[i + 2] = 20; px[i + 3] = 255;      // ink becomes near-black
      const p = i / 4, cx = p % c.width, cy = (p / c.width) | 0; ink++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy; }
  }
  if (ink < 5) throw new Error("That photograph has no clear signature on it — try in better light with a dark pen on white paper.");
  x.putImageData(d, 0, 0);
  const pad = 8, w = Math.min(c.width, maxX - minX + pad * 2), h = Math.min(c.height, maxY - minY + pad * 2);
  const o = document.createElement("canvas"); o.width = w; o.height = h;
  o.getContext("2d").drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), w, h, 0, 0, w, h);
  return await new Promise(r => o.toBlob(r, "image/png"));
}
const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
function compressImage(file, max = 1280, quality = 0.7) {
  return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = img.width * s; c.height = img.height * s;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => { URL.revokeObjectURL(url); b ? res(b) : rej(new Error("compress failed")); }, "image/jpeg", quality); };
    img.onerror = () => rej(new Error("bad image")); img.src = url; });
}

/* ---------- Boot ---------- */
function boot() {
  if (!firebaseConfig.apiKey) { show("v-login"); $("loginErr").textContent = "App not configured: fill firebaseConfig in app.js (see README)."; $("googleBtn").disabled = true; $("emailBtn").disabled = true; return; }
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth(); db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  $("googleBtn").onclick = async () => { const gp = new firebase.auth.GoogleAuthProvider(); gp.addScope("https://www.googleapis.com/auth/drive.file"); try { const gr = await auth.signInWithPopup(gp); if (gr.credential?.accessToken) { window._driveToken = gr.credential.accessToken; window._driveTokenAt = Date.now(); } } catch(e) { $("loginErr").textContent = e.message; } };
  /* Phone sign-in, for people who have no email account — the Salah Sakhis and the
     field team. India only, so the number is taken plainly and +91 added here. */
  const showWay = which => {
    const ways = document.querySelector(".waysin"); if (ways) ways.classList.add("hidden");
    ["m-phone", "m-email"].forEach(id => { const el = $(id); if (el) el.classList.toggle("hidden", id !== "m-" + which); });
    $("loginErr").textContent = "";
  };
  if (typeof paintSignInWords === "function") paintSignInWords();

  if ($("phoneSwitch")) $("phoneSwitch").onclick = () => showWay("phone");
  if ($("emailSwitch")) $("emailSwitch").onclick = () => showWay("email");
  let confirmer = null;
  const recaptcha = () => {
    if (window._epRecaptcha) return window._epRecaptcha;
    window._epRecaptcha = new firebase.auth.RecaptchaVerifier("recaptcha", { size: "invisible" });
    return window._epRecaptcha;
  };
  const sendCode = async () => {
    const raw = ($("phoneIn").value || "").replace(/\D/g, "");
    const num = raw.length === 10 ? "+91" + raw : raw.length === 12 && raw.startsWith("91") ? "+" + raw : null;
    if (!num) { $("loginErr").textContent = "Please give the ten-digit mobile number."; return; }
    $("loginErr").textContent = "Sending a code to " + num + "…";
    try {
      confirmer = await auth.signInWithPhoneNumber(num, recaptcha());
      $("otpWrap").classList.remove("hidden");
      $("loginErr").textContent = "We have sent a six-digit code to " + num + ".";
      $("otpIn").focus();
    } catch (e) {
      $("loginErr").textContent = /not enabled|operation-not-allowed/i.test(e.message)
        ? "Phone sign-in is not switched on yet. Use Google, or ask the office."
        : friendlyAuth(e);
      if (window._epRecaptcha) { try { window._epRecaptcha.clear(); } catch { } window._epRecaptcha = null; }
    }
  };
  if ($("phoneSendBtn")) $("phoneSendBtn").onclick = sendCode;
  if ($("otpAgain")) $("otpAgain").onclick = sendCode;
  if ($("otpBtn")) $("otpBtn").onclick = async () => {
    const code = ($("otpIn").value || "").replace(/\D/g, "");
    if (!confirmer) { $("loginErr").textContent = "Ask for a code first."; return; }
    if (code.length !== 6) { $("loginErr").textContent = "The code is six digits."; return; }
    try { await confirmer.confirm(code); }
    catch (e) { $("loginErr").textContent = /invalid-verification-code/i.test(e.message)
      ? "That code does not match. Check it, or ask for another." : friendlyAuth(e); }
  };
  if ($("otpIn")) $("otpIn").addEventListener("keydown", e => { if (e.key === "Enter") $("otpBtn").click(); });
  $("emailBtn").onclick = () => auth.signInWithEmailAndPassword($("emailIn").value.trim(), $("passIn").value).catch(e => $("loginErr").textContent = friendlyAuth(e));
  if ($("emailNewBtn")) $("emailNewBtn").onclick = () => { const em = $("emailIn").value.trim(), pw = $("passIn").value;
    if (pw.length < 6) return $("loginErr").textContent = "Choose a password of at least 6 characters.";
    auth.createUserWithEmailAndPassword(em, pw).catch(e => $("loginErr").textContent = friendlyAuth(e)); };

  // --- sign-in method tabs ---
  document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabbtn").forEach(x => x.classList.toggle("on", x === b));
    ["google", "email"].forEach(m => { const el = $("m-" + m); if (el) el.classList.toggle("hidden", m !== b.dataset.m); });
    $("loginErr").textContent = ""; });

  $("outBtn").onclick = () => auth.signOut(); $("deniedOut").onclick = () => auth.signOut();
  $("menuBtn").onclick = () => $("drawer").classList.toggle("hidden");
  $("drawer").onclick = e => { if (e.target === $("drawer")) closeDrawer(); };
  const net = () => $("offlineBar").classList.toggle("hidden", navigator.onLine); window.addEventListener("online", net); window.addEventListener("offline", net); net();
  (function () { const m = location.hash.match(/^#card=(.+)$/);
  if (m) { state.cardId = m[1];
    const draw = () => { show("v-main"); routes.cardCheck(m[1]); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw); else draw(); } })();
// Ensure forms.js executed properly — re-fetch if functions missing
if (typeof routes.forms !== "function") {
  fetch("/forms.js?v=338&t="+Date.now()).then(r=>r.text()).then(code=>{
    try { eval(code); } catch(e) { console.warn("forms.js eval:", e); }
  });
}

auth.onAuthStateChanged(u => {
  if (isCardCheck()) return;                       // a public card check needs no account
  if (u) onSignedIn(u).catch(e => { $("loginErr").textContent = e.message; show("v-login"); });
  else { state.user = state.me = null; show("v-login"); }
});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let installEvt = null;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (!standalone()) $("installBtn").classList.remove("hidden"); });
  $("installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").classList.add("hidden"); };
  window.addEventListener("appinstalled", () => { $("installBtn").classList.add("hidden"); $("installHint").classList.add("hidden"); });
  setTimeout(() => { if (!installEvt && !standalone()) $("installHint").classList.remove("hidden"); }, 3000);
}


// Drive fallback wrapper — runs 2s after boot() so uploadToDrive is defined
var _bootOrig = typeof boot === 'function' ? boot : null;
if(_bootOrig) {
  boot = function() {
    var _br = _bootOrig.apply(this, arguments);
    setTimeout(function(){
      if(typeof uploadToDrive==='function'&&!uploadToDrive._fallbackWrapped){
        var _orig=uploadToDrive;
        window.uploadToDrive=async function(file,fk,nh){
          try{var r=await _orig(file,fk,nh);if(r&&r.link)return r;}catch(e){console.warn('Drive failed:',e.message);}
          try{
            var path='pending/'+(fk||'root')+'/'+Date.now()+'-'+(nh||'file');
            var ref=firebase.storage().ref(path);
            await ref.put(file instanceof File?file:new File([file],nh||'file'));
            var url=await ref.getDownloadURL();
            await db.collection('driveQueue').add({storagePath:path,driveFolder:fk||'root',driveName:nh||'file',driveMime:(file&&file.type)||'application/octet-stream',status:'pending',createdAt:today(),createdBy:(state.user&&state.user.uid)||''});
            return{name:nh,link:url,url,webViewLink:url,id:path,driveStatus:'pending'};
          }catch(se){console.error('Storage fallback failed:',se);throw se;}
        };
        window.uploadToDrive._fallbackWrapped=true;
      }
    },2000);
    return _br;
  };
}
boot();

routes.myMonth = () => go('dayreport');

