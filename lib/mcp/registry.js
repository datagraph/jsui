/**
 * The MCP connections a session holds, in one place (§34.4).
 *
 * Until now there were two unrelated ways to reach a repository's MCP
 * resource and neither knew about the other.  An exploration pane called
 * `connect' itself, kept `connected' and `session' in its own pane state, and
 * offered an editable endpoint; the location bar derived an endpoint from the
 * host, used the signed-in token, and handed the tool adapter a `sessions'
 * Map that lived for the length of one run.  Four things followed, all of them
 * visible:
 *
 *   1. The same repository could carry two live explorations at once, with
 *      two handles and two transcripts, and nothing said so.
 *   2. A run started anywhere but the pane could not continue the pane's
 *      exploration, and a second run could not continue the first: every run
 *      re-connected and re-read the server's primer.
 *   3. An endpoint typed into a pane -- a proxy, a second host -- was the
 *      pane's private opinion and reached nothing else.
 *   4. No surface could ASK what was connected, so a surface that wanted to
 *      offer a choice of stores had nothing to offer from.
 *
 * This module is the answer to (4) and therefore to the rest.  A connection is
 * keyed by `<account>/<repository>' because the service has one MCP resource
 * per repository and authorizes it there: that part was always right and is
 * kept.  What changes is that the connection is no longer a pane's.  A pane
 * presents one -- its button, its handshake, its calls (and that presentation
 * stays in the repository's pane, where the repository is) -- while the thing
 * being presented lives here, where a second surface can find it.
 *
 * Nothing is written anywhere.  Like `lib/app/connection.js' and like
 * `AuthStore', this is memory for the life of the page: the token is the
 * session's and a reload asks for it again.
 */

import { connect as mcpConnect, endpointFor } from "./mcp-client.js";

const CONNECTIONS = new Map();
const LISTENERS = new Set();

/** `<account>/<repository>' -- the id the adapter routes on and the user reads. */
export const idFor = (account, repository) => `${account}/${repository}`;

/**
 * The fields a pane presents.  Named rather than inferred, for the same reason
 * `CONNECTION_FIELDS' is: a field added here and not listed would be set on a
 * pane and invisible to the registry, which is the bug this module ends.
 */
export const MCP_FIELDS = Object.freeze([
  "mcpEndpoint",   // where the resource is; editable, and the edit is shared
  "token",         // the host token this account signed in with
  "connected",     // null = not tried, true/false = the last attempt
  "connectText",   // the handshake, as the pane showed it
  "session",       // the live exploration handle, carried between runs
]);

const blank = (account, repository, host) => ({
  id: idFor(account, repository), account, repository,
  mcpEndpoint: endpointFor(host, account, repository),
  token: null,
  connected: null,
  connectText: "",
  connectedAt: null,
  session: null,
});

/** Tell the surfaces that the set, or a state in it, has changed. */
function notify() {
  for (const fn of [...LISTENERS]) {
    try { fn(connections()); } catch { /* a listener that throws is its own problem */ }
  }
}

