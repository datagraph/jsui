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

import { componentCatalog } from "../app/toolbox/catalog.js";

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
  "",
  "### Put an id on every region you might later want to change",
  "",
  "A follow-up prompt changes the page by replacing ONE element, addressed by its",
  "`id`. A region with no id can only be changed by replacing the whole view, which",
  "costs the user a much larger answer for a much smaller change. Give every card,",
  "section and figure an id; it costs you four characters each.",
].join("\n");

/**
 * Parameters, views and the patch block: what a page that is iterated on has
 * that a page produced once does not.
 *
 * Each of these is stated with its reason rather than as a rule, and the
 * reasons are not decoration.  A model told only that it cannot send query
 * text writes `fetch' and gets silence -- the frame has no network, so the
 * failure is invisible and the model has nothing to learn from.  A model told
 * WHY writes the thing that works.
 */
export const APPLICATION_CONTRACT = [
  "## Pages that are designed over several prompts",
  "",
  "### Parameters: letting the reader ask a narrower question",
  "",
  "A panel's query is fixed when the user authorises it and you cannot change it",
  "from inside the page. What you CAN do is declare a parameter and let the page",
  "supply a value for it. The interface binds the value as an RDF term with a",
  "`VALUES` clause after your query — your query text is not edited, not",
  "interpolated into, and not rewritten.",
  "",
  "```json",
  '{"parameters": [',
  '   {"name": "region", "kind": "literal", "datatype": "xsd:string",',
  '    "domain": {"from": "regions", "column": "region"}, "default": "North",',
  '    "label": "Region"}],',
  ' "panels": [',
  '   {"name": "regions", "query": "SELECT DISTINCT ?region WHERE { … }"},',
  '   {"name": "sales", "parameters": ["region"],',
  '    "query": "SELECT ?month ?total WHERE { … ?s :region ?region … }"}]}',
  "```",
  "",
  "The panel's query must actually use `?region`, or the control would do nothing",
  "and the page would look broken. A domain is an enumeration (`{\"values\": […]}`),",
  "a numeric range (`{\"min\": …, \"max\": …}`) or another panel's column",
  "(`{\"from\": …, \"column\": …}`) — and a value outside it is refused with a reason,",
  "which the page shows.",
  "",
  "In the page: `await dashboard.run(\"sales\", {region: \"South\"})`. It resolves when",
  "the new results have landed. **There is no way to send query text from the page.**",
  "`fetch` does not work — the frame has no network at all — and it fails silently,",
  "so you would get no error and the reader would get a blank region.",
  "",
  "### Asking again is budgeted",
  "",
  "A page re-running a panel is spending the reader's time against the store, over",
  "and over, from a control they did not write. So there is a budget: a count of",
  "interactive runs, shown as a meter beside the page, which the reader can renew",
  "whenever they like. It is not authority — the query is the one they already",
  "approved — it only bounds how often.",
  "",
  "What that means for how you write a page:",
  "",
  "- Run on a *decision*, not on a keystroke. A `change` event on a selector, a",
  "  button press — not `input`, not a slider dragging, not a timer.",
  "- One run answers one question. If two regions need the same panel, run it once",
  "  and let both read the result.",
  "- `dashboard.budget` is `{runs, maxRuns, remaining, exhausted}` and updates as it",
  "  is spent. A control that will be refused should show it — grey it out rather",
  "  than offering a choice that cannot be answered.",
  "- A refused run rejects with a reason, which the page shows. Do not retry it.",
  "",
  "### Views: several screens in one page",
  "",
  "A document may declare `views` instead of `html`: named regions, one shown at a",
  "time, all in the same frame with the same data.",
  "",
  "```json",
  '{"views": [{"name": "overview", "title": "Overview", "html": "…"},',
  '           {"name": "detail",   "title": "By month", "html": "…"}]}',
  "```",
  "",
  "Navigate with `dashboard.setView(\"detail\")` or `data-view=\"detail\"` on a link.",
  "Never a URL: switching views posts nothing, runs nothing and loses nothing, and a",
  "link that reloaded the document would throw away every result in it.",
  "",
  "### After the first turn: send a patch, not a page",
  "",
  "Once a page exists, a follow-up answers with a ```patch block — a JSON array of",
  "operations against the document that is already on the screen:",
  "",
  "```patch",
  '[{"op": "set-panel", "name": "costs", "value": {"query": "SELECT …"}},',
  ' {"op": "set-slot", "id": "margin-card", "html": "<section id=\"margin-card\" …>…</section>"},',
  ' {"op": "set-styles", "value": "…"},',
  ' {"op": "use", "add": ["metric"]}]',
  "```",
  "",
  "Operations: `set-title`, `set-panel`, `remove-panel`, `set-transform`,",
  "`remove-transform`, `set-assertion`, `remove-assertion`, `set-parameter`,",
  "`remove-parameter`, `set-view`, `remove-view`, `set-slot` (replace one element by",
  "id), `append-slot`, `set-styles`, `set-script`, `use` (`add`/`remove`).",
  "",
  "Patch rather than re-emit, and the reason matters more than the rule: a page",
  "worth iterating on is already close to the size of one answer. Re-emitting it",
  "every turn risks running out of room mid-block, and a block that never closes",
  "cannot be parsed, so the whole turn is lost. A patch is as large as the change",
  "and no larger.",
  "",
  "A patch is applied to a copy of the document and the RESULT is validated. If any",
  "operation is wrong the whole patch is refused — so address ids that exist, and",
  "do not remove a panel something still reads.",
  "",
  "### What your change will cost the user",
  "",
  "The interface works out what a patch changed and asks the user accordingly:",
  "",
  "| What you changed | What happens |",
  "|---|---|",
  "| markup, styles, captions, `uses` | nothing is re-run and nothing is re-asked; applied in place |",
  "| a transform or an assertion | the body is checked and the diff shown |",
  "| a panel query, `accept`, a parameter's domain, a new panel | the user authorises it again, with a per-panel diff |",
  "| a repository, a budget, write access | a new grant — which a patch cannot ask for |",
  "",
  "So a change of colour is free and a change of query is not. If a request can be",
  "satisfied without touching a query, say so and do it that way: \"I can do that",
  "without re-running anything\" is a better answer than a page that silently costs",
  "the user another authorisation.",
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

/**
 * The output ceiling as it applies to a patch turn.
 *
 * A patch is small, so the ceiling is rarely the binding constraint -- which
 * is exactly why it has to be said: a model that has just been told to answer
 * with operations rather than a page may reasonably conclude the budget no
 * longer matters, and the one operation that can still overflow it is a
 * `set-view' carrying a whole view's markup.
 */
export function patchBudget(tokens) {
  if (!tokens) return "";
  return [
    "### Your answer has to fit",
    "",
    `This turn has ${tokens} output tokens. A patch is normally far inside that —`,
    "which is the point of patching. The one operation that can still overflow it is",
    "`set-view`, which carries a whole view: prefer several `set-slot` operations",
    "addressed by id. A block that reaches the ceiling before it closes cannot be",
    "parsed, so nothing is applied.",
  ].join("\n");
}

/** The whole system prompt for a dashboard run. */
export function dashboardSystem(base, { grant = null, digesting = true,
                                        answerTokens = 0, request = "",
                                        components = true, interactive = true,
                                        usedComponents = [] } = {}) {
  return [base, DASHBOARD_CONTRACT,
          interactive ? APPLICATION_CONTRACT : "",
          components ? componentCatalog(request, { include: usedComponents }) : "",
          digesting ? DIGEST_CONTRACT : "",
          answerBudget(answerTokens), grantContract(grant)]
    .filter(Boolean).join("\n\n");
}

/**
 * The system prompt for a turn that revises a page that already exists.
 *
 * It carries the document's SHAPE rather than the document: names, queries,
 * slot ids and no bodies (§15, question 2).  The bodies are what make a
 * document too large to send, and the shape is what a model needs to address
 * a patch correctly.  Whatever the prompt actually mentions is added by the
 * caller, which is the half of that question still open.
 */
export function revisionSystem(base, { grant = null, document: doc = null,
                                       answerTokens = 0, request = "" } = {}) {
  return [base, DASHBOARD_CONTRACT, APPLICATION_CONTRACT,
          componentCatalog(request, { include: doc?.uses || [] }),
          doc ? documentSummary(doc) : "",
          patchBudget(answerTokens), grantContract(grant)]
    .filter(Boolean).join("\n\n");
}

/** The page as it stands, in as few characters as will still let it be patched. */
export function documentSummary(doc) {
  const lines = ["## The page as it stands", "",
                 `Title: ${doc.title}  ·  revision ${doc.revision ?? 1}`];
  if (doc.uses?.length) lines.push(`Components in use: ${doc.uses.filter((u) => u !== "base").join(", ")}`);
  if (doc.panels?.length) {
    lines.push("", "Panels:");
    for (const p of doc.panels) {
      lines.push(`- \`${p.name}\`${p.parameters?.length ? ` (${p.parameters.join(", ")})` : ""}`
               + `${p.caption ? ` — ${p.caption}` : ""}`);
      lines.push("  ```", `  ${p.query.replace(/\n/g, "\n  ")}`, "  ```");
    }
  }
  if (doc.parameters?.length) {
    lines.push("", "Parameters:");
    for (const x of doc.parameters) {
      lines.push(`- \`${x.name}\` ${x.kind}${x.datatype ? ` ${x.datatype}` : ""}`
               + ` · ${JSON.stringify(x.domain)}`);
    }
  }
  if (doc.transforms?.length) {
    // Names and inputs, not bodies: a transform body is the largest thing in
    // a document and a patch that replaces one does not need to have read it.
    lines.push("", "Transforms (bodies omitted; ask if you need one):");
    for (const t of doc.transforms) lines.push(`- \`${t.name}\` ← ${t.inputs.join(", ") || "nothing"}`);
  }
  if (doc.assertions?.length) {
    lines.push("", "Assertions:");
    for (const a of doc.assertions) lines.push(`- \`${a.id}\` ← ${a.inputs.join(", ") || "outside knowledge"}`);
  }
  lines.push("", "Views and the ids a `set-slot` can address:");
  for (const v of doc.views || []) {
    const ids = [...String(v.html || "").matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    lines.push(`- \`${v.name}\`${v.title ? ` (${v.title})` : ""}: `
             + (ids.length ? ids.map((i) => `\`${i}\``).join(", ") : "no ids — only replaceable whole"));
  }
  return lines.join("\n");
}

export default dashboardSystem;
