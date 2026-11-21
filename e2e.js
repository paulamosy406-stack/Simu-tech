'use strict';
// End-to-end API test: boots the real server on a temp database and drives the whole flow.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'simutech-test-'));
const ADMIN_PW = 'test-admin-password-123';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let pass = 0, failed = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✔ ' + name); } else { failed++; console.log('  ✘ ' + name + (extra ? '  -> ' + extra : '')); } };

function client() {
  const jar = {};
  return async (method, url, body, raw) => {
    const headers = { 'X-Requested-With': 'simutech', 'Content-Type': 'application/json' };
    const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) headers.Cookie = c;
    const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)]; }
    if (raw) return r;
    let j = {}; try { j = await r.json(); } catch {}
    if (Array.isArray(j)) return Object.assign(j, { status: r.status });
    return { ...j, status: r.status }; // HTTP status wins over any body field named status
  };
}

(async () => {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js')],
    { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: ADMIN_PW }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/public'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  try {
    const pub = client(), adm = client(), u1 = client(), u2 = client();

    console.log('\n1. Home Page / public data');
    let r = await pub('GET', '/api/public');
    ok(r.status === 200 && r.categories.length === 10, '10 default categories seeded');
    ok(r.tools.length === 0 && r.channel === null, 'no demo tools, no channel button by default');
    ok(!JSON.stringify(r).includes('0632414199') && !JSON.stringify(r).includes('255632414199'), 'admin WhatsApp number not exposed in public data');
    const html = await (await pub('GET', '/', null, true)).text();
    ok(html.includes('SIMUTECH MOD – Technology Tools and Programs') && html.includes('og:image'), 'index has SEO title + social metadata');
    const deep = await pub('GET', '/tool/12345', null, true);
    ok(deep.status === 200 && (await deep.text()).includes('id="app"'), 'direct deep link falls back to index.html');
    ok((await pub('GET', '/uploads/img/..%2F..%2Fsimutech.db', null, true)).status === 404, 'path traversal blocked');
    ok((await pub('GET', '/api/admin/stats')).status === 401, 'admin API requires session');
    ok((await pub('POST', '/api/login', { phone: 'x', password: 'y' })).status !== 403 && (await fetch(BASE + '/api/login', { method: 'POST', body: '{}' })).status === 403, 'POST without CSRF header rejected');

    console.log('\n2. Admin password protection');
    r = await adm('POST', '/api/admin/login', { password: 'wrong' });
    ok(r.status === 401, 'wrong password rejected');
    r = await adm('POST', '/api/admin/login', { password: ADMIN_PW });
    ok(r.status === 200, 'correct password accepted');
    ok((await adm('GET', '/api/admin/me')).status === 200, 'admin session works');
    ok((await u1('GET', '/api/admin/payments')).status === 401, 'normal visitor cannot reach admin API');

    console.log('\n3. Admin management: categories, tools, images');
    r = await adm('POST', '/api/admin/categories', { name: 'Test Cat', description: 'd' });
    const catId = r.id; ok(r.status === 200 && catId, 'add category');
    ok((await adm('PUT', '/api/admin/categories/' + catId, { name: 'Renamed Cat', description: 'x' })).status === 200, 'rename category');
    r = await adm('POST', '/api/admin/upload', { data: PNG });
    ok(r.status === 200 && /^\/uploads\/img\//.test(r.url), 'image upload accepted (PNG)');
    const served = await pub('GET', r.url, null, true); ok(served.status === 200 && served.headers.get('content-type') === 'image/png', 'uploaded image is served');
    const imgUrl = r.url;
    ok((await adm('POST', '/api/admin/upload', { data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status === 400, 'SVG / non-image upload rejected');
    ok((await adm('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + Buffer.from('not really a png at all').toString('base64') })).status === 400, 'fake PNG (bad magic bytes) rejected');
    const free = (await adm('POST', '/api/admin/tools', { name: 'Free Tool', category_id: catId, short_desc: 'short', type: 'free', visible: true, image: imgUrl, access_content: 'https://example.org/free' })).id;
    const prem = (await adm('POST', '/api/admin/tools', { name: 'Premium Tool', category_id: catId, short_desc: 'prem', type: 'premium', price: 5000, visible: true,
      description: 'D', features: 'F', benefits: 'B', how_to: 'H', terms: 'T', access_content: 'SECRET-DOWNLOAD-LINK' })).id;
    const hidden = (await adm('POST', '/api/admin/tools', { name: 'Hidden Tool', type: 'free', visible: false })).id;
    ok(free && prem && hidden, 'add tools without touching source code');
    ok((await adm('POST', '/api/admin/tools', { name: 'Bad Premium', type: 'premium', price: 0 })).status === 400, 'premium tool requires a price');
    r = await pub('GET', '/api/public');
    ok(r.tools.length === 2 && !r.tools.some((t) => t.name === 'Hidden Tool'), 'hidden tool not shown; visible tools appear immediately');
    ok(r.tools[0].image === imgUrl && r.tools.find((t) => t.id === prem).price === 5000, 'card has image, type and price');
    ok((await adm('PUT', '/api/admin/tools/' + hidden, { visible: true })).status === 200 && (await pub('GET', '/api/public')).tools.length === 3, 'show/hide toggle');
    ok((await adm('POST', '/api/admin/tools/reorder', { ids: [prem, free, hidden] })).status === 200 && (await pub('GET', '/api/public')).tools[0].id === prem, 'reorder tools');

    console.log('\n4. Program instructions & free flow');
    r = await pub('GET', '/api/tools/' + prem);
    ok(r.description === 'D' && r.how_to === 'H' && r.terms === 'T' && r.price === 5000, 'instructions page data complete');
    ok(r.access_content === undefined && r.has_access === false, 'premium content hidden without access');
    r = await pub('GET', '/api/tools/' + free);
    ok(r.access_content === 'https://example.org/free', 'free program content available without payment');

    console.log('\n5. Payment methods (approval rule)');
    ok((await pub('GET', '/api/payment-methods')).length === 0, 'no payment numbers exist by default (nothing invented)');
    const mA = (await adm('POST', '/api/admin/methods', { provider: 'ProviderA', number: '111000111', receiver: 'Recv A', active: true, approved: true })).id;
    const mB = (await adm('POST', '/api/admin/methods', { provider: 'ProviderB', number: '222000222', receiver: 'Recv B', active: true, approved: false })).id;
    const mC = (await adm('POST', '/api/admin/methods', { provider: 'ProviderC', number: '333000333', receiver: 'Recv C', active: false, approved: true })).id;
    let pm = await pub('GET', '/api/payment-methods');
    ok(pm.length === 1 && pm[0].provider === 'ProviderA', 'only ACTIVE+APPROVED method visible to customers');
    ok(!JSON.stringify(pm).includes('222000222') && !JSON.stringify(pm).includes('333000333'), 'unapproved / inactive numbers never exposed');
    await adm('PUT', '/api/admin/methods/' + mB, { approved: true });
    ok((await pub('GET', '/api/payment-methods')).length === 2, 'approving a method makes it appear');
    await adm('DELETE', '/api/admin/methods/' + mB);
    ok((await pub('GET', '/api/payment-methods')).length === 1, 'deleting a method removes it');

    console.log('\n6. User accounts & payment proof');
    r = await u1('POST', '/api/register', { name: 'Asha Test', phone: '0711000001', password: 'secret1' });
    ok(r.status === 200 && r.user.name === 'Asha Test', 'register user');
    ok((await u2('POST', '/api/register', { name: 'Juma Test', phone: '0711000002', password: 'secret2' })).status === 200, 'register second user');
    ok((await pub('POST', '/api/payments', { tool_id: prem })).status === 401, 'payment requires login');
    ok((await u1('GET', '/api/wa-link?tool_id=' + prem)).status === 403, 'WhatsApp link refused before submitting proof');
    const payBody = { tool_id: prem, method_id: mA, payer_name: 'Asha', payer_number: '0711000001', amount: 5000, txn_id: 'TX-ABC-1', screenshot: PNG };
    ok((await u1('POST', '/api/payments', { ...payBody, screenshot: '' })).status === 400, 'payment without screenshot rejected');
    ok((await u1('POST', '/api/payments', { ...payBody, tool_id: free })).status === 400, 'cannot pay for a FREE program');
    ok((await u1('POST', '/api/payments', { ...payBody, method_id: mC })).status === 400, 'cannot pay via inactive method');
    r = await u1('POST', '/api/payments', payBody);
    const payId = r.id; ok(r.status === 200 && payId, 'submit payment proof');
    ok((await u2('POST', '/api/payments', payBody)).status === 409, 'duplicate Transaction ID rejected');
    r = await u1('GET', '/api/wa-link?tool_id=' + prem);
    ok(r.status === 200 && r.url.startsWith('https://wa.me/255632414199?text=') && decodeURIComponent(r.url).includes('Habari Admin, nimefanya malipo'), 'WhatsApp link: Tanzania code 255, prepared message');
    ok((await u2('GET', '/api/wa-link?tool_id=' + prem)).status === 403, 'other user without payment cannot get WhatsApp link');
    ok((await u1('GET', '/api/tools/' + prem)).access_content === undefined, 'screenshot alone does NOT grant premium access');

    console.log('\n7. Payment verification & Access Codes');
    r = await adm('GET', '/api/admin/payments');
    ok(r.length === 1 && r[0].status === 'PENDING' && r[0].user_name === 'Asha Test' && r[0].txn_id === 'TX-ABC-1', 'payment visible in admin panel as PENDING');
    const proof = await adm('GET', '/api/admin/proof/' + r[0].proof_file, null, true);
    ok(proof.status === 200 && proof.headers.get('content-type') === 'image/png', 'admin can view proof screenshot');
    ok((await pub('GET', '/api/admin/proof/' + r[0].proof_file, null, true)).status === 401, 'proof screenshots are private');
    ok((await adm('POST', '/api/admin/codes', { tool_id: prem, payment_id: payId, days: 30 })).status === 400, 'cannot issue code before payment is APPROVED');
    ok((await adm('PUT', '/api/admin/payments/' + payId, { status: 'APPROVED', admin_note: 'ok' })).status === 200, 'admin approves payment');
    r = await adm('POST', '/api/admin/codes', { tool_id: prem, payment_id: payId, days: 30 });
    const code = r.code, codeId = r.id; ok(r.status === 200 && /^SM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'admin issues Access Code tied to payment', code);
    ok((await u1('GET', '/api/profile')).codes.some((c) => c.code === code && c.status === 'ACTIVE'), 'code appears in user profile as ACTIVE');
    ok((await u2('POST', '/api/access/verify', { code })).status === 403, 'code bound to user cannot be used by another account');
    ok((await u1('POST', '/api/access/verify', { code: 'SM-AAAA-BBBB-CCCC' })).status === 404, 'wrong code gives clear error');
    r = await u1('POST', '/api/access/verify', { code: code.toLowerCase().replace(/-/g, ' ') });
    ok(r.status === 200 && r.ok, 'correct code verified (case/spacing tolerant)');
    ok((await u1('GET', '/api/tools/' + prem)).access_content === 'SECRET-DOWNLOAD-LINK', 'access granted after verification');
    ok((await u2('GET', '/api/tools/' + prem)).access_content === undefined, 'other users still locked out');
    r = await u1('GET', '/api/profile');
    ok(r.programs.length === 1 && r.payments[0].status === 'APPROVED' && r.user.phone === '0711000001', 'profile: programs, codes, payment history, status');
    ok(!JSON.stringify(r).toLowerCase().includes('admin panel'), 'profile data never mentions Admin Panel');
    // expiry + deletion
    const gift = (await adm('POST', '/api/admin/codes', { tool_id: prem, days: 0 })).code;
    ok((await u2('POST', '/api/access/verify', { code: gift })).status === 200, 'admin-gifted code (no payment, no expiry) works');
    ok((await u1('POST', '/api/access/verify', { code: gift })).status === 409, 'redeemed code cannot be reused by someone else');
    const exp = await adm('POST', '/api/admin/codes', { tool_id: prem, days: 1 });
    // force expiry through direct DB edit
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path.join(DATA, 'simutech.db')); d.prepare('UPDATE access_codes SET expires_at=? WHERE id=?').run(Date.now() - 1000, exp.id); d.close();
    ok((await u1('POST', '/api/access/verify', { code: exp.code })).status === 410, 'expired code rejected with clear message');
    ok((await adm('GET', '/api/admin/codes')).find((c) => c.id === exp.id).status === 'EXPIRED', 'admin sees EXPIRED status');
    ok((await adm('DELETE', '/api/admin/codes/' + codeId)).status === 200 && (await u1('GET', '/api/tools/' + prem)).access_content === undefined, 'deleting a code revokes access');
    ok((await u1('POST', '/api/access/verify', { code })).status === 404, 'deleted code reports invalid');

    console.log('\n8. WhatsApp Channel button');
    ok((await pub('GET', '/api/public')).channel === null, 'hidden when no link');
    ok((await adm('PUT', '/api/admin/settings', { channel_url: 'http://insecure', channel_enabled: true })).status === 400, 'rejects non-https link');
    await adm('PUT', '/api/admin/settings', { channel_url: 'https://whatsapp.com/channel/test123', channel_enabled: true, channel_text: 'FOLLOW CHANNEL YETU YA WHATSAPP KWA TIPS ZAIDI' });
    r = await pub('GET', '/api/public');
    ok(r.channel && r.channel.url === 'https://whatsapp.com/channel/test123' && r.channel.text.startsWith('FOLLOW CHANNEL'), 'button appears with admin link/text');
    await adm('PUT', '/api/admin/settings', { channel_enabled: false });
    ok((await pub('GET', '/api/public')).channel === null, 'admin can switch button off');
    await adm('PUT', '/api/admin/settings', { channel_url: '', channel_enabled: true });
    ok((await pub('GET', '/api/public')).channel === null, 'enabled but no link -> still hidden');

    console.log('\n9. Users, AI settings, password change');
    ok((await adm('GET', '/api/admin/users')).length === 2, 'admin lists users');
    await adm('PUT', '/api/admin/users/' + 2, { blocked: true });
    ok((await u2('POST', '/api/logout')).status === 200 && (await client()('POST', '/api/login', { phone: '0711000002', password: 'secret2' })).status === 403, 'blocked user cannot log in');
    ok((await pub('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] })).status === 503, 'AI off by default; site works without it');
    await adm('PUT', '/api/admin/settings', { ai_enabled: true });
    r = await pub('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] });
    ok(r.status === 503 && /ANTHROPIC_API_KEY/.test(r.error), 'AI enabled but no server key -> clear error, no key in frontend');
    ok((await adm('POST', '/api/admin/qa', { question: 'Q?', answer: 'A.' })).status === 200, 'admin can train AI with Q&A');
    ok((await adm('POST', '/api/admin/password', { current: 'nope', next: 'a-new-password-1' })).status === 401, 'password change needs current password');
    ok((await adm('POST', '/api/admin/password', { current: ADMIN_PW, next: 'a-new-password-1' })).status === 200 && (await adm('GET', '/api/admin/me')).status === 401, 'password changed and admin logged out');
    ok((await adm('POST', '/api/admin/login', { password: ADMIN_PW })).status === 401 && (await adm('POST', '/api/admin/login', { password: 'a-new-password-1' })).status === 200, 'old password dead, new password works');
    await adm('POST', '/api/admin/logout');
    ok((await adm('GET', '/api/admin/me')).status === 401, 'logout closes the session; must log in again');

    console.log('\n10. Admin session timeout');
    ok((await adm('POST', '/api/admin/login', { password: 'a-new-password-1' })).status === 200 && (await adm('GET', '/api/admin/me')).status === 200, 'admin logs in again');
    { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(path.join(DATA, 'simutech.db'));
      d.prepare("UPDATE sessions SET last_seen=? WHERE kind='admin'").run(Date.now() - 31 * 60000); d.close(); }
    ok((await adm('GET', '/api/admin/me')).status === 401, 'admin idle > 30 min is logged out automatically');

    console.log('\n11. Brute-force protection');
    const bf = client(); let last;
    for (let i = 0; i < 8; i++) last = await bf('POST', '/api/admin/login', { password: 'guess' + i });
    ok(last.status === 429, 'rate limit kicks in after repeated bad passwords');
    ok((await bf('POST', '/api/admin/login', { password: 'a-new-password-1' })).status === 429, 'even the right password is locked out during the window');

    console.log('\n12. AI Assistant through the backend (fake upstream, key stays server-side)');
    const http = require('node:http');
    let seen = null;
    const fake = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => (b += c)); rq.on('end', () => { seen = { headers: rq.headers, body: JSON.parse(b) }; rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ content: [{ type: 'text', text: 'Jibu la majaribio' }] })); }); });
    await new Promise((r2) => fake.listen(0, '127.0.0.1', r2));
    const P2 = PORT + 1, D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'simutech-ai-'));
    const srv2 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js')],
      { env: { ...process.env, PORT: String(P2), DATA_DIR: D2, ADMIN_PASSWORD: ADMIN_PW, ANTHROPIC_API_KEY: 'sk-test-secret', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}` }, stdio: ['ignore', 'ignore', 'inherit'] });
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${P2}/api/public`); break; } catch { await new Promise((r2) => setTimeout(r2, 100)); } }
    const call2 = async (m, u2, b, ck) => { const rr = await fetch(`http://127.0.0.1:${P2}${u2}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'simutech', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = rr.headers.getSetCookie()[0]; return { status: rr.status, cookie: sc && sc.split(';')[0], body: await rr.json() }; };
    try {
      const login = await call2('POST', '/api/admin/login', { password: ADMIN_PW }); const ck = login.cookie;
      await call2('POST', '/api/admin/tools', { name: 'Zana Ya Majaribio', type: 'premium', price: 7000, short_desc: 'x', visible: true }, ck);
      await call2('POST', '/api/admin/qa', { question: 'Saa za kazi?', answer: 'Kila siku.' }, ck);
      await call2('PUT', '/api/admin/settings', { ai_enabled: true, ai_rules: 'Kuwa mkarimu.' }, ck);
      const chat = await call2('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Bei ya Zana ni ngapi?' }] });
      ok(chat.status === 200 && chat.body.reply === 'Jibu la majaribio', 'chat returns the model reply');
      ok(seen && seen.headers['x-api-key'] === 'sk-test-secret', 'API key sent from the server only');
      ok(seen.body.system.includes('Zana Ya Majaribio') && seen.body.system.includes('7000') && seen.body.system.includes('Saa za kazi?') && seen.body.system.includes('Kuwa mkarimu.'), 'admin-trained Q&A, rules and real prices are in the prompt');
      ok(/Usibuni bei, namba za malipo/.test(seen.body.system), 'prompt forbids inventing prices, payment numbers or Access Codes');
      ok(!seen.body.system.includes('SM-') && !/payment_methods|number/.test(JSON.stringify(seen.body.messages)), 'no payment numbers or codes passed to the model');
      const pubRes = await (await fetch(`http://127.0.0.1:${P2}/api/public`)).text(); const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
      ok(!pubRes.includes('sk-test-secret') && !js.includes('sk-test-secret') && !/sk-ant/.test(js), 'API key appears in no public response or frontend file');
      await call2('PUT', '/api/admin/settings', { ai_enabled: false }, ck);
      ok((await call2('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] })).status === 503, 'admin OFF switch disables the assistant');
    } finally { srv2.kill(); fake.close(); fs.rmSync(D2, { recursive: true, force: true }); }
  } catch (e) { failed++; console.log('  ✘ test crashed:', e); }
  finally { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
