/**
 * The tool-call adapter, exercised against a stub transport.
 *
 * The loop is the part that is easy to get wrong and expensive to test for real:
 * a live run costs a key, a repository and a model's goodwill, and tells you
 * little when it fails.  So the two wire shapes are stubbed -- the Messages API
 * and the MCP endpoint -- and what is asserted is the protocol between them:
 * that a tool_use comes back as a tools/call, that its payload returns as a
 * tool_result carrying the same id, that the conversation grows in the order the
 * API requires, and that a failed call is reported to the model rather than
 * thrown at the user.
 *
 * Loading note: jsui's package.json declares no "type", so node reads its .js as
 * CommonJS while the browser loads the same files as modules.  Rather than
 * change that for a test, the lib tree is copied into a scratch package that
 * does declare it -- which keeps the relative imports between the two modules
 * intact, unlike a data: URL.
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const scratch = mkdtempSync(join(tmpdir(), "jsui-adapter-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));

const {
  createToolAdapter, selectTools, ALLOW_TOOLS, sessionFrom,
  normalizeStores, toolNameFor, repositoriesNote, storeOf,
} = await import(pathToFileURL(join(scratch, "lib", "llm", "tool-adapter.js")).href);

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const MCP = "https://example.test/acct/repo/mcp";
const LLM = "https://api.anthropic.com/v1/messages";

const jsonResponse = (status, obj) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(obj),
});

/** An MCP tools/list reply carrying the survey tool. */
const toolsList = {
  jsonrpc: "2.0", id: 1,
  result: { tools: [
    { name: "survey",
      description: "Survey the repository: explore it, and record the exploration.",
      inputSchema: { type: "object", required: ["op"], properties: {
        op: { type: "string" }, body: { type: "string" }, session: { type: "string" },
      } } },
    { name: "sparql_update",
      description: "DEPRECATED — use query with mimeType application/sparql-update.",
      inputSchema: { type: "object", required: ["update"], properties: {
        update: { type: "string" },
      } } },
  ] },
};

/** An MCP resources/read reply. */
const resourceReply = (text) => ({
  jsonrpc: "2.0", id: 1, result: { contents: [{ type: "text", text }] },
});

/** An MCP tools/call reply whose payload is the notation text. */
const surveyReply = (text) => ({
  jsonrpc: "2.0", id: 1,
  result: { content: [{ type: "resource", resource: { text } }] },
});

/** A Messages API reply that asks for one tool call. */
const wantsTool = (id, input) => ({
  id: "msg_1", type: "message", role: "assistant", stop_reason: "tool_use",
  content: [
    { type: "text", text: "Let me look at what the repository declares." },
    { type: "tool_use", id, name: "survey", input },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
});

/** A Messages API reply that finishes with a query. */
const finishes = (text) => ({
  id: "msg_2", type: "message", role: "assistant", stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage: { input_tokens: 40, output_tokens: 30 },
});

const ANSWER = [
  "Those three predicates are the ones in use.",
  "",
  "```sparql",
  "SELECT ?name WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name } LIMIT 10",
  "```",
].join("\n");

/** Record every request, and reply from a scripted list. */
function stub(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers: init?.headers || {}, body });
    const next = script.shift();
    if (!next) throw new Error(`unscripted request to ${url}`);
    return next(url, body);
  };
  return { calls, fetchImpl };
}

// -------------------------------------------------- what is offered to a model

section("narrowing the server's tool list");
{
  // The names and shapes a live nl4 tools/list actually returns.  Thirteen of the
  // fifteen are deprecated spellings, and the surface includes writes.
  const live = [
    { name: "query", description: "Run one query against the RDF repository. The mimeType argument names the notation of `text'." },
    { name: "survey", description: "Survey the repository: explore it, and record the exploration." },
    { name: "graphql_query", description: "DEPRECATED — use query with mimeType application/graphql. Execute a GraphQL query." },
    { name: "graphql_mutate", description: "DEPRECATED — use query with mimeType application/graphql. Execute a GraphQL mutation." },
    { name: "sparql_select", description: "DEPRECATED — use query with mimeType application/sparql-query. Execute a SPARQL SELECT." },
    { name: "sparql_update", description: "DEPRECATED — use query with mimeType application/sparql-update. Execute a SPARQL UPDATE." },
    { name: "list_graphs", description: "DEPRECATED — read the resource rdf://REPOSITORY/graphs. List the named graphs." },
    { name: "orch_survey", description: "DEPRECATED — use survey with op=catalog." },
  ];

  const { tools, withheld } = selectTools(live);
  ok(tools.length === 1 && tools[0].name === "survey",
     "only survey is offered by default");
  ok(!withheld.includes("survey") && withheld.includes("sparql_update")
     && withheld.includes("graphql_mutate") && withheld.includes("query"),
     "the writing tools are withheld, and are named so a transcript can say so");
  ok(ALLOW_TOOLS.length === 1, "the default allow-list is one tool, not a policy engine");

  const widened = selectTools(live, ["survey", "query"]);
  ok(widened.tools.map((t) => t.name).join(",") === "query,survey",
     "it widens deliberately when a pane asks");
  ok(selectTools(live, null).tools.every((t) => !/DEPRECATED/.test(t.description)),
     "deprecated spellings are dropped even with no allow-list");
}

// ---------------------------------------------------------------- happy path

