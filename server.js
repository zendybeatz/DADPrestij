'use strict';
// DAD Prestij Bungalov: rezervasyon sunucusu. Bağımlılık yok, Node 18 ve üstü yeter.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env dosyasını oku (varsa)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* .env yok */ }

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const BILDIRIM_NO = (process.env.BILDIRIM_TELEFON || '905016186592').replace(/\D/g, '');
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY || '';
const BUNGALOV_SAYISI = Number(process.env.BUNGALOV_SAYISI) || 3;
const MAX_KISI = Number(process.env.MAX_KISI) || 4;
const GECELIK_FIYAT = Number(process.env.GECELIK_FIYAT) || 9000;
const tl = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₺';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rezervasyonlar.json');
const PUBLIC = path.join(__dirname, 'public');

if (ADMIN_PASSWORD.length < 8) {
  console.error('HATA: .env dosyasında en az 8 karakterlik ADMIN_PASSWORD tanımlayın.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- depolama ---------- */
function oku() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return []; }
}
function yaz(list) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- tarih yardımcıları (YYYY-MM-DD) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const gece = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
function trBugun() {
  // Türkiye saati (UTC+3, yaz/kış saati yok)
  const d = new Date(Date.now() + 3 * 3600e3);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const tarihOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
const aktif = (r) => r.s !== 'iptal';
function cakisir(list, b, a, z, haricId) {
  return list.some((r) => aktif(r) && r.b === b && r.id !== haricId && a < r.out && z > r.in);
}

/* ---------- WhatsApp bildirimi (CallMeBot) ---------- */
async function bildir(r) {
  const n = gece(r.in, r.out);
  const text = [
    'Yeni rezervasyon talebi',
    'Bungalov: ' + r.b,
    'Giriş: ' + r.in,
    'Çıkış: ' + r.out + ' (' + n + ' gece)',
    'Toplam: ' + tl(r.toplam) + ' (gecelik ' + tl(GECELIK_FIYAT) + ')',
    'Kişi: ' + r.kisi,
    'Ad soyad: ' + r.ad,
    'Telefon: ' + r.tel,
    r.not ? 'Not: ' + r.not : null
  ].filter(Boolean).join('\n');
  if (!CALLMEBOT_APIKEY) {
    console.log('[BİLDİRİM, CALLMEBOT_APIKEY tanımlı değil, gönderilmedi]\n' + text);
    return false;
  }
  try {
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent('+' + BILDIRIM_NO) +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) console.error('WhatsApp bildirimi başarısız, durum:', res.status);
    return res.ok;
  } catch (e) {
    console.error('WhatsApp bildirimi gönderilemedi:', e.message);
    return false;
  }
}

