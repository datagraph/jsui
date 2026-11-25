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

/*
 * The same page, with two figures the model drew: one declaring the panel it
 * was drawn from and one declaring nothing.  It is mounted in the frame on
 * its own rather than added to PROPOSAL, because PROPOSAL is also what the
 * stubbed model answers with, and a page that draws something is not the
 * page the gate's missing-figure notice is about.
 */
const FIGURED = {
  ...PROPOSAL,
  assertions: [...PROPOSAL.assertions,
               { id: "figure", inputs: ["sales"], text: "" },
               { id: "unsourced", inputs: [], text: "" }],
  html: PROPOSAL.html
      + '<figure data-asserted="figure"><svg viewBox="0 0 10 10"><rect width="4" height="9"/>'
      + '</svg></figure>'
      + '<figure data-asserted="unsourced"><svg viewBox="0 0 10 10"><rect width="2" height="3"/>'
      + '</svg></figure>',
};

const TSV = "?region\t?value\nNorth\t120\nSouth\t80\n";

/*
 * Two views made of elements, for U-116.  A patch is diffed over every view a
 * document has and the runtime holds one section per view, so an instruction
 * had to say which view it was for -- and until it did, a root-level insert
 * destined for the view that is NOT showing was applied to the one that was.
 * Nothing faulted, so the pane reported it applied in place, and the element
 * was in the wrong section.  Two views, two panels, and one insert is the
 * whole reproduction.
 */
const TWO_VIEWS = {
  title: "Two views",
  panels: [],
  views: [
    { name: "main", title: "First",
      elements: [{ name: "e-main", kind: "panel", order: "a",
                   attributes: { label: "First" } }] },
    { name: "second", title: "Second",
      elements: [{ name: "e-second", kind: "panel", order: "a",
                   attributes: { label: "Second" } }] },
  ],
};

