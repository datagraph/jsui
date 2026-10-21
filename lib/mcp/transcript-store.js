/**
 * The transcript record: what the model was told, and what it was shown.
 *
 * The server already records an exploration -- which operations ran, in what
 * order, under which parent, how many rows each returned (`exploration-quads',
 * orchestrator/persistence.lisp).  That is a record of the *shape* of a run.
 * It is not a record of its content: the payload the model actually read, the
 * schema or the instance data that led it to the query it proposed, the prose
 * it wrote around them, and the prompt that started it all leave no trace.
 * Read back a week later, the exploration says that `survey op=catalog'
 * returned 18 rows, and nothing about which 18.
 *
 * Why the browser writes it.
 *
 * Only the browser sees both halves.  The service sees the MCP calls and
 * nothing of the model: not the prompt, not the system primer, not a turn of
 * prose, not the provider or the model name.  The provider sees the
 * conversation and nothing of the store.  The adapter sits between them and is
 * the only place the whole exchange exists, so it is the only place that can
 * record it.
 *
 * Why a separate graph.
 *
 * `persist-exploration' writes by deleting the exploration's graph and posting
 * it again whole, every time an operation completes.  A triple added to that
 * graph from here survives exactly until the next survey call.  So the
 * transcript occupies its own graph, named after the exploration it belongs to
 * and pointing at it:
 *
 *   <…/explorations/ID>            the server's, rewritten per operation
 *   <…/explorations/ID/transcript> this one, appended to per run
 *
 * The two are read together and neither writer can tread on the other.
 *
 * The vocabulary continues the server's:
 *
 *   <g>     a mcp:Transcript ; mcp:exploration <…/ID> ; mcp:repository "a/r" ;
 *           mcp:recorded "…"^^xsd:dateTime ; mcp:provider "anthropic" ;
 *           mcp:model "…" ; mcp:run "r-…"
 *   <g#r-N> a mcp:Run ; mcp:prompt "…" ; mcp:started/mcp:ended "…" ;
 *           mcp:iterations N ; mcp:ok true ; mcp:error "…"
 *   <g#x-N> a mcp:Exchange ; mcp:run <g#r-N> ; mcp:ordinal N ; mcp:kind "…" ;
 *           mcp:at "…" ; mcp:ms N ; mcp:direction "received"|"sent" ;
 *           mcp:tool "survey" ; mcp:op "catalog" ; mcp:arguments "…" ;
 *           mcp:content "…"  ← the payload itself, the point of the exercise
 *           mcp:bytes N ; mcp:rows N ; mcp:truncated true ; mcp:node <…/ID#n2>
 */

import { MCP_NS, sessionRepository, sparqlQuery } from "./session-log.js";

export const XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * How much of one payload is kept.
 *
 * The record is worth having because it holds the data, so the default is
 * generous: a catalogue of a large repository, a materialised result set, a
 * schema survey all fit comfortably.  Beyond it the literal is cut and marked
 * `mcp:truncated', because a transcript that fails to write is worth less than
 * one that is honest about what it dropped.
 */
export const MAX_CONTENT = 200000;

/** The graph a transcript occupies, beside the exploration it describes. */
export function transcriptGraph(explorationUri) {
  return `${String(explorationUri || "").replace(/\/+$/, "")}/transcript`;
}

/** The exploration's own graph, from the handle a survey reply carried. */
export function explorationUri(session, base = "http://dydra.com/explorations") {
  return `${base}/${String(session || "")}`;
}

/* ── writing terms ───────────────────────────────────────────────────────── */

/**
 * One SPARQL literal.
 *
 * Payloads are arbitrary text from a store and a model: quotes, backslashes and
 * newlines all occur, and a transcript that corrupts the update it is written
 * with would lose the run it was recording.  Control characters are escaped
 * rather than dropped -- they are rare, but a payload is evidence.
 */
export function literal(value) {
  const s = String(value ?? "");
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, "0").toUpperCase()}`;
    else out += ch;
  }
  return `"${out}"`;
}

