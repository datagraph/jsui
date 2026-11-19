/**
 * The brief a question about data is asked under, and what it may spend (§35).
 *
 * §34 made a cross-repository question *askable*: the bar reads the
 * repositories out of the line, the adapter offers one tool per store and
 * routes each call by the name it was called under.  What it did not do was
 * make the resulting turn capable of the analysis that question implies.  The
 * turn ran under `DEFAULT_SYSTEM', which is the brief for operation 3 of the
 * design -- explore one repository, then hand back a single SPARQL query for
 * the user to run in the view editor -- with eight tool rounds, a 4 096-token
 * answer and no digesting.  Asked to compare two ontologies it would have
 * spent its rounds on the first store, answered with one query that cannot
 * span two endpoints anyway, and poured a 65 000-row survey into its own
 * context on the way.
 *
 * The measure used here is a real one: a consolidated alignment of two RDF
 * ontologies, in which the analyst inventoried each export, read the small
 * one's class axioms, searched the large one's labels by topic, proposed
 * fourteen candidate correspondences with a rationale each, and -- the part
 * that makes it an analysis rather than a list -- said plainly which of its
 * statements were observed, which were interpreted, and which were not
 * established at all.  Every clause below is there because that document
 * needed it.
 *
 * Three things are set here, and they are different in kind:
 *
 *   - the BRIEF (`analysisSystem'), which is what the model is told;
 *   - the BUDGET (`analysisBudget'), which is what the turn may spend; and
 *   - the CEILING, which is stated to the model rather than merely imposed
 *     on it, because a model that does not know its output budget cannot
 *     decide what to cut, and an answer cut mid-table reads exactly like an
 *     answer that gave up.
 *
 * What is NOT here is any claim about the data.  The brief tells the model
 * how to work and what a defensible answer looks like; it names no class, no
 * vocabulary and no domain, because the two repositories in the line may be
 * anything at all.
 */

/* ── the budget ───────────────────────────────────────────────────────────── */

/**
 * Rounds.  A round is one model turn, and a turn may carry several calls, so
 * this is not a call count -- it is how many times the model gets to look at
 * what came back and decide what to ask next.
 *
 * Eight was the figure for a single-repository exploration ending in a query.
 * An analysis of N stores has to inventory each of them before it can compare
 * anything, and the comparison itself is iterative: a candidate found in one
 * store sends a question to the other.  So the floor covers the opening and
 * the write-up, and the rest scales with the number of stores.
 */
export const ROUNDS_BASE = 6;
export const ROUNDS_PER_STORE = 10;
export const ROUNDS_CEILING = 40;

/**
 * The answer.  A report with a candidate table and an evidence section does
 * not fit in 4 096 tokens; the worked example is about 4 200 tokens of prose
 * and tables on its own.  Kept at a figure every current provider will serve
 * -- a gateway that caps lower will cap this, and the run then reports the
 * truncation rather than hiding it.
 */
export const ANALYSIS_TOKENS = 8192;

/**
 * Above this many characters a payload reaches the model as its shape and a
 * label, with `result_full' to ask for the whole of it (D-Q).
 *
 * Nothing like this was set on the data turn, and on a store of any size it
 * is the difference between an analysis and a context overflow: a label
 * listing from a 65 000-concept vocabulary is megabytes, the model needs its
 * SHAPE to decide what to narrow to, and it can ask for the rows of the one
 * result whose values the argument actually turns on.
 */
export const DIGEST_OVER = 4000;

/**
 * What the turn may spend, as a grant (`lib/llm/grant.js').
 *
 * The data turn carried no grant at all, which meant no call ceiling, no byte
 * ceiling and -- the one that matters -- no named set of repositories on the
 * authority itself.  The stores are named in the line and disclosed before the
 * press; putting the same names in the grant means a model that invents a
 * third is refused by the authority rather than by the routing table.
 */
export function analysisBudget(stores = []) {
  const n = Math.max(1, stores.length);
  const rounds = Math.min(ROUNDS_CEILING, ROUNDS_BASE + ROUNDS_PER_STORE * n);
  return {
    stores: n,
    rounds,
    answerTokens: ANALYSIS_TOKENS,
    digestOver: DIGEST_OVER,
    grant: {
      repositories: stores.map((s) => (typeof s === "string" ? s : s.id)).filter(Boolean),
      readOnly: true,
      // Three calls a round is generous for a model that batches its
      // questions and ample for one that does not; the byte and row budgets
      // are per store, because two stores are two inventories.
      maxQueries: rounds * 3,
      maxRows: 200000 * n,
      maxBytes: 400000 * n,
      lifetime: "run",
    },
  };
}

