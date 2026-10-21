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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
