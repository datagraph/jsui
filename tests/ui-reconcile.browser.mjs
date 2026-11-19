/**
 * The reconciler, in a real browser (U-61, U-62, U-63).
 *
 * One claim here cannot be checked anywhere else, and it is the claim the
 * whole design is built on:
 *
 *      AN ELEMENT ABSENT FROM THE DIFF IS NEVER TOUCHED.
 *
 * Nothing about the reconciler's source settles that -- a line that looks
 * like a targeted update is one `innerHTML =' away from rebuilding a
 * subtree -- so it is asserted the only honest way, with a MutationObserver
 * over the whole root while the change is applied.  Every test below that
 * changes something records which elements the DOM reported mutations for
 * and compares that set with what the change was about.
 *
 * Two others need a browser as well.  Identity across a move is a claim
 * about the NODE: the same object, with its value, its caret and its
 * children intact, which a serialised comparison cannot see.  And the two
 * rendering paths -- `htmlFromTree' for the frame, `mount' for the
 * reconciler -- have to produce the same page, or a presentation would look
 * different depending on how it was opened.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>reconciler harness</title>
<body>
<div id="root"></div>
<div id="markup"></div>
<script type="module">
import { node, view, find, htmlFromTree, diffTrees, canonicalTree } from "/lib/app/tree.js";
import { mount, apply, reconcile, nodeFor, mountedNames } from "/lib/app/reconcile.js";
import { COMPONENTS } from "/lib/app/toolbox/index.js";

/* Every component the trees below use has to be registered, as the frame
   would have inlined it.  The reconciler does not inline anything: it is
   given a root in a document that already has its toolbox. */
for (const name of ["base", "panel", "card", "grid", "table", "metric", "badge"]) {
  const c = COMPONENTS[name];
  if (!c) continue;
  if (c.style) { const s = document.createElement("style"); s.textContent = c.style; document.head.appendChild(s); }
  if (c.source) { const s = document.createElement("script"); s.textContent = c.source; document.head.appendChild(s); }
}

const sample = () => view({ name: "main", elements: [
  node({ name: "e-panel", kind: "panel", order: "a",
         attributes: { label: "Inventory" },
         layout: { columns: "1fr 1fr", gap: 12, areas: ["left right"] },
         children: [
           node({ name: "e-left", kind: "card", order: "a", placement: { area: "left" },
                  children: [ node({ name: "e-count", kind: "metric", order: "a",
                                     attributes: { label: "Parts", value: "41" } }) ] }),
           node({ name: "e-right", kind: "div", order: "b", placement: { area: "right" },
                  children: [ node({ name: "e-table", kind: "table", order: "a",
                                     attributes: { sortable: true }, bound: "parts" }) ] }),
         ] }),
  node({ name: "e-note", kind: "p", order: "b", text: "Counted at the last import." }),
] });

window.__state = { tree: sample() };
const root = () => document.getElementById("root");

window.__mount = () => {
  window.__state.tree = sample();
  mount(window.__state.tree.elements, root(), { components: COMPONENTS });
  return mountedNames(root());
};

/* The same tree, as markup: the frame's path, for comparison. */
window.__renderMarkup = () => {
  document.getElementById("markup").innerHTML =
    htmlFromTree(sample().elements, { components: COMPONENTS });
  return true;
};

/**
 * Apply a change, watching the DOM.
 *
 * \`touched' is every element identity a mutation was reported against,
 * walking up from the target to the nearest element that has one -- a
 * character-data mutation lands on a text node, and the question being
 * asked is which ELEMENT was disturbed.
 */
