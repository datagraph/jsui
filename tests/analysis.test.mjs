/**
 * An analysis across repositories (§35).
 *
 * §34 made a cross-repository question askable; this is the part that decides
 * whether the turn it starts can actually do the work.  Three things are
 * asserted here, and they are independent of one another:
 *
 *   - the BRIEF says what a defensible comparison looks like, and -- the
 *     thing that was wrong before -- does NOT ask for a single SPARQL query,
 *     which is the deliverable of a one-repository exploration and cannot
 *     span two endpoints at all;
 *   - the BUDGET scales with the number of stores and is carried as a grant
 *     naming them, so a model that invents a third is refused by the
 *     authority and not merely by the routing table;
 *   - the RUN can be watched and stopped, because an analysis of two stores
 *     is tens of calls and minutes of waiting.
 *
 * The measure throughout is a real two-ontology alignment report: inventory
 * each store, read the small one's axioms, search the large one's labels,
 * propose candidates with reasons, and separate what was observed from what
 * was interpreted from what was not established.
 *
 * Loading note: as in tool-adapter.test.mjs, lib/ is copied into a scratch
 * package that declares "type": "module".
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-analysis-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", ...p.split("/"))).href);

const A = await load("llm/analysis-prompt.js");
const { createToolAdapter } = await load("llm/tool-adapter.js");
const { createGrant } = await load("llm/grant.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const TWO = [{ id: "james/finto", account: "james", repository: "finto" },
             { id: "james/fibo", account: "james", repository: "fibo" }];
const ONE = [TWO[0]];

// ----------------------------------------------------------------- the budget

section("what a turn may spend");
{
  const one = A.analysisBudget(ONE);
  const two = A.analysisBudget(TWO);
  ok(two.rounds > one.rounds,
     "two stores get more rounds than one — each must be inventoried before anything is compared");
  ok(one.rounds > 8,
     "and even one store gets more than the eight an exploration-and-a-query had");
  ok(A.analysisBudget(new Array(12).fill(TWO[0])).rounds === A.ROUNDS_CEILING,
     "the scaling has a ceiling, so a line naming a dozen repositories cannot run forever");
  ok(two.answerTokens > 4096,
     "the answer is a report, so its ceiling is above the 4096 a one-sentence reply needed");
  ok(two.digestOver > 0,
     "large payloads reach the model as their shape — without this a 65 000-row listing is the context");
  ok(two.grant.readOnly === true && two.grant.lifetime === "run",
     "the grant reads and does not persist");
  ok(two.grant.repositories.join(",") === "james/finto,james/fibo",
     "and names exactly the repositories the line named");
  ok(two.grant.maxQueries >= two.rounds,
     "the call budget is at least one per round, or a round could not ask anything");
  ok(two.grant.maxBytes > one.grant.maxBytes && two.grant.maxRows > one.grant.maxRows,
     "two inventories are allowed to cost more than one");
}

// ------------------------------------------------------------------ the brief

section("the brief a comparison is asked under");
{
  const text = A.analysisSystem({ stores: TWO, asked: "compare the concepts in james/finto and james/fibo",
                                  rounds: 26, answerTokens: 8192 });

  ok(/james\/finto/.test(text) && /james\/fibo/.test(text),
     "both repositories are named in the brief");
  ok(/no query you can write\s+spans them/.test(text.replace(/\n/g, "\n")),
     "it says plainly that no single query spans them, which is why the comparison is the model's to make");
  ok(!/```sparql/.test(text) && !/fenced/.test(text),
     "it does NOT ask for a fenced sparql block — that is the deliverable of a one-store exploration");
  ok(/Write a report, not a query/.test(text),
     "it says what the deliverable is instead");

  // The discipline the worked example actually needed.
  ok(/Inventory before you characterise/.test(text),
     "inventory comes before characterisation");
  ok(/KIND of thing each side's terms are/.test(text),
     "the model is told to say what kind of thing each side's terms are before comparing them");
  ok(/shared label is a candidate, not an equivalence/.test(text)
     && /owl:sameAs/.test(text) && /skos:exactMatch/.test(text),
     "a label resemblance is a candidate, and the equivalence predicates are named as what not to assert");
  ok(/not thereby absent from its subject/.test(text),
     "absence from an export is not absence from the subject");
  ok(/names the store it came from/.test(text),
     "every figure is attributed to a store");
  ok(/\*\*Observed\*\*/.test(text) && /\*\*Interpreted\*\*/.test(text)
     && /\*\*Not established\*\*/.test(text),
     "the answer ends in the three headed lists that separate evidence from reading");
  ok(/none of which may be empty/.test(text),
     "and none of them may be empty by default");

  // The output ceiling, stated rather than merely imposed.
  ok(/8192 tokens/.test(text) && /32768 characters/.test(text),
     "the answer ceiling is stated to the model in both units");
  ok(/26 rounds/.test(text),
     "so is the number of rounds it has");
  ok(text.includes("compare the concepts in james/finto and james/fibo"),
     "and the question itself is restated at the end of the brief");

  const alone = A.analysisSystem({ stores: ONE, rounds: 16 });
  ok(/analysing an RDF repository/.test(alone) && !/comparing 1/.test(alone),
     "one store is an analysis, not a comparison of one");
  ok(!/no query you can write/.test(alone),
     "and is not told about spanning stores it does not have");
  ok(/Observed/.test(alone),
     "but the evidence discipline is not a multi-store luxury");
}

