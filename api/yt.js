// Vercel serverless funkce: nová videa z YouTube kanálu (RSS) → JSON.
// Použití: /api/yt?handle=TotalfilmCz   (nebo ?channel=UCxxxxxxxxxxxxxxxxxxxxxx)
// Pozn.: CommonJS. Když máš v package.json "type":"module", změň poslední řádek na "export default handler;".
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");

async function handler(req, res) {
  try {
    const q = req.query || {};
    const handle = String(q.handle || 'TotalfilmCz').replace(/^@/, '').replace(/[^\w.\-]/g, '');
    let id = /^UC[\w-]{22}$/.test(q.channel || '') ? q.channel : '';
    if (!id) {
      const r = await fetch(`https://www.youtube.com/@${handle}`, { headers: { 'user-agent': UA, 'accept-language': 'cs,en;q=0.8', cookie: 'CONSENT=YES+cb; SOCS=CAI' } });
      const html = await r.text();
      const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/);
      id = m && m[1];
    }
    if (!id) { res.status(404).json({ error: 'Kanál se nepodařilo dohledat' }); return; }
    const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: { 'user-agent': UA } })).text();
    const items = [];
    (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).forEach(e => {
      const g = re => { const m = e.match(re); return m ? dec(m[1]) : ''; };
      const vid = g(/<yt:videoId>(.*?)<\/yt:videoId>/);
      if (!vid) return;
      items.push({ id: vid, title: g(/<title>([\s\S]*?)<\/title>/), published: g(/<published>(.*?)<\/published>/), thumb: g(/<media:thumbnail url="(.*?)"/), desc: g(/<media:description>([\s\S]*?)<\/media:description>/).slice(0, 400) });
    });
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ channel: id, items });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
module.exports = handler;
