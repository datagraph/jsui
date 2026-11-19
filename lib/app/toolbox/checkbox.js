/**
 * `checkbox' — a parameter over exactly two values.
 *
 * Tier 2, a parameter editor.  The two are the parameter's declared
 * enumeration when it has one of exactly two members, and `true'/`false'
 * otherwise.  A checkbox over a domain of five would be a control that
 * cannot reach three of them, so it says so instead of pretending.
 */

export const NAME = "checkbox";
export const ELEMENT = "dydra-checkbox";

export const STYLE = `
dydra-checkbox { display: inline-flex; align-items: center; gap: 5px; }
dydra-checkbox input { width: 13px; height: 13px; }
dydra-checkbox label { font-size: 12px; color: #2b3138; margin: 0; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-checkbox", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "on", "off"]; }
    connectedCallback() {
      UI.budgetWatch(this, this.render.bind(this));
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    get value() { return this._value; }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    pair() {
      var declared = (UI.parameterOf(this.getAttribute("parameter")) || {}).domain || {};
      var values = declared.values;
      if (this.getAttribute("on") != null || this.getAttribute("off") != null) {
        return { on: this.getAttribute("on") || "true", off: this.getAttribute("off") || "false" };
      }
      if (values && values.length === 2) return { off: String(values[0]), on: String(values[1]) };
      return { on: "true", off: "false", wide: !!(values && values.length > 2) };
    }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      var pair = this.pair();
      if (this._value == null) this._value = UI.valueOf(name, pair.off);
      var field = UI.el("input", { type: "checkbox",
                                   "aria-label": this.getAttribute("label") || name });
      field.checked = String(this._value) === pair.on;
      field.addEventListener("change", function () {
        self._value = field.checked ? pair.on : pair.off;
        UI.commit(self, { parameter: name, panel: self.getAttribute("panel") }, self._value);
      });
      field.classList.add("dydra-field");
      if (UI.spent(this)) { field.disabled = true; }
      var parts = [field];
      if (this.getAttribute("label")) {
        parts.push(UI.el("label", { text: this.getAttribute("label") }));
      }
      parts.push(UI.el("span", { class: "dydra-why" }));
      this.replaceChildren.apply(this, parts);
      if (pair.wide) {
        UI.why(this, "this parameter admits more than two values; a select or a radio-group reaches them all");
      }
    }
  });
})();
`;

export const MANIFEST = {
  name: "checkbox", element: "dydra-checkbox", version: "1.0", tier: 2,
  description: "A checkbox that sets one declared parameter to one of two values.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                on: { type: "string", default: "true", attribute: true },
                off: { type: "string", default: "false", attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  examples: ['<dydra-checkbox parameter="only-open" label="Open only"></dydra-checkbox>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
