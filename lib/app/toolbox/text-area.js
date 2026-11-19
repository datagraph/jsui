/**
 * `text-area' — `text-input' with room for a sentence.
 *
 * Tier 2, a parameter editor, with the same contract and the same
 * commit-on-decision rule.  Separate from `text-input' because the shape of
 * the control tells the reader how much is wanted, which is a judgement
 * about the page and not about the data.
 */

export const NAME = "text-area";
export const ELEMENT = "dydra-text-area";

export const STYLE = `
dydra-text-area { display: block; }
dydra-text-area textarea { width: 100%; min-height: 48px; resize: vertical; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-text-area", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "rows", "placeholder"]; }
    connectedCallback() {
      UI.budgetWatch(this, this.render.bind(this));
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    get value() {
      var f = this.querySelector("textarea");
      return f ? f.value : this._value;
    }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      if (this._value == null) this._value = UI.valueOf(name, "");
      var rows = Number(this.getAttribute("rows")) || 3;
      var field = UI.el("textarea", { rows: String(rows),
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
  name: "text-area", element: "dydra-text-area", version: "1.0", tier: 2,
  description: "A multi-line text field that sets one declared parameter.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                rows: { type: "number", default: 3, attribute: true },
                placeholder: { type: "string", attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  examples: ['<dydra-text-area parameter="note" label="Note" rows="4"></dydra-text-area>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
