const CACHE='ajc-oficina-v18-6-layout-v17-7-1';
const CORE=['./','./index.html','./manifest.webmanifest','./ajc-icon-192.png','./ajc-icon-512.png','./ajc-banner-v17-7.png','./ajc-install-art-v17-7.png','./mobile-v186.css','./realtime-v186.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return;const url=new URL(req.url);
 if(req.mode==='navigate'){
  e.respondWith(fetch(req,{cache:'no-store'}).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));return res}).catch(()=>caches.match('./index.html').then(r=>r||caches.match('./'))));return;
 }
 if(url.origin===self.location.origin)e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return res})));
});