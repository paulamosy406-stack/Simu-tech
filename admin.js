/* SIMUTECH MOD - Admin panel UI. Loaded with the app, but every action is authorised by the server session. */
(() => {
'use strict';
const { h, icon, api, toast, money, fmtDate, fileToDataURL, copyText, imgSrc, go } = window.SM;

/* all admin calls: a 401 means the session ended or timed out -> back to the password screen */
async function A(method, url, body) {
  try { return await api(method, url, body); }
  catch (e) { if (e.status === 401) { toast('Kipindi kimeisha. Ingia tena.', true); go('/gate'); } throw e; }
}
const fail = (e) => toast(e.message, true);
async function act(btn, fn) {
  const old = btn.textContent; btn.disabled = true;
  try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = old; }
}
const F = (label, el, note) => h('div', { class: 'field' }, h('label', null, label), el, note ? h('span', { class: 'small muted' }, note) : null);
const T = (v, a) => h('input', { type: 'text', value: v ?? '', ...a });
const TA = (v, rows) => h('textarea', { value: v ?? '', rows: rows || 4 });
const NUM = (v) => h('input', { type: 'number', inputmode: 'numeric', min: 0, value: v ?? 0 });
const CK = (label, on) => { const i = h('input', { type: 'checkbox', checked: !!on }); const l = h('label', { class: 'check' }, i, label); l.input = i; return l; };
const SEL = (opts, v) => h('select', { value: v ?? '' }, opts.map(([val, text]) => h('option', { value: val }, text)));
const pill = (text, kind) => h('span', { class: 'pill ' + (kind || '') }, text);
const statusKind = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'no', ACTIVE: 'ok', EXPIRED: 'no' };
const confirmDo = (msg) => window.confirm(msg);

function imageField(current, onChange) {
  let value = current || '', pending = null;
  const prev = h('img', { class: 'preview', alt: '', src: value || '', style: value ? '' : 'display:none' });
  const file = h('input', { type: 'file', accept: 'image/*' });
  file.addEventListener('change', async () => {
    try { pending = await fileToDataURL(file.files[0], 1000, 'image/webp', 0.85); prev.src = pending; prev.style.display = 'block'; onChange && onChange(); }
    catch (e) { fail(e); }
  });
  const clear = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { value = ''; pending = null; file.value = ''; prev.style.display = 'none'; onChange && onChange(); } }, 'ONDOA PICHA');
  const el = h('div', null, prev, h('div', { style: 'height:8px' }), file, h('div', { style: 'height:8px' }), clear);
  el.resolve = async () => { if (pending) { value = (await A('POST', '/api/admin/upload', { data: pending })).url; pending = null; } return value; };
  return el;
}

/* ================= tabs ================= */
async function overview(box) {
  const s = await A('GET', '/api/admin/stats');
  const st = (n, l) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, l));
  const set = await A('GET', '/api/admin/settings');
  const todo = [];
  if (!s.categories) todo.push('Ongeza categories.');
  if (!s.tools) todo.push('Ongeza program ya kwanza kwenye "Tools".');
  if (s.premium && !s.methods_live) todo.push('Una programs za Premium lakini hakuna njia ya malipo iliyowashwa na kuthibitishwa. Wateja hawataona namba yoyote.');
  if (s.pending) todo.push(`Kuna malipo ${s.pending} yanayosubiri ukaguzi.`);
  if (set.channel_enabled === '1' && !set.channel_url) todo.push('Channel imewashwa lakini link haijawekwa.');
  box.replaceChildren(h('div', { class: 'stats' }, st(s.tools, 'Programs'), st(s.premium, 'Premium'), st(s.categories, 'Categories'), st(s.users, 'Watumiaji'),
    st(s.pending, 'Malipo yanayosubiri'), st(s.approved, 'Malipo yaliyothibitishwa'), st(s.codes_active, 'Access Codes ACTIVE'), st(s.methods_live, 'Njia za malipo zinazoonekana')),
  todo.length ? h('section', { class: 'panel', style: 'margin-top:14px' }, h('h3', null, 'KUMBUSHO'), h('ul', null, todo.map((t) => h('li', null, t)))) : null);
}

