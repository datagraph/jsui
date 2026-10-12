/**
 * MCP transport for the jsui prompt pane.
 *
 * Ported from the engineering prototype (spocq/gensrc/mcp/client/mcp-client.js),
 * with its DOM coupling removed: the prototype wrote its transcript straight
 * into the page as it went.  Here a call returns a record and the pane decides
 * how to show it, because the pane shows several calls in several tabs.
 *
 * The protocol is stateless by design (revision 2026-07-28): no initialize, no
 * session id.  Every call is one POST carrying `_meta`, with the method mirrored
 * into a header so that an intermediary can route without parsing the body.
 */

export const MCP_PROTOCOL_VERSION = "2026-07-28";

const META = (version) => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientInfo": { name: "dydra-jsui", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
});

/**
 * One JSON-RPC call.  Returns {ok, status, request, response, message, error},
 * never throws: a transcript of a failed call is as interesting as of a good one.
 */
export async function mcpCall({ endpoint, token, method, params = {}, name,
                                version = MCP_PROTOCOL_VERSION, fetchImpl }) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method,
    params: { ...params, _meta: META(version) },
  });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "MCP-Protocol-Version": version,
    "Mcp-Method": method,
  };
  if (token) headers.Authorization = "Bearer " + token;
  if (name) headers["Mcp-Name"] = name;

  // The transport is injectable so that the tool-call loop can be exercised
  // without a network: in the browser this is simply window.fetch.
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  const started = Date.now();
  let res, text;
  try {
    res = await doFetch(endpoint, { method: "POST", headers, body });
    text = await res.text();
  } catch (e) {
    return {
      ok: false, status: 0, request: body, response: "", message: null,
      // A page not served by the host it calls is refused on the Origin header,
      // before any of this reaches the protocol; that reads as a network failure.
      error: `${e}. If this page is not served by the host it calls, the endpoint `
           + `refuses the request on the Origin header before the protocol sees it.`,
      ms: Date.now() - started,
    };
  }
  let message = null;
  try { message = JSON.parse(text); } catch { /* a non-JSON body is still shown */ }
  const failed = !message || message.error || (message.result && message.result.isError);
  return {
    ok: !failed, status: res.status, request: body, response: text, message,
    error: failed ? (message?.error?.message || `HTTP ${res.status}`) : null,
    ms: Date.now() - started,
  };
}

/** The notation payload of a result — content[0].resource.text. */
export function payloadOf(message) {
  const result = message && message.result;
  if (!result) return null;
  const content = result.content && result.content[0];
  if (!content) return null;
  if (content.resource && typeof content.resource.text === "string") return content.resource.text;
  if (typeof content.text === "string") return content.text;
  return null;
}

/**
 * The SPARQL a response compiled to, or null.
 *
 * Two shapes are accepted.  MCP answers carry the query as the notation payload
 * when the request asked for `sparql`.  An LLM answers in prose with the query
 * in a fenced block, so that is read too -- the pane treats both the same way,
 * because what matters downstream is the query, not which side produced it.
 */
export function sparqlFrom(textOrMessage) {
  const text = typeof textOrMessage === "string" ? textOrMessage : payloadOf(textOrMessage);
  if (!text) return null;
  const fenced = text.match(/```(?:sparql|sq)?\s*\n([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // A query, not a shape: it must actually start like one.
  return /^\s*(PREFIX|BASE|SELECT|CONSTRUCT|ASK|DESCRIBE)\b/i.test(candidate) ? candidate : null;
}

/** `server/discover`, then the survey tool's connect — the prototype's handshake. */
export async function connect({ endpoint, token, fetchImpl }) {
  const discover = await mcpCall({ endpoint, token, method: "server/discover", fetchImpl });
  const survey = await mcpCall({
    endpoint, token, method: "tools/call", name: "survey", fetchImpl,
    params: { name: "survey", arguments: { op: "connect" } },
  });
  return { discover, survey };
}

/** Run one survey operation.  `body` is the notation the operation reads. */
export async function runOperation({ endpoint, token, op, body, mimeType, fetchImpl }) {
  return mcpCall({
    endpoint, token, method: "tools/call", name: "survey", fetchImpl,
    params: {
      name: "survey",
      arguments: { op, ...(body ? { body } : {}), ...(mimeType ? { mimeType } : {}) },
    },
  });
}

/** Derive {account, repository} from a `…/{account}/{repository}/mcp` endpoint. */
export function endpointParts(endpoint) {
  const m = String(endpoint || "").match(/\/([^/]+)\/([^/]+)\/mcp\/?$/);
  return m ? { account: m[1], repository: m[2] } : null;
}

/** The MCP endpoint for a repository on a host. */
export function endpointFor(host, account, repository) {
  return `${String(host || "").replace(/\/$/, "")}/${encodeURIComponent(account)}`
       + `/${encodeURIComponent(repository)}/mcp`;
}
