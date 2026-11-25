/**
 * The downloaded copy, in a real browser (U-111).
 *
 * Everything this feature claims is a claim about a browser, so nothing here
 * can be asserted against a model of one.  That a file with no network draws
 * at all; that pressing Refresh reaches the service with the reader's own
 * token and redraws the page from what came back; that the page inside the
 * file still cannot reach the network itself, although the file around it
 * now can; and that the token is in neither the file nor the page.  Those are
 * policy outcomes, and the policy is only real in Chromium.
 *
 * The saved document is built by the library, in the browser, exactly as the
 * pane builds it -- and then served as a file of its own and opened, because
 * a saved page that was only ever examined as a string is a saved page nobody
 * has opened.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as playwright from "playwright";

/* Every claim here is a claim about a browser, so which browser is not a
   detail: the policy, the opaque origin and the srcdoc frame are implemented
   separately by each engine.  `BROWSER=firefox' runs the same file against
   Gecko -- which is what the people who reported the first failure were
   using. */
const ENGINE = process.env.BROWSER || "chromium";
const chromium = playwright[ENGINE];
if (!chromium) throw new Error(`no such browser: ${ENGINE}`);
console.log(`\n--- ${ENGINE} ---`);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

const PROPOSAL = {
  title: "Sales",
  panels: [
    { name: "sales", query: "SELECT ?region ?value WHERE { ?s :region ?region ; :value ?value }" },
  ],
  transforms: [
    { name: "total", inputs: ["sales"],
      body: "let n = 0; for (const r of inputs.sales.objects) n += Number(r.value) || 0; return n;" },
  ],
  assertions: [
    { id: "lead", inputs: ["sales"], text: "The north leads." },
  ],
  html: '<h1>Sales</h1><section data-bound="sales"></section>'
      + '<p data-derived="total"></p><p data-asserted="lead"></p>'
      + '<button id="ask" onclick="dashboard.refresh()">Refresh from inside</button>',
};

const SAVED = "?region\t?value\nNorth\t120\nSouth\t80\n";
const FRESH = "?region\t?value\nNorth\t140\nSouth\t80\nEast\t15\n";

/* The harness only builds the file.  It is opened as its own document. */
const HARNESS = (origin) => `<!doctype html><meta charset="utf-8"><title>saved harness</title>
<body>
<script type="module">
import { buildSavedPage } from "/lib/dashboard/frame.js";
import { validateDashboard, withInputDigests } from "/lib/dashboard/spec.js";
import { contentDigest } from "/lib/mcp/result-digest.js";

const v = validateDashboard(${JSON.stringify(PROPOSAL)});
const saved = ${JSON.stringify(SAVED)};
const spec = withInputDigests(v.spec, { sales: { digest: contentDigest(saved) } });
window.__saved = buildSavedPage(spec, {
  results: { sales: { ok: true, mimeType: "text/tab-separated-values",
                      text: saved, digest: contentDigest(saved), rows: 2 } },
  at: "2026-11-21T09:00:00.000Z",
  source: { host: ${JSON.stringify(origin)}, account: "alice", repository: "sales" },
});
window.__ready = true;
</script>`;

let savedPage = "<!doctype html>not built";
const requests = [];

/*
 * The deploy race, in the one place it is real.
 *
 * `/stale-lib/' is the same library, except that the FIRST read of
 * `grant.js' there gets yesterday's copy -- the export `saved-runtime.js'
 * needs taken out of it -- and every read after that gets today's.  That is
 * exactly what a browser sees during a deploy: a module held in its cache
 * from before, a server that has already moved on.  The page's answer is a
 * second read under a URL the cache has never seen, and this is where that
 * claim can be checked, because only a browser has the cache.
 */