/* ---- tools (also used for Instructions / Prices / Images views) */
function toolForm(tool, cats, groups, done) {
  const isNew = !tool.id, all = groups.includes('all'), g = (n) => all || groups.includes(n);
  const f = {
    name: T(tool.name), category_id: SEL([['', '— Bila category —'], ...cats.map((c) => [c.id, c.name])], tool.category_id), short_desc: T(tool.short_desc, { maxlength: 300 }),
    visible: CK('Ionekane kwenye website', isNew ? true : tool.visible),
    description: TA(tool.description, 4), features: TA(tool.features, 4), benefits: TA(tool.benefits, 4), how_to: TA(tool.how_to, 6), terms: TA(tool.terms, 4), access_content: TA(tool.access_content, 4),
    type: SEL([['free', 'FREE'], ['premium', 'PREMIUM']], tool.type || 'free'), price: NUM(tool.price), currency: T(tool.currency || 'TSh', { maxlength: 10 }),
  };
  f.type.value = tool.type || 'free';
  const img = imageField(tool.image);
  const priceRow = h('div', { class: 'row' }, F('Bei', f.price), F('Sarafu', f.currency));
  const syncPrice = () => { priceRow.style.display = f.type.value === 'premium' ? '' : 'none'; };
  f.type.addEventListener('change', syncPrice); syncPrice();
  const parts = [];
  if (g('basic')) parts.push(F('Jina la program', f.name), F('Category', f.category_id), F('Maelezo mafupi (kwenye card)', f.short_desc), f.visible);
  if (g('price')) parts.push(F('Aina', f.type), priceRow);
  if (g('instr')) parts.push(F('Maelezo ya program', f.description), F('Kazi zinazofanywa na program', f.features), F('Faida na matumizi', f.benefits), F('Maelekezo ya kutumia', f.how_to), F('Masharti ya matumizi', f.terms),
    F('Maudhui ya Access (link au maelezo ya kutumia program)', f.access_content, 'Yanaonekana kwa mtumiaji aliyethibitishwa tu (au kwa kila mtu ikiwa program ni FREE).'));
  if (g('image')) parts.push(F('Picha (preview inaonekana kabla ya kuhifadhi)', img));
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'HIFADHI');
  const form = h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(btn, async () => {
    const body = {};
    if (g('basic')) Object.assign(body, { name: f.name.value, category_id: f.category_id.value, short_desc: f.short_desc.value, visible: f.visible.input.checked });
    if (g('price')) Object.assign(body, { type: f.type.value, price: f.price.value, currency: f.currency.value });
    if (g('instr')) Object.assign(body, { description: f.description.value, features: f.features.value, benefits: f.benefits.value, how_to: f.how_to.value, terms: f.terms.value, access_content: f.access_content.value });
    if (g('image')) body.image = await img.resolve();
    if (isNew) await A('POST', '/api/admin/tools', body); else await A('PUT', '/api/admin/tools/' + tool.id, body);
    toast('Imehifadhiwa'); done();
  }); } }, h('h2', null, isNew ? 'Program mpya' : tool.name), parts, h('div', { class: 'row' }, btn, h('button', { class: 'btn ghost', type: 'button', onclick: done }, 'FUTA MABADILIKO')));
  return form;
}

