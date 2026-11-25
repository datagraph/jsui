/**
 * The half of the interface that travels with a downloaded page (U-111).
 *
 * Until now a saved copy was a photograph: the island held the rows as they
 * stood when the file was written, `run' and `set' replayed the one
 * combination that had been run, and anything else said "this copy holds the
 * data as of {at}; re-open it in Dydra to ask again".  That is honest and it
 * is also the wrong default.  The page holds the panels' own queries -- it is
 * built from them -- so a copy that cannot run them is withholding something
 * it has.  A saved page should be able to ask again.
 *
 * What stops it is not the queries.  It is the two things the pane supplies
 * and a file does not: somewhere to put a credential that the page's own
 * script cannot read, and a policy that lets a request leave.  So a saved page
 * stops being ONE document and becomes the same two the pane is:
 *
 *      the saved file  ──  holds the data, the queries, this script, and the
 *       (the host)          reader's token while the tab is open; its policy
 *                           allows a connection to the panels' own hosts and
 *                           to nothing else.  No model-written code runs here.
 *           │
 *           │  postMessage, the same channel `mountDashboard' opens
 *           ▼
 *      the page itself ──  sandboxed, opaque origin, `connect-src 'none''.
 *      (srcdoc frame)      Exactly the document the pane mounts, including
 *                          the model's own script.  It cannot reach the
 *                          token, and it cannot reach the network.
 *
 * Which keeps every claim §7.3 and D-R make about the frame true in the saved
 * copy -- the page still holds no credential, still fetches nothing, still
 * asks for a declared panel by name and gets back what the host chose to run
 * -- and adds the one thing the reader wanted: the data can be made current.
 *
 * The reader's token is typed in, held in a closure, and written nowhere: not
 * into the file, not into storage, not into the frame.  A file that travels
 * with a credential in it is a credential that travels, and no amount of
 * convenience is worth that.
 *
 * This script cannot import anything -- a saved page loads nothing, which is
 * the whole of §2.2 -- so what it needs from the library travels as source.
 * See `RESULT_DIGEST_SOURCE' for why that is stringified rather than copied.
 */


/*
 * The library travels as source, and the table of what travels lives in
 * `lib/app/carried-source.js' -- it is shared now with the saved FIGURE,
 * which carries a subset of the same bundles.  Re-exported here because this
 * module is where `frame.js' and the tests have always asked about it, and
 * because "can this tree build a refreshable copy" is a question about the
 * saved page, not about the table.
 */
import {
  sharedSource as carriedSource, missingSource as missingCarried,
  repairMissingSource, repairPending,
} from "../app/carried-source.js";

export { repairMissingSource, repairPending };

/** The modules a refreshable DASHBOARD needs and this tree cannot supply. */
export function missingSource() { return missingCarried(); }

/** The whole library, which is what a dashboard's host script uses. */
export function sharedSource() { return carriedSource(); }


/* ── the host's own script ────────────────────────────────────────────────── */

/**
 * What the saved file does.
 *
 * It is the pane's job, minus everything that needs a model: mount the page,
 * post the data in, answer what the page asks, and run the panels again when
 * the reader asks for that.  Written as a string for the same reason `RUNTIME'
 * is: the file loads nothing.
 */
