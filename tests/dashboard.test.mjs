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

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const { buildPage, buildSavedPage, savedPolicy, savedOrigins, CSP, SANDBOX } =
  await load("dashboard/frame.js");
const { sharedSource, missingSource } = await load("dashboard/saved-runtime.js");
const { bindParameters } = await load("app/parameters.js");
const { runPanels, payloadsFor, totals } = await load("dashboard/runner.js");
const { putPanelSet, tempName, isTempName, sweep, authHeader } = await load("dashboard/catalog.js");
const { createToolAdapter, DASHBOARD_TOOLS, RESULT_FULL } = await load("llm/tool-adapter.js");
const { insertData } = await load("mcp/transcript-store.js");
const { dashboardSystem } = await load("llm/dashboard-prompt.js");
const { figureAsked, missingFigure } = await load("app/figure-ask.js");
const { listDashboards, readDashboard } = await load("dashboard/archive.js");
const { sourcesFrom, evidenceFrom, mergeEvidence, evidenceSummary,
        evidenceRecord, sourceLine } = await load("llm/evidence.js");

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
  // REQ-23.2.6: the record keeps what the model was SHOWN, not only what it
  // produced.  Without it a reopened page cannot say what its own prose rests
  // on, which is the state every archived dashboard was in.
  const run1 = evidenceFrom([
    { type: "prompt", text: "a dashboard of sales", at: "2026-11-21T09:00:00Z" },
    { type: "digest", id: "c1", label: "r1", rows: 34, form: "table", digest: "d1" },
    { type: "tool_result", id: "c1", name: "query", ok: true, repository: "acct/repo",
      input: { op: "query", query: "SELECT ?region ?total WHERE {}" },
      label: "r1", digest: "d1", text: "x".repeat(9000), at: "2026-11-21T09:00:02Z" },
  ], { turn: 1 });
  const rec = dashboardRecord(spec, { sales: { digest: "d1", rows: 10, ok: true } },
                              { grant, prompt: "a dashboard of sales", evidence: [run1] });
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

  ok(/mcp:Source/.test(update) && /mcp:sourceKind "result"/.test(update),
     "and the ledger goes in as STATEMENTS, not as one JSON literal — `which pages "
   + "were built from acct/repo' is a question a provenance record exists to answer, "
   + "and a blob answers none of them");
  ok(/mcp:turn "1"\^\^/.test(update),
     "each source carrying the turn that read it, which is what regroups them: a turn "
   + "node holding sources would be two levels out from the dashboard and would read "
   + "back empty");
  ok(/mcp:repository "acct\/repo"/.test(update) && /mcp:rows "34"\^\^/.test(update)
     && /mcp:resultDigest "d1"/.test(update),
     "with the repository, the shape and the digest the interface already had on the event");
  ok(/SELECT \?region \?total/.test(update),
     "and the query as it was SENT — the one piece of evidence that outlives the run");
  ok(/mcp:sourceKind "request"/.test(update),
     "the prompt is a source too: it was sent to the model like everything else");
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
    // Two turns, out of order and with their sources shuffled, because the
    // store keeps neither: the reader has to put both back.
    { s: D + "-s2", p: M + "type", o: M + "Source" },
    { s: D + "-s2", p: M + "turn", o: "1" },
    { s: D + "-s2", p: M + "sourceKind", o: "result" },
    { s: D + "-s2", p: M + "name", o: "r1" },
    { s: D + "-s2", p: M + "repository", o: "acct/repo" },
    { s: D + "-s2", p: M + "query", o: "SELECT ?r ?v WHERE { ?s :r ?r ; :v ?v }" },
    { s: D + "-s2", p: M + "rows", o: "34" },
    { s: D + "-s2", p: M + "resultDigest", o: "was-this" },
    { s: D + "-s2", p: M + "ok", o: "true" },
    { s: D + "-s2", p: M + "recorded", o: "2026-10-17T09:00:02Z" },
    { s: D + "-s1", p: M + "type", o: M + "Source" },
    { s: D + "-s1", p: M + "turn", o: "1" },
    { s: D + "-s1", p: M + "sourceKind", o: "request" },
    { s: D + "-s1", p: M + "name", o: "the request" },
    { s: D + "-s1", p: M + "content", o: "a dashboard of sales" },
    { s: D + "-s1", p: M + "ok", o: "true" },
    { s: D + "-s1", p: M + "recorded", o: "2026-10-17T09:00:00Z" },
    { s: D + "-s4", p: M + "type", o: M + "Source" },
    { s: D + "-s4", p: M + "turn", o: "2" },
    { s: D + "-s4", p: M + "sourceKind", o: "result" },
    { s: D + "-s4", p: M + "name", o: "r3" },
    { s: D + "-s4", p: M + "repository", o: "acct/other" },
    { s: D + "-s4", p: M + "rows", o: "2" },
    { s: D + "-s4", p: M + "ok", o: "true" },
    { s: D + "-s4", p: M + "recorded", o: "2026-10-17T09:05:03Z" },
    { s: D + "-s3", p: M + "type", o: M + "Source" },
    { s: D + "-s3", p: M + "turn", o: "2" },
    { s: D + "-s3", p: M + "sourceKind", o: "result" },
    { s: D + "-s3", p: M + "name", o: "r2" },
    { s: D + "-s3", p: M + "repository", o: "acct/down" },
    { s: D + "-s3", p: M + "ok", o: "false" },
    { s: D + "-s3", p: M + "error", o: "the store refused" },
    { s: D + "-s3", p: M + "recorded", o: "2026-10-17T09:05:01Z" },
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

  /*
   * REQ-23.2.6, the half that makes an archived page as truthful as a fresh
   * one.  Until the ledger was recorded, a dashboard read back out of the
   * store could only say it held no record of what the model was shown --
   * correct, and useless.  It now comes back as the turns it was built in.
   */
  ok(stored.evidence.length === 2,
     "the ledger comes back as the turns it was built in, not as one flat list");
  ok(stored.evidence[0].turn === 1 && stored.evidence[1].turn === 2,
     "in the order they happened");
  ok(stored.evidence[0].sources.map((x) => x.label).join(",") === "the request,r1",
     "each turn's sources in the order they were READ -- the store keeps none, and "
   + "`r1, then r2' means nothing without it");
  ok(stored.evidence[0].ask === "a dashboard of sales",
     "with the prompt that opened the turn, read back off its request source");
  ok(stored.evidence[0].repositories.join(",") === "acct/repo"
     && stored.evidence[1].repositories.join(",") === "acct/other",
     "and the repositories each turn actually read from");
  ok(stored.evidence[0].sources[1].rows === 34
     && typeof stored.evidence[0].sources[1].rows === "number",
     "numbers come back as numbers: the store answers in strings and a row count "
   + "that is a string reads as `34 rows' by luck and sorts by accident");
  ok(stored.evidence[1].sources[0].ok === false
     && /refused/.test(stored.evidence[1].sources[0].error),
     "a call that failed is kept, and kept marked");
  const summary = evidenceSummary(stored.evidence);
  ok(summary.known === true && summary.repositories.join(",") === "acct/repo,acct/other",
     "so a reopened page is marked from the same record a fresh one is");
  ok(!summary.repositories.includes("acct/down"),
     "and the store that refused is still not named as a source of its data");
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

