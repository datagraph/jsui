/**
 * The repair loop, and the three things that keep it from running away.
 *
 * U-41.  A loop that fixes a page automatically is easy to write and easy to
 * get wrong in ways that are expensive rather than merely untidy: it can
 * spend the grant indefinitely, it can send the whole document on every
 * attempt, and it can quietly let a fix change a query the user never saw.
 * Each of those has a rule in D-AA and an assertion here.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-app-repair-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  createRepairLoop, groupFailures, regionSource, repairPrompt, locate, MAX_ATTEMPTS,
} = await load("app/repair.js");
const { validateApplication } = await load("app/document.js");
const { applyPatch } = await load("app/patch.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const doc = validateApplication({
  id: "app-r", title: "Sales",
  panels: [{ name: "sales", query: "SELECT ?month ?total WHERE { ?s :m ?month }" }],
  transforms: [{ name: "growth", inputs: ["sales"],
                 body: "return inputs.sales.rows.map(r => r[1].toFixed(2));" }],
  assertions: [{ id: "lead", inputs: ["sales"], text: "Totals rose." }],
  script: "window.addEventListener('load', () => { missing(); });",
  views: [{ name: "main",
            html: '<section id="t" data-bound="sales"></section><p id="g" data-derived="growth"></p>'
                + '<p id="l" data-asserted="lead"></p>' }],
}).document;

/* ════════════════════════ what the model is sent ═══════════════════════════ */

section("§11: a fault names a region, and the region names its source");
{
  ok(locate("transform:growth").kind === "transform" && locate("transform:growth").name === "growth",
     "the frame's own label is read back");
  ok(locate("page").kind === "page", "and a fault with no region is a page fault");

  const t = regionSource(doc, "transform:growth");
  ok(t.kind === "transform" && t.source.includes("toFixed"),
     "a transform fault carries the transform's body");
  ok(/reads sales/.test(t.label), "labelled with what it reads, so the model knows what it has");

  ok(regionSource(doc, "bound:sales").source.startsWith("SELECT"),
     "a bound fault carries the panel's query");
  ok(regionSource(doc, "asserted:lead").source === "Totals rose.",
     "an assertion fault carries the sentence");
  ok(regionSource(doc, "page").source.includes("missing()"),
     "and a page fault carries the model's own script");
  ok(regionSource(doc, "transform:ghost") === null,
     "a fault naming something the document does not contain is null — the frame and the "
   + "document have come apart, and the answer is a rebuild rather than a repair");
}

section("§2.5: the repair turn carries the failing region and NOT the document");
{
  const { prompt, regions } = repairPrompt(doc, [
    { where: "transform:growth", error: "TypeError: r[1].toFixed is not a function" },
  ]);
  ok(regions === 1, "one region's source went");
  ok(prompt.includes("toFixed"), "which is in the prompt");
  ok(!prompt.includes("SELECT ?month"), "and the panel query, which did not fail, is not");
  ok(!prompt.includes("Totals rose."), "nor the assertion");
  ok(/```patch/.test(prompt), "the answer asked for is a patch");
  ok(/smallest set of operations/.test(prompt),
     "the smallest one that fixes it — not a re-emission of the parts that work");
  ok(/say so instead of guessing/.test(prompt),
     "and a model that cannot tell is told to say so: a wrong patch costs the attempt");

  const second = repairPrompt(doc, [{ where: "page", error: "x" }], { attempt: 2 });
  ok(/attempt 2 of 2/.test(second.prompt),
     "a second attempt says which attempt it is, because that changes what is worth trying");
}

/* ══════════════════════════ the bound ══════════════════════════════════════ */

section("D-AA: two attempts, and then it stops where a human can see it");
{
  const loop = createRepairLoop();
  const faults = [{ where: "transform:growth", error: "TypeError: boom" }];
  ok(MAX_ATTEMPTS === 2, "two is the bound");
  ok(loop.mayAttempt(faults), "the first attempt is allowed");
  loop.record({ failures: faults, patch: [{ op: "set-transform" }], outcome: "attempted" });
  ok(loop.mayAttempt(faults), "and the second");
  loop.record({ failures: faults, patch: [{ op: "set-transform" }], outcome: "attempted" });
  ok(!loop.mayAttempt(faults),
     "and then no more: an automatic loop that cannot converge must stop where it can be seen");
  ok(loop.summary().exhausted && loop.summary().attempts === 2,
     "with both attempts in the summary the pane shows and the record keeps");
  ok(loop.summary().regions.join(",") === "transform:growth",
     "and the region that would not come right");
}

section("a patch that changed nothing stops the loop one attempt early");
{
  const loop = createRepairLoop();
  const faults = [{ where: "transform:growth", error: "TypeError: boom" }];
  loop.record({ failures: faults, outcome: "unchanged" });
  ok(!loop.mayAttempt(faults),
     "trying again with the same input and the same fault is the definition of not converging");
  ok(loop.mayAttempt([{ where: "page", error: "something else" }]),
     "while a different fault is a different question, and is still worth one attempt");
  ok(!loop.mayAttempt([]), "and with nothing broken there is nothing to attempt");
}

section("the same fault reported twice is one fault");
{
  const events = [
    { type: "error", where: "transform:growth", error: "TypeError: boom" },
    { type: "size", height: 100 },
    { type: "error", where: "transform:growth", error: "TypeError: boom" },
    { type: "error", where: "page", error: "ReferenceError: missing" },
  ];
  const grouped = groupFailures(events);
  ok(grouped.length === 2, "two regions, not three errors");
  ok(grouped.find((g) => g.where === "transform:growth").count === 2,
     "with the repetition counted — a page whose data arrives twice reports twice");
  ok(groupFailures([{ type: "ready" }]).length === 0, "and nothing that is not an error");
}

/* ═════════════════════ a bug is not authority (D-AA) ═══════════════════════ */

section("D-AA: a repair that changes a query stops at Gate 1 like any other patch");
{
  const fix = applyPatch(doc, [
    { op: "set-panel", name: "sales",
      value: { query: "SELECT ?month (xsd:decimal(?total) AS ?total) WHERE { ?s :m ?month }" } },
  ]);
  ok(fix.ok && fix.classification.class === "data" && fix.classification.gate === "gate1",
     "the fact that something is broken is not a reason to run a query the user has not seen");

  const cosmetic = applyPatch(doc, [
    { op: "set-transform", name: "growth",
      value: { inputs: ["sales"], body: "return inputs.sales.rows.map(r => Number(r[1]).toFixed(2));" } },
  ]);
  ok(cosmetic.ok && cosmetic.classification.class === "computational",
     "while the ordinary repair — a transform that threw — asks for no authority");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