// --------------------------------------------------------------- the progress

section("the running account");
{
  const lines = [];
  const watch = A.analysisProgress((l) => lines.push(l), { rounds: 26 });
  watch.onEvent({ type: "tools", repository: "james/finto" });
  watch.onEvent({ type: "primer" });
  watch.onEvent({ type: "tool_call", repository: "james/finto", iteration: 1,
                  name: "survey__james__finto", tool: "survey", input: { op: "catalog" } });
  watch.onEvent({ type: "tool_result", repository: "james/finto", text: "x".repeat(50) });
  watch.onEvent({ type: "digest", repository: "james/fibo", rows: 65016 });
  watch.onEvent({ type: "tool_result", repository: "james/fibo", shown: "y".repeat(10) });
  watch.onEvent({ type: "done" });

  ok(lines.some((l) => /james\/finto · catalog…/.test(l)),
     "the line says which store was asked and which operation — not just `survey'");
  ok(lines.some((l) => /round 1 of 26/.test(l)),
     "and how far into its rounds the run is");
  ok(lines.some((l) => /65016 rows/.test(l)),
     "a result read as a shape says how many rows it stood for");
  ok(lines[lines.length - 1] === "writing it up…",
     "and the last thing it says before the answer is that it is writing it up");
  ok(watch.total() === 2 && watch.calls.length === 2,
     "the calls are counted per store, so the finished reply's figures are the ones watched");
  ok(watch.bytes === 60, "and what reached the model is measured");
  ok((() => { try { A.analysisProgress(() => { throw new Error("x"); }).onEvent({ type: "done" }); return true; }
              catch { return false; } })(),
     "a progress line that throws does not stop the run");
}

/* ── the run itself ───────────────────────────────────────────────────────── */

const LLM = "https://api.anthropic.com/v1/messages";
const FINTO = "https://example.test/james/finto/mcp";
const FIBO = "https://example.test/james/fibo/mcp";

const jsonResponse = (status, obj) => ({
  status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(obj),
});
const toolsList = { jsonrpc: "2.0", id: 1, result: { tools: [
  { name: "survey", description: "Survey the repository.",
    inputSchema: { type: "object", required: ["op"],
                   properties: { op: { type: "string" }, session: { type: "string" } } } },
] } };
const resourceReply = (text) => ({ jsonrpc: "2.0", id: 1, result: { contents: [{ type: "text", text }] } });
const surveyReply = (text) => ({ jsonrpc: "2.0", id: 1,
                                 result: { content: [{ type: "resource", resource: { text } }] } });
const wantsTool = (id, name, input) => ({
  id: "msg", type: "message", role: "assistant", stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const finishes = (text) => ({
  id: "msg", type: "message", role: "assistant", stop_reason: "end_turn",
  content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 },
});

function stub(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const next = script.shift();
    if (!next) throw new Error(`unscripted request to ${url}`);
    return next(url, body);
  };
  return { calls, fetchImpl };
}

const STORES = [{ account: "james", repository: "finto", endpoint: FINTO, token: "t" },
                { account: "james", repository: "fibo", endpoint: FIBO, token: "t" }];

// -------------------------------------------- a grant over more than one store

