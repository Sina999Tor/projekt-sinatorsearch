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
 * V zařízení zůstává i PŘEDCHOZÍ verze (index.prev.html v cache). Díky tomu jde vrátit starší verzi bez serveru:
 * APPLY_UPDATE s verzí, která je uložená jako předchozí, obě verze jen prohodí.
 *
 * Ostatní požadavky (obrázky, API, Firebase…) service worker nijak nemění – jdou přímo na síť.
 */
const CACHE = 'sinator-shell-v1';
const KEY = '/index.html';
const PREV = '/index.prev.html';
const NO_CACHE_PARAMS = ['_vchk', '_sw', '_v', '_boot', '_chk'];
const VER_RX = /<meta[^>]+name=["']sinator-version["'][^>]+content=["']([^"']+)["']/i;

function verOf(text) { const m = text.match(VER_RX); return m ? m[1] : null; }

async function store(cache, key, text) {
  const version = verOf(text);
  await cache.put(key, new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-sin-version': version || '' } }));
  return version;
}

// Verze uložené kopie (z hlavičky; u starších záznamů bez hlavičky se zjistí z obsahu a doplní)
async function readVersion(cache, key) {
  const r = await cache.match(key);
  if (!r) return null;
  const h = r.headers.get('x-sin-version');
  if (h) return h;
  try {
    const text = await r.text();
    return await store(cache, key, text);
  } catch (e) { return null; }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // První instalace: uložit aktuálně nasazenou verzi. Když už v paměti nějaká je, nechá se (nepřepisuje se bez pokynu).
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    if (await c.match(KEY)) return;
    try {
      const r = await fetch(KEY + '?_sw=' + Date.now(), { cache: 'no-store' });
      if (r.ok) await store(c, KEY, await r.text());
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
      if (r.ok) { const text = await r.clone().text(); store(c, KEY, text); }
      return r;
    } catch (e) {
      return fetch(event.request);
    }
  })());
});

// Pokyn z appky: nainstalovat verzi `expected`.
//  1) je-li uložená jako předchozí → vrácení (obě verze se prohodí, bez sítě)
//  2) jinak se stáhne ze serveru; musí tam být právě `expected` (ochrana před neotestovanou verzí)
async function applyUpdate(expected) {
  const c = await caches.open(CACHE);
  if (expected) {
    const pv = await readVersion(c, PREV);
    if (pv && pv === expected) {
      const cur = await c.match(KEY), prev = await c.match(PREV);
      if (prev) {
        await c.put(KEY, prev.clone());
        if (cur) await c.put(PREV, cur.clone());
        return { ok: true, version: expected, rollback: true };
      }
    }
  }
  const r = await fetch(KEY + '?_sw=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
  const text = await r.text();
  const version = verOf(text);
  if (expected && version !== expected) return { ok: false, reason: 'version-mismatch', version };
  const curVer = await readVersion(c, KEY);
  if (curVer !== version) {
    const cur = await c.match(KEY);
    if (cur) await c.put(PREV, cur.clone());   // dosavadní verze se schová jako předchozí
  }
  await store(c, KEY, text);
  return { ok: true, version };
}

async function info() {
  const c = await caches.open(CACHE);
  return { ok: true, current: await readVersion(c, KEY), prev: await readVersion(c, PREV) };
}

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type !== 'APPLY_UPDATE' && d.type !== 'GET_INFO') return;
  const port = event.ports && event.ports[0];
  const job = d.type === 'GET_INFO' ? info() : applyUpdate(d.expected || null);
  event.waitUntil(
    job
      .then((res) => { if (port) port.postMessage(res); })
      .catch((err) => { if (port) port.postMessage({ ok: false, reason: String(err) }); })
  );
});
