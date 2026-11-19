/**
 * `number-input' — a number, bound to a parameter.
 *
 * Tier 2, a parameter editor.  Its bounds come from the parameter's DECLARED
 * domain where it has one, so the control cannot offer a value the interface
 * would refuse; where it has none the control simply has none, rather than
 * inventing a range the document never agreed to.
 */

export const NAME = "number-input";
export const ELEMENT = "dydra-number-input";

export const STYLE = `
dydra-number-input { display: inline-block; }
dydra-number-input input { width: 90px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-number-input", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "min", "max", "step"]; }
    connectedCallback() {
      UI.budgetWatch(this, this.render.bind(this));
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    get value() {
      var f = this.querySelector("input");
      return f ? f.value : this._value;
    }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    bounds() {
      var domain = (UI.parameterOf(this.getAttribute("parameter")) || {}).domain || {};
      var min = this.getAttribute("min");
      var max = this.getAttribute("max");
      return { min: min != null ? min : (domain.min == null ? null : String(domain.min)),
               max: max != null ? max : (domain.max == null ? null : String(domain.max)) };
    }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      if (this._value == null) this._value = UI.valueOf(name, "");
      var b = this.bounds();
      var field = UI.el("input", { type: "number",
                                   step: this.getAttribute("step") || "any",
                                   "aria-label": this.getAttribute("label") || name });
      if (b.min != null) field.setAttribute("min", b.min);
      if (b.max != null) field.setAttribute("max", b.max);
      field.value = this._value;
      field.addEventListener("change", function () {
        self._value = field.value;
        UI.commit(self, { parameter: name, panel: self.getAttribute("panel") }, field.value);
      });
      UI.frame(this, field, this.getAttribute("label"));
    }
  });
})();
`;

export const MANIFEST = {
  name: "number-input", element: "dydra-number-input", version: "1.0", tier: 2,
  description: "A number field that sets one declared parameter, bounded by its declared domain.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                min: { type: "number", attribute: true, description: "defaults to the parameter's domain" },
                max: { type: "number", attribute: true, description: "defaults to the parameter's domain" },
                step: { type: "number", attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  examples: ['<dydra-number-input parameter="least" label="At least"></dydra-number-input>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
