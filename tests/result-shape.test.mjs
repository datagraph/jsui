/**
 * Does the document that came back answer the query that was sent?
 *
 * Written from a live failure.  "list the types" produced, after three turns,
 *
 *      SELECT ?type (COUNT(?s) AS ?count) WHERE { ?s a ?type } GROUP BY ?type
 *
 * and a markdown table of 34 classes taken from a catalogue operation, not
 * from that query.  When the figure path then ran the query for real, the
 * store answered with a SPARQL BOOLEAN document.  Everything downstream
 * accepted it: HTTP 200, a body, a digest, `rows: 1' -- so Gate 1 reported
 * "1 row(s)", and the model was handed a boolean and told it was the answer
 * to ?type and ?count.  The only thing between that and a published chart of
 * a dataset that does not exist was the model noticing, in prose, at the last
 * step.  A figure must never depend on that.
 *
 * Two claims, then:
 *
 *   1. `projectedVariables' reads the WHOLE projection list.  It used to see
 *      a parenthesis, take the aliases, and answer `["count"]' for the query
 *      above -- confidently omitting the column the chart is drawn along.
 *      Under-reporting silently is the one failure it must not have, because
 *      its callers trust a non-null answer to be complete.
 *   2. `resultFault' refuses the mismatch at Phase 2, where the query and the
 *      response can be read side by side -- and refuses ONLY what is
 *      unambiguous, since a check that rejects sound results is worse than
 *      the hole it closes.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-shape-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { projectedVariables } = await load("app/document.js");
const { resultFault, runPanel } = await load("dashboard/runner.js");
const { divergenceFrom, queriesRan, datasetOf, withoutDataset } =
  await load("figure/provenance.js");
const { validateProposal } = await load("figure/spec.js");
const { digestResult } = await load("mcp/result-digest.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/** The query from the live failure, verbatim. */
const CENSUS = `SELECT ?type (COUNT(?s) AS ?count)
WHERE {
  ?s a ?type .
}
GROUP BY ?type
ORDER BY DESC(?count)`;

const fault = (query, text, mimeType = null) =>
  resultFault(query, digestResult(text, mimeType));

/* ════════════════════ what a SELECT says it returns ════════════════════ */

section("the whole projection list, not the half of it that has parentheses");
{
  ok(String(projectedVariables(CENSUS)) === "type,count",
     "a mixed list reads as both: ?type AND the aliased count");
  ok(String(projectedVariables("SELECT (COUNT(DISTINCT ?s) AS ?n) ?g WHERE {}")) === "n,g",
     "a nested call does not end the item early — COUNT(DISTINCT ?s) is one expression");
  ok(String(projectedVariables("PREFIX x: <u:a>\nSELECT ?a ?b WHERE {}")) === "a,b",
     "PREFIX declarations are stepped over, which nearly every real query has");
  ok(String(projectedVariables("# a comment\nSELECT ?a WHERE {}")) === "a",
     "and so are comments");
}

section("and null wherever it cannot tell, because a wrong list refuses sound work");
{
  ok(projectedVariables("SELECT * WHERE { ?s ?p ?o }") === null, "SELECT *");
  ok(projectedVariables("SELECT ?a (?x + ?y) WHERE {}") === null,
     "an expression with no alias: the column has a value but no name to match on");
  ok(projectedVariables("ASK { ?s ?p ?o }") === null, "a query that projects nothing");
  ok(projectedVariables("") === null && projectedVariables(null) === null, "nothing at all");
}

/* ═══════════════════════ the mismatch itself ═══════════════════════════ */

section("the live failure: a SELECT answered with a boolean");
{
  const why = fault(CENSUS, '{"head":{},"boolean":false}', "application/sparql-results+json");
  ok(Boolean(why), "refused");
  ok(/boolean \(false\)/.test(why), "saying what came instead");
  ok(/EMPTY result set/.test(why) && /matched nothing/.test(why),
     "and what it actually means — see the last section: the store encodes an empty "
   + "result set this way, so the useful reading is 'no rows', not 'wrong shape'");
  ok(digestResult('{"head":{},"boolean":false}').rows === 1,
     "a boolean still digests to one row — which is exactly why the form has to be "
   + "compared and a row count cannot stand in for it");
}

section("the same failure as it actually arrived: TSV");
{
  // What the store really sent, byte for byte.  Its encoders each carry a
  // method on `(result symbol)\' written for an ASK\'s boolean marker; NIL is
  // a symbol, so an EMPTY result takes that method too, and the TSV one
  // writes a one-column table called `result\' holding the boolean.  Hence a
  // digest of 1 row, hence "1 row(s)" at the gate, and hence a model being
  // asked to chart a type census from the word "false".
  const TSV = 'result\n"false"^^<http://www.w3.org/2001/XMLSchema#boolean>\n';
  const d = digestResult(TSV, "text/tab-separated-values");
  ok(d.form === "table" && d.rows === 1,
     "it digests as a perfectly ordinary one-row table — nothing about it is malformed");
  const why = resultFault(CENSUS, d);
  ok(/has \?result/.test(why) && /\?type, \?count are not in it/.test(why),
     "and is caught by its columns, which is the only thing about it that is wrong");
}

