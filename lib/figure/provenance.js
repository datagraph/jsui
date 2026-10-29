/**
 * Is this the query that ran?
 *
 * The figure path reads its query out of the prose a turn wrote.  That is
 * convenient and it is where a whole class of failure enters, because the
 * query in the prose is TYPED AGAIN, and a model retyping a query it ran ten
 * messages ago drops things from it.
 *
 * Observed, and the reason this file exists: an exploration ran a census of
 * classes against a named graph and got 34 of them; the answer restated the
 * query with its `FROM' clause missing.  The interface then ran the restated
 * one.  Without the dataset clause it reads the default graph, which was
 * empty, so it matched nothing -- and an empty SELECT result came back from
 * the store encoded as a BOOLEAN, which is how a page of prose about 198,288
 * observations came to sit above a document saying `false'.  (The encoding is
 * a fault of its own and is being handled where it belongs; nothing here
 * depends on it.  A store that answered correctly would have returned zero
 * rows, and zero rows under a table of 34 classes is the same lie told more
 * quietly.)
 *
 * So the check is not "is this query valid" -- it parses, it is well formed,
 * it would be approved by anyone reading it at Gate 1, and that is exactly
 * the trouble.  The check is whether it is the SAME query, and the one piece
 * of evidence that can answer it is what the interface itself relayed during
 * the exploration.  That evidence exists: every tool call went through this
 * side and its arguments were kept.
 *
 * Two judgements, kept apart on purpose:
 *
 *   `kind: "same"'      the proposal is, character for character after
 *                       whitespace, a query that ran.  Nothing to say.
 *   `kind: "dataset"'   it is a query that ran WITH ITS DATASET CLAUSE
 *                       CHANGED.  This is the one worth interrupting for:
 *                       everything else about the query is identical, so the
 *                       prose above it describes what it returns, and it does
 *                       not return that.
 *   `kind: "none"'      no relation found.  Said once, quietly, because a
 *                       model proposing a better query than the one it
 *                       explored with is the normal and desirable case --
 *                       the three-step contract asks for exactly that.
 */

import { stripComments, queryFormOf, BODY_FIELDS } from "../llm/grant.js";

/** Whitespace-insensitive, comment-insensitive, and nothing else. */
export function squash(query) {
  return stripComments(query).replace(/\s+/g, " ").trim();
}

/**
 * The graphs a query names in its dataset clause.
 *
 * Text, not a parse: `FROM' is unambiguous enough at this grain, and the only
 * thing that depends on the answer is a sentence shown to a user who has the
 * query in front of them.  A prefixed name is accepted as well as an IRI,
 * because a query written with `FROM ex:graph' loses just as much.
 */
export function datasetOf(query) {
  const s = stripComments(query);
  const from = [], named = [];
  const re = /\bFROM\s+(NAMED\s+)?(<[^>\s]*>|[A-Za-z_][\w.-]*:[^\s{()]*)/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) (m[1] ? named : from).push(m[2]);
  return { from, named, all: [...from, ...named], any: Boolean(from.length || named.length) };
}

/** The same query with its dataset clause taken out, for comparing the rest. */
export function withoutDataset(query) {
  return squash(stripComments(query)
    .replace(/\bFROM\s+(?:NAMED\s+)?(?:<[^>\s]*>|[A-Za-z_][\w.-]*:[^\s{()]*)/gi, " "));
}

/** The SPARQL in a tool call's arguments, or null when it carries none. */
export function queryBodyOf(input) {
  if (!input || typeof input !== "object") return null;
  for (const field of BODY_FIELDS) {
    const v = input[field];
    if (typeof v === "string" && v.trim() && queryFormOf(v)) return v;
  }
  return null;
}

/**
 * Every query this exploration actually sent, newest first.
 *
 * Read from the adapter's own `tool_result' events rather than from the
 * prose, which is the whole point: these are the strings that left the pane.
 * Failed calls are kept and marked -- "the query that ran" is not a
 * recommendation, and a proposal that matches a call which errored is worth
 * knowing about too.
 */
export function queriesRan(events = []) {
  const out = [];
  for (const e of events) {
    if (e?.type !== "tool_result") continue;
    const query = queryBodyOf(e.input);
    if (!query) continue;
    out.unshift({ query, name: e.name || null, op: e.input?.op || null,
                  ok: Boolean(e.ok), at: e.at || null });
  }
  return out;
}

/**
 * What relation the proposed query bears to the ones that ran.
 *
 * Returns `{kind, match, lost, gained, note}'.  `note' is a finished
 * sentence, because every caller shows it to a person and none of them should
 * be composing this wording separately.
 */
export function divergenceFrom(proposed, ran = []) {
  const none = { kind: "none", match: null, lost: [], gained: [], note: null };
  const p = squash(proposed);
  if (!p || !ran.length) return none;

  for (const r of ran) if (squash(r.query) === p) return { ...none, kind: "same", match: r };

  const bare = withoutDataset(proposed);
  const mine = datasetOf(proposed);
  for (const r of ran) {
    if (withoutDataset(r.query) !== bare) continue;
    const theirs = datasetOf(r.query);
    const lost = theirs.all.filter((g) => !mine.all.includes(g));
    const gained = mine.all.filter((g) => !theirs.all.includes(g));
    if (!lost.length && !gained.length) continue;      // identical after all
    const note = lost.length
      ? `This is the query that ran, with its dataset clause removed: the call `
      + `that returned results read ${lost.join(", ")}, and this one names no `
      + `graph. Without it the query reads the default graph — which may hold `
      + `nothing, in which case it returns nothing, and an empty result drawn as `
      + `a figure looks like a finding.`
      : `This is the query that ran, with ${gained.join(", ")} added to its `
      + `dataset clause. It will not read what the call above read.`;
    return { kind: "dataset", match: r, lost, gained, note };
  }
  return none;
}

export default divergenceFrom;