section("a prompt that needs one tool round");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("catalog\n  scope: types, predicates or graphs")),
    () => jsonResponse(200, resourceReply("Score notation — a simplified JSON variant.")),
    () => jsonResponse(200, wantsTool("toolu_01", { op: "catalog", body: "{ scope: predicates }" })),
    () => jsonResponse(200, surveyReply("predicates: foaf:name 120, foaf:mbox 118, rdf:type 120")),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);

  const seen = [];
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", model: "claude-opus-5",
    mcp: { endpoint: MCP, token: "repo-token" },
    fetchImpl, onEvent: (e) => seen.push(e.type),
  });
  const result = await adapter.run("Which people have an email address?");

  ok(calls.length === 6, "six requests: tools/list, two primer reads, ask, tools/call, ask");
  ok(calls[0].url === MCP && calls[0].body.method === "tools/list",
     "the tool definitions are read from the server, not written here");
  ok(calls[3].url === LLM && Array.isArray(calls[3].body.tools)
     && calls[3].body.tools.length === 1
     && calls[3].body.tools[0].name === "survey"
     && calls[3].body.tools[0].input_schema?.required?.[0] === "op",
     "inputSchema is handed to the provider as input_schema, and only survey is sent");
  ok(calls[3].headers["x-api-key"] === "sk-test"
     && calls[3].headers["anthropic-version"] === "2023-06-01"
     && calls[3].headers["anthropic-dangerous-direct-browser-access"] === "true",
     "the Messages API headers are the ones a browser needs");
  ok(calls[3].headers["anthropic-workspace-id"] === undefined,
     "no workspace header is sent when none is configured");

  const relay = calls[4];
  ok(relay.url === MCP && relay.body.method === "tools/call"
     && relay.body.params.name === "survey"
     && relay.body.params.arguments.op === "catalog",
     "the tool_use is relayed to MCP as a tools/call with its arguments intact");
  ok(relay.headers.Authorization === "Bearer repo-token",
     "the relay carries the account token, so the service enforces access");

  const second = calls[5].body.messages;
  ok(second.length === 3
     && second[0].role === "user" && second[1].role === "assistant"
     && second[2].role === "user",
     "the conversation grows user, assistant, user");
  ok(second[1].content.some((b) => b.type === "tool_use" && b.id === "toolu_01"),
     "the assistant's tool_use block is replayed verbatim");
  const toolResult = second[2].content[0];
  ok(toolResult.type === "tool_result" && toolResult.tool_use_id === "toolu_01"
     && /foaf:name/.test(toolResult.content),
     "the payload returns as a tool_result under the same id");
  ok(toolResult.is_error === undefined, "a successful result is not flagged as an error");

  ok(result.ok === true && result.iterations === 2, "the loop ran twice and succeeded");
  ok(/SELECT \?name/.test(result.sparql || ""), "the fenced query is extracted");
  ok(seen.join(",") === "prompt,tools,primer,primer,asking,assistant,tool_call,"
                      + "tool_result,asking,assistant,done",
     `the event sequence is the one a transcript renders (${seen.join(",")})`);
  // `asking' is emitted BEFORE the request it describes, which is the whole
  // of its usefulness: it is the only event a surface can show for the one
  // interval that produces none, and a surface with nothing to show there
  // leaves whatever it last said standing -- `reading the primer', for as
  // long as the model takes to answer.
  ok(seen.indexOf("asking") === seen.indexOf("assistant") - 1,
     "each turn is announced before it is awaited, not after it has arrived");

  ok(/scope: types, predicates or graphs/.test(calls[3].body.system)
     && /Score notation/.test(calls[3].body.system),
     "the server's own operations and grammar are in the system prompt");
  ok(result.events.filter((e) => e.type === "primer").every((e) => e.ok),
     "both primer documents were read");

  const toolsEvent = result.events.find((e) => e.type === "tools");
  ok(toolsEvent.withheld.includes("sparql_update"),
     "the withheld write tool is reported to the transcript");

  const call = result.events.find((e) => e.type === "tool_call");
  ok(call.input.body === "{ scope: predicates }",
     "the tool call event carries the operation body, so it can be lifted into the MCP editor");
}

// ------------------------------------------- an organization-scoped key

section("a key scoped to the organization");
{
  const { calls, fetchImpl } = stub([() => jsonResponse(200, finishes(ANSWER))]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-org", workspaceId: "wrkspc_abc123", mcp: null, fetchImpl,
  });
  await adapter.run("anything");
  ok(calls[0].headers["anthropic-workspace-id"] === "wrkspc_abc123",
     "the workspace is named, as an org-scoped key requires");
}

// ------------------------------------------------------------ a failed relay

section("an MCP call that fails");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("toolu_02", { op: "profile", body: "NoSuchType" })),
    () => jsonResponse(200, { jsonrpc: "2.0", id: 1,
                              error: { code: -32602, message: "unresolved name: NoSuchType" } }),
    () => jsonResponse(200, finishes("That type is not declared. " + ANSWER)),
  ]);

  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test",
    mcp: { endpoint: MCP, token: "repo-token" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("Profile NoSuchType");

  const toolResult = calls[3].body.messages[2].content[0];
  ok(toolResult.is_error === true, "a failed call is flagged is_error");
  ok(/unresolved name/.test(toolResult.content),
     "the model is told what went wrong, so it can correct itself");
  ok(result.ok === true && result.iterations === 2,
     "a failed tool call is not a failed run");
  const ev = result.events.find((e) => e.type === "tool_result");
  ok(ev.ok === false, "the transcript records the failure as such");
}

// --------------------------------------------------------- a failed provider

section("a provider that refuses");
{
  const { fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(401, { type: "error", error: { type: "authentication_error",
                                                      message: "invalid x-api-key" } }),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "wrong", mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("anything");
  ok(result.ok === false && /invalid x-api-key/.test(result.error || ""),
     "the key error is reported, not thrown");
  ok(result.events.some((e) => e.type === "error" && e.where === "provider"),
     "and it reaches the transcript as an error event");
}

// -------------------------------------------------------------- the ceiling

section("a model that will not stop calling tools");
{
  // Three rounds of calling, and then the closing turn: asked once more with
  // the tools withheld, which is the only thing that turns a spent budget
  // into an answer rather than into a discarded run (§35.5).
  const script = [() => jsonResponse(200, toolsList)];
  for (let i = 0; i < 3; i += 1) {
    script.push(() => jsonResponse(200, wantsTool(`toolu_${i}`, { op: "catalog" })));
    script.push(() => jsonResponse(200, surveyReply("…")));
  }
  script.push(() => jsonResponse(200, finishes("Written from three rounds of calls.")));
  const { calls, fetchImpl } = stub(script);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", maxIterations: 3,
    mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("loop forever");
  ok(result.iterations === 3, "the loop stops at maxIterations");
  ok(result.roundsExhausted === true, "and says that the budget, not the model, ended it");
  ok(calls.length === 1 + 3 * 2 + 1, "one further request is made: the closing turn");
  const closing = calls[calls.length - 1];
  ok(closing.body.tools === undefined,
     "which offers no tools at all, so there is nothing left to call");
  const lastMessage = closing.body.messages[closing.body.messages.length - 1];
  ok(lastMessage.role === "user"
     && JSON.stringify(lastMessage.content).includes("no tools are offered"),
     "the notice joins the existing user turn rather than becoming a second one");
  ok(/three rounds of calls/.test(result.finalText), "the answer is the closing turn's");
  ok(result.ok === true, "and the run answered, so it is not reported as a failure");
}

section("a closing turn that itself fails");
{
  // The answer is gone either way; what must not happen is that the run
  // reports success because the last call was never read.
  const script = [() => jsonResponse(200, toolsList)];
  for (let i = 0; i < 2; i += 1) {
    script.push(() => jsonResponse(200, wantsTool(`toolu_${i}`, { op: "catalog" })));
    script.push(() => jsonResponse(200, surveyReply("…")));
  }
  script.push(() => jsonResponse(500, { error: { message: "overloaded" } }));
  const { fetchImpl } = stub(script);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", maxIterations: 2,
    mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("loop forever");
  ok(result.ok === false, "the run is still a failure");
  ok(/2 tool rounds/.test(result.error || ""), "and still says the budget ran out");
  ok(result.events.some((e) => e.type === "error" && e.where === "closing"),
     "with the closing turn's own failure recorded beside it");
}

section("a run the user stopped does not get a closing turn");
{
  const script = [() => jsonResponse(200, toolsList)];
  for (let i = 0; i < 3; i += 1) {
    script.push(() => jsonResponse(200, wantsTool(`toolu_${i}`, { op: "catalog" })));
    script.push(() => jsonResponse(200, surveyReply("…")));
  }
  script.push(() => jsonResponse(200, finishes("should never be asked for")));
  const { calls, fetchImpl } = stub(script);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", maxIterations: 3,
    mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
    // Stopped exactly as the budget runs out -- the user's wish and the
    // ceiling arrive together, and the user's is the one that governs.
    // Counted in requests rather than in rounds because `stop' is consulted
    // before each relayed call as well as between rounds (§35.3).
    stop: () => (calls.length >= 1 + 3 * 2 ? "you stopped this" : null),
  });
  const result = await adapter.run("loop forever");
  ok(calls.length === 1 + 3 * 2,
     "no provider call is made after a stop — their money is not spent on it");
  ok(result.ok === false, "and the run is reported as stopped, not as answered");
}

