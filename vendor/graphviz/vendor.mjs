/**
 * Fetch @hpcc-js/wasm-graphviz and write `graphviz.js' beside this file.
 *
 *      node vendor/graphviz/vendor.mjs [version]
 *
 * Two things happen here and both are deliberate.
 *
 * 1. THE ENGINE IS COMMITTED, not installed.  It is loaded into a frame that
 *    has `default-src 'none'' and no network of any kind, so it cannot be
 *    fetched at run time from a CDN even if we wanted that -- and we do not:
 *    a layout engine that arrives over the wire at the moment a figure is
 *    drawn is a third party in the drawing.  What is in the repository is
 *    what runs.
 *
 * 2. THE ES MODULE IS CONVERTED TO A CLASSIC SCRIPT.  The frame's document is
 *    built as a `srcdoc' with the engine inlined, because an opaque origin
 *    cannot resolve a module specifier and a module `<script src>' would need
 *    CORS from a server that is not ours to configure.  The upstream bundle
 *    has exactly one `export {…}' clause, at the end, and no imports and no
 *    `import.meta' -- so the conversion is the single substitution below
 *    rather than a bundler.  `tests/wasm-graphviz.test.mjs' asserts that it
 *    stayed that way.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = process.argv[2] || "1.29.2";
const PKG = "@hpcc-js/wasm-graphviz";
const URL_ = `https://registry.npmjs.org/${PKG}/-/wasm-graphviz-${VERSION}.tgz`;

/** The global the converted script defines; `lib/wasm/graphviz.js' reads it. */
export const GLOBAL = "GraphvizWasm";

/**
 * `export{a as B,c as D}' → `globalThis.GraphvizWasm={B:a,D:c}'.
 *
 * Throws rather than guesses: a bundle with no such clause, or with more than
 * one, is a bundle this conversion has not been read against.
 */
export function toClassicScript(source) {
  const re = /\bexport\s*\{([^}]*)\}\s*;?/g;
  const found = [...source.matchAll(re)];
  if (found.length !== 1) {
    throw new Error(`expected exactly one export clause, found ${found.length}`);
  }
  const pairs = found[0][1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/.exec(s);
    if (!m) throw new Error(`cannot read export specifier \`${s}'`);
    return `${m[2] || m[1]}:${m[1]}`;
  });
  return source.replace(re, `globalThis.${GLOBAL}={${pairs.join(",")}};`);
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), "gv-vendor-"));
  try {
    execFileSync("curl", ["-sSL", "-o", join(tmp, "pkg.tgz"), URL_]);
    execFileSync("tar", ["xzf", join(tmp, "pkg.tgz"), "-C", tmp]);
    const src = readFileSync(join(tmp, "package", "dist", "index.js"), "utf8")
      .replace(/^\s*\/\/# sourceMappingURL=.*$/m, "");
    const head = `/* ${PKG} ${VERSION} — Apache-2.0 — vendored by vendor/graphviz/vendor.mjs.\n`
               + ` * Upstream ES module converted to a classic script; see that file for why.\n`
               + ` * Do not edit: re-run the script. */\n`;
    writeFileSync(join(HERE, "graphviz.js"), head + toClassicScript(src));
    writeFileSync(join(HERE, "LICENSE"), readFileSync(join(tmp, "package", "LICENSE")));
    writeFileSync(join(HERE, "VERSION"), `${PKG}@${VERSION}\n${URL_}\n`);
    process.stdout.write(`wrote graphviz.js from ${PKG}@${VERSION}\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