const HARNESS = `<!doctype html><meta charset="utf-8"><title>dashboard harness</title>
<body>
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="view-editors"><div class="view-editors-container"></div></div>
</div>
<div id="frame-host"></div>
<div id="views-host"></div>
<div id="ledger-host"></div>
<div id="broken-host"></div>
<div id="blank-host"></div>
<script type="module">
import { mountDashboard } from "/lib/dashboard/frame.js";
import { validateDashboard, withInputDigests } from "/lib/dashboard/spec.js";
import { validateApplication } from "/lib/app/document.js";
import { openDashboardPane } from "/ui/components/dashboard-pane.js";
import { paneState } from "/ui/components/mcp-pane-state.js";
import { evidenceFrom, evidenceSummary } from "/lib/llm/evidence.js";

const PROPOSAL = ${JSON.stringify(PROPOSAL)};
const TWO_VIEWS = ${JSON.stringify(TWO_VIEWS)};
const FIGURED = ${JSON.stringify(FIGURED)};
const TSV = ${JSON.stringify(TSV)};

/* ── the frame on its own ─────────────────────────────────────────────── */
const v = validateDashboard(FIGURED);
window.__validation = { ok: v.ok, errors: v.errors, warnings: v.warnings };
const spec = withInputDigests(v.spec, { sales: { digest: "first" } });
const handle = mountDashboard(document.getElementById("frame-host"), spec, {
  onRefresh: () => { window.__refreshes = (window.__refreshes || 0) + 1; },
  onEvent: (e) => { (window.__frameEvents = window.__frameEvents || []).push(e); },
});
window.__handle = handle;

/* ── two views, and a patch that addresses the one not showing (U-116) ── */
{
  // validateApplication, not validateDashboard: a dashboard spec is markup,
  // and an element tree is an application document.  The frame draws either.
  const two = validateApplication({ id: "two-views", ...TWO_VIEWS });
  window.__twoValidation = { ok: two.ok, errors: two.errors,
                             views: (two.document?.views || []).map((v) => v.name) };
  const viewsHandle = mountDashboard(document.getElementById("views-host"), two.document, {
    onEvent: (e) => { (window.__viewEvents = window.__viewEvents || []).push(e); },
  });
  window.__insertIntoSecond = async () => {
    const next = JSON.parse(JSON.stringify(two.document));
    next.revision = (next.revision || 1) + 1;
    next.views[1].elements.push({ name: "e-added", kind: "panel", order: "b",
                                  attributes: { label: "Added" }, children: [] });
    return viewsHandle.update(next, {
      ops: [{ op: "insert-element", view: "second", parent: null, kind: "panel" }],
      post: { results: {}, stale: [], parameters: {}, state: {} },
    });
  };
}
handle.post({ results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                                  text: TSV, digest: "first", rows: 2 } }, stale: [] });

/* ── the same page, with the interface's own record posted in ─────────── */
/* Built from events of the shape the adapter emits, so the test exercises
   the ledger end to end rather than a hand-written summary of one. */
const RUN = [
  { type: "prompt", text: "sales by region, as a table and a bar chart" },
  { type: "primer", uri: "urn:primer", repository: "nsonly", ok: true, chars: 400 },
  { type: "digest", id: "c1", label: "r1", rows: 34, form: "table", digest: "d1" },
  { type: "tool_result", id: "c1", name: "query", ok: true, repository: "ns223",
    input: { query: "SELECT ?region ?total WHERE {}" }, label: "r1", digest: "d1",
    text: "x".repeat(9000) },
  { type: "tool_result", id: "c2", name: "query", ok: true, repository: "nsbrick",
    input: { query: "SELECT ?a WHERE {}" }, text: "a,b" },
  { type: "tool_result", id: "c3", name: "query", ok: false, repository: "nsmulti",
    input: { query: "SELECT ?b WHERE {}" }, text: "the store refused" },
];
const ledgerHandle = mountDashboard(document.getElementById("ledger-host"), spec, {
  onEvent: () => {},
});
ledgerHandle.post({ results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                                        text: TSV, digest: "first", rows: 2 } },
                    stale: [],
                    evidence: evidenceSummary([evidenceFrom(RUN, { turn: 1 })]) });
window.__ledgerHandle = ledgerHandle;

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

/* ── three figures the page promised, two of which do not draw ────────── */
/*
 * Both failures are ones a renderer commits WITHOUT THROWING: it runs to the
 * end, the caption and the legend beside it are right, and the picture is
 * not there.  The first is the namespace -- createElement("svg") makes an
 * HTML element of that name, which is in the document and is never drawn --
 * and the second is the arithmetic, where one log of zero turns every
 * coordinate into NaN.  The third draws, and is here to be left alone.
 */
const BLANK = {
  title: "Figures", panels: PROPOSAL.panels, assertions: [],
  transforms: ["wrongNamespace", "notANumber", "drawn"].map((name) => ({
    name, inputs: ["sales"], body: "return inputs.sales.objects;",
  })),
  html: '<section data-bound="sales"></section>'
      + '<figure data-derived="wrongNamespace"><figcaption>Counts by predicate</figcaption></figure>'
      + '<figure data-derived="notANumber"></figure>'
      + '<figure data-derived="drawn"></figure>',
  script: [
    'var SVG = "http://www.w3.org/2000/svg";',
    'dashboard.render("wrongNamespace", function (el, ctx) {',
    '  var svg = document.createElement("svg");',       // the whole bug
    '  svg.setAttribute("viewBox", "0 0 100 40");',
    '  var r = document.createElement("rect");',
    '  r.setAttribute("x", "0"); r.setAttribute("y", "0");',
    '  r.setAttribute("width", "20"); r.setAttribute("height", "30");',
    '  svg.appendChild(r); el.appendChild(svg);',
    '});',
    'dashboard.render("notANumber", function (el, ctx) {',
    '  var svg = document.createElementNS(SVG, "svg");',
    '  svg.setAttribute("viewBox", "0 0 100 40");',
    '  var r = document.createElementNS(SVG, "rect");',
    '  var h = 30 * Math.log10(0) / Math.log10(100);',   // -Infinity -> NaN
    '  r.setAttribute("x", "0"); r.setAttribute("y", String(40 - h));',
    '  r.setAttribute("width", "20"); r.setAttribute("height", String(h));',
    '  svg.appendChild(r); el.appendChild(svg);',
    '});',
    'dashboard.render("drawn", function (el, ctx) {',
    '  var svg = document.createElementNS(SVG, "svg");',
    '  svg.setAttribute("viewBox", "0 0 100 40");',
    '  svg.setAttribute("width", "200"); svg.setAttribute("height", "80");',
    '  var r = document.createElementNS(SVG, "rect");',
    '  r.setAttribute("x", "0"); r.setAttribute("y", "10");',
    '  r.setAttribute("width", "20"); r.setAttribute("height", "30");',
    '  svg.appendChild(r); el.appendChild(svg);',
    '});',
  ].join("\\n"),
};
const blank = mountDashboard(document.getElementById("blank-host"), BLANK, {
  onEvent: (e) => { (window.__blankEvents = window.__blankEvents || []).push(e); },
});
blank.post({ results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                                 text: TSV, digest: "first", rows: 2 } }, stale: [] });

/* ── the pane, with the provider and the store stubbed ────────────────── */
const st = paneState("playwright", "test", location.origin);
st.llmKey = "test-key";
st.token = "test-token";
// The second pane keeps its own state, so it needs its own key.
const st2 = paneState("playwright", "cutoff", location.origin);
st2.llmKey = "test-key";
st2.token = "test-token";
const st3 = paneState("playwright", "chart", location.origin);
st3.llmKey = "test-key";
st3.token = "test-token";

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
    /* A store that answers 200 and refuses in the body: the shape an access
       refusal takes when the transport succeeded, and the one a server log
       records as a success. */
    if (u.includes("/refuses/")) {
      return json({ jsonrpc: "2.0", id: 1,
                    error: { code: -32602,
                             message: "Repository not found: playwright/refuses" } });
    }
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
        return json({ id: "t1", type: "message", role: "assistant", model: "served-model-id",
          stop_reason: "tool_use",
          content: [{ type: "text",
                      text: "I'll start by reading the vocabulary and cataloguing the repository." },
                    { type: "tool_use", id: "x1", name: "survey", input: { op: "catalog" } }],
          usage: { input_tokens: 5, output_tokens: 5 } });
      }
      return json({ id: "t2", type: "message", role: "assistant", model: "served-model-id",
        stop_reason: "max_tokens",
        content: [], usage: { input_tokens: 37989, output_tokens: 32000 } });
    }
    llmTurn += 1;
    if (llmTurn === 1) {
      return json({ id: "m1", type: "message", role: "assistant", model: "served-model-id",
        stop_reason: "tool_use",
        content: [{ type: "text", text: "Looking at what is there." },
                  { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog" } }],
        usage: { input_tokens: 5, output_tokens: 5 } });
    }
    return json({ id: "m2", type: "message", role: "assistant", model: "served-model-id",
      stop_reason: "end_turn",
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
// A prompt that names a figure, answered by the proposal above -- which is
// three regions of table and prose and draws nothing.
window.__openChart = () => openDashboardPane(app, {
  container: document.querySelector(".view-editors-container"),
  accountName: "playwright", repositoryName: "chart",
  prompt: "sales by region, as a table and as a bar chart",
});
window.__openPair = () => openDashboardPane(app, {
  container: document.querySelector(".view-editors-container"),
  // Named for its FIRST store, exactly as the account's pane opens it.
  accountName: "playwright", repositoryName: "test",
  stores: [
    { account: "playwright", repository: "test",
      endpoint: location.origin + "/playwright/test/mcp", token: "t" },
    { account: "playwright", repository: "refuses",
      endpoint: location.origin + "/playwright/refuses/mcp", token: "t" },
  ],
  prompt: "a page over both",
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
       .includes("no source declared"),
     "and one that cites nothing says THAT -- what the interface knows is that the document "
   + "declared no source, not where the content came from");

  /*
   * The mark is about the document, not about the data's origin.
   *
   * It read "written by the model — not from this repository", which is a
   * claim the interface has never been in a position to make: all it has is
   * whether the assertion declared `inputs'.  Live, 2026-11-21: a revision
   * drew a chart from three panels and the chart carried that note, while the
   * paragraph under it cited the same three panels and said so.  Same data,
   * two contradictory provenances, and the one the reader could see was the
   * false one.
   */
  ok((await inside.evaluate(() =>
       document.querySelector('[data-asserted="figure"] svg') !== null)),
     "a figure in an asserted slot survives the fill -- an SVG with no text in it "
   + "used to read as an empty slot and be replaced by the assertion's text");
  const fig = await inside.evaluate(() =>
    document.querySelector('[data-asserted="figure"] .dash-prov').textContent);
  ok(/drawn by the model from sales/.test(fig),
     `a figure drawn from a panel is attributed to that panel, exactly as the prose is: "${fig}"`);
  ok(!/not from this repository/.test(fig),
     "and is not told it came from somewhere else");
  const un = await inside.evaluate(() =>
    document.querySelector('[data-asserted="unsourced"] .dash-prov').textContent);
  ok(/drawn by the model/.test(un) && /no source declared/.test(un),
     `a figure that declares nothing says so, as drawn and not written: "${un}"`);
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