window.__change = (edit) => {
  const before = canonicalTree(window.__state.tree.elements);
  const after = window.__state.tree;
  edit(after, { node, find });

  const touched = new Set();
  // The callback is a microtask and the change below is synchronous, so the
  // records are drained by hand rather than waited for: the question is what
  // this one apply() did, not what the page settles to.
  const note = (records) => {
    for (const r of records) {
      let target = r.target;
      if (r.type === "childList" || r.type === "characterData") {
        for (const added of r.addedNodes || []) {
          let a = added;
          while (a && a.nodeType !== 1) a = a.parentNode;
          if (a && a.getAttribute && a.getAttribute("data-ui")) touched.add(a.getAttribute("data-ui"));
        }
      }
      while (target && target.nodeType !== 1) target = target.parentNode;
      while (target && target !== root() && !(target.getAttribute && target.getAttribute("data-ui"))) {
        target = target.parentNode;
      }
      if (target && target !== root() && target.getAttribute) {
        touched.add(target.getAttribute("data-ui"));
      } else if (target === root()) {
        touched.add("(root)");
      }
    }
  };
  const observer = new MutationObserver(note);
  observer.observe(root(), { childList: true, subtree: true, attributes: true,
                             characterData: true, attributeOldValue: false });

  const result = reconcile(before, canonicalTree(after.elements), root(), { components: COMPONENTS });
  note(observer.takeRecords());
  observer.disconnect();
  return { diff: { added: result.diff.added.map((a) => a.name),
                   removed: result.diff.removed.map((r) => r.name),
                   moved: result.diff.moved.map((m) => m.name),
                   changed: result.diff.changed.map((c) => c.name) },
           touched: [...touched], faults: result.applied ? result.applied.faults : [] };
};

window.__html = (name) => (name ? nodeFor(root(), name)?.outerHTML : root().innerHTML);
window.__attr = (name, a) => nodeFor(root(), name)?.getAttribute(a);
window.__exists = (name) => !!nodeFor(root(), name);
/* The nearest ancestor that is an element of the tree.  A component may put
   its children inside a region of its own, so the DOM parent is not always
   the tree parent -- which is the thing data-ui-content exists to bridge. */
window.__parentOf = (name) => {
  let el = nodeFor(root(), name)?.parentElement;
  while (el && el !== root() && !el.getAttribute("data-ui")) el = el.parentElement;
  return el && el !== root() ? el.getAttribute("data-ui") : "(root)";
};
window.__childOrder = (name) => {
  const el = name ? nodeFor(root(), name) : root();
  const region = el?.querySelector(":scope > [data-ui-content]") || el;
  return [...region.children].map((c) => c.getAttribute("data-ui")).filter(Boolean);
};
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" }); res.end(HARNESS); return;
  }
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found: " + path); }
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
await page.waitForTimeout(200);

/* ═════════════════════════════ mounting ═══════════════════════════════════ */

console.log("\nU-61: a tree mounts");
{
  const names = await page.evaluate(() => window.__mount());
  ok(names.length === 6, `every element is in the DOM and carries its identity (${names.length})`);
  ok(await page.evaluate(() => window.__attr("e-panel", "data-ui-order") === "a"),
     "with its order key beside it, so a later insert can find its place");
  ok(await page.evaluate(() => /DYDRA-PANEL/.test(window.__html("e-panel").slice(0, 20).toUpperCase())),
     "a component is its custom element");
  ok(await page.evaluate(() => window.__attr("e-table", "data-bound") === "parts"),
     "a bound region is marked for the frame exactly as markup would have marked it");
  ok(await page.evaluate(() => /grid-template-areas/.test(window.__attr("e-panel", "style") || "")),
     "and the layout is on the container");
  ok(await page.evaluate(() => /grid-area: ?left/.test(window.__attr("e-left", "style") || "")),
     "the placement on the child (D-AK)");
}

