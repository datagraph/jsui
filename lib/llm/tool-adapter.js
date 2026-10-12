/**
 * The tool-call adapter: the browser-side loop that lets a model reach the
 * repository, and only through MCP.
 *
 * The model has no data of its own and no line to the store.  It asks for a tool
 * call; the call comes back here; this module POSTs it to /{a}/{r}/mcp with the
 * account's own token, hands the payload back, and asks again.
 *
 * The calls are recorded.  They go to the same endpoint and the same session as a
 * hand-written operation, so they land in <account>/mcp with the rest; the
 * transcript is a view of that record, not a separate one.
 *
 * The tool definitions are not written here.  They are read from the server with
 * tools/list and handed to the provider, so an operation added to the survey tool
 * reaches the model without a change on this side.
 *
 * Which tools are offered, and why that is a choice.
 *
 * Access is the service's to enforce: every relayed call travels under the same
 * client agent authorization as the user's own, so a read-only agent cannot be
 * talked into a write by anything written here.  But what the service enforces
 * and what the pane should *offer* are different questions.  A live tools/list
 * answers with the whole surface -- query, graphql_mutate, sparql_update and a
 * long tail of deprecated spellings -- and the pane's credential is the user's
 * own session token, which may well write.  Offering a model a write tool it has
 * no reason to want is a poor default however well the far end is guarded, and
 * fifteen descriptions where one will do is also fifteen descriptions of context.
 *
 * So ALLOW_TOOLS names what is offered, and it holds `survey' alone: every one
 * of its operations is a read, and exploring is the whole of what the model is
 * being asked to do here -- the query it proposes is run by the user, from the
 * view editor, as operation 3 of the design.  Widen it deliberately, per pane,
 * if some other tool is genuinely wanted.
 */

import { mcpCall, payloadOf, sparqlFrom } from "../mcp/mcp-client.js";
import { providerFor } from "./providers.js";

export const DEFAULT_MAX_ITERATIONS = 8;

/** The tools offered to a model by default.  See the note above. */
export const ALLOW_TOOLS = ["survey"];

/**
 * The exploration handle, read out of a score payload.
 *
 * A survey reply opens with `session: "<uuid>"`, and an operation that omits it
 * starts a fresh exploration.  A model left to carry the handle itself will
 * sooner or later drop it, and the run then becomes several unrelated sessions
 * -- which costs the vocabulary cache, and scatters across <account>/mcp the
 * record that is supposed to be one session's.  So the adapter holds it.
 *
 * The payload is score notation, not JSON -- its keys are unquoted -- so this
 * reads the one field it needs rather than pretending to parse the notation.
 */
export function sessionFrom(text) {
  const m = /\bsession\s*:\s*"([^"]+)"/.exec(String(text || ""));
  return m ? m[1] : null;
}

/** Deprecated spellings announce themselves; they are never worth the context. */
const deprecated = (tool) => /^\s*DEPRECATED\b/i.test(tool.description || "");

/**
 * Narrow a tools/list answer to what will be offered.  Returns the kept tools
 * and the names withheld, because a transcript should be able to say what was
 * left out rather than quietly showing a shorter list.
 */
export function selectTools(tools, allow = ALLOW_TOOLS) {
  const keep = [], withheld = [];
  for (const t of tools) {
    if (!deprecated(t) && (!allow || allow.includes(t.name))) keep.push(t);
    else withheld.push(t.name);
  }
  return { tools: keep, withheld };
}

export const DEFAULT_SYSTEM = [
  "You are exploring an RDF repository through the MCP `survey` tool.",
  "",
  "You have no direct access to the data: every fact you state about this",
  "repository must come from a tool call you made in this conversation. Do not",
  "guess at class names, predicate names or prefixes -- look them up.",
  "",
  "The operations and the notation they read are documented below, from the",
  "server itself. Follow them rather than inventing an operation or an argument:",
  "if what you want is not there, it is not available.",
  "",
  "When you have enough to answer, give the SPARQL query in a fenced ```sparql",
  "block, and say in one or two sentences what it returns and what you checked.",
].join("\n");

