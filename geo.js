/* ================= STATES AND DISTRICTS =================
   Empower People works in Haryana, Assam, Bihar and Delhi.
   Pick a state and the district list follows. "Other" is always available
   so nothing is blocked when work reaches a new place. */
const STATES = {
  Haryana: ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
  Assam: ["Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri", "West Karbi Anglong"],
  Bihar: ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran (Motihari)", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur (Bhabua)", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran (Chhapra)", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran (Bettiah)"],
  Delhi: ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
  "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Bareilly", "Ghaziabad", "Gorakhpur", "Kanpur Nagar", "Lucknow", "Mathura", "Meerut", "Moradabad", "Prayagraj", "Saharanpur", "Varanasi", "Other district"],
  "West Bengal": ["Alipurduar", "Cooch Behar", "Darjeeling", "Jalpaiguri", "Kolkata", "Malda", "Murshidabad", "Nadia", "North 24 Parganas", "South 24 Parganas", "Other district"],
  Jharkhand: ["Bokaro", "Dhanbad", "Dumka", "Giridih", "Gumla", "Hazaribagh", "Jamtara", "Pakur", "Ranchi", "Sahebganj", "Other district"],
  Punjab: ["Amritsar", "Bathinda", "Fazilka", "Jalandhar", "Ludhiana", "Patiala", "Sangrur", "Other district"],
  Rajasthan: ["Alwar", "Bharatpur", "Jaipur", "Jhunjhunu", "Jodhpur", "Sikar", "Other district"],
  Other: ["Other district"]
};
const STATE_LIST = Object.keys(STATES);
// Where the organisation actually works, shown first
const HOME_STATES = ["Haryana", "Assam", "Bihar", "Delhi"];
const orderedStates = () => [...HOME_STATES, ...STATE_LIST.filter(s => !HOME_STATES.includes(s))];
const districtsOf = s => STATES[s] || ["Other district"];

/** <select> markup for states */
function stateOptions(sel) {
  return orderedStates().map(s => `<option ${s === sel ? "selected" : ""}>${s}</option>`).join("");
}
/** <select> markup for districts of a state */
function districtOptions(state, sel) {
  return districtsOf(state).map(d => `<option ${d === sel ? "selected" : ""}>${d}</option>`).join("");
}
/** Wire a state <select> to its district <select> so the list follows. */
function linkStateDistrict(stateEl, districtEl, selectedDistrict) {
  if (!stateEl || !districtEl) return;
  const fill = keep => { const cur = keep ? districtEl.value : null;
    districtEl.innerHTML = districtOptions(stateEl.value, cur || selectedDistrict || "");
    if (cur && districtsOf(stateEl.value).includes(cur)) districtEl.value = cur; };
  fill(true);
  stateEl.addEventListener("change", () => fill(false));
}
/** Call after any screen renders: links every state/district pair by name. */
function autoLinkGeo(root) {
  (root || document).querySelectorAll('select[name="state"], select[data-geo="state"]').forEach(st => {
    const form = st.closest("form") || st.parentElement.parentElement;
    const di = form && (form.querySelector('select[name="district"]') || form.querySelector('select[data-geo="district"]'));
    if (di && !di.dataset.linked) { di.dataset.linked = "1"; linkStateDistrict(st, di, di.dataset.selected); }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  const obs = new MutationObserver(() => { clearTimeout(window.__geoT); window.__geoT = setTimeout(() => autoLinkGeo(), 60); });
  obs.observe(document.body, { childList: true, subtree: true });
});

/* ================= PUTTING A PLACE NAME RIGHT =================
   District names arrive misspelt — Mahendragrah for Mahendragarh, Yamuna Nagar for
   Yamunanagar — and a misspelling splits every count and every case ID. Rather than
   correcting each one by hand for ever, a typed name is matched against the official
   list for its state. */
const squash = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
/* How many single-letter changes turn one word into the other. */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
/* The official spelling, or null when nothing is close enough to be sure. */
function canonicalDistrict(stateName, typed) {
  const t = squash(typed);
  if (!t) return null;
  const lists = stateName && STATES[stateName] ? { [stateName]: STATES[stateName] } : STATES;
  let best = null, bestScore = 99;
  for (const [st, districts] of Object.entries(lists)) {
    for (const d of districts) {
      const c = squash(d);
      if (c === t) return d;                                  // already right
      // letters the same but jumbled — Mahendragrah / Mahendragarh
      const sameLetters = c.split("").sort().join("") === t.split("").sort().join("");
      const dist = editDistance(t, c);
      const allowed = c.length <= 6 ? 1 : c.length <= 10 ? 2 : 3;
      if (sameLetters || dist <= allowed) {
        if (dist < bestScore) { best = d; bestScore = dist; }
      }
    }
  }
  return best;
}
/* Returns { district, state, corrected } — leaves it alone when unsure. */
function fixPlace(state, district) {
  const right = canonicalDistrict(state, district);
  if (!right) return { district, state, corrected: false };
  let st = state;
  if (!st || !STATES[st] || !STATES[st].includes(right)) {
    st = Object.keys(STATES).find(s => STATES[s].includes(right)) || state;
  }
  return { district: right, state: st, corrected: right !== String(district || "").trim() || st !== state };
}
