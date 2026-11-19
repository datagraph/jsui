/**
 * Render `doc/*.mmd' to SVG and PDF, the way `dot -Tsvg' renders the .dot
 * figures beside them.
 *
 * Mermaid has no renderer outside a browser, so this loads its own bundle
 * into the headless chromium the browser tests already use and asks it to
 * render — rather than pulling in mermaid-cli, which is the same thing with
 * a second copy of a browser attached.
 *
 *   npm --prefix /tmp/mmd install mermaid@11.4.1
 *   MERMAID=/tmp/mmd/node_modules/mermaid/dist/mermaid.min.js \
 *     node doc/render-mermaid.mjs exploration-sequence arrangement-sequence
 *
 * `useMaxWidth: false' is the one setting that matters: with it on, mermaid
 * writes a percentage width and the SVG has no intrinsic size, which is right
 * inside a page and wrong for a file something else has to place.
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DOC = dirname(fileURLToPath(import.meta.url));
const BUNDLE = process.env.MERMAID;
const names = process.argv.slice(2);
if (!BUNDLE || !names.length) {
  console.error("usage: MERMAID=<path to mermaid.min.js> node doc/render-mermaid.mjs <name>…");
  process.exit(2);
}

// Served rather than inlined: mermaid is megabytes, and a <script src> keeps
// it out of the page's own parse.
const srv = createServer(async (req, res) => {
  const js = new URL(req.url, "http://x").pathname.endsWith(".js");
  res.writeHead(200, { "Content-Type": js ? "text/javascript" : "text/html" });
  res.end(js ? await readFile(BUNDLE)
             : `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">`
               + `<script src="/mermaid.min.js"></script>`);
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => Boolean(window.mermaid));

let failed = 0;
for (const name of names) {
  const text = await readFile(join(DOC, `${name}.mmd`), "utf8");
  const out = await page.evaluate(async ({ text, name }) => {
    window.mermaid.initialize({
      startOnLoad: false, theme: "neutral", maxTextSize: 500000, securityLevel: "loose",
      fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      sequence: { useMaxWidth: false, width: 190, boxMargin: 12, wrap: false,
                  noteFontSize: 12, actorFontSize: 13, messageFontSize: 13,
                  mirrorActors: false },
    });
    try { return { ok: true, svg: (await window.mermaid.render(`g-${name}`, text)).svg }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }, { text, name });

  if (!out.ok) { console.error(`${name}: FAILED — ${out.error}`); failed += 1; continue; }
  await writeFile(join(DOC, `${name}.svg`), out.svg);

  const [, w, h] = out.svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/).map(Number);
  const sized = out.svg.replace("<svg ", `<svg width="${Math.round(w)}" height="${Math.round(h)}" `);
  const sheet = await browser.newPage();
  await sheet.setContent(`<body style="margin:0">${sized}`);
  // One page at the drawing's own size: a figure split across A4 is not a figure.
  await sheet.pdf({ path: join(DOC, `${name}.pdf`), printBackground: true,
                    width: `${Math.round(w)}px`, height: `${Math.round(h)}px`,
                    margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await sheet.close();
  console.log(`${name}  ${Math.round(w)}×${Math.round(h)}  → .svg .pdf`);
}

await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
