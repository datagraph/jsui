/**
 * `date-input' — a date, bound to a parameter.
 *
 * Tier 2, a parameter editor.  The value is an ISO date; whether it reaches
 * the store as `xsd:date' or as a plain literal is the parameter's
 * declaration and the interface's business, not this control's.
 *
 * A range needs TWO parameters, and the contract here binds one, so
 * `date-range' is not in this set: a control that silently wrote two
 * bindings would be the one element that could change more of a query than
 * its declaration admits.  Two `date-input's and two parameters say the same
 * thing and say it visibly.
 *
 * The bounds are `earliest' and `latest' rather than `min' and `max': those
 * are numbers on `number-input' and on `slider', and one `uia:' predicate
 * cannot be a number in one place and a date in another (D-AL).
 */

export const NAME = "date-input";
export const ELEMENT = "dydra-date-input";

export const STYLE = `
dydra-date-input { display: inline-block; }
dydra-date-input input { width: 140px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-date-input", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "earliest", "latest"]; }
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
      var field = UI.el("input", { type: "date",
                                   "aria-label": this.getAttribute("label") || name });
      if (this.getAttribute("earliest")) field.setAttribute("min", this.getAttribute("earliest"));
      if (this.getAttribute("latest")) field.setAttribute("max", this.getAttribute("latest"));
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
  name: "date-input", element: "dydra-date-input", version: "1.0", tier: 2,
  description: "A date field that sets one declared parameter.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                earliest: { type: "string", attribute: true },
                latest: { type: "string", attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  notes: "a range is two of these and two parameters; one control never binds two",
  examples: ['<dydra-date-input parameter="since" label="Since"></dydra-date-input>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
