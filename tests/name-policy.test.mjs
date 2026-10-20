/**
 * What a name may contain, against the lists as they are actually shipped.
 *
 * The lists are read from config/names/ rather than restated here: a test that
 * carries its own copy of the configuration proves only that the copy agrees
 * with itself, and the whole point of the files is that they can be changed.
 * So the fixture is a fetch that reads the real directory from disk.
 */
import { cpSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-names-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const N = await import(pathToFileURL(join(scratch, "lib", "names", "name-policy.js")).href);

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

/* The configuration, served off the real directory. */
const fetchImpl = async (url) => {
  const file = String(url).replace(/^.*\/config\/names\//, "");
  try {
    const text = readFileSync(join(root, "config", "names", file), "utf8");
    return { ok: true, status: 200, text: async () => text };
  } catch {
    return { ok: false, status: 404, text: async () => "" };
  }
};

console.log("\nthe characters that interfere");
{
  // The ones named in the brief: quote, dot, comma, double quote, backslash.
  ok(N.sanitize(`o'brien`) === "o-brien", "an apostrophe becomes the separator");
  ok(N.sanitize("v1.2") === "v1-2", "a dot does");
  ok(N.sanitize("a,b") === "a-b", "a comma does");
  ok(N.sanitize('say "hi"') === "say--hi-", "a double quote does, and so does a space");
  ok(N.sanitize("c:\\tmp") === "c--tmp", "a backslash does");
  ok(N.sanitize("query results", { separator: "_" }) === "query_results",
     "the separator is configurable: an underscore where that is wanted");
  ok(N.sanitize("keep-this_one9") === "keep-this_one9",
     "letters, digits, hyphen and underscore are left alone");
}

console.log("\none character in, one character out");
{
  const typed = "a, b. c";
  ok(N.sanitize(typed).length === typed.length,
     "the length never changes while typing, so the caret never moves");
  ok(N.sanitize("a,,,b") === "a---b", "runs are left alone on the way in");
  ok(N.sanitize("a,,,b", { collapse: true }) === "a-b", "and collapsed on the way out");
  ok(N.sanitize(".lead and trail.", { collapse: true }) === "lead-and-trail",
     "where the ends are trimmed as well");
  ok(N.sanitize("two-words-") === "two-words-",
     "a trailing separator survives typing -- trimming it makes a two-word name untypeable");
}

console.log("\nthe lists, as shipped");
{
  const policy = await N.loadNamePolicy({ basePath: "", fetchImpl, force: true });
  ok(policy.reserved.account.includes("admin") && policy.reserved.account.includes("dydra"),
     "the account list is the rails one");
  ok(policy.reserved.repository.includes("auth_token")
     && policy.reserved.repository.includes("repositories"),
     "so is the repository list");
  ok(policy.reserved.view.includes("query") && policy.reserved.view.includes("sparql"),
     "and the view list");
  ok(!policy.reserved.account.includes("# reserved account names."),
     "comments are not terms");
  ok(policy.limits.kinds.repository.max === 255,
     "the length limit is the rails column's, read from the file");

  ok(policy.check("admin", "account").reason === "reserved",
     "a reserved account name is refused");
  ok(policy.check("ADMIN", "account").reason === "reserved", "whatever its case");
  ok(policy.check("query", "view").reason === "reserved",
     "and a view may not be called `query', which already means something there");
  ok(policy.check("auth_token", "repository").reason === "reserved"
     && policy.check("auth_token", "view").ok === true,
     "the lists are per kind: what a repository may not be called, a view may");
  ok(policy.check("administrator", "account").ok === true,
     "a longer name that merely begins with a reserved one is not reserved");
}

console.log("\nnames that will not be accepted");
{
  const policy = N.namePolicy();
  ok(policy.check("", "repository").reason === "empty", "an empty name says so");
  ok(policy.check("...", "repository").reason === "empty",
     "and so does one with nothing in it but punctuation");
  ok(policy.check("x".repeat(256), "repository").reason === "long",
     "a name past the column's width is refused before the server sees it");
  ok(policy.check("x".repeat(255), "repository").ok === true, "and one that fits is not");
  const bad = policy.check("fuck-this", "repository");
  ok(bad.reason === "offensive" && bad.term === "fuck", "an offensive name is refused");
  ok(policy.check("Shitty-Data", "repository").reason === "offensive",
     "including an inflection of a listed term, by its segment");
  // the reason short stems are kept out of the list
  ok(policy.check("assistant-notes", "repository").ok === true
     && policy.check("classics", "repository").ok === true,
     "while an ordinary word that merely contains one is not refused");
  ok(policy.check("my repository, v1", "repository").name === "my-repository-v1",
     "an acceptable name comes back in the form it will be stored under");
}

console.log("\nwithout its configuration");
{
  // a 404 on every file: the field must still do its first job
  const bare = await N.loadNamePolicy({ basePath: "", force: true,
                                        fetchImpl: async () => ({ ok: false, status: 404,
                                                                  text: async () => "" }) });
  ok(bare.check("admin", "account").ok === true,
     "a list that cannot be read is an empty list, not a broken field");
  ok(bare.check("a b", "repository").name === "a-b", "and the sanitising needs no configuration");
  ok(bare.check("", "repository").ok === false, "nor does the length check");
}

console.log("\nmalformed configuration");
{
  const odd = await N.loadNamePolicy({ basePath: "", force: true,
    fetchImpl: async (url) => (String(url).endsWith("limits.json")
      ? { ok: true, status: 200, text: async () => "{not json" }
      : fetchImpl(url)) });
  ok(odd.limits.kinds.repository.max === 255,
     "a limits file that will not parse leaves the defaults standing");
  ok(odd.check("admin", "account").reason === "reserved",
     "and the lists it names are still read");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
