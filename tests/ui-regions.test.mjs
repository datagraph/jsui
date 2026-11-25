/**
 * The parts of the interface's own pages, as things that can be addressed
 * (U-115).
 *
 * What is decided here and not in a browser: whether a region is addressed
 * by kind or by instance, whether a required one can be lost, what happens
 * to a stored arrangement this build no longer agrees with, and whether the
 * markup a pane emits is the markup the arrangement asked for.  Each of
 * those is a decision whose cost falls on an account that has already saved
 * an arrangement, which is exactly the case a browser run never reaches.
 *
 * The one thing deliberately NOT asserted here is appearance.  Whether the
 * properties column still looks like the properties column is a question for
 * the eye and for `ui-arrange.browser.mjs'; what this file guards is that
 * the names, the refusals and the fallbacks are what they claim to be.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-regions-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  REGIONS, REGION_KINDS, regionHost, regionElement, regionRoot, regionViewName,
  parseRegionHost, regionsOf, requiredRegions, defaultRegionView, defaultRegionViews,
  ensureRegionViews, checkRegionArrangement, regionArrangementOf, regionLayoutOf,
  regionMarkup, regionTip, REGION_ATTRIBUTE, REGION_CLASS, REGIONS_CLASS,
} = await load("app/regions.js");
const { defaultWorkspace } = await load("app/workspace.js");
const { applyPatch, immutableFaults } = await load("app/patch.js");
const { validateApplication } = await load("app/document.js");
const { anchorOf } = await load("app/anchors.js");
const { index } = await load("app/tree.js");

let passed = 0, failed = 0;
const ok = (condition, what) => {
  if (condition) { passed += 1; console.log(`  ok  ${what}`); }
  else { failed += 1; console.log(`  FAIL ${what}`); }
};
const section = (title) => console.log(`\n${title}`);

/* ── the names ────────────────────────────────────────────────────────────── */

section("U-115: a region is named by the KIND of pane, never by the instance");
{
  ok(regionHost("repository", "views") === "repository:views",
     "the host value is `kind:region'");
  ok(regionElement("repository", "views") === "r-repository-views",
     "and the anchor the verbs take is `r-kind-region'");
  ok(regionRoot("repository") === "r-repository-pane"
     && regionViewName("repository") === "repository-pane",
     "the container and the view that arranges it are named from the kind alone");
  ok(!/dflexlib|james|:[a-z]+:/.test([...REGION_KINDS].map((k) =>
       regionsOf(k).map((r) => regionHost(k, r.region)).join(" ")).join(" ")),
     "no name anywhere carries an account, a repository or a view — one "
     + "arrangement serves every pane of its kind");
  const p = parseRegionHost("repository:views");
  ok(p?.kind === "repository" && p?.region === "views" && p.declared.required === true,
     "a host value reads back to the kind, the region and what was declared of it");
  ok(parseRegionHost("repository:nonesuch") === null,
     "a region the kind does not declare does not parse — it is not a region");
  ok(parseRegionHost("content") === null && parseRegionHost("presentation:x") === null,
     "and neither a chrome band nor a mount is read as one");
}

section("U-115: every kind declares what each region holds, once");
{
  const said = REGION_KINDS.flatMap((k) => regionsOf(k).map((r) => r.what));
  ok(said.length >= 7 && said.every((w) => typeof w === "string" && w.length > 10),
     `each of the ${said.length} regions says what it holds, in a sentence`);
  const tip = regionTip({ name: "r-repository-views", host: "repository:views" });
  ok(tip.includes("r-repository-views") && tip.includes("repository:views")
     && tip.includes(REGIONS.repository.find((r) => r.region === "views").what),
     "and the tooltip a reader gets is that same sentence, so the two cannot drift");
  ok(/cannot be lifted/.test(tip),
     "the tooltip says what cannot be done as well as what can: a region is a "
     + "host, and `lift' refuses a host (D-AS)");
}

/* ── what is drawn by default ─────────────────────────────────────────────── */

section("U-115: the build's own arrangement is a tree like any other");
{
  const v = defaultRegionView("repository");
  ok(v.name === "repository-pane" && v.elements.length === 1,
     "one view, one root");
  const root = v.elements[0];
  ok(root.kind === "div" && root.immutable === true,
     "the container is an ordinary element and may not be removed");
  ok(root.children.length === REGIONS.repository.length
     && root.children.every((c) => c.kind === "host"),
     "with one host per declared region and nothing else");
  ok(root.layout.areas.join(" | ")
       === "metadata summary summary | metadata views   editors",
     `and a grid template that reproduces today's pane: ${root.layout.areas.join(" / ")}`);
  ok(!REGIONS.repository.some((r) => r.region === "results"),
     "and no results region (U-120): the result of running a view is in that "
     + "view's own tabs, and a result that is KEPT is kept to be compared with "
     + "readings from other repositories — which is a pane of its own");
  const immutable = root.children.filter((c) => c.immutable).map((c) => c.host);
  ok(immutable.join(" ") === "repository:views repository:editors",
     "the view list and the editors are immutable; the properties and the "
     + "summary are not, because hiding them is a reasonable thing to ask for");
  ok(defaultRegionView("nonesuch") === null,
     "a kind that declares no regions has no arrangement, rather than an empty one");
}