console.log("\nthe frame settles on a height instead of climbing to the ceiling");
{
  /* The reported symptom: a page that "continues to append content after the
     tables are complete -- it is whitespace, but it continues without
     conclusion".  Nothing was appended.  The frame measured the scrolling
     box, which is never smaller than the viewport it had just been given, so
     every observation returned the previous height plus the margin and the
     pane set it again: about 480 pixels a second, up to the ceiling. */
  const height = () => page.evaluate(() =>
    parseFloat(document.querySelector("#frame-host iframe").style.height) || 0);
  const first = await height();
  await page.waitForTimeout(900);
  const second = await height();
  ok(second === first,
     `the height stops where the content is and stays there (${first}px, then ${second}px)`);
  ok(second < 4000, "rather than climbing to the ceiling the pane caps it at");

  const content = await (await frameIn("#frame-host iframe")).evaluate(() =>
    Math.max(document.body.scrollHeight, document.documentElement.offsetHeight));
  ok(Math.abs(second - (content + 8)) <= 1,
     `and it is the content's own height plus the margin (${content} + 8), measured on the `
   + "body, whose box does not know the viewport");
}

console.log("\nU-116: a patch applies in the view it names, not in the view on screen");
{
  /* The report this answers: `revision 3 · presentational · applied in place'
     over a page that had not changed. Two faults behind it, and this is the
     first -- every instruction was applied against the SHOWING view's
     section, so an insert destined for another view went into this one. */
  // Read from inside the frame: its origin is opaque to the embedder, which
  // is the whole of D-R and is asserted above.
  ok((await page.evaluate(() => window.__twoValidation)).views.join(",") === "main,second",
     "the document really has two element views");
  const inViews = await frameIn("#views-host iframe");
  const sections = () => inViews.evaluate(() => Array.from(
    document.querySelectorAll(".dash-view")
  ).map((s) => ({ view: s.getAttribute("data-view-name"),
                  hidden: s.hasAttribute("hidden"),
                  named: Array.from(s.querySelectorAll("[data-ui]"))
                              .map((e) => e.getAttribute("data-ui")) })));
  await inViews.waitForFunction(
    () => document.querySelectorAll(".dash-view").length === 2, null, { timeout: 5000 });

  const before = await sections();
  ok(before.length === 2 && before[0].view === "main" && before[1].hidden,
     "two views, the first showing and the second hidden");

  const how = await page.evaluate(() => window.__insertIntoSecond());
  ok(how.applied === "in-place", `the patch applied in place (${how.applied})`);

  const after = await sections();
  const main = after.find((s) => s.view === "main");
  const second = after.find((s) => s.view === "second");
  ok(second.named.includes("e-added"),
     "the new element is in the view the patch named");
  ok(!main.named.includes("e-added"),
     "and NOT in the view that happened to be on screen — which is where it "
     + "went before, silently, because a null parent resolved to one root for "
     + "every view");

  ok(how.here === 0 && how.elsewhere === 1,
     `and the pane is told where it landed: ${how.here} here, ${how.elsewhere} elsewhere`);
  ok((how.views || []).join(",") === "second",
     "by name, so the reply can say which view to look at rather than reporting "
     + "a change the reader cannot see as an unqualified success");
}

