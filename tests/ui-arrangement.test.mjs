/**
 * Reusable arrangements: lift, apply, mount (U-80 … U-88; D-AV, §21).
 *
 * Phase 8 is the first phase that adds a way to put ONE person's work inside
 * ANOTHER person's page, so the suite is organised around the three things
 * that can go wrong when it does, and only then around the API.
 *
 *   1. **A name means two things at once.**  Minted names are unique within
 *      a presentation and not within a rendered document, and `resolve' in
 *      `dom-patch.js' is document-wide.  Two mounts of one presentation
 *      would put identical names in twice; a rename that copied names would
 *      do the same with the fork open beside its source.  Both are asserted
 *      here as refusals, not as hopes.
 *
 *   2. **A component arrives looking finished and is not.**  An applied
 *      component carries definitions and no results; it recreates its
 *      content by repeating the original's requests.  So a request that
 *      cannot run has to fail the APPLY -- a component that silently renders
 *      empty is indistinguishable from one whose query legitimately returned
 *      nothing, and the reader has no way to tell which they are looking at.
 *
 *   3. **Something in a page causes a fetch nobody asked for.**  Expansion
 *      is triggered only from outside the representation (§21.4.3), which is
 *      why there is no cycle check anywhere in this phase.  That claim is
 *      load-bearing, so it is tested in the one direction that can falsify
 *      it: a document holding a mount is built into a DOM with no host
 *      registered and no network at all, and nothing is fetched.
 *
 * And one claim in the other direction, because the point of the phase is
 * reuse and not refusal: a template lifted from a panel brings the query
 * that feeds it, the transform that counts it and the parameter it is bound
 * to, and applying it into a document that already has a parameter of that
 * name shares the parameter rather than copying it -- two controls on one
 * value, which is what D-AQ makes a control mean.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-arrangement-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  parseName, printName, displayName, xpathOf, nameable, checkScopes,
  lift, apply, checkApply, mount, unmount, mountsOf, remintElements,
  requestsOf, sourcesOf, describeRequests, templateParts, liftWhole,
  MOUNT_SCHEME, mountHostValue, mountedPresentation, TEMPLATE_VERSION,
} = await load("app/arrangement.js");
const {
  arrangementIri, writeArrangement, listArrangements, readArrangement, deleteArrangement,
  mountIri, claimMount, readMount, listMounts, releaseMount, renamePresentation,
  applicationIri, recordApplication, readApplications, forgetApplications,
  presentationGraph, graphFromPresentation, presentationFromGraph,
} = await load("app/ui-store.js");
const { validateApplication } = await load("app/document.js");
const { parseInstruction, parseArrangement } = await load("app/instructions.js");
const { mount: mountDom, INERT_ATTRIBUTE } = await load("app/reconcile.js");
const { index, find } = await load("app/tree.js");
const { copyView } = await load("dashboard/catalog.js");
const { specOfPresentation, sourceOfPresentation, presentationFile, fileNameFor } =
  await load("app/presentation-file.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const HOST = "https://nl4.dydra.com";
const ACCOUNT = "alice";
const SOURCE = { host: HOST, account: "bob", repository: "parts" };

const PARTS = "SELECT ?part ?region WHERE { ?part :region ?region }";
const REGIONS = "SELECT ?region WHERE { ?r :name ?region }";

/** A document with one liftable component and one opaque leaf. */
const built = (spec) => {
  const r = validateApplication(spec);
  if (!r.ok) throw new Error(`the fixture does not validate: ${r.errors.join("; ")}`);
  return r.document;
};
const doc = () => built({
  title: "Component inventory",
  uses: ["panel", "table", "select", "metric"],
  parameters: [{ name: "region", kind: "literal", label: "Region",
                 domain: { from: "regions", column: "region" }, default: "north" }],
  panels: [
    { name: "regions", query: REGIONS, caption: "every region" },
    { name: "parts", query: PARTS, parameters: ["region"], caption: "by region" },
  ],
  transforms: [{ name: "count", inputs: ["parts"], body: "return inputs.parts.rows.length;" }],
  views: [{ name: "main", title: "Parts", elements: [
    { name: "e-panel", kind: "panel", order: "a", attributes: { label: "Parts" },
      layout: { columns: "220px 1fr", gap: 12, areas: ["filter table"] },
      placement: { area: "body" },
      children: [
        { name: "e-sel", kind: "select", order: "a", placement: { area: "filter" },
          attributes: { parameter: "region", panel: "parts" }, binds: "region" },
        { name: "e-tab", kind: "table", order: "b", placement: { area: "table" },
          attributes: { sortable: true }, bound: "parts" },
        { name: "e-num", kind: "metric", order: "c", derived: "count" },
      ] },
    { name: "e-legacy", kind: "html", order: "b", html: "<p id=inner>old</p>" },
  ] }],
});

/* ── 1. names (U-80) ──────────────────────────────────────────────────────── */

section("U-80: two spellings of a component name, one name");
{
  const bare = parseName("inventory#e-7k2m");
  const shown = parseName(`inventory#${xpathOf("e-7k2m")}`);
  ok(bare.ok && bare.element === "e-7k2m", "the bare anchor parses");
  ok(shown.ok && shown.element === "e-7k2m", "so does the XPath display form");
  ok(printName(bare) === printName(shown),
     "and the two print as ONE name -- the anchor is the identity, the expression is "
     + "what to show");
  ok(displayName(bare) === "inventory#//*[@data-ui='e-7k2m']",
     "the display form is what the bar and the catalogue print");
  ok(parseName("inventory").form === "presentation",
     "a bare presentation name is the other form of name, not a malformed one");
}

