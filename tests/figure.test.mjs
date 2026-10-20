/**
 * The single-figure path: the media type, the argument screen, the three-step
 * prompt, the figure read back out of prose, and what the record keeps.
 *
 * §2 of `llm-result-rendering-plan.md' turns on a handful of claims that are
 * each one line of code and each silently reversible:
 *
 *   - the model is told what notation it got (U-10), rather than left to
 *     infer it from the first line of the document;
 *   - `query' may be offered without offering `application/sparql-update'
 *     with it (U-11), which is a statement about ARGUMENTS and cannot be
 *     made by a list of tool names;
 *   - a figure cut off at the token limit is refused rather than shown
 *     (U-15), because a truncated SVG still draws;
 *   - the figure is kept with the digest of what it was drawn from (U-16),
 *     so "this is a picture of data that has moved" is a fact and not a
 *     suspicion.
 *
 * The browser half of the claims -- that the frame runs no script -- is in
 * `figure-frame.browser.mjs', because they are claims about a browser.
 *
 * Loading: jsui's package.json declares no "type", so lib/ is copied into a
 * scratch package that does, which keeps the relative imports intact.
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-figure-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { payloadOf, payloadTextOf, sparqlFrom, figureFrom } = await load("mcp/mcp-client.js");
const {
  argumentRefusal, createGrant, graphqlOperationOf, bodyReadsOnly,
  READ_NOTATIONS, WRITE_NOTATIONS, BODY_FIELDS,
} = await load("llm/grant.js");
const {
  createToolAdapter, FIGURE_TOOLS, DASHBOARD_TOOLS, ALLOW_TOOLS,
} = await load("llm/tool-adapter.js");
const {
  figureSystem, renderSystem, renderPrompt, FIGURE_MAX_TOKENS, RESULT_NOTATIONS,
} = await load("llm/figure-prompt.js");
const {
  validateProposal, figureSpecFrom, figurePolicy, aspectOf, capRows, acceptFor, figureRecord,
  DOT_ENGINES, DEFAULT_ENGINE,
} = await load("figure/spec.js");
const { buildFigurePage, FIGURE_SANDBOX, FIGURE_CSP } = await load("figure/frame.js");
const { insertData, exchangesFrom, readTranscript } = await load("mcp/transcript-store.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const resource = (text, mimeType) => ({
  result: { content: [{ type: "resource", resource: { text, ...(mimeType ? { mimeType } : {}) } }] },
});
const jsonResponse = (obj) => ({
  status: 200, ok: true, headers: { get: () => "application/json" },
  text: async () => JSON.stringify(obj),
});

/* ═══════════════════ U-10: the model sees what it got ═══════════════════ */

section("U-10: the payload travels with its media type");
{
  const p = payloadOf(resource("?s\t?o\na\tb\n", "text/tab-separated-values"));
  ok(p.text.startsWith("?s"), "the document is returned");
  ok(p.mimeType === "text/tab-separated-values",
     "and the notation it is written in, which used to be dropped one line early");

  ok(payloadOf(resource("x")).mimeType === null,
     "a resource that states no type says null rather than guessing one");
  ok(payloadOf({ result: { content: [{ type: "text", text: "plain" }] } }).text === "plain",
     "a bare text content is still read");
  ok(payloadOf({ result: {} }) === null && payloadOf(null) === null,
     "and nothing is read out of nothing");
  ok(payloadTextOf(resource("just the text")) === "just the text",
     "callers that only ever wanted the text have that");
  ok(sparqlFrom(resource("SELECT ?s WHERE { ?s ?p ?o }")) === "SELECT ?s WHERE { ?s ?p ?o }",
     "and sparqlFrom still reads a message as well as a string");
}