async function toolsTab(box, mode) {
  const [tools, cats] = await Promise.all([A('GET', '/api/admin/tools'), A('GET', '/api/admin/categories')]);
  const reload = () => toolsTab(box, mode);
  const groups = { all: ['all'], instr: ['instr'], price: ['price'], image: ['image'] }[mode];
  const edit = (t) => box.replaceChildren(toolForm(t, cats, groups, reload));
  const move = async (i, d) => { const ids = tools.map((t) => t.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await A('POST', '/api/admin/tools/reorder', { ids }); reload(); };

  if (mode === 'price') {
    box.replaceChildren(h('p', { class: 'muted small' }, 'Badilisha bei na aina (FREE/PREMIUM) ya kila program.'), tools.map((t) => {
      const type = SEL([['free', 'FREE'], ['premium', 'PREMIUM']], t.type); type.value = t.type; const price = NUM(t.price), cur = T(t.currency, { maxlength: 10 });
      const btn = h('button', { class: 'btn primary sm' }, 'HIFADHI');
      btn.onclick = () => act(btn, async () => { await A('PUT', '/api/admin/tools/' + t.id, { type: type.value, price: price.value, currency: cur.value }); toast('Imehifadhiwa'); });
      return h('div', { class: 'list-item' }, h('div', { class: 'grow', style: 'min-width:140px' }, h('b', null, t.name)), h('div', { style: 'width:120px' }, type), h('div', { style: 'width:120px' }, price), h('div', { style: 'width:70px' }, cur), btn);
    }), tools.length ? null : h('div', { class: 'empty' }, 'Hakuna programs bado.'));
    return;
  }
  if (mode === 'image') {
    box.replaceChildren(h('p', { class: 'muted small' }, 'Pakia picha kutoka kwenye simu au computer; picha hupunguzwa ukubwa kiotomatiki.'), tools.map((t) => {
      const ed = imageField(t.image); const btn = h('button', { class: 'btn primary sm' }, 'HIFADHI PICHA');
      btn.onclick = () => act(btn, async () => { await A('PUT', '/api/admin/tools/' + t.id, { image: await ed.resolve() }); toast('Picha imehifadhiwa'); });
      return h('div', { class: 'panel' }, h('b', null, t.name), h('div', { style: 'height:8px' }), ed, h('div', { style: 'height:10px' }), btn);
    }), tools.length ? null : h('div', { class: 'empty' }, 'Hakuna programs bado.'));
    return;
  }
  box.replaceChildren(
    mode === 'all' ? h('button', { class: 'btn primary', style: 'margin-bottom:12px', onclick: () => edit({}) }, '+ ONGEZA PROGRAM') : h('p', { class: 'muted small' }, 'Chagua program ya kuhariri maelekezo yake.'),
    tools.length ? tools.map((t, i) => h('div', { class: 'list-item' }, h('img', { src: imgSrc(t), alt: '' }),
      h('div', { class: 'grow' }, h('b', null, t.name), h('span', { class: 'muted small' }, `${t.category || 'Bila category'} · ${t.type === 'premium' ? money(t.price, t.currency) : 'FREE'}`)),
      h('div', { class: 'acts' }, t.visible ? null : pill('IMEFICHWA', 'warn'),
        mode === 'all' ? [h('button', { class: 'btn ghost sm', 'aria-label': 'Juu', onclick: () => move(i, -1) }, '↑'), h('button', { class: 'btn ghost sm', 'aria-label': 'Chini', onclick: () => move(i, 1) }, '↓')] : null,
        h('button', { class: 'btn ghost sm', onclick: () => edit(t) }, 'HARIRI'),
        mode === 'all' ? [h('button', { class: 'btn ghost sm', onclick: async (e) => act(e.currentTarget, async () => { await A('PUT', '/api/admin/tools/' + t.id, { visible: !t.visible }); reload(); }) }, t.visible ? 'FICHA' : 'ONYESHA'),
          h('button', { class: 'btn danger sm', onclick: async (e) => { if (!confirmDo(`Futa "${t.name}"?`)) return; act(e.currentTarget, async () => { await A('DELETE', '/api/admin/tools/' + t.id); toast('Imefutwa'); reload(); }); } }, 'FUTA')] : null))) : h('div', { class: 'empty' }, 'Hakuna programs bado. Bonyeza "ONGEZA PROGRAM".'));
}

/* ---- categories */
async function categoriesTab(box) {
  const cats = await A('GET', '/api/admin/categories');
  const reload = () => categoriesTab(box);
  const edit = (c) => {
    const f = { name: T(c.name), description: T(c.description) }, img = imageField(c.image), btn = h('button', { class: 'btn primary', type: 'submit' }, 'HIFADHI');
    box.replaceChildren(h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(btn, async () => {
      const body = { name: f.name.value, description: f.description.value, image: await img.resolve() };
      if (c.id) await A('PUT', '/api/admin/categories/' + c.id, body); else await A('POST', '/api/admin/categories', body);
      toast('Imehifadhiwa'); reload();
    }); } }, h('h2', null, c.id ? 'Hariri category' : 'Category mpya'), F('Jina', f.name), F('Maelezo', f.description), F('Picha', img), h('div', { class: 'row' }, btn, h('button', { class: 'btn ghost', type: 'button', onclick: reload }, 'FUTA MABADILIKO'))));
  };
  const move = async (i, d) => { const ids = cats.map((c) => c.id), j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await A('POST', '/api/admin/categories/reorder', { ids }); reload(); };
  box.replaceChildren(h('button', { class: 'btn primary', style: 'margin-bottom:12px', onclick: () => edit({}) }, '+ ONGEZA CATEGORY'),
    cats.map((c, i) => h('div', { class: 'list-item' }, h('img', { src: imgSrc(c), alt: '' }), h('div', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'muted small' }, `${c.tool_count} programs · ${c.description || ''}`)),
      h('div', { class: 'acts' }, h('button', { class: 'btn ghost sm', onclick: () => move(i, -1) }, '↑'), h('button', { class: 'btn ghost sm', onclick: () => move(i, 1) }, '↓'), h('button', { class: 'btn ghost sm', onclick: () => edit(c) }, 'HARIRI'),
        h('button', { class: 'btn danger sm', onclick: (e) => { if (!confirmDo(`Futa category "${c.name}"? Programs zake zitabaki bila category.`)) return; act(e.currentTarget, async () => { await A('DELETE', '/api/admin/categories/' + c.id); reload(); }); } }, 'FUTA')))),
    h('p', { class: 'muted small' }, 'Kubadilisha category ya program: Tools → HARIRI → Category.'));
}