// ------------------------------------------------- no MCP: a plain completion

section("no MCP endpoint configured");
{
  const { calls, fetchImpl } = stub([() => jsonResponse(200, finishes(ANSWER))]);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "sk-test", mcp: null, fetchImpl });
  const result = await adapter.run("just answer");
  ok(calls.length === 1 && calls[0].body.tools === undefined,
     "with no MCP the request carries no tools at all");
  ok(result.ok === true && Boolean(result.sparql), "and the answer is still read");
}

// ------------------------------------------------------- one run, one session

section("the exploration handle is carried, not left to the model");
{
  const PAYLOAD = '{\n  session: "4B488676-C30B-11F1-95F7-3BCB8CEB8DDD",\n'
                + '  node: "n1",\n  scope: predicates,\n  count: 18\n}';
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("t1", { op: "catalog", body: "{ scope: predicates }" })),
    () => jsonResponse(200, surveyReply(PAYLOAD)),
    () => jsonResponse(200, wantsTool("t2", { op: "profile", body: "Person" })),
    () => jsonResponse(200, surveyReply('{ session: "4B488676-C30B-11F1-95F7-3BCB8CEB8DDD", node: "n2" }')),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test",
    mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("profile the people");

  ok(result.session === "4B488676-C30B-11F1-95F7-3BCB8CEB8DDD",
     "the handle is read out of the first payload");
  ok(calls[2].body.params.arguments.session === undefined,
     "the first call has no handle to carry");
  ok(calls[4].body.params.arguments.session === result.session,
     "the second call is made in the same exploration");
  ok(calls[4].body.params.arguments.op === "profile",
     "and the model's own arguments are untouched");
  const added = result.events.find((e) => e.type === "tool_call" && e.sessionAdded);
  ok(Boolean(added), "the transcript records that the adapter supplied the handle");

  ok(sessionFrom('{ session: "ABC", node: "n1" }') === "ABC"
     && sessionFrom("no handle here") === null,
     "the handle is read from score notation, which is not JSON");
}

// a model that supplies its own handle must keep it
section("a model that carries its own handle");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("t1", { op: "catalog" })),
    () => jsonResponse(200, surveyReply('{ session: "AAA" }')),
    () => jsonResponse(200, wantsTool("t2", { op: "history", session: "BBB" })),
    () => jsonResponse(200, surveyReply('{ session: "BBB" }')),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  await adapter.run("look at the history");
  ok(calls[4].body.params.arguments.session === "BBB",
     "an explicit handle is never overwritten");
}

section("documentation that cannot be read");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, { jsonrpc: "2.0", id: 1,
                              error: { code: -32020, message: "Mcp-Name header is required" } }),
    () => jsonResponse(200, resourceReply("Score notation — a simplified JSON variant.")),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", mcp: { endpoint: MCP, token: "t" }, fetchImpl,
  });
  const result = await adapter.run("anything");
  ok(result.ok === true, "an unreadable document does not stop the run");
  ok(/Score notation/.test(calls[3].body.system),
     "the document that did read is still used");
  const bad = result.events.find((e) => e.type === "primer" && !e.ok);
  ok(Boolean(bad) && /Mcp-Name/.test(bad.error),
     "and the transcript says which one failed, and why");
}

// the uri must travel in the header, which is what a live server requires
section("the resource read carries Mcp-Name");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("ops")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", mcp: { endpoint: MCP, token: "t" }, fetchImpl,
  });
  await adapter.run("anything");
  ok(calls[1].headers["Mcp-Name"] === "score://operations"
     && calls[1].body.params.uri === "score://operations",
     "the uri is sent in the header as well as the body");
}

// ------------------------------------------------------------ Chat Completions

