/**
 * The catalog the model is shown, and why it is not the whole catalog.
 *
 * Work item U-38; §8.5 and §13.9 of `ui-generator.md'.
 *
 * Two budgets meet here.  The prompt budget says the catalog costs tokens on
 * every single request, whether or not the page turns out to want a chart;
 * the answer budget (§2.5) says those tokens come out of the same turn that
 * has to carry the whole page.  So the catalog is SUBSETTABLE BY
 * CONSTRUCTION: one line of purpose per component, its properties with types
 * and defaults, its events, and exactly one example — and a request that
 * mentions no graph need not carry the graph's manifest at all.
 *
 * The selection is by what the request says, which is a heuristic and is
 * treated as one: it only ever ADDS to the tier-1 core, it never removes a
 * component the caller named, and the closing line tells the model that the
 * list is a convenience rather than a grammar (D-AB).  Guessing wrong costs
 * a component the model did not know it had; guessing wrong in the other
 * direction would cost the page.
 */

import { ALL, COMPONENTS, TIER_1, TIER_2 } from "./index.js";

/** Words that make a component worth carrying, beyond the always-included core. */
const HINTS = {
  table: ["table", "rows", "list", "grid of", "sort", "page", "column"],
  "bar-chart": ["chart", "bar", "histogram", "distribution", "compare", "by region",
                "by category", "plot"],
  "line-chart": ["chart", "line", "trend", "over time", "series", "monthly", "daily",
                 "yearly", "growth", "plot"],
  select: ["select", "choose", "filter", "picker", "dropdown", "parameter", "interactive",
           "per region", "by selection"],
  term: ["iri", "uri", "term", "datatype", "literal", "rdf", "triple", "predicate"],
  graph: ["graph", "network", "edges", "nodes", "hierarchy", "tree", "dependency",
          "relationship", "topology"],
  tabs: ["tab", "tabs", "switch between", "side by side"],
  metric: ["metric", "total", "count", "kpi", "figure", "headline", "summary number"],
  badge: ["badge", "status", "flag", "label"],
  "key-value": ["key", "properties", "attributes", "facts", "details"],
};

/** Always carried: layout costs almost nothing and every page uses some of it. */
const CORE = ["grid", "panel", "card", "metric", "table"];

/**
 * Which components a request is likely to want.
 *
 * Never fewer than the core, never more than the whole toolbox, and the
 * caller may always name components outright — which is what a follow-up
 * turn does, because a page that already uses `bar-chart' needs its manifest
 * whatever the new prompt happens to say.
 */
export function selectComponents(request = "", { include = [], all = false } = {}) {
  if (all) return ALL.filter((c) => !c.hidden).map((c) => c.name);
  const text = String(request || "").toLowerCase();
  const chosen = new Set([...CORE, ...[].concat(include).filter(Boolean)]);
  for (const [name, words] of Object.entries(HINTS)) {
    if (words.some((w) => text.includes(w))) chosen.add(name);
  }
  // Declaration order, so the catalog reads the same way twice.
  return ALL.filter((c) => !c.hidden && chosen.has(c.name)).map((c) => c.name);
}

const propertyLine = (name, p) => {
  const bits = [];
  if (p.type) bits.push(p.type);
  if (p.enum) bits.push(p.enum.join("|"));
  if (p.required) bits.push("required");
  if (p.default !== undefined) bits.push(`default ${p.default}`);
  if (!p.attribute && !/boolean/.test(p.type || "")) bits.push("property, not an attribute");
  return `    ${name}: ${bits.join(", ")}${p.description ? ` — ${p.description}` : ""}`;
};

/** One component, as the model reads it. */
export function describeComponent(name, { example = true } = {}) {
  const c = COMPONENTS[name];
  if (!c) return "";
  const m = c.manifest;
  // Both names, because they are used in two different places and only one
  // of them was ever shown: `uses' takes the component name, the markup takes
  // the element.  A catalog that printed the element alone taught the model to
  // write `uses: ["dydra-table"]', which the validator then refused.
  const out = [`- **\`${m.name}\`** — the element \`<${m.element}>\` — ${m.description}`];
  const props = Object.entries(m.properties || {});
  if (props.length) {
    out.push("  properties:");
    for (const [k, p] of props) out.push(propertyLine(k, p));
  }
  const events = Object.keys(m.events || {});
  if (events.length) out.push(`  events: ${events.join(", ")}`);
  if (m.needs?.length) out.push(`  needs: ${m.needs.join(", ")} (refused if unavailable)`);
  if (example && m.examples?.length) out.push(`  e.g. \`${m.examples[0]}\``);
  return out.join("\n");
};

/**
 * The catalog as prompt text.
 *
 * The closing paragraph is not boilerplate.  A model handed a list of
 * components will reach for one even where plain markup says the thing
 * better, and a page built out of components it did not need is larger,
 * slower to write and harder to patch.  D-AB is the rule; this is where the
 * model is told it.
 */
export function componentCatalog(request = "", { include = [], all = false,
                                                 examples = true } = {}) {
  const names = selectComponents(request, { include, all });
  if (!names.length) return "";
  const tier1 = TIER_1.map((c) => c.name).filter((n) => names.includes(n));
  const tier2 = TIER_2.map((c) => c.name).filter((n) => names.includes(n));
  const lines = [
    "### The component toolbox",
    "",
    "Custom elements the interface can inline into the page. Put the COMPONENT NAME —",
    "the first name on each line, not the element — in `uses`; only those are inlined,",
    "so a component you do not name is not there. In the markup you write the element:",
    '`"uses": ["table"]` puts `<dydra-table>` on the page.',
    "",
  ];
  if (tier1.length) {
    lines.push("**Layout and text** (no data contract):", "");
    for (const n of tier1) lines.push(describeComponent(n, { example: examples }));
    lines.push("");
  }
  if (tier2.length) {
    lines.push("**Bound to data** — put one inside a `data-bound` or `data-derived` region and",
               "the interface hands it the result; it draws itself:", "");
    for (const n of tier2) lines.push(describeComponent(n, { example: examples }));
    lines.push("");
  }
  lines.push(
    "None of this is required. A slot with no component in it still renders a readable",
    "table, and ordinary HTML, SVG and canvas remain correct answers — often the better",
    "ones. Use a component when it saves you writing the same furniture again, not",
    "because it is there.",
  );
  return lines.join("\n");
}

/** What the catalog costs, so §13.9 can measure rather than guess. */
export function catalogSize(request = "", options = {}) {
  const text = componentCatalog(request, options);
  return { characters: text.length, components: selectComponents(request, options).length,
           // Four characters to the token is the usual working figure for
           // English prose with punctuation; it is an estimate and is labelled
           // as one wherever it is shown.
           approximateTokens: Math.ceil(text.length / 4) };
}

export default componentCatalog;
