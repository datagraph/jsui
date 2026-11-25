/**
 * Where a revision landed, and whether the reply said so (U-116).
 *
 * All of this was reported by a reader, and none of it raised anything: a
 * matrix asked for in another pane was made here, a second instruction asked
 * for it to be moved there, and the pane answered
 * `revision 3 · presentational · applied in place' over a page that had not
 * changed at all.  Every part of that line was true. The part that was
 * missing — whether anything changed where the reader was looking — is the
 * only part they were about to check.
 *
 * Three decisions are tested here and none of them needs a browser:
 *
 *   1. an instruction carries the VIEW it is for, so the runtime applies it
 *      inside that view rather than inside whichever view is on screen;
 *   2. an applied revision that moved nothing, or moved something elsewhere,
 *      says which of those happened;
 *   3. the model is told that a patch reaches one document, so that a
 *      request naming another destination comes back as a sentence rather
 *      than as the nearest thing that could be done here.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-landing-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { whereItLanded } = await load("dashboard/landing.js");
const { elementInstructions } = await load("dashboard/frame.js");
const { revisionSystem, dashboardSystem, DESTINATION_CONTRACT, COMPOSITION_DESTINATION } =
  await load("llm/dashboard-prompt.js");
const { node, view } = await load("app/tree.js");

let passed = 0, failed = 0;
const ok = (c, what) => {
  if (c) { passed += 1; console.log(`  ok  ${what}`); }
  else { failed += 1; console.log(`  FAIL ${what}`); }
};
const section = (t) => console.log(`\n${t}`);

const doc = (views) => ({ id: "orders", title: "Orders", revision: 1, uses: [],
                          panels: [], parameters: [], transforms: [], assertions: [], views });
const panel = (name, order) => node({ name, kind: "panel", order, attributes: { label: name } });

/* ── 1. an instruction says which view it is for ───────────────────────────── */

section("U-116: an element instruction carries the view it belongs to");
{
  const before = doc([view({ name: "main", elements: [panel("p-one", "a")] }),
                      view({ name: "second", elements: [panel("p-two", "a")] })]);
  const after = doc([view({ name: "main", elements: [panel("p-one", "a")] }),
                     view({ name: "second", elements: [panel("p-two", "a"),
                                                       panel("p-new", "b")] })]);
  const list = elementInstructions(before, after, [{ op: "insert-element", view: "second" }]);
  ok(list.length === 1 && list[0].do === "insert" && list[0].name === "p-new",
     "one insert comes back for the element that was added");
  ok(list[0].view === "second",
     "and it says which view it is for — without that the runtime resolves a "
     + "null parent to the view on screen, which is a different view");
  ok(list[0].parent == null,
     "the parent IS null here: it is a root-level insert, which is exactly the "
     + "case that went wrong, because a null parent means `the root of my view'");
}

section("U-116: a patch that touches two views is two groups, each named");
{
  const before = doc([view({ name: "main", elements: [panel("p-one", "a")] }),
                      view({ name: "second", elements: [panel("p-two", "a")] })]);
  const after = doc([view({ name: "main", elements: [panel("p-one", "a"), panel("p-a", "b")] }),
                     view({ name: "second", elements: [panel("p-two", "a"), panel("p-b", "b")] })]);
  const list = elementInstructions(before, after, [{ op: "insert-element" }]);
  const views = list.map((i) => i.view).sort();
  ok(list.length === 2 && views.join(",") === "main,second",
     `both views are represented, each on its own instruction: ${views.join(", ")}`);
}

section("U-116: a patch with no element operation still produces no instructions");
{
  const d = doc([view({ name: "main", elements: [panel("p-one", "a")] })]);
  ok(elementInstructions(d, d, [{ op: "set-title", value: "x" }]).length === 0,
     "a document operation is carried out by the runtime itself, not translated");
}

/* ── 2. what the reply says ───────────────────────────────────────────────── */

section("U-116: applied, and something changed where the reader is looking");
{
  const r = whereItLanded({ applied: "in-place", shown: "main", here: 2, elsewhere: 0,
                            views: ["main"] }, {});
  ok(r.changed === true && r.short === null && r.note === null,
     "the ordinary case says nothing extra — `applied in place' is the whole truth");
}

