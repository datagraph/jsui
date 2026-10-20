/**
 * The layout engine: where it comes from, where it runs, and what it is not.
 *
 * A figure the model writes as DOT is laid out by a graphviz compiled to
 * WebAssembly and committed to this repository.  That is three claims, each
 * one line of code and each silently reversible:
 *
 *   - the engine is IN THE REPOSITORY (`vendor/graphviz'), not fetched when
 *     a picture is drawn.  A layout engine that arrives over the wire at that
 *     moment is a third party in the drawing, and the frame it runs in has
 *     `default-src 'none'' precisely so that it cannot be one;
 *   - it runs in a frame that holds NO MODEL-AUTHORED MARKUP -- the DOT
 *     arrives afterwards, by postMessage, as an argument.  That is what makes
 *     `script-src 'unsafe-inline'' a correct setting there rather than a
 *     convenient one;
 *   - the frame that SHOWS the result still runs nothing.  D-M is unchanged;
 *     the engine was added beside it, not inside it.
 *
 * The browser half -- that the frame actually lays a graph out, in both
 * engines, and that the figure frame stays inert while it does -- is in
 * `wasm-graphviz.browser.mjs', because those are claims about a browser.
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-wasm-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  ENGINE_SANDBOX, ENGINE_CSP, buildEngineDocument, createEngineFrame,
} = await load("wasm/engine-frame.js");
const {
  DOT_ENGINES, DEFAULT_ENGINE, ENGINE_NOTES, GRAPHVIZ_DRIVER, svgFragment, layoutDot,
} = await load("wasm/graphviz.js");
const { FIGURE_SANDBOX, FIGURE_CSP } = await load("figure/frame.js");
const { toClassicScript, GLOBAL } = await import(
  pathToFileURL(join(root, "vendor", "graphviz", "vendor.mjs")).href);

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const VENDOR = join(root, "vendor", "graphviz");

/* ═════════════ the engine is committed, not installed ═════════════ */