section("the same round through OpenAI Chat Completions");
{
  const OPENAI = "https://api.openai.com/v1/chat/completions";
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("ops")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, {
      id: "chatcmpl-1", object: "chat.completion",
      choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null,
        tool_calls: [
          { id: "call_a", type: "function",
            function: { name: "survey", arguments: '{"op":"catalog","body":"{ scope: types }"}' } },
          { id: "call_b", type: "function",
            function: { name: "survey", arguments: '{"op":"profile"}' } },
        ] } }],
    }),
    () => jsonResponse(200, surveyReply('session: "S-1"\ntypes: foaf:Person 4')),
    () => jsonResponse(200, surveyReply("profile: 4 subjects")),
    () => jsonResponse(200, {
      id: "chatcmpl-2", object: "chat.completion",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: ANSWER } }],
    }),
  ]);
  const adapter = createToolAdapter({
    provider: "openai", endpoint: OPENAI, apiKey: "sk-oa", workspaceId: "proj_1",
    model: "gpt-5", mcp: { endpoint: MCP, token: "t" }, fetchImpl,
  });
  const result = await adapter.run("Who is in here?");

  const first = calls[3];
  ok(first.url === OPENAI && first.headers.Authorization === "Bearer sk-oa"
     && first.headers["OpenAI-Project"] === "proj_1" && !first.headers["x-api-key"],
     "the key is a bearer token, and the workspace field names the project");
  ok(first.body.messages[0].role === "system" && first.body.messages[1].role === "user"
     && first.body.system === undefined,
     "the system prompt is the first message, not a field");
  ok(first.body.tools[0].type === "function" && first.body.tools[0].function.name === "survey"
     && first.body.tools[0].function.parameters.required[0] === "op",
     "a tool is a function whose parameters are the MCP input schema");
  ok(first.body.max_completion_tokens === 4096 && first.body.max_tokens === undefined,
     "the token limit is spelled as the current models want it");
  ok(calls[4].body.params.arguments.op === "catalog" && calls[5].body.params.arguments.op === "profile",
     "the arguments string is parsed, and each call is relayed in turn");
  ok(calls[5].body.params.arguments.session === "S-1",
     "the session handle from the first call is carried into the second");

  const msgs = calls[6].body.messages;
  ok(msgs.map((m) => m.role).join(",") === "system,user,assistant,tool,tool",
     "each result goes back as its own tool message");
  ok(msgs[2].tool_calls?.length === 2, "the assistant message is replayed with its tool_calls");
  ok(msgs[3].tool_call_id === "call_a" && msgs[4].tool_call_id === "call_b",
     "and each tool message answers its call by id");
  ok(result.ok && result.sparql && result.provider === "openai",
     "the run finishes with the query, as it does through Messages");
}

section("which provider a location speaks, and where it lists its models");
{
  const { providerForEndpoint, modelsEndpointFor, listModels } = await import(
    pathToFileURL(join(scratch, "lib", "llm", "providers.js")).href);
  ok(providerForEndpoint("https://api.anthropic.com/v1/messages").id === "anthropic"
     && providerForEndpoint("https://api.openai.com/v1/chat/completions").id === "openai",
     "a preset location names its provider");
  ok(providerForEndpoint("https://proxy.example/v1/messages").id === "anthropic"
     && providerForEndpoint("http://localhost:11434/v1/chat/completions").id === "openai",
     "another location is read by its path");
  ok(modelsEndpointFor("https://api.anthropic.com/v1/messages").startsWith("https://api.anthropic.com/v1/models")
     && modelsEndpointFor("https://api.openai.com/v1/chat/completions") === "https://api.openai.com/v1/models"
     && modelsEndpointFor("http://localhost:11434/v1/chat/completions") === "http://localhost:11434/v1/models",
     "models are listed at /v1/models beside the location");

  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, { data: [{ id: "claude-opus-5", display_name: "Claude Opus 5" }] }),
    () => jsonResponse(401, { error: { message: "invalid x-api-key" } }),
  ]);
  const listed = await listModels({ endpoint: "https://api.anthropic.com/v1/messages",
                                    apiKey: "k", fetchImpl });
  ok(listed.ok && listed.models[0].label === "Claude Opus 5"
     && calls[0].headers["x-api-key"] === "k" && !calls[0].headers["Content-Type"],
     "the Anthropic list is read with the key, by GET, and keeps the display names");
  const refused = await listModels({ endpoint: "https://api.anthropic.com/v1/messages",
                                     apiKey: "bad", fetchImpl });
  ok(!refused.ok && /^invalid x-api-key/.test(refused.error),
     "a refusal is returned, not thrown");
  ok(/3-character key ending \u2026bad,/.test(refused.error),
     "and the listing is where a bad key is usually met first, so it says what was sent");
}

// ------------------------------------------------------------------ OpenCode

section("OpenCode: one location, each model in its own shape");
{
  const BASE = "https://opencode.ai/inference";
  const plain = (reply) => stub([() => jsonResponse(200, reply)]);

  // Claude: Anthropic Messages, under the gateway's path, with its bearer key
  {
    const { calls, fetchImpl } = plain(finishes("hello"));
    const r = await createToolAdapter({ provider: "opencode", endpoint: BASE, apiKey: "oc-key",
                                        workspaceId: "org_1", model: "claude-sonnet-5",
                                        fetchImpl }).run("hi");
    ok(calls[0].url === `${BASE}/anthropic/v1/messages`, "a Claude model goes to /anthropic/v1/messages");
    ok(calls[0].headers.Authorization === "Bearer oc-key" && !calls[0].headers["x-api-key"]
       && calls[0].headers["anthropic-version"] === "2023-06-01"
       && calls[0].headers["X-Opencode-Org-Id"] === "org_1",
       "with the service-account key as a bearer token, and the organization if given");
    ok(calls[0].body.max_tokens === 4096 && typeof calls[0].body.system === "string",
       "in the Messages shape, max_tokens included as OpenCode requires");
    ok(r.ok && r.provider === "opencode" && r.wire === "anthropic", "and is read as Messages");
  }

  // a model served through Chat Completions
  {
    const { calls, fetchImpl } = plain({ choices: [{ finish_reason: "stop",
      message: { role: "assistant", content: "hello" } }] });
    const r = await createToolAdapter({ provider: "opencode", endpoint: BASE, apiKey: "k",
                                        model: "kimi-k2.6", fetchImpl }).run("hi");
    ok(calls[0].url === `${BASE}/openai/v1/chat/completions` && r.ok && r.finalText === "hello",
       "kimi, glm, minimax and the like go to /openai/v1/chat/completions");
  }

  // GPT: the Responses API, through a full tool round
  {
    const { calls, fetchImpl } = stub([
      () => jsonResponse(200, toolsList),
      () => jsonResponse(200, resourceReply("ops")),
      () => jsonResponse(200, resourceReply("grammar")),
      () => jsonResponse(200, { id: "resp_1", status: "completed", output: [
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "survey",
          arguments: '{"op":"catalog"}' },
      ] }),
      () => jsonResponse(200, surveyReply("types: foaf:Person 4")),
      () => jsonResponse(200, { id: "resp_2", status: "completed", output: [
        { type: "message", id: "msg_1", role: "assistant",
          content: [{ type: "output_text", text: ANSWER }] },
      ] }),
    ]);
    const r = await createToolAdapter({ provider: "opencode", endpoint: BASE, apiKey: "k",
                                        model: "gpt-5.5", mcp: { endpoint: MCP, token: "t" },
                                        fetchImpl }).run("who?");
    const first = calls[3];
    ok(first.url === `${BASE}/openai/v1/responses`, "a GPT model goes to /openai/v1/responses");
    ok(typeof first.body.instructions === "string" && Array.isArray(first.body.input)
       && first.body.input[0].role === "user" && first.body.max_output_tokens === 4096,
       "the system prompt is instructions, and the conversation is the input list");
    ok(first.body.tools[0].type === "function" && first.body.tools[0].name === "survey"
       && first.body.tools[0].parameters.required[0] === "op",
       "a tool is a flat function");
    ok(calls[4].body.params.arguments.op === "catalog", "the function_call is relayed to MCP");
    const input = calls[5].body.input;
    ok(input.map((i) => i.type || i.role).join(",") === "user,reasoning,function_call,function_call_output",
       "every output item is replayed, then the result as a function_call_output");
    ok(input[3].call_id === "call_1" && /foaf:Person/.test(input[3].output),
       "answering the call by its call_id");
    ok(r.ok && r.sparql && r.wire === "openai-responses", "and the run ends with the query");
  }

  const { providerFor, providerForEndpoint, modelsEndpointFor, presetProviders } = await import(
    pathToFileURL(join(scratch, "lib", "llm", "providers.js")).href);
  ok(presetProviders().map((p) => p.id).join(",") === "anthropic,openai,opencode",
     "it is offered as a third location");
  ok(providerForEndpoint(BASE).id === "opencode" && modelsEndpointFor(BASE) === `${BASE}/v1/models`,
     "whose models are listed at /inference/v1/models");
  const menu = providerFor("opencode").readModels({ data: [
    { id: "big-pickle-free" }, { id: "claude-opus-5" }, { id: "gemini-3.1-pro" },
    { id: "gpt-5.5" }, { id: "kimi-k2.6" } ] }).map((m) => m.id).join(",");
  ok(menu === "claude-opus-5,gpt-5.5,kimi-k2.6",
     "the menu leaves out Gemini (no adapter speaks it) and the free models (OpenCode's client only)");
}

