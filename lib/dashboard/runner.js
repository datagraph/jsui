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
import { authHeader, executeUrl, sparqlUrl, tempName } from "./catalog.js";

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
                                 viaCatalog = false, fetchImpl, signal }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const started = Date.now();
  const accept = panel.accept || "text/tab-separated-values";
  const auth = authHeader(token);
  const headers = { Accept: accept, ...(auth ? { Authorization: auth } : {}) };

  const url = viaCatalog && run
    ? executeUrl(host, account, repository, tempName(run, panel.name))
    : sparqlUrl(host, account, repository);
  const init = viaCatalog && run
    ? { method: "GET", headers, ...(signal ? { signal } : {}) }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/sparql-query" },
        body: panel.query, ...(signal ? { signal } : {}) };

  let res, text;
  try {
    res = await doFetch(url, init);
    text = await res.text();
  } catch (e) {
    return { name: panel.name, ok: false, status: 0, error: String(e),
             ms: Date.now() - started, text: "", digest: null, rows: null, via: viaCatalog ? "catalog" : "direct" };
  }
  const mimeType = (res.headers?.get?.("content-type") || accept).split(";")[0];
  if (!res.ok) {
    return { name: panel.name, ok: false, status: res.status,
             error: (text || `HTTP ${res.status}`).slice(0, 400), ms: Date.now() - started,
             text: "", digest: null, rows: null, via: viaCatalog ? "catalog" : "direct" };
  }
  const d = digestResult(text, mimeType);
  return {
    name: panel.name, ok: true, status: res.status, mimeType, text,
    digest: d.digest, rows: d.rows, bytes: d.bytes, form: d.form, shape: d,
    ms: Date.now() - started, via: viaCatalog ? "catalog" : "direct",
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
                                  viaCatalog = false, fetchImpl, onEvent = () => {}, signal }) {
  const results = {};
  for (const panel of panels) {
    onEvent({ type: "panel-start", name: panel.name });
    const r = await runPanel({ host, account, repository, token, panel, run, viaCatalog,
                               fetchImpl, signal });
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
  for (const p of spec.panels || []) {
    const usedByTransform = (spec.transforms || []).some((t) => t.inputs.includes(p.name));
    const bound = (spec.html || "").includes(`data-bound="${p.name}"`)
               || (spec.html || "").includes(`data-bound='${p.name}'`);
    if (bound || usedByTransform) needed.add(p.name);
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
