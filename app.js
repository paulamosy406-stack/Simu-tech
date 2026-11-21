/* SIMUTECH MOD - frontend (vanilla JS SPA, hash routing so direct links work on any static host) */
(() => {
'use strict';

/* DOM's replaceChildren() turns null/arrays into text ("null", "[object ...]"). Make it accept arrays and skip empty values. */
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(9).filter((k) => k != null && k !== false));
};

/* ---------- tiny DOM helper (text is always escaped) ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  if (value !== undefined) e.value = value;
  return e;
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  cat: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  ai: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  wa: '<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ---------- api / state ---------- */
const S = { settings: {}, categories: [], tools: [], channel: null, ai: false, me: null };
async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'simutech' }, body: body ? JSON.stringify(body) : undefined });
  } catch { const e = new Error('Hakuna mtandao. Angalia muunganisho wako kisha ujaribu tena.'); e.status = 0; throw e; }
  let j = {};
  try { j = await r.json(); } catch { /* non-json */ }
  if (!r.ok) { const e = new Error(j.error || 'Kuna hitilafu. Jaribu tena.'); e.status = r.status; throw e; }
  return j;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b || {});

let toastTimer;
function toast(msg, isBad) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.className = 'show' + (isBad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3200);
}
const money = (n, cur) => `${cur || 'TSh'} ${Number(n || 0).toLocaleString('en-US')}`;
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const go = (path) => { location.hash = '#' + path; };

