/**
 * Fractional order keys (U-58).
 *
 * Three claims, and the third is the one the design rests on.
 *
 *   1. `keyBetween' lands strictly between its neighbours, including at the
 *      ends and including after a thousand inserts into the same gap, which
 *      is where an implementation that runs out of room fails.
 *   2. The invariant holds: no key ends in the lowest digit, because a key
 *      that did would have nothing insertable below it.
 *   3. An insert touches ONE key.  Asserted by holding the whole list before
 *      and after and comparing every other element's key for equality -- the
 *      property `rdf:List' and integer indices both fail, and the reason
 *      this module exists.
 *
 * The loading note from the other suites applies: jsui's package.json
 * declares no "type", so the lib tree is copied into a scratch package that
 * does.
 */

import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-ui-order-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", p)).href);

const {
  DIGITS, FIRST_KEY, keyBetween, keysBetween, tagged, writerTag,
  validKey, compareNodes, sorted, assignKeys,
} = await load("app/order.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ══════════════════════════ between, at the ends ══════════════════════════ */

section("a key lands strictly between its neighbours");
{
  const a = keyBetween(null, null);
  ok(validKey(a), `the only child gets a usable key (${a})`);

  const before = keyBetween(null, a);
  const after = keyBetween(a, null);
  ok(before < a, `first: ${before} < ${a}`);
  ok(a < after, `last: ${a} < ${after}`);

  const middle = keyBetween(a, after);
  ok(a < middle && middle < after, `between: ${a} < ${middle} < ${after}`);

  let threw = false;
  try { keyBetween(after, a); } catch { threw = true; }
  ok(threw, "and a pair in the wrong order is a caller bug, so it throws");
}

section("the invariant: no key ends in the lowest digit");
{
  const keys = [];
  let lo = null;
  for (let i = 0; i < 200; i += 1) { lo = keyBetween(lo, null); keys.push(lo); }
  ok(keys.every((k) => !k.endsWith(DIGITS[0])), "appending two hundred times");

  let hi = null;
  const down = [];
  for (let i = 0; i < 200; i += 1) { hi = keyBetween(null, hi); down.push(hi); }
  ok(down.every((k) => !k.endsWith(DIGITS[0])), "prepending two hundred times");
  ok(down.every((k, i) => i === 0 || k < down[i - 1]), "and each prepend is below the last");
}

section("the same gap takes a thousand inserts");
{
  let lo = keyBetween(null, null);
  const hi = keyBetween(lo, null);
  let last = lo, broke = null;
  for (let i = 0; i < 1000; i += 1) {
    const k = keyBetween(last, hi);
    if (!(last < k && k < hi)) { broke = `${i}: ${last} < ${k} < ${hi}`; break; }
    if (!validKey(k)) { broke = `${i}: ${k} is not a key`; break; }
    last = k;
  }
  ok(broke === null, broke || "a thousand inserts into one gap, each still between");
  ok(last.length < 700, `and the key stays short enough to store (${last.length} chars)`);
}

section("several at once");
{
  const a = keyBetween(null, null), b = keyBetween(a, null);
  const five = keysBetween(a, b, 5);
  ok(five.length === 5, "five keys");
  ok(five.every((k, i) => (i === 0 ? a < k : five[i - 1] < k)) && five[4] < b,
     "in order, all between the two neighbours");
}

/* ═══════════════════════ the property that matters ════════════════════════ */

section("D-AJ: an insert touches one key and no other");
{
  const list = [];
  let lo = null;
  for (let i = 0; i < 8; i += 1) { lo = keyBetween(lo, null); list.push({ name: `e${i}`, order: lo }); }
  const before = list.map((n) => n.order);

  // Insert in the middle, the case an rdf:List or an index would make
  // rewrite the tail.
  const inserted = { name: "new", order: keyBetween(list[3].order, list[4].order) };
  const after = sorted([...list, inserted]);

  ok(after.map((n) => n.name).join(",") === "e0,e1,e2,e3,new,e4,e5,e6,e7",
     "the new element sorts where it was put");
  ok(list.every((n, i) => n.order === before[i]),
     "and NOT ONE existing key changed — which is the whole point");
}

section("ordering is total even if two keys collide");
{
  const same = [{ name: "b", order: "a" }, { name: "a", order: "a" }];
  ok(sorted(same).map((n) => n.name).join(",") === "a,b",
     "the element name breaks the tie, so two readers cannot disagree");
  ok(compareNodes({ name: "x", order: "a" }, { name: "x", order: "a" }) === 0,
     "and a node equals itself");
}

/* ═══════════════════════════ the writer tag ═══════════════════════════════ */

section("two writers inserting in the same gap do not collide");
{
  const a = keyBetween(null, null), b = keyBetween(a, null);
  const shared = keyBetween(a, b);
  const one = tagged(shared, "session-one");
  const two = tagged(shared, "session-two");

  ok(one !== two, "they reach different keys from the same two neighbours");
  ok(a < one && one < b, `and the first still lands in the gap (${a} < ${one} < ${b})`);
  ok(a < two && two < b, `and so does the second (${a} < ${two} < ${b})`);
  ok(validKey(one) && validKey(two), "both are usable keys");

  const between = keyBetween(one < two ? one : two, one < two ? two : one);
  ok((one < two ? one : two) < between && between < (one < two ? two : one),
     "and a third insert between the two tagged keys still works");

  ok(tagged(shared, "session-one") === one, "a writer reaches the same tag twice");
  ok(tagged(shared, "") === shared, "and no writer means no tag at all");
  ok(!writerTag("anything").endsWith(DIGITS[0]), "a tag never ends in the lowest digit");
}

section("a tagged key lands below a neighbour it is a prefix of");
{
  // The case that makes `.' the separator rather than any other character:
  // the computed key can be a PREFIX of the upper neighbour, and appending
  // anything above `.' to it would jump over that neighbour.
  const lower = "b", upper = "b1";
  ok(lower < upper, "setting up the prefix case");
  const t = tagged(lower, "w");
  ok(lower < t && t < upper, `${lower} < ${t} < ${upper}`);
}

/* ═══════════════════════════ keys from a list ═════════════════════════════ */

section("a list that has no keys gets them");
{
  const nodes = [{ name: "a" }, { name: "b" }, { name: "c" }];
  assignKeys(nodes);
  ok(nodes.every((n) => validKey(n.order)), "every node has a key");
  ok(nodes[0].order < nodes[1].order && nodes[1].order < nodes[2].order,
     "in the order the list was in");
  const tagged2 = [{ name: "a" }, { name: "b" }];
  assignKeys(tagged2, "w1");
  ok(tagged2[0].order < tagged2[1].order && tagged2.every((n) => validKey(n.order)),
     "and a writer's keys are still in order");
}

section("what is not a key");
{
  ok(!validKey(""), "nothing");
  ok(!validKey("a."), "a trailing lowest digit");
  ok(!validKey("a!"), "a character outside the alphabet");
  ok(!validKey("A"), "an uppercase letter, which would sort below the digits");
  ok(validKey("a"), "but a plain one is");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
