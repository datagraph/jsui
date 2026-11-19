/**
 * `heading' — a heading whose level is a property.
 *
 * Tier 1.  Moving a section deeper is then a change of one attribute rather
 * than a change of element, which a patch can make and a tag cannot.  The
 * attribute only chooses the size: the heading element it renders is a real
 * one, so the outline a screen reader builds is the document's.
 */

export const NAME = "heading";
export const ELEMENT = "dydra-heading";

export const STYLE = `
dydra-heading { display: block; font-weight: 600; color: #1d2329; margin: 10px 0 4px; }
dydra-heading[level="1"] { font-size: 17px; }
dydra-heading[level="2"] { font-size: 14px; }
dydra-heading[level="3"] { font-size: 12.5px; }
dydra-heading[level="4"], dydra-heading[level="5"], dydra-heading[level="6"] {
  font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; color: #5b6672; }
dydra-heading > h1, dydra-heading > h2, dydra-heading > h3,
dydra-heading > h4, dydra-heading > h5, dydra-heading > h6 {
  font: inherit; color: inherit; margin: 0; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-heading", class extends HTMLElement {
    static get observedAttributes() { return ["level"]; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var level = Math.max(1, Math.min(6, Number(this.getAttribute("level")) || 2));
      var held = this.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
      var text = held ? held.textContent : (this.textContent || "");
      /* Only when it differs: attributeChangedCallback fires on every
         setAttribute, same value or not, so writing the clamped level back
         unconditionally is an infinite loop. */
      if (this.getAttribute("level") !== String(level)) {
        this.setAttribute("level", String(level));
      }
      this.replaceChildren(UI.el("h" + level, { text: text }));
    }
  });
})();
`;

export const MANIFEST = {
  name: "heading", element: "dydra-heading", version: "1.0", tier: 1,
  description: "A heading whose level is a property rather than a tag.",
  properties: { level: { type: "number", default: 2, attribute: true } },
  methods: {}, events: {}, slots: ["(text)"], needs: [],
  examples: ['<dydra-heading level="2">Inventory</dydra-heading>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
