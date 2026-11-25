/**
 * The exploration pane, in a real browser.
 *
 * The pane is DOM work, so asserting it anywhere but in a browser would be
 * asserting a model of a browser.  A tiny static server hands Chromium the
 * module tree; `fetch' is replaced in the page before the pane is mounted, so
 * the MCP endpoint and the provider are both answered from fixtures and no
 * credential and no network are involved.
 *
 * What is checked is what a person would check by looking: that it connects by
 * itself, that the credentials are in the collapsible at the top, that Run
 * produces one entry per exchange with the indicator and the text in the same
 * element, that a fenced query is offered as a view, and that a failure opens
 * itself.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>harness</title>
<body>
<div class="account-pane" data-account="playwright">
  <div class="account-pane-layout">
    <div class="account-pane-content"></div>
    <div class="account-sidebar">
      <div class="manage-tabs">
        <button type="button" class="manage-tab active" data-tab="profile">P</button>
        <button type="button" class="manage-tab exploration-tab" data-account="playwright"
                data-testid="account-tab-exploration"><img src="/images/explore.svg" alt="Exploration" width="16" height="16" /></button>
      </div>
      <div class="manage-tab-content">
        <div class="tab-panel active" data-panel="profile">profile</div>
      </div>
    </div>
  </div>
</div>
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="query-catalog">
    <h2 style="display: flex; align-items: center;">Views
      <span style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
        <button class="view-new-btn">New</button>
      </span>
    </h2>
  </div>
  <div class="view-editors">
    <div class="view-editors-head" style="display: flex; justify-content: space-between; align-items: center;">
      <h2 style="margin: 0;">Editors</h2>
      <div class="repository-operation-buttons" style="display: flex; gap: 8px;">
        <button type="button" class="view-explore-btn" data-account="playwright" data-repository="test"
                style="background: blue; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Explore</button>
        <button type="button" class="repo-import-btn"
                style="background: #6f42c1; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Import</button>
        <button type="button" class="repo-export-btn"
                style="background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Export</button>
        <button type="button" class="repo-clear-btn"
                style="background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Clear</button>
      </div>
    </div>
    <div class="view-editors-container"></div>
  </div>
</div>
<script type="module">
import { openExplorationPane, installExplorationLauncher } from "/ui/components/exploration-pane.js";
import { installAccountExplorationLauncher } from "/ui/components/account-exploration-pane.js";
import { connectionFor } from "/lib/app/connection.js";
import { connections } from "/lib/mcp/registry.js";

/* The key is the ACCOUNT'S now, so the test sets it where it lives rather than
   by typing into a pane -- which is the whole of the change being asserted. */
window.__setKey = (k) => { connectionFor("playwright").llmKey = k; };
window.__connection = () => ({ ...connectionFor("playwright") });
window.__registry = () => connections().map((c) =>
  ({ id: c.id, connected: c.connected, session: c.session, endpoint: c.mcpEndpoint }));

/* ── fixtures ────────────────────────────────────────────────────────────── */
const rpc = (result) => ({ jsonrpc: "2.0", id: 1, result });
const payload = (text) => rpc({ content: [{ type: "resource", resource: { text } }] });

/* The exploration record, as SPARQL results.  Lisp universal time, because that
   is what the server writes. */
const bind = (rows) => ({ head: {}, results: { bindings: rows.map((r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { type: "literal", value: String(v) }]))) } });
const G = "http://dydra.com/explorations/AAAA-1111";
const M = "http://dydra.com/ns/mcp#";
const TX = G + "/transcript";
const TRANSCRIPT_ROWS = bind([
  { s: TX, p: M + "exploration", o: G },
  { s: TX, p: M + "model", o: "claude-opus-5" },
  { s: TX + "#r-1", p: M + "prompt", o: "samples with a temperature above 20" },
  { s: TX + "#r-1", p: M + "iterations", o: 2 },
  { s: TX + "#r-1", p: M + "ended", o: "2026-10-13T09:00:06.000Z" },
  { s: TX + "#r-1-x1", p: M + "run", o: TX + "#r-1" },
  { s: TX + "#r-1-x1", p: M + "ordinal", o: 1 },
  { s: TX + "#r-1-x1", p: M + "kind", o: "primer" },
  { s: TX + "#r-1-x1", p: M + "document", o: "score://grammar" },
  { s: TX + "#r-1-x1", p: M + "content", o: "operations: catalog, profile, select" },
  { s: TX + "#r-1-x2", p: M + "run", o: TX + "#r-1" },
  { s: TX + "#r-1-x2", p: M + "ordinal", o: 2 },
  { s: TX + "#r-1-x2", p: M + "kind", o: "tool_result" },
  { s: TX + "#r-1-x2", p: M + "tool", o: "survey" },
  { s: TX + "#r-1-x2", p: M + "op", o: "catalog" },
  { s: TX + "#r-1-x2", p: M + "rows", o: 8 },
  { s: TX + "#r-1-x2", p: M + "content", o: "catalog scope: types\\nresultCount: 8\\n  foaf:Person 4" },
]);

/* The endpoint's own record of the calls it served.  Written by the server for
   every client, which is what makes it the half an autonomous model also leaves
   behind; here it stands for one day against one repository. */
const J = "http://dydra.com/mcp/journal/playwright/test/2026-10-15";
const JOURNAL_ROWS = bind([
  { s: J, p: M + "type", o: M + "Journal" },
  { s: J, p: M + "repository", o: "playwright/test" },
  { s: J, p: M + "date", o: "2026-10-15" },
  { s: J + "#c1", p: M + "type", o: M + "Request" },
  { s: J + "#c1", p: M + "agent", o: "playwright" },
  { s: J + "#c1", p: M + "repository", o: "playwright/test" },
  { s: J + "#c1", p: M + "method", o: "tools/call" },
  { s: J + "#c1", p: M + "tool", o: "survey" },
  { s: J + "#c1", p: M + "client", o: "claude-cli/1.2" },
  { s: J + "#c1", p: M + "startedAt", o: 4000594310 },
  { s: J + "#c1", p: M + "duration", o: 184 },
  { s: J + "#c1", p: M + "status", o: M + "complete" },
  { s: J + "#c1", p: M + "request", o: '{"method":"tools/call","params":{"name":"survey"}}' },
  { s: J + "#c1", p: M + "response", o: '{"result":{"content":[]}}' },
  { s: J + "#c1", p: M + "responseSize", o: 24 },
  { s: J + "#c1", p: M + "exploration", o: G },
  { s: J + "#c2", p: M + "type", o: M + "Request" },
  { s: J + "#c2", p: M + "agent", o: "robot" },
  { s: J + "#c2", p: M + "method", o: "tools/call" },
  { s: J + "#c2", p: M + "tool", o: "sparql" },
  { s: J + "#c2", p: M + "startedAt", o: 4000594395 },
  { s: J + "#c2", p: M + "status", o: M + "error" },
  { s: J + "#c2", p: M + "errorCode", o: -32602 },
  { s: J + "#c2", p: M + "request", o: '{"method":"tools/call","params":{"name":"sparql"}}' },
  { s: J + "#c2", p: M + "response", o: '{"error":{"code":-32602}}' },
]);