function hue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function placeholder(name) {
  const a = hue(name), letter = (String(name).trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},70%,14%)"/><stop offset="1" stop-color="hsl(${(a + 70) % 360},70%,8%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><g stroke="hsla(${a},90%,60%,.12)"><path d="M0 45h320M0 90h320M0 135h320M80 0v180M160 0v180M240 0v180"/></g><circle cx="160" cy="90" r="44" fill="none" stroke="hsl(${a},90%,60%)" stroke-width="2" opacity=".6"/><text x="160" y="106" text-anchor="middle" font-family="Arial" font-weight="800" font-size="46" fill="hsl(${a},95%,68%)">${letter.replace(/[<>&]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const imgSrc = (o) => o.image || placeholder(o.name);

function fileToDataURL(file, max = 1000, type = 'image/jpeg', q = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Chagua faili la picha.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Picha haiwezi kusomwa.')); };
    img.src = url;
  });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = h('textarea', { value: text, style: 'position:fixed;opacity:0' }); document.body.append(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
  toast('Imenakiliwa');
}
function linkify(text) {
  const out = [];
  String(text || '').split(/(https?:\/\/[^\s]+)/g).forEach((p) => out.push(/^https?:\/\//.test(p) ? h('a', { href: p, target: '_blank', rel: 'noopener noreferrer' }, p) : p));
  return out;
}
const pre = (t) => h('p', { class: 'pre' }, linkify(t));

async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Subiri…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- shell ---------- */
const app = document.getElementById('app');
const NAV = [['/', 'HOME', 'home'], ['/tools', 'TOOLS', 'tools'], ['/categories', 'CATEGORIES', 'cat'], ['/profile', 'PROFILE', 'user']];

function shell(view, opts = {}) {
  const cur = opts.active;
  const header = h('header', { class: 'top' }, h('div', { class: 'wrap' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/logo.svg', alt: '', width: 34, height: 34 }), h('span', null, brandName())),
    h('div', { class: 'grow' }),
    opts.admin ? null : h('nav', { class: 'top-links', 'aria-label': 'Menu' }, NAV.map(([p, l]) => h('a', { href: '#' + p, class: cur === p ? 'on' : '' }, l))),
    opts.adminLogout ? h('button', { class: 'btn ghost sm', onclick: opts.adminLogout }, icon('logout'), 'TOKA') : null));
  const nodes = [header, h('div', { class: 'wrap' }, h('main', null, view))];
  if (!opts.admin) {
    nodes.push(h('footer', { class: 'foot' }, h('button', { class: 'lock', 'aria-label': 'Lock', onclick: () => go('/gate') }, icon('lock'))));
    nodes.push(h('nav', { class: 'bottom', 'aria-label': 'Menu ya chini' }, h('div', { class: 'in' },
      NAV.map(([p, l, i]) => h('a', { href: '#' + p, class: cur === p ? 'on' : '' }, icon(i), l)))));
    if (S.ai) nodes.push(aiWidget());
  }
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
function brandName() {
  const n = S.settings.site_name || 'SIMUTECH MOD';
  const i = n.indexOf(' ');
  return i > 0 ? [n.slice(0, i) + ' ', h('b', null, n.slice(i + 1))] : n;
}
function applyTheme() {
  const s = S.settings, r = document.documentElement.style;
  if (s.color_neon) r.setProperty('--neon', s.color_neon);
  if (s.color_cyan) r.setProperty('--cyan', s.color_cyan);
  if (s.color_purple) r.setProperty('--purple', s.color_purple);
  document.title = `${s.site_name || 'SIMUTECH MOD'} – ${s.tagline || 'Technology Tools and Programs'}`;
}
let lastLoad = 0;
async function loadPublic() {
  const d = await GET('/api/public');
  lastLoad = Date.now();
  S.settings = d.settings; S.categories = d.categories; S.tools = d.tools; S.channel = d.channel; S.ai = d.ai_enabled;
  applyTheme();
}
async function loadMe() { try { S.me = (await GET('/api/me')).user; } catch { S.me = null; } }
function needLogin() {
  if (S.me) return false;
  const next = location.hash.replace(/^#/, '') || '/';
  go('/login?next=' + encodeURIComponent(next));
  return true;
}

/* ---------- reusable bits ---------- */
function toolCard(t, i = 0) {
  return h('article', { class: 'card', style: `animation-delay:${Math.min(i, 12) * 40}ms` },
    h('div', { class: 'img' }, h('img', { src: imgSrc(t), alt: t.name, loading: 'lazy', width: 320, height: 180 })),
    h('span', { class: 'badge ' + t.type }, t.type === 'premium' ? 'PREMIUM' : 'FREE'),
    h('div', { class: 'body' },
      h('span', { class: 'cat' }, (t.category || 'Bila category').toUpperCase()),
      h('h3', null, t.name),
      h('p', { class: 'desc' }, t.short_desc),
      t.type === 'premium' ? h('div', { class: 'price' }, money(t.price, t.currency)) : null,
      h('a', { class: 'btn primary block', href: '#/tool/' + t.id }, 'FUNGUA PROGRAM')));
}
function toolGrid(list) {
  if (!list.length) return h('div', { class: 'empty' }, 'Hakuna program iliyopatikana.');
  return h('div', { class: 'grid' }, list.map(toolCard));
}
function matches(t, q) {
  q = q.trim().toLowerCase();
  return !q || [t.name, t.short_desc, t.category].some((x) => String(x || '').toLowerCase().includes(q));
}
function searchBox(onInput, value = '') {
  return h('div', { class: 'search' }, icon('search'),
    h('input', { type: 'search', value, 'aria-label': 'Tafuta tools na programs', placeholder: 'Tafuta tools na programs…', oninput: (e) => onInput(e.target.value) }));
}
function titleRow(text, back) {
  return h('div', { class: 'title-row' }, back ? h('button', { class: 'back', onclick: () => (history.length > 1 ? history.back() : go(back)) }, '← Rudi') : null, h('h2', null, text));
}
function panel(title, body) { return body ? h('section', { class: 'panel' }, h('h3', null, title), body) : null; }

/* ---------- pages ---------- */
function homePage() {
  const grid = h('div');
  let q = '';
  const draw = () => grid.replaceChildren(toolGrid(S.tools.filter((t) => matches(t, q))));
  draw();
  shell(h('div', null,
    h('section', { class: 'hero' }, h('h1', null, brandName()), h('p', null, S.settings.intro)),
    searchBox((v) => { q = v; draw(); }),
    S.channel ? h('div', { class: 'channel' }, h('a', { class: 'btn wa', href: S.channel.url, target: '_blank', rel: 'noopener noreferrer' }, icon('wa'), S.channel.text)) : null,
    grid), { active: '/' });
}
function toolsPage() {
  let q = '', cat = 0;
  const grid = h('div');
  const chips = h('div', { class: 'chips' });
  const draw = () => {
    chips.replaceChildren(h('button', { class: 'chip' + (!cat ? ' on' : ''), onclick: () => { cat = 0; draw(); } }, 'Zote'),
      S.categories.filter((c) => c.tool_count).map((c) => h('button', { class: 'chip' + (cat === c.id ? ' on' : ''), onclick: () => { cat = c.id; draw(); } }, c.name)));
    grid.replaceChildren(toolGrid(S.tools.filter((t) => (!cat || t.category_id === cat) && matches(t, q))));
  };
  draw();
  shell(h('div', null, titleRow('Tools & Programs'), searchBox((v) => { q = v; draw(); }), chips, grid), { active: '/tools' });
}
function categoriesPage() {
  shell(h('div', null, titleRow('Categories'),
    S.categories.length ? h('div', { class: 'grid' }, S.categories.map((c, i) =>
      h('a', { class: 'card cat-card', href: '#/category/' + c.id, style: `animation-delay:${Math.min(i, 12) * 40}ms;color:inherit` },
        h('div', { class: 'img' }, h('img', { src: imgSrc(c), alt: '', loading: 'lazy' })),
        h('div', { class: 'body' }, h('h3', null, c.name), h('p', { class: 'desc' }, c.description), h('span', { class: 'cat' }, `${c.tool_count} programs`)))))
      : h('div', { class: 'empty' }, 'Hakuna categories bado.')), { active: '/categories' });
}
function categoryPage(id) {
  const c = S.categories.find((x) => x.id === Number(id));
  if (!c) return go('/categories');
  shell(h('div', null, titleRow(c.name, '/categories'), c.description ? h('p', { class: 'muted' }, c.description) : null,
    toolGrid(S.tools.filter((t) => t.category_id === c.id))), { active: '/categories' });
}

async function toolPage(id) {
  shell(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:auto' })), { active: '/tools' });
  let t;
  try { t = await GET('/api/tools/' + id); } catch (e) { return shell(h('div', { class: 'empty' }, e.message, h('p', null, h('a', { href: '#/tools' }, '← Rudi kwenye Tools'))), { active: '/tools' }); }
  const premium = t.type === 'premium';
  const parts = [
    titleRow(t.name, '/tools'),
    h('img', { class: 'detail-img', src: imgSrc(t), alt: t.name, width: 800, height: 450 }),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('span', { class: 'pill ' + (premium ? 'warn' : 'ok'), style: 'flex:none' }, premium ? 'PREMIUM' : 'FREE'),
      h('span', { class: 'cat muted', style: 'flex:none' }, t.category || ''), h('span', { class: 'grow' })),
    panel('Maelezo', t.description ? pre(t.description) : t.short_desc ? pre(t.short_desc) : null),
    panel('Kazi zinazofanywa na program', t.features && pre(t.features)),
    panel('Faida na matumizi', t.benefits && pre(t.benefits)),
    panel('Maelekezo ya kutumia', t.how_to && pre(t.how_to)),
    panel('Masharti ya matumizi', t.terms && pre(t.terms)),
    panel('Bei', h('p', { class: 'price', style: 'font-size:22px;margin:0' }, premium ? money(t.price, t.currency) : 'BURE (FREE)')),
  ];
  if (premium && !t.has_access) {
    parts.push(h('div', { class: 'notice' }, h('h3', null, 'PROGRAM HII NI YA KULIPIA'),
      h('p', null, 'Program hii inahitaji malipo ili uweze kupata Access Code na kuendelea kuitumia. Tafadhali soma maelekezo yote ya program hii kabla ya kuendelea.'),
      h('a', { class: 'btn purple block', href: '#/pay/' + t.id }, 'ENDELEA KWENYE MALIPO'),
      h('p', { class: 'small', style: 'margin:12px 0 0' }, 'Una Access Code tayari? ', h('a', { href: '#/access/' + t.id }, 'Iweke hapa'))));
  } else {
    parts.push(h('section', { class: 'panel' }, h('h3', null, premium ? 'ACCESS UMETHIBITISHWA' : 'TUMIA PROGRAM'),
      t.access_content ? pre(t.access_content) : h('p', { class: 'muted' }, 'Fuata maelekezo ya matumizi yaliyo hapo juu.')));
  }
  shell(h('div', null, parts), { active: '/tools' });
}

/* ---- auth pages */
function authForm(mode) {
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '/profile';
  const reg = mode === 'register';
  const err = h('div', { class: 'err', role: 'alert' });
  const f = { name: h('input', { type: 'text', autocomplete: 'name' }), phone: h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }), pw: h('input', { type: 'password', autocomplete: reg ? 'new-password' : 'current-password' }) };
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, reg ? 'JISAJILI' : 'INGIA');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    await busy(btn, async () => {
      try {
        const d = await POST(reg ? '/api/register' : '/api/login', { name: f.name.value, phone: f.phone.value, password: f.pw.value });
        S.me = d.user; go(next.startsWith('/') ? next : '/profile');
      } catch (ex) { err.textContent = ex.message; }
    });
  } },
  reg ? h('div', { class: 'field' }, h('label', null, 'Jina lako'), f.name) : null,
  h('div', { class: 'field' }, h('label', null, 'Namba ya simu'), f.phone),
  h('div', { class: 'field' }, h('label', null, 'Password'), f.pw), err, btn,
  h('p', { class: 'small muted', style: 'text-align:center;margin-top:14px' }, reg ? 'Una akaunti? ' : 'Huna akaunti? ',
    h('a', { href: (reg ? '#/login' : '#/register') + '?next=' + encodeURIComponent(next) }, reg ? 'Ingia' : 'Jisajili')));
  shell(h('div', { class: 'access-wrap' }, titleRow(reg ? 'Fungua akaunti' : 'Ingia'), h('div', { class: 'panel' }, form)), { active: '/profile' });
}

async function profilePage() {
  if (needLogin()) return;
  shell(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:auto' })), { active: '/profile' });
  let d;
  try { d = await GET('/api/profile'); } catch (e) { if (e.status === 401) { S.me = null; return needLogin(); } return shell(h('div', { class: 'empty' }, e.message), { active: '/profile' }); }
  const st = (s) => h('span', { class: 'pill ' + ({ APPROVED: 'ok', PENDING: 'warn', REJECTED: 'no', ACTIVE: 'ok', EXPIRED: 'no' }[s] || '') }, { APPROVED: 'IMETHIBITISHWA', PENDING: 'INASUBIRI', REJECTED: 'IMEKATALIWA', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED' }[s] || s);
  const empty = (t) => h('p', { class: 'muted' }, t);
  shell(h('div', null,
    titleRow('Profile'),
    h('section', { class: 'panel' }, h('div', { class: 'row' }, h('div', null, h('b', null, d.user.name), h('div', { class: 'muted small' }, d.user.phone)),
      h('button', { class: 'btn ghost sm no', onclick: async () => { await POST('/api/logout'); S.me = null; toast('Umetoka'); go('/'); } }, icon('logout'), 'TOKA'))),
    h('section', { class: 'panel' }, h('h3', null, 'PROGRAMS ULIZOPATA ACCESS'),
      d.programs.length ? d.programs.map((p) => h('a', { class: 'list-item', href: '#/tool/' + p.id, style: 'color:inherit' }, h('img', { src: imgSrc(p), alt: '' }),
        h('div', { class: 'grow' }, h('b', null, p.name), h('span', { class: 'muted small' }, p.expires_at ? 'Mwisho: ' + fmtDate(p.expires_at) : 'Bila kikomo cha muda')), icon('arrow'))) : empty('Bado hujapata access ya program yoyote.')),
    h('section', { class: 'panel' }, h('h3', null, 'ACCESS CODES ZAKO'),
      d.codes.length ? d.codes.map((c) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'codebox' }, c.code), h('span', { class: 'muted small' }, c.tool_name + (c.expires_at ? ' · hadi ' + fmtDate(c.expires_at) : ''))),
        h('div', { class: 'acts' }, st(c.status), c.status === 'ACTIVE' && !c.redeemed_at ? h('a', { class: 'btn ghost sm', href: '#/access/' + c.tool_id }, 'TUMIA') : null))) : empty('Hakuna Access Code bado.')),
    h('section', { class: 'panel' }, h('h3', null, 'HISTORIA YA MALIPO NA HALI YA MAOMBI'),
      d.payments.length ? d.payments.map((p) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('b', null, p.tool_name), h('span', { class: 'muted small' }, `${money(p.amount)} · ${p.txn_id} · ${fmtDate(p.created_at)}`), p.admin_note ? h('span', { class: 'small' }, 'Maelezo: ' + p.admin_note) : null), st(p.status))) : empty('Hujatuma malipo yoyote bado.'))),
  { active: '/profile' });
}

