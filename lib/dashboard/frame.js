/**
 * The frame a model-authored page runs in, and the only channel into it.
 *
 * Implements D-R, D-S and the enforcement half of D-T from
 * `llm-result-rendering-plan.md' §7.2; work items U-22, U-23, U-26.  Extended
 * by `ui-generator.md' §6.2.1, §7.2 and D-AC; work items U-29a, U-34, U-37,
 * U-39, U-40 and U-43.
 *
 * D-M's answer for a single figure was a sandbox with no `allow-scripts' at
 * all: an SVG does not need to run to be looked at.  A dashboard does.  It has
 * tabs, it has a refresh, it draws from data that arrives after it is mounted,
 * and a page that cannot run is not a dashboard.  So scripts are enabled, and
 * the isolation has to come from somewhere else:
 *
 *      sandbox="allow-scripts"        and NOT allow-same-origin
 *
 * Those two flags together are the one combination that must never appear.  A
 * frame holding both runs on the parent's origin and can simply remove its own
 * sandbox attribute from the inside; the restriction becomes decorative.  With
 * `allow-scripts' alone the document has an OPAQUE origin: its scripts run, and
 * they cannot reach the parent's DOM, the session token, the cookies, or any
 * storage — `localStorage' throws, `document.cookie' is empty, and
 * `parent.document' is a cross-origin violation.
 *
 * The content policy closes the rest.  `connect-src 'none'' means the page
 * cannot fetch, open a socket or beacon anything out; `default-src 'none''
 * means it loads nothing from the network at all.  Together with the opaque
 * origin that gives the property the whole design rests on:
 *
 *      THE MODEL'S CODE NEVER HOLDS A CREDENTIAL AND NEVER MAKES A NETWORK CALL.
 *
 * Which is what makes it safe to let a model write arbitrary HTML and script
 * and then run it — and why `script-src' here is permissive ('unsafe-inline',
 * 'unsafe-eval').  Those keywords are alarming in a page that has an origin and
 * a session; in a page that has neither they buy the model its expressiveness
 * and cost nothing, because there is nothing in the frame worth stealing and no
 * way to send it anywhere.  The CSP's job here is to stop the frame reaching
 * OUT, not to stop it running.
 *
 * One consequence to keep in mind when reading the message handling below: an
 * opaque origin cannot be named.  `postMessage' to the frame therefore targets
 * "*" — there is no origin string that would match — and messages arriving
 * FROM the frame carry `origin === "null"'.  So the parent authenticates by
 * `event.source === iframe.contentWindow', which is an object identity and
 * cannot be forged by another page, rather than by an origin check that would
 * be vacuous here.
 *
 * ── What the application document added ─────────────────────────────────────
 *
 * Four things, and the first has the design decision in it.
 *
 * A patch is applied IN PLACE (§6.2.1).  The obvious way to change a page
 * whose markup lives in `srcdoc' is to rebuild the document and re-mount --
 * and that throws away everything the page has become since it loaded: scroll
 * position, which tab was open, a selection, a chart's state, the parameter
 * the reader just chose.  Iterating on a page by reloading it from the top is
 * not iterating; it is regenerating with extra steps, and it would make the
 * cheap change feel worse than the expensive one.  So the runtime takes
 * `{type:"patch", ops}' and edits its own DOM, while the document out here
 * remains the authority.  Two paths now reach the same state, which is a
 * consistency risk worth naming, so it has an invariant and a test:
 * PATCH-THEN-READ EQUALS REBUILD-THEN-READ, asserted on the frame's own
 * serialised DOM.  Anything the runtime cannot apply -- a component that was
 * never inlined, a new page script, a view that did not exist -- is reported
 * rather than guessed at, and the caller rebuilds.
 *
 * A page may ask for ONE PANEL to be re-run with parameter values (D-X, U-34).
 * It may not ask for a query: `run' names a declared panel and supplies values
 * the interface checks against declared domains, and a value outside its
 * domain comes back as a refusal with a reason rather than as silence.  The
 * promise matters -- without it every interactive page re-implements the same
 * correlation between a request and the `data' event, and most of them get the
 * second concurrent request wrong.
 *
 * SEVERAL VIEWS LIVE IN ONE FRAME (D-AC).  Not several frames: each frame is a
 * fresh opaque origin with its own copy of the runtime and its own data
 * posting, and navigating between them would mean re-posting every result on
 * every click.  One frame, one posting, views switched inside it -- and the
 * saved file keeps that behaviour with no network and no host.
 *
 * COMPONENTS ARE INLINED, not imported (D-Y).  §2.2 forbids the frame loading
 * anything, so a component library is not a URL; it is source concatenated
 * after the runtime, and only the components the document's `uses' names.
 */

import { contentDigest } from "../mcp/result-digest.js";
import { viewsOf, MAIN_VIEW } from "../app/document.js";
import { COMPONENTS } from "../app/toolbox/index.js";
import { SOURCE as DOM_PATCH_SOURCE } from "../app/dom-patch.js";
import { instructionsFor } from "../app/reconcile.js";
import { diffTrees } from "../app/tree.js";
/* A namespace, for the reason that module's own header gives: this one is
   newer than the tree it will be deployed into more than once, and a named
   import of an export a cached copy does not have yet is a link error that
   takes the whole application down. */
import * as saved from "./saved-runtime.js";

/* ── the policy ───────────────────────────────────────────────────────────── */

export const SANDBOX = "allow-scripts";

export const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── the runtime that lives inside the frame ──────────────────────────────── */

/**
 * The page's own script, written here rather than by the model.
 *
 * It does four things the model should not have to re-implement, and must not
 * be able to opt out of: it parses the result notations, it runs the declared
 * transforms, it fills the slots, and it marks provenance and staleness on
 * every region (D-S, D-T).  The model's own script runs alongside it and can
 * take over the DRAWING of any slot by registering a renderer; it cannot take
 * over the marking.
 *
 * Written as a string because the frame loads nothing: no module, no import,
 * no second file.  Everything the page needs is in the one srcdoc.
 */
