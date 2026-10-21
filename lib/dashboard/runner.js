/**
 * Phase 2: the interface's own runs.
 *
 * Implements D-I at panel-set scale and the live half of D-P; work items U-20
 * and U-21, and the recomputation half of D-T.
 *
 * The model proposes the queries; this runs them, under the user's own token,
 * after the user has seen them.  That is not ceremony.  §4.4(4) of the client
 * plan warns that LLM-REPORTED data is unsafe to present, because the
 * interface would be showing rows it never fetched -- and a dashboard of
 * charts is reported data in the most persuasive form there is.  Here the
 * interface holds the authentic result and the page is bound to it, so what
 * the user sees came from the store through the same path a view editor uses.
 *
 * A refresh is the same function called again.  That is the whole mechanism
 * behind "the dashboard is live": the page holds no data, the panels are named
 * slots, and re-running fills them again.  The digests computed here are what
 * make the staleness marking of D-T possible -- an assertion written against
 * digest X is marked when the panel now digests to Y.
 */

import { digestResult } from "../mcp/result-digest.js";
import { bindParameters } from "../app/parameters.js";
import { viewsOf, projectedVariables } from "../app/document.js";
import { datasetOf } from "../figure/provenance.js";
import { queryFormOf } from "../llm/grant.js";
import { authHeader, executeUrl, sparqlUrl, tempName } from "./catalog.js";

/**
 * Does this document answer THIS query?  A sentence saying why not, or null.
 *
 * Phase 2 fetched something and the HTTP status was 200; that is all `ok'
 * means, and it is not enough.  A store can answer a SELECT with a boolean
 * document, a route can run a view other than the one that was written, a
 * proxy can hand back a page -- and every one of those arrives as a 200 with
 * a body, is digested without complaint, and is passed on to be drawn.
 *
 * That is how a result reaches a figure at all.  Observed: a
 * `SELECT ?type (COUNT(?s) AS ?count)' came back as a SPARQL boolean
 * document, which digests to `form: "boolean", rows: 1' -- so the gate
 * reported "1 row(s)", the model was told the document answered ?type and
 * ?count, and the only thing between that and a published chart of a dataset
 * that does not exist was the model noticing, in prose, at the last step.
 * A figure should never have depended on that.
 *
 * So the comparison is made here, once, for both paths: the form the query
 * takes against the form the document is, and -- when the projection can be
 * read -- the columns asked for against the columns returned.  It REFUSES
 * only what is unambiguous and says nothing whenever it cannot tell, because
 * a check that rejects sound results is worse than the hole it closes.  An
 * empty document is never a fault: no rows is a real answer to a real query.
 */
export function resultFault(query, shape) {
  if (!shape || !shape.bytes) return null;             // empty: a real answer
  const form = queryFormOf(query);
  const got = shape.form;
  const is = (what) =>
    `the query is ${/^[AEIOU]/.test(form || "") ? "an" : "a"} ${form} and the response is ${what}`;

  if (got === "score") return is("not a result document at all");
  if (got === "unknown") {
    return is("in no notation this can read "
            + `(${shape.bytes} bytes of ${shape.mimeType || "an unstated type"})`);
  }

  if (form === "ASK") {
    return got === "boolean" ? null : is(`a ${got}, not a boolean`);
  }
  if (form === "CONSTRUCT" || form === "DESCRIBE") {
    return got === "graph" ? null : is(`a ${got}, not statements`);
  }
  if (form !== "SELECT") return null;                  // not ours to judge

  if (got === "boolean") {
    // A boolean where a SELECT was asked has a known and unglamorous cause:
    // an EMPTY result set encoded as one.  So the useful sentence is not
    // "this is the wrong shape" -- which sends the reader looking for a
    // routing fault -- but "this matched nothing", followed by the first
    // thing to check.  A query that names no graph reads the default graph,
    // and a model retyping a query it ran earlier drops the `FROM' clause
    // long before it drops anything a reader would notice.
    const names = datasetOf(query);
    return is(`a boolean (${shape.value}), which is how an EMPTY result set `
            + `arrives from this store. The query matched nothing.`)
         + (names.any
              ? ` It reads ${names.all.join(", ")}; check that the graph holds what `
              + `is being asked for.`
              : ` It names no graph, so it read the default graph — if the data is `
              + `in a named graph, a FROM clause is what is missing.`);
  }
  if (got !== "table") return is(`a ${got}, not a table of bindings`);

  const want = projectedVariables(query);
  if (!want) return null;                              // cannot tell: say nothing
  const have = new Set((shape.names || []).map((n) => String(n).replace(/^[?$]/, "")));
  const missing = want.filter((n) => !have.has(n));
  if (!missing.length) return null;
  return `the query selects ${want.map((n) => `?${n}`).join(", ")} and the response `
       + `has ${have.size ? [...have].map((n) => `?${n}`).join(", ") : "no columns"}`
       + ` — ${missing.map((n) => `?${n}`).join(", ")} ${missing.length > 1 ? "are" : "is"} `
       + `not in it`;
}

