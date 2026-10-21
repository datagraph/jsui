/**
 * `badge' — a small coloured label.
 *
 * Tier 1.  Four tones and no more: a palette a model can choose from without
 * being told the hex values, and one it cannot get wrong by inventing a fifth
 * -- an unknown tone falls back to the neutral one rather than to no styling
 * at all, which would look like a bug.
 */

export const NAME = "badge";
export const ELEMENT = "dydra-badge";

export const STYLE = `
dydra-badge { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
  padding: 1px 6px; border-radius: 9px; background: #eef2f7; color: #44505c;
  vertical-align: baseline; }
dydra-badge[data-tone="good"] { background: #eaf2ea; color: #2d662d; }
dydra-badge[data-tone="warn"] { background: #fdf3e0; color: #8a5a1a; }
dydra-badge[data-tone="bad"]  { background: #fbeceb; color: #8a2b2b; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var TONES = ["neutral", "good", "warn", "bad"];
  UI.define("dydra-badge", class extends HTMLElement {
    static get observedAttributes() { return ["tone"]; }
    connectedCallback() { this.apply(); }
    attributeChangedCallback() { this.apply(); }
    apply() {
      var t = this.getAttribute("tone") || "neutral";
      this.setAttribute("data-tone", TONES.indexOf(t) >= 0 ? t : "neutral");
    }
  });
})();
`;

export const MANIFEST = {
  name: "badge", element: "dydra-badge", version: "1.0", tier: 1,
  description: "A small coloured label.",
  properties: { tone: { enum: ["neutral", "good", "warn", "bad"], default: "neutral",
                        attribute: true } },
  methods: {}, events: {}, slots: ["(text)"], needs: [],
  examples: ['<dydra-badge tone="warn">stale</dydra-badge>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