/* ---------- yardımcılar ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function govde(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 10000) { reject(new Error('büyük')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function adminMi(req) {
  const k = String(req.headers['x-admin-key'] || '');
  const a = crypto.createHash('sha256').update(k).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
const denemeler = new Map();
function sinir(ip, anahtar, limit, ms) {
  const k = anahtar + '|' + ip, t = Date.now();
  const l = (denemeler.get(k) || []).filter((x) => t - x < ms);
  if (l.length >= limit) { denemeler.set(k, l); return false; }
  l.push(t); denemeler.set(k, l); return true;
}
const metin = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/* ---------- API ---------- */
async function api(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (req.method === 'GET' && url.pathname === '/api/doluluk') {
    // Herkese açık: yalnızca bungalov ve tarihler, kişisel bilgi yok
    const items = oku().filter(aktif).map((r) => ({ b: r.b, in: r.in, out: r.out }));
    return json(res, 200, { items });
  }

  if (req.method === 'POST' && url.pathname === '/api/rezervasyon') {
    if (!sinir(ip, 'rez', 6, 10 * 60e3)) return json(res, 429, { hata: 'Çok fazla deneme yaptınız. Biraz sonra tekrar deneyin.' });
    let g; try { g = await govde(req); } catch (e) { return json(res, 400, { hata: 'Geçersiz istek.' }); }
    const b = Number(g.b), a = g.in, z = g.out, kisi = Number(g.kisi);
    const ad = metin(g.ad, 80), tel = metin(g.tel, 30), not = metin(g.not, 500);
    if (!Number.isInteger(b) || b < 1 || b > BUNGALOV_SAYISI) return json(res, 400, { hata: 'Bungalov seçimi geçersiz.' });
    if (!tarihOk(a) || !tarihOk(z) || z <= a) return json(res, 400, { hata: 'Tarihler geçersiz.' });
    if (a < trBugun()) return json(res, 400, { hata: 'Geçmiş bir tarih seçilemez.' });
    if (gece(a, z) > 30) return json(res, 400, { hata: 'En fazla 30 gece rezervasyon yapılabilir.' });
    if (ad.length < 3) return json(res, 400, { hata: 'Ad soyad gerekli.' });
    if (tel.replace(/\D/g, '').length < 10) return json(res, 400, { hata: 'Telefon numarası eksik.' });
    if (!Number.isInteger(kisi) || kisi < 1 || kisi > MAX_KISI) return json(res, 400, { hata: 'Kişi sayısı geçersiz.' });
    const list = oku();
    if (cakisir(list, b, a, z)) return json(res, 409, { hata: 'Seçtiğiniz günlerden biri az önce doldu. Başka bir tarih seçin.' });
    const r = { id: 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), b, in: a, out: z, s: 'bekliyor', t: Date.now(), ad, tel, kisi, not, toplam: gece(a, z) * GECELIK_FIYAT };
    list.push(r); yaz(list);
    const gonderildi = await bildir(r);
    return json(res, 201, { ok: true, id: r.id, bildirim: gonderildi });
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!sinir(ip, 'adm', 40, 10 * 60e3)) return json(res, 429, { hata: 'Çok fazla deneme.' });
    if (!adminMi(req)) return json(res, 401, { hata: 'Şifre hatalı.' });

    if (req.method === 'GET' && url.pathname === '/api/admin/liste') return json(res, 200, { items: oku() });

    let g; try { g = await govde(req); } catch (e) { return json(res, 400, { hata: 'Geçersiz istek.' }); }

    if (req.method === 'POST' && url.pathname === '/api/admin/durum') {
      if (!['bekliyor', 'onaylandi', 'iptal'].includes(g.s)) return json(res, 400, { hata: 'Durum geçersiz.' });
      const list = oku(), r = list.find((x) => x.id === g.id);
      if (!r) return json(res, 404, { hata: 'Kayıt bulunamadı.' });
      if (g.s !== 'iptal' && r.s === 'iptal' && cakisir(list, r.b, r.in, r.out, r.id)) return json(res, 409, { hata: 'Bu günler başka bir rezervasyona verilmiş.' });
      r.s = g.s; yaz(list); return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/kapat') {
      const b = Number(g.b), a = g.in, z = g.out;
      if (!Number.isInteger(b) || b < 1 || b > BUNGALOV_SAYISI || !tarihOk(a) || !tarihOk(z) || z <= a) return json(res, 400, { hata: 'Bilgiler geçersiz.' });
      const list = oku();
      if (cakisir(list, b, a, z)) return json(res, 409, { hata: 'Bu aralıkta zaten dolu gece var.' });
      list.push({ id: 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), b, in: a, out: z, s: 'onaylandi', t: Date.now(), ad: metin(g.not, 80) || 'Elle kapatıldı', tel: '', kisi: 0, not: '', toplam: gece(a, z) * GECELIK_FIYAT });
      yaz(list); return json(res, 201, { ok: true });
    }
  }
  return json(res, 404, { hata: 'Bulunamadı.' });
}

/* ---------- statik dosyalar ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function statik(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUBLIC, p));
  if (!f.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sayfa bulunamadı'); }
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => { console.error(e); json(res, 500, { hata: 'Sunucu hatası.' }); });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    statik(req, res, url);
  } else { res.writeHead(405); res.end(); }
}).listen(PORT, () => {
  console.log('DAD Prestij Bungalov http://localhost:' + PORT);
  console.log(CALLMEBOT_APIKEY ? 'WhatsApp bildirimi: açık (' + BILDIRIM_NO + ')' : 'WhatsApp bildirimi: KAPALI (CALLMEBOT_APIKEY yok, mesajlar konsola yazılır)');
});
