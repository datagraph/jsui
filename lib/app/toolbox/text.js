/**
 * `text' — a paragraph of the page's own prose.
 *
 * Tier 1.  Its content is the element's, not markup inside it, and that is
 * what makes it addressable: `set-attribute' on `text' changes one line of
 * one element, where the same change written as markup would replace a
 * region and everything in it.
 *
 * The shade is `emphasis' and not `tone' because `badge' already declares a
 * `tone' with different members, and one `uia:' predicate cannot mean two
 * things (D-AL).  The generated vocabulary's build check is what said so.
 */

export const NAME = "text";
export const ELEMENT = "dydra-text";

export const STYLE = `
dydra-text { display: block; font-size: 12.5px; line-height: 1.5; color: #2b3138; margin: 0 0 6px; }
dydra-text[emphasis="muted"] { color: #6b747d; }
dydra-text[emphasis="warn"] { color: #8a5a1a; }
dydra-text[size="small"] { font-size: 11.5px; }
dydra-text[size="large"] { font-size: 14px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-text", class extends HTMLElement {});
})();
`;

export const MANIFEST = {
  name: "text", element: "dydra-text", version: "1.0", tier: 1,
  description: "A paragraph of the page's own prose, addressable as one element.",
  properties: { emphasis: { enum: ["normal", "muted", "warn"], default: "normal",
                          attribute: true },
                size: { enum: ["small", "normal", "large"], default: "normal", attribute: true } },
  methods: {}, events: {}, slots: ["(text)"], needs: [],
  examples: ['<dydra-text emphasis="muted">Counted at the last import.</dydra-text>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
