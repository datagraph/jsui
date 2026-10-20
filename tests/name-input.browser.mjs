/**
 * The name field, in a real browser.
 *
 * The policy itself is asserted in tests/name-policy.test.mjs; what cannot be
 * asserted there is the part that matters to the person typing: that the caret
 * does not jump, that the replacement happens as the character is typed rather
 * than on submit, that the Create button follows the verdict, and that the
 * lists are read off the served configuration rather than compiled in.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript",
                ".html": "text/html", ".txt": "text/plain", ".json": "application/json" };

const HARNESS = `<!doctype html><meta charset="utf-8"><title>names</title>
<body>
<input id="repo" type="text" placeholder="Repository name" />
<button id="create">Create</button>
<input id="acct" type="text" data-name-kind="account" placeholder="Username" />
<script type="module">
import { attachNameControl, installNamePolicy, installNameControls }
  from "/ui/components/name-input.js";

window.__ready = installNamePolicy("").then(() => {
  installNameControls(document);
  const btn = document.getElementById("create");
  window.__repo = attachNameControl(document.getElementById("repo"), {
    kind: "repository",
    onState: (res) => { btn.disabled = !res.ok; },
  });
  btn.disabled = true;
  return true;
});
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

const repo = page.locator("#repo");
const create = page.locator("#create");
const note = page.locator('[data-testid="repository-name-note"]');

console.log("\nas it is typed");
{
  await repo.click();
  await page.keyboard.type("my repo");
  ok(await repo.inputValue() === "my-repo",
     "a space becomes the separator at the moment it is typed, not on submit");
  await repo.fill("");
  await page.keyboard.type(`o'brien's, "notes".`);
  ok(await repo.inputValue() === "o-brien-s---notes--",
     "every interfering character goes the same way, one for one");
  ok((await note.textContent()).includes("replace"),
     "and the field says what it did rather than silently editing");
}

console.log("\nwhere the caret is");
{
  await repo.fill("abcdef");
  // put the caret in the middle and type the character that gets replaced
  await repo.evaluate((el) => el.setSelectionRange(3, 3));
  await page.keyboard.type(".");
  ok(await repo.inputValue() === "abc-def", "the replacement lands where it was typed");
  ok(await repo.evaluate((el) => el.selectionStart) === 4,
     "and the caret is after it -- the field does not throw you back to the end");
  await page.keyboard.type("X");
  ok(await repo.inputValue() === "abc-Xdef", "so the next character continues from there");
}

console.log("\nthe trailing separator");
{
  await repo.fill("");
  await page.keyboard.type("two words");
  ok(await repo.inputValue() === "two-words", "a two-word name can be typed at all");
  await repo.fill("");
  await page.keyboard.type("trail ");
  ok(await repo.inputValue() === "trail-", "the separator survives while the field has focus");
  await repo.blur();
  ok(await repo.inputValue() === "trail", "and is tidied away when it does not");
  await repo.fill("a,,,b");
  await repo.blur();
  ok(await repo.inputValue() === "a-b", "as are the runs");
}

console.log("\nwhat Create does with the verdict");
{
  await repo.fill("");
  await repo.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
  ok(await create.isDisabled(), "an empty name cannot be created");
  await repo.fill("auth_token");
  await repo.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
  ok(await create.isDisabled(), "nor can a reserved one");
  ok((await note.textContent()).includes("reserved"),
     "and the field says which rule it fell to");
  await repo.fill("samples");
  await repo.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
  ok(!(await create.isDisabled()), "a good name enables it again");
  ok((await note.textContent()).trim() === "", "with nothing left to explain");
}

console.log("\nthe lists are the served files");
{
  // Proof that nothing is compiled in: the page read config/names/ over HTTP,
  // and a term that only exists in that file is enforced.
  const reason = await page.evaluate(async () => {
    const { namePolicy } = await import("/lib/names/name-policy.js");
    return namePolicy().check("dydra", "account").reason;
  });
  ok(reason === "reserved", "an account name from accounts.txt is refused in the browser");
  const kinds = await page.evaluate(async () => {
    const { namePolicy } = await import("/lib/names/name-policy.js");
    return Object.keys(namePolicy().reserved).sort().join(",");
  });
  ok(kinds === "account,repository,view", "one list per kind, as limits.json names them");
}

console.log("\na field that only says what it is");
{
  // No JavaScript attached it: the document-level installer picked it up from
  // its data-name-kind the first time it was touched.
  const acct = page.locator("#acct");
  await acct.click();
  await page.keyboard.type("Jo Hacker");
  ok(await acct.inputValue() === "Jo-Hacker", "a marked field takes charge of itself");
  await acct.fill("admin");
  await acct.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
  ok((await page.locator('[data-testid="account-name-note"]').textContent()).includes("reserved"),
     "under its own kind's list");
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