section("a page composed over more than one store");
{
  const one = dashboardSystem("base", { grant: createGrant({ repositories: ["a/b"] }),
                                        stores: ["a/b"] });
  ok(!/may read more than one repository/.test(one),
     "with one store the prompt says nothing about choosing one — the choice does not exist");

  const two = dashboardSystem("base", { grant: createGrant({ repositories: ["a/b", "a/c"] }),
                                        stores: ["a/b", "a/c"] });
  ok(/may read more than one repository/.test(two), "with two it says so");
  ok(/a\/b, a\/c/.test(two), "naming both");
  ok(/"source"/.test(two) && /"repository": "c"/.test(two),
     "and shows the field that sends one panel to the other store");
  ok(/reads `a\/b` unless it says otherwise/.test(two),
     "stating which store a panel with no source reads");
  ok(/cannot span two repositories/.test(two),
     "a single query is not offered as a way to cross the boundary — they are separate endpoints");
  ok(/TRANSFORM/.test(two),
     "the transform is named as the place the two results are put together");
  ok(/2 stores/.test(two), "and the count is stated");
}

/*
 * REQ-34.3.12.  A prompt asking for tables AND bar graphs came back with
 * tables, and nothing on either side said half the question had been dropped.
 * The remedy is in two places and both are asserted: the contract, which says
 * the fallback table is not an answer to a request for a chart, and the
 * interface, which notices when the two do not match.
 */
