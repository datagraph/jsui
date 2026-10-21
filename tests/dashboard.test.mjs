/**
 * The dashboard path: the grant, the digest, the content contract, the frame's
 * policy, the panel runs and the staleness marking.
 *
 * §7 of `llm-result-rendering-plan.md' is mostly a set of claims about what
 * CANNOT happen -- a write cannot be relayed under a read-only grant, a page
 * cannot reach the parent's origin, a sentence cannot go on claiming a number
 * after the number has moved.  Those are the things asserted here, because a
 * claim of that shape is exactly the kind that rots silently: nothing fails
 * when it stops being true, the behaviour merely widens.
 *
 * The loading note from tool-adapter.test.mjs applies: jsui's package.json
 * declares no "type", so the lib tree is copied into a scratch package that
 * does, which keeps the relative imports intact.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-dashboard-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { createGrant, queryFormOf, bodyReadsOnly, repositoryKey,
        READ_NOTATIONS } = await load("llm/grant.js");
const { digestResult, renderDigest, contentDigest } = await load("mcp/result-digest.js");
const {
  dashboardFrom, validateDashboard, slotsOf, withInputDigests, staleAssertions, dashboardRecord,
} = await load("dashboard/spec.js");
const { buildPage, CSP, SANDBOX } = await load("dashboard/frame.js");
const { runPanels, payloadsFor, totals } = await load("dashboard/runner.js");
const { putPanelSet, tempName, isTempName, sweep, authHeader } = await load("dashboard/catalog.js");
const { createToolAdapter, DASHBOARD_TOOLS, RESULT_FULL } = await load("llm/tool-adapter.js");
const { insertData } = await load("mcp/transcript-store.js");
const { dashboardSystem } = await load("llm/dashboard-prompt.js");
const { listDashboards, readDashboard } = await load("dashboard/archive.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ══════════════════════════════ D-O: the grant ══════════════════════════ */

section("D-O: the grant is charged, not consulted");
{
  const seen = [];
  const g = createGrant({ repositories: ["acct/repo"], maxQueries: 2, maxBytes: 100 },
                        { onChange: (e) => seen.push(e.type) });

  ok(g.check({ name: "survey", input: { op: "catalog" } }).ok, "a read is allowed");
  ok(g.spent.queries === 1, "and the call is charged before it is made, not after");

  const write = g.check({ name: "query", input: { mimeType: "application/sparql-update" } });
  ok(!write.ok && /read-only/.test(write.reason),
     "a write notation is refused under a read-only grant");
  ok(g.spent.queries === 1, "a refused call costs nothing");

  const body = g.check({ name: "query", input: { body: "PREFIX x: <u:x> DELETE WHERE { ?s ?p ?o }" } });
  ok(!body.ok && /DELETE/.test(body.reason),
     "and so is a read notation carrying a body that writes -- the argument is screened, not the name");

  ok(!g.check({ name: "graphql_mutate", input: {} }).ok, "a tool outside the grant is refused");

  ok(g.check({ name: "survey", input: {} }).ok, "the second of two calls is allowed");
  const third = g.check({ name: "survey", input: {} });
  ok(!third.ok && /all are spent/.test(third.reason), "the third is not");

  ok(!g.check({ name: "survey", input: { repository: "other/repo" } }).ok,
     "a repository outside the grant is refused");

  ok(seen.includes("charged") && seen.includes("refused"),
     "every charge and every refusal is announced, so a meter can be live");
}

section("D-O: revocable mid-run, and widenable a notch at a time");
{
  const g = createGrant({ maxQueries: 10 });
  g.check({ name: "survey", input: {} });
  g.revoke("the user revoked it");
  const after = g.check({ name: "survey", input: {} });
  ok(!after.ok && /revoked/.test(after.reason), "a revoked grant refuses the next call");

  const h = createGrant({ maxQueries: 1, maxBytes: 1000 });
  h.check({ name: "survey", input: {} });
  ok(!h.check({ name: "survey", input: {} }).ok, "spent");
  h.widen({ maxQueries: 4 });
  ok(h.check({ name: "survey", input: {} }).ok, "and runs again once widened, without restarting");
  const narrowed = h.widen({ maxQueries: 1 });
  ok(h.limits.maxQueries === 4 && !("maxQueries" in narrowed),
     "widening cannot narrow: taking authority away is revocation, and says so");
}

