/**
 * What an element is called, and which verb could take it (U-104).
 *
 * The ledger that shows this is DOM and is asserted in a browser; what is
 * decided here is everything the DOM half is not allowed to decide -- which
 * elements exist, what each is called, whether the verb being typed could
 * take it, and the sentence shown either way.
 *
 * The claim worth stating: a hover that says yes where the operation would
 * say no is worse than no hover at all, because the refusal then arrives
 * after the Enter and contradicts what the interface just showed.  So every
 * refusal here is the one its operation already answers with -- `lift' and
 * an opaque element, `unmount' and an element that mounts nothing.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-anchors-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  ARRANGEMENT_VERBS, anchorTable, anchorOf, expectation, argumentCheck,
  anchorBadge, anchorLine, anchorArgument, anchorsFor, anchorTips,
} = await load("app/anchors.js");
const { view, node } = await load("app/tree.js");
const { mountHostValue } = await load("app/arrangement.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* A page with one of everything the four verbs care about. */
const PAGE = view({
  name: "main",
  elements: [
    node({ name: "i-head", kind: "heading", order: "a", text: "Inventory" }),
    node({ name: "i-row", kind: "stack", order: "b", children: [
      node({ name: "i-parts", kind: "metric", order: "a", bound: "parts" }),
      node({ name: "i-pick", kind: "select", order: "b", binds: "region" }),
    ] }),
    node({ name: "i-mark", kind: "html", order: "c", html: "<p>drawn by hand</p>" }),
    node({ name: "w-side", kind: "host", order: "d", host: "sidebar", immutable: true }),
    node({ name: "w-stock", kind: "host", order: "e", host: mountHostValue("inventory") }),
  ],
});

section("every element of a view, by name");
{
  const table = anchorTable(PAGE);
  ok(table.size === 7, "every element is there, children included");
  ok(table.get("i-parts").parent === "i-row", "and knows what holds it");
  ok(table.get("i-parts").depth === 1, "and how deep it sits");
  ok(table.get("i-head").kind === "heading", "with the kind it was given");
  ok(table.get("i-parts").shows === "shows panel parts", "what it shows is said as the outline says it");
  ok(table.get("i-pick").shows === "edits parameter region", "and a control says what it edits");
  ok(table.get("i-mark").opaque === true && table.get("w-side").opaque === true,
     "`html' and `host' are the opaque kinds");
  ok(table.get("i-row").opaque === false, "and a tree element is not");
  ok(table.get("w-stock").mounts === "inventory", "a host that mounts a presentation says which");
  ok(table.get("w-side").mounts === null, "and one that hosts a view mounts nothing");
  ok(table.get("w-side").immutable === true, "immutability is carried, because it is worth seeing");
  ok(anchorTable(null).size === 0 && anchorTable({}).size === 0, "no view is no elements, not a throw");
}

section("what a half-typed line is waiting for");
{
  const wants = (line) => expectation(line);
  ok(wants("").verb === null, "an empty line is not an arrangement");
  ok(wants("show me the biggest customers").verb === null, "and neither is prose");
  ok(wants("mou").wants === null, "a verb still being typed is not yet a verb");
  ok(wants("mount").wants === null, "nor is one with nothing after it");
  ok(wants("lift ").wants === "element",
     "`lift' waits for an element from its first argument");
  ok(wants("lift inventory#i-r").wants === "element", "and still is, part-way through one");
  ok(wants("unmount ").wants === "element", "`unmount' takes an element and nothing else");
  ok(wants("apply stock-card").wants === "arrangement",
     "`apply' waits for an ARRANGEMENT first — the page must not light up there");
  ok(wants("apply stock-card into ").wants === "element",
     "and for an element once the preposition says so");
  ok(wants("apply stock-card in i-r").wants === "element", "`in' introduces it too");
  ok(wants("mount inventory").wants === "arrangement", "`mount' names a presentation first");
  ok(wants("mount inventory into w-c").wants === "element", "then where to put it");
  ok(wants("  lift  ").verb === "lift", "leading space is not a different sentence");
  ok(wants("LIFT ").verb === "lift", "and neither is shouting");
  ok(ARRANGEMENT_VERBS.length === 4, "there are four verbs, and this knows all of them");
}

