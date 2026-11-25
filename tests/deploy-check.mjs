/**
 * What a half-stale deploy would make fatal (U-111, U-114).
 *
 * `/ui/` is served with no `Cache-Control`, so a reload after a deploy builds
 * the page out of two deploys at once: modules the browser already had come
 * from its cache, modules it has never seen come from the server.  A NAMED
 * import of an export the cached copy does not have is an ESM *link* error —
 * the module graph never loads, and the whole interface is blank over a
 * feature nobody has used yet.
 *
 * It has happened three times: `QUERY_FORM_SOURCE` (2026-11-21),
 * `missingSource` (2026-11-22), `templateParts` (2026-11-22).  Each time the
 * server had the new module all along.
 *
 * The export that is dangerous is the one a CACHED copy of the module will
 * not have, and nothing in the source says which those are.  So the baseline
 * is read from outside:
 *
 *     node tests/deploy-check.mjs https://nl4.dydra.com/ui/
 *
 *         the exact question.  Each module that is the target of a static
 *         named import is fetched from the deployed tree — `curl` has no
 *         cache, so the server's answer is authoritative — and every name
 *         imported from it is checked against what the deployed copy
 *         exports.  A name that is missing is an interface that will not
 *         start for anyone whose browser kept that file.
 *
 *     node tests/deploy-check.mjs
 *
 *         the offline approximation: git `HEAD` stands in for the deploy.
 *         Only as good as the last commit — in a tree that is never
 *         committed it reports everything, which is why it says so.
 *
 * The cure is never to stop adding exports; it is to read a new one through
 * a namespace at call time, where a missing member is `undefined` and costs
 * the one feature instead of the application.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
};
for (const r of ["lib", "ui"]) walk(join(ROOT, r));

/** Every name a module exports, read from its source. */
function exportsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const as = /\bas\s+([A-Za-z_$][\w$]*)/.exec(part);
      const name = (as ? as[1] : part.trim()).trim();
      if (name) out.add(name);
    }
  }
  if (/^export\s+default/m.test(text)) out.add("default");
  if (/^export\s+\*/m.test(text)) out.add("*");
  return out;
}

/** The same file as the last commit has it, or null when it is new. */
function committed(path) {
  try {
    return execFileSync("git", ["show", `HEAD:${relative(ROOT, path)}`],
                        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

/** Every static named import in the tree: who, from where, which names. */
const imports = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const names = m[1].split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    if (names.length) imports.push({ from: f, target: resolve(dirname(f), m[2]), names });
  }
}

const deployed = process.argv[2] || null;
const base = deployed ? deployed.replace(/\/?$/, "/") : null;

/** What the DEPLOYED copy of one module exports, or null when it is not there. */
async function served(path) {
  const url = base + relative(ROOT, path).split("\\").join("/");
  let res;
  try { res = await fetch(url, { cache: "no-store" }); }
  catch (e) { return { error: String(e.message || e) }; }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return { names: exportsOf(await res.text()) };
}

const targets = [...new Set(imports.map((i) => i.target))];
const have = new Map();
let absent = 0;

if (base) {
  console.log(`baseline: the deployed tree at ${base}\n`);
  for (const t of targets) {
    const got = await served(t);
    if (got.error) { absent += 1; have.set(t, { error: got.error }); continue; }
    have.set(t, got);
  }
} else {
  console.log("baseline: git HEAD — an APPROXIMATION of what is deployed. In a tree that is "
            + "not committed\n          it reports everything; pass the deployed base URL "
            + "for the exact answer.\n");
  for (const t of targets) {
    const was = committed(t);
    have.set(t, was === null ? { error: "not in HEAD" } : { names: exportsOf(was) });
  }
}

let fatal = 0, unknown = 0;
for (const { from, target, names } of imports) {
  const held = have.get(target);
  if (!held) continue;
  if (held.error) {
    unknown += 1;
    if (base) {
      console.log(`  UNKNOWN ${relative(ROOT, from)} → ${relative(ROOT, target)}: ${held.error}`);
      console.log(`          a module nobody can have cached is not the fatal case, but if it `
                + `is missing from the deploy it is worse.`);
    }
    continue;
  }
  if (held.names.has("*")) continue;
  for (const name of names) {
    if (held.names.has(name)) continue;
    fatal += 1;
    console.log(`  FATAL ${relative(ROOT, from)}`);
    console.log(`        names \`${name}', which the baseline copy of `
              + `${relative(ROOT, target)} does not export.`);
    console.log(`        A cached copy of that module makes this a LINK error: the module `
              + `graph never`);
    console.log(`        loads and the interface is blank. Read it through a namespace at `
              + `call time.`);
  }
}

console.log(`\n${files.length} modules · ${imports.length} static named imports · `
          + `${targets.length} modules imported from`
          + (base ? ` · ${absent} not served` : ""));
console.log(fatal
  ? `\n${fatal} import(s) would make a stale cache fatal.`
  : "\nno static named import depends on a name the baseline does not have."
    + (unknown && base ? ` (${unknown} could not be checked)` : ""));
process.exit(fatal ? 1 : 0);
