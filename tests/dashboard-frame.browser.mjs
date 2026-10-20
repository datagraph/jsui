/**
 * The dashboard, in a real browser.
 *
 * Everything D-R claims is a claim about a browser: that a frame with
 * `allow-scripts' and without `allow-same-origin' runs script and cannot reach
 * the embedder, that `connect-src 'none'' stops a fetch the page tries anyway,
 * that `postMessage' is the only way in.  None of that can be asserted against
 * a model of a browser -- jsdom will happily let a sandboxed frame read
 * `parent.document' -- so it is asserted here, in Chromium, with the real
 * policy on the real document.
 *
 * The second half walks the pane through its three gates with the provider and
 * the store stubbed, which is the only way to see that the gates are in the
 * order the plan puts them in and that nothing runs before the user's word.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const PROPOSAL = {
  title: "Sales",
  panels: [
    { name: "sales", query: "SELECT ?region ?value WHERE { ?s :region ?region ; :value ?value }",
      caption: "value by region" },
  ],
  transforms: [
    { name: "total", inputs: ["sales"],
      body: "let n = 0; for (const r of inputs.sales.objects) n += Number(r.value) || 0; return n;" },
  ],
  assertions: [
    { id: "lead", inputs: ["sales"], text: "The north leads." },
    { id: "outside", inputs: [], text: "The sector average is four percent." },
  ],
  html: '<h1>Sales</h1><section data-bound="sales"></section>'
      + '<p data-derived="total"></p><p data-asserted="lead"></p><p data-asserted="outside"></p>',
};

const TSV = "?region\t?value\nNorth\t120\nSouth\t80\n";

const HARNESS = `<!doctype html><meta charset="utf-8"><title>dashboard harness</title>
<body>
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="view-editors"><div class="view-editors-container"></div></div>
</div>
<div id="frame-host"></div>
<div id="broken-host"></div>
<script type="module">
import { mountDashboard } from "/lib/dashboard/frame.js";
import { validateDashboard, withInputDigests } from "/lib/dashboard/spec.js";
import { openDashboardPane } from "/ui/components/dashboard-pane.js";
import { paneState } from "/ui/components/mcp-pane-state.js";

const PROPOSAL = ${JSON.stringify(PROPOSAL)};
const TSV = ${JSON.stringify(TSV)};

/* ── the frame on its own ─────────────────────────────────────────────── */
const v = validateDashboard(PROPOSAL);
window.__validation = { ok: v.ok, errors: v.errors, warnings: v.warnings };
const spec = withInputDigests(v.spec, { sales: { digest: "first" } });
const handle = mountDashboard(document.getElementById("frame-host"), spec, {
  onRefresh: () => { window.__refreshes = (window.__refreshes || 0) + 1; },
  onEvent: (e) => { (window.__frameEvents = window.__frameEvents || []).push(e); },
});
window.__handle = handle;
handle.post({ results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                                  text: TSV, digest: "first", rows: 2 } }, stale: [] });

/* ── a transform that throws, mounted straight past validation ────────── */
const BROKEN = {
  title: "Broken", panels: PROPOSAL.panels, assertions: [],
  transforms: [{ name: "census", inputs: ["sales"],
                 body: "throw new TypeError('rows is not iterable');" }],
  html: '<section data-bound="sales"></section><p data-derived="census"></p>',
};
const broken = mountDashboard(document.getElementById("broken-host"), BROKEN, {
  onEvent: (e) => { (window.__brokenEvents = window.__brokenEvents || []).push(e); },
});
broken.post({ results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                                  text: TSV, digest: "first", rows: 2 } }, stale: [] });

/* ── the pane, with the provider and the store stubbed ────────────────── */
const st = paneState("playwright", "test", location.origin);
st.llmKey = "test-key";
st.token = "test-token";
// The second pane keeps its own state, so it needs its own key.
const st2 = paneState("playwright", "cutoff", location.origin);
st2.llmKey = "test-key";
st2.token = "test-token";

let llmTurn = 0;
const counts = { llm: 0, mcp: 0, sparql: 0, views: 0 };
window.__counts = () => counts;
window.__requests = [];
const json = (obj) => new Response(JSON.stringify(obj),
  { status: 200, headers: { "Content-Type": "application/json" } });

