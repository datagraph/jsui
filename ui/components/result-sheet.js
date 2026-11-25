/**
 * The result sheet, as a panel (U-117).
 *
 * One per interface, in the readings region of the results pane (U-120), and
 * the destination of the drag the view editor has always offered.  Four
 * things it does and one it deliberately does not:
 *
 *   it takes a drop, and says what it took;
 *   it takes the same result from a press on the tab, because a drag is a
 *     gesture some readers cannot make and all readers can miss;
 *   it says, of everything it holds, when that was read;
 *   it hands one over as a file, which is the way OUT of a surface that
 *     keeps nothing — a reader who dropped a result here because it matters
 *     should not have to choose between leaving the tab open and a
 *     screenshot (U-123);
 *
 *   and it keeps nothing past this page.  A sheet that survived a reload
 *   would be a store, and a store of results read at unrecorded moments
 *   under unrecorded credentials is the thing this whole interface is built
 *   not to have.  The empty state says so rather than leaving it to be
 *   discovered.
 *
 * The listeners are on the panel and not on the entries: entries are
 * redrawn whole on every change, and a listener on one is a listener on a
 * node that is about to be replaced.
 */

import { readDrop, entryOf, addEntry, removeEntry, renderSheet, rereadEntry,
         rerunnable, DROP_TYPE, SHEET_ATTRIBUTE } from "../../lib/app/results.js";
/* The two halves of the download, each in a file nothing can have cached:
   the judgement (what the file holds, and whether it can ask again) in
   `reading-file.js', the blob and the anchor in `presentation-download.js',
   where `offerFile' was written for the presentation's press and is the
   same gesture here. */
import { readingFile } from "../../lib/app/reading-file.js";
import { offerFile } from "./presentation-download.js";

/** The class the editor's drag lights up. */
const ACTIVE = "drag-active";

/**
 * Wire the sheet.
 *
 * Returns a handle: `add' is the manual path — the same entry, from a press
 * rather than from a drag — and `count' is for whoever wants to say how many
 * are held without reading the DOM.
 */
