/**
 * The catalog and the connection, in a real browser (§33.4; §34.1).
 *
 * `ui-catalog.test.mjs' decides what a catalog IS and where a connection
 * lives.  What it cannot decide is whether either is wired to anything: the
 * catalog's buttons have to reach the same channel the bar reaches, the
 * connection's controls have to write through to the account rather than to
 * the panel they are drawn in, and the bar's reply has to survive the chrome
 * being redrawn under it.  Four joins, and a suite of pure functions proves
 * none of them.
 *
 * Three claims:
 *
 *   1. **The catalog lists, and its buttons are the bar.**  Pressing `mount'
 *      beside a presentation sends the same instruction the typed verb sends
 *      (REQ-33.4.3), and the listing is read again afterwards, because what
 *      the verb did changed what the listing says (REQ-33.4.6).
 *
 *   2. **The connection is the account's.**  A key typed into the account's
 *      panel is the key a repository pane reads, with no event between them.
 *
 *   3. **A reply written after a redraw is visible.**  The bar resolves its
 *      reply element when it writes, not when it was wired: every successful
 *      arrangement used to answer into an orphaned node.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css", ".png": "image/png" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found: " + path);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const faults = [];
page.on("pageerror", (e) => faults.push(e.message));
await page.goto(`http://127.0.0.1:${port}/tests/ui-catalog.harness.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

/* ── 1. the listing ───────────────────────────────────────────────────────── */

section("REQ-33.4.1, REQ-33.4.2, REQ-33.4.9: three listings, where the others are");
{
  const rows = await page.locator('[data-testid^="catalog-presentation-"]').count();
  ok(rows === 2, "every presentation in `<account>/ui' is listed");
  ok(await page.locator('[data-testid="catalog-arrangement-stock-card"]').count() === 1,
     "and every arrangement, which nothing outside the tests had ever read");
  const components = await page.locator('[data-testid^="catalog-component-"]').count();
  ok(components > 10,
     "with the toolbox the model is handed on every request, for the user who is not");
  const text = await page.locator(".account-catalog-content").innerText();
  ok(/inventory/.test(text) && /stock-card/.test(text) && /alice\/sales/.test(text),
     "the names are there, and what an arrangement would read");
  // Scoped to the two store listings: the component table legitimately holds
  // a component CALLED `select', which a looser test reads as a query.
  const stored = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(
      '[data-testid^="catalog-presentation-"], [data-testid^="catalog-arrangement-"]')];
    return rows.map((r) => r.innerText).join("\n");
  });
  ok(!/SELECT\s+[?*]|WHERE\s*\{|<script|function\s*\(/i.test(stored),
     "and no text any of them carries: a catalog is read before anything is admitted");
}

section("REQ-33.4.5: the scope decides what is offered");
{
  const mountable = await page.locator('[data-testid="catalog-verb-inventory"]').count();
  const chrome = await page.locator('[data-testid="catalog-verb-workspace"]').count();
  ok(mountable === 1, "a document presentation is offered a mount");
  ok(chrome === 0, "the workspace presentation is not offered one it would be refused");
}

/* ── 2. a button is the bar ───────────────────────────────────────────────── */

section("REQ-33.4.3: the catalog does what the bar does, by doing it");
{
  const before = await page.evaluate(() => window.__reads);
  await page.locator('[data-testid="catalog-verb-inventory"]').click();
  await page.waitForFunction(() => window.__arranged.length > 0, { timeout: 5000 });
  const sent = await page.evaluate(() => window.__arranged[0]);
  ok(sent.kind === "arrangement" && sent.verb === "mount" && sent.presentation === "inventory",
     "the press produced the instruction the typed verb produces — not a second path");
  ok(await page.evaluate(() => window.__app.locationBar.address()?.id) === "workspace",
     "having addressed the workspace first, because a verb acts on what the bar addresses");
  ok(/mounted `inventory'/.test(await page.evaluate(() => window.__reply())),
     "the bar answers where it answers for a typed verb");
  await page.waitForFunction((n) => window.__reads > n, before, { timeout: 5000 });
  const after = await page.locator('[data-testid="catalog-presentation-inventory"]').innerText();
  ok(/workspace/.test(after),
     "and the listing is read again: what the verb did changed where the presentation is");
  ok(await page.locator('[data-testid="catalog-verb-inventory"]').innerText() === "unmount",
     "so the button now offers the verb that is available, not the one that was");
}

/* ── 3. the connection ────────────────────────────────────────────────────── */

section("REQ-34.1.1, REQ-34.1.2: typed into the account, read by a repository's pane");
{
  ok(await page.locator('[data-testid="connection-location"]').count() === 1
     && await page.locator('[data-testid="connection-model"]').count() === 1,
     "the account's settings carry the two linked menus the panes draw");
  await page.locator('[data-testid="connection-key"]').fill("sk-account-test");
  ok(await page.evaluate(() => window.__key()) === "sk-account-test",
     "a key typed here is the account's connection");
  ok(await page.evaluate(() => window.__paneSees()) === "sk-account-test",
     "and a repository pane made afterwards reads it, with no event between them");
  const state = await page.locator('[data-testid="connection-state"]').innerText();
  ok(/connected/.test(state), "the panel says so");
  ok(/never written to a repository/.test(
       await page.locator(".connection-panel").innerText()),
     "and says what becomes of the key, which is nothing");
}

/* ── 4. the reply that used to be lost ────────────────────────────────────── */

section("a reply written after the chrome was redrawn");
{
  await page.evaluate(() => window.__rebuildBar());
  await page.evaluate(() => window.__app.locationBar.say("mounted `inventory'"));
  ok(await page.evaluate(() => window.__reply()) === "mounted `inventory'",
     "the bar writes into the reply element that is in the document NOW");
}

section("REQ-34.2: an answer is folded, not truncated");
{
  await page.evaluate(() => window.__app.locationBar.setAddress("workspace"));
  await page.evaluate(() => window.__app.locationBar.submit("how many open orders in sales"));
  await page.waitForFunction(() => window.__instructed.length > 0, { timeout: 5000 });
  ok(await page.locator('[data-testid="location-more"]').count() === 1,
     "a reply with an answer behind it offers to show it");
  ok(await page.locator('[data-testid="location-detail"]').isHidden(),
     "folded away until it is asked for");
  await page.locator('[data-testid="location-more"]').click();
  ok(await page.locator('[data-testid="location-detail"]').isVisible(),
     "and shown in place, under the bar where the question was typed");
}

ok(faults.length === 0, `nothing threw in the page${faults.length ? `: ${faults[0]}` : ""}`);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
