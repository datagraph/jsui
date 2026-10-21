/**
 * The interaction budget: what a page may spend, and why it is not a grant.
 *
 * Open question 3 of `ui-generator.md' §15, answered.  The distinction this
 * file exists to hold up is the one the whole design turns on:
 *
 *      THE GRANT SCREENS THE MODEL.  THE BUDGET BOUNDS THE PAGE.
 *
 * They look alike -- both count calls, both refuse, both show a meter -- and
 * conflating them would be an easy and expensive mistake in either
 * direction.  Charge the page against the grant and a reader turning a
 * selector would exhaust the model's authority mid-exploration.  Treat the
 * budget as authority and renewing it would have to be a gate, which would
 * put a consent dialog in front of a query the user approved ten seconds
 * ago -- the exact failure D-O was written to prevent.
 *
 * So the assertions are mostly about the seams: that renewal asks nobody
 * anything and is counted, that a refusal happens before the store is read,
 * and that what the page is told is less than what the pane knows.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-app-budget-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const { createInteractionBudget, budgetForPage, DEFAULT_INTERACTION } =
  await load("app/interaction.js");
const { createGrant } = await load("llm/grant.js");
const { dashboardRecord } = await load("dashboard/spec.js");
const { insertData } = await load("mcp/transcript-store.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ═════════════════════════ charged, not consulted ══════════════════════════ */

section("§15 q.3: a page's runs are charged before the call, like the grant's");
{
  const seen = [];
  const b = createInteractionBudget({ maxRuns: 2 }, { onChange: (e) => seen.push(e.type) });
  ok(b.check({ panel: "sales" }).ok, "the first run is allowed");
  ok(b.spent.runs === 1, "and charged before it is made, not after");
  ok(seen.includes("charged"), "with the meter told at once, so it moves while the page runs");
  ok(b.check({ panel: "sales" }).ok && b.spent.runs === 2, "the second");
  const no = b.check({ panel: "sales" });
  ok(!no.ok, "and the third is refused");
  ok(b.spent.runs === 2, "without being charged — a refusal does not cost a run");
  ok(b.exhausted && b.remaining().runs === 0, "the budget is spent");
}

section("the refusal is worded for a reader, not for a log");
{
  const b = createInteractionBudget({ maxRuns: 1 });
  b.check({});
  const why = b.check({}).reason;
  ok(/Nothing is wrong and nothing is lost/.test(why),
     "it says nothing is wrong first, because a reader who thinks they broke something stops");
  ok(/the queries behind it are the ones you approved/.test(why),
     "it says the queries are the ones they approved — this is a meter, not a consent question");
  ok(/allow more/i.test(why), "and it says what to do");
  ok(/\b1 interactive run/.test(why), "naming the number that was spent");
}

section("rows and bytes are charged after, because they are not knowable before");
{
  const b = createInteractionBudget({ maxRuns: 10, maxRows: 100 });
  b.check({});
  b.chargeResult({ rows: 60, bytes: 1000 });
  ok(b.spent.rows === 60 && b.spent.bytes === 1000, "what it actually cost");
  b.check({});
  b.chargeResult({ rows: 60, bytes: 1000 });
  const no = b.check({});
  ok(!no.ok && /has read its 100 rows/.test(no.reason),
     "and a page over the row budget is stopped at the next request, not retrospectively");
  ok(b.spent.runs === 2, "the two runs that did happen are still the two that happened");
}

section("a refresh costs one run per panel");
{
  const b = createInteractionBudget({ maxRuns: 4 });
  ok(b.check({ runs: 3, panel: "(refresh)" }).ok, "a three-panel refresh is allowed");
  ok(b.spent.runs === 3, "and charged three");
  ok(!b.check({ runs: 3 }).ok,
     "so a second one is refused: otherwise the cheapest thing a page can ask for and the "
   + "most expensive would cost the same");
}

/* ══════════════════════════ renewable, and counted ═════════════════════════ */

