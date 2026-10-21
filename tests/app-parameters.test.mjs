/**
 * Parameters: the one place a page influences what runs.
 *
 * U-33.  The claim this file exists to hold up is D-X's, and it is a claim
 * about a string: THE QUERY THE USER AUTHORISED AT GATE 1 IS, CHARACTER FOR
 * CHARACTER, THE QUERY THAT RUNS, with one clause after it.  That is asserted
 * directly -- by prefix comparison on the bound text -- because every other
 * safety argument in this path rests on it, and because the tempting
 * implementations (interpolate the value, rewrite the FILTER, wrap the WHERE)
 * would each pass a looser test.
 *
 * The rest is the encoder, which is the part with edge cases: quoting,
 * datatypes, language tags, IRIs, and the values that must be refused rather
 * than escaped.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-app-parameters-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  termFor, checkValue, bindParameters, columnValues, datatypeIri, escapeLiteral,
  defaultValues,
} = await load("app/parameters.js");
const { runPanel, runPanels } = await load("dashboard/runner.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const XSD = "http://www.w3.org/2001/XMLSchema#";

/* ═══════════════════════════ the encoder ═══════════════════════════════════ */

section("D-X: a value becomes a term, through one encoder");
{
  ok(termFor({ kind: "literal" }, "North").term === '"North"',
     "a plain literal is a plain literal");
  ok(termFor({ kind: "literal", datatype: "xsd:string" }, "North").term === '"North"',
     "and so is an xsd:string — the same term, with one less thing to get wrong");
  ok(termFor({ kind: "literal", datatype: "xsd:integer" }, "42").term
     === `"42"^^<${XSD}integer>`,
     "a typed literal carries its datatype as a FULL IRI");
  ok(termFor({ kind: "literal", datatype: "xsd:date" }, "2026-10-20").term
     === `"2026-10-20"^^<${XSD}date>`,
     "including the ones with no shorthand");
  ok(termFor({ kind: "literal", language: "de" }, "Nord").term === '"Nord"@de',
     "a language tag is written as one");
  ok(termFor({ kind: "iri" }, "http://example.org/r").term === "<http://example.org/r>",
     "and an IRI parameter is written in angle brackets");

  ok(datatypeIri("xsd:integer") === `${XSD}integer`, "a known prefix expands");
  ok(datatypeIri("http://example.org/t") === "http://example.org/t", "a full IRI passes through");
  ok(datatypeIri("ex:thing") === null,
     "and an unknown prefix does not, because the appended clause has no prologue to declare it");
  ok(!termFor({ kind: "literal", datatype: "ex:thing" }, "x").ok,
     "so a value with that datatype is refused rather than written with a prefix nothing binds");
}

section("the encoder refuses what it cannot write, rather than escaping it");
{
  ok(escapeLiteral('he said "no"\\') === 'he said \\"no\\"\\\\',
     "a quote and a backslash are escaped");
  ok(termFor({ kind: "literal" }, 'a"b').term === '"a\\"b"',
     "so a quote in a value cannot end the literal early");
  ok(termFor({ kind: "literal" }, "a\nb").term === '"a\\nb"', "nor can a newline");
  ok(!termFor({ kind: "literal" }, "a\u0000b").ok,
     "a control character is refused — no legitimate value needs one");
  ok(!termFor({ kind: "iri" }, "not an iri").ok, "a relative IRI is refused");
  ok(!termFor({ kind: "iri" }, "http://e.org/a b").ok,
     "and so is one with a space, because a value that needs escaping to sit in an IRI is not one");
  ok(!termFor({ kind: "iri" }, "http://e.org/a>x").ok, "or one that would close the brackets early");
  ok(!termFor({ kind: "literal", datatype: "xsd:integer" }, "twelve").ok,
     "a lexical form that is not of its datatype is refused");
  ok(!termFor({ kind: "literal" }, { a: 1 }).ok, "and a parameter takes one value, not an object");
  ok(!termFor({ kind: "literal" }, null).ok, "nor nothing at all");
}

/* ═══════════════════════════ the domain ════════════════════════════════════ */

section("a value outside its declared domain is refused, with a reason");
{
  const enumerated = { name: "region", kind: "literal", domain: { values: ["North", "South"] } };
  ok(checkValue(enumerated, "North").ok, "a value in the enumeration");
  const no = checkValue(enumerated, "East");
  ok(!no.ok && /`East' is not one of `North', `South'/.test(no.reason),
     "and one outside it, named, with what was admitted");

  const ranged = { name: "year", kind: "literal", datatype: "xsd:integer",
                   domain: { min: 2000, max: 2026 } };
  ok(checkValue(ranged, "2020").ok, "a number inside the range");
  ok(!checkValue(ranged, "1999").ok && /below the lowest value/.test(checkValue(ranged, "1999").reason),
     "below it");
  ok(/above the highest value/.test(checkValue(ranged, "2027").reason), "and above it");

  const results = {
    regions: { ok: true, mimeType: "text/tab-separated-values",
               text: "?region\nNorth\nSouth\n" },
  };
  const fromPanel = { name: "region", kind: "literal",
                      domain: { from: "regions", column: "region" } };
  ok(columnValues(results.regions, "region").join(",") === "North,South",
     "the values of a `from' domain are read off what the panel returned");
  ok(checkValue(fromPanel, "South", { results }).ok, "a value the store returned is admitted");
  const made = checkValue(fromPanel, "Atlantis", { results });
  ok(!made.ok && /is not among the 2 value\(s\)/.test(made.reason),
     "and one it did not is refused — the enumeration is the data's, not the model's");
  ok(checkValue(fromPanel, "Anything", { results: {} }).ok,
     "a domain whose panel has not run yet admits the value: the page cannot have offered one it never had");
}