/**
 * Run one panel.
 *
 * Two routes, because §6 of the plan leaves the catalogue question open:
 * `viaCatalog' GETs the temporary view by name, which is the D-K reading and
 * makes the run reproducible from the catalogue; the direct route POSTs the
 * query text to the repository's SPARQL endpoint, which writes nothing and
 * leaves nothing to sweep.  Both run under the user's token and neither lets
 * the model execute anything.
 */
export async function runPanel({ host, account, repository, token, panel, run = null,
                                 viaCatalog = false, fetchImpl, signal,
                                 values = null, parameters = [], results = {} }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const started = Date.now();
  const accept = panel.accept || "text/tab-separated-values";
  const auth = authHeader(token);
  const headers = { Accept: accept, ...(auth ? { Authorization: auth } : {}) };

  // D-X.  The authorised text, plus a VALUES clause -- never an edit to it,
  // and never a run with some of the values refused: a panel run with two of
  // its three parameters bound is a query the user never saw.
  const bound = bindParameters(panel, values || {}, { parameters, results });
  if (!bound.ok) {
    return { name: panel.name, ok: false, status: 0, refused: true,
             error: bound.refusals.map((r) => `${r.name}: ${r.reason}`).join("; "),
             refusals: bound.refusals, ms: 0, text: "", digest: null, rows: null,
             via: "refused" };
  }
  const query = bound.query;

  // The catalogue route runs a stored view by name, and a stored view has no
  // room for a VALUES clause -- so a parameterised run goes direct, which is
  // the same query either way and writes nothing.
  const direct = !viaCatalog || !run || Boolean(Object.keys(bound.bound).length);
  const url = !direct
    ? executeUrl(host, account, repository, tempName(run, panel.name))
    : sparqlUrl(host, account, repository);
  const init = !direct
    ? { method: "GET", headers, ...(signal ? { signal } : {}) }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/sparql-query" },
        body: query, ...(signal ? { signal } : {}) };

  let res, text;
  try {
    res = await doFetch(url, init);
    text = await res.text();
  } catch (e) {
    return { name: panel.name, ok: false, status: 0, error: String(e),
             ms: Date.now() - started, text: "", digest: null, rows: null, via: direct ? "direct" : "catalog" };
  }
  const mimeType = (res.headers?.get?.("content-type") || accept).split(";")[0];
  if (!res.ok) {
    return { name: panel.name, ok: false, status: res.status,
             error: (text || `HTTP ${res.status}`).slice(0, 400), ms: Date.now() - started,
             text: "", digest: null, rows: null, via: direct ? "direct" : "catalog" };
  }
  const d = digestResult(text, mimeType);

  // A 200 with a body is not yet a result.  Checked before anything is
  // digested into a page or sent back to be drawn, and the body is kept on
  // the refusal: the whole value of catching it here is that the user can
  // read the query and what answered it side by side.
  const fault = resultFault(query, d);
  if (fault) {
    return { name: panel.name, ok: false, mismatch: true, status: res.status, mimeType,
             text, shape: d, digest: d.digest, rows: d.rows, ms: Date.now() - started,
             via: direct ? "direct" : "catalog",
             error: `the response does not answer the query: ${fault}` };
  }

  return {
    name: panel.name, ok: true, status: res.status, mimeType, text,
    digest: d.digest, rows: d.rows, bytes: d.bytes, form: d.form, shape: d,
    ms: Date.now() - started, via: direct ? "direct" : "catalog",
    bound: Object.keys(bound.bound).length ? bound.bound : null,
  };
}

