/**
 * The result sheet: somewhere to put a result that has already run (U-117),
 * and to read it again (U-119).
 *
 * The view editor has made every result tab draggable since before this
 * repository's first commit — `dragstart` writes a `result-sheet` payload
 * carrying the view, the store, the query, the revision and the whole result
 * — and then looks for `result-sheet-drop-zone` to light up. Nothing in the
 * tree has ever had that id. The sending half of a gesture survived; the
 * receiving half did not, so the drag ended wherever it was dropped and
 * nothing happened.
 *
 * This is the receiver, and it is written as a model rather than as a drop
 * handler for three reasons worth stating:
 *
 *   * **the result is already in hand.** The payload carries the rows, so a
 *     DROP runs no query, spends no grant and needs no credential. That is
 *     the character of the sheet: it holds what was read, as it was read.
 *
 *     Reading it again is a press and never a consequence of dropping it
 *     (U-119). The thing that made a re-read look impossible was the saved
 *     page's problem read into a place that does not have it: a file that
 *     travels cannot carry a credential, so its Refresh must ask the reader
 *     for one. A sheet does not travel. It is in the interface, the account
 *     is signed in, and the credential a re-run needs is the same one the
 *     editor's own Run used a moment ago — the account's. Nothing is
 *     carried, so there is nothing to carry wrongly.
 *   * **what was read has to say when.** A table with no "as of" is a table
 *     that will be believed next week. Each entry keeps the moment, the
 *     repository revision the store answered with, and a digest — and the
 *     digest is of the READING, the columns and the rows, rather than of the
 *     bytes the store sent. Two readings of one query are then comparable
 *     whether one arrived as a parsed object from a drop and the other as
 *     text from a re-run, which is exactly the pair a re-read has to
 *     compare. (It is therefore NOT the same number as a figure's
 *     provenance digest, which is of the document: the same function over a
 *     different subject.)
 *   * **a drag is not the only way to say where something goes.** The panel
 *     is a destination with a name, so the same result can be sent to it by
 *     a press on the tab it is in — and, for anything that takes a
 *     destination, the verbs name one (U-118).
 *
 * The sheet is per repository pane and holds nothing across a reload: it is
 * a working surface, not a store. Saying so is the point — a reader who
 * expects a sheet to survive a reload has been promised something no one
 * built.
 */

import { contentDigest } from "../mcp/result-digest.js";

/** The payload type the view editor has always written. */
export const DROP_TYPE = "result-sheet";

/** The attribute that marks a sheet in the DOM, for the editor to find. */
export const SHEET_ATTRIBUTE = "data-result-sheet";

/** How many entries one sheet keeps, and how many rows of each it draws. */
export const MAX_ENTRIES = 24;
export const MAX_ROWS = 200;

/* ── reading what was dropped ─────────────────────────────────────────────── */

/**
 * The payload of a drop, or a reason it is not one.
 *
 * Anything may be dropped on anything, so this is a parser and not a cast:
 * the text may be nothing, may not be JSON, may be JSON that is not ours.
 * Each of those answers with a sentence the panel can show, because a drop
 * that silently does nothing is what this module exists to replace.
 */
export function readDrop(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: false, error: "nothing came with the drop" };
  let payload;
  try { payload = JSON.parse(raw); }
  catch { return { ok: false, error: "what was dropped is not a result — it carried no data this sheet can read" }; }
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "what was dropped is not a result" };
  }
  if (payload.type !== DROP_TYPE) {
    return { ok: false,
             error: `what was dropped is \`${String(payload.type || "untyped")}', not a result` };
  }
  if (!payload.tab || typeof payload.tab !== "object") {
    return { ok: false, error: "the result came without its data — drag the tab itself" };
  }
  return { ok: true, payload };
}

/** SPARQL Results JSON, as columns and rows of display text. */
export function tableOf(results) {
  if (!results || typeof results !== "object") return { form: "unknown", columns: [], rows: [] };
  if (results.error) {
    return { form: "error", columns: [], rows: [],
             error: String(results.error.message || results.error) };
  }
  if (typeof results.boolean === "boolean") {
    return { form: "boolean", columns: ["value"], rows: [[String(results.boolean)]] };
  }
  const bindings = results.results?.bindings;
  if (!Array.isArray(bindings)) return { form: "unknown", columns: [], rows: [] };
  const columns = results.head?.vars || Object.keys(bindings[0] || {});
  return {
    form: "table", columns,
    rows: bindings.map((b) => columns.map((n) => termText(b[n]))),
  };
}

