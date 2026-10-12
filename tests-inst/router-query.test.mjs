// Run: node tests/router-query.test.mjs      (no browser, no server)
//
// P-1 of the prompt-pane plan.  A query composed elsewhere -- an MCP
// materialize, an LLM answer -- reaches jsui as
//     /account/:a/repositories/:r/views/new?query=<encoded SPARQL>
// and seeds the new view's editor.  Before this, the router compiled every
// route to ^pattern$ over the whole string, so the "?" made it match nothing
// and the URL fell through to onNotFound: a 404, not a dropped parameter.
// Under updateLocation:false the location bar is never written either, so
// window.location.search was not an alternative source.

// P-1: the views/new route must match with a ?query= attached, and deliver it.
import { readFile } from "node:fs/promises";

global.window = { location: { protocol: "http:", pathname: "/", search: "" } };
// router.js is ESM, but jsui's root package.json declares no "type" and cannot
// (doc/restyle-manual.js and js/*.js are CommonJS and are run by node), so a
// plain import would resolve it as CommonJS and fail on `export`.  The browser
// has no such ambiguity: index.html loads it with <script type="module">.
// Reading the real file and importing it as a module URL keeps the test honest
// -- it exercises the shipped source, not a copy -- without a build step.
const src = await readFile(new URL("../router.js", import.meta.url), "utf8");
const { Router } = await import("data:text/javascript," + encodeURIComponent(src));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS " + m)) : (fail++, console.log("  FAIL " + m)); };

let seen = null, notFound = null, changed = null;
const routes = [
  { path: "/account/:account_name/repositories/:repository_name/views/new",
    handler: (ctx) => { seen = ctx; } },
  { path: "/account/:account_name/repositories/:repository_name",
    handler: (ctx) => { seen = ctx; } },
];
const r = new Router(routes, (ctx) => { notFound = ctx; },
                     { updateLocation: false, onRouteChange: (p) => { changed = p; } });

const QUERY = "SELECT * WHERE { ?s ?p ?o } # all\nLIMIT 10";
const reset = () => { seen = notFound = changed = null; };

console.log("1. views/new with an encoded query");
reset();
r.handlePath(`/account/test/repositories/foaf/views/new?query=${encodeURIComponent(QUERY)}`);
ok(seen && !notFound, "the route matches (it did not before: ? is not in the ^...$ pattern)");
ok(seen?.params.account_name === "test" && seen?.params.repository_name === "foaf", "params still bind");
ok(seen?.query.get("query") === QUERY, "the query arrives verbatim, ? # and newline intact");
ok(seen?.path === "/account/test/repositories/foaf/views/new", "ctx.path carries no query");
ok(changed === "/account/test/repositories/foaf/views/new", "onRouteChange gets the bare path");
ok(r.currentPath === "/account/test/repositories/foaf/views/new" && r.currentSearch.length > 0,
   "currentPath is bare; currentSearch holds the rest");

console.log("2. the same route without a query still behaves");
reset();
r.handlePath("/account/test/repositories/foaf/views/new");
ok(seen && !notFound, "matches");
ok(seen.query.get("query") === null, "no seed");
ok(seen.search === "", "empty search");

console.log("3. an unrelated route is unaffected");
reset();
r.handlePath("/account/test/repositories/foaf");
ok(seen && seen.params.repository_name === "foaf", "repository route matches");

console.log("4. a genuinely unknown path still reaches onNotFound");
reset();
r.handlePath("/nope/at/all?x=1");
ok(!seen && notFound, "onNotFound called");
ok(notFound.query.get("x") === "1", "and is given the query too");

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