console.log("\na figure that drew nothing says so, where the figure is not");
{
  /* The report this answers: the page's own prose described a clustered bar
     chart on a log axis, the legend named all three repositories, and there
     was no chart.  Nothing threw, so nothing was reported, and the only
     party who could see the omission was the reader. */
  const blank = await frameIn("#blank-host iframe");
  await blank.waitForFunction(
    () => document.querySelectorAll('[data-derived] > .dash-blank').length >= 2,
    null, { timeout: 5000 });

  const read = async (name) => blank.evaluate((n) => {
    const el = document.querySelector(`[data-derived="${n}"]`);
    const note = el.querySelector(":scope > .dash-blank");
    return { failed: el.hasAttribute("data-failed"), note: note ? note.textContent : null,
             box: el.querySelector("svg")
                    ? el.querySelector("svg").getBoundingClientRect().height : null };
  }, name);

  const ns = await read("wrongNamespace");
  ok(ns.failed && /did not draw/.test(ns.note || ""),
     "a renderer that built its SVG with createElement is caught, although it threw nothing "
   + "and left an <svg> in the document");
  ok(/HTML element, not an SVG one/.test(ns.note || "")
     && /createElementNS/.test(ns.note || ""),
     `and is told exactly what to do instead: "${(ns.note || "").slice(40, 130)}…"`);

  const nan = await read("notANumber");
  ok(nan.failed && /not a finite number/.test(nan.note || ""),
     "a bar whose height came out NaN -- one log of zero on a log axis -- is caught too");
  ok(/\(rect@[a-z]+=(NaN|-?Infinity)\)/.test(nan.note || ""),
     `naming the first attribute that is not a number: "${(nan.note || "").slice(55, 110)}…"`);

  const drew = await read("drawn");
  ok(!drew.failed && drew.note === null && drew.box > 10,
     "while the figure that drew is left alone");

  const errs = await page.evaluate(() =>
    (window.__blankEvents || []).filter((e) => e.type === "error").map((e) => e.where));
  ok(errs.includes("render:wrongNamespace") && errs.includes("render:notANumber"),
     "and both reach the pane as errors, which is what puts them in front of the repair loop "
   + "instead of in front of nobody");
  ok(!errs.includes("render:drawn"), "with nothing said about the one that worked");
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

  const runLog = await page.locator('[data-testid="dashboard-pane"] '
                                  + '[data-testid="dashboard-log"]').textContent();
  ok(/tools · playwright\/test/.test(runLog),
     "the run log names the repository that offered the tools, not just that some were offered");
}

