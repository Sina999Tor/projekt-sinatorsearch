export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'missing url param' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const r = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8'
            }
        });
        clearTimeout(timeout);

        const text = await r.text();
        return res.status(200).json({
            ok: r.ok,
            status: r.status,
            text: text.slice(0, 30000)
        });
    } catch (e) {
        return res.status(200).json({ ok: false, error: e.message || String(e) });
    }
}
