/**
 * The session log: what an exploration did, read back from where it was written.
 *
 * MCP keeps no state in the browser.  Every survey operation is recorded by the
 * server into <account>/mcp -- one named graph per session, revisioned -- and
 * that record, not the response tabs, is the session.  The tabs are this page's
 * live tail of it: they hold the prompt text and the model's prose, which were
 * deliberately not made durable, and they are gone on reload.  This reads the
 * other half back.
 *
 * The vocabulary is the one `exploration-quads' writes (orchestrator/persistence.lisp):
 *
 *   <graph> a mcp:Exploration ; mcp:repository "a/r" ; mcp:created T ;
 *           mcp:lastActive T ; mcp:version N ; mcp:root <g#n1> ; mcp:activeNode <g#nK>
 *   <g#nK>  a mcp:Node ; mcp:name "nK" ; mcp:operation mcpop:catalog ;
 *           mcp:status mcp:complete ; mcp:startedAt T ; mcp:parent <g#nJ> ;
 *           mcp:resultCount N ; mcp:alias "…" ;
 *           mcp:shape/mcp:parameters/mcp:suggestions "<score notation>"
 *
 * Read through SPARQL rather than the Graph Store protocol: the questions are
 * "which sessions" and "this session's nodes in order", and both are one query.
 */

export const MCP_NS = "http://dydra.com/ns/mcp#";
export const MCP_OP_NS = "http://dydra.com/ns/mcp/operation#";

/** The exploration repository for an account: its sessions all live here. */
export function sessionRepository(host, account) {
  return `${String(host || "").replace(/\/$/, "")}/${encodeURIComponent(account)}/mcp`;
}

/**
 * Timestamps are written as lisp universal time -- seconds since 1900-01-01 --
 * which is 2208988800 seconds before the unix epoch.  A value that is already
 * unix-sized is passed through, so a change of convention on the server does not
 * silently render as 1904.
 */
export function universalToDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = n > 2208988800 ? n - 2208988800 : n;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function sparql({ host, account, token, query, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const endpoint = `${sessionRepository(host, account)}/sparql`;
  const started = Date.now();
  let res, text;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: query,
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, error: String(e), rows: [], ms: Date.now() - started };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    return { ok: false, status: res.status, rows: [], ms: Date.now() - started,
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  // one plain object per row, the binding's value only: nothing downstream cares
  // whether a term arrived as a uri or a literal, and keeping the distinction
  // here would push it into every caller.
  const rows = json.results.bindings.map((b) => {
    const row = {};
    for (const [k, v] of Object.entries(b)) row[k] = v.value;
    return row;
  });
  return { ok: true, status: res.status, rows, ms: Date.now() - started };
}

/** The sessions in <account>/mcp, newest first. */
export async function listSessions({ host, account, token, limit = 50, fetchImpl }) {
  const query = `PREFIX mcp: <${MCP_NS}>
SELECT ?session ?repository ?created ?lastActive ?version ?active
WHERE {
  GRAPH ?session {
    ?session a mcp:Exploration .
    OPTIONAL { ?session mcp:repository ?repository }
    OPTIONAL { ?session mcp:created    ?created }
    OPTIONAL { ?session mcp:lastActive ?lastActive }
    OPTIONAL { ?session mcp:version    ?version }
    OPTIONAL { ?session mcp:activeNode ?active }
  }
}
LIMIT ${Number(limit) || 50}`;
  const res = await sparql({ host, account, token, query, fetchImpl });
  if (!res.ok) return res;
  const sessions = res.rows.map((r) => ({
    uri: r.session,
    id: String(r.session || "").split("/").pop(),
    repository: r.repository || null,
    created: universalToDate(r.created),
    lastActive: universalToDate(r.lastActive),
    version: r.version ? Number(r.version) : null,
    activeNode: r.active ? String(r.active).split("#").pop() : null,
  }));
  // newest first; a session with no timestamp sorts last rather than first
  sessions.sort((a, b) => (b.lastActive?.getTime() ?? -1) - (a.lastActive?.getTime() ?? -1));
  return { ...res, sessions };
}

/**
 * One session: its header and its nodes in the order they were made.
 *
 * `parent` makes the tree, and `name` (n1, n2, …) is the order the operations
 * ran, so the log reads as a sequence while still showing where a branch left
 * the trunk.
 */
export async function readSession({ host, account, token, sessionUri, fetchImpl }) {
  const uri = String(sessionUri || "");
  const query = `PREFIX mcp: <${MCP_NS}>
SELECT ?s ?p ?o
WHERE { GRAPH <${uri}> { ?s ?p ?o } }`;
  const res = await sparql({ host, account, token, query, fetchImpl });
  if (!res.ok) return res;

  const local = (v) => String(v || "").replace(/^.*[#/]/, "");
  const header = {};
  const nodes = new Map();
  for (const { s, p, o } of res.rows) {
    const key = local(p);
    if (s === uri) { header[key] = o; continue; }
    if (!nodes.has(s)) nodes.set(s, { uri: s, name: local(s) });
    nodes.get(s)[key] = o;
  }

  const ordinal = (n) => {
    const m = /(\d+)$/.exec(n.name || "");
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const list = [...nodes.values()]
    .filter((n) => local(n.type) === "Node" || n.operation || n.name)
    .map((n) => ({
      uri: n.uri,
      name: n.name,
      operation: n.operation ? local(n.operation) : null,
      status: n.status ? local(n.status) : null,
      startedAt: universalToDate(n.startedAt),
      parent: n.parent ? local(n.parent) : null,
      resultCount: n.resultCount != null ? Number(n.resultCount) : null,
      alias: n.alias || null,
      shape: n.shape || null,
      parameters: n.parameters || null,
      suggestions: n.suggestions || null,
    }))
    .sort((a, b) => ordinal(a) - ordinal(b));

  // depth from the parent chain, so the presentation can indent a branch
  const byName = new Map(list.map((n) => [n.name, n]));
  for (const node of list) {
    let depth = 0, at = node;
    const guard = new Set();
    while (at?.parent && !guard.has(at.name)) { guard.add(at.name); at = byName.get(at.parent); depth += 1; }
    node.depth = depth;
  }

  return {
    ...res,
    session: {
      uri,
      id: uri.split("/").pop(),
      repository: header.repository || null,
      created: universalToDate(header.created),
      lastActive: universalToDate(header.lastActive),
      version: header.version ? Number(header.version) : null,
      root: header.root ? local(header.root) : null,
      activeNode: header.activeNode ? local(header.activeNode) : null,
      nodes: list,
    },
  };
}

export default { listSessions, readSession, sessionRepository, universalToDate };
