/**
 * The pane, driven through a second and a third prompt.
 *
 * Work items U-32, U-34, U-39 and U-40, and the acceptance test of §13.2:
 * the three prompts of §6.3, end to end, with the provider and the store
 * stubbed.
 *
 * The thing this suite exists to hold up is the one the whole plan turns on:
 * A SECOND PROMPT REVISES THE PAGE INSTEAD OF REPLACING IT, and it costs the
 * user only what it actually changed.  So the assertions are about counting
 * as much as about rendering — how many queries ran, which gate opened, and
 * whether the frame was reloaded — because those are the differences between
 * iterating and regenerating, and all three are invisible in a screenshot.
 *
 * The store is a stub that counts what reaches it, which is the only way to
 * assert "prompt 3 touches the store zero times" at all.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

/* Prompt 1's answer: two panels, one of them the domain of a parameter, and
   two views — so that §13.6's claims have something to switch between. */
const PROPOSAL = {
  title: "Regional sales",
  parameters: [
    { name: "region", kind: "literal", datatype: "xsd:string",
      domain: { from: "regions", column: "region" }, default: "North", label: "Region" },
  ],
  panels: [
    { name: "regions", query: "SELECT DISTINCT ?region WHERE { ?s :region ?region }",
      caption: "the regions that exist" },
    { name: "sales", parameters: ["region"],
      query: "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total ; :region ?region }",
      caption: "monthly totals for the chosen region" },
  ],
  uses: ["select", "table"],
  views: [
    { name: "overview", title: "Overview",
      html: '<h1 id="h">Regional sales</h1>'
          + '<dydra-select id="pick" parameter="region" panel="sales" from="regions"'
          + ' column="region" label="Region"></dydra-select>'
          + '<section id="tbl" data-bound="sales"><dydra-table></dydra-table></section>'
          + '<a id="go" data-view="detail">by month</a>' },
    { name: "detail", title: "By month",
      html: '<h2 id="d">By month</h2><section id="list" data-bound="sales"></section>'
          + '<a id="back" data-view="overview">back</a>' },
  ],
};

/* Prompt 2: a patch that changes a query and adds a panel — data class. */
const PATCH_DATA = [
  { op: "set-panel", name: "costs",
    value: { query: "SELECT ?month ?cost WHERE { ?s :month ?month ; :cost ?cost }" } },
  { op: "set-transform", name: "margin",
    value: { inputs: ["sales", "costs"], body: "return inputs.costs.rows.length;" } },
  { op: "append-slot", view: "overview",
    html: '<section id="margin-card" data-derived="margin"></section>' },
];

/* Prompt 3: a patch that changes nothing the store is asked. */
const PATCH_PRESENTATION = [
  { op: "set-slot", view: "overview", id: "margin-card",
    html: '<section id="margin-card" data-derived="margin" class="neg"></section>' },
  { op: "set-styles", value: ".neg { color: #8a2b2b; }" },
];

const REGIONS = "?region\nNorth\nSouth\n";
const SALES = "?month\t?total\n2026-01\t120\n2026-02\t80\n";

