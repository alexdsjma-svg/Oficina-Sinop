const CACHE='ajc-oficina-v18-2-layout-v17-7-001';
const CORE=[
  './',
  './index.html',
  './manifest.webmanifest',
  './ajc-icon-192.png',
  './ajc-icon-512.png',
  './ajc-banner-v17-7.png',
  './ajc-install-art-v17-7.png'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    list.forEach(c=>c.postMessage({type:'AJC_VERSION',version:'18.2'}));
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        cache.put('./index.html',res.clone());
        return res;
      }catch(e){
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;
  event.respondWith((async()=>{
    try{
      const res=await fetch(req,{cache:'no-store'});
      if(res && res.ok){
        const cache=await caches.open(CACHE);
        cache.put(req,res.clone());
      }
      return res;
    }catch(e){
      return (await caches.match(req)) || Response.error();
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus' in c)return c.focus();}
    return clients.openWindow('./?v=18.2&layout=17.7&fresh=1');
  }));
});