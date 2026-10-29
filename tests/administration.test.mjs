/**
 * Roles, the account listing, lifecycle events and the budgets that refuse.
 *
 * These are the [incomplete] requirements of sections 1-4 and REQ-23.1.4,
 * reduced to the parts that can be decided without a server: who the agent
 * is, what the interface may therefore offer, what a listing row holds, how
 * an event is read, and whether a prompt may be sent.
 *
 * Two of the assertions below are regressions in the strict sense -- they
 * fail against the code as it stood:
 *
 *   - the history table read `e.actor'; every event the server has ever sent
 *     carries `agent'.  Every Actor cell was empty, and an empty cell reads
 *     as "no agent recorded" rather than as a bug, which is why it survived.
 *   - the admin flag was read in one expression inside the admin app's login
 *     handler, so the user app could not tell an administrator from anyone
 *     else, and neither app could tell you why it had decided.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-admin-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const roles = await load("models/roles.js");
const history = await load("models/history.js");
const accounts = await load("models/accounts.js");
const collab = await load("models/collaboration.js");
const budget = await load("llm/budget.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ═══════════════════ REQ-1.1.5 — the administrator flag ═══════════════════ */

section("REQ-1.1.5: the admin flag is `administrator_of' in the account metadata");
{
  ok(roles.isAdministrator({ administrator_of: "http://dydra.com" }),
     "a single IRI naming the service sets it");
  ok(roles.isAdministrator({ administrator_of: ["http://elsewhere", "http://dydra.com"] }),
     "so does one among several — the value is a list when there is more than one");
  ok(!roles.isAdministrator({ administrator_of: "http://elsewhere" }),
     "administering some other service is not administering this one");
  ok(!roles.isAdministrator({}) && !roles.isAdministrator(null),
     "absent, and no configuration at all, both mean no");
  ok(!roles.isAdministrator({ administrator_of: "" }),
     "an empty value is absent, not a wildcard");
  ok(roles.isAdministrator({ administrator_of: "http://dydra.com/" })
     && roles.isAdministrator({ administrator_of: "HTTP://Dydra.com" }),
     "a trailing slash and a different case name the same service");
  ok(roles.administratorOf({ administrator_of: ["a", "b"] }).length === 2,
     "the list is reported as given, for an interface that wants to show it");
}

section("REQ-1.1.6 is rescinded: nothing here derives a role from system/system");
{
  const names = Object.values(roles.ROLES);
  ok(!names.includes("manager"),
     "there is no manager role — read/write on system/system no longer implies one");
  ok(names.length === 3 && names.includes("administrator") && names.includes("owner"),
     "three roles: administrator, owner, user");
}

/* ═════════════════ REQ-2.6.1, 3.9.1, 3.9.2, 4.5.1 — controls ══════════════ */

section("what the interface offers follows from the role, and excludes self-deletion");
{
  const admin = roles.agentRole({ configuration: { administrator_of: "http://dydra.com" },
                                  accountName: "root" });
  const owner = roles.agentRole({ configuration: {}, accountName: "james" });

  ok(admin.administrator && admin.role === "administrator", "the flag gives the role");
  ok(owner.role === "owner", "without it, an agent is the owner of its own account");

  ok(admin.mayDeleteAccount("james"), "REQ-2.6.1: an administrator may delete another account");
  ok(!admin.mayDeleteAccount("root"),
     "REQ-2.6.1: and may not delete the account it is authenticated as — "
   + "there is no way back from deleting the credential you are holding");
  ok(!owner.mayDeleteAccount("someone"), "an owner may not delete accounts at all");

  ok(admin.mayDeleteRepository("james") && admin.mayDeleteRepository("anyone"),
     "REQ-3.9.1: an administrator may delete any repository");
  ok(owner.mayDeleteRepository("james"), "REQ-3.9.2: an owner may delete its own");
  ok(!owner.mayDeleteRepository("someone-else"), "and not another account's");

  ok(owner.mayDeleteView("james") && !owner.mayDeleteView("someone-else"),
     "REQ-4.5.1: views follow the repository, so the repository's owner");

  ok(admin.mayListAllAccounts && !owner.mayListAllAccounts,
     "REQ-2.4.4: the listing is everyone's for an administrator and not for anyone else");
}

/* ═══════════════ REQ-2.5.x / 3.8.x / 4.4.x — reading an event ═════════════ */

section("the event field is `agent' — the renderer read `actor', which no event has");
{
  const served = { timestamp: "2026-10-20T11:00:00Z", action: "CreateRepositoryEvent",
                   agent: "james", details: "test/foaf" };
  const e = history.normalizeEvent(served);
  ok(e.agent === "james",
     "REGRESSION: the server sends `agent'; reading `actor' left every cell empty");
  ok(history.normalizeEvent({ actor: "old" }).agent === "old",
     "and an `actor' from an older response or a fixture is still read");
  ok(e.timestamp === served.timestamp && e.details === "test/foaf",
     "the other three fields pass through");
  ok(history.normalizeEvent({}).agent === "" && history.normalizeEvent(null).action === "",
     "a missing field is an empty string, never undefined in the markup");
}

