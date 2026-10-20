/**
 * The figure, in a real browser.
 *
 * D-M is a claim about what a browser does with a sandboxed iframe, and it is
 * the claim the whole single-figure path leans on: model-authored SVG is
 * active content -- `<script>' inside an `<svg>' runs when the SVG is
 * inlined, so does `onload=' on any element, and `<image href>' fetches from
 * a host of the author's choosing -- and the pane that would inline it runs
 * on the same origin as the session token.  jsdom will not settle that; it
 * does not enforce sandbox flags at all.  So it is settled here, in Chromium,
 * with the real attribute on the real document.
 *
 * The probe is a figure that tries four things at once.  It is mounted TWICE:
 * once in the frame the pane actually uses, and once in a control frame
 * identical but for `allow-scripts'.  The control is what makes the result
 * mean anything -- without it, "the script did not run" is equally consistent
 * with "the probe never worked".
 *
 * The second half walks the gate: Gate 1 with nothing run, the interface's
 * own run in the notation that was chosen, the drawing turn with no tools,
 * Gate 2 and its dispositions, and the sweep of a temporary view that was not
 * kept.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

/* A figure that tries everything the policy is supposed to stop. */
const PROBE = `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"
     onload="parent.postMessage('onload-ran','*')">
  <title>probe</title>
  <rect id="bar" x="10" y="10" width="80" height="80" fill="#36c"></rect>
  <image href="http://127.0.0.1:1/pixel.png" x="0" y="0" width="4" height="4"></image>
  <script>parent.postMessage("script-ran", "*");</script>
</svg>`;

const TSV = "?region\t?value\nNorth\t120\nSouth\t80\n";

const DRAWN = '<svg viewBox="0 0 200 100"><title>Sales</title>'
            + '<rect x="0" y="0" width="120" height="20" fill="#36c"/>'
            + '<rect x="0" y="30" width="80" height="20" fill="#36c"/></svg>';

const PROPOSAL_TEXT =
  "Two regions, so a bar each.\n\n```sparql\nSELECT ?region ?value WHERE { ?s :region ?region ; :value ?value }\n```\n\n"
+ '```figure\n{"kind":"svg","title":"Sales by region","caption":"a bar per region",'
+ '"accept":"text/tab-separated-values","why":"a comparison between two named things"}\n```';

/* The probe contains a literal </script>, which would end the harness's own
   module block; `<' is escaped so the page sees a string and not a tag. */