section("U-116: applied, and nothing on the page changed");
{
  const r = whereItLanded({ applied: "in-place", shown: "main", here: 0, elsewhere: 0,
                            views: [], ops: 0 },
                          { ops: [{ op: "insert-element", parent: "p-one" }] });
  ok(r.changed === false, "it is reported as a change that did not change anything");
  ok(/nothing on the page changed/.test(r.short || ""),
     `and the status line says so: ${JSON.stringify(r.short)}`);
  ok(r.level === "dsh-warn", "as a warning, because the reader is about to ask again");
  ok(/lift <presentation> as <name>/.test(r.note || "")
     && /apply <name> to <that presentation>#/.test(r.note || ""),
     "and the note names the two sentences that DO move an arrangement, because "
     + "asking for somewhere else is the commonest way to reach this");
}

section("U-116: applied, in a view that is not the one on screen");
{
  const r = whereItLanded({ applied: "in-place", shown: "main", here: 0, elsewhere: 3,
                            views: ["main", "second"] }, {});
  ok(r.changed === true, "something did change — it is not a failure");
  ok(/second/.test(r.short || "") && /not the one on screen/.test(r.short || ""),
     `and the line names the view it went to: ${JSON.stringify(r.short)}`);
  ok(/3 elements changed/.test(r.note || "") && /showing `main`/.test(r.note || ""),
     "the note says how much changed and which view is showing, so the reader "
     + "knows to look rather than to retype");
}

section("U-116: a document operation that moves no element is not a warning");
{
  const r = whereItLanded({ applied: "in-place", shown: "main", here: 0, elsewhere: 0, ops: 1 },
                          { ops: [{ op: "set-title", value: "x" }] });
  ok(r.changed === true && r.short === null,
     "a retitle changes nothing in the page and is not a surprise: the warning is "
     + "for a patch that ADDRESSED elements and moved none");
}

section("U-116: a rebuild that added a view says the new view is beside this one");
{
  const before = doc([view({ name: "main", elements: [panel("p-one", "a")] })]);
  const after = doc([view({ name: "main", elements: [panel("p-one", "a")] }),
                     view({ name: "matrix", elements: [panel("p-m", "a")] })]);
  const r = whereItLanded({ applied: "rebuild" }, { before, after });
  ok(r.changed === true && /matrix/.test(r.short || ""),
     `the status names the view that was added: ${JSON.stringify(r.short)}`);
  ok(/Nothing on this tab has changed/.test(r.note || ""),
     "and the note says outright that this tab looks the same, which is the "
     + "whole reason a reader reads a success as a failure here");
  const plain = whereItLanded({ applied: "rebuild" },
                              { before, after: doc([...after.views.slice(0, 1)]) });
  ok(plain.short === null, "a rebuild that added no view says nothing extra");
}

/* ── 3. what the model is told ────────────────────────────────────────────── */

section("U-116: the revision contract says a patch reaches one document");
{
  const sys = revisionSystem("BASE", { document: doc([view({ name: "main", elements: [] })]),
                                       request: "put this in the presentations pane" });
  ok(sys.includes(DESTINATION_CONTRACT.split("\n")[0]), "the contract is carried");
  ok(/this document and no other/.test(sys),
     "it says what a patch reaches");
  ok(/say so.*write no patch|write no patch/is.test(sys),
     "and that a destination it cannot reach is answered in a sentence rather "
     + "than approximated — the approximation is what reached the reader as "
     + "`applied' over a page that had not changed");
  ok(/lift <this presentation> as <name>/.test(sys)
     && /apply <name> to <that presentation>#/.test(sys),
     "naming the two sentences that would actually do it");
  ok(/than the one on screen, because the page will not appear to have changed/.test(sys),
     "and, for a destination that IS reachable — another view — that the page "
     + "will not appear to have changed");
}

section("U-116: the composition contract says where a composed page is drawn");
{
  const sys = dashboardSystem("BASE", { request: "add a panel to the presentations pane" });
  ok(sys.includes(COMPOSITION_DESTINATION.split("\n")[0]), "the clause is carried");
  ok(/In the pane that asked for it, and nowhere else/.test(sys),
     "it says where the page will appear");
  ok(/compose the page as asked and say in one/.test(sys),
     "and what to do with a request that names somewhere else: do the work, and "
     + "say the one thing that cannot be done");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
