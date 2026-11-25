/**
 * The library a downloaded page carries, as source (U-111, U-113).
 *
 * A saved page loads nothing -- that is the whole of §2.2 and the reason a
 * copy can be mailed, opened from a disk, and still draw.  But a saved page
 * that can ask the store again needs real code to do it: a digest to compare
 * against, the check that a 200 with a body actually answers the query, the
 * one line that turns a token into an Authorization header.  None of that can
 * be imported from a file on somebody else's laptop.
 *
 * So it travels as text.  Each module exports a `*_SOURCE' string built from
 * `Function.prototype.toString' over its own functions, and this module is
 * the table of which ones, in which order, with what bound into each -- plus
 * the two things that table has to do: assemble a subset of it into a script,
 * and notice when the running tree cannot supply one.
 *
 * It lives in `lib/app' and not in `lib/dashboard' because there are now two
 * kinds of saved page that need it, and the second one is a FIGURE
 * (`lib/figure/saved-runtime.js'), whose whole argument is that it is not a
 * dashboard.  A figure asking a dashboard module for its library would have
 * been the wrong shape of dependency to live with.
 */

/*
 * Namespace imports, deliberately, and read at call time.
 *
 * This module wants one export from each of eight modules, and /ui/ is served
 * with no cache lifetime: a reload after a deploy mixes old modules with new
 * ones.  A NAMED import of an export the cached copy does not have is a LINK
 * error -- the module graph does not load, and because the frames import this
 * one, the whole application fails to start over a feature nobody had asked
 * for yet.  That is what happened on the first deploy of this: "doesn't
 * provide an export named `QUERY_FORM_SOURCE'", and a blank interface behind
 * it.
 *
 * A namespace import does not link anything: a missing export is `undefined'
 * at the point it is read.  So the cost of a half-deployed tree becomes what
 * it should always have been -- a downloaded page that replays instead of
 * refreshing -- and the pane keeps working.
 */
import * as digest from "../mcp/result-digest.js";
import * as parameters from "./parameters.js";
import * as grant from "../llm/grant.js";
import * as document_ from "./document.js";
import * as provenance from "../figure/provenance.js";
import * as runner from "../dashboard/runner.js";
import * as spec from "../dashboard/spec.js";
import * as catalog from "../dashboard/catalog.js";

/**
 * One module's functions as one value, with its own dependencies bound in.
 *
 * Each bundle gets its own scope because the modules disagree about names on
 * purpose: `NUMERIC' is a regular expression in `result-digest.js' and a set
 * of datatype names in `parameters.js', and concatenating the two into one
 * flat script would silently take whichever came last.
 */
const scope = (source, gives, needs = {}) => {
  const names = Object.keys(needs);
  return `(function (${names.join(", ")}) {\n${source}\n`
       + `return { ${gives.map((g) => `${g}: ${g}`).join(", ")} };\n`
       + `})(${names.map((n) => needs[n]).join(", ")})`;
};

/**
 * What travels, and from where.
 *
 * Each row is: the name the bundle takes in the saved script, the module it
 * comes from (as a specifier, so a stale one can be fetched again), the
 * namespace it was imported under, the export that carries the source, the
 * file as a reader would name it, what the bundle gives out, and what it
 * needs bound in from the bundles before it.
 */
const MODULES = [
  ["RD", "../mcp/result-digest.js", digest, "RESULT_DIGEST_SOURCE", "result-digest.js",
   ["contentDigest", "digestResult", "tableOf"], {}],
  ["QF", "../llm/grant.js", grant, "QUERY_FORM_SOURCE", "grant.js",
   ["stripComments", "queryFormOf"], {}],
  ["PJ", "./document.js", document_, "PROJECTION_SOURCE", "document.js",
   ["projectedVariables"], { stripComments: "QF.stripComments" }],
  ["DS", "../figure/provenance.js", provenance, "DATASET_SOURCE", "provenance.js",
   ["datasetOf"], { stripComments: "QF.stripComments" }],
  ["PM", "./parameters.js", parameters, "PARAMETER_SOURCE", "parameters.js",
   ["bindParameters", "checkValue", "defaultValues"], { tableOf: "RD.tableOf" }],
  ["RF", "../dashboard/runner.js", runner, "RESULT_FAULT_SOURCE", "runner.js",
   ["resultFault"], { queryFormOf: "QF.queryFormOf", projectedVariables: "PJ.projectedVariables",
                      datasetOf: "DS.datasetOf" }],
  ["SP", "../dashboard/spec.js", spec, "STALE_SOURCE", "spec.js", ["staleAssertions"], {}],
  ["AU", "../dashboard/catalog.js", catalog, "AUTH_SOURCE", "catalog.js", ["authHeader"], {}],
];

/** Every bundle, by the two names a caller may know it under. */
export const CARRIED = MODULES.map(([key, , , , file]) => ({ key, file }));