section("a request the browser refuses is explained");
{
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  const r = await createToolAdapter({ provider: "opencode", apiKey: "k", model: "kimi-k2.6",
                                      fetchImpl }).run("hi");
  ok(!r.ok && /CORS/.test(r.error), "a TypeError from fetch names CORS as the likely cause");
}

section("a run says how it ENDED, not only what it last said");
{
  // The failure a live dashboard run found.  Seven turns of exploring, then a
  // final turn that reached the output ceiling while writing the page: the
  // block never closes, so nothing parses, and the turn carries no text the
  // adapter can keep.  `finalText' then reaches back to the last turn that
  // DID carry text -- turn 1, "I'll start by reading the vocabulary" -- and
  // the gate presented that opening line to the user as the model's answer.
  const opening = "I'll start by reading the vocabulary and cataloguing the repository.";
  const { fetchImpl } = stub([
    async () => jsonResponse(200, toolsList),
    async () => jsonResponse(200, {
      id: "m1", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "text", text: opening },
                { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog" } }],
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    async () => jsonResponse(200, surveyReply("a catalogue")),
    // The ceiling, reached mid-answer: the API cannot emit a block the model
    // did not finish, so the content comes back empty and the turn says why.
    async () => jsonResponse(200, {
      id: "m2", type: "message", role: "assistant", stop_reason: "max_tokens",
      content: [], usage: { input_tokens: 37989, output_tokens: 32000 },
    }),
  ]);
  const r = await createToolAdapter({
    provider: "anthropic", apiKey: "k", model: "claude-opus-5",
    mcp: { endpoint: MCP, token: "t" }, primeWith: [], fetchImpl,
  }).run("draw me a dashboard");

  ok(r.truncated === true && r.stopReason === "max_tokens",
     "the run reports that it was cut off at the ceiling, which is not the same as declining");
  ok(r.finalText === opening && r.textFromTurn === 1 && r.iterations === 2,
     "finalText is still the last turn that spoke, and says which turn that was");
  ok(r.lastTurn.text === "" && r.lastTurn.iteration === 2,
     "so a caller can tell that the LAST turn said nothing at all");
  ok(!r.dashboard,
     "and no dashboard was read, because an unclosed block is not a block");
  const done = r.events.find((e) => e.type === "done");
  ok(done.truncated === true && done.stopReason === "max_tokens",
     "the transcript carries the same verdict as the return");
}

section("a refused key is answered with what was sent");
{
  const { credentialNote } = await import(
    pathToFileURL(join(scratch, "lib", "llm", "providers.js")).href);

  // "invalid x-api-key" says the string sent is not a key, to a user looking
  // at a field holding a key.  Only the string settles it, and none of what
  // settles it is the secret part.
  const good = credentialNote({ apiKey: "sk-ant-api03-" + "x".repeat(80) + "AbC9" });
  ok(/97-character key ending \u2026AbC9/.test(good),
     "the length and the last four identify the key without disclosing it");
  ok(!/x{10}/.test(good), "and the key itself is not in the message");
  ok(/No workspace header went with it/.test(good),
     "the workspace header is reported too, because its absence is also an answer");

  ok(/non-printing character/.test(credentialNote({ apiKey: "sk-ant-api03-abc\u200bdef" })),
     "a zero-width character picked up in the copy is named");
  ok(/space or a non-printing/.test(credentialNote({ apiKey: "sk-ant-api03 abc" })),
     "and so is an interior space");
  ok(/Admin API key/.test(credentialNote({ apiKey: "sk-ant-admin01-abcd" })),
     "an Admin key is a key of the wrong kind, which no retry fixes");
  ok(/does not begin with/.test(credentialNote({ apiKey: "sess-01HQ…" })),
     "and a console session token is not an API key at all");
  ok(/no key was sent at all/.test(credentialNote({ apiKey: "" })),
     "an empty value is the one case the field cannot be showing");

  const { fetchImpl } = stub([
    async () => jsonResponse(401, { type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" } }),
  ]);
  const r = await createToolAdapter({ provider: "anthropic", apiKey: "sk-ant-api03-nope1234",
                                      model: "claude-opus-5", mcp: null, primeWith: [],
                                      fetchImpl }).run("hi");
  ok(!r.ok && /invalid x-api-key/.test(r.error) && /21-character key ending \u20261234/.test(r.error),
     "a 401 from the provider carries the note with it");

  const { fetchImpl: f2 } = stub([
    async () => jsonResponse(500, { type: "error", error: { message: "overloaded" } }),
  ]);
  const r2 = await createToolAdapter({ provider: "anthropic", apiKey: "sk-ant-api03-nope1234",
                                       model: "claude-opus-5", mcp: null, primeWith: [],
                                       fetchImpl: f2 }).run("hi");
  ok(!r2.ok && /overloaded/.test(r2.error) && !/character key/.test(r2.error),
     "and no other failure is treated as a credential problem");
}

section("a run that simply finishes says so too");
{
  const { fetchImpl } = stub([
    async () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const r = await createToolAdapter({ provider: "anthropic", apiKey: "k", model: "claude-opus-5",
                                      mcp: null, primeWith: [], fetchImpl }).run("ask");
  ok(r.truncated === false && r.stopReason === "end_turn" && r.textFromTurn === 1,
     "end_turn is reported as itself, so `truncated' means something");
}

/* ── one turn, several repositories (§34.3; A-16) ─────────────────────────── */

section("the stores a turn carries");
{
  ok(normalizeStores(null).length === 0, "no mcp is no store");
  const one = normalizeStores({ endpoint: MCP, token: "t" });
  ok(one.length === 1 && one[0].id === null,
     "the shape every existing caller passes is one unnamed store");
  ok(toolNameFor("survey", one[0], { qualify: false }) === "survey",
     "and its tools keep the names the server gave them");
  const two = normalizeStores({ repositories: [
    { account: "alice", repository: "sales", endpoint: "https://h/alice/sales/mcp", token: "t" },
    { account: "bob", repository: "parts", endpoint: "https://h/bob/parts/mcp", token: "t" },
  ] });
  ok(two.length === 2 && two[0].id === "alice/sales" && two[1].id === "bob/parts",
     "a set of repositories is a set of named stores");
  ok(toolNameFor("survey", two[0]) === "survey__alice__sales",
     "whose tool names say which repository the call goes to");
  const long = storeOf({ account: "a".repeat(40), repository: "b".repeat(40),
                         endpoint: "https://h/x/y/mcp" });
  ok(toolNameFor("survey", long).length <= 64,
     "a long name is cut to the provider's ceiling rather than refused");
  ok(toolNameFor("survey", long).endsWith(long.slug.slice(-10)),
     "and cut at the TOOL end, so two stores can never truncate into one another");
  ok(repositoriesNote(one, []) === "",
     "a single-store turn is told nothing about choosing a repository, because it has no choice");
  const note = repositoriesNote(two, [
    { name: "survey__alice__sales", store: two[0], tool: "survey" },
    { name: "survey__bob__parts", store: two[1], tool: "survey" },
  ]);
  ok(/alice\/sales/.test(note) && /bob\/parts/.test(note)
     && /survey__bob__parts/.test(note),
     "and a two-store turn is told both, with the tool name that reaches each");
  ok(!/NOT READABLE/.test(note),
     "where every store answered, nothing is said about one that did not");

  const short = repositoriesNote(two, [
    { name: "survey__alice__sales", store: two[0], tool: "survey" },
  ], [{ id: "bob/parts", why: "HTTP 403" }]);
  ok(/bob\/parts\*\* — NOT READABLE this turn: HTTP 403/.test(short),
     "a store that offered nothing is named with the REASON, not with an absence");
  ok(/nothing you say[\s\S]*about it can come from this turn/.test(short),
     "and the model is told what that means for its answer");
  ok(/Say so in your answer/.test(short),
     "including that the gap is to be stated: an answer covering only the stores "
     + "that replied reads as an answer about all of them");

  const silent = repositoriesNote(two, [
    { name: "survey__alice__sales", store: two[0], tool: "survey" },
  ]);
  ok(/no reason was recorded/.test(silent),
     "with no reason to hand, the note says THAT rather than inventing one");

  const wordy = repositoriesNote(two, [
    { name: "survey__alice__sales", store: two[0], tool: "survey" },
  ], [{ id: "bob/parts", why: `x${"y".repeat(400)}` }]);
  ok(wordy.split("\n").every((l) => l.length < 240),
     "a long reason is clipped: the note is a list, and one item is not a payload");
}

section("a question that crosses a repository boundary");
{
  const A = "https://example.test/alice/sales/mcp";
  const B = "https://example.test/bob/parts/mcp";
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),                       // tools/list — alice/sales
    () => jsonResponse(200, toolsList),                       // tools/list — bob/parts
    () => jsonResponse(200, resourceReply("operations")),     // primer, once
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, {                                 // the model asks both
      id: "msg_1", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu_a", name: "survey__alice__sales", input: { op: "catalog" } },
        { type: "tool_use", id: "tu_b", name: "survey__bob__parts", input: { op: "catalog" } },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    () => jsonResponse(200, surveyReply('session: "sess-alice"\ntypes: [Order]')),
    () => jsonResponse(200, surveyReply('session: "sess-bob"\ntypes: [Part]')),
    () => jsonResponse(200, finishes("Orders in alice/sales reference parts in bob/parts.")),
  ]);

  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl,
    mcp: { repositories: [
      { account: "alice", repository: "sales", endpoint: A, token: "ta" },
      { account: "bob", repository: "parts", endpoint: B, token: "tb" },
    ] },
  });
  const out = await adapter.run("compare orders in alice/sales with bob/parts");

  const listed = calls.filter((c) => c.body?.method === "tools/list");
  ok(listed.length === 2 && listed[0].url === A && listed[1].url === B,
     "every store is asked what tools it offers — two repositories may not offer the same ones");
  const primers = calls.filter((c) => c.body?.method === "resources/read");
  ok(primers.length === 2 && primers.every((c) => c.url === A),
     "the notation is read once, from the first store: it documents the grammar, not the data");

  const relayed = calls.filter((c) => c.body?.method === "tools/call");
  ok(relayed.length === 2 && relayed[0].url === A && relayed[1].url === B,
     "each call goes to the endpoint its name named");
  ok(relayed[0].headers.Authorization === "Bearer ta"
     && relayed[1].headers.Authorization === "Bearer tb",
     "with that store's own token, because authorization is per repository");
  ok(relayed.every((c) => c.body.params.name === "survey"),
     "and under the tool name the SERVER knows, not the one this side routes on");

  const asked = calls.filter((c) => c.url === LLM);
  const offered = (asked[0].body.tools || []).map((t) => t.name).sort();
  ok(offered.join(",") === "survey__alice__sales,survey__bob__parts",
     "the model is offered one tool per repository");
  ok(/alice\/sales/.test(asked[0].body.system) && /bob\/parts/.test(asked[0].body.system),
     "and told which repositories this turn may read");

  const results = asked[1].body.messages.at(-1).content;
  ok(results.every((r) => r.type === "tool_result"),
     "both answers come back as tool results");
  ok(out.events.filter((e) => e.type === "tool_result")
       .map((e) => e.repository).join(",") === "alice/sales,bob/parts",
     "and every record of a call says which repository it went to (REQ-34.3.5)");

  ok(relayed[1].body.params.arguments.session === undefined,
     "a session opened in one repository is not carried into another");
  ok(out.sessions["alice/sales"] === "sess-alice" && out.sessions["bob/parts"] === "sess-bob",
     "each store's exploration is held separately");
  ok(out.repositories.join(",") === "alice/sales,bob/parts",
     "and the run says which stores it carried");
  ok(out.ok && /bob\/parts/.test(out.finalText), "the turn answers across both");
}

section("a store that answers and still offers nothing says why");
{
  const A = "https://example.test/alice/sales/mcp";
  const B = "https://example.test/bob/parts/mcp";
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    // 200, and a JSON-RPC error inside it.  This is the shape an access
    // refusal takes when the transport succeeded: a server log sees a
    // success, and only the body says the call was refused.
    () => jsonResponse(200, { jsonrpc: "2.0", id: 1,
                              error: { code: -32602,
                                       message: "Repository not found: bob/parts" } }),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, finishes("Orders in alice/sales, and nothing from bob/parts.")),
  ]);

  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl,
    mcp: { repositories: [
      { account: "alice", repository: "sales", endpoint: A, token: "ta" },
      { account: "bob", repository: "parts", endpoint: B, token: "tb" },
    ] },
  });
  const out = await adapter.run("compare them");

  const told = out.events.find((e) => e.type === "tools" && e.repository === "bob/parts");
  ok(told && told.ok === false, "the store that offered nothing is reported as a failure");
  ok(told.http === 200,
     "with the status it actually answered with -- 200, which is why a server log shows none of this");
  ok(/Repository not found/.test(told.error),
     "and the server's own words, not a status code standing in for them");

  const asked = calls.filter((c) => c.url === LLM);
  ok(/bob\/parts\*\* — NOT READABLE this turn: Repository not found/.test(asked[0].body.system),
     "the model is told WHY the store is unreadable, in the same words (REQ-34.3.6)");
  ok(/alice\/sales\*\* — `survey/.test(asked[0].body.system),
     "and the one that answered is listed as before");
  ok((asked[0].body.tools || []).every((t) => !/bob/.test(t.name)),
     "no tool routes to it: a tool offered for a store that refused is a call that will fail");
  ok(out.ok, "the run is not failed by it -- one store short is an answer with a gap in it");
}

section("a 200 that is not JSON-RPC is named as such");
{
  const A = "https://example.test/alice/sales/mcp";
  const B = "https://example.test/bob/parts/mcp";
  const html = { status: 200, ok: true, text: async () => "<!doctype html><title>Sign in</title>" };
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => html,
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, finishes("Only alice/sales answered.")),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl,
    mcp: { repositories: [
      { account: "alice", repository: "sales", endpoint: A, token: "ta" },
      { account: "bob", repository: "parts", endpoint: B, token: "tb" },
    ] },
  });
  const out = await adapter.run("compare them");
  const told = out.events.find((e) => e.type === "tools" && e.repository === "bob/parts");
  ok(/not JSON-RPC/.test(told.error) && /other than an MCP resource/.test(told.error),
     "answering 200 with a page is a different fault from refusing, and is named differently");
  const asked = calls.filter((c) => c.url === LLM);
  ok(/not JSON-RPC/.test(asked[0].body.system), "and that reaches the model too");
}

section("the model names a repository the turn does not carry");
{
  const A = "https://example.test/alice/sales/mcp";
  const B = "https://example.test/bob/parts/mcp";
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, {
      id: "msg_1", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_x", name: "survey__carol__private",
                  input: { op: "catalog" } }],
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    () => jsonResponse(200, finishes("I cannot reach that one.")),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl,
    mcp: { repositories: [
      { account: "alice", repository: "sales", endpoint: A, token: "ta" },
      { account: "bob", repository: "parts", endpoint: B, token: "tb" },
    ] },
  });
  const out = await adapter.run("what is in carol/private");
  ok(!calls.some((c) => c.body?.method === "tools/call"),
     "nothing is sent anywhere: an unrouted name reaches no store");
  const refused = out.events.find((e) => e.type === "tool_result" && e.unrouted);
  ok(Boolean(refused), "the call comes back as a tool result, not as a failed run");
  ok(/survey__alice__sales/.test(refused.text) && /survey__bob__parts/.test(refused.text),
     "and the model is told what it may call instead, so it can correct itself");
  ok(out.ok, "the turn itself is not failed by it (REQ-34.3.3)");
}

section("one store still behaves exactly as it did");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, wantsTool("tu_1", { op: "catalog" })),
    () => jsonResponse(200, surveyReply('session: "s1"\ntypes: [Order]')),
    () => jsonResponse(200, wantsTool("tu_2", { op: "describe" })),
    () => jsonResponse(200, surveyReply("ok")),
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl,
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
  });
  const out = await adapter.run("what is in here");
  const asked = calls.filter((c) => c.url === LLM);
  ok((asked[0].body.tools || []).map((t) => t.name).join(",") === "survey",
     "the tool is called `survey', as it always was");
  ok(!/repositories this turn may read/.test(asked[0].body.system),
     "and nothing is said about choosing between repositories");
  const relayed = calls.filter((c) => c.body?.method === "tools/call");
  ok(relayed[1].body.params.arguments.session === "s1",
     "the one exploration is still carried from call to call");
  ok(out.session === "s1" && out.sessions["alice/sales"] === "s1",
     "and is reported both ways, so no caller has to change to read it");
  ok(out.ok && Boolean(out.sparql), "the run is unchanged in what it produces");
}

