/**
 * `stack' — a row or a column with a gap.
 *
 * Tier 1, and the one-dimensional companion to `grid'.  Most arrangements
 * are a row or a column; expressing those as a one-column grid costs a
 * template nobody reads and an area name nobody chose.  Anything
 * two-dimensional is `grid': the two are not interchangeable, and the
 * validator's area check applies to one of them only.
 */

export const NAME = "stack";
export const ELEMENT = "dydra-stack";

export const STYLE = `
dydra-stack { display: flex; gap: 8px; }
dydra-stack[direction="column"] { flex-direction: column; }
dydra-stack[direction="row"] { flex-direction: row; flex-wrap: wrap; }
dydra-stack[align="center"] { align-items: center; }
dydra-stack[align="end"] { align-items: flex-end; }
dydra-stack[align="stretch"] { align-items: stretch; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-stack", class extends HTMLElement {
    static get observedAttributes() { return ["direction", "gap", "align"]; }
    connectedCallback() { this.apply(); }
    attributeChangedCallback() { this.apply(); }
    apply() {
      if (!this.getAttribute("direction")) this.setAttribute("direction", "row");
      var gap = this.getAttribute("gap");
      this.style.gap = gap ? Number(gap) + "px" : "";
    }
  });
})();
`;

export const MANIFEST = {
  name: "stack", element: "dydra-stack", version: "1.0", tier: 1,
  description: "A row or a column with a gap: one-dimensional layout.",
  properties: { direction: { enum: ["row", "column"], default: "row", attribute: true },
                gap: { type: "number", default: 8, attribute: true },
                align: { enum: ["start", "center", "end", "stretch"], default: "start",
                         attribute: true } },
  methods: {}, events: {}, slots: ["(children)"], needs: [],
  examples: ['<dydra-stack direction="column" gap="12">…</dydra-stack>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
