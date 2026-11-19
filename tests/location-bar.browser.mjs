/**
 * The location bar and the arranged chrome, in a real browser
 * (U-72, U-76, U-77, U-78).
 *
 * The grammar is decided in `ui-instructions.test.mjs'; what cannot be
 * decided there is everything this bar is actually made of — a click that
 * swaps a span for an input, an Enter that must not start a second turn over
 * the first, a reply that has to survive the message timer beside it, and a
 * grid whose areas are only real once a browser has laid them out.
 *
 * The claims, in the order they matter:
 *
 *   1. **Nothing the bar did before has changed.** Click, type, Enter,
 *      Escape; a bare path still navigates. The bar is the repair route for
 *      a bad arrangement, so a regression here is the one that cannot be
 *      clicked away from.
 *   2. **The target is on the screen before the sentence is.** The user can
 *      read what an unprefaced line will act on without pressing anything.
 *   3. **One instruction at a time.** A second Enter against a document the
 *      first is still changing is refused by construction, not by luck.
 *   4. **The undo is beside the reply**, because a presentational change
 *      crosses no gate and leaves no other trace.
 *   5. **The chrome is laid out by the arrangement**, the bands keep their
 *      ids, and the bar is in flow — a fixed bar would make "move it to the
 *      top" silently do nothing.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css" };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>location bar harness</title>
<link rel="stylesheet" href="/stylesheets/jsui-overrides.css">
<body>
<div id="app"></div>
<script type="module">
import { LayoutView } from "/ui/components/layout.js";
import { mountLocationBar } from "/ui/components/location-bar.js";
import { target as makeTarget } from "/lib/app/instructions.js";
import { defaultWorkspace, arrangementOf } from "/lib/app/workspace.js";

const NAV_LINKS = { global: [], loggedIn: [], loggedOut: [] };
const SESSION = { isLoggedIn: () => true, accountName: "alice" };

window.__nav = [];
window.__asked = [];
window.__addressed = [];
let answer = { ok: true, message: "moved it", undo: null };
let hold = null;             // a promise the next instruction waits on

window.__answerWith = (a) => { answer = a; };
window.__holdNext = () => { let r; hold = new Promise((res) => { r = res; }); return (window.__release = r); };
window.__undone = 0;

const TARGETS = new Map();
const put = (t) => TARGETS.set(t.id, makeTarget(t));
put({ id: "workspace", label: "workspace", kind: "workspace",
      instruct: async (text) => record("workspace", text) });
put({ id: "dash-parts", label: "Parts inventory", kind: "presentation",
      instruct: async (text) => record("dash-parts", text) });
put({ id: "dash-orders", label: "Open orders", kind: "presentation",
      instruct: async (text) => record("dash-orders", text) });

async function record(id, text) {
  window.__asked.push({ id, text });
  if (hold) { const h = hold; hold = null; await h; }
  if (answer.undoable) {
    return { ...answer, undo: async () => { window.__undone += 1; return { ok: true, message: "put back" }; } };
  }
  return answer;
}

window.__drop = (id) => { TARGETS.delete(id); window.bar.refresh(); };

/* The chrome, drawn the way the App draws it. */
const layout = new LayoutView();
window.__workspace = defaultWorkspace({ page: "main" });

window.__draw = (document_) => {
  const ws = document_ ? arrangementOf(document_, { page: "main" }) : null;
  document.getElementById("app").innerHTML = layout.render({
    navLinks: NAV_LINKS, session: SESSION, content: "<p id='page-content'>hello</p>",
    sidebar: "", paneTabsBar: "", paneTabsDefault: "", workspace: ws,
  });
  const bar = document.querySelector("#location-bar");
  window.bar = mountLocationBar(bar, {
    navigate: (p) => { window.__nav.push(p); },
    targets: () => [...TARGETS.values()],
    instruct: ({ target, text }) => target.instruct(text),
    path: () => "/account/alice",
    onAddress: (t) => { window.__addressed.push(t ? t.id : null); },
  });
  return ws;
};

window.__draw(window.__workspace);
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
page.on("pageerror", (e) => { fail++; console.log("  FAIL page error: " + e.message
  + "\n" + String(e.stack || "").split("\n").slice(0, 6).join("\n")); });
