/**
 * The result sheet (U-117).
 *
 * The drag has existed since before this repository's first commit and the
 * drop has never existed at all: `dragstart` wrote a `result-sheet` payload
 * and then looked for `result-sheet-drop-zone', which is in no file in the
 * tree and in no commit in its history.  So the gesture ended wherever it
 * was let go and nothing happened, which is the exact failure the rest of
 * this interface is written to refuse — a thing that looks as though it did
 * something.
 *
 * What is decided here rather than in a browser: what a drop may be, what a
 * term reads as, what one entry keeps about where it came from, and what
 * happens to the same result dropped twice.  The browser suite drives the
 * drag itself, which is the half that needs one.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-results-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  readDrop, tableOf, termText, entryOf, addEntry, removeEntry,
  renderSheet, renderEntry, provenanceLine, DROP_TYPE, SHEET_ATTRIBUTE,
  MAX_ROWS, MAX_ENTRIES, readingDigest, rereadEntry, rerunnable, rereadLine,
} = await load("app/results.js");
const { contentDigest } = await load("mcp/result-digest.js");
const { readingFile, specOfReading, resultsOfReading, fileNameFor, READING_PANEL }
  = await load("app/reading-file.js");

let passed = 0, failed = 0;
const ok = (c, what) => {
  if (c) { passed += 1; console.log(`  ok  ${what}`); }
  else { failed += 1; console.log(`  FAIL ${what}`); }
};
const section = (t) => console.log(`\n${t}`);

const RESULTS = {
  head: { vars: ["s", "n", "label"] },
  results: { bindings: [
    { s: { type: "uri", value: "http://example.org/a" },
      n: { type: "literal", value: "3", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
      label: { type: "literal", value: "first", "xml:lang": "en" } },
    { s: { type: "bnode", value: "b0" },
      n: { type: "literal", value: "4" } },
  ] },
};

const payload = (over = {}) => ({
  type: DROP_TYPE, viewName: "census", accountName: "james", repositoryName: "ns223",
  tabId: "tab-1", key: "view:james/ns223/census",
  tab: { id: "tab-1", query: "SELECT * WHERE { ?s ?p ?o }", results: RESULTS,
         executionTime: 42, etag: "W/\"7\"", urlArguments: "",
         createdAt: "2026-11-23T10:00:00.000Z" },
  ...over,
});

/* ── what may be dropped ──────────────────────────────────────────────────── */