/**
 * What the model is told before it starts.
 *
 * The survey tool's own description ends by pointing at these two documents --
 * read score://grammar for the notation and score://operations for the
 * operations -- and a model that cannot reach them is left guessing. It guesses
 * badly and visibly: `scope: prefixes\' for a catalogue that takes types,
 * predicates or graphs; `{}\' as the body of an operation that wants a name.
 * Offering `resources/read\' as a tool would cost a round trip per document and
 * leave the reading optional. Reading them once, here, and putting them in the
 * system prompt costs about 1400 tokens and makes the rules the model is working
 * from the server\'s own.
 */
export const PRIMER_RESOURCES = ["score://operations", "score://grammar"];

/** One resource. `resources/read\' also wants the uri in the Mcp-Name header. */
export async function readResource({ endpoint, token, fetchImpl }, uri) {
  const res = await mcpCall({
    endpoint, token, method: "resources/read", name: uri,
    params: { uri }, fetchImpl,
  });
  const text = res.message?.result?.contents?.[0]?.text ?? null;
  return { ok: res.ok && typeof text === "string", uri, text, res };
}

/** The tools the server offers, as MCP descriptors. */
export async function listTools({ endpoint, token, fetchImpl }) {
  const res = await mcpCall({ endpoint, token, method: "tools/list", fetchImpl });
  const tools = res.message?.result?.tools;
  return { ok: res.ok && Array.isArray(tools), tools: Array.isArray(tools) ? tools : [], res };
}

/**
 * Relay one tool call to MCP.  Returns the shape toolResultMessage wants, plus
 * the whole record so the transcript can show the request as well as the reply.
 */
export async function relayToolCall({ endpoint, token, fetchImpl }, call) {
  const res = await mcpCall({
    endpoint, token, method: "tools/call", name: call.name, fetchImpl,
    params: { name: call.name, arguments: call.input || {} },
  });
  const text = payloadOf(res.message)
            ?? (res.ok ? res.response : (res.error || `HTTP ${res.status}`));
  return { id: call.id, name: call.name, input: call.input, ok: res.ok, text, res };
}

/**
 * Build an adapter.  `onEvent` is called as the loop proceeds so that a pane can
 * render a turn and its tool calls while they happen rather than at the end;
 * every event is also collected and returned.
 */
