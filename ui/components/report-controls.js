/**
 * Keeping the report (§34.7, §34.8).
 *
 * A pane is not a place a report can be kept: it is memory, it is gone on a
 * reload, and there is no way to send somebody a box inside somebody else's
 * browser.  The record in `<account>/mcp' is the archive and answers SPARQL,
 * which is the right shape for a later query and the wrong one for reading.
 * Neither of them is a document.
 *
 * So the answer is rendered as a standalone page -- its own styles, no script,
 * nothing fetched -- and offered two ways.  `Open' puts it in a window, which
 * is what makes it a web page rather than a file nobody looks at; `Save'
 * writes it to disk under a name that sorts by date.  Both carry the Article
 * 50 line and the record links, because a report that leaves this screen is
 * exactly the copy that must still say which model wrote it.
 *
 * One implementation, two panes.  The account's pane asks across several
 * stores and the repository's pane asks one, which changes what goes INTO the
 * report and nothing about what keeping it means -- so the caller passes a
 * function that renders the page, and what is here is the two buttons and the
 * two ways a browser can be given a document.
 */

import { reportFilename } from "../../lib/format/report.js";

const STYLE = `
.exp-save { margin-top: 8px; display: flex; gap: 6px; }
.exp-save button {
  font-size: 11px; padding: 3px 9px; cursor: pointer; border: 1px solid #c9d2db;
  border-radius: 3px; background: #fff; color: #24323f; }
.exp-save button:hover { background: #f2f6fa; }
`;

export function ensureReportControlStyle(doc) {
  if (!doc || doc.getElementById("jsui-report-controls-style")) return;
  const s = doc.createElement("style");
  s.id = "jsui-report-controls-style";
  s.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(s);
}

/**
 * The two controls, as one row.
 *
 * `page()' is called at the moment the button is pressed rather than when the
 * row is built: the run may still be recording its transcript when the answer
 * appears, and a report rendered early would carry "not recorded" for a record
 * that landed a second later.
 */
export function saveControls(doc, {
  page, account = null, filename = null, onStatus = () => {}, testid = "exploration",
} = {}) {
  ensureReportControlStyle(doc);
  const row = doc.createElement("div");
  row.className = "exp-save";
  row.dataset.testid = `${testid}-save-controls`;

  const nameIt = filename || (() => reportFilename({ account }));

  const open = doc.createElement("button");
  open.type = "button";
  open.className = "exp-open-page";
  open.dataset.testid = `${testid}-open-page`;
  open.title = "Open this report as a web page, in a window of its own";
  open.textContent = "Open as a page";
  open.addEventListener("click", () => {
    const html = page();
    // Written into the window rather than navigated to a blob: a document
    // written by its opener keeps the opener's origin, so a reader can save it
    // with the browser's own command; a blob: URL in a new tab is treated as a
    // download by some browsers and as nothing by others.
    const win = doc.defaultView?.open("", "_blank");
    if (!win) {
      onStatus("the page could not be opened — allow pop-ups for this site, or Save");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  });

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "exp-save-page";
  save.dataset.testid = `${testid}-save-page`;
  save.title = "Save this report as an HTML file";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    const view = doc.defaultView;
    const blob = new view.Blob([page()], { type: "text/html;charset=utf-8" });
    const href = view.URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = href;
    a.download = nameIt();
    doc.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a later turn of the event loop: revoking it in this one races
    // the download the click just started.
    view.setTimeout(() => view.URL.revokeObjectURL(href), 10000);
    onStatus(`saved · ${a.download}`);
  });

  row.append(open, save);
  return row;
}

export default saveControls;
