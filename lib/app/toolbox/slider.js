/**
 * `slider' — a number over a range.
 *
 * Tier 2, a parameter editor.  The reading follows the handle and the COMMIT
 * does not: dragging shows the value, letting go asks the interface for it.
 * A slider that re-ran on every pixel would be the clearest possible way to
 * exhaust a budget by accident, and the reader would have no idea why.
 *
 * Its range comes from the parameter's declared domain where it has one.
 * Where it has none a slider is the wrong control -- it cannot show the
 * reader what the ends mean -- so it says so rather than picking 0 to 100.
 */

export const NAME = "slider";
export const ELEMENT = "dydra-slider";

export const STYLE = `
dydra-slider { display: inline-flex; align-items: center; gap: 6px; }
dydra-slider input[type="range"] { width: 140px; }
dydra-slider .dydra-slider-read { font-size: 12px; color: #2b3138; min-width: 2.5em;
  font-variant-numeric: tabular-nums; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-slider", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "min", "max", "step"]; }
    connectedCallback() {
      UI.budgetWatch(this, this.render.bind(this));
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    get value() { return this._value; }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    bounds() {
      var domain = (UI.parameterOf(this.getAttribute("parameter")) || {}).domain || {};
      var min = this.getAttribute("min");
      var max = this.getAttribute("max");
      min = min != null ? Number(min) : (domain.min == null ? null : Number(domain.min));
      max = max != null ? Number(max) : (domain.max == null ? null : Number(domain.max));
      return { min: min, max: max };
    }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      var b = this.bounds();
      var known = b.min != null && b.max != null && b.max > b.min;
      if (this._value == null) this._value = UI.valueOf(name, known ? String(b.min) : "");
      var field = UI.el("input", { type: "range",
                                   min: known ? String(b.min) : "0",
                                   max: known ? String(b.max) : "100",
                                   step: this.getAttribute("step") || "1",
                                   "aria-label": this.getAttribute("label") || name });
      field.value = this._value;
      var reading = UI.el("span", { class: "dydra-slider-read", text: String(this._value) });
      field.addEventListener("input", function () { reading.textContent = field.value; });
      field.addEventListener("change", function () {
        self._value = field.value;
        UI.commit(self, { parameter: name, panel: self.getAttribute("panel") }, field.value);
      });
      field.classList.add("dydra-field");
      if (UI.spent(this)) field.disabled = true;
      if (!known) { field.disabled = true; field.setAttribute("data-locked", ""); }
      var parts = [];
      if (this.getAttribute("label")) {
        parts.push(UI.el("label", { class: "dydra-label", text: this.getAttribute("label") }));
      }
      parts.push(field, reading, UI.el("span", { class: "dydra-why" }));
      this.replaceChildren.apply(this, parts);
      if (!known) {
        UI.why(this, "this parameter declares no range, so a slider cannot say what its ends mean");
      }
    }
  });
})();
`;

export const MANIFEST = {
  name: "slider", element: "dydra-slider", version: "1.0", tier: 2,
  description: "A range control that sets one declared parameter when the handle is let go.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                min: { type: "number", attribute: true, description: "defaults to the parameter's domain" },
                max: { type: "number", attribute: true, description: "defaults to the parameter's domain" },
                step: { type: "number", default: 1, attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  notes: "dragging shows the value; letting go spends a run",
  examples: ['<dydra-slider parameter="least" label="At least" min="0" max="500"></dydra-slider>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
