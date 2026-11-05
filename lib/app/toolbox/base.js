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
.dydra-why { color: #8a5a1a; font-size: 11px; margin-left: 6px; }
.dydra-label { font-size: 11px; color: #5b6672; margin-right: 5px; }
.dydra-field { font: inherit; font-size: 12px; padding: 2px 4px;
  border: 1px solid #ccd3da; border-radius: 3px; background: #fff; }
.dydra-field:disabled { color: #8a94a0; background: #f4f6f8; }
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
    /* A component that MOVES its light-DOM children into a region of its
       own marks that region "data-ui-content".  The reconciler inserts a
       new child where the existing ones are, and without the mark it would
       insert into the component element beside the region -- which renders
       outside the border rather than in it, and only on the elements added
       after the first mount. */
    /* Every component renders something sensible with nothing set (§8.2),
       and this is what "sensible" means: a line saying what is missing. */
    accepts: function (element) {
      element.setAttribute("data-accepts", "");
      return element;
    },

    /* ── the control contract (U-69) ──────────────────────────────────────
       A control is a PARAMETER EDITOR and nothing else (D-AQ).  It holds a
       value, it shows the domain that value must come from, and on a
       DECISION -- a change, not a keystroke -- it asks the interface to set
       the parameter.  There is no other call it can make: it cannot compose
       a query, it cannot widen a grant, and the value it sends is refused by
       the interface if it falls outside what was declared.

       Eleven controls would otherwise each re-implement the five things
       below, and the fifth -- showing a refusal beside the control that
       caused it -- is the one that would be left out, leaving a control that
       appears to do nothing. */

    /** The declaration of a parameter, or null. */
    parameterOf: function (name) {
      if (!name || !window.dashboard || !window.dashboard.parameter) return null;
      try { return window.dashboard.parameter(name); } catch (e) { return null; }
    },

    /** Its current value: what the interface last bound, else its default. */
    valueOf: function (name, fallback) {
      var held = (window.dashboard && window.dashboard.parameters) || {};
      if (name && held[name] != null && held[name] !== "") return String(held[name]);
      var d = UI.parameterOf(name);
      if (d && d.default != null && d.default !== "") return String(d.default);
      return fallback == null ? "" : String(fallback);
    },

    /**
       The values a control may offer, from the parameter's DECLARED domain.

       An enumeration is the domain itself; 'from' is a panel's column, which
       means the options are what the store returned rather than a list
       written beside the query.  A control never invents one. */
    optionsOf: function (name, element) {
      var d = UI.parameterOf(name) || {};
      var domain = d.domain || {};
      if (domain.values && domain.values.length) return domain.values.map(String);
      var from = (element && element.getAttribute("from")) || domain.from;
      if (!from || !window.dashboard) return [];
      var table = window.dashboard.table(from);
      if (!table) return [];
      var column = (element && element.getAttribute("column")) || domain.column;
      var at = column ? table.names.indexOf(column) : 0;
      if (at < 0) at = 0;
      var seen = {}, out = [];
      table.rows.forEach(function (r) {
        var v = r[at];
        if (v == null || v === "" || seen[v]) return;
        seen[v] = 1; out.push(String(v));
      });
      return out;
    },

    /** The line that says why the last change was refused, beside the control. */
    why: function (host, text) {
      var spot = host.querySelector(".dydra-why");
      if (!spot) return;
      spot.textContent = text == null ? "" : String(text);
    },

    /**
       Disable while a change is in flight: one decision, one request.

       Letting go does NOT simply re-enable.  The answer that ends the
       request carries the budget with it, so by the time this runs the
       control may have been re-rendered as spent -- and an unconditional
       re-enable would hand the reader back a control whose next use is
       already refused.  A control that locked itself for its own reason
       (nothing to choose from, no range to slide over) says so with
       'data-locked' and stays locked too. */
    busy: function (host, flag) {
      var field = host.querySelector(".dydra-field");
      if (field) {
        field.disabled = flag ? true
          : (UI.spent(host) || field.hasAttribute("data-locked"));
      }
      if (flag) host.setAttribute("data-busy", ""); else host.removeAttribute("data-busy");
    },

    /**
       Watch the interaction budget.

       A control that is going to be refused should look refused.  The page
       is told what asking again costs; offering a choice that cannot be
       answered is the dishonest version of it. */
    budgetWatch: function (host, paint) {
      if (!window.dashboard) return;
      host._budget = window.dashboard.budget;
      window.dashboard.on("budget", function (b) { host._budget = b; try { paint(); } catch (e) {} });
    },

    /** True when the page has nothing left to spend. */
    spent: function (host) { return !!(host._budget && host._budget.exhausted); },

    /**
       Ask the interface to set the parameter.  Never rejects.

       With a 'panel' named, one panel is re-run, which is what 'select' has
       always done.  Without one, the interface re-runs every panel that
       DECLARES the parameter -- which is the better default, because the
       document already knows which those are and a control naming one is a
       chance to name the wrong one. */
    commit: function (host, options, value) {
      var name = options.parameter;
      UI.why(host, "");
      host.dispatchEvent(new CustomEvent("change",
        { detail: { parameter: name, value: value }, bubbles: true }));
      if (!name || !window.dashboard) return Promise.resolve({ ok: true, ran: false });
      var asked;
      if (options.panel) {
        var values = {}; values[name] = value;
        asked = window.dashboard.run(options.panel, values);
      } else if (window.dashboard.set) {
        asked = window.dashboard.set(name, value);
      } else {
        UI.why(host, "this interface cannot set a parameter");
        return Promise.resolve({ ok: false });
      }
      UI.busy(host, true);
      return asked.then(function (r) {
        UI.busy(host, false);
        return { ok: true, result: r };
      }, function (e) {
        UI.busy(host, false);
        /* Said here, beside the control that caused it: a refusal reported
           only in the pane is a control that appears to do nothing. */
        UI.why(host, (e && e.message) || e);
        return { ok: false, error: String((e && e.message) || e) };
      });
    },

    /** The label, the field and the refusal line, which every control has. */
    frame: function (host, field, label) {
      var parts = [];
      if (label) parts.push(UI.el("label", { class: "dydra-label", text: label }));
      field.classList.add("dydra-field");
      if (UI.spent(host)) {
        field.disabled = true;
        field.title = "this page has used its " + host._budget.maxRuns
                    + " interactive run(s); allow more in the pane to keep asking";
      }
      parts.push(field);
      parts.push(UI.el("span", { class: "dydra-why" }));
      host.replaceChildren.apply(host, parts);
      return field;
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
