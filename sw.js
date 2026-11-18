// Doğal Kalem service worker: uygulamayı çevrimdışı çalıştırır.
// - Uygulama dosyaları: önce ağ, olmazsa önbellek (güncellemeler hemen gelir)
// - Sabit sürümlü CDN kütüphaneleri: önce önbellek (sürüm değişmez)
// - api.anthropic.com: asla önbelleğe alınmaz
const CACHE = 'dogal-kalem-v1';
const APP = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.anthropic.com') return;

  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))));
  }
});