section("U-117: a drop is parsed, not assumed — anything may be dropped on anything");
{
  ok(readDrop(JSON.stringify(payload())).ok, "the editor's own payload is taken");
  ok(!readDrop("").ok && /nothing came with the drop/.test(readDrop("").error),
     "an empty drop says so");
  const text = readDrop("a file, probably");
  ok(!text.ok && /not a result/.test(text.error),
     `text that is not JSON says what it is not: ${text.error}`);
  const other = readDrop(JSON.stringify({ type: "something-else" }));
  ok(!other.ok && /`something-else'/.test(other.error),
     `JSON of another kind is named in the refusal: ${other.error}`);
  const bare = readDrop(JSON.stringify({ type: DROP_TYPE }));
  ok(!bare.ok && /without its data/.test(bare.error),
     "and our own type with no result in it is refused rather than filed empty");
}

/* ── what a result reads as ───────────────────────────────────────────────── */

section("U-117: a term shows its kind, because in RDF the kind is not decoration");
{
  ok(termText({ type: "uri", value: "http://example.org/a" }) === "<http://example.org/a>",
     "an IRI is in angle brackets");
  ok(termText({ type: "bnode", value: "b0" }) === "_:b0", "a blank node carries `_:'");
  ok(termText({ type: "literal", value: "first", "xml:lang": "en" }) === '"first"@en',
     "a language-tagged literal keeps its tag");
  ok(termText({ type: "literal", value: "3", datatype: "http://www.w3.org/2001/XMLSchema#integer" })
       === '"3"^^<http://www.w3.org/2001/XMLSchema#integer>',
     "and a typed one its datatype");
  ok(termText({ type: "literal", value: "plain" }) === "plain",
     "a plain literal is drawn plainly — the marks are there to distinguish, not to decorate");
  ok(termText(null) === "" && termText(undefined) === "",
     "an unbound variable is an empty cell and not the word `undefined'");
}

section("U-117: the three shapes a result comes in");
{
  const t = tableOf(RESULTS);
  ok(t.form === "table" && t.columns.join(",") === "s,n,label", "a SELECT is columns and rows");
  ok(t.rows.length === 2 && t.rows[1][2] === "",
     "with an unbound variable left empty rather than dropped, so the columns still line up");
  const b = tableOf({ boolean: true });
  ok(b.form === "boolean" && b.rows[0][0] === "true", "an ASK is one cell");
  const e = tableOf({ error: { message: "the store refused" } });
  ok(e.form === "error" && /refused/.test(e.error),
     "and a failure is carried as the failure, not as an empty table");
}

/* ── what an entry keeps ──────────────────────────────────────────────────── */

section("U-117: an entry says when the reading was taken, and of what");
{
  const e = entryOf(payload());
  ok(e.at === "2026-11-23T10:00:00.000Z",
     "`at' is when the query RAN, not when it was dropped — the sheet holds a "
     + "reading, and when it was taken is the only date that qualifies it");
  ok(e.revision === 'W/"7"', "the repository revision the store answered with is kept");
  ok(e.took === 42 && e.count === 2, "how long it took and how much came back");
  ok(e.digest === readingDigest(tableOf(RESULTS)),
     "and the digest is of the READING — the columns and the rows — because the "
     + "one comparison it is for is a drop against a re-run, which arrive as a "
     + "parsed object and as text and would otherwise be compared as spellings");
  ok(e.digest !== contentDigest(JSON.stringify(RESULTS)),
     "which is deliberately not the digest of the document a figure's provenance "
     + "strip carries: the same function over a different subject, said rather "
     + "than left to be assumed");
  ok(e.first.at === e.at && e.first.digest === e.digest && e.first.count === e.count,
     "the reading it arrived with is kept beside it, for a re-read to compare against");
  ok(e.query === "SELECT * WHERE { ?s ?p ?o }", "the query that produced it travels with it");

  const line = provenanceLine(e);
  ok(/james\/ns223/.test(line) && /42 ms/.test(line) && /revision/.test(line)
     && line.includes(e.digest.slice(0, 12)),
     `all of it is on one line under the heading: ${line}`);
}

section("U-117: a result too long to draw says so rather than drawing half in silence");
{
  const many = { head: { vars: ["n"] },
                 results: { bindings: Array.from({ length: MAX_ROWS + 10 },
                   (_, i) => ({ n: { type: "literal", value: String(i) } })) } };
  const e = entryOf(payload({ tab: { ...payload().tab, results: many } }));
  ok(e.count === MAX_ROWS + 10 && e.rows.length === MAX_ROWS,
     `the count is the whole result (${e.count}) and the drawing is capped (${e.rows.length})`);
  ok(e.truncated === true, "and it is marked as capped");
  ok(/the first 200 rows of 210 are drawn/.test(renderEntry(e)),
     "which the card says in words, with both numbers");
}

/* ── the sheet ────────────────────────────────────────────────────────────── */

section("U-119: reading it again, under the account's own credentials");
{
  const e = entryOf(payload());
  ok(rerunnable(e).ok, "an entry that kept its query can be read again");

  const same = rereadEntry(e, { results: RESULTS, at: "2026-11-23T12:00:00.000Z", took: 11,
                                revision: 'W/"8"' });
  ok(same.reread && same.reread.changed === false,
     "the same rows come back as unchanged — the verdict is explicit, because a "
     + "re-read that reported a later time and left the reader to diff two tables "
     + "by eye is the work they pressed the button to avoid");
  ok(same.at === "2026-11-23T12:00:00.000Z" && same.took === 11,
     "the entry now describes the new reading");
  ok(same.revision === 'W/"8"',
     "with the revision THIS reading was of, and not the one before it");
  ok(same.first.at === e.at && same.first.digest === e.digest,
     "while the first reading is untouched, so the comparison stays against what "
     + "the reader actually looked at");
  ok(/unchanged since/.test(rereadLine(same)), `and says so: ${rereadLine(same)}`);

  const grown = { head: { vars: ["s", "n", "label"] },
                  results: { bindings: [...RESULTS.results.bindings,
                    { s: { type: "uri", value: "http://example.org/c" },
                      n: { type: "literal", value: "5" } }] } };
  const moved = rereadEntry(e, { results: grown, at: "2026-11-23T12:30:00.000Z" });
  ok(moved.reread.changed === true && moved.reread.was === 2 && moved.reread.now === 3,
     "a result that grew is reported as moved, with both counts");
  ok(/2 rows → 3/.test(rereadLine(moved)), `in a line: ${rereadLine(moved)}`);

  const swapped = { head: { vars: ["s", "n", "label"] },
                    results: { bindings: [RESULTS.results.bindings[1],
                                          RESULTS.results.bindings[0]] } };
  const reordered = rereadEntry(e, { results: swapped });
  ok(reordered.reread.changed === true && /not the same ones/.test(rereadLine(reordered)),
     "and the same NUMBER of different rows is still a change, said in those words "
     + `rather than as a count that did not move: ${rereadLine(reordered)}`);

  ok(rereadEntry(e, { results: RESULTS }).revision === "",
     "a re-read the service sent no revision for says none, rather than repeating "
     + "the old one beside a new table");
}

section("U-119: what cannot be read again says why, on the control");
{
  const noQuery = entryOf(payload({ tab: { ...payload().tab, query: null } }));
  ok(!rerunnable(noQuery).ok && /did not keep the query/.test(rerunnable(noQuery).why),
     "a reading with no query cannot be reproduced by anything");
  const withArgs = entryOf(payload({ tab: { ...payload().tab, urlArguments: "limit=10" } }));
  const why = rerunnable(withArgs).why;
  ok(!rerunnable(withArgs).ok && /limit=10/.test(why) && /in the editor/.test(why),
     `and one taken with arguments says which, and where it can be run: ${why}`);
  ok(/disabled/.test(renderEntry(withArgs)) && renderEntry(withArgs).includes(why),
     "the reason is on the control rather than discovered by pressing it");
  ok(/<button type="button" class="rs-run"/.test(renderEntry(entryOf(payload()))),
     "while an ordinary entry gets the control enabled");
}

section("U-117: the same run dropped twice is one entry, moved to the front");
{
  const first = entryOf(payload());
  const other = entryOf(payload({ viewName: "other", tabId: "tab-2",
                                  key: "view:james/ns223/other",
                                  tab: { ...payload().tab, id: "tab-2" } }));
  let held = addEntry(addEntry([], first), other);
  ok(held.length === 2 && held[0].view === "other", "newest first");
  held = addEntry(held, entryOf(payload()));
  ok(held.length === 2 && held[0].view === "census",
     "the same run again is not a second copy — it moves to the front, because a "
     + "reader who drops something twice is looking for it");
  ok(removeEntry(held, held[0].key).length === 1, "and one can be taken out by key");
}

section("U-117: the sheet is capped, oldest first out");
{
  let held = [];
  for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
    held = addEntry(held, entryOf(payload({ tabId: `t${i}`, tab: { ...payload().tab, id: `t${i}` } })));
  }
  ok(held.length === MAX_ENTRIES, `it holds ${MAX_ENTRIES} and no more`);
  ok(held[0].key.endsWith(`#t${MAX_ENTRIES + 4}`), "the newest is kept");
}

