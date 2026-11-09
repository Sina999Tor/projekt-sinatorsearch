// api/admin-login.js
//
// Ověření admin hesla (level 1 a level 2) na serveru místo v klientském JS.
// Appka dřív porovnávala SHA-256 hash hesla přímo v prohlížeči proti hashi
// natvrdo zapsanému v index.html — ten šel přečíst "view-source" a offline
// zkoušet hashcatem bez jakéhokoli omezení. Teď appka posílá heslo sem,
// server ho porovná a teprve při shodě appce pošle zpět potřebný hash
// (ten, co appka pak posílá jako hlavičku x-admin-hash do api/vercel-usage
// apod.) — appka i útočník ho tak dostanou jen po uhodnutí správného hesla,
// a to přes tento endpoint, který lze omezit počtem pokusů.
//
// Potřebné proměnné prostředí (Vercel → Project Settings → Environment
// Variables), hodnoty = PŮVODNÍ hashe z index.html, beze změny:
//   ADMIN_HASH    = 781813bb37eab22353b8a69c29a5cac43df0e1efb8b3a112d2528a3c3b59f4d2
//   ADMIN_HASH_2  = 047a9a6cf044ed6a2881675f4ab69a8db3c3fb40dbbeb6d48af89ce6eca5d769
//
// (Hashe samotné teď nejsou tajemství, které chrání heslo — jsou to jen
// "tokeny", co appka posílá dál. Skutečné tajemství je HESLO, které zadáváš
// do appky, a to server nikde needitukládá, jen ho jednorázově spočítá.)

const crypto = require('crypto');

// Jednoduchý rate-limit v paměti funkce (resetuje se při studeném startu —
// pro vyšší odolnost lze později napojit na stejný Upstash Redis, co appka
// už používá pro cache). I takto to zastaví rychlé automatizované zkoušení.
const attempts = new Map(); // ip -> { count, firstAt }
const WINDOW_MS = 10 * 60 * 1000; // 10 minut
const MAX_ATTEMPTS = 8;

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();

  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now - rec.firstAt < WINDOW_MS) {
    if (rec.count >= MAX_ATTEMPTS) {
      res.status(429).json({ success: false, error: 'Příliš mnoho pokusů, zkus to později.' });
      return;
    }
    rec.count++;
  } else {
    attempts.set(ip, { count: 1, firstAt: now });
  }

  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) {
    res.status(400).json({ success: false, error: 'Chybí heslo.' });
    return;
  }

  const adminHash = process.env.ADMIN_HASH || '';
  const adminHash2 = process.env.ADMIN_HASH_2 || '';

  if (!adminHash && !adminHash2) {
    res.status(500).json({ success: false, error: 'Admin heslo není na serveru nastavené.' });
    return;
  }

  const candidateHash = sha256Hex(password);

  if (adminHash2 && timingSafeEqualHex(candidateHash, adminHash2)) {
    const okRec = attempts.get(ip); if (okRec) attempts.delete(ip);
    res.status(200).json({ success: true, level: 2, adminHash2: adminHash2 });
    return;
  }

  if (adminHash && timingSafeEqualHex(candidateHash, adminHash)) {
    const okRec = attempts.get(ip); if (okRec) attempts.delete(ip);
    res.status(200).json({ success: true, level: 1 });
    return;
  }

  res.status(401).json({ success: false, error: 'Nesprávné heslo.' });
};
