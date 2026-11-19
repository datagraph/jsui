/**
 * The worked example (§35): two repositories, compared, with the screen
 * captured at each step.
 *
 * What is real here and what is not, stated before anything else, because a
 * demonstration that blurs the two is worth nothing:
 *
 *   REAL -- the two repositories.  `james/finto' and `james/fibo' on
 *     dydra.com, read live through their own MCP resources.  Every count,
 *     every label, every class and every compiled query in the capture came
 *     back from the service during the run.  The node harness proxies those
 *     calls so that the page may make them (a browser page served from
 *     127.0.0.1 cannot call dydra.com), and the credential is read from
 *     ~/.dydra at run time and never reaches the browser.
 *
 *   REAL -- the whole of the client path under test: the line read by
 *     `classifyPrompt', the disclosure, the press, the grant, the brief, the
 *     per-store routing and tool naming, the digesting of large payloads, the
 *     progress line, the stop, and the recording of the run as RDF.
 *
 *   NOT REAL -- the model.  There is no provider key in this environment, so
 *     the harness answers the provider's wire shape itself with a fixed
 *     script.  The script is not invented: it is the sequence of operations
 *     an analyst ran by hand against these two stores, in that order, and the
 *     report it ends with is written from the figures those operations
 *     actually returned.  So the calls are real, their answers are real, and
 *     what is scripted is only the choosing of them.
 *
 * Run: node tests/analysis-demonstration.mjs
 * Writes: doc/analysis-demonstration/*.png
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "doc", "analysis-demonstration");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css" };

const HOST = "https://dydra.com";
const ACCOUNT = "james";
/** Read at run time, from outside the tree, and never sent to the browser. */
const TOKEN = readFileSync(join(homedir(), ".dydra", "dydra.com.token"), "utf8").trim();

/* ── the model, scripted ──────────────────────────────────────────────────
 *
 * Each entry is one provider turn.  The tool names are the qualified ones
 * §34.3 offers when a turn carries more than one store; the adapter resolves
 * them back to `survey' and routes them.
 */