/* The list of journals answers in its own shape, as the service does, and the
   per-exploration query answers only the call that named one -- the server
   filters it in SPARQL, so a stub that returned both would be testing the
   presentation against data the endpoint cannot produce. */
const JOURNAL_LIST = bind([{ journal: J, repository: "playwright/test", date: "2026-10-15" }]);
const EXPLORATION_CALLS = bind(
  JOURNAL_ROWS.results.bindings
    .map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])))
    .filter((r) => r.s === J + "#c1"));

const SESSION_ROWS = (query) => query.includes("/transcript>")
  ? TRANSCRIPT_ROWS
  : query.includes("a mcp:Journal")
  ? JOURNAL_LIST
  : query.includes("mcp:exploration <")
  ? EXPLORATION_CALLS
  : query.includes(J)
  ? JOURNAL_ROWS
  : query.includes("mcp:Exploration")
  ? bind([{ session: G, repository: "playwright/test", created: 4000594300,
            lastActive: 4000594400, version: 3, active: G + "#n2" }])
  : bind([
      { s: G, p: M + "repository", o: "playwright/test" },
      { s: G, p: M + "created", o: 4000594300 },
      { s: G, p: M + "lastActive", o: 4000594400 },
      { s: G, p: M + "version", o: 3 },
      { s: G, p: M + "activeNode", o: G + "#n2" },
      { s: G + "#n1", p: M + "operation", o: "http://dydra.com/ns/mcp/operation#catalog" },
      { s: G + "#n1", p: M + "status", o: "complete" },
      { s: G + "#n1", p: M + "startedAt", o: 4000594310 },
      { s: G + "#n1", p: M + "resultCount", o: 8 },
      { s: G + "#n1", p: M + "parameters", o: '{"scope":"types"}' },
      { s: G + "#n2", p: M + "operation", o: "http://dydra.com/ns/mcp/operation#select" },
      { s: G + "#n2", p: M + "status", o: "complete" },
      { s: G + "#n2", p: M + "startedAt", o: 4000594390 },
      { s: G + "#n2", p: M + "resultCount", o: 1 },
      { s: G + "#n2", p: M + "parent", o: G + "#n1" },
      { s: G + "#n2", p: M + "parameters", o: "scope: predicates" },
    ]);

let mcpCalls = 0, llmCalls = 0;
const modelListCalls = [];
window.__calls = () => ({ mcpCalls, llmCalls, modelListCalls });

window.__updates = [];
window.fetch = async (url, init = {}) => {
  // a SPARQL body is a query, not JSON -- parse defensively or the session log
  // request dies here instead of reaching its own branch
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj),
    { status, headers: { "Content-Type": "application/json" } });

  // The session log reads <account>/mcp over SPARQL, so it arrives here too --
  // with a query for a body rather than JSON-RPC.  The transcript is written
  // back to the same endpoint, which the content type tells apart from a read.
  if (String(url).includes("/sparql")) {
    const ct = (init.headers || {})["Content-Type"] || "";
    if (ct.includes("sparql-update")) {
      window.__updates.push(String(init.body || ""));
      return new Response("", { status: 200 });
    }
    return reply(SESSION_ROWS(String(init.body || "")));
  }

  // What the account may name (REQ-33.2.7).  Answered before the /mcp branch,
  // because /system/accounts/x/repositories contains neither and would
  // otherwise fall through to the provider and be counted as a model call.
  if (String(url).includes("/system/accounts/")) {
    if (String(url).includes("/collaboration")) return reply([]);
    return reply({ repositories: [
      { name: "test" }, { name: "other" }, { name: "ui" }, { name: "mcp" },
    ] });
  }

  if (String(url).includes("/mcp")) {
    mcpCalls += 1;
    if (body.method === "server/discover") return reply(rpc({ serverInfo: { name: "dydra" } }));
    if (body.method === "tools/list") {
      return reply(rpc({ tools: [
        { name: "survey", description: "explore", inputSchema: { type: "object" } },
        { name: "query",  description: "read",    inputSchema: { type: "object" } },
        { name: "update", description: "write",   inputSchema: { type: "object" } },
      ] }));
    }
    // resources/read answers with "contents", not "content" -- the shape the
    // MCP specification gives it, and the one readResource reads
    // (no backticks in here: the harness is itself a template literal)
    if (body.method === "resources/read") {
      return reply(rpc({ contents: [{ uri: body.params?.uri, mimeType: "text/plain",
                                      text: "operations: catalog, profile, select, materialize" }] }));
    }
    const op = body.params?.arguments?.op;
    if (op === "connect") return reply(payload('session: "AAAA-1111"'));
    if (op === "catalog") {
      // every survey answer restates the handle, which is how the adapter picks
      // one up without a dedicated call
      return reply(payload('session: "AAAA-1111"\\ncatalog scope: types\\nresultCount: 8\\n  foaf:Person 4'));
    }
    return reply(payload("ok"));
  }

  // Model lists.  Each location answers in its provider's own shape: the
  // Messages list with display names, the Chat Completions list with every kind
  // of model, of which only the chat models belong in the menu.
  if (String(url).includes("/v1/models")) {
    modelListCalls.push({ url: String(url), headers: init.headers || {} });
    if (String(url).includes("anthropic")) {
      return reply({ data: [
        { id: "claude-opus-5", display_name: "Claude Opus 5" },
        { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
      ], has_more: false });
    }
    return reply({ object: "list", data: [
      { id: "text-embedding-3-large", created: 30 },
      { id: "gpt-5", created: 20 },
      { id: "gpt-5-mini", created: 25 },
      { id: "whisper-1", created: 10 },
    ] });
  }

  llmCalls += 1;
  /* Kept so a follow-up can be asserted on what it actually SENT: whether the
     earlier turns travelled with it is not visible anywhere else. */
  window.__llmBodies = [...(window.__llmBodies || []),
                        (init && init.body) ? JSON.parse(init.body) : {}];
  /* The first turn of EVERY run calls a tool, not just the page's first run:
     a run that calls nothing is now a reported condition, and a stub that
     answered the account pane's run straight out of its head would be
     exercising that condition rather than the one this section is about. */
  const askedBody = init && init.body ? JSON.parse(init.body) : {};
  if ((askedBody.tools || []).length && (askedBody.messages || []).length === 1) {
    return reply({
      id: "m1", stop_reason: "tool_use", usage: { input_tokens: 5300, output_tokens: 412 },
      content: [
        { type: "text", text: "Let me look at the types first." },
        { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog", scope: "types" } },
      ],
    });
  }
  /* A model told to say which store its query is for says it, and the account's
     pane reads the name back out of the prose.  A stub that never wrote one
     would leave that half of the draw untested. */
  if (/Say which store/.test(String(askedBody.system || ""))) {
    return reply({
      id: "m3", stop_reason: "end_turn", usage: { input_tokens: 6100, output_tokens: 210 },
      content: [{ type: "text", text:
        "I will draw this from playwright/other.\\n\\n\`\`\`sparql\\nSELECT ?s (COUNT(*) AS ?n)\\nWHERE { ?s ?p ?o }\\nGROUP BY ?s\\n\`\`\`\\n\\nA bar per subject." }],
    });
  }
  return reply({
    id: "m2", stop_reason: "end_turn", usage: { input_tokens: 6100, output_tokens: 180 },
    content: [{ type: "text", text:
      "Eight types. Here is the query:\\n\\n\`\`\`sparql\\nSELECT ?s (COUNT(*) AS ?n)\\nWHERE { ?s ?p ?o }\\nGROUP BY ?s\\n\`\`\`\\n\\nIt counts triples per subject." }],
  });
};

window.__mockFetch = window.fetch;

/* ── mount ───────────────────────────────────────────────────────────────── */
const app = {
  state: { getAuthContext: () => ({ host: location.origin, token: "TOKEN" }) },
  // U-77: the account pane registers itself as an address, so the stub has to
  // accept one.  What it does with it is the location bar's business.
  registerTarget: (t) => { window.__targets = [...(window.__targets || []), t]; return () => {}; },
};
installExplorationLauncher(app);
installAccountExplorationLauncher(app);
window.__app = app;
document.querySelector(".view-explore-btn").click();
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS);
    return;
  }
  const rel = path.startsWith("/ui/") ? path.slice(1) : path.slice(1);
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
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

