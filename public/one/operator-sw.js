'use strict';

const cacheName = 'nuri-one-offline-v1';
const offlinePage = '/one/offline.html';

self.addEventListener('install', event => {
 event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  const page = await fetch(offlinePage, {cache:'reload', credentials:'omit', redirect:'error'});
  if (!page.ok) throw new Error('Offline page is unavailable.');
  await cache.put(offlinePage, page);
  await self.skipWaiting();
 })());
});

self.addEventListener('activate', event => {
 event.waitUntil((async () => {
  for (const name of await caches.keys()) {
   if (name.startsWith('nuri-one-offline-') && name !== cacheName) await caches.delete(name);
  }
  await self.clients.claim();
 })());
});

self.addEventListener('fetch', event => {
 const request = event.request;
 const target = new URL(request.url);
 if (request.method !== 'GET' || request.mode !== 'navigate' ||
     target.origin !== self.location.origin || target.pathname !== '/dashboard' || target.search) return;
 event.respondWith(fetch(request).catch(async () => {
  const cache = await caches.open(cacheName);
  return await cache.match(offlinePage) || Response.error();
 }));
});