// --------------------------------------- a handle the store will not honour

/**
 * The service's own words, verified live against nl4 on 2026-11-16: three
 * stores, three handles issued by `op=connect\', and all three refused by the
 * very next call -- seconds later, against a reply that had said
 * `cached_for_minutes: 30\'.
 */
const STALE = "Unknown exploration session: S-OLD. It may have expired; "
            + "call survey with op=connect for a new handle.";

/** A tools/call reply the server marks as an error, as this one arrives: 200. */
const surveyError = (text) => ({
  jsonrpc: "2.0", id: 1,
  result: { isError: true, content: [{ type: "text", text }] },
});

section("a handle the store issued and then refused");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("t1", { op: "connect" })),
    () => jsonResponse(200, surveyReply('{ session: "S-OLD" }')),
    () => jsonResponse(200, wantsTool("t2", { op: "catalog", body: "{ scope: types }" })),
    () => jsonResponse(200, surveyError(STALE)),          // the refusal
    () => jsonResponse(200, surveyReply('{ session: "S-NEW" }')),  // the reconnect
    () => jsonResponse(200, surveyReply("types: 86")),    // the call, again
    () => jsonResponse(200, finishes(ANSWER)),
  ]);
  const seen = [];
  const held = new Map();
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, primeWith: [],
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
    sessions: { get: (id) => held.get(id) || null, set: (id, v) => held.set(id, v) },
    onEvent: (e) => seen.push(e),
  });
  const out = await adapter.run("what is in here");
  const relayed = calls.filter((c) => c.body?.method === "tools/call");
  ok(relayed.length === 4, "the refusal costs one reconnect and one repeat, and no more");
  ok(relayed[2].body.params.arguments.op === "connect",
     "the recovery is a connect, issued by the client rather than left to the model");
  ok(relayed[3].body.params.arguments.op === "catalog"
     && relayed[3].body.params.arguments.session === "S-NEW",
     "and the call the model asked for is repeated under the new handle");
  ok(seen.some((e) => e.type === "session_lost" && e.session === "S-OLD" && e.recovering),
     "the transcript is told the handle was refused, not just that a call failed");
  ok(seen.some((e) => e.type === "session" && e.reopened && e.session === "S-NEW"),
     "and that a second exploration was opened in its place");
  ok(seen.some((e) => e.type === "session_retry" && e.ok === true),
     "the repeat is reported as a repeat, so the record is not a run that made one call");
  const results = seen.filter((e) => e.type === "tool_result" && e.name === "survey"
                                  && !e.reconnect);
  ok(results[1].ok && /types: 86/.test(results[1].text),
     "what the model is handed is the answer, not the refusal");
  ok(held.get("alice/sales") === "S-NEW",
     "and the handle that outlives the run is the live one");
  ok(out.ok && out.calls === 4,
     "the run counts what reached the store -- the recovery and the repeat included, "
     + "because both were spent");
}