const pane = page.locator('[data-testid="exploration-pane"]');

console.log("\nit opens where the view editors are, and connects by itself");
{
  await pane.waitFor({ timeout: 5000 });
  ok(await pane.count() === 1, "the Explore button opens one pane");
  ok(await page.locator(".view-editors-container > .exploration-pane").count() === 1,
     "it is a child of the editor container -- a peer of the view editors");
  ok(await page.locator(".repository-operation-buttons .view-explore-btn").count() === 1
     && await page.locator(".query-catalog .view-explore-btn").count() === 0,
     "the button that opens it stands with Import, Export and Clear");
  ok(await page.evaluate(() => {
       const explore = document.querySelector(".view-explore-btn");
       return explore.nextElementSibling === document.querySelector(".repo-import-btn");
     }),
     "immediately to the left of Import");
  ok(await page.evaluate(() => {
       const style = (el) => getComputedStyle(el);
       const explore = style(document.querySelector(".view-explore-btn"));
       const imp = style(document.querySelector(".repo-import-btn"));
       // The same font as the operations it now stands with -- it is one of
       // them -- and its own colour, which is blue.
       return explore.fontSize === imp.fontSize
           && explore.fontFamily === imp.fontFamily
           && explore.backgroundColor === "rgb(0, 0, 255)";
     }),
     "in their font, on blue");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="exploration-chip"]').textContent.trim() === "connected",
    null, { timeout: 5000 });
  ok(true, "it connects on open, with no first click");
  const out = await page.locator('[data-testid="exploration-connect-output"]').textContent();
  ok(out.includes("server/discover") && out.includes("survey op=connect"),
     "the connect output is kept, in the collapsible at the top");
  ok(await page.locator('[data-testid="exploration-mcp-endpoint"]').count() === 1,
     "the MCP endpoint is in that same block, because it is this repository's");
  for (const f of ["llm-endpoint", "llm-key", "llm-workspace", "llm-model"]) {
    ok(await page.locator(`[data-testid="exploration-${f}"]`).count() === 0,
       `${f} is NOT: the model is connected once, for the account (§34.4)`);
  }
  ok((await page.locator('[data-testid="exploration-conn-note"]').textContent())
       .includes("account's Connection settings"),
     "and the pane says where it is instead, in the one wording");
  ok(await page.locator('[data-testid="exploration-connection"]').evaluate((d) => d.open) === false,
     "the panel stays shut: a successful handshake is not something to attend to");
  ok(await page.evaluate(() => window.__registry().some(
       (c) => c.id === "playwright/test" && c.connected === true)),
     "and the connection it made is the registry's, not the pane's");
}

console.log("\nopening it twice does not make two");
{
  await page.locator(".view-explore-btn").click();
  ok(await pane.count() === 1, "a second Explore scrolls to the one that is open");
}

console.log("\nrun needs a key, and says so where the key goes");
{
  await page.locator('[data-testid="exploration-prompt"]').fill("collect statistics on the subjects");
  await page.locator('[data-testid="exploration-run"]').click();
  const refusal = await page.locator('[data-testid="exploration-status"]').textContent();
  ok(refusal.includes("key"), "with no key it asks for one rather than failing at the provider");
  ok(refusal.includes("account's Connection settings"),
     "and names the one place it is set, rather than a field it no longer draws");
  ok(await page.evaluate(() => window.__calls().llmCalls) === 0, "and nothing was sent");
}

console.log("\na run, end to end");
{
  await page.evaluate(() => window.__setKey("sk-test"));
  await page.locator('[data-testid="exploration-run"]').click();
  await page.waitForFunction(
    () => /done/.test(document.querySelector('[data-testid="exploration-status"]').textContent),
    null, { timeout: 10000 });

  const entries = page.locator(".exp-exchanges details.exp-x");
  const n = await entries.count();
  ok(n >= 6, `every exchange is an entry (${n} of them)`);

  const titles = await page.locator(".exp-x-title").allTextContents();
  ok(titles.includes("tools/list"), "the tool offer is in the record");
  ok(titles.some((t) => t.startsWith("resources/read")), "so is each primer read");
  ok(titles.some((t) => /turn 1/.test(t)), "so is the model's first turn");
  ok(titles.some((t) => /survey catalog · via LLM/.test(t)), "so is the call it caused");
  ok(titles.includes("exploration session"), "and the handle the run is carrying");

  const toolRow = page.locator("details", { has: page.locator('.exp-x-title:text("survey catalog · via LLM")') }).first();
  const summary = await toolRow.locator("> summary").textContent();
  ok(/catalog/.test(summary) && /8 rows/.test(summary) && /ms|s$/.test(summary.trim()),
     "the indicator line carries the operation, the cardinality and the time");
  ok(/✓/.test(summary), "and whether it worked");

  await toolRow.locator("> summary").click();
  const labels = await toolRow.locator(".exp-block-label").allTextContents();
  ok(labels.includes("arguments") && labels.includes("payload"),
     "request and response are inside the entry the indicator belongs to");
  ok((await toolRow.locator("pre.exp-kind-score").count()) >= 1,
     "the score payload is styled as score, not as undifferentiated text");
}