let grantReads = 0;
const STALE = (origin) => `<!doctype html><meta charset="utf-8"><title>stale harness</title>
<body>
<script type="module">
import { buildSavedPage, savedPageIsRefreshable, savedPageTrouble }
  from "/stale-lib/dashboard/frame.js";
import { validateDashboard, withInputDigests } from "/stale-lib/dashboard/spec.js";
import { contentDigest } from "/stale-lib/mcp/result-digest.js";

const v = validateDashboard(${JSON.stringify(PROPOSAL)});
const saved = ${JSON.stringify(SAVED)};
const spec = withInputDigests(v.spec, { sales: { digest: contentDigest(saved) } });
const results = { sales: { ok: true, mimeType: "text/tab-separated-values",
                           text: saved, digest: contentDigest(saved), rows: 2 } };
const source = { host: ${JSON.stringify(origin)}, account: "alice", repository: "sales" };
const build = () => buildSavedPage(spec, { results, source, at: "2026-11-22T09:00:00.000Z" });

window.__stale = { atLoad: savedPageIsRefreshable(), first: build() };
window.__stale.trouble = savedPageTrouble(window.__stale.first);
window.__repaired = async () => {
  for (let i = 0; i < 100 && !savedPageIsRefreshable(); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return { refreshable: savedPageIsRefreshable(), page: build() };
};
window.__ready = true;
</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS(`http://127.0.0.1:${port}`));
    return;
  }
  if (path === "/__stale") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(STALE(`http://127.0.0.1:${port}`));
    return;
  }
  if (path.startsWith("/stale-lib/")) {
    const name = path.slice("/stale-lib/".length);
    let text = await readFile(join(ROOT, "lib", name), "utf8");
    if (name === "llm/grant.js" && grantReads++ === 0) {
      text = text.replace(/export const QUERY_FORM_SOURCE[^;]*;/, "");
    }
    /* Cached as hard as a browser will cache it, which is the condition the
       repair has to work under. */
    res.writeHead(200, { "Content-Type": "text/javascript",
                         "Cache-Control": "public, max-age=3600" });
    res.end(text);
    return;
  }
  if (path === "/saved.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(savedPage);
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
    res.end(FRESH);
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

/* Build it. */
await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.waitForFunction(() => window.__ready === true);
savedPage = await page.evaluate(() => window.__saved);

console.log("\nthe file, before it is opened");
{
  ok(savedPage.includes('id="saved-page-data"'), "the data travels in the file");
  ok(savedPage.includes("SELECT ?region ?value"),
     "and so do the queries -- which is what makes a refresh possible at all");
  const blob = savedPage.split('id="saved-page-data">')[1].split("</script>")[0];
  ok(!/"token"|"password"|"authorization"/i.test(blob),
     "the data it carries has no field a credential could be in");
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(savedPage)[1]
    .replace(/&#39;/g, "'");
  ok(/connect-src http:\/\/127\.0\.0\.1:\d+;/.test(csp),
     `the file may connect to the panels' own host and nothing else: "${csp.match(/connect-src[^;]*/)[0]}"`);
  ok(/default-src 'none'/.test(csp) && /form-action 'none'/.test(csp),
     "everything else is still closed");
}

/* Open it. */
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/saved.html`);
const inside = async () => (await page.locator("#saved-page-frame").elementHandle()).contentFrame();

console.log("\nit draws with no network at all");
{
  const frame = await inside();
  await frame.waitForFunction(() => /North/.test(document.body.textContent), null, { timeout: 5000 });
  ok(/North/.test(await frame.evaluate(() => document.body.textContent)),
     "the rows the file was saved with are on the screen");
  ok(/200/.test(await frame.evaluate(() =>
       document.querySelector('[data-derived="total"]').textContent)),
     "the transform ran here, over the saved rows");
  ok(requests.length === 0, "and nothing was fetched to do it");
  ok(/holds the data as of 2026-11-21T09:00/.test(
       await page.locator("#saved-page-bar").textContent()),
     "the bar says what the copy holds, and as of when");
}

console.log("\nthe page inside is still the page: it reaches nothing");
{
  const frame = await inside();
  const sandbox = await page.locator("#saved-page-frame").getAttribute("sandbox");
  ok(sandbox === "allow-scripts" && !/allow-same-origin/.test(sandbox),
     "scripts yes, same-origin never");
  ok(await page.evaluate(() =>
       document.querySelector("#saved-page-frame").contentDocument === null),
     "the file cannot be read from the page, so the token cannot be either");
  const reached = await frame.evaluate(async (u) => {
    try { await fetch(u); return "reached"; } catch (e) { return "blocked"; }
  }, `http://127.0.0.1:${port}/alice/sales/sparql`);
  ok(reached === "blocked",
     "and the page cannot fetch, although the file around it now can -- "
   + "`connect-src 'none'' is the intersection of the two policies");
  ok(requests.length === 0, "nothing reached the service from in there");
  /* That probe is itself a policy violation, and a deliberate one: the
     report at the end is about violations nobody asked for. */
  errors.length = 0;
}

console.log("\nrefresh: the queries run again, under the reader's own token");
{
  await page.locator('[data-testid="saved-refresh"]').click();
  ok(await page.locator('[data-testid="saved-token"]').isVisible(),
     "pressing Refresh asks for a credential rather than assuming one");
  ok(await page.locator('[data-testid="saved-token"]').getAttribute("type") === "password",
     "which is not typed in the clear");
  ok(/alice\/sales at http:\/\/127\.0\.0\.1/.test(await page.locator(".saved-note").textContent()),
     "the address is the one the file records, shown and not asked for -- the reader "
   + "supplies the one thing the file could not carry");
  ok(await page.locator('[data-testid="saved-host"]').count() === 0,
     "and is not editable: the policy pins the origin, and a page redrawn from somewhere "
   + "else would carry a provenance mark that had stopped being true of it");

  await page.locator('[data-testid="saved-token"]').fill("secret-token");
  await page.locator('[data-testid="saved-connect"]').click();

  const frame = await inside();
  await frame.waitForFunction(() => /East/.test(document.body.textContent), null, { timeout: 5000 });
  ok(requests.length === 1, "one request, for the one panel");
  ok(requests[0].authorization === "Bearer secret-token",
     "carrying the reader's token as a bearer credential");
  ok(requests[0].body.includes("SELECT ?region ?value"),
     "and the panel's own query text, unedited");
  ok(/East/.test(await frame.evaluate(() => document.body.textContent)),
     "the page redrew from what the store holds now");
  ok(/235/.test(await frame.evaluate(() =>
       document.querySelector('[data-derived="total"]').textContent)),
     "the transform re-ran over the new rows, so a derived value is current too");
  ok(/was not rewritten/.test(await frame.evaluate(() =>
       document.querySelector('[data-asserted="lead"]').textContent)),
     "and the passage written against the old numbers is marked, not quietly re-stated");
  ok(/passage\(s\) were written against data that has since changed/
       .test(await page.locator("#saved-page-bar").textContent()),
     "which the bar says as well");
  ok(await page.evaluate(() => !/secret-token/.test(document.documentElement.outerHTML)),
     "the token is in no part of the document");
}

console.log("\nthe page's own Refresh control works, which it never did");
{
  const frame = await inside();
  await frame.evaluate(() => document.getElementById("ask").click());
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 400));
  ok(requests.length === 2,
     "`dashboard.refresh()' from inside the page reaches the file -- in the single-document "
   + "copy it posted to nobody and did nothing at all");
}

