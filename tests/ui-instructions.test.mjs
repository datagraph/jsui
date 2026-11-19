/**
 * The instruction channel, decided without a browser (U-76, U-77, U-78, U-72).
 *
 * Everything the location bar does that could be WRONG rather than merely
 * broken is here: what a typed line means, what it is addressed to, and what
 * happens to the chrome when a model answers. The browser suite drives the
 * same code through real events; this one drives the decisions, because the
 * decisions are where the cost of being wrong is asymmetric —
 *
 *   an exploration read as an arrangement wastes a turn;
 *   an arrangement read as a path loses the sentence;
 *   a path sent to a model spends the user's money on a 404.
 *
 * The three cases that matter most and have no DOM in them at all:
 *
 *   1. `goto` is the only navigation keyword, a bare path still navigates,
 *      and nothing else is ever read as a location (U-76).
 *   2. An address resolves to exactly one thing or refuses — never to the
 *      nearest one, because the NEXT instruction then acts on something the
 *      user did not mean (U-77).
 *   3. The chrome refuses a change that reaches the data class, falls back
 *      to a usable arrangement rather than to nothing, and offers an undo
 *      that is a revert rather than an inverse (U-72, U-78).
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-instructions-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  parseInstruction, resolveTarget, describeTarget, addressRefusal, pathLike, pathOf,
  target: makeTarget, NAVIGATION_PREFACE,
} = await load("app/instructions.js");
const {
  defaultWorkspace, defaultWorkspaceView, arrangementOf, checkArrangement,
  workspaceViewFor, restoreRequested, WORKSPACE_HOSTS, IMMUTABLE_HOSTS,
  REQUIRED_HOSTS, WORKSPACE_NAME, hostElement,
} = await load("app/workspace.js");
const { runWorkspaceInstruction, describe } = await load("app/workspace-instruction.js");
const { instructionSystem, workspaceSummary, WORKSPACE_CONTRACT } =
  await load("llm/instruction-prompt.js");
const { validateApplication } = await load("app/document.js");
const { applyPatch } = await load("app/patch.js");
const { selectComponents } = await load("app/toolbox/catalog.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const TARGETS = [
  makeTarget({ id: "workspace", label: "workspace", kind: "workspace" }),
  makeTarget({ id: "dashboard-alice-parts", label: "Parts inventory", kind: "presentation",
               instruct: async () => ({ ok: true, message: "did it" }) }),
  makeTarget({ id: "dashboard-alice-orders", label: "Open orders", kind: "presentation" }),
];

/* ═══════════════════ U-76: what a typed line means ═══════════════════ */

section("U-76: `goto' navigates, and it is the only keyword that does");
{
  ok(NAVIGATION_PREFACE === "goto", "the preface is `goto'");
  const g = parseInstruction("goto /account/alice/repositories/parts");
  ok(g.kind === "navigate" && g.path === "/account/alice/repositories/parts",
     "`goto <path>' navigates");
  ok(g.preface === "goto", "and says it was prefaced, so the bar can tell");

  ok(parseInstruction("GoTo /account/alice").kind === "navigate",
     "the keyword is not case-sensitive — a user typing `Goto' meant to navigate");
  ok(parseInstruction("  goto   /x  ").path === "/x",
     "and the whitespace around either part is not part of the path");
}

section("U-76: a bare path still navigates, with or without the word");
{
  for (const [line, path] of [["/account/alice", "/account/alice"],
                              ["/", "/"],
                              ["?tab=views", "?tab=views"],
                              ["#panel", "#panel"],
                              ["../parts", "../parts"],
                              ["https://dydra.com/account/alice?x=1#y", "/account/alice?x=1#y"]]) {
    const r = parseInstruction(line);
    ok(r.kind === "navigate" && r.path === path,
       `\`${line}' navigates to ${r.path}`);
  }
  ok(parseInstruction("/account/alice").preface === null,
     "an unprefaced path records that it had no preface");
}

section("U-76: everything else is an instruction, and that is the whole grammar");
{
  for (const line of ["put the inventory table beside the filter",
                      "add a panel for the open orders",
                      "make the heading smaller",
                      "move the location bar to the top",
                      "show 2/3 of the chart"]) {
    const r = parseInstruction(line);
    ok(r.kind === "instruct" && r.text === line, `\`${line.slice(0, 38)}…' is an instruction`);
  }
  ok(parseInstruction("show 2/3 of the chart").kind === "instruct",
     "a slash inside a sentence does not make it a path — only a leading one does");
  ok(parseInstruction("").kind === "empty" && parseInstruction("   ").kind === "empty",
     "an empty line is nothing, not an instruction to do nothing");
}

