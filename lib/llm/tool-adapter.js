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

import { mcpCall, payloadOf, sparqlFrom, figureFrom } from "../mcp/mcp-client.js";
import { providerFor, credentialNote } from "./providers.js";
import { digestResult, renderDigest } from "../mcp/result-digest.js";
import { dashboardFrom } from "../dashboard/spec.js";
import { argumentRefusal } from "./grant.js";

export const DEFAULT_MAX_ITERATIONS = 8;

/** The tools offered to a model by default.  See the note above. */
export const ALLOW_TOOLS = ["survey"];

/**
 * What a dashboard run offers instead.
 *
 * `query' joins the list because a dashboard is made OF queries: a model that
 * can only survey can describe a repository and must then guess at what its
 * own SPARQL would return.  The widening is safe in the way the note above
 * asks for -- deliberate, per pane, and for a stated reason -- and it is not
 * the thing standing between the model and a write.  That is the grant
 * (`lib/llm/grant.js'), which screens the ARGUMENTS: `query' with
 * `application/sparql-update' is refused before it is sent, and so is a body
 * whose operative keyword is a DELETE.  A name-only allow-list could not do
 * either, which is why both exist.
 */
export const DASHBOARD_TOOLS = ["survey", "query"];

/**
 * What a figure run offers.  Work item U-11.
 *
 * The same pair, for the same reason: a figure is drawn from a query, and a
 * model that can only survey must guess what its own SPARQL would return.
 * Written out rather than aliased to DASHBOARD_TOOLS because the two lists
 * answer different questions and may one day differ -- and a reader of either
 * should see the list, not a reference to the other one.
 *
 * What keeps `query' from being a write tool is NOT this list.  It is
 * `argumentRefusal' (lib/llm/grant.js), applied below to every relayed call
 * of an ungranted run: a `mimeType' of `application/sparql-update' is refused
 * before it is sent, and so is a body whose operative keyword is a DELETE.
 * A name-only allow-list cannot tell those from a SELECT, which is the whole
 * reason the screen is on the arguments.
 */
export const FIGURE_TOOLS = ["survey", "query"];

/**
 * The one tool this side answers itself.
 *
 * D-Q makes the shape of a result the default and the whole document a
 * request.  A request needs something to make it with, and inventing a server
 * operation for it would be wrong twice over: the document is already here,
 * in this process, and asking the store for it again would both cost a second
 * evaluation and risk answering from data that has moved since.  So the
 * adapter keeps what it relayed and serves it back on demand.
 *
 * The bytes are charged to the grant exactly as a fresh call would be.  "You
 * may read it again for free" would make the byte budget meaningless, since
 * the budget is about what reaches the model, not about what the store did.
 */
export const RESULT_FULL = "result_full";