section("a table that is not this query's table");
{
  const why = fault(CENSUS, "?klass\t?count\nhttp://x/A\t3\n", "text/tab-separated-values");
  ok(/\?type is not in it/.test(why), "a renamed column is a different result, and is named");
  ok(/selects \?type, \?count/.test(why) && /has \?klass, \?count/.test(why),
     "with both lists shown, since the user is about to decide which is wrong");
}

section("every other way the shapes can disagree");
{
  ok(fault("ASK { ?s ?p ?o }", "?a\n1\n"), "an ASK answered with a table");
  ok(fault("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }", '{"head":{},"boolean":true}'),
     "a CONSTRUCT answered with a boolean");
  ok(fault(CENSUS, "operations: catalog, describe\nscope: types\n"),
     "a score payload where a result should be — the survey answering instead of the store");
  ok(fault(CENSUS, "<!doctype html>\n<html><body>Not Found</body>"),
     "and a page, which is what a misrouted request returns with a 200");
}

/* ═════════════════ and nothing else: the quiet half ════════════════════ */

section("what it must not refuse");
{
  ok(!fault(CENSUS, "?type\t?count\nhttp://x/A\t3\n", "text/tab-separated-values"),
     "the right answer");
  ok(!fault(CENSUS, "?type\t?count\n", "text/tab-separated-values"),
     "the right answer with no rows in it — no rows is a real answer to a real query");
  ok(!fault(CENSUS, ""), "an empty body, which is the same statement more tersely");
  ok(!fault("SELECT * WHERE { ?s ?p ?o }", "?s\t?p\t?o\na\tb\tc\n"),
     "a SELECT * against any columns at all, because nothing was promised");
  ok(!fault("SELECT ?a (?x + ?y) WHERE {}", "?a\t?z\n1\t2\n"),
     "a projection it cannot read: unreadable is not wrong");
  ok(!fault("ASK { ?s ?p ?o }", '{"head":{},"boolean":true}'), "an ASK answered with a boolean");
  ok(!fault("CONSTRUCT { ?s ?p ?o } WHERE {}", "<u:a> <u:b> <u:c> .\n", "text/turtle"),
     "a CONSTRUCT answered with statements");
  ok(!fault("INSERT DATA { <u:a> <u:b> <u:c> }", '{"head":{},"boolean":true}'),
     "and a form this does not judge is left alone rather than guessed at");
  ok(!fault(CENSUS, "?count\t?type\n3\thttp://x/A\n", "text/tab-separated-values"),
     "column ORDER is not a fault: the page binds by name");
}

/* ════════════════════ where it sits in the run ═════════════════════════ */

section("runPanel refuses it as a failed run, and keeps the body");
{
  const stub = async () => ({
    ok: true, status: 200,
    headers: { get: () => "application/sparql-results+json" },
    text: async () => '{"head":{},"boolean":false}',
  });
  const r = await runPanel({
    host: "https://h", account: "a", repository: "r", token: "t",
    panel: { name: "census", query: CENSUS, accept: "text/tab-separated-values" },
    fetchImpl: stub,
  });
  ok(r.ok === false, "not a result, though the status was 200");
  ok(r.mismatch === true, "and distinguishable from a store that refused or fell over");
  ok(r.status === 200, "the status it actually got is kept, not rewritten to an error");
  ok(/does not answer the query/.test(r.error), "with the reason in the panel's own error");
  ok(r.text === '{"head":{},"boolean":false}',
     "and the body kept — the whole value of catching it here is that the user can "
   + "read the query and what answered it side by side");
}

section("a sound run is untouched");
{
  const stub = async () => ({
    ok: true, status: 200,
    headers: { get: () => "text/tab-separated-values" },
    text: async () => "?type\t?count\nhttp://x/A\t3\n",
  });
  const r = await runPanel({
    host: "https://h", account: "a", repository: "r", token: "t",
    panel: { name: "census", query: CENSUS, accept: "text/tab-separated-values" },
    fetchImpl: stub,
  });
  ok(r.ok === true && r.rows === 1 && !r.mismatch, "one row, no complaint");
}

/* ═════════════ the origin: a query retyped without its FROM ════════════ */

/*
 * The store's boolean was the SYMPTOM.  The cause was upstream of it: the
 * census ran against a named graph and returned 34 classes, and the answer
 * restated the query with its `FROM' clause gone.  The interface ran the
 * restatement.  It parses, it reads correctly, it would be approved by anyone
 * at Gate 1 -- and it reads the default graph, which was empty.
 *
 * So the thing to check is not validity but IDENTITY, and the only evidence
 * is what the interface itself relayed.
 */