section("renewal asks nobody anything — and is counted, because the count is the signal");
{
  const b = createInteractionBudget({ maxRuns: 1, renewal: 5 });
  b.check({});
  ok(b.exhausted, "spent");
  const changed = b.renew();
  ok(changed.maxRuns[0] === 1 && changed.maxRuns[1] === 6, "one press adds the renewal amount");
  ok(!b.exhausted && b.check({}).ok, "and the page can ask again");
  ok(b.renewals === 1, "the renewal is counted");
  b.renew(); b.renew();
  ok(b.renewals === 3,
     "three renewals means a page whose shape is wrong, which a larger number would hide");
  ok(b.limits.maxRuns === 16, "and the ceilings are additive");
}

section("renewal is upward only");
{
  const b = createInteractionBudget({ maxRuns: 10 });
  b.renew({ runs: -5 });
  ok(b.limits.maxRuns === 10,
     "a button the user reads as giving more must never quietly give less");
  ok(b.renewals === 0, "and a renewal that changed nothing is not counted as one");
}

/* ══════════════════ the page is told less than the pane knows ══════════════ */

section("what the page is told");
{
  const b = createInteractionBudget({ maxRuns: 4 });
  b.check({});
  const forPage = budgetForPage(b);
  ok(forPage.runs === 1 && forPage.maxRuns === 4 && forPage.remaining === 3,
     "the counts, so a control can be honest about being spent");
  ok(forPage.exhausted === false, "and whether it is");
  ok(!("events" in forPage) && typeof forPage.renew !== "function",
     "and nothing else: a page that could renew its own budget would make the button "
   + "a decoration");
  ok(budgetForPage(null) === null, "and a page with no budget behind it is told nothing");
}

/* ═══════════════════════ not the same thing as a grant ═════════════════════ */

section("the grant screens the model; the budget bounds the page");
{
  const grant = createGrant({ repositories: ["a/b"], maxQueries: 2 });
  const b = createInteractionBudget({ maxRuns: 2 });
  grant.check({ name: "survey", input: { op: "catalog" } });
  ok(grant.spent.queries === 1 && b.spent.runs === 0,
     "a model's call does not spend the page's allowance");
  b.check({ panel: "sales" });
  ok(grant.spent.queries === 1 && b.spent.runs === 1,
     "and a page's run does not spend the model's — a reader turning a selector must not "
   + "exhaust an exploration");
  ok(typeof grant.revoke === "function" && typeof b.renew === "function"
     && b.revoke === undefined,
     "a grant is revoked and widened; a budget is renewed. They are not the same verb");
}

/* ════════════════════════════ in the record ════════════════════════════════ */

section("the record keeps what the page cost, beside what the model was given");
{
  const b = createInteractionBudget({ maxRuns: 5 });
  b.check({ panel: "sales" });
  b.chargeResult({ rows: 12, bytes: 400 });
  b.renew();
  const rec = dashboardRecord(
    { title: "T", html: "<p id=x>x</p>", panels: [], transforms: [], assertions: [] },
    {}, { interaction: b.state() });
  ok(rec.interaction.spent.runs === 1 && rec.interaction.renewals === 1,
     "what it spent and how often it was renewed");
  ok(rec.interaction.limits.maxRuns === 5 + DEFAULT_INTERACTION.renewal,
     "and what it was allowed by the end");

  const update = insertData({
    graph: "http://e/g", exploration: "http://e/x", repository: "a/b",
    run: { id: "r1", prompt: "p", started: new Date(), finished: new Date() },
    exchanges: [], dashboard: { ...rec, disposition: "pending" },
  });
  ok(/mcp:interaction/.test(update), "written as one literal: nothing queries inside a meter reading");
  // Escaped, because it travels as a SPARQL string literal.
  ok(/renewals.{0,3}:1/.test(update), "with the renewal count in it");

  const none = dashboardRecord({ title: "T", html: "<p>x</p>", panels: [], transforms: [],
                                 assertions: [] }, {});
  ok(none.interaction === null,
     "a page nobody interacted with records no meter, rather than a meter reading zero");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