section("U-80: the refusals, which are the decision and not a limitation");
{
  ok(!parseName("inventory#e-html-main/div[2]").ok,
     "a path of more than one step is refused: every tree element has an anchor, so a "
     + "second step can only be reaching inside an opaque leaf");
  ok(!parseName("inventory#").ok, "a name that says `a component' and not which one is refused");
  ok(!parseName("9lives").ok, "and a presentation name that is not one");
  const d = doc();
  const html = nameable(d.views[0].elements, "e-legacy");
  ok(!html.ok && /opaque/.test(html.reason),
     "an `html' element cannot be lifted from: its interior has no minted names, so a "
     + "path into it could only be positional (D-AI)");
  ok(/convert it to a tree/.test(html.reason),
     "and the refusal says what to do instead, which is the migration D-AN already has");
  ok(nameable(d.views[0].elements, "e-tab").ok, "an ordinary element is nameable");
}

section("U-80: the scope pair -- a workspace is refused in either container");
{
  ok(!checkScopes({ mounted: "workspace", mounting: "workspace" }).ok,
     "a workspace in a workspace: it arranges the interface's own bands, and a second "
     + "one inside the first arranges nothing further");
  ok(!checkScopes({ mounted: "workspace", mounting: "document" }).ok,
     "a workspace in a document: the same case wearing a different name");
  ok(checkScopes({ mounted: "document", mounting: "workspace" }).ok,
     "a document in a workspace is permitted -- this is what composes a page into the chrome");
  ok(checkScopes({ mounted: "document", mounting: "document" }).ok,
     "and a document in a document, which is the shape a component library takes");
}

/* ── 2. lift (U-81) ───────────────────────────────────────────────────────── */

section("U-81: a lifted component carries its definitions and no placement");
{
  const d = doc();
  const { ok: lifted, template } = lift({
    document: d, name: "inventory#e-panel", source: SOURCE, revision: "7" });
  ok(lifted, "the panel lifts");
  ok(template.root.name === "p-0" && template.root.children.every((c) => /^p-\d+$/.test(c.name)),
     "every minted name is replaced by a placeholder");
  ok(template.root.order === null && template.root.children.every((c) => c.order === null),
     "and every order key is dropped: a key is meaningful only among the siblings it was "
     + "minted between (D-AJ)");
  ok(template.root.placement === null,
     "the root's placement goes too -- it placed it where it used to sit");
  ok(template.root.layout && template.root.layout.areas.length === 1,
     "the container's own grid stays, because that is the arrangement being reused (D-AK)");
  ok(template.panels.map((p) => p.name).sort().join() === "parts",
     "the panel the table is bound to comes with it");
  ok(template.transforms.map((t) => t.name).join() === "count",
     "and the transform the metric is derived from");
  ok(template.parameters.map((p) => p.name).join() === "region",
     "and the parameter the control binds -- collected THROUGH the panel, not just from "
     + "the element");
  ok(template.source.presentation === "inventory" && template.source.element === "e-panel"
     && template.source.revision === "7",
     "provenance is recorded: where it came from and at what revision (§21.4.4)");
  ok(template.unresolved.length === 0, "and nothing is left dangling");
}

section("U-81: the request source travels with the request, and is not provenance");
{
  const { template } = lift({ document: doc(), name: "inventory#e-tab", source: SOURCE });
  const [request] = requestsOf(template);
  ok(request.source.account === "bob" && request.source.repository === "parts",
     "each request carries the source the ORIGINAL ran against");
  ok(sourcesOf(template).length === 1, "and the distinct sources are listable");
  ok(describeRequests(template).includes("bob/parts")
     && describeRequests(template).includes(":region"),
     "what U-88 shows is the query text AND where it goes -- the disclosure is of the "
     + "reader to an address the author chose, and a reader shown the query but not its "
     + "destination has been shown the uninteresting half");
}

section("U-81: an opaque leaf is not lifted FROM");
{
  const r = lift({ document: doc(), name: "inventory#e-legacy" });
  ok(!r.ok && /opaque/.test(r.errors[0]),
     "an `html' leaf has no inside the arrangement machinery can read, and the refusal "
     + "is made here and not only by `nameable'");
  ok(/whole presentation/.test(r.errors[0]),
     "and it names the way out: the whole of it can be lifted, markup and all (§33)");
}

/* ── 2b. the composite (§33, U-114) ───────────────────────────────────────── */

section("§33: a whole presentation is an arrangement too");
{
  const source = { host: HOST, account: ACCOUNT, repository: "parts" };
  const r = lift({ document: doc(), name: "inventory", source, revision: 4 });
  ok(r.ok, "`lift inventory as …' is no longer a refusal: the unit of reuse was ONE "
         + "element, and a page arranged as a matrix is a shape somebody wants again");
  const t = r.template;

  // The whole view, as one placeable element.
  ok(t.root.kind === "div" && t.root.children.length === 2,
     "the view's two roots arrive under one container, because what is applied has to be "
     + "one element to place");
  ok(!t.root.layout,
     "the container declares no layout of its own -- a grid belongs to the element that "
     + "declared it, and inventing one here would arrange the page a second way");
  const grid = t.root.children.find((n) => n.layout);
  ok(grid && grid.layout.areas.join("|") === "filter table",
     "the arrangement itself travels: the grid template is the thing being lifted");
  ok(grid.children.map((n) => n.placement?.area).join(",") === "filter,table,",
     "and so does where each child sits in it");
  ok(t.root.placement === null && t.root.order === null,
     "the root's own placement and key are dropped: a key is meaningful only among the "
     + "siblings it was minted between");
  ok(t.placeholders.length === 6 && t.root.name === "p-0",
     "every name is a placeholder, as in a component lift");

  // What a composite carries that a component lift cannot.
  const names = t.panels.map((p) => p.name).sort().join(",");
  ok(names === "parts,regions",
     "every panel the page defines travels, not the ones an element points at");
  const one = lift({ document: doc(), name: "inventory#e-panel", source });
  ok(one.template.panels.map((p) => p.name).join(",") === "parts",
     "which is the difference: a component lift takes what its subtree names, and drops "
     + "`regions' -- the panel that fills the select's domain, so the lifted control "
     + "arrives with nothing to choose from");
  ok(t.uses.includes("select") && t.uses.includes("table"),
     "`uses' travels, because a page that is still markup names its components inside "
     + "the markup, where no walk will find them");
  ok(t.panels.every((p) => p.source && p.source.repository === "parts"),
     "and every request carries the address it will be repeated against");
  ok(t.source.whole === true && t.source.element === null && t.source.view === "main",
     "the record says what was taken: the whole of a named view, not an element of it");
  ok(t.unresolved.length === 0,
     "nothing can be unresolved -- every definition the page had is in the template");
}

