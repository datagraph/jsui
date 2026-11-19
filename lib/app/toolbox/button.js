/**
 * `button' — one of three named actions, and nothing else.
 *
 * Tier 2.  `refresh' the page, `set' a parameter to a value, `view' another
 * region.  The fixed registry is the point rather than a limitation: a
 * button carrying code would be a way for a page to do something its
 * document does not say it does, which is the whole of D-AQ in one element.
 *
 * An action this build does not know leaves the button inert and says so, in
 * the page, rather than doing nothing quietly.
 */

export const NAME = "button";
export const ELEMENT = "dydra-button";

export const STYLE = `
dydra-button { display: inline-block; }
dydra-button button { font: inherit; font-size: 12px; padding: 2px 9px; cursor: pointer;
  border: 1px solid #ccd3da; border-radius: 3px; background: #f7f9fb; color: #2b3138; }
dydra-button button:hover:not(:disabled) { background: #eef1f4; }
dydra-button button:disabled { color: #8a94a0; cursor: default; }
dydra-button[data-ui-inert] button { border-style: dashed; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var ACTIONS = ["refresh", "set", "view"];
  UI.define("dydra-button", class extends HTMLElement {
    static get observedAttributes() { return ["action", "parameter", "value", "view", "label"]; }
    connectedCallback() {
      this._label = this._label || this.textContent.trim();
      UI.budgetWatch(this, this.render.bind(this));
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var self = this;
      var action = this.getAttribute("action") || "refresh";
      var label = this.getAttribute("label") || this._label || action;
      var known = ACTIONS.indexOf(action) >= 0;
      var field = UI.el("button", { type: "button", text: label });
      if (!known) {
        this.setAttribute("data-ui-inert", "this build has no action called " + action);
        field.disabled = true;
        field.title = "no action called " + action;
      } else {
        this.removeAttribute("data-ui-inert");
      }
      /* 'view' costs nothing and must stay usable when the budget is spent:
         the reader is not asking the store for anything. */
      if (known && action !== "view" && UI.spent(this)) {
        field.disabled = true;
        field.title = "this page has used its " + this._budget.maxRuns + " interactive run(s)";
      }
      field.classList.add("dydra-field");
      field.addEventListener("click", function () { self.perform(action); });
      this.replaceChildren(field, UI.el("span", { class: "dydra-why" }));
    }
    perform(action) {
      var self = this;
      if (!window.dashboard) return;
      UI.why(this, "");
      if (action === "refresh") { window.dashboard.refresh(); return; }
      if (action === "view") {
        var to = this.getAttribute("view");
        if (to) window.dashboard.setView(to);
        return;
      }
      if (action === "set") {
        var name = this.getAttribute("parameter");
        if (!name) { UI.why(this, "this button sets no parameter"); return; }
        UI.commit(this, { parameter: name, panel: this.getAttribute("panel") },
                  this.getAttribute("value") == null ? "" : this.getAttribute("value"));
      }
    }
  });
})();
`;

export const MANIFEST = {
  name: "button", element: "dydra-button", version: "1.0", tier: 2,
  description: "A button that performs one named action: refresh, set a parameter, or open a view.",
  properties: { action: { enum: ["refresh", "set", "view"], default: "refresh", attribute: true },
                parameter: { type: "string", attribute: true, description: "for action=set" },
                value: { type: "string", attribute: true, description: "for action=set" },
                view: { type: "string", attribute: true, description: "for action=view" },
                panel: { type: "string", attribute: true,
                         description: "re-run only this panel; omit to re-run every panel that declares the parameter" },
                label: { type: "string", attribute: true } },
  methods: {}, events: { change: { detail: { parameter: "string", value: "string" } } },
  slots: ["(text, used as the label)"], needs: [],
  notes: "there is no action that runs code; an unknown one is inert and says so",
  examples: ['<dydra-button action="set" parameter="region" value="North">North</dydra-button>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
