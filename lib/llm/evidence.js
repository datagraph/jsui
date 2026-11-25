/**
 * What the interface put in front of the model, kept so the page can say it.
 *
 * `interface-as-rdf-plan.md' U-109; REQ-23.2.6.
 *
 * The mark on a region used to be read OUT OF THE ANSWER: an asserted region
 * carried `inputs' if the model had declared them, and the mark said whatever
 * that declaration implied -- including, when there was no declaration, a
 * sentence about where the content had NOT come from.  Two things are wrong
 * with that and they are the same thing twice.  The first is that it is a
 * claim about data origin derived from a document the model wrote, so it is
 * only as reliable as the model's bookkeeping, and bookkeeping is the first
 * thing a model drops when it is close to a token ceiling.  The second is
 * that it was never necessary: THE INTERFACE SENT THE DATA.  Every row the
 * model read went out through this side, and every one of them was already
 * carried on an event with its repository, its query, its shape and its
 * digest attached.  The provenance was in hand the whole time and the
 * interface was asking the model for it.
 *
 * So this module builds the record from the events the run already emits, and
 * the record travels with the document into the frame.  The model is not
 * asked how its work should be attributed, and does not need to know: the
 * presentation holds the ledger and writes the mark from it.
 *
 * What a ledger entry is NOT is a claim that the model USED that source for
 * that region.  Nobody can know that -- not the interface, and not the model,
 * whose answer on the question would be a reconstruction.  What the interface
 * knows exactly is what it SHOWED, and that is what the mark says: this is
 * the model's own work, and here is everything it was given to do it from.
 * An over-broad true statement beats a narrow invented one.
 *
 * `inputs' keeps its own, different job.  It is a declaration about which
 * results a sentence was written against, and it is what makes staleness
 * detectable (D-T): when a named panel's digest moves, the sentence is marked.
 * That is a claim the model is in a position to make and the interface is
 * not, so it stays -- as a narrowing of the ledger, never as the ledger.
 */

import { queryBodyOf } from "../figure/provenance.js";

/** How many sources a detail sentence names before it says "and N more". */
const NAMED = 6;

/**
 * Everything one run put in front of the model, oldest first.
 *
 * Read from the adapter's own events, which is the point: these are the
 * things that left this side, not a reconstruction of them.  A failed call is
 * kept and marked -- what the model was shown when a store would not answer
 * is part of what it was working from -- but it contributes no repository to
 * the attribution, because an error message is not data from a store.
 */
export function sourcesFrom(events = []) {
  const digests = new Map();
  for (const e of events) if (e?.type === "digest" && e.id) digests.set(e.id, e);

  const out = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "prompt") {
      out.push({ kind: "request", label: "the request", repository: null, ok: true,
                 at: e.at || null, text: String(e.text ?? ""),
                 bytes: String(e.text ?? "").length });
    } else if (e.type === "primer") {
      out.push({ kind: "primer", label: e.uri || "primer", repository: e.repository || null,
                 ok: Boolean(e.ok), at: e.at || null, bytes: Number(e.chars) || 0,
                 ...(e.ok ? {} : { error: e.error || "unreadable" }) });
    } else if (e.type === "tool_result") {
      // `result_full' hands back a document the model has already been shown
      // the shape of.  It is the same source served a second time, and
      // counting it twice would say the page rests on more than it does.
      if (e.local) continue;
      const d = digests.get(e.id) || null;
      out.push({ kind: "result",
                 label: e.label || e.name || "result",
                 repository: e.repository || null,
                 tool: e.name || null,
                 op: (e.input && e.input.op) || null,
                 query: queryBodyOf(e.input),
                 rows: d && Number.isFinite(d.rows) ? d.rows : null,
                 form: d ? d.form || null : null,
                 digest: e.digest || (d ? d.digest : null) || null,
                 bytes: typeof e.text === "string" ? e.text.length : Number(e.bytes) || 0,
                 ok: Boolean(e.ok), at: e.at || null,
                 ...(e.ok ? {} : { error: String(e.text || "").split("\n")[0] || "failed" }) });
    }
  }
  return out;
}

/** The repositories a set of sources actually brought data back from. */
export function repositoriesOf(sources = []) {
  const seen = [];
  for (const s of sources) {
    if (!s || !s.ok || !s.repository) continue;
    if (s.kind !== "result" && s.kind !== "primer") continue;
    if (!seen.includes(s.repository)) seen.push(s.repository);
  }
  return seen;
}

/**
 * One turn's ledger.  `turn' is the ordinal of the exchange in this page's
 * life -- the compose is 1 and each revision is the next -- because a page is
 * built by a sequence of them and a reader asking what a passage rests on is
 * owed the whole sequence, not the last of it.
 */
