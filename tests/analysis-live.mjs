/**
 * The worked example (§35), run again — this time with a real model and
 * against the patched service.
 *
 * What differs from `analysis-demonstration.mjs', which this file is otherwise
 * a copy of: there, the provider's wire shape was answered by a fixed script,
 * because no key was available and because the two service defects the run
 * found made the interesting half of the question unanswerable. Here the
 * model is Anthropic's, called for real, and it chooses its own operations.
 * Nothing in the page knows the difference: the provider adapter, the loop,
 * the grant, the budget and the brief are the shipped ones.
 *
 * What is real, stated before anything else:
 *
 *   REAL — the two repositories. `james/finto' and `james/fibo' on dydra.com,
 *     read live through their own MCP resources, now serving the patched
 *     score layer.
 *   REAL — the whole client path, as before.
 *   REAL — the model. It is asked the question and decides every call.
 *
 * Neither credential reaches the browser. The dydra token is read from
 * ~/.dydra at run time and added by the proxy; the provider key is read from
 * the environment or from ~/.anthropic and added by the `/model' relay. The
 * page holds a placeholder for each. Neither is written to this tree, and
 * neither appears in the log this run prints.
 *
 * Run: node tests/analysis-live.mjs
 * Writes: doc/analysis-live/*.png
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "doc", "analysis-live");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css" };

const HOST = "https://dydra.com";
const MODEL_API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANALYSIS_MODEL || "claude-opus-5-5";

/**
 * A credential has no working default: the environment first, then a file
 * outside this tree, and otherwise an error. Nothing here falls back to a
 * value that would let a test pass while reading nobody's data.
 */
function credential(envName, ...file) {
  if (process.env[envName]) return process.env[envName].trim();
  const path = join(homedir(), ...file);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  throw new Error(`no credential: set ${envName} or write ${path}`);
}

const TOKEN = credential("DYDRA_TOKEN", ".dydra", "dydra.com.token");
const API_KEY = credential("ANTHROPIC_API_KEY", ".anthropic", "dydra.com.key");
let WORKSPACE = "";
try { WORKSPACE = credential("ANTHROPIC_WORKSPACE_ID", ".anthropic", "dydra.com.workspace"); }
catch { /* a workspace-scoped key needs no header */ }

/* ── the harness page ─────────────────────────────────────────────────────── */

const HARNESS = `<!doctype html><meta charset="utf-8"><title>analysis, live</title>
<link rel="stylesheet" href="/stylesheets/style.css" media="all">
<link rel="stylesheet" href="/stylesheets/jsui-overrides.css" media="all">
<body>
<div id="app"></div>
<script type="module">
import { LayoutView } from "/ui/components/layout.js";
import { mountLocationBar } from "/ui/components/location-bar.js";
import { App } from "/ui/app.js";
import { target as makeTarget } from "/lib/app/instructions.js";
import { defaultWorkspace, arrangementOf } from "/lib/app/workspace.js";
import { connectionFor } from "/lib/app/connection.js";

const PROXY = location.origin + "/proxy";
const state = {
  session: { isLoggedIn: () => true, accountName: "james" },
  getAuthContext: () => ({ host: PROXY, token: "" }),   // the proxy holds the credential
};
const app = new App({ state });
window.__app = app;

const connection = connectionFor("james");
connection.llmProvider = "anthropic";
connection.llmEndpoint = location.origin + "/model";   // the relay holds the key
connection.llmKey = "held-by-the-relay";
connection.llmModel = ${JSON.stringify(MODEL)};

const layout = new LayoutView();
const ws = arrangementOf(defaultWorkspace({ page: "main" }), { page: "main" });
document.getElementById("app").innerHTML = layout.render({
  navLinks: { global: [], loggedIn: [], loggedOut: [] }, session: state.session,
  content: "<div id='page-content'><h2>james</h2>"
         + "<p>Two repositories of this account are named in the question below.</p></div>",
  sidebar: "", paneTabsBar: "", paneTabsDefault: "", workspace: ws,
});

const TARGETS = new Map();
TARGETS.set("workspace", makeTarget({
  id: "workspace", label: "workspace", kind: "workspace",
  instruct: (text) => app.instructWorkspace(text),
}));

window.bar = mountLocationBar(document.querySelector("#location-bar"), {
  navigate: () => {},
  targets: () => [...TARGETS.values()],
  instruct: ({ target, text }) => target.instruct(text),
  path: () => "/account/james",
  onAddress: () => {},
});
app.locationBar = window.bar;
window.bar.setAddress("workspace");
window.__ready = true;
<\/script>
</body>`;

