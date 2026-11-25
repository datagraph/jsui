/**
 * The two things about the editors column that only a real browser can answer:
 * whether the mouse works inside a panel, and whether the column uses the
 * window it is given.
 *
 * Both were reported from a live Firefox, and both are engine-specific in a
 * way a jsdom assertion would miss entirely.  The caret one in particular
 * PASSES in Chromium with the broken code, so this file drives Firefox first
 * and Chromium second and asserts the same thing of each: the behaviour is not
 * "works in the engine the author happened to use".
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { firefox, chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                ".html": "text/html", ".txt": "text/plain", ".json": "application/json" };

/* The panel as ui/pages/index.js builds it: a `.view-editor' wrapper holding
   the editor, whose own title bar carries `dialog-header' (js/sparql-editor.js
   names it that).  The editor itself is not loaded -- it needs a service --
   so the parts this file is about stand in for it.
 
   The pane around it is built by `regionMarkup' rather than written out here
   (U-115), because the thing being measured is now partly its doing: the two
   lists used to be children of one grid inside `.repository-views-layout',
   and they are now two REGIONS placed in one row of the pane's grid.  A
   harness that kept the old nesting would go on passing while the interface
   broke. */
const HARNESS = `<!doctype html><meta charset="utf-8"><title>editors</title>
<link rel="stylesheet" href="/stylesheets/jsui-overrides.css" media="all">
<body>
<div id="app">
  <div id="header-container" style="height:60px"></div>
  <div id="tabs-container" style="height:30px">
    <div class="pane-tabs-bar"><ul data-tab-list>
      <li><a href="#pane" data-tab-link data-location="" data-show-aside="false" data-body-class=""><span class="tab-label">repo</span></a></li>
    </ul></div>
  </div>
  <div id="content-container"><div class="repository-pane" id="pane"></div></div>
  <div id="footer" style="height:40px"></div>
</div>
<script type="module">
import { makeDragHandleOnly } from "/ui/components/drag-handle.js";
import { regionMarkup } from "/lib/app/regions.js";
import { resultsMarginTab } from "/ui/components/results-tab.js";
document.getElementById("pane").innerHTML = regionMarkup({ kind: "repository", parts: {
  metadata: '<div class="repository-sidebar">'
          + '<div class="repository-meta-tabs">'
          + '<button type="button" class="manage-tab active" data-tab="profile"></button>'
          + resultsMarginTab()
          + '</div>'
          + '<div class="repo-meta-field">props</div></div>',
  summary: '<div id="repository-detail"><div id="repository-summary"></div></div>',
  views: '<div id="repository-queries"><div class="block">'
       + '<div class="query-catalog"><h2>Views</h2><div class="query-container"></div></div>'
       + '</div></div>',
  editors: '<div class="view-editors"><div class="view-editors-head"><h2>Editors</h2></div>'
         + '<div class="view-editors-container"></div></div>',
} });

/* The results pane, as the interface builds it (U-120), beside the
   repository pane and hidden the way every pane but the front one is.  The
   app is a stub of exactly the four things the pane asks of it, so what is
   measured is the real wiring: the real markup, the real sheet, the real
   listeners on the real tab. */
import { resultsPaneMarkup, mountResultsPane } from "/ui/components/results-pane.js";
document.getElementById("content-container")
  .insertAdjacentHTML("beforeend", resultsPaneMarkup());
window.__runs = [];
window.__answer = null;
window.__activated = [];
window.__app = {
  root: document.getElementById("app"),
  state: {
    session: { accountName: "james" },
    listOpenAccounts: () => ["james"],
    getAuthContext: () => ({ host: "http://127.0.0.1:1/", token: "t" }),
  },
  registerTarget: (t) => { window.__target = t; return () => { window.__target = null; }; },
  activateTab: (sel) => {
    window.__activated.push(sel);
    for (const p of document.querySelectorAll("#content-container > div")) {
      p.style.display = "#" + p.id === sel ? "block" : "none";
    }
  },
  initializeMounts: () => { window.__mountsWired = (window.__mountsWired || 0) + 1; },
};
/* The store, stubbed: what U-119 is about is where the CREDENTIAL comes
   from, not what the store answers, so the run is a function the harness
   supplies exactly as the repository pane supplies one built on runPanel
   and the account's own session. */
window.__sheet = mountResultsPane(window.__app, {
  run: async (asked) => {
    window.__runs.push(asked);
    return window.__answer || { ok: false, error: "nothing stubbed" };
  },
  /* The same lookup the interface makes, by the account the reading came
     from — the download's address is that account's host and not the pane's
     (U-123). */
  hostFor: (account) => window.__app.state.getAuthContext(account).host,
});
window.__app.activateTab("#pane");

const container = document.querySelector(".view-editors-container");
const wrapper = document.createElement("div");
wrapper.className = "view-editor";
wrapper.innerHTML = \`
  <div class="dialog-header" style="background:#eee;padding:6px">
    /acct/repo/census <button id="hdr-btn" type="button">x</button>
  </div>
  <div class="view-editor-body">
    <textarea id="ta" style="width:360px;height:100px">SELECT * WHERE { ?s ?p ?o }</textarea>
  </div>\`;
makeDragHandleOnly(wrapper);
container.appendChild(wrapper);
window.__dragged = false;
wrapper.addEventListener("dragstart", () => { window.__dragged = true; });
window.__ready = true;
</script>`;

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
  } catch { res.writeHead(404); res.end("not found: " + path); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

for (const [name, engine] of [["firefox", firefox], ["chromium", chromium]]) {
  const browser = await engine.launch();
  const page = await browser.newPage({ viewportSize: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => { fail++; console.log(`  FAIL page error: ${e.message}`); });
  await page.goto(`http://127.0.0.1:${port}/__harness`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });

  console.log(`\nthe mouse inside a panel — ${name}`);
  {
    const ta = page.locator("#ta");
    const box = await ta.boundingBox();
    await page.mouse.click(box.x + 60, box.y + 10);
    const at = await ta.evaluate((el) => el.selectionStart);
    ok(at > 0, `a click places the caret where it was clicked, not at 0 (got ${at})`);

    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 10, { steps: 8 });
    await page.mouse.up();
    const sel = await ta.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
    ok(sel.length > 0, `and a sweep selects text rather than starting a drag (got ${JSON.stringify(sel)})`);
    ok(await page.evaluate(() => window.__dragged) === false,
       "no drag was begun from inside the text");
  }

  console.log(`\nand the title bar still moves the panel — ${name}`);
  {
    const hb = await page.locator(".dialog-header").boundingBox();
    await page.mouse.move(hb.x + 30, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 30, hb.y + 200, { steps: 12 });
    ok(await page.evaluate(() => window.__dragged) === true,
       "a gesture that begins on the header is a drag");
    await page.mouse.up();
    ok(await page.evaluate(() => document.querySelector(".view-editor").draggable) === false,
       "and the panel is inert again as soon as it ends -- it is not left draggable");
  }

  console.log(`\nthe column follows the window — ${name}`);
  {
    const read = () => page.evaluate(() => ({
      editors: document.querySelector(".view-editors-container").getBoundingClientRect().height,
      catalog: document.querySelector(".query-container").getBoundingClientRect().height,
      content: document.querySelector("#content-container").getBoundingClientRect().height,
      window: window.innerHeight,
    }));
    const short = await read();
    await page.setViewportSize({ width: 1200, height: 1400 });
    const tall = await read();
    ok(tall.editors > short.editors,
       `a taller window makes the editors column taller (${short.editors} → ${tall.editors})`);
    ok(tall.catalog === tall.editors && short.catalog === short.editors,
       "and the views list grows with it, so the two still close on the same line");
    ok(tall.content >= tall.window - 130,
       `the content fills what the chrome leaves (${tall.content} of ${tall.window})`);

    await page.setViewportSize({ width: 1200, height: 600 });
    const squeezed = await read();
    ok(squeezed.editors === 420,
       `and 420px is a floor, not a target, on a short window (got ${squeezed.editors})`);
    await page.setViewportSize({ width: 1200, height: 1400 });
  }

  console.log(`\nand the regions are where the arrangement put them — ${name}`);
  {
    const box = (sel) => page.evaluate((s) =>
      JSON.parse(JSON.stringify(document.querySelector(s).getBoundingClientRect())), sel);
    const views = await box('[data-region="repository:views"]');
    const editors = await box('[data-region="repository:editors"]');
    const metadata = await box('[data-region="repository:metadata"]');
    const summary = await box('[data-region="repository:summary"]');
    ok(Math.abs(views.top - editors.top) < 2,
       `the view list and the editors open on the same line (${views.top} vs ${editors.top})`);
    ok(views.right <= editors.left + 2,
       "with the list to the left of the editors, as the template says");
    ok(metadata.right <= views.left + 2,
       "the properties column to the left of both");
    ok(summary.bottom <= views.top + 2 && summary.width > views.width,
       "and the summary across the top of the working surface");
    const tip = await page.getAttribute('[data-region="repository:views"]', "title");
    ok(/r-repository-views/.test(tip || "") && /repository:views/.test(tip || ""),
       `each region says its own name on hover: ${JSON.stringify((tip || "").split("\n")[0])}`);
  }

  /* U-120.  The drag has existed since before the first commit; where it
     LANDS has now been wrong twice, and both wrongs are asserted here rather
     than described.  The sheet was first a sidebar panel mounted on first
     use, so there was nothing in the document to drag to and, once there
     was, it had no layout box.  Then it was a band across the repository
     pane, which fixed the box and kept two untruths: that what a reader
     keeps belongs to one repository, and that it is read beside that
     repository's view list.  It is a pane of its own, and because only one
     pane is displayed at a time the TAB is what takes the drop — the tab in
     the strip of margin icons down the left of the pane being dragged in,
     not one in the bar of open panes across the top, which was the third
     wrong and is asserted here too.

     The DataTransfer is constructed rather than produced by a mouse gesture,
     because the result tabs that would produce one live in a 2700-line
     editor that needs a service to draw anything -- so what is asserted is
     the listener wiring, the default that must be prevented, and what is
     drawn, all of which are the parts that were missing. */
  console.log(`\nU-120: a result dropped on the Results tab is kept in the results pane — ${name}`);
  {
    const PAYLOAD = {
      type: "result-sheet", viewName: "census", accountName: "james",
      repositoryName: "ns223", tabId: "tab-1", key: "view:james/ns223/census",
      tab: { id: "tab-1", query: "SELECT * WHERE { ?s ?p ?o }", executionTime: 42,
             etag: 'W/"7"', urlArguments: "", createdAt: "2026-11-23T10:00:00.000Z",
             results: { head: { vars: ["s", "n"] }, results: { bindings: [
               { s: { type: "uri", value: "http://example.org/a" },
                 n: { type: "literal", value: "3" } }] } } },
    };
    const empty = await page.textContent(".rs-sheet");
    ok(/drag a result tab/i.test(empty) && /left margin/.test(empty),
       "the sheet begins by saying what it is for and where the drag goes");

    ok(await page.evaluate(() =>
         document.querySelector('[data-region="repository:results"]') === null
         && document.querySelector("#pane .rs-sheet") === null),
       "the repository pane has no results region and no sheet in it: what is "
       + "kept did not all come from one repository");

    /* The reason the tab has to be the target, measured rather than argued:
       while the editor is in front the pane behind it is `display:none', and
       an element with no layout box receives no drop however carefully the
       drag is aimed -- which is the whole of the first defect. */
    ok(await page.evaluate(() =>
         document.querySelector('[data-tab-link][href="#tab-results"]') === null
         && document.querySelector('#pane .repository-meta-tabs [data-results-tab]') !== null),
       "the tab is in the pane's own left margin, with the other things a pane "
       + "can be asked to show, and not in the bar of open panes above");

    const shut = await page.evaluate(() => {
      const sheet = document.querySelector(".rs-sheet");
      const tab = document.querySelector('#pane [data-results-tab]');
      return { sheetBoxes: sheet.getClientRects().length,
               tabBoxes: tab.getClientRects().length };
    });
    ok(shut.sheetBoxes === 0,
       "with the editors in front the sheet has no layout box at all, so it "
       + "cannot be the drop target");
    ok(shut.tabBoxes > 0,
       "while the tab in the left margin always has one — which is why the tab "
       + "takes the drop, and why this interface had it that way before");

    const landed = await page.evaluate((payload) => {
      const tab = document.querySelector('#pane [data-results-tab]');
      const dt = new DataTransfer();
      dt.setData("application/json", JSON.stringify(payload));
      const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
      tab.dispatchEvent(over);
      const lit = tab.classList.contains("drag-active");
      const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      tab.dispatchEvent(drop);
      return { prevented: over.defaultPrevented, lit,
               stillLit: tab.classList.contains("drag-active"),
               count: window.__sheet.count(),
               badge: tab.querySelector('[data-testid="results-tab-count"]')?.textContent,
               shown: document.getElementById("tab-results").style.display,
               hidden: document.getElementById("pane").style.display,
               open: document.querySelector('#tab-results [data-results-tab]')
                 .classList.contains("open"),
               claimed: document.querySelectorAll("[data-tab-link].active").length };
    }, PAYLOAD);
    ok(landed.prevented && landed.lit,
       "the tab claims the drag and lights up, without which the engine never "
       + "offers a drop");
    ok(landed.count === 1, `the reading is kept (${landed.count})`);
    ok(landed.badge === "1",
       `and the count is on the tab, where the reader is looking (${JSON.stringify(landed.badge)})`);
    ok(!landed.stillLit, "the highlight goes out when the drag ends");
    ok(landed.shown === "block" && landed.hidden === "none",
       "and the pane is brought forward: a drop on a destination is a reader "
       + "asking to see it there");
    ok(landed.open,
       "the station's own margin carries the same tab, marked open — the pane "
       + "whose margin was pressed is hidden now, and with it the tab pressed, "
       + "so without this one there is no way back and no `you are here'");
    ok(landed.claimed === 0,
       "and nothing in the bar above claims to be active, because nothing up "
       + "there is this pane");

    /* Now that it is in front: the width the band could not give it. */
    const open = await page.evaluate(() => {
      const r = document.querySelector(".rs-sheet").getBoundingClientRect();
      const content = document.getElementById("content-container").getBoundingClientRect();
      const readings = document.querySelector('[data-region="results:readings"]').getBoundingClientRect();
      const mounts = document.querySelector('[data-region="results:presentations"]').getBoundingClientRect();
      return { width: r.width, boxes: document.querySelector(".rs-sheet").getClientRects().length,
               content: content.width,
               stacked: mounts.top >= readings.bottom - 2,
               full: Math.abs(readings.width - mounts.width) < 2 };
    });
    ok(open.boxes > 0 && open.width > open.content * 0.9,
       `the sheet is the width of the window (${Math.round(open.width)} of `
       + `${Math.round(open.content)}), which a 260px sidebar and a pane column were not`);
    ok(open.stacked && open.full,
       "with the readings above the presentations, each the full width: both were "
       + "composed for a window and not for a margin");

    const outcome = await page.evaluate((payload) => {
      const sheet = document.querySelector(".rs-sheet");
      const dt = new DataTransfer();
      dt.setData("application/json", JSON.stringify(payload));
      const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
      sheet.dispatchEvent(over);
      const lit = sheet.classList.contains("drag-active");
      const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      sheet.dispatchEvent(drop);
      return { prevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, lit,
               count: window.__sheet.count(),
               text: sheet.textContent, html: sheet.innerHTML };
    }, PAYLOAD);

    ok(outcome.prevented,
       "`dragover' prevents the default, without which the engine never offers a drop");
    ok(outcome.lit, "and the sheet lights up while something is over it");
    ok(outcome.dropPrevented,
       "the drop prevents the default too — otherwise the browser navigates to "
       + "what was dropped, which here is a JSON document");
    ok(outcome.count === 1,
       `and the same reading dropped a second time is still one entry (${outcome.count}), `
       + `because a reading is identified by the tab it came from`);
    ok(/census/.test(outcome.text) && /ns223/.test(outcome.text),
       "the card names the view and the store it came from");
    ok(/23\/2026|2026/.test(outcome.text) && /42 ms/.test(outcome.text),
       "and when it was read, and how long it took");
    ok(outcome.html.includes("&lt;http://example.org/a&gt;"),
       "an IRI is drawn in angle brackets and as text, not as markup");

    const bad = await page.evaluate(() => {
      const sheet = document.querySelector(".rs-sheet");
      const dt = new DataTransfer();
      dt.setData("text/plain", "a file, probably");
      sheet.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return document.querySelector(".rs-status").textContent;
    });
    ok(/not a result/.test(bad),
       `something that is not a result says so rather than doing nothing: ${JSON.stringify(bad)}`);

    /* U-119.  The saved page must ask its reader for a credential because it
       travels; a sheet does not travel, so the credential a re-read needs is
       the account's, already in this session.  What is asserted here is that
       the press reaches a runner with the store and the query, and that the
       card then says what moved. */
    const unchanged = await page.evaluate(async () => {
      window.__answer = { ok: true, ms: 11, revision: 'W/"8"', results: {
        head: { vars: ["s", "n"] }, results: { bindings: [
          { s: { type: "uri", value: "http://example.org/a" },
            n: { type: "literal", value: "3" } }] } } };
      document.querySelector("[data-rs-run]").click();
      await new Promise((r) => setTimeout(r, 50));
      return { asked: window.__runs[window.__runs.length - 1],
               verdict: document.querySelector("[data-rs-verdict]")?.getAttribute("data-rs-verdict"),
               text: document.querySelector(".rs-sheet").textContent };
    });
    ok(unchanged.asked && unchanged.asked.account === "james"
       && unchanged.asked.repository === "ns223"
       && /SELECT \* WHERE/.test(unchanged.asked.query),
       "the press reaches the runner with the store the reading came from and the "
       + "query that produced it");
    ok(unchanged.verdict === "unchanged",
       `and the card says what it found: ${unchanged.verdict}`);
    ok(/unchanged since/.test(unchanged.text),
       "in words, against the moment the reading was taken");
    ok(/revision W\/"8"/.test(unchanged.text),
       "with the revision THIS reading was of");

    const moved = await page.evaluate(async () => {
      window.__answer = { ok: true, ms: 9, revision: 'W/"9"', results: {
        head: { vars: ["s", "n"] }, results: { bindings: [
          { s: { type: "uri", value: "http://example.org/a" },
            n: { type: "literal", value: "3" } },
          { s: { type: "uri", value: "http://example.org/b" },
            n: { type: "literal", value: "4" } }] } } };
      document.querySelector("[data-rs-run]").click();
      await new Promise((r) => setTimeout(r, 50));
      return { verdict: document.querySelector("[data-rs-verdict]")?.getAttribute("data-rs-verdict"),
               text: document.querySelector(".rs-sheet").textContent };
    });
    ok(moved.verdict === "moved" && /1 row → 2/.test(moved.text),
       `a result that grew is reported as moved, with both counts: ${moved.verdict}`);

    const refused = await page.evaluate(async () => {
      window.__answer = { ok: false, error: "the store refused" };
      document.querySelector("[data-rs-run]").click();
      await new Promise((r) => setTimeout(r, 50));
      return { status: document.querySelector(".rs-status").textContent,
               verdict: document.querySelector("[data-rs-verdict]")?.getAttribute("data-rs-verdict") };
    });
    ok(/could not be read again: the store refused/.test(refused.status),
       `a run that failed says so and changes nothing: ${JSON.stringify(refused.status)}`);
    ok(refused.verdict === "moved",
       "the card still shows the last reading that actually happened");

    const after = await page.evaluate(() => {
      document.querySelector("[data-rs-remove]").click();
      return { count: window.__sheet.count(), text: document.querySelector(".rs-sheet").textContent };
    });
    ok(after.count === 0 && /drag a result tab/i.test(after.text),
       "and one can be taken out again, back to the sentence");

    /* U-120/U-118: the pane is a DESTINATION, which is the half of the
       request that a drag does not answer.  A composed presentation is moved
       here by naming it, and the name is resolved against the account's own
       catalogue before anything is drawn. */
    const addressed = await page.evaluate(() => ({
      id: window.__target?.id,
      arranges: typeof window.__target?.arrange === "function",
    }));
    ok(addressed.id === "results" && addressed.arranges,
       "the pane registers itself as `results', so `… in results#' resolves to it");

    const noLift = await page.evaluate(() => window.__target.arrange({ verb: "lift" }));
    ok(noLift.ok === false && /results-pane/.test(noLift.message)
       && /r-results-readings/.test(noLift.message),
       `a verb it cannot answer says where that verb goes instead: `
       + `${JSON.stringify((noLift.message || "").slice(0, 60))}…`);

    const brought = await page.evaluate(async () => {
      const listing = { results: { bindings: [
        { presentation: { value: "urn:p:stats-matrix" }, name: { value: "stats-matrix" },
          title: { value: "Statistics" }, scope: { value: "document" } }] } };
      window.fetch = async () => new Response(JSON.stringify(listing),
        { status: 200, headers: { "Content-Type": "application/sparql-results+json" } });
      const out = await window.__target.arrange({ verb: "mount", presentation: "stats-matrix" });
      const band = document.querySelector('[data-ui-mount="stats-matrix"]');
      const missed = await window.__target.arrange({ verb: "mount", presentation: "stats-matrices" });
      return { ok: out.ok, message: out.message,
               band: Boolean(band),
               drawn: band ? band.hasAttribute("data-ui-expanded") : null,
               press: Boolean(band?.querySelector('[data-testid="mount-expand"]')),
               empty: Boolean(document.querySelector('[data-testid="results-mounts-empty"]')),
               refusal: missed.message };
    });
    ok(brought.ok && brought.band,
       `a presentation named as this destination is put here: ${brought.message}`);
    ok(brought.drawn === false && brought.press,
       "by reference and not drawn — a band is a name and a press, and nothing "
       + "in a page can press it for the reader (§21.4.3)");
    ok(!brought.empty, "and the sentence that stood for nothing is gone");
    ok(/stats-matrix/.test(brought.refusal || ""),
       `a name the catalogue does not hold comes back with the names it may have `
       + `meant: ${JSON.stringify(brought.refusal)}`);

    /* U-121.  The reading keeps the tab it came out of, and the tab is what
       folds it away.  Driven here as well as in node because what is being
       claimed is that the BODY stops taking room: a `hidden' attribute that
       some rule overrode would pass every assertion a string can make. */
    const folded = await page.evaluate((payload) => {
      window.__sheet.add(payload);
      const card = document.querySelector(".rs-entry");
      const tab = card.querySelector(".rs-tab");
      const body = card.querySelector(".rs-body");
      const was = body.getBoundingClientRect().height;
      const label = tab.textContent;
      tab.click();
      const after = document.querySelector(".rs-entry");
      return { label, was,
               now: after.querySelector(".rs-body").getClientRects().length,
               said: after.querySelector(".rs-tab").getAttribute("aria-expanded"),
               head: after.querySelector(".rs-head").getClientRects().length,
               run: Boolean(after.querySelector("[data-rs-run]")),
               tall: after.getBoundingClientRect().height };
    }, PAYLOAD);
    ok(/\d/.test(folded.label) && folded.was > 0,
       `the card is fronted by the tab it came out of, bearing the time it ran `
       + `(${JSON.stringify(folded.label)})`);
    ok(folded.now === 0 && folded.said === "false",
       "and pressing it folds the reading away: the body has no layout box at all, "
       + "so the sheet below it closes up rather than keeping the room");
    ok(folded.head > 0 && folded.run,
       "the head stays — which view, and its Run — because a row of times with "
       + "nothing to tell them apart is not a sheet");

    const unfolded = await page.evaluate(() => {
      document.querySelector(".rs-tab").click();
      const card = document.querySelector(".rs-entry");
      return { boxes: card.querySelector(".rs-body").getClientRects().length,
               said: card.querySelector(".rs-tab").getAttribute("aria-expanded") };
    });
    ok(unfolded.boxes > 0 && unfolded.said === "true",
       "and pressing it again brings it back: the fold is a fold and not a removal");

    /* U-123.  The card a drop creates offers Download beside Run, and the
       press is the half only a browser can answer: that it reaches the
       builder, that the anchor is given a name and a type, and that the card
       is exactly as it was afterwards.  What is IN the file is judged in
       `results.test.mjs'. */
    const saved = await page.evaluate(async () => {
      const real = URL.createObjectURL;
      let suggested = null;
      window.__blob = null;
      URL.createObjectURL = (blob) => { window.__blob = blob; return real.call(URL, blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { suggested = this.download; };
      const runs = window.__runs.length;
      const card = document.querySelector(".rs-entry");
      card.querySelector("[data-rs-download]").click();
      for (let i = 0; i < 100 && !window.__blob; i += 1) await new Promise((r) => setTimeout(r, 10));
      URL.createObjectURL = real;
      HTMLAnchorElement.prototype.click = click;
      const text = window.__blob ? await window.__blob.text() : null;
      const after = document.querySelector(".rs-entry");
      return { text, suggested, type: window.__blob?.type || null, ran: window.__runs.length - runs,
               said: document.querySelector(".rs-status")?.textContent || "",
               bad: Boolean(document.querySelector(".rs-status")?.classList.contains("rs-error")),
               anchors: document.querySelectorAll("a[download]").length,
               body: after?.querySelector(".rs-body")?.getClientRects().length,
               same: after?.getAttribute("data-rs-key") };
    });
    ok(Boolean(saved.text) && saved.type === "text/html"
       && /^census-20261123T\d{6}\.html$/.test(saved.suggested || ""),
       `the press hands the browser one HTML file, named for the view and the `
       + `moment it was read (${JSON.stringify(saved.suggested)})`);
    ok(/id="saved-page-data"/.test(saved.text || "")
       && /id="saved-page-frame"/.test(saved.text || ""),
       "and it is the saved-page form U-111 settled — the file and the sandboxed "
       + "frame — and not a third kind of artifact");
    ok(saved.ran === 0,
       "nothing was run to write it: a reading is already in hand, which is why "
       + "this press spends no grant and asks for no credential");
    ok(/saved as a page/.test(saved.said) && !saved.bad,
       `the sheet says what it wrote, and not in the colour it says failures in: `
       + `${JSON.stringify(saved.said.slice(0, 60))}…`);
    ok(saved.anchors === 0 && saved.body > 0 && saved.same === "view:james/ns223/census#tab-1",
       "and the sheet is as it was: the anchor is taken out again, and the card is "
       + "neither folded, re-read nor removed by being kept");

    await page.evaluate(() => { window.__sheet.clear(); });

    /* The way back, which is the cost of not being in the bar above: pressing
       the tab in the station's own margin returns to the pane it covered, and
       returns through `activateTab' so the body class, the aside and the
       active mark up there come back with it. */
    const back = await page.evaluate(() => {
      window.__activated.length = 0;
      document.querySelector('#tab-results [data-results-tab]').click();
      return { activated: window.__activated.slice(),
               results: document.getElementById("tab-results").style.display,
               pane: document.getElementById("pane").style.display,
               open: document.querySelector('#pane [data-results-tab]').classList.contains("open") };
    });
    ok(back.activated[0] === "#pane" && back.results === "none" && back.pane === "block",
       `a second press puts back the pane it covered: ${JSON.stringify(back.activated)}`);
    ok(!back.open, "and the tab stops saying the station is in front");

    // And the repository pane goes back in front: the sections after this one
    // measure its regions, and a pane with no layout box measures as nothing.
    await page.evaluate(() => window.__app.activateTab("#pane"));
  }

  /* U-121.  Choosing a view from the repository's list scrolled the panel up
     and took its top off the screen with it.  `scrollIntoView' is what did
     that, and the bug is in the "every" of "scrolls every scrollable
     ancestor": the editors column, which was wanted, and then the PAGE, so
     that the column's top is dragged to the top of the window.  The header,
     the pane tabs and the repository's own lists go with it, and the panel's
     own title bar — the name and the controls — ends up above the column's
     visible top, because the editor sizes itself after the scroll was asked
     for and the smooth animation lands past where it aimed.

     Only a browser can answer this: both the clipping and the page scroll
     are layout. */
  console.log(`\nU-121: choosing a view brings its panel to the top of the COLUMN — ${name}`);
  {
    const geometry = await page.evaluate(async () => {
      const { bringPanelIntoView } = await import("/ui/components/panel-scroll.js");
      const column = document.querySelector(".view-editors-container");
      /* Four panels taller than the column, so there is something to scroll
         and something to scroll it wrongly. */
      for (let i = 0; i < 4; i += 1) {
        const p = document.createElement("div");
        p.className = "view-editor";
        p.dataset.n = String(i);
        p.innerHTML = `<div class="dialog-header" style="padding:6px">panel ${i}</div>`
                    + `<div style="height:400px"></div>`;
        column.appendChild(p);
      }
      window.scrollTo(0, 0);
      /* The second of the four: far enough down to need a scroll, and with
         enough below it that the column CAN put it at the top — the last
         panel clamps against the bottom, which is measured after this. */
      const target = column.querySelector('[data-n="1"]');
      const pageWas = window.scrollY;
      bringPanelIntoView(target);
      // the two frames it defers by, then the smooth scroll
      await new Promise((r) => setTimeout(r, 600));
      const colBox = column.getBoundingClientRect();
      const style = getComputedStyle(column);
      const contentTop = colBox.top + column.clientTop + parseFloat(style.paddingTop);
      const head = target.querySelector(".dialog-header").getBoundingClientRect();
      return { pageWas, pageNow: window.scrollY,
               scrolled: column.scrollTop,
               offBy: target.getBoundingClientRect().top - contentTop,
               headTop: head.top, headVisible: head.top >= colBox.top - 1,
               colTop: colBox.top, colBottom: colBox.bottom };
    });

    ok(geometry.scrolled > 0,
       `the column scrolled to reach a panel below the fold (${Math.round(geometry.scrolled)}px)`);
    ok(Math.abs(geometry.offBy) < 2,
       `and the panel's top is AT the column's content top, not past it `
       + `(off by ${geometry.offBy.toFixed(1)}px)`);
    ok(geometry.headVisible && geometry.headTop < geometry.colBottom,
       `so its title bar — the name and the controls — is inside the column's `
       + `visible box (${Math.round(geometry.headTop)} vs ${Math.round(geometry.colTop)}…`
       + `${Math.round(geometry.colBottom)})`);
    ok(geometry.pageNow === geometry.pageWas,
       `and the page did not move, so the header, the pane tabs and the `
       + `repository's own lists are where they were (scrollY ${geometry.pageWas} → `
       + `${geometry.pageNow})`);

    /* The last panel is the case the column cannot satisfy: there is nothing
       below it to scroll up into view, so the scroll clamps against the
       bottom.  What must still hold is the thing that was broken — the
       panel's title bar is in the visible box and not above it. */
    const clamped = await page.evaluate(async () => {
      const { bringPanelIntoView } = await import("/ui/components/panel-scroll.js");
      const column = document.querySelector(".view-editors-container");
      const target = column.querySelector('[data-n="3"]');
      const pageWas = window.scrollY;
      bringPanelIntoView(target);
      await new Promise((r) => setTimeout(r, 600));
      const colBox = column.getBoundingClientRect();
      const head = target.querySelector(".dialog-header").getBoundingClientRect();
      return { atBottom: column.scrollTop >= column.scrollHeight - column.clientHeight - 2,
               headVisible: head.top >= colBox.top - 1 && head.bottom <= colBox.bottom + 1,
               pageMoved: window.scrollY !== pageWas };
    });
    ok(clamped.atBottom && clamped.headVisible && !clamped.pageMoved,
       "and the last panel, which the column cannot lift to its top, clamps against "
       + "the bottom with its title bar still in view rather than scrolling the page "
       + "to make up the difference");

    await page.evaluate(() => {
      for (const p of document.querySelectorAll(".view-editor[data-n]")) p.remove();
      document.querySelector(".view-editors-container").scrollTop = 0;
    });
  }

  /* The whole point of naming them: one rewrite of the template, and the
     pane is a different pane.  Driven here rather than in node because the
     claim is about what the browser DRAWS -- a grid template that parses and
     places nothing would pass every assertion a string can make. */
  console.log(`\nand a rewritten template moves them — ${name}`);
  {
    const after = await page.evaluate(async () => {
      const { regionMarkup, regionArrangementOf, ensureRegionViews } =
        await import("/lib/app/regions.js");
      const { defaultWorkspace } = await import("/lib/app/workspace.js");
      const { applyPatch } = await import("/lib/app/patch.js");
      const out = applyPatch(ensureRegionViews(defaultWorkspace()), [
        { op: "set-layout", view: "repository-pane", element: "r-repository-pane",
          value: { columns: "1fr 1fr", rows: "auto auto",
                   areas: ["views editors", "metadata summary"] } },
      ]);
      if (!out.ok) return { error: (out.errors || []).join("; ") };
      const pane = document.getElementById("pane");
      const parts = {};
      for (const el of pane.querySelectorAll("[data-region]")) {
        parts[el.getAttribute("data-region-name")] = el.innerHTML;
      }
      pane.innerHTML = regionMarkup({
        kind: "repository", parts,
        arrangement: regionArrangementOf(out.document, { kind: "repository" }),
      });
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
      };
      return { views: box('[data-region="repository:views"]'),
               editors: box('[data-region="repository:editors"]'),
               metadata: box('[data-region="repository:metadata"]'),
               summary: box('[data-region="repository:summary"]') };
    });
    ok(!after.error, `the patch applied in the page: ${after.error || "accepted"}`);
    ok(after.views && after.views.top < after.metadata.top,
       "the two lists are now the top row and the properties are below them");
    ok(after.metadata && after.metadata.right <= after.summary.left + 2,
       "the properties sit beside the summary, where the template put them");
    ok(after.views && Math.abs(after.views.top - after.editors.top) < 2,
       "and the lists still open on the same line as each other");
  }

  /* A placed region the interface draws nothing for is meant to be a VISIBLE
     fault.  It was not: the reason went into `data-inert' and no rule ever
     read it, so the box was empty -- the silent failure the attribute was
     written to prevent, in the one place both the chrome and a pane use. */
  console.log(`\nand a region with nothing to draw says so — ${name}`);
  {
    const said = await page.evaluate(async () => {
      const { regionMarkup } = await import("/lib/app/regions.js");
      const pane = document.getElementById("pane");
      pane.innerHTML = regionMarkup({ kind: "repository", parts: {
        views: "<i>list</i>", editors: "<i>e</i>", metadata: "<i>m</i>",
      } });
      const box = pane.querySelector(".location-inert");
      const content = getComputedStyle(box, "::before").content;
      const height = box.getBoundingClientRect().height;
      const width = box.getBoundingClientRect().width;
      // The same box with nothing to say, for comparison: Firefox reports
      // `content' unresolved as `attr(data-inert)', so the only cross-engine
      // way to ask whether the reason is PAINTED is to take it away.
      box.removeAttribute("data-inert");
      return { content, height, width,
               silent: box.getBoundingClientRect().height };
    });
    ok(/draws nothing as|attr\(data-inert\)/.test(said.content),
       `the reason is read into the box: ${said.content}`);
    ok(said.height > said.silent,
       `and painted — the box is ${said.height} high with it and ${said.silent} without`);
  }

  await browser.close();
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