section("a figure the request named is not optional");
{
  const text = dashboardSystem("base", { grant: createGrant({ repositories: ["a/b"] }),
                                         request: "sales by region as a bar chart" });
  ok(/not optional/i.test(text), "the contract says so in as many words");
  ok(/fallback/i.test(text) && /is NOT an/.test(text),
     "and says what the fallback table is not");
  ok(/dashboard\.render/.test(text) && /SVG/.test(text),
     "giving both ways to draw: a component, or the slot taken over");
  ok(/no plotting library/i.test(text) && /no network/i.test(text),
     "and ruling out the third way a model would otherwise reach for");
  ok(/two REGIONS over one\s+panel/.test(text),
     "a table and a chart of one measure is two slots, not two queries");
  ok(/nearest honest\s+thing/.test(text),
     "with what to do when the result cannot carry the figure");
  ok(/A figure is bound where it can be/.test(text),
     "and a figure chooses its kind the way every other region does");
  ok(/photograph/.test(text) && /cannot refresh/.test(text),
     "an SVG with the values written into it is an assertion, and says why that costs something");
  ok(/notice later that\s+those results moved/.test(text),
     "`inputs' is asked for because it makes staleness detectable — not to attribute anything");
  // REQ-23.2.6.  The model used to be told how a figure would be marked and
  // what to declare so that the mark would read correctly.  It is not told
  // now, because the interface sent the data and does not have to ask.
  ok(/Do not write a note about where a figure or a passage came from/.test(text),
     "the model is told NOT to attribute its own work");
  ok(/keeps its own record/.test(text) && /marks the\s+page from that/.test(text),
     "and told why: the interface holds the record and marks the page from it");
  ok(!/not from this repository/.test(text) && !/no source declared/.test(text),
     "and no wording of the mark itself is put in front of the model");
  ok(/That is about furniture/.test(text),
     "and the toolbox's own `none of this is required' is qualified where it is given, "
   + "rather than argued against elsewhere");
}

section("the gate notices a figure that was asked for and not drawn");
{
  const page = (extra = {}) => ({ uses: [], views: [{ name: "main", html: "<table></table>" }],
                                  transforms: [], ...extra });

  ok(figureAsked("plot the totals"), "`plot' is a request for a drawing");
  ok(figureAsked("show me a bar graph of walls per storey"), "so is `bar graph'");
  ok(figureAsked("a histogram, please"), "and `histogram'");
  ok(!figureAsked("every triple in the default graph"),
     "`graph' alone is NOT -- in this interface it is an RDF graph far more often "
   + "than it is a picture, and reading it as one would warn on every page");
  ok(!figureAsked("list the rooms with their areas"), "and a request for a list is not");

  ok(missingFigure("a bar chart by storey", page()),
     "a page of tables, where a chart was asked for, is noticed");
  ok(/bar graph|chart/.test(missingFigure("a bar chart by storey", page()) || ""),
     "and the notice quotes the word the request used");
  ok(missingFigure("a bar chart by storey", page({ uses: ["bar-chart"] })) === null,
     "a page that names the component is not");
  ok(missingFigure("a bar chart by storey",
                   page({ views: [{ name: "main", html: "<svg viewBox='0 0 1 1'></svg>" }] })) === null,
     "nor is one that draws its own SVG");
  ok(missingFigure("a bar chart by storey",
                   page({ views: [{ name: "main",
                                    html: "<script>dashboard.render('x', () => {})<\/script>" }] })) === null,
     "nor one that takes the slot over");
  ok(missingFigure("a bar chart by storey",
                   page({ transforms: [{ name: "t", body: "const s = document.createElementNS(NS,'svg');" }] })) === null,
     "nor one whose transform returns a drawing -- the third legitimate way, "
   + "and the one that leaves no trace in the markup");
  ok(missingFigure("list the rooms", page()) === null,
     "and a page of tables for a question that asked for none says nothing at all");
}

