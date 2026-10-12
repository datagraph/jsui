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
<div class="repository-pane" data-account="playwright" data-repository="test">
  <div class="query-catalog">
    <h2 style="display: flex; align-items: center;">Views
      <span style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
        <button class="view-explore-btn" data-account="playwright" data-repository="test">Explore</button>
        <button class="view-new-btn">New</button>
      </span>
    </h2>
  </div>
  <div class="view-editors">
    <h2>Editors</h2>
    <div class="view-editors-container"></div>
  </div>
</div>
<script type="module">
import { openExplorationPane, installExplorationLauncher } from "/ui/components/exploration-pane.js";

/* ── fixtures ────────────────────────────────────────────────────────────── */
const rpc = (result) => ({ jsonrpc: "2.0", id: 1, result });
const payload = (text) => rpc({ content: [{ type: "resource", resource: { text } }] });

/* The exploration record, as SPARQL results.  Lisp universal time, because that
   is what the server writes. */
const bind = (rows) => ({ head: {}, results: { bindings: rows.map((r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { type: "literal", value: String(v) }]))) } });
const G = "http://dydra.com/explorations/AAAA-1111";
const M = "http://dydra.com/ns/mcp#";
const SESSION_ROWS = (query) => query.includes("mcp:Exploration")
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