const HARNESS = `<!doctype html><meta charset="utf-8"><title>interaction harness</title>
<body>
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="view-editors"><div class="view-editors-container"></div></div>
</div>
<script type="module">
import { openDashboardPane } from "/ui/components/dashboard-pane.js";
import { paneState } from "/ui/components/mcp-pane-state.js";

const PROPOSAL = ${JSON.stringify(PROPOSAL)};
const PATCH_DATA = ${JSON.stringify(PATCH_DATA)};
const PATCH_PRESENTATION = ${JSON.stringify(PATCH_PRESENTATION)};
const REGIONS = ${JSON.stringify(REGIONS)};
const SALES = ${JSON.stringify(SALES)};

const st = paneState("playwright", "test", location.origin);
st.llmKey = "test-key";
st.token = "test-token";

// The record is written by SPARQL too, to <account>/mcp -- so "how many
// queries did this cost" has to count the REPOSITORY's endpoint and not the
// transcript's, or every assertion about cost would also be counting the
// bookkeeping.
const counts = { llm: 0, sparql: 0, record: 0 };
window.__counts = () => counts;
window.__queries = [];
window.__answer = "proposal";
const json = (o) => new Response(JSON.stringify(o),
  { status: 200, headers: { "Content-Type": "application/json" } });

window.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/sparql")) {
    const body = String(init.body || "");
    if (u.includes("/test/sparql")) { counts.sparql += 1; window.__queries.push(body); }
    else counts.record += 1;
    const text = /DISTINCT \\?region/.test(body) ? REGIONS
               : (/\\?cost/.test(body) ? "?month\\t?cost\\n2026-01\\t90\\n" : SALES);
    return new Response(text, { status: 200,
      headers: { "Content-Type": "text/tab-separated-values" } });
  }
  if (u.includes("/v1/messages")) {
    counts.llm += 1;
    const say = (text) => json({ id: "m", type: "message", role: "assistant",
      stop_reason: "end_turn", content: [{ type: "text", text }],
      usage: { input_tokens: 5, output_tokens: 5 } });
    if (window.__answer === "proposal") {
      return say("Two panels and a selector.\\n\\n\\\`\\\`\\\`dashboard\\n"
               + JSON.stringify(PROPOSAL) + "\\n\\\`\\\`\\\`");
    }
    if (window.__answer === "data") {
      return say("Adding costs and a margin.\\n\\n\\\`\\\`\\\`patch\\n"
               + JSON.stringify(PATCH_DATA) + "\\n\\\`\\\`\\\`");
    }
    if (window.__answer === "presentation") {
      return say("Just a colour.\\n\\n\\\`\\\`\\\`patch\\n"
               + JSON.stringify(PATCH_PRESENTATION) + "\\n\\\`\\\`\\\`");
    }
    if (window.__answer === "break") {
      return say("\\\`\\\`\\\`patch\\n" + JSON.stringify([
        { op: "set-transform", name: "margin",
          value: { inputs: ["sales", "costs"], body: "return inputs.nowhere.rows.length;" } }])
        + "\\n\\\`\\\`\\\`");
    }
    if (window.__answer === "repair") {
      return say("\\\`\\\`\\\`patch\\n" + JSON.stringify([
        { op: "set-transform", name: "margin",
          value: { inputs: ["sales", "costs"], body: "return inputs.costs.rows.length;" } }])
        + "\\n\\\`\\\`\\\`");
    }
    if (window.__answer === "broken") {
      return say("\\\`\\\`\\\`patch\\n" + JSON.stringify([
        { op: "set-slot", id: "nowhere", html: "<p></p>" }]) + "\\n\\\`\\\`\\\`");
    }
    return say("nothing to say");
  }
  return new Response("", { status: 404 });
};

const app = { state: { getAuthContext: () => ({ host: location.origin, token: "test-token" }) } };
window.__pane = openDashboardPane(app, {
  container: document.querySelector(".view-editors-container"),
  accountName: "playwright", repositoryName: "test",
  prompt: "monthly sales by region for the last two years",
});
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS);
    return;
  }
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
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => { fail++; console.log("  FAIL page error: " + e.message); });
await page.goto(`http://127.0.0.1:${port}/__harness`);

const pane = '[data-testid="dashboard-pane"]';
const settle = (ms = 250) => page.waitForTimeout(ms);
const inside = async () => (await page.locator(`${pane} iframe`).elementHandle()).contentFrame();
const counts = () => page.evaluate(() => window.__counts());

/* ═══════════════════════ prompt 1: what happens today ═════════════════════ */

