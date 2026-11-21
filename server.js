'use strict';
/**
 * SIMUTECH MOD - backend (zero npm dependencies; needs Node 22+).
 * Database: SQLite (node:sqlite). Passwords: scrypt. Sessions: random tokens (hashed in DB).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const IMG_DIR = path.join(DATA_DIR, 'uploads', 'img');
const PROOF_DIR = path.join(DATA_DIR, 'uploads', 'proofs');
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(PROOF_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'simutech.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id=1), password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', image TEXT DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  short_desc TEXT DEFAULT '', description TEXT DEFAULT '', features TEXT DEFAULT '', benefits TEXT DEFAULT '',
  how_to TEXT DEFAULT '', terms TEXT DEFAULT '', type TEXT NOT NULL DEFAULT 'free', price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TSh', image TEXT DEFAULT '', access_content TEXT DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, number TEXT NOT NULL, receiver TEXT NOT NULL,
  instructions TEXT DEFAULT '', amount TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), tool_id INTEGER NOT NULL REFERENCES tools(id),
  method_provider TEXT DEFAULT '', payer_name TEXT NOT NULL, payer_number TEXT NOT NULL, amount INTEGER NOT NULL,
  txn_id TEXT NOT NULL, proof_file TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', admin_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL, reviewed_at INTEGER);
CREATE TABLE IF NOT EXISTS access_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  expires_at INTEGER, redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, redeemed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_qa (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL);
`);

/* ---------- helpers ---------- */
const now = () => Date.now();
const clean = (v) => (v === undefined ? null : v);
const all = (sql, ...p) => db.prepare(sql).all(...p.map(clean));
const one = (sql, ...p) => db.prepare(sql).get(...p.map(clean));
const run = (sql, ...p) => db.prepare(sql).run(...p.map(clean));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m, s = 400) => { throw new HttpError(s, m); };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [v, saltHex, hashHex] = String(stored).split('$');
    if (v !== 's1') return false;
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    const exp = Buffer.from(hashHex, 'hex');
    return exp.length === hash.length && crypto.timingSafeEqual(hash, exp);
  } catch { return false; }
}

const DEFAULT_SETTINGS = {
  site_name: 'SIMUTECH MOD',
  tagline: 'Technology Tools and Programs',
  intro: 'Tools na programs za kiteknolojia mahali pamoja. Soma maelekezo, lipia kwa usalama, pata Access Code na uanze kutumia.',
  wa_number: process.env.WHATSAPP_ADMIN_NUMBER || '0632414199',
  wa_message: 'Habari Admin, nimefanya malipo ya program kupitia SIMUTECH MOD. Nimewasilisha uthibitisho wa muamala. Naomba unisaidie kupata Access Code ya program niliyochagua.',
  channel_url: '', channel_enabled: '0', channel_text: 'FOLLOW CHANNEL YETU YA WHATSAPP KWA TIPS ZAIDI',
  ai_enabled: '0', ai_instructions: 'Wewe ni msaidizi wa tovuti ya SIMUTECH MOD. Jibu kwa ufupi na kwa adabu.',
  ai_language: 'Kiswahili', ai_rules: '', ai_model: process.env.AI_MODEL || 'claude-sonnet-5-5',
  color_neon: '#39ff88', color_cyan: '#22d3ee', color_purple: '#a855f7', admin_session_minutes: '30',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);
const getSettings = () => Object.fromEntries(all('SELECT key,value FROM settings').map((r) => [r.key, r.value]));
const setting = (k) => (one('SELECT value FROM settings WHERE key=?', k) || {}).value || '';

if (!one('SELECT COUNT(*) c FROM categories').c) {
  const defs = [
    ['Android Tools', 'Zana za simu za Android'], ['Computer Tools', 'Programs za kompyuta'],
    ['Networking Tools', 'Zana za mitandao'], ['Cyber Security', 'Usalama wa mtandaoni'],
    ['Privacy & Protection', 'Faragha na ulinzi'], ['WhatsApp Tools', 'Zana za WhatsApp'],
    ['Website Tools', 'Zana za tovuti'], ['Developer Tools', 'Zana za wasanidi programu'],
    ['AI Programs', 'Programs za akili bandia (AI)'], ['Utility Tools', 'Zana za matumizi ya kila siku'],
  ];
  defs.forEach(([n, d], i) => run('INSERT INTO categories(name,description,sort_order) VALUES(?,?,?)', n, d, i));
}