section("U-76: `goto' with nothing after it is a refusal, not a navigation to /");
{
  const r = parseInstruction("goto");
  ok(r.kind === "refusal", "`goto' alone refuses");
  ok(/somewhere to go/.test(r.reason), `and says what it wanted: ${r.reason}`);
  ok(parseInstruction("goto   ").kind === "refusal", "trailing space does not make it one");
}

section("pathLike / pathOf, stated separately because the grammar turns on them");
{
  ok(pathLike("/a") && pathLike("http://x/y") && pathLike("?q") && pathLike("#f") && pathLike("./a"),
     "paths, URLs, queries, fragments and relative paths are locations");
  ok(!pathLike("workspace") && !pathLike("add a panel") && !pathLike("a/b"),
     "a bare word, a sentence, and a slash in the middle are not");
  ok(pathOf("https://dydra.com/a/b") === "/a/b", "a URL reduces to what the router takes");
  ok(pathOf("http://x") === "/", "and a URL with no path reduces to the root, not to empty");
}

/* ═══════════════════ U-77: the address ═══════════════════ */

section("U-77: `goto <name>' re-addresses rather than navigating");
{
  const r = parseInstruction("goto workspace", { targets: TARGETS });
  ok(r.kind === "address", "`goto workspace' is an address, not a path");
  ok(r.target?.kind === "workspace", "and it resolves to the arrangement itself");

  const p = parseInstruction("goto Parts inventory", { targets: TARGETS });
  ok(p.kind === "address" && p.target?.id === "dashboard-alice-parts",
     "a presentation is addressed by the label the bar shows");
  ok(parseInstruction("goto parts", { targets: TARGETS }).target?.id === "dashboard-alice-parts",
     "a prefix is enough when only one thing starts with it");
  ok(parseInstruction("goto orders", { targets: TARGETS }).target?.id === "dashboard-alice-orders",
     "and a word inside the label is enough when only one contains it");
}

section("U-77: an ambiguous or unknown address refuses — it never picks the nearest");
{
  const two = [makeTarget({ id: "a", label: "Sales north" }),
               makeTarget({ id: "b", label: "Sales south" })];
  const r = parseInstruction("goto sales", { targets: two });
  ok(r.kind === "refusal", "two matches is a refusal");
  ok(/Sales north/.test(r.reason) && /Sales south/.test(r.reason),
     `and names them: ${r.reason}`);

  const u = parseInstruction("goto costs", { targets: TARGETS });
  ok(u.kind === "refusal", "no match is a refusal");
  ok(/workspace/.test(u.reason), `and says what there is instead: ${u.reason}`);

  const none = parseInstruction("goto costs", { targets: [] });
  ok(none.kind === "refusal" && /nothing else is open/.test(none.reason),
     "with nothing open it says so rather than listing an empty set");
}

section("U-77: resolution is exact before prefix before substring");
{
  const t = [makeTarget({ id: "parts", label: "Parts" }),
             makeTarget({ id: "parts-detail", label: "Parts, in detail" })];
  ok(resolveTarget("parts", t).target.id === "parts",
     "an exact match wins over the longer name it is a prefix of");
  ok(resolveTarget("parts-", t).target.id === "parts-detail", "a unique prefix resolves");
  ok(resolveTarget("detail", t).target.id === "parts-detail", "a unique substring resolves");
  ok(resolveTarget("part", t).ok === false, "a prefix of both does not");
}

section("U-77: what the bar prints as the target");
{
  ok(describeTarget(TARGETS[0]) === "workspace (the arrangement)",
     "the workspace says what it is, because `add a panel' means something different there");
  ok(describeTarget(TARGETS[1]) === "Parts inventory", "a presentation is just its name");
  ok(describeTarget(null) === "nothing", "and nothing addressed says nothing");
  ok(/more than one/.test(addressRefusal({ reason: "ambiguous", candidates: TARGETS }, "x")),
     "an ambiguous refusal says so in its first clause");
}