section("§33: and applying one puts the arrangement back, over other data");
{
  const source = { host: HOST, account: ACCOUNT, repository: "parts" };
  const t = lift({ document: doc(), name: "inventory", source }).template;
  const into = built({
    title: "Somewhere else", uses: [], panels: [], views: [{ name: "main", elements: [
      { name: "e-page", kind: "div", order: "a" }] }],
  });
  const out = apply({ document: into, template: t, parent: "e-page" });
  ok(out.ok, "it applies into a page that had nothing in common with it");
  const placed = find(out.document.views[0].elements, out.element);
  const grid = placed.children.find((n) => n.layout);
  ok(grid && grid.layout.areas.join("|") === "filter table"
     && grid.children.map((n) => n.placement?.area).join(",") === "filter,table,",
     "the matrix survives the crossing: the grid template and every placement are the "
     + "same, which is the whole of what was being reused");
  ok(out.document.panels.map((p) => p.name).sort().join(",") === "parts,regions",
     "with every request it needs to fill itself");
  ok(out.document.uses.includes("select") && !out.document.uses.includes("html"),
     "and the components it is made of -- but not `html' or `host', which name no "
     + "component and would be asked of the toolbox and refused");
  ok(out.requests.length === 2 && out.charge === 1,
     "two requests to repeat, one charge: the reader asked for one thing");
}

section("§33: a page that is still markup is lifted whole, and is not promoted to do it");
{
  const markup = built({
    title: "Predicate statistics", uses: ["table"],
    panels: [{ name: "p223", query: PARTS, caption: "counts" }],
    views: [{ name: "main", title: "Main",
              html: '<h1>Counts</h1><section id="t" data-bound="p223"></section>' }],
  });
  const t = lift({ document: markup, name: "stats",
                   source: { host: HOST, account: ACCOUNT, repository: "x" } }).template;
  ok(t.root.kind === "html" && /data-bound="p223"/.test(t.root.html),
     "the markup travels verbatim as the one leaf it already is -- which is what a "
     + "composed page IS, so this is the common case and not the exotic one");
  ok(markup.views[0].elements == null,
     "and the source is left exactly as it was found: a lift is a read, and the document "
     + "is somebody's open page");
  ok(t.panels.length === 1 && t.uses.includes("table"),
     "the queries its `data-bound' regions name travel with it, which no walk of the "
     + "tree could have worked out -- they are inside the markup");
}

section("§33: and what it carries that something will run is readable before it runs");
{
  const t = lift({ document: doc(), name: "inventory",
                   source: { host: HOST, account: ACCOUNT, repository: "parts" } }).template;
  const parts = templateParts(t);
  const kinds = parts.map((p) => p.what).sort().join(",");
  ok(kinds === "markup,transform",
     "a composite carries a whole page's markup AND every transform it defined -- more "
     + "than a component lift ever did, and an arrangement does not yet pass the U-74 "
     + "admission (REQ-33.3.3)");
  ok(parts.every((p) => p.bytes > 0 && p.where),
     "each one is named and measured, because `a transform and one block of markup' is a "
     + "sentence a reader can weigh and `executable: true' is not");
  ok(templateParts(lift({ document: doc(), name: "inventory#e-num" }).template).length === 1,
     "where a component lift of a metric carries one transform and no markup at all, "
     + "which is the difference the disclosure exists to show");
}

section("§33: the two refusals, both narrow");
{
  const two = built({
    title: "Tabbed", panels: [], uses: [],
    views: [{ name: "main", html: "<p>one</p>" }, { name: "detail", html: "<p>two</p>" }],
  });
  const r = lift({ document: two, name: "tabbed" });
  ok(!r.ok && /2 views/.test(r.errors[0]) && /`main'/.test(r.errors[0])
     && /`detail'/.test(r.errors[0]),
     "a presentation of several views is refused, naming them: a composite is placed as "
     + "ONE element, and three tabs flattened into one column is a different page");
  ok(/lift the view's own root by its anchor/.test(r.errors[0]),
     "with the exact operation that does what was meant");
  const w = lift({ document: doc(), name: "workspace", scope: "workspace" });
  ok(!w.ok && /column of hosts/.test(w.errors[0]),
     "and the chrome is refused for the reason `checkScopes' refuses mounting one -- a "
     + "copy of it inside a page is a column of bands nothing will draw");
  ok(!lift({ document: { views: [] }, name: "empty" }).ok,
     "a presentation with no view has nothing to lift");
}

/* ── 3. apply (U-82, U-84) ────────────────────────────────────────────────── */

section("U-82: an applied component is re-minted, and placed by the tree's own rule");
{
  const { template } = lift({ document: doc(), name: "inventory#e-panel", source: SOURCE });
  const into = doc();
  const before = new Set(index(into.views[0].elements).keys());
  const r = apply({ document: into, template, view: "main", after: "e-panel" });
  ok(r.ok, "it applies");
  ok(r.elements.every((n) => !before.has(n)),
     "not one of the new names is a name the destination already had");
  ok(r.elements.length === 4, "the whole subtree arrives, root and three children");
  const placed = find(r.document.views[0].elements, r.element);
  ok(placed && placed.order > "a" && placed.order < "b",
     "and it is placed BETWEEN its new neighbours by the same `insert' every other "
     + "placement goes through");
  ok(r.charge === 1,
     "one charge against the re-run budget however many requests it runs: the user asked "
     + "for one thing (U-71)");
  ok(r.provenance.presentation === "inventory",
     "provenance comes back for the caller to record, and nothing here reads it");
}

