/**
 * The downloaded figure, in a real browser (U-113).
 *
 * A saved figure used to be a photograph with a provenance strip under it:
 * correct, complete, and unable to answer the one question anybody asks of a
 * six-month-old chart -- is this still what the data looks like?  It now
 * carries its own query and the digest of the document it was drawn from, so
 * the file can answer that itself, under the reader's own credentials.
 *
 * The claims are all claims about a browser, and two of them pull in opposite
 * directions, which is why they are both here:
 *
 *   - the file now has a script, a policy and a connection it may make;
 *   - and it still draws with JavaScript turned off entirely, because the
 *     picture is a `srcdoc' attribute written by the build and not by that
 *     script.
 *
 * The second is the one a feature like this quietly loses.  So it is asserted
 * in a context with JavaScript switched off at the browser, not simulated.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as playwright from "playwright";

const ENGINE = process.env.BROWSER || "chromium";
const chromium = playwright[ENGINE];
if (!chromium) throw new Error(`no such browser: ${ENGINE}`);
console.log(`\n--- ${ENGINE} ---`);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const SVG = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">`
          + `<rect width="400" height="300" fill="#eef5ff"/>`
          + `<rect id="north" x="40" y="60" width="90" height="200" fill="#1f4e79"/>`
          + `<text x="40" y="285" font-size="14">North &amp; "South"</text></svg>`;
const QUERY = "SELECT ?region ?value WHERE { ?s :region ?region ; :value ?value }";
const SAVED = "?region\t?value\nNorth\t120\nSouth\t80\n";
const FRESH = "?region\t?value\nNorth\t140\nSouth\t80\nEast\t15\n";

/* The harness only builds the file; it is then opened as its own document,
   because a saved figure that was only ever examined as a string is a saved
   figure nobody has opened. */
const HARNESS = (origin) => `<!doctype html><meta charset="utf-8"><title>figure harness</title>
<body>
<script type="module">
import { buildFigurePage, buildSavedFigure, savedFigureIsRefreshable }
  from "/lib/figure/frame.js";
import { contentDigest } from "/lib/mcp/result-digest.js";
import { aspectOf } from "/lib/figure/spec.js";

const svg = ${JSON.stringify(SVG)};
const saved = ${JSON.stringify(SAVED)};
const page = buildFigurePage({ kind: "svg", text: svg }, {
  caption: 'North leads, by "a lot" & then some', title: "Sales by region",
  meta: { query: ${JSON.stringify(QUERY)}, rows: 2,
          mimeType: "text/tab-separated-values", resultDigest: contentDigest(saved) },
  at: "2026-11-22T09:00:00.000Z",
});
window.__refreshable = savedFigureIsRefreshable();
window.__figure = page;
window.__saved = buildSavedFigure({
  page, title: "Sales by region", query: ${JSON.stringify(QUERY)},
  accept: "text/tab-separated-values", mimeType: "text/tab-separated-values",
  digest: contentDigest(saved), rows: 2, aspect: aspectOf(svg),
  source: { host: ${JSON.stringify(origin)}, account: "alice", repository: "sales" },
  at: "2026-11-22T09:00:00.000Z",
});
window.__ready = true;
</script>`;

let savedFile = "<!doctype html>not built";
let answer = SAVED;                      // what the store says this minute
const requests = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS(`http://127.0.0.1:${port}`));
    return;
  }
  if (path === "/figure.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(savedFile);
    return;
  }
  if (path === "/alice/sales/sparql") {
    const body = await new Promise((r) => {
      let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => r(b));
    });
    requests.push({ authorization: req.headers.authorization || null,
                    accept: req.headers.accept || null, body });
    res.writeHead(200, { "Content-Type": "text/tab-separated-values",
                         "Access-Control-Allow-Origin": "*" });
    res.end(answer);
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
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

/* Build it. */
await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.waitForFunction(() => window.__ready === true);
savedFile = await page.evaluate(() => window.__saved);
const figureDoc = await page.evaluate(() => window.__figure);

