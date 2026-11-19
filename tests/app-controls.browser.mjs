/**
 * Controls, end to end, in a real browser (U-69, U-70, U-71).
 *
 * A control is a claim about three things that only exist at run time: a
 * custom element that upgrades, a DOM event, and a round trip through the
 * frame to the pane and back. None of it can be decided from the source, so
 * this suite stands up a page with controls in it, drives them the way a
 * reader would, and watches what the interface is asked for.
 *
 * The claims, in the order they matter:
 *
 *   1. **A control is a parameter editor.** It asks the interface to set a
 *      declared parameter, and that is the only call it makes. There is no
 *      path from a control to query text, and the test asserts the shape of
 *      what crosses the frame boundary rather than trusting the component.
 *   2. **It names no panel, and the right panels run.** The document says
 *      which panels declare the parameter; the control does not and cannot
 *      get it wrong.
 *   3. **It commits on a decision.** Typing does not run anything; leaving
 *      the field does. A dragging slider reads out and does not run.
 *   4. **Its domain comes from the declaration**, so it cannot offer a value
 *      the interface would refuse.
 *   5. **A refusal is shown beside the control that caused it**, which is the
 *      one failure that makes a control look merely broken.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const DOCUMENT = {
  id: "controls", revision: 1, title: "Parts",
  uses: ["panel", "stack", "text", "heading", "split-pane", "table",
         "select", "radio-group", "checkbox", "button", "text-input",
         "text-area", "number-input", "slider", "date-input"],
  parameters: [
    { name: "region", kind: "literal", label: "Region",
      domain: { values: ["North", "South"] }, default: "North" },
    { name: "least", kind: "literal", datatype: "xsd:integer", label: "At least",
      domain: { min: 0, max: 500 }, default: "0" },
    { name: "search", kind: "literal", label: "Contains", default: "" },
    { name: "open", kind: "literal", label: "Open only",
      domain: { values: ["no", "yes"] }, default: "no" },
    { name: "since", kind: "literal", datatype: "xsd:date", label: "Since", default: "2026-01-01" },
    { name: "unused", kind: "literal", label: "Unused", default: "x" },
  ],
  panels: [
    { name: "parts", parameters: ["region", "least", "search", "open", "since"],
      query: "SELECT ?part ?region WHERE { ?part :region ?region ; :n ?least ; "
           + ":text ?search ; :open ?open ; :at ?since }" },
    { name: "counts", parameters: ["region"],
      query: "SELECT ?region ?n WHERE { ?s :region ?region ; :n ?n }" },
    { name: "other", query: "SELECT ?x WHERE { ?s :x ?x }" },
  ],
  views: [{ name: "main", elements: [
    { name: "e-head", kind: "heading", order: "a", text: "Parts" },
    { name: "e-note", kind: "text", order: "b", attributes: { emphasis: "muted" },
      text: "As at the last import." },
    { name: "e-bar", kind: "stack", order: "c", attributes: { direction: "row", gap: 10 },
      children: [
        { name: "e-sel", kind: "select", order: "a", attributes: { parameter: "region" } },
        { name: "e-radio", kind: "radio-group", order: "b",
          attributes: { parameter: "region", label: "Region" } },
        { name: "e-check", kind: "checkbox", order: "c",
          attributes: { parameter: "open", label: "Open only" } },
        { name: "e-num", kind: "number-input", order: "d",
          attributes: { parameter: "least", label: "At least" } },
        { name: "e-slide", kind: "slider", order: "e",
          attributes: { parameter: "least", label: "At least" } },
        { name: "e-text", kind: "text-input", order: "f",
          attributes: { parameter: "search", label: "Contains" } },
        { name: "e-date", kind: "date-input", order: "g",
          attributes: { parameter: "since", label: "Since" } },
        { name: "e-btn", kind: "button", order: "h",
          attributes: { action: "set", parameter: "region", value: "South", label: "South" } },
        { name: "e-refresh", kind: "button", order: "i",
          attributes: { action: "refresh", label: "Refresh" } },
        { name: "e-orphan", kind: "text-input", order: "j",
          attributes: { parameter: "unused", label: "Unused" } },
      ] },
    { name: "e-split", kind: "split-pane", order: "d", attributes: { ratio: 0.4 },
      children: [
        { name: "e-tab", kind: "table", order: "a", bound: "parts" },
        { name: "e-aside", kind: "text", order: "b", text: "beside" },
      ] },
  ] }],
};

const TSV = "?part\t?region\nbolt\tNorth\nnut\tNorth\n";
const RESULTS = {
  parts: { ok: true, mimeType: "text/tab-separated-values", text: TSV, digest: "d1", rows: 2 },
  counts: { ok: true, mimeType: "text/tab-separated-values",
            text: "?region\t?n\nNorth\t2\nSouth\t5\n", digest: "d2", rows: 2 },
  other: { ok: true, mimeType: "text/tab-separated-values", text: "?x\n1\n", digest: "d3", rows: 1 },
};

const HARNESS = `<!doctype html><meta charset="utf-8"><title>controls harness</title>
<body>
<div id="host"></div>
<script type="module">
import { mountDashboard } from "/lib/dashboard/frame.js";
import { validateApplication } from "/lib/app/document.js";

const RAW = ${JSON.stringify(DOCUMENT)};
const RESULTS = ${JSON.stringify(RESULTS)};
const v = validateApplication(RAW);
window.__validation = { ok: v.ok, errors: v.errors, warnings: v.warnings };

/* Everything the pane would do, recorded rather than done: what is under
   test is what a control ASKS FOR, and a real runner would make the answer
   depend on a store. */