console.log("\nthe transcript reads as a conversation");
{
  const rowSide = (sel) => page.locator(sel).first().evaluate((el) =>
    getComputedStyle(el).justifyContent);
  ok(await rowSide(".exp-row-llm") === "flex-start", "the model is on the left");
  ok(await rowSide(".exp-row-mcp") === "flex-end", "the service is on the right");
  ok(await rowSide(".exp-row-note") === "center", "the pane's own notices are down the middle");

  // the control belongs on the outer margin: the side the bubble is against
  const llmRow = page.locator(".exp-row-llm").first();
  ok(await llmRow.evaluate((el) => el.firstElementChild.classList.contains("exp-toggle")),
     "a left-hand bubble carries its control on its left");
  const mcpRow = page.locator(".exp-row-mcp").first();
  ok(await mcpRow.evaluate((el) => el.lastElementChild.classList.contains("exp-toggle")),
     "a right-hand bubble carries its control on its right");

  ok(await page.locator(".exp-row .exp-toggle").count()
       === await page.locator(".exp-exchanges details.exp-x").count(),
     "every entry has one");

  // the same glyph the view editors use, and it follows the element it drives
  const d = 'path';
  const shown = await llmRow.locator(`.exp-toggle svg ${d}`).getAttribute("d");
  const openNow = await llmRow.locator("details.exp-x").evaluate((el) => el.open);
  ok(shown === (openNow ? "M6 10l6 6l6 -6h-12" : "M10 18l6 -6l-6 -6v12"),
     "the caret is the page's own, and shows the state it is in");
  // `toggle' is dispatched asynchronously, so wait for the state rather than
  // reading straight after the click and racing it
  const caretIs = (want) => page.waitForFunction(
    (w) => document.querySelector(".exp-row-llm .exp-toggle svg path").getAttribute("d") === w,
    want, { timeout: 2000 }).then(() => true, () => false);

  await llmRow.locator(".exp-toggle").click();
  ok(await llmRow.locator("details.exp-x").evaluate((el) => el.open) === !openNow,
     "the control hides and shows the bubble");
  ok(await caretIs(openNow ? "M10 18l6 -6l-6 -6v12" : "M6 10l6 6l6 -6h-12"),
     "and the caret turns with it");
  await llmRow.locator("details.exp-x > summary").click();
  ok(await caretIs(shown),
     "the summary still discloses, and the control follows rather than diverging");
}

console.log("\nthe answer, and the query inside it");
{
  const last = page.locator(".exp-exchanges .exp-row-llm details.exp-x").last();
  ok(await last.evaluate((d) => d.open) === true, "the final turn opens itself");
  ok((await last.locator("p.exp-prose").count()) >= 2, "the prose is paragraphs, not one block");
  ok(await last.locator("pre.exp-kind-sparql").count() === 1, "the fenced query is kept as a query");
  const q = await last.locator("pre.exp-kind-sparql").textContent();
  ok(q.includes("SELECT ?s (COUNT(*) AS ?n)") && q.includes("GROUP BY ?s"),
     "byte for byte -- it is about to be offered as a view");
  ok(await last.locator('[data-testid^="exploration-add-view-"]').count() === 1,
     "and it is offered as one");
  const raws = await last.locator("details.exp-raw > summary").allTextContents();
  ok(raws.includes("the request in full") && raws.includes("the response in full"),
     "both envelopes are there, collapsed, for when they are needed");
}

console.log("\nthe run is recorded, not just run");
{
  // The service records which operations ran.  Only this side ever saw what
  // they returned, so if the payload is not written from here it is written
  // nowhere -- which is the whole reason this write exists.
  const updates = await page.evaluate(() => window.__updates);
  ok(updates.length === 1, "one update per run, written once the run is over");
  const u = updates[0];
  ok(/INSERT DATA/.test(u) && u.includes("/transcript>"),
     "into the transcript graph, beside the exploration rather than inside it");
  ok(u.includes("mcp:exploration <http://dydra.com/explorations/AAAA-1111>"),
     "pointing at the exploration the handle names");
  ok(u.includes("resultCount: 8") && u.includes("foaf:Person 4"),
     "and it carries the payload the model was shown, not a count of it");
  ok(u.includes("operations: catalog, profile, select, materialize"),
     "including the primer -- the schema half of what it read");
  ok(/mcp:prompt "collect statistics on the subjects"/.test(u),
     "and the prompt that started it");
  ok(u.includes('mcp:kind "tool_result"') && u.includes('mcp:direction "received"'),
     "each exchange says what it was and which way it moved");

  const note = page.locator(".exp-exchanges .exp-row-note").last();
  ok((await note.textContent()).includes("transcript"),
     "the pane says the record was kept, where it says everything else");
}

console.log("\nthis repository's report can be kept too");
{
  // The same two controls as the account's pane, for the same reason: the
  // pane is memory and a file is not.  What differs is what goes in -- one
  // store, one record line, this run's exchanges (§34.8).
  ok(await page.locator('[data-testid="exploration-save-controls"]').count() === 1
     && await page.locator('[data-testid="exploration-open-page"]').count() === 1
     && await page.locator('[data-testid="exploration-save-page"]').count() === 1,
     "the pane offers Open as a page and Save, once a run has produced something");

  const pending = page.context().waitForEvent("page", { timeout: 10000 });
  await page.locator('[data-testid="exploration-open-page"]').click();
  const report = await pending;
  await report.waitForLoadState("domcontentloaded").catch(() => {});
  const html = await report.content();
  ok(/playwright\/test/.test(await report.title()),
     "the page is titled for the repository it reports on");
  ok(/collect statistics on the subjects/.test(html),
     "and carries the question that was asked");
  ok(await report.locator("style").count() === 1
     && await report.locator("script").count() === 0,
     "with its styles inside it and no script at all");
  ok(/recorded: playwright\/test/.test(html),
     "the record it can be checked against is named");
  ok(await report.locator("footer .stage").count() === 1
     && /call\(s\)/.test(await report.locator("footer .stage").textContent()),
     "and the Article 50 line says what was asked of the store");
  await report.close();

  const save = page.waitForEvent("download", { timeout: 10000 });
  await page.locator('[data-testid="exploration-save-page"]').click();
  const file = await save;
  ok(/^exploration-playwright-test-\d{8}T\d{6}Z\.html$/.test(file.suggestedFilename()),
     `saved as ${file.suggestedFilename()} — the repository is in the name`);
}

