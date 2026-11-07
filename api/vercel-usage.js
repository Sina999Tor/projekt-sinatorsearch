// Vercel serverless funkce: spotřeba účtu z Vercel Billing API (/v1/billing/charges, formát FOCUS, JSONL).
// Nastav na Vercelu (Project → Settings → Environment Variables):
//   VERCEL_TOKEN      (povinné)  token z https://vercel.com/account/tokens
//   VERCEL_TEAM_ID    (volitelné) teamId, pokud jde o tým (team_...)
//   VERCEL_TEAM_SLUG  (volitelné) slug týmu, např. "sinator"
const ADMIN2_HASH = '047a9a6cf044ed6a2881675f4ab69a8db3c3fb40dbbeb6d48af89ce6eca5d769';
let cache = null, cacheAt = 0;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-hash, content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.headers['x-admin-hash'] !== ADMIN2_HASH) return res.status(401).json({ error: 'Nepovolený přístup (jen Admin level 2)' });
  const token = process.env.VERCEL_TOKEN;
  if (!token) return res.status(500).json({ error: 'Na serveru chybí proměnná VERCEL_TOKEN' });
  if (cache && Date.now() - cacheAt < 60000) return res.status(200).json({ ...cache, cached: true });

  try {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (process.env.VERCEL_TEAM_ID) q.set('teamId', process.env.VERCEL_TEAM_ID);
    if (process.env.VERCEL_TEAM_SLUG) q.set('slug', process.env.VERCEL_TEAM_SLUG);
    const r = await fetch('https://api.vercel.com/v1/billing/charges?' + q, { headers: { Authorization: 'Bearer ' + token } });
    const text = await r.text();
    if (!r.ok) {
      // Hobby účet nemá billing data (404 "Costs not found") -> záloha: statistiky nasazení
      const hdr = { Authorization: 'Bearer ' + token };
      const tq = new URLSearchParams({ limit: '100', since: String(from.getTime()) });
      if (process.env.VERCEL_TEAM_ID) tq.set('teamId', process.env.VERCEL_TEAM_ID);
      if (process.env.VERCEL_TEAM_SLUG) tq.set('slug', process.env.VERCEL_TEAM_SLUG);
      const dr = await fetch('https://api.vercel.com/v6/deployments?' + tq, { headers: hdr });
      const dj = await dr.json().catch(() => null);
      if (!dr.ok || !dj) {
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = (j.error && j.error.message) || msg; } catch (e) {}
        return res.status(502).json({ error: 'Vercel API ' + r.status + ': ' + msg });
      }
      const list = dj.deployments || [];
      const failed = list.filter(d => (d.state || d.readyState) === 'ERROR').length;
      const prod = list.filter(d => d.target === 'production').length;
      const projects = new Set(list.map(d => d.name)).size;
      const last = list[0];
      const services = [
        { name: 'Nasazení (buildy) tento měsíc' + (list.length >= 100 ? ' (max 100)' : ''), unit: '×', quantity: list.length, cost: 0 },
        { name: 'Produkční nasazení', unit: '×', quantity: prod, cost: 0 },
        { name: 'Neúspěšné buildy', unit: '×', quantity: failed, cost: 0 },
        { name: 'Aktivní projekty', unit: '', quantity: projects, cost: 0 }
      ].filter(x => x.quantity > 0);
      cache = { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), services, totalCost: 0,
        note: 'Hobby účet: Vercel přes API nevrací bandwidth ani počty volání funkcí — ty uvidíš jen přes „↗ Vercel Usage“.' +
          (last ? ' Poslední nasazení: ' + (last.name || '') + ' (' + (last.state || last.readyState || '?') + ', ' + new Date(last.created || last.createdAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC).' : '') };
      cacheAt = Date.now();
      return res.status(200).json(cache);
    }
    const map = {};
    let totalCost = 0;
    text.split('\n').forEach(line => {
      line = line.trim(); if (!line) return;
      let c; try { c = JSON.parse(line); } catch (e) { return; }
      const name = c.ServiceName || c.ChargeDescription || c.SkuId || 'Ostatní';
      const unit = c.ConsumedUnit || c.PricingUnit || '';
      const key = name + '|' + unit;
      const m = map[key] || (map[key] = { name, unit, quantity: 0, cost: 0 });
      m.quantity += Number(c.ConsumedQuantity) || 0;
      const cost = Number(c.EffectiveCost != null ? c.EffectiveCost : c.BilledCost) || 0;
      m.cost += cost; totalCost += cost;
    });
    const services = Object.values(map).filter(x => x.quantity > 0 || x.cost > 0).sort((a, b) => b.quantity - a.quantity);
    cache = { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), services, totalCost };
    cacheAt = Date.now();
    return res.status(200).json(cache);
  } catch (e) {
    return res.status(500).json({ error: 'Chyba funkce: ' + (e && e.message ? e.message : e) });
  }
};
