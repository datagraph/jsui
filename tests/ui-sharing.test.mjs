/**
 * Reading a presentation somebody else wrote (U-74; D-AM).
 *
 * This is the first phase whose failures are not cosmetic. Every earlier one
 * could be wrong and produce a page that looked odd; this one can be wrong
 * and run another account's JavaScript against the reader's grant, inside a
 * frame whose channel reaches the reader's panels and parameters.
 *
 * So the suite is organised around what an adversary would try, not around
 * the API:
 *
 *   1. **Find the carrier that was forgotten.** D-AM named the page script.
 *      A transform body is `new Function(…, body)` in the same frame with the
 *      same `api`, and a `ui:Html` blob runs inline `<script>` because the
 *      CSP says `script-src 'unsafe-inline'`. All three, or none.
 *   2. **Get an old approval to cover new code.** The approval is recorded
 *      against a digest of everything executable, so changing any of it
 *      withholds again — and the digest is SHA-256, because sixty-four bits
 *      of FNV is forgeable by exactly the person who wants this.
 *   3. **Make the check not run.** An unreadable admission store, a missing
 *      SubtleCrypto, an absent `creator`, a reader who is not signed in: each
 *      has to fail CLOSED, and each is asserted here rather than reasoned
 *      about.
 *
 * And one claim in the other direction, because a security measure that
 * fires on the reader's own pages is one that gets turned off: a document
 * you wrote yourself is returned untouched and is not even fingerprinted.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-sharing-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  authorOf, isForeign, carriersOf, executableParts, digestOf, fingerprint,
  strongDigestAvailable, withhold, withheldBody, withheldMarkup, describeWithheld,
  noticeFor, screenPresentation,
} = await load("app/sharing.js");
const {
  presentationGraph, graphFromPresentation, writePresentation, readPresentation,
  openPresentation, readAdmission, admitPresentation, withdrawAdmission, listAdmissions,
} = await load("app/ui-store.js");
const { validateApplication } = await load("app/document.js");
const { buildPage, CSP } = await load("dashboard/frame.js");
const { T } = await load("app/vocabulary.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const HOST = "https://nl4.dydra.com";
const OWNER = "bob";
const READER = "alice";
const NAME = "inventory";
const GRAPH = presentationGraph(HOST, OWNER, NAME);
const Q = "SELECT ?region ?total WHERE { ?s :region ?region ; :total ?total }";

/** A page with all three carriers of executable text in it. */
const LOADED = validateApplication({
  title: "Inventory",
  uses: ["panel", "table"],
  panels: [{ name: "stock", query: Q }],
  transforms: [{ name: "ratio", inputs: ["stock"],
                 body: "return inputs.stock.rows.length;" },
               { name: "empty", inputs: [], body: "" }],
  assertions: [{ id: "note", text: "Stock is low.", inputs: ["stock"] }],
  script: "window.__ran = true;",
  styles: "body { background: #fff }",
  views: [{ name: "main", elements: [
    { name: "e-wrap", kind: "panel", order: "a", attributes: { label: "Stock" },
      children: [
        { name: "e-tab", kind: "table", order: "a", bound: "stock" },
        { name: "e-blob", kind: "html", order: "b",
          html: '<div data-asserted="note"><script>window.__blob = 1;<\/script></div>' },
      ] },
  ] }],
}).document;

/** The same page with nothing executable in it. */
const PLAIN = validateApplication({
  title: "Plain", uses: ["panel"], panels: [{ name: "stock", query: Q }],
  views: [{ name: "main", elements: [
    { name: "e-tab", kind: "table", order: "a", bound: "stock" }] }],
}).document;

const META = { creator: OWNER, scope: "document", name: NAME };
const CRYPTO = webcrypto;

/* ═══════════════ who wrote it ═══════════════ */