/* ═══════════════════ U-72: the chrome as a presentation ═══════════════════ */

section("U-72: the default workspace is a presentation like any other");
{
  const w = defaultWorkspace();
  const v = validateApplication(w);
  ok(v.ok, `the chrome validates as an application document (${(v.errors || []).join("; ")})`);
  ok(w.views.length === 1 && w.views[0].elements.length === 1,
     "one view, one root — the bands are its children");
  const hosts = w.views[0].elements[0].children.map((c) => c.host);
  ok(hosts.join(",") === WORKSPACE_HOSTS.join(","), `every band is a host: ${hosts.join(", ")}`);
  ok(w.views[0].elements[0].children.every((c) => c.kind === "host"),
     "and nothing inside a band is in the graph (D-AS)");
  ok(!w.panels.length && !w.parameters.length,
     "the chrome holds no panels and no parameters — it has no data of its own");
}

section("U-72: the bands that make the interface repairable are immutable");
{
  const w = defaultWorkspace();
  const kids = w.views[0].elements[0].children;
  for (const host of IMMUTABLE_HOSTS) {
    ok(kids.find((c) => c.host === host)?.immutable === true, `${host} is immutable`);
  }
  ok(kids.find((c) => c.host === "tabs")?.immutable === false,
     "and tabs is not — a band with no consequence should be movable");
  ok(REQUIRED_HOSTS.every((h) => IMMUTABLE_HOSTS.includes(h)),
     "every band the interface cannot do without is immutable, so the refusal comes first");
}