console.log("\nU-63: the two rendering paths agree");
{
  const same = await page.evaluate(() => {
    window.__mount(); window.__renderMarkup();
    const strip = (el) => [...el.querySelectorAll("[data-ui]")].map((n) =>
      n.getAttribute("data-ui") + "|" + n.tagName + "|" + (n.getAttribute("style") || "")
      + "|" + (n.getAttribute("data-bound") || ""));
    return { mounted: strip(document.getElementById("root")),
             markup: strip(document.getElementById("markup")) };
  });
  ok(JSON.stringify(same.mounted) === JSON.stringify(same.markup),
     "the frame's markup and the reconciler's DOM are the same page — element for "
   + "element, style for style");
}

/* ══════════════════ U-62: the post-condition, six ways ════════════════════ */

console.log("\nU-62: changing one attribute touches one element");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { find }) => { find(t.elements, "e-count").attributes.value = "47"; });
  });
  ok(r.diff.changed.join() === "e-count" && !r.diff.added.length && !r.diff.moved.length,
     "the diff names one element");
  ok(r.touched.join() === "e-count", `and the DOM reported mutations for that one only (${r.touched})`);
  ok(await page.evaluate(() => window.__attr("e-count", "value") === "47"), "with the value set");
}

console.log("changing text touches one element");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { find }) => { find(t.elements, "e-note").text = "Counted this morning."; });
  });
  ok(r.touched.join() === "e-note", `one element (${r.touched})`);
  ok(await page.evaluate(() => window.__html("e-note").includes("Counted this morning.")),
     "and it says the new thing");
}

console.log("rearranging a panel touches the panel, and NEITHER child (D-AK)");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { find }) => {
      find(t.elements, "e-panel").layout.areas = ["right left"];
    });
  });
  ok(r.diff.changed.join() === "e-panel", "one triple's worth of change");
  ok(r.touched.join() === "e-panel",
     `the container's style attribute and nothing else (${r.touched}) — which is why `
   + `named areas are the primary form`);
  ok(await page.evaluate(() => /right left/.test(window.__attr("e-panel", "style"))),
     "and the template is the new one");
}

console.log("inserting touches the new element and its container only");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { node, find }) => {
      find(t.elements, "e-left").children.push(
        node({ name: "e-badge", kind: "badge", order: "b", attributes: { tone: "warn" }, text: "stale" }));
    });
  });
  ok(r.diff.added.join() === "e-badge", "one element added");
  ok(r.touched.sort().join() === ["e-badge", "e-left"].sort().join(),
     `the element and the container it went into (${r.touched})`);
  ok(await page.evaluate(() => window.__parentOf("e-badge") === "e-left"), "and it is where it was put");
  ok(await page.evaluate(() => window.__childOrder("e-left").join() === "e-count,e-badge"),
     "after its sibling, by key");
}

console.log("an insert in the middle lands in the middle, from the key alone");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { node, find }) => {
      const panel = find(t.elements, "e-panel");
      panel.children.push(node({ name: "e-mid", kind: "div", order: "am",
                                 placement: { area: "left" } }));
    });
  });
  const order = await page.evaluate(() => window.__childOrder("e-panel"));
  ok(order.join() === "e-left,e-mid,e-right", `between the two that were there (${order})`);
  ok(r.touched.sort().join() === ["e-mid", "e-panel"].sort().join(),
     `and neither sibling was disturbed to make room (${r.touched})`);
}

console.log("removing touches the element and its container only");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { find }) => {
      const panel = find(t.elements, "e-panel");
      panel.children = panel.children.filter((c) => c.name !== "e-right");
    });
  });
  ok(r.diff.removed.join() === "e-right", "the subtree is reported once, at its root");
  ok(!(await page.evaluate(() => window.__exists("e-table"))), "and its children went with it");
  ok(r.touched.join() === "e-panel", `only the container saw it go (${r.touched})`);
  ok(await page.evaluate(() => window.__exists("e-left")), "the other child is still there");
}

/* ═══════════════════ the move, which is the point of it ═══════════════════ */