/* ---- payment flow */
async function payPage(id) {
  if (needLogin()) return;
  shell(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:auto' })), { active: '/tools' });
  let t, methods;
  try { [t, methods] = await Promise.all([GET('/api/tools/' + id), GET('/api/payment-methods')]); } catch (e) { return shell(h('div', { class: 'empty' }, e.message), { active: '/tools' }); }
  if (t.type !== 'premium') return go('/tool/' + id);
  const methodsEl = methods.length ? methods.map((m) => h('div', { class: 'method' },
    h('div', { class: 'lbl' }, m.provider), h('div', { class: 'num' }, m.number), h('div', null, 'Jina la mpokeaji: ', h('b', null, m.receiver)),
    m.amount ? h('div', { class: 'small muted' }, 'Kiasi: ' + m.amount) : null, m.instructions ? h('p', { class: 'small pre', style: 'margin:8px 0' }, m.instructions) : null,
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copyText(m.number) }, icon('copy'), 'COPY PAYMENT NUMBER')))
    : h('p', { class: 'muted' }, 'Njia za malipo bado hazijawekwa na Admin. Tafadhali jaribu tena baadaye.');

  const f = {
    payer_name: h('input', { type: 'text', value: S.me.name }), payer_number: h('input', { type: 'tel', inputmode: 'tel' }),
    amount: h('input', { type: 'number', inputmode: 'numeric', min: 1, value: t.price }), txn_id: h('input', { type: 'text', autocapitalize: 'characters' }),
    method: h('select', null, methods.map((m) => h('option', { value: m.id }, `${m.provider} – ${m.receiver}`))), file: h('input', { type: 'file', accept: 'image/*' }),
  };
  let shot = '';
  const prev = h('img', { class: 'preview', alt: '', style: 'display:none' });
  f.file.addEventListener('change', async () => {
    try { shot = await fileToDataURL(f.file.files[0], 1400); prev.src = shot; prev.style.display = 'block'; err.textContent = ''; } catch (e) { shot = ''; prev.style.display = 'none'; toast(e.message, true); }
  });
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'SUBMIT PAYMENT PROOF');
  const field = (l, el) => h('div', { class: 'field' }, h('label', null, l), el);
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!shot) { err.textContent = 'Weka screenshot ya uthibitisho wa muamala.'; return; }
    await busy(btn, async () => {
      try {
        await POST('/api/payments', { tool_id: t.id, method_id: f.method.value, payer_name: f.payer_name.value, payer_number: f.payer_number.value, amount: f.amount.value, txn_id: f.txn_id.value, screenshot: shot });
        go('/submitted/' + t.id);
      } catch (ex) { err.textContent = ex.message; }
    });
  } },
  field('Jina la aliyelipa', f.payer_name), field('Namba aliyotumia kulipia', f.payer_number), field('Kiasi alicholipa', f.amount), field('Transaction ID', f.txn_id),
  field('Program aliyolipia', h('input', { type: 'text', value: t.name, readonly: true })), methods.length > 1 ? field('Njia aliyotumia', f.method) : null,
  field('Screenshot ya uthibitisho wa muamala', h('div', null, f.file, prev)), err, btn);

  shell(h('div', null, titleRow('Malipo', '/tool/' + t.id),
    h('section', { class: 'panel' }, h('div', { class: 'lbl' }, 'Program'), h('h2', { style: 'margin:2px 0 8px' }, t.name), h('div', { class: 'lbl' }, 'Bei'),
      h('div', { class: 'price', style: 'font-size:24px' }, money(t.price, t.currency))),
    h('section', { class: 'panel' }, h('h3', null, 'NJIA ZA MALIPO'), methodsEl),
    methods.length ? h('section', { class: 'panel' }, h('h3', null, 'THIBITISHA MUAMALA'), form) : null), { active: '/tools' });
}