console.log("\n§6.3 prompt 1: a page, through Gate 1");
{
  // Four runs, so the meter can be driven to its mark by four clicks rather
  // than thirty.  It is the Gate 0 field the user sets, not a test hook.
  await page.locator(`${pane} [data-testid="dashboard-grant-runs"]`).fill("4");
  await page.locator(`${pane} [data-testid="dashboard-grant"]`).click();
  await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).waitFor({ timeout: 8000 });
  ok(await page.locator(`${pane} [data-testid="dashboard-size"]`).count() === 1,
     "Gate 1 says what the page will weigh — the model cannot measure that itself");
  const gate = await page.locator(`${pane} section.dsh-gate`).nth(1).textContent();
  ok(/parameter/.test(gate) && /region/.test(gate),
     "and shows the parameter, which is the one thing the page may vary after this screen");
  ok(/any value `regions'\.region returns/.test(gate),
     "with the domain it will admit, read off a panel rather than asserted");
  ok((await counts()).sparql === 0, "nothing has run yet");

  await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).click();
  await page.locator(`${pane} iframe`).waitFor({ timeout: 8000 });
  await settle(500);
  ok((await counts()).sparql === 2, "both panels run, once each");
  ok(await page.locator(`${pane} [data-testid="dashboard-revise-prompt"]`).count() === 1,
     "and the page comes up with a box to ask for a change — §3.1's gap, closed");
}

/* ═══════════════════════ U-39: views ══════════════════════════════════════ */

console.log("\nD-AC: several views in one frame");
{
  const f = await inside();
  ok(await f.evaluate(() => document.querySelectorAll(".dash-view").length === 2),
     "both views are in the one document");
  ok(await f.evaluate(() =>
    document.querySelector('[data-view-name="detail"]').hidden === true),
     "one is shown at a time");
  const before = (await counts()).sparql;
  await f.evaluate(() => document.getElementById("go").click());
  await settle(200);
  ok(await f.evaluate(() =>
    document.querySelector('[data-view-name="detail"]').hidden === false),
     "a data-view link switches view");
  ok((await counts()).sparql === before,
     "and switching posts nothing and runs nothing: it is one frame with one data posting");
  const filled = await f.evaluate(() => ({
    inner: document.querySelector("#list").innerHTML.slice(0, 120),
    rows: document.querySelectorAll("#list tbody tr").length }));
  ok(filled.rows > 0,
     `the view that was hidden was already filled, so it appears complete (${filled.inner})`);
}

/* ═══════════════════════ U-40: state ══════════════════════════════════════ */

console.log("\n§10.3: the page's state reaches the pane, bounded");
{
  ok(await page.evaluate(() => window.__pane.document.state.view === "detail"),
     "which view is open is written into the document, so a reopen comes back here");
  await page.evaluate(() => window.__pane.document);
  const f = await inside();
  await f.evaluate(() => window.dashboard.state.set("note", "kept"));
  await settle(150);
  ok(await page.evaluate(() => window.__pane.document.state.note === "kept"),
     "and so is anything else the page chooses to remember");
  await f.evaluate(() => window.dashboard.state.set("blob", "x".repeat(9000)));
  await settle(200);
  ok(await page.evaluate(() => window.__pane.document.state.blob === undefined),
     "a page that writes a megabyte of state is refused");
  ok(await f.evaluate(() => {
    const bar = document.getElementById("dash-refusal");
    return bar && !bar.hidden && /8 KiB/.test(bar.textContent);
  }), "and told why, in the page");
  await f.evaluate(() => document.getElementById("back").click());
  await settle(150);
}

/* ═══════════════════════ U-34: run one panel ══════════════════════════════ */

console.log("\nD-X: the control re-runs ONE panel, with the value bound");
{
  const f = await inside();
  ok(await f.evaluate(() =>
    document.querySelectorAll("#pick option").length === 2),
     "the selector's options are the values the store returned, not a list the model wrote");
  const before = (await counts()).sparql;
  await f.evaluate(() => {
    const s = document.querySelector("#pick select");
    s.value = "South";
    s.dispatchEvent(new Event("change"));
  });
  await settle(600);
  ok((await counts()).sparql === before + 1,
     "choosing a region runs one panel, not the page");
  const last = await page.evaluate(() => window.__queries[window.__queries.length - 1]);
  ok(last.startsWith(PROPOSAL.panels[1].query),
     "and the query that ran begins with the query that was authorised, byte for byte");
  ok(last.endsWith('VALUES (?region) { ("South") }'),
     "with the value bound as a term after it — nothing was interpolated");
  ok(await page.evaluate(() => window.__pane.parameters.region === "South"),
     "the pane records what the page chose");
}

console.log("\nD-X: a value outside the domain is refused, with a reason shown in the page");
{
  const f = await inside();
  const before = (await counts()).sparql;
  const why = await f.evaluate(() =>
    window.dashboard.run("sales", { region: "Atlantis" }).then(() => null, (e) => e.message));
  await settle(200);
  ok((await counts()).sparql === before,
     "nothing was fetched: the refusal happens before the store is touched");
  ok(/not among the 2 value/.test(String(why)),
     "and the page is told which values there were");
  const refusedPanel = await f.evaluate(() =>
    window.dashboard.run("nosuch", {}).then(() => null, (e) => e.message));
  ok(/is not a panel of this page/.test(String(refusedPanel)),
     "a panel the document does not declare is refused too — `run' is not a query channel");
}

/* ═══════════════════ prompt 2: a data-class revision ══════════════════════ */