section("U-117: an empty sheet is a sentence, and it says what it does not do");
{
  const empty = renderSheet([]);
  ok(/drag a result tab/i.test(empty) && /press <b>→<\/b>/.test(empty),
     "it names both ways of putting something in it, because a drag is a "
     + "gesture some readers cannot make and all readers can miss");
  ok(/<b>Results<\/b> tab — the `?\s*graph icon — in the `?\s*left margin/.test(empty),
     "and it names WHERE the drag goes (U-120): the pane is hidden while the "
     + "editor is in front, so the tab in the margin is what takes the drop");
  ok(/Dropping it runs\s+nothing/.test(empty),
     "that DROPPING runs nothing — a drop spends no grant and needs no credential");
  ok(/<b>Run<\/b> reads it again under this account's own credentials/.test(empty),
     "and that reading it again is a press, under the account's own credentials: "
     + "the sheet does not travel, so nothing has to be carried into it");
  ok(/Nothing is kept past this page/.test(empty),
     "and that it keeps nothing, rather than leaving a reader to find that out "
     + "by reloading");
}

section("U-117: what is drawn is escaped, because a result is somebody else's text");
{
  const nasty = { head: { vars: ["x"] },
                  results: { bindings: [{ x: { type: "literal",
                    value: '<img src=x onerror="boom">' } }] } };
  const e = entryOf(payload({ viewName: '<b>view</b>',
                              tab: { ...payload().tab, results: nasty,
                                     query: "SELECT <script>" } }));
  const html = renderEntry(e);
  ok(!/<img src=x/.test(html) && /&lt;img src=x/.test(html),
     "a value out of the store cannot be markup");
  ok(!/<b>view<\/b>/.test(html), "nor can a view's name");
  ok(/&lt;script&gt;/.test(html), "nor the query text");
  ok(html.includes(`data-rs-key="${e.key}"`), "and the key the remove control uses is on the card");
}