async function submittedPage(id) {
  if (needLogin()) return;
  const err = h('div', { class: 'err', role: 'alert' });
  const wa = h('button', { class: 'btn wa block', onclick: async (e) => {
    err.textContent = '';
    await busy(e.currentTarget, async () => {
      try { const { url } = await GET('/api/wa-link?tool_id=' + id); window.open(url, '_blank', 'noopener'); } catch (ex) { err.textContent = ex.message; }
    });
  } }, icon('wa'), 'WHATSAPP – PATA ACCESS CODE');
  shell(h('div', { class: 'access-wrap' }, h('section', { class: 'panel' },
    h('h2', null, 'Uthibitisho umepokelewa'),
    h('p', null, 'Admin atakagua taarifa za muamala wako. Ukishathibitishwa, utapewa Access Code.'),
    h('p', { class: 'small muted' }, 'Bonyeza kitufe hapa chini kumtumia Admin ujumbe kwenye WhatsApp. Unaweza kuambatanisha screenshot ya muamala. WhatsApp si uthibitisho wa malipo; Admin lazima athibitishe muamala.'),
    wa, err, h('div', { class: 'hr' }), h('a', { class: 'btn ghost block', href: '#/access/' + id }, 'NINA ACCESS CODE'))), { active: '/tools' });
}

