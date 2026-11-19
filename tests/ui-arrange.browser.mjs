/**
 * Arrange, end to end, in a real browser — and the figures that show it
 * (U-80 … U-88; D-AV, §21).
 *
 * `ui-arrangement.test.mjs' decides what lift, apply and mount MEAN.  What
 * it cannot decide is whether the verbs are wired to anything: every one of
 * them crosses the bar, a target registry, a pane that owns a document, a
 * frame it cannot reach into, a store that has to be written in the right
 * order, and — for a mount — a press that must come from outside every
 * document on the screen.  Six joins, and a suite of pure functions proves
 * none of them.
 *
 * Four claims, in the order they are driven:
 *
 *   1. **An arrangement verb reaches the thing the bar is addressing.**  The
 *      chrome takes `mount'; a page takes `lift' and `apply'; each refuses
 *      the other's verbs in words that say where to go instead.  `arrange'
 *      is a second channel beside `instruct' and no model is asked anything
 *      — asserted by counting provider turns, which stay at two for the two
 *      pages and never move again.
 *
 *   2. **An applied component goes on asking its own source.**  The
 *      arrangement is lifted from a page over `alice/parts' and applied into
 *      a page over `alice/orders', and the request has to arrive at PARTS.
 *      One repository would make a wrong implementation look right, so there
 *      are two.
 *
 *   3. **The reader sees the request before it is sent.**  An apply shows
 *      the query text and the address it goes to, and nothing runs until the
 *      press.  §20 withholds four carriers of executable text; a template's
 *      request text is a fifth, and this is where it is looked at.
 *
 *   4. **A mount is drawn by a press and never by the page.**  The band is
 *      inert until pressed, a second mount of the same presentation is
 *      refused by the store's own guard, and unmounting takes the band away.
 *
 * As it goes it writes the figures of `doc/arrange-sequence/': every image
 * is a step this suite asserted, captioned with the claim it carries.  A
 * figure that disagrees with the code is therefore a figure that cannot be
 * produced — and a sequence that stops early is a suite that failed.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "doc", "arrange-sequence");
const IMAGES = join(SHOTS, "images");
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
const section = (title) => console.log(`\n${title}`);

await mkdir(IMAGES, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 900 },
                                     deviceScaleFactor: 2 });
const faults = [];
page.on("pageerror", (e) => { faults.push(e.message); });
await page.goto(`http://127.0.0.1:${port}/tests/ui-arrange.harness.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const settle = (ms = 200) => page.waitForTimeout(ms);
const reply = () => page.evaluate(() => window.__reply());
const asked = () => page.evaluate(() => window.__asked.map((a) => a.repository));
const turns = () => page.evaluate(() => window.__llm);

/* ── the figures ──────────────────────────────────────────────────────────── */

const figures = [];
let shot = 0;
/**
 * One figure: a number, a file, and the claim it is evidence for.
 *
 * `of' photographs one element — used for the bar, which is a strip.  `at'
 * scrolls something into view and photographs the VIEWPORT, which is what a
 * page containing a frame needs: an element screenshot of a pane is a tall
 * image of mostly nothing, because the frame is scrolled past rather than
 * drawn at every offset.
 */
async function figure(what, claim, { of = null, at = null } = {}) {
  shot += 1;
  const name = `${String(shot).padStart(2, "0")}-${what}`;
  if (at) {
    // Top-aligned, not merely "in view": a page frame is taller than the
    // window, and scrolling it just-into-view puts its BOTTOM on the screen,
    // which for a page whose content is at the top is a photograph of white.
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: "start", behavior: "instant" });
    }, at);
    await page.waitForTimeout(250);
  }
  const target = of ? page.locator(of) : page;
  await target.screenshot({ path: join(IMAGES, `${name}.png`) });
  figures.push({ name, claim });
  return name;
}

/* ── opening the two pages ────────────────────────────────────────────────── */

async function openPane(repository, prompt) {
  await page.evaluate(([r, p]) => { window.__answer = r; window.__openPane(r, p); },
                      [repository, prompt]);
  const pane = `#dashboard-alice-${repository}`;
  await page.locator(`${pane} [data-testid="dashboard-grant"]`).click();
  await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).waitFor({ timeout: 10000 });
  await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).click();
  await page.locator(`${pane} [data-testid="dashboard-frame-holder"] iframe`)
            .waitFor({ timeout: 10000 });
  await settle(400);
  // The grant form and the panel gate are folded away for the figures.  They
  // are phase 1 and 2's business and they are documented where they belong;
  // what these pictures are of is the page and what is done TO it, and a
  // figure is only evidence of the thing a reader can find in it.
  for (const which of ["gate0", "phase1", "gate1"]) {
    const toggle = page.locator(`${pane} [data-testid="dashboard-toggle-${which}"]`);
    if (await toggle.count()) await toggle.click();
  }
  await settle(200);
  return pane;
}