await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.locator("#location-bar").waitFor({ timeout: 5000 });

const settle = (ms = 80) => page.waitForTimeout(ms);
const asked = () => page.evaluate(() => window.__asked);
const nav = () => page.evaluate(() => window.__nav);
const clearAll = () => page.evaluate(() => { window.__asked = []; window.__nav = [];
                                             window.__addressed = []; });
const type = async (line) => {
  await page.click("#location-display");
  await page.fill("#location-input", line);
  await page.press("#location-input", "Enter");
  await settle();
};
const replyText = () => page.textContent("#location-reply");
const targetText = () => page.textContent("#location-target");

/* ══════════════ U-76: the bar still does what it did ══════════════ */

console.log("\nU-76: the affordance is unchanged — click, type, Enter, Escape");
{
  ok(await page.isVisible("#location-display"), "the path is shown, not an input");
  ok(!(await page.isVisible("#location-input")), "the input is hidden until it is wanted");
  ok((await page.textContent("#location-display")) === "/account/alice",
     "and it shows where you are");

  await page.click("#location-display");
  ok(await page.isVisible("#location-input"), "clicking the path opens the input");
  ok(await page.evaluate(() => document.activeElement?.id) === "location-input",
     "with the caret already in it");
  await page.press("#location-input", "Escape");
  await settle();
  ok(!(await page.isVisible("#location-input")), "Escape closes it again");
  ok((await asked()).length === 0 && (await nav()).length === 0, "and does nothing");
}

console.log("\nU-76: a bare path navigates, with or without `goto'");
{
  await clearAll();
  await type("/account/alice/repositories/parts");
  ok((await nav())[0] === "/account/alice/repositories/parts", "a bare path navigates");
  ok((await asked()).length === 0, "and nothing is sent to a model");

  await clearAll();
  await type("goto /account/bob");
  ok((await nav())[0] === "/account/bob", "`goto <path>' navigates too");
  ok((await asked()).length === 0, "and still asks nothing");
}

console.log("\nU-77: an instruction with nothing addressed refuses rather than guessing");
{
  await clearAll();
  await type("put the table beside the filter");
  ok((await asked()).length === 0, "nothing was asked");
  ok(/nothing is addressed/.test(await replyText()),
     `and the bar says why: ${(await replyText()).trim()}`);
  ok(await page.evaluate(() =>
       document.querySelector("#location-reply").className.includes("location-err")),
     "marked as a refusal rather than as a result");
}

/* ══════════════ U-77: the address ══════════════ */

console.log("\nU-77: `goto <name>' re-addresses, and the bar says so before anything is typed");
{
  await clearAll();
  await type("goto workspace");
  ok((await nav()).length === 0, "it did not navigate");
  ok(await page.isVisible("#location-target"), "the target is on the screen");
  ok((await targetText()).includes("workspace (the arrangement)"),
     `and it names the arrangement: ${await targetText()}`);
  ok((await page.evaluate(() => window.__addressed)).join() === "workspace",
     "the host is told, so a pane can mark itself as the one being addressed");
  ok(/addressing workspace/.test(await replyText()), "and the reply confirms it");
}

console.log("\nU-77: the unprefaced line then goes there, verbatim");
{
  await clearAll();
  await type("move the location bar to the top");
  const a = await asked();
  ok(a.length === 1 && a[0].id === "workspace", "the instruction reached the workspace");
  ok(a[0].text === "move the location bar to the top",
     "with the sentence exactly as typed — no preface stripped, nothing added");
  ok((await nav()).length === 0, "and it did not navigate");
}

console.log("\nU-77: with several analyses open, the address is what decides");
{
  await clearAll();
  await type("goto Parts inventory");
  ok((await targetText()).includes("Parts inventory"), "a presentation can be addressed by name");
  await type("add a column for the supplier");
  let a = await asked();
  ok(a[a.length - 1].id === "dash-parts", "and the same sentence now goes there instead");

  await type("goto orders");
  await type("add a column for the supplier");
  a = await asked();
  ok(a[a.length - 1].id === "dash-orders",
     "re-addressing by a word inside the label moves it again — one verb, two scopes");
}