/* ═════════════ REQ-23.2.6: the interface keeps its own record ═════════════ */

/**
 * The attribution a page carries is the INTERFACE's, built from what it sent.
 *
 * The defect that ended this argument: a chart drawn from three panels was
 * marked "not from this repository" while the paragraph beneath it, citing
 * the same three panels, said it had come from them.  Both marks were read
 * out of the document -- the first from the ABSENCE of an `inputs'
 * declaration -- and a page cannot be more reliable about where its data came
 * from than the bookkeeping of the thing that wrote it.
 *
 * It never had to be.  Every row the model read left through the adapter, on
 * an event carrying its repository, its query, its shape and its digest.
 * These assertions are that the record is built from those events, that it
 * survives being merged across revisions, and that the three states a reader
 * can be in -- data was read, nothing was read, nothing is known -- are three
 * different sentences rather than one sentence and two guesses.
 */
section("the ledger is built from what the interface sent, not from the answer");
{
  const events = [
    { type: "prompt", text: "sales by region, as a table and a bar chart", at: "2026-11-21T10:00:00Z" },
    { type: "primer", uri: "urn:primer", repository: "ns223", ok: true, chars: 1200,
      at: "2026-11-21T10:00:01Z" },
    // A repository whose SCHEMA was read and whose rows never were.
    { type: "primer", uri: "urn:primer", repository: "nsonly", ok: true, chars: 400,
      at: "2026-11-21T10:00:01Z" },
    { type: "tool_call", name: "query", input: { op: "query", query: "SELECT * {}" } },
    { type: "digest", id: "c1", label: "r1", rows: 34, form: "table", digest: "abc123",
      repository: "ns223" },
    { type: "tool_result", id: "c1", name: "query", ok: true, repository: "ns223",
      input: { op: "query", query: "SELECT ?region ?total WHERE {}" },
      text: "x".repeat(9000), label: "r1", digest: "abc123", at: "2026-11-21T10:00:02Z" },
    { type: "tool_result", id: "c2", name: "query", ok: true, repository: "nsbrick",
      input: { op: "query", query: "SELECT ?a WHERE {}" }, text: "a,b\n1,2",
      at: "2026-11-21T10:00:03Z" },
    { type: "tool_result", id: "c3", name: "query", ok: false, repository: "nsmulti",
      input: { op: "query", query: "SELECT ?b WHERE {}" }, text: "the store refused",
      at: "2026-11-21T10:00:04Z" },
    { type: "tool_result", id: "c4", name: "result_full", ok: true, local: true, label: "r1",
      text: "x".repeat(9000), input: { of: "r1" }, at: "2026-11-21T10:00:05Z" },
    { type: "assistant", text: "```dashboard\n{}\n```" },
  ];
  const src = sourcesFrom(events);
  const kinds = src.map((x) => x.kind);

  ok(kinds.filter((k) => k === "request").length === 1, "the prompt is a source: it was sent too");
  ok(kinds.filter((k) => k === "primer").length === 2, "so is the repository's own documentation");
  ok(src.filter((x) => x.kind === "result").length === 3,
     "three calls reached a store, and the fourth is not counted -- `result_full' is "
   + "a document the model had already been shown, not a second source");
  const r1 = src.find((x) => x.label === "r1" && x.kind === "result");
  ok(r1.repository === "ns223" && r1.rows === 34 && r1.digest === "abc123",
     "and a result carries the repository, the row count and the digest the interface "
   + "already had on the event");
  ok(/SELECT \?region \?total/.test(r1.query),
     "with the query that was actually SENT, not one retyped into prose");
  const bad = src.find((x) => x.repository === "nsmulti");
  ok(bad.ok === false && /refused/.test(bad.error),
     "a call that failed is kept -- what the model was shown when a store would not "
   + "answer is part of what it worked from");

  const turn = evidenceFrom(events, { turn: 1 });
  ok(turn.repositories.join(",") === "ns223,nsbrick",
     "but a store that answered nothing is not somewhere the page's data came from");
  ok(!turn.repositories.includes("nsmulti"), "which is the whole point of naming them at all");

  const summary = evidenceSummary([turn]);
  ok(summary.known === true && summary.results === 2 && summary.attempted === 3,
     "the summary counts what answered and what was tried");
  ok(summary.documented.includes("nsonly") && !summary.repositories.includes("nsonly"),
     "documentation read is kept apart from data read: a page marked `from nsonly' "
   + "because its SCHEMA was read would be saying the wrong thing in the one place "
   + "a reader is relying on it");
  ok(/r1 · ns223 · 34 rows/.test(summary.detail),
     "and the detail names each source the way a person reads it");
  ok(/1 call did not answer/.test(summary.detail),
     "including the one that did not answer, counted rather than dropped");
}