section("U-10: and the model is told, in the tool result itself");
{
  const seen = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("/mcp")) {
      const body = JSON.parse(init.body);
      if (body.method === "tools/list") {
        return jsonResponse({ result: { tools: [
          { name: "query", description: "Run one query.", inputSchema: { type: "object" } }] } });
      }
      return jsonResponse(resource("?region\t?value\nNorth\t120\n", "text/tab-separated-values"));
    }
    seen.push(JSON.parse(init.body));
    return jsonResponse(seen.length === 1
      ? { id: "m1", type: "message", role: "assistant", stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "query",
                      input: { body: "SELECT ?region ?value WHERE { ?s ?p ?o }",
                               mimeType: "application/sparql-query" } }],
          usage: {} }
      : { id: "m2", type: "message", role: "assistant", stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }], usage: {} });
  };
  const adapter = createToolAdapter({
    apiKey: "k", mcp: { endpoint: "https://h/a/r/mcp", token: "T" },
    allowTools: FIGURE_TOOLS, primeWith: [], fetchImpl,
  });
  const out = await adapter.run("what is there");
  const relayed = JSON.stringify(seen[1]);
  ok(relayed.includes("[text/tab-separated-values]"),
     "the notation is stated above the document the model reads");
  ok(relayed.includes("North"), "and the document itself is all still there");
  const result = out.events.find((e) => e.type === "tool_result");
  ok(result.mimeType === "text/tab-separated-values",
     "the event carries it too, so the record can say what the model was handed");
}

/* ═══════════ U-11: the screen is on the argument, not the name ══════════ */

section("U-11: offering `query' is not offering a write");
{
  ok(FIGURE_TOOLS.includes("query") && FIGURE_TOOLS.includes("survey"),
     "a figure run offers both, because a figure is drawn from a query");
  ok(!ALLOW_TOOLS.includes("query"),
     "while the plain exploration run still offers survey alone");
  ok(FIGURE_TOOLS.join() === DASHBOARD_TOOLS.join(),
     "the dashboard run offers the same pair, for the same reason");

  ok(argumentRefusal({ name: "query", input: { mimeType: "application/sparql-update" } }),
     "a write notation is refused");
  ok(/sparql-update/.test(argumentRefusal(
       { name: "query", input: { mimeType: "application/sparql-update" } })),
     "and the refusal names it, rather than saying `not allowed'");
  ok(argumentRefusal({ name: "query", input: { body: "PREFIX x: <u:x> DELETE { ?s ?p ?o } WHERE {}" } }),
     "so is a body whose operative keyword is a DELETE, whatever the notation said");
  ok(argumentRefusal({ name: "query", input: { body: 'SELECT ?s { ?s ?p "delete this" }' } }) === null,
     "while a SELECT carrying the word in a literal is a read, which is why this is not a grep");
  ok(argumentRefusal({ name: "sparql_update", input: {} }), "a tool outside the list is refused");
  ok(argumentRefusal({ name: "survey", input: { op: "catalog" } }) === null,
     "and an ordinary survey goes through");
}