async function accessPage(id) {
  if (needLogin()) return;
  shell(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:auto' })), { active: '/tools' });
  let t; try { t = await GET('/api/tools/' + id); } catch (e) { return shell(h('div', { class: 'empty' }, e.message), { active: '/tools' }); }
  const input = h('input', { type: 'text', class: 'access-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Access Code' });
  const out = h('div'), err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'VERIFY ACCESS CODE');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    await busy(btn, async () => {
      try {
        const r = await POST('/api/access/verify', { code: input.value });
        const tt = await GET('/api/tools/' + r.tool_id);
        out.replaceChildren(h('section', { class: 'panel' }, h('div', { class: 'okmsg' }, 'Access Code imethibitishwa. Karibu!'), h('h3', null, tt.name), tt.access_content ? pre(tt.access_content) : h('p', { class: 'muted' }, 'Fuata maelekezo ya matumizi kwenye ukurasa wa program.'),
          h('a', { class: 'btn ghost block', href: '#/tool/' + tt.id }, 'FUNGUA UKURASA WA PROGRAM')));
        input.value = '';
      } catch (ex) { err.textContent = ex.message; }
    });
  } }, input, err, h('div', { style: 'height:8px' }), btn);
  const waSlot = h('div');
  GET('/api/wa-link?tool_id=' + id).then((r) => waSlot.append(h('div', { class: 'hr' }), h('a', { class: 'btn wa block', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, icon('wa'), 'WHATSAPP – PATA ACCESS CODE'))).catch(() => {});
  shell(h('div', { class: 'access-wrap' }, titleRow(t.name, '/tool/' + id), h('section', { class: 'panel' }, form, waSlot), out), { active: '/tools' });
}