section("a handle that is refused twice is the store's answer, not a loop");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("t1", { op: "catalog", session: "S-OLD" })),
    () => jsonResponse(200, surveyError(STALE)),
    () => jsonResponse(200, surveyReply('{ session: "S-NEW" }')),
    () => jsonResponse(200, surveyError(STALE)),
    () => jsonResponse(200, finishes("I could not hold a session.")),
  ]);
  const seen = [];
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, primeWith: [],
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
    onEvent: (e) => seen.push(e),
  });
  const out = await adapter.run("what is in here");
  ok(calls.filter((c) => c.body?.method === "tools/call").length === 3,
     "one reconnect, one repeat, and then it stops trying");
  ok(seen.filter((e) => e.type === "session_lost").length === 1,
     "and the second refusal is not treated as a fresh loss to recover from");
  ok(seen.some((e) => e.type === "session_retry" && e.ok === false),
     "the repeat is reported as having failed");
  ok(out.ok, "a store that will not hold a session is not a failed RUN -- "
           + "the model is told, and answers");
  const refused = seen.filter((e) => e.type === "tool_result" && !e.reconnect).pop();
  ok(/is not holding explorations at the moment/.test(refused.text)
     && /Reconnecting again will not help/.test(refused.text),
     "and what goes back to the model says so in words, not as a bare repetition");
}

