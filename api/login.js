// Soubor: api/login.js
// Vercel serverless funkce — ověří heslo proti proměnné prostředí APP_PASSWORD.
// Heslo samotné se NIKDY neposílá klientovi ani nefiguruje v žádném souboru
// v repozitáři — žije jen na serveru (Vercel → Project Settings → Environment Variables).

import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Metoda nepovolena' });
  }

  const { password } = req.body || {};

  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ success: false, error: 'Chybí heslo' });
  }

  const correctPassword = process.env.APP_PASSWORD;

  if (!correctPassword) {
    // Proměnná prostředí není na Vercelu nastavená — appka by se v žádném
    // případě neměla tvářit jako odemčená.
    console.error('[login] APP_PASSWORD není nastavena v environment variables.');
    return res.status(500).json({ success: false, error: 'Server není nakonfigurován' });
  }

  // Porovnání konstantní dobou (ochrana proti timing útoku) — obě hodnoty
  // musí mít stejnou délku, jinak crypto.timingSafeEqual hodí výjimku.
  const a = Buffer.from(password);
  const b = Buffer.from(correctPassword);
  const isMatch = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!isMatch) {
    return res.status(401).json({ success: false, error: 'Nesprávné heslo' });
  }

  // Náhodný token pro tuto session (žádná perzistence na serveru není
  // potřeba — appka je jednouživatelská, token slouží jen jako lokální
  // "vstupenka" pro sessionStorage, ne jako plnohodnotná autentizace).
  const token = crypto.randomBytes(24).toString('hex');
  return res.status(200).json({ success: true, token });
}