// First-run admin password: env ADMIN_PASSWORD, otherwise a random one printed once.
if (!one('SELECT 1 x FROM admin')) {
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw || pw.length < 10) { pw = crypto.randomBytes(12).toString('base64url'); generated = true; }
  run('INSERT INTO admin(id,password_hash) VALUES(1,?)', hashPassword(pw));
  if (generated) {
    const f = path.join(DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt');
    fs.writeFileSync(f, pw + '\n', { mode: 0o600 });
    console.log('\n=== SIMUTECH MOD: admin password ya kwanza imetengenezwa ===');
    console.log('Password: ' + pw);
    console.log('(Pia imehifadhiwa kwenye ' + f + ' - ibadilishe kisha ufute faili hilo)\n');
  } else console.log('SIMUTECH MOD: admin password imewekwa kutoka ADMIN_PASSWORD.');
}

/* ---------- rate limiting ---------- */
const buckets = new Map();
function limit(key, max, windowMs, msg) {
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > max) bad(msg || 'Majaribio mengi sana. Subiri kidogo kisha ujaribu tena.', 429);
}
const hits = (key) => { const b = buckets.get(key); return b && b.reset > now() ? b.n : 0; };
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();

/* ---------- sessions ---------- */
const USER_TTL = 14 * 864e5, ADMIN_MAX = 12 * 36e5;
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) { return req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'); }
function cookie(req, name, value, maxAgeSec) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}
function startSession(req, res, kind, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(token_hash,kind,user_id,created_at,last_seen) VALUES(?,?,?,?,?)', sha(token), kind, userId || null, now(), now());
  const name = kind === 'admin' ? 'sm_admin' : 'sm_user';
  res.cookies.push(cookie(req, name, token, kind === 'admin' ? ADMIN_MAX / 1000 : USER_TTL / 1000));
}
function getSession(req, kind) {
  const token = parseCookies(req)[kind === 'admin' ? 'sm_admin' : 'sm_user'];
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token_hash=? AND kind=?', sha(token), kind);
  if (!s) return null;
  const t = now();
  const idle = kind === 'admin' ? Math.max(5, Number(setting('admin_session_minutes')) || 30) * 60000 : USER_TTL;
  const max = kind === 'admin' ? ADMIN_MAX : USER_TTL;
  if (t - s.last_seen > idle || t - s.created_at > max) { run('DELETE FROM sessions WHERE token_hash=?', s.token_hash); return null; }
  run('UPDATE sessions SET last_seen=? WHERE token_hash=?', t, s.token_hash);
  return s;
}
function endSession(req, res, kind) {
  const name = kind === 'admin' ? 'sm_admin' : 'sm_user';
  const token = parseCookies(req)[name];
  if (token) run('DELETE FROM sessions WHERE token_hash=?', sha(token));
  res.cookies.push(cookie(req, name, '', 0));
}
setInterval(() => run('DELETE FROM sessions WHERE last_seen<?', now() - USER_TTL), 3600000).unref();