/* ── the server: files, a proxy to the service, a relay to the model ──────── */

const turns = [];             // one entry per completed model turn
const relayed = [];           // what went to the service
let modelError = null;

process.on("unhandledRejection", (e) => console.log("  unhandled: " + e));

/** Never print a credential, however a caller happens to have mangled it. */
const redact = (s) => String(s)
  .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…")
  .replace(new RegExp(TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "…");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);

  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" }); res.end(HARNESS); return;
  }

  if (path === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ turns: turns.length, relayed: relayed.length,
                             last: turns[turns.length - 1] || null, error: modelError }));
    return;
  }

  if (path === "/model") {
    let body = ""; for await (const c of req) body += c;
    let out = null, text = "", why = null;
    for (let attempt = 0; attempt < 2 && !out; attempt += 1) {
      try {
        out = await fetch(MODEL_API, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": API_KEY,
            ...(WORKSPACE ? { "anthropic-workspace-id": WORKSPACE } : {}),
          },
          body,
        });
        text = await out.text();
      } catch (e) { why = e; out = null; }
    }
    if (!out) {
      modelError = redact(String(why));
      console.log("  model FAILED: " + modelError);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: modelError } }));
      return;
    }
    // What this turn was, for the log and for the screenshot name
    let summary = { status: out.status, calls: [], said: "", usage: null, stop: null };
    try {
      const j = JSON.parse(text);
      if (j.error) { modelError = redact(j.error.message || JSON.stringify(j.error)); }
      const content = Array.isArray(j.content) ? j.content : [];
      summary.calls = content.filter((b) => b.type === "tool_use")
                             .map((b) => `${b.name} ${JSON.stringify(b.input).slice(0, 120)}`);
      summary.said = content.filter((b) => b.type === "text")
                            .map((b) => b.text).join(" ").slice(0, 160);
      summary.usage = j.usage || null;
      summary.stop = j.stop_reason || null;
      summary.model = j.model || null;
    } catch { /* a non-JSON body is reported by status alone */ }
    turns.push(summary);
    console.log(`  turn ${turns.length}: ${out.status} ${summary.stop || ""} `
              + `${summary.calls.length ? summary.calls.join(" | ") : "(prose)"}`);
    if (summary.said) console.log(`     said: ${summary.said.replace(/\s+/g, " ")}`);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(text);
    return;
  }

  if (path.startsWith("/proxy/")) {
    const target = HOST + path.slice("/proxy".length) + (url.search || "");
    let body = ""; for await (const c of req) body += c;
    const headers = { Authorization: "Bearer " + TOKEN };
    for (const h of ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name"]) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    let out = null, text = "", why = null;
    for (let attempt = 0; attempt < 2 && !out; attempt += 1) {
      try {
        out = await fetch(target, { method: req.method, headers,
                                    body: req.method === "GET" ? undefined : body });
        text = await out.text();
      } catch (e) { why = e; out = null; }
    }
    if (!out) {
      console.log(`  proxy FAILED ${req.method} ${target}: ${redact(why)}`);
      relayed.push({ target, status: 0, bytes: 0 });
      res.writeHead(502, { "Content-Type": "application/json",
                           "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: redact(String(why)) }));
      return;
    }
    relayed.push({ target, status: out.status, bytes: text.length });
    res.writeHead(out.status, { "Content-Type": out.headers.get("content-type") || "application/json",
                                "Access-Control-Allow-Origin": "*" });
    res.end(text);
    return;
  }

  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found: " + path); }
});

await mkdir(SHOTS, { recursive: true });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const notes = [];
let n = 0;
const shot = async (name, note) => {
  n += 1;
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(SHOTS, file), fullPage: false });
  notes.push({ file, note });
  console.log(`  shot ${String(n).padStart(2, "0")} ${name} — ${note}`);
};

