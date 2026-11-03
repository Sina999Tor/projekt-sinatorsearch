// Vercel serverless funkce: /api/yt?handle=TotalfilmCz[&channel=UC...]
// Stáhne RSS feed YouTube kanálu na serveru (bez CORS problémů) a vrátí JSON { items: [...] }
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const q = req.query || {};
    const handle = String(q.handle || 'TotalfilmCz').replace(/^@/, '').replace(/[^\w.\-]/g, '');
    let id = /^UC[\w-]{22}$/.test(q.channel || '') ? q.channel : '';
    const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    if (!id) {
      const r = await fetch('https://www.youtube.com/@' + handle, { headers: { 'User-Agent': UA, 'Accept-Language': 'cs-CZ,cs;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
      const html = await r.text();
      const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/);
      if (!m) return res.status(502).json({ error: 'channel id not found' });
      id = m[1];
    }
    const fr = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: { 'User-Agent': UA } });
    if (!fr.ok) return res.status(502).json({ error: 'feed HTTP ' + fr.status });
    const xml = await fr.text();
    const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const items = (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => {
      const g = re => { const m = e.match(re); return m ? dec(m[1]) : ''; };
      return { id: g(/<yt:videoId>(.*?)<\/yt:videoId>/), title: g(/<title>([\s\S]*?)<\/title>/), published: g(/<published>(.*?)<\/published>/), desc: g(/<media:description>([\s\S]*?)<\/media:description>/).slice(0, 400) };
    }).filter(x => x.id);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ channel: id, items });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