section("a grant across two stores");
{
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, wantsTool("t1", "survey__james__finto", { op: "catalog" })),
    () => jsonResponse(200, surveyReply('session: "s-finto"\ntypes: [Concept]')),
    () => jsonResponse(200, wantsTool("t2", "survey__james__fibo", { op: "catalog" })),
    () => jsonResponse(200, surveyReply('session: "s-fibo"\ntypes: [Class]')),
    () => jsonResponse(200, finishes("Observed: …")),
  ]);
  const budget = A.analysisBudget(TWO);
  const grant = createGrant(budget.grant);
  const adapter = createToolAdapter({
    endpoint: LLM, apiKey: "k", fetchImpl, grant,
    mcp: { repositories: STORES },
  });
  const out = await adapter.run("compare them");
  const relayed = calls.filter((c) => c.body?.method === "tools/call");
  ok(relayed.length === 2,
     "both calls were relayed — a grant written in the server's tool names does not refuse the qualified ones");
  ok(relayed[0].url === FINTO && relayed[1].url === FIBO,
     "and each went to the endpoint its name named");
  ok(out.ok && grant.spent.queries === 2, "the grant charged one call each");
  ok(out.sessions["james/finto"] === "s-finto" && out.sessions["james/fibo"] === "s-fibo",
     "each store keeps its own exploration");
}

section("a grant that does not cover the store");
{
  const grant = createGrant({ ...A.analysisBudget(TWO).grant, maxQueries: 1 });
  const { fetchImpl, calls } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, wantsTool("t1", "survey__james__finto", { op: "catalog" })),
    () => jsonResponse(200, surveyReply("ok")),
    () => jsonResponse(200, wantsTool("t2", "survey__james__fibo", { op: "catalog" })),
    () => jsonResponse(200, finishes("I ran out.")),
  ]);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "k", fetchImpl, grant,
                                      mcp: { repositories: STORES } });
  const out = await adapter.run("compare them");
  const relayed = calls.filter((c) => c.body?.method === "tools/call");
  ok(relayed.length === 1, "the second call never left the page once the budget was spent");
  ok(out.events.some((e) => e.type === "refused" && /all are spent/.test(e.reason)),
     "and the refusal says why, in the grant's own terms");
}

// ------------------------------------------------------------------- stopping

section("stopping a run that is taking minutes");
{
  let stopped = null;
  const { calls, fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, wantsTool("t1", "survey__james__finto", { op: "catalog" })),
    // The user presses stop while this one is out.
    () => { stopped = "stopped by the user"; return jsonResponse(200, surveyReply('session: "s1"')); },
  ]);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "k", fetchImpl,
                                      mcp: { repositories: STORES },
                                      stop: () => stopped });
  const out = await adapter.run("compare them");
  ok(out.ok === false && /stopped by the user/.test(out.error),
     "the run ends as an error naming the reason, not as a short success");
  ok(out.events.some((e) => e.type === "stopped"),
     "and says so in the record");
  ok(out.events.some((e) => e.type === "tool_result" && e.ok && e.repository === "james/finto"),
     "the call that was already out came back and was recorded — the store had done the work");
  ok(calls.filter((c) => c.url === LLM).length === 1,
     "but the model was not asked again");
  ok(out.sessions["james/finto"] === "s1",
     "and the exploration it opened is still reported, so the transcript can be filed");
}

section("a run nobody stops");
{
  const { fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, finishes("done")),
  ]);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "k", fetchImpl,
                                      mcp: { endpoint: FINTO, token: "t" },
                                      stop: () => null });
  const out = await adapter.run("what is here");
  ok(out.ok && !out.events.some((e) => e.type === "stopped"),
     "a stop that never fires changes nothing");
}

section("a stop that throws");
{
  const { fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, finishes("done")),
  ]);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "k", fetchImpl,
                                      mcp: { endpoint: FINTO, token: "t" },
                                      stop: () => { throw new Error("x"); } });
  const out = await adapter.run("what is here");
  ok(out.ok, "a stop that throws is read as `do not stop', not as a crash");
}

// ------------------------------------------------- the shape of a big payload

section("a payload too large to read");
{
  const big = "subject,label\n" + new Array(4000).fill("http://x,y").join("\n");
  const { fetchImpl } = stub([
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, toolsList),
    () => jsonResponse(200, resourceReply("operations")),
    () => jsonResponse(200, resourceReply("grammar")),
    () => jsonResponse(200, wantsTool("t1", "survey__james__finto", { op: "select" })),
    () => jsonResponse(200, surveyReply(big)),
    () => jsonResponse(200, finishes("Observed: …")),
  ]);
  const budget = A.analysisBudget(TWO);
  const adapter = createToolAdapter({ endpoint: LLM, apiKey: "k", fetchImpl,
                                      mcp: { repositories: STORES },
                                      digestOver: budget.digestOver });
  const out = await adapter.run("compare them");
  const digest = out.events.find((e) => e.type === "digest");
  ok(digest && digest.repository === "james/finto",
     "the digest names the store, so a shape is attributable like everything else");
  ok(digest.shownBytes < digest.bytes / 10,
     "and what reached the model is a fraction of what arrived");
  ok(out.events.find((e) => e.type === "tool_result" && e.label).text === big,
     "while the record keeps the whole of it");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