/* ---- payment methods */
async function methodsTab(box) {
  const ms = await A('GET', '/api/admin/methods');
  const reload = () => methodsTab(box);
  const edit = (m) => {
    const f = { provider: T(m.provider), number: T(m.number), receiver: T(m.receiver), instructions: TA(m.instructions, 3), amount: T(m.amount), active: CK('ACTIVE (imewashwa)', m.active), approved: CK('APPROVED (nimethibitisha taarifa hizi ni sahihi)', m.approved) };
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'HIFADHI');
    box.replaceChildren(h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(btn, async () => {
      const body = { provider: f.provider.value, number: f.number.value, receiver: f.receiver.value, instructions: f.instructions.value, amount: f.amount.value, active: f.active.input.checked, approved: f.approved.input.checked };
      if (m.id) await A('PUT', '/api/admin/methods/' + m.id, body); else await A('POST', '/api/admin/methods', body);
      toast('Imehifadhiwa'); reload();
    }); } }, h('h2', null, m.id ? 'Hariri njia ya malipo' : 'Njia mpya ya malipo'),
    F('Jina la huduma ya malipo', f.provider, 'Mfano: jina la mtandao wa pesa za simu au benki.'), F('Namba ya malipo', f.number), F('Jina la mpokeaji', f.receiver), F('Maelezo ya malipo', f.instructions), F('Kiasi kinachotakiwa (hiari)', f.amount),
    f.active, h('div', { style: 'height:8px' }), f.approved, h('div', { style: 'height:12px' }), h('div', { class: 'row' }, btn, h('button', { class: 'btn ghost', type: 'button', onclick: reload }, 'FUTA MABADILIKO'))));
  };
  const toggle = (m, key) => (e) => act(e.currentTarget, async () => { await A('PUT', '/api/admin/methods/' + m.id, { [key]: !m[key] }); reload(); });
  box.replaceChildren(h('p', { class: 'muted small' }, 'Wateja wanaona tu njia zenye ACTIVE na APPROVED. Namba zote unaziingiza wewe; mfumo haubuni namba.'),
    h('button', { class: 'btn primary', style: 'margin-bottom:12px', onclick: () => edit({}) }, '+ ONGEZA NJIA YA MALIPO'),
    ms.length ? ms.map((m) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('b', null, `${m.provider} · ${m.number}`), h('span', { class: 'muted small' }, m.receiver)),
      h('div', { class: 'acts' }, pill(m.active ? 'ACTIVE' : 'INACTIVE', m.active ? 'ok' : 'no'), pill(m.approved ? 'APPROVED' : 'NOT APPROVED', m.approved ? 'ok' : 'warn'),
        m.active && m.approved ? pill('INAONEKANA', 'ok') : pill('IMEFICHWA KWA WATEJA'),
        h('button', { class: 'btn ghost sm', onclick: toggle(m, 'approved') }, m.approved ? 'ONDOA UTHIBITISHO' : 'THIBITISHA'), h('button', { class: 'btn ghost sm', onclick: toggle(m, 'active') }, m.active ? 'ZIMA' : 'WASHA'),
        h('button', { class: 'btn ghost sm', onclick: () => edit(m) }, 'HARIRI'),
        h('button', { class: 'btn danger sm', onclick: (e) => { if (!confirmDo('Futa njia hii ya malipo?')) return; act(e.currentTarget, async () => { await A('DELETE', '/api/admin/methods/' + m.id); reload(); }); } }, 'FUTA')))) : h('div', { class: 'empty' }, 'Hakuna njia ya malipo bado.'));
}

