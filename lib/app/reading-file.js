/**
 * A kept reading, as a file somebody can keep (U-123).
 *
 * The sheet holds a reading for this page and says so: nothing it holds
 * survives a reload, because a store of results read at unrecorded moments
 * under unrecorded credentials is the thing this interface is built not to
 * have (U-117).  That is the right rule for a working surface and it is
 * exactly why a reading needs a way OUT of it.  A reader who has dropped a
 * result here because it matters has, until now, two ways to keep it: leave
 * the tab open, or screenshot it.
 *
 * So: the same file everything else downloads to.  U-111 settled what a
 * document that travels is — the file and a sandboxed frame, the data
 * inlined so it draws with no network, the query inlined so the reader can
 * ask again, and the credential typed in by whoever opens it and written
 * nowhere — and U-122 declined to invent a second kind of artifact for a
 * presentation.  A reading is the same question a third time.
 *
 * Two things differ from the presentation's file, and both are the reading's
 * own character rather than a shortcoming:
 *
 *   * **it holds data, and the whole of it.**  A presentation moved here by
 *     reference has run nothing, so its file opens empty.  A reading IS what
 *     ran, so its file opens with the rows — and with all of them, not the
 *     first `MAX_ROWS' the sheet draws.  The sheet truncates because a sheet
 *     is for looking; a file is what the reading is kept AS.
 *
 *   * **it refreshes under exactly the rule the Run button follows.**
 *     `rerunnable' already says when a reading may be read again and why
 *     not: no query kept, or arguments this cannot reproduce.  A file whose
 *     Refresh ran the same query WITHOUT the arguments it was taken with
 *     would answer a different question under the first question's heading —
 *     the defect the Run button refuses — so such a reading travels with its
 *     data and with NO address, and its Refresh says so rather than asking
 *     for a credential first.  One rule, two places that obey it.
 *
 * Nothing here touches the DOM or the network: the judgement is here, where
 * node can test it, and the blob and the anchor are in the component.
 */

import { digestResult } from "../mcp/result-digest.js";
import { buildSavedPage } from "../dashboard/frame.js";
import { provenanceLine, rerunnable } from "./results.js";

/**
 * What the one panel is called.
 *
 * A fixed word and not the view's name, because the name goes into a
 * `[data-bound="…"]' selector in the page: a view called `sales 2026' or
 * `a/b' would be a selector that throws, in a file that is already written
 * and already downloaded.  The view's name is in the title, the heading and
 * the provenance line, where it cannot break anything.
 */
export const READING_PANEL = "reading";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/**
 * The reading, as the page's own results map.
 *
 * The result document as it was read, not the sheet's drawn table: the sheet
 * keeps display text for columns and rows and keeps 200 of them, and a file
 * built from that would be a transcription of a screen rather than a copy of
 * an answer.  The digest is taken by the same function the file's own
 * refresh will use on what comes back, so the two numbers are comparable —
 * which is the whole reason a saved page carries one.
 */
export function resultsOfReading(entry) {
  if (entry?.error) {
    return { [READING_PANEL]: { ok: false, mimeType: null, text: "", digest: null,
                                rows: null, error: String(entry.error) } };
  }
  const text = entry?.results == null ? "" : JSON.stringify(entry.results);
  const mimeType = "application/sparql-results+json";
  const d = digestResult(text, mimeType);
  return { [READING_PANEL]: { ok: true, mimeType, text, digest: d.digest, rows: d.rows } };
}

/**
 * What the file says about itself, above the table.
 *
 * Phrased as what was SAVED and never as what is on the screen.  The page's
 * Refresh replaces the rows below this line, and a line reading "ran at
 * 14:32" over a table read this morning is the one false statement the whole
 * sheet exists to prevent — so the line states the reading this copy was
 * made from, which stays true however often the file is refreshed.
 */
export function savedLine(entry) {
  return `Saved from a reading of ${esc(entry.view)} — ${esc(provenanceLine(entry))}.`;
}

