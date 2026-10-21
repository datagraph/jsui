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

/** Tier 1: the page's own furniture.  No data contract. */
export const TIER_1 = [grid, panel, card, tabs, metric, badge, keyValue];

/** Tier 2: data presentation, bound to a panel or a transform. */
export const TIER_2 = [table, barChart, lineChart, select, term, graph];

/** Everything, `base' included — which the catalog hides and the inliner adds. */
export const ALL = [base, ...TIER_1, ...TIER_2];

/** The toolbox as the inliner wants it: by name. */
export const COMPONENTS = Object.fromEntries(ALL.map((c) => [c.name, c]));

/** The contract version this toolbox answers to (§13.10). */
export const TOOLBOX_VERSION = "1";

/** The names a document may put in `uses'. */
export const COMPONENT_NAMES = ALL.filter((c) => !c.hidden).map((c) => c.name);

export default COMPONENTS;