/* ── the tab it came out of ────────────────────────────────── */

section("U-121: a kept reading keeps its tab, and the tab is the show/hide");
{
  const ran = new Date("2026-11-23T10:00:00.000Z").toLocaleTimeString();

  const own = entryOf(payload({ tab: { ...payload().tab, label: "10:00:00" } }));
  ok(own.label === "10:00:00",
     "the label the editor put on the tab is the label the sheet shows — the same "
     + "moment formatted by the same call, so the tab here reads as the tab there");

  const e = entryOf(payload());
  ok(e.label === ran,
     `a payload that carried no label is labelled from the moment it ran (${e.label}), `
     + `and from the moment it RAN rather than the moment it was dropped`);
  ok(e.collapsed === false, "and it arrives open: what was just dropped is what is being looked at");

  const open = renderEntry(e);
  ok(open.includes(`data-rs-toggle="${e.key}"`) && /class="rs-tab"/.test(open)
     && open.includes(`>${ran}</button>`),
     "the card is fronted by a tab bearing that time, and the tab is a button");
  ok(/aria-expanded="true"/.test(open) && /class="rs-body"(?! hidden)/.test(open),
     "open, said in the one place a reader who cannot see the caret can read it");

  const shut = renderEntry({ ...e, collapsed: true });
  ok(/aria-expanded="false"/.test(shut) && /class="rs-body" hidden/.test(shut)
     && /data-rs-collapsed/.test(shut),
     "folded, the body is hidden — by the attribute, so it is hidden for a reader "
     + "who is listening rather than looking too");
  ok(shut.includes("census") && /data-rs-run/.test(shut) && /data-rs-remove/.test(shut)
     && shut.includes(ran),
     "and the head survives the fold: which view this was, its Run and its ×. A fold "
     + "that hid those would leave a row of times with nothing to tell them apart");
  ok(open.indexOf('class="rs-body"') < open.indexOf("<table")
     && open.indexOf('class="rs-body"') < open.indexOf("rs-query"),
     "the table and the query are inside what folds, which is the bulk of what a "
     + "fold is for; the head is outside it");

  /* A re-read is a new reading.  The tab says when the reading it fronts was
     taken, so the tab moves with it — a tab still showing the dropped
     reading's time over a table read a minute ago is the one false statement
     this sheet exists to prevent. */
  const again = rereadEntry(e, { results: RESULTS, at: "2026-11-23T11:30:00.000Z",
                                 took: 9, revision: 'W/"8"' });
  ok(again.label === new Date("2026-11-23T11:30:00.000Z").toLocaleTimeString()
     && again.label !== e.label,
     `a re-read moves the tab's time with the reading (${e.label} → ${again.label})`);
  ok(again.collapsed === false,
     "and leaves the fold as it found it — pressing Run is not asking for it to close");
}

