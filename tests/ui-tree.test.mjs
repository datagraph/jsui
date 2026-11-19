/**
 * The element tree, its markup, and its graph (U-57, U-59, U-60).
 *
 * The claims, in the order they matter:
 *
 *   1. A tree survives the round trip through RDF unchanged.  Everything in
 *      phase 3 rests on it: if `graphFromTree' and `treeFromGraph' disagree
 *      anywhere, a presentation changes by being saved, and the revision
 *      history records edits nobody made.
 *   2. `htmlFromTree' produces markup the existing frame already knows how to
 *      render -- `data-bound', `data-derived', component tags, grid styles --
 *      because the whole point of D-AN is that the machinery downstream does
 *      not have to be told about any of this.
 *   3. The validator refuses what it says it refuses, and says WHY in terms
 *      of the element rather than the triple.
 *   4. `diffTrees' reports one element when one element changed.  That is
 *      what the reconciler consumes and therefore what "no unrelated
 *      component is disturbed" reduces to; the browser suite asserts the
 *      other half.
 *
 * The loading note from the other suites applies.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-tree-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  node, view, walk, index, find, insert, mintName,
  htmlFromTree, treeFromHtml, isLegacyTree, styleFor, attributesFor,
  graphFromTree, treeFromGraph, validateTree, diffTrees, canonicalTree,
  iriFor, nameFromIri, MAX_DEPTH,
} = await load("app/tree.js");
const {
  UI, UIA, T, VOCABULARY_VERSION, vocabularyReport, attributesOf,
  checkAttribute, checkKind, tagFor, GENERIC_ELEMENTS,
} = await load("app/vocabulary.js");
const { COMPONENTS } = await load("app/toolbox/index.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);
const BASE = "http://dydra.com/alice/ui/presentations/parts";

/* a small tree used throughout: a panel with a grid, a select and a table */
const sample = () => view({
  name: "main", title: "Inventory",
  elements: [
    node({
      name: "e-panel", kind: "panel", order: "a",
      attributes: { label: "Component inventory", caption: "by assembly" },
      layout: { columns: "220px 1fr", gap: 12, areas: ["filter table"] },
      children: [
        node({ name: "e-filter", kind: "select", order: "a",
               attributes: { parameter: "assembly", panel: "parts" },
               placement: { area: "filter" }, binds: "assembly" }),
        node({ name: "e-table", kind: "table", order: "b",
               attributes: { sortable: true, "page-size": 25 },
               placement: { area: "table" }, bound: "parts" }),
      ],
    }),
    node({ name: "e-note", kind: "p", order: "b", text: "Counted at the last import.",
           asserted: "lead" }),
  ],
});

/* ═══════════════════════════ the vocabulary ═══════════════════════════════ */

section("U-57: the attribute vocabulary is generated, and in step");
{
  const report = vocabularyReport(COMPONENTS);
  ok(report.ok, report.conflicts.join("; ") || "no two components give one attribute name two types");
  ok(report.terms.some((t) => t.name === "label" && t.components.length > 1),
     "one `uia:' term is shared by every component that declares it");
  ok(report.terms.every((t) => t.term.startsWith(UIA)), "every term is in the attribute namespace");
  ok(attributesOf("table", COMPONENTS).has("sortable"),
     "a component's attributes come from its own manifest");
  ok(!attributesOf("table", COMPONENTS).has("data"),
     "and a property that is not an attribute is not one — `data' is set by the frame");
  ok(attributesOf("p", COMPONENTS).has("id"), "a plain element gets the generic set");
}

section("what an attribute may be");
{
  ok(checkAttribute("table", "sortable", "true", COMPONENTS).value === true,
     "a boolean arrives from the DOM as a string and is coerced");
  ok(checkAttribute("table", "page-size", "25", COMPONENTS).value === 25, "and a number likewise");
  ok(!checkAttribute("badge", "tone", "sideways", COMPONENTS).ok,
     "an enum is refused rather than guessed at");
  ok(!checkAttribute("table", "nonesuch", "x", COMPONENTS).ok,
     "an attribute the component does not declare is an error, not a silent no-op");
  ok(!checkAttribute("p", "onclick", "x", COMPONENTS).ok, "and handlers are not attributes");
  ok(!checkAttribute("p", "data-bound", "x", COMPONENTS).ok,
     "nor are the runtime's own data- attributes");
}