/* ── the brief ────────────────────────────────────────────────────────────── */

/** The clauses that do not depend on how many stores there are. */
const DISCIPLINE = [
  "## What a defensible answer looks like",
  "",
  "Inventory before you characterise. Before saying what a repository is about,",
  "find out what is in it: which types it declares and in what numbers, and --",
  "for a dataset that declares none -- which predicates it uses. A repository",
  "described from its name and three sampled rows is a guess with citations.",
  "",
  "Say what KIND of thing each side's terms are before you compare them. A",
  "vocabulary of indexing concepts and an ontology of classes with axioms are",
  "not the same sort of object even where their labels agree, and a comparison",
  "that does not say so is comparing strings. Where the two stores model their",
  "subject differently, that difference is itself a result -- usually the most",
  "important one -- and belongs near the top of the answer, not in a caveat.",
  "",
  "A shared label is a candidate, not an equivalence. Propose correspondences",
  "with a stated reason and a confidence you are willing to defend, and do not",
  "assert `owl:sameAs`, `owl:equivalentClass` or `skos:exactMatch` on the",
  "strength of resembling text. If you use words like `close`, `broader` or",
  "`related` as your own categories, say that they are yours and not the",
  "formal predicates they resemble.",
  "",
  "What a store does not contain is not thereby absent from its subject. Say",
  "what the data you actually read covers, and scope every conclusion to that.",
  "An export of four classes does not license a statement about the ontology",
  "it was taken from.",
  "",
  "Every figure and every term names the store it came from. In a turn that",
  "reads more than one, an unattributed count is unusable.",
  "",
  "## Delegating the queries",
  "",
  "Do the work with the operations rather than describing it: catalogue and",
  "profile to find out what is there, then shaped queries, narrowing and",
  "joining to get at the rows the comparison turns on. When a result is shown",
  "to you as a shape and a label rather than as rows, that is the whole of a",
  "document too large to read: ask for the whole of the one or two whose",
  "values your argument depends on, and work from the shape for the rest.",
  "",
  "Show the operations that produced each side of a comparison, so that a",
  "reader can run them again. Where an operation can emit the SPARQL it",
  "compiled to, that SPARQL is the thing worth quoting -- and quote it as it",
  "ran, with its dataset clause, not a tidied version.",
  "",
  "## The shape of the answer",
  "",
  "Write a report, not a query. It opens with what was compared and what came",
  "of it in a few sentences; then the substance -- the correspondences, the",
  "differences, the counts -- with each side identified by its URI or name and",
  "its store; and it ends with three headed lists, none of which may be empty",
  "by default:",
  "",
  "- **Observed** -- what a call in this conversation returned, store by store.",
  "- **Interpreted** -- what you concluded from that, and on what reasoning.",
  "- **Not established** -- what this exercise did not settle: the equivalences",
  "  you did not validate, the coverage you did not have, the questions a",
  "  reader would be wrong to think you answered.",
  "",
  "That last list is the point of the exercise. An analysis that cannot say",
  "what it failed to establish has not distinguished its evidence from its",
  "reading of it, and the reader cannot either.",
];

/**
 * The honesty clauses, restated for a turn that reads several stores.
 *
 * `DEFAULT_SYSTEM' says them for one repository and then asks for a single
 * `sparql` block, which is the wrong deliverable here; these are the parts of
 * it that still hold, with "this repository" made plural.
 */
const GROUND = [
  "You have no direct access to any of this data: every fact you state about a",
  "repository must come from a tool call you made to THAT repository in this",
  "conversation. Do not guess at class names, predicate names or prefixes, and",
  "do not carry a fact from one store to another -- look it up in each.",
  "",
  "The operations and the notation they read are documented below, from the",
  "server itself. Follow them rather than inventing an operation or an",
  "argument: if what you want is not there, it is not available.",
];

/** One line per store, so the model knows what it is comparing before it starts. */
function storeLines(stores) {
  return stores.map((s) => {
    const id = typeof s === "string" ? s : s.id;
    const note = typeof s === "string" ? "" : (s.note || "");
    return `- **${id}**${note ? ` — ${note}` : ""}`;
  });
}

/**
 * The whole brief.
 *
 * `base' is passed in rather than imported so that a caller can state what it
 * is building on; the adapter appends the server's own operation and grammar
 * documents after this, and `repositoriesNote' names the tools.
 */