section("U-117: the sheet is marked where the editor can find it");
{
  ok(SHEET_ATTRIBUTE === "data-result-sheet",
     "by an attribute and not by an id: with two repository panes open an id "
     + "answers with whichever sheet is first in the document, which files a "
     + "result under a repository it did not come from");
}


/* ═══════════ U-123: a reading goes out as a file, or it goes nowhere ═══════ */

section("U-123: the card offers Download beside Run");
{
  const card = renderEntry(entryOf(payload()));
  const key = "view:james/ns223/census#tab-1";
  ok(card.includes(`data-rs-download="${key}"`) && /class="rs-save"/.test(card),
     "the panel a drop creates carries a Download, keyed by the reading it is on");
  ok(card.indexOf('data-rs-run=') < card.indexOf('data-rs-download='),
     "beside Run and after it: Run is what this card was already for");

  /* The two buttons answer different questions, so the one that is refused
     does not refuse the other.  A reading taken with URL arguments cannot be
     re-run by this button — it would drop them — but it can certainly be
     kept, and the file it is kept as says for itself that it cannot ask
     again. */
  const withArgs = entryOf(payload({ tab: { ...payload().tab, urlArguments: "year=2026" } }));
  const argCard = renderEntry(withArgs);
  ok(/class="rs-run"[^>]*disabled/.test(argCard.replace(/\n/g, "")),
     "a reading taken with arguments may not be re-read, and the control says so");
  ok(!/class="rs-save"[^>]*disabled/.test(argCard.replace(/\n/g, "")),
     "and may still be downloaded — keeping what was read asks nobody for anything");
}

section("U-123: what the file holds, and what it must not");
{
  const entry = entryOf(payload());
  const built = readingFile(entry, { host: "https://nl4.dydra.com",
                                     at: "2026-11-25T09:00:00.000Z" });
  ok(built.ok, "a dropped reading builds a file");
  ok(built.html.includes('id="saved-page-data"') && built.html.includes('id="saved-page-frame"'),
     "and it is the form U-111 settled — the file and the sandboxed frame — "
     + "rather than a second kind of artifact invented for a reading");

  const blob = built.html.split('id="saved-page-data">')[1].split("</script>")[0];
  const held = JSON.parse(blob.replace(/\\u003c/g, "<"));

  ok(held.spec.panels.length === 1 && held.spec.panels[0].name === READING_PANEL
     && held.spec.panels[0].query === "SELECT * WHERE { ?s ?p ?o }",
     "the query that produced the reading travels with it, which is what a refresh runs");
  ok(held.page.includes(`data-bound="${READING_PANEL}"`),
     "and the page has a slot bound to that panel by the same name — a panel the page "
     + "does not name is a file that opens blank");

  const data = JSON.parse(held.results[READING_PANEL].text);
  ok(data.results.bindings.length === RESULTS.results.bindings.length
     && data.results.bindings[0].s.value === "http://example.org/a",
     "the rows travel as the result document they were read as, not as the sheet's "
     + "display text — an IRI is still an IRI in the file");

  ok(held.source.host === "https://nl4.dydra.com" && held.source.account === "james"
     && held.source.repository === "ns223",
     "the address is the reading's OWN account and repository, at the host that "
     + "account is signed in to");
  ok(/connect-src https:\/\/nl4\.dydra\.com/.test(built.html),
     "and the policy opens only that origin, so the limit is the browser's and not "
     + "this module's good intentions");
  /* By the KEYS of what travels and not by a regular expression over the
     document: the file carries the library's own source, which contains the
     word "token" in a comment about a syntax error, and an assertion that
     passes only until somebody writes that word is an assertion about
     prose. */
  const keys = (v, out = []) => {
    if (!v || typeof v !== "object") return out;
    for (const [k, x] of Object.entries(v)) { out.push(k); keys(x, out); }
    return out;
  };
  ok(!keys(held).some((k) => /token|password|credential|authorization/i.test(k)),
     "nothing in the file is a credential — the reader types one into the copy, and "
     + "it is held in a closure for as long as the tab is open");
  ok(Object.keys(held.source).sort().join() === "account,host,repository",
     "what travels of the address is the address: three fields and no fourth");

  ok(/Saved from a reading of census/.test(held.page),
     "the page states the reading it was made FROM, in the past tense");
  ok(!/\bran\b[^<]*<\/p>\s*<section data-bound/.test(held.page.replace(/\n/g, "")),
     "and does not describe what is on the screen, which a Refresh would make false");
}

