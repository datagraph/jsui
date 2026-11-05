/**
 * The application frame, in a real browser: patching in place, the toolbox,
 * and the saved copy.
 *
 * Work items U-29a, U-35, U-36, U-37, U-42 and U-43.
 *
 * The claim that has to be checked here and cannot be checked anywhere else
 * is §6.2.1's invariant:
 *
 *      PATCH-THEN-READ EQUALS REBUILD-THEN-READ
 *
 * Two paths now reach the same page — the runtime edits its own DOM when a
 * patch can be applied in place, and the pane rebuilds the document from
 * scratch when it cannot — and if they ever disagree the page quietly stops
 * being what the document says it is. The only honest way to assert that is
 * to drive both and compare the frame's own serialised DOM, which means a
 * browser.
 *
 * The second reason for a browser is custom elements. A component is a claim
 * about `customElements.define` and `connectedCallback`; nothing about it can
 * be decided from its source. §8.2's third rule — every component renders
 * something sensible with no properties set — is asserted here one component
 * at a time, because a blank element is indistinguishable from a bug and
 * that is precisely the failure the rule exists to prevent.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const DOCUMENT = {
  id: "app-browser", revision: 1, title: "Sales",
  // Every component except `line-chart', which is left out so that adding it
  // later is a real change: a patch to `uses' is the case the runtime cannot
  // apply in place, and a test that "added" one already there would prove
  // nothing.
  uses: ["card", "metric", "table", "bar-chart", "badge", "grid", "panel", "tabs",
         "key-value", "term", "select", "graph"],
  panels: [
    { name: "sales", query: "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total }",
      caption: "monthly totals" },
  ],
  transforms: [
    { name: "total", inputs: ["sales"],
      body: "let n = 0; for (const r of inputs.sales.objects) n += Number(r.total) || 0; return n;" },
  ],
  assertions: [{ id: "lead", inputs: ["sales"], text: "The year rose." }],
  views: [{ name: "main", title: null,
            html: '<h1 id="h">Sales</h1>'
                + '<section id="tbl" data-bound="sales"><dydra-table sortable></dydra-table></section>'
                + '<p id="g" data-derived="total"></p>'
                + '<p id="l" data-asserted="lead"></p>'
                + '<div id="empties"><dydra-metric label="nothing"></dydra-metric>'
                + '<dydra-table></dydra-table><dydra-bar-chart></dydra-bar-chart>'
                + '<dydra-key-value></dydra-key-value>'
                + '<dydra-term></dydra-term><dydra-graph></dydra-graph>'
                + '<dydra-badge tone="warn">warn</dydra-badge>'
                + '<dydra-select parameter="region" panel="sales"></dydra-select></div>'
                + '<dydra-grid columns="2"><dydra-card><span slot="title">T</span>c</dydra-card>'
                + '<dydra-panel label="P" caption="c">body</dydra-panel></dydra-grid>'
                + '<dydra-tabs><div label="one" id="t1">first</div>'
                + '<div label="two" id="t2">second</div></dydra-tabs>' }],
  styles: "#h { letter-spacing: .01em; }",
};

const TSV = "?month\t?total\n2026-01\t120\n2026-02\t80\n2026-03\t140\n";
const RESULTS = { sales: { ok: true, mimeType: "text/tab-separated-values",
                           text: TSV, digest: "first", rows: 3 } };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>application harness</title>
<body>
<div id="host"></div>
<div id="rebuilt"></div>
<div id="graphhost"></div>
<div id="treehost"></div>
<div id="sharedhost"></div>
<script type="module">
import { mountDashboard, buildPage } from "/lib/dashboard/frame.js";
import { validateApplication } from "/lib/app/document.js";
import { applyPatch } from "/lib/app/patch.js";
import { COMPONENTS } from "/lib/app/toolbox/index.js";

const RAW = ${JSON.stringify(DOCUMENT)};
const RESULTS = ${JSON.stringify(RESULTS)};
const v = validateApplication(RAW);
window.__validation = { ok: v.ok, errors: v.errors, warnings: v.warnings, size: v.size };
let doc = v.document;

const handle = mountDashboard(document.getElementById("host"), doc, {
  onEvent: (e) => { (window.__events = window.__events || []).push(e); },
});
window.__handle = handle;
handle.post({ results: RESULTS, stale: [] });

/* The same document, patched, applied in place. */
window.__patch = async (ops) => {
  const applied = applyPatch(doc, ops);
  if (!applied.ok) return { ok: false, errors: applied.errors };
  doc = applied.document;
  const how = await handle.update(doc, { ops: applied.classification.rebuild ? null : ops });
  return { ok: true, how: how.applied, klass: applied.classification.class,
           rebuild: applied.classification.rebuild };
};

