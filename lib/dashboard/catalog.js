/**
 * Temporary views: the catalogue half of Gate 1.
 *
 * Implements D-K at panel-set scale (U-20) and the promote/sweep half of U-24.
 *
 * D-K says the query the user authorises becomes a real catalogue entry,
 * `tmp-{run}', carrying the prompt and the run id as provenance, swept at
 * session end unless promoted.  A real entry is what makes a run
 * re-executable, auditable, and promotable with one more click, and it reuses
 * the view machinery rather than inventing a parallel path.
 *
 * §6 of the plan leaves the cost of that OPEN, and this module does not settle
 * it.  A dashboard is N panels, so the catalogue route is N configuration
 * writes per confirmed prompt and N entries to sweep if the pane is closed
 * without warning -- which is a real cost, and it is the user's to weigh, not
 * this module's to decide silently.  So both routes are implemented and the
 * pane offers the choice at Gate 1: `viaCatalog' writes the entries and runs
 * them by name, and the direct route runs the query text and writes nothing.
 * What the user picks is recorded with the run.
 */

/** `Authorization' however the caller holds it: bare token or full header. */
export function authHeader(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  return /^(bearer|basic|token)\s/i.test(t) ? t : `Bearer ${t}`;
}

/** Where a view lives.  The system path, which is what PUT and DELETE take. */
export function viewUrl(host, account, repository, name) {
  return `${String(host || "").replace(/\/$/, "")}`
       + `/system/accounts/${encodeURIComponent(account)}`
       + `/repositories/${encodeURIComponent(repository)}`
       + `/views/${encodeURIComponent(name)}`;
}

/** Where a view RUNS.  A named view is executed by GET on its own path. */
export function executeUrl(host, account, repository, name) {
  return `${String(host || "").replace(/\/$/, "")}`
       + `/${encodeURIComponent(account)}/${encodeURIComponent(repository)}`
       + `/${encodeURIComponent(name)}`;
}

/** The repository's SPARQL endpoint, for the route that writes nothing. */
export function sparqlUrl(host, account, repository) {
  return `${String(host || "").replace(/\/$/, "")}`
       + `/${encodeURIComponent(account)}/${encodeURIComponent(repository)}/sparql`;
}

/**
 * A run id: short, sortable, and unique enough for a session's worth of runs.
 *
 * It goes in every temporary name, so a sweep can find this run's entries and
 * leave another pane's alone.
 */
export function runId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T.]/g, "").slice(2, 14);
  const salt = Math.random().toString(36).slice(2, 6);
  return `${stamp}${salt}`;
}

/** The catalogue name of one panel of one run. */
export function tempName(run, panel) {
  return `tmp-${run}-${panel}`;
}

/** True for a name this module made.  The sweep refuses to touch anything else. */
export function isTempName(name, run = null) {
  return run ? String(name || "").startsWith(`tmp-${run}-`)
             : /^tmp-[0-9a-z]{12,20}-/.test(String(name || ""));
}

async function send(url, { method, token, body, contentType, accept, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const started = Date.now();
  const headers = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (accept) headers.Accept = accept;
  const auth = authHeader(token);
  if (auth) headers.Authorization = auth;
  let res, text;
  try {
    res = await doFetch(url, { method, headers, ...(body != null ? { body } : {}) });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String(e), ms: Date.now() - started };
  }
  return {
    ok: res.ok, status: res.status, text,
    error: res.ok ? null : (text || `HTTP ${res.status}`).slice(0, 400),
    mimeType: (res.headers?.get?.("content-type") || "").split(";")[0] || null,
    ms: Date.now() - started,
  };
}

/** Write one view.  The query text is the body, as the view editor sends it. */
export function putView({ host, account, repository, name, query, token, fetchImpl }) {
  return send(viewUrl(host, account, repository, name), {
    method: "PUT", token, body: query,
    contentType: "application/sparql-query", accept: "application/n-quads", fetchImpl,
  });
}

/** Remove one view. */
export function deleteView({ host, account, repository, name, token, fetchImpl }) {
  return send(viewUrl(host, account, repository, name), {
    method: "DELETE", token, accept: "application/n-quads", fetchImpl });
}

/**
 * Write the whole panel set as temporary views, under one run id.
 *
 * All or nothing in intent but not in effect: the catalogue has no transaction,
 * so a failure half way leaves entries behind.  They are named for the run, so
 * `sweep' removes them; what must not happen is the caller believing the set
 * was written when it was not, which is why every outcome is returned rather
 * than the first failure thrown.
 */
export async function putPanelSet({ host, account, repository, token, panels, run, fetchImpl,
                                    onEvent = () => {} }) {
  const written = [];
  for (const panel of panels) {
    const name = tempName(run, panel.name);
    const res = await putView({ host, account, repository, name, query: panel.query,
                                token, fetchImpl });
    written.push({ panel: panel.name, name, ok: res.ok, status: res.status,
                   error: res.error, ms: res.ms });
    onEvent({ type: "temp-view", panel: panel.name, name, ok: res.ok, error: res.error });
  }
  return { ok: written.every((w) => w.ok), written, run };
}

/**
 * Keep one panel under a name of the user's choosing.
 *
 * Written before the temporary one is removed: if the write fails the run is
 * still there to try again, where the other order would lose the query.
 */
export async function promoteView({ host, account, repository, token, from, to, query, fetchImpl }) {
  const put = await putView({ host, account, repository, name: to, query, token, fetchImpl });
  if (!put.ok) return { ok: false, put, deleted: null };
  const del = from ? await deleteView({ host, account, repository, name: from, token, fetchImpl })
                   : null;
  return { ok: true, put, deleted: del };
}

/**
 * Remove this run's temporary entries.
 *
 * Takes the names it wrote rather than listing the catalogue and matching a
 * pattern: a pattern match would also hit another pane's run, and a sweep that
 * deletes someone else's view is a far worse failure than one that leaves a
 * stale entry behind.
 */
export async function sweep({ host, account, repository, token, names, run = null, fetchImpl,
                              onEvent = () => {} }) {
  const out = [];
  for (const name of names || []) {
    if (!isTempName(name, run)) { out.push({ name, ok: false, error: "not a temporary name" }); continue; }
    const res = await deleteView({ host, account, repository, name, token, fetchImpl });
    out.push({ name, ok: res.ok, status: res.status, error: res.error });
    onEvent({ type: "swept", name, ok: res.ok });
  }
  return { ok: out.every((o) => o.ok), swept: out };
}

export default putPanelSet;