page.on("pageerror", (e) => console.log("  PAGE ERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("  console: " + redact(m.text())); });

await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.waitForFunction(() => window.__ready, { timeout: 10000 });
await page.waitForTimeout(300);
await shot("the-interface", "the chrome, with the location bar as the only prompt on the screen");

const QUESTION = process.env.ANALYSIS_QUESTION
  || "compare the concepts present in james/finto and james/fibo";
await page.click("#location-display");
await page.fill("#location-input", QUESTION);
await shot("the-question-typed",
           "a line that names two repositories — read as a question about data, not an instruction about the interface");

await page.press("#location-input", "Enter");
await page.waitForSelector('[data-testid="location-confirm"]', { timeout: 20000 });
await shot("disclosed-before-it-runs", "nothing has run: the stores are named and one press is offered");
await page.click('[data-testid="location-more"]');
await page.waitForTimeout(150);
await shot("what-the-press-authorises",
           "the disclosure: which repositories, how many rounds, how many calls, read-only, and where the answer will be kept");
await page.click('[data-testid="location-more"]');

const runState = async () => (await (await fetch(`http://127.0.0.1:${port}/state`)).json());
const CEILING = Number(process.env.ANALYSIS_CEILING || 20 * 60 * 1000);
const started = Date.now();

await page.click('[data-testid="location-confirm"]');
await shot("the-run-begins",
           "each store's own tools and the server's operation catalogue are read before the model is asked anything");

/* The model drives itself from here. One screenshot per completed turn,
 * named by what that turn asked for, until the reply line appears. */
let seen = 0;
let answered = false;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 46) || "turn";
for (;;) {
  if (Date.now() - started > CEILING) { console.log("  ceiling reached"); break; }
  if (await page.$('[data-testid="location-more"]')) { answered = true; break; }
  const st = await runState();
  if (st.turns > seen) {
    seen = st.turns;
    const t = st.last || {};
    const what = t.calls && t.calls.length
      ? t.calls.map((c) => c.split(" ")[0]).join("+")
      : "prose";
    await page.waitForTimeout(400);
    await shot(`turn-${String(seen).padStart(2, "0")}-${slug(what)}`,
               t.calls && t.calls.length
                 ? `the model asks for: ${t.calls.join(" | ")}`
                 : `the model writes rather than calls: ${t.said || "(no text)"}`);
    continue;
  }
  await page.waitForTimeout(500);
}

if (answered) {
  await page.waitForTimeout(500);
  await shot("answered", "the reply line: the first sentence of the answer, with the rest folded");
  await page.click('[data-testid="location-more"]');
  await page.waitForTimeout(300);
  await shot("the-report", "the answer, folded under the bar rather than truncated into it");
  // The report is long; capture it in screenfuls rather than one unreadable image.
  const box = '[data-testid="location-detail"]';
  const metrics = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? { h: el.clientHeight, s: el.scrollHeight } : null;
  }, box);
  if (metrics && metrics.s > metrics.h) {
    const pages = Math.min(6, Math.ceil(metrics.s / metrics.h));
    for (let i = 1; i < pages; i += 1) {
      await page.evaluate(([sel, k]) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop = el.clientHeight * k;
      }, [box, i]);
      await page.waitForTimeout(200);
      await shot(`the-report-${i + 1}`, `the report, screenful ${i + 1} of ${pages}`);
    }
  }
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = el.scrollHeight;
  }, box);
  await page.waitForTimeout(200);
  await shot("provenance", "the end of the report and the provenance the interface adds: model as served, calls, date, where it was recorded");
}

/* ── what the run actually did ────────────────────────────────────────────── */

// The report itself, not only the turns that produced it. A run whose answer
// survives solely as pixels cannot be quoted, diffed against the next run, or
// checked against the calls it claims to rest on.
let answerText = "";
try {
  answerText = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="location-detail"]');
    return el ? el.innerText : "";
  });
} catch { /* the pane may already be gone; the screenshots remain */ }
if (answerText) await writeFile(join(SHOTS, "report.md"), answerText);

const report = {
  question: QUESTION, model: MODEL, answered,
  servedModel: turns.map((t) => t.model).filter(Boolean).pop() || null,
  turns: turns.map((t, i) => ({ turn: i + 1, status: t.status, stop: t.stop,
                                calls: t.calls, said: t.said, usage: t.usage })),
  service: relayed,
  error: modelError,
};
await writeFile(join(SHOTS, "run.json"), JSON.stringify(report, null, 2));
await writeFile(join(SHOTS, "shots.json"), JSON.stringify(notes, null, 2));

console.log(`\nmodel turns: ${turns.length}   served as: ${report.servedModel}`);
const totalIn = turns.reduce((a, t) => a + (t.usage?.input_tokens || 0), 0);
const totalOut = turns.reduce((a, t) => a + (t.usage?.output_tokens || 0), 0);
console.log(`tokens: ${totalIn} in, ${totalOut} out`);
console.log(`service calls relayed: ${relayed.length}`);
for (const r of relayed) console.log(`  ${r.status} ${r.bytes.toString().padStart(7)}  ${r.target}`);
if (modelError) console.log(`\nmodel error: ${modelError}`);

await browser.close();
server.close();
console.log(`\nwrote ${n} screenshots to doc/analysis-live/`);
process.exit(answered ? 0 : 1);