export const RESULT_FULL_TOOL = {
  name: RESULT_FULL,
  description:
    "Return the whole of a result you were shown only the shape of. Takes the "
  + "label the shape carried (for example \"r3\"). Costs its own size against "
  + "your byte budget, so ask for the documents the analysis needs the values "
  + "of, not all of them.",
  inputSchema: {
    type: "object", required: ["of"],
    properties: { of: { type: "string", description: "the label, e.g. r3" } },
  },
};

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
  "",
  "That query is the one the interface will run, and it is read as the source of",
  "whatever you just reported. So if the figures in your answer came from",
  "somewhere else -- a catalogue operation, a survey, a different query -- say so",
  "plainly and do not present this one as where they came from. A table",
  "attributed to a query that was never run reads exactly like a table that came",
  "from one, and nobody downstream can tell them apart.",
  "",
  "And when the query you give is one you already ran, give it back EXACTLY as you",
  "sent it -- the `FROM` clause above all. A query that loses its dataset clause",
  "still parses and still looks right, but it reads the default graph instead of",
  "the one you explored, so it matches nothing and returns nothing.",
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
  const payload = payloadOf(res.message);
  const text = (payload ? payload.text : null)
            ?? (res.ok ? res.response : (res.error || `HTTP ${res.status}`));
  // U-10: the notation travels with the document.  It is read off the
  // embedded resource rather than assumed from the request, because the two
  // differ -- a form the server cannot encode as asked comes back as
  // something else, and only the answer says which.
  return { id: call.id, name: call.name, input: call.input, ok: res.ok, text,
           mimeType: payload ? payload.mimeType : null, res };
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
  grant = null,                          // lib/llm/grant.js, or ungoverned
  // U-11.  Applied only when there is no grant: where there IS one the grant
  // is the policy, including a grant the user deliberately made writable,
  // which a standing screen out here would silently override.
  screenArguments = true,
  digestOver = 0,                        // 0 keeps every payload whole (D-L)
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

  // What was relayed, so that `result_full' can answer from it (D-Q).  Keyed
  // by the label the digest announced; the full text is kept, not re-fetched.
  const payloads = new Map();
  let payloadSeq = 0;

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
    // A refused credential is the one error where the provider's own message
    // explains nothing.  "invalid x-api-key" is true and tells the user only
    // that the thing they are looking at is not what was sent -- so say what
    // WAS sent, which is the single fact that settles it.
    const why = ok ? null
      : (json?.error?.message || read?.error || `HTTP ${status}`)
        + ((status === 401 || status === 403)
            ? ` \u2014 ${credentialNote({ apiKey, workspaceId, provider: provider.id })}`
            : "");
    return {
      ok, status, ms: Date.now() - started, request: body, response: text, read,
      error: why,
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
      // Offered only when there is something for it to serve: with digesting
      // off every payload already arrived whole, and a tool that can only
      // answer "you already have it" is a line of context for nothing.
      if (digestOver > 0) tools.push(provider.toolSpec(RESULT_FULL_TOOL));

      if (primer === null && primeWith.length) {
        const docs = [];
        for (const uri of primeWith) {
          const r = await readResource({ ...mcp, fetchImpl: doFetch }, uri);
          // The document travels with the event, not just its length.  It is
          // the schema half of what the model was shown -- the notation and
          // the operations it read before it saw a row of data -- and a record
          // that keeps the answer but not the rules it was derived under
          // cannot be audited.  The pane shows the character count; the
          // transcript keeps the text.
          emit(events, { type: "primer", uri, ok: r.ok, ms: r.res.ms,
                         chars: r.text ? r.text.length : 0, text: r.text ?? null,
                         ...(r.ok ? {} : { error: r.res.error || "unreadable" }) });
          if (r.ok) docs.push(`--- ${uri} ---\n${r.text}`);
        }
        primer = docs.length ? `${system}\n\n${docs.join("\n\n")}` : system;
      }
    }

    // How the run ENDED is a separate fact from what it last said, and the
    // two used to be conflated.  `finalText' keeps the last turn that carried
    // text; a turn cut off at the output ceiling can carry none at all, and
    // then `finalText' silently reaches back to an earlier turn -- so the
    // caller is handed prose from turn 1 as though it were the answer.  That
    // reads to a user as "the model declined", which is a different event
    // from "the model was interrupted mid-answer" and calls for a different
    // remedy.  Both are reported, and which turn the text came from with them.
    let iterations = 0, finalText = "", lastError = null;
    let stopReason = null, lastTurnText = "", lastResponse = "", textFromTurn = 0;
    while (iterations < maxIterations) {
      iterations += 1;
      const reply = await ask(messages, tools);
      if (!reply.ok) {
        lastError = reply.error;
        emit(events, { type: "error", where: "provider", status: reply.status,
                       ms: reply.ms, error: reply.error, response: reply.response });
        break;
      }
      const { text, toolCalls, stopReason: stopReason_, usage, assistantMessage } = reply.read;
      // The request body travels with the turn it produced.  A transcript that
      // shows an answer without what was asked is half a record, and the half
      // that is missing is the one that explains the answer.
      emit(events, { type: "assistant", text, stopReason: stopReason_, usage, ms: reply.ms,
                     iteration: iterations, toolCalls: toolCalls.length,
                     request: reply.request, response: reply.response });
      stopReason = stopReason_ || null;
      lastTurnText = text || "";
      lastResponse = reply.response || "";
      if (text) { finalText = text; textFromTurn = iterations; }

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

        // The model asking for a document it has seen the shape of (D-Q).
        // Answered from what was relayed, never by asking the store again:
        // a second evaluation could answer from data that has since moved,
        // and the digest the model is holding would then describe nothing.
        if (call.name === RESULT_FULL) {
          const label = String(call.input?.of || "").trim();
          const held = payloads.get(label);
          const text = held
            ? held.text
            : `no result is held under \`${label}'. `
            + `Held: ${[...payloads.keys()].join(", ") || "(none yet)"}.`;
          if (held && grant) grant.chargeResult({ bytes: text.length, rows: 0 });
          const served = { id: call.id, name: call.name, input: call.input,
                           ok: Boolean(held), text,
                           res: { ms: 0, status: held ? 200 : 404, request: "", error: null } };
          results.push(served);
          emit(events, { type: "tool_result", id: call.id, name: call.name, ok: served.ok,
                         ms: 0, status: served.res.status, text,
                         input: call.input, request: "", iteration: iterations,
                         local: true, label, bytes: text.length });
          continue;
        }

        // The arguments, screened, when nothing else is screening them (U-11).
        // `selectTools' decided that `query' may be offered; it cannot decide
        // what `query' is then asked to do, because that is in an argument
        // and every value of it wears the same tool name.
        if (!grant && screenArguments) {
          const why = argumentRefusal(sent, { tools: allowTools });
          if (why) {
            const text = `This call was not made: ${why}. This run may only read.`;
            results.push({ id: call.id, name: call.name, input: sent.input, ok: false, text,
                           res: { ms: 0, status: 0, request: "", error: why } });
            emit(events, { type: "refused", id: call.id, name: call.name, input: sent.input,
                           reason: why, iteration: iterations });
            emit(events, { type: "tool_result", id: call.id, name: call.name, ok: false,
                           ms: 0, status: 0, text, input: sent.input, request: "",
                           iteration: iterations, refused: why });
            continue;
          }
        }

        // The grant decides whether this leaves the pane at all (D-O).  The
        // call count is charged HERE, before the call: a limit enforced after
        // the store has been read is not a limit, it is a complaint.
        if (grant) {
          const verdict = grant.check(sent);
          if (!verdict.ok) {
            const text = `This call was not made: ${verdict.reason}. `
                       + `The user can widen or revoke the grant; `
                       + `say what you still need rather than working around it.`;
            results.push({ id: call.id, name: call.name, input: sent.input, ok: false, text,
                           res: { ms: 0, status: 0, request: "", error: verdict.reason } });
            emit(events, { type: "refused", id: call.id, name: call.name, input: sent.input,
                           reason: verdict.reason, iteration: iterations,
                           grant: grant.state() });
            emit(events, { type: "tool_result", id: call.id, name: call.name, ok: false,
                           ms: 0, status: 0, text, input: sent.input, request: "",
                           iteration: iterations, refused: verdict.reason });
            continue;
          }
        }

        const result = await relayToolCall({ ...mcp, fetchImpl: doFetch }, sent);
        if (!session) {
          session = sessionFrom(result.text);
          if (session) emit(events, { type: "session", session });
        }

        // What the payload cost, and -- when there is more of it than a run of
        // a dozen panels can afford to read -- what the model is shown of it.
        // The pane and the transcript keep the whole thing either way: the
        // digest is what the MODEL saw, not a decision about what happened.
        const whole = result.text ?? "";
        let shown = whole;
        let digest = null, label = null;
        if (digestOver > 0 && whole.length > digestOver) {
          digest = digestResult(whole, result.mimeType || null);
          label = `r${++payloadSeq}`;
          payloads.set(label, { text: whole, digest: digest.digest, at: Date.now() });
          shown = renderDigest(digest, { name: label, howToAsk:
            `  This is the shape of ${label}, not its rows. Call ${RESULT_FULL} with `
          + `{"of": "${label}"} for the whole document when the analysis needs the values.` });
          emit(events, { type: "digest", id: call.id, label, bytes: whole.length,
                         rows: digest.rows, form: digest.form, digest: digest.digest,
                         shownBytes: shown.length, iteration: iterations });
        }
        // U-10, at the one place it is visible to the model: the notation is
        // stated above the document.  A reader who is choosing notations
        // (D-L) cannot otherwise tell CSV from TSV, nor notice that what
        // arrived is not what was asked for.
        if (result.ok && result.mimeType) shown = `[${result.mimeType}]\n${shown}`;
        if (grant) {
          grant.chargeResult({ bytes: shown.length,
                               rows: digest ? (digest.rows || 0) : 0 });
        }

        results.push({ ...result, text: shown });
        emit(events, {
          type: "tool_result", id: call.id, name: call.name, ok: result.ok,
          ms: result.res.ms, status: result.res.status, text: whole,
          mimeType: result.mimeType || null,
          input: sent.input, request: result.res.request, iteration: iterations,
          ...(label ? { shown, label, digest: digest.digest } : {}),
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
    // A dashboard proposal and a bare query are both "what the run produced";
    // which one it is depends on what was asked for, and the pane decides what
    // to do with either.  Read here rather than in the pane so that a run is
    // self-describing: its result says what it carries.
    const dashboard = dashboardFrom(finalText);
    // And a figure, by the same argument: a run asked to draw ends with one,
    // and whether it is COMPLETE is part of what `figureFrom' reports --
    // because a figure cut off at the token limit still renders, and a
    // half-drawn chart does not look half-drawn (U-15).
    const figure = figureFrom(finalText);
    const truncated = stopReason === "max_tokens";
    emit(events, { type: "done", iterations, sparql: Boolean(sparql),
                   dashboard: Boolean(dashboard), figure: figure ? figure.kind : null,
                   error: lastError, stopReason, truncated,
                   ...(grant ? { grant: grant.state() } : {}) });
    return {
      ok: !lastError, iterations, finalText, sparql, dashboard, figure,
      // The end of the run, for a caller that has to explain an absent answer:
      // `truncated' says the ceiling was reached, `textFromTurn' says whether
      // `finalText' is the last turn's own words or an older turn's.
      stopReason, truncated, textFromTurn,
      lastTurn: { iteration: iterations, text: lastTurnText,
                  stopReason, response: lastResponse },
      events, messages, session,
      error: lastError, model: chosenModel, provider: location.id, wire: provider.id,
      grant: grant ? grant.state() : null,
      payloads: Object.fromEntries([...payloads].map(([k, v]) => [k, v.text])),
    };
  }

  return { run, provider, model: chosenModel, endpoint: url };
}

export default createToolAdapter;