section("U-66 over the chrome: a patch that would unplace an immutable band is refused");
{
  const w = defaultWorkspace();
  const gone = applyPatch(w, [{ op: "remove-element", element: hostElement("location") }]);
  ok(!gone.ok, "removing the location bar is refused");
  ok((gone.errors || []).some((e) => /w-location' may not be removed/.test(e)),
     `and the reason names the element rather than the rule: ${(gone.errors || [])[0]}`);

  // The one that looks like a layout change and is really a deletion.
  const unplaced = applyPatch(w, [{ op: "set-layout", element: "w-chrome",
    value: { columns: "1fr", areas: ["header", "tabs", "content", "footer"] } }]);
  ok(!unplaced.ok, "and so is dropping its area from the template");
  ok((unplaced.errors || []).some((e) => /location/.test(e)),
     `which names the band that would have been lost: ${(unplaced.errors || [])[0]}`);
}

section("U-72: a band can still be MOVED, which is the point of the phase");
{
  const w = defaultWorkspace();
  const moved = applyPatch(w, [
    { op: "set-layout", element: "w-chrome",
      value: { columns: "1fr", rows: "auto auto auto 1fr auto auto",
               areas: ["location", "flashes", "header", "tabs", "content", "footer"] } },
  ]);
  ok(moved.ok, `the bar can be moved to the top (${(moved.errors || []).join("; ")})`);
  ok(moved.classification?.class === "presentational",
     "and rearranging the chrome costs nothing: it is presentational");
  const a = arrangementOf(moved.document, { page: "main" });
  ok(a.ok && /grid-template-areas:'location' 'flashes'/.test(a.rootStyle),
     `the template says so (${a.rootStyle.slice(0, 80)}…)`);
  ok(a.bands.find((b) => b.host === "location").style === "grid-area:location",
     "and no band was touched — each still names the area it was always in");
}

section("U-72: an arrangement that could not be used falls back rather than failing");
{
  ok(checkArrangement(null).ok === false, "no view is not an arrangement");
  ok(checkArrangement({ elements: [] }).ok === false, "nor is an empty one");
  const noContent = {
    name: "main",
    elements: [{ name: "w-chrome", kind: "div", children: [
      { name: "w-header", kind: "host", host: "header" }] }],
  };
  const c = checkArrangement(noContent);
  ok(!c.ok && /content/.test(c.reason) && /location/.test(c.reason),
     `a workspace without content or a bar is refused: ${c.reason}`);
  const a = arrangementOf(noContent);
  ok(!a.ok && a.fellBack, "and `arrangementOf' answers with the default and says why");
  ok(a.bands.length === WORKSPACE_HOSTS.length,
     "which is a complete arrangement, so a renderer never has a second layout in it");
}

section("U-78: `?workspace=default' is the restore route");
{
  ok(restoreRequested("?workspace=default"), "the query parameter is recognised");
  ok(restoreRequested("workspace=default&x=1"), "with or without the leading `?', among others");
  ok(!restoreRequested("?workspace=mine") && !restoreRequested("") && !restoreRequested(null),
     "and nothing else turns it on");
}

section("U-72: a page the saved workspace does not know gets the default view, not nothing");
{
  const w = defaultWorkspace({ page: "main" });
  ok(workspaceViewFor(w, "main")?.name === "main", "the named view is found");
  ok(workspaceViewFor(w, "admin")?.name === "main",
     "and an unknown page falls back to `main' rather than to null");
  ok(workspaceViewFor({ views: [] }, "main") === null, "with no views at all there is none");
}

/* ═══════════════════ U-78: one instruction, end to end ═══════════════════ */

const patchAnswer = (ops) => ({ ok: true, finalText:
  "Moved it.\n\n```patch\n" + JSON.stringify(ops) + "\n```\n" });

section("U-78: an instruction that works is saved, reported in a line, and undoable");
{
  const w = defaultWorkspace();
  const writes = [];
  const out = await runWorkspaceInstruction({
    document: w, text: "put the bar at the top",
    ask: async () => patchAnswer([{ op: "set-layout", element: "w-chrome",
      value: { columns: "1fr", areas: ["location", "flashes", "header", "tabs", "content", "footer"] } }]),
    save: async (d) => { writes.push(d); return { ok: true }; },
  });
  ok(out.ok, `the instruction succeeded (${out.message})`);
  ok(out.document.revision === 2, "the result is a new revision of the workspace");
  ok(writes.length === 1 && writes[0].revision === 2, "which is what was written");
  ok(/saved/.test(out.message), `and the bar's line says so: ${out.message}`);
  ok(typeof out.undo === "function", "with an undo beside it (D-AU, point 3)");

  const back = await out.undo();
  ok(back.ok && writes.length === 2, "the undo writes again rather than deleting a revision");
  ok(writes[1].revision === 1, "putting back the document as it was — a revert, not an inverse");
}

section("U-78: every way it can fail says which, and changes nothing");
{
  const w = defaultWorkspace();
  const never = async () => { throw new Error("should not be saved"); };

  const noPatch = await runWorkspaceInstruction({
    document: w, text: "x", save: never,
    ask: async () => ({ ok: true, finalText: "I would rather not." }) });
  ok(!noPatch.ok && /no patch/.test(noPatch.message), `prose with no patch: ${noPatch.message}`);

  const cut = await runWorkspaceInstruction({
    document: w, text: "x", save: never,
    ask: async () => ({ ok: true, truncated: true, finalText: "```patch\n[{" }) });
  ok(!cut.ok && /ran out of room/.test(cut.message),
     `an answer cut off mid-block says that rather than "no patch": ${cut.message}`);

  const bad = await runWorkspaceInstruction({
    document: w, text: "x", save: never,
    ask: async () => patchAnswer([{ op: "remove-element", element: "w-content" }]) });
  ok(!bad.ok && /refused whole/.test(bad.message), `a refused patch: ${bad.message}`);
  ok(/may not be removed/.test(bad.message), "carrying the reason the refusal gave");

  const unreachable = await runWorkspaceInstruction({
    document: w, text: "x", save: never,
    ask: async () => { throw new Error("no network"); } });
  ok(!unreachable.ok && /no network/.test(unreachable.message),
     `a provider that cannot be reached: ${unreachable.message}`);

  const noModel = await runWorkspaceInstruction({ document: w, text: "x" });
  ok(!noModel.ok && /no model is connected/.test(noModel.message),
     `and no connection at all: ${noModel.message}`);
}

section("U-72: the chrome refuses a change that reaches the data class");
{
  const w = defaultWorkspace();
  const out = await runWorkspaceInstruction({
    document: w, text: "show me the open orders here",
    save: async () => { throw new Error("should not be saved"); },
    ask: async () => patchAnswer([{ op: "set-panel", name: "orders",
      value: { query: "SELECT ?o WHERE { ?o a :Order }" } }]),
  });
  ok(!out.ok, "a panel written into the furniture is refused");
  ok(/holds no data/.test(out.message), `and the refusal says why: ${out.message}`);
  ok(out.classification?.class === "data",
     "the classifier is what decided it, not a list of forbidden operations");
}

section("U-78: a write that fails is reported as a change that was not saved");
{
  const w = defaultWorkspace();
  const out = await runWorkspaceInstruction({
    document: w, text: "x",
    ask: async () => patchAnswer([{ op: "set-attribute", element: "w-tabs",
                                    name: "style", value: "opacity:0.9" }]),
    save: async () => ({ ok: false, error: "HTTP 403" }),
  });
  ok(!out.ok, "the instruction did not succeed");
  ok(/not saved/.test(out.message) && /403/.test(out.message),
     `and the line distinguishes that from a refusal: ${out.message}`);
  ok(!out.undo, "with no undo offered, because nothing was written");
}

section("`describe': what the bar is told a patch did");
{
  ok(describe([{ op: "set-layout" }]) === "set-layout", "one operation is named");
  ok(describe([{ op: "move-element" }, { op: "move-element" }]) === "move-element ×2",
     "two of a kind are counted rather than listed");
  ok(describe([]) === "nothing changed", "and an empty patch says so");
}

/* ═══════════════════ U-76 item 3: what the model is told ═══════════════════ */

section("U-76: the workspace prompt is not the dashboard prompt");
{
  const w = defaultWorkspace();
  const sys = instructionSystem("BASE", { target: { kind: "workspace" }, document: w,
                                          request: "move the bar", answerTokens: 8000 });
  ok(sys.includes(WORKSPACE_CONTRACT.split("\n")[0]), "it carries the workspace contract");
  ok(!/Three kinds of region/.test(sys),
     "and not the three content classes — the chrome binds nothing");
  ok(/There is nothing to bind here/.test(sys),
     "the catalogue's examples do show `data-bound', so the contract says outright that "
     + "none of it applies — the examples are right for a page and wrong for the chrome");
  ok(!/SELECT /.test(sys), "nor any query vocabulary");
  for (const h of WORKSPACE_HOSTS) ok(sys.includes("`" + h + "`"), `it names the host \`${h}'`);
  ok(/IMMUTABLE/.test(sys), "it says which bands are immutable");
  ok(/w-chrome/.test(sys), "and shows the outline, so the model has names to address");
}

section("U-76: the chrome's catalogue is tier 1 only, and the bound is a ceiling");
{
  const sys = instructionSystem("BASE", { target: { kind: "workspace" },
                                          document: defaultWorkspace(),
                                          request: "add a table of the open orders" });
  ok(!/`table`/.test(sys),
     "a request that asks for a table is still not offered one: the chrome has no data to put in it");
  ok(/`panel`/.test(sys), "layout furniture is offered");
  ok(selectComponents("chart", { tier: 1 }).every((n) => !["table", "bar-chart"].includes(n)),
     "the ceiling applies to the request's own hints");
  ok(selectComponents("x", { include: ["table"], tier: 1 }).includes("table") === false,
     "and to a component the caller named outright, or it would not be a ceiling");
  ok(selectComponents("x", { include: ["table"] }).includes("table"),
     "without a tier, naming one still works exactly as before");
}

section("U-79: a presentation routes to the prompt the Revise box already used");
{
  const doc = { title: "Parts", revision: 3, uses: ["panel", "table"],
                panels: [{ name: "parts", query: "SELECT ?p WHERE { ?p a :Part }" }],
                views: [{ name: "main", html: "<div id='x' data-bound='parts'></div>" }] };
  const sys = instructionSystem("BASE", { target: { kind: "presentation" }, document: doc,
                                          request: "add a column" });
  ok(/The page as it stands/.test(sys), "it is the revision prompt");
  ok(/SELECT \?p WHERE/.test(sys), "carrying the panel queries a patch has to address");
  ok(!/Rearranging the interface itself/.test(sys), "and not the workspace contract");
}

section("workspaceSummary: the outline, and what it says when there is nothing yet");
{
  const s = workspaceSummary(defaultWorkspace(), { page: "main" });
  ok(/w-location  host  area=location/.test(s), `each band is one line: ${s.split("\n")[4]}`);
  ok(/IMMUTABLE/.test(s), "and immutability is on the line, not in a separate list");
  ok(/nothing is arranged yet/.test(workspaceSummary({ views: [] })),
     "an account with no arrangement is told so rather than shown an empty outline");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