section("what a kind may be");
{
  ok(checkKind("table", COMPONENTS).ok, "a component");
  ok(checkKind("section", COMPONENTS).ok, "a plain element");
  ok(checkKind("html", COMPONENTS).ok && checkKind("host", COMPONENTS).ok, "the two carriers");
  ok(!checkKind("script", COMPONENTS).ok, "and nothing that loads or runs");
  ok(!GENERIC_ELEMENTS.includes("img") && !GENERIC_ELEMENTS.includes("iframe"),
     "the allowlist holds nothing that fetches");
  ok(tagFor("table", COMPONENTS) === "dydra-table" && tagFor("p", COMPONENTS) === "p",
     "a kind becomes its element");
}

/* ════════════════════════════ markup ══════════════════════════════════════ */

section("U-59: the markup is what the frame already renders");
{
  const html = htmlFromTree(sample().elements, { components: COMPONENTS });
  ok(/<dydra-panel /.test(html), "a component becomes its custom element");
  ok(/data-ui="e-panel"/.test(html), "every element carries its identity");
  ok(/label="Component inventory"/.test(html), "attributes are written out");
  ok(/data-bound="parts"/.test(html), "a bound region is still data-bound");
  ok(/data-asserted="lead"/.test(html), "and an asserted one data-asserted");
  ok(/display:grid/.test(html) && /grid-template-areas:'filter table'/.test(html),
     "the layout is written as grid CSS");
  ok(/grid-area:filter/.test(html), "and placement as grid-area");
  ok(/sortable=""/.test(html) || /<dydra-table[^>]*\ssortable[^=]/.test(html),
     "a true boolean is written as a bare attribute");
  ok(/Counted at the last import\./.test(html), "text is text");
  ok(html.indexOf("e-filter") < html.indexOf("e-table"), "and children are in key order");
}

section("text and attributes are escaped");
{
  const t = view({ elements: [node({ name: "e-x", kind: "p", order: "a",
                                     text: '<script>alert("x")</script>',
                                     attributes: { title: 'he said "no" & left' } })] });
  const html = htmlFromTree(t.elements, { components: COMPONENTS });
  ok(!/<script>/.test(html) && /&lt;script&gt;/.test(html),
     "text from a graph is text, always — it is written by other people");
  ok(/title="he said &quot;no&quot; &amp; left"/.test(html), "and an attribute cannot end itself");
}

section("the order children are written in is the order of their keys, not of the array");
{
  const t = view({ elements: [
    node({ name: "e-second", kind: "p", order: "b", text: "two" }),
    node({ name: "e-first", kind: "p", order: "a", text: "one" }),
  ] });
  const html = htmlFromTree(t.elements, { components: COMPONENTS });
  ok(html.indexOf("one") < html.indexOf("two"), "sorted on the way out");
}

/* ═════════════════════════ the legacy carrier ═════════════════════════════ */