const embed = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const HARNESS = `<!doctype html><meta charset="utf-8"><title>figure harness</title>
<body>
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="view-editors"><div class="view-editors-container"></div></div>
</div>
<div id="frame-host"></div>
<div id="control-host"></div>
<div id="gate-host"></div>
<script type="module">
import { mountFigure, FIGURE_SANDBOX } from "/lib/figure/frame.js";
import { openFigureGate } from "/ui/components/figure-gate.js";
import { openExplorationPane } from "/ui/components/exploration-pane.js";
import { paneState } from "/ui/components/mcp-pane-state.js";

const PROBE = ${embed(PROBE)};
const TSV = ${embed(TSV)};
const DRAWN = ${embed(DRAWN)};
const PROPOSAL_TEXT = ${embed(PROPOSAL_TEXT)};

// Which frame spoke, by window identity -- an opaque origin is the string
// "null" for every sandboxed document, so it distinguishes nothing.
window.__messages = [];
const who = (src) => {
  const named = { figure: document.querySelector("#frame-host iframe"),
                  bare: document.getElementById("control-bare"),
                  policed: document.getElementById("control-policed") };
  for (const [k, f] of Object.entries(named)) if (f && src === f.contentWindow) return k;
  return "other";
};
window.addEventListener("message", (e) => {
  window.__messages.push(who(e.source) + ":" + String(e.data));
});

/* the frame the pane actually uses */
const handle = mountFigure(document.getElementById("frame-host"),
                           { kind: "svg", text: PROBE },
                           { caption: "the probe", meta: { rows: 2, resultDigest: "d0" } });
window.__page = handle.page();
window.__sandbox = FIGURE_SANDBOX;

/* Two controls, so that "nothing happened" is attributable.
   A: the same markup with scripts allowed and no policy -- the probe fires,
      which is what makes the real frame's silence mean something.
   B: the same page the pane builds, policy and all, with allow-scripts added
      -- the policy alone stops it, so the two barriers are independent. */
const bare = document.createElement("iframe");
bare.id = "control-bare";
bare.setAttribute("sandbox", "allow-scripts");
bare.srcdoc = "<!doctype html><meta charset=utf-8><body>" + PROBE;
document.getElementById("control-host").appendChild(bare);

const policed = document.createElement("iframe");
policed.id = "control-policed";
policed.setAttribute("sandbox", "allow-scripts");
policed.srcdoc = handle.page();
document.getElementById("control-host").appendChild(policed);

/* ── the gate, with the provider and the store stubbed ─────────────────── */
const st = paneState("playwright", "test", location.origin);
st.llmKey = "test-key";
st.token = "test-token";

const counts = { llm: 0, sparql: 0, put: 0, del: 0, view: 0, record: 0 };
window.__counts = () => counts;
window.__requests = [];
window.__llmBodies = [];
window.__records = [];
window.__truncate = false;

const json = (o) => new Response(JSON.stringify(o),
  { status: 200, headers: { "Content-Type": "application/json" } });

window.fetch = async (url, init = {}) => {
  const u = String(url);
  const m = (init.method || "GET").toUpperCase();
  window.__requests.push({ url: u, method: m,
                           accept: (init.headers || {}).Accept || null });
  if (u.includes("/mcp/sparql")) {
    counts.record += 1;
    window.__records.push(String(init.body || ""));
    return new Response("ok", { status: 200 });
  }
  if (u.includes("/views/")) {
    if (m === "PUT") counts.put += 1;
    if (m === "DELETE") counts.del += 1;
    return new Response(null, { status: 204 });
  }
  if (u.includes("/sparql")) {
    counts.sparql += 1;
    return new Response(TSV, { status: 200,
      headers: { "Content-Type": "text/tab-separated-values" } });
  }
  if (/\\/playwright\\/test\\/tmp-/.test(u)) {
    counts.view += 1;
    return new Response(TSV, { status: 200,
      headers: { "Content-Type": "text/tab-separated-values" } });
  }
  if (u.includes("/v1/models")) return json({ data: [] });
  if (u.includes("/v1/messages")) {
    counts.llm += 1;
    window.__llmBodies.push(JSON.parse(init.body));
    const text = window.__truncate
      ? "Here it is.\\n\\n\\u0060\\u0060\\u0060svg\\n<svg viewBox=\\"0 0 200 100\\"><rect x=\\"0\\""
      : "Here it is.\\n\\n\\u0060\\u0060\\u0060svg\\n" + DRAWN
        + "\\n\\u0060\\u0060\\u0060\\n\\nCaption: North leads South by half again.";
    return json({ id: "m", type: "message", role: "assistant",
      stop_reason: window.__truncate ? "max_tokens" : "end_turn",
      content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 5 } });
  }
  return new Response("not stubbed: " + u, { status: 404 });
};

window.__openGate = (opts = {}) => openFigureGate(document.getElementById("gate-host"), {
  host: location.origin, account: "playwright", repository: "test", state: st,
  prompt: "sales by region", text: PROPOSAL_TEXT, session: "S-1",
  onStatus: (s) => { window.__status = s; },
  onDone: (d) => { window.__done = d; },
  ...opts,
});
window.__gate = window.__openGate();

const app = { state: { getAuthContext: () => ({ host: location.origin, token: "test-token" }) } };
window.__pane = openExplorationPane(app, {
  container: document.querySelector(".view-editors-container"),
  accountName: "playwright", repositoryName: "test",
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

const figureEl = page.locator("#frame-host iframe");
await figureEl.waitFor({ timeout: 5000 });
// Give both frames every chance to misbehave before asserting that one did not.
await page.waitForTimeout(400);

console.log("\nD-M: the figure frame runs nothing");
{
  const sandbox = await figureEl.getAttribute("sandbox");
  ok(sandbox === "", "the sandbox attribute is present and empty: every restriction");
  ok(!/allow-scripts/.test(sandbox || ""),
     "allow-scripts is not among them -- a picture does not have to run");
  ok(await page.evaluate(() => document.querySelector("#frame-host iframe").contentDocument === null),
     "the document is opaque to its embedder, so nothing can reach into it either");

  // A sandboxed frame cannot touch the parent's globals whatever its flags,
  // so the probe reports by postMessage -- the one channel it does have, and
  // therefore the one that distinguishes "did not run" from "could not say".
  const said = async (what) => page.evaluate((w) => window.__messages.includes(w), what);
  ok(!(await said("figure:script-ran")), "a <script> inside the model's SVG did not run");
  ok(!(await said("figure:onload-ran")), "nor did the onload= handler on its root element");
  ok(await page.evaluate(() => !window.__messages.some((m) => m.startsWith("figure:"))),
     "the frame said nothing at all: there was no script in it to say anything");

  ok(await said("bare:script-ran") && await said("bare:onload-ran"),
     "the control -- the same markup, scripts allowed, no policy -- fires both halves of "
   + "the probe, so the silence above is the sandbox and not a flaw in the probe");
  ok(await page.evaluate(() => !window.__messages.some((m) => m.startsWith("policed:"))),
     "and the second control, which HAS allow-scripts but keeps the page's own policy, is "
   + "silent too: the sandbox flag and the CSP each stop this on their own");
}

console.log("\nD-N: the artifact says who drew it");
{
  const saved = await page.evaluate(() => window.__page);
  ok(saved.includes("Drawn by a language model"),
     "the saved file carries the statement, not only the transcript");
  ok(saved.includes("d0"), "with the digest of the result it was drawn from");
  ok(saved.includes("Content-Security-Policy") && saved.includes("script-src &#39;none&#39;"),
     "and its own policy, so a copy opened elsewhere is governed too");
  ok(saved.includes("<rect id=\"bar\""),
     "the figure is saved exactly as written -- nothing was sanitised out of it");
}

console.log("\nGate 1: the last point before anything runs");
{
  const gate = page.locator('[data-testid="figure-gate"]');
  await gate.waitFor({ timeout: 5000 });
  ok(await page.evaluate(() => window.__counts().sparql) === 0,
     "nothing has been run against the store");
  ok((await gate.textContent()).includes("SELECT ?region"), "the query is shown");
  ok((await gate.textContent()).includes("a bar per region"),
     "and what the model says it will draw, which is what makes the query reviewable");
  ok(await page.locator('[data-testid="figure-accept"]').inputValue()
       === "text/tab-separated-values",
     "the notation the model chose is preselected (D-L)");
  const options = await page.locator('[data-testid="figure-accept"] option').count();
  ok(options >= 2, "and the others a SELECT can produce are offered beside it");
  ok(await page.locator('[data-testid="figure-limit"]').count() === 1,
     "with the row cap, which is the lever for a result too large to send (§6)");
  ok(!(await page.locator('[data-testid="figure-catalog"]').isChecked()),
     "the temporary view is off by default: one write for one query is the worst of the trade");
}

console.log("\nPhase 2 is the interface's own run");
{
  await page.locator('[data-testid="figure-accept"]').selectOption("text/csv");
  await page.locator('[data-testid="figure-catalog"]').check();
  await page.locator('[data-testid="figure-run"]').click();
  await page.locator('[data-testid="figure-holder"] iframe').waitFor({ timeout: 8000 });

  ok(await page.evaluate(() => window.__counts().put) === 1,
     "the temporary view was written, once");
  ok(await page.evaluate(() => window.__requests.some(
       (r) => /\/views\/tmp-/.test(r.url) && r.method === "PUT")),
     "under a name that says which run it belongs to");
  ok(await page.evaluate(() => window.__requests.some(
       (r) => /\/playwright\/test\/tmp-/.test(r.url) && r.accept === "text/csv")),
     "and it was executed BY NAME, in the notation chosen at the gate, not the one proposed");
  ok(await page.evaluate(() => window.__counts().llm) === 1,
     "then the model was asked once, to draw");
  ok(await page.evaluate(() => window.__counts().sparql) === 0,
     "and the direct route was not used, because the catalogue route was chosen");
}

console.log("\nPhase 3 has no store and no tools");
{
  const body = await page.evaluate(() => window.__llmBodies[0]);
  ok(!body.tools || body.tools.length === 0,
     "the drawing turn is given no tools: there is nothing for it to fetch");
  ok(/scripts disabled/i.test(body.system),
     "it is told the frame's rules, which it could not otherwise discover");
  ok(JSON.stringify(body.messages).includes("North"),
     "and the real result -- the one the interface fetched, not one the model reported");
  ok(JSON.stringify(body.messages).includes("sales by region"),
     "with the question that started the run");
  ok(body.max_tokens > 4096, "and room to finish the figure");
}

console.log("\nGate 2: the figure, in the frame the policy describes");
{
  const holder = page.locator('[data-testid="figure-holder"] iframe');
  ok(await holder.getAttribute("sandbox") === "",
     "the drawn figure is mounted under the same empty sandbox");
  for (const b of ["figure-keep", "figure-download", "figure-draw-again-2", "figure-discard"]) {
    ok(await page.locator(`[data-testid="${b}"]`).count() === 1,
       `Gate 2 offers ${b.slice(7)}`);
  }
  ok((await holder.getAttribute("srcdoc")).includes("North leads South"),
     "the model's caption travels inside the figure's own document, not around it");
}

console.log("\nthe disposition is recorded, discard included (U-16, U-17)");
{
  await page.locator('[data-testid="figure-discard"]').click();
  await page.waitForFunction(() => window.__done, null, { timeout: 8000 });
  const update = await page.evaluate(() => window.__records[0] || "");
  ok(/ a mcp:Figure /.test(update), "a figure node was written, typed with rdf:type");
  ok(/mcp:disposition "discarded"/.test(update),
     "saying it was discarded -- which is the line that explains a pane that keeps getting it wrong");
  ok(/mcp:resultDigest/.test(update) && /mcp:query/.test(update),
     "beside the query and the digest of what was drawn from");
  ok(update.includes("<svg viewBox="), "and the figure itself, so the record holds the picture");
  ok(await page.evaluate(() => window.__counts().del) === 1,
     "and the temporary view was swept, because it was not kept");
  ok(await page.locator('[data-testid="figure-gate"]').count() === 0, "the gate closed");
}

console.log("\na figure cut off at the token limit is refused, not shown");
{
  await page.evaluate(() => { window.__truncate = true; window.__gate = window.__openGate(); });
  await page.locator('[data-testid="figure-run"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="figure-run"]').click();
  await page.locator('[data-testid="figure-truncated"]').waitFor({ timeout: 8000 });
  ok(await page.locator('[data-testid="figure-holder"]').count() === 0,
     "it is not mounted: a truncated SVG still draws, and does not look truncated");
  ok((await page.locator('[data-testid="figure-truncated"]').textContent()).includes("token limit"),
     "and the pane says why, rather than failing silently");
  ok(await page.locator('[data-testid="figure-draw-again"]').count() === 1,
     "with the way out: ask for a simpler one");
}

console.log("\nthe exploration pane offers the path at all");
{
  const pane = page.locator('[data-testid="exploration-pane"]');
  await pane.waitFor({ timeout: 5000 });
  ok(await page.locator('[data-testid="exploration-figure-mode"]').count() === 1,
     "Figure is a mode of the exploration, not a second pane");
  ok(!(await page.locator('[data-testid="exploration-figure-mode"]').isChecked()),
     "off by default: most runs still want a query");
  const added = await page.evaluate(() => {
    window.__pane.add({ kind: "llm", title: "turn 1", status: "ok",
                        response: "here", sparql: "SELECT ?s WHERE { ?s ?p ?o }" });
    return document.querySelectorAll('[data-testid^="exploration-draw-"]').length;
  });
  ok(added === 1, "and a turn carrying a query gets Draw it… beside Add as a view");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