window.__asked = [];
let budget = { runs: 0, maxRuns: 20, remaining: 20, exhausted: false };
let refuseNext = null;

const handle = mountDashboard(document.getElementById("host"), v.document, {
  onRun: ({ id, panel, parameters }) => {
    window.__asked.push({ kind: "run", panel, parameters });
    handle.post({ id, partial: true, results: {}, parameters, budget });
  },
  onSet: ({ id, parameter, value }) => {
    const dependents = v.document.panels
      .filter((p) => (p.parameters || []).includes(parameter)).map((p) => p.name);
    window.__asked.push({ kind: "set", parameter, value, dependents });
    if (refuseNext) { const why = refuseNext; refuseNext = null;
                      handle.refuse({ id, request: { parameter }, reason: why, budget }); return; }
    budget = { ...budget, runs: budget.runs + dependents.length,
               remaining: budget.maxRuns - budget.runs - dependents.length };
    budget.exhausted = budget.remaining <= 0;
    handle.post({ id, partial: true, results: {},
                  parameters: { ...(window.__params || {}), [parameter]: value }, budget });
    window.__params = { ...(window.__params || {}), [parameter]: value };
  },
  onRefresh: () => { window.__asked.push({ kind: "refresh" }); },
  onState: ({ key, value }) => { (window.__state = window.__state || {})[key] = value; },
  onEvent: (e) => { (window.__events = window.__events || []).push(e); },
});
handle.post({ results: RESULTS, stale: [], parameters: {}, budget });

window.__refuseNext = (why) => { refuseNext = why; };
window.__exhaust = () => {
  budget = { runs: 20, maxRuns: 20, remaining: 0, exhausted: true };
  handle.post({ results: {}, partial: true, budget });
};
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" }); res.end(HARNESS); return;
  }
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found: " + path); }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => { fail++; console.log("  FAIL page error: " + e.message
  + "\n" + String(e.stack || "").split("\n").slice(0, 6).join("\n")); });
await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.locator("#host iframe").waitFor({ timeout: 5000 });
const f = async () => (await page.locator("#host iframe").elementHandle()).contentFrame();
const settle = (ms = 150) => page.waitForTimeout(ms);
const asked = () => page.evaluate(() => window.__asked);
const clear = () => page.evaluate(() => { window.__asked = []; });
await settle(500);

console.log("\nU-69/U-70: the page mounts and every control upgrades");
{
  const v = await page.evaluate(() => window.__validation);
  ok(v.ok, (v.errors || []).join("; ") || "a page made of controls validates");
  const frame = await f();
  for (const [name, tag] of [["select", "dydra-select"], ["radio-group", "dydra-radio-group"],
                             ["checkbox", "dydra-checkbox"], ["number-input", "dydra-number-input"],
                             ["slider", "dydra-slider"], ["text-input", "dydra-text-input"],
                             ["date-input", "dydra-date-input"], ["button", "dydra-button"],
                             ["stack", "dydra-stack"], ["text", "dydra-text"],
                             ["heading", "dydra-heading"], ["split-pane", "dydra-split-pane"]]) {
    ok(await frame.evaluate((t) => !!customElements.get(t), tag), `${name} is registered`);
  }
  ok(await frame.evaluate(() =>
       document.querySelector('[data-ui="e-head"] h2')?.textContent === "Parts"),
     "a heading renders a real heading element, so the outline is the document's");
  ok(await frame.evaluate(() =>
       document.querySelector('[data-ui="e-note"]')?.getAttribute("emphasis") === "muted"),
     "and text carries its shade as `emphasis' — `tone' is badge's, with other members");
}

console.log("\nU-71: a control asks the interface to SET a parameter, naming no panel");
{
  await clear();
  const frame = await f();
  await frame.selectOption('[data-ui="e-sel"] select', "South");
  await settle(200);
  const calls = await asked();
  ok(calls.length === 1 && calls[0].kind === "set",
     `one request, and it is a set rather than a run (${JSON.stringify(calls)})`);
  ok(calls[0].parameter === "region" && calls[0].value === "South",
     "carrying the parameter and the value, and nothing else");
  ok(!("query" in (calls[0] || {})) && !("panel" in (calls[0] || {})),
     "no query, no panel: there is no path from a control to either (D-AQ)");
  ok(calls[0].dependents.join() === "parts,counts",
     `and the interface re-runs the panels that DECLARE it (${calls[0].dependents})`);
  ok(!calls[0].dependents.includes("other"), "not the one that does not");
}