/* ---- payment verification */
async function paymentsTab(box, filter = 'ALL') {
  const list = await A('GET', '/api/admin/payments');
  const reload = (f) => paymentsTab(box, f || filter);
  const shown = list.filter((p) => filter === 'ALL' || p.status === filter);
  const chips = h('div', { class: 'chips' }, ['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => h('button', { class: 'chip' + (filter === s ? ' on' : ''), onclick: () => reload(s) }, s === 'ALL' ? 'Zote' : s)));
  box.replaceChildren(chips, shown.length ? shown.map((p) => {
    const note = T(p.admin_note, { maxlength: 300 }), days = NUM(30);
    const setStatus = (status) => (e) => act(e.currentTarget, async () => { await A('PUT', '/api/admin/payments/' + p.id, { status, admin_note: note.value }); toast('Status: ' + status); reload(); });
    const codeBox = h('div');
    const give = h('button', { class: 'btn primary sm' }, 'TOA ACCESS CODE');
    give.onclick = () => act(give, async () => {
      const r = await A('POST', '/api/admin/codes', { tool_id: p.tool_id, payment_id: p.id, days: days.value });
      codeBox.replaceChildren(h('div', { class: 'codebox' }, r.code), h('button', { class: 'btn ghost sm', onclick: () => copyText(r.code) }, icon('copy'), 'COPY'));
      toast('Access Code imetengenezwa');
    });
    const mismatch = p.tool_price && p.amount !== p.tool_price;
    return h('section', { class: 'panel' },
      h('div', { class: 'row' }, h('div', null, h('b', null, p.tool_name), h('div', { class: 'muted small' }, `${p.user_name} · ${p.user_phone} · ${fmtDate(p.created_at)}`)), pill(p.status, statusKind[p.status])),
      h('div', { class: 'small', style: 'margin:8px 0' }, `Aliyelipa: ${p.payer_name} (${p.payer_number}) · Njia: ${p.method_provider || '—'}`, h('br'), `Kiasi: ${money(p.amount)}  (bei ya program: ${money(p.tool_price, p.currency)})`, h('br'), `Transaction ID: ${p.txn_id}`),
      mismatch ? h('div', { class: 'err small' }, 'Tahadhari: kiasi kilicholipwa hakilingani na bei ya program.') : null,
      h('img', { class: 'proof', src: '/api/admin/proof/' + p.proof_file, alt: 'Screenshot ya muamala', loading: 'lazy' }),
      h('div', { style: 'height:10px' }), F('Maelezo kwa mteja (hiari)', note),
      h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: setStatus('APPROVED') }, 'THIBITISHA (APPROVE)'), h('button', { class: 'btn danger sm', onclick: setStatus('REJECTED') }, 'KATAA'),
        p.status !== 'PENDING' ? h('button', { class: 'btn ghost sm', onclick: setStatus('PENDING') }, 'RUDISHA PENDING') : null),
      p.status === 'APPROVED' ? h('div', { style: 'margin-top:12px' }, p.code ? h('div', null, h('span', { class: 'lbl' }, 'Access Code iliyotolewa'), h('div', { class: 'codebox' }, p.code)) :
        h('div', { class: 'row' }, h('div', { style: 'max-width:150px' }, F('Siku za matumizi (0 = bila kikomo)', days)), h('div', { class: 'no' }, give)), codeBox) : null);
  }) : h('div', { class: 'empty' }, 'Hakuna malipo.'));
}

