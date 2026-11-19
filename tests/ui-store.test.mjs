/**
 * `<account>/ui': saving a presentation, reading it back, and its history
 * (U-67, U-68, U-75).
 *
 * The claim that carries phase 3 is the same one phase 1 made of the tree,
 * one level up: A PRESENTATION DOES NOT CHANGE BY BEING SAVED.  Write a
 * validated document, read the triples back, and the document that comes out
 * has to be the one that went in -- panels, transforms, assertions,
 * parameters with their domains, the element trees, the styles, the state.
 * If it does not, a presentation drifts every time it is opened and the
 * revision history records edits nobody made.
 *
 * Everything here runs against a stub `fetch'.  What is being tested is what
 * this module SENDS and what it makes of what comes back; a live store would
 * test spocq, and `tests/` has no live host.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-store-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  uiRepository, presentationGraph, presentationName, UI_REPOSITORY_CLASS,
  graphFromPresentation, presentationFromGraph, insertData, termOf, iriOf, digestOf,
  readGraph, writePresentation, readPresentation, deletePresentation,
  listPresentations, listRevisions, revertPresentation, comparePresentations,
  ensureRepository,
} = await load("app/ui-store.js");
const { validateApplication, canonical } = await load("app/document.js");
const { VOCABULARY_VERSION, T } = await load("app/vocabulary.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const HOST = "https://nl4.dydra.com";
const ACCOUNT = "alice";
const GRAPH = presentationGraph(HOST, ACCOUNT, "inventory");

const SALES = "SELECT ?region ?total WHERE { ?s :region ?region ; :total ?total }";
const ASSEMBLIES = "SELECT ?region WHERE { ?r :name ?region }";

const DOC = validateApplication({
  title: "Component inventory",
  uses: ["panel", "table", "select"],
  parameters: [{ name: "region", kind: "literal", label: "Region",
                 domain: { from: "regions", column: "region" }, default: "north" }],
  panels: [
    { name: "regions", query: ASSEMBLIES, caption: "every region" },
    { name: "parts", query: "SELECT ?part ?region WHERE { ?part :region ?region }",
      parameters: ["region"], caption: "by region" },
  ],
  transforms: [{ name: "count", inputs: ["parts"], body: "return inputs.parts.rows.length;" }],
  assertions: [{ id: "lead", inputs: ["parts"], text: "The north holds most of them." }],
  views: [{ name: "main", title: "Parts", elements: [
    { name: "e-panel", kind: "panel", order: "a", attributes: { label: "Parts" },
      layout: { columns: "220px 1fr", gap: 12, areas: ["filter table"] },
      children: [
        { name: "e-sel", kind: "select", order: "a", placement: { area: "filter" },
          attributes: { parameter: "region", panel: "parts" }, binds: "region" },
        { name: "e-tab", kind: "table", order: "b", placement: { area: "table" },
          attributes: { sortable: true }, bound: "parts" },
      ] },
    { name: "e-note", kind: "p", order: "b", asserted: "lead", text: "" },
  ] }],
  styles: "p { color: #556; }",
  state: { view: "main", region: "north" },
});

/** A stub store: it keeps whatever was written and answers reads from it. */
function store() {
  const calls = [];
  let triples = [];
  const results = (rows) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ head: { vars: ["s", "p", "o"] }, results: { bindings: rows } }),
  });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body,
                 type: init.headers?.["Content-Type"] });
    if (init.headers?.["Content-Type"] === "application/sparql-update") {
      // Only what the harness needs: the body is inspected by the tests
      // themselves, and the triples are taken from the INSERT DATA.
      if (/DROP SILENT/.test(init.body)) triples = parseInsert(init.body);
      return { ok: true, status: 200, text: async () => "" };
    }
    if (/revisions$/.test(url)) {
      return { ok: true, status: 200, text: async () => "2026-11-01T09:00:00Z\n2026-10-31T17:20:00Z\n" };
    }
    if (/ui\/sparql/.test(url) && /SELECT \?s \?p \?o/.test(String(init.body))) {
      return results(triples.map((t) => ({
        s: { type: "uri", value: t.s }, p: { type: "uri", value: t.p },
        o: t.o.iri ? { type: "uri", value: t.o.iri }
                   : { type: "literal", value: t.o.value,
                       ...(t.o.datatype ? { datatype: t.o.datatype } : {}) },
      })));
    }
    return results([]);
  };
  return { calls, fetchImpl, seed: (t) => { triples = t; }, held: () => triples };
}