/**
 * Run the set.
 *
 * In sequence rather than in parallel.  N panels issued at once is N
 * concurrent evaluations against one store for one person looking at one page,
 * and the pane can show progress panel by panel only if they arrive panel by
 * panel.  `onEvent' fires as each lands so a dashboard can paint while the
 * rest are still running.
 */
export async function runPanels({ host, account, repository, token, panels, run = null,
                                  viaCatalog = false, fetchImpl, onEvent = () => {}, signal,
                                  only = null, values = null, parameters = [],
                                  have = {} }) {
  // U-31.  `only' names the panels a patch actually changed; everything else
  // keeps the result it already has.  Re-running an unchanged panel is not
  // merely wasteful -- it spends the user's grant on a question nobody asked
  // again, and it can make a page flicker between two readings of the same
  // data for no reason the reader can see.
  const wanted = only ? new Set([].concat(only)) : null;
  const results = { ...(have || {}) };
  for (const panel of panels) {
    if (wanted && !wanted.has(panel.name)) continue;
    onEvent({ type: "panel-start", name: panel.name });
    const r = await runPanel({ host, account, repository, token, panel, run, viaCatalog,
                               fetchImpl, signal, values, parameters, results });
    results[panel.name] = r;
    onEvent({ type: "panel-done", name: panel.name, ok: r.ok, rows: r.rows, ms: r.ms,
              error: r.error || null, digest: r.digest });
    if (signal?.aborted) break;
  }
  return results;
}

/**
 * What the page is told.
 *
 * Not the same objects: a result carries the whole document, and a panel that
 * the page never binds has no business being posted into it.  The frame gets
 * the payload of the panels the page actually uses, and nothing else.
 */
export function payloadsFor(spec, results) {
  const needed = new Set();
  // Every view's markup, because a page shows one view at a time but holds
  // all of them (D-AC): a panel bound only in the view that is not open yet
  // is still a panel the page needs.
  const html = viewsOf(spec).map((v) => v.html).join("\n");
  for (const p of spec.panels || []) {
    const usedByTransform = (spec.transforms || []).some((t) => t.inputs.includes(p.name));
    const usedByParameter = (spec.parameters || []).some((x) => x.domain?.from === p.name);
    const bound = html.includes(`data-bound="${p.name}"`)
               || html.includes(`data-bound='${p.name}'`);
    if (bound || usedByTransform || usedByParameter) needed.add(p.name);
  }
  const out = {};
  for (const [name, r] of Object.entries(results || {})) {
    if (!needed.has(name)) continue;
    out[name] = { ok: r.ok, mimeType: r.mimeType || null, text: r.ok ? r.text : "",
                  digest: r.digest, rows: r.rows, error: r.error || null };
  }
  return out;
}

/** Totals, for the grant meter and the Gate 1 estimate. */
export function totals(results) {
  const list = Object.values(results || {});
  return {
    panels: list.length,
    ok: list.filter((r) => r.ok).length,
    rows: list.reduce((n, r) => n + (Number(r.rows) || 0), 0),
    bytes: list.reduce((n, r) => n + (Number(r.bytes) || 0), 0),
    ms: list.reduce((n, r) => n + (Number(r.ms) || 0), 0),
  };
}

export default runPanels;
