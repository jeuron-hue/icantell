// sw.js: keeps a copy of the app on the phone so it opens with no network.
// VERSION must match APP_VERSION in icantell.html. Bump both on every release.
'use strict';

const VERSION = '0.1.0';
const CACHE = 'icantell-' + VERSION;
const SHELL = [
  './',
  'icantell.html',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/source-sans-3-latin-400-normal.woff2',
  'vendor/source-sans-3-latin-600-normal.woff2',
  'vendor/jetbrains-mono-latin-400-normal.woff2',
];

// Fetch every file of this version up front. The new version then waits
// until the page asks it to take over (the "Update available" prompt).
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

// Drop copies left by older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('icantell-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Same-site files only: from the copy if there is one, else from the site.
// Anything else is left alone (and the page's Content-Security-Policy blocks it).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(request))
  );
});
