/**
 * The toolbox, assembled.
 *
 * Work items U-35, U-36 and the assembly half of U-38.
 *
 * No build step and no `/toolbox/catalog.json' (Appendix C): the catalog is
 * the result of importing the modules, which works unchanged in node for the
 * tests and in the browser for the pane.  A build step would be a third thing
 * to keep in step with the other two and would buy nothing — jsui has none
 * and wants none.
 *
 * Twelve components, in two tiers, cut from the first draft's seventy (§8.3).
 * The cut is not minimalism for its own sake: every component costs prompt
 * tokens in the catalog, page bytes when it is inlined, and a compatibility
 * promise forever, and a catalog nobody can fit in a prompt is a catalog the
 * model never reads.  The twelve are the furniture the implemented paths have
 * actually had to hand-write; Appendix E keeps the rest as the backlog, each
 * deferred until a page has wanted it twice.
 */

import base from "./base.js";
import grid from "./grid.js";
import panel from "./panel.js";
import card from "./card.js";
import tabs from "./tabs.js";
import metric from "./metric.js";
import badge from "./badge.js";
import keyValue from "./key-value.js";
import table from "./table.js";
import barChart from "./bar-chart.js";
import lineChart from "./line-chart.js";
import select from "./select.js";
import term from "./term.js";
import graph from "./graph.js";
import text from "./text.js";
import heading from "./heading.js";
import stack from "./stack.js";
import splitPane from "./split-pane.js";
import button from "./button.js";
import textInput from "./text-input.js";
import textArea from "./text-area.js";
import numberInput from "./number-input.js";
import checkbox from "./checkbox.js";
import radioGroup from "./radio-group.js";
import slider from "./slider.js";
import dateInput from "./date-input.js";

/** Tier 1: the page's own furniture.  No data contract. */
export const TIER_1 = [grid, stack, splitPane, panel, card, tabs,
                       text, heading, metric, badge, keyValue];

/**
 * Tier 2: bound to the data — either showing it or editing a parameter of it.
 *
 * The controls are here rather than in tier 1, which the plan had the other
 * way round (§8).  Tier is what the catalogue subsets on, and a control is
 * only wanted when the request is interactive; carrying eight of them in
 * every prompt would spend the answer's budget on furniture the page does
 * not need.  The line still holds: tier 1 knows nothing about the store,
 * tier 2 does — a control knows it has a parameter and a domain.
 */
export const TIER_2 = [table, barChart, lineChart, term, graph,
                       select, radioGroup, checkbox, button,
                       textInput, textArea, numberInput, slider, dateInput];

/** Everything, `base' included — which the catalog hides and the inliner adds. */
export const ALL = [base, ...TIER_1, ...TIER_2];

/** The toolbox as the inliner wants it: by name. */
export const COMPONENTS = Object.fromEntries(ALL.map((c) => [c.name, c]));

/** The contract version this toolbox answers to (§13.10). */
export const TOOLBOX_VERSION = "1";

/** The names a document may put in `uses'. */
export const COMPONENT_NAMES = ALL.filter((c) => !c.hidden).map((c) => c.name);

export default COMPONENTS;