section("U-74: the author, and the fallback that stops old pages looking foreign");
{
  ok(authorOf({ creator: "bob" }, "carol") === "bob", "`ui:creator' is the author");
  ok(authorOf({}, "carol") === "carol",
     "and with none recorded the owning account is — a page saved before `creator' "
     + "existed is not authorless");
  ok(authorOf({ creator: "   " }, "carol") === "carol", "an empty creator is no creator");
  ok(authorOf({}, null) === null, "and with neither there is no author to name");
}

section("U-74: whose it is, and which way the unknown cases fall");
{
  ok(!isForeign({ owner: "alice", reader: "alice" }), "your own is not foreign");
  ok(!isForeign({ owner: "alice", creator: "Alice", reader: "alice" }),
     "compared without case, as accounts are compared everywhere else");
  ok(isForeign({ owner: "bob", reader: "alice" }), "somebody else's is");
  ok(isForeign({ owner: "alice", creator: "bob", reader: "alice" }),
     "and the CREATOR decides, not the repository it is sitting in — otherwise "
     + "copying a page into your own account would launder it");
  ok(isForeign({ owner: "alice", reader: null }),
     "nobody signed in reads everything as foreign: an anonymous reader has approved "
     + "nothing, and the other default would make `not signed in' the most permissive state");
  ok(isForeign({ owner: null, creator: null, reader: "alice" }),
     "and an unattributable page is foreign too");
}

/* ═══════════════ the three carriers ═══════════════ */

section("U-74: all three carriers of executable text are found");
{
  const parts = executableParts(LOADED);
  const kinds = parts.map((p) => p.what);
  ok(kinds.includes("script"), "the page script — the one D-AM named");
  ok(kinds.includes("transform"),
     "a transform body — `new Function(\"inputs\", \"api\", body)' in the same frame");
  ok(kinds.includes("markup"), "and a `ui:Html' blob, which may hold an inline <script>");
  ok(parts.filter((p) => p.what === "transform").length === 1,
     "a transform with an empty body is not a carrier and is not counted");
  ok(carriersOf(LOADED).length === 1 && carriersOf(LOADED)[0].name === "e-blob",
     "the carrier is found inside the tree, not only at its root");
  ok(executableParts(PLAIN).length === 0, "a page with none has none");
}

section("U-74: a view that is still legacy markup IS the carrier");
{
  // The shape every page had before phase 1, and the one this suite caught:
  // there is no `ui:Html' element to edit, the whole view is the blob, and
  // the frame renders `views[].html' either way.
  const legacy = validateApplication({
    title: "Old", panels: [{ name: "stock", query: Q }],
    html: '<div data-bound="stock"></div><script>window.__legacy = 1;<\/script>',
  }).document;
  ok(legacy.views[0].elements === null, "a markup view has no tree");
  ok(carriersOf(legacy).length === 1 && carriersOf(legacy)[0].name === null,
     "and is found as one carrier named by its view rather than by an element");
  const { document: safe, withheld } = withhold(legacy, { author: OWNER });
  ok(withheld.length === 1 && withheld[0].where === "main", "which is what is withheld");
  ok(!/__legacy/.test(buildPage(safe, {})), "so its script does not reach the page");
  ok(/__legacy/.test(buildPage(legacy, {})), "where unscreened it would");
  ok((await fingerprint(safe, { crypto: CRYPTO })) !== (await fingerprint(legacy, { crypto: CRYPTO })),
     "and the fingerprint covers it");
}

section("U-74: the generated projection is withheld with the tree it came from");
{
  // `views[].html' is a GENERATED copy of the tree's markup and is what the
  // frame renders.  Editing the tree alone withheld nothing -- the fault
  // this section exists to keep fixed.
  const { document: safe } = withhold(LOADED, { author: OWNER });
  ok(!/__blob/.test(safe.views[0].html),
     "the view's generated markup no longer holds the blob's script");
  ok(/data-withheld="markup"/.test(safe.views[0].html), "it holds the placeholder instead");
  const { document: again } = withhold(safe, { author: OWNER });
  ok(again.views[0].html === safe.views[0].html,
     "and screening an already-screened document changes nothing, so a document "
     + "does not drift by being read twice");
}

