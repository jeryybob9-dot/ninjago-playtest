'use strict';

// Offline support for the playtest tracker. The app shell is cached per version (tools/playtest_pages.py stamps the
// version from the shell's contents on every publish); the data is always fetched fresh, and its last good copy is
// served, marked x-pt-cache: 1, only when the network fails.
const VERSION = 'f5463d1ae022';
const SHELL = `shell-${VERSION}`;
const DATA = 'data';
const SHELL_FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    const key = url.origin + url.pathname;
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(() => caches.open(DATA).then((c) => c.match(key)).then((hit) => {
      if (!hit) throw new Error('offline and no saved copy');
      const headers = new Headers(hit.headers);
      headers.set('x-pt-cache', '1');
      return hit.blob().then((body) => new Response(body, { status: 200, headers }));
    })));
    return;
  }

  // the shell: network first (so a publish shows up at once), the cached copy offline
  event.respondWith(fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))));
});