section("an action says what happened, in the rails-shaped spelling");
{
  ok(history.describeAction("AccountCreatedEvent") === "Account created",
     "noun first, participle second — `events.type' is a rails STI class name");
  ok(history.describeAction("RepositoryUpdatedEvent") === "Repository modified",
     "Updated → modified, which is the word the requirements use");
  ok(history.describeAction("RepositoryClearedEvent") === "Repository cleared",
     "REQ-3.6.2: a clear is its own event now, and rails already has the class");
  ok(history.describeAction("RepositoryImportedEvent") === "Repository imported into",
     "REQ-3.8.1: and so is an import");
  ok(history.describeAction("QueryDeletedEvent") === "View deleted",
     "the service's `Query' is this interface's `view'");
  ok(history.describeAction("SomethingElseEvent") === "SomethingElseEvent",
     "a type this interface has not seen is shown raw rather than dropped");
  ok(history.parseAction("QueryCreatedEvent").subject === "view"
     && history.parseAction("nonsense").action === null,
     "the parse reports failure rather than guessing");
}

section("the verb-first spelling a development host still holds is read too");
{
  ok(history.describeAction("CreateAccountEvent") === "Account created",
     "`CreateAccountEvent' was what the service wrote before 2026-10-23");
  ok(history.describeAction("DeleteQueryEvent") === "View deleted", "and so was this");
  ok(history.parseAction("UpdateRepositoryEvent").legacy === true
     && history.parseAction("RepositoryUpdatedEvent").legacy === false,
     "and the two spellings are distinguishable, so a reader can tell which host "
   + "wrote a row");
  ok(history.parseAction("ClearRepositoryEvent").action === null,
     "there is no legacy clear or import: nothing ever wrote one");
}

section("the full matrix, so a missing rails class is at least predictable");
{
  const subjects = ["Account", "Repository", "Query"];
  const every = subjects.flatMap((n) => history.ACTIONS.map((a) => `${n}${a}Event`));
  ok(every.length === 15, "five actions by three subjects");
  ok(every.every((t) => history.parseAction(t).action !== null),
     "every one of the fifteen parses");
  ok(["RepositoryCreatedEvent", "RepositoryClearedEvent", "RepositoryImportedEvent",
      "QueryCreatedEvent"].every((t) => every.includes(t)),
     "including the four rails already defines classes for");
}

section("events are ordered newest first, and creation is the earliest Create");
{
  const events = [
    { timestamp: "2026-10-01T00:00:00Z", action: "AccountCreatedEvent", agent: "root" },
    { timestamp: "2026-10-20T00:00:00Z", action: "AccountUpdatedEvent", agent: "james" },
    { timestamp: "2026-10-10T00:00:00Z", action: "AccountUpdatedEvent", agent: "james" },
  ];
  const sorted = history.normalizeEvents(events);
  ok(sorted[0].timestamp === "2026-10-20T00:00:00Z", "newest first");
  ok(history.createdAt(events) === "2026-10-01T00:00:00Z",
     "creation is the earliest Create, not the newest event");
  ok(history.lastEventAt(events) === "2026-10-20T00:00:00Z", "last use is the newest of any kind");
  ok(history.createdAt([]) === null && history.lastEventAt([]) === null,
     "and nothing recorded is null, not a fabricated date");
  ok(history.normalizeEvents("not an array").length === 0,
     "a response that is not an array is no events, not a throw");
}

section("the history paths and their filters (REQ-2.5.4, 3.8.4, 4.4.3)");
{
  ok(history.historyPath({ account: "james" }) === "/system/accounts/james/history",
     "account");
  ok(history.historyPath({ account: "james", repository: "foaf" })
     === "/system/accounts/james/repositories/foaf/history", "repository");
  ok(history.historyPath({ account: "james", repository: "foaf", view: "people" })
     === "/system/accounts/james/repositories/foaf/views/people/history", "view");
  ok(history.historyPath({ account: "a b", repository: "c/d" })
     === "/system/accounts/a%20b/repositories/c%2Fd/history",
     "every segment is encoded — a view name can carry a slash");
  ok(history.historyQuery({ type: "Create*" }) === "?type=Create%25",
     "a shell wildcard becomes the SQL one the server matches with");
  ok(history.historyQuery({ first: "2026-01-01", last: "2026-12-31" })
     === "?first=2026-01-01&last=2026-12-31", "the date boundaries pass through");
  ok(history.historyQuery({}) === "",
     "no filter is an empty string, so a caller may always concatenate");
}

