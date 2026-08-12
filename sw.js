/* Limoverse PWA service worker — app-shell cache + web push.
   Network-first for HTML/data so a new deploy is always picked up; cache-first
   only for immutable, content-hashed build assets. Bumping CACHE purges old. */
const CACHE = 'limoverse-v1';
const ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API / Supabase / third-party calls (must stay live).
  if (url.origin !== self.location.origin) return;

  // Navigation / HTML: network-first so new deploys load immediately.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }

  // Immutable hashed build assets: cache-first (content-addressed, safe).
  if (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })),
    );
    return;
  }

  // Everything else: network-first, fall back to cache only when offline.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});

// Web push: show the notification the server sent.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Limoverse', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

// Tapping a notification focuses or opens the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { try { c.navigate(target); } catch (_) { /* noop */ } return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