export function analysisSystem({
  stores = [], asked = "", rounds = null, answerTokens = ANALYSIS_TOKENS,
} = {}) {
  const n = stores.length;
  const lines = [
    n > 1
      ? `You are comparing ${n} RDF repositories through the MCP tools offered below.`
      : "You are analysing an RDF repository through the MCP tools offered below.",
    "",
    ...GROUND,
  ];
  if (n) {
    lines.push("", "## The repositories this question names", "", ...storeLines(stores));
    if (n > 1) {
      lines.push("",
        "Each is a separate store with its own tools and its own exploration; a",
        "handle from one means nothing in another, and no query you can write",
        "spans them. The comparison is yours to make, from what each store",
        "answers separately.");
    }
  }
  lines.push("", ...DISCIPLINE);
  lines.push("", "## What you have to spend", "");
  if (rounds) {
    lines.push(
      `About ${rounds} rounds of tool calls. Spend the early ones on inventory --`,
      "what is in each store -- because a comparison built on an unexamined store",
      "cannot be repaired later in the run.");
    lines.push("");
    lines.push(
      "Leave yourself a round to write in. Searching until the budget is gone and",
      "then being cut off mid-exploration wastes the whole run: a report drawn",
      "from twenty calls is worth more than twenty-six calls and no report. If",
      "the rounds do run out you will be asked once more with no tools offered,",
      "and that turn is for the answer -- but a report written under that notice",
      "is one you did not get to shape, so plan not to need it.");
    lines.push("");
  }
  lines.push(
    `Your final answer is cut off at about ${answerTokens} tokens`,
    `(roughly ${answerTokens * 4} characters). If you will not fit, shorten the`,
    "body -- fewer candidates, shorter rationales -- and keep Observed,",
    "Interpreted and Not established complete. A table cut in half is worse than",
    "a shorter table, and the interface will tell the reader that you were cut",
    "off, so do not spend words apologising for it.");
  if (asked) {
    lines.push("", "## What was asked", "", String(asked).trim());
  }
  return lines.join("\n");
}

export default analysisSystem;

/* ── the running account ──────────────────────────────────────────────────── */

/**
 * What the bar says while the run is going on (§35.3).
 *
 * An analysis is tens of calls across minutes, and the only thing the bar
 * could say about it was "asking…".  This turns the adapter's events into one
 * line that keeps changing: which store was just asked, for what, and how far
 * into its rounds the run is.  It is deliberately a SENTENCE rather than a
 * meter -- the interesting fact is what the model is doing, not a percentage
 * of a ceiling that it may never reach.
 *
 * It counts as well as narrates, and the counts are returned, because the
 * finished reply says how many calls each store answered and that number
 * must be the one the user watched go up.
 */
export function analysisProgress(onLine = () => {}, { rounds = null } = {}) {
  const calls = new Map();
  let round = 0, bytes = 0, lastStore = null;

  const say = (text) => { try { onLine(text); } catch { /* a progress line must not stop a run */ } };
  const where = (id) => (id ? `${id} · ` : "");
  const far = () => (rounds ? ` (round ${round} of ${rounds})` : ` (round ${round})`);

  const onEvent = (e) => {
    switch (e.type) {
      case "tools":
        say(`${where(e.repository)}reading the tools it offers…`);
        break;
      case "primer":
        say("reading the server's own operation catalogue…");
        break;
      case "assistant":
        round = Math.max(round, e.iteration || 0);
        break;
      case "tool_call": {
        lastStore = e.repository || lastStore;
        round = Math.max(round, e.iteration || 0);
        // The operation, where there is one: `survey' says only that it is a
        // survey, and `catalog' versus `select' is the whole of what the
        // reader wants to know about a call that is taking a while.
        const op = e.input && (e.input.op || e.input.operation);
        say(`${where(e.repository)}${op || e.tool || e.name}…${far()}`);
        break;
      }
      case "tool_result": {
        const id = e.repository || lastStore;
        calls.set(id, (calls.get(id) || 0) + 1);
        bytes += (e.shown || e.text || "").length;
        const n = [...calls.values()].reduce((a, b) => a + b, 0);
        say(`${where(id)}${n} call${n === 1 ? "" : "s"} answered${far()}`);
        break;
      }
      case "digest":
        say(`${where(e.repository)}${e.rows ? `${e.rows} rows` : "a large result"}`
          + ` — reading its shape${far()}`);
        break;
      case "done":
        say("writing it up…");
        break;
      default:
        break;
    }
  };

  return {
    onEvent,
    get rounds() { return round; },
    get bytes() { return bytes; },
    /** `[["alice/sales", 7], …]`, in the order the stores were first reached. */
    get calls() { return [...calls].filter(([id]) => id); },
    total() { return [...calls.values()].reduce((a, b) => a + b, 0); },
  };
}
