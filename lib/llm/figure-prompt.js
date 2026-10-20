/**
 * What the model is told when it is asked for a figure.  Work item U-12.
 *
 * There are two prompts here, not one, because §2 of the plan is two model
 * calls with a store read between them.  That split is the whole of D-I: the
 * model proposes a query, the INTERFACE runs it, and only then is the model
 * asked to draw -- from the document the interface fetched, not from rows it
 * reported to itself.  A single prompt saying "explore, then draw" would let
 * the model draw from what it saw during exploration, and the figure would be
 * a picture of remembered data.  So the contract is stated twice, and the two
 * statements say different things.
 *
 * The first (`FIGURE_CONTRACT') ends the first call at a proposal and is
 * explicit that the figure comes later, because a model that does not know
 * step 3 exists writes its best guess at a chart in step 2 -- out of data it
 * has only sampled -- and then has nothing left to do with the real result.
 *
 * The second (`RENDER_CONTRACT') states the frame's rules, which the model
 * cannot discover.  A figure renders with scripts disabled and with
 * `default-src 'none'': an `onload' handler simply never fires and a web font
 * simply never arrives, with no error anywhere.  Silence is the problem.  A
 * model told the rules writes within them; a model left to find out produces
 * something that looks right to it and renders blank.
 */

/**
 * Tokens for the drawing turn.
 *
 * The adapter's default is sized for prose and a query.  An SVG of a chart
 * with its axes, ticks and labels written out is several thousand tokens of
 * markup, and the failure mode of running short is not an error: a truncated
 * SVG still partly renders, which is worse than one that does not render at
 * all, because it looks finished.  The pane refuses an incomplete figure
 * (`figureFrom().complete'), and this is what makes that refusal rare.
 */
export const FIGURE_MAX_TOKENS = 16384;

/** Result notations the interface will ask for in Phase 2, by query form. */
export const RESULT_NOTATIONS = {
  SELECT: ["text/tab-separated-values", "text/csv", "application/sparql-results+json"],
  ASK: ["application/sparql-results+json", "text/tab-separated-values"],
  CONSTRUCT: ["text/turtle", "application/n-triples"],
  DESCRIBE: ["text/turtle", "application/n-triples"],
};

import { DOT_ENGINES, ENGINE_NOTES } from "../wasm/graphviz.js";

export const FIGURE_CONTRACT = [
  "## What this run produces",
  "",
  "A figure drawn from repository data, in three steps. You are at step 1.",
  "",
  "1. **Explore.** Use the tools to find out what is actually in the repository:",
  "   the classes, the predicates, the shape of the data. Everything you state",
  "   about it has to come from a call you made.",
  "2. **Propose one query and say what you will draw.** This is where this call",
  "   ends. You do not draw yet, and you should not: what you have seen so far is",
  "   a sample, and the figure must be drawn from the real result.",
  "3. **Draw.** The interface runs your query itself, under the user's own",
  "   credentials, and then asks you again — with the actual result document",
  "   attached — to produce the figure. That second request is where the picture",
  "   is made.",
  "",
  "Knowing that step 3 exists should change step 2: write the query that returns",
  "exactly the columns the figure needs, in the shape it needs them, and keep it",
  "small enough to be worth sending back to you. An aggregate of 20 rows makes a",
  "better chart than 5000 raw ones, and costs a fraction of the round trip.",
  "",
  "### Answer with",
  "",
  "The query in a fenced ```sparql block, and the figure's description in a",
  "fenced ```figure block of JSON:",
  "",
  "```figure",
  "{",
  '  "kind": "svg",',
  '  "title": "Observations per station",',
  '  "caption": "what the reader should take from it, in one sentence",',
  '  "accept": "text/tab-separated-values",',
  '  "why": "a bar chart because the comparison is between a dozen named things"',
  "}",
  "```",
  "",
  "`kind` is `svg` for anything you will draw yourself, or `dot` for a graph —",
  "and for a graph, **prefer `dot`**. The interface lays it out with a real",
  "graphviz, compiled into the page, and shows the drawing with your source",
  "beside it. You write the structure; the engine does rank assignment,",
  "crossing reduction and spline routing, which you cannot do in one pass and",
  "should not spend tokens attempting. With `kind: \"dot\"` you may name the",
  "engine:",
  "",
  ...DOT_ENGINES.map((e) => `  \`${e}\` — ${ENGINE_NOTES[e]}`),
  "",
  "(default `dot`). Put it in the proposal as `\"engine\": \"neato\"`.",
  "Keep `svg` for charts, diagrams and anything whose placement carries meaning.",
  "`accept` is the notation you want the result in when it comes back to you:",
  "`text/tab-separated-values` for a SELECT (compact, one row per line),",
  "`text/turtle` for a CONSTRUCT or DESCRIBE, `application/sparql-results+json`",
  "only if you need the datatype of every cell — it costs several times as much.",
  "",
  "Then say, in a sentence or two, what the query returns and what you checked to",
  "be sure of it. The user reads that before authorising the run.",
].join("\n");