/* The same document, mounted from scratch: the other path to the same page. */
window.__rebuild = () => new Promise((resolve) => {
  const other = mountDashboard(document.getElementById("rebuilt"), doc, {
    onEvent: (e) => { if (e.type === "ready") setTimeout(resolve, 60); },
  });
  window.__other = other;
  other.post({ results: RESULTS, stale: [] });
});

/* §8.4: the component emits DOT, the pane lays it out in the engine frame
   beside the display frame, and the SVG comes back like any other result —
   one graph vocabulary across this path and the figure path. */
window.__mountGraph = () => new Promise((resolve) => {
  const g = mountDashboard(document.getElementById("graphhost"), {
    title: "Graph", panels: [], transforms: [], assertions: [], uses: ["graph"],
    views: [{ name: "main",
              html: '<div id="gg"><dydra-graph dot="digraph{a->b;b->c}"></dydra-graph></div>' }],
  }, {
    onLayout: async ({ dot, engine }) => {
      const { layoutDot } = await import("/lib/wasm/graphviz.js");
      window.__layoutAsked = (window.__layoutAsked || 0) + 1;
      return layoutDot(dot, { engine });
    },
    onEvent: (e) => { if (e.type === "ready") resolve(true); },
  });
  window.__graph = g;
});

/* A document made of ELEMENTS rather than markup, so that the element
   operations can be driven through the same pane-to-frame path as any other
   patch.  The question is whether they are applied IN PLACE: the frame
   cannot import the reconciler, so it runs the same applier inlined, and if
   that does not work the pane falls back to a rebuild and the claim that a
   change does not recreate the page is false in the only place it matters. */
const TREE_DOC = {
  id: "app-tree", revision: 1, title: "Inventory",
  uses: ["panel", "card", "metric", "table"],
  panels: [{ name: "sales", query: "SELECT ?month ?total WHERE { ?s :month ?month ; :total ?total }" }],
  views: [{ name: "main", elements: [
    { name: "e-panel", kind: "panel", order: "a", attributes: { label: "Parts" },
      layout: { columns: "1fr 1fr", gap: 12, areas: ["left right"] },
      children: [
        { name: "e-left", kind: "card", order: "a", placement: { area: "left" },
          children: [{ name: "e-tab", kind: "table", order: "a", bound: "sales" }] },
        { name: "e-right", kind: "metric", order: "b", placement: { area: "right" },
          attributes: { label: "Count", value: "3" } },
      ] },
    { name: "e-note", kind: "p", order: "b", text: "As at the last import." },
  ] }],
};
let treeDoc = validateApplication(TREE_DOC).document;
window.__treeValidation = validateApplication(TREE_DOC).errors;
const treeHandle = mountDashboard(document.getElementById("treehost"), treeDoc, {
  onEvent: (e) => { (window.__treeEvents = window.__treeEvents || []).push(e); },
});
treeHandle.post({ results: RESULTS, stale: [] });
window.__treePatch = async (ops) => {
  const applied = applyPatch(treeDoc, ops);
  if (!applied.ok) return { ok: false, errors: applied.errors };
  treeDoc = applied.document;
  const how = await treeHandle.update(treeDoc, { ops: applied.classification.rebuild ? null : ops });
  return { ok: true, how: how.applied, klass: applied.classification.class,
           unapplied: how.unapplied || [] };
};

/* U-74: a page somebody else wrote, mounted with the mark the store
   produced.  The document handed in is already SCREENED -- the frame draws
   the mark and never decides what to withhold. */