/** Watch the registry.  Returns a function that stops watching. */
export function onConnections(fn) {
  if (typeof fn !== "function") return () => {};
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

/**
 * The connection for one repository, made on first ask.
 *
 * `host' is only consulted when the entry is made: an endpoint typed into a
 * pane afterwards is the user's word and is not overwritten by a later caller
 * that happens to know the default.
 */
export function mcpConnectionFor(account, repository, host) {
  const key = idFor(account, repository);
  if (!CONNECTIONS.has(key)) {
    CONNECTIONS.set(key, blank(account, repository, host));
    notify();
  }
  return CONNECTIONS.get(key);
}

/** One by id, without making it. */
export function mcpConnection(id) {
  return CONNECTIONS.get(String(id || "")) || null;
}

/** Every connection the session has made, in the order it made them. */
export function connections() {
  return [...CONNECTIONS.values()];
}

/** Those whose last handshake succeeded -- what a chooser should offer. */
export function connectedConnections() {
  return connections().filter((c) => c.connected === true);
}

/**
 * One connection in the shape the tool adapter routes on (§34.3).
 *
 * The same shape `paneStore' produced, which is why that function is now one
 * line: a pane and the location bar hand the adapter the same kind of thing,
 * and they always should have.
 */
export function storeFor(conn) {
  if (!conn || !conn.mcpEndpoint) return null;
  return { account: conn.account, repository: conn.repository,
           endpoint: conn.mcpEndpoint, token: conn.token };
}

/** Several of them, for a turn that crosses a repository boundary. */
export function storesFor(ids = []) {
  return ids.map((id) => storeFor(mcpConnection(id))).filter(Boolean);
}

/**
 * Perform the handshake and record what came of it.
 *
 * The pane used to own this: it called `connect', kept the two answers as
 * text, and set its own chip.  The call is here now so that whichever surface
 * presses the button, every other surface sees the result -- which is the
 * whole point of a registry and the reason the chooser in the exploration
 * pane can list what is reachable without connecting anything itself.
 */
export async function connectMcp(conn, { fetchImpl, format = null } = {}) {
  if (!conn) return { ok: false, error: "no connection" };
  conn.connected = null;
  notify();
  let discover, survey;
  try {
    ({ discover, survey } = await mcpConnect({ endpoint: conn.mcpEndpoint,
                                               token: conn.token, fetchImpl }));
  } catch (e) {
    conn.connected = false;
    conn.connectText = String(e);
    notify();
    return { ok: false, error: String(e) };
  }
  const ok = Boolean(discover.ok && survey.ok);
  conn.connected = ok;
  conn.connectedAt = ok ? new Date().toISOString() : conn.connectedAt;
  conn.connectText = typeof format === "function"
    ? format({ discover, survey })
    : `server/discover HTTP ${discover.status}\n${discover.response}\n\n`
    + `survey op=connect HTTP ${survey.status}\n${survey.response}`;
  notify();
  return { ok, discover, survey,
           error: ok ? null : (discover.error || survey.error || "connect failed") };
}

/* ── the exploration handles ─────────────────────────────────────────────── */

/**
 * The handle store the tool adapter reads and writes (§34.4.3).
 *
 * The adapter kept a `Map' made inside `createToolAdapter', so a handle lived
 * exactly as long as one run.  It now takes this instead: a handle opened by
 * the pane's first run is carried into the bar's next one, because they are
 * the same exploration of the same repository and the service files them that
 * way.  `get'/`set' is deliberately the whole interface -- the adapter must
 * not be able to enumerate the session's connections.
 */
export function sessionStore() {
  return {
    get: (id) => mcpConnection(id)?.session || null,
    // A null clears it, and that is not a nicety: a handle the store has
    // disowned must not outlive the run that discovered it, or the next run
    // opens with a handle that is already refused (§34.5).
    set: (id, session) => {
      const conn = mcpConnection(id);
      if (!conn) return;
      if (!session) { if (conn.session) { conn.session = null; notify(); } return; }
      if (conn.session !== session) { conn.session = session; notify(); }
    },
  };
}

export function setSession(id, session) { sessionStore().set(id, session); }

export function forgetMcpConnection(account, repository) {
  if (CONNECTIONS.delete(idFor(account, repository))) notify();
}

/** Sign-out, and the tests. */
export function forgetAll() {
  CONNECTIONS.clear();
  notify();
}

/**
 * Give `state' the connection's fields, by reference.
 *
 * The same device `attachConnection' uses, for the same reason: a pane's
 * controls write `st.mcpEndpoint = …' on a change event, and a copy would
 * make the pane the owner again the moment anything was typed.
 */
export function attachMcp(state, account, repository, host) {
  const conn = mcpConnectionFor(account, repository, host);
  for (const field of MCP_FIELDS) {
    delete state[field];
    Object.defineProperty(state, field, {
      enumerable: true, configurable: true,
      get: () => conn[field],
      set: (v) => { conn[field] = v; },
    });
  }
  return state;
}

export default mcpConnectionFor;