console.log("\na failure opens itself");
{
  await page.evaluate(() => {
    const prev = window.fetch;
    window.fetch = async (url, init) => {
      if (!String(url).includes("/mcp")) {
        return new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }),
                            { status: 401, headers: { "Content-Type": "application/json" } });
      }
      return prev(url, init);
    };
  });
  await page.locator('[data-testid="exploration-prompt"]').fill("again");
  await page.locator('[data-testid="exploration-run"]').click();
  await page.waitForFunction(
    () => /failed/.test(document.querySelector('[data-testid="exploration-status"]').textContent),
    null, { timeout: 10000 });
  const failed = page.locator(".exp-exchanges details.exp-x-fail").last();
  ok(await failed.count() === 1, "the failure is an entry like any other");
  ok(await failed.evaluate((d) => d.open) === true, "but it opens itself, unlike any other");
  ok(/✗/.test(await failed.locator("> summary").textContent()), "and is marked as one");
}

console.log("\nthe primer actually reads");
{
  const primer = page.locator("details", {
    has: page.locator('.exp-x-title:text("resources/read score://operations")') }).first();
  ok(/✓/.test(await primer.locator("> summary").textContent()),
     "the server's own documentation is read, not reported unreadable");
}

console.log("\nthe request the model was sent");
{
  const turn = page.locator("details", { has: page.locator('.exp-x-title:text("turn 1 → 1 call(s)")') }).first();
  await turn.locator("> summary").click();
  const req = await turn.locator("pre.exp-pre").first().textContent();
  ok(!req.includes("[object Object]"), "the request body is formatted, not stringified");
  ok(/model\s+claude-opus-5/.test(req) && /messages\s+1/.test(req) && /tools\s+survey/.test(req),
     "it is digested to what varies: the model, the messages, the tools offered");
  ok(/system\s+\d+ characters/.test(req) && !/You are exploring an RDF repository/.test(req),
     "the primer is measured rather than reprinted on every turn");
  await turn.locator('details.exp-raw > summary:text("the request in full")').click();
  const full = await turn.locator("details.exp-raw pre.exp-pre").first().textContent();
  ok(full.includes('"model": "claude-opus-5"') && full.includes("You are exploring an RDF repository"),
     "and the whole body is one disclosure away, primer and all");
}

console.log("\nthe Past runs button, and the record it opens");
{
  const panel = page.locator('[data-testid="exploration-session-panel"]');
  ok(await panel.isHidden(), "the log is out of the way until it is asked for");
  await page.locator('[data-testid="exploration-session"]').click();
  ok(await panel.isVisible(), "Past runs shows it");

  await panel.locator('[data-testid="session-log-item-AAAA-1111"]').waitFor({ timeout: 5000 });
  ok(true, "the account's sessions are listed");
  const nodes = panel.locator(".session-log-node");
  await nodes.first().waitFor({ timeout: 5000 });
  ok(await nodes.count() === 2, "the newest session opens itself, with its operations");

  const first = await nodes.first().textContent();
  ok(/catalog/.test(first) && /8 rows/.test(first) && /✓/.test(first),
     "an operation is a row of aligned columns: what, how it went, how much");
  ok(/scope=types/.test(first),
     "JSON parameters are digested to key=value rather than shown as JSON on one line");

  const second = nodes.nth(1);
  ok(await second.evaluate((el) => parseInt(el.style.marginLeft, 10)) === 16,
     "a child operation is indented under its parent");
  ok(await second.evaluate((el) => el.classList.contains("sl-active")) === true,
     "and the session's active node is marked");

  ok(await panel.locator("details.sl-more").count() === 1,
     "only the row with more than its columns can hold gets a disclosure");
  // the pane styles its own disclosures; the log nested inside it must keep its own
  const stray = await panel.locator(".session-log-node").first().evaluate((el) =>
    getComputedStyle(el.closest("summary") || el, "::before").content);
  ok(stray === "none" || stray === "" || stray === "normal",
     "the pane's disclosure triangle does not leak into the log nested inside it");
  ok(await panel.locator('[data-testid="session-log-nodes"] .sl-caret').count() === 2,
     "the log draws its own caret column, on every row, so the columns line up");

  // The second half of the record: the operations say what ran, these say what
  // was shown.  They are separate graphs and one reading.
  const tx = panel.locator('[data-testid="session-log-transcript"]');
  await tx.waitFor({ timeout: 5000 });
  ok(await tx.locator(".sl-run").count() === 1, "the run is listed under the operations");
  ok((await tx.locator(".sl-run-prompt").textContent()).includes("temperature above 20"),
     "headed by what was asked of it");
  const ex = tx.locator('[data-testid^="session-log-exchange-"]');
  ok(await ex.count() === 2, "with one row per exchange that carried content");
  ok((await ex.first().textContent()).includes("score://grammar"),
     "a document the model read is named");
  const payload = await tx.locator('[data-testid="session-log-content-2"]').textContent();
  ok(payload.includes("foaf:Person 4"),
     "and the payload itself is there to be read, which the operation log never held");
  ok((await panel.locator('[data-testid="session-log-status"]').textContent())
       .includes("2 exchange(s) recorded"),
     "the status counts what was recovered");

  // The third record: what the ENDPOINT was asked, which is the only one of the
  // three an autonomous client also produces.
  const calls = panel.locator('[data-testid="session-log-requests"] .sl-req');
  ok(await calls.count() === 1,
     "the calls that named this exploration are shown under it");
  ok((await calls.first().textContent()).includes("tools/call survey"),
     "a call is named by its method and its tool");

  await panel.locator('[data-testid="session-log-journal-2026-10-15"]').click();
  const day = panel.locator('[data-testid="session-log-requests"] .sl-req');
  // wait for a row only the journal view has: the session view also holds one
  // .sl-req, so waiting for the first would resolve against the old paint
  await panel.locator('[data-testid="session-log-call-c2"]').waitFor({ timeout: 5000 });
  ok(await day.count() === 2,
     "a day's journal shows every call it served, exploration or not");
  const agents = await panel.locator(".sl-req-agent").allTextContents();
  ok(agents.includes("playwright") && agents.includes("robot"),
     "each call is attributed to the agent the token authorized");
  ok((await day.nth(1).textContent()).includes("error -32602"),
     "a call that failed says how");
  await day.nth(1).locator("summary").click();
  const body = await panel.locator('[data-testid="session-log-response-c2"]').textContent();
  ok(body.includes("-32602"),
     "and the response itself is one disclosure away, as the request is");

  await page.locator('[data-testid="exploration-session"]').click();
  ok(await panel.isHidden(), "and hides it again");
}