section("the frame's CSP is why a blob counts, and why a stylesheet does not");
{
  ok(/script-src [^;]*'unsafe-inline'/.test(CSP),
     "inline script runs in the frame, so markup is executable text");
  ok(/default-src 'none'/.test(CSP) && /img-src data:/.test(CSP),
     "and nothing may be fetched, so a foreign stylesheet cannot report that the "
     + "page was opened — which is why `styles' is not withheld");
}

/* ═══════════════ withholding ═══════════════ */

section("U-74: withholding takes all three, together");
{
  const { document: safe, withheld } = withhold(LOADED, { author: OWNER });
  ok(safe.script === null, "the script is gone");
  ok(safe.transforms[0].body === withheldBody(OWNER),
     "the transform body is replaced by a string literal and nothing else");
  ok(!/inputs\.stock/.test(JSON.stringify(safe)),
     "with no trace of the original anywhere in the document");
  const blob = safe.views[0].elements[0].children[1];
  ok(blob.html === withheldMarkup(OWNER), "the carrier's markup is replaced");
  ok(!/__blob/.test(JSON.stringify(safe)), "and the inline script in it is gone");
  ok(withheld.length === 3, `three parts were taken (${withheld.map((w) => w.what).join(", ")})`);
  ok(withheld.every((w) => w.bytes > 0), "each recorded with how much it was");
}

section("U-74: withholding keeps the page drawable, and the tree addressable");
{
  const { document: safe } = withhold(LOADED, { author: OWNER });
  ok(safe.transforms.length === LOADED.transforms.length,
     "a withheld transform is REPLACED, not removed");
  ok(/withheld/.test(withheldBody(OWNER)),
     "its body returns a sentence, so the slot reading it says so rather than "
     + "being silently empty — the failure the frame's own `did not run' avoids");
  const names = (d) => d.views[0].elements[0].children.map((c) => c.name).join();
  ok(names(safe) === names(LOADED),
     "every element name survives, so a later patch addresses the same tree");
  ok(safe.panels.length === 1 && safe.panels[0].query === Q,
     "the panels are untouched: a foreign query is Gate 1's question, not this one");
  ok(safe.styles === LOADED.styles, "and so is the stylesheet");
  ok(JSON.stringify(LOADED).includes("__blob"), "the caller's own document was not modified");
}

section("the replacements cannot themselves carry anything");
{
  const nasty = withheldMarkup('<img src=x onerror="alert(1)">');
  ok(!/<img/.test(nasty), "an author name is escaped into the placeholder");
  ok(/&lt;img/.test(nasty), `rather than being written through: ${nasty.slice(40, 90)}`);
  ok(JSON.parse(withheldBody('"); alert(1); //').match(/^return (.*);$/)[1])
       .includes('"); alert(1); //'),
     "and a name with quotes in it stays inside the string literal");
}

/* ═══════════════ the fingerprint ═══════════════ */

section("U-74: the approval is recorded against SHA-256, not against the fast digest");
{
  ok(digestOf("x").length === 16, "`digestOf' is 64 bits — change detection, not a control");
  ok(strongDigestAvailable(webcrypto), "SubtleCrypto is what an approval uses");
  const print = await fingerprint(LOADED, { crypto: CRYPTO });
  ok(/^[0-9a-f]{64}$/.test(print), `and it is a SHA-256: ${print.slice(0, 16)}…`);
  ok(await fingerprint(LOADED, { crypto: CRYPTO }) === print, "stable across calls");
}

