/**
 * The half of the interface that travels with a downloaded FIGURE (U-113).
 *
 * A saved dashboard was made refreshable first, because a dashboard is a page
 * of panels and a panel is a query: running them again produces the same page
 * with newer numbers in it.  A figure is not like that.  It is a drawing, and
 * the drawing was made by a model from one document at one moment.  Nothing
 * in a saved file can draw it again -- there is no model in the file, and
 * there is deliberately no script in the frame that shows it.
 *
 * So the question is what a figure's Refresh can honestly mean, and the
 * answer is the one the record was built to answer (D-N): the figure carries
 * the digest of the exact document it was drawn from, so a copy found later
 * can be matched against a re-run of the same query.  That is a check a file
 * can do by itself.  Pressing Refresh here runs the query again under the
 * reader's own credentials and says one of two things:
 *
 *      the digest is the same   -- the picture is still a picture of the
 *                                  data.  Which is the sentence someone
 *                                  holding a six-month-old chart actually
 *                                  wants, and could not get before.
 *
 *      the digest has changed   -- the drawing is of data that has since
 *                                  moved.  The figure is marked, above
 *                                  itself, and what the query answers NOW is
 *                                  put on the page as a table, so the reader
 *                                  can see what changed without leaving the
 *                                  file.
 *
 * It does not redraw, and it says so rather than leaving the reader to infer
 * it.  A picture that silently became a different picture would be worse than
 * one that is honestly stale: the whole provenance strip underneath it --
 * which model, which query, which digest -- is a statement about the drawing
 * that is there, and a redraw nobody authorised would falsify all of it.
 *
 * The file is two documents for the same reason the saved dashboard is:
 *
 *      the saved file  ──  holds the query, this script, and the reader's
 *       (the host)         token while the tab is open; its policy allows a
 *                          connection to the figure's own host and to
 *                          nothing else.  No model-written content here.
 *           │
 *           │  (nothing: the frame is sandbox="" and cannot speak)
 *           ▼
 *      the figure      ──  the same bytes `buildFigurePage' has always
 *      (srcdoc frame)      written, under every restriction there is.
 *
 * Note the arrow has nothing on it.  The saved dashboard opens a postMessage
 * channel because its page is empty until it is fed; a figure is complete
 * when it is written, so the frame is given its document as a `srcdoc'
 * ATTRIBUTE, in the file, by the build.  Which is why this copy still draws
 * with JavaScript turned off entirely -- the refresh is the only part that
 * needs a script, and the picture never did.
 */

import { sharedSource, missingSource, repairMissingSource } from "../app/carried-source.js";

/* The cache-defeating second read, passed through so that a figure built
   against a half-deployed tree can ask for the missing bundle again rather
   than simply going without the check.  See `carried-source.js'. */
export { repairMissingSource };

/**
 * What a figure's host script uses, and nothing else.
 *
 * A quarter of the saved dashboard's library is about parameters and
 * passages, and a figure has neither.  Naming the three it does use keeps
 * about 14 KB out of every saved figure; `carried-source.js' adds whatever
 * those three need underneath (`resultFault' alone pulls in three more).
 */
export const FIGURE_BUNDLES = ["result-digest.js", "runner.js", "catalog.js"];

/** The modules a refreshable figure needs and this tree cannot supply. */
export function missingFigureSource() { return missingSource(FIGURE_BUNDLES); }

/* ── the host's own script ────────────────────────────────────────────────── */

