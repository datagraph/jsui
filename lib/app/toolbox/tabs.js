/**
 * `tabs' — several regions of one view, one at a time.
 *
 * Tier 1, and deliberately NOT views (D-AC).  A view is a region of the
 * application document that the pane and the saved page both know about and
 * that `setView' and `data-view' navigate between; tabs are local furniture
 * inside one view, with no document meaning.  Conflating them would make
 * every tab click a document change -- and a document change is a revision.
 *
 * Children carry a `label' attribute; the one with `selected' opens first.
 */

export const NAME = "tabs";
export const ELEMENT = "dydra-tabs";

export const STYLE = `
dydra-tabs { display: block; }
dydra-tabs > .dydra-tabstrip { display: flex; gap: 2px; border-bottom: 1px solid #e2e6ea;
  margin-bottom: 8px; flex-wrap: wrap; }
dydra-tabs > .dydra-tabstrip > button { font: inherit; font-size: 11.5px; cursor: pointer;
  border: 1px solid transparent; border-bottom: none; background: transparent;
  padding: 3px 10px; border-radius: 3px 3px 0 0; color: #44505c; }
dydra-tabs > .dydra-tabstrip > button[aria-selected="true"] {
  background: #fff; border-color: #e2e6ea; color: #1a1d21; font-weight: 600;
  margin-bottom: -1px; }
dydra-tabs > [data-tab-panel][hidden] { display: none; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-tabs", class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector(":scope > .dydra-tabstrip")) return;
      var self = this;
      var kids = Array.prototype.filter.call(this.children, function (c) {
        return c.hasAttribute("label"); });
      if (!kids.length) { this.appendChild(UI.empty("no tabs: give each child a label")); return; }
      var strip = UI.el("div", { class: "dydra-tabstrip", role: "tablist" });
      kids.forEach(function (kid, i) {
        kid.setAttribute("data-tab-panel", "");
        var b = UI.el("button", { type: "button", role: "tab",
                                  text: kid.getAttribute("label") });
        b.addEventListener("click", function () { self.select(i); });
        strip.appendChild(b);
      });
      this.insertBefore(strip, this.firstChild);
      var first = kids.findIndex(function (k) { return k.hasAttribute("selected"); });
      this.select(first < 0 ? 0 : first);
    }
    get panels() {
      return Array.prototype.slice.call(this.querySelectorAll(":scope > [data-tab-panel]"));
    }
    select(index) {
      var strip = this.querySelector(":scope > .dydra-tabstrip");
      var panels = this.panels;
      panels.forEach(function (p, i) { p.hidden = i !== index; });
      if (strip) {
        Array.prototype.forEach.call(strip.children, function (b, i) {
          b.setAttribute("aria-selected", i === index ? "true" : "false"); });
      }
      this.dispatchEvent(new CustomEvent("tab-select", { detail: { index: index } }));
      if (window.dashboard) window.dashboard.resize();
    }
  });
})();
`;

export const MANIFEST = {
  name: "tabs", element: "dydra-tabs", version: "1.0", tier: 1,
  description: "Local tabs inside one view. For navigation between VIEWS use data-view.",
  properties: {}, methods: { select: { parameters: ["number"] } },
  events: { "tab-select": { detail: { index: "number" } } },
  slots: ["(children, each with a label attribute)"], needs: [],
  examples: ['<dydra-tabs><div label="By month" data-bound="m"></div>'
           + '<div label="By region" data-bound="r"></div></dydra-tabs>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