/* ---- AI assistant (only when admin enabled it) */
let aiOpen = false; const aiHist = [];
function aiWidget() {
  const wrap = h('div');
  const draw = () => {
    wrap.replaceChildren(h('button', { class: 'ai-fab', 'aria-label': 'Msaidizi wa AI', onclick: () => { aiOpen = !aiOpen; draw(); } }, icon(aiOpen ? 'close' : 'ai')));
    if (!aiOpen) return;
    const msgs = h('div', { class: 'ai-msgs' }, aiHist.length ? aiHist.map((m) => h('div', { class: 'msg ' + (m.role === 'user' ? 'u' : 'a') }, m.content)) : h('div', { class: 'msg a' }, 'Habari! Niulize kuhusu programs, malipo au jinsi ya kupata Access Code.'));
    const inp = h('input', { type: 'text', maxlength: 500, 'aria-label': 'Swali lako' });
    const send = async (e) => {
      e.preventDefault(); const q = inp.value.trim(); if (!q) return;
      aiHist.push({ role: 'user', content: q }); inp.value = ''; draw();
      try { const r = await POST('/api/ai/chat', { messages: aiHist.slice(-8) }); aiHist.push({ role: 'assistant', content: r.reply }); }
      catch (ex) { aiHist.push({ role: 'assistant', content: ex.message }); }
      draw();
    };
    wrap.append(h('div', { class: 'ai-box' }, h('div', { class: 'ai-head' }, 'Msaidizi wa AI', h('button', { class: 'back', onclick: () => { aiOpen = false; draw(); } }, icon('close'))), msgs,
      h('form', { class: 'ai-in', onsubmit: send }, inp, h('button', { class: 'btn primary sm', type: 'submit' }, 'TUMA'))));
    msgs.scrollTop = msgs.scrollHeight;
  };
  draw(); return wrap;
}

