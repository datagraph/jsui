/**
 * The administrative interface, in a real browser.
 *
 * `tests/administration.test.mjs' asserts the rules; this asserts what the
 * reader is shown — which is where the two failures these requirements were
 * written against actually lived:
 *
 *   - the events table read `e.actor' and the server sends `agent', so every
 *     Agent cell was empty and looked like "nothing recorded";
 *   - the delete controls were drawn unconditionally, in six templates, so a
 *     user was shown a trash can on repositories they cannot delete.
 *
 * Both are DOM facts, not logic facts, so neither could be caught above.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".json": "application/json" };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>administration</title>
<body>
<div id="events"></div>
<div id="collaboration"></div>
<div id="controls">
  <button class="repo-delete-btn" data-account="james" data-repository="foaf">x</button>
  <button class="repo-delete-btn" data-account="other" data-repository="theirs">x</button>
  <button class="view-delete-btn" data-account="james" data-view="people">x</button>
  <button class="view-delete-btn" data-account="other" data-view="theirs">x</button>
  <button class="account-delete-btn" data-account="james">x</button>
  <button class="account-delete-btn" data-account="other">x</button>
  <button class="repo-delete-btn">nameless</button>
</div>
<script type="module">
import { renderHistoryTable, renderCollaborationTable } from "/ui/components/history-table.js";
import { applyDeletionPermissions } from "/ui/components/deletion-controls.js";
import { agentRole } from "/lib/models/roles.js";

window.__render = (events) => {
  document.getElementById("events").innerHTML = renderHistoryTable(events);
};
window.__collab = (rows, accountName) => {
  document.getElementById("collaboration").innerHTML =
    renderCollaborationTable(rows, { accountName, basePath: "" });
};
window.__strip = (configuration, accountName) =>
  applyDeletionPermissions(document.getElementById("controls"),
                           agentRole({ configuration, accountName }));
window.__ready = true;
</script>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__harness") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HARNESS);
    return;
  }
  const file = join(ROOT, normalize(path.slice(1)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found: " + path); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => { fail++; console.log("  FAIL page error: " + e.message); });
await page.goto(`http://127.0.0.1:${port}/__harness`);
await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });

const SERVED = [
  { timestamp: "2026-10-20T09:00:00Z", action: "CreateRepositoryEvent",
    agent: "james", details: "james/foaf" },
  { timestamp: "2026-10-21T09:00:00Z", action: "DeleteQueryEvent",
    agent: "root", details: "people" },
];

console.log("\nthe events table shows the agent the server actually sent");
{
  await page.evaluate((e) => window.__render(e), SERVED);
  const agents = await page.locator('[data-testid="history-table"] td[data-agent]')
    .allTextContents();
  ok(agents.join("|") === "root|james",
     "REGRESSION: every Agent cell was empty, because the column read `actor'");
  const heading = await page.locator('[data-testid="history-table"] th').nth(2).textContent();
  ok(heading.trim() === "Agent", "and the heading is the word the requirement uses");
  const actions = await page.locator('[data-testid="history-table"] td[data-action]')
    .allTextContents();
  ok(actions[0].trim() === "View deleted" && actions[1].trim() === "Repository created",
     "the action is readable, newest first");
  const raw = await page.locator('[data-testid="history-table"] td[data-action]')
    .first().getAttribute("data-action");
  ok(raw === "DeleteQueryEvent",
     "and the server's own token stays on the cell, so the record can be checked");
}

console.log("\nan empty history says so rather than drawing an empty table");
{
  await page.evaluate(() => window.__render([]));
  ok(await page.locator('[data-testid="history-table"]').count() === 0,
     "no table");
  ok((await page.locator("#events").textContent()).includes("No events recorded"),
     "a sentence instead");
}

console.log("\nthe collaborations table (REQ-2.1.2)");
{
  await page.evaluate(() => window.__collab(
    [{ repository: "other/foaf" }, { repository: "james/own" }], "james"));
  const rows = await page.locator("[data-collaboration]").allTextContents();
  ok(rows.length === 1, "the account's own repository is not shown as a collaboration");
  ok(rows[0].includes("other") && rows[0].includes("foaf"), "the owner and the repository");
  ok((await page.locator("#collaboration").textContent()).includes("not whether the access"),
     "against a service that does not report the mode, the table says so rather "
   + "than drawing a column it would have to guess at");
  ok(await page.locator("[data-mode]").count() === 0, "and draws no Access column");
}

console.log("\nS-5: the Access column appears once the service reports the mode");
{
  await page.evaluate(() => window.__collab(
    [{ repository: "other/foaf", mode: "read-write", readable: true, writable: true },
     { repository: "third/data", mode: "read", readable: true, writable: false }], "james"));
  const modes = await page.locator("[data-mode]").allTextContents();
  ok(modes.join("|") === "read-write|read", "one cell per row, as the service said it");
  const heads = await page.locator('[data-testid="collaboration-table"] th').allTextContents();
  ok(heads.map((h) => h.trim()).join("|") === "Owner|Repository|Access",
     "and the column is headed Access");
  ok(!(await page.locator("#collaboration").textContent()).includes("not whether the access"),
     "the note about not knowing is gone, because now it does");
}

console.log("\ndelete controls follow the role (REQ-2.6.1, 3.9.1, 3.9.2, 4.5.1)");
{
  const asUser = await page.evaluate(() => window.__strip({}, "james"));
  ok(asUser.kept.length === 2,
     "an owner keeps the two controls on their own account");
  ok(asUser.kept.every((k) => k.account === "james"),
     "and loses every control on another account's resources");
  ok(await page.locator("#controls .account-delete-btn").count() === 0,
     "an owner is offered no account deletion at all");
  ok(await page.locator('#controls .repo-delete-btn[data-account="other"]').count() === 0,
     "REGRESSION: the trash can on another account's repository is gone");
  ok(asUser.removed.some((r) => r.account === ""),
     "a control that does not say what it would delete is removed, not kept");
}

console.log("\nan administrator keeps the rest, and still cannot delete itself");
{
  await page.reload();
  await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });
  const asAdmin = await page.evaluate(() =>
    window.__strip({ administrator_of: "http://dydra.com" }, "james"));
  ok(asAdmin.kept.filter((k) => k.selector === ".repo-delete-btn").length === 2,
     "every repository is deletable");
  ok(await page.locator('#controls .account-delete-btn[data-account="other"]').count() === 1,
     "another account is deletable");
  ok(await page.locator('#controls .account-delete-btn[data-account="james"]').count() === 0,
     "REQ-2.6.1: and the account the administrator is authenticated as is not");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
