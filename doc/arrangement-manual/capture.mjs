/**
 * The figures in the arrangement manual, captured from the real thing.
 *
 * This is the harness of `tests/location-bar.browser.mjs' with the
 * assertions taken out and a camera put in.  Nothing here is drawn for the
 * manual: the chrome is rendered by `LayoutView' from an arrangement that
 * `arrangementOf' computed, the bar is the one `mountLocationBar' wires, and
 * the rearranged figure is the result of `applyPatch' running the same
 * operations the manual documents.  A figure that disagrees with the code is
 * therefore a figure that cannot be produced.
 *
 * The model is the one thing stubbed, and it has to be: a manual whose
 * pictures depend on what a provider answered on the day is a manual that
 * cannot be rebuilt.  The stub stands exactly where the provider stands —
 * the patch it returns is applied by the real code, and the reply line is
 * written by the real bar.
 *
 *   node doc/arrangement-manual/capture.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const IMAGES = join(HERE, "images");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css" };

/** The rearrangement the manual uses as its worked example. */
const SIDEBAR_PATCH = [
  { op: "set-layout", element: "w-chrome",
    value: { columns: "220px 1fr", rows: "auto auto 1fr auto",
             areas: ["flashes flashes", "header header", "tabs content", "footer location"] } },
];

const HARNESS = `<!doctype html><meta charset="utf-8"><title>arrangement manual figures</title>
<link rel="stylesheet" href="/stylesheets/style.css">
<link rel="stylesheet" href="/stylesheets/jsui-overrides.css">
<body>
<div id="app"></div>
<script type="module">
import { LayoutView } from "/ui/components/layout.js";
import { mountLocationBar } from "/ui/components/location-bar.js";
import { target as makeTarget } from "/lib/app/instructions.js";
import { defaultWorkspace, arrangementOf, placeBand } from "/lib/app/workspace.js";
import { applyPatch } from "/lib/app/patch.js";
import { mount as mountPresentation } from "/lib/app/arrangement.js";

/* The header's links and a tab strip, so the bands in the figures are the
   bands a reader has on the screen.  The tab strip matters most: the worked
   example moves \`tabs\`, and an empty band would make the figure prove
   nothing. */
const NAV_LINKS = {
  global: ['<a href="#">About</a>', '<a href="#">Docs</a>', '<a href="#">Blog</a>'],
  loggedIn: ['<a href="#">Logout</a>', '<a href="#">Admin</a>'],
  loggedOut: [],
};
const TABS = \`<div class="pane-tabs-bar"><ul data-tab-list>
  <li><a href="#t1" data-tab-link><span class="tab-label">Login</span></a></li>
  <li><a href="#t2" data-tab-link><span class="tab-label">alice</span></a></li>
  <li><a href="#t3" data-tab-link><span class="tab-label">alice parts</span></a></li>
  <li><a href="#t4" data-tab-link><span class="tab-label">Parts inventory</span></a></li>
</ul></div>\`;
const SESSION = { isLoggedIn: () => true, accountName: "alice" };

/* The document the figures are taken against, and the stubbed turn. */
window.__workspace = defaultWorkspace({ page: "main" });
window.__patch = null;              // what the "model" will answer with

const TARGETS = new Map();
const put = (t) => TARGETS.set(t.id, makeTarget(t));
put({ id: "workspace", label: "workspace", kind: "workspace",
      instruct: async () => {
        if (!window.__patch) return { ok: false, message: "the answer carried no patch, so nothing has been changed" };
        const applied = applyPatch(window.__workspace, window.__patch);
        if (!applied.ok) return { ok: false, message: "refused whole: " + applied.errors.join("; ") };
        const before = window.__workspace;
        window.__workspace = { ...applied.document, revision: (before.revision || 1) + 1 };
        window.__draw(window.__workspace);
        return { ok: true, message: "set-layout — saved",
                 undo: async () => { window.__workspace = before; window.__draw(before);
                                     return { ok: true, message: "put back" }; } };
      } });
put({ id: "dash-parts", label: "Parts inventory", kind: "presentation",
      instruct: async () => ({ ok: true, message: "set-placement, set-attribute — saved",
                               undo: async () => ({ ok: true, message: "put back" }) }) });

const CONTENT = \`<div style="padding:14px 18px">
  <h2 style="margin:0 0 8px">alice / parts</h2>
  <p style="color:#5b6670;margin:0 0 14px">4 views  ·  last imported 3 November</p>
  <table style="border-collapse:collapse;font-size:13px">
    <tr><th style="text-align:left;padding:4px 18px 4px 0">view</th><th style="text-align:left;padding:4px 0">rows</th></tr>
    <tr><td style="padding:3px 18px 3px 0">on-hand</td><td>1 204</td></tr>
    <tr><td style="padding:3px 18px 3px 0">on-order</td><td>317</td></tr>
    <tr><td style="padding:3px 18px 3px 0">shortfall</td><td>12</td></tr>
  </table>
</div>\`;

/* The chrome's own arrange channel, as "ui/app.js" wires it, with the store
   left out: the registry is this array and the save is the assignment.  What
   is NOT stubbed is the decision or the sentence -- "mount" is the real one
   from "lib/app/arrangement.js" and a refusal is its own words, which is the
   only reason a figure of a refusal is worth taking. */
window.__mounts = [];
window.__arranged = async (instruction) => {
  if (instruction.verb !== "mount") {
    return { ok: false, message: instruction.verb + " is not wired in the figure harness" };
  }
  const made = mountPresentation({
    document: window.__workspace, presentation: instruction.presentation,
    scope: "document", mounting: "workspace",
    parent: instruction.into || "w-chrome", loaded: window.__mounts });
  if (!made.ok) return { ok: false, message: made.errors[0] };
  window.__mounts.push({ presentation: instruction.presentation,
                         at: "workspace", element: made.element });
  window.__workspace = instruction.into ? made.document
    : placeBand(made.document, { page: "main", element: made.element });
  window.__draw(window.__workspace);
  return { ok: true, message: "mounted" };
};
const arrangeChrome = (instruction) => window.__arranged(instruction);

const layout = new LayoutView();
window.__draw = (document_) => {
  // The App keeps the address across a redraw ("initializeLocationBar"), and
  // the figures have to show what it shows: without this the silent-bar
  // figure would also be missing its address chip, which would blame the
  // redraw for one fault more than it commits.
  const was = window.bar?.address() || null;
  const ws = document_ ? arrangementOf(document_, { page: "main" }) : null;
  document.getElementById("app").innerHTML = layout.render({
    navLinks: NAV_LINKS, session: SESSION,
    content: CONTENT, sidebar: "", paneTabsBar: TABS, paneTabsDefault: "t3",
    workspace: ws,
  });
  window.bar = mountLocationBar(document.querySelector("#location-bar"), {
    navigate: () => {},
    targets: () => [...TARGETS.values()],
    instruct: ({ target, text }) => target.instruct(text),
    arrange: ({ instruction }) => arrangeChrome(instruction),
    path: () => "/account/alice",
  });
  if (was) window.bar.setAddress(was.id);
  return ws;
};
window.__draw(window.__workspace);
<\/script>
</body>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__figures") {
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 620 },
                                     deviceScaleFactor: 2 });
page.on("pageerror", (e) => { console.log("  page error: " + e.message); });
await page.goto(`http://127.0.0.1:${port}/__figures`);
await page.locator("#location-bar").waitFor({ timeout: 5000 });