section("U-74: the fingerprint covers every carrier, so none can be changed under it");
{
  const print = await fingerprint(LOADED, { crypto: CRYPTO });
  const changed = async (edit) => {
    const d = JSON.parse(JSON.stringify(LOADED));
    edit(d);
    return (await fingerprint(d, { crypto: CRYPTO })) !== print;
  };
  ok(await changed((d) => { d.script = "window.__ran = false;"; }), "the script is covered");
  ok(await changed((d) => { d.transforms[0].body = "return 2;"; }), "a transform body is");
  ok(await changed((d) => { d.views[0].elements[0].children[1].html = "<p>x</p>"; }),
     "a carrier's markup is");
  ok(await changed((d) => { d.transforms[0].name = "ratio2"; }),
     "and so is WHICH transform a body belongs to");
  ok(!(await changed((d) => { d.title = "Something else"; })),
     "a title is not: it is not executable, and a digest that moved on it would "
     + "ask the reader to approve a rename");
  ok(!(await changed((d) => { d.panels[0].caption = "x"; })), "nor is a caption");
}

section("U-74: the parts are length-prefixed, so bytes cannot be moved between them");
{
  // Without a length prefix, a script ending "ab" with a transform starting
  // "c" hashes the same as one ending "a" with a transform starting "bc".
  const one = validateApplication({ title: "t", panels: [{ name: "p", query: Q }],
    html: '<div data-bound="p"></div>', script: "ab",
    transforms: [{ name: "t", inputs: [], body: "c" }] }).document;
  const two = validateApplication({ title: "t", panels: [{ name: "p", query: Q }],
    html: '<div data-bound="p"></div>', script: "a",
    transforms: [{ name: "t", inputs: [], body: "bc" }] }).document;
  ok((await fingerprint(one, { crypto: CRYPTO })) !== (await fingerprint(two, { crypto: CRYPTO })),
     "`ab'+`c' and `a'+`bc' are different fingerprints");
}

/* ═══════════════ screening ═══════════════ */

section("U-74: your own page is returned untouched, and not even fingerprinted");
{
  const out = await screenPresentation({ document: LOADED, meta: { creator: READER },
                                         owner: READER, reader: READER, crypto: CRYPTO });
  ok(!out.foreign, "it is not foreign");
  ok(out.document === LOADED, "the same object comes back — nothing was copied or edited");
  ok(out.fingerprint === null,
     "and nothing was hashed: a digest of your own page answers no question and would "
     + "cost a hash of every transform on every open");
  ok(out.notice === null, "no mark, because there is nothing to say");
}

section("U-74: somebody else's is withheld and marked");
{
  const out = await screenPresentation({ document: LOADED, meta: META, owner: OWNER,
                                         reader: READER, crypto: CRYPTO });
  ok(out.foreign && !out.trusted, "it is foreign and not trusted");
  ok(out.document.script === null, "the script is not running");
  ok(out.withheld.length === 3, "nor the transform, nor the markup");
  ok(out.admissible, "and it can be admitted");
  ok(/Written by bob/.test(out.notice), `the mark names the author: ${out.notice}`);
  ok(/not running/.test(out.notice), "says what is not running");
  ok(/Admit it only if you would run bob's code yourself/.test(out.notice),
     "and says what admitting it means, in those words");
}

section("U-74: a foreign page with no code says so rather than saying nothing");
{
  const out = await screenPresentation({ document: PLAIN, meta: META, owner: OWNER,
                                         reader: READER, crypto: CRYPTO });
  ok(out.foreign && out.trusted, "foreign, and nothing is withheld");
  ok(out.withheld.length === 0 && out.document === PLAIN, "the document is untouched");
  ok(/carries no code/.test(out.notice), `and the mark says why it is safe: ${out.notice}`);
  ok(!out.admissible, "with nothing to admit");
}