const SHARED = validateApplication({
  id: "shared", title: "Bob's page", uses: ["panel", "table"],
  panels: [{ name: "sales", query: "SELECT ?region ?total WHERE { ?s :region ?region ; :total ?total }" }],
  views: [{ name: "one", title: "One", html: '<div id="s1" data-bound="sales"></div>' },
          { name: "two", title: "Two", html: '<p id="s2">second</p>' }],
}).document;
const sharedHandle = mountDashboard(document.getElementById("sharedhost"), SHARED, {
  notice: "Written by bob. Its the page's script is not running.",
  onEvent: () => {},
});
sharedHandle.post({ results: RESULTS, stale: [] });
window.__shared = sharedHandle;
window.__sharedDoc = SHARED;
/* A rebuild rather than a patch: a change to "uses" is the one the runtime
   cannot apply in place, so this is the path that throws the document away. */
window.__sharedRebuild = () => sharedHandle.update(
  { ...SHARED, uses: [...SHARED.uses, "metric"] }, { ops: null });

window.__savedPage = () => handle.page(RESULTS);
window.__size = () => window.__validation.size;
window.__componentNames = Object.keys(COMPONENTS);
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS);
    return;
  }
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found: " + path);
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => { fail++; console.log("  FAIL page error: " + e.message); });
await page.goto(`http://127.0.0.1:${port}/__harness`);

const frameEl = page.locator("#host iframe");
await frameEl.waitFor({ timeout: 5000 });
const inside = async () => (await page.locator("#host iframe").elementHandle()).contentFrame();
const settle = (ms = 150) => page.waitForTimeout(ms);

await settle(400);

console.log("\nthe document mounts, and the toolbox is in the page");
{
  const v = await page.evaluate(() => window.__validation);
  ok(v.ok, "the document validates");
  const f = await inside();
  ok(await f.evaluate(() => !!document.querySelector(".dash-view")),
     "its one view is a region of the page (D-AC)");
  ok(await f.evaluate(() => !!window.DydraUI),
     "the toolbox helper is inlined, not imported — the frame loads nothing");
  ok(await f.evaluate(() => !!customElements.get("dydra-table")),
     "and the components it declared are registered");
  ok(await f.evaluate(() => !customElements.get("dydra-heatmap")),
     "while one it did not declare does not exist");
}

console.log("\n§8.2: a component in a bound slot is given the data, not drawn over");
{
  const f = await inside();
  ok(await f.evaluate(() =>
    document.querySelector("#tbl dydra-table tbody tr") !== null),
     "the table the model put in the slot drew the rows");
  ok(await f.evaluate(() =>
    document.querySelectorAll("#tbl table").length === 1),
     "and the runtime did not draw a second table over it");
  ok(await f.evaluate(() => document.querySelector("#tbl").getAttribute("data-provenance") === "bound"),
     "and the provenance marking the page cannot opt out of is still on the slot");
}

console.log("\n§8.2: every component renders something sensible with nothing set");
{
  const f = await inside();
  const blanks = await f.evaluate(() => {
    const out = [];
    document.querySelectorAll("#empties > *").forEach((el) => {
      if (!el.textContent.trim() && !el.querySelector("svg, select, table")) out.push(el.tagName);
    });
    return out;
  });
  ok(blanks.length === 0, `nothing renders blank (${blanks.join(", ") || "all twelve say something"})`);
  ok(await f.evaluate(() =>
    /no layout engine|no graph/.test(document.querySelector("dydra-graph").textContent)),
     "`graph` with no engine behind it says so rather than showing an empty box (§7.4)");
  ok(await f.evaluate(() => document.querySelector("dydra-tabs .dydra-tabstrip button") !== null),
     "`tabs` builds its strip from the children's labels");
  ok(await f.evaluate(() => document.getElementById("t2").hidden === true),
     "and opens on the first one");
}

