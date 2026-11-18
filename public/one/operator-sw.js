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
 const critical=message?.type==='sns-attention'&&/^[A-Za-z0-9_-]{1,80}$/.test(message.id||'');
 const digest=message?.type==='operator-digest'&&Number.isSafeInteger(message.attention)&&message.attention>=0&&message.attention<=30&&typeof message.activity==='boolean';
 if (!critical&&!digest&&message?.type!=='instagram-activity') return;
 const reasons={connection:'게시 계정을 다시 연결하세요.',delay:'예약 시각이 지났습니다.',result:'채널의 게시 결과를 확인하세요.'};
 event.waitUntil(self.registration.showNotification(digest?'누리원 아침 요약':'누리원 게시 활동',{
  body:critical?(reasons[message.reason]||'승인함에서 확인하세요.'):digest?
   [message.attention>0?'확인할 예약 '+message.attention+'건':'',message.activity?'Instagram 활동':''].filter(Boolean).join(' · '):
   'Instagram 승인함에 확인할 변경 사항이 있습니다.',
  icon:'/one/operator-icon-192.png',
  tag:critical?'nuri-one-sns-'+message.id:digest?'nuri-one-digest':'nuri-one-instagram',
  data:critical?{id:message.id}:undefined,
 }));
});

self.addEventListener('notificationclick', event => {
 const id=event.notification.data?.id;
 const critical=/^[A-Za-z0-9_-]{1,80}$/.test(id||'')&&event.notification.tag==='nuri-one-sns-'+id;
 const digest=event.notification.tag==='nuri-one-digest';
 if (!critical&&!digest&&event.notification.tag!=='nuri-one-instagram') return;
 event.notification.close();
 const approvalUrl=new URL(digest?'/dashboard#overview':'/dashboard#approval'+(critical?'/tistory/'+encodeURIComponent(id):''),self.location.origin);
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