section("a store that has proved it will not hold a handle is not asked again");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, wantsTool("t1", { op: "catalog", session: "S-OLD" })),
    () => jsonResponse(200, surveyError(STALE)),
    () => jsonResponse(200, surveyReply('{ session: "S-NEW" }')),
    () => jsonResponse(200, surveyError(STALE)),
    () => jsonResponse(200, wantsTool("t2", { op: "profile", session: "S-NEW" })),
    () => jsonResponse(200, surveyError(STALE)),
    () => jsonResponse(200, finishes("I could not read it.")),
  ]);
  const seen = [];
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, primeWith: [], maxIterations: 4,
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
    onEvent: (e) => seen.push(e),
  });
  const out = await adapter.run("what is in here");
  const connects = calls.filter((c) => c.body?.params?.arguments?.op === "connect");
  ok(connects.length === 1,
     "the second round's refusal costs no second reconnect: it was learned in the first");
  ok(seen.filter((e) => e.type === "session_lost").pop().exhausted === true,
     "and the transcript says the recovery was given up rather than not attempted");
  ok(out.calls === 4, "four calls reached the store, and the count says four");
}

section("a turn with stores but no tools is not a turn");
{
  const empty = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
  const { calls, fetchImpl } = stub([() => jsonResponse(200, empty)]);
  const seen = [];
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, primeWith: [],
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
    onEvent: (e) => seen.push(e),
  });
  const out = await adapter.run("compare these repositories");
  ok(calls.every((c) => c.url !== LLM),
     "the model is not asked at all: there is nothing it could call");
  ok(!out.ok && /no store offered a usable tool/.test(out.error || ""),
     "and the run says so, rather than presenting a plan as an answer");
  ok(out.calls === 0 && out.iterations === 0, "nothing was spent on it");
  ok(seen.some((e) => e.type === "error" && e.where === "tools"),
     "the transcript names where it stopped");
}

section("a run that called nothing says so");
{
  const { fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, finishes("I will start by inventorying each store.")),
  ]);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, primeWith: [],
    mcp: { account: "alice", repository: "sales", endpoint: MCP, token: "t" },
  });
  const out = await adapter.run("what is in here");
  ok(out.ok && out.iterations === 1 && out.calls === 0,
     "a turn that offered tools and called none is counted, not inferred from the turn count");
}

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
