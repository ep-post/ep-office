// M3-SAGE Shared App Logic
// Firebase Auth · IndexedDB · Offline Sync
// Empower People | Gaya, Bihar

'use strict';

// ── STATE ──────────────────────────────────────────
let _firebaseApp  = null;
let _auth         = null;
let _firestore    = null;
let _currentUser  = null;
let _dbConn       = null;

const DB_NAME  = 'm3sage-db';
const DB_VER   = 1;
const STORE    = 'submissions';

// ── FIREBASE INIT ──────────────────────────────────
function _initFirebase() {
  if (_firebaseApp) return;
  _firebaseApp = firebase.initializeApp(firebaseConfig);
  _auth        = firebase.auth();
  _firestore   = firebase.firestore();
}

// ── AUTH ───────────────────────────────────────────
/**
 * Call on every protected page.
 * onAuthorized(user)   — user is in allowlist
 * onUnauthorized(code) — 'not-signed-in' | 'not-allowed' | 'config-error'
 */
function initAuth(onAuthorized, onUnauthorized) {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY') {
    onUnauthorized('config-error');
    return;
  }
  _initFirebase();
  _auth.onAuthStateChanged(async user => {
    if (!user) { onUnauthorized('not-signed-in'); return; }
    try {
      const doc = await _firestore.collection('allowlist').doc(user.email).get();
      if (doc.exists) {
        _currentUser = user;
        onAuthorized(user);
      } else {
        await _auth.signOut();
        onUnauthorized('not-allowed');
      }
    } catch (e) {
      console.error('Allowlist check failed:', e);
      // Fail open in case of Firestore connectivity issue (offline) if user was previously signed in
      _currentUser = user;
      onAuthorized(user);
    }
  });
}

function signInWithGoogle() {
  _initFirebase();
  if (!_auth) _auth = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();
  return _auth.signInWithPopup(provider);
}

function appSignOut() {
  if (_auth) return _auth.signOut().then(() => { window.location.href = 'index.html'; });
  window.location.href = 'index.html';
}

function getCurrentUser() { return _currentUser; }

// ── INDEXEDDB ─────────────────────────────────────
function _openDB() {
  if (_dbConn) return Promise.resolve(_dbConn);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('status',    'status',    { unique: false });
        s.createIndex('formType',  'formType',  { unique: false });
        s.createIndex('submitted', 'submittedAt', { unique: false });
      }
    };
    req.onsuccess = e => { _dbConn = e.target.result; resolve(_dbConn); };
    req.onerror   = () => reject(req.error);
  });
}

function _generateId(formType) {
  const map = { household: 'HH', village: 'VG', kiifgd: 'KF', survivor: 'SA' };
  const prefix = map[formType] || 'XX';
  if (formType === 'survivor') {
    // No date in survivor ID for extra anonymity
    return 'M3-SA-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  }
  const d    = new Date();
  const date = d.getFullYear().toString() +
               String(d.getMonth()+1).padStart(2,'0') +
               String(d.getDate()).padStart(2,'0');
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `M3-${prefix}-${date}-${rand}`;
}

/** Save a completed form submission. Returns the submission ID. */
async function saveSubmission(formType, data) {
  const idb = await _openDB();
  const user = _currentUser;
  const sub  = {
    id:              _generateId(formType),
    formType,
    enumeratorEmail: user ? user.email        : '',
    enumeratorName:  user ? user.displayName  : '',
    submittedAt:     new Date().toISOString(),
    data,
    status:          'pending',
    syncAttempts:    0,
    syncedAt:        null
  };
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(sub);
    req.onsuccess = () => {
      syncAll().catch(console.error); // attempt immediately
      resolve(sub.id);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Returns count of pending (unsynced) submissions. */
async function getPendingCount() {
  const idb = await _openDB();
  return new Promise(resolve => {
    const req = idb.transaction(STORE, 'readonly')
                   .objectStore(STORE)
                   .index('status')
                   .count(IDBKeyRange.only('pending'));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(0);
  });
}

/** Returns all submissions, newest first. */
async function getAllSubmissions() {
  const idb = await _openDB();
  return new Promise(resolve => {
    const req = idb.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a,b) => b.submittedAt.localeCompare(a.submittedAt)));
    req.onerror   = () => resolve([]);
  });
}

async function _updateStatus(id, status, syncedAt) {
  const idb = await _openDB();
  return new Promise((resolve, reject) => {
    const tx       = idb.transaction(STORE, 'readwrite');
    const getReq   = tx.objectStore(STORE).get(id);
    getReq.onsuccess = () => {
      const sub = getReq.result;
      if (!sub) { resolve(); return; }
      sub.status       = status;
      sub.syncedAt     = syncedAt;
      sub.syncAttempts = (sub.syncAttempts || 0) + 1;
      const putReq     = tx.objectStore(STORE).put(sub);
      putReq.onsuccess = resolve;
      putReq.onerror   = () => reject(putReq.error);
    };
  });
}

/** Attempt to sync all pending submissions to Apps Script. */
async function syncAll() {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL') return { synced: 0, failed: 0 };

  const idb     = await _openDB();
  const pending = await new Promise(resolve => {
    const req = idb.transaction(STORE, 'readonly')
                   .objectStore(STORE)
                   .index('status')
                   .getAll(IDBKeyRange.only('pending'));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => resolve([]);
  });

  let synced = 0, failed = 0;
  for (const sub of pending) {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' }, // avoid CORS preflight
        body:    JSON.stringify({ secret: SYNC_SECRET, ...sub })
      });
      if (res.ok) {
        await _updateStatus(sub.id, 'synced', new Date().toISOString());
        synced++;
      } else {
        failed++;
      }
    } catch (_) {
      failed++;
    }
  }
  return { synced, failed };
}

// ── UI HELPERS ─────────────────────────────────────
/** Update the sync badge element (id="syncBadge") if present. */
async function refreshSyncBadge() {
  const el = document.getElementById('syncBadge');
  if (!el) return;
  const n = await getPendingCount();
  if (n > 0) {
    el.textContent = `${n} बाकी`;
    el.className   = 'sync-badge pending';
  } else {
    el.textContent = '✓ सिंक';
    el.className   = 'sync-badge synced';
  }
}

// Auto-sync when connection restored
window.addEventListener('online',  async () => { await syncAll(); refreshSyncBadge(); document.body.classList.remove('offline'); });
window.addEventListener('offline', () => { document.body.classList.add('offline'); });
if (!navigator.onLine) document.body.classList.add('offline');

// ── SERVICE WORKER REGISTRATION ────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

// ── FORM UTILITIES ─────────────────────────────────
/** Collect all named form fields into a flat object.
 *  Checkboxes (multi-select) become arrays. */
function collectFormData(formEl) {
  const data = {};
  const els  = formEl.querySelectorAll('[name]');
  els.forEach(el => {
    const name = el.name;
    if (!name) return;
    if (el.type === 'checkbox') {
      if (!data[name]) data[name] = [];
      if (el.checked) data[name].push(el.value);
    } else if (el.type === 'radio') {
      if (el.checked) data[name] = el.value;
    } else {
      if (el.value.trim()) data[name] = el.value.trim();
    }
  });
  return data;
}

/** Format a submission date for display. */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('hi-IN', { day: '2-digit', month: 'short', year: 'numeric',
                                          hour: '2-digit', minute: '2-digit' });
}

/** Form type labels */
const FORM_LABELS = {
  household: 'परिवार सर्वेक्षण',
  village:   'ग्राम प्रोफाइल',
  kiifgd:    'KII / FGD / बाजार',
  survivor:  'गोपनीय परामर्श'
};