/** An IRI, refused rather than escaped: a broken one is a bug, not input. */
export function iri(value) {
  const s = String(value ?? "");
  if (!s || /[\s<>"{}|\\^`]/.test(s)) throw new Error(`not an IRI: ${s}`);
  return `<${s}>`;
}

const integer = (n) => `"${Math.trunc(Number(n))}"^^<${XSD}integer>`;
const boolean = (b) => `"${b ? "true" : "false"}"^^<${XSD}boolean>`;
const dateTime = (d) => `"${(d instanceof Date ? d : new Date(d)).toISOString()}"^^<${XSD}dateTime>`;

/** Keep a payload whole where it fits, and say so where it does not. */
export function clipContent(text, max = MAX_CONTENT) {
  const s = typeof text === "string" ? text : (text == null ? "" : JSON.stringify(text, null, 2));
  if (s.length <= max) return { text: s, bytes: s.length, truncated: false };
  return { text: s.slice(0, max), bytes: s.length, truncated: true };
}

/* ── the events, as a record ─────────────────────────────────────────────── */

const ROWS = /\b(?:resultCount|rows|count)\s*[:=]\s*(\d+)/i;

/**
 * Turn one run's events into exchanges.
 *
 * Every event that carried content becomes one exchange with that content
 * attached: the prompt, each document of the primer, each turn of prose, each
 * tool call's arguments and -- the reason the record exists -- each tool
 * result's payload, whole.  `direction' says which way it moved, so the record
 * can be read as a conversation without reconstructing it from the kinds.
 */
export function exchangesFrom(events, { max = MAX_CONTENT } = {}) {
  const out = [];
  let ordinal = 0;
  const push = (e) => { out.push({ ordinal: ++ordinal, ...e }); };

  for (const e of events || []) {
    switch (e.type) {
      case "prompt":
        push({ kind: "prompt", direction: "sent", at: e.at, content: e.text,
               model: e.model, provider: e.provider });
        break;
      case "tools":
        push({ kind: "tools", direction: "received", at: e.at, ms: e.ms, ok: e.ok,
               content: `offered: ${(e.names || []).join(", ") || "(none)"}\n`
                      + `withheld: ${(e.withheld || []).join(", ") || "(none)"}`,
               error: e.error });
        break;
      case "primer":
        // The primer is schema in the broad sense: the notation and the
        // operations the model was handed before it saw any data.
        push({ kind: "primer", direction: "received", at: e.at, ms: e.ms, ok: e.ok,
               document: e.uri, content: e.text ?? null, bytes: e.chars, error: e.error });
        break;
      case "assistant":
        push({ kind: "assistant", direction: "received", at: e.at, ms: e.ms, ok: true,
               content: e.text, stopReason: e.stopReason,
               tokensIn: e.usage?.input_tokens, tokensOut: e.usage?.output_tokens,
               iteration: e.iteration });
        break;
      case "tool_call":
        push({ kind: "tool_call", direction: "sent", at: e.at, tool: e.name,
               op: e.input?.op || null, arguments: e.input ? JSON.stringify(e.input) : null,
               iteration: e.iteration });
        break;
      case "tool_result": {
        const m = ROWS.exec(String(e.text || ""));
        push({ kind: "tool_result", direction: "received", at: e.at, ms: e.ms, ok: e.ok,
               tool: e.name, op: e.input?.op || null, httpStatus: e.status,
               arguments: e.input ? JSON.stringify(e.input) : null,
               content: e.text, rows: m ? Number(m[1]) : null, iteration: e.iteration });
        break;
      }
      case "refused":
        // A call the grant stopped is part of the record, not an absence in
        // it: "the model did not ask" and "the model asked and was refused"
        // are different runs, and only one of them says the ceiling was too
        // low.  Written with the grant's state at the moment of refusal.
        push({ kind: "refused", direction: "sent", at: e.at, ok: false,
               tool: e.name, arguments: e.input ? JSON.stringify(e.input) : null,
               error: e.reason, iteration: e.iteration,
               content: e.grant ? JSON.stringify(e.grant) : null });
        break;
      case "digest":
        // What the model was SHOWN of a payload, beside the payload itself.
        // Without this the record holds the whole document and implies the
        // model read it, which is the one thing a digest means it did not do.
        push({ kind: "digest", direction: "received", at: e.at, ok: true,
               document: e.label, rows: e.rows, bytes: e.bytes,
               iteration: e.iteration,
               content: `${e.label}: ${e.form}, ${e.rows} rows, ${e.bytes} bytes, `
                      + `digest ${e.digest}; ${e.shownBytes} bytes shown` });
        break;
      case "execute":
        // Phase 2: the run the INTERFACE made, between the model's proposal
        // and the model's drawing (D-I).  It is the only exchange in a figure
        // run that touched the store under the user's own token, and without
        // it the record reads as though the model fetched its own data --
        // which is the one thing the design exists to prevent.
        push({ kind: "execute", direction: "received", at: e.at, ms: e.ms, ok: e.ok,
               tool: e.via === "catalog" ? "view" : "sparql", op: e.name || null,
               document: e.view || null, httpStatus: e.status,
               arguments: e.query ? JSON.stringify({ accept: e.accept, via: e.via }) : null,
               content: e.text ?? null, rows: e.rows ?? null, error: e.error || null });
        break;
      case "figure":
        // D-N: the figure is kept WITH the result it was drawn from, and the
        // digest is what joins them.  Content is the figure itself, because a
        // record of a picture that does not hold the picture answers nothing.
        push({ kind: "figure", direction: "received", at: e.at, ok: e.ok !== false,
               document: e.kind || "svg", content: e.text ?? null,
               arguments: e.caption ? JSON.stringify({ caption: e.caption }) : null,
               error: e.error || null, iteration: e.iteration });
        break;
      case "error":
        push({ kind: "error", direction: "received", at: e.at, ms: e.ms, ok: false,
               where: e.where, error: e.error, content: e.response ?? null,
               httpStatus: e.status });
        break;
      default:
        break;   // session and done are the run's own fields, below
    }
  }
  return out.map((x) => {
    if (x.content == null) return x;
    const c = clipContent(x.content, max);
    return { ...x, content: c.text, bytes: x.bytes ?? c.bytes, truncated: c.truncated };
  });
}

/**
 * The whole record of one run, as SPARQL INSERT DATA.
 *
 * One update, written once the run is over: a run that failed half way still
 * records everything up to the failure, and nothing has to be reconciled
 * against a half-written record if the browser goes away mid-run.
 */
const frag = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

/**
 * The dashboard, as the record keeps it (D-S).
 *
 * The page alone cannot answer "what was this drawn from".  It answers it for
 * bound regions, which name a view, and not at all for the other two kinds --
 * a transform is a function the page ran, an assertion is a sentence someone
 * wrote.  So the record carries the queries, the transform sources, the
 * assertions, the digest of every result each was made from, and the digest of
 * the page itself, so that an artifact found later can be matched to the run
 * that produced it.
 */
function dashboardLines(graph, runUri, run, dash, t) {
  const D = iri(`${graph}#${run.id}-dashboard`);
  t(D, "type", "mcp:Dashboard");
  t(D, "run", iri(runUri));
  if (dash.title) t(D, "title", literal(dash.title));
  if (dash.pageDigest) t(D, "pageDigest", literal(dash.pageDigest));
  if (dash.html) t(D, "page", literal(clipContent(dash.html).text));
  if (dash.grant) t(D, "grant", literal(JSON.stringify(dash.grant)));
  if (dash.disposition) t(D, "disposition", literal(dash.disposition));
  if (dash.via) t(D, "executedVia", literal(dash.via));

  // Identity and history (U-28).  `mcp:application' is the document id, which
  // is stable across revisions and is what the archive groups by; the
  // revision number orders them and `mcp:revisionOf' names the one this was
  // made from.  All three are optional: a record written before the document
  // existed has none of them and still reads back as a one-revision page.
  if (dash.id) t(D, "application", literal(dash.id));
  if (dash.revision != null) t(D, "revision", integer(dash.revision));
  if (dash.revisionOf) t(D, "revisionOf", literal(dash.revisionOf));
  if (dash.toolbox) t(D, "toolbox", literal(dash.toolbox));
  for (const u of dash.uses || []) t(D, "uses", literal(u));
  if (dash.styles) t(D, "styles", literal(clipContent(dash.styles).text));
  if (dash.script) t(D, "script", literal(clipContent(dash.script).text));
  if (dash.state) t(D, "state", literal(JSON.stringify(dash.state)));
  // The patch that produced this revision, kept whole rather than unpicked
  // into statements: it is a list of operations read back as a list of
  // operations, and nothing queries inside it.
  if (dash.patches) t(D, "patch", literal(JSON.stringify(dash.patches)));
  // One literal rather than statements: nothing queries inside a meter
  // reading, and the shape is the budget's own.
  if (dash.interaction) t(D, "interaction", literal(JSON.stringify(dash.interaction)));

  for (const v of dash.views || []) {
    const V = iri(`${graph}#${run.id}-view-${frag(v.name)}`);
    t(D, "view", V);
    t(V, "type", "mcp:View");
    t(V, "name", literal(v.name));
    if (v.title) t(V, "title", literal(v.title));
    if (v.html) t(V, "page", literal(clipContent(v.html).text));
  }
  for (const x of dash.parameters || []) {
    const X = iri(`${graph}#${run.id}-parameter-${frag(x.name)}`);
    t(D, "parameter", X);
    t(X, "type", "mcp:Parameter");
    t(X, "name", literal(x.name));
    if (x.kind) t(X, "kind", literal(x.kind));
    if (x.datatype) t(X, "datatype", literal(x.datatype));
    if (x.label) t(X, "label", literal(x.label));
    if (x.domain) t(X, "domain", literal(JSON.stringify(x.domain)));
    if (x.default != null) t(X, "default", literal(String(x.default)));
  }

  for (const p of dash.panels || []) {
    const P = iri(`${graph}#${run.id}-panel-${frag(p.name)}`);
    t(D, "panel", P);
    t(P, "type", "mcp:Panel");
    t(P, "name", literal(p.name));
    if (p.query) t(P, "query", literal(clipContent(p.query).text));
    if (p.accept) t(P, "accept", literal(p.accept));
    for (const x of p.parameters || []) t(P, "parameter", literal(x));
    if (p.view) t(P, "view", literal(p.view));
    if (p.digest) t(P, "resultDigest", literal(p.digest));
    if (p.rows != null) t(P, "rows", integer(p.rows));
    if (p.ok != null) t(P, "ok", boolean(p.ok));
  }
  for (const x of dash.transforms || []) {
    const T = iri(`${graph}#${run.id}-transform-${frag(x.name)}`);
    t(D, "transform", T);
    t(T, "type", "mcp:Transform");
    t(T, "name", literal(x.name));
    for (const i of x.inputs || []) t(T, "input", literal(i));
    if (x.body) t(T, "body", literal(clipContent(x.body).text));
  }
  for (const a of dash.assertions || []) {
    const A = iri(`${graph}#${run.id}-assertion-${frag(a.id)}`);
    t(D, "assertion", A);
    t(A, "type", "mcp:Assertion");
    t(A, "name", literal(a.id));
    t(A, "provenance", literal(a.kind || "asserted"));
    if (a.text) t(A, "content", literal(clipContent(a.text).text));
    for (const i of a.inputs || []) t(A, "input", literal(i));
    for (const [k, v] of Object.entries(a.inputDigests || {})) {
      if (v) t(A, "inputDigest", literal(`${k}=${v}`));
    }
  }
}

/**
 * The figure, as the record keeps it (D-N, work item U-16).
 *
 * The same shape of answer as `dashboardLines', one step smaller: what was
 * asked, what ran, what came back, what was drawn, and what the user then did
 * with it.  Two fields carry the weight.
 *
 * `mcp:resultDigest' is the join between the picture and the data.  A figure
 * found a month later can be matched against a re-run of the same query: a
 * different digest says, as a fact rather than a suspicion, that the picture
 * is of data that has since moved.
 *
 * `mcp:disposition' is what the user chose at Gate 2 -- mounted, downloaded or
 * discarded.  A discarded figure is still recorded, and deliberately so: "the
 * model drew this and the user threw it away" is the single most useful line
 * in the record when someone later asks why the pane keeps producing the
 * wrong chart.
 */
function figureLines(graph, runUri, run, fig, t) {
  const F = iri(`${graph}#${run.id}-figure`);
  t(F, "type", "mcp:Figure");
  t(F, "run", iri(runUri));
  t(F, "provenance", literal("model"));
  if (fig.kind) t(F, "figureKind", literal(fig.kind));
  if (fig.title) t(F, "title", literal(fig.title));
  if (fig.caption) t(F, "caption", literal(fig.caption));
  if (fig.text) t(F, "content", literal(clipContent(fig.text).text));
  if (fig.figureDigest) t(F, "figureDigest", literal(fig.figureDigest));
  if (fig.complete === false) t(F, "truncated", boolean(true));
  if (fig.query) t(F, "query", literal(clipContent(fig.query).text));
  if (fig.accept) t(F, "accept", literal(fig.accept));
  if (fig.mimeType) t(F, "mimeType", literal(fig.mimeType));
  if (fig.resultDigest) t(F, "resultDigest", literal(fig.resultDigest));
  if (fig.rows != null) t(F, "rows", integer(fig.rows));
  if (fig.bytes != null) t(F, "bytes", integer(fig.bytes));
  if (fig.view) t(F, "view", literal(fig.view));
  if (fig.promotedTo) t(F, "promotedTo", literal(fig.promotedTo));
  if (fig.via) t(F, "executedVia", literal(fig.via));
  if (fig.disposition) t(F, "disposition", literal(fig.disposition));
  for (const n of fig.policy || []) t(F, "policyNote", literal(n));
}

export function insertData({ graph, exploration, repository, run, exchanges,
                             dashboard = null, figure = null }) {
  const g = iri(graph);
  const runUri = `${graph}#${run.id}`;
  const lines = [];
  // `type' is rdf:type, written `a'.  It had been written `mcp:type', which
  // is not what this module's own header documents and not what anything
  // querying the record would ask for: `?d a mcp:Dashboard' matched nothing,
  // which is why the archive listed no dashboards until it was run against a
  // real store.  Readers here take the predicate's LOCAL name, so both
  // spellings read back and records written before this still open.
  const t = (s, p, o) =>
    lines.push(p === "type" ? `    ${s} a ${o} .` : `    ${s} mcp:${p} ${o} .`);

  const G = iri(graph);
  t(G, "type", "mcp:Transcript");
  if (exploration) t(G, "exploration", iri(exploration));
  if (repository) t(G, "repository", literal(repository));
  t(G, "recorded", dateTime(run.ended || new Date()));
  if (run.provider) t(G, "provider", literal(run.provider));
  if (run.model) t(G, "model", literal(run.model));
  t(G, "run", iri(runUri));

  const R = iri(runUri);
  t(R, "type", "mcp:Run");
  t(R, "transcript", G);
  if (run.prompt != null) t(R, "prompt", literal(clipContent(run.prompt).text));
  if (run.started) t(R, "started", dateTime(run.started));
  t(R, "ended", dateTime(run.ended || new Date()));
  if (run.iterations != null) t(R, "iterations", integer(run.iterations));
  t(R, "ok", boolean(run.ok !== false));
  if (run.error) t(R, "error", literal(run.error));
  if (run.session) t(R, "session", literal(run.session));

  for (const x of exchanges) {
    const X = iri(`${graph}#${run.id}-x${x.ordinal}`);
    t(X, "type", "mcp:Exchange");
    t(X, "run", R);
    t(X, "ordinal", integer(x.ordinal));
    t(X, "kind", literal(x.kind));
    t(X, "direction", literal(x.direction));
    if (x.at) t(X, "at", dateTime(x.at));
    if (x.ms != null) t(X, "ms", integer(x.ms));
    if (x.ok != null) t(X, "ok", boolean(x.ok));
    if (x.tool) t(X, "tool", literal(x.tool));
    if (x.op) t(X, "op", literal(x.op));
    if (x.document) t(X, "document", literal(x.document));
    if (x.iteration != null) t(X, "iteration", integer(x.iteration));
    if (x.httpStatus != null) t(X, "httpStatus", integer(x.httpStatus));
    if (x.stopReason) t(X, "stopReason", literal(x.stopReason));
    if (x.tokensIn != null) t(X, "tokensIn", integer(x.tokensIn));
    if (x.tokensOut != null) t(X, "tokensOut", integer(x.tokensOut));
    if (x.rows != null) t(X, "rows", integer(x.rows));
    if (x.arguments) t(X, "arguments", literal(x.arguments));
    if (x.error) t(X, "error", literal(x.error));
    if (x.bytes != null) t(X, "bytes", integer(x.bytes));
    if (x.truncated) t(X, "truncated", boolean(true));
    if (x.content != null && x.content !== "") t(X, "content", literal(x.content));
  }

  if (dashboard) dashboardLines(graph, runUri, run, dashboard, t);
  if (figure) figureLines(graph, runUri, run, figure, t);

  return `PREFIX mcp: <${MCP_NS}>\nINSERT DATA {\n  GRAPH ${g} {\n`
       + lines.join("\n") + `\n  }\n}`;
}

/* ── the write itself ────────────────────────────────────────────────────── */

/** One run's id: ordered by time, unique within a graph, readable in a log. */
export function runId(when = new Date()) {
  const stamp = (when instanceof Date ? when : new Date(when)).toISOString()
    .replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `r-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record one run into <account>/mcp.
 *
 * Never throws and never fails a run: the exploration happened whether or not
 * the record of it could be written, and a pane that reported a store error
 * instead of the model's answer would be reporting the wrong thing.  The
 * outcome is returned so the pane can say, quietly, that the record was not
 * kept.
 */
export async function recordRun({
  host, account, token, repository, session, result, prompt, started,
  dashboard = null, figure = null,
  max = MAX_CONTENT, fetchImpl, now = () => new Date(),
} = {}) {
  const ended = now();
  const exploration = session ? explorationUri(session) : null;
  // Without a handle there was no exploration to hang this on -- an LLM-only
  // run, or one whose first call failed -- and it is still worth keeping.
  const graph = transcriptGraph(exploration || `http://dydra.com/explorations/detached-${runId(ended)}`);
  const run = {
    id: runId(ended), prompt, started: started || ended, ended,
    iterations: result?.iterations, ok: result?.ok, error: result?.error,
    provider: result?.provider, model: result?.model, session: session || null,
  };
  const exchanges = exchangesFrom(result?.events || [], { max });
  let update;
  try {
    update = insertData({ graph, exploration, repository, run, exchanges, dashboard, figure });
  } catch (e) {
    return { ok: false, error: String(e), graph, exchanges: exchanges.length };
  }

  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const endpoint = `${sessionRepository(host, account)}/sparql`;
  const at = Date.now();
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-update",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: update,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, graph, run: run.id,
             exchanges: exchanges.length, bytes: update.length,
             ms: Date.now() - at,
             ...(res.ok ? {} : { error: (text || `HTTP ${res.status}`).slice(0, 400) }) };
  } catch (e) {
    return { ok: false, status: 0, graph, run: run.id, exchanges: exchanges.length,
             ms: Date.now() - at, error: String(e) };
  }
}