/* ---------- validation / uploads ---------- */
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, d = 0) => { const n = Math.round(Number(String(v).replace(/[, ]/g, ''))); return Number.isFinite(n) ? n : d; };
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function decodeImage(dataUrl, maxBytes) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) bad('Faili si picha halali (PNG, JPG, WEBP au GIF).');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) bad('Picha ni kubwa mno.');
  const sig = buf.subarray(0, 12);
  let ext = null;
  if (sig[0] === 0x89 && sig[1] === 0x50) ext = 'png';
  else if (sig[0] === 0xff && sig[1] === 0xd8) ext = 'jpg';
  else if (sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP') ext = 'webp';
  else if (sig.subarray(0, 3).toString() === 'GIF') ext = 'gif';
  if (!ext) bad('Faili si picha halali.');
  return { buf, ext };
}
function saveImage(dir, dataUrl, maxBytes) {
  const { buf, ext } = decodeImage(dataUrl, maxBytes);
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

function waLink(message) {
  let n = setting('wa_number').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('0')) n = '255' + n.slice(1);
  else if (!n.startsWith('255')) n = '255' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

const hasAccess = (uid, tid) => !!(uid && one('SELECT 1 x FROM access_codes WHERE redeemed_by=? AND tool_id=? AND (expires_at IS NULL OR expires_at>?)', uid, tid, now()));
const TOOL_PUBLIC = `t.id,t.name,t.category_id,c.name AS category,t.short_desc,t.type,t.price,t.currency,t.image`;
const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone });
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => A[b % A.length]).join('');
  return `SM-${pick(4)}-${pick(4)}-${pick(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const dashed = (norm) => norm.replace(/^SM/, 'SM-').replace(/^(SM-)(.{4})(.{4})(.{4})$/, '$1$2-$3-$4');

/* ---------- routes ---------- */
const routes = [];
const R = (method, p, auth, fn) =>
  routes.push({ method, auth, fn, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

// ---- public
R('GET', '/api/public', null, () => {
  const s = getSettings();
  const channel = s.channel_enabled === '1' && /^https?:\/\//.test(s.channel_url) ? { url: s.channel_url, text: s.channel_text } : null;
  return {
    settings: { site_name: s.site_name, tagline: s.tagline, intro: s.intro, color_neon: s.color_neon, color_cyan: s.color_cyan, color_purple: s.color_purple },
    channel, ai_enabled: s.ai_enabled === '1',
    categories: all('SELECT c.*, (SELECT COUNT(*) FROM tools t WHERE t.category_id=c.id AND t.visible=1) AS tool_count FROM categories c ORDER BY sort_order,id'),
    tools: all(`SELECT ${TOOL_PUBLIC} FROM tools t LEFT JOIN categories c ON c.id=t.category_id WHERE t.visible=1 ORDER BY t.sort_order,t.id`),
  };
});
R('GET', '/api/tools/:id', 'optUser', ({ params, user }) => {
  const t = one(`SELECT ${TOOL_PUBLIC}, t.description,t.features,t.benefits,t.how_to,t.terms,t.access_content FROM tools t LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=? AND t.visible=1`, params.id);
  if (!t) bad('Program haikupatikana.', 404);
  const access = t.type === 'free' || hasAccess(user && user.id, t.id);
  if (!access) delete t.access_content;
  t.has_access = !!access;
  return t;
});
R('GET', '/api/payment-methods', null, () =>
  all('SELECT id,provider,number,receiver,instructions,amount FROM payment_methods WHERE active=1 AND approved=1 ORDER BY sort_order,id'));

// ---- user auth
R('POST', '/api/register', null, ({ body, ip, res, req }) => {
  limit('reg:' + ip, 10, 36e5);
  const name = str(body.name, 80), phone = str(body.phone, 20).replace(/[^\d+]/g, ''), pw = String(body.password || '');
  if (name.length < 2) bad('Weka jina lako.');
  if (phone.length < 9) bad('Weka namba sahihi ya simu.');
  if (pw.length < 6 || pw.length > 200) bad('Password iwe na angalau herufi 6.');
  if (one('SELECT 1 x FROM users WHERE phone=?', phone)) bad('Namba hii tayari imesajiliwa. Ingia badala yake.', 409);
  const r = run('INSERT INTO users(name,phone,password_hash,created_at) VALUES(?,?,?,?)', name, phone, hashPassword(pw), now());
  startSession(req, res, 'user', Number(r.lastInsertRowid));
  return { user: { id: Number(r.lastInsertRowid), name, phone } };
});
R('POST', '/api/login', null, ({ body, ip, res, req }) => {
  limit('ulogin:' + ip, 15, 15 * 60000);
  const phone = str(body.phone, 20).replace(/[^\d+]/g, '');
  const u = one('SELECT * FROM users WHERE phone=?', phone);
  const ok = u && verifyPassword(String(body.password || ''), u.password_hash);
  if (!ok) bad('Namba au password si sahihi.', 401);
  if (u.blocked) bad('Akaunti hii imezuiwa. Wasiliana na Admin.', 403);
  startSession(req, res, 'user', u.id);
  return { user: publicUser(u) };
});
R('POST', '/api/logout', null, ({ req, res }) => { endSession(req, res, 'user'); return { ok: true }; });
R('GET', '/api/me', 'optUser', ({ user }) => ({ user: user ? publicUser(user) : null }));

// ---- user: payments / access
R('POST', '/api/payments', 'user', ({ body, user, ip }) => {
  limit('pay:' + user.id, 10, 36e5, 'Umetuma maombi mengi. Subiri kidogo.');
  const tool = one("SELECT * FROM tools WHERE id=? AND visible=1 AND type='premium'", int(body.tool_id));
  if (!tool) bad('Program hii haihitaji malipo au haipatikani.');
  const method = one('SELECT * FROM payment_methods WHERE id=? AND active=1 AND approved=1', int(body.method_id));
  if (!method) bad('Chagua njia ya malipo iliyothibitishwa.');
  const payer_name = str(body.payer_name, 80), payer_number = str(body.payer_number, 30), txn = str(body.txn_id, 60).toUpperCase();
  const amount = int(body.amount);
  if (!payer_name || !payer_number || !txn) bad('Jaza taarifa zote za fomu.');
  if (amount <= 0) bad('Weka kiasi ulicholipa.');
  if (one("SELECT 1 x FROM payments WHERE txn_id=? AND status!='REJECTED'", txn)) bad('Transaction ID hii imetumika tayari.', 409);
  const proof = saveImage(PROOF_DIR, body.screenshot, 4 * 1024 * 1024);
  const r = run('INSERT INTO payments(user_id,tool_id,method_provider,payer_name,payer_number,amount,txn_id,proof_file,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    user.id, tool.id, method.provider, payer_name, payer_number, amount, txn, proof, now());
  return { id: Number(r.lastInsertRowid), status: 'PENDING' };
});
R('GET', '/api/wa-link', 'user', ({ query, user }) => {
  const tid = int(query.get('tool_id'));
  if (!one('SELECT 1 x FROM payments WHERE user_id=? AND tool_id=?', user.id, tid)) bad('Wasilisha uthibitisho wa malipo kwanza.', 403);
  const url = waLink(setting('wa_message'));
  if (!url) bad('WhatsApp haijawekwa na Admin.', 503);
  return { url };
});
R('POST', '/api/access/verify', 'user', ({ body, user }) => {
  limit('verify:' + user.id, 10, 10 * 60000, 'Umejaribu mara nyingi. Subiri dakika chache.');
  const norm = normCode(body.code);
  if (!norm) bad('Weka Access Code.');
  const row = one('SELECT * FROM access_codes WHERE code=?', dashed(norm));
  if (!row) bad('Access Code si sahihi au imefutwa.', 404);
  if (row.expires_at && row.expires_at < now()) bad('Access Code hii imeisha muda.', 410);
  if (row.user_id && row.user_id !== user.id) bad('Access Code hii si ya akaunti yako.', 403);
  if (row.redeemed_by && row.redeemed_by !== user.id) bad('Access Code hii tayari imetumika.', 409);
  if (!row.redeemed_by) run('UPDATE access_codes SET redeemed_by=?, redeemed_at=? WHERE id=?', user.id, now(), row.id);
  const t = one('SELECT id,name FROM tools WHERE id=?', row.tool_id);
  return { ok: true, tool_id: t.id, tool_name: t.name };
});
R('GET', '/api/profile', 'user', ({ user }) => ({
  user: publicUser(user),
  programs: all(`SELECT t.id,t.name,t.image,ac.expires_at,ac.code FROM access_codes ac JOIN tools t ON t.id=ac.tool_id
                 WHERE ac.redeemed_by=? AND (ac.expires_at IS NULL OR ac.expires_at>?)`, user.id, now()),
  codes: all(`SELECT ac.code,ac.expires_at,ac.redeemed_at,t.name AS tool_name,t.id AS tool_id FROM access_codes ac JOIN tools t ON t.id=ac.tool_id
              WHERE ac.user_id=? OR ac.redeemed_by=? ORDER BY ac.id DESC`, user.id, user.id)
    .map((c) => ({ ...c, status: c.expires_at && c.expires_at < now() ? 'EXPIRED' : 'ACTIVE' })),
  payments: all(`SELECT p.id,p.amount,p.txn_id,p.status,p.admin_note,p.created_at,t.name AS tool_name FROM payments p JOIN tools t ON t.id=p.tool_id
                 WHERE p.user_id=? ORDER BY p.id DESC`, user.id),
}));

// ---- AI assistant (optional; key stays on the server)
R('POST', '/api/ai/chat', null, async ({ body, ip }) => {
  if (setting('ai_enabled') !== '1') bad('AI Assistant imezimwa.', 503);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) bad('AI Assistant haijaunganishwa bado (ANTHROPIC_API_KEY haijawekwa kwenye server).', 503);
  limit('ai:' + ip, 20, 10 * 60000, 'Umeuliza maswali mengi. Subiri kidogo.');
  const hist = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
  const messages = hist.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 1500) })).filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') bad('Andika swali.');
  const s = getSettings();
  const tools = all(`SELECT t.name,c.name AS category,t.type,t.price,t.currency,t.short_desc FROM tools t LEFT JOIN categories c ON c.id=t.category_id WHERE t.visible=1`)
    .map((t) => `- ${t.name} [${t.category || 'Bila category'}] ${t.type === 'premium' ? `PREMIUM ${t.price} ${t.currency}` : 'FREE'}: ${t.short_desc}`).join('\n');
  const qa = all('SELECT question,answer FROM ai_qa').map((r) => `Q: ${r.question}\nA: ${r.answer}`).join('\n\n');
  const system = [
    s.ai_instructions, `Lugha ya majibu: ${s.ai_language}.`, s.ai_rules && `Sheria za majibu:\n${s.ai_rules}`,
    `Taarifa za website: ${s.site_name} - ${s.tagline}. ${s.intro}`,
    'Hatua za kupata program ya kulipia: 1) Bonyeza FUNGUA PROGRAM na usome maelekezo. 2) Bonyeza ENDELEA KWENYE MALIPO. 3) Lipa kwa njia iliyoonyeshwa na ujaze fomu ya uthibitisho pamoja na screenshot. 4) Baada ya kutuma, bonyeza kitufe cha WhatsApp kuomba Access Code. 5) Admin akikagua na kuthibitisha, atakupa Access Code. 6) Weka code kwenye ukurasa wa Access Code kisha bonyeza VERIFY ACCESS CODE.',
    `Programs zilizopo:\n${tools || '(hakuna bado)'}`, qa && `Maswali na majibu yaliyofundishwa na Admin:\n${qa}`,
    'SHERIA ZA LAZIMA: Usibuni bei, namba za malipo, majina ya wapokeaji wala Access Codes. Bei tumia zile zilizo kwenye orodha tu. Namba za malipo zinaonekana kwenye ukurasa wa malipo pekee. Ikiwa hujui jibu, sema hujui na umshauri mtumiaji awasiliane na Admin kupitia hatua za WhatsApp baada ya malipo.',
  ].filter(Boolean).join('\n\n');
  const resp = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: s.ai_model, max_tokens: 600, system, messages }),
  });
  if (!resp.ok) { console.error('AI error', resp.status, (await resp.text()).slice(0, 300)); bad('AI Assistant haipatikani kwa sasa.', 502); }
  const j = await resp.json();
  return { reply: (j.content || []).map((b) => b.text || '').join('').trim() || 'Samahani, sijaweza kujibu.' };
});

// ---- admin auth
R('POST', '/api/admin/login', null, async ({ body, ip, res, req }) => {
  if (hits('adm-fail:' + ip) >= 5 || hits('adm-fail:all') >= 40) bad('Majaribio mengi. Jaribu tena baada ya dakika 15.', 429);
  const a = one('SELECT * FROM admin WHERE id=1');
  const ok = verifyPassword(String(body.password || ''), a.password_hash);
  if (!ok) {
    limit('adm-fail:' + ip, 1000, 15 * 60000); limit('adm-fail:all', 1000, 15 * 60000);
    await new Promise((r) => setTimeout(r, 600));
    bad('Password si sahihi.', 401);
  }
  buckets.delete('adm-fail:' + ip);
  startSession(req, res, 'admin');
  return { ok: true };
});
R('POST', '/api/admin/logout', null, ({ req, res }) => { endSession(req, res, 'admin'); return { ok: true }; });
R('GET', '/api/admin/me', 'admin', () => ({ ok: true }));

// ---- admin: stats & settings
R('GET', '/api/admin/stats', 'admin', () => ({
  tools: one('SELECT COUNT(*) c FROM tools').c, premium: one("SELECT COUNT(*) c FROM tools WHERE type='premium'").c,
  categories: one('SELECT COUNT(*) c FROM categories').c, users: one('SELECT COUNT(*) c FROM users').c,
  pending: one("SELECT COUNT(*) c FROM payments WHERE status='PENDING'").c, approved: one("SELECT COUNT(*) c FROM payments WHERE status='APPROVED'").c,
  codes_active: one('SELECT COUNT(*) c FROM access_codes WHERE expires_at IS NULL OR expires_at>?', now()).c,
  methods_live: one('SELECT COUNT(*) c FROM payment_methods WHERE active=1 AND approved=1').c,
}));
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
R('GET', '/api/admin/settings', 'admin', () => getSettings());
R('PUT', '/api/admin/settings', 'admin', ({ body }) => {
  for (const k of SETTING_KEYS) {
    if (!(k in body)) continue;
    let v = String(body[k] ?? '').slice(0, 4000);
    if (k === 'channel_url' && v && !/^https:\/\//.test(v)) bad('Link ya Channel lazima ianze na https://');
    if (/^color_/.test(k) && !/^#[0-9a-fA-F]{6}$/.test(v)) bad('Rangi si sahihi.');
    if (k === 'admin_session_minutes') v = String(Math.min(240, Math.max(5, int(v, 30))));
    if (k === 'channel_enabled' || k === 'ai_enabled') v = flag(body[k]) ? '1' : '0';
    run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
  }
  return getSettings();
});
R('POST', '/api/admin/password', 'admin', ({ body, res, req }) => {
  const a = one('SELECT * FROM admin WHERE id=1');
  if (!verifyPassword(String(body.current || ''), a.password_hash)) bad('Password ya sasa si sahihi.', 401);
  const np = String(body.next || '');
  if (np.length < 10) bad('Password mpya iwe na angalau herufi 10.');
  run('UPDATE admin SET password_hash=? WHERE id=1', hashPassword(np));
  run("DELETE FROM sessions WHERE kind='admin'");
  res.cookies.push(cookie(req, 'sm_admin', '', 0));
  return { ok: true };
});
R('POST', '/api/admin/upload', 'admin', ({ body }) => ({ url: '/uploads/img/' + saveImage(IMG_DIR, body.data, 3 * 1024 * 1024) }));

// ---- admin: categories
const catBody = (b) => ({ name: str(b.name, 80), description: str(b.description, 300), image: str(b.image, 200) });
R('GET', '/api/admin/categories', 'admin', () => all('SELECT c.*,(SELECT COUNT(*) FROM tools t WHERE t.category_id=c.id) AS tool_count FROM categories c ORDER BY sort_order,id'));
R('POST', '/api/admin/categories', 'admin', ({ body }) => {
  const c = catBody(body); if (!c.name) bad('Weka jina la category.');
  const r = run('INSERT INTO categories(name,description,image,sort_order) VALUES(?,?,?,?)', c.name, c.description, c.image, one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM categories').n);
  return { id: Number(r.lastInsertRowid) };
});
R('PUT', '/api/admin/categories/:id', 'admin', ({ params, body }) => {
  const c = catBody(body); if (!c.name) bad('Weka jina la category.');
  run('UPDATE categories SET name=?,description=?,image=? WHERE id=?', c.name, c.description, c.image, params.id); return { ok: true };
});
R('DELETE', '/api/admin/categories/:id', 'admin', ({ params }) => { run('DELETE FROM categories WHERE id=?', params.id); return { ok: true }; });
R('POST', '/api/admin/categories/reorder', 'admin', ({ body }) => { (body.ids || []).forEach((id, i) => run('UPDATE categories SET sort_order=? WHERE id=?', i, int(id))); return { ok: true }; });

// ---- admin: tools
function toolBody(b) {
  const type = b.type === 'premium' ? 'premium' : 'free';
  return {
    name: str(b.name, 100), category_id: b.category_id ? int(b.category_id) : null, short_desc: str(b.short_desc, 300),
    description: str(b.description, 5000), features: str(b.features, 5000), benefits: str(b.benefits, 5000), how_to: str(b.how_to, 8000),
    terms: str(b.terms, 5000), type, price: type === 'premium' ? Math.max(0, int(b.price)) : 0, currency: str(b.currency, 10) || 'TSh',
    image: str(b.image, 200), access_content: str(b.access_content, 8000), visible: flag(b.visible),
  };
}
R('GET', '/api/admin/tools', 'admin', () => all('SELECT t.*,c.name AS category FROM tools t LEFT JOIN categories c ON c.id=t.category_id ORDER BY t.sort_order,t.id'));
R('POST', '/api/admin/tools', 'admin', ({ body }) => {
  const t = toolBody(body); if (!t.name) bad('Weka jina la program.');
  if (t.type === 'premium' && t.price <= 0) bad('Program ya Premium inahitaji bei.');
  const r = run(`INSERT INTO tools(name,category_id,short_desc,description,features,benefits,how_to,terms,type,price,currency,image,access_content,visible,sort_order,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, t.name, t.category_id, t.short_desc, t.description, t.features, t.benefits, t.how_to, t.terms, t.type, t.price, t.currency,
    t.image, t.access_content, t.visible, one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM tools').n, now());
  return { id: Number(r.lastInsertRowid) };
});
R('PUT', '/api/admin/tools/:id', 'admin', ({ params, body }) => {
  const old = one('SELECT * FROM tools WHERE id=?', params.id); if (!old) bad('Haipatikani.', 404);
  const t = toolBody({ ...old, ...body });
  if (!t.name) bad('Weka jina la program.');
  if (t.type === 'premium' && t.price <= 0) bad('Program ya Premium inahitaji bei.');
  run(`UPDATE tools SET name=?,category_id=?,short_desc=?,description=?,features=?,benefits=?,how_to=?,terms=?,type=?,price=?,currency=?,image=?,access_content=?,visible=? WHERE id=?`,
    t.name, t.category_id, t.short_desc, t.description, t.features, t.benefits, t.how_to, t.terms, t.type, t.price, t.currency, t.image, t.access_content, t.visible, params.id);
  return { ok: true };
});
R('DELETE', '/api/admin/tools/:id', 'admin', ({ params }) => {
  if (one('SELECT 1 x FROM payments WHERE tool_id=?', params.id)) bad('Program hii ina malipo yaliyorekodiwa. Ifiche badala ya kuifuta.', 409);
  run('DELETE FROM tools WHERE id=?', params.id); return { ok: true };
});
R('POST', '/api/admin/tools/reorder', 'admin', ({ body }) => { (body.ids || []).forEach((id, i) => run('UPDATE tools SET sort_order=? WHERE id=?', i, int(id))); return { ok: true }; });

