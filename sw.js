/* Sinator – service worker (statický soubor v kořeni webu vedle index.html; nahrazuje původní sw.js)
 *
 * Zůstává skutečný soubor na serveru (ne blob:), aby ho Android/Chrome mohl ověřovat a appka nezmizela z plochy.
 * Původní verze měla pro HTML „network-first“ (každá nahraná verze šla hned všem) – tahle drží verzi v zařízení,
 * dokud ji Admin level 2 neodešle.
 *
 * Appka (index.html) se uživatelům obsluhuje z paměti zařízení (cache-first), takže nová verze nahraná na Vercel
 * se k nim NEDOSTANE sama. Stáhne se až na pokyn appky (zpráva APPLY_UPDATE) – tedy když Admin level 2 verzi
 * odešle a uživatel klepne „Aktualizovat“ (nebo odložení dojde na řadu při příštím spuštění).
 *
 * Ostatní požadavky (obrázky, API, Firebase…) service worker nijak nemění – jdou přímo na síť.
 */
const CACHE = 'sinator-shell-v1';
const KEY = '/index.html';
const NO_CACHE_PARAMS = ['_vchk', '_sw', '_v', '_boot', '_chk'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // První instalace: uložit aktuálně nasazenou verzi. Když už v paměti nějaká je, nechá se (nepřepisuje se bez pokynu).
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    if (await c.match(KEY)) return;
    try {
      const r = await fetch(KEY + '?_sw=' + Date.now(), { cache: 'no-store' });
      if (r.ok) await c.put(KEY, r);
    } catch (e) { /* offline – uloží se při prvním načtení */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // starší cache (z původního sw.js) už nejsou potřeba
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isShellRequest(req) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname !== '/' && url.pathname !== '/index.html') return false;
  for (const p of NO_CACHE_PARAMS) if (url.searchParams.has(p)) return false;   // kontrola verze / nouzová aktualizace jdou na síť
  return req.mode === 'navigate' || req.destination === 'document' || req.destination === '';
}

self.addEventListener('fetch', (event) => {
  if (!isShellRequest(event.request)) return;
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(KEY);
    if (hit) return hit;
    // v paměti nic není (např. po smazání dat) → ze sítě a uložit
    try {
      const r = await fetch(KEY, { cache: 'no-store' });
      if (r.ok) c.put(KEY, r.clone());
      return r;
    } catch (e) {
      return fetch(event.request);
    }
  })());
});

// Pokyn z appky: stáhnout novou verzi do paměti zařízení. expected = verze, která musí být na serveru
// (ochrana, aby se uživatelům nedostala jiná, ještě neotestovaná verze).
async function applyUpdate(expected) {
  const r = await fetch(KEY + '?_sw=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
  const text = await r.text();
  const m = text.match(/<meta[^>]+name=["']sinator-version["'][^>]+content=["']([^"']+)["']/i);
  const version = m ? m[1] : null;
  if (expected && version !== expected) return { ok: false, reason: 'version-mismatch', version };
  const c = await caches.open(CACHE);
  await c.put(KEY, new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  return { ok: true, version };
}

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type !== 'APPLY_UPDATE') return;
  const port = event.ports && event.ports[0];
  event.waitUntil(
    applyUpdate(d.expected || null)
      .then((res) => { if (port) port.postMessage(res); })
      .catch((err) => { if (port) port.postMessage({ ok: false, reason: String(err) }); })
  );
});