section("U-74: an admission admits exactly the version it was given");
{
  const print = await fingerprint(LOADED, { crypto: CRYPTO });
  const admitted = { fingerprint: print, at: "2026-11-01T10:00:00Z" };
  const out = await screenPresentation({ document: LOADED, meta: META, owner: OWNER,
                                         reader: READER, admission: admitted, crypto: CRYPTO });
  ok(out.trusted && out.document === LOADED, "the admitted version runs");
  ok(/You admitted this version on 2026-11-01/.test(out.notice),
     `and says when: ${out.notice}`);

  const edited = JSON.parse(JSON.stringify(LOADED));
  edited.script = "window.__ran = 'something else';";
  const after = await screenPresentation({ document: edited, meta: META, owner: OWNER,
                                           reader: READER, admission: admitted, crypto: CRYPTO });
  ok(!after.trusted, "an edit since the admission is withheld again");
  ok(after.document.script === null, "with the new script not running");
  ok(/has CHANGED since you admitted it/.test(after.notice),
     `and the mark distinguishes that from a first visit: ${after.notice}`);
  ok(after.reason === "changed-since-admitted", "which the caller can also act on");
}

section("U-74: an admission of a DIFFERENT page does not carry");
{
  const other = await fingerprint(PLAIN, { crypto: CRYPTO });
  const out = await screenPresentation({ document: LOADED, meta: META, owner: OWNER,
                                         reader: READER, crypto: CRYPTO,
                                         admission: { fingerprint: other || "x".repeat(64) } });
  ok(!out.trusted, "a fingerprint that is not this page's admits nothing");
}

section("U-74: no SubtleCrypto means no approval can be recorded, so none is honoured");
{
  const out = await screenPresentation({ document: LOADED, meta: META, owner: OWNER,
                                         reader: READER, crypto: {} });
  ok(!out.trusted && out.document.script === null, "the code is withheld");
  ok(out.fingerprint === null && !out.admissible,
     "and it cannot be admitted — an approval that could not be tied to the code "
     + "it approved would be worse than none");
  ok(/not served over a secure connection/.test(out.notice),
     `the mark says why rather than looking like a refusal: ${out.notice}`);
  const forged = await screenPresentation({ document: LOADED, meta: META, owner: OWNER,
    reader: READER, crypto: {}, admission: { fingerprint: "a".repeat(64) } });
  ok(!forged.trusted,
     "and an admission presented when no digest can be computed is not honoured either");
}

section("describeWithheld / noticeFor: what the reader actually reads");
{
  ok(describeWithheld([{ what: "script" }]) === "the page's script", "one part");
  ok(describeWithheld([{ what: "script" }, { what: "transform" }, { what: "transform" }])
       === "the page's script and 2 transforms", "two kinds");
  ok(describeWithheld([{ what: "script" }, { what: "transform" }, { what: "markup" }])
       === "the page's script, 1 transform and 1 block of markup", "three");
  ok(describeWithheld([]) === "", "and none is nothing, not an empty list");
  ok(/is not running/.test(noticeFor({ author: "bob", withheld: [{ what: "script" }] })),
     "one part takes the singular verb");
  ok(/are not running/.test(noticeFor({ author: "bob",
       withheld: [{ what: "script" }, { what: "markup" }] })), "two take the plural");
}

/* ═══════════════ the store ═══════════════ */

/** A stub store that keeps one presentation graph and one admission graph. */
function store({ admission = null, admissionsReadable = true } = {}) {
  const calls = [];
  let presentation = graphFromPresentation(LOADED, { base: GRAPH, name: NAME, creator: OWNER });
  let admitted = admission;
  const results = (vars, rows) => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ head: { vars }, results: { bindings: rows } }) });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    const mine = url.includes(`/${READER}/ui`);
    if (init.headers?.["Content-Type"] === "application/sparql-update") {
      if (mine && /ui:Admission|ui\/#?Admission|Admission/.test(String(init.body))) {
        const f = String(init.body).match(/fingerprint>\s+"([0-9a-f]{64})"/);
        admitted = f ? { fingerprint: f[1], at: "2026-11-01T12:00:00Z", of: OWNER } : null;
      } else if (mine && /DELETE WHERE/.test(String(init.body))) admitted = null;
      return { ok: true, status: 200, text: async () => "" };
    }
    if (mine) {
      if (!admissionsReadable) return { ok: false, status: 500, text: async () => "boom" };
      if (!admitted) return results(["fingerprint"], []);
      return results(["fingerprint", "admitted", "of"], [{
        graph: { type: "uri", value: GRAPH },
        fingerprint: { type: "literal", value: admitted.fingerprint },
        admitted: { type: "literal", value: admitted.at },
        of: { type: "literal", value: admitted.of || OWNER },
      }]);
    }
    return results(["s", "p", "o"], presentation.map((t) => ({
      s: { type: "uri", value: t.s }, p: { type: "uri", value: t.p },
      o: t.o.iri ? { type: "uri", value: t.o.iri }
                 : { type: "literal", value: t.o.value,
                     ...(t.o.datatype ? { datatype: t.o.datatype } : {}) },
    })));
  };
  return { calls, fetchImpl, admitted: () => admitted };
}

