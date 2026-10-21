/**
 * The component toolbox: what is in it, what it costs, and what it refuses.
 *
 * Work items U-35, U-36, U-37, U-38 and the catalog half of U-42.
 *
 * The browser half of the toolbox -- that each component actually renders --
 * is in `tests/app-frame.browser.mjs', because a custom element is a claim
 * about a browser.  What is asserted here is everything that can be decided
 * from the source: the three rules of §8.2, the inlining of §8.1, and the
 * subsetting of §8.5, which is the one with a budget behind it.
 *
 * The §8.2 rules are asserted by reading the source rather than by trusting
 * the review that wrote it.  A component that fetches would fail silently
 * behind `connect-src 'none'' -- no error, no data, a blank region -- and
 * that is exactly the failure that takes a day to find.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-toolbox-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { ALL, COMPONENTS, TIER_1, TIER_2, COMPONENT_NAMES, TOOLBOX_VERSION } =
  await load("app/toolbox/index.js");
const { componentCatalog, selectComponents, describeComponent, catalogSize } =
  await load("app/toolbox/catalog.js");
const { componentSources, buildPage } = await load("dashboard/frame.js");
const { validateApplication, sizeOf } = await load("app/document.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ═══════════════════════════ what is in it ═════════════════════════════════ */

section("§8.3: twelve components, in two tiers, cut from the first draft's seventy");
{
  ok(TIER_1.length === 7, "seven in tier 1 — the page's own furniture");
  ok(TIER_2.length === 5 + 1, "six in tier 2 — five data components and `graph'");
  ok(COMPONENT_NAMES.length === 13 && !COMPONENT_NAMES.includes("base"),
     "thirteen names a document may use, and `base' is not one of them");
  ok(TIER_1.map((c) => c.name).join(",") === "grid,panel,card,tabs,metric,badge,key-value",
     "tier 1 is layout and text");
  ok(TIER_2.map((c) => c.name).join(",") === "table,bar-chart,line-chart,select,term,graph",
     "tier 2 is bound to data");
  ok(TOOLBOX_VERSION === "1", "and the whole of it answers to contract version 1");
}

section("every component keeps the same shape (Appendix A, Appendix B)");
{
  for (const c of ALL) {
    const m = c.manifest;
    ok(typeof c.source === "string" && c.source.length > 0, `${c.name}: has source`);
    ok(m && m.name === c.name && m.version && m.description,
       `${c.name}: a manifest with a name, a version and one line of purpose`);
    if (c.element) {
      ok(c.element.startsWith("dydra-") && m.element === c.element,
         `${c.name}: one element name, and the manifest agrees with it`);
      ok(c.source.includes(`"${c.element}"`),
         `${c.name}: and the source registers exactly that name`);
    }
  }
}