const GRAPH = "<http://data.cssz.cz/g>";
const RAN = `SELECT ?type (COUNT(?s) AS ?count)\nFROM ${GRAPH}\n`
          + `WHERE { ?s a ?type . }\nGROUP BY ?type ORDER BY DESC(?count)`;
const RETYPED = `SELECT ?type (COUNT(?s) AS ?count)\n`
              + `WHERE { ?s a ?type . }\nGROUP BY ?type ORDER BY DESC(?count)`;

section("the queries that ran are read from what was relayed, not from the prose");
{
  const ran = queriesRan([
    { type: "tool_result", name: "survey", ok: true, input: { op: "catalog", scope: "types" } },
    { type: "tool_result", name: "query", ok: true, input: { text: RAN } },
    { type: "assistant", text: "```sparql\n" + RETYPED + "\n```" },
  ]);
  ok(ran.length === 1 && ran[0].query === RAN,
     "the call that carried SPARQL, and not the turn that merely wrote some");
  ok(ran[0].name === "query" && ran[0].ok,
     "with the tool and the outcome, since matching a call that errored is worth knowing too");
}

section("a query retyped without its dataset clause is caught");
{
  const ran = queriesRan([{ type: "tool_result", name: "query", ok: true, input: { text: RAN } }]);
  const d = divergenceFrom(RETYPED, ran);
  ok(d.kind === "dataset", "recognised as the same query with its dataset clause changed");
  ok(d.lost.length === 1 && d.lost[0] === GRAPH, "and the graph it stopped reading is named");
  ok(d.match.query === RAN, "with the call itself kept, so the gate can offer it");
  ok(/reads the default graph/.test(d.note) && /looks like a finding/.test(d.note),
     "the note says what it will do instead and why that is worse than an error");

  ok(divergenceFrom(RAN, ran).kind === "same",
     "the same query, whitespace aside, is just the same query");
  ok(divergenceFrom(RAN.replace(/\n/g, "  \n  "), ran).kind === "same",
     "— whitespace really aside");
}

section("and a different query is not");
{
  const ran = queriesRan([{ type: "tool_result", name: "query", ok: true, input: { text: RAN } }]);
  ok(divergenceFrom("SELECT ?p WHERE { ?s ?p ?o }", ran).kind === "none",
     "a model proposing a better query than it explored with is the normal case, and "
   + "warning about it would teach the user to click past this");
  ok(divergenceFrom(RETYPED, []).kind === "none", "nothing relayed, nothing to say");
  ok(divergenceFrom("", ran).kind === "none", "and no proposal, nothing to say");
}

section("reading a dataset clause");
{
  ok(datasetOf(RAN).all.join() === GRAPH, "an IRI");
  ok(datasetOf("SELECT ?a FROM NAMED ex:g WHERE {}").named.join() === "ex:g",
     "a prefixed name, and FROM NAMED, which loses just as much");
  ok(datasetOf(RETYPED).any === false, "and none at all");
  ok(withoutDataset(RAN) === withoutDataset(RETYPED),
     "the rest of the two queries is the same text, which is what makes the match safe");
}

section("Gate 1 warns, and keeps the proposal runnable");
{
  const ran = queriesRan([{ type: "tool_result", name: "query", ok: true, input: { text: RAN } }]);
  const v = validateProposal({ query: RETYPED, text: "", ran });
  ok(v.ok, "the proposal is still valid — this is not an error, and refusing it would be wrong");
  ok(v.warnings.some((w) => /dataset clause removed/.test(w)),
     "but the gate says the query is not the one that ran");
  ok(v.divergence.match.query === RAN,
     "and carries the one that did, so the gate can offer it rather than describe it");
  ok(validateProposal({ query: RAN, text: "", ran }).warnings.every(
       (w) => !/dataset clause/.test(w)),
     "the query that ran draws no warning about itself");
  ok(validateProposal({ query: RETYPED, text: "" }).divergence.kind === "none",
     "and a gate opened with no history behaves exactly as it did before");
}

section("the refusal names the likely cause, not just the wrong shape");
{
  const why = fault(RETYPED, '{"head":{},"boolean":false}');
  ok(/EMPTY result set/.test(why),
     "a boolean where a SELECT was asked is an empty result set encoded badly — "
   + "saying 'wrong shape' sends the reader hunting a routing fault");
  ok(/names no graph/.test(why) && /FROM clause is what is missing/.test(why),
     "so the next thing to check is named");
  ok(/check that the graph holds/.test(fault(RAN, '{"head":{},"boolean":false}')),
     "and when the query DOES name a graph, the advice is the other one");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