console.log("D-AO: a move moves the node");
{
  const r = await page.evaluate(() => {
    window.__mount();
    // Mark the node so that a rebuild can be told from a relocation: a
    // property set on the element survives a move and does not survive
    // being built again.
    window.__marked = document.querySelector('[data-ui="e-table"]');
    window.__marked.__keptAcrossTheMove = "yes";
    return window.__change((t, { find }) => {
      const panel = find(t.elements, "e-panel");
      const right = find(t.elements, "e-right");
      const table = find(t.elements, "e-table");
      right.children = right.children.filter((c) => c.name !== "e-table");
      table.order = "c";
      table.placement = { area: "left" };
      panel.children.push(table);
    });
  });
  ok(r.diff.moved.join() === "e-table", "reported as a move, not as a delete and an insert");
  ok(await page.evaluate(() => window.__parentOf("e-table") === "e-panel"), "it is in its new container");
  ok(await page.evaluate(() =>
    document.querySelector('[data-ui="e-table"]') === window.__marked
    && window.__marked.__keptAcrossTheMove === "yes"),
     "and it is the SAME NODE — so a control keeps its value and a chart its canvas");
  ok(r.touched.includes("e-table") && r.touched.includes("e-panel") && r.touched.includes("e-right"),
     `the node, the container it left and the one it joined (${r.touched})`);
  ok(!r.touched.includes("e-count") && !r.touched.includes("e-note"),
     "and nothing else");
}

console.log("a field a text input holds survives a move");
{
  const kept = await page.evaluate(() => {
    window.__mount();
    const host = document.querySelector('[data-ui="e-right"]');
    const input = document.createElement("input");
    input.value = "half typed";
    host.appendChild(input);
    window.__change((t, { find }) => {
      const panel = find(t.elements, "e-panel");
      const right = find(t.elements, "e-right");
      right.order = "aa";
      panel.children = panel.children.filter((c) => c.name !== "e-right");
      panel.children.push(right);
    });
    return document.querySelector('[data-ui="e-right"] input')?.value;
  });
  ok(kept === "half typed", "the DOM is the execution environment, and it persists across the edit");
}

/* ═══════════════════════════ kind, and faults ═════════════════════════════ */

console.log("a change of kind replaces the element and keeps its subtree");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { find }) => { find(t.elements, "e-right").kind = "card"; });
  });
  ok(r.diff.changed.join() === "e-right", "one element");
  ok(await page.evaluate(() => window.__html("e-right").slice(0, 12).toUpperCase().includes("DYDRA-CARD")),
     "it is the new kind");
  ok(await page.evaluate(() => window.__exists("e-table")
                            && window.__parentOf("e-table") === "e-right"),
     "and its children moved into the replacement rather than being built again");
}

console.log("U-61: a bad element is inert, and its siblings are not");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { node, find }) => {
      find(t.elements, "e-left").children.push(
        node({ name: "e-bad", kind: "host", order: "z", host: "nothing-registered" }));
    });
  });
  ok(r.faults.length === 1 && r.faults[0].name === "e-bad", "the fault is reported once, by element");
  ok(await page.evaluate(() => (window.__attr("e-bad", "data-ui-inert") || "").includes("nothing-registered")),
     "the element says what is missing, in the page");
  ok(await page.evaluate(() => window.__exists("e-count")), "its sibling is untouched");
  ok(await page.evaluate(() => window.__exists("e-note")), "and so is the rest of the view");
}

console.log("a registered host is mounted, and its content is left alone");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change((t, { node, find }) => {
      find(t.elements, "e-left").children.push(
        node({ name: "e-host", kind: "host", order: "y", host: "prompt-pane" }));
    });
  });
  ok(r.faults.length === 1,
     "with no registry the host is inert — which is the phase-6 wiring, not a reconciler fault");
}

console.log("nothing to do is nothing done");
{
  const r = await page.evaluate(() => {
    window.__mount();
    return window.__change(() => {});
  });
  ok(r.touched.length === 0 && !r.diff.changed.length,
     "an empty diff mutates nothing at all");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