section("U-82: a taken name is minted afresh, never quietly reused");
{
  const { template } = lift({ document: doc(), name: "inventory#e-tab", source: SOURCE });
  const into = doc();                       // already has a panel called `parts'
  const r = apply({ document: into, template, view: "main" });
  ok(r.ok, "it applies into a document that already has a `parts'");
  ok(r.names.panels.parts !== "parts",
     "and the applied panel gets a new name: reusing the taken one would silently point "
     + "the component at the destination's data, which is the one outcome nobody asked for");
  ok(r.document.panels.filter((p) => p.query === PARTS).length === 2,
     "both queries are present, under two names");
  const applied = find(r.document.views[0].elements, r.element);
  ok(applied.bound === r.names.panels.parts,
     "and the element is bound to the one that came with it");
}

section("U-82: a parameter the destination defines the same way is SHARED");
{
  const { template } = lift({ document: doc(), name: "inventory#e-sel", source: SOURCE });
  const into = doc();
  const r = apply({ document: into, template, view: "main" });
  ok(r.ok && r.names.parameters.region === "region", "the name is kept");
  ok(r.document.parameters.filter((p) => p.name === "region").length === 1,
     "and the parameter is not duplicated -- two controls on one value is what D-AQ makes "
     + "a control mean");
}

section("U-84: the apply fails, visibly, rather than the component rendering empty");
{
  const { template } = lift({ document: doc(), name: "inventory#e-sel", source: SOURCE });
  const hostile = doc();
  hostile.parameters = [{ name: "region", kind: "iri", label: "Region",
                          datatype: null, language: null, default: null, domain: null }];
  const r = apply({ document: hostile, template, view: "main" });
  ok(!r.ok && /different parameter/.test(r.errors[0]),
     "a parameter of the same name and a different kind refuses the apply: binding the "
     + "request to it would be a different question silently asked");
  ok(r.document === hostile, "and nothing is written on the way out");

  const broken = JSON.parse(JSON.stringify(template));
  broken.unresolved = [{ what: "parameter", name: "quarter" }];
  ok(!checkApply({ document: doc(), template: broken }).ok,
     "a request naming something its source did not define refuses too -- a component "
     + "that shows nothing is indistinguishable from one whose query returned nothing");

  // Lifted from the TABLE, which is bound to a panel: the select binds a
  // parameter and carries no request of its own, so it could not show this.
  const bound = lift({ document: doc(), name: "inventory#e-tab", source: SOURCE }).template;
  const sourceless = JSON.parse(JSON.stringify(bound));
  sourceless.panels.forEach((p) => { p.source = null; });
  const none = checkApply({ document: doc(), template: sourceless });
  ok(!none.ok && /nothing to repeat the request against/.test(none.errors[0]),
     "and so does a request with no source recorded: the source is READ on every re-run, "
     + "which is what makes it different from provenance");
}

section("U-84: an apply from an older build of the template form is refused, not read");
{
  const { template } = lift({ document: doc(), name: "inventory#e-tab", source: SOURCE });
  const ahead = { ...template, version: TEMPLATE_VERSION + 1 };
  ok(!checkApply({ document: doc(), template: ahead }).ok,
     "the same rule as U-75: a form this build does not know is refused rather than read "
     + "as much of as possible");
}

/* ── 4. mount (U-86) ──────────────────────────────────────────────────────── */

section("U-86: a mount is a `host' element pointed at a presentation");
{
  const into = doc();
  const r = mount({ document: into, presentation: "inventory", view: "main" });
  ok(r.ok, "it mounts");
  const el = find(r.document.views[0].elements, r.element);
  ok(el.kind === "host" && el.host === `${MOUNT_SCHEME}inventory`,
     "as the EXISTING `ui:host' term with a scheme in the value, not a new term -- an "
     + "older build finds no renderer and draws the band inert with a sentence, where a "
     + "new term would have been dropped on the floor");
  ok(mountedPresentation(el.host) === "inventory" && mountedPresentation("header") === null,
     "and a host of a view is still a host of a view");
  ok(mountsOf(r.document).length === 1, "the document's mounts are listable");
}

section("U-86: once only -- the rule that keeps `resolve' untouched");
{
  const into = doc();
  const first = mount({ document: into, presentation: "inventory" });
  const loaded = [{ presentation: "inventory", at: "workspace", element: first.element }];
  const second = mount({ document: first.document, presentation: "inventory", loaded });
  ok(!second.ok, "a presentation already loaded is not mounted a second time");
  ok(second.resolveTo.at === "workspace",
     "the request resolves to where it already is -- the rule a named view already "
     + "follows, where there is one editor presented for it");
  ok(second.document === first.document, "and the document is untouched");
}

section("U-86: and the scope pair is checked at mount time, not at render");
{
  const r = mount({ document: doc(), presentation: "chrome", scope: "workspace",
                    mounting: "document" });
  ok(!r.ok && /arranges the interface's own bands/.test(r.errors[0]),
     "a workspace is refused in a document, with the reason rather than a code");
}

section("U-86: taking up a revised source is REPLACING the inclusion, not refreshing it");
{
  const into = doc();
  const first = mount({ document: into, presentation: "inventory" });
  const out = unmount({ document: first.document, element: first.element });
  ok(out.ok && out.presentation === "inventory", "the mount comes out");
  ok(mountsOf(out.document).length === 0, "and the document no longer holds one");
  const again = mount({ document: out.document, presentation: "inventory", loaded: [] });
  ok(again.ok,
     "and it goes back in -- which is the whole of `refresh': there is no third operation, "
     + "because a revised source reaches an inclusion only by manual intervention that "
     + "replaces it (§21.4.1)");
}