export const RENDER_CONTRACT = [
  "## Draw the figure",
  "",
  "The result below is the real one: the interface ran the query itself and this",
  "is what came back. Draw from these values and no others. If the result is",
  "empty or contradicts what you expected, say so in prose instead of drawing a",
  "figure of what you assumed.",
  "",
  "### The frame it renders in",
  "",
  "Your figure is displayed in a sandbox with **scripts disabled entirely** and a",
  "policy of `default-src 'none'`. That has consequences you cannot observe,",
  "because nothing reports them:",
  "",
  "- `<script>`, `onload=`, `onclick=` and every other handler: never run.",
  "  Anything the figure needs must be in the markup already.",
  "- No external references of any kind. No `<image href=\"https://…\">`, no web",
  "  font, no `@import`, no `xlink:href` to a URL. They fail silently, leaving a",
  "  hole where the thing was.",
  "- `<foreignObject>` is unavailable. Use `<text>` for text.",
  "- Inline `<style>` inside the SVG, and presentation attributes, both work.",
  "",
  "### The figure itself",
  "",
  "- One fenced ```svg block holding one complete `<svg>` element, and nothing",
  "  else after it but the caption line — or, if you proposed a graph, one",
  "  fenced ```dot block holding the graph. A DOT answer is laid out here by",
  "  graphviz and drawn; it does not have to be geometry and must not be.",
  "- Give it a `viewBox` and no fixed `width`/`height`, so it scales to the pane.",
  "- Include an `<title>` as the first child, for a reader who cannot see it.",
  "- Draw the axes, the scale and the labels: an unlabelled chart is a decoration.",
  "- Keep it inside your token budget. **A figure cut off part way still draws**,",
  "  and a chart missing its last series looks finished. If it is going to be",
  "  long, simplify it rather than risk that.",
  "",
  "End with one line:",
  "",
  "`Caption: <one sentence saying what the figure shows>`",
].join("\n");

/** The system prompt for Phase 1 of a figure run. */
export function figureSystem(base, { tools = true } = {}) {
  return [base, FIGURE_CONTRACT, tools ? "" : NO_TOOLS].filter(Boolean).join("\n\n");
}

const NO_TOOLS = [
  "No tools are available in this run, so step 1 cannot happen. Say what you",
  "would need to look up rather than guessing at names.",
].join("\n");

/** The system prompt for Phase 3.  No tools, no store: one document, one figure. */
export function renderSystem() {
  return [
    "You draw figures from data that has already been fetched for you.",
    "",
    "You have no tools in this request and no access to the repository: the one",
    "document below is everything there is. Do not ask for more and do not fill a",
    "gap with a plausible value — a figure is read as a measurement.",
    "",
    RENDER_CONTRACT,
  ].join("\n");
}

/**
 * The Phase 3 user message: the result, what it is, and what it was for.
 *
 * The original prompt travels with it.  Without it the model is drawing a
 * table it has no reason for, and the figure that comes back is a generic
 * rendering of the columns rather than an answer to the question that was
 * asked.  The query travels too, because the column names alone rarely say
 * what a column MEANS.
 */
export function renderPrompt({
  prompt, query, figure = {}, mimeType, document: doc, rows = null, bytes = null,
  truncated = false, view = null,
} = {}) {
  const head = [
    `The user asked: ${String(prompt || "").trim() || "(no prompt recorded)"}`,
    "",
    `You proposed to draw: ${figure.title || "a figure"}`
    + (figure.caption ? ` — ${figure.caption}` : "")
    + (figure.kind ? ` (${figure.kind})` : ""),
    "",
    "The query that was run"
    + (view ? `, as the view \`${view}\`` : "")
    + ":",
    "",
    "```sparql",
    String(query || "").trim(),
    "```",
    "",
    `The result, as \`${mimeType || "an unstated notation"}\``
    + (rows != null ? `, ${rows} row(s)` : "")
    + (bytes != null ? `, ${bytes} characters` : "")
    + ":",
    "",
  ];
  const tail = truncated
    ? ["", "This document was CUT to fit: it is the head of the result, not all of it.",
       "Say so in the caption rather than drawing a total that is not one."]
    : [];
  return [...head, "```", String(doc ?? ""), "```", ...tail].join("\n");
}

export default figureSystem;
