/**
 * The frame a model-authored page runs in, and the only channel into it.
 *
 * Implements D-R, D-S and the enforcement half of D-T from
 * `llm-result-rendering-plan.md' §7.2; work items U-22, U-23, U-26.
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
 */

import { contentDigest } from "../mcp/result-digest.js";

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
  var state = { results: {}, derived: {}, stale: [], spec: null, at: null };
  var renderers = {};
  var listeners = { data: [], error: [] };

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

  function draw(el, value) {
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

  /* --- the API the model's own script may use ---------------------------- */

  var API = {
    get results() { return state.results; },
    get derived() { return state.derived; },
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
    resize: size
  };
  window.dashboard = API;

  window.addEventListener("message", function (e) {
    // The parent is the only sender that matters and it is the only one that
    // can reach here: a sandboxed opaque-origin frame is not addressable by
    // anything but its embedder.  The shape is still checked, because a
    // malformed message should fail visibly rather than half-apply.
    var d = e.data;
    if (!d || d.channel !== "dashboard") return;
    if (d.type === "results") {
      state.results = d.results || {};
      state.spec = d.spec || state.spec;
      state.stale = d.stale || [];
      state.at = d.at || new Date().toISOString();
      try { fill(); } catch (err) { fail("fill", err); }
    }
  });

  window.addEventListener("error", function (e) { fail("page", e.error || e.message); });
  window.addEventListener("resize", size);
  if (window.ResizeObserver) { new ResizeObserver(size).observe(document.documentElement); }
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
.dash-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #edf0f3;
  font-size: 10.5px; color: #8a94a0; }
`;

/**
 * The whole document, ready to be a `srcdoc' or a saved file.
 *
 * The footer is not decoration and is not the model's to remove: a dashboard is
 * read as the repository's own output unless it says otherwise, and D-S puts
 * that statement in the artifact rather than only in the transcript, because
 * the artifact is the part that gets saved, mailed and shown to someone who
 * was not here.
 */
export function buildPage(spec, { results = null, standalone = false, at = null } = {}) {
  const stamp = at || new Date().toISOString();
  const island = standalone && results
    ? `<script type="application/json" id="dash-data">${
        JSON.stringify({ spec, results, at: stamp }).replace(/</g, "\\u003c")}</script>`
    : "";
  const boot = standalone
    ? `<script>(function(){var el=document.getElementById("dash-data");if(!el)return;`
    + `var d=JSON.parse(el.textContent);window.postMessage(Object.assign({channel:"dashboard",type:"results"},`
    + `{results:d.results,spec:d.spec,at:d.at}),"*");})();</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title || "Dashboard")}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
${spec.html || ""}
<div class="dash-footer">
  Produced by a language model from ${spec.panels?.length || 0} repository
  ${(spec.panels?.length || 0) === 1 ? "query" : "queries"}${
    spec.assertions?.length ? `, with ${spec.assertions.length} passage(s) it wrote itself` : ""}.
  Bound regions are the interface's own runs; derived regions are recomputed here;
  asserted passages are the model's words. Rendered <span id="dash-footer-at">${esc(stamp)}</span>.
</div>
${island}
<script>${RUNTIME}</script>
${boot}
</body>
</html>`;
}

/* ── mounting ─────────────────────────────────────────────────────────────── */

/**
 * Put the page on the screen and keep the one channel to it open.
 *
 * Returns a handle: `post' sends results in, `destroy' takes it down, `page'
 * is the document text for a download.  The caller owns the data; this owns
 * the frame.
 */
export function mountDashboard(container, spec, {
  onRefresh = null, onEvent = () => {}, minHeight = 240, maxHeight = 4000, doc = null,
} = {}) {
  const d = doc || container.ownerDocument || document;
  const page = buildPage(spec);
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
    }
  };
  const view = d.defaultView || window;
  view.addEventListener("message", onMessage);

  return {
    frame,
    get ready() { return ready; },
    /** Hand the page a set of results.  Queued until the runtime says ready. */
    post({ results, stale = [], at = null }) {
      const msg = { type: "results", results, spec, stale, at: at || new Date().toISOString() };
      if (ready) send(msg); else pending = msg;
    },
    /** The page as a file: data inlined, so a saved copy still draws. */
    page(results) { return buildPage(spec, { results, standalone: true }); },
    digest() { return contentDigest(page); },
    destroy() {
      view.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}

export default mountDashboard;
