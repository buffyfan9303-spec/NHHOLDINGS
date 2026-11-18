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

self.addEventListener('push', event => {
 let message;
 try {message=event.data?.json();} catch {return;}
 if (message?.type!=='instagram-activity') return;
 event.waitUntil(self.registration.showNotification('누리원 게시 활동',{
  body:'Instagram 승인함에 확인할 변경 사항이 있습니다.',
  icon:'/one/operator-icon-192.png',
  tag:'nuri-one-instagram',
 }));
});

self.addEventListener('notificationclick', event => {
 if (event.notification.tag!=='nuri-one-instagram') return;
 event.notification.close();
 const approvalUrl=new URL('/dashboard#approval',self.location.origin);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const dashboard=windows.find(client=>{
   const url=new URL(client.url);
   return url.origin===approvalUrl.origin && url.pathname===approvalUrl.pathname;
  });
  if (dashboard) {await dashboard.focus();await dashboard.navigate(approvalUrl);}
  else await self.clients.openWindow(approvalUrl);
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