const settle = (ms = 120) => page.waitForTimeout(ms);
const shotBar = async (name) =>
  page.locator("#location-bar").screenshot({ path: join(IMAGES, name + ".png") });
const shotAll = async (name) => page.screenshot({ path: join(IMAGES, name + ".png") });
const type = async (line) => {
  await page.click("#location-display");
  await page.fill("#location-input", line);
  await page.press("#location-input", "Enter");
  await settle(250);
};
const made = [];
const figure = async (name, what, how) => { await how(); made.push([name, what]); };

/* 1 — the bar as it sits, showing where you are. */
await figure("bar-at-rest", "the bar at rest: it shows the path", async () => {
  await shotBar("bar-at-rest");
});

/* 2 — the input open, with a line in it, before Enter. */
await figure("bar-typing", "the input open, `goto workspace' typed", async () => {
  await page.click("#location-display");
  await page.fill("#location-input", "goto workspace");
  await settle();
  await shotBar("bar-typing");
});

/* 3 — the address taken: the chip says what a sentence will act on. */
await figure("bar-addressed", "the address taken", async () => {
  await page.press("#location-input", "Enter");
  await settle(250);
  await shotBar("bar-addressed");
});

/* 4 — the arrangement this build ships with. */
await figure("chrome-default", "the arrangement this build ships with", async () => {
  await shotAll("chrome-default");
});

/* 5 — the same chrome after the worked example's patch.
   Applied through `applyPatch' and redrawn through `arrangementOf', which is
   the path an instruction takes; the bar is left out of it because what this
   figure is about is the arrangement, not the reply. */
await figure("chrome-rearranged", "the chrome after `set-layout'", async () => {
  const refused = await page.evaluate(async (ops) => {
    const { applyPatch } = await import("/lib/app/patch.js");
    const applied = applyPatch(window.__workspace, ops);
    if (!applied.ok) return applied.errors.join("; ");
    window.__workspace = applied.document;
    window.__draw(applied.document);
    return null;
  }, SIDEBAR_PATCH);
  if (refused) throw new Error("the worked example's patch was refused: " + refused);
  await settle(250);
  await shotAll("chrome-rearranged");
});

/* 6 — an applied change with its undo.
   Taken against a PRESENTATION and not against the workspace, because the
   workspace path redraws the chrome before the bar writes its reply and the
   reply is lost with the node it was going into.  Documented in the manual
   under "What the bar does not tell you"; captured here where it is true. */
await figure("bar-reply-undo", "an applied change, and the undo beside it", async () => {
  await page.evaluate(() => { window.__draw(window.__workspace); });
  await settle(150);
  await type("goto Parts inventory");
  await type("put the chart beside the table");
  await shotBar("bar-reply-undo");
});

/* 7 — a refusal: an address that names nothing. */
await figure("bar-refusal", "an address that names nothing", async () => {
  await type("goto zzz-no-such-target");
  await shotBar("bar-refusal");
});

/* 8 — the workspace, silent: what a successful arrangement actually shows. */
await figure("bar-silent", "a successful arrangement says nothing (a known defect)", async () => {
  await page.evaluate((ops) => { window.__patch = ops; }, SIDEBAR_PATCH);
  await type("goto workspace");
  await type("put the tabs down the left-hand side");
  await shotBar("bar-silent");
});

/* 9 - a verb refused: a presentation is mounted in one place at a time.
   The sentence is "mount"'s own (arrangement.js), not the harness's, and it
   is one of the few verb replies that survives: a refusal returns before the
   chrome is redrawn, and a redraw is what swallows the others. */
await figure("bar-mount-refused", "the second mount of one presentation, refused", async () => {
  await type("goto workspace");
  await type("mount inventory");
  await type("mount inventory");
  await shotBar("bar-mount-refused");
});

await browser.close();
server.close();
console.log(`${made.length} figures written to ${IMAGES}`);
for (const [name, what] of made) console.log(`  ${name}.png — ${what}`);
