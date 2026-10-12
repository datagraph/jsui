/**
 * The transcript formatter.
 *
 * What is worth asserting is the judgement, not the markup: that a payload is
 * recognised for what it is, that a fenced query survives intact while the
 * prose around it is kept separate, and that the indicator line says the same
 * things in the same order every time.  The rendering is ui/components'
 * business and is not tested here.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-fmt-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const T = await import(pathToFileURL(join(scratch, "lib", "format", "transcript.js")).href);

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

console.log("\nwhat a payload is");
{
  ok(T.classify('{"result":{"content":[]}}') === "json", "a JSON-RPC envelope is json");
  ok(T.classify("  \n SELECT ?s WHERE { ?s ?p ?o }") === "sparql",
     "a query is sparql even with leading whitespace");
  ok(T.classify("PREFIX foaf: <http://x/>\nSELECT * {}") === "sparql", "a PREFIX leads a query");
  ok(T.classify("catalog scope: types\n  rdfs:Class 4") === "score",
     "the survey tool's own notation is score, not undifferentiated text");
  ok(T.classify("{ subject ?s }") === "score", "a brace-led shape is score");
  ok(T.classify('session: "AAAA-1111"\ncatalog scope: types') === "score",
     "a live answer leads with the handle it restates, and is still score");
  ok(T.classify("Note that I checked.") !== "score",
     "prose with a capital is not mistaken for a declaration");
  ok(T.classify("I looked at the predicates and found eighteen.") === "text", "prose is text");
  ok(T.classify("") === "empty" && T.classify(null) === "empty", "nothing is empty, not text");
  ok(T.classify('{"q":"SELECT * {}"}') === "json",
     "JSON that mentions SELECT is still JSON -- the order of the tests matters");
}

console.log("\nJSON is re-indented, and only when it is JSON");
{
  ok(T.prettyJson('{"a":1,"b":[2,3]}') === '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
     "a compact object is expanded");
  ok(T.prettyJson("SELECT * {}") === null, "a query is not mangled through JSON.parse");
  ok(T.prettyJson("{not json") === null, "a brace alone does not make it JSON");
  ok(T.formatBlock('{"a":1}').kind === "json" && T.formatBlock('{"a":1}').body.includes('"a": 1'),
     "formatBlock returns both the kind and the formatted text");
}

console.log("\nan object is formatted, not stringified");
{
  // the provider request body reaches the transcript as the object it will be
  // serialised from, and reading `[object Object]' is reading nothing
  const body = { model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] };
  ok(T.asText(body).startsWith("{\n"), "an object becomes indented JSON");
  ok(T.classify(body) === "json", "and is classified as JSON without a round trip through text");
  ok(T.formatBlock(body).body.includes('"model": "claude-opus-5"'),
     "formatBlock shows its fields");
  ok(T.asText(null) === "" && T.asText(undefined) === "", "nothing stays nothing");
  ok(T.asText(42) === "42", "a number is its digits");
  const circular = {}; circular.self = circular;
  ok(typeof T.asText(circular) === "string", "a cycle does not throw");
}

console.log("\nfenced blocks are kept whole, prose is kept apart");
{
  const parts = T.fences("Here is one:\n```sparql\nSELECT ?s\nWHERE { ?s ?p ?o }\n```\nIt counts rows.");
  ok(parts.length === 3, "prose, code, prose");
  ok(parts[1].kind === "code" && parts[1].lang === "sparql", "the fence language is carried");
  ok(parts[1].body === "SELECT ?s\nWHERE { ?s ?p ?o }\n",
     "the query survives byte for byte -- it is about to be offered as a view");
  ok(parts[0].body.trim() === "Here is one:" && parts[2].body.trim() === "It counts rows.",
     "the prose either side is separate");

  const two = T.fences("a\n```\nx\n```\nb\n```js\ny\n```\nc");
  ok(two.filter((p) => p.kind === "code").length === 2, "more than one fence is handled");
  ok(two[1].lang === "" && two[3].lang === "js", "a fence without a language is still code");

  ok(T.fences("no fences at all").length === 1, "unfenced prose is one text segment");
  ok(T.fences("").length === 0, "nothing in, nothing out");
  const open = T.fences("text\n```sparql\nSELECT 1");
  ok(open.length === 1 && open[0].kind === "text",
     "an unterminated fence is kept as prose rather than dropped");
}

console.log("\nthe provider request, digested");
{
  const body = { model: "claude-opus-5", max_tokens: 4096,
    system: "x".repeat(5364),
    tools: [{ name: "survey" }],
    messages: [
      { role: "user", content: "collect statistics" },
      { role: "assistant", content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", name: "survey", input: { op: "catalog" } }] },
      { role: "user", content: [
          { type: "tool_result", content: [{ text: "y".repeat(180) }] }] },
    ] };
  const d = T.digestRequest(body);
  ok(/model\s+claude-opus-5/.test(d), "the model is named");
  ok(/system\s+5364 characters/.test(d),
     "the primer is measured, not reprinted -- it is the same every turn");
  ok(!d.includes("xxxx"), "and really not reprinted");
  ok(/tools\s+survey/.test(d), "the tools actually offered are named");
  ok(/messages\s+3/.test(d) && /tool_use survey catalog/.test(d) && /tool_result 180c/.test(d),
     "each message is digested to what it carries, which is the part that varies");
  ok(T.digestRequest(JSON.stringify(body)) === d, "a serialised body digests the same");
  ok(T.digestRequest("not json") === null && T.digestRequest(null) === null,
     "and anything else digests to nothing, so the caller can fall back");
}

console.log("\nthe indicator line");
{
  ok(T.summarize({ op: "catalog", ms: 256, rows: 18, http: 200 }) === "catalog · 18 rows · 256ms",
     "a successful call: what, how much, how long -- and no HTTP 200 noise");
  ok(T.summarize({ http: 401, ms: 40 }) === "HTTP 401 · 40ms", "a status worth seeing is shown");
  ok(T.summarize({ rows: 1 }) === "1 row", "one row is singular");
  ok(T.summarize({ stopReason: "tool_use", tokensIn: 5300, tokensOut: 412, ms: 4289 })
       === "tool_use · 5.3k↓ 412↑ · 4.3s",
     "a model turn: why it stopped, what it cost, how long");
  ok(T.summarize({}) === "", "nothing known, nothing claimed");
}

console.log("\nscales");
{
  ok(T.duration(256) === "256ms" && T.duration(4289) === "4.3s", "ms below a second, s above");
  ok(T.count(820) === "820" && T.count(5300) === "5.3k" && T.count(42000) === "42k",
     "counts shorten as they grow");
  ok(T.count(null) === "" && T.duration(undefined) === "", "an absent number is absent, not NaN");
}

console.log("\nrow counts and clipping");
{
  ok(T.rowsIn("resultCount: 18") === 18 && T.rowsIn("rows = 4") === 4,
     "a cardinality stated in the payload is read out for the summary");
  ok(T.rowsIn("no number here") === null, "and not invented when it is absent");
  const long = "x".repeat(60000);
  const clipped = T.clip(long);
  ok(clipped.length < long.length && clipped.includes("more character(s) not shown"),
     "an oversized payload is clipped before it reaches the DOM, and says so");
  ok(T.clip("short") === "short", "a short one is untouched");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
