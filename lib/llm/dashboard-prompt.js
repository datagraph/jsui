/**
 * What the model is told when it is asked for a dashboard.
 *
 * The output contract of D-P, stated to the side that has to satisfy it.  Two
 * things make this prompt longer than a "draw me a chart" prompt would be, and
 * both are load-bearing:
 *
 *   1. The three content classes are not a formality.  A model given a free
 *      hand writes the numbers into the HTML, and a page with the numbers
 *      written into it is a photograph: it cannot refresh, and it cannot tell
 *      anyone when it has become false.  The classes exist so that each region
 *      says which of those it is.
 *   2. The frame's rules have to be stated, because the model cannot discover
 *      them.  A page that fetches its own data fails silently behind
 *      `connect-src 'none'', and "silently" is the problem -- the model gets no
 *      error to learn from and the user gets a blank panel.
 *
 * The preference order -- query, then transform, then its own reading -- is
 * argued rather than asserted, because a rule a model understands it follows in
 * cases the rule did not anticipate, and this one has many.
 */

export const DASHBOARD_CONTRACT = [
  "## Producing a dashboard",
  "",
  "You are composing a complete HTML page from repository data. You may combine",
  "several queries, compute from their results, merge in what you know, and write",
  "analytic prose about what you find. All of that is wanted. What matters is that",
  "the page says which is which.",
  "",
  "### Three kinds of region",
  "",
  "**bound** — `<div data-bound=\"panelName\">`. The interface runs that panel's",
  "query itself and fills the slot. Live: it refreshes, and the data is the",
  "interface's own rather than something you transcribed.",
  "",
  "**derived** — `<div data-derived=\"transformName\">`. A value YOU compute,",
  "written as a function the page can re-run. This is where anything SPARQL cannot",
  "express belongs: pivots, ratios, rankings, time alignment, approximate joins,",
  "unit conversion, merging two result sets on a fuzzy key. It stays live, because",
  "the function runs again when the data does.",
  "",
  "**asserted** — `<div data-asserted=\"id\">`. Prose, judgement, interpretation,",
  "context from outside the repository. Not re-derivable by anything. Declare the",
  "panels it was written from in `inputs`, so that when those results change the",
  "page can mark the sentence as written against data that has moved.",
  "",
  "### Prefer the cheapest route that can say the thing",
  "",
  "1. **One query.** A UNION, a sub-select, an aggregate, GROUP BY — if SPARQL can",
  "   express the combination, make it a panel and bind it.",
  "2. **A transform.** If SPARQL cannot say it, write the function.",
  "3. **Your own reading.** Read the results and write the answer.",
  "",
  "Not because your arithmetic is suspect — because the first two survive a refresh",
  "and the third does not. Analytic text IS the third kind, and a dashboard without",
  "it is worse. Use it for what it is for: meaning, not arithmetic.",
  "",
  "### The page runs sandboxed",
  "",
  "- No network of any kind: no `fetch`, no XHR, no web sockets, no external",
  "  scripts, stylesheets, fonts or images. They are blocked, silently.",
  "- No storage: `localStorage` and cookies throw or are empty.",
  "- Inline `<style>` and `<script>` work. Draw with SVG, canvas or the DOM.",
  "- Data arrives after load, through `window.dashboard`:",
  "    `dashboard.table(\"panel\")`     → {names, rows}",
  "    `dashboard.objects(\"panel\")`   → [{column: value}, …]",
  "    `dashboard.render(\"name\", (el, ctx) => …)`  take over drawing one slot",
  "    `dashboard.on(\"data\", ({results, derived}) => …)`  redraw when data lands",
  "    `dashboard.refresh()`            ask the interface to re-run the panels",
  "  A slot with no renderer gets a readable default table, so a page that only",
  "  declares slots still works.",
  "",
  "### The answer",
  "",
  "One fenced ```dashboard block holding JSON, and nothing else after it:",
  "",
  "```dashboard",
  "{",
  '  "title": "…",',
  '  "panels": [',
  '    {"name": "sales", "query": "SELECT …", "accept": "text/tab-separated-values",',
  '     "caption": "what this answers"}',
  "  ],",
  '  "transforms": [',
  '    {"name": "margin", "inputs": ["sales", "costs"],',
  '     "body": "const by = {}; for (const r of inputs.sales.objects) …; return rows;"}',
  "  ],",
  '  "assertions": [',
  '    {"id": "lead", "inputs": ["sales"], "text": "Revenue concentration rose …"}',
  "  ],",
  '  "html": "<h1>…</h1><section data-bound=\\"sales\\"></section>…"',
  "}",
  "```",
  "",
  "A transform body is a function body. It receives `inputs` — one entry per name",
  "in `inputs`, each `{names, rows, objects, digest}` — and returns what the slot",
  "should show: a string or number, an array of objects, `{names, rows}`, or a DOM",
  "node. Transforms may read earlier transforms, so declare them in dependency",
  "order.",
  "",
  "Every panel query must be a SELECT, CONSTRUCT, ASK or DESCRIBE. Every name used",
  "in the HTML must be declared. Say in the prose, before the block, what the page",
  "will show and which queries it rests on — that is what the user reads before",
  "authorising the run.",
].join("\n");