console.log("\nU-77: an ambiguous address refuses and leaves the address alone");
{
  await clearAll();
  await page.evaluate(() => { window.__before = window.bar.address().id; });
  await type("goto a");
  ok(/names more than one/.test(await replyText()),
     `the refusal says it is ambiguous: ${(await replyText()).trim()}`);
  ok(await page.evaluate(() => window.bar.address().id === window.__before),
     "and the address is still what it was — a guess here would misdirect the NEXT line");
}

console.log("\nU-77: an address does not outlive its target");
{
  await clearAll();
  await page.evaluate(() => window.bar.setAddress("dash-parts"));
  ok((await targetText()).includes("Parts inventory"), "a pane can take the address when clicked");
  await page.evaluate(() => window.__drop("dash-parts"));
  await settle();
  ok(await page.evaluate(() => window.bar.address() === null),
     "and closing it drops the address rather than leaving it pointing at a closed pane");
  ok((await page.evaluate(() => window.__addressed)).includes(null),
     "the host is told that too");
  ok(!(await page.isVisible("#location-target")), "the bar stops naming a target it does not have");
}

/* ══════════════ U-78: what the bar says back ══════════════ */

console.log("\nU-78: the reply is the only trace a presentational change leaves");
{
  await clearAll();
  await page.evaluate(() => window.__answerWith({ ok: true, message: "set-layout — saved" }));
  await page.evaluate(() => window.bar.setAddress("workspace"));
  await type("put the bar at the top");
  ok(await page.isVisible("#location-reply"), "there is a reply");
  ok(/set-layout — saved/.test(await replyText()), `carrying what changed: ${(await replyText()).trim()}`);
  ok(!(await page.isVisible('[data-testid="location-undo"]')),
     "with no undo, because this answer carried none");
}

console.log("\nU-78: an undo beside the reply, and it is the caller's revert");
{
  await clearAll();
  await page.evaluate(() => window.__answerWith({ ok: true, message: "moved it", undoable: true }));
  await type("put the bar at the top");
  ok(await page.isVisible('[data-testid="location-undo"]'), "the undo is offered");
  await page.click('[data-testid="location-undo"]');
  await settle();
  ok(await page.evaluate(() => window.__undone) === 1, "pressing it calls the revert");
  ok(/put back/.test(await replyText()), `and the line says what happened: ${(await replyText()).trim()}`);
  ok(!(await page.isVisible('[data-testid="location-undo"]')),
     "the undo does not offer itself again — a second press would redo, not undo");
}

console.log("\nU-78: a refusal reads as one");
{
  await clearAll();
  await page.evaluate(() => window.__answerWith({ ok: false, message: "refused whole: no such element" }));
  await type("remove the footer");
  ok(/refused whole/.test(await replyText()), "the refusal is shown");
  ok(await page.evaluate(() =>
       document.querySelector("#location-reply").className.includes("location-err")),
     "and marked, so it does not read as a result");
}

console.log("\nU-78: one instruction at a time");
{
  await clearAll();
  await page.evaluate(() => window.__answerWith({ ok: true, message: "done" }));
  const release = await page.evaluateHandle(() => window.__holdNext());
  await page.click("#location-display");
  await page.fill("#location-input", "first change");
  await page.press("#location-input", "Enter");
  await settle(60);
  ok(await page.evaluate(() => document.querySelector("#location-input").disabled),
     "the input is disabled while the turn runs");
  ok(/asking/.test(await replyText()), `and the bar says it is working: ${(await replyText()).trim()}`);

  // A second line cannot be typed, but a caller could still submit one.
  await page.evaluate(() => window.bar.submit("second change"));
  await settle(60);
  ok((await asked()).length === 1, "a second instruction is refused while the first is running");

  await release.evaluate((r) => r());
  await settle(120);
  ok(!(await page.evaluate(() => document.querySelector("#location-input").disabled)),
     "and the input comes back when the turn ends");
  ok(/done/.test(await replyText()), "with the answer in the line");
}