const RUNTIME = String.raw`
(function () {
  "use strict";
  var state = { results: {}, derived: {}, stale: [], spec: null, at: null,
                view: null, parameters: {}, app: {}, standalone: false, island: null,
                budget: null,
                /* What the interface showed the model while this page was
                   built (REQ-23.2.6).  Null until it is posted in: a page
                   with no ledger must say it has none, not say nothing was
                   read. */
                evidence: null };
  var renderers = {};
  /* How many elements the last patch moved, by view.  Reported with the
     answer so that the pane can say whether anything changed where the
     reader is looking (it used to say "applied in place" either way). */
  var lastTouched = null;
  var listeners = { data: [], error: [], view: [], refused: [], budget: [] };
  var pending = {};
  var seq = 0;

  function post(msg) {
    try { parent.postMessage(Object.assign({ channel: "dashboard" }, msg), "*"); } catch (e) {}
  }
  /* What an error SAYS, not only where it was.  Firefox's stack for a
     SyntaxError carries the frames and not the message, so reporting the stack
     alone turns "unexpected token" into three line numbers and nothing else.
     Chromium's stack already begins with the name and message, hence the
     test before prefixing. */
  function describe(e) {
    if (!e) return String(e);
    if (typeof e === "string") return e;
    var head = (e.name || "Error") + (e.message ? ": " + e.message : "");
    var stack = e.stack ? String(e.stack) : "";
    if (!stack) return head;
    return stack.indexOf(head) === 0 ? stack : head + "\n" + stack;
  }

  function fail(where, e) {
    var text = describe(e);
    post({ type: "error", where: where, error: text });
    (listeners.error || []).forEach(function (f) { try { f({ where: where, error: text }); } catch (x) {} });
  }

  /* An unhandled rejection is an error the page never sees: nothing throws on
     the stack and the region simply stays as it was.  Reported like any
     other, which is what makes it repairable (§11). */
  window.addEventListener("unhandledrejection", function (e) {
    fail("promise", (e && e.reason) || "an async operation failed with no reason given");
  });

  /* --- notations, read as tables ---------------------------------------- */

  function parseSeparated(text, sep) {
    var rows = [], row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"' && sep === ",") quoted = true;
      else if (c === sep) { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || "").length; });
  }

  function asTable(payload) {
    var text = payload && payload.text != null ? String(payload.text) : "";
    var mt = (payload && payload.mimeType) || "";
    if (/json/.test(mt) || /^\s*[{[]/.test(text)) {
      try {
        var json = JSON.parse(text);
        if (json && typeof json.boolean === "boolean") {
          return { names: ["value"], rows: [[String(json.boolean)]] };
        }
        var b = json && json.results && json.results.bindings;
        if (Array.isArray(b)) {
          var names = (json.head && json.head.vars) || Object.keys(b[0] || {});
          return { names: names, rows: b.map(function (r) {
            return names.map(function (n) { return r[n] ? String(r[n].value) : ""; }); }) };
        }
      } catch (e) { /* fall through to separated values */ }
    }
    var sep = /csv/.test(mt) ? "," : "\t";
    var t = parseSeparated(text, sep);
    if (!t.length) return { names: [], rows: [] };
    return { names: t[0].map(function (n) { return n.replace(/^\?/, ""); }), rows: t.slice(1) };
  }

  /** A row as an object, which is what a transform usually wants. */
  function objects(table) {
    return table.rows.map(function (r) {
      var o = {};
      table.names.forEach(function (n, i) { o[n] = r[i]; });
      return o;
    });
  }

  /* --- default drawing --------------------------------------------------- */

  function tableElement(table, limit) {
    var t = document.createElement("table");
    t.className = "dash-table";
    var thead = document.createElement("thead"), tr = document.createElement("tr");
    table.names.forEach(function (n) {
      var th = document.createElement("th"); th.textContent = n; tr.appendChild(th); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = document.createElement("tbody");
    table.rows.slice(0, limit || 200).forEach(function (r) {
      var row = document.createElement("tr");
      r.forEach(function (c) {
        var td = document.createElement("td");
        td.textContent = c;
        if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(c)) td.className = "num";
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    if (table.rows.length > (limit || 200)) {
      var cap = document.createElement("caption");
      cap.textContent = table.rows.length + " rows, first " + (limit || 200) + " shown";
      t.appendChild(cap);
    }
    return t;
  }

  /* A component in the slot takes the value instead of being drawn over.
     The model writes <section data-bound="sales"><dydra-table></dydra-table>
     </section>, and without this the default drawing would replace the
     component it just declared -- which is the one failure that would make
     the whole toolbox look broken. */
  function componentIn(el) {
    if (el.hasAttribute && el.hasAttribute("data-accepts") && typeof el.setData === "function") return el;
    var found = el.querySelector ? el.querySelector("[data-accepts]") : null;
    return found && typeof found.setData === "function" ? found : null;
  }

  function draw(el, value) {
    var target = componentIn(el);
    if (target) { target.setData(value); return; }
    if (value == null) { el.textContent = ""; return; }
    if (value instanceof Node) { el.replaceChildren(value); return; }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      el.textContent = String(value); return;
    }
    if (value && Array.isArray(value.rows) && Array.isArray(value.names)) {
      el.replaceChildren(tableElement(value)); return;
    }
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object" && !Array.isArray(value[0])) {
        var names = Object.keys(value[0]);
        el.replaceChildren(tableElement({ names: names,
          rows: value.map(function (o) { return names.map(function (n) { return String(o[n] == null ? "" : o[n]); }); }) }));
        return;
      }
      el.replaceChildren(tableElement({ names: ["value"], rows: value.map(function (v) { return [String(v)]; }) }));
      return;
    }
    var pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    el.replaceChildren(pre);
  }

  /* --- provenance, which the page cannot opt out of (D-S) ---------------- */

  function mark(el, kind, label, detail) {
    el.setAttribute("data-provenance", kind);
    var tag = el.querySelector(":scope > .dash-prov");
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "dash-prov";
      el.appendChild(tag);
    }
    tag.textContent = label;
    tag.title = detail || label;
    return tag;
  }

  /* --- a region that was taken over and drew nothing ---------------------- */

  var SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * Why a slot the page promised to draw is blank, in one sentence.
   *
   * A renderer that throws is already reported.  This is the other failure,
   * and the one nobody notices: the renderer runs to the end, the legend and
   * the caption around it are right, and the figure is not there.  The
   * reader is then looking at a page that says "the bar chart is drawn over
   * the derived slot" above an empty space, with nothing anywhere saying
   * otherwise -- so the page says it here.
   *
   * The first case is a certainty rather than a guess.  createElement("svg")
   * makes an HTML element called "svg": it goes into the document, it has
   * children, querySelector("svg") finds it, and it will never draw,
   * because only the SVG namespace is drawn.  It is the commonest way to
   * write a figure that does not appear, and it is invisible in the source.
   *
   * The second is the arithmetic: one Math.log10(0) is -Infinity, and
   * every coordinate computed from it is NaN.  A NaN geometry attribute
   * is not an error, it is a shape the browser declines to paint.
   *
   * The third is the general one, and the only one that needs a measurement:
   * nothing in the region has a box.
   */
  function drewNothing(el) {
    var wrong = null;
    el.querySelectorAll("svg").forEach(function (g) {
      if (!wrong && g.namespaceURI !== SVG_NS) wrong = g;
    });
    if (wrong) {
      return "the <svg> here is an HTML element, not an SVG one, so nothing in it is drawn"
           + " \u2014 document.createElement(\"svg\") makes an HTML element of that name;"
           + " build it with document.createElementNS(\"" + SVG_NS + "\", \u2026) or assign"
           + " the markup with innerHTML";
    }
    var svg = el.querySelector("svg");
    if (svg) {
      var bad = null;
      svg.querySelectorAll("*").forEach(function (node) {
        if (bad) return;
        for (var i = 0; i < node.attributes.length; i++) {
          var a = node.attributes[i];
          if (/NaN|Infinity/.test(a.value)) { bad = node.nodeName + "@" + a.name + "=" + a.value; return; }
        }
      });
      if (bad) {
        return "a coordinate in the drawing is not a finite number (" + bad + "), so the shape"
             + " is not painted \u2014 a log of zero or a division by an empty extent is the"
             + " usual cause";
      }
    }
    var seen = false;
    el.childNodes.forEach(function (node) {
      if (seen) return;
      if (node.nodeType === 3) { if (node.textContent.trim()) seen = true; return; }
      if (node.nodeType !== 1) return;
      if (node.classList && (node.classList.contains("dash-prov")
                             || node.classList.contains("dash-stale")
                             || node.classList.contains("dash-blank"))) return;
      var box = node.getBoundingClientRect();
      if (box.width > 0.5 && box.height > 0.5) seen = true;
      else if (node.textContent && node.textContent.trim()) seen = true;
    });
    return seen ? null : "it drew nothing";
  }

  /** Say it in the page, where the blank space is, as well as out of it. */
  function sayBlank(el, name, why) {
    el.setAttribute("data-failed", "true");
    var note = el.querySelector(":scope > .dash-blank");
    if (!note) {
      note = document.createElement("div");
      note.className = "dash-blank";
      el.insertBefore(note, el.firstChild);
    }
    note.textContent = "The figure for " + name + " did not draw: " + why;
    fail("render:" + name, why);
  }

  /**
   * Check, once, after the drawing has had a chance to happen.
   *
   * Only slots the page took over with render are checked: those are the
   * ones where it undertook to put something there.  A slot left to the
   * interface either has its table or already says why it has not.  The
   * delay is for a renderer that draws from a promise; a hidden view is
   * skipped, where a box of zero is the truth and not a fault.
   */
  var blankCheck = null;
  function checkDrawn() {
    Object.keys(renderers).forEach(function (name) {
      document.querySelectorAll('[data-bound="' + name + '"], [data-derived="' + name + '"]')
        .forEach(function (el) {
          if (el.hasAttribute("data-failed") && !el.querySelector(":scope > .dash-blank")) return;
          if (!el.getClientRects().length && !el.offsetParent) return;   /* in a hidden view */
          var why = drewNothing(el);
          var note = el.querySelector(":scope > .dash-blank");
          if (why) sayBlank(el, name, why);
          else if (note) { note.remove(); el.removeAttribute("data-failed"); }
        });
    });
    size();
  }

  /* --- the fill ----------------------------------------------------------- */

  function fill() {
    var spec = state.spec || { panels: [], transforms: [], assertions: [] };

    /* bound: the pane's own run of a named view */
    (spec.panels || []).forEach(function (p) {
      var payload = state.results[p.name];
      document.querySelectorAll('[data-bound="' + p.name + '"]').forEach(function (el) {
        try {
          var table = payload && payload.ok ? asTable(payload) : null;
          var value = table ? { names: table.names, rows: table.rows } : null;
          if (renderers[p.name]) {
            renderers[p.name](el, { table: table, objects: table ? objects(table) : [],
                                    payload: payload, panel: p });
          } else if (!payload) {
            el.textContent = "waiting for " + p.name + "…";
          } else if (!payload.ok) {
            el.textContent = "panel " + p.name + " did not run: " + (payload.error || "unknown");
            el.setAttribute("data-failed", "true");
          } else {
            draw(el, value);
          }
          mark(el, "bound", "view " + p.name,
               "run by the interface from the catalogue view " + p.name
             + (payload && payload.digest ? " · digest " + payload.digest.slice(0, 12) : ""));
        } catch (e) { fail("bound:" + p.name, e); }
      });
    });

    /* derived: the model's own computation, re-run on this data (D-P) */
    (spec.transforms || []).forEach(function (t) {
      var inputs = {};
      (t.inputs || []).forEach(function (name) {
        if (state.results[name]) {
          var tb = asTable(state.results[name]);
          inputs[name] = { names: tb.names, rows: tb.rows, objects: objects(tb),
                           digest: state.results[name].digest, ok: state.results[name].ok };
        } else if (name in state.derived) {
          inputs[name] = state.derived[name];
        }
      });
      var value, broke = null;
      try {
        value = (new Function("inputs", "api", t.body))(inputs, API);
      } catch (e) {
        value = null;
        broke = describe(e);
        fail("transform:" + t.name, e);
      }
      state.derived[t.name] = value;
      document.querySelectorAll('[data-derived="' + t.name + '"]').forEach(function (el) {
        try {
          /* A transform that threw leaves its slot empty, which reads as a
             page with nothing to say there.  It says so instead -- the same
             way a panel that did not run does. */
          el.toggleAttribute("data-failed", Boolean(broke));
          if (broke) el.textContent = "transform " + t.name + " did not run: " + broke.split("\n")[0];
          else if (renderers[t.name]) renderers[t.name](el, { value: value, inputs: inputs, transform: t });
          else draw(el, value);
          mark(el, "derived", "computed · " + t.name,
               "computed by the model from " + ((t.inputs || []).join(", ") || "nothing")
             + ", re-run here against the data above");
        } catch (e) { fail("derived:" + t.name, e); }
      });
    });

    /* asserted: what only the model can say, and what it was written from */
    var staleIds = {};
    (state.stale || []).forEach(function (s) { staleIds[s.id] = s; });
    (spec.assertions || []).forEach(function (a) {
      document.querySelectorAll('[data-asserted="' + a.id + '"]').forEach(function (el) {
        try {
          /* textContent alone is not emptiness.  A slot holding a drawing
             whose SVG has no <text> in it reads as empty here, and assigning
             the assertion's text would then delete the picture. */
          if (!el.textContent.trim() && !el.firstElementChild && a.text) el.textContent = a.text;
          var cited = (a.inputs || []).join(", ");
          /* Prose or a picture.  The two are the same class of content -- the
             model made them and the interface cannot re-derive either -- but
             they are not the same sentence, and "written" over a bar chart is
             the wrong word for what the reader is looking at. */
          var drawn = el.querySelector("svg, canvas, dydra-bar-chart, dydra-line-chart, dydra-graph");
          var verb = drawn ? "drawn" : "written";
          /*
           * The attribution is the LEDGER's, not the document's.
           *
           * This used to be read out of the answer: it said what the model
           * had declared in inputs, and -- when the model had declared
           * nothing -- a sentence about where the content had not come from.
           * Both are the interface asking the model a question it had
           * already answered itself.  Every row the model saw went out
           * through this side, carried on an event with its repository and
           * its digest on it, and state.evidence is that record.  So the
           * mark names what the interface SHOWED the model, which it knows
           * exactly, instead of what the model says it used, which it can
           * only be told.
           *
           * It does not claim this region used all of it.  Nothing can know
           * that.  An over-broad true statement is the right trade here: a
           * reader who wants the narrow one has the whole ledger in the
           * title, in the order it was read.
           *
           * inputs keeps its own job -- which panels the sentence was
           * written against, so the page can mark it when they move -- and
           * is reported as the narrowing it is.
           */
          var ev = state.evidence || null;
          var read = ev && ev.repositories ? ev.repositories.join(", ") : "";
          var what = drawn ? "A figure the model drew" : "Prose the model wrote";
          var watched = a.inputs && a.inputs.length
            ? " The document names " + cited + " as what it was written against, which is "
            + "what the staleness check watches."
            : " The document names no panel for it, so it is not marked when the data moves.";
          if (ev && ev.known) {
            mark(el, "asserted",
                 read ? verb + " by the model from " + read
                      : verb + " by the model · nothing was read from the store",
                 what + ", over what the interface fetched and showed it. " + ev.detail + watched);
          } else {
            /* No ledger: an archived page reopened, or a page mounted by
               something that holds no record of the run.  Saying "nothing
               was read" here would be the old over-claim with the sign
               flipped, so it says it has no record. */
            mark(el, "asserted",
                 a.inputs && a.inputs.length ? verb + " by the model from " + cited
                                             : verb + " by the model · no source declared",
                 what + ". " + (ev ? ev.detail
                                   : "No record of what the model was shown is held with this "
                                   + "page.") + watched);
          }
          var s = staleIds[a.id];
          el.toggleAttribute("data-stale", Boolean(s));
          var warn = el.querySelector(":scope > .dash-stale");
          if (s && !warn) {
            warn = document.createElement("div");
            warn.className = "dash-stale";
            warn.textContent = "The data behind this changed (" + s.moved.join(", ")
                             + "). The sentence was not rewritten.";
            el.insertBefore(warn, el.firstChild);
          } else if (!s && warn) { warn.remove(); }
        } catch (e) { fail("asserted:" + a.id, e); }
      });
    });

    (listeners.data || []).forEach(function (f) {
      try { f({ results: state.results, derived: state.derived, stale: state.stale }); }
      catch (e) { fail("ondata", e); }
    });

    /* A redraw replaces elements, and a replaced element has no title.  Put
       them back here rather than waiting for the next message from the
       parent, which may never come. */
    applyTips();

    /* After the drawing, not during it: a renderer may still be waiting on a
       promise, and a region measured mid-render is not yet empty. */
    if (blankCheck) clearTimeout(blankCheck);
    blankCheck = setTimeout(checkDrawn, 250);

    var foot = document.getElementById("dash-footer-at");
    if (foot && state.at) foot.textContent = state.at;
    var fread = document.getElementById("dash-footer-read");
    if (fread) {
      var e2 = state.evidence;
      fread.textContent = e2 && e2.known && e2.repositories && e2.repositories.length
        ? " Read from " + e2.repositories.join(", ") + "."
        : "";
    }
    size();
  }

  /*
   * How tall the CONTENT is -- which is not what scrollHeight answers.
   *
   * documentElement is the scrolling box, so its scrollHeight is never less
   * than the viewport: measure it, and the answer includes the height the
   * frame was given, not only the height the page needs.  The embedder then
   * sets the frame to that plus its margin, the viewport grows by the
   * margin, the ResizeObserver fires, and the next measurement is larger by
   * the same amount.  A page with two rows in it climbed to the pane ceiling
   * at about 480 pixels a second, which the reader sees as a table that
   * keeps adding blank space under itself and never stops.
   *
   * The body's own box does not know the viewport, so it is a fixed point:
   * the embedder sets a height, the content does not change, the next
   * measurement is the same number, and the loop closes.
   */
  var lastSize = -1;
  function size() {
    var body = document.body, root = document.documentElement;
    var h = Math.max(body ? body.scrollHeight : 0,
                     body ? body.offsetHeight : 0,
                     root ? root.offsetHeight : 0);
    if (h === lastSize) return;
    lastSize = h;
    post({ type: "size", height: h });
  }

  /* --- views: regions of one document, shown one at a time (D-AC) -------- */

  function viewElements() {
    return Array.prototype.slice.call(document.querySelectorAll(".dash-view"));
  }

  function viewNamed(name) {
    var all = viewElements();
    if (name == null) return all.length === 1 ? all[0] : null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute("data-view-name") === name) return all[i];
    }
    return null;
  }

  function showView(name, announce) {
    var all = viewElements();
    if (!all.length) return false;
    var found = null;
    all.forEach(function (el) {
      var mine = el.getAttribute("data-view-name") === name;
      if (mine) found = el;
      el.hidden = !mine;
    });
    if (!found) return false;
    state.view = name;
    document.documentElement.setAttribute("data-view", name);
    if (announce !== false) post({ type: "state", key: "view", value: name });
    (listeners.view || []).forEach(function (f) { try { f({ view: name }); } catch (e) {} });
    size();
    return true;
  }

  /* A link marked 'data-view' navigates inside the page.  Not a URL: the
     frame has an opaque origin, and a href that reloaded the document would
     lose every result posted into it. */
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-view]") : null;
    if (!el || el === document.documentElement) return;
    var name = el.getAttribute("data-view");
    if (!name) return;
    e.preventDefault();
    showView(name, true);
  });

  /* --- applying a patch in place (§6.2.1) -------------------------------- */

  function parseFragment(html) {
    var t = document.createElement("template");
    t.innerHTML = String(html == null ? "" : html);
    return t.content;
  }

  /**
   * Apply what can be applied; report what cannot.
   *
   * The document in here is not the authority -- the one the pane holds is.
   * So an operation this runtime does not know how to perform is NOT an
   * error: it is a request for a rebuild, which the pane can satisfy exactly.
   * Guessing would be the error.
   */
  /**
   * Element instructions, carried out by the applier inlined above.
   *
   * The same function the main document runs (dom-patch.js), delivered as
   * text because nothing in here can import.  The instructions were worked
   * out where the before and after trees both are; in here there is only a
   * DOM to change.
   */
  /**
   * Apply each instruction inside the view it is for, and count what moved.
   *
   * An instruction carries its view (see elementInstructions, below the
   * runtime).  Grouping by it is what stops a root-level insert destined for
   * one view from landing in whichever view happens to be on screen -- the
   * applier resolves a null parent to the root it is given, so one root for
   * every view was not a near miss, it was the wrong answer that could not
   * fault.
   *
   * The counts are reported because "applied" and "something changed" are
   * not the same claim, and the pane was making the second one out of the
   * first: a patch whose every instruction landed in a view that is not
   * showing is applied, in place, and invisible.
   */
  function applyInstructionList(instructions) {
    lastTouched = null;
    if (!instructions || !instructions.length) return [];
    if (!window.DydraDomPatch) return instructions.slice();
    var groups = {}, order = [];
    for (var i = 0; i < instructions.length; i += 1) {
      var key = instructions[i].view == null ? "" : String(instructions[i].view);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(instructions[i]);
    }
    var unapplied = [];
    var touched = {};
    for (var g = 0; g < order.length; g += 1) {
      var name = order[g];
      // No view named: the old behaviour, which is right for the one case it
      // was ever right for -- a document of a single view.
      var host = name === "" ? (viewNamed(state.view) || document.body) : viewNamed(name);
      if (!host) {
        // A view this runtime has not got.  Not an error: a rebuild is the
        // answer, and the pane can give it exactly.
        for (var u = 0; u < groups[name].length; u += 1) {
          unapplied.push({ op: "instruction", element: groups[name][u].name,
                           reason: "view " + name + " is not in the page" });
        }
        continue;
      }
      var done = window.DydraDomPatch(groups[name], host, {});
      var where = name === "" ? (state.view || "") : name;
      touched[where] = (touched[where] || 0)
        + (done.added || []).length + (done.removed || []).length
        + (done.moved || []).length + (done.changed || []).length;
      unapplied = unapplied.concat((done.faults || []).map(function (f) {
        return { op: "instruction", element: f.name, reason: f.reason };
      }));
    }
    lastTouched = touched;
    return unapplied;
  }

  function applyOps(ops) {
    var unapplied = [];
    (ops || []).forEach(function (op) {
      var kind = op && op.op;
      try {
        if (kind === "set-slot") {
          var host = op.view ? viewNamed(op.view) : null;
          var el = (host || document).querySelector('[id="' + String(op.id).replace(/"/g, '\\"') + '"]');
          if (!el) { unapplied.push(op); return; }
          el.replaceWith(parseFragment(op.html));
        } else if (kind === "append-slot") {
          var into = op.id ? document.getElementById(op.id)
                           : (viewNamed(op.view) || viewNamed(state.view));
          if (!into) { unapplied.push(op); return; }
          into.appendChild(parseFragment(op.html));
        } else if (kind === "set-view") {
          var v = viewNamed(op.name);
          if (!v) { unapplied.push(op); return; }       // a view that is new needs a rebuild
          var value = op.value || {};
          v.replaceChildren(parseFragment(value.html == null ? op.html : value.html));
        } else if (kind === "remove-view") {
          var gone = viewNamed(op.name);
          if (!gone) { unapplied.push(op); return; }
          var wasShown = state.view === op.name;
          gone.remove();
          var rest = viewElements();
          if (wasShown && rest.length) showView(rest[0].getAttribute("data-view-name"), false);
        } else if (kind === "set-styles") {
          var style = document.getElementById("dash-doc-style");
          if (!style) {
            style = document.createElement("style");
            style.id = "dash-doc-style";
            document.head.appendChild(style);
          }
          style.textContent = op.value == null ? "" : String(op.value);
        } else if (kind === "set-title") {
          document.title = String(op.value == null ? "" : op.value);
        } else if (kind === "set-panel" || kind === "remove-panel"
                || kind === "set-transform" || kind === "remove-transform"
                || kind === "set-assertion" || kind === "remove-assertion"
                || kind === "set-parameter" || kind === "remove-parameter"
                || kind === "set-state") {
          /* Nothing in the DOM to change: the new spec arrives with the patch
             and the fill below redraws from it. */
        } else {
          unapplied.push(op);
        }
      } catch (e) {
        unapplied.push(op);
        fail("patch:" + (kind || "?"), e);
      }
    });
    return unapplied;
  }

  /* --- the API the model's own script may use ---------------------------- */

  function announceBudget(budget) {
    state.budget = budget || null;
    (listeners.budget || []).forEach(function (f) {
      try { f(state.budget); } catch (e) {}
    });
  }

  function refusalBanner(text) {
    var bar = document.getElementById("dash-refusal");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "dash-refusal";
      bar.className = "dash-refusal";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.textContent = text;
    bar.hidden = false;
    size();
  }

  var API = {
    get results() { return state.results; },
    get derived() { return state.derived; },
    get parameters() { return Object.assign({}, state.parameters); },
    /* What asking again costs, so a control can be honest about being spent
       rather than offering a choice that will be refused.  Read-only, and
       deliberately not the budget object: a page that could renew its own
       budget would make the pane's button a decoration. */
    get budget() { return state.budget ? Object.assign({}, state.budget) : null; },
    get view() { return state.view; },
    get views() {
      return viewElements().map(function (el) { return el.getAttribute("data-view-name"); });
    },
    table: function (name) {
      var p = state.results[name];
      return p ? asTable(p) : null;
    },
    objects: function (name) {
      var t = API.table(name);
      return t ? objects(t) : [];
    },
    render: function (name, fn) { renderers[name] = fn; if (state.at) fill(); },
    on: function (what, fn) { (listeners[what] || (listeners[what] = [])).push(fn); },
    refresh: function () { post({ type: "refresh" }); },
    resize: size,
    setView: function (name) { return showView(name, true); },
    /**
     * Ask the interface to run one DECLARED panel, with values for its
     * declared parameters.  Never a query: there is no way to send query text
     * from here, and a model that does not know that writes 'fetch' and gets
     * silence.
     *
     * A promise, so a page need not correlate its own request with the next
     * 'data' event -- the thing every interactive page would otherwise
     * re-implement, and most would get wrong for the second concurrent
     * request.
     */
    run: function (panel, parameters) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject, panel: panel };
        if (state.standalone) { replayFromIsland(id, panel, parameters || {}); return; }
        post({ type: "run", id: id, panel: panel, parameters: parameters || {} });
      });
    },
    /**
     * The declaration of one parameter: its kind, its datatype, its domain.
     *
     * A control has to render the domain it edits -- the members of an
     * enumeration, the ends of a range -- and the alternative to handing it
     * the declaration is each control carrying its own copy of the domain in
     * an attribute, which is a second place for it to be wrong.
     */
    parameter: function (name) {
      var declared = (state.spec && state.spec.parameters) || [];
      for (var i = 0; i < declared.length; i += 1) {
        if (declared[i] && declared[i].name === name) {
          return JSON.parse(JSON.stringify(declared[i]));
        }
      }
      return null;
    },
    /**
     * Set one declared parameter, and re-run whatever depends on it.
     *
     * The difference from 'run' is which panels: 'run' names one, and this
     * names none, because the DOCUMENT already says which panels declare the
     * parameter.  A control that had to name the panel would be a second
     * place for that to be written down and a chance to write it wrongly --
     * and there is no answer a control could give for a parameter two panels
     * share.
     */
    set: function (name, value) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject, panel: null };
        if (state.standalone) {
          var values = {}; values[name] = value;
          replayFromIsland(id, null, values);
          return;
        }
        post({ type: "set", id: id, parameter: String(name), value: value });
      });
    },
    state: {
      get: function (key) { return state.app ? state.app[key] : undefined; },
      set: function (key, value) {
        state.app = state.app || {};
        state.app[key] = value;
        post({ type: "state", key: String(key), value: value });
        return value;
      },
      all: function () { return Object.assign({}, state.app); }
    },
    /**
     * Lay a graph out.
     *
     * The frame cannot run an engine -- it has no network and its own thread
     * is the page's -- so the DOT goes out, the pane runs the vendored
     * graphviz in the engine frame beside this one, and the SVG comes back
     * (§8.4).  A saved copy has no pane, so this rejects there, and the
     * component says so rather than showing an empty box.
     */
    layout: function (dot, engine) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        if (state.standalone) {
          reject(new Error("a saved copy has no layout engine behind it"));
          return;
        }
        pending[id] = { resolve: resolve, reject: reject, panel: null };
        post({ type: "layout", id: id, dot: String(dot || ""), engine: engine || "dot" });
      });
    },
    /** Ask for something the page may not do.  It surfaces as a gate, never as an action. */
    propose: function (what, detail) {
      post({ type: "propose", what: String(what), detail: detail || null });
    }
  };
  window.dashboard = API;

  /* --- a saved copy has no interface behind it (§7.4) -------------------- */

  function replayFromIsland(id, panel, parameters) {
    var held = state.island && state.island.parameters;
    var key = JSON.stringify([panel, parameters || {}]);
    var found = held && Object.prototype.hasOwnProperty.call(held, key) ? held[key] : null;
    var p = pending[id];
    delete pending[id];
    if (found) {
      Object.keys(found).forEach(function (n) { state.results[n] = found[n]; });
      state.parameters = Object.assign({}, state.parameters, parameters);
      fill();
      if (p) p.resolve({ panel: panel, parameters: parameters, replayed: true });
      return;
    }
    var why = "this copy holds the data as of " + (state.at || "the time it was saved")
            + "; re-open it in Dydra to ask again";
    refusalBanner(why);
    (listeners.refused || []).forEach(function (f) {
      try { f({ request: { panel: panel, parameters: parameters }, reason: why }); } catch (e) {}
    });
    if (p) p.reject(new Error(why));
  }

  /* ── the identifiers, while an operation is being composed (U-104) ──────
     An arrangement verb names an element by its anchor, and until this the
     anchors were in the data-ui attribute and nowhere a reader could see.

     The page is a sandbox: it cannot import the module that decides what an
     element is called or whether the verb being typed could take it, and a
     second copy of those rules in here would be a second thing to be wrong.
     So the parent resolves both and sends the ANSWERS -- a badge and a yes
     or no, per element -- and this draws them.  What it sends back is a
     name.  Never a judgement, and never anything the page composed: the
     parent looks the name up in the table it sent. */

  var anchors = { wants: null, marks: null, over: null, badge: null, swallow: false,
                  tips: null };

  /* The standing answer, as the browser's own tooltip.

     The badge below appears while an arrangement verb is being typed, which
     is the right moment for a pointer that changes what a press does -- and
     the wrong moment to learn what things are called, because by then the
     line is half written.  A title attribute says it at any moment and costs
     nothing until someone dwells.

     The text is the parent's, whole.  What is added here is read off the
     element's own binding attributes, which the fill above already reads:
     that is a fact about the DOM, not a rule about addressing, and the rules
     stay out there where there is one copy of them. */
  function tipFor(el, text) {
    var shows = el.getAttribute("data-bound") ? "shows panel " + el.getAttribute("data-bound")
              : el.getAttribute("data-derived") ? "shows transform " + el.getAttribute("data-derived")
              : el.getAttribute("data-asserted") ? "holds passage " + el.getAttribute("data-asserted")
              : null;
    return shows && text.indexOf(shows) < 0 ? text + " — " + shows : text;
  }

  function applyTips() {
    if (!anchors.tips) return;
    var named = document.querySelectorAll("[data-ui]");
    for (var i = 0; i < named.length; i++) {
      var text = anchors.tips.elements[named[i].getAttribute("data-ui")];
      if (!text) continue;
      /* Never over a title the page wrote: that one is the author's and says
         something about the content.  Ours is marked, so re-applying after a
         redraw replaces our own and still leaves theirs alone. */
      if (named[i].hasAttribute("title") && !named[i].hasAttribute("data-ui-tip")) continue;
      named[i].setAttribute("title", tipFor(named[i], text));
      named[i].setAttribute("data-ui-tip", "");
    }
    var ids = Object.keys(anchors.tips.ids || {});
    for (var j = 0; j < ids.length; j++) {
      var el = document.getElementById(ids[j]);
      if (!el) continue;
      if (el.hasAttribute("title") && !el.hasAttribute("data-ui-tip")) continue;
      el.setAttribute("title", tipFor(el, anchors.tips.ids[ids[j]]));
      el.setAttribute("data-ui-tip", "");
    }
  }

  function anchorBadge() {
    if (!anchors.badge) {
      var b = document.createElement("div");
      b.className = "ui-anchor-badge";
      b.setAttribute("data-testid", "anchor-badge");
      b.hidden = true;
      document.body.appendChild(b);
      anchors.badge = b;
    }
    return anchors.badge;
  }

  /* The nearest element with an identity the parent told us about.  An
     element the table does not mention is not a named element of this
     document -- a region the runtime drew, a table a renderer built -- and
     is left entirely alone. */
  function anchorNamed(t) {
    var el = t && t.closest ? t.closest("[data-ui]") : null;
    if (!el || !anchors.marks) return null;
    return anchors.marks[el.getAttribute("data-ui")] ? el : null;
  }

  function anchorLeave() {
    if (anchors.over) anchors.over.removeAttribute("data-ui-hover");
    anchors.over = null;
    if (anchors.badge) anchors.badge.hidden = true;
  }

  function anchorEnter(el) {
    var name = el.getAttribute("data-ui");
    var mark = anchors.marks[name];
    anchors.over = el;
    el.setAttribute("data-ui-hover", mark.ok && anchors.wants === "element" ? "yes" : "no");
    var b = anchorBadge();
    b.textContent = mark.badge || name;
    b.setAttribute("data-ok", mark.ok ? "yes" : "no");
    b.hidden = false;
    var box = el.getBoundingClientRect();
    b.style.left = Math.max(0, Math.round(box.left + (window.scrollX || 0) + 8)) + "px";
    b.style.top = Math.max(0, Math.round(box.top + (window.scrollY || 0))) + "px";
    post({ type: "anchor", name: name });
  }

  /* Every element the verb could take, marked.  Recomputed when the parent
     says the expectation changed, which is not on every keystroke. */
  function markAnchors() {
    var lit = document.querySelectorAll("[data-ui-candidate]");
    for (var i = 0; i < lit.length; i++) lit[i].removeAttribute("data-ui-candidate");
    if (!anchors.marks || anchors.wants !== "element") return;
    var named = document.querySelectorAll("[data-ui]");
    for (var j = 0; j < named.length; j++) {
      var m = anchors.marks[named[j].getAttribute("data-ui")];
      if (m && m.ok) named[j].setAttribute("data-ui-candidate", "");
    }
  }

  document.addEventListener("mouseover", function (e) {
    if (!anchors.marks) return;
    var el = anchorNamed(e.target);
    if (!el || el === anchors.over) return;
    anchorLeave();
    anchorEnter(el);
  });

  document.addEventListener("mouseout", function (e) {
    if (!anchors.over) return;
    var to = e.relatedTarget;
    if (to && anchors.over.contains && anchors.over.contains(to)) return;
    anchorLeave();
  });

  /* A press on a candidate types its name out there.  Cancelled, and only
     where the line is waiting for an element: at every other moment the page
     must behave exactly as it does when nobody is composing anything. */
  document.addEventListener("mousedown", function (e) {
    anchors.swallow = false;
    if (!anchors.marks || anchors.wants !== "element") return;
    var el = anchorNamed(e.target);
    if (!el) return;
    var mark = anchors.marks[el.getAttribute("data-ui")];
    if (!mark || !mark.ok) return;
    e.preventDefault();
    e.stopPropagation();
    anchors.swallow = true;
    post({ type: "pick", name: el.getAttribute("data-ui") });
  }, true);

  /* Cancelling the press stops the focus moving; it does not stop the click,
     which would still reach whatever was under it -- a tab, a control, a
     link that redraws the page.  A press that types a name must not also do
     what the element does, so the one click behind a pick is taken too. */
  document.addEventListener("click", function (e) {
    if (!anchors.swallow) return;
    anchors.swallow = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener("scroll", function () { if (anchors.over) anchorLeave(); }, true);

  window.addEventListener("message", function (e) {
    // The parent is the only sender that matters and it is the only one that
    // can reach here: a sandboxed opaque-origin frame is not addressable by
    // anything but its embedder.  The shape is still checked, because a
    // malformed message should fail visibly rather than half-apply.
    var d = e.data;
    if (!d || d.channel !== "dashboard") return;
    if (d.type === "results") {
      // A partial posting carries only the panels that were re-run, so the
      // rest of the page keeps the data it has rather than blanking while one
      // selector is answered.
      state.results = d.partial ? Object.assign({}, state.results, d.results || {})
                                : (d.results || {});
      state.spec = d.spec || state.spec;
      state.stale = d.stale || state.stale || [];
      if (d.evidence) state.evidence = d.evidence;
      state.at = d.at || new Date().toISOString();
      if (d.parameters) state.parameters = Object.assign({}, state.parameters, d.parameters);
      if (d.state) state.app = Object.assign({}, state.app, d.state);
      if (d.budget !== undefined) announceBudget(d.budget);
      if (d.id && pending[d.id]) {
        var p = pending[d.id]; delete pending[d.id];
        try { p.resolve({ panel: p.panel, results: d.results }); } catch (x) {}
      }
      var bar = document.getElementById("dash-refusal");
      if (bar) bar.hidden = true;
      try { fill(); } catch (err) { fail("fill", err); }
    } else if (d.type === "patch") {
      /* The markup and the data it needs arrive together, deliberately.  A
         patch that adds a transform, applied before the results its inputs
         come from, fills once with those inputs missing -- the transform
         throws, the region is marked failed, and the error reaches the pane
         as a fault in a page that is about to be correct.  One message, one
         fill. */
      var unapplied = applyOps(d.ops);
      // The element operations arrive already resolved, as instructions: the
      // runtime would otherwise have to hold a copy of the tree to work out
      // what move-element meant, and the document out here is not the
      // authority.
      unapplied = unapplied.concat(applyInstructionList(d.instructions));
      if (d.spec) state.spec = d.spec;
      if (d.results) {
        state.results = d.partial ? Object.assign({}, state.results, d.results) : d.results;
      }
      if (d.stale) state.stale = d.stale;
      if (d.evidence) state.evidence = d.evidence;
      if (d.parameters) state.parameters = Object.assign({}, state.parameters, d.parameters);
      if (d.appState) state.app = Object.assign({}, state.app, d.appState);
      if (d.budget !== undefined) announceBudget(d.budget);
      if (d.at) state.at = d.at;
      if (!unapplied.length) { try { fill(); } catch (err2) { fail("fill", err2); } }
      post({ type: "patched", ok: unapplied.length === 0, unapplied: unapplied,
             // What actually moved, and where the reader is looking, so that
             // the pane can tell "applied" from "applied where you can see
             // it" instead of reporting the first as the second.
             touched: lastTouched, shown: state.view || null,
             ops: (d.ops || []).length,
             revision: d.revision == null ? null : d.revision });
    } else if (d.type === "laid-out") {
      if (d.id && pending[d.id]) {
        var g = pending[d.id]; delete pending[d.id];
        if (d.ok) { try { g.resolve(d.svg); } catch (x) {} }
        else { try { g.reject(new Error(d.error || "the graph could not be laid out")); } catch (x) {} }
      }
    } else if (d.type === "anchors") {
      anchors.wants = d.wants || null;
      anchors.marks = d.marks || null;
      /* Marks come and go with the line being typed; the tips do not.  A
         reader who stopped typing has not stopped wanting to know what
         things are called. */
      if (d.tips) { anchors.tips = d.tips; applyTips(); }
      anchorLeave();
      markAnchors();
    } else if (d.type === "view") {
      showView(d.name, false);
    } else if (d.type === "budget") {
      announceBudget(d.budget);
    } else if (d.type === "refused") {
      if (d.budget !== undefined) announceBudget(d.budget);
      var text = "that request was refused: " + (d.reason || "no reason given");
      refusalBanner(text);
      (listeners.refused || []).forEach(function (f) {
        try { f({ request: d.request, reason: d.reason }); } catch (x) {}
      });
      if (d.id && pending[d.id]) {
        var q = pending[d.id]; delete pending[d.id];
        try { q.reject(new Error(d.reason || "refused")); } catch (x) {}
      }
    }
  });

  window.addEventListener("error", function (e) { fail("page", e.error || e.message); });
  window.addEventListener("resize", size);
  if (window.ResizeObserver) { new ResizeObserver(size).observe(document.documentElement); }

  /* The view the document was built showing, before anything is posted: a
     page that opens on the wrong tab and corrects itself a moment later is
     worse than one that opens on the right one. */
  (function () {
    var all = viewElements();
    if (!all.length) return;
    var wanted = document.documentElement.getAttribute("data-view");
    showView(wanted && viewNamed(wanted) ? wanted : all[0].getAttribute("data-view-name"), false);
  })();

  window.__dashboardStandalone = function (data) {
    state.standalone = true;
    state.island = data;
    state.app = data.state || {};
    state.parameters = data.parameters0 || {};
    /* A downloaded page is where the mark matters most -- it is the copy
       that travels -- so the ledger is inlined with the data rather than
       left behind in the pane that posted it. */
    state.evidence = data.evidence || null;
  };

  post({ type: "ready" });
})();
`;