const say = (text) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-opus-5-20261101",
  stop_reason: "end_turn", content: [{ type: "text", text }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const call = (id, name, input, said) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-opus-5-20261101",
  stop_reason: "tool_use",
  content: [...(said ? [{ type: "text", text: said }] : []),
            { type: "tool_use", id, name, input }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

const FINTO = "survey__james__finto";
const FIBO = "survey__james__fibo";

const REPORT = `# Finto and FIBO: what the two stores hold, and what can be compared

Both repositories were read through their own MCP resources in this turn. The
comparison below is drawn only from what those calls returned.

## The two stores are not the same kind of thing

\`james/finto\` is a terminology. It declares 12 types, of which the dominant
one is **96 797 \`skos:Concept\`**, beside 11 980 \`afo-meta:Concept\`, 6 260
\`allars-meta:GeographicalConcept\`, 475 \`skos:Collection\`, 414
\`skos-thes:ThesaurusArray\`, 164 deprecated concepts and 10
\`skos:ConceptScheme\`. It declares **3 \`owl:Class\`** in all.

\`james/fibo\` is an ontology fragment. It declares **4 \`owl:Class\`**, 7
\`owl:Restriction\`, 2 \`owl:Ontology\` and 1 \`owl:DatatypeProperty\` — and **no
\`skos:Concept\` at all**. Its 24 predicates include 10 \`rdfs:subClassOf\` and
13 \`owl:imports\`.

That difference is the principal result. One side indexes subjects for
retrieval; the other states types of financial things and restricts their
relationships. A correspondence between them is a cross-model link, not an
equivalence, and nothing below should be read as one.

## What \`james/fibo\` actually defines

Four classes, with their definitions as the store holds them:

| Class | Definition | Subclass of |
|---|---|---|
| industry sector classification scheme | system for allocating classifiers to organizations by industry sector | Commons \`ClassificationScheme\` |
| industry sector classifier | standardized classification or delineation for an organization, or possibly for a security representing an interest in a given organization, per some scheme for such delineation, by industry | Commons \`Classifier\` |
| commercial loan | loan extended to a corporation, commercial enterprise, joint venture, or other organization as opposed to a consumer | \`LOAN/LoansGeneral/Loans/Loan\` |
| (a fourth, reached only through \`owl:imports\`) | — | — |

Each also carries anonymous \`rdfs:subClassOf\` restrictions, which is why the
shaped query returns eight rows for four classes.

## Two obstacles that stopped the candidate search

I could not produce the candidate table. Both reasons are in the service, not
in the data, and the direct SPARQL below shows the data is fine.

1. **Language-tagged literals do not reach me as text.** Every \`@en\`, \`@fi\`
   and \`@sv\` literal arrives as a printed internal structure —
   \`#S(PLAIN-LITERAL :ID 51432710 :LEXICAL-FORM yhteisöt :LANGUAGE-TAG fi)\` —
   so I cannot read a label, cannot tell one language from another, and cannot
   compare labels across the two stores. Untagged literals, such as fibo's
   definitions, arrive correctly.

2. **\`narrow\` does not narrow.** Asking \`{ where: { skos:prefLabel: {
   $contains: "classification" } } }\` returned the working set unchanged, and
   the query the node compiles to has no filter in it at all:

\`\`\`sparql
SELECT ?SKOS_PREFLABEL
 FROM <urn:dydra:all> WHERE { ?S rdf:type skos:Concept .
         ?S skos:prefLabel ?SKOS_PREFLABEL }
 OFFSET 0
 LIMIT 5
\`\`\`

With 96 797 concepts, a label search is the whole of the Finto side of this
comparison, so this is the blocking one.

## Observed

- \`james/finto\`: 12 declared types; 96 797 \`skos:Concept\`; 11 980
  \`afo-meta:Concept\`; 6 260 \`GeographicalConcept\`; 475 \`skos:Collection\`;
  3 \`owl:Class\`; 10 \`skos:ConceptScheme\`.
- \`james/fibo\`: 4 declared types; 4 \`owl:Class\`; 7 \`owl:Restriction\`;
  2 \`owl:Ontology\`; 24 predicates, 10 of them \`rdfs:subClassOf\`; no
  \`skos:Concept\`.
- \`james/fibo\`: the three readable class definitions quoted above, with their
  named superclasses in OMG Commons and FIBO LOAN.
- \`james/finto\`: labels unreadable through this interface (defect 1); label
  narrowing produces no filter (defect 2).

## Interpreted

- The two stores model their subject differently — indexing concepts against
  classes with axioms — and that is a finding about the pair, not an obstacle
  to be worked around. Any link between them belongs in a mapping graph of its
  own, with its evidence, and not as \`owl:equivalentClass\` or
  \`skos:exactMatch\` in either store.
- fibo's coverage is two modules: industry-sector classification and
  commercial lending. Whatever correspondences exist can only concern those
  two subject areas, whatever else Finto contains.
- The duplicate rows in both stores are a cross-graph union without
  \`DISTINCT\`, not duplicate data.

## Not established

- **No candidate correspondence at all.** None was proposed, because the
  Finto side could not be searched. Nothing here says the fourteen candidates
  of the earlier file-based study are right or wrong.
- **Coverage.** Four classes is not FIBO. The \`owl:imports\` are declarations,
  not definitions, and none of the imported classes — \`Loan\`, \`Classifier\`,
  the organization types — is in this store.
- **Finto's own shape beyond its type counts.** No concept scheme was opened,
  no hierarchy walked, no language inventory taken.
- **Whether the two defects above have other effects.** They were found while
  doing something else, and were not investigated.`;

const SCRIPT = [
  call("c1", FINTO, { op: "catalog", body: "{ scope: types }" },
       "I will inventory each store before saying anything about either. Finto first."),
  call("c2", FIBO, { op: "catalog", body: "{ scope: types }" },
       "96 797 skos:Concept. Now the other store."),
  call("c3", FIBO, { op: "select",
                     body: "{ @type: owl:Class, @shape: [rdfs:label, skos:definition, rdfs:subClassOf], @limit: 10 }" },
       "Four owl:Class and no skos:Concept — a different kind of store. Let me read the four."),
  call("c4", FINTO, { op: "select", body: "{ @type: skos:Concept, @shape: [skos:prefLabel], @limit: 5 }" },
       "Now the Finto side: I need its labels to look for the same subjects."),
  call("c5", FINTO, { op: "narrow", body: "{ where: { skos:prefLabel: { $contains: \"classification\" } } }",
                      node: "n2" },
       "The labels are not arriving as text. Let me try narrowing anyway."),
  call("c6", FINTO, { op: "materialize", body: "sparql", node: "n3" },
       "That returned the same rows. Let me see what query it compiled to."),
  say(REPORT),
];

/* ── the harness page ─────────────────────────────────────────────────────── */

const HARNESS = `<!doctype html><meta charset="utf-8"><title>analysis demonstration</title>
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
connection.llmEndpoint = location.origin + "/model";
connection.llmKey = "no-real-key-the-harness-answers";
connection.llmModel = "claude-opus-5";

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

/* ── the server: files, a proxy to the service, and the scripted model ────── */

let turn = 0;                 // which scripted reply has been served
let credits = 0;              // how many model turns the driver has released
const asked = [];             // what the page sent the "model"
const relayed = [];           // what went to the service
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Hold a model reply until the driver releases one.  A release is never
 *  wasted: it is a credit, whether or not a request is waiting for it. */
async function waitForCredit() {
  while (credits <= 0) await wait(50);
  credits -= 1;
}

process.on("unhandledRejection", (e) => console.log("  unhandled: " + e));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);

  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" }); res.end(HARNESS); return;
  }

  if (path === "/go") { credits += 1; res.writeHead(200); res.end("ok"); return; }

  if (path === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ turn, asked: asked.length, credits, relayed: relayed.length }));
    return;
  }

  if (path === "/model") {
    let body = ""; for await (const c of req) body += c;
    asked.push(JSON.parse(body));
    await waitForCredit();
    const reply = SCRIPT[turn++] || say("(the script is exhausted)");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
    return;
  }

  if (path.startsWith("/proxy/")) {
    const target = HOST + path.slice("/proxy".length) + (url.search || "");
    let body = ""; for await (const c of req) body += c;
    const headers = { Authorization: "Bearer " + TOKEN };
    for (const h of ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name"]) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    // The service occasionally closes a connection mid-response; one retry
    // keeps a ten-minute demonstration from ending on a socket.
    let out = null, text = "", why = null;
    for (let attempt = 0; attempt < 2 && !out; attempt += 1) {
      try {
        out = await fetch(target, { method: req.method, headers,
                                    body: req.method === "GET" ? undefined : body });
        text = await out.text();
      } catch (e) { why = e; out = null; }
    }
    if (!out) {
      console.log(`  proxy FAILED ${req.method} ${target}: ${why}`);
      relayed.push({ target, status: 0, bytes: 0 });
      res.writeHead(502, { "Content-Type": "application/json",
                           "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: String(why) }));
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
  const file = join(SHOTS, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  notes.push({ file: `${String(n).padStart(2, "0")}-${name}.png`, note });
  console.log(`  shot ${String(n).padStart(2, "0")} ${name} — ${note}`);
};

page.on("pageerror", (e) => console.log("  PAGE ERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("  console: " + m.text()); });

await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.waitForFunction(() => window.__ready, { timeout: 10000 });
await page.waitForTimeout(300);
await shot("the-interface", "the chrome, with the location bar as the only prompt on the screen");

const QUESTION = "compare the concepts present in james/finto and james/fibo";
await page.click("#location-display");
await page.fill("#location-input", QUESTION);
await shot("the-question-typed",
           "a line that names two repositories — the bar reads it as a question about data, not an instruction about the interface");

await page.press("#location-input", "Enter");
await page.waitForSelector('[data-testid="location-confirm"]', { timeout: 20000 });
await shot("disclosed-before-it-runs",
           "nothing has run: the stores are named and one press is offered");
await page.click('[data-testid="location-more"]');
await page.waitForTimeout(150);
await shot("what-the-press-authorises",
           "the disclosure: which repositories, how many rounds, how many calls, read-only, and where the answer will be kept");
await page.click('[data-testid="location-more"]');

const runState = async () => (await (await fetch(`http://127.0.0.1:${port}/state`)).json());
/** Wait until the page has ASKED the model for turn `k' (1-based). */
const until = async (k, ms = 180000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const st = await runState();
    if (st.asked >= k) return st;
    if (Date.now() > deadline) throw new Error(`timed out waiting for model turn ${k}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

await page.click('[data-testid="location-confirm"]');
// Both stores' tools/list and the two primer documents are read before the
// model is asked anything; that is four live round trips.
await until(1);
await page.waitForTimeout(200);
await shot("reading-the-tools", "the run has begun: each store's own tools and the server's operation catalogue are read first");

let served = 0;
const step = async (name, note) => {
  await fetch(`http://127.0.0.1:${port}/go`);
  served += 1;
  await until(served + 1);        // the next turn has been asked, so this one is done
  await page.waitForTimeout(250);
  await shot(name, note);
};

await step("inventory-finto", "the first call, routed to james/finto by the name it was called under");
await step("inventory-fibo", "the second, to james/fibo — one exploration per store");
await step("reading-the-classes", "fibo's four owl:Class, read with their definitions");
await step("reading-the-labels", "finto's labels — where the run meets the first defect");
await step("narrowing", "a label search over 96 797 concepts");
await step("the-compiled-query", "and the query that search compiled to, asked for so it can be rerun");

// The last turn is the report: released, and then the run finishes on its own.
await shot("writing-it-up", "the model has what it needs and is writing the report");
await fetch(`http://127.0.0.1:${port}/go`);
await page.waitForSelector('[data-testid="location-more"]', { timeout: 120000 });
await page.waitForTimeout(400);
await shot("answered", "the reply line: the first sentence of the answer, with the rest folded");

await page.click('[data-testid="location-more"]');
await page.waitForTimeout(250);
await shot("the-report", "the answer, folded under the bar rather than truncated into it");
await page.evaluate(() => {
  const box = document.querySelector('[data-testid="location-detail"]');
  if (box) box.scrollTop = box.scrollHeight;
});
await page.waitForTimeout(200);
await shot("observed-interpreted-not-established",
           "the three lists the brief requires, and the provenance the interface adds: model as served, stores, calls, date, and where it was recorded");

console.log(`\nmodel turns served: ${turn}`);
console.log(`service calls relayed: ${relayed.length}`);
for (const r of relayed) console.log(`  ${r.status} ${r.bytes.toString().padStart(7)}  ${r.target}`);

await writeFile(join(SHOTS, "shots.json"), JSON.stringify(notes, null, 2));
await browser.close();
server.close();
console.log(`\nwrote ${n} screenshots to doc/analysis-demonstration/`);
process.exit(0);