console.log("\nU-78: navigating clears the reply, because it is no longer about this page");
{
  await clearAll();
  await type("/account/alice");
  ok(!(await page.isVisible("#location-reply")), "the reply is gone");
  ok((await targetText()) !== "", "but the address is not — a navigation is not a re-addressing");
}

/* ══════════════ U-72: the chrome, arranged ══════════════ */

console.log("\nU-72: with no arrangement the chrome is exactly what it was");
{
  await page.evaluate(() => window.__draw(null));
  await settle();
  ok(await page.evaluate(() => !document.querySelector("#chrome")),
     "there is no grid wrapper");
  for (const id of ["#header-container", "#tabs-container", "#content-container",
                    "#location-bar", "#page-content"]) {
    ok(await page.evaluate((s) => !!document.querySelector(s), id), `${id} is where it was`);
  }
  ok(await page.evaluate(() => !!document.querySelector("#app > #header-container")),
     "and still a direct child of #app, which the stylesheet selects on");
}

console.log("\nU-72: with one, the bands are placed into a grid and keep their ids");
{
  await page.evaluate(() => window.__draw(window.__workspace));
  await settle();
  ok(await page.evaluate(() => !!document.querySelector("#chrome")), "there is a grid");
  ok(await page.evaluate(() =>
       getComputedStyle(document.querySelector("#chrome")).display === "grid"),
     "and the browser agrees it is one");
  for (const host of ["flashes", "header", "tabs", "content", "footer", "location"]) {
    ok(await page.evaluate((h) => !!document.querySelector(`#chrome > [data-host="${h}"]`), host),
       `the ${host} band is placed`);
  }
  ok(await page.evaluate(() =>
       document.querySelector('[data-host="header"]')?.getAttribute("data-ui") === "w-header"),
     "each band carries the element name a patch addresses");
  for (const id of ["#header-container", "#tabs-container", "#content-container",
                    "#location-bar", "#page-content"]) {
    ok(await page.evaluate((s) => !!document.querySelector(s), id),
       `${id} is still there, untouched inside its band`);
  }
}

console.log("\nU-72: the bar is in flow, or moving it would do nothing");
{
  ok(await page.evaluate(() =>
       getComputedStyle(document.querySelector("#location-bar")).position === "sticky"),
     "inside the chrome the bar is sticky rather than fixed");
  const before = await page.evaluate(() =>
    document.querySelector('[data-host="location"]').getBoundingClientRect().top);
  await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.__workspace));
    d.views[0].elements[0].layout.areas =
      ["location", "flashes", "header", "tabs", "content", "footer"];
    window.__draw(d);
  });
  await settle();
  const after = await page.evaluate(() =>
    document.querySelector('[data-host="location"]').getBoundingClientRect().top);
  ok(after < before, `moving it to the top MOVED it (${Math.round(before)} → ${Math.round(after)})`);
  ok(await page.evaluate(() =>
       document.querySelector('[data-host="header"]').getBoundingClientRect().top)
     > after, "and the header is now below it");
  ok(await page.evaluate(() => !!document.querySelector("#location-bar")),
     "the bar itself survived the move — the band moved, the bar was not rebuilt");
}

console.log("\nU-72: a host this build does not know, and a band the arrangement forgot");
{
  await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.__workspace));
    const root = d.views[0].elements[0];
    root.children = root.children.filter((c) => c.host !== "tabs");
    root.children.push({ name: "w-odd", kind: "host", host: "sidebar", order: "z",
                         placement: { area: "odd" } });
    root.layout.areas = ["flashes", "header", "odd", "content", "footer", "location"];
    window.__draw(d);
  });
  await settle();
  ok(await page.evaluate(() => !!document.querySelector('[data-host="sidebar"] .location-inert')),
     "an unregistered host renders as an inert box rather than as nothing");
  ok(await page.evaluate(() => document.querySelector('[data-host="sidebar"] .location-inert')
       ?.getAttribute("data-inert")?.includes("sidebar")),
     "with the reason on it");
  ok(await page.evaluate(() => !!document.querySelector('[data-host="tabs"][data-unplaced]')),
     "and a band the arrangement no longer mentions is still emitted, marked unplaced");
  ok(await page.evaluate(() => !!document.querySelector("#tabs-container")),
     "so a workspace saved before a band existed does not silently lose it");
}