section("U-115: the pane arrangements live beside the chrome's, in one document");
{
  const topped = ensureRegionViews(defaultWorkspace());
  const names = topped.views.map((v) => v.name);
  ok(names.includes("main") && REGION_KINDS.every((k) => names.includes(regionViewName(k))),
     `the chrome's view and one per kind of pane: ${names.join(", ")}`);
  ok(ensureRegionViews(topped) === topped,
     "topping up a document that already has them changes nothing — the same "
     + "object comes back, so a saved arrangement is never quietly rewritten");
  const checked = validateApplication({ ...topped, id: "workspace" });
  ok(checked.ok, `and the whole document still validates: ${(checked.errors || []).join("; ") || "no errors"}`);
}

/* ── rearranging ──────────────────────────────────────────────────────────── */

section("U-115: rearranging a pane is one patch against its own view");
{
  const doc = ensureRegionViews(defaultWorkspace());
  const out = applyPatch(doc, [
    { op: "set-layout", view: "repository-pane", element: "r-repository-pane",
      value: { columns: "1fr 1fr", rows: "auto auto",
               areas: ["views editors", "metadata summary"] } },
  ]);
  ok(out.ok, `the layout is rewritten: ${(out.errors || []).join("; ") || "accepted"}`);
  const a = regionArrangementOf(out.document, { kind: "repository" });
  ok(a.ok && /grid-template-areas:'views editors' 'metadata summary'/.test(a.rootStyle),
     `and the container's style follows: ${a.rootStyle}`);
  ok(a.regions.every((r) => r.area),
     "every region still has an area — a rewrite of the template moves them all "
     + "and touches none of them (D-AK)");
  ok((out.classification?.class || "presentational") === "presentational",
     "and the change is presentational: a pane's parts hold no data of their own");
}

section("U-66: a required region cannot be lost by a patch");
{
  const doc = ensureRegionViews(defaultWorkspace());
  const out = applyPatch(doc, [
    { op: "remove-element", view: "repository-pane", element: "r-repository-views" },
  ]);
  ok(!out.ok, `removing the view list is refused: ${(out.errors || []).join("; ")}`);
  ok((out.errors || []).join(" ").includes("r-repository-views"),
     "and the refusal names it, rather than reporting that something failed");

  const gone = applyPatch(doc, [
    { op: "remove-element", view: "repository-pane", element: "r-repository-metadata" },
  ]);
  ok(gone.ok, "while the properties column may be removed — that is an arrangement");
  ok(regionArrangementOf(gone.document, { kind: "repository" }).ok,
     "and what is left is still a pane this build can draw");
}

section("U-115: an arrangement this build cannot use answers with the default and a reason");
{
  const stored = { views: [{ name: "repository-pane", elements: [
    { name: "r-repository-pane", kind: "div", order: "a",
      children: [{ name: "r-repository-metadata", kind: "host",
                   host: "repository:metadata", order: "a" }] },
  ] }] };
  const a = regionArrangementOf(stored, { kind: "repository" });
  ok(!a.ok && /views or editors/.test(a.fellBack || ""),
     `a stored pane that places neither list falls back, and says why: ${a.fellBack}`);
  ok(a.regions.length === REGIONS.repository.length,
     "and what comes back is the build's own arrangement, whole");
  const none = regionArrangementOf(ensureRegionViews(defaultWorkspace()), { kind: "nonesuch" });
  ok(!none.ok && /declares no regions/.test(none.fellBack || ""),
     `a kind with no regions answers with nothing and a reason: ${none.fellBack}`);
  ok(checkRegionArrangement(null, "repository").ok === false
     && checkRegionArrangement({ elements: [] }, "repository").ok === false,
     "no tree and an empty tree are both refused before anything reads them");
}

section("U-120: the results pane is a kind of its own, arranged like the rest");
{
  ok(REGION_KINDS.includes("results"),
     "there is a `results' kind, so the pane that keeps what a reader kept is "
     + "arranged by the same instruction as every other pane");
  const said = regionsOf("results").map((r) => r.region);
  ok(said.join(" ") === "readings presentations",
     `and it declares the two things kept there: ${said.join(", ")}`);
  ok(requiredRegions("results").join(" ") === "readings",
     "the readings may not be dropped — they are what the pane is; the "
     + "presentations may, because a reader who keeps no presentations should "
     + "not be shown a box for them");
  const v = defaultRegionView("results");
  ok(v.name === "results-pane" && v.elements[0].layout.areas.join(" | ")
       === "readings | presentations",
     "one column, in that order: both of these are as wide as they were "
     + "composed to be, and a destination narrower than its content is the "
     + "defect this pane was built to correct");
  ok(v.elements[0].layout.columns === "minmax(0, 1fr)",
     "and the column is the whole width of the pane, which is the whole width "
     + "of the window");
  const p = parseRegionHost("results:presentations");
  ok(p?.kind === "results" && /reference/.test(p.declared.what),
     "what the presentations region holds says that it holds a REFERENCE: a "
     + "band is a name and a press, and nothing in a page can press it (§21.4.3)");
}

