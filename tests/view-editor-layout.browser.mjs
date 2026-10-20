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
   so the parts this file is about stand in for it. */
const HARNESS = `<!doctype html><meta charset="utf-8"><title>editors</title>
<link rel="stylesheet" href="/stylesheets/jsui-overrides.css" media="all">
<body>
<div id="app">
  <div id="header-container" style="height:60px"></div>
  <div id="tabs-container" style="height:30px"></div>
  <div id="content-container">
    <div id="repository-queries">
      <div class="repository-views-layout">
        <div class="query-catalog"><h2>Views</h2><div class="query-container"></div></div>
        <div class="view-editors">
          <div class="view-editors-head"></div>
          <div class="view-editors-container"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="footer" style="height:40px"></div>
</div>
<script type="module">
import { makeDragHandleOnly } from "/ui/components/drag-handle.js";
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
  }

  await browser.close();
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
