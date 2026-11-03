// Vercel serverless funkce: /api/yt?handle=TotalfilmCz[&channel=UC...]
// Vrací JSON { items: [{id,title,published,desc}], via }.
// Zkouší postupně: RSS feed -> YouTube InnerTube (stránka Videa) -> HTML kanálu -> Piped -> Invidious.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const COOKIE = 'CONSENT=YES+1; SOCS=CAI';
const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function get(url, opts, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 8000);
  try { return await fetch(url, Object.assign({ signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'cs-CZ,cs;q=0.9', Cookie: COOKIE } }, opts || {})); }
  finally { clearTimeout(t); }
}

// "před 3 hodinami" / "3 hours ago" -> ISO (přibližně)
function relToIso(txt) {
  const t = String(txt || '').toLowerCase();
  const m = t.match(/(\d+)\s*([^\d\s]+)/); const n = m ? parseInt(m[1], 10) : 1;
  const u = m ? m[2] : t.replace(/před|ago|streamed|premiéra|premiered/g, '').trim();
  const mult = /^(sek|sec)/.test(u) ? 1e3 : /^(min)/.test(u) ? 6e4 : /^(hod|hour)/.test(u) ? 36e5 : /^(dn|den|day)/.test(u) ? 864e5 : /^(týd|tyd|week)/.test(u) ? 6048e5 : /^(měs|mes|month)/.test(u) ? 2592e6 : /^(rok|let|year)/.test(u) ? 31536e6 : 0;
  return mult ? new Date(Date.now() - n * mult).toISOString() : '';
}

function fromRss(xml) {
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => {
    const g = re => { const m = e.match(re); return m ? dec(m[1]) : ''; };
    return { id: g(/<yt:videoId>(.*?)<\/yt:videoId>/), title: g(/<title>([\s\S]*?)<\/title>/), published: g(/<published>(.*?)<\/published>/), desc: g(/<media:description>([\s\S]*?)<\/media:description>/).slice(0, 400) };
  }).filter(x => x.id);
}

// projde ytInitialData / InnerTube odpověď a vytáhne videa
function fromYtData(root) {
  const out = [], seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.videoId && o.title && (o.title.runs || o.title.simpleText) && !seen.has(o.videoId)) {
      seen.add(o.videoId);
      out.push({ id: o.videoId, title: (o.title.runs ? o.title.runs.map(r => r.text).join('') : o.title.simpleText) || '', published: relToIso(o.publishedTimeText && (o.publishedTimeText.simpleText || '')), desc: '' });
    } else if (o.contentId && o.metadata && o.metadata.lockupMetadataViewModel && /VIDEO/.test(o.contentType || '') && !seen.has(o.contentId)) {
      seen.add(o.contentId);
      let when = '';
      try { JSON.stringify(o.metadata.lockupMetadataViewModel.metadata).replace(/"content":"([^"]*)"/g, (_, c) => { if (!when && /před|ago/i.test(c)) when = c; }); } catch (e) {}
      out.push({ id: o.contentId, title: (o.metadata.lockupMetadataViewModel.title || {}).content || '', published: relToIso(when), desc: '' });
    }
    for (const k in o) walk(o[k]);
  })(root);
  return out.filter(x => /^[\w-]{11}$/.test(x.id) && x.title);
}

async function resolveId(handle) {
  const r = await get('https://www.youtube.com/@' + handle);
  const html = await r.text();
  const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error('ID kanálu nenalezeno (HTTP ' + r.status + ')');
  return m[1];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  const handle = String(q.handle || 'TotalfilmCz').replace(/^@/, '').replace(/[^\w.\-]/g, '');
  let id = /^UC[\w-]{22}$/.test(q.channel || '') ? q.channel : '';
  const errs = [];
  const done = (items, via) => {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ channel: id, via, items: items.slice(0, 20) });
  };
  try { if (!id) id = await resolveId(handle); } catch (e) { errs.push('id: ' + e.message); }

  if (id) {
    // A) RSS feed
    try { const r = await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + id); if (r.ok) { const it = fromRss(await r.text()); if (it.length) return done(it, 'rss'); errs.push('rss: prázdné'); } else errs.push('rss: HTTP ' + r.status); } catch (e) { errs.push('rss: ' + e.message); }
    // B) InnerTube (záložka Videa)
    try {
      const r = await get('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Cookie: COOKIE, Origin: 'https://www.youtube.com' }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'cs', gl: 'CZ' } }, browseId: id, params: 'EgZ2aWRlb3PyBgQKAjoA' }) });
      if (r.ok) { const it = fromYtData(await r.json()); if (it.length) return done(it, 'innertube'); errs.push('innertube: prázdné'); } else errs.push('innertube: HTTP ' + r.status);
    } catch (e) { errs.push('innertube: ' + e.message); }
    // C) HTML stránky Videa (ytInitialData)
    try {
      const r = await get('https://www.youtube.com/channel/' + id + '/videos?hl=cs');
      const html = await r.text();
      const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
      if (m) { const it = fromYtData(JSON.parse(m[1])); if (it.length) return done(it, 'html'); errs.push('html: prázdné'); } else errs.push('html: HTTP ' + r.status + ' bez dat');
    } catch (e) { errs.push('html: ' + e.message); }
    // D) Piped
    for (const base of ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee']) {
      try {
        const r = await get(base + '/channel/' + id, null, 7000);
        if (!r.ok) { errs.push('piped: HTTP ' + r.status); continue; }
        const j = await r.json();
        const it = (j.relatedStreams || []).map(x => ({ id: String(x.url || '').replace(/^.*v=/, '').slice(0, 11), title: x.title || '', published: x.uploaded > 0 ? new Date(x.uploaded).toISOString() : '', desc: '' })).filter(x => /^[\w-]{11}$/.test(x.id));
        if (it.length) return done(it, 'piped');
      } catch (e) { errs.push('piped: ' + e.message); }
    }
    // E) Invidious
    for (const base of ['https://yewtu.be', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de']) {
      try {
        const r = await get(base + '/api/v1/channels/' + id + '/latest', null, 7000);
        if (!r.ok) { errs.push('invidious: HTTP ' + r.status); continue; }
        const j = await r.json();
        const it = (Array.isArray(j) ? j : (j.videos || [])).map(x => ({ id: x.videoId || '', title: x.title || '', published: x.published ? new Date(x.published * 1000).toISOString() : '', desc: '' })).filter(x => /^[\w-]{11}$/.test(x.id));
        if (it.length) return done(it, 'invidious');
      } catch (e) { errs.push('invidious: ' + e.message); }
    }
  }
  return res.status(502).json({ error: [...new Set(errs)].join(', ').slice(0, 300) || 'nic se nepodařilo načíst' });
};
