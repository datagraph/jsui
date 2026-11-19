/**
 * Screenshots of the SHIPPED client, for the multi-repository analysis manual.
 *
 * `analysis-live.mjs' builds its own minimal page so that it can hold both
 * credentials outside the browser.  That page imports the real App, the real
 * location bar and the real analysis path -- the behaviour it records is the
 * shipped behaviour -- but it is not the shipped SCREEN: no sign-in, no
 * navigation, no sidebar, no pane tabs, and a hand-written page body.  A
 * manual illustrated from it would show a reader something they will never
 * see.
 *
 * This file loads `index.html' as served, signs in through the real form with
 * a token, and photographs the real chrome.  It stops at the disclosure: the
 * gate is the part a manual has to show, and pressing it would spend a model
 * run that doc/analysis-live/ already records.
 *
 * Run: node tests/manual-shots.mjs
 * Writes: doc/user-manual/multi-repository-analysis/*.png
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "doc", "user-manual", "multi-repository-analysis");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml",
                ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const HOST = "https://dydra.com";

function credential(envName, ...file) {
  if (process.env[envName]) return process.env[envName].trim();
  const path = join(homedir(), ...file);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  throw new Error(`no credential: set ${envName} or write ${path}`);
}
const TOKEN = credential("DYDRA_TOKEN", ".dydra", "dydra.com.token");
const redact = (s) => String(s).replace(new RegExp(TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "…");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);

  if (path.startsWith("/proxy/") || path === "/proxy") {
    const target = HOST + path.slice("/proxy".length) + (url.search || "");
    let body = ""; for await (const c of req) body += c;
    const headers = { Authorization: "Bearer " + TOKEN };
    for (const h of ["content-type", "accept"]) if (req.headers[h]) headers[h] = req.headers[h];
    try {
      const out = await fetch(target, { method: req.method, headers,
                                        body: req.method === "GET" ? undefined : body });
      const text = await out.text();
      console.log(`  ${out.status} ${req.method} ${path.slice("/proxy".length).slice(0, 70)}`);
      res.writeHead(out.status, {
        "Content-Type": out.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*" });
      res.end(text);
    } catch (e) {
      console.log("  proxy FAILED " + redact(e));
      res.writeHead(502, { "Access-Control-Allow-Origin": "*" }); res.end("{}");
    }
    return;
  }

  // index.html asks for /ui/stylesheets/... and /ui/images/...; the tree is one level up
  if (path.startsWith("/ui/")) path = path.slice(3);
  if (path === "/" || path === "") path = "/index.html";
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found: " + path); }
});

await mkdir(SHOTS, { recursive: true });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const PROXY = `http://127.0.0.1:${port}/proxy`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const notes = [];
let n = 0;
/**
 * A figure in a manual is read, not admired: a full 1280x860 page with the
 * bar as a 47-pixel strip at the bottom shows the reader everything except
 * the thing it is about.  `within' crops to the union of the elements named,
 * with a little air, and falls back to the whole viewport when none is there.
 */
const shot = async (name, note, within = null) => {
  n += 1;
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  let clip = null;
  if (within) {
    clip = await page.evaluate((sel) => {
      const boxes = sel.map((s) => document.querySelector(s))
                       .filter((e) => e && e.getBoundingClientRect().height > 0)
                       .map((e) => e.getBoundingClientRect());
      if (!boxes.length) return null;
      const pad = 10;
      const top = Math.max(0, Math.min(...boxes.map((b) => b.top)) - pad);
      const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - pad);
      const right = Math.min(window.innerWidth, Math.max(...boxes.map((b) => b.right)) + pad);
      const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((b) => b.bottom)) + pad);
      return { x: left, y: top, width: right - left, height: bottom - top };
    }, within);
  }
  await page.screenshot({ path: join(SHOTS, file), fullPage: false, ...(clip ? { clip } : {}) });
  notes.push({ file, note });
  console.log(`  shot ${String(n).padStart(2, "0")} ${name} — ${note}`);
};
const BAR = ["#location-detail", "#location-reply", "#location-bar"];
page.on("response", (r) => { if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${redact(r.url()).slice(0, 110)}`); });
page.on("pageerror", (e) => console.log("  PAGE ERROR " + redact(e.message)));
page.on("console", (m) => { if (m.type() === "error") console.log("  console: " + redact(m.text())); });

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('[data-testid="login-form"]', { timeout: 20000 });
await shot("sign-in", "the client as it is served, before anything is signed in");

await page.fill('[data-testid="login-host-input"]', PROXY);
await page.fill('[data-testid="login-username-input"]', "james");
await page.fill('[data-testid="login-password-input"]', ":" + TOKEN);
await page.click('[data-testid="login-submit"]');
await page.waitForTimeout(4000);
await shot("signed-in", "the account page, with the location bar across the top");

/* The bar is the last band of the chrome, so on a long page it is below the
 * fold until the reader scrolls -- which is what a reader does. */
await page.evaluate(() => document.querySelector("#location-bar").scrollIntoView({ block: "end" }));
await page.waitForTimeout(300);
await shot("the-location-bar",
           "the location bar, the last band of the chrome and present on every page", BAR);

await page.click('[data-testid="account-tab-connection"]');
await page.waitForTimeout(600);
await shot("the-connection-tab",
           "the account pane's Connection tab: provider, model and the key the analysis is asked with", [".account-connection-content"]);

// A placeholder, not a credential: the disclosure below is produced without
// calling the model, so nothing is asked and nothing can leak into a picture.
await page.fill('[data-testid="connection-key"]', "sk-ant-not-a-key-placeholder");
await page.waitForTimeout(200);

await page.evaluate(() => document.querySelector("#location-bar").scrollIntoView({ block: "end" }));
await page.click("#location-display");
await page.fill("#location-input", "goto workspace");
await page.waitForTimeout(150);
await shot("address-the-workspace",
           "the bar starts addressing nothing: `goto workspace' points it at the chrome", BAR);
await page.press("#location-input", "Enter");
await page.waitForTimeout(600);
await shot("addressed",
           "the bar says what it is addressing; from here a line that is not a path is an instruction", BAR);

await page.click("#location-display");
await page.fill("#location-input", "compare the concepts present in james/finto and james/fibo");
await page.waitForTimeout(200);
await shot("the-question-typed",
           "a line that is not a path and that names two repositories", BAR);

await page.press("#location-input", "Enter");
await page.waitForTimeout(4000);
console.log("  reply: " + JSON.stringify(await page.evaluate(() => {
  const r = document.querySelector("#location-reply");
  return { text: r ? r.innerText.slice(0, 400) : null,
           confirm: Boolean(document.querySelector('[data-testid="location-confirm"]')) };
})));
await page.waitForSelector('[data-testid="location-confirm"]', { timeout: 30000 });
await page.waitForTimeout(300);
await shot("disclosed-before-it-runs",
           "nothing has run: the bar names what it would read and offers one press", BAR);

await page.click('[data-testid="location-more"]');
await page.waitForTimeout(300);
await shot("what-the-press-authorises",
           "the disclosure in full: which repositories, how many rounds, how many calls, read-only, and where the answer is kept", BAR);

await writeFile(join(SHOTS, "shots.json"), JSON.stringify(notes, null, 2));
console.log(`\nwrote ${n} screenshots to doc/user-manual/multi-repository-analysis/`);
await browser.close();
server.close();
