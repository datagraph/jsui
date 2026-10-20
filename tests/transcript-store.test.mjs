/**
 * The transcript record: that a run's content survives the writing of it.
 *
 * The exploration the service keeps is a record of shape -- which operation,
 * under which parent, how many rows.  This record is the one that holds the
 * rows themselves, so what is worth asserting is that the payload comes back
 * byte for byte through an escaper, a SPARQL update and a reader, and that the
 * graph it lands in is not the one the server rewrites from scratch on every
 * operation.
 */
import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ts-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const T = await import(pathToFileURL(join(scratch, "lib", "mcp", "transcript-store.js")).href);

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const SESSION = "EB062DE9-C460-11F1-95F7-3BCB8CEB8DDD";
const EXPLORATION = `http://dydra.com/explorations/${SESSION}`;

/* A payload with every character that could end an update early, plus the
   shape a live survey answers with. */
const PAYLOAD = `session: "${SESSION}"
op: catalog
scope: types
resultCount: 18
types: (
  (<http://xmlns.com/foaf/0.1/Person> 12)
  (<http://example.org/Sample "quoted"> 6)
)
note: a backslash \\ and a tab\there`;

const events = [
  { type: "prompt", at: "2026-10-13T09:00:00.000Z", text: "samples above 20 degrees",
    model: "claude-opus-5", provider: "anthropic" },
  { type: "tools", at: "2026-10-13T09:00:01.000Z", ok: true, ms: 12,
    names: ["survey"], withheld: ["query", "sparql_update"] },
  { type: "primer", at: "2026-10-13T09:00:02.000Z", ok: true, ms: 9,
    uri: "score://grammar", chars: 1400, text: "grammar ::= operation | query" },
  { type: "assistant", at: "2026-10-13T09:00:03.000Z", ms: 2100, iteration: 1,
    text: "Let me look at the types.", stopReason: "tool_use", toolCalls: 1,
    usage: { input_tokens: 1800, output_tokens: 40 },
    request: { model: "claude-opus-5" }, response: "{}" },
  { type: "tool_call", at: "2026-10-13T09:00:04.000Z", id: "t1", name: "survey",
    input: { op: "catalog", scope: "types" }, iteration: 1 },
  { type: "tool_result", at: "2026-10-13T09:00:05.000Z", id: "t1", name: "survey",
    ok: true, ms: 31, status: 200, text: PAYLOAD,
    input: { op: "catalog", scope: "types" }, iteration: 1 },
  { type: "session", at: "2026-10-13T09:00:05.100Z", session: SESSION },
  { type: "done", at: "2026-10-13T09:00:06.000Z", iterations: 2, sparql: true, error: null },
];
const result = { ok: true, iterations: 2, events, session: SESSION,
                 model: "claude-opus-5", provider: "anthropic" };

console.log("\nwhere it is written");
{
  ok(T.transcriptGraph(EXPLORATION) === `${EXPLORATION}/transcript`,
     "the transcript is a graph beside the exploration, not inside it");
  // persist-exploration deletes and re-posts the exploration's graph on every
  // operation; a triple written into it would last until the next survey call.
  ok(T.transcriptGraph(EXPLORATION) !== EXPLORATION,
     "which is what keeps the server's next rewrite from erasing it");
}

console.log("\nwhat is kept");
{
  const x = T.exchangesFrom(events);
  const kinds = x.map((e) => e.kind);
  ok(kinds.join(",") === "prompt,tools,primer,assistant,tool_call,tool_result",
     "every event that carried content becomes an exchange, in order");
  ok(x.every((e, i) => e.ordinal === i + 1), "numbered by the order they happened");
  const payload = x.find((e) => e.kind === "tool_result");
  ok(payload.content === PAYLOAD, "the payload is kept whole, not summarised");
  ok(payload.rows === 18, "and its stated cardinality is read out for the indicator");
  ok(payload.direction === "received" && payload.op === "catalog" && payload.tool === "survey",
     "with which way it moved, and what was asked");
  const primer = x.find((e) => e.kind === "primer");
  ok(primer.content === "grammar ::= operation | query" && primer.document === "score://grammar",
     "the schema half -- the documents the model read -- is kept as well");
  const turn = x.find((e) => e.kind === "assistant");
  ok(turn.content === "Let me look at the types." && turn.tokensIn === 1800,
     "the model's prose is kept, with what the turn cost");
}

console.log("\nan oversized payload");
{
  const big = "x".repeat(300);
  const x = T.exchangesFrom([{ type: "tool_result", name: "survey", ok: true,
                               text: big, input: { op: "catalog" } }], { max: 100 });
  ok(x[0].content.length === 100 && x[0].truncated === true && x[0].bytes === 300,
     "is cut, and says both what was kept and what there was");
}

