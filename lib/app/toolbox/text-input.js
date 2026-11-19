/**
 * `text-input' — free text, bound to a parameter.
 *
 * Tier 2, a parameter editor (D-AQ).  What the reader types becomes a
 * LITERAL binding and never a fragment of a query: the interface binds it
 * with a `VALUES' clause after the query the user approved, so there is
 * nothing anyone can type here that changes what is asked of the store.
 *
 * It commits on `change' -- blur, or Enter -- and not on `input'.  A page
 * that re-ran per keystroke would spend the reader's store time on a word
 * being typed; the interaction budget would stop it eventually, and a
 * control should not need the budget to stop it at all.
 */

export const NAME = "text-input";
export const ELEMENT = "dydra-text-input";

export const STYLE = `
dydra-text-input { display: inline-block; }
dydra-text-input input { min-width: 140px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-text-input", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "placeholder"]; }
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
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      if (this._value == null) this._value = UI.valueOf(name, "");
      var field = UI.el("input", { type: "text", value: this._value,
                                   placeholder: this.getAttribute("placeholder") || "",
                                   "aria-label": this.getAttribute("label") || name });
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
  name: "text-input", element: "dydra-text-input", version: "1.0", tier: 2,
  description: "A text field that sets one declared parameter, on change rather than on keystroke.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                placeholder: { type: "string", attribute: true },
                panel: { type: "string", attribute: true,
                         description: "re-run only this panel; omit to re-run every panel that declares the parameter" } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  notes: "the value is bound as a literal; there is no way to send query text from a page",
  examples: ['<dydra-text-input parameter="search" label="Contains"></dydra-text-input>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