/** How a result arrives when there are too many to arrive whole (D-Q). */
export const DIGEST_CONTRACT = [
  "### Result size",
  "",
  "A large result arrives as its SHAPE — columns, types, ranges, cardinality and a",
  "head sample — with a label such as `r3`. That is a default, not a limit: call",
  "`result_full` with that label to read the whole document, as often as the",
  "analysis needs it, until the budget you were granted is spent. Prefer a query",
  "that reduces (COUNT, GROUP BY, an aggregate) over reading rows you will only",
  "total up — it is cheaper for you and for the store.",
].join("\n");

/**
 * The output ceiling, stated.
 *
 * A dashboard is the longest answer this interface ever asks for -- a whole
 * HTML page, inside a JSON string, after however much prose the model wants to
 * write first -- and it is produced in ONE turn.  A turn that reaches the
 * ceiling mid-page is not a short answer: the fenced block never closes, so it
 * cannot be parsed, and the entire exploration that preceded it is lost at the
 * last step.  Nothing on this side can recover it; only the model can avoid it,
 * and it cannot avoid what it has not been told.
 *
 * So the budget is stated, with the one instruction that actually prevents the
 * failure: when the page will not fit, say so and propose a smaller one, rather
 * than beginning a page there is no room to finish.
 */
export function answerBudget(tokens) {
  if (!tokens) return "";
  return [
    "### Your answer has to fit",
    "",
    `The final turn has ${tokens} output tokens, and everything goes in it: the`,
    "prose, the JSON, and the whole HTML page inside it. A block that reaches the",
    "ceiling before it closes cannot be parsed, so nothing is run and the whole",
    "exploration is wasted at the last step.",
    "",
    "Budget for it. Few panels rather than many; plain markup; no long inline",
    "stylesheet, no framework shim, no data written into the HTML (that is what",
    "the bound slots are for). If what was asked for will not fit, say so and",
    "propose a narrower page — do not begin a page you cannot finish.",
  ].join("\n");
}

/** How the grant is described to the model, so a refusal is not a surprise. */
export function grantContract(grant) {
  if (!grant) return "";
  const l = grant.limits;
  return [
    "### What you have been granted",
    "",
    `You may make ${l.maxQueries} tool call(s) against `
    + `${l.repositories.length ? l.repositories.join(", ") : "this repository"}, `
    + `${l.readOnly ? "read-only" : "with write access"}, returning at most `
    + `${l.maxRows} rows and ${Math.round(l.maxBytes / 1024)} KiB in total.`,
    "",
    "A call past the grant is refused with a reason rather than executed, and the",
    "user can revoke the grant while you work. If you are running short, say so in",
    "your answer rather than quietly producing a thinner page: the user can widen",
    "the grant and let you continue.",
  ].join("\n");
}

/** The whole system prompt for a dashboard run. */
export function dashboardSystem(base, { grant = null, digesting = true,
                                        answerTokens = 0 } = {}) {
  return [base, DASHBOARD_CONTRACT, digesting ? DIGEST_CONTRACT : "",
          answerBudget(answerTokens), grantContract(grant)]
    .filter(Boolean).join("\n\n");
}

export default dashboardSystem;