/*
 * Show/hide, as the view editors have it.
 *
 * A run leaves every stage on the screen, because each is evidence for the
 * next -- and by the time the page itself is up, that is a column several
 * screens long with the thing you want to look at at the bottom of it.  The
 * remedy is the control this interface already uses everywhere else, so the
 * assertions are about it being the SAME control: the caret from the view
 * editor, open by default, on the stages and on each box inside Gate 1.
 */
console.log("\nevery stage and every box can be collapsed, like a view editor");
{
  const pane = '[data-testid="dashboard-pane"]';
  const gate1Body = `${pane} [data-testid="dashboard-toggle-gate1"]`;

  ok(await page.locator(`${pane} [data-testid="dashboard-toggle-gate0"]`).count() === 1
     && await page.locator(gate1Body).count() === 1
     && await page.locator(`${pane} [data-testid="dashboard-toggle-phase1"]`).count() === 1,
     "every stage carries one");
  ok(await page.locator(gate1Body).getAttribute("aria-expanded") === "true",
     "open by default — a gate that hid what it was asking about would not be a gate");
  ok(await page.locator(`${gate1Body} svg path`).getAttribute("d") === "M6 10l6 6l6 -6h-12",
     "drawn as the caret js/sparql-editor.js draws, down for shown");

  // The boxes: one per panel, transform, parameter and assertion.
  for (const [what, id] of [["the panel", "panel-sales"], ["the transform", "transform-total"],
                            ["the assertion", "assertion-lead"]]) {
    ok(await page.locator(`${pane} [data-testid="dashboard-toggle-${id}"]`).count() === 1,
       `${what} has its own`);
  }

  const box = `${pane} [data-testid="dashboard-toggle-panel-sales"]`;
  const query = `${pane} section.dsh-gate pre.dsh-pre`;
  const before = await page.locator(query).first().isVisible();
  await page.locator(box).click();
  ok(before && !(await page.locator(query).first().isVisible()),
     "and pressing it hides the query, which is what buries this screen");
  ok(await page.locator(box).getAttribute("aria-expanded") === "false"
     && await page.locator(`${box} svg path`).getAttribute("d") === "M10 18l6 -6l-6 -6v12",
     "with the caret turned to face the state it is now in");
  ok(await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).isVisible(),
     "the button to run stays where it was: collapsing is tidying, not withdrawing");

  // The header is the target, not only the 16px square at the end of it.
  await page.locator(`${pane} [data-testid="dashboard-toggle-panel-sales"]`)
            .evaluate((b) => b.parentElement.click());
  ok(await page.locator(query).first().isVisible(),
     "clicking anywhere on the header works too, since a 16px square is findable "
   + "only by someone already looking for it");

  // And a stage collapses whole, with its gate still legible by its heading.
  await page.locator(gate1Body).click();
  ok(!(await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).isVisible()),
     "a collapsed stage takes its body with it");
  ok(await page.locator(`${pane} section.dsh-gate`).nth(1).isVisible(),
     "while the stage itself stays on the screen, so the run is still readable as a sequence");
  await page.locator(gate1Body).click();
  ok(await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).isVisible(),
     "and it comes back");
}