section("the operative keyword decides what a body does");
{
  ok(queryFormOf('SELECT ?s { ?s ?p "delete this" }') === "SELECT",
     "a query mentioning delete in a literal is still a SELECT");
  ok(queryFormOf("PREFIX a: <u:a>\nBASE <u:b>\n# comment\nDELETE DATA { }") === "DELETE",
     "a write behind a prologue and a comment is still a write");
  ok(repositoryKey("https://host/acct/repo/mcp") === "acct/repo",
     "an endpoint names its repository");
}

/* ═════════════════════════════ D-Q: the digest ══════════════════════════ */

section("D-Q: the shape is the default, not the ceiling");
{
  const rows = ["?region\t?year\t?revenue"];
  for (let i = 0; i < 500; i += 1) rows.push(`R${i % 4}\t${2019 + (i % 6)}\t${(i * 7.5).toFixed(2)}`);
  const tsv = rows.join("\n");
  const d = digestResult(tsv, "text/tab-separated-values");

  ok(d.form === "table" && d.rows === 500, "a table is read as a table");
  ok(d.columns.length === 3 && d.columns[0].name === "region",
     "the ? is stripped from a SPARQL TSV header");
  ok(d.columns[1].min === 2019 && d.columns[1].max === 2024, "a numeric column carries its range");
  ok(d.columns[2].types[0].type === "decimal",
     "the lexical form decides the type: 7.50 is a decimal, not an integer");
  ok(d.columns[0].distinct === 4, "cardinality is counted, which is what picks a chart");
  ok(d.sample.length === 5, "and a head sample is carried");

  const text = renderDigest(d, { name: "r1" });
  ok(text.length < tsv.length / 4, "the digest is a fraction of the document");
  ok(/full document/i.test(text), "and every digest says how to get the whole thing");

  ok(digestResult(JSON.stringify({ boolean: true })).form === "boolean", "an ASK is a boolean");
  ok(digestResult("<u:a> <u:p> 1 .\n<u:b> <u:p> 2 .").form === "graph",
     "a graph is a graph, with its predicates counted");
}

section("D-T: the digest is stable, and changes when the data does");
{
  ok(contentDigest("abc") === contentDigest("abc"), "the same text always digests the same");
  ok(contentDigest("abc") !== contentDigest("abd"), "a changed byte changes it");
  ok(contentDigest("ab") !== contentDigest("abab"), "length is mixed in, so truncation is not a near miss");
  ok(contentDigest("x").length === 32, "128 bits, as hex");
}

/* ═════════════════════════ D-P: the content contract ════════════════════ */

const PROPOSAL = {
  title: "Sales",
  panels: [
    { name: "sales", query: "SELECT ?r ?v WHERE { ?s :region ?r ; :value ?v }" },
    { name: "costs", query: "SELECT ?r ?c WHERE { ?s :region ?r ; :cost ?c }" },
  ],
  transforms: [
    { name: "margin", inputs: ["sales", "costs"],
      body: "return inputs.sales.rows.length + inputs.costs.rows.length;" },
  ],
  assertions: [
    { id: "lead", inputs: ["sales"], text: "Revenue concentration rose." },
    { id: "context", inputs: [], text: "The industry average is four percent." },
  ],
  html: '<h1>Sales</h1><div data-bound="sales"></div><div data-bound="costs"></div>'
      + '<p data-derived="margin"></p><p data-asserted="lead"></p><p data-asserted="context"></p>',
};