console.log("\nthe account's exploration pane, opened from the left margin");
{
  // the failure section above left a provider that refuses; restore the fixtures
  await page.evaluate(() => { window.fetch = window.__mockFetch; });
  await page.locator('[data-testid="account-tab-exploration"]').click();
  const acc = page.locator('[data-testid="account-exploration-pane"]');
  await acc.waitFor({ timeout: 5000 });
  ok(await acc.count() === 1, "the tab opens one pane");
  ok(await page.locator(".account-pane-content > .account-exploration-pane").count() === 1,
     "in the account's own column, not in the sidebar the tab sits in");
  ok(await page.evaluate(() => document.querySelector('[data-testid="account-tab-exploration"] img')
       .getAttribute("src").includes("explore.svg")),
     "the tab's image is the triple: three nodes and the edges between them");
  ok(await page.evaluate(() =>
       document.querySelector('.account-sidebar .tab-panel[data-panel="profile"]')
         .classList.contains("active")),
     "and the sidebar it sits beside is left alone -- it selects no panel there");

  ok(await page.locator('[data-testid="account-exploration-connection"]').count() === 1,
     "the model is connected here: location, key, workspace and model in one panel");
  ok(await page.locator('[data-testid="connection-key"]').count() === 1,
     "the same controls the account's Connection tab draws, bound to the same object");

  const store = page.locator('[data-testid="account-exploration-store-playwright-test"]');
  await store.waitFor({ timeout: 5000 });
  ok(await store.count() === 1,
     "a store connected in a repository's pane is offered here, without being connected again");
  ok((await page.locator('[data-testid="account-exploration-state-playwright-test"]')
        .textContent()) === "connected",
     "with the state of the handshake that pane made");
  const addable = await page.locator('[data-testid="account-exploration-add-store"]')
    .evaluate((el) => [...el.options].map((o) => o.value));
  ok(addable.includes("playwright/other") && !addable.includes("playwright/test"),
     "and every other repository the account may read is offered to be added");

  ok((await page.locator('[data-testid="account-exploration-authorises"]').textContent())
       .includes("Choose at least one store"),
     "nothing is chosen to begin with, and the pane says what a press would need");
  await page.locator('[data-testid="account-exploration-choose-playwright-test"]').check();
  const said = await page.locator('[data-testid="account-exploration-authorises"]').textContent();
  ok(said.includes("playwright/test") && /\d+ rounds/.test(said) && said.includes("read-only"),
     "choosing one says what the press would authorise, before it is pressed (§35.2)");
  ok((await page.locator('[data-testid="account-exploration-ask"]').textContent()).trim() === "Ask",
     "one store is still an Ask");
}

console.log("\nasking across the stores that were chosen");
{
  const before = await page.evaluate(() => window.__calls().llmCalls);
  await page.locator('[data-testid="account-exploration-prompt"]')
    .fill("compare what the two repositories are about");
  await page.locator('[data-testid="account-exploration-ask"]').click();
  await page.waitForFunction(
    () => /done|failed/.test(
      document.querySelector('[data-testid="account-exploration-status"]').textContent),
    null, { timeout: 15000 });
  ok(await page.evaluate(() => window.__calls().llmCalls) > before,
     "the model is asked with the account's key, which no pane holds");
  ok(await page.locator('[data-testid="account-exploration-answer"]').count() === 1,
     "the answer is placed in the pane, where a report can be read");
  ok((await page.locator('[data-testid="account-exploration-answer"]').textContent())
       .includes("Eight types"),
     "as prose, not as a line in a transcript entry that collapses");
  const titles = await page.locator('[data-testid="account-exploration-exchanges"] .exp-x-title')
    .allTextContents();
  ok(titles.includes("tools/list") && titles.some((t) => /turn 1/.test(t)),
     "and the transcript beside it is the one the repository pane draws");
  ok(await page.evaluate(() => (window.__targets || [])
       .some((t) => t.id === "exploration/playwright")),
     "the pane registers itself as an address, so the location bar can reach it (U-77)");
  ok(await page.evaluate(() => window.__registry()
       .some((c) => c.id === "playwright/test" && c.session === "AAAA-1111")),
     "and the exploration handle is the registry's, so the next run continues this one");
}

console.log("\nthe report can be kept");
{
  ok(await page.locator('[data-testid="account-exploration-open-page"]').count() === 1
     && await page.locator('[data-testid="account-exploration-save-page"]').count() === 1,
     "the answer carries a control to open it as a page, and one to save it");

  // Opening writes a whole document into a window of its own.  Asserted
  // through the window rather than through the HTML, because what matters is
  // that a browser renders it, not that a string was built.
  const pending = page.context().waitForEvent("page", { timeout: 10000 });
  await page.locator('[data-testid="account-exploration-open-page"]').click();
  const report = await pending;
  await report.waitForLoadState("domcontentloaded").catch(() => {});
  ok(await report.title() !== "", "the page has a title of its own");
  ok(/Eight types/.test(await report.content()), "and carries the answer");
  ok(await report.locator("style").count() === 1
     && await report.locator("script").count() === 0,
     "with its styles inside it and no script at all");
  ok(await report.locator("footer .stage").count() === 1,
     "and the Article 50 line, which is the part a copy must not lose");
  await report.close();

  // Saving writes a file.  Playwright reports the download the anchor starts.
  const save = page.waitForEvent("download", { timeout: 10000 });
  await page.locator('[data-testid="account-exploration-save-page"]').click();
  const file = await save;
  ok(/^exploration-playwright-\d{8}T\d{6}Z\.html$/.test(file.suggestedFilename()),
     `saved as ${file.suggestedFilename()} — dated, named for the account, .html`);
}

console.log("\nthe next step continues the exploration");
{
  const next = page.locator('[data-testid="account-exploration-next"]');
  await next.waitFor({ timeout: 5000 });
  ok(await next.isVisible(),
     "a box to write the next step appears once there is an exploration to continue");
  ok(await page.evaluate(() => {
       const answer = document.querySelector('[data-testid="account-exploration-answer"]');
       return answer && answer.nextElementSibling
              === document.querySelector('[data-testid="account-exploration-next"]');
     }),
     "directly under the answer, which is what it responds to");
  const note = await page.locator('[data-testid="account-exploration-next-note"]').textContent();
  ok(/earlier turn\(s\)/.test(note) && /KB/.test(note) && /playwright\/test/.test(note),
     `what the press carries is stated before it is pressed: ${note.trim()}`);

  const before = (await page.evaluate(() => window.__llmBodies.length));
  await page.locator('[data-testid="account-exploration-next-text"]')
    .fill("now do the second of those, for the storeys above 3");
  await page.locator('[data-testid="account-exploration-next-run"]').click();
  await page.waitForFunction(
    (n) => window.__llmBodies.length > n
           && /done|failed|answered/.test(
                document.querySelector('[data-testid="account-exploration-status"]').textContent),
    before, { timeout: 15000 });

  const sent = await page.evaluate((n) => window.__llmBodies[n], before);
  ok(sent.messages.length > 1,
     "the turn is sent with what came before it, not as a fresh conversation");
  ok(sent.messages[sent.messages.length - 1].content
       === "now do the second of those, for the storeys above 3",
     "with the instruction last");
  ok(sent.messages[sent.messages.length - 2].role === "assistant",
     "and an assistant turn before it — two user turns in a row are refused");
  ok(JSON.stringify(sent.messages).includes("tool_result"),
     "the results the earlier turns read travel with it, so \"the second of those\" names something");

  const titles = await page.locator('[data-testid="account-exploration-exchanges"] .exp-x-title')
    .allTextContents();
  ok(titles.includes("next step"),
     "the transcript says this was a continuation, not another first question");
  ok((await page.locator('[data-testid="account-exploration-next-text"]').textContent()).trim() === "",
     "and the box is cleared once the instruction is in the transcript");
}

