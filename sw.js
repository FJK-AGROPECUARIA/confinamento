const CACHE='confinamento-v50';
const RUNTIME='confinamento-runtime-v1';
const FILES=['./','./index.html','./manifest.json','./icone-192.png','./icone-512.png','./gestao.js','./automacao.js'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'})))));self.skipWaiting();});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('confinamento-')&&x!==CACHE&&x!==RUNTIME).map(x=>caches.delete(x)))));
  self.clients.claim();
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  // Leitor de foto (biblioteca e dados): guarda depois do primeiro uso com internet
  if(url.hostname==='cdn.jsdelivr.net'||url.hostname.endsWith('projectnaptha.com')){
    e.respondWith(caches.open(RUNTIME).then(c=>c.match(req).then(r=>r||fetch(req).then(res=>{if(res.ok||res.type==='opaque')c.put(req,res.clone());return res;}))));
    return;
  }

  if(url.origin!==location.origin)return; // Google Script (nuvem) vai direto, sem cache

  // App: sempre tenta a versão mais nova da internet; sem sinal, usa a guardada
  const novo=new Request(req.url,{cache:'no-cache',credentials:'same-origin'});
  e.respondWith(fetch(novo).then(res=>{
    if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp));}
    return res;
  }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
