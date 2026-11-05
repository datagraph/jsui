/**
 * `select' — a control bound to a parameter.
 *
 * Tier 2, and the component the parameter machinery exists for: it is what
 * turns D-X from a mechanism into something a reader can touch.  Its options
 * come from a panel's column -- the values the store returned -- or from an
 * enumerated domain, and never from a list the model wrote down beside the
 * query.
 *
 * What it does on change is the whole of the page's influence over what runs.
 * There is no other call it could make, and a value outside the declared
 * domain comes back as a refusal the control shows, rather than as a request
 * that quietly does nothing.
 *
 * Since phase 5 it keeps none of that itself: the options, the current value,
 * the budget and the commit are the shared control contract in `base.js', so
 * that eleven controls behave the same way rather than eleven times
 * similarly.  With no `panel' named it asks the interface to SET the
 * parameter, and every panel that declares it is re-run — which is what a
 * parameter two panels share has always needed and what naming one panel
 * could never express.
 */

export const NAME = "select";
export const ELEMENT = "dydra-select";

export const STYLE = `
dydra-select { display: inline-block; }
dydra-select select { min-width: 90px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-select", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "panel", "label", "from", "column"]; }
    connectedCallback() {
      UI.accepts(this);
      var self = this;
      UI.budgetWatch(this, this.render.bind(this));
      /* The options follow the data: a selector whose domain is a panel's
         column is only correct once that panel has returned. */
      if (window.dashboard) {
        window.dashboard.on("data", function () { self.render(); });
      }
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    /** Options from the bound slot this control sits in, if it is in one. */
    setData(value) {
      var t = UI.asTable(value);
      this._options = t.rows.map(function (r) { return String(r[0]); });
      this.render();
    }
    get options() {
      return this._options || UI.optionsOf(this.getAttribute("parameter"), this);
    }
    set options(v) { this._options = (v || []).map(String); this.render(); }
    get value() {
      var s = this.querySelector("select");
      return s ? s.value : this._value;
    }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      var options = this.options;
      if (this._value == null) this._value = UI.valueOf(name, options[0] || "");
      var field = UI.el("select", { "aria-label": this.getAttribute("label") || name });
      if (!options.length) {
        field.appendChild(UI.el("option", { text: "…", value: "" }));
        field.disabled = true;
        field.setAttribute("data-locked", "");
      }
      options.forEach(function (o) {
        var opt = UI.el("option", { value: o, text: o });
        if (o === String(self._value)) opt.setAttribute("selected", "");
        field.appendChild(opt);
      });
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
  name: "select", element: "dydra-select", version: "1.0", tier: 2,
  description: "A control that sets one declared parameter and re-runs one declared panel.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                panel: { type: "string", attribute: true,
                         description: "re-run only this panel; omit to re-run every panel that declares the parameter" },
                from: { type: "string", attribute: true,
                        description: "a panel whose column supplies the options; defaults to the parameter's declared domain" },
                column: { type: "string", attribute: true },
                label: { type: "string", attribute: true },
                options: { type: "array", description: "set as a property, if not from a panel" } },
  methods: { setData: { parameters: ["table"] }, setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  notes: "disables itself when the page's interaction budget is spent",
  slots: [], needs: [],
  examples: ['<dydra-select parameter="region" label="Region"></dydra-select>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