section("the ledger spans the turns, because the page does");
{
  const one = evidenceFrom([
    { type: "prompt", text: "compose", at: "2026-11-21T10:00:00Z" },
    { type: "tool_result", id: "a", name: "query", ok: true, repository: "ns223",
      input: { query: "SELECT * {}" }, text: "x,y", at: "2026-11-21T10:00:01Z" },
  ], { turn: 1 });
  const two = evidenceFrom([
    { type: "prompt", text: "now as a bar chart", at: "2026-11-21T10:05:00Z" },
    { type: "tool_result", id: "b", name: "query", ok: true, repository: "nsbrick",
      input: { query: "SELECT * {}" }, text: "x,y", at: "2026-11-21T10:05:01Z" },
  ], { turn: 2 });

  const ledger = mergeEvidence(mergeEvidence([], one), two);
  ok(ledger.length === 2 && ledger[0].turn === 1 && ledger[1].turn === 2,
     "a revision adds a turn rather than replacing the record of the compose");
  const s2 = evidenceSummary(ledger);
  ok(s2.repositories.join(",") === "ns223,nsbrick",
     "so a figure added by the second turn is attributed to everything the page rests on, "
   + "not to the last request alone");
  ok(/over 2 turns/.test(s2.detail), "and the reader is told it took two");
  ok(mergeEvidence(ledger, evidenceFrom([], { turn: 2 })).length === 2,
     "re-noting a turn replaces it: a retried revision does not count twice");

  // The three states, which used to be two and a guess.
  ok(evidenceSummary([]).known === false,
     "no ledger at all is a state of its own — an archived page reopened");
  ok(/No record of what the model was shown/.test(evidenceSummary([]).detail),
     "and it says it holds no record, rather than saying nothing was read");
  const dry = evidenceSummary([evidenceFrom([{ type: "prompt", text: "hello" }], { turn: 1 })]);
  ok(dry.known === true && dry.results === 0 && /answered from the request/.test(dry.detail),
     "a run that read nothing says THAT, which is the honest form of the sentence "
   + "`not from this repository' was reaching for");

  const rec = evidenceRecord(ledger);
  ok(rec["prov:wasDerivedFrom"].length === 2 && rec["dydra:turns"] === 2,
     "and the same facts come out as data, for a record that is not a sentence");
  ok(sourceLine({ kind: "result", label: "r2", repository: "nsbrick", ok: true, rows: 1208 })
       === "r2 · nsbrick · 1208 rows",
     "one source reads as one line");
}

/* ═════════════════════ the downloaded copy (U-111) ═══════════════════════ */

