/**
 * Dashboards that have already been made, read back out of <account>/mcp.
 *
 * The second half of U-24.  A dashboard is promoted by keeping its panels as
 * views and saved by downloading the page, and both of those leave the user
 * with something -- but neither answers "what did I build last Tuesday".  The
 * transcript already holds the answer: `recordRun' writes an `mcp:Dashboard'
 * per run, with the page, every panel's query and digest, every transform's
 * source and every assertion with what it was written from (D-S).  This reads
 * it back.
 *
 * Reopening is deliberately NOT a replay of the run.  Nothing is sent to a
 * model and no gate is crossed: the queries are the ones the user already
 * authorised, the page is the one they already saw, and running a saved query
 * is what the view editor does every day.  It is §1 of the plan -- the
 * baseline, automatic path -- applied to a page instead of a view, which is
 * also why a reopened dashboard is live rather than a snapshot.
 */

import { MCP_NS, sparqlQuery } from "../mcp/session-log.js";

/**
 * A predicate as a key: its local name.
 *
 * Not "strip the mcp: namespace", which was the earlier reading and which
 * silently dropped `rdf:type' -- the one predicate here that is NOT in the
 * mcp namespace, and the one every branch below turns on.
 */
const key = (p) => String(p || "").replace(/^.*[#/]/, "");

/** Every dashboard this account has recorded, newest first. */
export async function listDashboards({ host, account, token, limit = 50, fetchImpl }) {
  const query = `PREFIX mcp: <${MCP_NS}>
SELECT ?dashboard ?title ?recorded ?repository ?disposition ?pageDigest
WHERE {
  GRAPH ?g {
    # rdf:type is what is written now; mcp:type is what earlier records
    # carry, and an archive that cannot read its own back catalogue is none.
    { ?dashboard a mcp:Dashboard } UNION { ?dashboard mcp:type mcp:Dashboard }
    OPTIONAL { ?dashboard mcp:title       ?title }
    OPTIONAL { ?dashboard mcp:pageDigest  ?pageDigest }
    OPTIONAL { ?dashboard mcp:disposition ?disposition }
    ?g mcp:recorded ?recorded .
    OPTIONAL { ?g mcp:repository ?repository }
  }
}
LIMIT ${Number(limit) || 50}`;
  const res = await sparqlQuery({ host, account, token, query, fetchImpl });
  if (!res.ok) return res;
  const dashboards = res.rows.map((r) => ({
    uri: r.dashboard, title: r.title || "(untitled)", recorded: r.recorded || null,
    repository: r.repository || null, disposition: r.disposition || null,
    pageDigest: r.pageDigest || null,
  }));
  dashboards.sort((a, b) => String(b.recorded || "").localeCompare(String(a.recorded || "")));
  return { ...res, dashboards };
}

/**
 * One dashboard, as a spec the frame can mount.
 *
 * Rebuilt from the statements rather than from a stored blob of JSON, so the
 * record stays readable as RDF and a panel renamed or a query corrected in the
 * store is what comes back.  The assertions keep the digests they were written
 * against, which is what lets a reopened page mark its own prose stale the
 * moment the panels are re-run (D-T).
 */
export async function readDashboard({ host, account, token, uri, fetchImpl }) {
  const query = `PREFIX mcp: <${MCP_NS}>
SELECT ?s ?p ?o
WHERE {
  GRAPH ?g {
    <${String(uri || "")}> ?dp ?s .
    ?s ?p ?o
  }
}`;
  const head = await sparqlQuery({
    host, account, token, fetchImpl,
    query: `PREFIX mcp: <${MCP_NS}>
SELECT ?p ?o WHERE { GRAPH ?g { <${String(uri || "")}> ?p ?o } }`,
  });
  if (!head.ok) return head;
  const parts = await sparqlQuery({ host, account, token, query, fetchImpl });
  if (!parts.ok) return parts;

  const own = {};
  for (const r of head.rows) {
    const k = key(r.p);
    (own[k] || (own[k] = [])).push(r.o);
  }

  // The members arrive as a flat (s, p, o) stream; group them by subject and
  // let the rdf:type say which of the three kinds each one is.
  const bySubject = new Map();
  for (const r of parts.rows) {
    const m = bySubject.get(r.s) || {};
    const k = key(r.p);
    if (k === "input" || k === "inputDigest") (m[k] || (m[k] = [])).push(r.o);
    else m[k] = r.o;
    bySubject.set(r.s, m);
  }

  const panels = [], transforms = [], assertions = [];
  for (const [, m] of bySubject) {
    const kind = String(m.type || "");
    if (kind.endsWith("Panel")) {
      panels.push({ name: m.name, query: m.query, accept: m.accept || "text/tab-separated-values",
                    caption: null, view: m.view || null,
                    recordedDigest: m.resultDigest || null });
    } else if (kind.endsWith("Transform")) {
      transforms.push({ name: m.name, inputs: m.input || [], body: m.body || "return null;" });
    } else if (kind.endsWith("Assertion")) {
      const digests = {};
      for (const pair of m.inputDigest || []) {
        const i = String(pair).indexOf("=");
        if (i > 0) digests[String(pair).slice(0, i)] = String(pair).slice(i + 1);
      }
      assertions.push({ id: m.name, inputs: m.input || [], text: m.content || "",
                        kind: (m.provenance || "asserted"), inputDigests: digests });
    }
  }
  // Declaration order is dependency order for transforms, and the store does
  // not keep an order -- so they are sorted by what they read: a transform
  // whose inputs are all panels comes before one that reads another transform.
  const panelNames = new Set(panels.map((p) => p.name));
  transforms.sort((a, b) =>
    Number(a.inputs.some((i) => !panelNames.has(i))) - Number(b.inputs.some((i) => !panelNames.has(i))));

  const spec = {
    title: (own.title || [])[0] || "(untitled)",
    html: (own.page || [])[0] || "",
    panels, transforms, assertions,
  };
  return {
    ok: true, spec,
    pageDigest: (own.pageDigest || [])[0] || null,
    disposition: (own.disposition || [])[0] || null,
    via: (own.executedVia || [])[0] || null,
    grant: (own.grant || [])[0] ? JSON.parse((own.grant || [])[0]) : null,
    complete: Boolean(spec.html && panels.length),
  };
}

export default listDashboards;
