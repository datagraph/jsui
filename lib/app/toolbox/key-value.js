/**
 * `key-value' — a definition list that lines up.
 *
 * Tier 1.  `pairs' is a property and never an attribute (Appendix A): a list
 * of pairs serialised into an attribute is JSON inside quotes inside markup,
 * which is both the hardest thing for the model to write correctly and the
 * construct the Gate 1 scan reads worst.
 */

export const NAME = "key-value";
export const ELEMENT = "dydra-key-value";

export const STYLE = `
dydra-key-value { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px;
  font-size: 12px; align-items: baseline; }
dydra-key-value > dt { color: #5b6672; }
dydra-key-value > dd { margin: 0; font-variant-numeric: tabular-nums; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-key-value", class extends HTMLElement {
    connectedCallback() { UI.accepts(this); if (!this.children.length) this.render(); }
    /** Two columns of a result read as key and value; one column as a list. */
    setData(value) {
      var t = UI.asTable(value);
      this._pairs = t.rows.map(function (r) {
        return [String(r[0] == null ? "" : r[0]), String(r[1] == null ? "" : r[1])];
      });
      this.render();
    }
    get pairs() { return this._pairs || []; }
    set pairs(v) {
      this._pairs = Array.isArray(v) ? v.map(function (p) {
        return Array.isArray(p) ? [String(p[0]), String(p[1])] : [String(p), ""];
      }) : Object.keys(v || {}).map(function (k) { return [k, String(v[k])]; });
      this.render();
    }
    render() {
      var pairs = this.pairs;
      if (!pairs.length) { this.replaceChildren(UI.empty("nothing to show")); return; }
      var out = [];
      pairs.forEach(function (p) {
        out.push(UI.el("dt", { text: p[0] }));
        out.push(UI.el("dd", { text: p[1] }));
      });
      this.replaceChildren.apply(this, out);
    }
  });
})();
`;

export const MANIFEST = {
  name: "key-value", element: "dydra-key-value", version: "1.0", tier: 1,
  description: "A two-column list of names and values.",
  properties: { pairs: { type: "array|object", required: false,
                         description: "set as a PROPERTY, never as an attribute" } },
  methods: { setData: { parameters: ["table"] } }, events: {}, slots: ["(dt/dd children)"],
  needs: [],
  examples: ['<div data-bound="facts"><dydra-key-value></dydra-key-value></div>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