/**
 * One term, as the text a reader should see.
 *
 * The value, with the marks that distinguish the kinds — angle brackets for
 * an IRI, `_:` for a blank node, a language tag or a datatype on a literal
 * that carries one. A bare `value` would show an IRI and a string that spell
 * the same characters as the same thing, which in RDF they are not.
 */
export function termText(term) {
  if (!term || typeof term !== "object") return "";
  const value = term.value == null ? "" : String(term.value);
  switch (term.type) {
    case "uri": return `<${value}>`;
    case "bnode": return `_:${value}`;
    case "literal":
    case "typed-literal": {
      const lang = term["xml:lang"] || term.lang || null;
      if (lang) return `"${value}"@${lang}`;
      if (term.datatype) return `"${value}"^^<${term.datatype}>`;
      return value;
    }
    default: return value;
  }
}

/**
 * One sheet entry, out of a drop.
 *
 * `at` is the moment the query ran and not the moment it was dropped: the
 * sheet is holding a reading, and when the reading was taken is the only
 * date that qualifies it.
 */
export function entryOf(payload, { at = null } = {}) {
  const tab = payload?.tab || {};
  const table = tableOf(tab.results);
  const rows = table.rows.length;
  const read = {
    at: at || (tab.createdAt ? new Date(tab.createdAt).toISOString() : new Date().toISOString()),
    digest: readingDigest(table),
    count: rows,
  };
  return {
    key: `${payload.key || `view:${payload.accountName}/${payload.repositoryName}/${payload.viewName}`}`
       + `#${tab.id || payload.tabId || "run"}`,
    view: String(payload.viewName || "(unnamed)"),
    // The tab this reading came out of, by the label the editor gave it.
    // Its own, where the payload carried one: the same moment formatted by
    // the same call, so the tab in the sheet reads as the tab in the editor.
    label: String(tab.label || timeLabel(read.at)),
    // Whether its body is folded away.  In the model and not in the DOM: the
    // sheet redraws every entry on every change, and a fold kept on the node
    // is a fold lost the next time anything else happens.
    collapsed: false,
    account: String(payload.accountName || ""),
    repository: String(payload.repositoryName || ""),
    query: tab.query == null ? null : String(tab.query),
    arguments: String(tab.urlArguments || payload.urlArguments || ""),
    // The result document as it was read, kept beside the drawn table and
    // not instead of it.  `rows' is display text and stops at MAX_ROWS,
    // which is right for a sheet and wrong for a copy somebody keeps: a
    // download built from what is drawn would be a transcription of a
    // screen (U-123).  It is the object the drop already carried, so
    // holding it costs nothing that was not already held.
    results: tab.results ?? null,
    at: read.at,
    took: Number.isFinite(Number(tab.executionTime)) ? Number(tab.executionTime) : null,
    revision: String(tab.etag || ""),
    digest: read.digest,
    form: table.form,
    error: table.error || null,
    columns: table.columns,
    rows: table.rows.slice(0, MAX_ROWS),
    count: rows,
    truncated: rows > MAX_ROWS,
    // What this entry was when it arrived.  Kept so that a re-read can say
    // what moved rather than merely showing a later number (U-119); it is
    // never overwritten, so the comparison stays against the reading the
    // reader actually looked at.
    first: read,
    reread: null,
  };
}

/**
 * The digest of what was read.
 *
 * Over the columns and the rows and not over the bytes: a drop arrives as a
 * parsed object and a re-run as text, and digesting each as it came would
 * make the one comparison this is for — the same query, twice — a comparison
 * of two spellings.
 */
export function readingDigest(table) {
  return contentDigest(JSON.stringify({ columns: table?.columns || [],
                                        rows: table?.rows || [] }));
}

/**
 * One entry, read again.
 *
 * The first reading is kept and the verdict is explicit: a re-read that
 * reports a later time and a changed table, with no statement about whether
 * anything moved, leaves the reader to diff two tables by eye — which is the
 * work they pressed the button to avoid.
 */