/** The spec a reading becomes: one panel, one view, one bound slot. */
export function specOfReading(entry, { source = null } = {}) {
  const may = rerunnable(entry);
  const html =
      `<section class="reading">`
    + `<h1>${esc(entry.view)}</h1>`
    + `<p class="reading-saved">${savedLine(entry)}</p>`
    + (may.ok
        ? `<p class="reading-saved">Refresh runs the query below again and replaces the `
        + `table with what the store holds now.</p>`
        : `<p class="reading-saved">This copy cannot be refreshed: ${esc(may.why)}.</p>`)
    + `<section data-bound="${READING_PANEL}"></section>`
    + (entry.query
        ? `<details class="reading-query"><summary>the query that produced it</summary>`
        + `<pre>${esc(entry.query)}</pre></details>`
        : `<p class="reading-saved">This reading did not keep the query that produced it.</p>`)
    + `</section>`;
  return {
    title: `${entry.view} — ${entry.account}/${entry.repository}`,
    uses: [],
    parameters: [],
    /* The panel carries its own source, which is where a refresh goes (U-84)
       and which is what the file's policy opens `connect-src' to.  Both come
       off the same object, so a file that may not refresh reaches nothing
       either — the policy agrees with the sentence. */
    panels: source
      ? [{ name: READING_PANEL, query: String(entry.query || ""),
           accept: "application/sparql-results+json", source: { ...source } }]
      : [{ name: READING_PANEL, query: String(entry.query || ""),
           accept: "application/sparql-results+json" }],
    transforms: [],
    assertions: [],
    views: [{ name: "main", title: entry.view, html }],
    styles: `.reading { max-width: 60rem; margin: 0 auto; }\n`
          + `.reading-saved { color: #555; font-size: 0.9em; }\n`
          + `.reading-query pre { white-space: pre-wrap; }\n`,
    script: "",
    state: {},
    notes: null,
  };
}

/**
 * A name for the file: the view, and when it was read.
 *
 * The moment is in the name because the same view downloaded twice is two
 * readings and not two copies of one, and a second file that silently
 * replaced the first in a downloads folder would lose the comparison the
 * reader kept both of them for.
 */
export function fileNameFor(entry) {
  const base = String(entry?.view || "reading").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reading";
  const at = String(entry?.at || "").replace(/[-:]/g, "").replace(/\.\d+Z?$/, "")
    .replace(/[^0-9T]/g, "");
  return `${base}${at ? `-${at}` : ""}.html`;
}

/**
 * Where a copy of this reading would run its query, or null.
 *
 * Null whenever the Run button is refused, and for the reason it is refused:
 * the address is what makes a Refresh possible, so a reading that may not be
 * read again must not travel with one.  Null also when the interface has no
 * host for the account — a file addressed at a guess is worse than a file
 * that says it has no address.
 */
export function sourceOfReading(entry, { host = null } = {}) {
  if (!host || !entry?.account || !entry?.repository) return null;
  if (!rerunnable(entry).ok) return null;
  return { host: String(host).replace(/\/$/, ""),
           account: String(entry.account), repository: String(entry.repository) };
}

/**
 * The file, and what to say about it.
 *
 * The sentence carries the two facts that are invisible in the file itself
 * and matter to whoever it is sent on to: what this copy holds, and whether
 * it can ask again.
 */
export function readingFile(entry, { host = null, at = null } = {}) {
  if (!entry) return { ok: false, error: "there is no reading to save" };
  const source = sourceOfReading(entry, { host });
  const spec = specOfReading(entry, { source });
  const results = resultsOfReading(entry);
  const html = buildSavedPage(spec, { results, source, at });
  const held = entry.error
    ? "the error the store answered with"
    : `${entry.count} row${entry.count === 1 ? "" : "s"}`;
  const taken = new Date(entry.at);
  const when = Number.isNaN(taken.getTime()) ? String(entry.at) : taken.toLocaleString();
  const may = rerunnable(entry);
  const message = source
    ? `\`${entry.view}' saved as a page. It holds the reading taken ${when} — ${held} — and `
    + `its query runs against ${source.account}/${source.repository} when you press Refresh `
    + `in it, under a credential you type into the file. The file never holds one.`
    : `\`${entry.view}' saved as a page. It holds the reading taken ${when} — ${held} — and `
    + `no address to ask again at: ${may.ok
        ? `this interface has no signed-in host for \`${entry.account}'`
        : may.why}. Its Refresh says so rather than asking for a credential.`;
  return { ok: true, html, name: fileNameFor(entry), source, message };
}

export default readingFile;
