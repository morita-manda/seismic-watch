// SEISMIC WATCH は公開終了しました。
// この Service Worker はキルスイッチです: 既存クライアントのキャッシュを
// 全削除して自身を登録解除し、定期チェックや通知は一切行いません。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
