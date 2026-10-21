/**
 * `grid' — the page's own columns.
 *
 * Tier 1 (§8.3): no data contract, pure layout.  It is in the toolbox because
 * every hand-written page so far has opened with the same twelve lines of
 * `display:grid' and a media query, and twelve lines repeated is twelve lines
 * of the output budget spent on furniture rather than on the answer.
 */

export const NAME = "grid";
export const ELEMENT = "dydra-grid";

export const STYLE = `
dydra-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
dydra-grid[data-columns="1"] { grid-template-columns: 1fr; }
dydra-grid[data-columns="2"] { grid-template-columns: repeat(2, 1fr); }
dydra-grid[data-columns="3"] { grid-template-columns: repeat(3, 1fr); }
dydra-grid[data-columns="4"] { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 640px) { dydra-grid { grid-template-columns: 1fr !important; } }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-grid", class extends HTMLElement {
    static get observedAttributes() { return ["columns", "gap"]; }
    connectedCallback() { this.apply(); }
    attributeChangedCallback() { this.apply(); }
    apply() {
      var c = this.getAttribute("columns");
      /* The attribute is mirrored to data-columns so the stylesheet can do
         the work: a style property set from script is lost the moment the
         element is replaced by a patch, and the stylesheet is not. */
      if (c) this.setAttribute("data-columns", String(Math.max(1, Math.min(6, Number(c) || 1))));
      else this.removeAttribute("data-columns");
      var g = this.getAttribute("gap");
      this.style.gap = g ? Number(g) + "px" : "";
    }
  });
})();
`;

export const MANIFEST = {
  name: "grid", element: "dydra-grid", version: "1.0", tier: 1,
  description: "Responsive columns for the page's own regions.",
  properties: { columns: { type: "number", default: "auto", attribute: true },
                gap: { type: "number", default: 12, attribute: true } },
  methods: {}, events: {}, slots: ["(children)"], needs: [],
  examples: ['<dydra-grid columns="3"><dydra-card>…</dydra-card></dydra-grid>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
