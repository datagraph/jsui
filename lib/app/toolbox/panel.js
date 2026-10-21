/**
 * `panel' — a bordered region with a heading.
 *
 * Tier 1.  Distinguished from `card' by having a title bar and a caption
 * line: a panel says what it is showing, a card merely groups.
 */

export const NAME = "panel";
export const ELEMENT = "dydra-panel";

export const STYLE = `
dydra-panel { display: block; border: 1px solid #e2e6ea; border-radius: 4px; background: #fff; }
dydra-panel > .dydra-panel-head { padding: 5px 9px; background: #f7f9fb;
  border-bottom: 1px solid #eef1f4; display: flex; gap: 8px; align-items: baseline; }
dydra-panel > .dydra-panel-head b { font-size: 12px; }
dydra-panel > .dydra-panel-head span { color: #8a94a0; font-size: 11px; }
dydra-panel > .dydra-panel-body { padding: 8px 9px 9px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-panel", class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector(":scope > .dydra-panel-body")) return;
      var head = UI.el("div", { class: "dydra-panel-head" }, [
        UI.el("b", { text: this.getAttribute("label") || "" }),
        UI.el("span", { text: this.getAttribute("caption") || "" })
      ]);
      var body = UI.el("div", { class: "dydra-panel-body" });
      /* The children are MOVED, not copied: a slot the frame fills by id must
         keep its identity, and re-creating it would break the next patch. */
      while (this.firstChild) body.appendChild(this.firstChild);
      this.appendChild(head);
      this.appendChild(body);
    }
  });
})();
`;

export const MANIFEST = {
  name: "panel", element: "dydra-panel", version: "1.0", tier: 1,
  description: "A bordered region with a heading and an optional caption.",
  properties: { label: { type: "string", attribute: true },
                caption: { type: "string", attribute: true } },
  methods: {}, events: {}, slots: ["(children)"], needs: [],
  examples: ['<dydra-panel label="Sales" caption="by month"><div data-bound="sales"></div></dydra-panel>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
