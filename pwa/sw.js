const CACHE='chv-remote-pwa-v2.5.0';
const STATIC=['./','./index.html','./app.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-180.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.endsWith('/relay.json')){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));return}
  e.respondWith(fetch(e.request).then(resp=>{
    if(e.request.method==='GET'&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return resp;
  }).catch(()=>caches.match(e.request)));
});