section("U-11: the screen reads the arguments the SERVICE actually defines");
{
  // Read off a live `tools/list' on 2026-10-18: `query' takes `mimeType' and
  // `text'; `survey' takes `op' and `body'.  Both halves of this section are
  // regressions against a screen that was written from the plan rather than
  // from the schema, and was wrong about both.
  ok(BODY_FIELDS.includes("text") && BODY_FIELDS.includes("body"),
     "a document may arrive as `text' (query) or as `body' (survey), and both are read");
  ok(argumentRefusal({ name: "query", input: { mimeType: "application/sparql-query",
                                               text: "DELETE WHERE { ?s ?p ?o }" } }),
     "a DELETE in `text' is refused -- screening only `body' left the one tool "
   + "the screen exists for entirely unread");
  ok(/`text'/.test(argumentRefusal({ name: "query", input: { mimeType: "application/sparql-query",
                                                             text: "DROP ALL" } })),
     "and the refusal names the argument it found it in");

  ok(READ_NOTATIONS.includes("application/score"),
     "the score notation is `application/score', which is what the service advertises");
  ok(!READ_NOTATIONS.includes("text/x-score"),
     "and not `text/x-score', which it has never accepted -- a model asking for the "
   + "notation its own primer teaches would have been refused by this side");
  ok(!READ_NOTATIONS.some((n) => /turtle|csv|tab-separated/.test(n)),
     "response notations are not request notations and are no longer mixed in");
  ok(WRITE_NOTATIONS.length === 1 && WRITE_NOTATIONS[0] === "application/sparql-update",
     "one notation writes by its name alone; GraphQL does not, which is why it is read");
  ok(argumentRefusal({ name: "query", input: { mimeType: "application/score",
                                               text: "catalog" } }) === null,
     "so an ordinary score request goes through");
}

section("U-11: GraphQL writes by a keyword, not by a media type");
{
  ok(graphqlOperationOf("mutation { addPerson(name: \"x\") { id } }") === "mutation",
     "a mutation is one");
  ok(graphqlOperationOf("{ persons { name } }") === "query",
     "the anonymous shorthand is a query -- that is what it means");
  ok(graphqlOperationOf("fragment f on Person { name }\nquery Q { persons { ...f } }") === "query",
     "a document that opens with a fragment is still what its operation says");
  ok(graphqlOperationOf('query Q { persons(note: "mutation") { name } }') === "query",
     "the word inside a string is not an operation");
  ok(graphqlOperationOf("# mutation\n{ persons { name } }") === "query",
     "nor is it inside a comment");
  ok(graphqlOperationOf("{ a { mutation } }") === "query",
     "nor is a FIELD called mutation, which is why the scan tracks depth");

  const gq = (text) => argumentRefusal({ name: "query", input: { mimeType: "application/graphql", text } });
  ok(gq("mutation { addPerson { id } }"), "so a GraphQL mutation is refused");
  ok(/GraphQL mutation/.test(gq("mutation { addPerson { id } }")),
     "and said to be one, rather than reported as a SPARQL form it is not");
  ok(gq("{ persons { name } }") === null, "while a GraphQL query goes through");
  ok(argumentRefusal({ name: "query", input: { mimeType: "application/graphql+json",
      text: JSON.stringify({ query: "mutation { addPerson { id } }" }) } }),
     "the JSON envelope is opened and the document inside it screened");
  ok(bodyReadsOnly('{"query":"{ persons { name } }"}', "application/graphql+json"),
     "and an enveloped query is still a read");
}

section("U-11: the adapter applies it when nothing else is");
{
  let relayed = 0;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("/mcp")) {
      const body = JSON.parse(init.body);
      if (body.method === "tools/list") {
        return jsonResponse({ result: { tools: [
          { name: "query", description: "Run one query.", inputSchema: { type: "object" } }] } });
      }
      relayed += 1;
      return jsonResponse(resource("ok", "text/csv"));
    }
    return jsonResponse(relayed === 0
      ? { id: "m1", type: "message", role: "assistant", stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "query",
                      input: { body: "DELETE WHERE { ?s ?p ?o }",
                               mimeType: "application/sparql-update" } }], usage: {} }
      : { id: "m2", type: "message", role: "assistant", stop_reason: "end_turn",
          content: [{ type: "text", text: "understood" }], usage: {} });
  };
  const out = await createToolAdapter({
    apiKey: "k", mcp: { endpoint: "https://h/a/r/mcp", token: "T" },
    allowTools: FIGURE_TOOLS, primeWith: [], fetchImpl,
  }).run("delete everything");
  ok(relayed === 0, "the write never reached the service -- it was stopped on this side");
  const refused = out.events.find((e) => e.type === "refused");
  ok(refused && /writes|DELETE/.test(refused.reason),
     "and the refusal is in the record, with its reason");
  const told = out.events.find((e) => e.type === "tool_result" && e.refused);
  ok(told && /not made/.test(told.text),
     "the model is told, rather than left to infer it from a silence");
}

section("U-11: a grant, where there is one, remains the policy");
{
  // A user who deliberately granted write authority must not have it taken
  // back by a screen the adapter applies behind the grant's back.
  const g = createGrant({ readOnly: false, maxQueries: 3 });
  ok(g.check({ name: "query", input: { mimeType: "application/sparql-update" } }).ok,
     "a grant made writable passes a write");
  const ro = createGrant({ maxQueries: 3 });
  ok(!ro.check({ name: "query", input: { mimeType: "application/sparql-update" } }).ok,
     "while the default read-only grant refuses it, using the same screen");
}

/* ═══════════════════ U-12: the three-step contract ══════════════════════ */