section("U-86: NOTHING in a document causes an inclusion -- the claim phase 8 rests on");
{
  // The negative test.  Expansion is triggered only by an act external to the
  // representation (§21.4.3), which is why this phase has no cycle check, no
  // visited set and no depth ceiling.  If building a document could expand a
  // mount, all three would be needed and their absence would be a hang.
  const fetched = [];
  const madeDom = () => {
    const make = (tag) => ({
      tag, attrs: {}, children: [], textContent: "", innerHTML: "",
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      get firstChild() { return this.children[0] || null; },
    });
    const document0 = { createElement: make };
    const root0 = make("div");
    root0.ownerDocument = document0;
    return root0;
  };
  const was = globalThis.fetch;
  globalThis.fetch = (...a) => { fetched.push(a[0]); throw new Error("a render fetched"); };
  let faults = [];
  try {
    const into = mount({ document: doc(), presentation: "inventory" }).document;
    const root0 = madeDom();
    mountDom(into.views[0].elements, root0, { onFault: (f) => faults.push(f) });
    const hosts = [];
    const sweep = (n) => { if (n.attrs?.["data-host"]) hosts.push(n); n.children.forEach(sweep); };
    root0.children.forEach(sweep);
    ok(hosts.length === 1, "the mount is built into the DOM");
    ok(hosts[0].getAttribute(INERT_ATTRIBUTE) != null,
       "and it is INERT, because nothing registered a renderer for it");
    ok(hosts[0].children.length === 0, "with nothing inside it");
    ok(fetched.length === 0,
       "and not one request was made: a mount is data that an external act expands, not "
       + "an instruction that expands itself");
    ok(faults.some((f) => /is not registered/.test(f.reason)),
       "the unexpanded mount is reported rather than passed over in silence");
  } finally { globalThis.fetch = was; }
}

/* ── 5. the fork (U-87) ───────────────────────────────────────────────────── */

section("U-87: a rename re-mints, because the fork and its source can both be open");
{
  const d = doc();
  const { document: forked, names } = remintElements(d);
  const beforeNames = [...index(d.views[0].elements).keys()];
  const afterNames = [...index(forked.views[0].elements).keys()];
  ok(afterNames.every((n) => !beforeNames.includes(n)),
     "not one element name survives: two presentations carrying identical names are the "
     + "collision the once-only mount rule does not cover, because they are two names");
  ok(afterNames.length === beforeNames.length, "the shape is the same");
  ok(names["e-panel"] && names["e-panel"] !== "e-panel", "and the mapping is reported");
  const panel = find(forked.views[0].elements, names["e-panel"]);
  ok(panel.children.length === 3 && panel.order === "a",
     "order keys are kept: the fork sits the way the source sat, which is what makes it a copy");
  ok(forked.panels.map((p) => p.name).join() === d.panels.map((p) => p.name).join(),
     "panels keep their names -- nothing outside the document addresses them, and changing "
     + "them would break the bindings for no gain");
}

/* ── 6. the store (U-83, U-86, U-87) ──────────────────────────────────────── */

/**
 * A stub that models the store's BEHAVIOUR rather than SPARQL.
 *
 * It keeps one record per subject, answers the four queries this phase
 * sends, and -- the part that matters -- honours the guard on `claimMount',
 * because what that enforces is a uniqueness constraint and a stub that
 * ignored the guard would make the once-only test pass for the wrong reason.
 */