console.log("\n§6.2.1: a presentational patch is applied IN PLACE");
{
  const f = await inside();
  await f.evaluate(() => { window.scrollTo(0, 40); window.__mark = "survived"; });
  const out = await page.evaluate(() => window.__patch([
    { op: "set-slot", id: "l", html: '<p id="l" data-asserted="lead" class="hot"></p>' },
    { op: "set-styles", value: ".hot { color: #8a2b2b; }" },
  ]));
  await settle(200);
  ok(out.ok && out.klass === "presentational", "the change is classified presentational");
  ok(out.how === "in-place", "and applied in place, not by reloading");
  const g = await inside();
  ok(await g.evaluate(() => document.querySelector("#l").className === "hot"),
     "the slot changed");
  ok(await g.evaluate(() => document.getElementById("dash-doc-style").textContent.includes(".hot")),
     "the stylesheet changed");
  ok(await g.evaluate(() => window.__mark === "survived"),
     "and the page is the same document it was: nothing the reader had done was thrown away");
  ok(await g.evaluate(() => document.querySelector("#l").getAttribute("data-provenance") === "asserted"),
     "the replaced region was re-marked, because the fill runs after the patch");
  ok(await g.evaluate(() => document.querySelector("#tbl tbody tr") !== null),
     "and the data that was already in the page is still drawn — nothing was re-posted");
}

console.log("\n§6.2.1: patch-then-read equals rebuild-then-read");
{
  await page.evaluate(() => window.__rebuild());
  await settle(400);
  const a = await (await inside()).evaluate(() => document.body.innerHTML);
  const other = await (await page.locator("#rebuilt iframe").elementHandle()).contentFrame();
  const b = await other.evaluate(() => document.body.innerHTML);
  // The timestamp in the footer is the one thing that legitimately differs:
  // the two pages were rendered seconds apart.
  const normalise = (s) => s.replace(/<span id="dash-footer-at">[^<]*<\/span>/, "")
                            .replace(/\s+/g, " ").trim();
  ok(normalise(a) === normalise(b),
     "the page reached by patching and the page reached by rebuilding are the same page");
  if (normalise(a) !== normalise(b)) {
    const x = normalise(a), y = normalise(b);
    let i = 0; while (i < x.length && x[i] === y[i]) i += 1;
    console.log("    first difference at " + i + ":\n      patched: " + x.slice(i - 60, i + 120)
              + "\n      rebuilt: " + y.slice(i - 60, i + 120));
  }
}

console.log("\n§6.2.1: what the reader has done to the page survives a patch");
{
  // This is the whole argument for applying in place rather than rebuilding.
  // A sort is reader state: it is in the DOM and nowhere in the document, so
  // a rebuild would silently undo it — and undoing the reader's last action
  // on every cosmetic change is what would make iterating feel like filing
  // requests rather than like designing.
  const f = await inside();
  await f.evaluate(() => document.querySelectorAll("dydra-tabs .dydra-tabstrip button")[1].click());
  ok(await f.evaluate(() => document.getElementById("t2").hidden === false),
     "a tab switches on a click, inside the one view — tabs are not views (D-AC)");
  const before = await f.evaluate(() => document.querySelector("#tbl tbody tr td").textContent);
  await f.evaluate(() => document.querySelectorAll("#tbl th")[1].click());
  const sorted = await f.evaluate(() => document.querySelector("#tbl tbody tr td").textContent);
  ok(before === "2026-01" && sorted === "2026-02",
     "clicking a header sorts without a round trip — the whole reason the component exists");

  const out = await page.evaluate(() => window.__patch([
    { op: "set-slot", id: "h", html: '<h1 id="h">Monthly sales</h1>' },
  ]));
  await settle(200);
  ok(out.how === "in-place", "a patch to another region is applied in place");
  const g = await inside();
  ok(await g.evaluate(() => document.querySelector("#h").textContent === "Monthly sales"),
     "the region named by the patch changed");
  ok(await g.evaluate(() => document.querySelector("#tbl tbody tr td").textContent === "2026-02"),
     "and the sort the reader had applied is still there");
  ok(await g.evaluate(() => document.getElementById("t2").hidden === false),
     "as is the tab they had open");
}

console.log("\n§6.2.1: what the runtime cannot apply, it says so rather than guessing");
{
  ok(!await (await inside()).evaluate(() => !!customElements.get("dydra-line-chart")),
     "the component the document did not declare is not in the page");
  const out = await page.evaluate(() => window.__patch([{ op: "use", add: ["line-chart"] }]));
  await settle(400);
  ok(out.ok && out.rebuild === true,
     "a change to `uses` cannot be applied in place: a component that was not inlined is not there");
  ok(out.how === "rebuild", "so the page is rebuilt");
  const f = await inside();
  ok(await f.evaluate(() => !!customElements.get("dydra-line-chart")),
     "and now it is");
  ok(await f.evaluate(() => document.querySelector("#tbl tbody tr") !== null),
     "with the data the page already had posted back into it, not fetched again");
}