const HOST = String.raw`
(function () {
  "use strict";

  var el = document.getElementById("saved-figure-data");
  if (!el) return;
  var data = JSON.parse(el.textContent);
  var source = data.source || null;
  var query = data.query || "";
  var at = data.at || null;
  var was = { digest: data.digest || null, rows: data.rows == null ? null : data.rows,
              mimeType: data.mimeType || null };

  /* The reader's credential, for as long as this tab is open.  Not in the
     file, not in localStorage, and -- unlike the saved dashboard, which at
     least has a frame to withhold it from -- not anywhere at all but this
     closure. */
  var credential = null;
  var running = false;

  var frame = document.getElementById("saved-figure-frame");
  var bar = document.getElementById("saved-figure-bar");
  var mark = document.getElementById("saved-figure-mark");
  var after = document.getElementById("saved-figure-after");

  /* ── the box the picture sits in ───────────────────────────────────────── */

  /*
     Nothing inside the frame can measure itself -- it has no script, by
     construction -- and nothing out here can read it either, because its
     origin is opaque.  So the height comes from the figure's own viewBox,
     which the build computed and wrote into the file.  The stylesheet
     already states it as an aspect-ratio, so a reader with no JavaScript
     gets a box of about the right shape; this refines it by the caption and
     provenance strip the ratio does not know about.
  */
  var aspect = Number(data.aspect) || 0;
  function sizeFrame() {
    if (!frame || !(aspect > 0)) return;
    var w = frame.clientWidth || 0;
    if (!w) return;
    var h = Math.round(w / aspect) + 96;
    frame.style.height = Math.min(1600, Math.max(160, h)) + "px";
  }
  window.addEventListener("resize", sizeFrame);

  /* ── the bar ───────────────────────────────────────────────────────────── */

  var status = document.createElement("span");
  status.className = "saved-status";
  var actions = document.createElement("span");
  actions.className = "saved-actions";
  var form = document.createElement("form");
  form.className = "saved-form";
  form.hidden = true;
  var log = document.createElement("div");
  log.className = "saved-log";
  log.hidden = true;
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

  function field(into, name, label, type) {
    var wrap = document.createElement("label");
    wrap.textContent = label;
    var input = document.createElement("input");
    input.type = type || "text";
    input.name = name;
    input.autocomplete = "off";
    input.setAttribute("data-testid", "saved-" + name);
    wrap.appendChild(input);
    into.appendChild(wrap);
    return input;
  }

  /** Where this figure was drawn from, as one phrase. */
  function where() {
    if (!source) return "nowhere this copy records";
    return source.account + "/" + source.repository + " at " + source.host;
  }

  /** What the bar says when nothing is happening. */
  function paint() {
    status.textContent = "Drawn from data read " + (at || "when this was saved")
                       + ". The drawing is fixed; Refresh runs the query again and says "
                       + "whether it is still a picture of the data.";
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
   * The address is shown and not offered for editing: the policy this file
   * runs under names the one origin the figure was drawn against, so an
   * address typed over the top would be refused by the browser with a message
   * about a directive -- and a figure checked against some other store would
   * be answering a different question than the one its provenance strip says
   * it is answering.
   */
  function connect(then) {
    form.hidden = false;
    form.replaceChildren();
    var note = document.createElement("p");
    note.className = "saved-note";
    note.textContent = "The query runs under your own credentials, against " + where()
                     + ". The token is held in this tab only — it is not written into "
                     + "this file.";
    form.appendChild(note);
    var token = field(form, "token", "Token or password", "password");
    var go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Check it now";
    go.setAttribute("data-testid", "saved-connect");
    form.appendChild(go);
    form.appendChild(button("Cancel", function () { form.hidden = true; }, "saved-cancel"));
    form.onsubmit = function (e) {
      e.preventDefault();
      var t = token.value.trim();
      if (!t) { say("A token or password is needed to run the query again.", "saved-err"); return; }
      credential = { token: t };
      form.hidden = true;
      form.replaceChildren();          // the token does not stay in the DOM either
      paint();
      then();
    };
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
           + "will not let reach a service. Serve the file over http, or open the figure "
           + "again in Dydra.";
    }
    return why;
  }

  /* ── running the query again ───────────────────────────────────────────── */

  function run() {
    var host = String(source.host).replace(/\/$/, "");
    var url = host + "/" + encodeURIComponent(source.account)
            + "/" + encodeURIComponent(source.repository) + "/sparql";
    var accept = data.accept || was.mimeType || "text/tab-separated-values";
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: accept,
        Authorization: AU.authHeader(credential.token),
        "Content-Type": "application/sparql-query",
      },
      body: query,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) {
      return res.text().then(function (text) {
        var mimeType = (res.headers.get("content-type") || accept).split(";")[0];
        if (!res.ok) {
          return { ok: false, error: (text || ("HTTP " + res.status)).slice(0, 400) };
        }
        var d = RD.digestResult(text, mimeType);
        /* The same check the interface makes, for the same reason: a 200 with
           a body is not yet an answer to the question that was asked, and a
           figure declared stale against a document that answers some other
           query would be a false alarm nobody could disprove. */
        var fault = RF.resultFault(query, d);
        if (fault) return { ok: false, error: "the response does not answer the query: " + fault };
        return { ok: true, text: text, mimeType: mimeType, shape: d };
      });
    }).catch(function (e) {
      return { ok: false, error: reach(e) };
    });
  }

  /** What the query answers now, as a table under the picture. */
  function showTable(text, mimeType) {
    var t = RD.tableOf(text, mimeType);
    after.replaceChildren();
    if (!t || !t.names.length) return;
    var head = document.createElement("p");
    head.className = "saved-note";
    head.setAttribute("data-testid", "saved-now-head");
    var shown = Math.min(t.rows.length, 200);
    head.textContent = "What the query answers now" + (shown < t.rows.length
      ? " — the first " + shown + " of " + t.rows.length + " rows"
      : " — " + t.rows.length + " row(s)") + ".";
    after.appendChild(head);
    var table = document.createElement("table");
    table.className = "saved-table";
    table.setAttribute("data-testid", "saved-now-table");
    var tr = document.createElement("tr");
    t.names.forEach(function (n) {
      var th = document.createElement("th");
      th.textContent = n;
      tr.appendChild(th);
    });
    table.appendChild(tr);
    t.rows.slice(0, shown).forEach(function (row) {
      var r = document.createElement("tr");
      t.names.forEach(function (_, i) {
        var td = document.createElement("td");
        td.textContent = row[i] == null ? "" : String(row[i]);
        r.appendChild(td);
      });
      table.appendChild(r);
    });
    after.appendChild(table);
  }

  /** The band over the picture.  Removed when the answer is the happy one. */
  function band(text, kind) {
    mark.replaceChildren();
    if (!text) { mark.hidden = true; return; }
    mark.hidden = false;
    mark.className = kind || "saved-mark";
    mark.setAttribute("data-testid", "saved-figure-mark");
    mark.textContent = text;
  }

  function refresh() {
    if (running) return;
    if (!(source && source.host && source.account && source.repository && query)) {
      say("This copy records no query and no address to run one against, so it cannot "
          + "check itself. Open the figure again in Dydra instead.", "saved-err");
      return;
    }
    if (!credential) { connect(refresh); return; }
    running = true;
    log.hidden = false;
    log.replaceChildren();
    status.textContent = "Running the query again…";
    run().then(function (r) {
      running = false;
      paint();
      if (!r.ok) {
        say(r.error, "saved-err");
        say("The figure is unchanged, and so is what this copy says about it.");
        return;
      }
      var now = r.shape;
      var same = was.digest && now.digest === was.digest;
      say("digest " + now.digest + (now.rows == null ? "" : ", " + now.rows + " row(s)"));
      if (same) {
        band(null);
        after.replaceChildren();
        say("The data has not changed since the figure was drawn: the same "
            + now.bytes + " bytes, digest " + now.digest + ". The picture still holds.");
        status.textContent = "Checked " + new Date().toISOString()
                           + ": the data is unchanged since " + (at || "this was saved") + ".";
        return;
      }
      band("The data has changed since this was drawn. The figure is of the document read "
           + (at || "when this was saved") + " (digest " + (was.digest || "unrecorded")
           + (was.rows == null ? "" : ", " + was.rows + " row(s)")
           + "); the query now answers digest " + now.digest
           + (now.rows == null ? "" : ", " + now.rows + " row(s)")
           + ". The drawing is not redrawn — a picture cannot redraw itself without the "
           + "model that made it. What the query answers now is below.", "saved-mark saved-moved");
      showTable(r.text, r.mimeType);
      status.textContent = "Checked " + new Date().toISOString()
                         + ": the data has moved since " + (at || "this was saved") + ".";
    });
  }

  /* ── start ─────────────────────────────────────────────────────────────── */

  band(null);
  sizeFrame();
  paint();
})();
`;

/**
 * The whole script a saved figure carries: the library it uses, then the host.
 *
 * Throws, like the dashboard's, when the running tree cannot supply a bundle
 * -- the caller then writes the figure as the single static document it has
 * always been, which loses the check and nothing else.
 */
export function savedFigureRuntime() {
  return `${sharedSource(FIGURE_BUNDLES)}\n\n${HOST}`;
}

export default savedFigureRuntime;
