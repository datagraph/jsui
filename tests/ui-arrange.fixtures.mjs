/**
 * What the arrange harness is driven with.
 *
 * Kept beside the harness rather than inside it so that both the page and
 * the runner read the same fixtures, and so that neither has to be written
 * as a string inside the other.
 *
 * Two pages over two different repositories, because the claim phase 8 makes
 * about an applied component is only visible when the destination is NOT
 * where the component came from: an arrangement lifted from `alice/parts'
 * and applied into a page over `alice/orders' has to go on asking
 * `alice/parts', under the reader's credentials (U-84, §21.4.2).  One
 * repository would make a wrong implementation look right.
 *
 * One presentation in `<account>/ui' with no data in it at all, because a
 * mount is drawn and not run (§21.4.3): a mounted page whose elements need
 * results would be indistinguishable, on the screen, from one the expander
 * failed to fill.
 */

/* ── the page a component is lifted FROM: alice/parts ─────────────────────── */

export const PARTS = {
  title: "Parts inventory",
  uses: ["heading", "text", "panel", "table", "select", "metric", "stack"],
  parameters: [
    { name: "region", kind: "literal", label: "Region",
      domain: { values: ["North", "South"] }, default: "North" },
  ],
  panels: [
    { name: "onhand", parameters: ["region"], caption: "what is on the shelf, by region",
      query: "SELECT ?part ?onHand WHERE { ?part :region ?region ; :onHand ?onHand }" },
  ],
  views: [{
    name: "main", title: "Main",
    elements: [
      { name: "e-head", kind: "heading", order: "a",
        attributes: { level: 2 }, text: "Parts inventory" },
      { name: "e-note", kind: "text", order: "b",
        attributes: { emphasis: "muted" }, text: "As at the last import." },
      // The component the whole demonstration turns on: a panel holding a
      // control and a table.  Lifting it has to bring the query that feeds
      // the table and the parameter the control edits, or the copy arrives
      // looking finished and showing nothing.
      { name: "e-card", kind: "panel", order: "c",
        attributes: { label: "On hand" },
        children: [
          { name: "e-pick", kind: "select", order: "a",
            attributes: { parameter: "region", label: "Region" } },
          { name: "e-tab", kind: "table", order: "b", bound: "onhand" },
        ] },
    ],
  }],
};

/* ── the page it is applied INTO: alice/orders ────────────────────────────── */

export const ORDERS = {
  title: "Open orders",
  uses: ["heading", "text", "table", "stack"],
  parameters: [],
  panels: [
    { name: "orders", caption: "orders not yet delivered",
      query: "SELECT ?order ?due WHERE { ?order :due ?due }" },
  ],
  views: [{
    name: "main", title: "Main",
    elements: [
      { name: "e-head", kind: "heading", order: "a",
        attributes: { level: 2 }, text: "Open orders" },
      { name: "e-list", kind: "table", order: "b", bound: "orders" },
      // A named destination, so the apply can say where it goes rather than
      // landing at the end of the view and being found by scrolling.
      { name: "e-slot", kind: "stack", order: "c",
        attributes: { direction: "column", gap: 10 },
        children: [
          { name: "e-slot-note", kind: "text", order: "a",
            attributes: { emphasis: "muted" }, text: "Lifted components go here." },
        ] },
    ],
  }],
};

/* ── the presentation that gets mounted into the chrome ───────────────────── */

export const INVENTORY = {
  id: "inventory",
  revision: 1,
  title: "Inventory at a glance",
  uses: ["heading", "text", "metric", "stack", "card"],
  parameters: [], panels: [], transforms: [], assertions: [],
  views: [{
    name: "main", title: "Main",
    elements: [
      { name: "i-head", kind: "heading", order: "a",
        attributes: { level: 3 }, text: "Inventory at a glance" },
      { name: "i-row", kind: "stack", order: "b",
        attributes: { direction: "row", gap: 12 },
        children: [
          { name: "i-parts", kind: "metric", order: "a",
            attributes: { label: "Parts", value: "1 204" } },
          { name: "i-short", kind: "metric", order: "b",
            attributes: { label: "Short", value: "12" } },
          { name: "i-orders", kind: "metric", order: "c",
            attributes: { label: "Open orders", value: "317" } },
        ] },
      { name: "i-note", kind: "text", order: "c",
        attributes: { emphasis: "muted" },
        text: "Mounted by reference: this is one presentation, in one place." },
    ],
  }],
};

/* ── what the stores answer ───────────────────────────────────────────────── */

export const ON_HAND = "?part\t?onHand\nbolt-m6\t412\nnut-m6\t388\nwasher-m6\t404\n";
export const OPEN_ORDERS = "?order\t?due\nSO-1183\t2026-11-12\nSO-1194\t2026-11-19\n";

/** The page's own content, as the fake route renders it around the panes. */
export const CONTENT = `<div class="arrange-page">
  <h2>alice</h2>
  <p class="arrange-sub">two pages, open at once</p>
  <div class="view-editors"><div class="view-editors-container" id="panes"></div></div>
</div>`;

export default { PARTS, ORDERS, INVENTORY, ON_HAND, OPEN_ORDERS, CONTENT };