section("D-P: three kinds of region, each declaring itself");
{
  const fenced = "Here is the page.\n\n```dashboard\n" + JSON.stringify(PROPOSAL) + "\n```";
  const parsed = dashboardFrom(fenced);
  ok(parsed && parsed.panels.length === 2, "the proposal is read out of the fenced block");

  const v = validateDashboard(parsed);
  ok(v.ok && !v.errors.length, "a well-formed proposal validates");
  const s = slotsOf(PROPOSAL.html);
  ok(s.bound.length === 2 && s.derived.length === 1 && s.asserted.length === 2,
     "and the page's slots are found by kind");
  ok(v.spec.assertions.find((a) => a.id === "context").kind === "outside-knowledge",
     "an assertion citing no panel is marked as outside knowledge, not hidden");
  ok(v.spec.assertions.find((a) => a.id === "lead").kind === "derived-from-results",
     "one citing a panel says what it was written from");
}

section("a `#\' in a namespace is not a comment");
{
  // The live failure, in full.  A FOAF page declares `contact:\' last, whose
  // IRI ends in `#\'; a comment stripper that does not know an IRI from a
  // comment eats the rest of that line -- the closing `>\' with it -- and the
  // query no longer begins with anything recognisable.  Every panel of the
  // page was rejected as "not a query", and the eighteen errors that followed
  // were the same three faults seen from the transforms, the assertions and
  // the slots.
  const EDGES = [
    "PREFIX foaf: <http://xmlns.com/foaf/0.1/>",
    "PREFIX contact: <http://www.w3.org/2000/10/swap/pim/contact#>",
    "SELECT ?from ?to WHERE { { ?from foaf:knows ?to } UNION { ?from contact:assistant ?to } }",
  ].join("\n");
  ok(queryFormOf(EDGES) === "SELECT", "the form is read through a hash-terminated namespace");
  ok(queryFormOf("PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nSELECT ?s {}")
     === "SELECT", "and through rdf:, which every query in the world declares");
  ok(queryFormOf("# SELECT is mentioned here\nASK { ?s ?p ?o }") === "ASK",
     "a real comment is still a comment");
  ok(queryFormOf('SELECT ?s { ?s ?p "a # b" }') === "SELECT",
     "and a hash inside a literal is neither");

  // The same misreading, pointed the other way, is the serious one: a form
  // that cannot be read is not recognised as a write, and the argument screen
  // exists for exactly the call it then passes.
  const DEL = "PREFIX ex: <http://example.org/ns#>\nDELETE WHERE { ?s ?p ?o }";
  ok(queryFormOf(DEL) === "DELETE", "a DELETE behind a hash-terminated prefix is a DELETE");
  ok(bodyReadsOnly(DEL, "application/sparql-query") === false,
     "so the read-only screen refuses it, which it did not before");

  const page = validateDashboard({
    title: "Relations among people",
    panels: [{ name: "edges", query: EDGES },
             { name: "nodes", query: "PREFIX foaf: <http://xmlns.com/foaf/0.1/>\n"
                                   + "SELECT ?p ?name WHERE { ?p foaf:name ?name }" }],
    transforms: [{ name: "graph", inputs: ["edges", "nodes"], body: "return 1;" }],
    assertions: [{ id: "lead", inputs: ["edges"], text: "A star." }],
    html: '<div data-bound="edges"></div><div data-bound="nodes"></div>'
        + '<div data-derived="graph"></div><div data-asserted="lead"></div>',
  });
  ok(page.ok && page.errors.length === 0,
     "and the page the live run proposed validates, which it did not before");
  ok(page.spec.panels.length === 2 && page.spec.transforms.length === 1,
     "with its panels and its transform intact");
}