console.log("\na module stale in the cache costs a reload, not the Refresh");
{
  const stale = await page.goto(`http://127.0.0.1:${port}/__stale`)
    .then(() => page.waitForFunction(() => window.__ready === true))
    .then(() => page.evaluate(() => window.__stale));
  ok(stale.atLoad === false,
     "a page built against a cached `grant.js' knows, at load, that it cannot put a "
   + "Refresh in a download");
  ok(!stale.first.includes('id="saved-page-data"'),
     "and a download taken at that moment is the copy that replays");
  ok(/needs a newer grant\.js/.test(stale.trouble || ""),
     `which says so, in itself, naming the module: "${(stale.trouble || "").slice(0, 60)}…"`);

  const after = await page.evaluate(() => window.__repaired());
  ok(after.refreshable === true,
     "meanwhile the page has read that module again under a URL the cache has never seen, "
   + "and has the bundle the first read did not give it");
  ok(after.page.includes('id="saved-page-data"') && /function stripComments/.test(after.page),
     "so the next download is the refreshable copy, carrying the module's own source -- "
   + "no reload, no lost Refresh");
  ok(grantReads === 2, "at the cost of one extra read of one module");
}

ok(errors.filter((e) => /Content Security Policy/i.test(e)).length === 0,
   `nothing was blocked by the policy that should not have been: ${errors.slice(0, 2).join(" | ")}`);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