console.log("\nthe update it writes");
{
  const update = T.insertData({
    graph: T.transcriptGraph(EXPLORATION), exploration: EXPLORATION,
    repository: "test/foaf",
    run: { id: "r-1", prompt: "samples above 20 degrees", started: new Date(0),
           ended: new Date(0), iterations: 2, ok: true, session: SESSION },
    exchanges: T.exchangesFrom(events),
  });
  ok(/^PREFIX mcp: <http:\/\/dydra\.com\/ns\/mcp#>\nINSERT DATA \{/.test(update),
     "one INSERT DATA, in the server's own vocabulary");
  ok(update.includes(`GRAPH <${EXPLORATION}/transcript>`), "into the transcript graph");
  ok(update.includes(`mcp:exploration <${EXPLORATION}>`),
     "pointing back at the exploration it belongs to");
  // The escaping is the whole risk: an unescaped quote in a payload ends the
  // literal and the rest of the run is read as syntax.
  const quoted = update.split("\n").find((l) => l.includes("Sample"));
  ok(quoted.includes('\\"quoted\\"') && quoted.includes("\\\\"),
     "quotes and backslashes in the payload are escaped, not dropped");
  ok(!/[^\\]\n/.test(quoted.slice(quoted.indexOf('"'))) && update.includes("\\n"),
     "and newlines travel as escapes, so one payload is one literal");
  ok(T.literal('a "b" \\ c\nd') === '"a \\"b\\" \\\\ c\\nd"', "which is what the escaper does");
  let threw = false;
  try { T.iri("http://x/ a>"); } catch { threw = true; }
  ok(threw, "an IRI that would break the update is refused rather than escaped");
}

console.log("\nwriting it");
{
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return { ok: true, status: 200, text: async () => "" };
  };
  const r = await T.recordRun({
    host: "https://nl9.dydra.com", account: "test", token: "T",
    repository: "test/foaf", session: SESSION, result,
    prompt: "samples above 20 degrees", fetchImpl,
  });
  ok(r.ok && r.exchanges === 6, "the run is recorded");
  ok(sent.url === "https://nl9.dydra.com/test/mcp/sparql",
     "into the account's exploration repository, where the log already lives");
  ok(sent.init.headers["Content-Type"] === "application/sparql-update",
     "as a SPARQL update, which the graph-store resource decodes");
  ok(sent.init.headers.Authorization === "Bearer T", "under the user's own token");
  ok(sent.init.body.includes(PAYLOAD.split("\n")[2]), "and the body carries the payload");
}

console.log("\nwhen the store will not take it");
{
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "no write access" });
  const r = await T.recordRun({ host: "https://h", account: "test", token: "T",
                                session: SESSION, result, fetchImpl });
  ok(r.ok === false && /no write access/.test(r.error),
     "the failure is returned, not thrown -- the run already happened");
}

console.log("\na run with no exploration handle");
{
  let body = null;
  const fetchImpl = async (url, init) => { body = init.body; return { ok: true, status: 200, text: async () => "" }; };
  const r = await T.recordRun({ host: "https://h", account: "test", token: "T",
                                session: null, result: { ...result, session: null },
                                fetchImpl });
  ok(r.ok && /detached-/.test(r.graph),
     "is still recorded, under a graph of its own rather than discarded");
  ok(!body.includes("mcp:exploration"), "with nothing to point at, and no pretence that there is");
}

console.log("\nreading it back");
{
  const G = `${EXPLORATION}/transcript`;
  const rows = [
    { s: G, p: "mcp#exploration", o: EXPLORATION },
    { s: G, p: "mcp#model", o: "claude-opus-5" },
    // deliberately out of order, and the exchange before its run
    { s: `${G}#r-1-x2`, p: "mcp#type", o: "mcp#Exchange" },
    { s: `${G}#r-1-x2`, p: "mcp#run", o: `${G}#r-1` },
    { s: `${G}#r-1-x2`, p: "mcp#ordinal", o: "2" },
    { s: `${G}#r-1-x2`, p: "mcp#kind", o: "tool_result" },
    { s: `${G}#r-1-x2`, p: "mcp#content", o: PAYLOAD },
    { s: `${G}#r-1-x2`, p: "mcp#rows", o: "18" },
    { s: `${G}#r-1-x1`, p: "mcp#run", o: `${G}#r-1` },
    { s: `${G}#r-1-x1`, p: "mcp#ordinal", o: "1" },
    { s: `${G}#r-1-x1`, p: "mcp#kind", o: "primer" },
    { s: `${G}#r-1-x1`, p: "mcp#document", o: "score://grammar" },
    { s: `${G}#r-1-x1`, p: "mcp#content", o: "grammar ::= operation" },
    { s: `${G}#r-1`, p: "mcp#type", o: "mcp#Run" },
    { s: `${G}#r-1`, p: "mcp#prompt", o: "samples above 20 degrees" },
    { s: `${G}#r-1`, p: "mcp#iterations", o: "2" },
    { s: `${G}#r-1`, p: "mcp#ended", o: "2026-10-13T09:00:06.000Z" },
  ];
  const fetchImpl = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({
    head: {}, results: { bindings: rows.map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, { type: "literal", value: v }]))) } }) });
  const r = await T.readTranscript({ host: "https://h", account: "test", token: "T",
                                     exploration: EXPLORATION, fetchImpl });
  ok(r.ok && r.runs.length === 1, "the runs are separated from their exchanges");
  ok(r.runs[0].prompt === "samples above 20 degrees" && r.runs[0].iterations === 2,
     "a run carries what was asked of it");
  ok(r.runs[0].exchanges.length === 2 && r.runs[0].exchanges[0].kind === "primer",
     "its exchanges come back in the order they happened, not the rows'");
  ok(r.runs[0].exchanges[1].content === PAYLOAD,
     "and the payload reads back exactly as it was written");
  ok(r.runs[0].exchanges[0].document === "score://grammar"
     && r.runs[0].exchanges[0].uri === `${G}#r-1-x1`,
     "a document the model read keeps its name without overwriting the record's own");
  ok(r.model === "claude-opus-5" && r.exploration === EXPLORATION,
     "and the header says which model, against which exploration");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
