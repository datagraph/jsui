/**
 * `card' — a raised box that groups without labelling.
 *
 * Tier 1.  The `title' slot is a real slot rather than an attribute because
 * a title is often markup -- a term, a badge, a count -- and an attribute
 * would force the model to write escaped HTML into one, which is exactly what
 * Appendix A's rule about structured values in attributes forbids.
 */

export const NAME = "card";
export const ELEMENT = "dydra-card";

export const STYLE = `
dydra-card { display: block; border: 1px solid #e8ecf0; border-radius: 5px; background: #fff;
  padding: 10px 11px; box-shadow: 0 1px 2px rgba(20,30,40,.04); }
dydra-card > .dydra-card-title { font-weight: 600; margin-bottom: 6px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-card", class extends HTMLElement {
    connectedCallback() {
      var slotted = this.querySelector(':scope > [slot="title"]');
      if (slotted && !this.querySelector(":scope > .dydra-card-title")) {
        var t = UI.el("div", { class: "dydra-card-title" });
        t.appendChild(slotted);
        this.insertBefore(t, this.firstChild);
      }
    }
  });
})();
`;

export const MANIFEST = {
  name: "card", element: "dydra-card", version: "1.0", tier: 1,
  description: "A raised box that groups a region.",
  properties: {}, methods: {}, events: {},
  slots: ["title", "(children)"], needs: [],
  examples: ['<dydra-card><span slot="title">Failures</span><div data-bound="fails"></div></dydra-card>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