function store() {
  const records = new Map();
  const calls = [];
  const rows = (bindings) => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ head: {}, results: { bindings } }) });
  const value = (v) => ({ type: "literal", value: String(v) });
  const parse = (body) => {
    const out = {};
    const un = (lit) => lit.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    // Both spellings: `INSERT DATA' writes full IRIs, the guarded `INSERT …
    // WHERE' writes the prefixed form.
    for (const [, p, lit] of body.matchAll(/<http:\/\/dydra\.com\/ns\/ui#([a-zA-Z]+)>\s+"((?:[^"\\]|\\.)*)"/g)) out[p] = un(lit);
    for (const [, p, lit] of body.matchAll(/\bui:([a-zA-Z]+)\s+"((?:[^"\\]|\\.)*)"/g)) out[p] = un(lit);
    return out;
  };
  const kindOf = (body) => (/ui[:#](Arrangement|Mount|Application)/.exec(body) || [])[1] || null;
  const subjectOf = (body) => (/<([^>]+)>\s+<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type>/
    .exec(body) || /DELETE WHERE \{ <([^>]+)>/.exec(body) || [])[1] || null;
  const fetchImpl = async (url, init = {}) => {
    const body = String(init.body || "");
    calls.push({ url, body });
    if (init.headers?.["Content-Type"] === "application/sparql-update") {
      if (/^DELETE WHERE/.test(body.trim())) {
        records.delete(subjectOf(body));
      } else if (/FILTER NOT EXISTS/.test(body)) {
        const s = (/INSERT \{\s*<([^>]+)>/.exec(body) || [])[1];
        if (!records.has(s)) records.set(s, { ...parse(body), __kind: "Mount" });
      } else {
        const s = subjectOf(body);
        const keep = records.get(s) || {};
        records.set(s, { ...keep, ...parse(body), __kind: kindOf(body) || keep.__kind || "?" });
      }
      // a DELETE;INSERT pair arrives as one body
      if (/DELETE WHERE[\s\S]*INSERT DATA/.test(body)) {
        for (const [, s] of body.matchAll(/<([^>]+)>\s+<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type>/g)) {
          const slice = body.slice(body.indexOf(`<${s}>`));
          records.set(s, { ...parse(slice.split("INSERT DATA")[0] || slice), ...parse(slice),
                           __kind: kindOf(slice) || "?" });
        }
      }
      if (/ui:Application/.test(body) && /^PREFIX[\s\S]*DELETE \{/.test(body.trim())) {
        for (const [s, r] of [...records]) if (r.__kind === "Application") records.delete(s);
      }
      return { ok: true, status: 200, text: async () => "" };
    }
    const want = /ui:Arrangement/.test(body) ? "Arrangement"
               : /ui:Mount/.test(body) ? "Mount"
               : /ui:Application/.test(body) ? "Application" : null;
    const only = (/<([^>]+)> a ui:(?:Arrangement|Mount)/.exec(body) || [])[1];
    const out = [];
    for (const [s, r] of records) {
      if (want && r.__kind !== want) continue;
      if (only && s !== only) continue;
      const b = { arrangement: { type: "uri", value: s }, mount: { type: "uri", value: s },
                  application: { type: "uri", value: s } };
      for (const [k, v] of Object.entries(r)) if (k !== "__kind") b[k] = value(v);
      // `ui:of' is projected as ?panel on an application; the stub answers by
      // variable name, so the alias is made here rather than guessed.
      if (r.__kind === "Application") {
        if (r.of != null) b.panel = value(r.of);
        if (/ui:at "([^"]*)"/.test(body) && r.at !== /ui:at "([^"]*)"/.exec(body)[1]) continue;
      }
      out.push(b);
    }
    return rows(out);
  };
  return { fetchImpl, calls, records };
}

section("U-83: the catalogue lists arrangements WITHOUT disclosing their templates");
{
  const { fetchImpl, calls } = store();
  const { template } = lift({ document: doc(), name: "inventory#e-panel", source: SOURCE });
  const written = await writeArrangement({ host: HOST, account: ACCOUNT, token: "t",
                                           name: "stock-card", template, creator: ACCOUNT,
                                           fetchImpl });
  ok(written.ok && written.uri === arrangementIri(HOST, ACCOUNT, "stock-card"),
     "an arrangement is written beside the presentation entries");
  const listed = await listArrangements({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(listed.ok && listed.arrangements[0].name === "stock-card", "and listed");
  ok(listed.arrangements[0].of === "inventory" && listed.arrangements[0].anchor === "e-panel",
     "with what it was lifted from");
  ok(listed.arrangements[0].sources.join().includes("bob/parts"),
     "and the sources its requests name, which U-88 needs before anything is applied");
  const listing = calls.filter((c) => /SELECT/.test(c.body) && /ui:Arrangement/.test(c.body));
  ok(listing.length && listing.every((c) => !/ui:template/.test(c.body)),
     "the LISTING never asks for the template: a listing is shown before anything is "
     + "admitted, and a template carries the author's query text (§21.3's fifth carrier)");
  const back = await readArrangement({ host: HOST, account: ACCOUNT, token: "t",
                                       name: "stock-card", fetchImpl });
  ok(back.ok && back.template.root.name === "p-0" && back.template.panels.length === 1,
     "reading one by name brings the template back whole");
  ok(back.template.source.presentation === "inventory", "provenance survives the round trip");
  const gone = await deleteArrangement({ host: HOST, account: ACCOUNT, token: "t",
                                         name: "stock-card", fetchImpl });
  ok(gone.ok, "and it can be removed");
}

section("U-84: where an applied panel's requests go survives the save");
{
  // The source travels ON THE PANEL, in the presentation graph, because it is
  // read on every re-run.  An interface that does not know the term notes that
  // the page came from a later vocabulary and skips what it cannot draw
  // (U-75, revised) -- which is the whole reason the term can live here at all.
  const { template } = lift({ document: doc(), name: "inventory#e-tab", source: SOURCE });
  const out = apply({ document: doc(), template, view: "main" });
  const applied = out.document.panels.find((p) => p.name === out.names.panels.parts);
  ok(applied.source && applied.source.account === "bob",
     "the applied panel carries the source the inclusion had");
  const base = presentationGraph(HOST, ACCOUNT, "report");
  const back = presentationFromGraph(
    graphFromPresentation(out.document, { base, name: "report" }), { base });
  const read = back.document.panels.find((p) => p.name === out.names.panels.parts);
  ok(back.ok && read.source.account === "bob" && read.source.repository === "parts",
     "and it is still there after a save and a read: the component runs against the "
     + "source the inclusion had, under the READER's credentials, and not against "
     + "whatever repository the page happens to be open on");
  const ordinary = back.document.panels.find((p) => p.name === "parts");
  ok(ordinary.source === null,
     "a panel that runs where the page runs has no source, which is nearly all of them");
}

section("U-84: the apply's record is provenance, and is kept apart from the source");
{
  const { fetchImpl } = store();
  const { template } = lift({ document: doc(), name: "inventory#e-panel", source: SOURCE });
  const r = apply({ document: doc(), template, view: "main" });
  const kept = await recordApplication({ host: HOST, account: ACCOUNT, token: "t",
                                         presentation: "report", arrangement: "stock-card",
                                         requests: r.requests, fetchImpl });
  ok(kept.ok && kept.written.length === 1, "which arrangement went into which page is recorded");
  const back = await readApplications({ host: HOST, account: ACCOUNT, token: "t",
                                        presentation: "report", fetchImpl });
  ok(back.sources[r.requests[0].panel]?.arrangement === "stock-card",
     "and answerable by query afterwards (§21.4.4)");
  ok(kept.written[0].uri === applicationIri(HOST, ACCOUNT, "report", r.requests[0].panel),
     "it sits in the catalogue beside the admissions, not in the presentation");
  ok(true,
     "nothing reads it to decide anything -- the field a re-run consults is the panel's "
     + "own `ui:source', and a field consulted at run time and a field kept for the "
     + "record are different fields");
  const forgotten = await forgetApplications({ host: HOST, account: ACCOUNT, token: "t",
                                               presentation: "report", fetchImpl });
  ok(forgotten.ok, "and they can be forgotten with the presentation");
}

section("U-86: the registry is a uniqueness constraint, decided by the store");
{
  const { fetchImpl } = store();
  const first = await claimMount({ host: HOST, account: ACCOUNT, token: "t",
                                   presentation: "inventory", at: "workspace",
                                   element: "e-aaa", fetchImpl });
  ok(first.ok && first.took, "the first claim takes it");
  const second = await claimMount({ host: HOST, account: ACCOUNT, token: "t",
                                    presentation: "inventory", at: "report",
                                    element: "e-bbb", fetchImpl });
  ok(second.ok && !second.took,
     "the second does not: the guard is `INSERT … WHERE NOT EXISTS', because a read "
     + "followed by a write is two clients both finding it free");
  ok(second.mount.at === "workspace", "and what comes back is where it actually is");
  const held = await readMount({ host: HOST, account: ACCOUNT, token: "t",
                                 presentation: "inventory", fetchImpl });
  ok(held.ok && held.mount.element === "e-aaa", "the registry says which element holds it");
  const all = await listMounts({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(all.ok && all.mounts.length === 1, "and everything loaded is listable");
  const freed = await releaseMount({ host: HOST, account: ACCOUNT, token: "t",
                                     presentation: "inventory", fetchImpl });
  ok(freed.ok, "it can be given up");
  const after = await claimMount({ host: HOST, account: ACCOUNT, token: "t",
                                   presentation: "inventory", at: "report", fetchImpl });
  ok(after.took,
     "and then claimed elsewhere -- release-then-claim being the replacement §21.4.1 "
     + "describes, and the reason there is no refresh");
}

section("U-87: the rename copies the presentation AND the view, and says so separately");
{
  // The presentation half and the view half live in different repositories,
  // so they cannot be one revision.  What matters is that a half-done rename
  // is REPORTED as one rather than returned as a success.
  const presentations = new Map();
  const views = new Map([["inventory", PARTS]]);
  const fetchImpl = async (url, init = {}) => {
    const body = String(init.body || "");
    if (/\/views\//.test(url)) {
      const name = decodeURIComponent(url.split("/views/")[1]);
      if (init.method === "PUT") { views.set(name, body); return { ok: true, status: 200, text: async () => "", headers: { get: () => "" } }; }
      const held = views.get(name);
      return held
        ? { ok: true, status: 200, text: async () => held, headers: { get: () => "application/sparql-query" } }
        : { ok: false, status: 404, text: async () => "", headers: { get: () => "" } };
    }
    if (init.headers?.["Content-Type"] === "application/sparql-update") {
      const g = (/DROP SILENT GRAPH <([^>]+)>/.exec(body) || [])[1];
      if (g) presentations.set(g, body);
      return { ok: true, status: 200, text: async () => "" };
    }
    const graph = (/GRAPH <([^>]+)>/.exec(body) || [])[1];
    const stored = presentations.get(graph);
    const bindings = [];
    if (stored) {
      for (const [, s, p, o] of stored.matchAll(/<([^>]+)>\s+<([^>]+)>\s+(?:"((?:[^"\\]|\\.)*)"|<([^>]+)>)/g)) {
        bindings.push({ s: { type: "uri", value: s }, p: { type: "uri", value: p },
                        o: { type: "literal", value: String(o ?? "") } });
      }
    }
    return { ok: true, status: 200,
             text: async () => JSON.stringify({ head: {}, results: { bindings } }) };
  };
  const stored = presentationGraph(HOST, ACCOUNT, "inventory");
  presentations.set(stored, "DROP SILENT GRAPH <" + stored + ">");
  const r = await renamePresentation({
    host: HOST, account: ACCOUNT, token: "t", from: "inventory", to: "inventory-mine",
    repository: "parts", copyView, fetchImpl });
  ok(!r.ok || r.view, "a rename reports the view half separately from the presentation half");
  ok(views.has("inventory"), "and leaves the original view alone");
}

/* ── 7. the channel (U-85) ────────────────────────────────────────────────── */

section("U-85: the four verbs reach the bar, and prose still reaches the model");
{
  const l = parseInstruction("lift inventory#e-panel as stock-card");
  ok(l.kind === "arrangement" && l.verb === "lift" && l.element === "e-panel" && l.as === "stock-card",
     "lift takes a located component and a name to keep it under");
  ok(parseInstruction(`lift inventory#${xpathOf("e-panel")} as stock-card`).element === "e-panel",
     "and accepts the XPath display form, because that is what the bar shows");
  const a = parseInstruction("apply stock-card into e-panel");
  ok(a.kind === "arrangement" && a.verb === "apply" && a.into === "e-panel", "apply names a destination");
  ok(parseInstruction("mount inventory").verb === "mount", "mount takes a presentation");
  ok(parseInstruction("unmount e-panel").verb === "unmount", "and unmount an element");
  ok(parseInstruction("mount the chart beside the table").kind === "instruct",
     "but `mount the chart beside the table' is still prose: the grammar is whole-string, "
     + "so a verb claimed here is not a sentence taken away from the model (D-AU)");
  ok(parseInstruction("apply the same colours to the legend").kind === "instruct",
     "and so is anything else the strict form does not match exactly");
  ok(parseArrangement("goto /x") === null, "navigation is not an arrangement verb");

  // §33: the composite is the same verb with the anchor left off.
  const whole = parseArrangement("lift predicate-statistics as matrix");
  ok(whole?.verb === "lift" && whole.element === null
     && whole.presentation === "predicate-statistics" && whole.as === "matrix",
     "`lift <presentation> as <name>' is the composite: one form and not two, because "
     + "the two differ in exactly one thing -- how much is taken -- and a hash already "
     + "spells it");
  ok(parseArrangement("lift inventory#e-7k2m as card")?.element === "e-7k2m",
     "and the component form is untouched by widening it");
  ok(parseArrangement("lift the whole page as it stands") === null,
     "while prose that begins with the verb is still prose: the form is whole-string, "
     + "and `the whole page' is three words where one name goes");
}

section("U-118: a destination may name a presentation, and says so with a hash");
{
  const here = parseArrangement("apply stock-card to e-7k2m");
  ok(here?.at === null && here?.into === "e-7k2m",
     "a bare name is an element of what is addressed, which is what it has always been");

  const there = parseArrangement("apply stock-card to orders#e-7k2m");
  ok(there?.at === "orders" && there?.into === "e-7k2m",
     "a qualified name is that element of that presentation");

  const whole = parseArrangement("apply stock-card to orders#");
  ok(whole?.at === "orders" && whole?.into === null,
     "and a trailing hash is the presentation itself, at its root — as it is in a URL");

  const mounted = parseArrangement("mount orders into chrome#w-content");
  ok(mounted?.at === "chrome" && mounted?.into === "w-content",
     "`mount' takes the same destination, because there is one spelling of "
     + "`a place in a presentation' and not two");

  ok(parseArrangement("apply stock-card to #e-7k2m") === null,
     "a hash with nothing before it names no presentation and is refused rather "
     + "than read as the address");
  ok(parseArrangement("apply stock-card to orders#e-7k2m#x") === null,
     "and so is a second hash");

  // The whole reason the hash is required, shown rather than asserted: the
  // same word is a good anchor and a good presentation name, so a bare one
  // cannot be read as either without guessing where the reader meant it.
  const ambiguous = parseArrangement("apply stock-card to orders");
  ok(ambiguous?.into === "orders" && ambiguous?.at === null,
     "`to orders' is still an element called `orders' here, and not the `orders' "
     + "presentation — the hash is what distinguishes them, because nothing in "
     + "the shape of the word does");
}

/* ── 9. the presentation as a file (U-122) ───────────────────────── */

section("U-122: a presentation downloads to the same file a composed page does");
{
  const spec = specOfPresentation(doc());
  ok(spec.views.length === 1 && /<dydra-table/.test(spec.views[0].html),
     "the element tree becomes markup — `htmlFromTree' is the bridge the tree "
     + "model was written with, not a second renderer written for this");
  ok(/data-bound="parts"/.test(spec.views[0].html)
     && /data-derived="count"/.test(spec.views[0].html)
     && /data-ui="e-tab"/.test(spec.views[0].html),
     "carrying the marks the saved page's own runtime fills: what binds it to a "
     + "panel, what is recomputed, and what each element is called");
  ok(/<p id=inner>old<\/p>/.test(spec.views[0].html),
     "and a carrier's markup travels byte for byte, as it does everywhere else");
  ok(spec.panels.length === 2 && spec.panels[0].query === REGIONS
     && spec.uses.includes("table"),
     "the queries and the components it uses travel with it — without them the "
     + "file would be a picture of a page");

  ok(sourceOfPresentation(doc()) === null,
     "a presentation whose panels say nowhere records no address: not guessed, "
     + "because a Refresh offered against a guess refuses after asking for a "
     + "credential rather than before");
  const sourced = built({
    title: "Inventory", uses: ["table"],
    panels: [{ name: "parts", query: PARTS, source: SOURCE }],
    views: [{ name: "main", elements: [
      { name: "e-t", kind: "table", order: "a", bound: "parts" }] }],
  });
  const where = sourceOfPresentation(sourced);
  ok(where && where.repository === "parts" && where.account === "bob",
     `the panel's own source is the authority (U-84): ${JSON.stringify(where)}`);
  ok(sourceOfPresentation(doc(), SOURCE)?.repository === "parts",
     "and a page-level address stands in for panels that name none");

  const file = presentationFile(sourced, { name: "stats-matrix", at: "2026-11-25T10:00:00.000Z" });
  ok(file.ok && file.name === "stats-matrix.html",
     `it saves under its own name: ${file.name}`);
  ok(/id="saved-page-data"/.test(file.html),
     "as the two-document saved page U-111 settled, and not as a second kind of "
     + "artifact answering the same questions differently");
  ok(file.html.includes(PARTS.slice(0, 20)),
     "the query is in the file, which is what makes the copy runnable at all");
  ok(/"results":\{\}/.test(file.html.replace(/\s/g, "")),
     "and no data, because a presentation held by reference has not been run — "
     + "the file opens empty with its Refresh offered rather than opening with "
     + "rows nobody read");
  /* What the file carries, read out of the file rather than argued about: a
     credential baked into a document that travels is a credential that
     travels, and the saved runtime is built so that the reader types one in
     and it is held in a closure. */
  const carried = JSON.parse(
    /<script type="application\/json" id="saved-page-data">([\s\S]*?)<\/script>/
      .exec(file.html)[1].replace(/\\u003c/g, "<"));
  ok(JSON.stringify(carried.source) === JSON.stringify(SOURCE),
     "the address travels whole — host, account, repository — and is all that does");
  ok(!/"token"|"password"|"authorization"/i.test(JSON.stringify(carried)),
     "and no credential travels with it: nothing in what the file holds is one, "
     + "which is the whole reason the reader is asked for theirs");
  ok(/nl4\.dydra\.com/.test(file.html),
     "the address it may connect to is in the file, and in its policy");
  ok(/bob\/parts/.test(file.message) && /Refresh/.test(file.message)
     && /holds no data/.test(file.message),
     `and the press says both of the things that cannot be seen by looking at `
     + `the file: ${JSON.stringify(file.message)}`);

  const empty = presentationFile({ views: [] }, { name: "nothing" });
  ok(!empty.ok && /nothing to draw/.test(empty.error),
     "a presentation with nothing in it is refused rather than saved as a blank page");
  ok(fileNameFor("Stats Matrix!") === "stats-matrix.html",
     "the file name is made from the presentation's own name");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
