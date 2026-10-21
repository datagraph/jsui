/**
 * What every component in the toolbox shares.
 *
 * Implements the common half of Appendix C; work item U-35.
 *
 * Not a component and not in the catalog: it is marked `hidden', so the model
 * never sees it, `uses' never names it, and the validator adds it silently as
 * a dependency rather than warning that a component the model did not ask for
 * has been inlined.  It exists because the alternative -- repeating element
 * registration, number formatting and text escaping in twelve files -- is
 * twelve places for the same bug.
 *
 * Three rules from §8.2 are enforced here rather than trusted:
 *
 *   `define' refuses to register a name twice, because a page inlined with a
 *   component twice (a dependency named directly and reached as a dependency)
 *   would otherwise throw at registration and take the whole script with it.
 *
 *   `setData' is the one data contract.  A component that accepts data sets
 *   `data-accepts' on itself, and the frame's default drawing hands the slot's
 *   value to it instead of drawing over it.  Without that, a model writing
 *   `<section data-bound="sales"><dydra-table></dydra-table></section>' would
 *   watch the runtime replace the component it had just declared -- the one
 *   failure that would make the whole toolbox look broken.
 *
 *   Nothing fetches, stores or imports.  There is nothing here that could.
 */

export const NAME = "base";
export const ELEMENT = null;

// Deliberately names no element.  A shared stylesheet listing every component
// would put the whole toolbox's vocabulary into every page that used one of
// them -- harmless to render and misleading to read, since a page would then
// mention components it does not carry.  Each component brings its own
// `display'.
export const STYLE = `
.dydra-empty { color: #8a94a0; font-size: 11.5px; font-style: italic; }
.dydra-h { font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
  color: #5b6672; margin-bottom: 4px; }
`;

export const SOURCE = String.raw`
(function () {
  "use strict";
  if (window.DydraUI) return;
  var NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  var UI = {
    /* Registering the same element twice throws and takes the rest of the
       inlined script with it, so this is a guard and not a convenience. */
    define: function (name, cls) {
      try { if (!customElements.get(name)) customElements.define(name, cls); }
      catch (e) { /* already defined by an earlier copy: leave the first */ }
    },
    isNumber: function (v) { return v != null && v !== "" && NUM.test(String(v)); },
    number: function (v, digits) {
      var n = Number(v);
      if (!isFinite(n)) return String(v == null ? "" : v);
      return n.toLocaleString(undefined, digits == null ? undefined
        : { minimumFractionDigits: digits, maximumFractionDigits: digits });
    },
    /* A table out of whatever the slot was given: the runtime posts
       {names, rows}, a transform may return rows of objects, and a component
       should not care which. */
    asTable: function (value) {
      if (!value) return { names: [], rows: [] };
      if (Array.isArray(value.rows) && Array.isArray(value.names)) return value;
      if (Array.isArray(value)) {
        if (!value.length) return { names: [], rows: [] };
        if (typeof value[0] === "object" && !Array.isArray(value[0])) {
          var names = Object.keys(value[0]);
          return { names: names, rows: value.map(function (o) {
            return names.map(function (n) { return o[n] == null ? "" : String(o[n]); }); }) };
        }
        return { names: ["value"], rows: value.map(function (v) { return [String(v)]; }) };
      }
      return { names: ["value"], rows: [[String(value)]] };
    },
    column: function (table, name) {
      var at = table.names.indexOf(name);
      if (at < 0 && UI.isNumber(name)) at = Number(name);
      return at < 0 ? -1 : at;
    },
    el: function (tag, props, kids) {
      var e = document.createElement(tag);
      Object.keys(props || {}).forEach(function (k) {
        if (k === "class") e.className = props[k];
        else if (k === "text") e.textContent = props[k];
        else if (k === "style") e.style.cssText = props[k];
        else if (props[k] != null) e.setAttribute(k, props[k]);
      });
      (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
      return e;
    },
    empty: function (text) { return UI.el("div", { class: "dydra-empty", text: text }); },
    /* Every component renders something sensible with nothing set (§8.2),
       and this is what "sensible" means: a line saying what is missing. */
    accepts: function (element) {
      element.setAttribute("data-accepts", "");
      return element;
    }
  };
  window.DydraUI = UI;
})();
`;

export const MANIFEST = {
  name: "base", element: null, version: "1.0", hidden: true,
  description: "Shared helpers; inlined automatically whenever any component is used.",
  properties: {}, methods: {}, events: {}, slots: [], needs: [], examples: [],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: {}, hidden: true, tier: 0 };