section("one fault is reported once");
{
  // Even with the parse fixed, a genuinely bad panel used to be reported by
  // everything downstream of it.  The cause has to be findable.
  const r = validateDashboard({
    panels: [{ name: "edges", query: "not a query at all" }],
    transforms: [{ name: "graph", inputs: ["edges"], body: "return 1;" }],
    assertions: [{ id: "lead", inputs: ["edges"], text: "…" }],
    html: '<div data-bound="edges"></div><div data-derived="graph"></div>'
        + '<div data-asserted="lead"></div>',
  });
  ok(!r.ok, "the proposal is still refused");
  ok(r.errors.length === 1 && /panel `edges\' does not begin with a query form/.test(r.errors[0]),
     "by the one error that says why, not by its five consequences");
  ok(!r.warnings.some((w) => /no panels/.test(w)),
     "and `no panels\' is not said of a page that proposed one");

  // The forward reference, which IS the referrer\'s fault, survives: it is the
  // only thing between declaration order and a cycle.
  const cyc = validateDashboard({
    panels: [{ name: "p", query: "SELECT * {}" }],
    transforms: [{ name: "a", inputs: ["b"], body: "1" }, { name: "b", inputs: ["a"], body: "1" }],
    html: '<div data-bound="p"></div>',
  });
  ok(!cyc.ok && cyc.errors.some((e) => /not declared above it/.test(e)),
     "a cycle is still a cycle");
}

section("a transform that does not compile is a Gate 1 error, not a page that fails");
{
  // The live run that prompted this reported, after the page was already up,
  // "the page reported an error in transform:census: fill/<@about:srcdoc:225:18
  // fill@about:srcdoc:212:29" -- three line numbers inside the frame's own
  // runtime and not one word about what was wrong.  Line 225 is where the
  // frame builds the transform with `new Function', so the throw was a parse
  // failure in the model's body, and Firefox leaves the message out of
  // SyntaxError.stack.  Both halves are addressed: the fault is found before
  // the page is mounted, and the frame says what an error SAYS (asserted in
  // tests/dashboard-frame.browser.mjs).
  const r = validateDashboard({
    panels: [{ name: "people", query: "SELECT * {}" }],
    transforms: [{ name: "census", inputs: ["people"],
                   body: "const n = inputs.people.rows.length; return {;" }],
    html: '<div data-bound="people"></div><div data-derived="census"></div>',
  });
  ok(!r.ok, "a body that cannot be parsed stops the page");
  const err = r.errors.find((e) => /transform `census'/.test(e));
  ok(Boolean(err) && /does not compile/.test(err),
     "and is named as the transform it is, before anything is mounted");
  ok(Boolean(err) && err.length > "transform `census' does not compile: ".length,
     `with the parser's own message, which the frame's stack omits: ${JSON.stringify(err)}`);
  ok(r.errors.filter((e) => /census/.test(e)).length === 1,
     "once -- the slot that shows it is not a second fault");

  const good = validateDashboard({
    panels: [{ name: "people", query: "SELECT * {}" }],
    transforms: [{ name: "census", inputs: ["people"],
                   body: "return { count: inputs.people.rows.length };" }],
    html: '<div data-bound="people"></div><div data-derived="census"></div>',
  });
  ok(good.ok, "a body that parses is left alone");

  // Construction parses; it must not RUN.  A body whose top level throws is
  // still a valid body -- the frame is where it is called, under a catch.
  const runs = validateDashboard({
    panels: [{ name: "people", query: "SELECT * {}" }],
    transforms: [{ name: "boom", inputs: ["people"],
                   body: "throw new Error('at run time');" }],
    html: '<div data-bound="people"></div><div data-derived="boom"></div>',
  });
  ok(runs.ok, "the check parses the body and does not execute it");
}

section("D-P: what the contract refuses");
{
  const bad = validateDashboard({
    panels: [{ name: "a", query: "DELETE WHERE { ?s ?p ?o }" }],
    html: '<div data-bound="nope"></div><div data-derived="ghost"></div>',
  });
  ok(!bad.ok, "a broken proposal does not validate");
  ok(bad.errors.some((e) => /does not write/.test(e)), "a panel that writes is refused");
  ok(bad.errors.some((e) => /not a panel/.test(e)), "a slot naming nothing is refused");
  ok(bad.errors.some((e) => /not a transform/.test(e)), "and so is a derived slot with no function");

  const cyc = validateDashboard({
    panels: [{ name: "p", query: "SELECT * {}" }],
    transforms: [{ name: "a", inputs: ["b"], body: "1" }, { name: "b", inputs: ["a"], body: "1" }],
    html: '<div data-bound="p"></div>',
  });
  ok(!cyc.ok && cyc.errors.some((e) => /not declared above it/.test(e)),
     "declaration order is dependency order, so a cycle cannot be written");

  const warned = validateDashboard({
    panels: [{ name: "p", query: "SELECT * {}" }],
    html: '<div data-bound="p"></div><img src="https://example.test/x.png">'
        + "<script>fetch('/x')</script>",
  });
  ok(warned.ok, "a page the policy will trim is still a valid page");
  ok(warned.warnings.some((w) => /external image/.test(w))
     && warned.warnings.some((w) => /network call/.test(w)),
     "but Gate 1 is told what will be blocked, rather than leaving a blank panel to explain itself");
}

section("D-T: an assertion carries the digest of what it was written from");
{
  const v = validateDashboard(PROPOSAL);
  const first = { sales: { digest: "aaa" }, costs: { digest: "bbb" } };
  const stamped = withInputDigests(v.spec, first);
  ok(stamped.assertions[0].inputDigests.sales === "aaa", "the digest is stamped on");
  ok(!staleAssertions(stamped, first).length, "unchanged data leaves the prose alone");

  const moved = staleAssertions(stamped, { sales: { digest: "zzz" }, costs: { digest: "bbb" } });
  ok(moved.length === 1 && moved[0].id === "lead" && moved[0].moved[0] === "sales",
     "and when the data moves, the sentence written against it is named");
  ok(!moved.some((m) => m.id === "context"),
     "a passage citing nothing cannot go stale, because it never claimed a number");
}

/* ══════════════════════════ D-R: the frame's policy ═════════════════════ */

section("D-R: scripts on, origin off");
{
  ok(SANDBOX === "allow-scripts", "the sandbox allows scripts");
  ok(!/allow-same-origin/.test(SANDBOX),
     "and NOT same-origin -- the one combination that must never appear, "
   + "because a frame holding both can remove its own sandbox");

  ok(/connect-src 'none'/.test(CSP), "the page cannot open a connection");
  ok(/default-src 'none'/.test(CSP), "and loads nothing from the network");
  ok(/img-src data:/.test(CSP) && !/img-src[^;]*https/.test(CSP),
     "images must be inline");

  const page = buildPage(validateDashboard(PROPOSAL).spec);
  ok(page.includes("Content-Security-Policy"), "the policy travels in the document");
  ok(page.includes("window.dashboard"), "the runtime is inlined -- the frame loads no second file");
  ok(/Produced by a language model/.test(page),
     "D-S: the artifact says it is model-produced, not only the transcript");
  ok(/dash-prov/.test(page), "and carries the provenance marking the page cannot opt out of");
}

/* ═══════════════════════ Phase 2: the interface runs ════════════════════ */

section("Phase 2: the interface runs the panels, under its own token");
{
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, accept: init.headers.Accept,
                auth: init.headers.Authorization, body: init.body });
    // Answers in the columns the query actually selects.  A stub that
    // replied `?a ?b\' to everything passed for a long time and should not
    // have: a document whose columns are not the query\'s is now a failed
    // run (`resultFault\'), which is the whole point of the check.
    const cols = (init.body.match(/SELECT\s+([^W]*?)\s*WHERE/i)[1].match(/\?\w+/g) || [])
      .join("\t");
    return { ok: true, status: 200,
             headers: { get: () => "text/tab-separated-values" },
             text: async () => `${cols}\n1\tx\n2\ty\n` };
  };
  const spec = validateDashboard(PROPOSAL).spec;
  const results = await runPanels({
    host: "https://h", account: "acct", repository: "repo", token: "tok",
    panels: spec.panels, fetchImpl,
  });
  ok(Object.keys(results).length === 2, "every panel is run");
  ok(seen.every((s) => s.auth === "Bearer tok"),
     "under the user's own token -- the model executed nothing");
  ok(seen.every((s) => s.method === "POST" && /\/sparql$/.test(s.url)),
     "directly, when the catalogue route was not chosen");
  ok(results.sales.digest && results.sales.rows === 2,
     "and each result is digested as it lands, which is what makes staleness detectable");

  const t = totals(results);
  ok(t.panels === 2 && t.ok === 2 && t.rows === 4, "totals are what the meter reads");

  const payload = payloadsFor(spec, results);
  ok(Object.keys(payload).length === 2, "panels the page uses are posted into it");
  ok(payload.sales.text.includes("?r") && payload.sales.text.includes("?v"),
     "with the document the interface fetched, in the columns the panel asked for");

  const unused = payloadsFor({ panels: [{ name: "sales" }], html: "<p>nothing</p>", transforms: [] },
                             results);
  ok(Object.keys(unused).length === 0,
     "and a panel the page never binds is not posted in at all");
}