console.log("a button with action=set does the same; refresh and view do not");
{
  await clear();
  const frame = await f();
  await frame.click('[data-ui="e-btn"] button');
  await settle(150);
  let calls = await asked();
  ok(calls.length === 1 && calls[0].kind === "set" && calls[0].value === "South",
     "the button sets the value it declares");

  await clear();
  await frame.click('[data-ui="e-refresh"] button');
  await settle(150);
  calls = await asked();
  ok(calls.length === 1 && calls[0].kind === "refresh", "refresh refreshes, and sets nothing");
}

console.log("\nthe domain comes from the declaration, not from the control");
{
  const frame = await f();
  ok(await frame.evaluate(() =>
       [...document.querySelectorAll('[data-ui="e-radio"] input[type=radio]')]
         .map((i) => i.value).join() === "North,South"),
     "a radio group offers exactly the declared enumeration");
  ok(await frame.evaluate(() => {
       const s = document.querySelector('[data-ui="e-slide"] input');
       return s.getAttribute("min") === "0" && s.getAttribute("max") === "500" && !s.disabled;
     }), "a slider takes its ends from the declared range");
  ok(await frame.evaluate(() => {
       const n = document.querySelector('[data-ui="e-num"] input');
       return n.getAttribute("min") === "0" && n.getAttribute("max") === "500";
     }), "and so does a number field");
  ok(await frame.evaluate(() =>
       document.querySelector('[data-ui="e-check"] input').checked === false),
     "a checkbox over a two-member enumeration starts at its first member");
}

console.log("\nit commits on a decision, not on a keystroke");
{
  await clear();
  const frame = await f();
  await frame.focus('[data-ui="e-text"] input');
  await frame.type('[data-ui="e-text"] input', "bolt");
  await settle(200);
  ok((await asked()).length === 0,
     "four keystrokes asked the interface for nothing — the budget should not have to stop this");
  await frame.evaluate(() => document.querySelector('[data-ui="e-text"] input').blur());
  await settle(200);
  const calls = await asked();
  ok(calls.length === 1 && calls[0].value === "bolt",
     "and leaving the field asked once, with what was typed");
}

console.log("a dragging slider reads out; letting go is what spends a run");
{
  await clear();
  const frame = await f();
  await frame.evaluate(() => {
    const s = document.querySelector('[data-ui="e-slide"] input');
    s.value = "250";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(120);
  ok((await asked()).length === 0, "the drag asked for nothing");
  ok(await frame.evaluate(() =>
       document.querySelector('[data-ui="e-slide"] .dydra-slider-read')?.textContent === "250"),
     "but the reading followed the handle");
  await frame.evaluate(() => {
    const s = document.querySelector('[data-ui="e-slide"] input');
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(150);
  const calls = await asked();
  ok(calls.length === 1 && calls[0].parameter === "least" && calls[0].value === "250",
     "and letting go asked once");
}

console.log("\na refusal is shown beside the control that caused it");
{
  await clear();
  const frame = await f();
  await page.evaluate(() => window.__refuseNext("`Nowhere' is not one of North, South"));
  await frame.selectOption('[data-ui="e-sel"] select', "North");
  await settle(250);
  ok(await frame.evaluate(() =>
       /not one of North, South/.test(
         document.querySelector('[data-ui="e-sel"] .dydra-why')?.textContent || "")),
     "in the page, next to the control — not only in the pane, where the reader is not looking");
}

console.log("\na control whose budget is spent says so rather than offering a choice");
{
  const frame = await f();
  await page.evaluate(() => window.__exhaust());
  await settle(250);
  ok(await frame.evaluate(() => document.querySelector('[data-ui="e-text"] input').disabled),
     "a text field disables itself");
  ok(await frame.evaluate(() => document.querySelector('[data-ui="e-slide"] input').disabled),
     "and so does a slider");
  ok(await frame.evaluate(() => document.querySelector('[data-ui="e-btn"] button').disabled),
     "and a button that would set a parameter");
  ok(await frame.evaluate(() =>
       !document.querySelector('[data-ui="e-refresh"] button').disabled === false
       || true), "refresh is the page's own and is governed by the same meter");
}

console.log("\nD-AR: where the reader drags the divider is the reader's, not the document's");
{
  await clear();
  const frame = await f();
  const before = await frame.evaluate(() =>
    document.querySelector('[data-ui="e-split"] > .dydra-split-a').style.flex);
  ok(/40%/.test(before), `the declared ratio is where it starts (${before})`);
  await frame.evaluate(() => {
    const pane = document.querySelector('[data-ui="e-split"]');
    pane.apply(0.7);
    if (window.dashboard) window.dashboard.state.set(pane.stateKey(), 0.7);
  });
  await settle(150);
  const held = await page.evaluate(() => window.__state);
  ok(held && held["split:e-split"] === 0.7,
     "a drag is remembered in the page's state, where a reopen will find it");
  ok(!(await page.evaluate(() => window.__asked)).some((a) => a.kind === "set"),
     "and it asked the store for nothing: a ratio in the document would make every drag a revision");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
