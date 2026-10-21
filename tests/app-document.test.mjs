/**
 * The application document: the generalisation, and what it refuses.
 *
 * U-27 and U-28.  Two kinds of claim are made here and they are not the same
 * kind.  The first is that NOTHING CHANGED: today's spec is the one-view case
 * of the document, and a page that validated yesterday validates identically
 * today, with the same errors in the same words.  That claim is mostly carried
 * by `tests/dashboard.test.mjs', which was not touched, and is restated here
 * only where the projection could silently differ.
 *
 * The second is that the five new checks of §5.3 refuse what they say they
 * refuse.  Each of them exists because the failure it prevents happens inside
 * the frame, after the page is on the screen, where what reaches the user is a
 * blank region and no reason for it -- so each is asserted both ways: the bad
 * document is refused, and the good one that looks like it is not.
 *
 * The loading note from the other suites applies: jsui's package.json declares
 * no "type", so the lib tree is copied into a scratch package that does.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-app-document-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  validateApplication, applicationFrom, liftLegacy, specOf, viewsOf, canonical,
  mintId, sizeOf, projectedVariables, idsOf, MAX_PAGE_BYTES, MAX_STATE_BYTES,
} = await load("app/document.js");
const { validateDashboard, dashboardRecord } = await load("dashboard/spec.js");
const { groupByApplication } = await load("dashboard/archive.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const SALES = "SELECT ?region ?total WHERE { ?s :region ?region ; :total ?total }";
const base = (extra = {}) => ({
  title: "Sales",
  panels: [{ name: "sales", query: SALES }],
  html: '<section id="s" data-bound="sales"></section>',
  ...extra,
});

/* ══════════════════ the legacy shape is the one-view case ══════════════════ */

section("D-U: today's spec is an application document with one view");
{
  const lifted = liftLegacy(base());
  ok(Array.isArray(lifted.views) && lifted.views.length === 1 && lifted.views[0].name === "main",
     "a spec with `html' lifts to one view named main");
  ok(!("html" in lifted), "and the lifted shape no longer carries the flat html");

  const v = validateApplication(base());
  ok(v.ok, "which validates");
  ok(v.document.application === 1 && v.document.revision === 1,
     "as a version-1 document at revision 1");
  ok(v.document.toolbox === "1", "naming the toolbox version it was written against (§13.10)");

  const projected = specOf(v.document);
  ok(projected.html === base().html, "and projects back to exactly the html it came from");
  ok(projected.panels.length === 1 && projected.title === "Sales",
     "with the panels and the title unchanged");

  const legacy = validateDashboard(base());
  ok(legacy.ok && legacy.spec.html === base().html,
     "`validateDashboard' is that projection, not a second validator");
  ok(legacy.document && legacy.document.views.length === 1,
     "and hands the document out beside the spec, for the callers that patch it");
}

section("a document with views needs no html at all");
{
  const v = validateApplication({
    title: "Two",
    panels: [{ name: "sales", query: SALES }],
    views: [
      { name: "overview", title: "Overview", html: '<div id="a" data-bound="sales"></div>' },
      { name: "detail", title: "By month", html: '<div id="b">…</div>' },
    ],
  });
  ok(v.ok, "two views validate");
  ok(v.document.views.map((x) => x.name).join(",") === "overview,detail",
     "and keep their order, which is the order they were declared in");
  ok(specOf(v.document).html.includes("data-bound") && specOf(v.document).html.includes("id=\"b\""),
     "a reader with no notion of views sees all of the page, in order");
  ok(viewsOf({ html: "<p>x</p>" })[0].name === "main",
     "and `viewsOf' gives a legacy spec the same one-view reading");
}

/* ══════════════════════════ §5.3, the new refusals ═════════════════════════ */