/**
 * The bundles a caller asked for, plus the ones those need, in table order.
 *
 * A caller names what it uses -- a figure wants the digest and the fault
 * check, not the parameter encoder -- and gets the closure of that, because
 * `resultFault' is nothing on its own: it reads a query form, a projection
 * and a dataset out of three other modules.  Asking the caller to know that
 * would make the subset a second place the dependency graph is written down,
 * and the second copy is the one that goes stale.
 */
function selected(which) {
  if (!which || !which.length) return MODULES;
  const want = new Set();
  const add = (name) => {
    const m = MODULES.find((r) => r[0] === name || r[4] === name);
    if (!m || want.has(m[0])) return;
    want.add(m[0]);
    for (const bound of Object.values(m[6])) add(String(bound).split(".")[0]);
  };
  for (const name of which) add(name);
  return MODULES.filter((m) => want.has(m[0]));
}

/* What a second, cache-defeating read of a module gave us, keyed by its
   specifier.  Empty on a tree that is all of one age, which is every tree
   except one being deployed into. */
const recovered = Object.create(null);

/** One module's bundle: the fresh copy if one was fetched, else the import. */
const sourceOf = ([, specifier, ns, key]) => {
  const own = recovered[specifier];
  if (typeof own === "string" && own) return own;
  const read = ns[key];
  return typeof read === "string" && read ? read : null;
};

/** The modules this cannot find a bundle in, which is the deploy's own list. */
export function missingSource(which = null) {
  return selected(which).filter((m) => !sourceOf(m)).map((m) => m[4]);
}

/*
 * Repairing a half-deployed tree, rather than reporting it.
 *
 * The namespace imports above keep a stale module from taking the
 * application down, but they do not make the saved page refreshable again:
 * `undefined' where a bundle should be still costs the reader the one
 * control this whole feature is about, and it costs it SILENTLY, on a page
 * that looks finished.  That is the shape the first report of this took --
 * the interface worked, the download drew, and the Refresh was simply not
 * there.
 *
 * But the module is only stale in the CACHE.  The server has the new one, as
 * `curl' shows every time this happens.  A dynamic import of the same
 * specifier under a query the cache has never seen is a different URL, so it
 * is fetched rather than reused, and the export that was missing is there.
 *
 * It runs once, at load, and only for the modules that came up short; it is
 * never awaited, because nothing on the screen waits for it either.  A page
 * saved before it lands still falls back to the copy that replays, and says
 * which module it is waiting on.
 */
let repair = null;
let repairing = false;

/** Whether a second read is still in flight, for a message worth printing. */
export function repairPending() { return repairing; }

/**
 * Fetch, past the cache, the modules whose bundle this page did not get.
 *
 * Resolves with the files it recovered.  Never rejects: a tree that really
 * is older than this module is the case the fallback exists for.
 */
export function repairMissingSource() {
  if (repair) return repair;
  const stale = MODULES.filter((m) => !sourceOf(m));
  if (!stale.length) return Promise.resolve([]);
  repairing = true;
  repair = Promise.all(stale.map((m) => {
    const [, specifier, , key, from] = m;
    return import(`${specifier}?reload=${Date.now()}`)
      .then((fresh) => {
        const source = fresh && fresh[key];
        if (typeof source === "string" && source) { recovered[specifier] = source; return from; }
        return null;
      })
      .catch(() => null);
  })).then((got) => {
    repairing = false;
    const recoveredFiles = got.filter(Boolean);
    /* A second read that recovered nothing is not an answer, it is a tree
       that was mid-deploy when this page loaded.  Forgetting the attempt
       lets the next download try again, which is what the sentence the
       reader was given tells them to do. */
    if (!recoveredFiles.length) repair = null;
    return recoveredFiles;
  });
  return repair;
}

/* Not awaited, and not conditional on a browser: a tree all of one age asks
   for nothing here, and that is the common case. */
if (missingSource().length) repairMissingSource();

/**
 * The library a saved page carries, as source.
 *
 * Throws when a module in the running tree has no bundle to give, naming the
 * modules: the caller falls back to the copy that cannot ask again, and the
 * sentence is one somebody can act on rather than a blank page.
 */
export function sharedSource(which = null) {
  const missing = missingSource(which);
  if (missing.length) {
    throw new Error(`a refreshable copy needs a newer ${missing.join(", ")} than this `
                  + `page has loaded (a stale module from an earlier deploy)`
                  + (repairing
                       ? ` — a fresh copy is being fetched now; downloading again in a `
                         + `moment should give the refreshable page`
                       : ` — a hard reload (Shift-Reload) is the cure`));
  }
  return selected(which).map((m) =>
    `var ${m[0]} = ${scope(sourceOf(m), m[5], m[6])};`).join("\n\n");
}
