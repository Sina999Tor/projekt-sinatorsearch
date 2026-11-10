// Soubor: api/geo.js
// Vrací stát, ze kterého přichází požadavek (podle IP, údaj doplňuje Vercel). Žádná třetí strana, nic se neukládá.
export default function handler(req, res) {
  const c = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).end(JSON.stringify({ c: /^[A-Z]{2}$/.test(c) ? c : '' }));
}
