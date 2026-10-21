/**
 * `select' — a control bound to a parameter.
 *
 * Tier 2, and the component the parameter machinery exists for: it is what
 * turns D-X from a mechanism into something a reader can touch.  Its options
 * come from a panel's column -- the values the store returned -- or from an
 * enumerated domain, and never from a list the model wrote down beside the
 * query.
 *
 * What it does on change is the whole of the page's influence over what runs:
 * `dashboard.run(panel, {name: value})'.  There is no other call it could
 * make, and a value outside the declared domain comes back as a refusal the
 * control shows, rather than as a request that quietly does nothing.
 */

export const NAME = "select";
export const ELEMENT = "dydra-select";

export const STYLE = `
dydra-select { display: inline-block; }
dydra-select label { font-size: 11px; color: #5b6672; margin-right: 5px; }
dydra-select select { font: inherit; font-size: 12px; padding: 2px 4px;
  border: 1px solid #ccd3da; border-radius: 3px; background: #fff; }
dydra-select select:disabled { color: #8a94a0; }
dydra-select .dydra-select-why { color: #8a5a1a; font-size: 11px; margin-left: 6px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-select", class extends HTMLElement {
    static get observedAttributes() { return ["parameter", "panel", "label"]; }
    connectedCallback() {
      UI.accepts(this);
      this.render();
      var self = this;
      /* The options follow the data: a selector whose domain is a panel's
         column is only correct once that panel has returned. */
      if (window.dashboard) {
        window.dashboard.on("data", function () { self.refreshOptions(); });
        /* A control that is going to be refused should look refused.  The
           page is told what asking again costs; offering a choice that
           cannot be answered is the dishonest version of §7.4. */
        window.dashboard.on("budget", function (b) { self._budget = b; self.render(); });
        this._budget = window.dashboard.budget;
        this.refreshOptions();
      }
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    /** Options from the bound slot this control sits in, if it is in one. */
    setData(value) {
      var t = UI.asTable(value);
      this._options = t.rows.map(function (r) { return String(r[0]); });
      this.render();
    }
    get options() { return this._options || []; }
    set options(v) { this._options = (v || []).map(String); this.render(); }
    get value() {
      var s = this.querySelector("select");
      return s ? s.value : this._value;
    }
    set value(v) { this._value = v; this.render(); }
    refreshOptions() {
      var from = this.getAttribute("from");
      if (!from || !window.dashboard) return;
      var t = window.dashboard.table(from);
      if (!t) return;
      var column = this.getAttribute("column");
      var at = column ? t.names.indexOf(column) : 0;
      if (at < 0) return;
      var seen = {}, out = [];
      t.rows.forEach(function (r) {
        var v = r[at];
        if (v == null || v === "" || seen[v]) return;
        seen[v] = 1; out.push(String(v));
      });
      this._options = out;
      this.render();
    }
    render() {
      var self = this;
      var name = this.getAttribute("parameter") || "";
      var panel = this.getAttribute("panel") || "";
      var sel = UI.el("select", { "aria-label": this.getAttribute("label") || name });
      var options = this.options;
      if (!options.length) {
        sel.appendChild(UI.el("option", { text: "…", value: "" }));
        sel.disabled = true;
      }
      options.forEach(function (o) {
        var opt = UI.el("option", { value: o, text: o });
        if (o === self._value) opt.setAttribute("selected", "");
        sel.appendChild(opt);
      });
      if (this._budget && this._budget.exhausted) {
        sel.disabled = true;
        sel.title = "this page has used its " + this._budget.maxRuns
                  + " interactive run(s); allow more in the pane to keep asking";
      }
      sel.addEventListener("change", function () {
        self._value = sel.value;
        var why = self.querySelector(".dydra-select-why");
        if (why) why.textContent = "";
        self.dispatchEvent(new CustomEvent("change",
          { detail: { parameter: name, value: sel.value } }));
        if (!panel || !window.dashboard) return;
        var values = {};
        values[name] = sel.value;
        sel.disabled = true;
        window.dashboard.run(panel, values).then(function () {
          sel.disabled = false;
        }, function (e) {
          sel.disabled = false;
          /* Said here, beside the control that caused it: a refusal reported
             only in the pane is a control that appears to do nothing. */
          var spot = self.querySelector(".dydra-select-why");
          if (spot) spot.textContent = String((e && e.message) || e);
        });
      });
      this.replaceChildren(
        this.getAttribute("label")
          ? UI.el("label", { text: this.getAttribute("label") }) : document.createComment(""),
        sel,
        UI.el("span", { class: "dydra-select-why" })
      );
    }
  });
})();
`;

export const MANIFEST = {
  name: "select", element: "dydra-select", version: "1.0", tier: 2,
  description: "A control that sets one declared parameter and re-runs one declared panel.",
  properties: { parameter: { type: "string", required: true, attribute: true },
                panel: { type: "string", required: true, attribute: true,
                         description: "the panel to re-run on change" },
                from: { type: "string", attribute: true,
                        description: "a panel whose column supplies the options" },
                column: { type: "string", attribute: true },
                label: { type: "string", attribute: true },
                options: { type: "array", description: "set as a property, if not from a panel" } },
  methods: { setData: { parameters: ["table"] } },
  events: { change: { detail: { parameter: "string", value: "string" } } },
  notes: "disables itself when the page's interaction budget is spent",
  slots: [], needs: [],
  examples: ['<dydra-select parameter="region" panel="sales" from="regions" column="region" label="Region"></dydra-select>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