/* ---- access codes */
async function codesTab(box) {
  const [codes, tools, users] = await Promise.all([A('GET', '/api/admin/codes'), A('GET', '/api/admin/tools'), A('GET', '/api/admin/users')]);
  const reload = () => codesTab(box);
  const premium = tools.filter((t) => t.type === 'premium');
  const tool = SEL(premium.map((t) => [t.id, t.name]), premium[0] && premium[0].id), user = SEL([['', '— Mtumiaji yeyote —'], ...users.map((u) => [u.id, `${u.name} (${u.phone})`])], ''), days = NUM(30);
  const out = h('div'), btn = h('button', { class: 'btn primary', type: 'submit' }, 'TENGENEZA CODE');
  box.replaceChildren(
    premium.length ? h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(btn, async () => {
      const r = await A('POST', '/api/admin/codes', { tool_id: tool.value, user_id: user.value, days: days.value });
      out.replaceChildren(h('div', { class: 'codebox' }, r.code), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copyText(r.code) }, icon('copy'), 'COPY')); toast('Imetengenezwa');
    }); } }, h('h3', null, 'TENGENEZA ACCESS CODE'), F('Program', tool), F('Mtumiaji maalumu (hiari)', user), F('Siku za matumizi (0 = bila kikomo)', days), btn, out,
    h('p', { class: 'muted small' }, 'Kwa malipo ya mteja, tumia "TOA ACCESS CODE" kwenye Uthibitisho wa Malipo ili code iunganishwe na muamala.')) : h('p', { class: 'muted' }, 'Hakuna program ya Premium bado.'),
    codes.length ? codes.map((c) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'codebox', style: 'font-size:15px' }, c.code),
      h('span', { class: 'muted small' }, `${c.tool_name} · ${c.user_name ? 'ya ' + c.user_name : 'yeyote'} · ${c.redeemed_name ? 'imetumika na ' + c.redeemed_name : 'haijatumika'} · ${c.expires_at ? 'hadi ' + fmtDate(c.expires_at) : 'bila kikomo'}`)),
      h('div', { class: 'acts' }, pill(c.status, statusKind[c.status]), h('button', { class: 'btn ghost sm', onclick: () => copyText(c.code) }, icon('copy')),
        h('button', { class: 'btn danger sm', onclick: (e) => { if (!confirmDo('Futa Access Code hii? Mtumiaji atapoteza access.')) return; act(e.currentTarget, async () => { await A('DELETE', '/api/admin/codes/' + c.id); reload(); }); } }, 'FUTA')))) : h('div', { class: 'empty' }, 'Hakuna Access Codes bado.'));
}

/* ---- users */
async function usersTab(box) {
  const users = await A('GET', '/api/admin/users');
  box.replaceChildren(users.length ? users.map((u) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('b', null, u.name), h('span', { class: 'muted small' }, `${u.phone} · malipo ${u.payments} · programs ${u.programs} · alijiunga ${fmtDate(u.created_at)}`)),
    h('div', { class: 'acts' }, u.blocked ? pill('AMEZUIWA', 'no') : null, h('button', { class: 'btn ' + (u.blocked ? 'ghost' : 'danger') + ' sm', onclick: (e) => act(e.currentTarget, async () => { await A('PUT', '/api/admin/users/' + u.id, { blocked: !u.blocked }); usersTab(box); }) }, u.blocked ? 'ONDOA ZUIO' : 'ZUIA')))) : h('div', { class: 'empty' }, 'Hakuna watumiaji bado.'));
}