console.log("\nthe account's pane can ask for a figure too");
{
  const mode = page.locator('[data-testid="account-exploration-figure-mode"]');
  ok(await mode.count() === 1,
     "Figure is a mode of this exploration as well, beside the stores it is asked across");
  ok(!(await mode.isChecked()), "off by default, as it is in a repository's pane");

  await mode.check();
  const said = await page.locator('[data-testid="account-exploration-authorises"]').textContent();
  ok(/query/.test(said) && /survey/.test(said),
     "ticking it says what it widens -- a second tool -- before the press (\u00a735.2)");
  ok(/read-only/.test(said), "and that the grant is unchanged: it was read-only and stays so");

  const before = await page.evaluate(() => window.__llmBodies.length);
  await page.locator('[data-testid="account-exploration-prompt"]')
    .fill("chart the subjects by how many triples they carry");
  await page.locator('[data-testid="account-exploration-ask"]').click();
  await page.waitForFunction(
    (n) => window.__llmBodies.length > n
           && /done|failed|answered/.test(
                document.querySelector('[data-testid="account-exploration-status"]').textContent),
    before, { timeout: 15000 });

  const sent = await page.evaluate((n) => window.__llmBodies[n], before);
  ok(/step 1/i.test(sent.system) && /Draw\./.test(sent.system),
     "the run is told that drawing is step 3 and that this call ends at a proposal (U-12)");
  ok(/analysis|repositor/i.test(sent.system),
     "on top of the analysis brief, not instead of it -- the stores are still named");
  ok((sent.tools || []).some((t) => t.name === "query"),
     "and query is offered beside survey: a figure is drawn from a query (U-11)");
  ok((sent.tools || []).every((t) => t.name !== "update"),
     "the write tool is still withheld, which is what the mode does not change");

  await mode.uncheck();
  const after = await page.evaluate(() => window.__llmBodies.length);
  await page.locator('[data-testid="account-exploration-prompt"]').fill("and in prose");
  await page.locator('[data-testid="account-exploration-ask"]').click();
  await page.waitForFunction(
    (n) => window.__llmBodies.length > n, after, { timeout: 15000 });
  const plain = await page.evaluate((n) => window.__llmBodies[n], after);
  ok(!/step 1/i.test(plain.system) && (plain.tools || []).every((t) => t.name !== "query"),
     "unticked, the next run is the analysis it was before -- the mode is per run, not per pane");
}

console.log("\ncomposing from more than one store");
{
  await page.locator('[data-testid="account-exploration-add-store"]')
    .selectOption("playwright/other");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="account-exploration-choose-playwright-other"]'),
    null, { timeout: 5000 });
  await page.locator('[data-testid="account-exploration-choose-playwright-other"]').check();
  // REQ-37.2.4.  The count used to be in the label -- `Compose from 2' -- so
  // one operation read as several and the same press in a repository's pane,
  // labelled `Compose', looked like a different thing.  The verb is now the
  // verb and the scope is said beside it, which also lets it name the stores
  // rather than only count them.
  await page.waitForFunction(() =>
    /across 2 stores/.test(
      document.querySelector('[data-testid="account-exploration-scope"]').textContent),
    null, { timeout: 5000 });
  ok(await page.textContent('[data-testid="account-exploration-compose"]') === "Compose",
     "the verb is the verb: the count is no longer grown into the label");
  ok((await page.getAttribute('[data-testid="account-exploration-scope"]', "title"))
       .includes("playwright/other"),
     "and the scope beside it names the stores a press would grant a page over, "
   + "not merely how many there are");

  await page.locator('[data-testid="account-exploration-compose"]').click();
  const dash = page.locator('[data-testid="dashboard-pane"]');
  await dash.waitFor({ timeout: 5000 });
  ok(await dash.count() === 1,
     "two stores compose — the press is no longer refused for having more than one");
  const head = await dash.locator(".dsh-head span").first().textContent();
  ok(/playwright\/test/.test(head) && /playwright\/other/.test(head),
     `and the page says which stores it is over: ${head.trim()}`);
  const repos = await dash.locator('input').evaluateAll((els) =>
    els.map((e) => e.value).find((v) => /playwright\/test/.test(String(v))));
  ok(/playwright\/other/.test(String(repos)),
     "Gate 0 offers the grant over both, which is where the user may still narrow it");
}