/* ── the markup ───────────────────────────────────────────────────────────── */

section("U-115: the markup a pane emits is the arrangement, applied");
{
  const html = regionMarkup({ kind: "repository", parts: {
    metadata: "<i>props</i>", summary: "<i>sum</i>",
    views: "<i>list</i>", editors: "<i>editors</i>",
  } });
  ok(html.startsWith(`<div class="${REGIONS_CLASS}" data-ui="r-repository-pane"`),
     "one container, carrying the anchor the patch addresses");
  ok(/grid-template-areas:&#039;|grid-template-areas:'/.test(html) || /grid-template-areas/.test(html),
     "with the grid written inline, from the arrangement");
  for (const r of REGIONS.repository) {
    ok(html.includes(`data-ui="r-repository-${r.region}"`)
       && html.includes(`${REGION_ATTRIBUTE}="repository:${r.region}"`),
       `\`repository:${r.region}' is emitted with its anchor and its host value`);
  }
  ok((html.match(new RegExp(`class="${REGION_CLASS}"`, "g")) || []).length
       === REGIONS.repository.length,
     `${REGIONS.repository.length} regions, and no more`);
  ok(html.includes("grid-area:views") && html.includes("grid-area:metadata"),
     "each placed by its area and not by document order");
  ok(html.includes("title=") && html.includes("data-ui-tip"),
     "and each carrying its own name as a native tooltip (REQ-35.8.1, as amended)");
}

section("U-115: a region the page did not build, and one the arrangement does not place");
{
  const missing = regionMarkup({ kind: "repository", parts: { views: "<i>list</i>" } });
  ok(missing.includes("location-inert")
     && missing.includes("the interface draws nothing as `repository:editors'"),
     "a placed region with no markup is an inert box with the reason on it, "
     + "which is visible rather than silent");

  const extra = regionMarkup({ kind: "repository", parts: {
    views: "<i>list</i>", editors: "<i>e</i>", metadata: "<i>m</i>", summary: "<i>s</i>",
    nonesuch: "<i>later</i>",
  } });
  ok(extra.includes("data-unplaced") && extra.includes("<i>later</i>"),
     "and a region the arrangement does not know is emitted at the end rather "
     + "than dropped — an arrangement saved before a region existed keeps it");
}

section("U-115: the markup escapes what goes in an attribute, and not what goes in the page");
{
  const html = regionMarkup({ kind: "view", parts: { editor: `<b class="x">&amp;</b>` } });
  ok(html.includes(`<b class="x">&amp;</b>`),
     "the page's own markup is passed through untouched — it is already markup");
  const evil = regionMarkup({ kind: "view", arrangement: {
    kind: "view", root: `x" onload="boom`, rootStyle: "display:grid", regions: [
      { name: `r" onload="boom`, host: "view:editor", region: "editor", area: "editor",
        style: `grid-area:editor` },
    ],
  }, parts: { editor: "<i>e</i>" } });
  ok(!/onload="boom/.test(evil) && evil.includes("&quot; onload=&quot;boom"),
     "while a name out of the store cannot break out of its attribute");
}

/* ── what a region is not ─────────────────────────────────────────────────── */

section("D-AS: a region is a host, so it is opaque and cannot be lifted");
{
  const root = defaultRegionView("repository").elements[0];
  const n = index([root]).get("r-repository-views").node;
  const a = anchorOf(n);
  ok(a.kind === "host" && a.opaque === true,
     "`anchorOf' reports it opaque, which is what refuses `lift' (D-AS)");
  ok(a.immutable === true, "and immutable, which is what refuses `remove-element'");
  ok(a.mounts === null,
     "a region mounts no presentation, so `unmount' has nothing to take either");
}

section("U-115: the chrome's own view is untouched by any of this");
{
  const doc = ensureRegionViews(defaultWorkspace());
  const chrome = doc.views.find((v) => v.name === "main");
  const hosts = [];
  for (const { node: n } of index(chrome.elements).values()) if (n.host) hosts.push(n.host);
  ok(hosts.join(" ") === "flashes header tabs content footer location",
     `the six bands, as they were: ${hosts.join(", ")}`);
  ok(!hosts.some((h) => parseRegionHost(h)),
     "and not one of them is a region — `content' still holds every open pane");
  const faults = immutableFaults(doc, doc);
  ok(faults.length === 0, "a document compared with itself reports no fault");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
