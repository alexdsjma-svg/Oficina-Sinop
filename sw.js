const CACHE='ajc-oficina-v18-7-3-shared-realtime-20261031';
const APP='./v18.7.3.html?v=shared-realtime-20261031';
const CORE=['./manifest.webmanifest','./ajc-icon-192.png','./ajc-icon-512.png','./apple-touch-icon.png','./v18.7.3.html'];
self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'){
    e.respondWith(
      fetch(req,{cache:'no-store'})
        .then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp));}return res;})
        .catch(()=>caches.match(req).then(r=>r||caches.match('./v18.7.3.html').then(x=>x||Response.redirect(APP))))
    );
    return;
  }
  if(url.origin===self.location.origin){
    e.respondWith(
      fetch(req,{cache:'no-store'})
        .then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp));}return res;})
        .catch(()=>caches.match(req))
    );
  }
});
