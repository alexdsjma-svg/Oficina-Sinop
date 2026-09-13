const CACHE = 'ajc-oficina-v13-jpg-real-2026-09-13';
const CORE = ['./','./index.html','./manifest.json','./ajc-banner-v13.jpg','./ajc-icon-v11.svg','./supabase-config.js','./cloud.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      const copy=res.clone(); caches.open(CACHE).then(cache=>cache.put('./index.html',copy)); return res;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy=res.clone(); caches.open(CACHE).then(cache=>cache.put(req,copy));
    }
    return res;
  })));
});