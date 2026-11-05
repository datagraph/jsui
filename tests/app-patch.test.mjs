/**
 * The patch protocol, and the classification that decides which gate a
 * follow-up re-opens.
 *
 * U-29 and U-30.  Most of this file is about refusal, which is the part of a
 * patch protocol that has to be right: a patch that half-applies leaves a page
 * in a state no prompt asked for, and a patch misclassified as presentational
 * lets a prompt quietly change what runs against the store.  The second of
 * those is a consent bug, so the classifier is asserted from both directions
 * -- the change that must re-open Gate 1 does, and the change that must not
 * does not.
 *
 * The worked example of §6.3 is run end to end at the bottom, because the
 * three prompts are the thing the protocol exists for and a suite that checked
 * every operation separately could still get the sequence wrong.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-app-patch-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  applyPatch, classify, patchFrom, panelDiff, findElementById, replaceElementById,
  appendIntoElement, OPERATIONS, GATE_FOR,
} = await load("app/patch.js");
const { validateApplication, canonical } = await load("app/document.js");
const { documentSummary } = await load("llm/dashboard-prompt.js");

/** The same summary, with the markup it replaced, for the size comparison. */
const documentSummaryWithHtml = (d) =>
  documentSummary(d) + (d.views || []).map((v) => v.html).join("");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const SALES = "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total }";
const doc = () => validateApplication({
  id: "app-1", revision: 1, title: "Sales",
  panels: [{ name: "sales", query: SALES, caption: "monthly totals" }],
  transforms: [{ name: "growth", inputs: ["sales"], body: "return inputs.sales.rows.length;" }],
  assertions: [{ id: "lead", inputs: ["sales"], text: "Totals rose." }],
  views: [{ name: "main", title: null,
            html: '<h1 id="t">Sales</h1><section id="tbl" data-bound="sales"></section>'
                + '<p id="g" data-derived="growth"></p><p id="l" data-asserted="lead"></p>' }],
}).document;

/* ══════════════════════════ addressing by id ═══════════════════════════════ */

section("§6.1: `set-slot' addresses one element by id, in text, with no DOM");
{
  const html = '<div id="a"><div id="b">inner</div></div><p id="c">tail</p>';
  const a = findElementById(html, "a");
  ok(html.slice(a.start, a.end) === '<div id="a"><div id="b">inner</div></div>',
     "a nested element of the same tag name does not end the outer one early");
  ok(findElementById(html, "c").name === "p", "and the scanner reads the tag name back");
  ok(findElementById(html, "nope") === null, "an id that is not there is null, not a guess");
  ok(findElementById('<img id="i" src="x.png"><p id="p">x</p>', "i").end
     === '<img id="i" src="x.png">'.length, "a void element ends at its own tag");
  ok(findElementById("<div id='q'>x</div>", "q") !== null, "single quotes address the same element");
  ok(findElementById('<div data-x="id=\'q\'" id="r">x</div>', "q") === null,
     "and an id written inside another attribute's value is not one");

  ok(replaceElementById(html, "b", "<em id=\"b\">new</em>")
     === '<div id="a"><em id="b">new</em></div><p id="c">tail</p>',
     "replacing the inner element leaves the outer alone");
  ok(replaceElementById(html, "zz", "<p></p>") === null, "and replacing what is not there fails");
  ok(appendIntoElement(html, "a", "<i>x</i>")
     === '<div id="a"><div id="b">inner</div><i>x</i></div><p id="c">tail</p>',
     "appending goes inside the element, before its close");
  ok(appendIntoElement(html, null, "<i>x</i>").endsWith("<i>x</i>"),
     "and with no id, at the end of the view");
}

/* ═════════════════════════ apply, validate, refuse ═════════════════════════ */