section("the engine is in the repository, not on a CDN");
{
  ok(existsSync(join(VENDOR, "graphviz.js")), "the engine is checked in");
  const src = readFileSync(join(VENDOR, "graphviz.js"), "utf8");
  ok(src.length > 200000, `and it is the whole thing (${Math.round(src.length / 1024)}K)`);

  ok(existsSync(join(VENDOR, "LICENSE"))
     && /Apache License/.test(readFileSync(join(VENDOR, "LICENSE"), "utf8")),
     "with the licence it came under, beside it");
  ok(/@hpcc-js\/wasm-graphviz@/.test(readFileSync(join(VENDOR, "VERSION"), "utf8")),
     "and the exact version, so what is here can be re-derived");
  ok(existsSync(join(VENDOR, "vendor.mjs")),
     "by a script that is in the repository too -- the conversion is not folklore");

  // The three properties the inlining depends on.  Each would fail loudly
  // in a browser and not at all here, which is why they are asserted here.
  ok(!/\bexport\s*[{*]/.test(src) && !/\bexport\s+(default|const|function|class)\b/.test(src),
     "it is a classic script: an opaque origin cannot resolve a module specifier");
  ok(!/\bimport\s*[({]/.test(src) && !/\bimport\.meta\b/.test(src),
     "and fetches nothing of its own, which a frame with no network could not honour");
  ok(src.includes(`globalThis.${GLOBAL}=`),
     `it publishes itself as globalThis.${GLOBAL}, which is how the driver reaches it`);
  ok(!/<\/script/i.test(src),
     "and contains no </script, which would end the element and turn the rest into text");
}

section("the conversion is one substitution, and says so when it is not");
{
  ok(toClassicScript("var a=1;export{a as B};") === `var a=1;globalThis.${GLOBAL}={B:a};`,
     "an export clause becomes an assignment to the global");
  ok(toClassicScript("var a=1;export{a};") === `var a=1;globalThis.${GLOBAL}={a:a};`,
     "an unrenamed export keeps its name");
  let threw = null;
  try { toClassicScript("var a=1;"); } catch (e) { threw = e.message; }
  ok(/found 0/.test(threw || ""), "a bundle with no export clause is refused, not patched");
  threw = null;
  try { toClassicScript("export{a};export{b};"); } catch (e) { threw = e.message; }
  ok(/found 2/.test(threw || ""),
     "and so is one with two: this conversion has been read against exactly one shape");
}

/* ═════════════ where it runs ═════════════ */

section("the frame that runs the engine is not the frame that shows the figure");
{
  ok(ENGINE_SANDBOX === "allow-scripts", "the engine frame is given script");
  ok(!/allow-same-origin/.test(ENGINE_SANDBOX),
     "and nothing else: not same-origin, so it cannot reach the page that made it");
  ok(FIGURE_SANDBOX === "" && !/allow-scripts/.test(FIGURE_SANDBOX),
     "while the frame that shows the drawing still runs nothing at all (D-M, unchanged)");
  ok(/script-src 'none'/.test(FIGURE_CSP),
     "and says so in its own policy, as it did before there was an engine");

  ok(/default-src 'none'/.test(ENGINE_CSP) && /connect-src 'none'/.test(ENGINE_CSP),
     "the engine has no network: a compiled blob that phones home cannot");
  ok(/'wasm-unsafe-eval'/.test(ENGINE_CSP) && !/'unsafe-eval'/.test(ENGINE_CSP.replace(/'wasm-unsafe-eval'/g, "")),
     "it may instantiate WebAssembly and may not eval JavaScript");

  const doc = buildEngineDocument({ engineSource: "var x=1;", driver: "var y=2;" });
  ok(doc.includes(ENGINE_CSP), "the document carries the policy");
  ok(doc.indexOf("var x=1;") < doc.indexOf("var y=2;"),
     "the engine is inlined before the driver that calls it");

  let threw = null;
  try { buildEngineDocument({ engineSource: "</script><img>", driver: "" }); }
  catch (e) { threw = e.message; }
  ok(/cannot be inlined/.test(threw || ""),
     "a source that would end the script element early is refused rather than inlined");
}

section("the model's text is an argument, never part of the document");
{
  const doc = buildEngineDocument({ engineSource: "", driver: GRAPHVIZ_DRIVER });
  ok(!/digraph/.test(doc),
     "no graph is in the frame's document: it is built before any figure exists");
  ok(!/\bdocument\./.test(GRAPHVIZ_DRIVER),
     "and the driver never touches the DOM -- it takes a string and returns a string");
  ok(/event\.source !== parent/.test(GRAPHVIZ_DRIVER),
     "it answers only its embedder, not any window that can find it");
}

/* ═════════════ what comes back ═════════════ */

section("graphviz writes a file; a figure is a fragment");
{
  const out = svgFragment(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generated by graphviz version 16.1.0 (0) -->
<svg width="242pt" height="67pt" viewBox="0.00 0.00 242.00 67.00" xmlns="http://www.w3.org/2000/svg">
<g id="graph0"/></svg>`);
  ok(!/<\?xml/.test(out), "the XML declaration goes: this is an element, not a document");
  ok(!/<!DOCTYPE/.test(out),
     "and the doctype, which the figure policy would rightly report as ignored");
  ok(!/width="242pt"/.test(out) && !/height="67pt"/.test(out),
     "the point size goes, so the drawing scales to the pane instead of to the page");
  ok(/viewBox="0\.00 0\.00 242\.00 67\.00"/.test(out),
     "the viewBox stays: it is how the frame is sized, there being no script to measure");
  ok(/Generated by graphviz version 16\.1\.0/.test(out),
     "and the generator comment stays -- it is the engine saying what drew this");
  ok(/<g id="graph0"\/>/.test(out), "nothing else is touched: this is not a sanitiser");
}

section("the engines offered, and what each is for");
{
  ok(DOT_ENGINES.includes("dot") && DOT_ENGINES.includes("neato"),
     "the two that answer different questions are both there");
  ok(DEFAULT_ENGINE === "dot", "and the layered one is the default, as graphviz's own is");
  ok(DOT_ENGINES.every((e) => typeof ENGINE_NOTES[e] === "string" && ENGINE_NOTES[e]),
     "each is offered with a line saying when to pick it, for the prompt and the menu");
  ok(!DOT_ENGINES.includes("patchwork") && !DOT_ENGINES.includes("osage"),
     "the treemap layouts are not offered: picked by mistake they draw the wrong kind of thing");
}

section("a layout that cannot happen is an outcome, not an exception");
{
  const empty = await layoutDot("", { engineSource: "x" });
  ok(empty.ok === false && /no DOT source/.test(empty.error),
     "an empty source comes back as a failure, having started nothing");

  // No document, so the frame cannot be created: the shape a browser without
  // the engine would produce.  It must still be a value.
  const nowhere = await layoutDot("digraph g { a -> b }", { engineSource: "x", doc: null });
  ok(nowhere.ok === false && typeof nowhere.error === "string",
     "and so does an engine that will not start -- a caller is never made to catch");

  let threw = null;
  try { createEngineFrame({ engineSource: "", driver: "", doc: null }); }
  catch (e) { threw = e.message; }
  ok(/needs a document/.test(threw || ""),
     "the frame itself is explicit about what it needs, rather than failing later");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
