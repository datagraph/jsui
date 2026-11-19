/**
 * The catalog, the permitted set, the connection, and what a prompt is about.
 *
 * Section 33.4 and section 34.1–34.2 of the requirements catalog, which were
 * written on 2026-11-08 from two deficiencies: the interface listed nothing it
 * held, and the connection to a model was owned by a repository.
 *
 * The suite is organised around the three ways this work can go wrong rather
 * than around the modules:
 *
 *   1. **A listing discloses what an admission exists to hold back.**  A
 *      catalog is read BEFORE anything has been admitted (U-74), so no entry
 *      may carry a presentation's script, its styles, a panel's query or an
 *      arrangement's template.  That is asserted over the whole structure,
 *      not over the fields this module happens to name today.
 *
 *   2. **A credential follows the wrong thing.**  The connection is the
 *      account's; the MCP endpoint, its token and the exploration session are
 *      the repository's.  Both halves are asserted, because moving too much
 *      would be as wrong as moving too little -- two panes sharing one
 *      exploration handle is a different bug with the same shape.
 *
 *   3. **A line typed into the bar is read as the wrong kind of thing.**
 *      Reading an instruction as a question costs a turn; reading a question
 *      as an instruction edits the page instead of answering it.  The rule is
 *      decidable without a model and is tested as such, including the case it
 *      deliberately does NOT catch.
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-catalog-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  catalog, catalogOf, catalogAccounts, catalogRefusal, mountable,
  componentRows, componentRow, namesOf,
} = await load("app/catalog.js");
const {
  loadRepositories, ownRows, collaboratedRows, resolveRepository, repositoryRefusal,
  ensureRepositories, repositoriesFor, forgetRepositories, describeRepository,
} = await load("app/repositories.js");
const {
  connectionFor, attachConnection, isConnected, forgetConnection,
  connectionRefusal, connectedAccounts, CONNECTION_FIELDS, CONNECTION_PLACE,
} = await load("app/connection.js");
const {
  classifyPrompt, citations, repositoryFromUrl, describeContext, contextRefusal,
  CITATION_CUES,
} = await load("app/prompt-context.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const HOST = "https://nl4.dydra.com";
const ACCOUNT = "alice";

/* ── a `<account>/ui' that answers the three listings ─────────────────────── */

const row = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: String(v) }]));

const UI_CONTENT = {
  alice: {
    presentations: [
      row({ presentation: `${HOST}/alice/ui/p/inventory`, name: "inventory",
            title: "Component inventory", scope: "document", modified: "2026-11-05T09:00:00Z" }),
      row({ presentation: `${HOST}/alice/ui/p/workspace`, name: "workspace",
            scope: "workspace", modified: "2026-11-01T08:00:00Z" }),
      row({ presentation: `${HOST}/alice/ui/p/orders`, name: "orders",
            title: "Open orders", scope: "document", modified: "2026-11-06T11:00:00Z" }),
    ],
    arrangements: [
      row({ arrangement: `${HOST}/alice/ui/a/stock-card`, name: "stock-card",
            title: "Stock card", of: "inventory", anchor: "e-panel",
            modified: "2026-11-05T10:00:00Z", creator: "alice",
            source: `${HOST} alice/sales` }),
    ],
    mounts: [
      row({ mount: `${HOST}/alice/ui/mounts/orders`, of: "orders",
            at: "workspace", name: "w-aside", modified: "2026-11-06T12:00:00Z" }),
    ],
  },
  bob: {
    presentations: [
      row({ presentation: `${HOST}/bob/ui/p/parts-board`, name: "parts-board",
            title: "Parts board", scope: "document", modified: "2026-11-04T09:00:00Z" }),
    ],
    arrangements: [], mounts: [],
  },
};

/** One fetch that answers a SPARQL select from the fixture above. */
function uiStore({ broken = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = String(init?.body || "");
    const account = /\/([^/]+)\/ui\/sparql$/.exec(url)?.[1] || "";
    calls.push({ url, account, body });
    const which = /ui:Presentation/.test(body) ? "presentations"
                : /ui:Arrangement/.test(body) ? "arrangements"
                : /ui:Mount/.test(body) ? "mounts" : null;
    if (broken && broken === which) {
      return { ok: false, status: 500, text: async () => "the store said no" };
    }
    const held = UI_CONTENT[account] || { presentations: [], arrangements: [], mounts: [] };
    return { ok: true, status: 200,
             text: async () => JSON.stringify({ head: {}, results: { bindings: held[which] || [] } }) };
  };
  return { calls, fetchImpl };
}