section("U-123: the whole reading, not the drawn part of it");
{
  const many = { head: { vars: ["n"] },
                 results: { bindings: Array.from({ length: MAX_ROWS + 50 },
                   (_, i) => ({ n: { type: "literal", value: String(i) } })) } };
  const entry = entryOf(payload({ tab: { ...payload().tab, results: many } }));
  ok(entry.rows.length === MAX_ROWS && entry.count === MAX_ROWS + 50,
     `the sheet draws ${MAX_ROWS} of ${MAX_ROWS + 50} rows, because a sheet is for looking`);
  const held = JSON.parse(readingFile(entry, { host: "https://nl4.dydra.com" }).html
    .split('id="saved-page-data">')[1].split("</script>")[0].replace(/\\u003c/g, "<"));
  ok(JSON.parse(held.results[READING_PANEL].text).results.bindings.length === MAX_ROWS + 50,
     "and the file holds all of them, because a file is what the reading is kept AS");
}

section("U-123: a reading that cannot ask again travels with no address");
{
  const withArgs = entryOf(payload({ tab: { ...payload().tab, urlArguments: "year=2026" } }));
  const built = readingFile(withArgs, { host: "https://nl4.dydra.com" });
  ok(built.ok && built.source === null,
     "a reading taken with arguments records no address: its Refresh would run the "
     + "same query WITHOUT them, which is a different question under the first "
     + "question's heading — the rule the Run button already follows");
  const policy = built.html.split('Content-Security-Policy" content="')[1].split('"')[0]
    .replace(/&#39;/g, "'");
  ok(/connect-src 'none'/.test(policy),
     "so the file reaches nothing at all, and the policy agrees with the sentence");
  ok(/cannot be refreshed/.test(built.html) && /year=2026/.test(built.html),
     "and the file says why, in the words the Run control uses");
  ok(/no address to ask again at/.test(built.message) && /year=2026/.test(built.message),
     "as does the line the sheet shows when the press lands");

  const noQuery = entryOf(payload({ tab: { ...payload().tab, query: null } }));
  const q = readingFile(noQuery, { host: "https://nl4.dydra.com" });
  ok(q.ok && q.source === null && /did not keep the query/.test(q.html),
     "a reading with no query keeps its data and says it cannot be reproduced");

  const noHost = readingFile(entryOf(payload()), { host: null });
  ok(noHost.ok && noHost.source === null
     && /no signed-in host for `james'/.test(noHost.message),
     "and a reading whose account this interface has no session for is saved with "
     + "its data and no guessed address");
}

section("U-123: two readings of one view are two files");
{
  const first = entryOf(payload());
  const later = rereadEntry(first, { results: RESULTS, at: "2026-11-23T11:30:00.000Z" });
  ok(/^census-20261123T\d{6}\.html$/.test(fileNameFor(first)),
     `the file is named for the view and the moment (${fileNameFor(first)})`);
  ok(fileNameFor(first) !== fileNameFor(later),
     "so a second reading does not silently replace the first in a downloads folder, "
     + "which is where the comparison both were kept for would be lost");
  ok(JSON.parse(resultsOfReading(later).reading.text) !== null
     && resultsOfReading(later)[READING_PANEL].rows === RESULTS.results.bindings.length,
     "and a re-read is downloaded as the reading it now is, not the one it arrived as");
  ok(specOfReading(first, { source: null }).panels[0].source === undefined,
     "a spec built with no address carries none on its panel either — the two are "
     + "the same fact and cannot disagree");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
