// Sdílený pomocník pro vydávání a ověřování Bearer tokenu.
// Soubor začíná podtržítkem, takže ho Vercel nenasadí jako vlastní
// endpoint (/api/_auth by nefungovalo) — ostatní funkce v /api si ho
// jen importují jako obyčejný modul.
//
// Token je bezstavový (stateless): není nikde uložen na serveru,
// jen podepsán tajným klíčem s expirací. Kdokoliv se serverovým
// tajným klíčem (AUTH_TOKEN_SECRET) ho dokáže znovu spočítat a ověřit
// jeho platnost i podpis, aniž by bylo potřeba cokoliv číst z databáze.

import crypto from 'crypto';

// Ideálně vlastní proměnná prostředí AUTH_TOKEN_SECRET (Vercel → Project
// Settings → Environment Variables). Pokud ji nenastavíš, použije se
// jako fallback APP_PASSWORD, aby appka fungovala i bez dalšího kroku —
// ale doporučuju mít pro podepisování tokenů samostatný, nezávislý secret.
const SECRET = process.env.AUTH_TOKEN_SECRET || process.env.APP_PASSWORD;

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // token platí 12 hodin od vydání

function sign(payload) {
    return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

// Vytvoří nový podepsaný token. Volá se pouze z api/login.js po úspěšném
// ověření hesla.
export function issueToken() {
    const expires = Date.now() + TOKEN_TTL_MS;
    const payload = String(expires);
    return `${payload}.${sign(payload)}`;
}

// Ověří token: musí mít platný formát, nesmí být prošlý a podpis musí
// sedět (porovnání konstantní dobou, ochrana proti timing útoku).
export function verifyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.lastIndexOf('.');
    if (dot === -1) return false;

    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expires = Number(payload);
    if (!Number.isFinite(expires) || Date.now() > expires) return false;

    const expectedSig = sign(payload);
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// Pomocník pro chráněné endpointy. Použití na začátku handleru:
//   import { requireAuth } from './_auth.js';
//   export default function handler(req, res) {
//       if (!requireAuth(req, res)) return; // requireAuth už sama poslala 401
//       ... zbytek chráněné logiky ...
//   }
export function requireAuth(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!verifyToken(token)) {
        res.status(401).json({ success: false, error: 'Neautorizovaný přístup — přihlas se prosím znovu.' });
        return false;
    }
    return true;
}
