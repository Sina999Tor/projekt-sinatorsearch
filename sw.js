// Sinator Search — Service Worker
// Statický soubor (dřív se generoval za běhu jako blob: URL, což dělalo
// z appky nespolehlivou PWA — Android/Chrome si po instalaci periodicky
// (a hlavně po restartu telefonu) ověřuje manifest.json a tenhle soubor
// přes skutečnou síťovou adresu; blob: URL zvenku vůbec nejde natáhnout,
// takže appka po čase zmizela z plochy. Teď je to reálný soubor na serveru.
const CACHE_VERSION = 'sinator-v1';

self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // Network-first pro HTML (vždy aktuální verze), cache-first pro ostatní
    if (e.request.mode === 'navigate' || e.request.destination === 'document') {
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
        return;
    }
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