/* ---- admin gate (blank password field, no labels/placeholder) */
function gatePage() {
  const input = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit', 'aria-label': 'Ingia' }, icon('arrow'));
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const b = btn; b.disabled = true;
    try { await POST('/api/admin/login', { password: input.value }); input.value = ''; go('/admin'); }
    catch (ex) { err.textContent = ex.message; } finally { b.disabled = false; }
  } }, input, err, h('div', { style: 'height:8px' }), btn);
  shell(h('div', { class: 'access-wrap' }, h('section', { class: 'panel' }, form)), { admin: true });
  input.focus();
}
async function adminPage() {
  try { await GET('/api/admin/me'); } catch { return go('/gate'); }
  const logout = async () => { try { await POST('/api/admin/logout'); } catch {} go('/gate'); };
  shell(window.SM.adminUI(logout), { admin: true, adminLogout: logout });
}

/* ---------- router ---------- */
const ROUTES = [
  [/^\/$/, homePage], [/^\/tools$/, toolsPage], [/^\/categories$/, categoriesPage], [/^\/category\/(\d+)$/, categoryPage],
  [/^\/tool\/(\d+)$/, toolPage], [/^\/pay\/(\d+)$/, payPage], [/^\/submitted\/(\d+)$/, submittedPage], [/^\/access\/(\d+)$/, accessPage],
  [/^\/login$/, () => (S.me ? go('/profile') : authForm('login'))], [/^\/register$/, () => (S.me ? go('/profile') : authForm('register'))],
  [/^\/profile$/, profilePage], [/^\/gate$/, gatePage], [/^\/admin$/, adminPage],
];
async function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  // keep tools/categories fresh (admin edits show up without a manual reload)
  if (path === '/admin') lastLoad = 0;
  else if (Date.now() - lastLoad > 15000) { try { await loadPublic(); } catch { /* keep cached data */ } }
  for (const [re, fn] of ROUTES) { const m = re.exec(path); if (m) return fn(...m.slice(1)); }
  go('/');
}
window.SM = { h, icon, api, GET, POST, S, toast, money, fmtDate, fileToDataURL, copyText, imgSrc, placeholder, busy, go, reload: loadPublic };

(async () => {
  try { await Promise.all([loadPublic(), loadMe()]); }
  catch (e) { app.replaceChildren(h('div', { class: 'empty' }, 'Imeshindwa kupakia tovuti. ', e.message, h('p', null, h('button', { class: 'btn primary', onclick: () => location.reload() }, 'JARIBU TENA')))); return; }
  window.addEventListener('hashchange', route);
  route();
})();
})();
