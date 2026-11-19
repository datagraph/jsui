/**
 * The report, as a page that can be kept (§34.7).
 *
 * What is worth asserting is not that markdown renders -- it is that a
 * document written from a model's answer cannot be made to carry anything but
 * text.  A report quotes SPARQL, URLs and identifiers full of underscores and
 * angle brackets, and every one of those is a way for a renderer to either
 * corrupt the report or to put markup into a page the user is about to open.
 */
import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-report-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const R = await import(pathToFileURL(join(scratch, "lib", "format", "report.js")).href);

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

console.log("\nnothing from a model becomes markup");
{
  const hostile = 'A <script>alert(1)</script> and an "attribute" & an ampersand.';
  const html = R.markdown(hostile);
  ok(!html.includes("<script>") && html.includes("&lt;script&gt;"),
     "a tag in the prose is text in the page");
  ok(html.includes("&amp;"), "and so is a bare ampersand");

  const fenced = "```sparql\nSELECT * WHERE { ?s <http://x/p> \"<b>\" }\n```";
  const code = R.markdown(fenced);
  ok(code.includes("<pre") && code.includes("&lt;http://x/p&gt;"),
     "a fence is a code block, and what is inside it is escaped too");
  ok(code.includes('data-lang="sparql"'), "the language is kept, as data rather than as a class");

  const page = R.reportPage({ answer: hostile, asked: "<em>what</em>", title: "a <b>title</b>" });
  ok(!/<script>/.test(page) && page.includes("&lt;script&gt;"),
     "and the whole page carries none of it as markup");
  ok(page.includes("&lt;b&gt;title"), "the title is escaped where it is shown");
}

console.log("\nwhat an analysis report is actually made of");
{
  const answer = [
    "# Findings",
    "",
    "Two of the three declare equipment.",
    "",
    "| store | equipment | relationships |",
    "| --- | ---: | --- |",
    "| building-qa/b59 | 86 | `hasPoint`, `feeds` |",
    "| building-qa/bldg11 | 45 | `hasPoint` |",
    "",
    "## Not established",
    "",
    "- whether `bldg_223p_anon` uses a different predicate",
    "- the direction of `feeds` in **b59**",
    "",
    "> The third store answered no catalogue at all.",
  ].join("\n");
  const html = R.markdown(answer);
  ok(/<h1>Findings<\/h1>/.test(html), "a heading is a heading");
  ok(/<h2>Not established<\/h2>/.test(html), "at every level it uses");
  ok((html.match(/<th>/g) || []).length === 3 && (html.match(/<tr>/g) || []).length === 3,
     "a pipe table is a table, header row and all");
  ok(html.includes("<code>hasPoint</code>"), "a code span inside a cell survives the cell");
  ok((html.match(/<li>/g) || []).length === 2, "a list is a list");
  ok(html.includes("<strong>b59</strong>"), "and emphasis is emphasis");
  ok(html.includes("<blockquote>"), "a quoted line is quoted");
  ok(!/<em>/.test(html),
     "but an underscore in an identifier is NOT italics: bldg_223p_anon is a name");
  ok(html.indexOf("<h2>") > html.indexOf("</table>"),
     "the heading after a table is after the table, not inside it");
}

console.log("\nthe page stands on its own");
{
  const page = R.reportPage({
    title: "Exploration — building-qa/b59",
    asked: "equipment relationships in two but not the third",
    answer: "# Findings\n\nNothing was established.",
    stores: ["building-qa/b59", "building-qa/bldg11"],
    stage: "claude-opus-5 · building-qa/b59 18 · 2026-11-17",
    records: ["recorded: building-qa/b59 → http://dydra.com/explorations/X/transcript"],
    exchanges: [{ title: "survey catalog", repository: "building-qa/b59", status: "ok", ms: 240 }],
    at: new Date("2026-11-17T10:00:00Z"), account: "building-qa",
  });
  ok(/^<!doctype html>/i.test(page) && page.trimEnd().endsWith("</html>"),
     "it is a whole document, not a fragment");
  ok(!/<script/i.test(page), "with no script in it anywhere");
  ok(!/(src|href)=["']https?:/i.test(page.replace(/<a href="http[^"]*">/g, "")),
     "and nothing it has to fetch to render: no stylesheet, no font, no image");
  ok(page.includes("<style>") && page.includes("font:"),
     "its styles travel with it");
  ok(page.includes('<meta name="date" content="2026-11-17" />'),
     "it says when it was made, where a reader of the file will look");
  ok(page.includes("claude-opus-5 · building-qa/b59 18 · 2026-11-17"),
     "the Article 50 line goes with it — this is the copy that leaves the building");
  ok(page.includes("recorded: building-qa/b59"),
     "and the record it can be checked against");
  ok(page.includes("survey catalog") && page.includes("<details>"),
     "the exchanges travel folded: the report is what it is for");
  ok(/href="http:\/\/dydra\.com\/explorations\/X\/transcript"/.test(page),
     "a bare URL in the footer is a link, because a saved page is read in a browser");
}

console.log("\nthe file name");
{
  const name = R.reportFilename({ account: "building-qa", at: new Date("2026-11-17T10:09:08Z") });
  ok(name === "exploration-building-qa-20261117T100908Z.html",
     "sorts by date, names the account, and ends .html");
  ok(R.reportFilename({ account: "a/b c" }).startsWith("exploration-a-b-c-"),
     "a name that is not a file name is made into one");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