section("what a saved page carries, and what it must not");
{
  const spec = withInputDigests(validateDashboard(PROPOSAL).spec, { sales: { digest: "first" } });
  const results = { sales: { ok: true, mimeType: "text/tab-separated-values",
                             text: "?region\t?value\nNorth\t120\n", digest: "first", rows: 1 } };
  const source = { host: "https://dydra.com", account: "alice", repository: "sales" };
  const file = buildSavedPage(spec, { results, source, at: "2026-11-21T09:00:00.000Z" });

  ok(file.includes('id="saved-page-data"') && file.includes('id="saved-page-frame"'),
     "it is two documents: the data and the runner outside, the page in a frame of its own");
  const blob = file.split('id="saved-page-data">')[1].split("</script>")[0];
  const held = JSON.parse(blob.replace(/\\u003c/g, "<"));
  ok(held.spec.panels[0].query === PROPOSAL.panels[0].query,
     "the panel's own query travels with it, which is what a refresh runs");
  ok(held.results.sales.text.includes("North"),
     "and so does the data, so the file still draws with no network");
  ok(held.source.account === "alice" && !("token" in held) && !/secret|password/i.test(blob),
     "the ADDRESS travels and no credential does -- the reader supplies that, into the tab");
  ok(!/<\/script>/.test(blob),
     "the page inside the blob cannot close the block that carries it");

  ok(/connect-src https:\/\/dydra\.com/.test(savedPolicy(savedOrigins(spec, source))),
     "the file may reach the host its panels name");
  ok(savedOrigins(spec, { host: "https://dydra.com/some/path" }).join() === "https://dydra.com",
     "as an origin, not as whatever address happened to be recorded");
  ok(savedOrigins({ panels: [{ source: { host: "https://other.example" } }] }, source)
       .join() === "https://dydra.com,https://other.example",
     "and a panel with a source of its own adds that one, since the token goes there too");
  ok(/connect-src 'none'/.test(savedPolicy([])),
     "a page with no recorded address reaches nothing at all");
  ok(/default-src 'none'/.test(savedPolicy(["https://dydra.com"]))
     && /form-action 'none'/.test(savedPolicy(["https://dydra.com"])),
     "everything the page's own policy closes stays closed out here");
  ok(/connect-src 'none'/.test(CSP),
     "and the page's own policy is unchanged: it still cannot open a connection, "
   + "which is what the two documents exist to keep true");
}

section("the library a saved page carries is the library, not a copy of it");
{
  /* The whole point of stringifying rather than copying: a saved page that
     digests differently marks prose stale that is not, and one that binds
     parameters differently runs a query the reader never authorised. */
  const F = new Function(`${sharedSource()}\nreturn { RD, PM, SP, AU, RF };`)();
  const text = "?region\t?value\nNorth\t120\n";
  ok(F.RD.contentDigest(text) === contentDigest(text),
     "the same bytes digest the same in the file as in the pane");
  ok(JSON.stringify(F.RD.digestResult(text, "text/tab-separated-values"))
       === JSON.stringify(digestResult(text, "text/tab-separated-values")),
     "and are read the same way");

  const panel = { name: "p", query: "SELECT ?x WHERE { ?x :in ?region }", parameters: ["region"] };
  const declared = [{ name: "region", kind: "literal", domain: { values: ["North"] } }];
  ok(F.PM.bindParameters(panel, { region: "North" }, { parameters: declared }).query
       === bindParameters(panel, { region: "North" }, { parameters: declared }).query,
     "a parameter is encoded by the one encoder D-X promises there is");
  ok(F.PM.bindParameters(panel, { region: "Elsewhere" }, { parameters: declared }).ok === false,
     "and a value outside the declared domain is refused in the file as well");

  const doc = { assertions: [{ id: "lead", inputs: ["p"], inputDigests: { p: "aaa" } }] };
  ok(JSON.stringify(F.SP.staleAssertions(doc, { p: { digest: "bbb" } }))
       === JSON.stringify(staleAssertions(doc, { p: { digest: "bbb" } })),
     "and a passage goes stale in the saved copy exactly when it would in the pane");

  ok(F.AU.authHeader("abc") === "Bearer abc" && F.AU.authHeader("Bearer x") === "Bearer x",
     "a pasted token is read the same way too");
  const boolean = JSON.stringify({ head: {}, boolean: false });
  ok(/EMPTY result set/.test(String(F.RF.resultFault(
       "SELECT ?a WHERE { ?a :b ?c }",
       F.RD.digestResult(boolean, "application/sparql-results+json")))),
     "and the check that stops an empty result being drawn as a table travels with it");
}