section("U-12: the prompt says that drawing is step 3");
{
  const sys = figureSystem("You are exploring an RDF repository.");
  ok(sys.includes("You are exploring"), "the base prompt is kept");
  ok(/step 1/i.test(sys) && /Draw\./.test(sys), "and the three steps are named");
  ok(/do not draw yet/i.test(sys),
     "with the instruction NOT to draw from what it sampled, which is the point of the split");
  ok(sys.includes("```figure"), "the proposal's output contract is stated");
  ok(sys.includes("text/tab-separated-values") && sys.includes("costs several times as much"),
     "and the notations are priced, since the model is choosing one (D-L)");

  const r = renderSystem();
  ok(/no access to the repository/i.test(r), "the drawing turn is told it has no store");
  ok(/scripts disabled/i.test(r) && /silently/i.test(r),
     "and the frame's rules, which it cannot discover: a blocked fetch reports nothing");
  ok(/viewBox/.test(r), "the figure must scale");
  ok(/still draws/i.test(r), "and it is warned that running out of tokens does not look like failure");
  ok(FIGURE_MAX_TOKENS > 4096, "the drawing turn gets room, for the same reason");
  ok(RESULT_NOTATIONS.CONSTRUCT.includes("text/turtle"),
     "a CONSTRUCT is offered turtle, not a table");
}

section("U-12: the drawing turn carries the result and the question");
{
  const ask = renderPrompt({
    prompt: "which stations report most", query: "SELECT ?s ?n WHERE { ?s :n ?n }",
    figure: { kind: "svg", title: "Reports per station", caption: "a bar per station" },
    mimeType: "text/tab-separated-values", document: "?s\t?n\nA\t3\n", rows: 1, bytes: 12,
    view: "tmp-x-figure",
  });
  ok(ask.includes("which stations report most"),
     "the original question travels, or the figure is a generic rendering of the columns");
  ok(ask.includes("SELECT ?s ?n"), "so does the query -- column names rarely say what a column means");
  ok(ask.includes("text/tab-separated-values") && ask.includes("1 row(s)"),
     "and the result is announced as what it is");
  ok(ask.includes("tmp-x-figure"), "including the view it was run as, when there was one");
  ok(!/CUT to fit/.test(ask), "a whole document says nothing about being cut");
  ok(/CUT to fit/.test(renderPrompt({ document: "x", truncated: true })),
     "and a head says so, because a total drawn from a head is wrong in the way nobody checks");
}

/* ═══════════════════ U-15: reading a figure out of prose ════════════════ */

section("U-15: figureFrom");
{
  const svg = figureFrom("Here it is.\n\n```svg\n<svg viewBox=\"0 0 10 5\"><rect/></svg>\n```\n\n"
                       + "Caption: Reports per station, highest first.");
  ok(svg.kind === "svg", "an svg fence is an svg");
  ok(svg.text.startsWith("<svg") && svg.text.endsWith("</svg>"), "the element comes back whole");
  ok(svg.caption === "Reports per station, highest first.",
     "and the caption is the model's own sentence, not the pane's guess at one");
  ok(svg.complete === true, "a terminated element is complete");

  const cut = figureFrom("```svg\n<svg viewBox=\"0 0 10 5\"><rect x=\"1\"");
  ok(cut && cut.kind === "svg", "a figure cut off mid-element is still READ");
  ok(cut.complete === false,
     "and reported incomplete -- it would render, which is exactly why it must not be shown");

  const dot = figureFrom("```dot\ndigraph g { a -> b }\n```");
  ok(dot.kind === "dot" && dot.complete === true, "DOT is recognised and brace-checked");
  ok(figureFrom("```dot\ndigraph g { a -> b\n```").complete === false,
     "an unbalanced DOT graph is incomplete");

  ok(figureFrom("<svg viewBox='0 0 1 1'><g/></svg>").kind === "svg",
     "an answer that forgot the fence is still an answer");
  ok(figureFrom("nothing here at all") === null, "and prose with no figure is null");

  const two = figureFrom("```svg\n<svg id=\"first\" viewBox=\"0 0 1 1\"></svg>\n```\n"
                       + "on reflection:\n```svg\n<svg id=\"second\" viewBox=\"0 0 1 1\"></svg>\n```");
  ok(two.text.includes("second"),
     "the last block wins, so a model that reconsiders is not overruled by its first attempt");
}

/* ═══════════════════ the proposal, checked at Gate 1 ════════════════════ */