console.log("\nU-72: the arrangement does not reach inside a band (D-AS)");
{
  await page.evaluate(() => window.__draw(window.__workspace));
  await settle();
  ok(await page.evaluate(() =>
       document.querySelectorAll("#chrome > [data-host] [data-ui]").length === 0),
     "no element inside a band carries an addressable name");
  ok(await page.evaluate(() =>
       document.querySelectorAll("#chrome > [data-ui]").length === 6),
     "the six bands are the whole of what a patch can address");
}


/* ══════════════ §35: watching an analysis, and stopping it ══════════════ */

console.log("\n§35: a turn that takes minutes can be watched and stopped");
{
  await clearAll();
  // The reply an unrun data question produces: stores named, nothing asked
  // yet, and one press.  The run itself is a promise this test holds open,
  // which is what a two-repository analysis is from the bar's point of view.
  await page.evaluate(() => {
    window.__ran = 0;
    window.__answerWith({
      ok: true,
      message: "james/finto and james/fibo — under your credentials, nothing has run yet",
      detail: "Up to 26 rounds of tool calls, read-only, for this run.",
      confirm: {
        label: "Ask across 2",
        working: "asking james/finto, james/fibo…",
        run: (controls) => new Promise((resolve) => {
          window.__ran += 1;
          window.__progress = controls.progress;
          window.__stopped = controls.stopped;
          window.__finish = resolve;
        }),
      },
    });
  });
  await page.evaluate(() => window.bar.setAddress("workspace"));
  await type("compare the concepts in james/finto and james/fibo");

  ok((await replyText()).includes("nothing has run yet"),
     "the offer says the stores and that nothing has run");
  ok(await page.isVisible('[data-testid="location-confirm"]'),
     "and offers one press");
  ok((await page.textContent('[data-testid="location-confirm"]')) === "Ask across 2",
     "whose label says how many repositories it would reach");
  ok(await page.evaluate(() => window.__ran) === 0,
     "nothing ran before the press — the disclosure is not a formality");

  await page.click('[data-testid="location-confirm"]');
  await settle();
  ok(await page.evaluate(() => window.__ran) === 1, "the press runs it");
  ok((await replyText()).includes("asking james/finto"),
     "and the line says what it is doing");
  ok(await page.isVisible('[data-testid="location-stop"]'),
     "with a way out beside it, because this one may take minutes");

  await page.evaluate(() => window.__progress("james/finto · catalog… (round 2 of 26)"));
  await settle(20);
  ok((await replyText()).includes("james/finto · catalog"),
     "the run can say what it is doing without replacing the reply");
  ok(await page.isVisible('[data-testid="location-stop"]'),
     "and the stop survives the line changing under it");

  ok(await page.evaluate(() => window.__stopped()) === null,
     "nothing is stopped until it is pressed");
  await page.click('[data-testid="location-stop"]');
  await settle(20);
  ok(typeof (await page.evaluate(() => window.__stopped())) === "string",
     "the press is a flag the run reads, not an abort of the request in flight");
  ok((await replyText()).includes("stopping"),
     "the line says it is stopping, not that it has stopped");
  await page.evaluate(() => window.__progress("james/fibo · select…"));
  await settle(20);
  ok(!(await replyText()).includes("james/fibo"),
     "and a progress line that arrives after the press does not overwrite that");

  // The run comes back with what it had: a partial report, kept.
  await page.evaluate(() => window.__finish({
    ok: false, message: "stopped by the user — james/finto, james/fibo",
    detail: "Observed: james/finto declares 65 016 skos:Concept.\n\n— claude · recorded",
  }));
  await settle();
  ok((await replyText()).includes("stopped by the user"),
     "a stopped run reports as stopped, not as an answer");
  ok(await page.isVisible('[data-testid="location-more"]'),
     "and what it did manage to say is kept, folded");

  await page.click('[data-testid="location-more"]');
  await settle(20);
  ok((await page.textContent('[data-testid="location-detail"]')).includes("65 016"),
     "the fold opens onto the prose");
  ok(await page.isVisible('[data-testid="location-copy"]'),
     "which can be copied out, because the panel is gone at the next instruction");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