section("a half-deployed tree loses the refresh, and nothing else");
{
  /* What this guards is not hypothetical: /ui/ is served with no cache
     lifetime, the first deploy of U-111 came up with a cached `grant.js'
     beside the new `saved-runtime.js', and a NAMED import of an export the
     cached copy did not have took the whole application down -- a link
     error, before a line of it ran, over a feature nobody had used yet. */
  ok(missingSource().length === 0,
     "this tree has every bundle, so it builds the copy that can ask again");

  /* A second copy of the tree with yesterday's `grant.js' in it. */
  const old = mkdtempSync(join(tmpdir(), "jsui-stale-"));
  cpSync(join(root, "lib"), join(old, "lib"), { recursive: true });
  writeFileSync(join(old, "package.json"), JSON.stringify({ type: "module" }));
  const grantPath = join(old, "lib/llm/grant.js");
  writeFileSync(grantPath,
    readFileSync(grantPath, "utf8").replace(/export const QUERY_FORM_SOURCE[^;]*;/, ""));
  const stale = await import(pathToFileURL(join(old, "lib/dashboard/frame.js")).href);

  ok(typeof stale.buildPage === "function",
     "`frame.js' LOADS against the older module -- which is the thing that failed on the "
   + "deploy, and failed before a line of the application ran");
  ok(stale.savedPageIsRefreshable() === false,
     "it simply knows it cannot build a refreshable copy");
  const spec = withInputDigests(validateDashboard(PROPOSAL).spec, { sales: { digest: "d" } });
  const results = { sales: { ok: true, mimeType: "text/tab-separated-values",
                             text: "?region\t?value\nNorth\t120\n", digest: "d", rows: 1 } };
  const source = { host: "https://dydra.com", account: "alice", repository: "sales" };
  const degraded = stale.buildSavedPage(spec, { results, source });
  ok(!degraded.includes('id="saved-page-data"') && /dash-data/.test(degraded),
     "so a download still happens -- as the copy that replays, which is what the reader "
   + "had yesterday, rather than as a failure");
  ok(/North/.test(degraded), "with its data, so it still draws");
  ok(buildSavedPage(spec, { results, source }).includes('id="saved-page-data"'),
     "while a tree with everything in it builds the copy that can ask again");
  ok(/dydra-saved: no refresh: a refreshable copy needs a newer grant\.js/.test(degraded),
     "and the copy that replays says, in itself, which module it went without -- a download "
   + "with no Refresh looks exactly like a finished one, so the reason has to travel");
  ok(stale.savedPageTrouble(degraded)?.startsWith("a refreshable copy needs a newer grant.js"),
     "which is the line the pane reads back out of the document it just built");
  ok(stale.savedPageTrouble(buildSavedPage(spec, { results, source })) === null,
     "and the full copy says nothing of the sort");

  /* The deploy race, as it actually happens: the module is stale in the
     CACHE and current on the SERVER.  Here the file stands in for the
     server -- restoring it is the deploy landing -- and the second,
     cache-defeating read is what the page does about it. */
  const { repairMissingSource } = await import(
    pathToFileURL(join(old, "lib/dashboard/saved-runtime.js")).href);
  writeFileSync(grantPath, readFileSync(join(root, "lib/llm/grant.js"), "utf8"));
  const got = await repairMissingSource();
  ok(got.includes("grant.js"),
     "a second read of the same module under a URL the cache has never seen gets the export "
   + "the first read did not have");
  ok(stale.savedPageIsRefreshable() === true,
     "so the tree can build the refreshable copy after all, with no reload");
  const repaired = stale.buildSavedPage(spec, { results, source });
  ok(repaired.includes('id="saved-page-data"') && /QUERY_FORM/.test(repaired) === false,
     "and the next download is the one with the Refresh in it");
  ok(/function stripComments/.test(repaired),
     "carrying the recovered module's own source, not a copy of it");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