/* ---- settings-backed tabs */
async function settingsForm(box, title, build, note) {
  const s = await A('GET', '/api/admin/settings');
  const { fields, collect, extra } = build(s);
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'HIFADHI');
  box.replaceChildren(h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(btn, async () => { await A('PUT', '/api/admin/settings', collect()); await window.SM.reload(); toast('Imehifadhiwa'); }); } },
    h('h2', null, title), note ? h('p', { class: 'muted small' }, note) : null, fields, btn), extra || null);
}
const waTest = (num, msg) => { let n = String(num).replace(/\D/g, ''); if (n.startsWith('0')) n = '255' + n.slice(1); else if (n && !n.startsWith('255')) n = '255' + n; return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`; };

const whatsappTab = (box) => settingsForm(box, 'WhatsApp ya Admin', (s) => {
  const num = T(s.wa_number, { inputmode: 'tel' }), msg = TA(s.wa_message, 5);
  return { fields: [F('Namba ya WhatsApp ya Admin', num, 'Namba haionyeshwi kama maandishi kwa wateja; inatumika ndani ya kitufe kimoja tu baada ya kutuma uthibitisho wa malipo.'), F('Ujumbe uliotayarishwa', msg),
    h('button', { class: 'btn ghost', type: 'button', style: 'margin-bottom:12px', onclick: () => window.open(waTest(num.value, msg.value), '_blank', 'noopener') }, icon('wa'), 'JARIBU KIUNGANISHI')], collect: () => ({ wa_number: num.value, wa_message: msg.value }) };
});
const channelTab = (box) => settingsForm(box, 'WhatsApp Channel', (s) => {
  const url = T(s.channel_url, { type: 'url', inputmode: 'url' }), text = T(s.channel_text), on = CK('Kitufe kionekane kwenye Home', s.channel_enabled === '1');
  const del = h('button', { class: 'btn danger sm', type: 'button', onclick: () => { if (!confirmDo('Futa link ya Channel?')) return; act(del, async () => { await A('PUT', '/api/admin/settings', { channel_url: '', channel_enabled: false }); await window.SM.reload(); toast('Link imefutwa'); channelTab(box); }); } }, 'FUTA LINK');
  return { fields: [F('Link ya Channel', url, 'Lazima ianze na https://. Kitufe hakionekani ikiwa link haijawekwa.'), F('Maandishi ya kitufe', text), on, h('div', { style: 'height:12px' }), del, h('div', { style: 'height:12px' })],
    collect: () => ({ channel_url: url.value.trim(), channel_text: text.value, channel_enabled: on.input.checked }) };
});
const appearanceTab = (box) => settingsForm(box, 'Muonekano wa Website', (s) => {
  const f = { site_name: T(s.site_name), tagline: T(s.tagline), intro: TA(s.intro, 3), color_neon: h('input', { type: 'color', value: s.color_neon }), color_cyan: h('input', { type: 'color', value: s.color_cyan }), color_purple: h('input', { type: 'color', value: s.color_purple }) };
  return { fields: [F('Jina la website', f.site_name), F('Kichwa kidogo (tagline)', f.tagline), F('Utambulisho mfupi (Home)', f.intro), h('div', { class: 'row' }, F('Neon green', f.color_neon), F('Cyan', f.color_cyan), F('Purple', f.color_purple))],
    collect: () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) };
});
const aiTab = (box) => settingsForm(box, 'AI Assistant', (s) => {
  const f = { ai_enabled: CK('AI Assistant imewashwa (ON)', s.ai_enabled === '1'), ai_language: T(s.ai_language), ai_instructions: TA(s.ai_instructions, 4), ai_rules: TA(s.ai_rules, 4), ai_model: T(s.ai_model) };
  const qaBox = h('div');
  const loadQA = async () => {
    const qa = await A('GET', '/api/admin/qa'), q = T(''), a = TA('', 3), add = h('button', { class: 'btn primary sm', type: 'button' }, 'ONGEZA');
    add.onclick = () => act(add, async () => { await A('POST', '/api/admin/qa', { question: q.value, answer: a.value }); loadQA(); });
    qaBox.replaceChildren(h('section', { class: 'panel' }, h('h3', null, 'MASWALI NA MAJIBU'), F('Swali', q), F('Jibu', a), add, h('div', { class: 'hr' }),
      qa.length ? qa.map((r) => { const rq = T(r.question), ra = TA(r.answer, 3); const save = h('button', { class: 'btn ghost sm', type: 'button' }, 'HIFADHI'), del = h('button', { class: 'btn danger sm', type: 'button' }, 'FUTA');
        save.onclick = () => act(save, async () => { await A('PUT', '/api/admin/qa/' + r.id, { question: rq.value, answer: ra.value }); toast('Imehifadhiwa'); });
        del.onclick = () => { if (confirmDo('Futa swali hili?')) act(del, async () => { await A('DELETE', '/api/admin/qa/' + r.id); loadQA(); }); };
        return h('div', { style: 'margin-bottom:14px' }, rq, h('div', { style: 'height:6px' }), ra, h('div', { class: 'row', style: 'margin-top:6px' }, save, del)); }) : h('p', { class: 'muted' }, 'Hakuna maswali yaliyofundishwa bado.')));
  };
  loadQA();
  return { fields: [f.ai_enabled, h('div', { style: 'height:12px' }), F('Lugha ya majibu', f.ai_language), F('Maelekezo ya kujibu', f.ai_instructions), F('Sheria za majibu', f.ai_rules), F('Model', f.ai_model, 'AI inaitwa kupitia server. Weka ANTHROPIC_API_KEY kwenye environment variables za server (kamwe si kwenye frontend). AI haibuni bei, namba za malipo wala Access Codes.')],
    collect: () => ({ ai_enabled: f.ai_enabled.input.checked, ai_language: f.ai_language.value, ai_instructions: f.ai_instructions.value, ai_rules: f.ai_rules.value, ai_model: f.ai_model.value }), extra: qaBox };
}, 'Website inafanya kazi vizuri hata AI ikiwa imezimwa.');
const securityTab = async (box) => {
  const s = await A('GET', '/api/admin/settings');
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nxt = h('input', { type: 'password', autocomplete: 'new-password' }), rep = h('input', { type: 'password', autocomplete: 'new-password' });
  const mins = NUM(s.admin_session_minutes), b1 = h('button', { class: 'btn primary', type: 'submit' }, 'BADILISHA PASSWORD'), b2 = h('button', { class: 'btn primary', type: 'submit' }, 'HIFADHI');
  box.replaceChildren(
    h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); if (nxt.value !== rep.value) return toast('Password mpya hazilingani.', true);
      act(b1, async () => { await A('POST', '/api/admin/password', { current: cur.value, next: nxt.value }); toast('Password imebadilishwa. Ingia tena.'); go('/gate'); }); } },
    h('h2', null, 'Badilisha password'), F('Password ya sasa', cur), F('Password mpya (angalau herufi 10)', nxt), F('Rudia password mpya', rep), b1),
    h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); act(b2, async () => { await A('PUT', '/api/admin/settings', { admin_session_minutes: mins.value }); toast('Imehifadhiwa'); }); } },
      h('h2', null, 'Kipindi cha Admin'), F('Muda wa kutotumika kabla ya kutolewa (dakika)', mins, 'Admin akitoka au muda ukiisha, lazima aingize password upya.'), b2),
    h('section', { class: 'panel' }, h('h3', null, 'ULINZI ULIOWASHWA'), h('ul', null, ['Password imehifadhiwa kama hash (scrypt) kwenye server tu.', 'Majaribio ya password: 5 kwa dakika 15 kwa kila IP.', 'Cookie ya session ni HttpOnly, SameSite=Strict (Secure kwenye HTTPS).', 'Screenshots za malipo zinaonekana kwa Admin tu.'].map((t) => h('li', null, t)))));
};

const TABS = [
  ['Dashboard', overview], ['Tools', (b) => toolsTab(b, 'all')], ['Categories', categoriesTab], ['Maelekezo', (b) => toolsTab(b, 'instr')], ['Bei', (b) => toolsTab(b, 'price')], ['Picha', (b) => toolsTab(b, 'image')],
  ['Njia za Malipo', methodsTab], ['Uthibitisho wa Malipo', (b) => paymentsTab(b)], ['Access Codes', codesTab], ['Watumiaji', usersTab], ['WhatsApp', whatsappTab], ['Channel', channelTab],
  ['AI Assistant', aiTab], ['Muonekano', appearanceTab], ['Usalama', securityTab],
];

function adminUI() {
  const box = h('div'), tabs = h('div', { class: 'adm-tabs', role: 'tablist' });
  let cur = 0;
  const open = async (i) => {
    cur = i;
    tabs.replaceChildren(...TABS.map(([label], k) => h('button', { role: 'tab', class: k === cur ? 'on' : '', onclick: () => open(k) }, label)));
    box.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:auto' })));
    try { await TABS[i][1](box); } catch (e) { if (e.status !== 401) box.replaceChildren(h('div', { class: 'err' }, e.message)); }
  };
  open(0);
  return h('div', null, tabs, box);
}
window.SM.adminUI = adminUI;
})();