section("may the verb take this element");
{
  const of = (n) => anchorTable(PAGE).get(n);
  ok(argumentCheck("lift", of("i-row")).ok, "a tree element can be lifted");
  ok(!argumentCheck("lift", of("i-mark")).ok, "an `html' element cannot");
  ok(/opaque/.test(argumentCheck("lift", of("i-mark")).reason),
     "and the reason is the one `nameable' gives");
  ok(!argumentCheck("lift", of("w-side")).ok, "nor can a host band");
  ok(argumentCheck("lift", of("w-side")).reason.includes("host"),
     "which says which kind it is, since the two refusals are not the same fix");
  ok(argumentCheck("apply", of("i-row")).ok, "a tree element can be applied into");
  ok(!argumentCheck("apply", of("i-mark")).ok, "an opaque one has no interior");
  ok(argumentCheck("unmount", of("w-stock")).ok, "an element that mounts something can be unmounted");
  ok(argumentCheck("unmount", of("w-stock")).role.includes("inventory"),
     "and says what would go");
  ok(!argumentCheck("unmount", of("i-row")).ok, "an element that mounts nothing cannot");
  ok(argumentCheck("unmount", of("w-side")).ok === false,
     "a host that is not a mount is not one either");
  ok(argumentCheck(null, of("i-row")).ok && argumentCheck(null, of("i-mark")).ok,
     "with no verb every named element is addressable — a name is worth reading anyway");
  ok(argumentCheck("lift", undefined).ok === false, "and nothing is not an element");
}

section("what is shown, and what is typed");
{
  const of = (n) => anchorTable(PAGE).get(n);
  ok(anchorBadge(of("i-row")) === "i-row · stack", "the badge is the name and the kind");
  const line = anchorLine({ presentation: "inventory", entry: of("i-parts"), verb: "lift" });
  ok(line.startsWith("inventory#i-parts · metric"),
     "the line leads with the name that gets typed");
  ok(line.includes("shows panel parts"), "and says what the element shows");
  ok(line.endsWith("— lift this"), "and what the verb would do with it");
  ok(anchorLine({ presentation: "inventory", entry: of("i-mark"), verb: "lift" })
       .includes("opaque"),
     "a refusal is SAID, not left as an element that stopped lighting up");
  ok(!anchorLine({ presentation: "inventory", entry: of("i-row") }).includes("—"),
     "with no verb the line is the name and the kind, and promises nothing");
  ok(anchorLine({ entry: null }) === "", "and nothing is nothing");

  ok(anchorArgument({ presentation: "inventory", entry: of("i-row"), verb: "lift" })
       === "inventory#i-row",
     "a lift is typed qualified: two presentations may mint the same anchor");
  ok(anchorArgument({ presentation: "inventory", entry: of("i-row"), verb: "apply" })
       === "i-row",
     "and the other three take the anchor bare, which is what their grammar accepts");
}

section("the whole view, resolved for one verb");
{
  const table = anchorsFor(PAGE, "lift", { presentation: "inventory" });
  ok(Object.keys(table).length === 7, "every element is in it");
  ok(table["i-row"].ok === true && table["i-mark"].ok === false,
     "each carrying its own answer for that verb");
  ok(table["i-mark"].reason && table["i-mark"].role === null,
     "a refusal carries its sentence and no role");
  ok(table["i-row"].argument === "inventory#i-row", "and what picking it would type");
  ok(JSON.stringify(table).length > 0 && typeof table === "object",
     "and it is plain data: it crosses into a sandbox that cannot import a module");
  const unmounting = anchorsFor(PAGE, "unmount", { presentation: "inventory" });
  ok(unmounting["w-stock"].ok === true && unmounting["i-row"].ok === false,
     "the same view under another verb is another set of candidates");
}

section("the standing answer: what everything is called when nobody is typing");
{
  const tips = anchorTips({ views: [PAGE] }, { presentation: "inventory" });
  ok(Object.keys(tips.elements).length === 7,
     "every element of a tree has one, the children included");
  ok(tips.elements["i-parts"] === "inventory#i-parts · metric, shows panel parts",
     "qualified as it would be typed, and saying what it shows: "
     + `"${tips.elements["i-parts"]}"`);
  ok(!/lift this|cannot be lifted/.test(tips.elements["i-mark"]),
     "and with no verdict about any verb in it -- nobody has named a verb, and a tooltip "
     + "that advised would be a second place the rules live");
  ok(Object.keys(tips.ids).length === 0,
     "a view made of elements has no ids to offer: its parts are anchors");
}

section("a view that is still markup has ids, and they are NOT anchors");
{
  const tips = anchorTips({ views: [
    { name: "raw", elements: null,
      html: '<section id="t223" data-bound="p223"></section><div id="all-stores"></div>' },
  ] }, { presentation: "predicate-statistics" });
  ok(Object.keys(tips.elements).length === 0,
     "a composed page is markup, so it has no element anchors at all -- which is the "
     + "whole reason its regions looked nameless");
  ok(Object.keys(tips.ids).sort().join(",") === "all-stores,t223",
     "what it has is ids, and both are offered -- including the one with no caption, "
     + "whose name was otherwise readable nowhere");
  ok(/not an element anchor/.test(tips.ids.t223)
     && /cannot be lifted/.test(tips.ids.t223),
     "each says what it is NOT, because an id looks exactly like an anchor and the way "
     + `to find out that it is not was to type it and read a refusal: "${tips.ids.t223}"`);
  ok(/changed by an instruction/.test(tips.ids["all-stores"]),
     "and what does take it");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