section("the proposal is validated, not trusted");
{
  const text = "I will chart it.\n\n```sparql\nSELECT ?r ?v WHERE { ?s :r ?r ; :v ?v }\n```\n\n"
             + "```figure\n{\"kind\":\"svg\",\"title\":\"By region\",\"caption\":\"a bar per region\","
             + "\"accept\":\"text/tab-separated-values\"}\n```";
  const v = validateProposal({ text });
  ok(v.ok && v.query.startsWith("SELECT"), "the query and the figure block are both read");
  ok(v.figure.title === "By region" && v.figure.accept === "text/tab-separated-values",
     "the model's own choices are kept");
  ok(figureSpecFrom("```figure\n{not json\n```") === null, "a malformed block is simply absent");

  const update = validateProposal({ query: "DELETE WHERE { ?s ?p ?o }" });
  ok(!update.ok && /not something this will run/.test(update.errors[0]),
     "a proposal that is not a read does not reach the user as runnable");

  const wrong = validateProposal({ query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
                                   spec: { accept: "text/csv" } });
  ok(wrong.figure.accept === "text/turtle",
     "a notation the form cannot produce is corrected to one it can");
  ok(wrong.warnings.some((w) => /text\/csv/.test(w)),
     "and the correction is visible at Gate 1, not applied quietly");

  // DOT is no longer a dead end: the engine is vendored and the graph is laid
  // out before it is mounted, so what the gate has to settle is WHICH engine.
  const dot = validateProposal({ query: "SELECT ?s WHERE { ?s ?p ?o }", spec: { kind: "dot" } });
  ok(dot.figure.engine === DEFAULT_ENGINE,
     "a DOT proposal is given a layout engine, since there is one to give");
  ok(!dot.warnings.some((w) => /kept as source/.test(w)),
     "and is no longer warned that nothing will draw it");
  const neato = validateProposal({ query: "SELECT ?s WHERE { ?s ?p ?o }",
                                   spec: { kind: "dot", engine: "NEATO" } });
  ok(neato.figure.engine === "neato", "the model's choice of engine is honoured");
  const nonsense = validateProposal({ query: "SELECT ?s WHERE { ?s ?p ?o }",
                                      spec: { kind: "dot", engine: "spiral" } });
  ok(nonsense.figure.engine === DEFAULT_ENGINE
     && nonsense.warnings.some((w) => /spiral/.test(w)),
     "an engine that does not exist is corrected, visibly, before anything runs");
  const chart = validateProposal({ query: "SELECT ?s WHERE { ?s ?p ?o }",
                                   spec: { kind: "svg", engine: "neato" } });
  ok(chart.figure.engine === undefined,
     "and an SVG carries no engine: there is nothing to lay out");

  ok(acceptFor("ASK { ?s ?p ?o }").accept === "application/sparql-results+json",
     "an ASK is asked for in a notation that can express a boolean");
}

section("the row cap is the lever Gate 1 offers");
{
  const q = "SELECT ?s WHERE { ?s ?p ?o }";
  ok(capRows(q, 50).query.endsWith("LIMIT 50") && capRows(q, 50).applied, "a cap is appended");
  ok(capRows(q, 0).applied === false, "no cap, no change");
  const limited = `${q}\nLIMIT 10`;
  ok(capRows(limited, 50).query === limited && capRows(limited, 50).had,
     "a query that already limits is left alone: the model chose that number and said why");
}

/* ═══════════════════ D-M: the frame, as a document ══════════════════════ */