// ---- admin: payment methods
const methodBody = (b) => ({ provider: str(b.provider, 60), number: str(b.number, 40), receiver: str(b.receiver, 80), instructions: str(b.instructions, 500), amount: str(b.amount, 40), active: flag(b.active), approved: flag(b.approved) });
R('GET', '/api/admin/methods', 'admin', () => all('SELECT * FROM payment_methods ORDER BY sort_order,id'));
R('POST', '/api/admin/methods', 'admin', ({ body }) => {
  const m = methodBody(body); if (!m.provider || !m.number || !m.receiver) bad('Jaza jina la huduma, namba na jina la mpokeaji.');
  const r = run('INSERT INTO payment_methods(provider,number,receiver,instructions,amount,active,approved,sort_order) VALUES(?,?,?,?,?,?,?,?)', m.provider, m.number, m.receiver, m.instructions, m.amount, m.active, m.approved, one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM payment_methods').n);
  return { id: Number(r.lastInsertRowid) };
});
R('PUT', '/api/admin/methods/:id', 'admin', ({ params, body }) => {
  const old = one('SELECT * FROM payment_methods WHERE id=?', params.id); if (!old) bad('Haipatikani.', 404);
  const m = methodBody({ ...old, ...body });
  if (!m.provider || !m.number || !m.receiver) bad('Jaza jina la huduma, namba na jina la mpokeaji.');
  run('UPDATE payment_methods SET provider=?,number=?,receiver=?,instructions=?,amount=?,active=?,approved=? WHERE id=?', m.provider, m.number, m.receiver, m.instructions, m.amount, m.active, m.approved, params.id);
  return { ok: true };
});
R('DELETE', '/api/admin/methods/:id', 'admin', ({ params }) => { run('DELETE FROM payment_methods WHERE id=?', params.id); return { ok: true }; });

// ---- admin: payments
R('GET', '/api/admin/payments', 'admin', () => all(`SELECT p.*,t.name AS tool_name,t.price AS tool_price,t.currency,u.name AS user_name,u.phone AS user_phone,
  (SELECT code FROM access_codes ac WHERE ac.payment_id=p.id LIMIT 1) AS code
  FROM payments p JOIN tools t ON t.id=p.tool_id JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 500`));
R('PUT', '/api/admin/payments/:id', 'admin', ({ params, body }) => {
  const status = ['APPROVED', 'REJECTED', 'PENDING'].includes(body.status) ? body.status : bad('Status si sahihi.');
  if (!one('SELECT 1 x FROM payments WHERE id=?', params.id)) bad('Haipatikani.', 404);
  run('UPDATE payments SET status=?,admin_note=?,reviewed_at=? WHERE id=?', status, str(body.admin_note, 300), now(), params.id);
  return { ok: true };
});
R('GET', '/api/admin/proof/:file', 'admin', ({ params, res }) => {
  if (!/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(params.file)) bad('Haipatikani.', 404);
  const f = path.join(PROOF_DIR, params.file);
  if (!fs.existsSync(f)) bad('Haipatikani.', 404);
  res.raw = { type: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[params.file.split('.')[1]], data: fs.readFileSync(f), cache: 'private, max-age=3600' };
});

// ---- admin: access codes
R('GET', '/api/admin/codes', 'admin', () => all(`SELECT ac.*,t.name AS tool_name,u.name AS user_name,u.phone AS user_phone,r.name AS redeemed_name
  FROM access_codes ac JOIN tools t ON t.id=ac.tool_id LEFT JOIN users u ON u.id=ac.user_id LEFT JOIN users r ON r.id=ac.redeemed_by ORDER BY ac.id DESC LIMIT 500`)
  .map((c) => ({ ...c, status: c.expires_at && c.expires_at < now() ? 'EXPIRED' : 'ACTIVE' })));
R('POST', '/api/admin/codes', 'admin', ({ body }) => {
  const tool = one("SELECT * FROM tools WHERE id=?", int(body.tool_id)); if (!tool) bad('Chagua program.');
  let user_id = body.user_id ? int(body.user_id) : null, payment_id = body.payment_id ? int(body.payment_id) : null;
  if (payment_id) {
    const p = one('SELECT * FROM payments WHERE id=?', payment_id);
    if (!p) bad('Malipo hayapatikani.');
    if (p.status !== 'APPROVED') bad('Thibitisha (APPROVE) malipo kwanza kabla ya kutoa Access Code.');
    if (p.tool_id !== tool.id) bad('Malipo hayo ni ya program nyingine.');
    user_id = p.user_id;
  }
  if (user_id && !one('SELECT 1 x FROM users WHERE id=?', user_id)) bad('Mtumiaji hapatikani.');
  const days = body.days ? int(body.days) : 0;
  const expires = days > 0 ? now() + days * 864e5 : null;
  let code, tries = 0;
  do { code = newCode(); } while (one('SELECT 1 x FROM access_codes WHERE code=?', code) && ++tries < 5);
  const r = run('INSERT INTO access_codes(code,tool_id,user_id,payment_id,expires_at,created_at) VALUES(?,?,?,?,?,?)', code, tool.id, user_id, payment_id, expires, now());
  return { id: Number(r.lastInsertRowid), code, expires_at: expires };
});
R('DELETE', '/api/admin/codes/:id', 'admin', ({ params }) => { run('DELETE FROM access_codes WHERE id=?', params.id); return { ok: true }; });

// ---- admin: users
R('GET', '/api/admin/users', 'admin', () => all(`SELECT u.id,u.name,u.phone,u.blocked,u.created_at,
  (SELECT COUNT(*) FROM payments p WHERE p.user_id=u.id) AS payments,
  (SELECT COUNT(*) FROM access_codes a WHERE a.redeemed_by=u.id) AS programs FROM users u ORDER BY u.id DESC LIMIT 1000`));
R('PUT', '/api/admin/users/:id', 'admin', ({ params, body }) => {
  run('UPDATE users SET blocked=? WHERE id=?', flag(body.blocked), params.id);
  if (flag(body.blocked)) run("DELETE FROM sessions WHERE kind='user' AND user_id=?", params.id);
  return { ok: true };
});

// ---- admin: AI Q&A
R('GET', '/api/admin/qa', 'admin', () => all('SELECT * FROM ai_qa ORDER BY id DESC'));
R('POST', '/api/admin/qa', 'admin', ({ body }) => {
  const q = str(body.question, 500), a = str(body.answer, 2000); if (!q || !a) bad('Jaza swali na jibu.');
  return { id: Number(run('INSERT INTO ai_qa(question,answer) VALUES(?,?)', q, a).lastInsertRowid) };
});
R('PUT', '/api/admin/qa/:id', 'admin', ({ params, body }) => {
  const q = str(body.question, 500), a = str(body.answer, 2000); if (!q || !a) bad('Jaza swali na jibu.');
  run('UPDATE ai_qa SET question=?,answer=? WHERE id=?', q, a, params.id); return { ok: true };
});
R('DELETE', '/api/admin/qa/:id', 'admin', ({ params }) => { run('DELETE FROM ai_qa WHERE id=?', params.id); return { ok: true }; });

/* ---------- http server ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function readBody(req, max = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new HttpError(413, 'Faili ni kubwa mno.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function send(res, status, headers, body) {
  const h = { ...SEC, ...headers };
  if (res.cookies.length) h['Set-Cookie'] = res.cookies;
  res.writeHead(status, h); res.end(body);
}
function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  send(res, 200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': data.length }, data);
}

async function handle(req, res) {
  res.cookies = [];
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'ip';

  if (pathname.startsWith('/api/')) {
    try {
      const route = routes.map((r) => ({ r, m: r.method === req.method && r.re.exec(pathname) })).find((x) => x.m);
      if (!route) bad('Haipatikani.', 404);
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'simutech') bad('Ombi si halali.', 403);
      const ctx = { req, res, ip, params: { ...route.m.groups }, query: url.searchParams, body: {} };
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const raw = await readBody(req);
        try { ctx.body = raw ? JSON.parse(raw) : {}; } catch { bad('Data si sahihi.'); }
      }
      const auth = route.r.auth;
      if (auth === 'admin') { if (!getSession(req, 'admin')) bad('Kipindi kimeisha. Ingia tena.', 401); }
      if (auth === 'user' || auth === 'optUser') {
        const s = getSession(req, 'user');
        const u = s && one('SELECT * FROM users WHERE id=?', s.user_id);
        if (u && u.blocked) { ctx.user = null; } else ctx.user = u || null;
        if (auth === 'user' && !ctx.user) bad('Tafadhali ingia kwanza.', 401);
      }
      const out = await route.r.fn(ctx);
      if (res.raw) return send(res, 200, { 'Content-Type': res.raw.type, 'Cache-Control': res.raw.cache }, res.raw.data);
      return send(res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(out ?? { ok: true }));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify({ error: status === 500 ? 'Hitilafu ya server. Jaribu tena.' : e.message }));
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {}, 'Method not allowed');
  if (pathname.startsWith('/uploads/img/')) {
    const name = path.basename(pathname);
    const f = path.join(IMG_DIR, name);
    if (/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(name) && fs.existsSync(f)) return serveFile(res, f, 'public, max-age=31536000, immutable');
    return send(res, 404, {}, 'Not found');
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const f = path.join(PUBLIC_DIR, rel);
  if (f.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    return serveFile(res, f, rel === 'index.html' || rel === 'sw.js' ? 'no-cache' : 'public, max-age=3600');
  }
  if (path.extname(pathname)) return send(res, 404, {}, 'Not found');
  return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache'); // SPA fallback: direct links work
}

const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); try { res.writeHead(500); res.end('error'); } catch {} }); });
server.listen(PORT, () => console.log(`SIMUTECH MOD inaendesha kwenye http://localhost:${PORT}`));
module.exports = { server };