section("§6.2: a patch is applied to a copy and the RESULT is validated");
{
  const before = doc();
  const r = applyPatch(before, [
    { op: "set-slot", id: "l", html: '<p id="l" data-asserted="lead" class="hot"></p>' },
  ]);
  ok(r.ok, "a slot replacement validates");
  ok(r.document.views[0].html.includes('class="hot"'), "and the new markup is in the view");
  ok(before.views[0].html.includes('<p id="l" data-asserted="lead"></p>'),
     "while the document it was applied to is untouched — the copy was the one that changed");
  ok(r.document.revision === 2 && r.document.revisionOf === "app-1#1",
     "the revision is bumped and says what it was made from");
}

section("§6.2: a patch that does not validate is refused WHOLE");
{
  const before = doc();
  const r = applyPatch(before, [
    { op: "set-slot", id: "t", html: '<h1 id="t">Revenue</h1>' },      // fine
    { op: "remove-panel", name: "sales" },                              // breaks the transform
  ]);
  ok(!r.ok, "the patch is refused");
  ok(r.errors.some((e) => /transform `growth' reads `sales'/.test(e)),
     "for the fault the SECOND operation caused, which only the result could show");
  ok(r.document === before || canonical(r.document) === canonical(before),
     "and the title the first operation changed did not survive: half a patch is not applied");
}

section("an operation this version does not know is refused, not ignored");
{
  const r = applyPatch(doc(), [{ op: "set-colour", value: "red" }]);
  ok(!r.ok && r.errors.some((e) => /unknown operation `set-colour'/.test(e)),
     "because ignoring it would silently produce a page the prompt did not ask for");
  const auth = applyPatch(doc(), [{ op: "set-grant", value: { maxQueries: 99 } }]);
  ok(!auth.ok && auth.errors.some((e) => /asks for authority, which a patch cannot grant/.test(e)),
     "and a patch that asks for authority is told it is a proposal for Gate 0");
}

section("operations that address something absent say so");
{
  const missing = applyPatch(doc(), [{ op: "set-slot", id: "nope", html: "<p></p>" }]);
  ok(!missing.ok && missing.errors.some((e) => /addresses id `nope'/.test(e)),
     "a slot id the view does not contain");
  const noview = applyPatch(doc(), [{ op: "remove-view", name: "main" }]);
  ok(!noview.ok && noview.errors.some((e) => /would leave the page with no views/.test(e)),
     "and removing the only view");
  const nopanel = applyPatch(doc(), [{ op: "remove-panel", name: "ghost" }]);
  ok(!nopanel.ok && nopanel.errors.some((e) => /which is not a panel/.test(e)),
     "and removing a panel that is not there");
}

section("a document with two views makes `set-slot' name one");
{
  const two = validateApplication({
    title: "T", panels: [],
    views: [{ name: "a", html: '<p id="x">1</p>' }, { name: "b", html: '<p id="y">2</p>' }],
  }).document;
  const vague = applyPatch(two, [{ op: "set-slot", id: "x", html: '<p id="x">3</p>' }]);
  ok(!vague.ok && vague.errors.some((e) => /must name a view/.test(e)),
     "because guessing which view a card is in is how the wrong card gets replaced");
  const named = applyPatch(two, [{ op: "set-slot", view: "a", id: "x", html: '<p id="x">3</p>' }]);
  ok(named.ok && named.document.views[0].html.includes(">3<"), "and naming it works");
}

/* ═══════════════════════════ D-W: classification ═══════════════════════════ */

section("D-W: a change to a query is a data-class change and re-opens Gate 1");
{
  const r = applyPatch(doc(), [
    { op: "set-panel", name: "sales",
      value: { query: "SELECT ?month ?total ?region WHERE { ?s :month ?month }" } },
  ]);
  ok(r.ok && r.classification.class === "data", "classified data");
  ok(r.classification.gate === "gate1", "which is Gate 1");
  ok(r.classification.rerun.join(",") === "sales", "and the panel re-runs");
  ok(r.classification.reasons.some((x) => /asks the store something different/.test(x.why)),
     "with a reason the user can read");
}

section("D-W: a new panel is a data-class change; the others do not re-run");
{
  const r = applyPatch(doc(), [
    { op: "set-panel", name: "costs", value: { query: "SELECT ?month ?cost WHERE { ?s :cost ?cost }" } },
    { op: "set-transform", name: "margin", value: { inputs: ["sales", "costs"], body: "return 1;" } },
    { op: "append-slot", html: '<p id="m" data-derived="margin"></p>' },
  ]);
  ok(r.ok && r.classification.class === "data", "a new panel is a data change");
  ok(r.classification.rerun.join(",") === "costs", "only the new panel re-runs");
  ok(r.classification.unchanged.join(",") === "sales", "and the unchanged one is named as unchanged");
}

section("D-W: a change to a transform or an assertion is computational, not data");
{
  const r = applyPatch(doc(), [
    { op: "set-transform", name: "growth", value: { inputs: ["sales"], body: "return 2;" } },
  ]);
  ok(r.ok && r.classification.class === "computational" && r.classification.gate === "gate1-lite",
     "the body compiles and the diff is shown; nothing asks the store anything new");
  ok(r.classification.rerun.length === 0, "and no panel re-runs");
}

section("D-W: markup, styles and captions are presentational — no gate, no store");
{
  const r = applyPatch(doc(), [
    { op: "set-slot", id: "tbl", html: '<section id="tbl" data-bound="sales" class="wide"></section>' },
    { op: "set-styles", value: ".wide{width:100%}" },
    { op: "set-title", value: "Monthly sales" },
  ]);
  ok(r.ok && r.classification.class === "presentational", "classified presentational");
  ok(r.classification.gate === "none", "which opens no gate");
  ok(r.classification.rerun.length === 0, "and runs nothing");
  ok(r.classification.rebuild === false,
     "and can be applied in the frame in place, without reloading it (§6.2.1)");
}

section("D-W: a caption change on a panel does not become a data change");
{
  const r = applyPatch(doc(), [
    { op: "set-panel", name: "sales", value: { caption: "totals, by month" } },
  ]);
  ok(r.ok && r.classification.class === "presentational",
     "`set-panel' is not what makes a change data-class; changing what it asks the store is");
  ok(r.document.panels[0].query === SALES, "and the query is carried through untouched");
}

section("D-W: three things force a rebuild although they re-run nothing");
{
  const uses = applyPatch(doc(), [{ op: "use", add: ["metric"] }]);
  ok(uses.ok && uses.classification.rebuild === true,
     "a component that was not inlined is not in the frame to be used");
  const script = applyPatch(doc(), [{ op: "set-script", value: "void 0;" }]);
  ok(script.ok && script.classification.rebuild === true, "and a new page script has to be run");
  const view = applyPatch(doc(), [{ op: "set-view", name: "extra", value: { html: '<p id="e">x</p>' } }]);
  ok(view.ok && view.classification.rebuild === true, "and so does a view that did not exist");
}

section("D-W: the class is the strongest change in the patch, not the last one");
{
  const r = applyPatch(doc(), [
    { op: "set-styles", value: "p{}" },
    { op: "set-panel", name: "sales", value: { query: "SELECT ?x WHERE { ?s :x ?x }" } },
    { op: "set-title", value: "T" },
  ]);
  ok(r.ok && r.classification.class === "data",
     "a patch that changes a query and a colour is a patch that changes a query");
}

section("D-W: the classification is computed, never declared by the model");
{
  const before = doc();
  const after = applyPatch(before, [
    { op: "set-panel", name: "sales", value: { query: "SELECT ?z WHERE { ?s :z ?z }" } },
  ]).document;
  // The model's own account of the patch says it only changed a colour.  The
  // comparison does not consult it.
  const c = classify(before, after, [{ op: "set-styles" }]);
  ok(c.class === "data",
     "a patch described as presentational and performing a data change is a data change");
  ok(Object.keys(GATE_FOR).length === 4 && OPERATIONS.includes("set-slot"),
     "and the four classes each name a gate");
}

/* ═══════════════════════════ reading the block ═════════════════════════════ */

section("the patch block");
{
  ok(patchFrom('x\n```patch\n[{"op":"set-title","value":"A"}]\n```').length === 1,
     "a fenced ```patch block of operations");
  ok(patchFrom('```patch\n{"op":"set-title","value":"A"}\n```').length === 1,
     "a single operation written without its brackets is accepted rather than losing the turn");
  ok(patchFrom("```patch\nnot json\n```") === null, "and a block that is not JSON is nothing");
  ok(patchFrom("no block here") === null, "as is no block at all");
}

/* ═════════════════════════ §6.3, the three prompts ═════════════════════════ */

section("§6.3: the three prompts, end to end");
{
  // 1. what happens today.
  const first = validateApplication({
    id: "app-9", revision: 1, title: "Regional sales",
    panels: [{ name: "regions", query: "SELECT DISTINCT ?region WHERE { ?s :region ?region }" },
             { name: "sales", query: "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total }" }],
    views: [{ name: "main",
              html: '<h1 id="h">Regional sales</h1><section id="tbl" data-bound="sales"></section>' }],
  });
  ok(first.ok && first.document.revision === 1, "prompt 1 produces revision 1");

  // 2. "Add a margin figure next to each month, and put a region selector at
  //    the top."  A patch: a new panel, a transform, a parameter, the sales
  //    query gains ?region, two slots and two components.
  const second = applyPatch(first.document, [
    { op: "set-panel", name: "costs",
      value: { query: "SELECT ?month ?cost WHERE { ?s :month ?month ; :cost ?cost }" } },
    { op: "set-transform", name: "margin", value: { inputs: ["sales", "costs"], body: "return [];" } },
    { op: "set-parameter", name: "region",
      value: { kind: "literal", domain: { from: "regions", column: "region" }, default: "North" } },
    { op: "set-panel", name: "sales",
      value: { query: "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total ; :region ?region }",
               parameters: ["region"] } },
    { op: "append-slot", html: '<section id="margin-card" data-derived="margin"></section>' },
    { op: "use", add: ["metric", "select"] },
  ]);
  ok(second.ok, "prompt 2's patch applies and validates");
  ok(second.classification.class === "data", "classified data — a query changed and a panel is new");
  ok(second.classification.rerun.sort().join(",") === "costs,sales",
     "two panels of three re-run");
  ok(second.classification.unchanged.join(",") === "regions",
     "and `regions', unchanged, does not");
  const d = panelDiff(first.document, second.document);
  ok(d.find((x) => x.name === "costs").change === "added"
     && d.find((x) => x.name === "sales").change === "changed"
     && d.find((x) => x.name === "regions").change === "unchanged",
     "Gate 1 shows exactly that: one added, one diffed, one left alone");
  ok(second.document.revision === 2, "revision 2");

  // 3. "The margin column should be red when negative, and move it before the
  //    total."  Slot and stylesheet only.
  const third = applyPatch(second.document, [
    { op: "set-slot", id: "margin-card",
      html: '<section id="margin-card" data-derived="margin" class="neg"></section>' },
    { op: "set-styles", value: ".neg td.down{color:#8a2b2b}" },
  ]);
  ok(third.ok && third.classification.class === "presentational", "prompt 3 is presentational");
  ok(third.classification.gate === "none" && third.classification.rerun.length === 0,
     "no gate, no query, no round trip to the store");
  ok(third.classification.rebuild === false,
     "and no reload: this is the case that makes interactive design feel like design");
  ok(third.document.revision === 3 && third.document.revisionOf === "app-9#2",
     "revision 3, made from revision 2");
}

/* ═══════════════ U-64: addressing the page by element ═════════════════════ */

const tree = (extra = {}) => validateApplication({
  id: "app-t", revision: 1, title: "Inventory",
  uses: ["panel", "table", "metric", "card"],
  panels: [{ name: "parts", query: SALES, caption: "monthly totals" },
           { name: "other", query: "SELECT ?x WHERE { ?s :x ?x }" }],
  transforms: [{ name: "count", inputs: ["parts"], body: "return 1;" }],
  views: [{ name: "main", elements: [
    { name: "e-panel", kind: "panel", order: "a", attributes: { label: "Parts" },
      layout: { columns: "1fr 1fr", gap: 12, areas: ["left right"] },
      children: [
        { name: "e-left", kind: "card", order: "a", placement: { area: "left" },
          children: [{ name: "e-table", kind: "table", order: "a", bound: "parts" }] },
        { name: "e-right", kind: "metric", order: "b", placement: { area: "right" },
          attributes: { label: "Count", value: "7" } },
      ] },
    { name: "e-note", kind: "p", order: "b", text: "As at the last import." },
  ] }],
  ...extra,
}).document;

const elementsIn = (d, view = "main") =>
  (d.views.find((v) => v.name === view) || {}).elements || [];
const findIn = (d, name) => {
  const out = [];
  const walk = (ns) => ns.forEach((n) => { out.push(n); walk(n.children || []); });
  walk(elementsIn(d));
  return out.find((n) => n.name === name) || null;
};
const parentIn = (d, name) => {
  let found = null;
  const walk = (ns, parent) => ns.forEach((n) => {
    if (n.name === name) found = parent;
    walk(n.children || [], n.name);
  });
  walk(elementsIn(d), null);
  return found;
};

section("U-64: insert-element puts one where it was asked for");
{
  const r = applyPatch(tree(), [{ op: "insert-element", parent: "e-left", after: "e-table",
                                  name: "e-new", kind: "metric",
                                  attributes: { label: "Added", value: "1" } }]);
  ok(r.ok, r.errors.join("; ") || "applied");
  ok(parentIn(r.document, "e-new") === "e-left", "under the container named");
  const kids = findIn(r.document, "e-left").children.map((c) => c.name);
  ok(kids.join() === "e-table,e-new", `after the sibling named (${kids})`);
  ok(findIn(r.document, "e-table").order === findIn(tree(), "e-table").order,
     "and the sibling's own key did not change — one insert, one key (D-AJ)");
  ok(/data-ui="e-new"/.test(r.document.views[0].html), "the markup is regenerated from the tree");
  ok(r.classification.class === "presentational", "and it costs nothing: no gate");
}

section("an element with no name gets one, and a repeated name is refused");
{
  const minted = applyPatch(tree(), [{ op: "insert-element", parent: "e-left", kind: "p",
                                       text: "x" }]);
  ok(minted.ok && elementsIn(minted.document).length === 2, "minted");
  const clash = applyPatch(tree(), [{ op: "insert-element", parent: "e-left",
                                      name: "e-table", kind: "p" }]);
  ok(!clash.ok && /second element named `e-table'/.test(clash.errors[0]),
     "a name already in the page is refused, because a name is an address");
}

section("set-attribute sets an attribute, a field, or neither");
{
  const r = applyPatch(tree(), [{ op: "set-attribute", element: "e-right",
                                  name: "value", value: "12" }]);
  ok(r.ok && findIn(r.document, "e-right").attributes.value === "12", "an attribute");

  const t = applyPatch(tree(), [{ op: "set-attribute", element: "e-note",
                                  name: "text", value: "Counted this morning." }]);
  ok(t.ok && findIn(t.document, "e-note").text === "Counted this morning.",
     "a field, by the same operation — six operations rather than sixteen");

  const cleared = applyPatch(tree(), [{ op: "set-attribute", element: "e-right",
                                        name: "value", value: null }]);
  ok(cleared.ok && findIn(cleared.document, "e-right").attributes.value === undefined,
     "null clears it");

  const wrong = applyPatch(tree(), [{ op: "set-attribute", element: "e-table",
                                      name: "nonesuch", value: "1" }]);
  ok(!wrong.ok && /has no attribute `nonesuch'/.test(wrong.errors[0]),
     "an attribute the component has not got is refused, not written and ignored");

  const typed = applyPatch(tree(), [{ op: "set-attribute", element: "e-table",
                                      name: "sortable", value: "true" }]);
  ok(typed.ok && findIn(typed.document, "e-table").attributes.sortable === true,
     "and a value is coerced to what the manifest declares");
}

section("move-element moves it, and refuses to put it inside itself");
{
  const r = applyPatch(tree(), [{ op: "move-element", element: "e-table",
                                  parent: "e-panel", area: "right" }]);
  ok(r.ok, r.errors.join("; ") || "moved");
  ok(parentIn(r.document, "e-table") === "e-panel", "to its new container");
  ok(findIn(r.document, "e-table").placement.area === "right", "with its new placement");
  ok(findIn(r.document, "e-left").children.length === 0, "and out of the old one");

  const loop = applyPatch(tree(), [{ op: "move-element", element: "e-left", parent: "e-table" }]);
  ok(!loop.ok && /inside itself/.test(loop.errors[0]),
     "a move into its own subtree would stop the tree being a tree");
}

section("remove-element takes the subtree with it");
{
  const r = applyPatch(tree(), [{ op: "remove-element", element: "e-left" }]);
  ok(r.ok, r.errors.join("; ") || "removed");
  ok(!findIn(r.document, "e-left") && !findIn(r.document, "e-table"),
     "the element and everything under it");
  ok(r.warnings.some((w) => /is run but never used/.test(w)),
     "with the existing warning doing its job: a panel nothing reads now costs a query for nothing");
}

section("D-AK: rearranging is set-layout on the container, and touches no child");
{
  const before = tree();
  const r = applyPatch(before, [{ op: "set-layout", element: "e-panel",
                                  value: { columns: "1fr 1fr", gap: 12,
                                           areas: ["right left"] } }]);
  ok(r.ok, r.errors.join("; ") || "rearranged");
  ok(findIn(r.document, "e-panel").layout.areas.join() === "right left", "the template is the new one");
  ok(canonical(findIn(r.document, "e-left")) === canonical(findIn(before, "e-left"))
     && canonical(findIn(r.document, "e-right")) === canonical(findIn(before, "e-right")),
     "and neither child changed in any way");
  ok(r.classification.class === "presentational", "no gate");
}

section("set-placement moves one child between areas");
{
  const r = applyPatch(tree(), [{ op: "set-placement", element: "e-right",
                                  value: { area: "left" } }]);
  ok(r.ok && findIn(r.document, "e-right").placement.area === "left", "placed");
  const nowhere = applyPatch(tree(), [{ op: "set-placement", element: "e-right",
                                        value: { area: "middle" } }]);
  ok(!nowhere.ok && /does not declare/.test(nowhere.errors[0]),
     "into an area the container never declared: refused, because it would render "
   + "somewhere plausible and be found on a screen");
}

section("an element that is not there is named, not guessed at");
{
  const r = applyPatch(tree(), [{ op: "set-attribute", element: "e-nope", name: "id", value: "x" }]);
  ok(!r.ok && /names element `e-nope', which is not in this page/.test(r.errors[0]), "by name");
}

section("a view that is still markup is promoted when something is put in it");
{
  const r = applyPatch(doc(), [{ op: "insert-element", kind: "metric", name: "e-added",
                                 attributes: { label: "New", value: "1" } }]);
  ok(r.ok, r.errors.join("; ") || "applied");
  const kinds = elementsIn(r.document).map((n) => n.kind);
  ok(kinds.join() === "html,metric",
     `the old markup becomes one carrier with the new element beside it (${kinds})`);
  ok(elementsIn(r.document)[0].html.includes('data-bound="sales"'),
     "holding exactly what it held — not reinterpreted (D-AN)");
  const slot = applyPatch(r.document, [{ op: "set-slot", id: "tbl", html: "<p>x</p>" }]);
  ok(!slot.ok && /address the element instead/.test(slot.errors[0]),
     "and from then on a slot operation is refused rather than silently overwritten");
}

/* ══════════════════ U-65: what an element change costs ════════════════════ */

section("U-65: a binding gained takes the class of what it points at");
{
  const bound = applyPatch(tree(), [{ op: "set-attribute", element: "e-right",
                                      name: "bound", value: "other" }]);
  ok(bound.ok && bound.classification.class === "data",
     "an element that starts showing a panel puts store data in front of the reader");
  ok(bound.classification.gate === "gate1", "so Gate 1 opens");
  ok(bound.classification.reasons.some((r) => /now shows bound `other'/.test(r.why)),
     "and the reason names the element and the panel");

  const moved = applyPatch(tree(), [{ op: "set-attribute", element: "e-table",
                                      name: "bound", value: "other" }]);
  ok(moved.ok && moved.classification.class === "data",
     "and so does one that starts showing a different panel");

  const derived = applyPatch(tree(), [{ op: "set-attribute", element: "e-right",
                                        name: "derived", value: "count" }]);
  ok(derived.ok && derived.classification.class === "computational",
     "a transform is computational, which is the cheaper gate");
}

section("a binding LOST is presentational — the asymmetry is the point");
{
  const cleared = applyPatch(tree(), [{ op: "set-attribute", element: "e-table",
                                        name: "bound", value: null }]);
  ok(cleared.ok && cleared.classification.class === "presentational",
     "a page that shows less cannot show the reader anything they did not consent to");
  const gone = applyPatch(tree(), [{ op: "remove-element", element: "e-table" }]);
  ok(gone.ok && gone.classification.class === "presentational",
     "and deleting a chart stays free, as it should");
}

section("an ordinary element change is presentational and applies in place");
{
  const r = applyPatch(tree(), [{ op: "move-element", element: "e-right", parent: "e-left" },
                                 { op: "set-attribute", element: "e-note", name: "text",
                                   value: "later" }]);
  ok(r.ok && r.classification.class === "presentational", "no gate");
  ok(r.classification.rebuild === false, "and no rebuild: the runtime can do this where it stands");
}

/* ══════════════════════ U-66: immutable regions ═══════════════════════════ */

const guarded = () => validateApplication({
  id: "app-i", revision: 1, title: "Guarded",
  uses: ["panel", "metric"],
  panels: [{ name: "parts", query: SALES }],
  views: [{ name: "main", elements: [
    { name: "e-frame", kind: "div", order: "a",
      layout: { columns: "1fr 1fr", areas: ["body gate"] },
      children: [
        { name: "e-body", kind: "div", order: "a", placement: { area: "body" },
          children: [{ name: "e-tab", kind: "metric", order: "a", bound: "parts",
                       attributes: { label: "Parts" } }] },
        { name: "e-gate", kind: "div", order: "b", placement: { area: "gate" },
          immutable: true, text: "Authority" },
      ] },
    // A sibling, so that removing the frame is a removal rather than an
    // empty page: the question being asked is what happened to `e-gate'.
    { name: "e-foot", kind: "p", order: "b", text: "foot" },
  ] }],
}).document;

section("U-66: an immutable element cannot be removed, moved or re-kinded");
{
  ok(guarded().views[0].elements[0].children[1].immutable, "the fixture is marked");
  const removed = applyPatch(guarded(), [{ op: "remove-element", element: "e-gate" }]);
  ok(!removed.ok && /`e-gate' may not be removed/.test(removed.errors[0]), "removed");
  const moved = applyPatch(guarded(), [{ op: "move-element", element: "e-gate", parent: "e-body" }]);
  ok(!moved.ok && /may not be moved out of/.test(moved.errors[0]), "moved");
  const rekinded = applyPatch(guarded(), [{ op: "set-attribute", element: "e-gate",
                                            name: "kind", value: "span" }]);
  ok(!rekinded.ok && /may not be changed from a div to a span/.test(rekinded.errors[0]), "re-kinded");
}

section("nor hidden — including by something that never names it");
{
  const hidden = applyPatch(guarded(), [{ op: "set-attribute", element: "e-gate",
                                          name: "hidden", value: true }]);
  ok(!hidden.ok && /may not be hidden/.test(hidden.errors[0]), "hidden outright");

  const above = applyPatch(guarded(), [{ op: "set-attribute", element: "e-frame",
                                         name: "hidden", value: true }]);
  ok(!above.ok && /`e-frame' hides it/.test(above.errors[0]),
     "hidden by an ancestor, which names the element nowhere");

  const outOfTheTemplate = applyPatch(guarded(), [
    { op: "set-layout", element: "e-frame", value: { columns: "1fr", areas: ["body"] } }]);
  ok(!outOfTheTemplate.ok && /no longer\s+declares/.test(outOfTheTemplate.errors.join(" ")),
     "and hidden by dropping its area from its container's template — the one that is "
   + "genuinely hard to see, which is why the check is a post-condition on the result");

  const containerGone = applyPatch(guarded(), [{ op: "remove-element", element: "e-frame" }]);
  ok(!containerGone.ok && /`e-gate' may not be removed/.test(containerGone.errors[0]),
     "or by deleting what holds it");
}

section("and a patch may not hand out the mark, in either direction");
{
  const claiming = applyPatch(guarded(), [{ op: "insert-element", parent: "e-body",
                                            kind: "div", immutable: true }]);
  ok(!claiming.ok && /set by the interface, not by a patch/.test(claiming.errors[0]),
     "a model that could mark its own work immutable could lock the page");
  const freeing = applyPatch(guarded(), [{ op: "set-attribute", element: "e-gate",
                                           name: "immutable", value: null }]);
  ok(!freeing.ok && /set by the interface, not by a patch/.test(freeing.errors[0]),
     "and one that could clear the mark would only need two patches");
}

section("what an immutable element does not stop");
{
  const r = applyPatch(guarded(), [{ op: "set-attribute", element: "e-tab",
                                     name: "label", value: "Components" }]);
  ok(r.ok, r.errors.join("; ") || "the rest of the page is as free as it was");
}

/* ════════════════════════ U-73: the outline ═══════════════════════════════ */

section("U-73: the model is shown an outline, not markup");
{
  const summary = documentSummary(tree());
  ok(/Views and the elements a patch can address/.test(summary), "the views are listed by element");
  ok(/e-panel\s+panel/.test(summary), "name first, kind second — the address in the first column");
  ok(/grid\(cols=1fr 1fr areas="left right"\)/.test(summary), "with the grid on the container");
  ok(/area=left/.test(summary), "the area on the child");
  ok(/shows panel parts/.test(summary), "and what each element shows");
  ok(!/<dydra-panel/.test(summary), "and no markup at all: it is several times the size");
  ok(summary.length < documentSummaryWithHtml(tree()).length,
     "which is the other half of the reason");
}

section("an immutable element says so in the outline");
{
  const summary = documentSummary(guarded());
  ok(/e-gate.*IMMUTABLE/.test(summary),
     "so the model is told before it writes the patch, not after it is refused");
}

section("a markup view is still listed by its ids");
{
  const summary = documentSummary(doc());
  ok(/Views that are still markup/.test(summary) && /`tbl`/.test(summary),
     "set-slot keeps working and keeps being described");
  ok(/turns the whole view into one element/.test(summary),
     "with what an insert there would do, since that is a decision the model is making");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