section("Phase 2: the catalogue route writes views named for the run");
{
  const wrote = [];
  const fetchImpl = async (url, init) => {
    wrote.push({ url, method: init.method });
    return { ok: true, status: 204, headers: { get: () => "application/n-quads" },
             text: async () => "" };
  };
  const spec = validateDashboard(PROPOSAL).spec;
  const run = "260101abcd12";
  const put = await putPanelSet({ host: "https://h", account: "acct", repository: "repo",
                                  token: "tok", panels: spec.panels, run, fetchImpl });
  ok(put.ok && put.written.length === 2, "one view per panel");
  ok(wrote.every((w) => w.method === "PUT" && /\/views\/tmp-260101abcd12-/.test(w.url)),
     "each named for the run, so a sweep can find this run's and leave another's");
  ok(tempName(run, "sales") === "tmp-260101abcd12-sales", "the name is predictable");

  const refused = await sweep({ host: "https://h", account: "acct", repository: "repo",
                                token: "tok", names: ["an-important-view"], fetchImpl });
  ok(!refused.ok && /not a temporary name/.test(refused.swept[0].error),
     "and the sweep refuses to delete anything it did not write");
  ok(isTempName("tmp-260101abcd12-sales") && !isTempName("sales"), "which it tells apart by name");
  ok(authHeader("tok") === "Bearer tok" && authHeader("Bearer tok") === "Bearer tok",
     "a token is bearer-prefixed once, however the caller holds it");
}