const HOST = String.raw`
(function () {
  "use strict";

  var el = document.getElementById("saved-page-data");
  if (!el) return;
  var data = JSON.parse(el.textContent);
  var spec = data.spec || {};
  var results = data.results || {};
  var values = data.parameters || {};
  var appState = data.state || {};
  var stale = data.stale || [];
  var at = data.at || null;
  var source = data.source || null;

  /* The reader's credential, for as long as this tab is open.  Not in the
     file, not in localStorage, not posted into the frame: a saved page is a
     file that gets mailed, and a credential it remembered would be mailed
     with it. */
  var credential = null;

  var frame = document.getElementById("saved-page-frame");
  var ready = false, pending = null, running = false, lastHeight = 240;
  var seq = 0;

  function send(msg) {
    var m = Object.assign({ channel: "dashboard" }, msg);
    if (!ready) { pending = m; return; }
    try { frame.contentWindow.postMessage(m, "*"); } catch (e) { /* gone */ }
  }

  /* Identity, not origin: the frame's origin is the string "null", which
     every opaque context shares. */
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || m.channel !== "dashboard") return;
    if (m.type === "ready") {
      ready = true;
      post();
      if (pending) { var p = pending; pending = null; send(p); }
    } else if (m.type === "size") {
      var h = Math.max(240, Math.ceil(Number(m.height) || 0) + 8);
      /* The same echo the pane refuses: a page that reports back the height
         it was just given would otherwise grow by the margin on every
         observation, and a saved copy has nobody to notice it doing so. */
      if (h > lastHeight && h - lastHeight <= 8) return;
      lastHeight = h;
      frame.style.height = h + "px";
    } else if (m.type === "refresh") {
      refresh();
    } else if (m.type === "run") {
      askedToRun(m);
    } else if (m.type === "set") {
      askedToSet(m);
    } else if (m.type === "state") {
      appState[m.key] = m.value;
    } else if (m.type === "layout") {
      /* The engine is the pane's, and it was never in the file. */
      send({ type: "laid-out", id: m.id, ok: false,
             error: "a saved copy has no layout engine behind it" });
    } else if (m.type === "propose") {
      say("The page asked for " + (m.what || "something") + ". A saved copy has no "
          + "interface to grant it — re-open the page in Dydra to decide.");
    } else if (m.type === "error") {
      say("The page reported an error in " + (m.where || "itself") + ": " + (m.error || ""));
    }
  });

  /** Everything the page is told, in the one message its runtime expects. */
  function post(extra) {
    send(Object.assign({
      type: "results", results: results, spec: spec, at: at, stale: stale,
      parameters: values, state: appState, evidence: data.evidence || null,
    }, extra || {}));
  }

  /* ── the bar ───────────────────────────────────────────────────────────── */

  var bar = document.getElementById("saved-page-bar");
  var status = document.createElement("span");
  status.className = "saved-status";
  var actions = document.createElement("span");
  actions.className = "saved-actions";
  var log = document.createElement("div");
  log.className = "saved-log";
  log.hidden = true;
  var form = document.createElement("form");
  form.className = "saved-form";
  form.hidden = true;
  bar.appendChild(status);
  bar.appendChild(actions);
  bar.appendChild(form);
  bar.appendChild(log);

  function say(text, kind) {
    log.hidden = false;
    var line = document.createElement("div");
    if (kind) line.className = kind;
    line.textContent = text;
    log.appendChild(line);
    while (log.childNodes.length > 24) log.removeChild(log.firstChild);
  }

  function button(label, onclick, testid) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (testid) b.setAttribute("data-testid", testid);
    b.addEventListener("click", onclick);
    return b;
  }

  /** One labelled input.  Returns the input; the label is already around it. */
  function field(into, name, label, value, type) {
    var wrap = document.createElement("label");
    wrap.textContent = label;
    var input = document.createElement("input");
    input.type = type || "text";
    input.name = name;
    input.value = value == null ? "" : String(value);
    input.autocomplete = "off";
    input.setAttribute("data-testid", "saved-" + name);
    wrap.appendChild(input);
    into.appendChild(wrap);
    return input;
  }

  /** What the bar says when nothing is happening. */
  function paint() {
    status.textContent = at
      ? (credential ? "Showing data read " + at + " from " + where() + "."
                    : "This copy holds the data as of " + at + ".")
      : "This copy holds the data it was saved with.";
    actions.replaceChildren(
      button(credential ? "Refresh" : "Refresh…", refresh, "saved-refresh"));
    if (credential) {
      actions.appendChild(button("Forget the token", function () {
        credential = null;
        say("The token is forgotten. It was never written into this file.");
        paint();
      }, "saved-forget"));
    }
  }

  /**
   * Ask for the credential, and for nothing else.
   *
   * The address is shown and not offered for editing, for two reasons that
   * happen to agree.  The policy this file runs under names the origins its
   * panels were composed against, so an address typed over the top would be
   * refused by the browser with a message about a directive; and this copy
   * refreshes ITSELF -- the same panels against the same repository -- so a
   * page redrawn from somewhere else would carry a provenance mark that had
   * stopped being true of it.
   *
   * What the reader supplies is the one thing the file could not carry.
   */
  function connect(then) {
    form.hidden = false;
    form.replaceChildren();
    var note = document.createElement("p");
    note.className = "saved-note";
    note.textContent = "The queries run under your own credentials, against " + where()
                     + ". The token is held in this tab only — it is not written into "
                     + "this file, and it is not given to the page.";
    form.appendChild(note);
    var token = field(form, "token", "Token or password", "", "password");
    var go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Refresh now";
    go.setAttribute("data-testid", "saved-connect");
    form.appendChild(go);
    form.appendChild(button("Cancel", function () { form.hidden = true; }, "saved-cancel"));
    form.onsubmit = function (e) {
      e.preventDefault();
      var t = token.value.trim();
      if (!t) { say("A token or password is needed to run the queries again.", "saved-err"); return; }
      credential = {
        host: String(source.host).replace(/\/$/, ""),
        account: source.account,
        repository: source.repository,
        token: t,
      };
      form.hidden = true;
      form.replaceChildren();          // the token does not stay in the DOM either
      paint();
      then();
    };
  }

  /** Where this page was composed, as one phrase. */
  function where() {
    if (!source) return "nowhere this copy records";
    return source.account + "/" + source.repository + " at " + source.host;
  }

  /* ── running the panels again ──────────────────────────────────────────── */

  /** Where one panel's request goes: its own source, else the reader's. */
  function destination(panel) {
    var s = (panel && panel.source) || {};
    return {
      host: (s.host || credential.host || "").replace(/\/$/, ""),
      account: s.account || credential.account,
      repository: s.repository || credential.repository,
    };
  }

  function runPanel(panel) {
    var to = destination(panel);
    var bound = PM.bindParameters(panel, values,
                                  { parameters: spec.parameters || [], results: results });
    if (!bound.ok) {
      return Promise.resolve({
        ok: false, refused: true, text: "", digest: null, rows: null,
        error: bound.refusals.map(function (r) { return r.name + ": " + r.reason; }).join("; "),
      });
    }
    var accept = panel.accept || "text/tab-separated-values";
    var url = to.host + "/" + encodeURIComponent(to.account)
            + "/" + encodeURIComponent(to.repository) + "/sparql";
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: accept,
        Authorization: AU.authHeader(credential.token),
        "Content-Type": "application/sparql-query",
      },
      body: bound.query,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) {
      return res.text().then(function (text) {
        var mimeType = (res.headers.get("content-type") || accept).split(";")[0];
        if (!res.ok) {
          return { ok: false, mimeType: mimeType, text: "", digest: null, rows: null,
                   error: (text || ("HTTP " + res.status)).slice(0, 400) };
        }
        var d = RD.digestResult(text, mimeType);
        /* The same check the pane makes, for the same reason: a 200 with a
           body is not yet an answer to the question that was asked. */
        var fault = RF.resultFault(bound.query, d);
        if (fault) {
          return { ok: false, mimeType: mimeType, text: "", digest: d.digest, rows: d.rows,
                   error: "the response does not answer the query: " + fault };
        }
        return { ok: true, mimeType: mimeType, text: text, digest: d.digest, rows: d.rows };
      });
    }).catch(function (e) {
      return { ok: false, text: "", digest: null, rows: null, error: reach(e) };
    });
  }

  /**
   * What a failed connection means, said in terms of what the reader can do.
   *
   * A browser reports a blocked cross-origin request and a dead host the same
   * way -- a TypeError with nothing in it -- and the commonest cause by far
   * is the one the reader can act on: the file was opened from the disk, so
   * the request carries no origin the service will answer.
   */
  function reach(e) {
    var why = String((e && e.message) || e);
    if (location.protocol === "file:") {
      return why + " — this copy was opened from a file:// address, which most browsers "
           + "will not let reach a service. Serve the file over http, or re-open the page "
           + "in Dydra.";
    }
    return why;
  }

  /** Run every panel, then hand the page the whole refreshed state. */
  function refresh() {
    if (running) return;
    if (!(source && source.host && source.account && source.repository)) {
      say("This copy records no address for the repository it was composed against, so it "
          + "cannot run its queries again. Open the page in Dydra instead.", "saved-err");
      return;
    }
    if (!credential) { connect(refresh); return; }
    var panels = spec.panels || [];
    if (!panels.length) { say("This page has no panels to run."); return; }
    running = true;
    log.hidden = false;
    log.replaceChildren();
    status.textContent = "Running " + panels.length + " "
                       + (panels.length === 1 ? "query" : "queries") + "…";
    var fresh = {};
    var step = Promise.resolve();
    panels.forEach(function (panel) {
      step = step.then(function () {
        return runPanel(panel).then(function (r) {
          fresh[panel.name] = r;
          say(panel.name + ": " + (r.ok ? (r.rows == null ? "ok" : r.rows + " rows") : r.error),
              r.ok ? null : "saved-err");
        });
      });
    });
    step.then(function () {
      running = false;
      var failed = Object.keys(fresh).filter(function (n) { return !fresh[n].ok; });
      /* Every panel failing is a connection that did not work, not data that
         changed: the page keeps what it had rather than blanking itself. */
      if (failed.length === panels.length) {
        status.textContent = "Could not refresh. The page still shows the data it was saved with.";
        return;
      }
      results = fresh;
      at = new Date().toISOString();
      stale = SP.staleAssertions(spec, results);
      post();
      paint();
      say(stale.length
            ? stale.length + " passage(s) were written against data that has since changed; "
                           + "they are marked in the page."
            : "Every passage still matches the data it was written from.");
      if (failed.length) say(failed.length + " panel(s) did not answer.", "saved-err");
    });
  }

  /* ── what the page itself asks for ─────────────────────────────────────── */

  /**
   * A combination this copy was saved holding, if it is one.
   *
   * The offline half, unchanged: a saved page whose reader has given no token
   * can still answer what it was saved with, and says plainly when it cannot.
   */
  function replay(panel, parameters) {
    var held = data.replay || null;
    var key = JSON.stringify([panel || null, parameters || {}]);
    return held && Object.prototype.hasOwnProperty.call(held, key) ? held[key] : null;
  }

  function refuse(id, request) {
    send({ type: "refused", id: id, request: request,
           reason: "this copy holds the data as of " + (at || "the time it was saved")
                 + "; press Refresh to run the queries again, or re-open it in Dydra" });
  }

  function askedToRun(m) {
    var panel = (spec.panels || []).filter(function (p) { return p.name === m.panel; })[0];
    if (!panel) {
      send({ type: "refused", id: m.id, request: { panel: m.panel },
             reason: "\u0060" + m.panel + "' is not a panel of this page" });
      return;
    }
    var asked = m.parameters || {};
    if (!credential) {
      var held = replay(m.panel, asked);
      if (!held) { refuse(m.id, { panel: m.panel, parameters: asked }); return; }
      Object.keys(held).forEach(function (n) { results[n] = held[n]; });
      values = Object.assign({}, values, asked);
      post({ id: m.id, partial: true, results: held });
      return;
    }
    var was = values;
    values = Object.assign({}, values, asked);
    runPanel(panel).then(function (r) {
      if (!r.ok) {
        values = was;
        send({ type: "refused", id: m.id, request: { panel: m.panel, parameters: asked },
               reason: r.error });
        return;
      }
      results[panel.name] = r;
      stale = SP.staleAssertions(spec, results);
      var one = {};
      one[panel.name] = r;
      post({ id: m.id, partial: true, results: one });
    });
  }

  function askedToSet(m) {
    var declared = (spec.parameters || []).filter(function (p) { return p.name === m.parameter; })[0];
    if (!declared) {
      send({ type: "refused", id: m.id, request: { parameter: m.parameter },
             reason: "\u0060" + m.parameter + "' is not a parameter of this page" });
      return;
    }
    var checked = PM.checkValue(declared, m.value, { results: results });
    if (!checked.ok) {
      send({ type: "refused", id: m.id, request: { parameter: m.parameter, value: m.value },
             reason: checked.reason });
      return;
    }
    var asked = {};
    asked[m.parameter] = m.value;
    if (!credential) {
      var held = replay(null, asked);
      if (!held) { refuse(m.id, { parameter: m.parameter, value: m.value }); return; }
      Object.keys(held).forEach(function (n) { results[n] = held[n]; });
      values = Object.assign({}, values, asked);
      post({ id: m.id, partial: true, results: held, parameters: values });
      return;
    }
    values = Object.assign({}, values, asked);
    /* Only the panels that declare it: the page already says which, and
       re-running the rest would spend the reader's time on a question
       nobody asked again. */
    var affected = (spec.panels || []).filter(function (p) {
      return [].concat(p.parameters || []).indexOf(m.parameter) >= 0;
    });
    var fresh = {};
    var step = Promise.resolve();
    affected.forEach(function (panel) {
      step = step.then(function () {
        return runPanel(panel).then(function (r) { fresh[panel.name] = r; results[panel.name] = r; });
      });
    });
    step.then(function () {
      stale = SP.staleAssertions(spec, results);
      post({ id: m.id, partial: true, results: fresh, parameters: values });
    });
  }

  /* ── start ─────────────────────────────────────────────────────────────── */

  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = data.page;
  paint();
})();
`;

/** The whole script a saved page carries: the library, then the host. */
export function savedRuntime() {
  return `${sharedSource()}\n\n${HOST}`;
}

export default savedRuntime;