/* ═══════════════════ REQ-2.4.1 … 2.4.4 — the listing ══════════════════════ */

section("REQ-2.4.1: a row out of each of the three shapes the listing answers");
{
  ok(accounts.accountRows(["james", "test"]).length === 2, "an array of names");
  ok(accounts.accountRows([{ name: "james" }, { id: "test" }]).length === 2,
     "an array of objects, under either key");
  ok(accounts.accountRows({ james: {}, test: {} }).length === 2, "an object keyed by name");
  ok(accounts.accountRows(["james", "james"]).length === 1, "duplicates collapse");
  ok(accounts.accountRows([null, "", { }]).length === 0, "nothing nameless becomes a row");
  ok(accounts.accountRows(["james"])[0].pending === true,
     "a row from the listing alone is PENDING — the other three columns are not in it");
}

section("S-1: the listing now carries the three derived columns itself");
{
  const served = accounts.accountRows([
    { id: "james", uri: "http://dydra.com/james", readable: true, writable: true,
      created: "2026-01-01T00:00:00Z", lastUsed: "2026-10-20T00:00:00Z", repositories: 3 },
  ]);
  ok(served[0].name === "james", "the name is the `id' dimension, as for repositories");
  ok(served[0].created === "2026-01-01T00:00:00Z" && served[0].lastUsed === "2026-10-20T00:00:00Z",
     "creation and last use come from the response when the service fills them");
  ok(served[0].repositories === 3, "so does the repository count");
  ok(served[0].pending === false, "and such a row needs no enrichment pass");

  const bare = accounts.accountRows([{ id: "old", uri: "http://dydra.com/old" }]);
  ok(bare[0].created === null && bare[0].pending === true,
     "S-2: an account older than the event record has no creation time, and the "
   + "service omits the key rather than inventing one — the row stays pending");
}

section("REQ-2.4.2: the three columns are still derivable client-side");
{
  const row = accounts.accountRow("james");
  const filled = accounts.enrichAccount(row, {
    events: [{ timestamp: "2026-01-01T00:00:00Z", action: "AccountCreatedEvent" },
             { timestamp: "2026-10-20T00:00:00Z", action: "AccountUpdatedEvent" }],
    repositories: ["foaf", "test", "mcp"],
  });
  ok(filled.created === "2026-01-01T00:00:00Z", "creation from the CreateAccountEvent");
  ok(filled.lastUsed === "2026-10-20T00:00:00Z", "last use from the most recent event");
  ok(filled.repositories === 3, "repository count from the repositories listing");
  ok(filled.pending === false, "and the row is no longer pending");
  ok(accounts.enrichAccount(row, {}).repositories === null,
     "with nothing fetched the count is null — which is not zero");
}

section("REQ-2.4.3: ordered by any field, with the unfetched sorting last both ways");
{
  const rows = [
    { name: "zeta", created: "2026-01-01", lastUsed: "2026-10-01", repositories: 1 },
    { name: "alpha", created: "2026-05-01", lastUsed: "2026-10-20", repositories: 9 },
    { name: "mid", created: null, lastUsed: null, repositories: null },
  ];
  ok(accounts.sortAccounts(rows, "name").map((r) => r.name).join() === "alpha,mid,zeta",
     "by name");
  ok(accounts.sortAccounts(rows, "repositories", "desc")[0].name === "alpha",
     "by repository count, descending — a number compares as a number");
  ok(accounts.sortAccounts(rows, "created")[0].name === "zeta", "by creation");
  ok(accounts.sortAccounts(rows, "lastUsed", "desc")[0].name === "alpha", "by last use");
  ok(accounts.sortAccounts(rows, "repositories", "asc").at(-1).name === "mid"
     && accounts.sortAccounts(rows, "repositories", "desc").at(-1).name === "mid",
     "a null sorts LAST in both directions — an unfetched count is not zero, and "
   + "ascending would otherwise put every unfetched account first");
  ok(accounts.sortAccounts(rows, "nonsense")[0].name === "alpha",
     "an unknown field falls back to the name rather than returning nothing");
  const frozen = [...rows];
  accounts.sortAccounts(rows, "name");
  ok(rows[0] === frozen[0], "the input is not sorted in place");
}

section("REQ-2.4.4: who appears");
{
  const rows = accounts.accountRows(["james", "test", "other"]);
  ok(accounts.visibleAccounts(rows, { administrator: true }).length === 3,
     "an administrator sees all of them");
  ok(accounts.visibleAccounts(rows, { accountName: "james" }).map((r) => r.name).join()
     === "james", "anyone else sees their own");
  ok(accounts.visibleAccounts(rows, { accountName: "james", collaborations: ["test"] })
     .map((r) => r.name).join() === "james,test",
     "plus the accounts they collaborate with");
  ok(accounts.visibleAccounts(rows, { accountName: "james", collaborations: ["absent"] })
     .length === 1,
     "a collaboration the server did not list stays absent — this narrows, never widens");
}