section("D-M: the figure frame runs nothing");
{
  ok(FIGURE_SANDBOX === "",
     "every sandbox restriction, scripts included -- a picture does not have to run");
  ok(/script-src 'none'/.test(FIGURE_CSP), "and the policy says so a second time");
  ok(/default-src 'none'/.test(FIGURE_CSP) && /connect-src 'none'/.test(FIGURE_CSP),
     "nothing is loaded and nothing is sent");
  ok(!/allow-scripts/.test(FIGURE_SANDBOX), "the dashboard's one concession is not made here");

  const page = buildFigurePage({ kind: "svg", text: "<svg viewBox='0 0 2 1'><g/></svg>" },
                               { caption: "a caption", meta: { rows: 7, resultDigest: "abc",
                                                               mimeType: "text/csv" } });
  ok(page.includes("<svg"), "the figure is in the document as written -- nothing is sanitised");
  ok(page.includes("Drawn by a language model"),
     "and the document says who drew it, in the artifact and not only in the transcript (D-N)");
  ok(page.includes("abc") && page.includes("7 row"),
     "with the digest of what it was drawn from, so a copy found later can be matched");
  ok(/http-equiv="Content-Security-Policy"/.test(page) && /script-src &#39;none&#39;/.test(page),
     "the policy travels with the file it governs, so a saved copy is governed too");

  const dot = buildFigurePage({ kind: "dot", text: "digraph g { a -> b }" });
  ok(dot.includes("fig-dot") && !/<svg/.test(dot),
     "a DOT figure that has not been laid out is shown as source");
  ok(/has not been laid out/.test(dot),
     "and the reason is given, rather than leaving a wall of text unexplained");
  const failed = buildFigurePage({ kind: "dot", text: "digraph g {" },
                                  { layout: { error: "syntax error in line 1" } });
  ok(/syntax error in line 1/.test(failed),
     "a graph that would not lay out says what the engine said");

  // The drawing and the source in one file, because the saved copy is the
  // one that gets mailed to someone who cannot re-run anything.
  const laid = buildFigurePage({ kind: "dot", text: "digraph g { a -> b }" },
    { drawing: "<svg viewBox='0 0 4 1'><g/></svg>",
      layout: { engine: "neato", version: "16.1.0" } });
  ok(/<svg/.test(laid) && /<details class="fig-src"/.test(laid),
     "a laid-out graph saves as the drawing AND the source it was drawn from");
  ok(/digraph g \{ a -&gt; b \}/.test(laid),
     "with the source escaped, since it is text in a document and not markup");
  ok(/graphviz 16\.1\.0/.test(laid) && /neato/.test(laid),
     "and the provenance names the engine: the geometry is not the model's work");
  ok(!/has not been laid out/.test(laid),
     "and does not also carry the note for a graph that was not drawn");
}

section("what the policy will silently refuse is said out loud");
{
  const notes = figurePolicy(
    "<svg viewBox='0 0 1 1' onload='x()'><script>1</script>"
  + "<image href='https://example.com/a.png'/><foreignObject/></svg>");
  ok(notes.some((n) => /<script>/.test(n)), "a script element is named");
  ok(notes.some((n) => /handler/.test(n)), "so is an inline handler");
  ok(notes.some((n) => /external reference/.test(n)), "so is an external image");
  ok(notes.some((n) => /foreignObject/.test(n)), "so is a foreignObject");
  ok(figurePolicy("<svg viewBox='0 0 1 1'><g/></svg>").length === 0,
     "and a figure that keeps inside the rules draws no notes");
  ok(figurePolicy("<svg><g/></svg>").some((n) => /viewBox/.test(n)),
     "a figure with no viewBox cannot scale, and is told so");

  ok(Math.abs(aspectOf("<svg viewBox='0 0 640 480'>") - 640 / 480) < 1e-9,
     "the ratio is read from the viewBox, since nothing in the frame can measure itself");
  ok(aspectOf("<svg>") === 16 / 9, "and a figure without one falls back rather than collapsing");
}

/* ═══════════════════ U-16: the record ═══════════════════════════════════ */

section("U-16: a figure is its own exchange kind");
{
  const xs = exchangesFrom([
    { type: "prompt", text: "chart it", at: "2026-10-18T10:00:00Z" },
    { type: "execute", ok: true, ms: 12, status: 200, view: "tmp-r-figure", via: "catalog",
      accept: "text/tab-separated-values", query: "SELECT ?s WHERE {?s ?p ?o}",
      text: "?s\nA\n", rows: 1, at: "2026-10-18T10:00:01Z" },
    { type: "figure", ok: true, kind: "svg", text: "<svg/>", caption: "one bar",
      at: "2026-10-18T10:00:02Z" },
  ]);
  const exec = xs.find((x) => x.kind === "execute");
  ok(exec && exec.content === "?s\nA\n",
     "Phase 2 is recorded with the document the INTERFACE fetched");
  ok(exec.tool === "view" && exec.document === "tmp-r-figure",
     "and by what route, because that is the difference between proposing and executing");
  const fig = xs.find((x) => x.kind === "figure");
  ok(fig && fig.content === "<svg/>" && fig.document === "svg",
     "the figure is kept, not just the fact that there was one");
  ok(/one bar/.test(fig.arguments || ""), "with its caption");
}

