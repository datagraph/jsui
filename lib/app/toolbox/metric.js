/**
 * `metric' — one number, said once, large.
 *
 * Tier 1, but it is the first component with a data contract worth arguing
 * about.  A metric can be written by the model (`value="4120"'), which is an
 * ASSERTED number and not refreshable, or bound to a slot, in which case the
 * frame hands it the result and it takes the first cell.  Both are allowed:
 * D-P's point was never that the model may not write a number, only that the
 * page must say which kind of number it is -- and the frame's provenance
 * marking does that for the slot it sits in, whichever way it was filled.
 */

export const NAME = "metric";
export const ELEMENT = "dydra-metric";

export const STYLE = `
dydra-metric { display: block; }
dydra-metric > .dydra-metric-label { font-size: 11px; letter-spacing: .04em;
  text-transform: uppercase; color: #5b6672; }
dydra-metric > .dydra-metric-value { font-size: 23px; line-height: 1.15;
  font-variant-numeric: tabular-nums; }
dydra-metric > .dydra-metric-value > small { font-size: 13px; color: #5b6672; margin-left: 3px; }
dydra-metric > .dydra-metric-trend { font-size: 11.5px; color: #5b6672; }
dydra-metric[data-trend="up"] > .dydra-metric-trend { color: #2d662d; }
dydra-metric[data-trend="down"] > .dydra-metric-trend { color: #8a2b2b; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-metric", class extends HTMLElement {
    static get observedAttributes() { return ["label", "value", "unit", "trend", "digits"]; }
    connectedCallback() { UI.accepts(this); this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    /** The frame's default drawing hands a bound slot's value here. */
    setData(value) {
      var t = UI.asTable(value);
      var cell = t.rows.length ? t.rows[0][t.rows[0].length - 1] : null;
      this._value = cell;
      this.render();
    }
    get value() { return this._value != null ? this._value : this.getAttribute("value"); }
    set value(v) { this._value = v; this.render(); }
    render() {
      var v = this.value;
      var digits = this.getAttribute("digits");
      var shown = v == null || v === ""
        ? "—"
        : (UI.isNumber(v) ? UI.number(v, digits == null ? null : Number(digits)) : String(v));
      var trend = this.getAttribute("trend") || "";
      this.setAttribute("data-trend",
        /^\s*[+]/.test(trend) ? "up" : (/^\s*[-−]/.test(trend) ? "down" : "flat"));
      var unit = this.getAttribute("unit");
      var value = UI.el("div", { class: "dydra-metric-value", text: shown });
      if (unit) value.appendChild(UI.el("small", { text: unit }));
      this.replaceChildren(
        UI.el("div", { class: "dydra-metric-label", text: this.getAttribute("label") || "" }),
        value,
        trend ? UI.el("div", { class: "dydra-metric-trend", text: trend }) : document.createComment("")
      );
    }
  });
})();
`;

export const MANIFEST = {
  name: "metric", element: "dydra-metric", version: "1.0", tier: 1,
  description: "One figure, shown large, with a label and an optional trend.",
  properties: { label: { type: "string", attribute: true },
                value: { type: "string|number", attribute: true },
                unit: { type: "string", attribute: true },
                digits: { type: "number", attribute: true },
                trend: { type: "string", attribute: true,
                         description: "free text; a leading + or − colours it" } },
  methods: { setData: { parameters: ["table|value"] } }, events: {}, slots: [], needs: [],
  examples: ['<div data-bound="total"><dydra-metric label="Revenue" unit="£"></dydra-metric></div>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