section("the two pages, each over its own repository");
const PARTS_PANE = await openPane("parts", "what is on hand, by region");
const ORDERS_PANE = await openPane("orders", "which orders are still open");
ok(await page.locator(`${PARTS_PANE} iframe`).count() === 1, "the parts page is on the screen");
ok(await page.locator(`${ORDERS_PANE} iframe`).count() === 1, "and so is the orders page");
ok(await turns() === 2, "one provider turn each, and no more");
ok((await asked()).join(",") === "parts,orders",
   "each asked its own repository, and only its own");

const PARTS_ID = await page.evaluate(() => window.__app.uiTargets.get("dashboard-alice-parts")
                                             ?.document()?.id);
const ORDERS_ID = await page.evaluate(() => window.__app.uiTargets.get("dashboard-alice-orders")
                                              ?.document()?.id);
ok(/^app-\d{14}-[0-9a-f]{6}$/.test(PARTS_ID || ""),
   `a page's identity can be written in the bar's grammar: ${PARTS_ID}`);

/* ═════════════════════════ 1. lift (U-80, U-81, U-83) ═════════════════════ */

section("U-81: a component is lifted from the page the bar is addressing");

await page.evaluate(() => window.__app.locationBar.setAddress("dashboard-alice-parts"));
await settle(150);
await figure("addressed", "The page a component will be lifted from, and the bar saying what "
                        + "a line typed into it will act on. `arrange' goes to the same address "
                        + "prose does.",
             { at: `${PARTS_PANE} [data-testid="dashboard-frame-holder"]` });

await page.evaluate((id) => window.__type(`lift ${id}#e-card as stock-card`), PARTS_ID);
await settle(120);
await figure("lift-typed", "`lift <presentation>#<anchor> as <name>' — exact, whole-string, and "
                         + "never sent to a model. The anchor is the element's `data-ui'.",
             { of: "#location-bar" });

const lifted = await page.evaluate((id) => window.__submit(`lift ${id}#e-card as stock-card`),
                                   PARTS_ID);
await settle(200);
ok(lifted?.result?.ok === true, `the lift is performed where the bar points: ${lifted?.result?.message}`);
ok(/1 request/.test(lifted?.result?.message || ""),
   "and the reply says what the arrangement will have to repeat");
ok(await turns() === 2, "no provider turn was spent on it: an exact line is not asked of a model");
ok((await asked()).length === 2, "and nothing was run — a lift is a read of the page");

await figure("lift-done", "The reply, and an undo beside it: the undo of a lift is to forget "
                        + "the entry, because a lift changed nothing on the page.",
             { of: "#location-bar" });

const catalogued = await page.evaluate(async () => {
  const { listArrangements } = await import("/lib/app/ui-store.js");
  return listArrangements({ host: location.origin, account: "alice", token: "test-token" });
});
ok(catalogued.arrangements?.length === 1, "the catalogue has it");
ok(catalogued.arrangements[0].sources?.[0]?.includes("alice/parts"),
   `and records the source its requests will be repeated against: `
   + `${catalogued.arrangements[0].sources?.[0]}`);
ok(!("template" in (catalogued.arrangements[0] || {})),
   "and the listing does not carry the template: U-83 lists without disclosing");

/* ═══════════════════ 2. apply, and the disclosure (U-82, U-84, U-88) ══════ */

section("U-88: what an applied component will ask for, before it asks");

await page.evaluate(() => window.__app.locationBar.setAddress("dashboard-alice-orders"));
const applying = await page.evaluate(() => window.__submit("apply stock-card into e-slot"));
await page.locator(`${ORDERS_PANE} [data-testid="arrange-apply"]`).waitFor({ timeout: 5000 });
await settle(250);

ok(applying?.result?.ok === true, "the verb is accepted by the page that was addressed");
ok(/waiting for you in the pane/.test(applying?.result?.message || ""),
   "and answers that it is waiting, because an apply is not done by the typing");
ok((await asked()).length === 2, "nothing has run yet: the gate is before the request, not after");

const where = await page.locator(`${ORDERS_PANE} [data-testid="arrange-where-onhand"]`).textContent();
ok(/alice\/parts/.test(where || ""),
   `the gate says where the request goes, and it is not this page's repository: ${where}`);
const shown = await page.locator(`${ORDERS_PANE} [data-testid="arrange-query-onhand"]`)
                       .textContent();
ok(/onHand/.test(shown || ""), "the query text is shown whole — the fifth carrier, looked at");
const credentials = await page.locator(`${ORDERS_PANE} [data-testid="arrange-credentials"]`)
                              .textContent();