section("U-16: and its own node, joined to the result by a digest");
{
  const update = insertData({
    graph: "http://dydra.com/explorations/S/transcript",
    exploration: "http://dydra.com/explorations/S",
    repository: "test/foaf",
    run: { id: "r-1", prompt: "chart it", ended: new Date("2026-10-18T10:00:00Z") },
    exchanges: [],
    figure: figureRecord({
      figure: { kind: "svg", text: "<svg viewBox='0 0 1 1'/>", caption: "one bar", complete: true },
      proposal: { query: "SELECT ?s WHERE { ?s ?p ?o }",
                  figure: { title: "Stations", accept: "text/tab-separated-values" } },
      result: { digest: "d1e2", rows: 7, mimeType: "text/tab-separated-values", text: "x" },
      disposition: "kept", view: null, promotedTo: "stations", via: "direct",
    }),
  });
  ok(/ a mcp:Figure /.test(update),
     "the figure is a node of its own, typed with rdf:type -- which is what a query for it asks");
  ok(/mcp:provenance "model"/.test(update),
     "marked model-produced, which D-N says is never presented as the repository's own output");
  ok(/mcp:resultDigest "d1e2"/.test(update) && /mcp:rows "7"/.test(update),
     "carrying the digest and the cardinality of what it was drawn from");
  ok(/mcp:query "SELECT/.test(update), "and the query, so the run can be repeated");
  ok(/mcp:disposition "kept"/.test(update) && /mcp:promotedTo "stations"/.test(update),
     "and what the user decided, which is the most useful line in the record later");
  ok(/mcp:figureDigest/.test(update), "the figure itself is digested too");
  ok(update.includes("<svg viewBox='0 0 1 1'/>"), "and kept whole: a record of a picture holds it");
}

section("U-16: reading it back does not mistake a figure for a run");
{
  const G = "http://dydra.com/explorations/S/transcript";
  const rows = [
    { s: G, p: "mcp#type", o: "mcp#Transcript" },
    { s: `${G}#r-1`, p: "mcp#type", o: "mcp#Run" },
    { s: `${G}#r-1`, p: "mcp#prompt", o: "chart it" },
    { s: `${G}#r-1-x1`, p: "mcp#type", o: "mcp#Exchange" },
    { s: `${G}#r-1-x1`, p: "mcp#run", o: `${G}#r-1` },
    { s: `${G}#r-1-x1`, p: "mcp#ordinal", o: "1" },
    { s: `${G}#r-1-x1`, p: "mcp#kind", o: "figure" },
    { s: `${G}#r-1-figure`, p: "mcp#type", o: "mcp#Figure" },
    { s: `${G}#r-1-figure`, p: "mcp#run", o: `${G}#r-1` },
    { s: `${G}#r-1-figure`, p: "mcp#figureKind", o: "svg" },
    { s: `${G}#r-1-figure`, p: "mcp#caption", o: "one bar" },
    { s: `${G}#r-1-figure`, p: "mcp#resultDigest", o: "d1e2" },
    { s: `${G}#r-1-figure`, p: "mcp#content", o: "<svg/>" },
    // a dashboard node from another run in the same graph, for good measure
    { s: `${G}#r-0-dashboard`, p: "mcp#type", o: "mcp#Dashboard" },
    { s: `${G}#r-0-dashboard`, p: "mcp#run", o: `${G}#r-0` },
  ];
  const fetchImpl = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({
    head: {}, results: { bindings: rows.map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, { type: "literal", value: v }]))) } }) });
  const r = await readTranscript({ host: "https://h", account: "test", token: "T",
                                   exploration: "http://dydra.com/explorations/S", fetchImpl });
  ok(r.runs.length === 1,
     "one run -- the figure and the dashboard nodes are not read as runs with no prompt");
  ok(r.runs[0].figures.length === 1 && r.runs[0].figures[0].caption === "one bar",
     "the figure comes back attached to the run that drew it");
  ok(r.runs[0].figures[0].resultDigest === "d1e2",
     "with the digest that joins it to the data, which is the question the record exists to answer");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