console.log("\na figure across two stores has to say which one it is of");
{
  // The dashboard pane opened over the account's; press through it rather
  // than closing it, because what is being tested is behind it either way.
  const press = (sel) => page.locator(sel).evaluate((el) => el.click());
  await page.locator('[data-testid="account-exploration-figure-mode"]').evaluate((el) => {
    el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const before = await page.evaluate(() => window.__llmBodies.length);
  await page.locator('[data-testid="account-exploration-prompt"]')
    .evaluate((el) => { el.textContent = "chart the subjects in each"; });
  await press('[data-testid="account-exploration-ask"]');
  await page.waitForFunction(
    (n) => window.__llmBodies.length > n
           && /done|failed|answered/.test(
                document.querySelector('[data-testid="account-exploration-status"]').textContent),
    before, { timeout: 15000 });

  const sent = await page.evaluate((n) => window.__llmBodies[n], before);
  ok(/Say which store/.test(sent.system),
     "with two stores chosen, the model is asked to name the one its query is for");
  ok(sent.system.includes("playwright/test") && sent.system.includes("playwright/other"),
     "listing them in the spelling the pane matches on");

  const draw = page.locator('[data-testid^="account-exploration-draw-"]').last();
  ok(await draw.count() === 1, "the proposal carries a query, so Draw it\u2026 is offered");
  await draw.evaluate((el) => el.click());
  ok(await page.locator('[data-testid="figure-gate"]').count() === 1,
     "and it opens: the store was named in the prose, so the gate knows where to run");
  const status = await page.locator('[data-testid="account-exploration-status"]').textContent();
  ok(!/names no repository/.test(status),
     "not the refusal that a proposal naming nothing would get");
  await draw.evaluate((el) => el.click());
  await page.locator('[data-testid="account-exploration-figure-mode"]').evaluate((el) => {
    el.checked = false; el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

console.log("\nthe location and the model are linked menus");
{
  const loc = page.locator('[data-testid="connection-location"]');
  const model = page.locator('[data-testid="connection-model"]');
  const state = () => page.evaluate(() => {
    const c = window.__connection();
    return { endpoint: c.llmEndpoint, provider: c.llmProvider, model: c.llmModel };
  });
  const options = (sel) => sel.evaluate((el) => [...el.options].map((o) => o.value));
  await page.locator('[data-testid="account-exploration-connection"] > summary').evaluate((s) => {
    const d = s.parentElement; if (!d.open) d.open = true; });

  ok(await loc.evaluate((el) => el.tagName) === "SELECT", "the location is a menu");
  const locs = await options(loc);
  ok(locs.includes("anthropic") && locs.includes("openai") && locs.at(-1) === "__other__",
     "of Anthropic, OpenAI, and other");
  ok(await model.evaluate((el) => el.tagName) === "SELECT", "the model is a menu too");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="connection-model-note"]').textContent), null, { timeout: 5000 });
  ok((await options(model)).join(",") === "claude-opus-5,claude-sonnet-5,__other__",
     "filled from the location's own list, which the key made readable");
  ok(await page.evaluate(() => window.__calls().modelListCalls
       .some((c) => c.url.startsWith("https://api.anthropic.com/v1/models"))),
     "read from api.anthropic.com/v1/models");

  await loc.selectOption("openai");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="connection-model-note"]').textContent)
    && document.querySelector('[data-testid="connection-model"]').options[0].value.startsWith("gpt"),
    null, { timeout: 5000 });
  let s = await state();
  ok(s.provider === "openai" && s.endpoint === "https://api.openai.com/v1/chat/completions",
     "choosing OpenAI sets the location and the provider together");
  ok((await options(model)).join(",") === "gpt-5-mini,gpt-5,__other__",
     "and the model menu follows: chat models only, newest first");
  ok(s.model === "gpt-5", "with the provider's default chosen when the list has it");
  const auth = await page.evaluate(() => window.__calls().modelListCalls.at(-1).headers);
  ok(auth.Authorization === "Bearer sk-test", "the OpenAI list is read with the key as a bearer token");

  await loc.selectOption("__other__");
  const locOther = page.locator('[data-testid="connection-location-other"]');
  ok(await locOther.isVisible(), "other… opens a field for the location");
  await locOther.fill("http://127.0.0.1:9/v1/chat/completions");
  await locOther.dispatchEvent("change");
  await page.waitForFunction(() => window.__calls().modelListCalls
    .some((c) => c.url === "http://127.0.0.1:9/v1/models"), null, { timeout: 5000 });
  s = await state();
  ok(s.endpoint === "http://127.0.0.1:9/v1/chat/completions" && s.provider === "openai",
     "a typed location is used, and spoken to as Chat Completions");
  ok(true, "and its models are read from the sibling /v1/models");

  await model.selectOption("__other__");
  const modelOther = page.locator('[data-testid="connection-model-other"]');
  ok(await modelOther.isVisible(), "other… opens a field for the model");
  await modelOther.fill("my-local-model");
  await modelOther.dispatchEvent("change");
  ok((await state()).model === "my-local-model", "and the typed model is the one used");

  await loc.selectOption("anthropic");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="connection-model-note"]').textContent), null, { timeout: 5000 });
  s = await state();
  ok(!await locOther.isVisible() && s.provider === "anthropic", "choosing a preset closes the field");
  ok(s.model === "my-local-model", "and a model typed by hand is kept until it is changed");
}

console.log("\nREQ-37: the three controls say what they are for, and say it the same way");
{
  /*
   * The question this was written for: what are Ask, Session and Compose?
   *
   * Every mechanism behind the three was specified and tested; what was not
   * was the one thing a reader meets first.  The repository pane called its
   * run `Run', the account pane called the same operation `Ask', the bar
   * called it `Ask across 2', and `Session' named both the button and the
   * live MCP exploration handle the interface carries between runs.  So the
   * three assertions here are: one verb, one noun for the record, and a
   * visible line saying which is which.
   */
  const text = (sel) => page.textContent(sel);
  const title = (sel) => page.getAttribute(sel, "title");

  // REQ-37.2.4 — one name for one operation.
  ok(await text('[data-testid="exploration-run"]') === "Ask",
     "a repository's pane asks with the same verb the account's pane uses — it "
   + "said `Run', which is also what the query editor's execute button says");
  ok(await text('[data-testid="account-exploration-ask"]') === "Ask",
     "and the account's pane carries no count in the verb");

  // REQ-37.2.5 — `Session' named two different things on one screen.
  ok(await text('[data-testid="exploration-session"]') === "Past runs",
     "the record browser is named for what it shows, not for the exploration "
   + "handle that is also called a session");
  ok(await text('[data-testid="account-exploration-session"]') === "Past runs",
     "in the account's pane too, which is the same record read from one level up");

  // REQ-37.1.6 — said before it is pressed, where it is, in one line.
  for (const pane of ["exploration", "account-exploration"]) {
    const legend = (await text(`[data-testid="${pane}-legend"]`)).replace(/\s+/g, " ");
    ok(/Ask answers a question/.test(legend),
       `${pane}: the legend says Ask answers a question`);
    ok(/builds a page/.test(legend), `${pane}: that Compose builds a page`);
    ok(/already happened/.test(legend),
       `${pane}: and that Past runs shows what has already happened`);
  }

  for (const id of ["exploration-run", "exploration-session", "exploration-dashboard",
                    "account-exploration-ask", "account-exploration-session",
                    "account-exploration-compose", "account-exploration-stop"]) {
    const t = await title(`[data-testid="${id}"]`);
    ok(Boolean(t) && t.length > 30, `${id} also carries the longer sentence`);
  }
  ok(/has not run/.test(await title('[data-testid="exploration-run"]')),
     "Ask says the part a reader cannot see: the query it ends with has not run");
  ok(/once, up front/.test(await title('[data-testid="exploration-dashboard"]')),
     "Compose says the part that makes it a different control: the authority is "
   + "granted before anything is sent");
  ok(/no model/.test(await title('[data-testid="exploration-session"]')),
     "and Past runs says it asks no model, which is why it needs no disclosure");
}

console.log("\nclose");
{
  await page.locator('[data-testid="exploration-close"]').click();
  ok(await pane.count() === 0, "the pane closes like a view editor");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
