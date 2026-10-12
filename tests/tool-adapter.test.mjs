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

const { createToolAdapter, selectTools, ALLOW_TOOLS, sessionFrom } = await import(
  pathToFileURL(join(scratch, "lib", "llm", "tool-adapter.js")).href);

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
  ok(seen.join(",") === "prompt,tools,primer,primer,assistant,tool_call,tool_result,assistant,done",
     `the event sequence is the one a transcript renders (${seen.join(",")})`);

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
  const script = [() => jsonResponse(200, toolsList)];
  for (let i = 0; i < 20; i += 1) {
    script.push(() => jsonResponse(200, wantsTool(`toolu_${i}`, { op: "catalog" })));
    script.push(() => jsonResponse(200, surveyReply("…")));
  }
  const { calls, fetchImpl } = stub(script);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "sk-test", maxIterations: 3,
    mcp: { endpoint: MCP, token: "t" }, fetchImpl, primeWith: [],
  });
  const result = await adapter.run("loop forever");
  ok(result.iterations === 3, "the loop stops at maxIterations");
  ok(/3 tool rounds/.test(result.error || ""), "and says why");
  ok(calls.length === 1 + 3 * 2, "no further requests are made");
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
  ok(!refused.ok && refused.error === "invalid x-api-key", "a refusal is returned, not thrown");
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

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