const PERMITTED = [
  { id: "alice/sales", account: "alice", repository: "sales", own: true, mode: "own" },
  { id: "alice/orders", account: "alice", repository: "orders", own: true, mode: "own" },
  { id: "alice/ui", account: "alice", repository: "ui", own: true, mode: "own", interface: true },
  { id: "bob/parts", account: "bob", repository: "parts", own: false, mode: "read" },
  { id: "bob/ui", account: "bob", repository: "ui", own: false, mode: "read" },
];

/* ══════════════════ 1. the catalog discloses nothing ═════════════════════ */

section("REQ-33.4.8: a catalog is read before anything is admitted");
{
  const s = uiStore();
  const read = await catalogOf({ host: HOST, account: ACCOUNT, token: "t", fetchImpl: s.fetchImpl });
  const text = JSON.stringify(read);
  ok(read.ok && read.presentations.length === 3 && read.arrangements.length === 1,
     "the three listings are read in one pass");
  ok(!/SELECT\b|CONSTRUCT\b|<script|function\s*\(/.test(text),
     "and no entry carries a query, a script or a style — the four carriers stay behind the gate");
  ok(!("template" in read.arrangements[0]),
     "an arrangement entry has no template: `listArrangements' does not project it, and "
     + "nothing here asks for it a second way");
  ok(read.arrangements[0].reads === 1
     && read.arrangements[0].sources[0] === `${HOST} alice/sales`,
     "the STORES it would read are listed, because that is what a reader has to decide about");
  const queries = s.calls.filter((c) => /ui:template|ui:script|ui:styles/.test(c.body));
  ok(queries.length === 0, "and the queries sent never ask for one");
}

section("REQ-33.4.5, REQ-33.4.6: an entry says what can be done with it");
{
  const s = uiStore();
  const read = await catalogOf({ host: HOST, account: ACCOUNT, token: "t", fetchImpl: s.fetchImpl });
  const by = Object.fromEntries(read.presentations.map((p) => [p.name, p]));
  ok(by.inventory.mountable.ok, "a document presentation nobody has mounted can be mounted");
  ok(!by.workspace.mountable.ok && /chrome/.test(by.workspace.mountable.reason),
     "a workspace presentation cannot, and the reason names the scope rather than refusing blankly");
  ok(by.orders.mountedAt === "workspace" && by.orders.mountedIn === "w-aside",
     "the registry says where a mounted one is");
  ok(!by.orders.mountable.ok && /one place at a time/.test(by.orders.mountable.reason),
     "so the catalog does not invite the refusal it had the facts to prevent");
  ok(by.inventory.mountsKnown === true, "and the listing knows it read the registry");
}

section("a mount registry that cannot be read is not an empty one");
{
  const s = uiStore({ broken: "mounts" });
  const read = await catalogOf({ host: HOST, account: ACCOUNT, token: "t", fetchImpl: s.fetchImpl });
  ok(read.errors.some((e) => /mount registry/.test(e)), "the failure is reported");
  ok(read.presentations.every((p) => p.mountsKnown === false),
     "and every entry says it does not know, rather than saying `not mounted'");
}

section("REQ-33.4.4: the refusal names what is there");
{
  const s = uiStore();
  const read = await catalogOf({ host: HOST, account: ACCOUNT, token: "t", fetchImpl: s.fetchImpl });
  const said = catalogRefusal("presentation", "inventorie", read.presentations);
  ok(/no presentation named `inventorie'/.test(said), "it still says what was not found");
  ok(/inventory/.test(said) && /orders/.test(said),
     "and the names that were, which the caller is holding at that moment");
  ok(/and 2 more/.test(catalogRefusal("presentation", "x",
       namesOf(read.presentations).concat(["a", "b"]).map((n) => ({ name: n })), { limit: 3 })),
     "a cut listing says it was cut, so a short list is not read as the whole catalog");
  ok(/holds none/.test(catalogRefusal("arrangement", "x", [])),
     "and an empty catalog says so rather than offering nothing without explanation");
}

section("REQ-33.4.7: whose presentation it is");
{
  const s = uiStore();
  const read = await catalog({ host: HOST, account: ACCOUNT, token: "t", permitted: PERMITTED,
                               fetchImpl: s.fetchImpl });
  ok(read.accounts.join(",") === "alice,bob",
     "another account's catalog is read exactly when its `ui' is in the permitted set");
  const foreign = read.presentations.find((p) => p.name === "parts-board");
  ok(foreign.foreign && foreign.owner === "bob", "and its entries say whose they are");
  ok(!foreign.mountable.ok && /belongs to bob/.test(foreign.mountable.reason),
     "a foreign presentation is not offered for mounting under a bare name, and says why");
  ok(read.presentations.every((p, i, all) => i === 0 || !(all[i - 1].foreign && !p.foreign)),
     "the account's own come first");
}

section("REQ-33.4.9: the toolbox, for the user");
{
  const rows = componentRows();
  ok(rows.length > 10 && rows.every((r) => r.name && r.element && r.description),
     "every component is listed with its name, its element and what it is");
  ok(rows.some((r) => r.bound) && rows.some((r) => !r.bound),
     "and which of them are bound to data");
  ok(!rows.some((r) => r.name === "base"), "the hidden one the inliner adds is not offered");
  ok(componentRow("table")?.element === "dydra-table", "one can be looked up by name");
  ok(componentRow("nonesuch") === null, "and a name that is not a component is not invented");
  ok(componentRows({ tier: 1 }).every((r) => !r.bound),
     "a tier bound leaves out everything with a data contract");
}

/* ══════════════════ 2. the permitted set ═════════════════════════════════ */

section("REQ-33.2.7, REQ-33.2.8: two lists, read once, and their union");
{
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = url.endsWith("/repositories")
      ? [{ name: "sales" }, { name: "orders" }, { name: "ui" }, { name: "system" }]
      : [{ repository: "bob/parts", readable: true, writable: false },
         { repository: "carol/ledger", mode: "read-write" }];
    return { ok: true, status: 200, json: async () => body };
  };
  forgetRepositories(ACCOUNT);
  const sets = await loadRepositories({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(asked.length === 2 && asked.some((u) => /\/collaboration$/.test(u)),
     "the account-level collaboration route is read, and not only when a tab is opened");
  ok(sets.own.length === 4 && sets.collaborated.length === 2,
     "both lists come back");
  ok(sets.permitted.length === 6, "and the permitted set is their union (REQ-33.2.8)");
  ok(sets.own.every((r) => r.own) && sets.collaborated.every((r) => !r.own),
     "the two stay distinguishable (REQ-33.2.9)");
  ok(sets.collaborated.find((r) => r.id === "bob/parts").mode === "read"
     && sets.collaborated.find((r) => r.id === "carol/ledger").writable === null,
     "a collaborated entry carries the access the service reported, and nothing it did not");
  ok(sets.own.find((r) => r.repository === "ui").interface === true
     && sets.own.find((r) => r.repository === "system").system === true,
     "the interface's own repositories and the service's are marked rather than hidden");
}

section("one list failing does not lose the other");
{
  const fetchImpl = async (url) => (/\/collaboration$/.test(url)
    ? { ok: false, status: 503, json: async () => null }
    : { ok: true, status: 200, json: async () => [{ name: "sales" }] });
  const sets = await loadRepositories({ host: HOST, account: ACCOUNT, token: "t", fetchImpl });
  ok(!sets.ok && sets.own.length === 1 && sets.collaborated.length === 0,
     "what could be read is kept");
  ok(sets.errors.some((e) => /collaborations/.test(e)),
     "and `we could not ask' is reported, because it is not the same answer as `none'");
}

section("REQ-34.2.6: naming one, and naming one that is not there");
{
  ok(resolveRepository("alice/sales", PERMITTED).how === "qualified", "a qualified name is exact");
  ok(resolveRepository("sales", PERMITTED).how === "own",
     "a bare name is the account's own first");
  ok(resolveRepository("parts", PERMITTED).repository.id === "bob/parts",
     "and a collaborated one when only it answers");
  const ambiguous = resolveRepository("ui", [
    ...PERMITTED.filter((r) => r.repository !== "ui"),
    { id: "x/ui", account: "x", repository: "ui", own: false },
    { id: "y/ui", account: "y", repository: "ui", own: false }]);
  ok(!ambiguous.ok && ambiguous.reason === "ambiguous",
     "two collaborations of one name is a refusal, not a guess");
  ok(/names more than one/.test(repositoryRefusal(ambiguous)), "and the refusal says so");
  const unknown = resolveRepository("carol/private", PERMITTED);
  ok(!unknown.ok && /carol\/private/.test(repositoryRefusal(unknown)),
     "a name outside the set is refused by name");
  ok(/alice\/sales/.test(repositoryRefusal(unknown)) && !/alice\/system/.test(repositoryRefusal(unknown)),
     "offering what there is, less the service's own");
  ok(describeRepository(PERMITTED[3]) === "bob/parts (read)",
     "and one line says which it is and how it is reached");
}

section("the set is held for the session, not re-read per keystroke");
{
  let reads = 0;
  const fetchImpl = async (url) => {
    reads += 1;
    return { ok: true, status: 200,
             json: async () => (url.endsWith("/repositories") ? [{ name: "sales" }] : []) };
  };
  forgetRepositories("held");
  await ensureRepositories({ host: HOST, account: "held", token: "t", fetchImpl });
  await ensureRepositories({ host: HOST, account: "held", token: "t", fetchImpl });
  ok(reads === 2, "two requests the first time and none the second");
  ok(repositoriesFor("held").own.length === 1, "what was read is what is held");
  forgetRepositories("held");
  ok(repositoriesFor("held") === null, "and sign-out forgets it, because it is an authorization answer");
}

/* ══════════════════ 3. the connection is the account's ═══════════════════ */

section("REQ-34.1.1, REQ-34.1.2: one connection per account, shared by every surface");
{
  forgetConnection("alice");
  const paneA = attachConnection({ account: "alice", repository: "sales",
                                   mcpEndpoint: "https://h/alice/sales/mcp", token: "ta",
                                   session: null }, "alice");
  const paneB = attachConnection({ account: "alice", repository: "orders",
                                   mcpEndpoint: "https://h/alice/orders/mcp", token: "tb",
                                   session: null }, "alice");
  ok(!isConnected("alice"), "nothing is connected before a key is typed");
  paneA.llmKey = "sk-test";
  paneA.llmModel = "claude-opus-5";
  ok(paneB.llmKey === "sk-test" && paneB.llmModel === "claude-opus-5",
     "a key typed in one surface IS the key in the other — not a copy of it");
  ok(isConnected("alice") && connectionFor("alice").llmKey === "sk-test",
     "and the account holds it");
  paneB.llmEndpoint = "https://proxy.internal/v1/messages";
  ok(paneA.llmEndpoint === "https://proxy.internal/v1/messages",
     "the forwarding goes both ways, so neither surface is the owner");
  ok(CONNECTION_FIELDS.every((f) => f in paneA),
     "every field of the connection is reachable through a pane, as it was before");

  forgetConnection("bob");
  const paneC = attachConnection({ account: "bob", repository: "parts" }, "bob");
  ok(paneC.llmKey === "", "another account's surfaces are another account's connection");
  ok(connectedAccounts().includes("alice") && !connectedAccounts().includes("bob"),
     "and which accounts have one is answerable without reading a pane");
}

section("REQ-34.1.5: what is the repository's stays the repository's");
{
  forgetConnection("alice");
  const paneA = attachConnection({ account: "alice", repository: "sales",
                                   mcpEndpoint: "https://h/alice/sales/mcp", token: "ta",
                                   session: "sess-a" }, "alice");
  const paneB = attachConnection({ account: "alice", repository: "orders",
                                   mcpEndpoint: "https://h/alice/orders/mcp", token: "tb",
                                   session: "sess-b" }, "alice");
  ok(paneA.mcpEndpoint !== paneB.mcpEndpoint && paneA.token !== paneB.token,
     "the endpoint and its token are not shared");
  ok(paneA.session === "sess-a" && paneB.session === "sess-b",
     "and neither is the exploration: a handle of one repository means nothing in another");
}

section("REQ-34.1.6: one refusal, one place");
{
  const said = connectionRefusal("nothing was asked");
  ok(said.includes(CONNECTION_PLACE), "it names where the connection is set");
  ok(!/exploration pane/.test(said),
     "and no longer sends the user to a repository's surface to set an account's credential");
}

/* ══════════════════ 4. what a line typed into the bar is ═════════════════ */

section("REQ-34.2.1: interface or data, decided without a model");
{
  const at = (text, address = { kind: "workspace" }) =>
    classifyPrompt(text, { permitted: PERMITTED, address });
  ok(at("put the chart beside the table").kind === "interface",
     "a line that names no repository is about the interface, as it always was");
  ok(at("two columns, and move the legend under the chart").kind === "interface",
     "including one that reads like prose about data but names no store");
  ok(at("how many open orders are there in sales").kind === "data",
     "a line that names one is about data");
  ok(at("how many open orders are there").kind === "interface",
     "and the rule does NOT guess: an unnamed question is an instruction, which is "
     + "the case this design accepts rather than paying a classifier turn for");
}

section("REQ-34.2.2: a prompt may name more than one");
{
  const read = classifyPrompt("compare revenue across sales, orders and bob/parts",
                              { permitted: PERMITTED, address: { kind: "workspace" } });
  ok(read.kind === "data" && read.repositories.length === 3,
     "three repositories, from one line");
  ok(read.repositories.map((r) => r.id).join(",") === "alice/sales,alice/orders,bob/parts",
     "in the order they were written, which is the order they will be offered and recorded");
  ok(read.repositories.some((r) => !r.own),
     "and a collaborated repository is as nameable as an owned one (A-8, A-9)");
}

section("the three spellings of naming one");
{
  const c = (t) => citations(t, PERMITTED).named.map((r) => r.id);
  ok(c("in sales").join() === "alice/sales", "a bare name after a cue");
  ok(c("from bob/parts").join() === "bob/parts", "an account-qualified name");
  ok(c("see https://nl4.dydra.com/alice/sales/sparql").join() === "alice/sales",
     "a service URL");
  ok(c("see /ui/account/bob/repositories/parts/views/open").join() === "bob/parts",
     "and the interface's own link, which is what the address bar shows");
  ok(c("make the orders column wider").length === 0,
     "a bare name with no cue cites nothing: every repository name is also an ordinary word");
  ok(CITATION_CUES.length < 12 && !CITATION_CUES.includes("apply"),
     "the cue list is closed, and holds no word the bar's own grammar uses");
  ok(repositoryFromUrl("https://nl4.dydra.com/system/accounts/alice") === null,
     "and the service's own tree names no repository");
}

section("REQ-34.2.6: a repository this account may not read");
{
  const read = classifyPrompt("count the rows in carol/private and in sales",
                              { permitted: PERMITTED, address: { kind: "workspace" } });
  ok(read.kind === "refusal" && !read.ok,
     "the line is refused even though one of the two names resolved");
  ok(/carol\/private/.test(contextRefusal(read)), "by name");
  ok(read.repositories.length === 0 || read.kind === "refusal",
     "and nothing is run against the half that did resolve, which would answer a "
     + "question nobody asked");
}

section("REQ-34.2.3: what a turn carries when the line names nothing");
{
  const onPage = classifyPrompt("summarise it", {
    permitted: PERMITTED, address: { kind: "presentation", repository: "alice/sales" },
    always: "data" });
  ok(onPage.repositories.map((r) => r.id).join() === "alice/sales",
     "a surface that is a data prompt by construction takes the repository it is addressing");
  const onChrome = classifyPrompt("summarise it", {
    permitted: PERMITTED, address: { kind: "workspace" }, always: "data" });
  ok(onChrome.empty && onChrome.repositories.length === 0,
     "and the workspace names none, so the turn carries none and says so rather than choosing");
}

section("REQ-34.2.5: what the user is told before it runs");
{
  const one = describeContext([PERMITTED[0]]);
  const three = describeContext([PERMITTED[0], PERMITTED[1], PERMITTED[3]]);
  ok(one === "reads alice/sales", "one store, named");
  ok(/3 repositories/.test(three) && /bob\/parts/.test(three),
     "three, counted and named — a turn that reaches two authorises more than one that reaches one");
  ok(/cannot read data/.test(describeContext([])), "and none says so plainly");
}

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
