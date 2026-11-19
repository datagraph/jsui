/**
 * Sibling order: a key you can insert between, in one triple.
 *
 * Implements D-AJ of `interface-as-rdf-plan.md'; work item U-58.
 *
 * The question this answers is narrow and the two obvious answers are both
 * wrong, so it is worth saying why before the code.
 *
 * An `rdf:List' orders its members by chaining them, so inserting between the
 * third and the fourth rewrites every cell from the fourth on.  An integer
 * index does the same thing with arithmetic instead of pointers: insert
 * between 2 and 3 and everything from 3 renumbers.  Either way a LOCAL change
 * writes a GLOBAL diff -- which in a revisioned store makes every mid-list
 * insert an expensive revision, in a replicated one makes two concurrent
 * inserts a conflict over the whole tail, and in the reconciler makes a diff
 * that touches elements the user did not change.  That last one is the whole
 * property this design exists to produce.
 *
 * So the key is a STRING compared lexicographically, and between any two
 * distinct strings there is always another.  Inserting writes one triple and
 * no sibling moves.
 *
 * The alphabet, and the one invariant
 * -----------------------------------
 * Keys are read as fractions: `"a"' is a number in (0,1) written in base 37,
 * and a key shorter than another is padded with the LOWEST digit.  The lowest
 * digit is `.', which sorts below `0' in every byte order that matters, and
 * the invariant is that **no key ends in `.'** -- if one did there would be
 * nothing to insert below it, because padding would make it equal to its own
 * prefix.  Every function here maintains that and `validKey' checks it.
 *
 * `.' is in the alphabet rather than reserved because of `tagged' below: a
 * writer tag has to be appendable to any key and still land before whatever
 * followed it, which only works if the separator is the lowest digit -- and
 * then arithmetic between two tagged keys has to work too, which only works
 * if it is a digit at all.
 */

/** The digits, in order.  `.' is the lowest and is what a short key is padded with. */
export const DIGITS = ".0123456789abcdefghijklmnopqrstuvwxyz";

const LOW = DIGITS[0];
const BASE = DIGITS.length;
const at = (s, i) => (i < s.length ? s[i] : LOW);
const value = (c) => DIGITS.indexOf(c);

/** A key that is well formed: digits only, not empty, and not ending in `.'. */
export function validKey(key) {
  const s = String(key ?? "");
  if (!s) return false;
  if (s.endsWith(LOW)) return false;
  for (const ch of s) if (DIGITS.indexOf(ch) < 0) return false;
  return true;
}

/**
 * A key strictly between A and B, where `""' as B means "above everything".
 *
 * The recursion is the ordinary one for finding a number between two
 * fractions: share the common prefix, then either land halfway between two
 * digits that have room between them, or -- when they are adjacent -- descend
 * into the lower one and look again.
 */
function midpoint(a, b) {
  if (b !== "" && a >= b) {
    throw new Error(`order: ${JSON.stringify(a)} is not below ${JSON.stringify(b)}`);
  }
  if (a.endsWith(LOW) || (b !== "" && b.endsWith(LOW))) {
    throw new Error(`order: a key may not end in ${JSON.stringify(LOW)}`);
  }
  if (b !== "") {
    let n = 0;
    while (at(a, n) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? value(a[0]) : 0;
  const high = b !== "" ? value(b[0]) : BASE;
  if (high - low > 1) return DIGITS[Math.round(0.5 * (low + high))];
  // Adjacent digits: there is no room at this position.  If B has more to it,
  // its first digit alone is already below it and above A.  Otherwise keep A's
  // digit and find room one position further down.
  if (b !== "" && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + midpoint(a.slice(1), "");
}

/**
 * The key for an element inserted between the siblings with keys A and B.
 *
 * `null' for A means "first", `null' for B means "last", both means the only
 * child.  Throws if A is not below B, which is a caller bug: the two keys come
 * from the tree and the tree is sorted.
 */
export function keyBetween(a = null, b = null) {
  const lo = a == null ? "" : String(a);
  const hi = b == null ? "" : String(b);
  if (lo && !validKey(lo)) throw new Error(`order: ${JSON.stringify(lo)} is not a key`);
  if (hi && !validKey(hi)) throw new Error(`order: ${JSON.stringify(hi)} is not a key`);
  return midpoint(lo, hi);
}

/** The first key in an empty container. */
export const FIRST_KEY = keyBetween(null, null);

/** N keys in order between A and B, for an insert of several at once. */
export function keysBetween(a, b, n) {
  const count = Math.max(0, Math.trunc(Number(n) || 0));
  const out = [];
  let lo = a == null ? null : String(a);
  for (let i = 0; i < count; i += 1) {
    const key = keyBetween(lo, b == null ? null : String(b));
    out.push(key);
    lo = key;
  }
  return out;
}

/**
 * A writer's own version of a key.
 *
 * Two clients inserting in the same gap compute the same key from the same
 * two neighbours.  Appending the writer's tag separates them without either
 * having to see the other: `tagged' lands strictly above the untagged key and
 * strictly below whatever the key was below, because the separator is the
 * lowest digit -- so both inserts survive, and every reader orders them the
 * same way.
 *
 * It is not a conflict resolution mechanism and does not pretend to be one.
 * It makes concurrent inserts COMMUTE.  Concurrent edits to the same property
 * are a different question, and an open one (§13.1 of the plan).
 */
export function tagged(key, writer) {
  const base = String(key ?? "");
  if (!validKey(base)) throw new Error(`order: ${JSON.stringify(base)} is not a key`);
  const tag = writerTag(writer);
  return tag ? base + LOW + tag : base;
}

/**
 * A short tag for a writer, drawn from the alphabet and never ending in `.'.
 *
 * Derived from whatever identifies the client -- a session id, an account
 * name -- so that the same client reaches the same tag across a reload and
 * does not accumulate a new ordering position per page view.
 */
export function writerTag(writer) {
  const s = String(writer ?? "").trim();
  if (!s) return "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let n = h >>> 0, out = "";
  for (let i = 0; i < 4; i += 1) { out += DIGITS[1 + (n % (BASE - 1))]; n = Math.floor(n / (BASE - 1)); }
  return out.endsWith(LOW) ? out.slice(0, -1) + DIGITS[1] : out;
}

/**
 * The total order on siblings: by key, then by name.
 *
 * The tie-break is not expected to fire -- `tagged' exists so that it does
 * not -- but ordering has to be a TOTAL function of the graph or two readers
 * can disagree about what the interface looks like, which is a worse failure
 * than either order would have been.
 */
export function compareNodes(a, b) {
  const ka = String(a?.order ?? ""), kb = String(b?.order ?? "");
  if (ka !== kb) return ka < kb ? -1 : 1;
  const na = String(a?.name ?? ""), nb = String(b?.name ?? "");
  return na === nb ? 0 : (na < nb ? -1 : 1);
}

/** Children in order, as a new array. */
export function sorted(nodes) {
  return [].concat(nodes || []).sort(compareNodes);
}

/**
 * Keys for a list that has none, or whose keys do not sort as the list does.
 *
 * Used when a tree is built from markup, where order is position, and once
 * per legacy document on its way into the store.  Not used afterwards: from
 * then on the keys are the order.
 */
export function assignKeys(nodes, writer = null) {
  const list = [].concat(nodes || []);
  let previous = null;
  for (const node of list) {
    const key = keyBetween(previous, null);
    node.order = writer ? tagged(key, writer) : key;
    previous = node.order;
  }
  return list;
}