/* ═══════════════════ the adapter under a grant (U-18, U-19) ═════════════ */

section("the adapter relays under the grant, and serves full documents itself");
{
  const big = ["?s\t?o"].concat(Array.from({ length: 400 }, (_, i) => `s${i}\t${i}`)).join("\n");
  const jsonResponse = (obj) => ({ status: 200, ok: true, text: async () => JSON.stringify(obj) });
  const script = [
    // tools/list
    () => jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [
      { name: "survey", description: "Survey the repository.", inputSchema: { type: "object" } },
      { name: "query", description: "Run one query.", inputSchema: { type: "object" } },
      { name: "sparql_update", description: "DEPRECATED — writes.", inputSchema: { type: "object" } },
    ] } }),
    // the model asks for a big result
    () => jsonResponse({ id: "m1", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "query",
                  input: { mimeType: "application/sparql-query", body: "SELECT * {}" } }],
      usage: { input_tokens: 1, output_tokens: 1 } }),
    // MCP answers with four hundred rows
    () => jsonResponse({ jsonrpc: "2.0", id: 1,
      result: { content: [{ type: "resource", resource: { text: big } }] } }),
    // the model asks for the whole document
    () => jsonResponse({ id: "m2", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t2", name: "result_full", input: { of: "r1" } }],
      usage: { input_tokens: 1, output_tokens: 1 } }),
    // then tries to write
    () => jsonResponse({ id: "m3", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t3", name: "query",
                  input: { mimeType: "application/sparql-update", body: "DELETE WHERE {}" } }],
      usage: { input_tokens: 1, output_tokens: 1 } }),
    // and finishes with a page
    () => jsonResponse({ id: "m4", type: "message", role: "assistant", stop_reason: "end_turn",
      content: [{ type: "text", text: "Done.\n\n```dashboard\n" + JSON.stringify(PROPOSAL) + "\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 } }),
  ];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const next = script.shift();
    if (!next) throw new Error(`unscripted request to ${url}`);
    return next();
  };

  const grant = createGrant({ maxQueries: 8, maxBytes: 10 * 1024 });
  const adapter = createToolAdapter({
    apiKey: "k", model: "claude-opus-5",
    mcp: { endpoint: "https://h/acct/repo/mcp", token: "tok" },
    allowTools: DASHBOARD_TOOLS, grant, digestOver: 1000, primeWith: [],
    fetchImpl,
  });
  const result = await adapter.run("a dashboard of sales");

  const offered = requests[1].body.tools.map((t) => t.name);
  ok(offered.includes("survey") && offered.includes("query"),
     "a dashboard run offers query as well as survey");
  ok(!offered.includes("sparql_update"), "and still not the deprecated write");
  ok(offered.includes(RESULT_FULL),
     "with the local tool, because a digest without a way to ask past it is a cap");

  const digested = result.events.find((e) => e.type === "digest");
  ok(digested && digested.label === "r1" && digested.rows === 400,
     "a large payload is digested and labelled");
  ok(digested.shownBytes < digested.bytes / 4, "the model is shown a fraction of it");

  const full = result.events.find((e) => e.type === "tool_result" && e.local);
  ok(full && full.text === big,
     "and result_full answers with the whole document, from what was relayed");
  ok(!requests.some((r, i) => i > 3 && String(r.url).includes("/mcp")
                              && r.body?.params?.name === "query" && i === 4),
     "without asking the store again, which could answer from data that has moved");

  const refused = result.events.find((e) => e.type === "refused");
  ok(refused && /read-only/.test(refused.reason),
     "the write is refused by the grant, not sent");
  const told = result.events.find((e) => e.type === "tool_result" && e.refused);
  ok(told && /not made/.test(told.text),
     "and the model is told why, so it can adapt rather than retry blindly");

  ok(result.dashboard && result.dashboard.panels.length === 2,
     "the run's product is a dashboard proposal");
  ok(result.grant.spent.queries === 1,
     "one call charged: the refused write never left, and reading a document "
   + "already in hand is not another call against the store");
  ok(result.grant.spent.bytes > big.length,
     "though result_full is charged its bytes -- the budget is about what reaches "
   + "the model, not about what the store did");
  ok(result.payloads.r1 === big, "the full payloads come back with the run, for the record");
}

/* ══════════════════════════ D-S: the record ═════════════════════════════ */

section("D-S: the record answers what the page was drawn from");
{
  const spec = withInputDigests(validateDashboard(PROPOSAL).spec,
                                { sales: { digest: "d1" }, costs: { digest: "d2" } });
  const grant = createGrant({ maxQueries: 3 });
  const rec = dashboardRecord(spec, { sales: { digest: "d1", rows: 10, ok: true } },
                              { grant, prompt: "a dashboard of sales" });
  ok(rec.pageDigest && rec.panels.length === 2, "the record carries the page and its panels");
  ok(rec.transforms[0].body.includes("inputs.sales"),
     "the transform SOURCE, because a derived number is only checkable against it");
  ok(rec.assertions[1].kind === "outside-knowledge",
     "and each assertion's provenance");

  const update = insertData({
    graph: "http://dydra.com/explorations/x/transcript",
    exploration: "http://dydra.com/explorations/x",
    repository: "acct/repo",
    run: { id: "r-1", prompt: "p", started: new Date(), ended: new Date(), ok: true },
    exchanges: [],
    dashboard: { ...rec, disposition: "promoted", via: "catalog" },
  });
  ok(/mcp:Dashboard/.test(update) && /mcp:Panel/.test(update)
     && /mcp:Transform/.test(update) && /mcp:Assertion/.test(update),
     "all four go into <account>/mcp as RDF");
  ok(/mcp:resultDigest "d1"/.test(update), "with the digest of what each panel returned");
  ok(/mcp:inputDigest "sales=d1"/.test(update),
     "and what each sentence was written against, which is what makes D-T checkable later");
  ok(/mcp:disposition "promoted"/.test(update), "and what the user did with it");
}

section("U-24: a dashboard can be read back out of the record and reopened");
{
  const M = "http://dydra.com/ns/mcp#";
  const D = "http://dydra.com/explorations/x/transcript#r-1-dashboard";
  const bind = (rows) => ({
    head: { vars: Object.keys(rows[0] || {}) },
    results: { bindings: rows.map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, { type: "literal", value: String(v) }]))) },
  });
  const HEAD = [
    { p: M + "title", o: "Sales" },
    { p: M + "page", o: '<div data-bound="sales"></div><p data-asserted="lead"></p>' },
    { p: M + "pageDigest", o: "pd" },
    { p: M + "disposition", o: "promoted" },
    { p: M + "executedVia", o: "direct" },
  ];
  const PARTS = [
    { s: D + "-p", p: M + "type", o: M + "Panel" },
    { s: D + "-p", p: M + "name", o: "sales" },
    { s: D + "-p", p: M + "query", o: "SELECT ?r ?v WHERE { ?s :r ?r ; :v ?v }" },
    { s: D + "-p", p: M + "accept", o: "text/tab-separated-values" },
    { s: D + "-p", p: M + "resultDigest", o: "was-this" },
    { s: D + "-a", p: M + "type", o: M + "Assertion" },
    { s: D + "-a", p: M + "name", o: "lead" },
    { s: D + "-a", p: M + "provenance", o: "derived-from-results" },
    { s: D + "-a", p: M + "content", o: "The north leads." },
    { s: D + "-a", p: M + "input", o: "sales" },
    { s: D + "-a", p: M + "inputDigest", o: "sales=was-this" },
  ];
  const fetchImpl = async (url, init) => {
    const q = String(init.body || "");
    const rows = /a mcp:Dashboard/.test(q)
      ? bind([{ dashboard: D, title: "Sales", recorded: "2026-10-17T10:00:00Z",
                repository: "acct/repo", disposition: "promoted", pageDigest: "pd" }])
      : /\?dp \?s/.test(q) ? bind(PARTS) : bind(HEAD);
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };

  const listed = await listDashboards({ host: "https://h", account: "acct", token: "t", fetchImpl });
  ok(listed.ok && listed.dashboards[0].title === "Sales",
     "the dashboards an account has made are listed from <account>/mcp");

  const stored = await readDashboard({ host: "https://h", account: "acct", token: "t",
                                       uri: D, fetchImpl });
  ok(stored.ok && stored.complete, "and one can be read back whole");
  ok(stored.spec.html.includes("data-bound"), "the page is kept, not only its digest");
  ok(stored.spec.panels[0].query.startsWith("SELECT"),
     "with the query behind each panel, so reopening RUNS rather than replays");
  ok(stored.spec.assertions[0].inputDigests.sales === "was-this",
     "and the digest each sentence was written against");

  const stale = staleAssertions(stored.spec, { sales: { digest: "is-now-this" } });
  ok(stale.length === 1 && stale[0].id === "lead",
     "so a page reopened after the data moved marks its own prose on the way up");
}

section("the prompt states the contract the parser enforces");
{
  const grant = createGrant({ maxQueries: 7, repositories: ["acct/repo"] });
  const text = dashboardSystem("base", { grant, digesting: true });
  ok(/data-bound/.test(text) && /data-derived/.test(text) && /data-asserted/.test(text),
     "the three kinds of region are named");
  ok(/cheapest route/.test(text), "with the order to prefer them in");
  ok(/result_full/.test(text), "the way past a digest is stated");
  ok(/7 tool call/.test(text), "and the grant is described, so a refusal is not a surprise");
  ok(/connect-src|No network/i.test(text),
     "as are the frame's rules, which the model could not otherwise discover");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