export function mountResultSheet(box, { onNote = () => {}, run = null,
                                        hostFor = null } = {}) {
  if (!box) return null;
  if (box.__resultSheet) return box.__resultSheet;

  let entries = [];
  const sheet = box.ownerDocument.createElement("div");
  sheet.className = "rs-sheet";
  sheet.setAttribute(SHEET_ATTRIBUTE, "");
  box.appendChild(sheet);

  const draw = () => { sheet.innerHTML = renderSheet(entries); };
  draw();

  const note = (text, bad = false) => {
    onNote(text, bad);
    const line = box.querySelector(".rs-status") || (() => {
      const el = box.ownerDocument.createElement("p");
      el.className = "rs-status";
      box.insertBefore(el, sheet);
      return el;
    })();
    line.textContent = text;
    line.classList.toggle("rs-error", Boolean(bad));
  };

  /** One payload, however it arrived. */
  const take = (payload) => {
    const entry = entryOf(payload);
    entries = addEntry(entries, entry);
    draw();
    note(`✓ ${entry.view} — ${entry.count} row${entry.count === 1 ? "" : "s"}, `
       + `read ${new Date(entry.at).toLocaleTimeString()}`);
    return entry;
  };

  /* A drop is only a drop if `dragover' said so: the default action of a
     drop on an element is to navigate to what was dropped, which with our
     payload means leaving the page for a JSON document. */
  const over = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    sheet.classList.add(ACTIVE);
  };
  sheet.addEventListener("dragenter", over);
  sheet.addEventListener("dragover", over);
  sheet.addEventListener("dragleave", (event) => {
    if (event.target === sheet) sheet.classList.remove(ACTIVE);
  });

  sheet.addEventListener("drop", (event) => {
    event.preventDefault();
    sheet.classList.remove(ACTIVE);
    const dt = event.dataTransfer;
    const text = dt ? (dt.getData("application/json") || dt.getData("text/plain")) : "";
    const read = readDrop(text);
    if (!read.ok) { note(read.error, true); return; }
    take(read.payload);
  });

  /**
   * Read one entry again (U-119).
   *
   * The credential is the account's, from the session this interface is
   * already signed in to — the same one the editor's own Run used.  Nothing
   * was carried into the sheet and nothing has to be: the reason a saved
   * page must ask its reader for a credential is that it travels, and a
   * sheet does not.
   *
   * It is a press and never a consequence of anything else.  A sheet that
   * re-read on its own would turn a surface for comparing readings into a
   * poll against someone's store.
   */
  const reread = async (key) => {
    const entry = entries.find((e) => e.key === key);
    if (!entry) return null;
    const may = rerunnable(entry);
    if (!may.ok) { note(may.why, true); return null; }
    if (typeof run !== "function") {
      note("this sheet has no way to run a query — it was mounted without one", true);
      return null;
    }
    note(`reading ${entry.view} again…`);
    let out;
    try { out = await run({ account: entry.account, repository: entry.repository,
                            query: entry.query, view: entry.view }); }
    catch (e) { out = { ok: false, error: String(e) }; }
    if (!out?.ok) {
      note(`${entry.view} could not be read again: ${out?.error || "the run failed"}`, true);
      return null;
    }
    const next = rereadEntry(entry, { results: out.results, took: out.ms,
                                      revision: out.revision });
    entries = entries.map((e) => (e.key === key ? next : e));
    draw();
    note(next.reread.changed
      ? `${entry.view} has moved since it was dropped`
      : `${entry.view} is unchanged`);
    return next;
  };

  /**
   * Keep one reading as a file (U-123).
   *
   * No network and no credential: everything the file holds is already in
   * this entry, which is the point of a sheet that holds readings rather
   * than addresses.  The host is asked for by account — the reading says
   * which account it came from, and a reading from an account this
   * interface has no session for still downloads, with its data and
   * without an address it could not honour.
   */
  const save = (key) => {
    const entry = entries.find((e) => e.key === key);
    if (!entry) return null;
    const host = typeof hostFor === "function" ? hostFor(entry.account) : null;
    let built;
    try { built = readingFile(entry, { host }); }
    catch (e) { built = { ok: false, error: String(e) }; }
    if (!built.ok) { note(built.error, true); return null; }
    if (!offerFile(box.ownerDocument, { name: built.name, html: built.html })) {
      note("this page could not hand the file to the browser", true);
      return null;
    }
    note(built.message);
    return built;
  };

  sheet.addEventListener("click", (event) => {
    /* The tab folds its own reading away.  The fold is written into the
       model rather than onto the node, because the next thing that happens
       redraws every entry; `closest' rather than the target itself, because
       the press may land on anything the tab is drawn with. */
    const foldKey = event.target?.closest?.("[data-rs-toggle]")
      ?.getAttribute("data-rs-toggle");
    if (foldKey) {
      entries = entries.map((e) => (e.key === foldKey ? { ...e, collapsed: !e.collapsed } : e));
      draw();
      return;
    }
    const runKey = event.target?.getAttribute?.("data-rs-run");
    if (runKey) { reread(runKey); return; }
    const saveKey = event.target?.getAttribute?.("data-rs-download");
    if (saveKey) { save(saveKey); return; }
    const key = event.target?.getAttribute?.("data-rs-remove");
    if (!key) return;
    entries = removeEntry(entries, key);
    draw();
    note(entries.length ? "" : "the sheet is empty again");
  });

  const handle = {
    element: sheet,
    add: (payload) => take(payload),
    addDropText: (text) => {
      const read = readDrop(text);
      if (!read.ok) { note(read.error, true); return null; }
      return take(read.payload);
    },
    reread: (key) => reread(key),
    save: (key) => save(key),
    count: () => entries.length,
    entries: () => entries.slice(),
    clear: () => { entries = []; draw(); },
  };
  box.__resultSheet = handle;
  return handle;
}

/**
 * The sheet an element can send to.
 *
 * There is one, in the results pane (U-120), and a reading carries the
 * account and the repository it was read from — so the question an element
 * asks is no longer "which pane am I in" but "where is the sheet".  It is
 * looked up from the element's own document, so a second document (a test
 * harness, an opened window) finds its own.
 */
export function sheetFor(el) {
  const doc = el?.ownerDocument || (typeof document === "undefined" ? null : document);
  const box = doc?.querySelector(`#tab-results [${SHEET_ATTRIBUTE}]`)
           || doc?.querySelector(`[${SHEET_ATTRIBUTE}]`);
  return box?.parentElement?.__resultSheet || null;
}

export { DROP_TYPE, SHEET_ATTRIBUTE };
export default mountResultSheet;