console.log("\n§15 q.3: the page's runs are metered, and the meter moves");
{
  ok(await page.locator(`${pane} [data-testid="dashboard-interaction-meter"]`).count() === 1,
     "the meter is beside the page, where the reader is when they wonder what a click cost");
  const meter = await page.locator(`${pane} [data-testid="dashboard-interaction-meter"]`).textContent();
  ok(/of 4 interactive run/.test(meter), "showing what was allowed at Gate 0");
  ok(/^page: 1 of 4/.test(meter),
     "and what the one selection so far has spent — a meter that moved rather than appeared");
  ok(!/2 of 4/.test(meter),
     "the value refused for being outside its domain cost nothing: that check is free and "
   + "local, and never reached the store");

  // Spend the rest through the control the reader actually uses.
  const f = await inside();
  const before = (await counts()).sparql;
  for (const value of ["North", "South", "North"]) {
    await f.evaluate((v) => {
      const s = document.querySelector("#pick select");
      s.value = v;
      s.dispatchEvent(new Event("change"));
    }, value);
    await settle(350);
  }
  ok((await counts()).sparql === before + 3, "three more selections, three more runs");
  const spent = await page.locator(`${pane} [data-testid="dashboard-interaction-meter"]`).textContent();
  ok(/4 of 4/.test(spent) && /spent/.test(spent), "and the budget is spent");

  const g = await inside();
  ok(await g.evaluate(() => window.dashboard.budget.exhausted === true),
     "the page is told, so a control can be honest about it");
  ok(await g.evaluate(() => document.querySelector("#pick select").disabled === true),
     "and the selector greys itself out rather than offering a choice that cannot be answered");

  const held = (await counts()).sparql;
  const why = await g.evaluate(() =>
    window.dashboard.run("sales", { region: "South" }).then(() => null, (e) => e.message));
  await settle(200);
  ok((await counts()).sparql === held,
     "a run past the budget does not reach the store: charged before the call, like the grant");
  ok(/used its 4 interactive run/.test(String(why)) && /Nothing is wrong/.test(String(why)),
     "and the reason says what was spent and that nothing is wrong");
  ok(await g.evaluate(() => {
    const bar = document.getElementById("dash-refusal");
    return bar && !bar.hidden;
  }), "shown in the page, beside the control the reader touched");
}

console.log("\n§15 q.3: renewal asks nobody anything");
{
  const gatesBefore = await page.locator(`${pane} section.dsh-gate:visible`).count();
  await page.locator(`${pane} [data-testid="dashboard-interaction-renew"]`).click();
  await settle(250);
  ok(await page.locator(`${pane} section.dsh-gate:visible`).count() === gatesBefore,
     "no gate opens: the queries behind the page are the ones already approved");
  ok(await page.locator(`${pane} [data-testid="dashboard-patch-class"]`).count() === 0,
     "renewal is a meter reaching its mark, not a change to review");
  const meter = await page.locator(`${pane} [data-testid="dashboard-interaction-meter"]`).textContent();
  ok(/renewed 1×/.test(meter),
     "the renewal is counted, because the count is the signal a page's shape is wrong");
  const f = await inside();
  ok(await f.evaluate(() => document.querySelector("#pick select").disabled === false),
     "the control comes back without the reader having to touch it twice");
  const before = (await counts()).sparql;
  await f.evaluate(() => {
    const s = document.querySelector("#pick select");
    s.value = "South";
    s.dispatchEvent(new Event("change"));
  });
  await settle(400);
  ok((await counts()).sparql === before + 1, "and the page can ask again");
  ok(await page.evaluate(() => window.__pane.interaction.renewals === 1),
     "with the pane keeping the count for the record");
}