section("U-60: a page that is markup stays markup, and keeps an identity");
{
  const markup = '<h1 id="h">Sales</h1><section id="s" data-bound="sales"></section>';
  const tree = treeFromHtml(markup);
  ok(tree.length === 1 && tree[0].kind === "html", "one opaque element, not a parse");
  ok(isLegacyTree(tree), "recognisable as such");
  const out = htmlFromTree(tree, { components: COMPONENTS });
  ok(out.includes(markup), "whose markup comes out byte for byte");
  ok(/data-ui="e-/.test(out), "wrapped in something addressable, so siblings can be put beside it");
  ok(treeFromHtml("   ").length === 0, "and an empty view is an empty tree");
}

section("a carrier and a tree coexist, which is what makes migration incremental");
{
  const mixed = view({ elements: [
    ...treeFromHtml("<p>the old page</p>"),
    node({ name: "e-new", kind: "metric", order: "z", attributes: { label: "Total", value: "4" } }),
  ] });
  const checked = validateTree(mixed.elements, { components: COMPONENTS });
  ok(checked.ok, checked.errors.join("; ") || "both validate in one view");
}

/* ══════════════════════════ the round trip ════════════════════════════════ */

section("U-59: a tree survives the round trip through RDF");
{
  const before = sample();
  const triples = graphFromTree(before, { base: BASE, components: COMPONENTS });
  const { views, warnings } = treeFromGraph(triples, { base: BASE, components: COMPONENTS });

  ok(warnings.length === 0, warnings.join("; ") || "nothing is reported on the way back");
  ok(views.length === 1 && views[0].name === "main" && views[0].title === "Inventory",
     "the view comes back with its name and title");
  ok(JSON.stringify(canonicalTree(views[0].elements)) === JSON.stringify(canonicalTree(before.elements)),
     "and the tree is identical — every attribute, placement, layout and binding");
}

section("the shape of what is written");
{
  const triples = graphFromTree(sample(), { base: BASE, components: COMPONENTS });
  const has = (s, p) => triples.some((t) => t.s === s && t.p === p);
  const panel = iriFor.element(BASE, "e-panel");
  ok(has(panel, T.parent) && has(panel, T.order) && has(panel, T.kind),
     "an element has a parent, an order and a kind");
  ok(triples.some((t) => t.s === panel && t.p === `${UIA}label`),
     "its attributes are `uia:' predicates, one triple each");
  ok(triples.some((t) => t.s === iriFor.layout(BASE, "e-panel") && t.p === T.areas),
     "its layout is a NAMED resource, so a patch can DELETE it by name");
  ok(triples.some((t) => t.p === T.bound && t.o.iri === iriFor.panel(BASE, "parts")),
     "and a bound region points at the panel resource");
  const areas = triples.find((t) => t.p === T.areas);
  ok(areas && !areas.o.iri, "areas is one literal, not a list — the rows are already in order");
}

section("changing one attribute changes one triple");
{
  const before = graphFromTree(sample(), { base: BASE, components: COMPONENTS });
  const after2 = sample();
  find(after2.elements, "e-panel").attributes.label = "Parts";
  const after = graphFromTree(after2, { base: BASE, components: COMPONENTS });
  const key = (t) => `${t.s} ${t.p} ${t.o.iri ?? t.o.value}`;
  const gone = before.filter((t) => !after.some((u) => key(u) === key(t)));
  const came = after.filter((t) => !before.some((u) => key(u) === key(t)));
  ok(gone.length === 1 && came.length === 1 && gone[0].p === `${UIA}label`,
     `one out, one in (${gone.length}/${came.length})`);
}

section("rearranging a panel changes one triple");
{
  const before = graphFromTree(sample(), { base: BASE, components: COMPONENTS });
  const swapped = sample();
  find(swapped.elements, "e-panel").layout.areas = ["table filter"];
  const after = graphFromTree(swapped, { base: BASE, components: COMPONENTS });
  const key = (t) => `${t.s} ${t.p} ${t.o.iri ?? t.o.value}`;
  const gone = before.filter((t) => !after.some((u) => key(u) === key(t)));
  ok(gone.length === 1 && gone[0].p === T.areas,
     "the areas template, and nothing on either child (D-AK)");
}

section("a graph is read defensively, because other writers can reach it");
{
  const triples = graphFromTree(sample(), { base: BASE, components: COMPONENTS });
  const orphaned = triples.map((t) =>
    (t.s === iriFor.element(BASE, "e-table") && t.p === T.parent)
      ? { ...t, o: { value: null, datatype: null, iri: `${BASE}#e-gone` } } : t);
  const read = treeFromGraph(orphaned, { base: BASE, components: COMPONENTS });
  ok(read.warnings.some((w) => /parent that is not in the graph/.test(w)),
     "an element whose parent is missing is reported");
  ok(read.views[0].elements.length === 2, "and the rest of the tree still loads");

  const cyclic = [
    { s: `${BASE}#v-main`, p: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", o: { iri: T.View, value: null, datatype: null } },
    { s: `${BASE}#v-main`, p: T.name, o: { value: "main", datatype: null, iri: null } },
    { s: `${BASE}#e-a`, p: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", o: { iri: T.Element, value: null, datatype: null } },
    { s: `${BASE}#e-a`, p: T.parent, o: { iri: `${BASE}#e-b`, value: null, datatype: null } },
    { s: `${BASE}#e-a`, p: T.kind, o: { value: "p", datatype: null, iri: null } },
    { s: `${BASE}#e-b`, p: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", o: { iri: T.Element, value: null, datatype: null } },
    { s: `${BASE}#e-b`, p: T.parent, o: { iri: `${BASE}#e-a`, value: null, datatype: null } },
    { s: `${BASE}#e-b`, p: T.kind, o: { value: "p", datatype: null, iri: null } },
  ];
  const loop = treeFromGraph(cyclic, { base: BASE, components: COMPONENTS });
  ok(loop.views[0].elements.length === 0 && loop.warnings.some((w) => /cycle/.test(w)),
     "and a cycle is reported rather than recursed into");
}

/* ═══════════════════════════ the validator ════════════════════════════════ */

section("U-59: what the validator refuses");
{
  const bad = (elements) => validateTree(elements, { components: COMPONENTS });

  ok(!bad([node({ name: "e-x", kind: "marquee", order: "a" })]).ok,
     "a kind that is neither a component nor a plain element");
  ok(bad([node({ name: "e-x", kind: "marquee", order: "a" })]).errors[0].includes("`html' element"),
     "and the error says where such markup does belong");

  ok(!bad([node({ name: "e-x", kind: "table", order: "a", attributes: { nope: 1 } })]).ok,
     "an attribute the component does not have");

  ok(!bad([node({ name: "e-x", kind: "html", order: "a", html: "<p>x</p>",
                  children: [node({ name: "e-y", kind: "p", order: "a" })] })]).ok,
     "a carrier with children, which could only render one of the two");

  ok(!bad([node({ name: "e-x", kind: "host", order: "a" })]).ok, "a host that names no view");

  ok(!bad([node({ name: "e-x", kind: "p", order: "a" }),
           node({ name: "e-x", kind: "p", order: "b" })]).ok, "two elements with one name");

  ok(!bad([node({ name: "e-x", kind: "p", order: "not a key!" })]).ok, "an unusable order key");

  const misplaced = bad([node({ name: "e-g", kind: "div", order: "a",
                                layout: { areas: ["head"] },
                                children: [node({ name: "e-c", kind: "p", order: "a",
                                                  placement: { area: "main" } })] })]);
  ok(!misplaced.ok && misplaced.errors[0].includes("does not declare"),
     "a child placed in an area its container never declared — which would render "
   + "somewhere plausible and be found on a screen");
}

section("and what it warns about");
{
  const styled = validateTree([node({ name: "e-x", kind: "div", order: "a",
                                      style: "display:grid;grid-template-columns:1fr 1fr" })],
                              { components: COMPONENTS });
  ok(styled.ok && styled.warnings.some((w) => /no patch can move/.test(w)),
     "D-AK: arrangement hidden in free CSS is allowed and reported, not refused");

  const loose = validateTree([node({ name: "e-c", kind: "p", order: "a",
                                     placement: { area: "main" } })], { components: COMPONENTS });
  ok(loose.ok && loose.warnings.some((w) => /declares no areas/.test(w)),
     "a placement with no grid above it is a warning, not an error");
}

section("the ceilings");
{
  let deep = node({ name: "e-0", kind: "div", order: "a" });
  const rootNode = deep;
  for (let i = 1; i <= MAX_DEPTH + 2; i += 1) {
    const next = node({ name: `e-${i}`, kind: "div", order: "a" });
    deep.children.push(next); deep = next;
  }
  ok(!validateTree([rootNode], { components: COMPONENTS }).ok, "a tree nested past the limit");
}

/* ═════════════════════════════ the diff ═══════════════════════════════════ */

section("U-59: the diff reports what changed and nothing else");
{
  const before = sample().elements;
  const after = sample().elements;
  find(after, "e-note").text = "Counted this morning.";
  const d = diffTrees(before, after);
  ok(d.changed.length === 1 && d.changed[0].name === "e-note", "one element");
  ok(JSON.stringify(d.changed[0].fields) === JSON.stringify({ text: "Counted this morning." }),
     "one field");
  ok(!d.added.length && !d.removed.length && !d.moved.length, "and nothing else at all");
}

section("an inserted subtree is reported once, at its root");
{
  const before = sample().elements;
  const after = sample().elements;
  find(after, "e-panel").children.push(node({
    name: "e-card", kind: "card", order: "c",
    children: [node({ name: "e-inner", kind: "p", order: "a", text: "x" })],
  }));
  const d = diffTrees(before, after);
  ok(d.added.length === 1 && d.added[0].name === "e-card",
     "the reconciler builds a subtree in one go, so it is told once");
  ok(d.added[0].parent === "e-panel", "with where to put it");
}

section("a move is a move, not a delete and an insert");
{
  const before = sample().elements;
  const after = sample().elements;
  const table = find(after, "e-table");
  find(after, "e-panel").children = find(after, "e-panel").children.filter((c) => c.name !== "e-table");
  after.push(table);
  table.order = "c";
  const d = diffTrees(before, after);
  ok(d.moved.length === 1 && d.moved[0].name === "e-table" && d.moved[0].from === "e-panel"
     && d.moved[0].to === null,
     "reported as moved, so the node keeps its value, its focus and its canvas");
  ok(!d.removed.length && !d.added.length, "and neither removed nor added");
}

section("an attribute set and an attribute cleared");
{
  const before = sample().elements;
  const after = sample().elements;
  find(after, "e-table").attributes.paged = true;
  delete find(after, "e-table").attributes.sortable;
  const d = diffTrees(before, after);
  ok(d.changed.length === 1
     && d.changed[0].fields.attributes.paged === true
     && d.changed[0].fields.attributes.sortable === null,
     "set is the value, cleared is null");
}

section("two trees that mean the same thing diff to nothing");
{
  const a = sample().elements;
  const b = sample().elements;
  b[0].children.reverse();                       // array order is not tree order
  ok(diffTrees(a, b).empty, "the array order children arrive in is not a change");
}

/* ═══════════════════════════ names and insert ═════════════════════════════ */

section("D-AI: a name says nothing about where the element is");
{
  const names = new Set();
  for (let i = 0; i < 500; i += 1) names.add(mintName());
  ok(names.size === 500, "minted names do not collide in five hundred");
  ok([...names].every((n) => /^e-[a-z0-9]{8}$/.test(n)), "and are opaque");
}

section("insert mints the key, in one place");
{
  const v = sample();
  const panel = find(v.elements, "e-panel");
  const added = insert(v.elements, { parent: panel, after: "e-filter" }, node({ name: "e-mid", kind: "p" }));
  const order = panel.children.slice().sort((x, y) => (x.order < y.order ? -1 : 1)).map((c) => c.name);
  ok(order.join(",") === "e-filter,e-mid,e-table", `inserted between: ${order.join(",")}`);
  ok(added.order > "a" && added.order < "b", "with a key strictly between its neighbours");
  const first = insert(v.elements, { parent: panel, before: "e-filter" }, node({ name: "e-top", kind: "p" }));
  ok(first.order < "a", "and prepending works too");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
