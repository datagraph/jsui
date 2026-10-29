/**
 * Provenance: EU AI Act Article 50, as this interface answers it.
 *
 * `ui-generator.md' §2.6, decision D-AD, work items U-46 … U-49.
 *
 * The assertions here are mostly about the seams rather than the strings,
 * because every way this requirement is got wrong is a seam:
 *
 *   - a mark that records the model that was ASKED FOR rather than the one
 *     the provider SERVED records the request, not the fact;
 *   - a mark that lives beside the artefact is gone the moment the artefact
 *     travels, which is the moment 50(4) is engaged;
 *   - a mark drawn OVER a figure can sit on a data point, so provenance
 *     destroys evidence;
 *   - a mark the model is asked to write is a mark it can omit under a token
 *     ceiling, in the run where provenance matters most;
 *   - a mark that says "a model made this" about a `data-bound` panel of
 *     fetched rows is false, and is the over-marking that teaches a reader to
 *     ignore every mark.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-provenance-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { provenanceOf, provenanceLine, provenanceRecord, provenanceDate } =
  await load("provenance.js");
const { markSvg, viewBoxOf, isMarked, LEDGER_HEIGHT } = await load("figure/provenance-mark.js");
const { buildFigurePage } = await load("figure/frame.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const WHO = { model: "claude-opus-5", servedModel: "claude-opus-5-20261014",
              provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages",
              at: "2026-10-21T09:30:00.000Z", account: "test", repository: "foaf" };

/* ══════════════ the identifier is the one that was SERVED ═════════════════ */

section("R-P1: the model recorded is the one the provider served, not the one asked for");
{
  const v = provenanceOf(WHO);
  ok(v.model === "claude-opus-5-20261014",
     "the served identifier is what the mark shows");
  ok(v.requested === "claude-opus-5" && v.served === true,
     "and the requested one is kept beside it, because they are two different facts "
   + "that look like one string");

  const asked = provenanceOf({ model: "claude-opus-5", at: WHO.at });
  ok(asked.model === "claude-opus-5" && asked.served === false,
     "with no served identifier the requested one is used — and flagged as not served, "
   + "rather than passed off as the fact");

  ok(provenanceOf({}).at && !Number.isNaN(Date.parse(provenanceOf({}).at)),
     "a mark with no time given is stamped now: there is no such thing as an undated one");
  ok(provenanceOf({ at: "not a date" }).at,
     "and an unparsable time does not produce an unparsable mark");
}

section("the line a person reads says what, when and from where");
{
  const line = provenanceLine(WHO);
  ok(/claude-opus-5-20261014/.test(line), "the model");
  ok(/2026-10-21/.test(line), "the date");
  ok(/test\/foaf/.test(line),
     "and the repository — R-P5: the mark names the model AND the data, so it cannot be "
   + "read as saying a model invented the numbers");
  ok(line.length < 90,
     "short, because a footnote stops being read by becoming a paragraph, and an unread "
   + "mark fails 50(5) as surely as no mark");
  ok(provenanceDate("2026-10-21T23:59:00Z") === "2026-10-21", "the date is the day, in UTC");
}

section("R-P4: the same facts, for a program that will not parse prose");
{
  const r = provenanceRecord(WHO);
  ok(r["ai:generated"] === true && r["ai:model"] === "claude-opus-5-20261014",
     "generated, and by what");
  ok(r["ai:modelRequested"] === "claude-opus-5" && r["ai:modelServed"] === true,
     "with the served/requested distinction preserved in the data too");
  ok(r["ai:repository"] === "test/foaf", "the repository, qualified by its account");
  ok(r["ai:disclosure"] === "EU AI Act Article 50",
     "and which obligation it answers, so a reader of the data knows what it is for");
}

/* ═══════════════════ the ledger drawn into the figure ═════════════════════ */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
          + '<title>t</title><rect x="0" y="0" width="400" height="300" fill="#fff"/>'
          + '<circle cx="395" cy="295" r="3"/></svg>';

section("§2.6.1: the ledger is drawn INSIDE the figure, not around it");
{
  const out = markSvg(SVG, WHO);
  ok(out.ok, "an SVG with a viewBox can be marked");
  ok(/<svg[^>]*viewBox="0 0 400 318"/.test(out.svg),
     `the viewBox GREW by the band's height (${LEDGER_HEIGHT}), so the drawing is moved `
   + "over, not covered — a ledger laid on a chart's corner can sit on a data point");
  ok(/<circle cx="395" cy="295"/.test(out.svg),
     "and every original element is still there, at its original coordinates");
  ok(out.svg.indexOf("claude-opus-5-20261014") > out.svg.indexOf("<svg"),
     "the text is inside the <svg> element, so it survives a copy of the picture — "
   + "which is exactly when 50(4) applies and a pane footnote is already gone");
  ok(/<metadata[^>]*data-provenance="ai"/.test(out.svg) && /ai_model/.test(out.svg),
     "with the machine-readable half beside it (R-P4)");
  ok(/<text[^>]*font-size="\d+"[^>]*fill="/.test(out.svg),
     "styled by presentation attributes, not a <style> block: a copied figure may land "
   + "where inline CSS does not survive, and an illegible mark is not a mark");
}

