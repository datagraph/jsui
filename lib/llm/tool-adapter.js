/**
 * The tool-call adapter: the browser-side loop that lets a model reach the
 * repository, and only through MCP.
 *
 * The model has no data of its own and no line to the store.  It asks for a tool
 * call; the call comes back here; this module POSTs it to /{a}/{r}/mcp with the
 * account's own token, hands the payload back, and asks again.
 *
 * One turn, several repositories (§34.3; A-16(a)).
 *
 * A turn used to carry one `mcp: {endpoint, token}', so an analysis that
 * crossed two repositories could not be asked for anywhere.  It now carries a
 * SET of stores, and the routing is in the tool name: with one store the tools
 * are named as the server names them and nothing is different, and with more
 * than one each tool is offered once per repository under a qualified name --
 * `survey__alice__sales' -- which this module resolves back to a bare tool and
 * an endpoint before it relays the call.
 *
 * The name is the whole mechanism, and that is a deliberate choice between two.
 * The service offers exactly one MCP resource, `/:account/:repository/mcp',
 * authorized per repository, and its tools take no repository argument: the
 * store IS the endpoint.  Routing by tool name needs no change there and keeps
 * the authorization decision on the resource, where the service makes it.  The
 * alternative -- a repository argument answered by an account-level endpoint --
 * would move that decision onto an argument, which is a larger change in the
 * place where it matters most.
 *
 * Each repository keeps its own exploration session: a handle is an exploration
 * of one store and means nothing in another.  Every event a call produces names
 * the repository it went to, so a cross-repository answer is attributable store
 * by store rather than in aggregate.
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

/**
 * What the model is told when its rounds are gone and it is asked once more
 * with no tools offered.  Written as a fact rather than as a request, because
 * it is one: the tools are not in that request, so there is nothing to refuse.
 */
export const CLOSING_TURN =
  "The round budget for tool calls is now spent, and no tools are offered on "
+ "this turn: there is nothing further to call. Write your answer now, from "
+ "what the calls above actually returned, in the form the brief asks for. "
+ "What you did not get to is not a failure to apologise for -- say it under "
+ "Not established, specifically enough that the next run knows where to "
+ "start, and do not present as found anything you had only planned to look "
+ "for.";

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

/* ── the stores a turn carries (§34.3) ────────────────────────────────────── */

/** How a qualified tool name is built.  Two underscores, never one. */
export const STORE_SEPARATOR = "__";

/** Anthropic's ceiling, and the smallest of the providers' — so, the ceiling. */
const MAX_TOOL_NAME = 64;

const safe = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * One store, in the shape the loop wants.
 *
 * `id' is `account/repository' and is what the user, the disclosure and the
 * record all call it; `slug' is the same thing spelled for a tool name.
 */
export function storeOf(entry = {}) {
  const account = entry.account == null ? null : String(entry.account);
  const repository = entry.repository == null ? null : String(entry.repository);
  const id = entry.id || (account && repository ? `${account}/${repository}` : null);
  return {
    id, account, repository,
    endpoint: entry.endpoint || null,
    token: entry.token ?? null,
    slug: id ? safe(id.replace("/", STORE_SEPARATOR)) : null,
  };
}

/**
 * The stores a `mcp' argument names.
 *
 * Three shapes are accepted, and the first is the one every existing caller
 * passes: `{endpoint, token}' is one unnamed store and behaves exactly as it
 * did -- same tool names, same single session, same events but for the
 * `repository' field, which is null.  `{repositories: [...]}' and a bare array
 * are the new ones.
 */
export function normalizeStores(mcp) {
  if (!mcp) return [];
  const many = Array.isArray(mcp) ? mcp : (Array.isArray(mcp.repositories) ? mcp.repositories : null);
  if (many) return many.filter((e) => e && e.endpoint).map(storeOf);
  return mcp.endpoint ? [storeOf(mcp)] : [];
}

/**
 * The name one tool is offered under, for one store.
 *
 * Unqualified when the turn carries a single store: a model that can only
 * reach one repository should not be made to read a name that says which.
 * Truncated from the TOOL end rather than the store end, because two stores
 * whose names collide after truncation would route to one another, and a
 * truncated tool name only costs legibility.
 */