export function rereadEntry(entry, { results, at = null, took = null, revision = null } = {}) {
  const table = tableOf(results);
  const digest = readingDigest(table);
  const rows = table.rows.length;
  const when = at || new Date().toISOString();
  return {
    ...entry,
    at: when,
    // The reading this entry now IS.  Replaced rather than kept beside the
    // first, because a download takes what the card shows.
    results: results ?? null,
    // The tab says when the reading it fronts was taken, so a re-read moves
    // it.  A tab still showing the dropped reading's time over a table read
    // a minute ago is the one false statement this sheet exists to prevent.
    label: timeLabel(when),
    took: Number.isFinite(Number(took)) ? Number(took) : null,
    // The revision of THIS reading, and not the one before it.  Empty where
    // the service sent none: a provenance line that repeated the old
    // revision beside a new table would be a false statement in the one
    // place the sheet exists to make true ones.
    revision: String(revision || ""),
    digest,
    form: table.form,
    error: table.error || null,
    columns: table.columns,
    rows: table.rows.slice(0, MAX_ROWS),
    count: rows,
    truncated: rows > MAX_ROWS,
    reread: {
      at: when,
      changed: digest !== entry.first.digest,
      was: entry.first.count,
      now: rows,
      since: entry.first.at,
    },
  };
}

/**
 * Add one entry, newest first.
 *
 * The same run dropped twice is one entry — the key carries the tab it came
 * from — and it moves to the front rather than appearing again, because a
 * reader who drops something a second time is looking for it, not asking for
 * two of it.
 */
export function addEntry(entries, entry, { max = MAX_ENTRIES } = {}) {
  const rest = (entries || []).filter((e) => e.key !== entry.key);
  return [entry, ...rest].slice(0, max);
}

/** Drop one entry by key. */
export function removeEntry(entries, key) {
  return (entries || []).filter((e) => e.key !== key);
}

/* ── drawing it ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** When something happened, in the form the rest of the interface uses. */
function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

/**
 * The time alone, which is what a result tab is labelled with.
 *
 * The editor labels each run `new Date().toLocaleTimeString()' and has since
 * before this repository's first commit; a reading kept out of one of those
 * tabs keeps the tab, so the same clock has to be read the same way or the
 * reader is comparing two spellings of one moment.
 */
function timeLabel(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString();
}

/**
 * What one entry says about itself before it says anything else.
 *
 * Six facts, in one line: which view, in which store, when it ran, how long
 * it took, what the store said its revision was, and the digest of the exact
 * document. The last two are what make a result in this sheet comparable
 * with the same result in a figure or a saved page, instead of merely
 * similar.
 */
export function provenanceLine(entry) {
  const parts = [`${entry.account}/${entry.repository}`, `ran ${when(entry.at)}`];
  if (entry.took != null) parts.push(`${entry.took} ms`);
  if (entry.revision) parts.push(`revision ${entry.revision}`);
  if (entry.arguments) parts.push(`arguments ${entry.arguments}`);
  parts.push(entry.digest.slice(0, 12));
  return parts.join("  ·  ");
}

/**
 * Whether this entry may be read again, and in whose words if not.
 *
 * Two reasons it may not, and both are about honesty rather than about
 * capability.  A reading with no query is a reading nothing can reproduce.
 * A reading taken with URL arguments is one this button would reproduce
 * WITHOUT them, which is a different question answered under the first
 * question's heading — the editor is where that run belongs.
 */
export function rerunnable(entry) {
  if (!entry?.query) {
    return { ok: false, why: "this reading did not keep the query that produced it" };
  }
  if (entry.arguments) {
    return { ok: false,
             why: `this ran with arguments (${entry.arguments}), which this button `
                + `cannot reproduce — run it again in the editor` };
  }
  return { ok: true, why: null };
}

/** What a re-read found, in a line. */
export function rereadLine(entry) {
  const r = entry?.reread;
  if (!r) return null;
  if (r.changed) {
    const rows = r.was === r.now
      ? `still ${r.now} row${r.now === 1 ? "" : "s"}, and not the same ones`
      : `${r.was} row${r.was === 1 ? "" : "s"} → ${r.now}`;
    return `read again ${when(r.at)} — it has moved since ${when(r.since)}: ${rows}`;
  }
  return `read again ${when(r.at)} — unchanged since ${when(r.since)}`;
}