console.log("\nthe file, before it is opened");
{
  ok(await page.evaluate(() => window.__refreshable) === true,
     "this tree can build a figure that checks itself");
  ok(savedFile.includes("SELECT ?region ?value"),
     "the query travels in the file -- which is what makes a check possible at all");
  ok(savedFile.includes('"digest":'),
     "and so does the digest of the document the picture was drawn from");
  const blob = savedFile.split('id="saved-figure-data">')[1].split("</script>")[0];
  ok(!/"token"|"password"|"authorization"/i.test(blob),
     "what it carries has no field a credential could be in");
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(savedFile)[1]
    .replace(/&#39;/g, "'");
  ok(/connect-src http:\/\/127\.0\.0\.1:\d+;/.test(csp),
     `the file may connect to the figure's own host and nothing else: "${csp.match(/connect-src[^;]*/)[0]}"`);
  ok(/default-src 'none'/.test(csp) && /form-action 'none'/.test(csp) && !/unsafe-eval/.test(csp),
     "everything else is closed, and nothing here may compile anything");
}

console.log("\nit still draws with JavaScript turned off at the browser");
{
  const quiet = await browser.newContext({ javaScriptEnabled: false });
  const mute = await quiet.newPage();
  await mute.goto(`http://127.0.0.1:${port}/figure.html`);
  const frame = await (await mute.locator("#saved-figure-frame").elementHandle()).contentFrame();
  ok(await frame.locator("#north").count() === 1,
     "the picture is on the screen with no script of any kind -- it is a srcdoc attribute "
   + "written by the build, which is the property the one-document copy had and this one "
   + "was not going to be allowed to lose");
  ok(await frame.locator("figcaption").count() === 1,
     "with its caption, and the provenance strip under it");
  ok(await mute.locator("#saved-figure-bar").textContent() === "",
     "the bar is empty, because the check is the only part that needs a script");
  ok(requests.length === 0, "and nothing was fetched to draw any of it");
  await quiet.close();
}

/* Open it properly. */
await page.goto(`http://127.0.0.1:${port}/figure.html`);
const inside = async () =>
  (await page.locator("#saved-figure-frame").elementHandle()).contentFrame();

console.log("\nthe figure inside is still the figure: it runs nothing and reaches nothing");
{
  ok(await page.locator("#saved-figure-frame").getAttribute("sandbox") === "",
     "the frame carries every restriction there is, scripts included -- the same empty "
   + "sandbox the pane mounts it in");
  ok(await page.evaluate(() =>
       document.querySelector("#saved-figure-frame").contentDocument === null),
     "and is opaque to the file around it, so the token cannot reach it even by accident");
  const frame = await inside();
  ok(await frame.locator("#north").count() === 1, "the picture is there");
  ok(requests.length === 0, "and still nothing has been fetched");
  const bar = await page.locator("#saved-figure-bar").textContent();
  ok(/Drawn from data read 2026-11-22T09:00/.test(bar),
     "the bar says when the data it was drawn from was read");
  ok(/The drawing is fixed/.test(bar),
     "and that Refresh will not redraw it, before anyone presses it");
}

console.log("\nunchanged data: the picture is still a picture of it");
{
  answer = SAVED;
  await page.locator('[data-testid="saved-refresh"]').click();
  ok(await page.locator('[data-testid="saved-token"]').isVisible(),
     "pressing Refresh asks for a credential rather than assuming one");
  ok(await page.locator('[data-testid="saved-token"]').getAttribute("type") === "password",
     "which is not typed in the clear");
  ok(/alice\/sales at http:\/\/127\.0\.0\.1/.test(await page.locator(".saved-note").textContent()),
     "the address is the one the file records, shown and not asked for");

  await page.locator('[data-testid="saved-token"]').fill("secret-token");
  await page.locator('[data-testid="saved-connect"]').click();
  await page.waitForFunction(() =>
    /unchanged|has changed|not changed/.test(document.getElementById("saved-figure-bar").textContent),
    null, { timeout: 5000 });

  ok(requests.length === 1, "one request, for the one query");
  ok(requests[0].authorization === "Bearer secret-token",
     "carrying the reader's token as a bearer credential");
  ok(requests[0].body.includes("SELECT ?region ?value"),
     "and the query the figure was drawn from, unedited");
  const bar = await page.locator("#saved-figure-bar").textContent();
  ok(/The data has not changed since the figure was drawn/.test(bar),
     "the answer is the one somebody holding an old chart wants: it is still true");
  ok(await page.locator('[data-testid="saved-figure-mark"]').count() === 0
     || await page.locator('[data-testid="saved-figure-mark"]').isHidden(),
     "nothing is marked, because nothing has moved");
  ok(await page.locator('[data-testid="saved-now-table"]').count() === 0,
     "and no table of what it answers now, which would only repeat the picture");
}

console.log("\nchanged data: the figure is marked, and not redrawn");
{
  answer = FRESH;
  await page.locator('[data-testid="saved-refresh"]').click();
  await page.waitForSelector('[data-testid="saved-figure-mark"]', { timeout: 5000 });

  ok(requests.length === 2, "the query ran again, under the token already given");
  const mark = await page.locator('[data-testid="saved-figure-mark"]').textContent();
  ok(/The data has changed since this was drawn/.test(mark),
     "and the figure is marked, above itself, where a reader cannot miss it");
  ok(/digest/.test(mark) && /2026-11-22T09:00/.test(mark),
     "naming both digests and the moment the drawing is of");
  ok(/a picture cannot redraw itself without the model/.test(mark),
     "and saying plainly that this is not a new drawing -- there is no model in a saved "
   + "file, and a picture that silently became another picture would falsify the "
   + "provenance strip under it");

  const frame = await inside();
  ok(await frame.locator("#north").count() === 1
     && await frame.evaluate(() =>
          document.querySelector("#north").getAttribute("height")) === "200",
     "the drawing is untouched: the same bars, of the same data, as the strip under it says");

  ok(await page.locator('[data-testid="saved-now-table"]').count() === 1,
     "what the query answers NOW is on the page instead");
  const table = await page.locator('[data-testid="saved-now-table"]').textContent();
  ok(/East/.test(table) && /140/.test(table),
     "with the rows that moved, so the reader can see what changed without leaving the file");
  ok(/region/.test(table) && /value/.test(table), "under the query's own column names");

  ok(await page.evaluate(() => !/secret-token/.test(document.documentElement.outerHTML)),
     "and the token is in no part of the document");
}

console.log("\nand the two documents are the same figure");
{
  ok(savedFile.includes(figureDoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")),
     "the file carries the figure document byte for byte -- what was previewed and what "
   + "was saved cannot differ, which was the argument for one document and survives two");
}

ok(errors.filter((e) => /Content Security Policy/i.test(e)).length === 0,
   `nothing was blocked by the policy that should not have been: ${errors.slice(0, 2).join(" | ")}`);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
