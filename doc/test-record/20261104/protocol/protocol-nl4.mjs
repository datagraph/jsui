/**
 * The parts of doc/manual-test-protocol.md the documented specs do not cover,
 * driven IN-APP: this client never changes location.pathname (the router runs
 * with updateLocation:false), so navigation is clicking, not page.goto.
 */
import { chromium } from '/Users/Shared/Development/Source/Library/org/datagraph/jsui/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ORIGIN = 'http://localhost:8100';
const UP = 'https://nl4.dydra.com';
const ACCT = 'playwright';
const TOKEN = readFileSync(`${homedir()}/.dydra/nl4.dydra.com.playwright.token`, 'utf8').trim();
const OUT = process.argv[2];

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok   ${n}${d ? ' — ' + d : ''}`))
                                 : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };
const head = (s) => console.log(`\n${s}`);
const api = (p, i = {}) => fetch(`${UP}${p}`,
  { ...i, headers: { Authorization: `Bearer ${TOKEN}`, ...(i.headers || {}) } });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));

head('protocol 1 — login');
await page.goto(`${ORIGIN}/ui/user`);
await page.waitForTimeout(1500);
ok('1.1  the login form is shown', await page.locator('[data-testid="login-form"]').count() > 0);
await page.fill('[data-testid="login-host-input"]', ORIGIN);
await page.fill('[data-testid="login-username-input"]', ACCT);
await page.fill('[data-testid="login-password-input"]', `:${TOKEN}`);
await page.click('[data-testid="login-submit"]');
await page.waitForTimeout(4000);
ok('1.3  signed in — the account pane is drawn',
   await page.locator('.account-pane').count() > 0);

head('protocol 2.2 / 2.3 / 9.1 — two repositories open, one visible');
for (const r of ['test', 'mcp']) {
  // The account pane is hidden once a repository is open, and a hidden pane's
  // links cannot be clicked — so go back to the account tab first, which is
  // what a user does too.
  const acct = page.locator('[data-tab-link][href="#tab-account-playwright"]').first();
  if (await acct.count()) { await acct.click().catch(() => {}); await page.waitForTimeout(1500); }
  const link = page.locator(`a[href*="/repositories/${r}"]`).first();
  if (await link.count()) {
    await link.click({ timeout: 10000 }).catch((e) => console.log(`  (${r}: ${e.message.split('\n')[0]})`));
    await page.waitForTimeout(3500);
  }
}
const panes = await page.evaluate(() => [...document.querySelectorAll('.repository-pane')]
  .map((p) => ({ repo: p.dataset.repository, shown: getComputedStyle(p).display !== 'none' })));
const tabs = await page.locator('[data-tab-link]').count();
ok('2.2  a tab per opened repository', tabs >= 3, `${tabs} tabs`);
ok('2.3  both repository panes are in the document', panes.length >= 2,
   panes.map((p) => p.repo).join(', '));
ok('9.1  exactly one is displayed — the chrome shows ONE repository',
   panes.filter((p) => p.shown).length === 1,
   `shown: ${panes.filter((p) => p.shown).map((p) => p.repo).join(', ') || '(none)'}`);

head('protocol 4 — the location bar, with no model');
const barState = () => page.evaluate(() => ({
  display: document.querySelector('#location-display')?.textContent?.trim() || '',
  target: document.querySelector('#location-target')?.textContent?.trim() || '',
  reply: document.querySelector('#location-reply')?.textContent?.trim() || '',
  shown: [...document.querySelectorAll('.repository-pane,.account-pane')]
          .filter((e) => getComputedStyle(e).display !== 'none')
          .map((e) => e.dataset.repository || e.dataset.account).join(','),
}));
// The bar is an address bar: the display span is what is shown, and clicking
// it reveals the input (location-bar.js `open').  A driver that fills the
// input directly is filling something display:none.
const bar = async (line) => {
  await page.click('#location-display');
  await page.waitForTimeout(250);
  await page.fill('#location-input', line);
  await page.press('#location-input', 'Enter');
  await page.waitForTimeout(2800);
  return barState();
};
ok('the bar is on the screen', await page.locator('#location-display').count() > 0);
const hosts = await page.evaluate(() =>
  [...document.querySelectorAll('[data-host]')].map((e) => e.dataset.host));
