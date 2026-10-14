/* Sinator – upozornění na nové epizody a dostupnost titulů na streamech.
 *
 * Samostatný service worker (neovlivňuje /sw.js). Appka do IndexedDB uloží "snímek"
 * (TMDB klíč, sledované seriály s poslední shlédnutou epizodou, watchlist) a tenhle worker:
 *   • při periodicsync (Chrome na Androidu, nainstalovaná PWA) nebo na pokyn appky (zpráva "check")
 *   • zeptá se TMDB na poslední vysílanou epizodu a na streamovací služby (watch/providers)
 *   • a když se něco změnilo oproti minulé kontrole, ukáže upozornění.
 * Při první kontrole se jen zapíše výchozí stav (aby appka nezahltila upozorněními na staré věci).
 */
const TMDB = 'https://api.themoviedb.org/3';
const DB = 'sinator-notify', STORE = 'kv';
const MAX_NOTIFS = 6;           // víc než tohle se sloučí do jednoho souhrnného upozornění
const FRESH_DAYS = 4;           // epizoda se oznámí jen když vyšla v posledních dnech

// ── úložiště (IndexedDB; v testech lze přepsat přes self.__kv) ───────────────
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  if (self.__kv) return self.__kv.get(k);
  const db = await openDb();
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function kvSet(k, v) {
  if (self.__kv) return self.__kv.set(k, v);
  const db = await openDb();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

async function tmdb(path, key, extra) {
  const r = await fetch(`${TMDB}${path}?api_key=${encodeURIComponent(key)}${extra || ''}`);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

async function check(opts) {
  opts = opts || {};
  const snap = await kvGet('snap');
  const out = { shows: 0, titles: 0, notified: 0, baseline: false, skipped: false };
  if (!snap || !snap.tmdb) { out.skipped = true; return out; }
  const state = (await kvGet('state')) || { shows: {}, titles: {} };
  const found = [];  // { tag, title, body }
  const region = snap.region || 'CZ';
  const want = (snap.providers || []).map(s => String(s).toLowerCase().trim()).filter(Boolean);

  // 1) Nové epizody sledovaných seriálů
  await pool((snap.shows || []).slice(0, 80), 5, async sh => {
    try {
      const d = await tmdb('/tv/' + sh.id, snap.tmdb, '&language=cs-CZ');
      const le = d.last_episode_to_air;
      if (!le) return;
      out.shows++;
      const key = (le.season_number || 0) * 1000 + (le.episode_number || 0);
      const prev = state.shows[sh.id];
      state.shows[sh.id] = Math.max(prev || 0, key);
      if (prev === undefined) { out.baseline = true; return; }
      if (key <= prev) return;
      const air = le.air_date ? new Date(le.air_date + 'T00:00:00').getTime() : 0;
      const seen = (sh.s || 0) * 1000 + (sh.e || 0);
      if (air && Date.now() - air < FRESH_DAYS * 864e5 && key > seen) {
        found.push({ tag: 'ep-' + sh.id + '-' + key, title: '📺 ' + (d.name || sh.name || 'Seriál') + ': nová epizoda',
          body: 'S' + le.season_number + 'E' + le.episode_number + (le.name ? ' — ' + le.name : '') });
      }
    } catch (e) {}
  });

  // 2) Tituly z watchlistu, které se objevily na streamovací službě
  await pool((snap.titles || []).slice(0, 120), 5, async t => {
    try {
      const type = t.type === 'tv' ? 'tv' : 'movie';
      const d = await tmdb('/' + type + '/' + t.id + '/watch/providers', snap.tmdb);
      const flat = ((d.results || {})[region] || {}).flatrate || [];
      let names = flat.map(p => p.provider_name);
      if (want.length) names = names.filter(n => want.some(w => n.toLowerCase().includes(w)));
      out.titles++;
      const k = type + t.id;
      const prev = state.titles[k];
      state.titles[k] = names;
      if (prev === undefined) { out.baseline = true; return; }
      const fresh = names.filter(n => !prev.includes(n));
      if (fresh.length) found.push({ tag: 'prov-' + k + '-' + fresh.join(','), title: '🎬 ' + (t.title || 'Titul') + ' je teď na streamu',
        body: fresh.join(', ') + ' — máš ho ve watchlistu' });
    } catch (e) {}
  });

  state.last = Date.now();
  await kvSet('state', state);

  // 3) Upozornění
  let list = found;
  if (list.length > MAX_NOTIFS) {
    list = list.slice(0, MAX_NOTIFS - 1);
    list.push({ tag: 'more-' + Date.now(), title: '🔔 Sinator: další novinky', body: '+' + (found.length - list.length) + ' dalších — otevři appku' });
  }
  for (const n of list) { await show(n); out.notified++; }
  return out;
}

function show(n) {
  return self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, icon: '/apple-touch-icon.png', badge: '/favicon.png', data: { url: '/' }
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('periodicsync', e => {
  if (e.tag === 'sinator-notify') e.waitUntil(check({ source: 'periodic' }).catch(() => {}));
});

self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'check') {
    const p = check({ source: 'app' }).catch(err => ({ error: String(err) }));
    e.waitUntil(p);
    p.then(r => { if (e.ports && e.ports[0]) e.ports[0].postMessage(r); });
  } else if (m.type === 'test') {
    e.waitUntil(show({ tag: 'test', title: '🔔 Sinator: upozornění fungují', body: 'Takhle budou vypadat upozornění na nové epizody a dostupné filmy.' }));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

if (typeof module !== 'undefined') module.exports = { check };