export function toolNameFor(tool, store, { qualify = true } = {}) {
  const bare = String(tool);
  if (!qualify || !store || !store.slug) return bare;
  const room = MAX_TOOL_NAME - STORE_SEPARATOR.length - store.slug.length;
  const head = room >= 3 ? bare.slice(0, room) : bare.slice(0, 3);
  return `${head}${STORE_SEPARATOR}${store.slug}`.slice(0, MAX_TOOL_NAME);
}

/**
 * What the model is told about the stores it may reach (REQ-34.3.3).
 *
 * Only when there is more than one: a single-store turn has nothing to choose
 * between, and a paragraph explaining a choice that does not exist is context
 * spent on confusion.
 */
export function repositoriesNote(stores, routed = []) {
  if (stores.length < 2) return "";
  const lines = [
    "### The repositories this turn may read",
    "",
    "You may read more than one repository here. Each has its own tools, and the",
    "tool name says which repository the call goes to. A tool not listed here does",
    "not exist for this turn.",
    "",
  ];
  for (const store of stores) {
    const names = routed.filter((r) => r.store.id === store.id).map((r) => r.name);
    lines.push(`- **${store.id}** — ${names.length ? names.map((n) => `\`${n}\``).join(", ") : "no tools offered"}`);
  }
  lines.push("",
    "Each repository is a separate exploration: a session handle from one means",
    "nothing in another, and the interface carries each for you. State which",
    "repository a figure came from whenever your answer draws on more than one.");
  return lines.join("\n");
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

/** The tool whose `op=connect' opens an exploration, and whose handle goes stale. */
export const SESSION_TOOL = "survey";

/**
 * A result that says the handle it was given is not a handle any more (§34.5).
 *
 * The service issues a handle from `op=connect' and states how long it is good
 * for -- `cached_for_minutes: 30' -- and then refuses it on the very next
 * call: "Unknown exploration session: <handle>. It may have expired; call
 * survey with op=connect for a new handle."  Observed against all three stores
 * of a live run on 2026-11-16, seconds after the handles were issued.
 *
 * That is the service's defect and is reported as one.  But a client that
 * merely relays the refusal turns it into the model's problem, and the model
 * spends a round rediscovering what the message already said; worse, now that
 * a handle outlives the run that opened it (§34.4.3), a dead handle is carried
 * into the NEXT run and kills its first call too.  So the message is read:
 * matching the server's own words, not a status code, because it arrives as a
 * 200 with `isError'.
 */
export function staleSession(text) {
  return /unknown exploration session|exploration session (?:is )?(?:unknown|expired|not found)|no such exploration|call survey with op=connect for a new handle/i
    .test(String(text || ""));
}

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
export async function relayToolCall({ endpoint, token, fetchImpl, model = null }, call) {
  const res = await mcpCall({
    endpoint, token, method: "tools/call", name: call.name, fetchImpl,
    params: { name: call.name, arguments: call.input || {} },
    // AI Act Art. 50 (§2.6 R-P1): this call was ISSUED BY A MODEL, and the
    // endpoint cannot see which.  Only tools/call carries it — a tools/list
    // or a primer read is the interface's own housekeeping and has no model
    // behind it, and marking those would record a model for work it did not do.
    model,
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
  mcp,                                   // {endpoint, token}, or {repositories: [...]}
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
  /**
   * A way out, checked between rounds (§35).
   *
   * An analysis across two stores is tens of calls and minutes of waiting,
   * and until now the only way to end one early was to leave the page --
   * which loses the transcript with it.  `stop' is asked before each round
   * and before each relayed call; a truthy answer ends the run as an ERROR
   * with that reason, not as a success with a short answer, because a run
   * the user cut short has not answered the question and must not be filed
   * as though it had.
   */
  stop = null,
  /**
   * Where the exploration handles live, when they outlive the run (§34.4.3).
   *
   * A `{get(id), set(id, session)}' -- `lib/mcp/registry.js' returns one from
   * `sessionStore()'.  Omitted, the run keeps its handles to itself, which is
   * what every caller did before there was a registry to keep them in and
   * what the tests still do.  Given one, a handle opened by an earlier run of
   * the SAME repository is carried into this one rather than a second
   * exploration being opened beside the first.
   */
  sessions: sessionStore = null,
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

  // The stores this turn may reach (§34.3).  One is the ordinary case and
  // behaves exactly as it did; several is what makes an analysis across a
  // repository boundary askable.
  const stores = normalizeStores(mcp);
  const qualify = stores.length > 1;
  let toolCache = null;      // [{name, store, tool}] — the routing table
  // One exploration per store, keyed by `account/repository' (and by "" for
  // the single unnamed store).  A handle is an exploration of one repository
  // and carries no meaning in another, so there is no "the" session.
  const sessions = new Map();
  let primer = null;         // the server's own documentation, read once
  const sessionKey = (store) => (store && store.id) || "";

  /**
   * The handle to send with a call to `store', from this run or an earlier one.
   *
   * Read through to the registry on first use and cached per run afterwards,
   * so that the store is consulted once per repository rather than once per
   * call; written through on every open, so the next run -- in this pane, in
   * another pane, or from the location bar -- continues the same exploration.
   */
  function heldSession(store) {
    const key = sessionKey(store);
    if (sessions.has(key)) return sessions.get(key);
    let carried = null;
    try { carried = sessionStore?.get?.(key) || null; } catch { carried = null; }
    if (carried) sessions.set(key, carried);
    return carried;
  }

  function keepSession(store, session) {
    sessions.set(sessionKey(store), session);
    try { sessionStore?.set?.(sessionKey(store), session); } catch { /* not fatal */ }
  }

  /**
   * Forget a handle, here and wherever it outlives the run.
   *
   * The registry has to be told too: a handle the store has disowned is worse
   * than no handle, because the next run would open with it and lose its first
   * call to a refusal it could have avoided.
   */
  function dropSession(store) {
    sessions.delete(sessionKey(store));
    try { sessionStore?.set?.(sessionKey(store), null); } catch { /* not fatal */ }
  }

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

  /** The reason the run should end now, or null. */
  function halted() {
    if (typeof stop !== "function") return null;
    let answer = null;
    try { answer = stop(); } catch { return null; }
    if (!answer) return null;
    return typeof answer === "string" ? answer : "stopped by the user";
  }

  async function run(promptText) {
    const events = [];
    const messages = [{ role: "user", content: String(promptText ?? "") }];
    emit(events, { type: "prompt", text: promptText, model: chosenModel, provider: location.id,
                   wire: provider.id, url });

    let tools = [];
    /**
     * Why the model was not asked at all (§34.5), or null.
     *
     * A brief that says "through the MCP tools offered below" and then offers
     * none does not produce a refusal; it produces a plan.  Observed on
     * 2026-11-16: the model wrote "Let me see what operations are available"
     * and named a tool nobody has -- which the pane then presented as the
     * answer, under a footer reading `0 calls', as though the run had
     * succeeded.  A question about data the run cannot read has no answer the
     * model could give, so it is not asked.
     */
    let blocked = null;
    if (stores.length && provider.supportsTools) {
      if (!toolCache) {
        const routed = [];
        const taken = new Set();
        // One tools/list per store.  Not one for all of them: two
        // repositories may be of different classes and offer different
        // tools, and assuming otherwise would offer the model a tool the
        // second store does not have.
        for (const store of stores) {
          const listed = await listTools({ endpoint: store.endpoint, token: store.token,
                                           fetchImpl: doFetch });
          const { tools: kept, withheld } = selectTools(listed.tools, allowTools);
          for (const tool of kept) {
            let name = toolNameFor(tool.name, store, { qualify });
            // A collision can only happen when two slugs truncate alike; the
            // counter keeps the table one-to-one, which is what routing needs.
            let n = 1;
            while (taken.has(name)) name = `${toolNameFor(tool.name, store, { qualify })}_${++n}`;
            taken.add(name);
            routed.push({ name, store, tool: tool.name,
                          spec: { ...tool, name,
                                  description: qualify
                                    ? `[${store.id}] ${tool.description || ""}`.trim()
                                    : tool.description } });
          }
          emit(events, {
            type: "tools", ok: listed.ok && kept.length > 0, ms: listed.res.ms,
            repository: store.id, endpoint: store.endpoint,
            names: kept.map((t) => toolNameFor(t.name, store, { qualify })), withheld,
            ...(listed.ok && kept.length ? {}
                : { error: listed.res.error
                        || (listed.tools.length ? `none of ${listed.tools.length} offered tools is allowed`
                                                : "tools/list returned no tools") }),
          });
        }
        toolCache = routed;
      }
      tools = toolCache.map((r) => provider.toolSpec(r.spec));
      if (!toolCache.length) {
        blocked = `no store offered a usable tool: `
          + `${stores.map((st) => st.id || st.endpoint).join(", ")}. `
          + `The model was not asked. Check the tools/list entries above: a `
          + `store that could not be reached says so there, and one that was `
          + `reached but offers nothing this run may use says that instead.`;
        emit(events, { type: "error", where: "tools", error: blocked });
      }
      // Offered only when there is something for it to serve: with digesting
      // off every payload already arrived whole, and a tool that can only
      // answer "you already have it" is a line of context for nothing.
      if (digestOver > 0) tools.push(provider.toolSpec(RESULT_FULL_TOOL));

      if (primer === null && primeWith.length) {
        const docs = [];
        // Read from the first store only.  `score://operations' and
        // `score://grammar' document the notation and the operations, not the
        // data, and they are the same document at every endpoint: reading
        // them once per repository would spend about 1400 tokens per store to
        // say the same thing again.
        const from = stores[0];
        for (const uri of primeWith) {
          const r = await readResource({ endpoint: from.endpoint, token: from.token,
                                         fetchImpl: doFetch }, uri);
          // The document travels with the event, not just its length.  It is
          // the schema half of what the model was shown -- the notation and
          // the operations it read before it saw a row of data -- and a record
          // that keeps the answer but not the rules it was derived under
          // cannot be audited.  The pane shows the character count; the
          // transcript keeps the text.
          emit(events, { type: "primer", uri, ok: r.ok, ms: r.res.ms,
                         repository: from.id,
                         chars: r.text ? r.text.length : 0, text: r.text ?? null,
                         ...(r.ok ? {} : { error: r.res.error || "unreadable" }) });
          if (r.ok) docs.push(`--- ${uri} ---\n${r.text}`);
        }
        // The stores come before the documentation: which repositories this
        // turn may read is the first thing the model needs, and a note buried
        // after 1400 tokens of grammar is a note that was not read.
        const note = repositoriesNote(stores, toolCache);
        const head = note ? `${system}\n\n${note}` : system;
        primer = docs.length ? `${head}\n\n${docs.join("\n\n")}` : head;
      } else if (primer === null) {
        const note = repositoriesNote(stores, toolCache);
        primer = note ? `${system}\n\n${note}` : system;
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
    // How many calls actually reached a store.  Counted because `iterations'
    // does not say it: a run can take a turn, call nothing and end, and that
    // is the one outcome a caller must not report as an answer.
    let callsMade = 0;
    /**
     * Stores that refused a handle they had just issued (§34.5).
     *
     * One recovery per store, not one per call.  A store whose fresh handle is
     * refused on the next request will refuse the one after that too -- that is
     * what nl4 did on 2026-11-16, three stores, every round -- and reconnecting
     * again costs a call out of the grant to learn the same thing.  So it is
     * learned once, and after that the refusal goes straight back to the model,
     * which can then say what it could not establish instead of spending the
     * budget on handles.
     */
    const hopeless = new Set();
    let iterations = 0, finalText = "", lastError = null, roundsExhausted = false;
    let stopReason = null, lastTurnText = "", lastResponse = "", textFromTurn = 0;
    let servedModel = null;
    if (blocked) lastError = blocked;
    while (!blocked && iterations < maxIterations) {
      const before = halted();
      if (before) {
        lastError = before;
        emit(events, { type: "stopped", where: "round", iteration: iterations + 1,
                       error: before });
        break;
      }
      iterations += 1;
      const reply = await ask(messages, tools);
      if (!reply.ok) {
        lastError = reply.error;
        emit(events, { type: "error", where: "provider", status: reply.status,
                       ms: reply.ms, error: reply.error, response: reply.response });
        break;
      }
      const { text, toolCalls, stopReason: stopReason_, usage, assistantMessage } = reply.read;
      // Article 50 provenance (§2.6, R-P1): the identifier the provider
      // SERVED, kept per turn and as the run's answer.  Recording the model
      // that was asked for would record the request, not the fact.
      if (reply.read.model) servedModel = reply.read.model;
      // The request body travels with the turn it produced.  A transcript that
      // shows an answer without what was asked is half a record, and the half
      // that is missing is the one that explains the answer.
      emit(events, { type: "assistant", text, stopReason: stopReason_, usage, ms: reply.ms,
                     iteration: iterations, toolCalls: toolCalls.length,
                     request: reply.request, response: reply.response,
                     model: reply.read.model || chosenModel });
      stopReason = stopReason_ || null;
      lastTurnText = text || "";
      lastResponse = reply.response || "";
      if (text) { finalText = text; textFromTurn = iterations; }

      if (!toolCalls.length) break;

      // One message, or (Responses) the list of output items it is replayed as.
      messages.push(...[].concat(assistantMessage));
      const results = [];
      for (const call of toolCalls) {
        // Which store this call is for (§34.3).  The name is the routing, so
        // a name that is not in the table is refused HERE -- and the refusal
        // goes back to the model as a tool result, not to the user as a
        // failure: the model named a repository the turn does not carry, and
        // it is the one that can correct it (REQ-34.3.3).
        const route = call.name === RESULT_FULL
          ? null
          : (toolCache || []).find((r) => r.name === call.name);
        if (!route && call.name !== RESULT_FULL) {
          const offered = (toolCache || []).map((r) => r.name).join(", ") || "(none)";
          const text = `There is no tool \`${call.name}' in this turn. `
                     + `The tools you may call are: ${offered}. `
                     + `The name says which repository the call goes to.`;
          results.push({ id: call.id, name: call.name, input: call.input, ok: false, text,
                         res: { ms: 0, status: 0, request: "", error: "unrouted tool name" } });
          emit(events, { type: "tool_result", id: call.id, name: call.name, ok: false,
                         ms: 0, status: 0, text, input: call.input, request: "",
                         iteration: iterations, unrouted: true });
          continue;
        }
        const store = route ? route.store : (stores[0] || null);
        const carried = !sessions.has(sessionKey(store));
        const session = heldSession(store);
        // A handle the registry was already holding is announced the first
        // time it is used, because a transcript that shows no `session' event
        // reads as a run that opened none -- and this one did not open it, it
        // joined it.
        if (session && carried) {
          emit(events, { type: "session", session, carried: true,
                         repository: store ? store.id : null });
        }
        // One exploration per repository: the handle from that store's first
        // reply is carried into every later call to the SAME store that the
        // model did not give one for.  Carrying it across stores would hand
        // one repository's exploration to another, which resolves to nothing.
        const sent = session && call.input && !call.input.session
          ? { ...call, input: { ...call.input, session } }
          : call;
        emit(events, { type: "tool_call", id: sent.id, name: sent.name,
                       repository: store ? store.id : null,
                       tool: route ? route.tool : sent.name,
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
        // Screened under the name the SERVER knows (§34.3).  The allow-list
        // and the grant are both written in the server's tool names, and the
        // qualified name is this side's routing: screening the qualified one
        // would refuse every call in a two-repository turn, which is a
        // sentence that would have read as policy and was arithmetic.
        const screened = route ? { ...sent, name: route.tool } : sent;
        if (!grant && screenArguments) {
          const why = argumentRefusal(screened, { tools: allowTools });
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
          const verdict = grant.check(screened);
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

        const during = halted();
        if (during) {
          const text = `This call was not made: ${during}.`;
          results.push({ id: call.id, name: call.name, input: sent.input, ok: false, text,
                         res: { ms: 0, status: 0, request: "", error: during } });
          emit(events, { type: "tool_result", id: call.id, name: call.name, ok: false,
                         ms: 0, status: 0, text, input: sent.input, request: "",
                         iteration: iterations, refused: during });
          continue;
        }

        const whoCalls = { endpoint: store.endpoint, token: store.token, fetchImpl: doFetch,
            // The model that ISSUED this call -- the turn's served identifier,
            // which is known by now because the turn it came from has answered.
            model: { served: servedModel, requested: chosenModel,
                     provider: location.id } };
        let relayed = await relayToolCall(
          whoCalls,
          // The server knows the tool by its own name; the qualified one is
          // this side's routing and is put back before the result is reported,
          // because that is the name the model called and must see answered.
          { ...sent, name: route ? route.tool : sent.name });

        // The handle was refused (§34.5).  Open a new exploration and make the
        // call again -- once.  Not twice: a handle refused a second time is a
        // store that will not hold one, and the refusal then belongs to the
        // model and to the user, who can read it and stop.  The reconnect and
        // the repeat are both charged to the grant like any other call, and
        // both appear in the transcript, because a run that quietly made three
        // calls where the model asked for one is not a run anybody can audit.
        if (!relayed.ok && sent.input && sent.input.session && staleSession(relayed.text)) {
          const opener = (toolCache || []).find(
            (r) => r.store && store && r.store.id === store.id && r.tool === SESSION_TOOL);
          const mayOpen = !grant
            || grant.check({ name: SESSION_TOOL, input: { op: "connect" } }).ok;
          const give = hopeless.has(sessionKey(store));
          emit(events, { type: "session_lost", id: call.id, name: sent.name,
                         repository: store ? store.id : null,
                         session: sent.input.session, iteration: iterations,
                         recovering: Boolean(opener && mayOpen && !give),
                         exhausted: give, text: relayed.text });
          dropSession(store);
          if (opener && mayOpen && !give) {
            const reopened = await relayToolCall(
              whoCalls, { id: `${call.id}-reconnect`, name: SESSION_TOOL,
                          input: { op: "connect" } });
            // It reached the store, so it counts: a recovery spends the budget
            // like anything else, and a count that hid it would understate
            // what the run cost.
            callsMade += 1;
            const fresh = reopened.ok ? sessionFrom(reopened.text) : null;
            emit(events, { type: "tool_result", id: `${call.id}-reconnect`,
                           name: opener.name, ok: Boolean(fresh),
                           repository: store ? store.id : null,
                           ms: reopened.res.ms, status: reopened.res.status,
                           text: reopened.text, input: { op: "connect" },
                           request: reopened.res.request, iteration: iterations,
                           reconnect: true });
            if (fresh) {
              keepSession(store, fresh);
              emit(events, { type: "session", session: fresh, reopened: true,
                             repository: store ? store.id : null });
              const again = { ...sent, input: { ...sent.input, session: fresh } };
              const screenedAgain = route ? { ...again, name: route.tool } : again;
              if (!grant || grant.check(screenedAgain).ok) {
                relayed = await relayToolCall(whoCalls, screenedAgain);
                callsMade += 1;   // the repeat reached the store too
                emit(events, { type: "session_retry", id: call.id, name: sent.name,
                               repository: store ? store.id : null,
                               ok: relayed.ok, session: fresh, iteration: iterations });
                // It was reopened and refused anyway: this store does not hold
                // the handles it issues, and nothing this run does will change
                // that.  Say it once, to the model, and stop paying for it.
                if (!relayed.ok && staleSession(relayed.text)) {
                  hopeless.add(sessionKey(store));
                  relayed = { ...relayed, text: `${relayed.text}\n\n`
                    + `This handle was issued by op=connect immediately before this `
                    + `call, and refused anyway: ${store && store.id ? store.id : "this store"} `
                    + `is not holding explorations at the moment. Reconnecting again will `
                    + `not help. Work from what you already have, or say under Not `
                    + `established that this repository could not be read.` };
                }
              }
            }
          }
        }
        const result = { ...relayed, name: sent.name };
        if (!session) {
          const opened = sessionFrom(result.text);
          if (opened) {
            keepSession(store, opened);
            emit(events, { type: "session", session: opened,
                           repository: store ? store.id : null });
          }
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
                         repository: store ? store.id : null,
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

        callsMade += 1;
        results.push({ ...result, text: shown });
        emit(events, {
          type: "tool_result", id: call.id, name: call.name, ok: result.ok,
          repository: store ? store.id : null,
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
        roundsExhausted = true;
        emit(events, { type: "error", where: "loop", error: lastError });
      }
    }

    /**
     * The closing turn: asked once more, with no tools (§35.5).
     *
     * A run that used its last round on a tool call ended here with an error
     * and nothing to show -- the tool results of that last call were in the
     * conversation and no one had ever been asked to read them.  Measured on
     * a real model against two live stores: twenty-six rounds of inventory,
     * label searches and a materialised query, and then `stopped after 26
     * tool rounds', with the whole of the work discarded.  The budget bounds
     * what may be SPENT; it was never meant to decide whether the question
     * gets answered.
     *
     * So when the rounds run out, the model is asked one more time with the
     * tools withheld.  It cannot call anything, and the only thing left to do
     * with a turn is to write.  That is what a person told `time is up' does,
     * and it answers from the evidence actually gathered rather than from a
     * guess about what another ten rounds might have found.
     *
     * Not for a run the user stopped.  A stop means the user no longer wants
     * the answer, and squeezing one more provider call out of a cancelled run
     * would spend their money after they said to stop.
     */
    if (roundsExhausted && !halted()) {
      // Anthropic requires alternating roles, and the conversation ends with
      // a user turn carrying tool_result blocks -- so the instruction joins
      // THAT turn as a further block rather than becoming a second user
      // message, which the API refuses.  Chat Completions ends on per-call
      // `tool' messages instead, where an ordinary user message is correct.
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push({ type: "text", text: CLOSING_TURN });
      } else {
        messages.push({ role: "user", content: CLOSING_TURN });
      }
      const closing = await ask(messages, []);
      if (closing.ok) {
        const text = closing.read.text;
        if (closing.read.model) servedModel = closing.read.model;
        emit(events, { type: "assistant", text, closing: true,
                       stopReason: closing.read.stopReason, usage: closing.read.usage,
                       ms: closing.ms, iteration: iterations + 1, toolCalls: 0,
                       request: closing.request, response: closing.response,
                       model: closing.read.model || chosenModel });
        if (text) {
          finalText = text;
          textFromTurn = iterations + 1;
          lastTurnText = text;
          lastResponse = closing.response || "";
          stopReason = closing.read.stopReason || null;
          // The run answered. That it answered against the clock is reported
          // by `roundsExhausted', not by withholding the answer.
          lastError = null;
        }
      } else {
        emit(events, { type: "error", where: "closing", status: closing.status,
                       ms: closing.ms, error: closing.error, response: closing.response });
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
    emit(events, { type: "done", iterations, calls: callsMade,
                   roundsExhausted, sparql: Boolean(sparql),
                   dashboard: Boolean(dashboard), figure: figure ? figure.kind : null,
                   error: lastError, stopReason, truncated,
                   ...(grant ? { grant: grant.state() } : {}) });
    return {
      ok: !lastError, iterations, finalText, sparql, dashboard, figure,
      // What reached a store.  Zero with no error is the case the panes have
      // to speak about: the model answered from nothing.
      calls: callsMade,
      // The exploration was cut short even if the answer was written: what
      // the report says is drawn from fewer calls than the model wanted.
      roundsExhausted,
      // The end of the run, for a caller that has to explain an absent answer:
      // `truncated' says the ceiling was reached, `textFromTurn' says whether
      // `finalText' is the last turn's own words or an older turn's.
      stopReason, truncated, textFromTurn,
      lastTurn: { iteration: iterations, text: lastTurnText,
                  stopReason, response: lastResponse },
      events, messages,
      // One store's handle under `session', as every caller has read it; the
      // whole set beside it, because a turn may now have several and a
      // transcript that keeps one of them keeps the wrong one.
      session: sessions.get(sessionKey(stores[0])) || null,
      sessions: Object.fromEntries(sessions),
      repositories: stores.map((st) => st.id).filter(Boolean),
      error: lastError, model: chosenModel, provider: location.id, wire: provider.id,
      // What to mark the answer with: the served identifier when there is one,
      // and the requested one only as a fallback, labelled as such by `served'.
      servedModel: servedModel || null, served: Boolean(servedModel),
      at: new Date().toISOString(),
      grant: grant ? grant.state() : null,
      payloads: Object.fromEntries([...payloads].map(([k, v]) => [k, v.text])),
    };
  }

  return { run, provider, model: chosenModel, endpoint: url };
}

export default createToolAdapter;
