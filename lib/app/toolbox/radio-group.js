/**
 * `radio-group' — the choices, all visible at once.
 *
 * Tier 2, a parameter editor.  `select' when the list is long and this when
 * seeing the alternatives is part of the point -- a judgement about the page
 * rather than about the data, which is why both exist and neither is the
 * default.
 *
 * Its options come from the parameter's declared enumeration or from a
 * panel's column: the values the store returned, never a list written beside
 * the query.
 */

export const NAME = "radio-group";
export const ELEMENT = "dydra-radio-group";

export const STYLE = `
dydra-radio-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
dydra-radio-group .dydra-radio { display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: #2b3138; }
dydra-radio-group input { width: 13px; height: 13px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var group = 0;
  UI.define("dydra-radio-group", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "label", "from", "column"]; }
    connectedCallback() {
      UI.accepts(this);
      this._group = "dydra-radio-" + (++group);
      UI.budgetWatch(this, this.render.bind(this));
      var self = this;
      /* The options follow the data: a group whose domain is a panel's
         column is only correct once that panel has returned. */
      if (window.dashboard) window.dashboard.on("data", function () { self.render(); });
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    get value() { return this._value; }
    set value(v) { this._value = v == null ? "" : String(v); this.render(); }
    setValue(v) { this.value = v; }
    setData(value) {
      var t = UI.asTable(value);
      this._options = t.rows.map(function (r) { return String(r[0]); });
      this.render();
    }
    get options() { return this._options || UI.optionsOf(this.getAttribute("parameter"), this); }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      var options = this.options;
      if (this._value == null) this._value = UI.valueOf(name, options[0] || "");
      var parts = [];
      if (this.getAttribute("label")) {
        parts.push(UI.el("span", { class: "dydra-label", text: this.getAttribute("label") }));
      }
      if (!options.length) {
        parts.push(UI.empty("no choices yet"));
      }
      options.forEach(function (o) {
        var input = UI.el("input", { type: "radio", name: self._group, value: o });
        input.checked = String(self._value) === o;
        if (UI.spent(self)) input.disabled = true;
        input.addEventListener("change", function () {
          if (!input.checked) return;
          self._value = o;
          UI.commit(self, { parameter: name, panel: self.getAttribute("panel") }, o);
        });
        parts.push(UI.el("label", { class: "dydra-radio" }, [input, UI.el("span", { text: o })]));
      });
      parts.push(UI.el("span", { class: "dydra-why" }));
      this.replaceChildren.apply(this, parts);
    }
  });
})();
`;

export const MANIFEST = {
  name: "radio-group", element: "dydra-radio-group", version: "1.0", tier: 2,
  description: "Every choice at once; sets one declared parameter.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                label: { type: "string", attribute: true },
                from: { type: "string", attribute: true,
                        description: "a panel whose column supplies the options" },
                column: { type: "string", attribute: true },
                panel: { type: "string", attribute: true } },
  methods: { setData: { parameters: ["table"] }, setValue: { parameters: ["string"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: [], needs: [],
  examples: ['<dydra-radio-group parameter="region" label="Region"></dydra-radio-group>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