section("U-74: `readPresentation' defaults the reader to the owner, so nothing regressed");
{
  const s = store();
  const own = await readPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                       fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(own.ok, "the page reads");
  ok(own.document.script === "window.__ran = true;",
     "and with no `reader' given it is read as the owner's own — every caller built "
     + "before this phase keeps its behaviour exactly");
  ok(own.sharing.foreign === false, "which the result says outright");
  ok(own.sharing.assumedOwner === true,
     "and it says that nobody actually SAID who was reading — the one fail-open "
     + "default in U-74, recorded rather than left to be inferred");
  const said = await readPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                        reader: OWNER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(said.sharing.assumedOwner === false, "a caller that says so is not assuming");
}

section("U-74: `openPresentation' reads the admission and the page together");
{
  const s = store();
  const out = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                       reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(out.ok, "it reads");
  ok(out.document.script === null, "and bob's script is not in the document alice gets");
  ok(out.sharing.withheld.length === 3, "nor his transform, nor his markup");
  ok(s.calls.some((c) => c.url.includes(`/${READER}/ui/sparql`)),
     "the admission was looked for in ALICE's repository, not bob's — a store the "
     + "author can write is not somewhere an approval can be kept");
  ok(s.calls.some((c) => c.url.includes(`/${OWNER}/ui/sparql`)), "and the page in bob's");
}

section("U-74: admit, reopen, and it runs");
{
  const s = store();
  const first = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                         reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  const written = await admitPresentation({
    host: HOST, reader: READER, token: "t", graph: GRAPH,
    fingerprint: first.sharing.fingerprint, of: OWNER, fetchImpl: s.fetchImpl });
  ok(written.ok, "the admission is written");
  ok(s.calls.at(-1).url.includes(`/${READER}/ui/sparql`), "to the reader's own repository");

  const again = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                         reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(again.sharing.trusted, "and on reopening the page is trusted");
  ok(again.document.script === "window.__ran = true;", "with bob's script now running");
  ok(again.document.transforms[0].body === "return inputs.stock.rows.length;",
     "and his transform");
}

section("U-74: an admission needs a real fingerprint, or nothing is recorded");
{
  const s = store();
  for (const bad of [null, "", "abc", "Z".repeat(64), digestOf("x")]) {
    const out = await admitPresentation({ host: HOST, reader: READER, token: "t",
                                          graph: GRAPH, fingerprint: bad, fetchImpl: s.fetchImpl });
    ok(!out.ok, `\`${String(bad).slice(0, 12)}' is refused as a fingerprint`);
  }
  ok(s.calls.length === 0, "and not one of them reached the store");
}

section("U-74: an unreadable admission store is not an admission");
{
  const s = store({ admissionsReadable: false });
  const held = await readAdmission({ host: HOST, reader: READER, token: "t", graph: GRAPH,
                                     fetchImpl: s.fetchImpl });
  ok(!held.ok && held.admission === null, "it fails, and it fails closed");
  const out = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                       reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(out.document.script === null,
     "so breaking the reader's own repository is not a way to get code run in it");
  ok(out.warnings.some((w) => /nothing in this page will run/.test(w)),
     `and the reader is told why: ${out.warnings.join("; ")}`);
}

