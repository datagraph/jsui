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
                budget: null };
  var renderers = {};
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
          if (!el.textContent.trim() && a.text) el.textContent = a.text;
          var cited = (a.inputs || []).join(", ");
          mark(el, "asserted",
               a.inputs && a.inputs.length ? "written by the model from " + cited
                                           : "written by the model — not from this repository",
               a.inputs && a.inputs.length
                 ? "prose, not a computed value; written against " + cited
                 : "outside knowledge: nothing in this repository supports or contradicts it");
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

    var foot = document.getElementById("dash-footer-at");
    if (foot && state.at) foot.textContent = state.at;
    size();
  }

  function size() {
    var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
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
      if (d.spec) state.spec = d.spec;
      if (d.results) {
        state.results = d.partial ? Object.assign({}, state.results, d.results) : d.results;
      }
      if (d.stale) state.stale = d.stale;
      if (d.parameters) state.parameters = Object.assign({}, state.parameters, d.parameters);
      if (d.appState) state.app = Object.assign({}, state.app, d.appState);
      if (d.budget !== undefined) announceBudget(d.budget);
      if (d.at) state.at = d.at;
      if (!unapplied.length) { try { fill(); } catch (err2) { fail("fill", err2); } }
      post({ type: "patched", ok: unapplied.length === 0, unapplied: unapplied,
             revision: d.revision == null ? null : d.revision });
    } else if (d.type === "laid-out") {
      if (d.id && pending[d.id]) {
        var g = pending[d.id]; delete pending[d.id];
        if (d.ok) { try { g.resolve(d.svg); } catch (x) {} }
        else { try { g.reject(new Error(d.error || "the graph could not be laid out")); } catch (x) {} }
      }
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
[data-provenance] { position: relative; }
.dash-prov { margin-top: 4px; font-size: 10px; letter-spacing: .04em; color: #8a94a0;
  text-transform: uppercase; }
[data-provenance="asserted"] > .dash-prov { color: #9a6a2a; }
[data-provenance="asserted"] { border-left: 2px solid #e8d4b0; padding-left: 8px; }
[data-provenance="derived"] > .dash-prov { color: #3a6ea5; }
[data-stale] { background: #fffaf0; }
.dash-stale { font-size: 11px; color: #8a5a1a; background: #fdf3e0;
  border: 1px solid #f0dcb8; border-radius: 3px; padding: 3px 6px; margin-bottom: 5px; }
[data-failed] { color: #8a2b2b; }
.dash-refusal { font-size: 11.5px; color: #8a5a1a; background: #fdf3e0;
  border: 1px solid #f0dcb8; border-radius: 3px; padding: 4px 8px; margin-bottom: 8px; }
.dash-view[hidden] { display: none; }
a[data-view] { cursor: pointer; text-decoration: underline; }
.dash-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #edf0f3;
  font-size: 10.5px; color: #8a94a0; }
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
export function buildPage(spec, { results = null, standalone = false, at = null,
                                  components = COMPONENTS, parameters = null,
                                  replay = null } = {}) {
  const stamp = at || new Date().toISOString();
  const views = viewsOf(spec);
  const active = (spec.state && spec.state.view) || views[0]?.name || MAIN_VIEW;
  const parts = componentSources(spec, components);
  const island = standalone && results
    ? `<script type="application/json" id="dash-data">${
        JSON.stringify({ spec, results, at: stamp,
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
    + `{results:d.results,spec:d.spec,at:d.at,state:d.state,parameters:d.parameters0}),"*");})();</script>`
    : "";
  const body = views.map((v) =>
    `<section class="dash-view" data-view-name="${esc(v.name)}"`
    + `${v.name === active ? "" : " hidden"}>${v.html || ""}</section>`).join("\n");
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
${body}
<div class="dash-footer">
  Produced by a language model from ${spec.panels?.length || 0} repository
  ${(spec.panels?.length || 0) === 1 ? "query" : "queries"}${
    spec.assertions?.length ? `, with ${spec.assertions.length} passage(s) it wrote itself` : ""}.
  Bound regions are the interface's own runs; derived regions are recomputed here;
  asserted passages are the model's words. Rendered <span id="dash-footer-at">${esc(stamp)}</span>.
</div>
${island}
<script>${RUNTIME}</script>
${parts.source ? `<script>${parts.source}</script>` : ""}
${spec.script ? `<script>${spec.script}</script>` : ""}
${boot}
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
  onRefresh = null, onEvent = () => {}, onRun = null, onState = null, onPropose = null,
  onLayout = null,
  minHeight = 240, maxHeight = 4000, doc = null, components = COMPONENTS,
} = {}) {
  const d = doc || container.ownerDocument || document;
  let current = spec;
  let page = buildPage(current, { components });
  const frame = d.createElement("iframe");
  frame.className = "dash-frame";
  frame.setAttribute("sandbox", SANDBOX);     // and never allow-same-origin
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", spec.title || "Dashboard");
  frame.style.cssText = `width:100%;border:1px solid #e2e6ea;border-radius:4px;`
                      + `background:#fff;min-height:${minHeight}px;height:${minHeight}px;`;
  frame.srcdoc = page;
  container.replaceChildren(frame);

  let ready = false;
  let pending = null;
  let lastPost = null;
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
      if (pending) { send(pending); pending = null; }
      onEvent({ type: "ready" });
    } else if (m.type === "size") {
      const h = Math.min(maxHeight, Math.max(minHeight, Math.ceil(Number(m.height) || 0) + 8));
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
    } else if (m.type === "propose") {
      onEvent({ type: "propose", what: m.what, detail: m.detail });
      if (onPropose) onPropose({ what: m.what, detail: m.detail });
    } else if (m.type === "patched") {
      const waiting = patches.shift();
      onEvent({ type: "patched", ok: m.ok, unapplied: m.unapplied || [] });
      if (waiting) waiting(m);
    }
  };
  const view = d.defaultView || window;
  view.addEventListener("message", onMessage);

  const rebuild = () => {
    page = buildPage(current, { components });
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
           state = null, budget = undefined }) {
      const msg = { type: "results", results, spec: current, stale,
                    at: at || new Date().toISOString(), partial, id, parameters, state,
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
      current = next;
      // Data that belongs with this revision is remembered before anything
      // is sent, so that a rebuild -- whether chosen here or forced by the
      // runtime -- comes back up holding it rather than blank.
      if (post) {
        lastPost = { type: "results", results: post.results, spec: current,
                     stale: post.stale || [], at: post.at || new Date().toISOString(),
                     partial: false, parameters: post.parameters || null,
                     state: post.state || null };
      }
      if (force || !ops || !ops.length || !ready) {
        rebuild();
        return { applied: "rebuild" };
      }
      const answer = await new Promise((resolve) => {
        patches.push(resolve);
        send({ type: "patch", ops, spec: current, revision: current.revision ?? null,
               results: post ? post.results : null, stale: post ? post.stale || [] : null,
               parameters: post ? post.parameters : null,
               appState: post ? post.state : null,
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
      if (answer.ok) return { applied: "in-place" };
      rebuild();
      return { applied: "rebuild", unapplied: answer.unapplied || [], timedOut: !!answer.timedOut };
    },
    /** Drive navigation from out here: a back button, a deep link. */
    setView(name) { send({ type: "view", name }); },
    /** The page as a file: data inlined, so a saved copy still draws. */
    page(results, { replay = null, parameters = null } = {}) {
      return buildPage(current, { results, standalone: true, components, replay, parameters });
    },
    digest() { return contentDigest(page); },
    destroy() {
      view.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}

export default mountDashboard;