/* ── the page ─────────────────────────────────────────────────────────────── */

const BASE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 14px; background: #fff; color: #1a1d21;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
h1, h2, h3 { margin: 0 0 .4em; line-height: 1.25; }
h1 { font-size: 19px; } h2 { font-size: 15px; } h3 { font-size: 13px; }
table.dash-table { border-collapse: collapse; font-size: 12px; width: 100%; }
table.dash-table th, table.dash-table td {
  border-bottom: 1px solid #edf0f3; padding: 3px 8px 3px 0; text-align: left;
  vertical-align: top; }
table.dash-table th { color: #5b6672; font-weight: 600; white-space: nowrap; }
table.dash-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
table.dash-table caption { caption-side: bottom; color: #8a94a0; font-size: 11px;
  text-align: left; padding-top: 4px; }
/* The identifiers, while an operation is being composed out there (U-104).
   Drawn as an outline and a legend in the element's own top border: the
   element is not moved, nothing is inserted into it, and a page that is
   mid-interaction keeps every pixel it had. */
[data-ui-candidate] { outline: 1px dashed #9db7e8; outline-offset: 2px; }
[data-ui-hover="yes"] { outline: 2px solid #2563eb; outline-offset: 2px; }
[data-ui-hover="no"] { outline: 1px dotted #a4acb6; outline-offset: 2px; }
.ui-anchor-badge { position: absolute; z-index: 40; transform: translateY(-50%);
  padding: 0 5px; border-radius: 3px; font: 10px/1.5 ui-monospace, SFMono-Regular,
  Menlo, Consolas, monospace; letter-spacing: .02em; white-space: nowrap;
  pointer-events: none; background: #2563eb; color: #fff; }
.ui-anchor-badge[data-ok="no"] { background: #6b7280; }
[data-provenance] { position: relative; }
.dash-prov { margin-top: 4px; font-size: 10px; letter-spacing: .04em; color: #8a94a0;
  text-transform: uppercase; }
[data-provenance="asserted"] > .dash-prov { color: #9a6a2a; }
[data-provenance="asserted"] { border-left: 2px solid #e8d4b0; padding-left: 8px; }
[data-provenance="derived"] > .dash-prov { color: #3a6ea5; }
[data-stale] { background: #fffaf0; }
.dash-blank { font-size: 11px; color: #8a2b2b; background: #fbeaea;
  border: 1px solid #f0cccc; border-radius: 3px; padding: 4px 7px; margin-bottom: 5px; }
.dash-stale { font-size: 11px; color: #8a5a1a; background: #fdf3e0;
  border: 1px solid #f0dcb8; border-radius: 3px; padding: 3px 6px; margin-bottom: 5px; }
[data-failed] { color: #8a2b2b; }
.dash-refusal { font-size: 11.5px; color: #8a5a1a; background: #fdf3e0;
  border: 1px solid #f0dcb8; border-radius: 3px; padding: 4px 8px; margin-bottom: 8px; }
.dash-view[hidden] { display: none; }
a[data-view] { cursor: pointer; text-decoration: underline; }
.dash-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #edf0f3;
  font-size: 10.5px; color: #8a94a0; }
/* U-74.  A page somebody else wrote says so at the top, and says what of it
   is not running.  At the TOP and not in the footer: the footer is where a
   reader looks after reading, and this is a fact they need before. */
.dash-notice { font-size: 11.5px; color: #4a3a12; background: #fdf6e3;
  border: 1px solid #ece0bd; border-left: 3px solid #c9a227; border-radius: 3px;
  padding: 6px 9px; margin: 0 0 10px; }
.dash-withheld { font-size: 11.5px; color: #6b6257; background: #f6f5f2;
  border: 1px dashed #d8d4cc; border-radius: 3px; padding: 6px 9px; }
`;

/**
 * The components `uses' names, inlined (D-Y).
 *
 * Not a URL and not a build step: §2.2 forbids the frame loading anything, so
 * a component library is source that goes into the one srcdoc.  Only what the
 * document declares, plus what that declares, because inlining the whole
 * toolbox would put every component into every saved page -- which is how a
 * convenience becomes a tax.
 */
export function componentSources(doc, components) {
  const style = [], source = [], used = [];
  const seen = new Set();
  const add = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const c = components?.[name];
    if (!c) return;
    for (const dep of [].concat(c.needs?.components || [])) add(dep);
    if (c.style) style.push(`/* ${name} */\n${c.style}`);
    if (c.source) source.push(`/* ${name} */\n${c.source}`);
    used.push(name);
  };
  for (const n of [].concat(doc?.uses || [])) add(n);
  return { style: style.join("\n"), source: source.join("\n"), used };
}

/**
 * The whole document, ready to be a `srcdoc' or a saved file.
 *
 * The footer is not decoration and is not the model's to remove: a dashboard is
 * read as the repository's own output unless it says otherwise, and D-S puts
 * that statement in the artifact rather than only in the transcript, because
 * the artifact is the part that gets saved, mailed and shown to someone who
 * was not here.
 */
/** The operations whose effect reaches the runtime as instructions, not as ops. */
const ELEMENT_OPS = new Set(["insert-element", "set-attribute", "move-element",
                             "remove-element", "set-layout", "set-placement"]);

/**
 * What an element patch comes to, as instructions for the runtime.
 *
 * Computed from the two documents rather than from the operations: an
 * operation says what was asked for, and what has to reach the DOM is what
 * actually changed -- which is the same rule the classifier follows, and for
 * the same reason.  A patch that touches no view returns nothing and the
 * ordinary op path handles it alone.
 */
export function elementInstructions(before, after, ops) {
  if (!(ops || []).some((o) => ELEMENT_OPS.has(String(o?.op || "")))) return [];
  const was = new Map((before?.views || []).map((v) => [v.name, v.elements || []]));
  const out = [];
  for (const v of after?.views || []) {
    if (!v.elements) continue;
    const diff = diffTrees(was.get(v.name) || [], v.elements);
    if (diff.empty) continue;
    // WHICH VIEW, on every instruction.  The diff is taken over every view a
    // document has and the runtime holds one section per view, so an
    // instruction without a view is one the runtime has to guess at -- and
    // its guess was the view on screen.  An insert at the root of a view
    // that is not showing therefore landed in the view that was, silently,
    // and a revision reported as applied in place had put the thing
    // somewhere nobody asked for.  Carried per instruction rather than per
    // batch because one patch may touch two views.
    for (const ins of instructionsFor(diff, { components: COMPONENTS })) {
      out.push({ ...ins, view: v.name });
    }
  }
  return out;
}

export function buildPage(spec, { results = null, standalone = false, at = null,
                                  components = COMPONENTS, parameters = null,
                                  replay = null, notice = null, evidence = null } = {}) {
  const stamp = at || new Date().toISOString();
  const views = viewsOf(spec);
  const active = (spec.state && spec.state.view) || views[0]?.name || MAIN_VIEW;
  const parts = componentSources(spec, components);
  const island = standalone && results
    ? `<script type="application/json" id="dash-data">${
        JSON.stringify({ spec, results, at: stamp, evidence,
                         state: spec.state || {},
                         parameters0: parameters || {},
                         // Which parameter combinations this copy holds, so a
                         // control in a saved page can say "this copy has the
                         // data as of …" instead of appearing to hang (§7.4).
                         parameters: replay || {} }).replace(/</g, "\\u003c")}</script>`
    : "";
  const boot = standalone
    ? `<script>(function(){var el=document.getElementById("dash-data");if(!el)return;`
    + `var d=JSON.parse(el.textContent);`
    + `if(window.__dashboardStandalone)window.__dashboardStandalone(d);`
    + `window.postMessage(Object.assign({channel:"dashboard",type:"results"},`
    + `{results:d.results,spec:d.spec,at:d.at,state:d.state,parameters:d.parameters0,`
    + `evidence:d.evidence}),"*");})();</script>`
    : "";
  const body = views.map((v) =>
    `<section class="dash-view" data-view-name="${esc(v.name)}"`
    + `${v.name === active ? "" : " hidden"}>${v.html || ""}</section>`).join("\n");
  /**
   * The mark a shared page carries (U-74).
   *
   * Escaped, and built here rather than accepted as markup, because the one
   * thing it must not be is a way for the text it is warning about to get
   * into the page.  It sits before the views and outside them, so a view
   * switch cannot take it off the screen.
   */
  const mark = notice
    ? `<div class="dash-notice" data-notice="shared" role="note">${esc(notice)}</div>`
    : "";
  return `<!doctype html>
<html lang="en" data-view="${esc(active)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title || "Dashboard")}</title>
<style>${BASE_STYLE}</style>
${parts.style ? `<style id="dash-toolbox-style">${parts.style}</style>` : ""}
<style id="dash-doc-style">${spec.styles || ""}</style>
</head>
<body>
${mark}
${body}
<div class="dash-footer">
  Produced by a language model from ${spec.panels?.length || 0} repository
  ${(spec.panels?.length || 0) === 1 ? "query" : "queries"}${
    spec.assertions?.length ? `, with ${spec.assertions.length} passage(s) it wrote itself` : ""}.
  Bound regions are the interface's own runs; derived regions are recomputed here;
  asserted passages are the model's words. Rendered <span id="dash-footer-at">${esc(stamp)}</span>.<span id="dash-footer-read"></span>
</div>
${island}
<script>${DOM_PATCH_SOURCE}</script>
<script>${RUNTIME}</script>
${parts.source ? `<script>${parts.source}</script>` : ""}
${spec.script ? `<script>${spec.script}</script>` : ""}
${boot}
</body>
</html>`;
}

/* ── the downloaded copy ──────────────────────────────────────────────────── */

/**
 * The style of the one band the saved file adds.
 *
 * Deliberately plain and deliberately outside the page: it is the file's
 * chrome, not the document's, and a reader should be able to tell at a glance
 * which of the two they are looking at.
 */
const SAVED_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 10px; background: #f6f7f9; color: #1a1d21;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.saved-bar { background: #fff; border: 1px solid #e2e6ea; border-radius: 4px;
  padding: 7px 10px; margin-bottom: 8px; }
.saved-status { color: #5b6672; margin-right: 10px; }
.saved-actions button { font: inherit; font-size: 12px; margin-right: 6px;
  padding: 2px 8px; border: 1px solid #c8cfd6; border-radius: 3px; background: #fbfcfd;
  cursor: pointer; }
.saved-form { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.saved-form[hidden] { display: none; }
.saved-form label { display: block; font-size: 11px; color: #5b6672; }
.saved-form input { display: block; font: inherit; font-size: 12px; padding: 2px 5px;
  border: 1px solid #c8cfd6; border-radius: 3px; min-width: 150px; }
.saved-form button { font: inherit; font-size: 12px; padding: 3px 9px;
  border: 1px solid #c8cfd6; border-radius: 3px; background: #fbfcfd; cursor: pointer; }
.saved-note { flex-basis: 100%; margin: 0; font-size: 11px; color: #8a94a0; }
.saved-log { margin-top: 7px; font-size: 11.5px; color: #5b6672;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.saved-log[hidden] { display: none; }
.saved-err { color: #8a2b2b; }
.saved-frame { width: 100%; min-height: 240px; height: 240px; border: 1px solid #e2e6ea;
  border-radius: 4px; background: #fff; }
.saved-noscript { background: #fdf3e0; border: 1px solid #f0dcb8; border-radius: 3px;
  padding: 6px 9px; font-size: 12px; }
`;

/** One address as an origin, or null when it is not one this can name. */
function originOf(host) {
  const text = String(host || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    return u.origin === "null" ? null : u.origin;
  } catch { return null; }
}

/**
 * Where a saved copy may connect, and nowhere else.
 *
 * Every panel's own source, plus the repository the page was composed
 * against -- which is the list of places the reader's token was ever going to
 * go, written into the policy so that it is the browser enforcing the limit
 * and not this script's good intentions.
 */
export function savedOrigins(spec, source) {
  const out = [];
  const add = (host) => {
    const o = originOf(host);
    if (o && !out.includes(o)) out.push(o);
  };
  add(source?.host);
  for (const p of spec?.panels || []) add(p?.source?.host);
  return out;
}

/**
 * The policy the saved FILE runs under.
 *
 * It is not the page's policy.  The page keeps its own, declared in its own
 * document, and a srcdoc frame is enforced under the INTERSECTION of the two
 * -- so `connect-src' opening here cannot open it there, where the model's
 * script is.  `unsafe-eval' is granted because the frame inherits this policy
 * as well and the page's transforms are compiled functions; nothing that runs
 * at this level is model-written.
 */
export function savedPolicy(origins = []) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "frame-src 'self'",
    `connect-src ${origins.length ? origins.join(" ") : "'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Whether this tree can build a refreshable copy at all, and what is missing. */
export function savedPageIsRefreshable() {
  return (saved.missingSource?.() || []).length === 0;
}

/**
 * The one line a page that could not be made refreshable carries about it.
 *
 * It travels in the file as a comment, where it is still there tomorrow for
 * whoever is asked why their copy has no Refresh, and the pane lifts it back
 * out of the document it just built rather than asking the library a second
 * question -- which is also how it avoids importing one more name from a
 * module that may be a deploy behind it.
 */
export const NO_REFRESH = "dydra-saved: no refresh";

/** What a built page says about itself, or null when it is the full one. */
export function savedPageTrouble(html) {
  const m = new RegExp(`<!-- ${NO_REFRESH}: ([\\s\\S]*?) -->`).exec(String(html || ""));
  return m ? m[1] : null;
}

/**
 * The page as a file that can ask again (U-111).
 *
 * The data is inlined, so the file still draws with no network at all; the
 * queries are inlined, so a reader who supplies their own credentials can run
 * them again and watch the page redraw from what the store holds now.  Those
 * two are not in tension: the saved data is what the file opens with, and a
 * refresh replaces it.
 *
 * The file is two documents, for the reason `saved-runtime.js' sets out: the
 * page itself goes in the sandboxed frame it has always run in, and the
 * credential, the queries and the fetching stay outside it, where the model's
 * script cannot reach them.
 *
 * `source' is where the page was composed -- the host, account and repository
 * its panels were run against.  Without it the file still opens and still
 * replays what it holds; it simply has no address to offer the reader.
 */
export function buildSavedPage(spec, { results = null, parameters = null, replay = null,
                                       evidence = null, notice = null, stale = [],
                                       components = COMPONENTS, source = null,
                                       at = null } = {}) {
  const stamp = at || new Date().toISOString();
  /* A tree half-way through a deploy can have this module and an older one
     beside it, and then there is no runtime to put in the file.  A copy that
     replays is the thing to give the user at that point -- it is what they
     had yesterday -- rather than a download that fails. */
  let runtime;
  try { runtime = saved.savedRuntime(); }
  catch (e) {
    /* Why, and not just that: a copy without its Refresh looks exactly like
       a finished one, so the reason travels in the file and the pane says it
       aloud.  Anything thrown here means the same thing to the reader --
       this copy replays -- but not to whoever has to fix it. */
    const why = String(e?.message || e).replace(/-->/g, "-- >");
    /* And ask again, past the cache, so that "try the download once more"
       is advice that leads somewhere. */
    saved.repairMissingSource?.();
    const page = buildPage(spec, { results, standalone: true, components, replay, parameters,
                                   notice, evidence, at: stamp });
    return page.replace(/^<!doctype html>/i, `<!doctype html>\n<!-- ${NO_REFRESH}: ${why} -->`);
  }
  const page = buildPage(spec, { components, notice, at: stamp });
  const origins = savedOrigins(spec, source);
  /* A `</script>' inside the page would close the block carrying it, and the
     page is the one field here certain to contain markup. */
  const payload = JSON.stringify({
    page, spec, results: results || {}, parameters: parameters || {},
    state: spec?.state || {}, stale, at: stamp, evidence, replay, source,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(savedPolicy(origins))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title || "Dashboard")}</title>
<style>${SAVED_STYLE}</style>
</head>
<body>
<div class="saved-bar" id="saved-page-bar"></div>
<noscript><p class="saved-noscript">This page draws itself from the data saved in it, and
needs JavaScript to do so.</p></noscript>
<iframe id="saved-page-frame" class="saved-frame" title="${esc(spec.title || "Dashboard")}"></iframe>
<script type="application/json" id="saved-page-data">${payload}</script>
<script>${runtime}</script>
</body>
</html>`;
}

/* ── mounting ─────────────────────────────────────────────────────────────── */

/**
 * Put the page on the screen and keep the one channel to it open.
 *
 * Returns a handle: `post' sends results in, `update' applies a new revision,
 * `destroy' takes it down, `page' is the document text for a download.  The
 * caller owns the data and the document; this owns the frame.
 */
export function mountDashboard(container, spec, {
  onRefresh = null, onEvent = () => {}, onRun = null, onSet = null, onState = null, onPropose = null,
  onLayout = null,
  minHeight = 240, maxHeight = 4000, doc = null, components = COMPONENTS,
  notice = null,
} = {}) {
  const d = doc || container.ownerDocument || document;
  let current = spec;
  // U-74: the mark a shared page carries travels with the document, through
  // every rebuild and into the downloaded copy.  Held in the handle rather
  // than passed at each call, because a rebuild that dropped it would take
  // the warning off a page whose code is still withheld.
  let mark = notice;
  let page = buildPage(current, { components, notice: mark });
  const frame = d.createElement("iframe");
  frame.className = "dash-frame";
  frame.setAttribute("sandbox", SANDBOX);     // and never allow-same-origin
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", spec.title || "Dashboard");
  frame.style.cssText = `width:100%;border:1px solid #e2e6ea;border-radius:4px;`
                      + `background:#fff;min-height:${minHeight}px;height:${minHeight}px;`;
  frame.srcdoc = page;
  container.replaceChildren(frame);

  /* The margin the frame is given over its content, and the last height set
     from it: the pair the size loop turns on. */
  const PAD = 8;
  let lastHeight = minHeight;
  let ready = false;
  let pending = null;
  let lastPost = null;
  /* The standing answer about what the page's parts are called (U-104).
     Held, like `lastPost', because it is sent at the mount -- before the
     frame has loaded, so the message would otherwise be dropped -- and
     because a rebuild replaces the document the titles were written into. */
  let lastAnchors = null;
  // What the interface showed the model while this page was built, as the
  // frame will be told it (REQ-23.2.6).  Null means no record is held, which
  // is a different statement from an empty one and is marked differently.
  let ledger = null;
  const patches = [];

  const send = (msg) => {
    // An opaque origin has no name, so "*" is the only possible target.  The
    // frame is addressable by nobody else -- it is a srcdoc child of this
    // document -- so this does not widen anything.
    try { frame.contentWindow?.postMessage({ channel: "dashboard", ...msg }, "*"); } catch { /* gone */ }
  };

  const onMessage = (event) => {
    // Identity, not origin: a sandboxed frame's origin is the string "null",
    // which every other opaque context shares, so it distinguishes nothing.
    if (event.source !== frame.contentWindow) return;
    const m = event.data;
    if (!m || m.channel !== "dashboard") return;
    if (m.type === "ready") {
      ready = true;
      if (lastAnchors) send(lastAnchors);
      if (pending) { send(pending); pending = null; }
      onEvent({ type: "ready" });
    } else if (m.type === "size") {
      const h = Math.min(maxHeight, Math.max(minHeight, Math.ceil(Number(m.height) || 0) + PAD));
      /* A page whose own stylesheet ties its height to the viewport can
         still report back the height it was just given.  Growth of exactly
         the margin is that echo and not a page that needs more room; it is
         refused here, where the ratchet would otherwise turn.  Shrinking is
         always honoured, and real growth is never this small. */
      if (h > lastHeight && h - lastHeight <= PAD) return;
      lastHeight = h;
      frame.style.height = `${h}px`;
    } else if (m.type === "refresh") {
      onEvent({ type: "refresh" });
      if (onRefresh) onRefresh();
    } else if (m.type === "error") {
      onEvent({ type: "error", where: m.where, error: m.error });
    } else if (m.type === "run") {
      onEvent({ type: "run", panel: m.panel, parameters: m.parameters });
      if (onRun) onRun({ id: m.id, panel: m.panel, parameters: m.parameters || {} });
      else send({ type: "refused", id: m.id, request: { panel: m.panel },
                  reason: "this page is not connected to an interface that can run panels" });
    } else if (m.type === "set") {
      onEvent({ type: "set", parameter: m.parameter, value: m.value });
      if (onSet) onSet({ id: m.id, parameter: m.parameter, value: m.value });
      else send({ type: "refused", id: m.id, request: { parameter: m.parameter },
                  reason: "this page is not connected to an interface that can set parameters" });
    } else if (m.type === "state") {
      onEvent({ type: "state", key: m.key, value: m.value });
      if (onState) onState({ key: m.key, value: m.value });
    } else if (m.type === "layout") {
      onEvent({ type: "layout", engine: m.engine });
      if (onLayout) {
        Promise.resolve(onLayout({ dot: m.dot, engine: m.engine }))
          .then((r) => send({ type: "laid-out", id: m.id, ok: !!(r && r.ok), svg: r?.svg || null,
                              error: r?.error || null }))
          .catch((e) => send({ type: "laid-out", id: m.id, ok: false, error: String(e) }));
      } else {
        send({ type: "laid-out", id: m.id, ok: false,
               error: "no layout engine is available to this page" });
      }
    } else if (m.type === "anchor") {
      // A name, out of the table this document sent in.  Nothing the page
      // composed reaches the caller: an unknown name is dropped here.
      onEvent({ type: "anchor", name: m.name });
    } else if (m.type === "pick") {
      onEvent({ type: "pick", name: m.name });
    } else if (m.type === "propose") {
      onEvent({ type: "propose", what: m.what, detail: m.detail });
      if (onPropose) onPropose({ what: m.what, detail: m.detail });
    } else if (m.type === "patched") {
      const waiting = patches.shift();
      onEvent({ type: "patched", ok: m.ok, unapplied: m.unapplied || [],
                touched: m.touched || null, shown: m.shown || null });
      if (waiting) waiting(m);
    }
  };
  const view = d.defaultView || window;
  view.addEventListener("message", onMessage);

  const rebuild = () => {
    page = buildPage(current, { components, notice: mark });
    frame.srcdoc = page;
    ready = false;
    // The data the page already had, re-posted the moment the new document
    // says it is ready: a rebuild is more expensive than a patch, but it must
    // not be a blank page followed by a second round trip to the store.
    if (lastPost) pending = { ...lastPost, spec: current };
  };

  return {
    frame,
    get ready() { return ready; },
    get document() { return current; },
    /** Hand the page a set of results.  Queued until the runtime says ready. */
    post({ results, stale = [], at = null, partial = false, id = null, parameters = null,
           state = null, budget = undefined, evidence = undefined }) {
      // The ledger is held in the handle, not re-sent on every partial: one
      // selector being answered must not take the attribution off the page,
      // and a rebuild has to come back up with it.
      if (evidence !== undefined) ledger = evidence;
      const msg = { type: "results", results, spec: current, stale,
                    at: at || new Date().toISOString(), partial, id, parameters, state,
                    ...(ledger === null ? {} : { evidence: ledger }),
                    ...(budget === undefined ? {} : { budget }) };
      if (!partial) lastPost = msg;
      else if (lastPost) lastPost = { ...lastPost, results: { ...lastPost.results, ...results } };
      if (ready) send(msg); else pending = msg;
    },
    /** Tell the page a request it made will not be answered, and why. */
    refuse({ id = null, request = null, reason = "", budget = undefined }) {
      send({ type: "refused", id, request, reason,
             ...(budget === undefined ? {} : { budget }) });
    },
    /** The meter moved; the page may want to grey a control out. */
    budget(budget) { send({ type: "budget", budget }); },
    /**
     * Apply a new revision of the document.
     *
     * In place where the runtime can, which is the point of §6.2.1: a
     * presentational change must not cost the reader their scroll position,
     * their open tab and their selection.  A rebuild where it cannot, with
     * the data the page already had re-posted behind it.  Resolves to what
     * happened, so the caller can say which it was rather than guess.
     */
    async update(next, { ops = null, rebuild: force = false, post = null } = {}) {
      const previous = current;
      current = next;
      // Data that belongs with this revision is remembered before anything
      // is sent, so that a rebuild -- whether chosen here or forced by the
      // runtime -- comes back up holding it rather than blank.
      if (post) {
        if (post.evidence !== undefined) ledger = post.evidence;
        lastPost = { type: "results", results: post.results, spec: current,
                     stale: post.stale || [], at: post.at || new Date().toISOString(),
                     partial: false, parameters: post.parameters || null,
                     state: post.state || null,
                     ...(ledger === null ? {} : { evidence: ledger }) };
      }
      if (force || !ops || !ops.length || !ready) {
        rebuild();
        return { applied: "rebuild" };
      }
      // An element operation says what to do to a tree; the runtime holds a
      // DOM.  The translation needs both trees, and both are here, so it
      // happens here -- once, rather than by shipping the tree into the frame
      // and the diffing logic with it.
      const instructions = elementInstructions(previous, current, ops);
      const answer = await new Promise((resolve) => {
        patches.push(resolve);
        send({ type: "patch", ops: ops.filter((o) => !ELEMENT_OPS.has(String(o?.op || ""))),
               instructions,
               spec: current, revision: current.revision ?? null,
               results: post ? post.results : null, stale: post ? post.stale || [] : null,
               parameters: post ? post.parameters : null,
               appState: post ? post.state : null,
               ...(ledger === null ? {} : { evidence: ledger }),
               ...(post && post.budget !== undefined ? { budget: post.budget } : {}),
               at: post ? post.at || new Date().toISOString() : null });
        // A runtime that never answers must not wedge the pane: the rebuild
        // is always available and is never wrong, only more expensive.
        setTimeout(() => {
          const at = patches.indexOf(resolve);
          if (at >= 0) {
            patches.splice(at, 1);
            resolve({ ok: false, unapplied: ops, timedOut: true });
          }
        }, 4000);
      });
      if (answer.ok) {
        // `applied' and `anything changed' are two claims, and only the
        // second is what the reader is about to look for.  Both are
        // returned; the caller says which it got.
        const touched = answer.touched || null;
        const shown = answer.shown == null ? null : String(answer.shown);
        const here = touched && shown != null ? (touched[shown] || 0) : 0;
        const elsewhere = touched
          ? Object.entries(touched).reduce((n, [v, c]) => (v === shown ? n : n + c), 0)
          : 0;
        return { applied: "in-place", touched, shown, here, elsewhere,
                 views: touched ? Object.keys(touched).filter((v) => touched[v]) : [],
                 ops: answer.ops || 0 };
      }
      rebuild();
      return { applied: "rebuild", unapplied: answer.unapplied || [], timedOut: !!answer.timedOut };
    },
    /**
     * What this page's elements are called, resolved for the verb being
     * typed out here (U-104).
     *
     * `marks' is a badge and a yes-or-no per element and nothing else: the
     * sentences and the text that would be typed stay in the document that
     * sent them, so the page holds no rule it could apply differently.
     * Null puts everything back.
     */
    anchors({ wants = null, marks = null, tips = null } = {}) {
      const msg = { type: "anchors", wants, marks, tips };
      /* Only the standing half is replayed on a reload: a line being typed
         is a live thing and the bar says it again, but the names are true of
         the page whether or not anyone is composing anything. */
      if (tips) lastAnchors = { type: "anchors", wants: null, marks: null, tips };
      send(msg);
    },
    /** Drive navigation from out here: a back button, a deep link. */
    setView(name) { send({ type: "view", name }); },
    /**
     * The page as a file.
     *
     * Given `source' -- where the panels were run -- it is the two-document
     * form of U-111: data inlined so it still draws with no network, queries
     * inlined so the reader can run them again under their own credentials.
     * Without it, the older single-document copy, which draws and replays and
     * cannot ask again.
     */
    page(results, { replay = null, parameters = null, source = null, stale = [] } = {}) {
      if (source) {
        return buildSavedPage(current, { results, replay, parameters, source, stale,
                                         components, notice: mark, evidence: ledger });
      }
      return buildPage(current, { results, standalone: true, components, replay, parameters,
                                  notice: mark, evidence: ledger });
    },
    /** Change what the mark says — after an admission, or after a withdrawal. */
    setNotice(text) { mark = text || null; },
    digest() { return contentDigest(page); },
    destroy() {
      view.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}

export default mountDashboard;