/* ═══════════════════ the query that runs is the query that was read ════════ */

section("D-X: the authorised text is appended to, never edited");
{
  const QUERY = "SELECT ?month ?total WHERE { ?s :month ?month ; :region ?region } ORDER BY ?month";
  const panel = { name: "sales", query: QUERY, parameters: ["region"] };
  const parameters = [{ name: "region", kind: "literal", domain: { values: ["North"] } }];
  const r = bindParameters(panel, { region: "North" }, { parameters });
  ok(r.ok, "the binding succeeds");
  ok(r.query.startsWith(QUERY),
     "and the query that runs BEGINS with the query that was authorised, byte for byte");
  ok(r.query.slice(QUERY.length) === '\nVALUES (?region) { ("North") }',
     "with exactly one VALUES clause after it, on its own line");
  ok(r.query.indexOf("North") > QUERY.length,
     "the value appears nowhere inside the authorised text — nothing was interpolated");
  ok(r.bound.region === "North", "and what was bound is reported");

  const none = bindParameters({ name: "p", query: QUERY }, { region: "North" }, { parameters });
  ok(none.query === QUERY,
     "a panel that declares no parameters gets its text back identical, not merely equivalent");

  const unsupplied = bindParameters(panel, {}, { parameters });
  ok(unsupplied.ok && unsupplied.query === QUERY,
     "and a parameter with no value and no default leaves the query's own variable free");

  const defaulted = bindParameters(panel, {},
    { parameters: [{ name: "region", kind: "literal", default: "South" }] });
  ok(defaulted.query.endsWith('VALUES (?region) { ("South") }'), "a default is used when nothing is supplied");
  ok(defaultValues([{ name: "a", default: 1 }, { name: "b" }]).a === 1
     && !("b" in defaultValues([{ name: "a", default: 1 }, { name: "b" }])),
     "and the defaults a page starts with are the declared ones");
}

section("the clause survives a query that ends in a comment");
{
  const QUERY = "SELECT ?x WHERE { ?s :p ?x } # the last word";
  const r = bindParameters({ name: "p", query: QUERY, parameters: ["x"] }, { x: "1" },
                           { parameters: [{ name: "x", kind: "literal" }] });
  ok(r.query.includes("\nVALUES"),
     "because a `#' runs to the end of its own line and would otherwise swallow the binding");
}

section("one refused value stops the whole binding");
{
  const panel = { name: "sales", query: "SELECT ?a WHERE { ?s :a ?region ; :b ?year }",
                  parameters: ["region", "year"] };
  const parameters = [
    { name: "region", kind: "literal", domain: { values: ["North"] } },
    { name: "year", kind: "literal", datatype: "xsd:integer", domain: { min: 2000, max: 2026 } },
  ];
  const r = bindParameters(panel, { region: "North", year: "1999" }, { parameters });
  ok(!r.ok && r.refusals.length === 1 && r.refusals[0].name === "year",
     "the refusal names the parameter and the reason");
  ok(!r.query.includes("VALUES"),
     "and nothing is bound: half a binding is a query the user never saw, returning the wrong rows");
}

/* ══════════════════════════ through the runner ═════════════════════════════ */

section("U-34: the runner binds, and refuses before it fetches");
{
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(String(init.body || ""));
    return { ok: true, status: 200, headers: { get: () => "text/tab-separated-values" },
             text: async () => "?a\n1\n" };
  };
  const panel = { name: "sales", query: "SELECT ?a WHERE { ?s :r ?region }",
                  parameters: ["region"] };
  const parameters = [{ name: "region", kind: "literal", domain: { values: ["North"] } }];

  const good = await runPanel({ host: "https://h", account: "a", repository: "r", token: "t",
                                panel, fetchImpl, values: { region: "North" }, parameters });
  ok(good.ok && sent[0].endsWith('VALUES (?region) { ("North") }'), "a value in the domain runs");
  ok(good.bound.region === "North", "and the result says what it was run with");

  const bad = await runPanel({ host: "https://h", account: "a", repository: "r", token: "t",
                               panel, fetchImpl, values: { region: "East" }, parameters });
  ok(!bad.ok && bad.refused && /is not one of/.test(bad.error),
     "a value outside it is refused with a reason");
  ok(sent.length === 1, "and nothing was fetched: the refusal happens before the store is touched");
}

section("U-31: only the panels that changed are run");
{
  const ran = [];
  const fetchImpl = async (url, init) => {
    ran.push(String(init.body || "").slice(0, 20));
    // In the panel\'s own column: a result whose columns are not the
    // query\'s is a failed run (`resultFault\'), so a stub that answered
    // `?a\' to everything would now be testing the check, not the routing.
    const col = (String(init.body || "").match(/\?\w+/) || ["?a"])[0];
    return { ok: true, status: 200, headers: { get: () => "text/tab-separated-values" },
             text: async () => `${col}\n1\n` };
  };
  const panels = [
    { name: "regions", query: "SELECT ?region WHERE { }" },
    { name: "sales", query: "SELECT ?total WHERE { }" },
    { name: "costs", query: "SELECT ?cost WHERE { }" },
  ];
  const have = { regions: { name: "regions", ok: true, text: "?region\nNorth\n", rows: 1 } };
  const out = await runPanels({ host: "https://h", account: "a", repository: "r", token: "t",
                                panels, fetchImpl, only: ["sales", "costs"], have });
  ok(ran.length === 2, "two of three panels are run");
  ok(out.regions.rows === 1 && out.sales.ok && out.costs.ok,
     "and the one that was not keeps the result it already had");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