/**
 * One result, as a card.
 *
 * The card is fronted by the TAB the reading came out of — the time, as the
 * editor labelled it — and that tab is the show/hide.  Two reasons it is the
 * tab and not a separate control: in the editor the tab is already what
 * selects a reading among several, so a reader who dropped three of them
 * here reaches for the same thing; and a sheet of full results is a sheet
 * that scrolls, so folding one away has to be possible without taking it
 * out, which is what the × does and cannot be undone.
 *
 * What folds is the body — the query and the table.  The head stays: it
 * carries which view this was, in which store, when, and the Run, Download
 * and × a folded reading still has to be reachable by.  A fold that hid
 * those would leave a row of times with nothing to tell them apart.
 *
 * Download is beside Run and never disabled, where Run is refused for a
 * reading it cannot reproduce (U-123).  The two buttons answer different
 * questions: Run asks whether this has moved, which a reading taken with
 * arguments cannot be asked; Download keeps what was read, which is always
 * possible, and the file says for itself whether it can ask again.
 */
export function renderEntry(entry) {
  const may = rerunnable(entry);
  const shut = Boolean(entry.collapsed);
  const head = `<div class="rs-head">`
    + `<button type="button" class="rs-tab" data-rs-toggle="${esc(entry.key)}"`
    + ` aria-expanded="${shut ? "false" : "true"}"`
    + ` title="${shut ? "Show this reading" : "Hide this reading"}">`
    + `${esc(entry.label || "")}</button>`
    + `<b>${esc(entry.view)}</b>`
    + `<span class="rs-count">${entry.form === "table"
        ? `${entry.count} row${entry.count === 1 ? "" : "s"}` : esc(entry.form)}</span>`
    + `<button type="button" class="rs-run" data-rs-run="${esc(entry.key)}"`
    + `${may.ok ? "" : " disabled"} title="${esc(may.ok
        ? "Read it again, under this account's own credentials" : may.why)}">Run</button>`
    + `<button type="button" class="rs-save" data-rs-download="${esc(entry.key)}" `
    + `title="Save this reading as a page — the rows as they were read, and its `
    + `query to ask again with">Download</button>`
    + `<button type="button" class="rs-drop" data-rs-remove="${esc(entry.key)}" `
    + `title="Take this out of the sheet">×</button>`
    + `</div>`
    + `<div class="rs-note">${esc(provenanceLine(entry))}</div>`
    + (entry.reread
        ? `<div class="rs-note ${entry.reread.changed ? "rs-moved" : ""}" `
        + `data-rs-verdict="${entry.reread.changed ? "moved" : "unchanged"}">`
        + `${esc(rereadLine(entry))}</div>`
        : "");

  const query = entry.query
    ? `<details class="rs-query"><summary>the query that produced it</summary>`
    + `<pre>${esc(entry.query)}</pre></details>`
    : "";

  const body = entry.error
    ? `<p class="rs-error">${esc(entry.error)}</p>`
    : entry.columns.length
      ? `<div class="rs-table"><table><thead><tr>`
        + entry.columns.map((c) => `<th>${esc(c)}</th>`).join("")
        + `</tr></thead><tbody>`
        + entry.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
        + `</tbody></table></div>`
        + (entry.truncated
            ? `<p class="rs-note">the first ${MAX_ROWS} rows of ${entry.count} are drawn — `
            + `the sheet is for looking, not for reading a result whole</p>` : "")
      : `<p class="rs-note">the result carried no rows this sheet can draw</p>`;

  return `<article class="rs-entry" data-rs-key="${esc(entry.key)}"`
       + `${shut ? ` data-rs-collapsed=""` : ""}>${head}`
       + `<div class="rs-body"${shut ? " hidden" : ""}>${query}${body}</div></article>`;
}

/** The sheet, whole.  Empty is a sentence and not a blank box. */
export function renderSheet(entries) {
  if (!entries || !entries.length) {
    // What is here, and how something gets here.  The gesture is named as
    // it is made: a result tab is dragged onto the Results tab in the left
    // margin -- this pane is hidden while the editor is in front, so the tab
    // is what has a layout box and the tab is what takes the drop.
    return `<div class="rs-empty">`
      + `<b>Readings</b> — drag a result tab from an editor onto the <b>Results</b> tab — the `
      + `graph icon — in the left margin, or press <b>→</b> on the tab to send it here `
      + `without a drag. `
      + `What lands is the result as it was read: the rows, the query, when it ran `
      + `and the revision the store answered with. Dropping it runs nothing; `
      + `<b>Run</b> reads it again under this account's own credentials and says whether `
      + `it has moved. Nothing is kept past this page.`
      + `</div>`;
  }
  return entries.map(renderEntry).join("");
}

export default renderSheet;