/* ── reading it back ─────────────────────────────────────────────────────── */

/**
 * The transcript of one exploration: its runs, each with its exchanges in the
 * order they happened.
 *
 * One query for the whole graph, as `readSession' does: the alternative is a
 * query per run and the graph is one exploration's, not the account's.
 */
export async function readTranscript({ host, account, token, exploration, graph, fetchImpl }) {
  const g = graph || transcriptGraph(exploration);
  const query = `PREFIX mcp: <${MCP_NS}>
SELECT ?s ?p ?o
WHERE { GRAPH <${g}> { ?s ?p ?o } }`;
  const res = await sparqlQuery({ host, account, token, query, fetchImpl });
  if (!res.ok) return { ...res, runs: [] };

  const local = (v) => String(v || "").replace(/^.*[#/]/, "");
  const head = {};
  // Every subject first, then partition by what it SAYS it is.  Deciding
  // from the shape of the name was workable while a transcript held runs and
  // exchanges and nothing else; it stopped being workable the moment a run
  // could also carry a dashboard, its panels, its transforms, its assertions
  // and now a figure -- each of which would have been read as a run with no
  // prompt and no exchanges.  The type is written on every node, so use it.
  const bySubject = new Map();
  for (const { s, p, o } of res.rows) {
    const key = local(p);
    if (s === g) { (head[key] ??= []).push(o); continue; }
    let rec = bySubject.get(s);
    if (!rec) { rec = { subject: s, name: local(s), types: [] }; bySubject.set(s, rec); }
    if (key === "type") rec.types.push(local(o));
    else rec[key] = o;
  }
  const is = (rec, what) => rec.types.includes(what);
  // A node that states its type is read by it; one that does not -- an older
  // record, or a row lost in transit -- falls back to the shape of its name,
  // which is what this used to do for everything.
  const kindOf = (rec) => (rec.types.length
    ? (rec.types.find((x) => x === "Run" || x === "Exchange") || rec.types[0])
    : (/-x\d+$/.test(rec.subject) ? "Exchange" : "Run"));
  const runs = new Map([...bySubject].filter(([, r]) => kindOf(r) === "Run"));
  const exchanges = [...bySubject.values()].filter((r) => kindOf(r) === "Exchange");
  const figures = [...bySubject.values()].filter((r) => is(r, "Figure"));

  const num = (v) => (v == null ? null : Number(v));
  const list = [...runs.values()].map((r) => ({
    uri: r.subject, id: r.name, prompt: r.prompt ?? null,
    started: r.started ? new Date(r.started) : null,
    ended: r.ended ? new Date(r.ended) : null,
    iterations: num(r.iterations), ok: r.ok !== "false", error: r.error ?? null,
    session: r.session ?? null,
    exchanges: exchanges
      .filter((x) => x.run === r.subject)
      .map((x) => ({
        uri: x.subject, ordinal: num(x.ordinal), kind: x.kind, direction: x.direction,
        at: x.at ? new Date(x.at) : null, ms: num(x.ms), ok: x.ok !== "false",
        tool: x.tool ?? null, op: x.op ?? null, document: x.document ?? null,
        arguments: x.arguments ?? null, content: x.content ?? null,
        rows: num(x.rows), bytes: num(x.bytes), truncated: x.truncated === "true",
        stopReason: x.stopReason ?? null, iteration: num(x.iteration),
        httpStatus: num(x.httpStatus), error: x.error ?? null,
      }))
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)),
    // D-N: the figure belongs to the run that drew it, so it is read back
    // attached to it rather than as a loose node someone has to join by hand.
    figures: figures.filter((f) => f.run === r.subject).map((f) => ({
      uri: f.subject, kind: f.figureKind || "svg", title: f.title ?? null,
      caption: f.caption ?? null, text: f.content ?? null,
      figureDigest: f.figureDigest ?? null, resultDigest: f.resultDigest ?? null,
      query: f.query ?? null, accept: f.accept ?? null, mimeType: f.mimeType ?? null,
      rows: num(f.rows), bytes: num(f.bytes), view: f.view ?? null,
      promotedTo: f.promotedTo ?? null, via: f.executedVia ?? null,
      disposition: f.disposition ?? null, truncated: f.truncated === "true",
    })),
  }));
  list.sort((a, b) => (a.ended?.getTime() ?? 0) - (b.ended?.getTime() ?? 0));

  return { ...res, graph: g,
           exploration: head.exploration?.[0] ?? null,
           repository: head.repository?.[0] ?? null,
           provider: head.provider?.[0] ?? null,
           model: head.model?.[0] ?? null,
           runs: list };
}

export default { recordRun, readTranscript, insertData, exchangesFrom,
                 transcriptGraph, clipContent };