console.log("\nU-37: only what `uses` names is in the page");
{
  const size = await page.evaluate(() => window.__size());
  ok(size.components > 0 && size.perComponent.table > 0,
     "the size reported at Gate 1 counts the components");
  const saved = await page.evaluate(() => window.__savedPage());
  ok(saved.includes("dydra-table") && saved.includes("window.DydraUI"),
     "and the saved page carries them, because it has nowhere to load them from");
}

console.log("\nU-42: `graph` draws through the vendored engine, not through a layout it wrote");
{
  await page.evaluate(() => window.__mountGraph());
  await settle(2500);
  const gf = await (await page.locator("#graphhost iframe").elementHandle()).contentFrame();
  ok(await page.evaluate(() => window.__layoutAsked >= 1),
     "the component asked the pane to lay the graph out");
  ok(await gf.evaluate(() => document.querySelector("dydra-graph svg") !== null),
     "and an SVG came back into the page");
  ok(await gf.evaluate(() => {
    const svg = document.querySelector("dydra-graph svg");
    return svg && svg.querySelectorAll("g.node").length === 3;
  }), "laid out by graphviz — three nodes, positioned by the engine rather than by a model");
  ok(await gf.evaluate(() => !!document.querySelector("dydra-graph svg").getAttribute("viewBox")),
     "with the coordinate system the engine computed");
}

console.log("\nU-43: a saved copy degrades honestly");
{
  const saved = await page.evaluate(() => window.__savedPage());
  ok(saved.includes("__dashboardStandalone"),
     "the saved page knows it is standalone");
  ok(saved.includes("dash-data"), "and carries its data inline, so it still draws offline");
  await page.evaluate((html) => {
    const f = document.createElement("iframe");
    f.id = "savedframe";
    f.setAttribute("sandbox", "allow-scripts");
    f.srcdoc = html;
    document.body.appendChild(f);
  }, saved);
  await settle(500);
  const savedFrame = await (await page.locator("#savedframe").elementHandle()).contentFrame();
  ok(await savedFrame.evaluate(() => document.querySelector("#tbl tbody tr") !== null),
     "opened with no interface behind it, it draws the data it holds");
  const why = await savedFrame.evaluate(() =>
    window.dashboard.run("sales", { region: "Nowhere" }).then(() => null, (e) => e.message));
  ok(/re-open it in Dydra/.test(String(why)),
     "and a request it does not hold the answer to says so, rather than hanging");
  ok(await savedFrame.evaluate(() =>
    document.getElementById("dash-refusal") !== null
    && !document.getElementById("dash-refusal").hidden),
     "with the reason shown in the page, where the reader is looking");
}

/* ═══════ U-64: an element patch is applied in place, in the frame ═══════ */