/* ══════════════════════ REQ-2.1.2 — collaborations ════════════════════════ */

section("REQ-2.1.2: the repositories an account reaches that it does not own");
{
  const rows = collab.collaborationRows(
    [{ repository: "other/foaf" }, { repository: "third/data" }, { repository: "james/own" }],
    { accountName: "james" });
  ok(rows.length === 2, "the account's own repository is not indirect metadata");
  ok(rows[0].account === "other" && rows[0].repository === "foaf",
     "the identifier splits into the owning account and the repository");
  ok(rows[0].mode === null,
     "an entry with no mode field reports null — an older service, and the "
   + "table must show that as unknown rather than as read-only");
  ok(collab.collaborationRows(["a/b"]).length === 1, "a bare string is accepted too");
  ok(collab.collaborationRows([{ repository: "malformed" }]).length === 0,
     "an identifier that is not owner/name is dropped rather than half-parsed");
  ok(collab.collaboratingAccounts(rows).join() === "other,third",
     "and the accounts behind them feed REQ-2.4.4");
  ok(collab.collaborationPath("a b") === "/system/accounts/a%20b/collaboration",
     "the path is built in one place");
}

section("S-5: the access mode, now that the service reports it");
{
  const named = collab.collaborationRows([{ repository: "o/r", mode: "read-write",
                                            readable: true, writable: true }]);
  ok(named[0].mode === "read-write", "the service's own one-word summary is preferred");
  ok(named[0].readable === true && named[0].writable === true, "and both flags are kept");

  const flags = collab.collaborationRows([{ repository: "o/r", readable: true,
                                            writable: false }]);
  ok(flags[0].mode === "read", "with no summary the mode is derived from the flags");
  ok(collab.collaborationRows([{ repository: "o/r", readable: true, writable: true }])[0]
     .mode === "read-write", "write implies read-write");
  ok(collab.collaborationRows([{ repository: "o/r", readable: false, writable: false }])[0]
     .mode === "none", "and both false is a recorded `none', not an unknown");

  ok(collab.collaborationRows([{ repository: "o/r", readable: "false", writable: "false" }])[0]
     .mode === "none",
     "a boolean that arrived as a string is compared, not coerced — \"false\" is truthy");
  ok(collab.collaborationRows([{ repository: "o/r" }])[0].mode === null,
     "and an older service that sends neither stays unknown");
}

/* ══════════════════════ REQ-23.1.4 — budgets refuse ═══════════════════════ */

section("REQ-23.1.4: the prompt budget refuses instead of only measuring");
{
  const small = budget.promptVerdict("x".repeat(1000));
  ok(small.ok && small.level === "ok", "a small prompt passes with nothing said");
  const warn = budget.promptVerdict("x".repeat(100000));
  ok(warn.ok && warn.level === "warned" && /%/.test(warn.reason),
     "a large one passes and says what share of the ceiling it took");
  const over = budget.promptVerdict("x".repeat(200000));
  ok(!over.ok && over.level === "refused", "an oversized one is REFUSED, not logged");
  ok(/Nothing was sent/.test(over.reason),
     "and the refusal says nothing was sent, since the cost is the point");
  ok(/catalog/.test(over.reason) && /grant/.test(over.reason),
     "it names the two things that are actually adjustable");
  ok(budget.promptVerdict("x".repeat(100), { ceiling: 50 }).ok === false,
     "the ceiling is the caller's to set");
  ok(budget.promptVerdict("abcd").tokens === 1,
     "the token figure is an estimate for display; the verdict is on characters");
}

section("REQ-23.1.4: an answer cut at the ceiling is refused, not annotated");
{
  const cut = budget.answerVerdict({ stopReason: "max_tokens", text: "<html>…",
                                     maxTokens: 8192 });
  ok(!cut.ok && cut.truncated, "max_tokens is a refusal");
  ok(/still renders/.test(cut.reason),
     "because the thing being refused is markup, and half of it renders");
  ok(!budget.answerVerdict({ stopReason: "length", text: "x" }).ok
     && !budget.answerVerdict({ stopReason: "incomplete", text: "x" }).ok,
     "the other providers' spellings of the same event are refused too");
  ok(budget.answerVerdict({ stopReason: "end_turn", text: "done" }).ok,
     "a complete answer passes");
  const empty = budget.answerVerdict({ stopReason: "end_turn", text: "" });
  ok(!empty.ok && !empty.truncated,
     "and no text at all is its own refusal — a different event from being cut off");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