window.fetch = async (url, init = {}) => {
  const u = String(url);
  window.__requests.push({ url: u, method: init.method || "GET",
                           accept: (init.headers || {}).Accept || null });
  if (u.includes("/mcp")) {
    counts.mcp += 1;
    const body = init.body ? JSON.parse(init.body) : {};
    if (body.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: 1, result: { tools: [
        { name: "survey", description: "Survey the repository.", inputSchema: { type: "object" } },
        { name: "query", description: "Run one query.", inputSchema: { type: "object" } },
      ] } });
    }
    if (body.method === "resources/read") {
      return json({ jsonrpc: "2.0", id: 1, result: { contents: [{ type: "text", text: "operations: catalog" }] } });
    }
    return json({ jsonrpc: "2.0", id: 1,
      result: { content: [{ type: "resource", resource: { text: "session: \\"S-1\\"\\nresultCount: 2" } }] } });
  }
  if (u.includes("/views/")) {
    counts.views += 1;
    return new Response("", { status: 204 });
  }
  if (u.includes("/sparql")) {
    counts.sparql += 1;
    return new Response(TSV, { status: 200,
      headers: { "Content-Type": "text/tab-separated-values" } });
  }
  if (u.includes("anthropic") || u.includes("/v1/messages")) {
    counts.llm += 1;
    // The live failure, scripted: an opening line and a tool call, then a
    // final turn that reaches the ceiling mid-page and comes back empty.
    if (window.__truncate) {
      window.__tTurn = (window.__tTurn || 0) + 1;
      if (window.__tTurn === 1) {
        return json({ id: "t1", type: "message", role: "assistant", stop_reason: "tool_use",
          content: [{ type: "text",
                      text: "I'll start by reading the vocabulary and cataloguing the repository." },
                    { type: "tool_use", id: "x1", name: "survey", input: { op: "catalog" } }],
          usage: { input_tokens: 5, output_tokens: 5 } });
      }
      return json({ id: "t2", type: "message", role: "assistant", stop_reason: "max_tokens",
        content: [], usage: { input_tokens: 37989, output_tokens: 32000 } });
    }
    llmTurn += 1;
    if (llmTurn === 1) {
      return json({ id: "m1", type: "message", role: "assistant", stop_reason: "tool_use",
        content: [{ type: "text", text: "Looking at what is there." },
                  { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog" } }],
        usage: { input_tokens: 5, output_tokens: 5 } });
    }
    return json({ id: "m2", type: "message", role: "assistant", stop_reason: "end_turn",
      content: [{ type: "text",
        text: "One panel, one computed total, one sentence.\\n\\n\`\`\`dashboard\\n"
            + JSON.stringify(PROPOSAL) + "\\n\`\`\`" }],
      usage: { input_tokens: 5, output_tokens: 5 } });
  }
  return new Response("", { status: 404 });
};

const app = { state: { getAuthContext: () => ({ host: location.origin, token: "test-token" }) } };
window.__openSecond = () => openDashboardPane(app, {
  container: document.querySelector(".view-editors-container"),
  accountName: "playwright", repositoryName: "cutoff",
  prompt: "a dashboard too large to finish",
});
window.__pane = openDashboardPane(app, {
  container: document.querySelector(".view-editors-container"),
  accountName: "playwright", repositoryName: "test",
  prompt: "a dashboard of sales by region",
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

const frameEl = page.locator("#frame-host iframe");
await frameEl.waitFor({ timeout: 5000 });

// By element, not by elimination: there is more than one frame on the page
// now, and "the one that is not the main frame" would be whichever mounted
// first.
const frameIn = async (sel) => (await page.locator(sel).elementHandle()).contentFrame();

console.log("\nD-R: the sandbox is the enabling constraint");
{
  const sandbox = await frameEl.getAttribute("sandbox");
  ok(sandbox === "allow-scripts", "scripts are allowed");
  ok(!/allow-same-origin/.test(sandbox),
     "and same-origin is not -- the one pair that must never appear together");

  ok(await page.evaluate(() => document.querySelector("#frame-host iframe").contentDocument === null),
     "so the embedder cannot read into the frame: its origin is opaque");

  const inside = await frameIn("#frame-host iframe");
  ok(Boolean(inside), "the page is there and running");

  ok(await inside.evaluate(() => { try { return parent.document === null; } catch { return true; } }),
     "and the frame cannot read out: parent.document throws");
  ok(await inside.evaluate(() => { try { void localStorage.length; return false; } catch { return true; } }),
     "storage is unavailable, so nothing can be stashed between runs");
  ok(await inside.evaluate(() => { try { void document.cookie; return false; } catch { return true; } }),
     "reading a cookie does not return empty -- it throws, because there is no origin to have cookies for");
  ok(await inside.evaluate(() => location.origin === "null" || location.origin === ""),
     "the origin is opaque, which is what makes all of the above true at once");
  ok(await inside.evaluate(async () => {
       try { await fetch("/__harness"); return false; } catch { return true; }
     }),
     "connect-src 'none': a fetch the page tries anyway is refused");
}

console.log("\nD-P: the page binds, computes and marks");
{
  const inside = await frameIn("#frame-host iframe");
  await inside.waitForFunction(
    () => document.querySelector('[data-bound="sales"] table') !== null, null, { timeout: 5000 });

  ok(await inside.evaluate(() =>
       document.querySelectorAll('[data-bound="sales"] tbody tr').length) === 2,
     "a bound slot is filled from the results the pane posted in");
  ok((await inside.evaluate(() =>
       document.querySelector('[data-bound="sales"] .dash-prov').textContent)).includes("view sales"),
     "and marked with the view it came from");

  ok((await inside.evaluate(() =>
       document.querySelector('[data-derived="total"]').textContent)).includes("200"),
     "a derived slot runs the model's own function over that data -- 120 + 80");
  ok((await inside.evaluate(() =>
       document.querySelector('[data-derived="total"] .dash-prov').textContent)).includes("computed"),
     "and says it was computed rather than fetched");

  ok((await inside.evaluate(() =>
       document.querySelector('[data-asserted="lead"] .dash-prov').textContent)).includes("from sales"),
     "a sentence written from a panel says which");
  ok((await inside.evaluate(() =>
       document.querySelector('[data-asserted="outside"] .dash-prov').textContent))
       .includes("not from this repository"),
     "and one that came from outside says that instead -- the distinction survives into the artifact");
}

console.log("\nD-T: a sentence is marked when the data under it moves");
{
  await page.evaluate(() => window.__handle.post({
    results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                        text: "?region\t?value\nNorth\t500\nSouth\t80\n",
                        digest: "second", rows: 2 } },
    stale: [{ id: "lead", moved: ["sales"] }],
  }));
  const inside = await frameIn("#frame-host iframe");
  await inside.waitForFunction(
    () => document.querySelector('[data-asserted="lead"][data-stale]') !== null,
    null, { timeout: 5000 });
  ok(true, "the passage is flagged in place, not removed");
  ok((await inside.evaluate(() =>
       document.querySelector('[data-asserted="lead"] .dash-stale').textContent)).includes("sales"),
     "and the flag names the panel whose data changed");
  ok(await inside.evaluate(() =>
       !document.querySelector('[data-asserted="outside"][data-stale]')),
     "a passage citing nothing is left alone, because it never claimed a number");
  ok((await inside.evaluate(() =>
       document.querySelector('[data-derived="total"]').textContent)).includes("580"),
     "while the computed value simply recomputes -- which is the whole point of declaring it");
}

console.log("\nthe page asks for a refresh; it cannot perform one");
{
  const inside = await frameIn("#frame-host iframe");
  await inside.evaluate(() => window.dashboard.refresh());
  await page.waitForFunction(() => window.__refreshes === 1, null, { timeout: 5000 });
  ok(true, "dashboard.refresh() reaches the pane by postMessage");
  ok(await page.evaluate(() => window.__requests.filter((r) => r.url.includes("sparql")).length) >= 0,
     "and the pane, not the page, decides whether to honour it");
}

console.log("\na transform that throws says what it said");
{
  // The live report read "the page reported an error in transform:census:
  // fill/<@about:srcdoc:225:18 fill@about:srcdoc:212:29" -- the frames and
  // not the fault.  Firefox omits the message from SyntaxError.stack, so a
  // report built from the stack alone throws away the only useful part.
  await page.waitForFunction(() => (window.__brokenEvents || []).some((e) => e.type === "error"),
                             null, { timeout: 5000 });
  const err = await page.evaluate(() =>
    (window.__brokenEvents || []).find((e) => e.type === "error"));
  ok(err.where === "transform:census", "the report still says where");
  ok(/TypeError/.test(err.error) && /rows is not iterable/.test(err.error),
     `and now also what: ${JSON.stringify(err.error.split("\n")[0])}`);

  const broken = await frameIn("#broken-host iframe");
  const slot = await broken.evaluate(() => {
    const el = document.querySelector('[data-derived="census"]');
    return { text: el.textContent, failed: el.hasAttribute("data-failed") };
  });
  ok(slot.failed, "the slot is marked as failed rather than left blank");
  ok(/census/.test(slot.text) && /rows is not iterable/.test(slot.text),
     "and says so in the page, where the reader is looking");
  ok(/COMPUTED|computed/.test(slot.text),
     "with its provenance intact -- a failed region is still a declared region");
}

console.log("\nthe pane: Gate 0 before anything is asked");
{
  const pane = page.locator('[data-testid="dashboard-pane"]');
  await pane.waitFor({ timeout: 5000 });
  ok(await pane.count() === 1, "the pane opens beside the view editors");
  for (const f of ["repos", "queries", "rows", "bytes", "readonly", "catalog"]) {
    ok(await page.locator(`[data-testid="dashboard-grant-${f}"]`).count() === 1,
       `the grant names its ${f}`);
  }
  ok(await page.locator('[data-testid="dashboard-grant-readonly"]').isChecked(),
     "read-only by default");
  ok(await page.evaluate(() => window.__counts().llm) === 0,
     "and nothing has been sent to the model: the grant comes first");
  ok(await page.locator('[data-testid="dashboard-run-panels"]').count() === 0,
     "Gate 1 does not exist yet");
}

console.log("\nPhase 1 runs inside the grant, and Gate 1 reviews the set");
{
  await page.locator('[data-testid="dashboard-grant-queries"]').fill("4");
  await page.locator('[data-testid="dashboard-grant"]').click();
  await page.locator('[data-testid="dashboard-run-panels"]').waitFor({ timeout: 8000 });

  ok(await page.evaluate(() => window.__counts().llm) >= 2, "the model ran");
  ok(await page.evaluate(() => window.__counts().sparql) === 0,
     "and NOTHING was run against the store on its behalf: the model proposes, it does not execute");

  const meter = await page.locator('[data-testid="dashboard-meter"]').textContent();
  ok(/calls 1 of 4/.test(meter), "the meter shows what the grant has spent, live");

  const gate1 = await page.locator('[data-testid="dashboard-pane"] section.dsh-gate').nth(1).textContent();
  ok(gate1.includes("SELECT ?region"), "Gate 1 shows the query");
  ok(gate1.includes("bound") && gate1.includes("derived") && gate1.includes("asserted"),
     "every region, by kind");
  ok(gate1.includes("inputs.sales"), "including the transform's source -- a derived number is only checkable against it");
  ok(gate1.includes("outside knowledge"), "and which sentences nothing in the repository supports");
  ok((await page.locator('[data-testid="dashboard-run-panels"]').textContent()).includes("1 panel"),
     "and the button says how much will run");
}

console.log("\nPhase 2 is the interface's own, and Gate 2 follows it");
{
  await page.locator('[data-testid="dashboard-run-panels"]').click();
  await page.locator('[data-testid="dashboard-save"]').waitFor({ timeout: 8000 });
  ok(await page.evaluate(() => window.__counts().sparql) === 1,
     "the panel is run once, by the pane");
  ok(await page.evaluate(() => window.__requests.some(
       (r) => r.url.includes("/sparql") && r.accept === "text/tab-separated-values")),
     "in the notation the panel asked for");
  ok(await page.evaluate(() => window.__counts().views) === 0,
     "and the catalogue was not written, because that box was not ticked");
  ok(await page.locator('[data-testid="dashboard-frame-holder"] iframe').count() === 1,
     "the page is mounted");
  const sandbox = await page.locator('[data-testid="dashboard-frame-holder"] iframe')
                            .getAttribute("sandbox");
  ok(sandbox === "allow-scripts", "in the same frame the policy describes");
  for (const b of ["dashboard-keep", "dashboard-save", "dashboard-refresh", "dashboard-discard-page"]) {
    ok(await page.locator(`[data-testid="${b}"]`).count() === 1, `Gate 2 offers ${b.slice(10)}`);
  }
}

console.log("\nan answer cut off at the ceiling is reported as that, not as a refusal");
{
  // What a live run produced: seven turns of good exploring, then a final
  // turn that ran out of output tokens with the block still open.  The gate
  // used to show turn 1's opening line under "the answer is above", which
  // reads as a model that said hello and stopped.
  await page.evaluate(() => { window.__truncate = true; window.__openSecond(); });
  const pane = "#dashboard-playwright-cutoff";
  await page.locator(`${pane} [data-testid="dashboard-grant"]`).click();
  await page.locator(`${pane} [data-testid="dsh-truncated"]`).waitFor({ timeout: 8000 });

  const gate = await page.locator(`${pane} section.dsh-gate`).nth(1).textContent();
  ok(/ran out of room/.test(gate) && /32000-token/.test(gate),
     "the gate says the turn hit the ceiling, and names the ceiling");
  ok(/fewer panels or a plainer page/.test(gate),
     "and gives the remedy that belongs to THIS failure");
  ok(!/The run produced no dashboard block/.test(gate),
     "not the one that belongs to a model that declined");
  ok(await page.locator(`${pane} [data-testid="dsh-stale-prose"]`).count() === 1,
     "prose from an earlier turn is marked as not being the answer");
  const stale = await page.locator(`${pane} [data-testid="dsh-stale-prose"]`).textContent();
  ok(/turn 1 of 2/.test(stale), "naming which turn it came from");
  ok(await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).count() === 0,
     "and nothing is offered to run, because there is nothing to run");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