section("U-74: withdrawing an admission puts the page back behind the mark");
{
  const s = store();
  const first = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                         reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  await admitPresentation({ host: HOST, reader: READER, token: "t", graph: GRAPH,
                            fingerprint: first.sharing.fingerprint, fetchImpl: s.fetchImpl });
  await withdrawAdmission({ host: HOST, reader: READER, token: "t", graph: GRAPH,
                            fetchImpl: s.fetchImpl });
  const after = await openPresentation({ host: HOST, account: OWNER, token: "t", name: NAME,
                                         reader: READER, fetchImpl: s.fetchImpl, crypto: CRYPTO });
  ok(!after.sharing.trusted && after.document.script === null,
     "it is withheld again — an admission is ordinary data and a revocation is a delete");
}

section("U-74: the admissions a reader has given can be listed and reviewed");
{
  const s = store({ admission: { fingerprint: "b".repeat(64), at: "2026-11-01T12:00:00Z",
                                 of: OWNER } });
  const list = await listAdmissions({ host: HOST, reader: READER, token: "t",
                                      fetchImpl: s.fetchImpl });
  ok(list.ok && list.admissions.length === 1, "the list reads");
  ok(list.admissions[0].of === OWNER && list.admissions[0].graph === GRAPH,
     "naming whose code and which page, which is what a review needs");
}

/* ═══════════════ the mark on the page ═══════════════ */

section("U-74: the mark is drawn by the frame, above the views, escaped");
{
  const page = buildPage(PLAIN, { notice: "Written by bob. Its <script> is not running." });
  ok(/data-notice="shared"/.test(page), "the page carries the mark");
  ok(page.indexOf('data-notice="shared"') < page.indexOf('class="dash-view"'),
     "above the views, where a reader sees it before reading");
  ok(/&lt;script&gt;/.test(page) && !/>Written by bob. Its <script>/.test(page),
     "and the notice text is escaped — the one thing it must not be is a way in");
  ok(!/data-notice/.test(buildPage(PLAIN, {})), "a page with no notice carries none");
  ok(!/<section class="dash-view"[^>]*>[\s\S]*data-notice/.test(page),
     "and it is outside every view, so switching view cannot take it off the screen");
}

section("U-74: the withheld placeholder renders where the markup was");
{
  const { document: safe } = withhold(LOADED, { author: OWNER });
  const page = buildPage(safe, {});
  ok(/data-withheld="markup"/.test(page), "the placeholder is in the page");
  ok(!/__blob/.test(page), "and the blob's own script is not");
  ok(!/window\.__ran/.test(page), "nor the page script");
  ok(/window\.__ran/.test(buildPage(LOADED, {})),
     "both of which the UNSCREENED document does put there — which is what makes "
     + "the two assertions above mean something");
}

section("U-74: and the copy a reader downloads carries the withholding too");
{
  // A transform body does not appear in a mounted page at all: the spec is
  // posted in, not inlined.  It IS inlined in a standalone copy, which is
  // the file a reader keeps and may open anywhere, so that is where it has
  // to be checked.
  const { document: safe } = withhold(LOADED, { author: OWNER });
  const results = { stock: { ok: true, mimeType: "text/tab-separated-values",
                             text: "?region\n1\n", digest: "d", rows: 1 } };
  const saved = buildPage(safe, { results, standalone: true });
  ok(/dash-data/.test(saved), "the standalone copy inlines the document");
  ok(!/inputs\.stock\.rows/.test(saved), "and bob's transform body is not in it");
  ok(/withheld/.test(saved), "what is there instead is the sentence the slot will show");
  ok(/inputs\.stock\.rows/.test(buildPage(LOADED, { results, standalone: true })),
     "whereas the unscreened document does inline it");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