ok(/YOUR credentials/.test(credentials || ""),
   "and whose credentials it will run under is said, not implied");

await figure("disclosure", "An apply costs queries the reader has never seen, against addresses "
                         + "the arrangement's author chose. Both are shown, and nothing has run.",
             { at: `${ORDERS_PANE} [data-testid="arrange-apply"]` });

section("U-84: the applied component repeats its request against its OWN source");

await page.locator(`${ORDERS_PANE} [data-testid="arrange-apply"]`).click();
await page.waitForFunction(() => window.__asked.length > 2, { timeout: 10000 });
await settle(600);

const after = await asked();
ok(after.length === 3, "exactly one more request ran: one apply, one panel");
ok(after[2] === "parts",
   `and it went to \`parts', the source the inclusion had — not to \`orders', `
   + `the page it now sits in (got: ${after[2]})`);
ok(await turns() === 2, "still two provider turns: nothing about an apply is asked of a model");

const appliedDoc = await page.evaluate(() =>
  window.__app.uiTargets.get("dashboard-alice-orders").document());
ok((appliedDoc.panels || []).length === 2, "the destination gained the panel the component needs");
ok((appliedDoc.panels || []).some((p) => p.source?.repository === "parts"),
   "and the panel carries the source, so a reload repeats the same request to the same place");
ok((appliedDoc.parameters || []).some((p) => p.name === "region"),
   "the parameter the control edits came with it (D-AQ): a copy without it would render dead");

const slot = await page.evaluate(() => {
  const d = window.__app.uiTargets.get("dashboard-alice-orders").document();
  const find = (ns) => { for (const n of ns) { if (n.name === "e-slot") return n;
                                               const f = find(n.children || []); if (f) return f; }
                         return null; };
  return (find(d.views[0].elements)?.children || []).length;
});
ok(slot === 2, "it landed where it was told to land: `into e-slot', beside what was there");

// The claim an element count cannot make: it is ON THE SCREEN.  An applied
// component brings components the destination never used, and a frame
// inlines only the toolbox its document asks for — so a page that gained
// the elements and not the toolbox renders an empty space and reports
// success, which is the failure §21.4.2 exists to rule out.
const frame = page.frameLocator(`${ORDERS_PANE} [data-testid="dashboard-frame-holder"] iframe`);
await settle(600);
await frame.locator("dydra-panel").first().waitFor({ timeout: 5000 });
const drawn = await frame.locator("dydra-panel").first().innerText();
ok(/On hand/.test(drawn), `the component is drawn, with its own label: ${drawn.split("\n")[0]}`);
ok(/bolt-m6/.test(drawn), "and filled with the rows its request brought back from `parts'");
const uses = await page.evaluate(() =>
  window.__app.uiTargets.get("dashboard-alice-orders").document().uses);
ok(uses.includes("panel") && uses.includes("select"),
   `it brought the components it is made of: ${uses.join(", ")}`);

await settle(400);
await figure("applied", "The component is in the second page, drawn from data fetched for it — "
                      + "and the log line says which repository answered.",
             { at: `${ORDERS_PANE} [data-testid="dashboard-frame-holder"]` });

const ran = await page.locator(`${ORDERS_PANE} [data-testid^="patch-ran-"]`).first().textContent();
ok(/alice\/parts/.test(ran || ""), `the pane says where it went: ${ran}`);

/* ═══════════════════════ 3. what a page will not do ═══════════════════════ */

section("§21.4.3: a page refuses to mount, in the words of where to go instead");
const refusedMount = await page.evaluate(() => window.__submit("mount inventory"));
ok(refusedMount?.result?.ok === false, "a page does not mount a presentation");
ok(/goto workspace/.test(refusedMount?.result?.message || ""),
   `and says where it is done instead: ${refusedMount?.result?.message}`);

/* ═══════════════════════ 4. mount (U-86) ═════════════════════════════════ */

section("U-86: the chrome mounts a presentation, and nothing draws it until a press");

await page.evaluate(() => window.__app.locationBar.setAddress("workspace"));
const mounted = await page.evaluate(() => window.__submit("mount inventory"));
await settle(500);
ok(mounted?.result?.ok === true, `the chrome takes the verb: ${mounted?.result?.message}`);

const band = '[data-ui-mount="inventory"]';
await page.locator(band).waitFor({ timeout: 5000 });
ok(await page.locator(`${band} [data-testid="mount-expand"]`).count() === 1,
   "the band is there, with a control on it");
ok((await page.locator(`${band} .ui-mount-content`).innerHTML()) === "",
   "and nothing is drawn in it: a mount is inert until something OUTSIDE it acts");
