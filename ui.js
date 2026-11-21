'use strict';
// Optional browser test (needs Playwright + Chrome, which are NOT project dependencies).
// Usage: node test/ui.js [screenshotDir]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 3800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'simutech-ui-'));
const SHOTS = process.argv[2] || path.join(DATA, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ADMIN_PW = 'ui-test-admin-pass-1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let pass = 0, failed = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n + (x ? '  -> ' + x : '')); } };

async function seed() {
  let cookie = '';
  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'simutech', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.getSetCookie()[0]; if (sc) cookie = sc.split(';')[0];
    return r.json();
  };
  await call('POST', '/api/admin/login', { password: ADMIN_PW });
  const cats = await call('GET', '/api/admin/categories');
  const mk = (name, cat, type, price, short) => call('POST', '/api/admin/tools', { name, category_id: cats[cat].id, short_desc: short, type, price, visible: true,
    description: 'Maelezo kamili ya ' + name, features: 'Kazi 1\nKazi 2', benefits: 'Faida 1', how_to: '1. Fungua\n2. Tumia', terms: 'Tumia kwa uwajibikaji', access_content: 'https://example.org/' + name.replace(/ /g, '-') });
  await mk('Network Scanner Pro', 2, 'premium', 15000, 'Skani mitandao ya karibu kwa haraka na usalama.');
  await mk('Android Cleaner', 0, 'free', 0, 'Safisha simu yako na uongeze nafasi.');
  await mk('Privacy Shield', 4, 'premium', 8000, 'Linda faragha yako mtandaoni.');
  await mk('Code Formatter', 7, 'free', 0, 'Panga code yako kiotomatiki.');
  await call('POST', '/api/admin/methods', { provider: 'Njia Moja', number: '700111222', receiver: 'Jina La Mpokeaji', instructions: 'Tuma kisha uweke Transaction ID.', active: true, approved: true });
  await call('POST', '/api/admin/methods', { provider: 'Njia Isiyothibitishwa', number: '999888777', receiver: 'Hapana', active: true, approved: false });
  await call('PUT', '/api/admin/settings', { channel_url: 'https://whatsapp.com/channel/uitest', channel_enabled: true });
}