export function createToolAdapter({
  provider: providerId = "anthropic",
  endpoint, apiKey, workspaceId, model,
  mcp,                                   // {endpoint, token}
  system = DEFAULT_SYSTEM,
  maxTokens = 4096,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  allowTools = ALLOW_TOOLS,
  primeWith = PRIMER_RESOURCES,
  onEvent = () => {},
  fetchImpl,
} = {}) {
  const location = providerFor(providerId);
  const chosenModel = model || location.defaultModel;
  // A gateway names the wire shape and the URL per model; a provider is its own.
  const routed = location.route ? location.route(chosenModel, endpoint || location.defaultEndpoint) : null;
  const provider = routed ? routed.provider : location;
  const url = routed ? routed.url : (endpoint || location.defaultEndpoint);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  let toolCache = null;
  let session = null;        // the exploration the whole run belongs to
  let primer = null;         // the server's own documentation, read once

  const emit = (events, event) => {
    const e = { at: new Date().toISOString(), ...event };
    events.push(e);
    try { onEvent(e); } catch { /* a transcript that throws must not stop the loop */ }
    return e;
  };

  /** One call to the provider.  Never throws; a failure is a readable record. */
  async function ask(messages, tools) {
    const body = provider.request({ model: chosenModel, system: primer ?? system,
                                    messages, tools, maxTokens });
    const started = Date.now();
    let status = 0, text = "";
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: provider.headers({ apiKey, workspaceId }),
        body: JSON.stringify(body),
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      // A request a page may not make fails as a bare TypeError; say what it
      // most likely means rather than leaving "Failed to fetch" to be decoded.
      const hint = e instanceof TypeError
        ? " -- the location may not accept requests from a browser page (CORS)" : "";
      return { ok: false, status: 0, ms: Date.now() - started, request: body,
               response: "", error: `${String(e)}${hint}`, read: null };
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* a non-JSON body is still shown */ }
    const read = json ? provider.read(json) : null;
    const ok = status >= 200 && status < 300 && read && !read.error;
    return {
      ok, status, ms: Date.now() - started, request: body, response: text, read,
      error: ok ? null : (read?.error || `HTTP ${status}`),
    };
  }

  async function run(promptText) {
    const events = [];
    const messages = [{ role: "user", content: String(promptText ?? "") }];
    emit(events, { type: "prompt", text: promptText, model: chosenModel, provider: location.id,
                   wire: provider.id, url });

    let tools = [];
    if (mcp && mcp.endpoint && provider.supportsTools) {
      if (!toolCache) {
        const listed = await listTools({ ...mcp, fetchImpl: doFetch });
        const { tools: kept, withheld } = selectTools(listed.tools, allowTools);
        toolCache = kept;
        emit(events, {
          type: "tools", ok: listed.ok && kept.length > 0, ms: listed.res.ms,
          names: kept.map((t) => t.name), withheld,
          ...(listed.ok && kept.length ? {}
              : { error: listed.res.error
                      || (listed.tools.length ? `none of ${listed.tools.length} offered tools is allowed`
                                              : "tools/list returned no tools") }),
        });
      }
      tools = toolCache.map((t) => provider.toolSpec(t));

      if (primer === null && primeWith.length) {
        const docs = [];
        for (const uri of primeWith) {
          const r = await readResource({ ...mcp, fetchImpl: doFetch }, uri);
          emit(events, { type: "primer", uri, ok: r.ok, ms: r.res.ms,
                         chars: r.text ? r.text.length : 0,
                         ...(r.ok ? {} : { error: r.res.error || "unreadable" }) });
          if (r.ok) docs.push(`--- ${uri} ---\n${r.text}`);
        }
        primer = docs.length ? `${system}\n\n${docs.join("\n\n")}` : system;
      }
    }

    let iterations = 0, finalText = "", lastError = null;
    while (iterations < maxIterations) {
      iterations += 1;
      const reply = await ask(messages, tools);
      if (!reply.ok) {
        lastError = reply.error;
        emit(events, { type: "error", where: "provider", status: reply.status,
                       ms: reply.ms, error: reply.error, response: reply.response });
        break;
      }
      const { text, toolCalls, stopReason, usage, assistantMessage } = reply.read;
      // The request body travels with the turn it produced.  A transcript that
      // shows an answer without what was asked is half a record, and the half
      // that is missing is the one that explains the answer.
      emit(events, { type: "assistant", text, stopReason, usage, ms: reply.ms,
                     iteration: iterations, toolCalls: toolCalls.length,
                     request: reply.request, response: reply.response });
      finalText = text || finalText;

      if (!toolCalls.length) break;

      // One message, or (Responses) the list of output items it is replayed as.
      messages.push(...[].concat(assistantMessage));
      const results = [];
      for (const call of toolCalls) {
        // One run is one exploration: the handle from the first reply is carried
        // into every later call the model did not give one for.
        const sent = session && call.input && !call.input.session
          ? { ...call, input: { ...call.input, session } }
          : call;
        emit(events, { type: "tool_call", id: sent.id, name: sent.name,
                       input: sent.input, iteration: iterations,
                       ...(sent !== call ? { sessionAdded: session } : {}) });
        const result = await relayToolCall({ ...mcp, fetchImpl: doFetch }, sent);
        if (!session) {
          session = sessionFrom(result.text);
          if (session) emit(events, { type: "session", session });
        }
        results.push(result);
        emit(events, {
          type: "tool_result", id: call.id, name: call.name, ok: result.ok,
          ms: result.res.ms, status: result.res.status, text: result.text,
          input: sent.input, request: result.res.request, iteration: iterations,
        });
      }
      // One message for Messages, one per call for Chat Completions.
      messages.push(...[].concat(provider.toolResultMessage(results)));

      if (iterations >= maxIterations) {
        lastError = `stopped after ${maxIterations} tool rounds`;
        emit(events, { type: "error", where: "loop", error: lastError });
      }
    }

    const sparql = sparqlFrom(finalText);
    emit(events, { type: "done", iterations, sparql: Boolean(sparql), error: lastError });
    return {
      ok: !lastError, iterations, finalText, sparql, events, messages, session,
      error: lastError, model: chosenModel, provider: location.id, wire: provider.id,
    };
  }

  return { run, provider, model: chosenModel, endpoint: url };
}

export default createToolAdapter;