/*
 * EU AI Act Article 50, as the panes answer it.  `ui-generator.md' §2.6 R-P2.
 *
 * 50(5) wants the disclosure "in a clear and distinguishable manner at the
 * latest at the time of the first interaction or exposure".  A tooltip does
 * not meet that and neither does a detail view: it is met by text on the
 * screen while the content is.  The assertions below are about the two ways
 * that is easy to lose -- a footnote that folds away with its stage, and a
 * footnote that names the model the interface ASKED for rather than the one
 * the provider served.
 */
console.log("\nevery stage discloses what produced it, and when");
{
  const pane = '[data-testid="dashboard-pane"]';
  const note = `${pane} [data-testid="dashboard-provenance-gate1"]`;
  ok(await page.locator(note).count() === 1, "a stage carries a footnote");
  const text = await page.locator(note).textContent();
  ok(/Generated by/.test(text), "saying what generated it");
  ok(/served-model-id/.test(text),
     "named as the PROVIDER SERVED it — the fixture answers a request for one model "
   + "with another, and the served identifier is the fact a reconstruction needs");
  ok(new RegExp(new Date().toISOString().slice(0, 10)).test(text), "and when");
  ok(/playwright\/test/.test(text),
     "with the repository, so the mark cannot be read as saying a model invented the data");
  ok(/Art\. 50/.test(text), "and which obligation it answers");

  const data = await page.locator(note).evaluate((n) => ({ ...n.dataset }));
  ok(data.aiModel === "served-model-id" && Boolean(data.aiGeneratedAt),
     "the same facts as data on the element, for a program that will not parse prose (R-P4)");
  ok(data.aiModelServed === "true",
     "including whether the identifier is the served one or only the requested one");

  const gate0 = `${pane} [data-testid="dashboard-provenance-gate0"]`;
  ok(/Nothing on this pane was produced by a model/.test(
       await page.locator(gate0).textContent()),
     "a stage nothing was generated on says so, rather than showing a mark with blanks "
   + "in it — over-marking is how a reader learns to ignore every mark");

  // The one that would quietly undo all of it.
  await page.locator(`${pane} [data-testid="dashboard-toggle-gate1"]`).click();
  ok(await page.locator(note).isVisible(),
     "and collapsing the stage does NOT take its disclosure with it: a mark the reader "
   + "can fold away is absent exactly when someone is looking past the interface");
  await page.locator(`${pane} [data-testid="dashboard-toggle-gate1"]`).click();
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

  // REQ-23.2.6, through the pane rather than the frame on its own: the
  // ledger the run built reaches the page it composed.  This is the half
  // that cannot be tested by posting a summary in by hand -- it asserts that
  // the pane kept the record of its own exchange and sent it.
  {
    const inside = await frameIn('[data-testid="dashboard-frame-holder"] iframe');
    await inside.waitForFunction(
      () => document.querySelector('[data-asserted] .dash-prov') !== null, null,
      { timeout: 8000 });
    const m = await inside.evaluate(() =>
      document.querySelector('[data-asserted] .dash-prov').textContent);
    const t = await inside.evaluate(() =>
      document.querySelector('[data-asserted] .dash-prov').title);
    ok(/by the model from \S/.test(m),
       `and marked from the record the PANE kept of its own run: "${m}"`);
    ok(/The interface put \d+ results? in front of the model/.test(t),
       `with the sources it was shown, in order: "${t}"`);
  }
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

console.log("\na store that offers nothing is named in the run log, with the reason");
{
  // Compose, not Ask: this pane keeps its own log and writes nothing to the
  // exploration pane's transcript, so this log is the only place a reader
  // could have found out which store was missing from the page.
  await page.evaluate(() => { window.__truncate = false; window.__openPair(); });
  // Addressed by its store, not by its id: a pane over several carries the
  // other stores in the id, which is the pane's business and not the test's.
  // The pane over several carries the other stores in its id, so it is
  // addressed by that prefix rather than by the primary alone.
  const pane = '[data-testid="dashboard-pane"][id^="dashboard-playwright-test-"]';
  await page.locator(`${pane} [data-testid="dashboard-grant"]`).click();
  await page.waitForFunction(
    (sel) => /NOT READABLE/.test(
      document.querySelector(`${sel} [data-testid="dashboard-log"]`)?.textContent || ""),
    pane, { timeout: 8000 });

  const log = await page.locator(`${pane} [data-testid="dashboard-log"]`).textContent();
  ok(/tools · playwright\/refuses/.test(log),
     "the store that offered nothing is named -- three stores used to print three identical lines");
  ok(/Repository not found/.test(log),
     "with the server's own words for why");
  ok(/\[200\]/.test(log),
     "and the status it answered with, which is why a server log shows nothing wrong");
  ok(/tools · playwright\/test[^\n]*survey/.test(log),
     "and the FIRST store -- the one the pane is named for -- has its tools too");
}

/*
 * REQ-34.3.12.  The half of the prompt that was dropped.
 *
 * Live, 2026-11-20: a prompt asking for tables AND bar graphs produced three
 * tables, and the user found out by re-reading their own question against the
 * page.  The gate reviews what the model proposed; this is the one thing it
 * can check the proposal against that nothing else in the pane holds -- the
 * question it was an answer to.
 */
console.log("\na figure that was asked for and not drawn is said at the gate");
{
  await page.evaluate(() => { window.__truncate = false; window.__openChart(); });
  const pane = '[data-testid="dashboard-pane"][id="dashboard-playwright-chart"]';
  await page.locator(`${pane} [data-testid="dashboard-grant"]`).click();
  await page.locator(`${pane} [data-testid="dashboard-no-figure"]`).waitFor({ timeout: 8000 });

  const said = await page.locator(`${pane} [data-testid="dashboard-no-figure"]`).textContent();
  ok(/draws none/.test(said), "the gate says the page draws nothing");
  ok(/chart/.test(said), "quoting the word the request used");
  ok(/may be right/.test(said),
     "as a notice and not a refusal -- some results cannot carry a chart, "
   + "and only the person who asked can say");
  ok(await page.locator(`${pane} [data-testid="dashboard-run-panels"]`).count() === 1,
     "and the page is still offered: nothing is blocked by this");

  const list = `${pane} [data-testid="dashboard-exchange"]`;
  ok(await page.locator(list).count() === 1,
     "this pane too draws the exchange rather than summarising it");
  ok(/sales by region, as a table and as a bar chart/.test(
       await page.locator(list).textContent()),
     "beginning with the prompt the run was started from");
}

console.log("\nREQ-23.2.6: the page is marked from the interface's record, not from the answer");
{
  /*
   * The argument that retired the last version of this mark.
   *
   * A mark read out of the document is only as good as the model's
   * bookkeeping about its own work, and it had already been wrong once in
   * the worst possible way -- a chart and the paragraph under it, drawn from
   * the same three panels, carrying contradictory provenances.  The fix is
   * not better wording for a claim derived from `inputs'.  It is that the
   * interface SENT the data: every row went out through the adapter on an
   * event with its repository and digest attached, so the attribution is
   * something the interface knows rather than something it is told.
   */
  const inside = await frameIn("#ledger-host iframe");
  await inside.waitForFunction(
    () => document.querySelector('[data-asserted="figure"] .dash-prov') !== null);

  const prov = (id) => inside.evaluate((x) =>
    document.querySelector('[data-asserted="' + x + '"] .dash-prov').textContent, id);
  const title = (id) => inside.evaluate((x) =>
    document.querySelector('[data-asserted="' + x + '"] .dash-prov').title, id);

  const fig = await prov("figure");
  ok(/drawn by the model from ns223, nsbrick/.test(fig),
     `a figure is attributed to the repositories the INTERFACE read: "${fig}"`);
  ok(!/nsmulti/.test(fig),
     "and not to the store that refused -- an error message is not data from a store");
  ok(!/nsonly/.test(fig),
     "nor to one whose documentation was read and whose rows were not");

  const un = await prov("unsourced");
  ok(/drawn by the model from ns223, nsbrick/.test(un),
     `a figure that declared NOTHING gets the same attribution, because the `
   + `interface knows what it showed the model whether or not the model said so: "${un}"`);
  ok(!/no source declared/.test(un) && !/not from this repository/.test(un),
     "and carries no claim about where the content did not come from");
  ok((await prov("lead")) === un.replace("drawn", "written"),
     "the prose and the picture say the same thing about the same data -- which is "
   + "the contradiction the reader saw, stated as it should have been");

  const t = await title("figure");
  ok(/r1 · ns223 · 34 rows/.test(t),
     `the detail names each source, in the order it was read: "${t}"`);
  ok(/1 call did not answer/.test(t), "including the one that did not");
  ok(/names sales as what it was written against/.test(t),
     "and `inputs' keeps its own, separate job: what the staleness check watches");
  ok(/not marked when the data moves/.test(await title("unsourced")),
     "which the figure that declared nothing is told it does not have");

  ok(/Read from ns223, nsbrick\./.test(await inside.evaluate(() =>
       document.querySelector(".dash-footer").textContent)),
     "and the page's own footer says what it was built from");

  // The third state: a page this interface holds no record for.
  const other = await frameIn("#frame-host iframe");
  ok(/no source declared/.test(await other.evaluate(() =>
       document.querySelector('[data-asserted="outside"] .dash-prov').textContent)),
     "a frame posted no ledger falls back to what the document declares");
  ok(/No record of what the model was shown/.test(await other.evaluate(() =>
       document.querySelector('[data-asserted="outside"] .dash-prov').title)),
     "and says it holds no record -- which is not the same statement as `nothing was read'");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