(async () => {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js')],
    { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: ADMIN_PW }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/public'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    await seed();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
    await ctx.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/')) errors.push(`${r.status()} ${r.url()}`); });
    const body = () => page.evaluate(() => document.body.innerText);
    const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };

    console.log('\nHome (mobile 390px)');
    await page.goto(BASE + '/'); await page.waitForSelector('.card');
    let txt = await body();
    ok((await page.title()) === 'SIMUTECH MOD – Technology Tools and Programs', 'page title');
    ok((await page.$$('.card')).length === 4, '4 tool cards rendered');
    ok((await page.$$eval('.card .btn', (b) => b.map((x) => x.textContent))).every((t) => t === 'FUNGUA PROGRAM'), 'every card has FUNGUA PROGRAM button');
    ok(await page.$$eval('.card img', (i) => i.every((x) => x.getAttribute('src'))), 'every card has an image');
    ok((await page.$$('.badge.free')).length === 2 && (await page.$$('.badge.premium')).length === 2, 'FREE / PREMIUM badges');
    ok(txt.includes('TSh 15,000'), 'premium price shown on card');
    for (const bad of ['ZANA ZINAZOVUMA', 'AI TOOLS', 'VINJARI ZANA ZOTE', 'MAKUNDI YA ZANA', 'PATA ACCESS CODE HAPA', 'ADMIN PANEL', '0632414199', '255632414199']) ok(!txt.toUpperCase().includes(bad), `no "${bad}" text on Home`);
    ok(txt.includes('FOLLOW CHANNEL YETU YA WHATSAPP KWA TIPS ZAIDI'), 'WhatsApp Channel follow button shown');
    ok((await page.$eval('.channel a', (a) => a.href)) === 'https://whatsapp.com/channel/uitest', 'channel button goes to admin-set link');
    const navLabels = await page.$$eval('nav.bottom a', (a) => a.map((x) => x.textContent));
    ok(JSON.stringify(navLabels) === JSON.stringify(['HOME', 'TOOLS', 'CATEGORIES', 'PROFILE']), 'bottom navigation: HOME / TOOLS / CATEGORIES / PROFILE');
    const lock = await page.$('footer .lock'); ok(lock && (await lock.innerText()) === '', 'small lock icon in footer, no text');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow on mobile');
    ok(await page.$eval('nav.bottom', (n) => getComputedStyle(n).position === 'fixed'), 'bottom nav fixed');
    await shot('01-home-mobile');
    await page.fill('.search input', 'privacy'); ok((await page.$$('.card')).length === 1, 'search filters tools');
    await page.fill('.search input', '');

    console.log('\nTools / Categories nav');
    await page.click('nav.bottom a:nth-child(2)'); await page.waitForSelector('.chips');
    ok((await page.$$('.card')).length === 4 && (await page.$$('.chip')).length >= 2, 'TOOLS page with category chips');
    await page.click('nav.bottom a:nth-child(3)'); await page.waitForSelector('.cat-card');
    ok((await page.$$('.cat-card')).length === 10, 'CATEGORIES page lists 10 categories');
    await shot('02-categories-mobile');
    await page.click('.cat-card:nth-child(3)'); await page.waitForSelector('.card');
    ok((await body()).includes('Network Scanner Pro'), 'category page lists its tools');

    console.log('\nProgram instructions (premium)');
    await page.goto(BASE + '/#/'); await page.waitForSelector('.card');
    await page.click('.card:has-text("Network Scanner Pro") .btn'); await page.waitForSelector('.notice');
    txt = await body();
    ok(txt.includes('PROGRAM HII NI YA KULIPIA') && txt.includes('Program hii inahitaji malipo ili uweze kupata Access Code'), 'premium notice text');
    ok(txt.includes('Kazi 1') && txt.includes('Faida 1') && txt.includes('1. Fungua') && txt.includes('Tumia kwa uwajibikaji') && txt.includes('TSh 15,000'), 'features, benefits, how-to, terms, price shown');
    ok(!txt.includes('example.org/Network'), 'premium access content NOT revealed before access');
    await shot('03-tool-premium-mobile');

    console.log('\nPay flow (register -> pay -> proof -> WhatsApp)');
    await page.click('.notice .btn.purple'); await page.waitForURL(/#\/login/);
    await page.click('text=Jisajili'); await page.waitForSelector('input[autocomplete="name"]');
    await page.fill('input[autocomplete="name"]', 'Asha Mteja'); await page.fill('input[type=tel]', '0712345678'); await page.fill('input[type=password]', 'siri123');
    await page.click('button:has-text("JISAJILI")'); await page.waitForURL(/#\/pay\/1$/);
    await page.waitForSelector('.method');
    txt = await body();
    ok((await page.$$('.method')).length === 1 && txt.includes('700111222') && txt.includes('Jina La Mpokeaji'), 'shows the one approved payment method');
    ok(!txt.includes('999888777'), 'unapproved payment number is invisible');
    ok(txt.includes('COPY PAYMENT NUMBER') && txt.includes('SUBMIT PAYMENT PROOF'), 'copy button + submit button present');
    await page.click('button:has-text("COPY PAYMENT NUMBER")'); await page.waitForSelector('#toast.show');
    ok((await page.textContent('#toast')) === 'Imenakiliwa', 'copy gives feedback');
    await page.click('button:has-text("SUBMIT PAYMENT PROOF")');
    ok((await page.textContent('.err')).includes('screenshot'), 'missing screenshot gives clear error');
    const f = page.locator('form input[type=text], form input[type=tel], form input[type=number]');
    await page.fill('form input[type=tel]', '0712345678'); await page.fill('form input[type=number]', '15000');
    await page.locator('form input[type=text]').first().fill('Asha Mteja');
    await page.locator('form input[autocapitalize=characters]').fill('uitx-001');
    await page.setInputFiles('input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.preview[src^="data:"]');
    ok(true, 'screenshot preview appears');
    await shot('04-payment-mobile');
    await page.click('button:has-text("SUBMIT PAYMENT PROOF")'); await page.waitForURL(/#\/submitted\/1$/);
    txt = await body();
    ok(txt.includes('WHATSAPP – PATA ACCESS CODE'), 'WhatsApp button appears after submitting proof');
    ok(!/0632414199|255632414199|632414199/.test(txt), 'admin number not shown as text');
    await page.click('button:has-text("WHATSAPP – PATA ACCESS CODE")'); await page.waitForTimeout(400);
    const opened = await page.evaluate(() => window.__opened);
    ok(opened.length === 1 && opened[0].startsWith('https://wa.me/255632414199?text=') && decodeURIComponent(opened[0]).includes('Naomba unisaidie kupata Access Code'), 'button opens wa.me with TZ country code + prepared message', opened[0]);
    await shot('05-submitted-mobile');

    console.log('\nAccess Code input');
    await page.click('text=NINA ACCESS CODE'); await page.waitForSelector('.access-input');
    const inp = await page.$('.access-input');
    ok((await inp.getAttribute('placeholder')) === null && (await inp.inputValue()) === '' && (await page.$$eval('.access-wrap input', (i) => i.length)) === 1, 'Access Code input is empty: no placeholder, no value, no text');
    ok((await body()).includes('VERIFY ACCESS CODE'), 'VERIFY ACCESS CODE button');
    await inp.fill('SM-WRONG-CODE-0000'); await page.click('button:has-text("VERIFY ACCESS CODE")'); await page.waitForSelector('.err:not(:empty)');
    ok((await page.textContent('.err')).includes('si sahihi'), 'wrong code -> understandable message');
    await shot('06-access-mobile');

    console.log('\nProfile (normal user)');
    await page.click('nav.bottom a:nth-child(4)'); await page.waitForSelector('text=HISTORIA YA MALIPO');
    txt = await body();
    ok(txt.includes('Network Scanner Pro') && txt.includes('UITX-001') && txt.includes('INASUBIRI'), 'payment history + request status shown');
    ok(!/admin panel/i.test(txt) && !/WHATSAPP –/.test(txt), 'profile has no Admin Panel word and no WhatsApp admin button');
    await shot('07-profile-mobile');

    console.log('\nAdmin gate & panel');
    await page.click('footer .lock'); await page.waitForSelector('input[type=password]');
    const pw = await page.$('input[type=password]');
    txt = (await body()).trim();
    ok((await pw.getAttribute('placeholder')) === null && (await pw.inputValue()) === '', 'password field empty, no placeholder');
    ok(!/admin/i.test(txt) && (await page.$$eval('.access-wrap input', (i) => i.length)) === 1, 'gate shows no "Admin" wording; only the blank field and button');
    await shot('08-gate-mobile');
    await pw.fill('wrong-password'); await page.click('button[type=submit]'); await page.waitForSelector('.err:not(:empty)');
    ok((await page.textContent('.err')).includes('si sahihi'), 'wrong admin password rejected');
    await pw.fill(ADMIN_PW); await page.click('button[type=submit]'); await page.waitForSelector('.adm-tabs');
    const tabs = await page.$$eval('.adm-tabs button', (b) => b.map((x) => x.textContent));
    ok(tabs.length === 15, '15 admin sections', tabs.join(', '));
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'admin panel fits mobile width');
    await shot('09-admin-dashboard-mobile');
    await page.click('.adm-tabs button:has-text("Uthibitisho wa Malipo")'); await page.waitForSelector('.proof');
    await shot('10-admin-payments-mobile');
    await page.click('button:has-text("THIBITISHA (APPROVE)")'); await page.waitForSelector('button:has-text("TOA ACCESS CODE")');
    await page.click('button:has-text("TOA ACCESS CODE")'); await page.waitForSelector('.codebox');
    const code = (await page.textContent('.codebox')).trim();
    ok(/^SM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'admin issued code from the UI', code);
    await page.click('.adm-tabs button:has-text("Njia za Malipo")'); await page.waitForSelector('.list-item');
    ok((await body()).includes('IMEFICHWA KWA WATEJA'), 'unapproved method flagged as hidden from customers');
    await page.click('.adm-tabs button:has-text("Tools")'); await page.waitForSelector('.list-item');
    await page.click('button:has-text("+ ONGEZA PROGRAM")'); await page.waitForSelector('form.panel input[type=file]');
    await page.locator('form.panel input[type=text]').first().fill('Mpya Kutoka Admin');
    await page.setInputFiles('form.panel input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.preview[src^="data:"]');
    await shot('11-admin-tool-form-mobile');
    await page.click('form.panel button:has-text("HIFADHI")'); await page.waitForSelector('.list-item:has-text("Mpya Kutoka Admin")');
    ok(true, 'new program added through the panel (with image upload + preview)');
    await page.click('button:has-text("TOKA")'); await page.waitForSelector('input[type=password]');
    await page.goto(BASE + '/#/admin'); await page.waitForSelector('input[type=password]');
    ok(true, 'after logout, /admin returns to the password screen');

    console.log('\nUser verifies the code; new program visible on Home');
    await page.goto(BASE + '/#/access/1'); await page.waitForSelector('.access-input');
    await page.fill('.access-input', code); await page.click('button:has-text("VERIFY ACCESS CODE")'); await page.waitForSelector('.okmsg');
    ok((await body()).includes('https://example.org/Network-Scanner-Pro'), 'verified code reveals program access content');
    await page.goto(BASE + '/#/'); await page.waitForSelector('.card');
    ok((await body()).includes('Mpya Kutoka Admin'), 'program added by admin appears on Home immediately');

    console.log('\nDesktop layout');
    const dctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const dp = await dctx.newPage(); await dp.goto(BASE + '/'); await dp.waitForSelector('.card');
    ok(await dp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no overflow on desktop');
    ok(await dp.$eval('.top-links', (e) => getComputedStyle(e).display !== 'none'), 'top menu visible on desktop');
    await dp.waitForTimeout(900); await dp.screenshot({ path: path.join(SHOTS, '12-home-desktop.png') });
    const tctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    const tp = await tctx.newPage(); await tp.goto(BASE + '/'); await tp.waitForSelector('.card');
    ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no overflow on tablet');
    await tp.waitForTimeout(900); await tp.screenshot({ path: path.join(SHOTS, '13-home-tablet.png') });

    ok(errors.length === 0, 'no JavaScript / console errors', errors.slice(0, 3).join(' | '));
  } catch (e) { failed++; console.log('  ✘ crashed:', e.message.split('\n').slice(0, 4).join(' ')); }
  finally { await browser.close(); srv.kill(); }
  console.log(`\n${pass} passed, ${failed} failed. Screenshots: ${SHOTS}`);
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 2 });
  process.exit(failed ? 1 : 0);
})();
