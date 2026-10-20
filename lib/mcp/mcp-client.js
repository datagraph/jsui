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

/**
 * The notation payload of a result, AND the media type it arrived under.
 *
 * Work item U-10.  The embedded resource carries a `mimeType' -- it is how the
 * server says which of the notations it compiled in this answer is written in
 * -- and this function used to drop it one line before the only consumer that
 * would have read it.  The model then received a document with no statement of
 * what it was, and had to infer the notation from its first line: which works
 * for turtle and for TSV, and does not for score, for CSV against TSV, or for
 * an empty result in any of them.
 *
 * It matters more once the model is choosing the notation (D-L).  A request
 * for `text/csv' that is answered in TSV because the server does not encode
 * CSV for that query form is a thing the model can only notice if it is told
 * what it got.  So the pair is returned and the caller decides; nothing is
 * inferred here.
 */
export function payloadOf(message) {
  const result = message && message.result;
  if (!result) return null;
  const content = result.content && result.content[0];
  if (!content) return null;
  const resource = content.resource;
  if (resource && typeof resource.text === "string") {
    return { text: resource.text, mimeType: resource.mimeType || null };
  }
  if (typeof content.text === "string") {
    return { text: content.text, mimeType: content.mimeType || null };
  }
  return null;
}

/** Just the text, for the callers that only ever wanted that. */
export function payloadTextOf(message) {
  const p = payloadOf(message);
  return p ? p.text : null;
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
  const text = typeof textOrMessage === "string" ? textOrMessage : payloadTextOf(textOrMessage);
  if (!text) return null;
  const fenced = text.match(/```(?:sparql|sq)?\s*\n([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // A query, not a shape: it must actually start like one.
  return /^\s*(PREFIX|BASE|SELECT|CONSTRUCT|ASK|DESCRIBE)\b/i.test(candidate) ? candidate : null;
}

/** The two forms a figure may take.  SVG is drawn; DOT describes a graph. */
export const FIGURE_KINDS = ["svg", "dot"];

/**
 * The figure a turn produced, or null.  Work item U-15.
 *
 * Beside `sparqlFrom\' and for the same reason: the model answers in prose
 * with the artifact fenced inside it, and what matters downstream is the
 * artifact.  Three things are read rather than one, because all three are
 * needed before anything is shown to anyone:
 *
 *   kind      `svg\' renders; `dot\' is a description of a graph that this
 *             side cannot draw -- see lib/figure/frame.js -- and saying which
 *             it is, is the difference between a picture and a wall of text
 *             appearing where a picture was expected.
 *   caption   D-N keeps the figure with what it was drawn from, and a caption
 *             is the human half of that.  Taken from a `Caption:\' line so
 *             that it is the model\'s own sentence and not the pane guessing
 *             at one from the prose.
 *   complete  a turn cut off at the token limit still carries a fenced block,
 *             and a truncated SVG still PARTLY RENDERS.  That is the worst
 *             outcome available: a figure missing its last series looks like
 *             a figure, not like an error.  So completeness is decided from
 *             the text -- a closing `</svg>\', balanced braces for DOT -- and
 *             the pane refuses to present a figure that fails it.
 */
export function figureFrom(textOrMessage) {
  const text = typeof textOrMessage === "string" ? textOrMessage : payloadTextOf(textOrMessage);
  if (!text) return null;

  let kind = null, body = null;
  // The LAST fenced figure block, so that a prompt echoing an earlier attempt
  // does not win over the answer.  An unterminated fence is read too: that is
  // precisely the truncated case, and it has to be seen to be refused.
  const fence = /```(svg|dot|graphviz|xml)?[^\S\n]*\n([\s\S]*?)(?:```|$)/gi;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const lang = (m[1] || "").toLowerCase();
    const candidate = m[2].trim();
    if (lang === "svg" || /^<svg[\s>]/i.test(candidate)) { kind = "svg"; body = candidate; }
    else if (lang === "dot" || lang === "graphviz"
             || /^(strict\s+)?(di)?graph\b/i.test(candidate)) { kind = "dot"; body = candidate; }
    else if (lang === "xml" && /<svg[\s>]/i.test(candidate)) { kind = "svg"; body = candidate; }
  }
  // An answer that forgot the fence but did write the element is still an
  // answer; refusing it on punctuation would be pedantry.
  if (!body) {
    const bare = /<svg[\s>][\s\S]*/i.exec(text);
    if (bare) { kind = "svg"; body = bare[0].trim(); }
  }
  if (!body) return null;

  const complete = kind === "svg"
    ? /<\/svg\s*>\s*$/i.test(body)
    : balanced(body);

  const cap = /^[ \t]*caption[ \t]*:[ \t]*(.+?)[ \t]*$/im.exec(text);
  return { kind, text: body, caption: cap ? cap[1].trim() : null, complete };
}

/** Braces matched, for DOT: the cheap completeness test the notation allows. */
function balanced(text) {
  let depth = 0;
  for (const c of text) {
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth < 0) return false; }
  }
  return depth === 0 && text.includes("{");
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