ok(/Nothing in a page can open it/.test(await page.locator(`${band} .ui-mount-note`).textContent()),
   "which is said, because an unopened mount otherwise reads as a failure to load");

await figure("mounted", "`mount inventory' against the chrome. The band is a reference and "
                      + "nothing more: expansion is an act outside the representation (§21.4.3).");

const before = (await asked()).length;
await page.locator(`${band} [data-testid="mount-expand"]`).click();
await page.locator(`${band} [data-ui="i-head"]`).waitFor({ timeout: 5000 });
await settle(300);
ok(await page.locator(`${band} [data-ui="i-row"] [data-ui="i-parts"]`).count() === 1,
   "the press draws the mounted presentation's own tree, with its own element names");
ok((await asked()).length === before,
   "and drawing it asked no repository anything: a mount is drawn, not run");

await figure("expanded", "Pressed. The mounted presentation is drawn in place, keeping its own "
                       + "element names — it is the same presentation, included by reference.");

section("§21.4.1: one presentation is mounted in one place at a time");
const second = await page.evaluate(() => window.__submit("mount inventory"));
ok(second?.result?.ok === false, "a second mount of the same presentation is refused");
ok(/already loaded/.test(second?.result?.message || ""),
   `and resolves to where it already is: ${second?.result?.message}`);
ok(await page.locator(band).count() === 1, "so there is still exactly one band");

await figure("second-refused", "The once-only rule, enforced by the store's own guard. Two "
                             + "mounts would put one presentation's element names into one "
                             + "document twice — a certain collision, not a risk.",
             { of: "#location-bar" });

section("U-86: unmounting takes it away, and lets it be mounted again");
const element = await page.evaluate(() =>
  document.querySelector('[data-ui-mount="inventory"]').closest("[data-ui]")
          .getAttribute("data-ui"));
const gone = await page.evaluate((e) => window.__submit(`unmount ${e}`), element);
await settle(500);
ok(gone?.result?.ok === true, `the band is taken out: ${gone?.result?.message}`);
ok(await page.locator(band).count() === 0, "and it is no longer on the screen");

const freed = await page.evaluate(async () => {
  const { listMounts } = await import("/lib/app/ui-store.js");
  return listMounts({ host: location.origin, account: "alice", token: "test-token" });
});
ok((freed.mounts || []).length === 0,
   "the registry is clear, so release-then-claim is the replacement §21.4.1 describes");

await figure("unmounted", "Unmounted. There is no refresh: taking up a revised source is this, "
                        + "followed by mounting it again.");

/* ═══════════════════════ what nothing did ════════════════════════════════ */

section("what none of it cost");
ok(await turns() === 2, "two provider turns in the whole sequence — the two pages, and nothing "
                      + "for the six arrangement verbs");
ok(!faults.length, `nothing threw in the page${faults.length ? `: ${faults[0]}` : ""}`);

/* ── the contact sheet ────────────────────────────────────────────────────── */

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="date" content="${new Date().toISOString().slice(0, 10)}">
<title>Arrange, in sequence</title>
<style>
  body { font: 15px/1.6 Georgia, "Times New Roman", serif; max-width: 980px;
         margin: 0 auto; padding: 32px 24px 64px; color: #1d2227; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #5b6670; margin: 0 0 28px; }
  figure { margin: 0 0 34px; }
  figcaption { font-size: 14px; color: #39414a; margin-top: 8px; }
  .n { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #7a838c;
       margin-right: 8px; }
  img { width: 100%; border: 1px solid #d8dde2; border-radius: 3px; display: block; }
  footer { color: #7a838c; font-size: 13px; border-top: 1px solid #e3e7ea; padding-top: 14px; }
</style>
</head>
<body>
<h1>Arrange, in sequence</h1>
<p class="sub">Lift, apply and mount, as a reader meets them. Every figure below is a step
<code>tests/ui-arrange.browser.mjs</code> asserted on the way past; the suite writes them as it
runs, so a figure that disagrees with the build is a figure that cannot be produced.</p>
${figures.map((f, i) => `<figure>
  <img src="images/${f.name}.png" alt="${f.claim.replace(/"/g, "&quot;")}">
  <figcaption><span class="n">${String(i + 1).padStart(2, "0")}</span>${f.claim}</figcaption>
</figure>`).join("\n")}
<footer>Written by <code>npm run test:arrange-ui</code> · ${new Date().toISOString().slice(0, 10)} ·
${pass} assertions passed, ${fail} failed.</footer>
</body>
</html>
`;
await writeFile(join(SHOTS, "index.html"), index);

await browser.close();
server.close();

console.log(`\n${figures.length} figures written to ${IMAGES}`);
for (const f of figures) console.log(`  ${f.name}.png`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