window.fetch = async (url, init = {}) => {
  // a SPARQL body is a query, not JSON -- parse defensively or the session log
  // request dies here instead of reaching its own branch
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj),
    { status, headers: { "Content-Type": "application/json" } });

  // The session log reads <account>/mcp over SPARQL, so it arrives here too --
  // with a query for a body rather than JSON-RPC.
  if (String(url).includes("/sparql")) return reply(SESSION_ROWS(String(init.body || "")));

  if (String(url).includes("/mcp")) {
    mcpCalls += 1;
    if (body.method === "server/discover") return reply(rpc({ serverInfo: { name: "dydra" } }));
    if (body.method === "tools/list") {
      return reply(rpc({ tools: [
        { name: "survey", description: "explore", inputSchema: { type: "object" } },
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
  if (llmCalls === 1) {
    return reply({
      id: "m1", stop_reason: "tool_use", usage: { input_tokens: 5300, output_tokens: 412 },
      content: [
        { type: "text", text: "Let me look at the types first." },
        { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog", scope: "types" } },
      ],
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
const app = { state: { getAuthContext: () => ({ host: location.origin, token: "TOKEN" }) } };
installExplorationLauncher(app);
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
  ok(await page.locator(".query-catalog .view-explore-btn").count() === 1
     && await page.locator(".view-editors .view-explore-btn").count() === 0,
     "the button that opens it sits in the view catalog, with New");
  ok(await page.evaluate(() => {
       const explore = document.querySelector(".view-explore-btn");
       return explore.nextElementSibling === document.querySelector(".view-new-btn");
     }),
     "immediately to the left of New");
  ok(await page.evaluate(() => {
       const h2 = document.querySelector(".query-catalog h2");
       const controls = document.querySelector(".view-explore-btn").parentElement;
       // Floated right: the controls end where the header ends, and start well
       // past its left edge -- not simply stacked after the word `Views'.
       return Math.abs(controls.getBoundingClientRect().right
                       - h2.getBoundingClientRect().right) < 2
           && controls.getBoundingClientRect().left
                - h2.getBoundingClientRect().left > 40;
     }),
     "and the pair is pushed to the right edge of the panel");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="exploration-chip"]').textContent.trim() === "connected",
    null, { timeout: 5000 });
  ok(true, "it connects on open, with no first click");
  const out = await page.locator('[data-testid="exploration-connect-output"]').textContent();
  ok(out.includes("server/discover") && out.includes("survey op=connect"),
     "the connect output is kept, in the collapsible at the top");
  for (const f of ["llm-endpoint", "llm-key", "llm-workspace", "llm-model", "mcp-endpoint"]) {
    ok(await page.locator(`[data-testid="exploration-${f}"]`).count() === 1, `${f} is in that same block`);
  }
  ok(await page.locator('[data-testid="exploration-connection"]').evaluate((d) => d.open) === true,
     "and it is open to begin with, because no key has been given yet");
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
  ok((await page.locator('[data-testid="exploration-status"]').textContent()).includes("key"),
     "with no key it asks for one rather than failing at the provider");
  ok(await page.evaluate(() => window.__calls().llmCalls) === 0, "and nothing was sent");
}

console.log("\na run, end to end");
{
  await page.locator('[data-testid="exploration-llm-key"]').fill("sk-test");
  await page.locator('[data-testid="exploration-llm-key"]').dispatchEvent("change");
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
  const last = page.locator(".exp-exchanges details.exp-x").last();
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

console.log("\nthe session button, and the log it opens");
{
  const panel = page.locator('[data-testid="exploration-session-panel"]');
  ok(await panel.isHidden(), "the log is out of the way until it is asked for");
  await page.locator('[data-testid="exploration-session"]').click();
  ok(await panel.isVisible(), "Session shows it");

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
  ok(await panel.locator(".sl-caret").count() === 2,
     "the log draws its own caret column, on every row, so the columns line up");

  await page.locator('[data-testid="exploration-session"]').click();
  ok(await panel.isHidden(), "and hides it again");
}

console.log("\nthe location and the model are linked menus");
{
  const loc = page.locator('[data-testid="exploration-llm-endpoint"]');
  const model = page.locator('[data-testid="exploration-llm-model"]');
  const state = () => page.evaluate(() => {
    const st = document.querySelector(".exploration-pane")._explorationApi.state;
    return { endpoint: st.llmEndpoint, provider: st.llmProvider, model: st.llmModel };
  });
  const options = (sel) => sel.evaluate((el) => [...el.options].map((o) => o.value));
  // the failure section above left a provider that refuses; restore the fixtures
  await page.evaluate(() => { window.fetch = window.__mockFetch; });
  await page.locator('[data-testid="exploration-connection"] > summary').evaluate((s) => {
    const d = s.parentElement; if (!d.open) d.open = true; });

  ok(await loc.evaluate((el) => el.tagName) === "SELECT", "the location is a menu");
  const locs = await options(loc);
  ok(locs.includes("anthropic") && locs.includes("openai") && locs.at(-1) === "__other__",
     "of Anthropic, OpenAI, and other");
  ok(await model.evaluate((el) => el.tagName) === "SELECT", "the model is a menu too");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="exploration-llm-model-note"]').textContent), null, { timeout: 5000 });
  ok((await options(model)).join(",") === "claude-opus-5,claude-sonnet-5,__other__",
     "filled from the location's own list, which the key made readable");
  ok(await page.evaluate(() => window.__calls().modelListCalls
       .some((c) => c.url.startsWith("https://api.anthropic.com/v1/models"))),
     "read from api.anthropic.com/v1/models");

  await loc.selectOption("openai");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="exploration-llm-model-note"]').textContent)
    && document.querySelector('[data-testid="exploration-llm-model"]').options[0].value.startsWith("gpt"),
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
  const locOther = page.locator('[data-testid="exploration-llm-endpoint-other"]');
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
  const modelOther = page.locator('[data-testid="exploration-llm-model-other"]');
  ok(await modelOther.isVisible(), "other… opens a field for the model");
  await modelOther.fill("my-local-model");
  await modelOther.dispatchEvent("change");
  ok((await state()).model === "my-local-model", "and the typed model is the one used");

  await loc.selectOption("anthropic");
  await page.waitForFunction(() => /2 models/.test(
    document.querySelector('[data-testid="exploration-llm-model-note"]').textContent), null, { timeout: 5000 });
  s = await state();
  ok(!await locOther.isVisible() && s.provider === "anthropic", "choosing a preset closes the field");
  ok(s.model === "my-local-model", "and a model typed by hand is kept until it is changed");
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