section("§8.2: no component may fetch, store or import");
{
  for (const c of ALL) {
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|\bimport\s*\(|\bimport\s+/;
    ok(!forbidden.test(c.source),
       `${c.name}: reaches for nothing the frame does not have`);
  }
  ok(!ALL.some((c) => /<\/script/i.test(c.source) || /<\/script/i.test(c.style)),
     "and none of them carries a </script, which would end the element it is inlined into");
}

section("§8.2: a component backed by an engine declares what it needs");
{
  const graph = COMPONENTS.graph;
  ok(graph.needs.capabilities.join(",") === "graphviz",
     "`graph' declares graphviz rather than carrying a layout algorithm (§8.4)");
  ok(!/function\s+layout|networkSimplex|stress/i.test(graph.source),
     "and computes no layout itself — the pane runs the vendored engine");
  ok(graph.source.includes("dashboard.layout"),
     "it asks for one through the channel the frame provides");
  ok(/no layout engine is available/.test(graph.source),
     "and says so when there is none, instead of showing an empty box (§7.4)");
  ok(validateApplication({ title: "G", panels: [], uses: ["graph"],
                           views: [{ name: "a", html: '<p id="p">x</p>' }] }).ok,
     "which this host can provide, so the document validates");
}

section("§8.2: every component renders something with no properties set");
{
  // Asserted here as far as source can: each component either has an explicit
  // empty state or needs no data at all.  That it LOOKS right is a browser
  // assertion; that the branch exists is this one.
  const needData = ["metric", "key-value", "table", "bar-chart", "line-chart", "term",
                    "graph", "select"];
  for (const name of needData) {
    ok(/UI\.empty\(|"…"|"—"/.test(COMPONENTS[name].source),
       `${name}: says what is missing rather than rendering nothing`);
  }
}

/* ═══════════════════════ U-37: uses-driven inlining ════════════════════════ */

section("D-Y: only the components a document names are inlined");
{
  const two = componentSources({ uses: ["card", "metric"] }, COMPONENTS);
  ok(two.used.includes("card") && two.used.includes("metric"),
     "the two that were named");
  ok(!two.used.includes("table") && !two.used.includes("graph"),
     "and not the other eleven");
  ok(two.used[0] === "base",
     "with the shared helper first, because the components call into it as they register");
  ok(two.source.includes("dydra-card") && !two.source.includes("dydra-table"),
     "which is what reaches the page");

  const none = componentSources({ uses: [] }, COMPONENTS);
  ok(none.source === "" && none.style === "",
     "a page that names none carries none — not even the helper");

  const dedup = componentSources({ uses: ["card", "base", "card"] }, COMPONENTS);
  ok(dedup.used.filter((n) => n === "card").length === 1,
     "and a component named twice is inlined once");
}

section("U-37: the page carries what it uses, and Gate 1 can say what that costs");
{
  const doc = validateApplication({
    title: "T", panels: [], uses: ["bar-chart"],
    views: [{ name: "main", html: '<div id="c"><dydra-bar-chart></dydra-bar-chart></div>' }],
  });
  ok(doc.ok, "a page using a chart validates");
  ok(doc.size.components > 0 && doc.size.perComponent["bar-chart"] > 0,
     "and its size is reported with the component's share broken out");
  ok(doc.size.perComponent.base > 0,
     "including the helper it pulled in, because those are bytes too");

  const page = buildPage(doc.document, { components: COMPONENTS });
  ok(page.includes("dydra-bar-chart") && !page.includes("dydra-graph { display"),
     "the built page holds the chart and not the graph");
  ok(page.includes("window.DydraUI"), "and the helper the chart calls into");
  ok(page.indexOf("window.DydraUI") > page.indexOf("window.dashboard"),
     "after the runtime, which the components use");

  const bare = buildPage({ title: "T", panels: [], html: "<p>x</p>" });
  ok(!bare.includes("window.DydraUI") && !bare.includes("dash-toolbox-style"),
     "a page that uses no component carries no component at all");
}

/* ══════════════════════════ U-38: the catalog ══════════════════════════════ */

section("§8.5: the catalog is subsettable, because it costs tokens on every request");
{
  const plain = selectComponents("monthly sales by region");
  ok(!plain.includes("graph"),
     "a request that mentions no graph does not carry the graph manifest");
  ok(plain.includes("table") && plain.includes("card") && plain.includes("metric"),
     "while the core is always carried: layout costs almost nothing and every page uses some");

  ok(selectComponents("draw the dependency network between modules").includes("graph"),
     "a request about a network does carry it");
  ok(selectComponents("a trend over time").includes("line-chart"), "and one about a trend, the line chart");
  ok(selectComponents("let me choose a region").includes("select"), "and one about choosing, the control");

  const named = selectComponents("nothing in particular", { include: ["graph"] });
  ok(named.includes("graph"),
     "a caller may name components outright — which a follow-up turn does, for what the page already uses");
  ok(selectComponents("", { all: true }).length === 13, "and `all' is the whole toolbox");
}

section("the catalog reads as one line of purpose, the properties, and one example");
{
  const text = componentCatalog("a sortable table of sales");
  ok(/`<dydra-table>`/.test(text), "the element name");
  // Both names, after a live page declared `uses: ["dydra-table"]' -- which is
  // the only name this catalog had ever shown it -- and was refused for it.
  ok(/\*\*`table`\*\* — the element `<dydra-table>`/.test(text),
     "and the COMPONENT name beside it, which is the one `uses' takes");
  ok(/Put the COMPONENT NAME/.test(text) && /`"uses": \["table"\]`/.test(text),
     "with the instruction saying which of the two goes where, and showing it");
  ok(/sortable: boolean/.test(text), "its properties with their types");
  ok(/row-select/.test(text), "its events");
  ok((text.match(/e\.g\./g) || []).length === selectComponents("a sortable table of sales").length,
     "and exactly one example each — not three");
  ok(/None of this is required/.test(text),
     "closing with D-AB: the catalog describes conveniences, not the grammar");
  ok(/ordinary HTML, SVG and canvas remain correct answers/.test(text),
     "stated plainly, because a model handed a list will reach for it even where markup says it better");

  const one = describeComponent("badge");
  ok(one.includes("dydra-badge") && one.includes("neutral|good|warn|bad"),
     "and one component can be described on its own, for a follow-up turn that needs only that");
  ok(describeComponent("nosuch") === "", "an unknown name describes nothing");
}

section("§13.9: what the catalog costs is measured, not guessed");
{
  const small = catalogSize("a table of sales");
  const big = catalogSize("", { all: true });
  ok(small.characters > 0 && big.characters > small.characters,
     "the whole toolbox costs more than a subset of it");
  ok(small.approximateTokens === Math.ceil(small.characters / 4),
     "and the figure is an estimate, labelled as one");
  ok(big.components === 13, "the full catalog is thirteen components");
}

section("the measurement and the inlining agree");
{
  const doc = { uses: ["table", "base"], views: [{ html: "" }], styles: null, script: null };
  const inlined = componentSources(doc, COMPONENTS);
  const measured = sizeOf(doc, COMPONENTS);
  const actual = inlined.used.reduce((n, name) =>
    n + COMPONENTS[name].source.length + COMPONENTS[name].style.length, 0);
  ok(measured.components === actual,
     "the size reported at Gate 1 is the size of what is actually put in the page");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