console.log("\nU-64: the element operations reach the frame as instructions");
{
  const treeFrame = async () =>
    (await page.locator("#treehost iframe").elementHandle()).contentFrame();
  await page.locator("#treehost iframe").waitFor({ timeout: 5000 });
  await settle(400);
  const tf = await treeFrame();

  ok((await page.evaluate(() => window.__treeValidation)).length === 0,
     "a document made of elements validates");
  ok(await tf.evaluate(() => !!document.querySelector('[data-ui="e-panel"]')),
     "and mounts with its identities in the page");
  ok(await tf.evaluate(() => !!window.DydraDomPatch),
     "the applier is inlined, because the frame can import nothing");
  ok(await tf.evaluate(() =>
       /grid-template-areas/.test(document.querySelector('[data-ui="e-panel"]')
         .getAttribute("style") || "")),
     "the layout is on the container");

  // Mark the node, so that a relocation can be told from a rebuild.
  await tf.evaluate(() => {
    window.__mark = document.querySelector('[data-ui="e-tab"]');
    window.__mark.__survived = "yes";
  });

  const moved = await page.evaluate(() => window.__treePatch(
    [{ op: "move-element", element: "e-tab", parent: "e-panel", area: "right" }]));
  ok(moved.ok, (moved.errors || []).join("; ") || "the patch applied");
  ok(moved.how === "in-place",
     `IN PLACE, not a rebuild — which is the whole claim (${moved.how})`);
  ok(moved.klass === "presentational", "and it crossed no gate");
  ok(await tf.evaluate(() => {
       const el = document.querySelector('[data-ui="e-tab"]');
       let up = el?.parentElement;
       while (up && !up.getAttribute("data-ui")) up = up.parentElement;
       return up?.getAttribute("data-ui") === "e-panel";
     }), "it is in its new container");
  ok(await tf.evaluate(() =>
       document.querySelector('[data-ui="e-tab"]') === window.__mark
       && window.__mark.__survived === "yes"),
     "and it is the same node: the frame moved it rather than building it again");

  const rearranged = await page.evaluate(() => window.__treePatch(
    [{ op: "set-layout", element: "e-panel",
       value: { columns: "1fr 1fr", gap: 12, areas: ["right left"] } }]));
  ok(rearranged.how === "in-place", "rearranging is in place too");
  ok(await tf.evaluate(() =>
       /right left/.test(document.querySelector('[data-ui="e-panel"]').getAttribute("style"))),
     "with the new template on the container");
  ok(await tf.evaluate(() => document.querySelector('[data-ui="e-tab"]') === window.__mark),
     "and still the same node — a rearrangement rebuilt nothing");

  const inserted = await page.evaluate(() => window.__treePatch(
    [{ op: "insert-element", parent: "e-left", name: "e-added", kind: "metric",
       attributes: { label: "Added", value: "9" } }]));
  ok(inserted.how === "in-place", "an insert is in place");
  ok(await tf.evaluate(() => {
       const el = document.querySelector('[data-ui="e-added"]');
       return el && el.tagName.toLowerCase() === "dydra-metric"
              && el.textContent.includes("9");
     }), "and the component it names is upgraded and drawn, inside the frame");

  const removed = await page.evaluate(() => window.__treePatch(
    [{ op: "remove-element", element: "e-note" }]));
  ok(removed.how === "in-place" && await tf.evaluate(() =>
       !document.querySelector('[data-ui="e-note"]')), "a removal likewise");
  ok(await tf.evaluate(() => document.querySelector('[data-ui="e-tab"]') === window.__mark),
     "with the rest of the page still standing, node for node");
}

console.log("\nU-74: the mark a shared page carries, and what it survives");
{
  const sf = async () => (await page.locator("#sharedhost iframe").elementHandle()).contentFrame();
  const f = await sf();
  ok(await f.evaluate(() => !!document.querySelector('[data-notice="shared"]')),
     "a page mounted with a notice draws it");
  ok(await f.evaluate(() =>
       document.querySelector('[data-notice="shared"]').textContent.includes("Written by bob")),
     "saying who wrote it");
  ok(await f.evaluate(() => {
       const n = document.querySelector('[data-notice="shared"]');
       return !n.closest(".dash-view");
     }), "outside every view, so it is not something a view switch can hide");

  await page.evaluate(() => window.__shared.setView("two"));
  await page.waitForTimeout(150);
  const after = await sf();
  ok(await after.evaluate(() => !!document.querySelector("#s2")?.offsetParent),
     "switching view works");
  ok(await after.evaluate(() => {
       const n = document.querySelector('[data-notice="shared"]');
       return n && n.offsetParent !== null;
     }), "and the mark is still on the screen");

  // A rebuild is the path that would most plausibly drop it: it throws the
  // document away and builds a new one from `current'.
  const how = await page.evaluate(() => window.__sharedRebuild());
  await page.waitForTimeout(250);
  ok(how.applied === "rebuild", `the document was rebuilt, not patched (${how.applied})`);
  const rebuilt = await sf();
  ok(await rebuilt.evaluate(() => !!document.querySelector('[data-notice="shared"]')),
     "and it survives a rebuild, which is where a mark passed per call would be lost");

  ok(/data-notice="shared"/.test(await page.evaluate(() => window.__shared.page({}))),
     "the downloadable copy carries it too — a saved page does not lose the warning");
  await page.evaluate(() => window.__shared.setNotice(null));
  ok(!/data-notice/.test(await page.evaluate(() => window.__shared.page({}))),
     "and an admitted page can have the mark taken off without being remounted");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