export function evidenceFrom(events = [], { turn = 1, ask = null, at = null } = {}) {
  const sources = sourcesFrom(events);
  const request = sources.find((s) => s.kind === "request") || null;
  return {
    turn,
    at: at || sources[0]?.at || new Date().toISOString(),
    ask: ask ?? (request ? request.text : null),
    sources,
    // Where DATA came from.  A repository whose documentation was read and
    // whose rows were not is not somewhere this page's numbers came from,
    // and the attribution is the one place that distinction is load-bearing.
    repositories: repositoriesOf(sources.filter((s) => s.kind === "result")),
  };
}

/** Add a turn to a page's ledger, replacing a turn of the same ordinal. */
export function mergeEvidence(before = [], next = null) {
  const list = (Array.isArray(before) ? before : []).filter((t) => t && t.turn !== next?.turn);
  if (next) list.push(next);
  return list.sort((a, b) => (a.turn || 0) - (b.turn || 0));
}

/** Every source across every turn, flattened, in the order they were read. */
export function allSources(ledger = []) {
  const out = [];
  for (const t of ledger || []) for (const s of t?.sources || []) out.push({ ...s, turn: t.turn });
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** How one source reads in a list a person is looking at. */
export function sourceLine(s) {
  if (!s) return "";
  if (s.kind === "request") return "the request, as it was typed";
  const where = s.repository ? ` · ${s.repository}` : "";
  if (s.kind === "primer") {
    return `${s.label}${where} · ${s.ok ? `${s.bytes} characters of documentation`
                                        : `not readable (${s.error})`}`;
  }
  if (!s.ok) return `${s.label}${where} · did not answer (${s.error})`;
  const size = s.rows != null ? plural(s.rows, "row", "rows") : `${s.bytes} bytes`;
  return `${s.label}${where} · ${size}`;
}

/**
 * The ledger as a page states it: what was read, and from where.
 *
 * Returns {repositories, results, turns, detail, sources} -- the pieces the
 * frame composes its mark out of.  The wording lives here rather than in the
 * frame runtime because the runtime is a string with no imports and nothing
 * in it can be unit-tested, and a sentence shown on every generated page is
 * not a thing to leave untested.
 */
export function evidenceSummary(ledger = []) {
  const list = Array.isArray(ledger) ? ledger.filter(Boolean) : [];
  const sources = allSources(list);
  const reads = sources.filter((s) => s.kind === "result");
  const got = reads.filter((s) => s.ok);
  // What the attribution names is where DATA came from.  A primer is a
  // repository's own documentation and it is certainly something the model
  // was shown, but a page marked "from nsbrick" because the model read
  // nsbrick's schema and none of its rows would be saying the wrong thing
  // in the one place a reader is relying on it.  Kept, and kept apart.
  const repositories = repositoriesOf(got);
  const documented = repositoriesOf(sources.filter((s) => s.kind === "primer"));
  const turns = list.length;

  let detail;
  if (!list.length) {
    // Not "nothing was read" -- there is a difference between a run that read
    // nothing and a page this interface has no record for, and a reopened
    // archive page is the second.  Saying the first about the second would be
    // the same over-claim in the other direction.
    detail = "No record of what the model was shown is held with this page.";
  } else if (!reads.length) {
    detail = "The interface put no repository data in front of the model on this page: "
           + "it answered from the request" + (sources.some((s) => s.kind === "primer")
             ? " and the repository documentation." : " alone.");
  } else {
    const named = got.slice(0, NAMED).map(sourceLine);
    const rest = got.length - named.length;
    detail = `The interface put ${plural(got.length, "result", "results")} in front of the `
           + `model over ${plural(turns, "turn", "turns")}: ${named.join("; ")}`
           + (rest > 0 ? `; and ${rest} more.` : ".")
           + (reads.length > got.length
                ? ` ${plural(reads.length - got.length, "call", "calls")} did not answer.`
                : "");
  }
  return { known: list.length > 0, repositories, documented,
           results: got.length, attempted: reads.length, turns, detail, sources };
}

/** The same facts as data, for a `<meta>', an attribute or an RDF record. */
export function evidenceRecord(ledger = []) {
  const sources = allSources(ledger).filter((s) => s.ok && s.kind === "result");
  return {
    "prov:wasDerivedFrom": sources.map((s) => ({
      "dydra:repository": s.repository || null,
      "dydra:result": s.label || null,
      "dydra:rows": s.rows,
      "dydra:digest": s.digest,
      "prov:generatedAtTime": s.at,
      "dydra:turn": s.turn,
    })),
    "dydra:repositoriesRead": repositoriesOf(allSources(ledger).filter((s) => s.kind === "result")),
    "dydra:repositoriesDocumented":
      repositoriesOf(allSources(ledger).filter((s) => s.kind === "primer")),
    "dydra:turns": (Array.isArray(ledger) ? ledger : []).length,
  };
}

export default evidenceSummary;