/** The INSERT DATA of a written update, read back as triples. */
function parseInsert(body) {
  const block = String(body).split("INSERT DATA {")[1] || "";
  const inner = block.slice(0, block.indexOf("\n  }\n}"));
  const out = [];
  for (const line of inner.split("\n")) {
    const m = line.match(/^\s*<([^>]+)>\s+<([^>]+)>\s+(.*)\s\.$/);
    if (!m) continue;
    const [, s, p, object] = m;
    if (object.startsWith("<")) { out.push({ s, p, o: { iri: object.slice(1, -1) } }); continue; }
    const typed = object.match(/^"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]+)>)?$/);
    if (!typed) continue;
    const value = typed[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
                          .replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    out.push({ s, p, o: { value, datatype: typed[2] || null, iri: null } });
  }
  return out;
}

/* ═════════════════════════════ the names ══════════════════════════════════ */

section("U-67: where a presentation lives");
{
  ok(uiRepository(HOST, ACCOUNT) === `${HOST}/alice/ui`, "one repository per account");
  ok(GRAPH === `${HOST}/alice/ui/presentations/inventory`, "one graph per presentation");
  ok(presentationName(GRAPH) === "inventory", "and the name is recoverable from it");
  ok(UI_REPOSITORY_CLASS === "revisioned",
     "created revisioned, so history is an as-of read and not a chain of triples");
}

/* ═══════════════════════ the round trip, which is the claim ═══════════════ */

section("U-67: a presentation does not change by being saved");
{
  ok(DOC.ok, DOC.errors.join("; ") || "the document validates");
  const triples = graphFromPresentation(DOC.document, { base: GRAPH, name: "inventory" });
  const back = presentationFromGraph(triples, { base: GRAPH });

  ok(back.ok, (back.errors || []).join("; ") || "it reads back");
  const was = DOC.document, is = back.document;
  ok(is.title === was.title && is.toolbox === was.toolbox && is.revision === was.revision,
     "the document's own fields");
  // `canonical' rather than JSON.stringify: a graph has no key order, so the
  // claim is that the two documents MEAN the same, which is the comparison
  // the patch classifier makes as well.
  ok(canonical(is.panels) === canonical(was.panels), "every panel, with its query and caption");
  ok(canonical(is.transforms) === canonical(was.transforms), "every transform, with its body");
  ok(canonical(is.assertions) === canonical(was.assertions),
     "every assertion, with its inputs and the digests they held");
  ok(canonical(is.parameters) === canonical(was.parameters),
     "every parameter, with its domain and its default");
  ok(canonical(is.views) === canonical(was.views.map((v) =>
       ({ name: v.name, title: v.title, elements: v.elements }))),
     "and the element trees, attribute for attribute");
  ok(is.styles === was.styles && canonical(is.state) === canonical(was.state),
     "the styles and the state");
  ok(canonical(is.uses) === canonical(was.uses), "and what it uses");
}

section("a view that is still markup is carried, not reinterpreted (D-AN)");
{
  const legacy = validateApplication({
    title: "Old", panels: [{ name: "sales", query: SALES }],
    html: '<h1 id="h">Sales</h1><section id="s" data-bound="sales"></section>',
  });
  const triples = graphFromPresentation(legacy.document, { base: GRAPH, name: "old" });
  const back = presentationFromGraph(triples, { base: GRAPH });
  ok(back.ok, "it reads back");
  const carrier = back.document.views[0].elements;
  ok(carrier.length === 1 && carrier[0].kind === "html", "as one opaque element");
  ok(carrier[0].html === legacy.document.views[0].html, "holding its markup byte for byte");
  const revalidated = validateApplication({ ...back.document, views: back.document.views });
  ok(revalidated.ok && revalidated.document.views[0].html.includes('data-bound="sales"'),
     "and a document built from it still validates and still binds its panel");
}

section("what the graph says about one element");
{
  const triples = graphFromPresentation(DOC.document, { base: GRAPH, name: "inventory" });
  const about = (s) => triples.filter((t) => t.s === s);
  ok(about(GRAPH).some((t) => t.p === T.vocabulary && t.o.value === VOCABULARY_VERSION),
     "the presentation records the vocabulary it was written against");
  ok(about(GRAPH).some((t) => t.p === T.view), "and names its views, which is their order");
  ok(about(`${GRAPH}#pan-parts`).some((t) => t.p === T.query), "a panel carries its query");
  ok(about(`${GRAPH}#par-region`).some((t) => t.p === T.domainFrom
                                            && t.o.iri === `${GRAPH}#pan-regions`),
     "and a parameter's domain points at the panel it comes from");
  ok(about(`${GRAPH}#e-tab`).some((t) => t.p === T.bound && t.o.iri === `${GRAPH}#pan-parts`),
     "an element points at the panel it shows");
}

/* ══════════════════════════ U-75: the version ═════════════════════════════ */

section("U-75: a presentation from a later vocabulary is READ, and said to be later");
{
  // Revised 2026-11-05.  This used to assert a refusal.  A refusal meant a
  // page written by a newer client could not be opened at all by anyone
  // behind it, and a vocabulary that cannot be extended without taking every
  // stored presentation away from every older build is one nobody can
  // extend.  The remedy for a half-read page is to SAY it is half-read.
  const ahead = String(Number(VOCABULARY_VERSION) + 1);
  const triples = graphFromPresentation(DOC.document, { base: GRAPH, name: "inventory" })
    .map((t) => (t.p === T.vocabulary ? { ...t, o: { ...t.o, value: ahead } } : t));
  const back = presentationFromGraph(triples, { base: GRAPH });
  ok(back.ok && back.document, "it opens");
  ok(back.meta.later === true && back.meta.vocabulary === ahead,
     "and says which interface wrote it, which is what a caller passes on as `lenient'");
  ok(back.warnings.some((w) => /shown as unavailable rather than drawn/.test(w)),
     "with the note that anything newer than this build understands is not drawn");
  ok(back.document.views.length === DOC.document.views.length,
     "everything this build DOES understand is there");
  const mine = presentationFromGraph(
    graphFromPresentation(DOC.document, { base: GRAPH, name: "inventory" }), { base: GRAPH });
  ok(mine.meta.later === false && !mine.warnings.some((w) => /unavailable/.test(w)),
     "and a presentation of this build's own version is not marked at all");
}

/* ═══════════════════════════ what is sent ═════════════════════════════════ */

section("U-67: one save is one request");
{
  const s = store();
  const res = await writePresentation({
    host: HOST, account: ACCOUNT, token: "t", name: "inventory",
    document: DOC.document, creator: "alice", fetchImpl: s.fetchImpl,
    now: () => new Date("2026-11-01T10:00:00Z"),
  });
  ok(res.ok, res.error || "written");
  ok(s.calls.length === 1, `one request, not one per element (${s.calls.length})`);
  ok(s.calls[0].type === "application/sparql-update", "as an update");
  const body = s.calls[0].body;
  ok(/^DROP SILENT GRAPH <.*inventory>/.test(body), "the graph is replaced");
  ok(body.split(" ;\n").length === 4,
     "and the graph and the catalogue entry go in one transaction, so no reader "
   + "sees the graph empty");
  ok(/ui#Presentation/.test(body) && body.includes("ui#modified"),
     "the catalogue entry carries what a listing shows");
}

section("and one read is one query");
{
  const s = store();
  await writePresentation({ host: HOST, account: ACCOUNT, token: "t", name: "inventory",
                            document: DOC.document, fetchImpl: s.fetchImpl });
  const read = await readPresentation({ host: HOST, account: ACCOUNT, token: "t",
                                        name: "inventory", fetchImpl: s.fetchImpl });
  ok(read.ok, (read.errors || []).join("; ") || "read back through the store");
  ok(s.calls.length === 2, `one write, one read (${s.calls.length})`);
  ok(read.document.title === "Component inventory", "with the title");
  ok(read.document.views[0].elements[0].children.length === 2,
     "and the tree, through SPARQL results and back");
  ok(canonical(read.document.views) === canonical(DOC.document.views.map((v) =>
       ({ name: v.name, title: v.title, elements: v.elements }))),
     "identical to what was written — the round trip holds through the wire format too");
}

section("a presentation that is not there says so");
{
  const s = store();
  const read = await readPresentation({ host: HOST, account: ACCOUNT, token: "t",
                                        name: "nothing", fetchImpl: s.fetchImpl });
  ok(!read.ok && /no presentation named `nothing'/.test(read.errors[0]),
     "by name, rather than as an empty page");
}

/* ═══════════════════════════ U-68: history ════════════════════════════════ */

section("U-68: a past revision is an as-of read");
{
  const s = store();
  await writePresentation({ host: HOST, account: ACCOUNT, token: "t", name: "inventory",
                            document: DOC.document, fetchImpl: s.fetchImpl });
  s.calls.length = 0;
  await readPresentation({ host: HOST, account: ACCOUNT, token: "t", name: "inventory",
                           revision: "2026-10-31T17:20:00Z", fetchImpl: s.fetchImpl });
  ok(/\?revision=2026-10-31T17%3A20%3A00Z$/.test(s.calls[0].url),
     "the revision is asked of the endpoint, not reconstructed from triples");
}

section("the revisions are the repository's");
{
  const s = store();
  const revs = await listRevisions({ host: HOST, account: ACCOUNT, token: "t", fetchImpl: s.fetchImpl });
  ok(revs.ok && revs.revisions.length === 2, "listed from the system API");
  ok(/\/system\/accounts\/alice\/repositories\/ui\/revisions$/.test(s.calls[0].url),
     "at the repository, because that is where a revision is");
}

section("reverting is a new revision, not a rewind");
{
  const s = store();
  await writePresentation({ host: HOST, account: ACCOUNT, token: "t", name: "inventory",
                            document: DOC.document, creator: "alice", fetchImpl: s.fetchImpl });
  s.calls.length = 0;
  const back = await revertPresentation({ host: HOST, account: ACCOUNT, token: "t",
                                          name: "inventory", revision: "2026-10-31T17:20:00Z",
                                          fetchImpl: s.fetchImpl });
  ok(back.ok, back.errors?.join("; ") || "reverted");
  ok(s.calls.length === 2 && s.calls[1].type === "application/sparql-update",
     "a read of the old version and a write of it as the current one");
  ok(back.revertedFrom === "2026-10-31T17:20:00Z", "saying where it came from");
  ok(!/DROP SILENT GRAPH <[^>]*>\s*$/.test(s.calls[1].body) && /INSERT DATA/.test(s.calls[1].body),
     "and the history between is left where it is — someone may have read it");
}

section("two revisions compared, element by element");
{
  const s = store();
  await writePresentation({ host: HOST, account: ACCOUNT, token: "t", name: "inventory",
                            document: DOC.document, fetchImpl: s.fetchImpl });
  const diff = await comparePresentations({ host: HOST, account: ACCOUNT, token: "t",
                                            name: "inventory", from: "r1", to: null,
                                            fetchImpl: s.fetchImpl });
  ok(diff.ok && diff.views.length === 1 && diff.views[0].name === "main",
     "a before and an after tree per view, for `diffTrees' to take");
}

/* ══════════════════════════ the catalogue ═════════════════════════════════ */

section("U-67: the catalogue is in the default graph, so a listing is cheap");
{
  const s = store();
  s.seed([]);
  const fetchImpl = async (url, init) => {
    s.calls.push({ url, body: init.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({
      head: {},
      results: { bindings: [
        { presentation: { type: "uri", value: GRAPH }, name: { value: "inventory" },
          title: { value: "Component inventory" }, scope: { value: "document" },
          modified: { value: "2026-11-01T10:00:00Z" } },
        { presentation: { type: "uri", value: presentationGraph(HOST, ACCOUNT, "workspace") },
          name: { value: "workspace" }, scope: { value: "workspace" },
          modified: { value: "2026-10-30T08:00:00Z" } },
      ] },
    }) };
  };
  const list = await listPresentations({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(list.ok && list.presentations.length === 2, "both are listed");
  ok(list.presentations[0].name === "inventory", "newest first");
  ok(list.presentations[1].scope === "workspace", "with the scope, so the two are told apart");
  ok(!/GRAPH/.test(s.calls[0].body),
     "and the query does not open a single presentation graph to do it");
}

section("deleting takes the graph and the entry together");
{
  const s = store();
  const res = await deletePresentation({ host: HOST, account: ACCOUNT, token: "t",
                                         name: "inventory", fetchImpl: s.fetchImpl });
  ok(res.ok, "deleted");
  ok(/DROP SILENT GRAPH/.test(s.calls[0].body) && /DELETE WHERE/.test(s.calls[0].body),
     "or the catalogue would list a presentation that is not there");
}

/* ══════════════════════════ provisioning ══════════════════════════════════ */

section("U-67: the repository is made if it is not there");
{
  let created = null;
  const fetchImpl = async (url, init) => {
    if (/ui\/sparql/.test(url)) return { ok: false, status: 404, text: async () => "no such repository" };
    created = JSON.parse(init.body);
    return { ok: true, status: 201, text: async () => "" };
  };
  const res = await ensureRepository({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(res.ok && res.created, "created");
  ok(created.name === "ui" && created.type === "revisioned",
     "as `ui', revisioned — the class history depends on");
}

section("and an account that may not create one is told, not thrown at");
{
  const fetchImpl = async (url) => (/ui\/sparql/.test(url)
    ? { ok: false, status: 404, text: async () => "" }
    : { ok: false, status: 403, text: async () => "not your account" });
  const res = await ensureRepository({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(!res.ok && res.status === 403 && /not your account/.test(res.error),
     "with the reason the store gave");
}

section("one that is already there is left alone");
{
  let posts = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === "POST" && /repositories$/.test(url)) posts += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ boolean: true }) };
  };
  const res = await ensureRepository({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(res.ok && !res.created && posts === 0, "no second create");
}

/* ══════════════════════════ the small things ══════════════════════════════ */

section("terms are written so that they come back");
{
  ok(termOf({ value: 'a "quoted" \\ line\nbreak', datatype: null, iri: null })
     === '"a \\"quoted\\" \\\\ line\\nbreak"', "a literal escapes what would end it");
  ok(termOf({ iri: "http://x/y" }) === "<http://x/y>", "an IRI is an IRI");
  ok(termOf({ value: "3", datatype: "http://www.w3.org/2001/XMLSchema#integer", iri: null })
     === '"3"^^<http://www.w3.org/2001/XMLSchema#integer>', "and a typed literal keeps its type");
  let threw = false;
  try { iriOf("http://x/ y"); } catch { threw = true; }
  ok(threw, "a broken IRI is refused rather than escaped: it is a bug, not input");
}

section("a script is recorded with a digest (D-AM)");
{
  const withScript = validateApplication({
    title: "s", panels: [{ name: "p", query: SALES }],
    html: '<div data-bound="p"></div>', script: "window.x = 1;",
  });
  const triples = graphFromPresentation(withScript.document, { base: GRAPH, name: "s" });
  const digest = triples.find((t) => t.p === T.scriptDigest);
  ok(digest && digest.o.value === digestOf("window.x = 1;"),
     "so that crossing the gate once does not silently cover a later edit");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