section("§5.3: a parameter whose domain names a panel that does not exist");
{
  const v = validateApplication(base({
    parameters: [{ name: "region", domain: { from: "regions", column: "region" } }],
  }));
  ok(!v.ok && v.errors.some((e) => /takes its values from `regions', which is not a panel/.test(e)),
     "is refused, naming the panel");
}

section("§5.3: a parameter whose domain names a column the panel does not return");
{
  const v = validateApplication({
    title: "P",
    panels: [
      { name: "regions", query: "SELECT ?region WHERE { ?s :region ?region }" },
      { name: "sales", query: "SELECT ?region ?total WHERE { ?s :region ?region }",
        parameters: ["region"] },
    ],
    parameters: [{ name: "region", domain: { from: "regions", column: "district" } }],
    html: '<div id="a" data-bound="sales"></div>',
  });
  ok(!v.ok && v.errors.some((e) => /`district'/.test(e) && /which that panel does not return/.test(e)),
     "is refused, and says what the panel does return");

  const okDoc = validateApplication({
    title: "P",
    panels: [
      { name: "regions", query: "SELECT ?region WHERE { ?s :region ?region }" },
      { name: "sales", query: "SELECT ?region ?total WHERE { ?s :region ?region }",
        parameters: ["region"] },
    ],
    parameters: [{ name: "region", domain: { from: "regions", column: "region" } }],
    html: '<div id="a" data-bound="sales"></div>',
  });
  ok(okDoc.ok, "and the same document with the right column is not");

  ok(projectedVariables("SELECT * WHERE { ?s ?p ?o }") === null,
     "a projection the text cannot read is `cannot tell', not an empty list");
  ok(projectedVariables("SELECT DISTINCT ?a ?b WHERE { }").join(",") === "a,b",
     "DISTINCT does not hide the variables");
  ok(projectedVariables("SELECT (COUNT(*) AS ?n) WHERE { }").join(",") === "n",
     "and an aliased expression is read by its alias");
}

section("§5.3: a panel that names a parameter not declared");
{
  const v = validateApplication(base({
    panels: [{ name: "sales", query: SALES, parameters: ["region"] }],
  }));
  ok(!v.ok && v.errors.some((e) => /names parameter `region', which is not declared/.test(e)),
     "is refused");
}

section("§5.3: a declared parameter that binds nothing is a control that does nothing");
{
  const v = validateApplication({
    title: "P",
    panels: [{ name: "sales", query: "SELECT ?total WHERE { ?s :total ?total }",
               parameters: ["region"] }],
    parameters: [{ name: "region", domain: { values: ["North"] } }],
    html: '<div id="a" data-bound="sales"></div>',
  });
  ok(!v.ok && v.errors.some((e) => /its query never uses \?region/.test(e)),
     "is refused: the user would turn the control and get the same rows back");

  const unused = validateApplication(base({
    parameters: [{ name: "region", domain: { values: ["North"] } }],
  }));
  ok(unused.ok && unused.warnings.some((w) => /no panel uses it/.test(w)),
     "while a parameter no panel mentions at all is a warning, not an error");
}

section("§5.3: a view name that is not unique, and navigation to a view that is not there");
{
  const twice = validateApplication({
    title: "T", panels: [],
    views: [{ name: "a", html: "<p id=x>1</p>" }, { name: "a", html: "<p id=y>2</p>" }],
  });
  ok(!twice.ok && twice.errors.some((e) => /view `a' is declared twice/.test(e)),
     "a repeated view name is refused");

  const nowhere = validateApplication({
    title: "T", panels: [],
    views: [{ name: "a", html: '<a id="l" data-view="detail">detail</a>' }],
  });
  ok(!nowhere.ok && nowhere.errors.some((e) => /navigates to view `detail', which does not exist/.test(e)),
     "and a link to a view that does not exist is refused at the gate, not discovered by clicking it");

  const fine = validateApplication({
    title: "T", panels: [],
    views: [{ name: "a", html: '<a id="l" data-view="b">b</a>' }, { name: "b", html: "<p id=p>2</p>" }],
  });
  ok(fine.ok, "a link to a view that does exist is not");
}

section("§5.3: `uses' is checked against the toolbox when there is one");
{
  const components = {
    card: { source: "/*card*/", style: ".c{}", needs: {} },
    chart: { source: "/*chart*/", style: "", needs: { components: ["card"] } },
    plot: { source: "/*plot*/", style: "", needs: { capabilities: ["gnuplot"] } },
  };
  const unknown = validateApplication(base({ uses: ["nosuch"] }), { components });
  ok(!unknown.ok && unknown.errors.some((e) => /not in the toolbox/.test(e)),
     "a component that is not in the toolbox is refused");
  const byDefault = validateApplication(base({ uses: ["nosuch"] }));
  ok(!byDefault.ok && byDefault.errors.some((e) => /not in the toolbox/.test(e)),
     "and the real toolbox is the default, so no caller can forget to check");
  ok(validateApplication(base({ uses: ["card", "table"] })).ok,
     "while the names the real toolbox does have pass");

  const dep = validateApplication(base({ uses: ["chart"] }), { components });
  ok(dep.ok && dep.document.uses.join(",") === "chart,card",
     "a dependency the model did not name is added rather than refused");
  ok(dep.warnings.some((w) => /needs `card', which has been added/.test(w)),
     "and the addition is said out loud, because it is page bytes the model did not ask for");

  const cap = validateApplication(base({ uses: ["plot"] }), { components });
  ok(!cap.ok && cap.errors.some((e) => /needs `gnuplot', which this interface cannot provide/.test(e)),
     "a capability the host cannot supply is refused (§8.2)");

  const nocat = validateApplication(base({ uses: ["nosuch"] }), { components: null });
  ok(nocat.ok && nocat.document.uses.join(",") === "nosuch",
     "and with no catalog to check against, `uses' is carried through rather than refused");
}

/*
 * The element name is the one the model is SHOWN.
 *
 * Found live, 2026-10-21: a page declared `uses: ["dydra-grid", "dydra-panel",
 * "dydra-table"]' and was refused three times over, with the run button left
 * disabled under a full set of correctly proposed panels.  The model had not
 * guessed -- the catalog headed every component with `<dydra-table>' and the
 * markup takes that same tag -- so the interface showed one name and demanded
 * another.  Both halves are held here: the validator resolves it, and the
 * catalog now prints the name it is asking for.
 */
section("§5.3: `uses' takes the element name too, because that is what the catalog shows");
{
  const v = validateApplication(base({ uses: ["dydra-grid", "dydra-panel", "dydra-table"] }));
  ok(v.ok, "the three names that were refused on a live page are accepted");
  ok(v.document.uses.join(",").startsWith("grid,panel,table"),
     "and normalised to the component name, so everything downstream reads one spelling");
  ok(!v.warnings.some((w) => /dydra-/.test(w)),
     "without a warning: the model wrote what it was shown, and there is nothing to correct");

  const mixed = validateApplication(base({ uses: ["table", "dydra-table"] }));
  ok(mixed.ok && mixed.document.uses.filter((u) => u === "table").length === 1,
     "naming a component both ways is one component, not two");

  const bad = validateApplication(base({ uses: ["dydra-nosuch"] }));
  ok(!bad.ok && bad.errors.some((e) => /`dydra-nosuch', which is not in the toolbox/.test(e)),
     "an element that is in no toolbox is still refused — and reported as the model spelled it, "
   + "so the error names a string that is findable in the answer");
}

section("§5.3: the page's size is measured, because the model cannot measure it");
{
  const big = "x".repeat(MAX_PAGE_BYTES + 10);
  const v = validateApplication(base({ html: `<div id="a">${big}</div>` }));
  ok(!v.ok && v.errors.some((e) => /KiB inlined/.test(e) && /the limit is/.test(e)),
     "a page over the budget is refused with the number");
  ok(v.errors.some((e) => /markup \d+, styles \d+, script \d+, components \d+/.test(e)),
     "broken down, because the breakdown is the line the model can act on");

  const s = sizeOf({ views: [{ html: "12345" }], styles: "12", script: "123", uses: ["card"] },
                   { card: { source: "1234", style: "12" } });
  ok(s.html === 5 && s.styles === 2 && s.script === 3 && s.components === 6 && s.total === 16,
     "and the measurement counts markup, styles, script and the components `uses' names");
}

section("§10.3: state is bounded");
{
  const v = validateApplication(base({ state: { blob: "y".repeat(MAX_STATE_BYTES + 1) } }));
  ok(!v.ok && v.errors.some((e) => /`state' is \d+ bytes; the limit is/.test(e)),
     "a page that writes a megabyte of state is refused, and told why");
  const small = validateApplication(base({ state: { view: "overview", region: "North" } }));
  ok(small.ok && small.document.state.region === "North", "a few keys are kept");
}

section("a view whose regions carry no id can only be revised whole");
{
  const v = validateApplication(base({ html: "<section data-bound=\"sales\"></section>" }));
  ok(v.ok && v.warnings.some((w) => /gives its regions no id/.test(w)),
     "which is a warning at Gate 1, where the page can still be asked for again");
  ok(idsOf('<p id="a"></p><div id=\'b\'></div>').join(",") === "a,b",
     "and the ids are read in document order");
}

/* ═══════════════════════════ normalisation ═════════════════════════════════ */

section("D-W rests on two equal documents serialising identically");
{
  const a = validateApplication({ title: "X", panels: [{ name: "p", query: SALES }],
                                  html: '<div id="d" data-bound="p"></div>' }).document;
  const b = validateApplication({ html: '<div id="d" data-bound="p"></div>',
                                  panels: [{ name: "p", query: SALES, accept: "text/tab-separated-values" }],
                                  title: "X" }).document;
  ok(canonical(a) === canonical(b),
     "key order in the model's answer does not reach the comparison");
  ok(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }) === '{"a":[2,{"c":4,"d":3}],"b":1}',
     "because the canonical form sorts keys at every depth");
  ok(mintId().startsWith("app-") && mintId() !== mintId(), "and an id is minted, time-ordered and distinct");
}

/* ═══════════════════════ U-28: identity in the record ══════════════════════ */

section("U-28: the record carries identity and history");
{
  const doc = validateApplication({
    id: "app-1", revision: 3, title: "Sales",
    panels: [{ name: "sales", query: SALES }],
    uses: ["card"],
    parameters: [],
    views: [{ name: "main", html: '<div id="a" data-bound="sales"></div>' }],
  }).document;
  const rec = dashboardRecord({ ...doc, revisionOf: "app-1#2" }, {},
                              { patches: [{ op: "set-title", value: "Sales" }] });
  ok(rec.id === "app-1" && rec.revision === 3 && rec.revisionOf === "app-1#2",
     "the id, the revision and what it was made from");
  ok(rec.uses.includes("card") && rec.toolbox === "1",
     "the components it inlined and the contract version they answer to");
  ok(rec.uses.includes("base") && !doc.uses.some((u) => /needs/.test(u)),
     "with the toolbox's own shared helper added silently — not a choice the model made");
  ok(rec.views.length === 1 && rec.html.includes("data-bound"),
     "the views, and the whole page beside them for a reader that wants one string");
  ok(rec.patches.length === 1, "and the operations that produced this revision from the last");

  const legacy = dashboardRecord({ title: "T", html: "<p>x</p>", panels: [], transforms: [],
                                   assertions: [] });
  ok(legacy.id === null && legacy.revision === null && legacy.views === null,
     "a record written from a page with no identity carries none, rather than inventing one");
  ok(legacy.html === "<p>x</p>", "and still carries the page");
}

section("U-28: the archive groups revisions of one page into one entry");
{
  const rows = [
    { uri: "u1", application: "app-1", revision: 1, recorded: "2026-10-01" },
    { uri: "u2", application: "app-1", revision: 2, recorded: "2026-10-02" },
    { uri: "u3", application: "app-2", revision: 1, recorded: "2026-10-03" },
    { uri: "u4", application: null, revision: null, recorded: "2026-09-01" },
  ];
  const groups = groupByApplication(rows);
  ok(groups.length === 3, "four records, three things");
  const one = groups.find((g) => g.id === "app-1");
  ok(one.count === 2 && one.latest.uri === "u2",
     "the newest revision stands for the group and says how many there are");
  ok(one.revisions[0].revision === 2 && one.revisions[1].revision === 1,
     "with the others reachable through it, newest first");
  ok(groups[0].latest.uri === "u3", "and the groups are ordered by when they were last touched");
  ok(groups.some((g) => g.id === null && g.latest.uri === "u4"),
     "a record written before revisions existed is its own group — it really is a page that happened once");
}

section("§13.10: a document names the toolbox version it was written against");
{
  const future = validateApplication(base({ toolbox: "2" }));
  ok(!future.ok && future.errors.some((e) => /toolbox version 2; this interface has version 1/.test(e)),
     "and one written against a version this build does not have is refused, not mounted "
   + "subtly wrong");
  ok(validateApplication(base()).document.toolbox === "1",
     "while a document that names none is this version's");
}

section("the fenced block is read under either name");
{
  ok(applicationFrom("text\n```dashboard\n{\"panels\":[]}\n```") !== null,
     "```dashboard, which is what every recorded run carries");
  ok(applicationFrom("```application\n{\"views\":[]}\n```") !== null,
     "```application, which is what a document with views is called in the prompt now");
  ok(applicationFrom("```dashboard\n{not json}\n```") === null, "and nothing at all from a block that is not JSON");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