ok('the chrome is the workspace — six hosts', hosts.length === 6, hosts.join(' '));

let r = await bar(`/account/${ACCT}/repositories/mcp`);
ok('4.1  a path navigates', /mcp/.test(r.shown) || /mcp/.test(r.display),
   `shown=${r.shown} display="${r.display}"`);
r = await bar(`goto /account/${ACCT}/repositories/test`);
ok('4.2  goto before a path also navigates', /test/.test(r.shown) || /test/.test(r.display),
   `shown=${r.shown} display="${r.display}"`);
const beforeGoto = r.shown;
r = await bar('goto workspace');
ok('4.3  goto workspace re-addresses and does not navigate',
   /workspace/i.test(r.target) && r.shown === beforeGoto,
   `target="${r.target}" shown=${r.shown}`);
r = await bar('goto zzz-no-such-target');
ok('4.4  an unknown address is refused, not guessed',
   r.reply.length > 0 && !/zzz/.test(r.target),
   `target="${r.target}" reply="${r.reply.slice(0, 120)}"`);

head('defect — the editors pane does not scroll to the editor it just added');
const names = ['protoscroll1', 'protoscroll2', 'protoscroll3'];
for (const n of names) {
  await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/n-quads' },
    body: `SELECT * WHERE { ?s ?p ?o } LIMIT 10`,
  });
}
await page.reload();
await page.waitForTimeout(2000);
await page.fill('[data-testid="login-host-input"]', ORIGIN).catch(() => {});
await page.fill('[data-testid="login-username-input"]', ACCT).catch(() => {});
await page.fill('[data-testid="login-password-input"]', `:${TOKEN}`).catch(() => {});
await page.click('[data-testid="login-submit"]').catch(() => {});
await page.waitForTimeout(4000);
const acct2 = page.locator('[data-tab-link][href="#tab-account-playwright"]').first();
if (await acct2.count()) { await acct2.click().catch(() => {}); await page.waitForTimeout(1500); }
const repoLink = page.locator(`a[href*="/repositories/test"]`).first();
if (await repoLink.count()) {
  await repoLink.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(4500);
}

const rows = [];
for (const n of names) {
  const link = page.locator(`[data-testid="view-edit-${n}"]`).first();
  if (!(await link.count())) { rows.push({ n, found: false }); continue; }
  const before = await page.evaluate(() => ({
    y: window.scrollY,
    n: document.querySelectorAll('.view-editors-container .view-editor').length,
  }));
  await link.click().catch(() => {});
  await page.waitForTimeout(3500);
  const after = await page.evaluate((name) => {
    const eds = [...document.querySelectorAll('.view-editors-container .view-editor')];
    const mine = eds.find((e) => e.dataset.viewName === name);
    const b = mine?.getBoundingClientRect();
    return { y: window.scrollY, n: eds.length, made: Boolean(mine),
             top: b ? Math.round(b.top) : null,
             inView: b ? (b.top >= -4 && b.top < window.innerHeight) : false,
             vh: window.innerHeight,
             docH: document.documentElement.scrollHeight };
  }, n);
  rows.push({ n, found: true, before, after });
}
for (const o of rows) {
  if (!o.found) { console.log(`  --   ${o.n}: no row to click`); continue; }
  console.log(`  ${o.n}: editors ${o.before.n}→${o.after.n}  scrollY ${o.before.y}→${o.after.y}`
            + `  editor top=${o.after.top}/${o.after.vh}  inView=${o.after.inView}`);
}
const made = rows.filter((o) => o.found && o.after?.made);
if (made.length) {
  const last = made[made.length - 1];
  ok('the editors were added', made.length === names.length, `${made.length} of ${names.length}`);
  ok('REPRODUCED — the pane did not scroll to the editor it added',
     last.before.y === last.after.y && !last.after.inView,
     `scrollY stayed ${last.after.y}; the new editor is at y=${last.after.top} `
   + `in a ${last.after.vh}px viewport (page is ${last.after.docH}px)`);
  await page.screenshot({ path: `${OUT}/editor-scroll-defect.png` });
} else {
  console.log('  (no editors were created — the defect check did not run)');
}
for (const n of names) {
  await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`,
            { method: 'DELETE', headers: { Accept: 'application/n-quads' } });
}

head(`page errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ! ${e.slice(0, 160)}`);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
