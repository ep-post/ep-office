// M3-SAGE Service Worker
// Cache-first for static assets · Offline queue via IndexedDB in app.js

const CACHE = 'm3sage-v1';

const STATIC = [
  '/',
  '/index.html',
  '/form-household.html',
  '/form-village.html',
  '/form-kii-fgd.html',
  '/form-survivor.html',
  '/style.css',
  '/app.js',
  '/firebase-config.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Network-only: Apps Script sync and Firebase API calls
  if (url.includes('script.googleusercontent') ||
      url.includes('script.google.com') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('identitytoolkit') ||
      url.includes('securetoken')) {
    return; // let the browser handle it
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // If offline and not in cache, return a simple offline message for HTML
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
