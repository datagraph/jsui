/**
 * Was a drawing asked for, and did one arrive?
 *
 * The live failure (2026-11-20): a prompt asking for tables AND bar graphs
 * over three repositories came back with three tables and no drawing, and the
 * user had to spend a second whole turn asking again for the half of the first
 * prompt that had been dropped.  Nothing anywhere said it had been dropped —
 * the page was valid, the panels ran, the gate had nothing to report, and the
 * only reader who could notice the omission was the one who had written the
 * prompt and now had to re-read it against the page.
 *
 * Most of the remedy is in the prompt: the contract now says that a fallback
 * table is not an answer to a request for a chart, and the toolbox catalogue
 * no longer tells the model in the same breath that none of its components is
 * required.  This is the other half — the interface noticing, at the gate,
 * that the two do not match, and saying so while the page can still be asked
 * about rather than after it has been read.
 *
 * It is a NOTICE and never a refusal.  The reading is a heuristic over two
 * texts, the model may have had a good reason (a measure with one row cannot
 * be a bar chart), and a gate that refused on this would be refusing a page
 * the user can see is fine.  So it says what it noticed and leaves the
 * decision where every other decision in this pane is left.
 */

/**
 * Words that mean a drawing, and not the word `graph'.
 *
 * `graph' is the one word that cannot be used here: in this interface it is
 * an RDF graph far more often than it is a picture, and "the default graph"
 * or "a graph of the account" would otherwise read as a request for a chart
 * on every page the model ever composes.  `bar graph' and `line graph' are
 * safe because the qualifier is what makes them pictures.
 */
const FIGURE_WORDS = [
  "chart", "bar graph", "bar-graph", "line graph", "line-graph", "histogram",
  "plot", "scatter", "pie", "sparkline", "trend line", "trendline",
  "diagram", "visuali", "graphically", "draw ", "drawn ", "drawing",
];

/** Markup, components and script that amount to something being drawn. */
const DRAWN = [
  /<svg[\s>]/i, /<canvas[\s>]/i,
  /<dydra-(bar-chart|line-chart|graph)[\s>/]/i,
  /dashboard\s*\.\s*render\s*\(/,
  // A transform returning a node builds it rather than writing it, so there
  // is no tag anywhere to find; this is the call that has to be made to
  // build one.
  /createElementNS\s*\(/,
];

const CHART_COMPONENTS = ["bar-chart", "line-chart", "graph"];

/** Which figure words a request used, in the order they are listed. */
export function figureWords(request = "") {
  const text = String(request || "").toLowerCase();
  return FIGURE_WORDS.filter((w) => text.includes(w));
}

/** Did the request ask for a drawing? */
export function figureAsked(request = "") {
  return figureWords(request).length > 0;
}

/** Does this document draw anything at all? */
export function drawsFigure(doc) {
  if (!doc) return false;
  if ((doc.uses || []).some((u) => CHART_COMPONENTS.includes(u))) return true;
  const text = [
    ...(doc.views || []).map((v) => v?.html || ""),
    doc.html || "", doc.script || "", doc.styles || "",
    // A transform may return a DOM node, which is the third legitimate way to
    // draw and leaves no trace in the markup.
    ...(doc.transforms || []).map((t) => t?.body || ""),
  ].join("\n");
  return DRAWN.some((re) => re.test(text));
}

/**
 * The sentence the gate shows, or null when there is nothing to say.
 *
 * Null in three cases, and the third is the one worth stating: no figure was
 * asked for; a figure was asked for and drawn; or the page draws SOMETHING,
 * in which case this has nothing useful to add — a page with one chart and
 * three tables may be exactly right, and only the person who wrote the prompt
 * can say.
 */
export function missingFigure(request, doc) {
  const words = figureWords(request);
  if (!words.length) return null;
  if (drawsFigure(doc)) return null;
  const said = words[0].trim();
  return `The request asked for a figure (“${said}”) and this page draws none: `
       + `every region is a table or prose. That may be right — some results cannot `
       + `carry a chart — but the model was not asked to explain it. Revise with `
       + `“draw <panel> as a bar chart” if it is not.`;
}

export default missingFigure;