console.log("\n§6.3 prompt 2: a patch that changes what runs stops at Gate 1");
{
  const before = (await counts()).sparql;
  await page.evaluate(() => { window.__answer = "data"; });
  await page.evaluate(() => window.__pane.revise("add a margin figure"));
  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).waitFor({ timeout: 8000 });
  ok((await counts()).sparql === before,
     "nothing has run: the change is shown before it is applied");
  const klass = await page.locator(`${pane} [data-testid="dashboard-patch-class"]`).textContent();
  ok(/^data/.test(klass), "classified data, because a panel is new");
  ok(await page.locator(`${pane} [data-testid="dashboard-diff-costs"]`).count() === 1,
     "with a per-panel diff for the panel that changed");
  ok(await page.locator(`${pane} [data-testid="dashboard-diff-sales"]`).count() === 0,
     "and none for the two that did not");
  const gate = await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).textContent();
  ok(/Run 1 panel and apply/.test(gate),
     "and the button says how much will run — one panel of three");

  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).click();
  await settle(700);
  ok((await counts()).sparql === before + 1,
     "on acceptance exactly the new panel runs");
  ok(await page.evaluate(() => window.__pane.document.revision === 2), "revision 2");
  const f = await inside();
  ok(await f.evaluate(() => document.querySelector("#margin-card") !== null),
     "and the new region is in the page");
}

/* ═══════════════ prompt 3: the case the whole plan is for ═════════════════ */

console.log("\n§6.3 prompt 3: a presentational change, with no gate and no store");
{
  const before = (await counts()).sparql;
  const f = await inside();
  await f.evaluate(() => { window.__mark = "still here"; window.scrollTo(0, 30); });
  await page.evaluate(() => { window.__answer = "presentation"; });
  const out = await page.evaluate(() => window.__pane.revise("make the margin red when negative"));
  await settle(700);
  ok(out && out.classification.class === "presentational", "classified presentational");
  ok(out.applied === "immediately",
     "applied without a gate: a change of colour that asked permission would teach the user "
   + "to stop reading the ones that matter");
  ok((await counts()).sparql === before, "the store was touched zero times");
  const g = await inside();
  ok(await g.evaluate(() => window.__mark === "still here"),
     "and the frame was NOT reloaded — this is the case that makes design feel like design");
  ok(await g.evaluate(() => document.querySelector("#margin-card").className === "neg"),
     "the region changed");
  ok(await g.evaluate(() =>
    document.getElementById("dash-doc-style").textContent.includes(".neg")),
     "so did the stylesheet");
  ok(await page.evaluate(() => window.__pane.document.revision === 3), "revision 3");
  ok(await page.evaluate(() => window.__pane.patches.length === 5),
     "and the operations that produced it are kept, which is the history the archive "
   + "cannot otherwise show");
}

console.log("\n§11: a page that breaks at run time is repaired without the user retyping");
{
  await page.evaluate(() => { window.__answer = "break"; });
  await page.evaluate(() => window.__pane.revise("recompute the margin differently"));
  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).waitFor({ timeout: 8000 });
  // The breakage is accepted deliberately: a transform that compiles and then
  // throws is exactly the fault Gate 1 cannot catch, which is why the loop
  // exists at all.
  await page.evaluate(() => { window.__answer = "repair"; });
  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).click();
  await settle(900);
  ok(await page.locator(`${pane} [data-testid="dashboard-page-error"]`).count() >= 1,
     "the frame reports the transform that threw");
  ok(await page.locator(`${pane} [data-testid="dashboard-repair"]`).count() === 1,
     "one repair attempt is started, and it is visible in the pane");
  const note = await page.locator(`${pane} [data-testid="dashboard-repair"]`).textContent();
  ok(/attempt 1 of 2/.test(note), "saying which attempt it is");
  ok(/transform:margin/.test(note), "and which region would not come right");
  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).waitFor({ timeout: 8000 });
  const klass = await page.locator(`${pane} [data-testid="dashboard-patch-class"]`).textContent();
  ok(/^computational/.test(klass),
     "the repair is a patch like any other, classified like any other");
  await page.locator(`${pane} [data-testid="dashboard-patch-accept"]`).click();
  await settle(700);
  const f = await inside();
  ok(await f.evaluate(() =>
    !document.querySelector("#margin-card").hasAttribute("data-failed")),
     "and the region it was about is no longer failing");
  ok(await page.evaluate(() => window.__pane.repair.attempts === 1),
     "one attempt was spent, of the two there are");
}

console.log("\na patch that does not apply is refused whole and reported");
{
  await page.evaluate(() => { window.__answer = "broken"; });
  const out = await page.evaluate(() => window.__pane.revise("change the thing that is not there"));
  await settle(400);
  ok(out && out.ok === false, "the revision fails");
  ok(await page.locator(`${pane} [data-testid="dashboard-patch-refused"]`).count() === 1,
     "and says so, naming the operation");
  ok(await page.evaluate(() => window.__pane.document.revision === 5),
     "the document is still the revision it was: half a patch is not applied");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