section("marking is idempotent, bounded, and never half-done");
{
  const once = markSvg(SVG, WHO);
  const twice = markSvg(once.svg, WHO);
  ok(twice.ok && twice.already && twice.svg === once.svg,
     "a figure already marked is left alone — a redraw must not stack ledgers");
  ok(isMarked(once.svg) && !isMarked(SVG), "which is detectable without re-parsing");

  const noBox = markSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', WHO);
  ok(!noBox.ok && /viewBox/.test(noBox.reason) && noBox.svg.includes("<rect/>"),
     "a figure with no viewBox is returned UNCHANGED with a reason, rather than marked "
   + "at a guessed scale — the caller shows the reason, because silently unmarked is the "
   + "one outcome §2.6 does not allow");
  ok(!markSvg("", WHO).ok && !markSvg("<p>not a figure</p>", WHO).ok,
     "and nothing that is not a figure is mistaken for one");
  ok(viewBoxOf('<svg viewBox="1 2 30 40">') .width === 30, "the viewBox is read, not assumed");
  ok(viewBoxOf('<svg viewBox="0 0 0 40">') === null,
     "and a degenerate one is refused rather than divided by");
}

section("the interface draws it, never the model");
{
  // The whole argument for marking in `buildFigurePage': it is the one place
  // the mounted frame and the saved file are both composed, so a figure
  // cannot be shown marked and saved unmarked.
  const page = buildFigurePage({ kind: "svg", text: SVG }, { aiProvenance: WHO });
  ok(/claude-opus-5-20261014/.test(page),
     "the saved page carries the ledger, because it is built from the same function "
   + "as the mounted one");
  const unmarked = buildFigurePage({ kind: "svg", text: SVG }, {});
  ok(!/claude-opus/.test(unmarked),
     "and a caller that knows of no model marks nothing, rather than inventing one");

  const dot = buildFigurePage({ kind: "dot", text: "digraph{a->b}" },
                              { drawing: SVG, aiProvenance: WHO });
  ok(/claude-opus-5-20261014/.test(dot),
     "a DOT figure is marked on the SVG graphviz RETURNED — after layout, for the same "
   + "reason: the model does not write the mark and cannot omit it");
  const notLaidOut = buildFigurePage({ kind: "dot", text: "digraph{a->b}" },
                                     { aiProvenance: WHO });
  ok(!/<metadata/.test(notLaidOut),
     "while DOT source shown as source is not an image and gets no ledger drawn on it");
}

/* ════════════════ the provider half: the served identifier ════════════════ */

section("R-P1: every provider reports the model it actually served");
{
  const providers = await load("llm/providers.js");
  // Every DISTINCT wire shape in the module — the registered providers plus
  // the ones a gateway routes to, which are exported but not registered
  // (`opencode' has no `read' of its own: it routes per model).  Enumerated
  // this way so a provider added later is held to this too.
  const all = [...new Set([
    ...providers.providerIds().map((id) => providers.providerFor(id)),
    providers.anthropic, providers.openai, providers.openaiResponses,
  ])].filter((p) => p && Object.prototype.hasOwnProperty.call(p, "read"));
  ok(all.length === 3,
     `all ${all.length} wire shapes are checked — anthropic, chat completions and `
   + "responses — not just the default one");
  for (const p of all) {
    const read = p.read({ model: "served-id-1", content: [], choices: [{ message: {} }],
                          output: [] });
    ok(read.model === "served-id-1",
       `${p.id || "a provider"} surfaces the served model identifier`);
  }
  ok(all.every((p) => p.read({}).model === null),
     "and a response that names no model says null rather than guessing at one");
}

/* ═════════ the server half: what the endpoint is told, and by whom ════════ */

section("R-P1 at the MCP boundary: the client states the model, because the server cannot see it");
{
  const { mcpCall } = await load("mcp/mcp-client.js");
  const { relayToolCall } = await load("llm/tool-adapter.js");
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
                        { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await relayToolCall(
    { endpoint: "https://h/mcp", token: "t", fetchImpl,
      model: { served: "claude-opus-5-20261014", requested: "claude-opus-5",
               provider: "anthropic" } },
    { name: "query", input: { sparql: "ASK{}" } });
  const meta = sent[0].params._meta;
  ok(meta["com.dydra/model"] === "claude-opus-5-20261014",
     "a tools/call carries the SERVED identifier in its own _meta");
  ok(meta["com.dydra/modelRequested"] === "claude-opus-5"
     && meta["com.dydra/modelProvider"] === "anthropic",
     "with the requested one and the provider beside it");
  ok(Object.keys(meta).filter((k) => /\bmodel(Requested|Provider)?$/.test(k))
       .every((k) => k.startsWith("com.dydra/")),
     "every model field is under our own reverse-DNS prefix, since "
   + "io.modelcontextprotocol/* is reserved to the specification");
  ok(Boolean(meta["io.modelcontextprotocol/protocolVersion"]),
     "and the required spec fields are still there — this is an addition, not a replacement");

  sent.length = 0;
  await relayToolCall(
    { endpoint: "https://h/mcp", token: "t", fetchImpl,
      model: { served: "m", requested: "m", provider: "anthropic" } },
    { name: "query", input: {} });
  ok(!("com.dydra/modelRequested" in sent[0].params._meta),
     "a requested identifier equal to the served one is NOT sent: a field repeated on "
   + "every request to say nothing is a field a reader learns to skip");

  sent.length = 0;
  await mcpCall({ endpoint: "https://h/mcp", token: "t", method: "tools/list", fetchImpl });
  const bare = sent[0].params._meta;
  ok(!Object.keys(bare).some((k) => k.startsWith("com.dydra/")),
     "and a call with no model behind it — tools/list, a primer read, the interface's own "
   + "housekeeping — states none, rather than recording a model for work it did not do");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
