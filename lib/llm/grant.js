/**
 * The grant: the authority a model is given over the store, for one run.
 *
 * Implements D-O of `llm-result-rendering-plan.md' §7.2.  The single-figure
 * path of §2 confirms one query at Gate 1, before it runs, which is right when
 * there is one.  A dashboard is a dozen, and confirming a dozen queries one at
 * a time is not a safeguard -- it is a dialog the user learns to dismiss, which
 * is worse than no gate at all because it looks like one.
 *
 * So the unit of consent moves.  What the user decides once, at Gate 0, is
 * SCOPE: which repositories may be read, read-only or not, how many queries,
 * how many rows and bytes may come back, and how long the authority lasts.
 * Every relayed call is then charged against that grant and refused past it,
 * without a further prompt.
 *
 * Three properties make the move defensible, and all three are mechanical
 * rather than advisory:
 *
 *   CHARGED    a call that would exceed the grant does not happen.  The query
 *              count is charged BEFORE the call -- a refusal after the store
 *              has been read is not a limit, it is a complaint.  Rows and bytes
 *              are charged after, since they are not knowable before.
 *   VISIBLE    `onChange' fires on every charge and every refusal, so the pane
 *              can show consumption while the run proceeds rather than
 *              reporting it afterwards.
 *   REVOCABLE  `revoke()' takes effect at the next check, mid-run.  The model
 *              is told, in the tool result, that it was revoked -- it is not
 *              left to infer it from a silence.
 *
 * And one that makes it usable: `widen()'.  The grant can start at one query on
 * one repository and be raised a notch at a time, by the user, without
 * restarting the run.  That is the "even if just incrementally" authority the
 * goal asks for, and the reason this is a budget object rather than a boolean.
 *
 * Nothing here is a substitute for the service's own access control.  Every
 * relayed call still travels under the account's token and the service decides
 * what that token may do.  The grant decides what the PANE will ask on the
 * model's behalf, which is a different question and the only one this side can
 * answer.
 */

/**
 * Request notations that read.
 *
 * The `query' tool selects what it is being handed with `mimeType'.  Offering
 * the tool while leaving that argument free offers `application/sparql-update'
 * with it, so the allow-list is on the argument, not only on the tool name.
 *
 * These are the five the service actually accepts, read off its own
 * `tools/list' schema on a live host (2026-10-18) rather than guessed at.  An
 * earlier draft of this list was wrong in both directions: it named
 * `text/x-score', which no spelling of the service has ever used -- the
 * notation is `application/score' -- and it mixed in RESPONSE notations
 * (`text/turtle', `text/csv') that cannot be the notation of a request at
 * all.  The first was the damaging half: a model asking for score, which is
 * the notation the survey primer teaches it, would have been refused by its
 * own side with a message naming a media type that does not exist.
 */
export const READ_NOTATIONS = [
  "application/sparql-query",
  "application/score",
  // Dual-use.  A GraphQL document carries its own operation keyword, so the
  // notation cannot settle this and the BODY is screened below.
  "application/graphql",
  "application/graphql+json",
];

/** Notations that write.  Named so that a refusal can say which one it saw. */
export const WRITE_NOTATIONS = [
  "application/sparql-update",
];

/**
 * Notations a RESULT may be asked for (D-L).  A different axis entirely: this
 * is what comes back, and nothing in it can write.  Kept apart from the list
 * above because conflating the two is what produced the error it documents.
 */
export const RESPONSE_NOTATIONS = [
  "application/sparql-results+json",
  "application/score",
  "application/graphql+json",
  "text/turtle",
  "application/n-triples",
  "text/tab-separated-values",
  "text/csv",
];

/** Tools a grant may relay at all.  `survey' reads; `query' reads if told to. */
export const GRANTABLE_TOOLS = ["survey", "query"];

export const DEFAULT_GRANT = {
  repositories: [],        // [] means "the pane's own repository", set by the caller
  readOnly: true,
  maxQueries: 12,
  maxRows: 50000,
  maxBytes: 2000000,
  lifetime: "run",         // "run" | "session"
};

/**
 * The operative form of a SPARQL body: the keyword that decides what it does.
 *
 * Not a regexp over the whole text.  `SELECT ?s { ?s :note "delete this" }' is
 * a read, and a search for the word "delete" calls it a write; `PREFIX x: <…>
 * DELETE { … }' is a write, and a search for a leading SELECT calls it a read.
 * Comments and prologue are stripped and the first keyword after them decides,
 * which is also how the server reads it.
 */
/**
 * SPARQL with its comments removed.
 *
 * `#' opens a comment only OUTSIDE an IRI and outside a string literal, and
 * that distinction is not pedantry -- it is the single most common character
 * in the vocabularies any query will declare.  `rdf:', `rdfs:', `owl:',
 * `skos:', `xsd:', `vcard:' and `contact:' all end in `#', so a stripper that
 * takes every `#' for a comment eats the rest of the line INCLUDING the
 * closing `>' of the declaration it was in the middle of reading.
 *
 * What that costs is not a cosmetic misreading.  `queryFormOf' then cannot
 * find the form, and everything built on it draws the wrong conclusion in the
 * wrong direction: a dashboard panel is rejected as "not a query" (every panel
 * of a FOAF page, in the live run that found this), and -- far worse -- an
 * UPDATE whose form cannot be read is not recognised as a write, so the
 * argument screen that exists to stop one passes it.
 */
export function stripComments(text) {
  const s = String(text || "");
  let out = "";
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "#") {                       // a comment, to the end of the line
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i += 1;
      continue;
    }
    if (c === "<") {
      // An IRIREF, by the grammar: no space and none of <>\"{}|^` inside it.
      // A `<' that begins no IRIREF is a comparison, and is copied as itself.
      const m = /^<[^<>"{}|^`\\\s]*>/.exec(s.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
      out += c; i += 1;
      continue;
    }
    if (c === '"' || c === "'") {          // a literal, short or long
      const q = s.slice(i, i + 3) === c + c + c ? c + c + c : c;
      let j = i + q.length;
      while (j < s.length) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s.slice(j, j + q.length) === q) { j += q.length; break; }
        j += 1;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function queryFormOf(text) {
  let s = stripComments(text);
  // PREFIX and BASE declarations, repeatedly, from the front.  The IRI may not
  // contain whitespace, and saying so matters: `<[^>]*>' spans newlines, so a
  // declaration whose `>' had been eaten would swallow the NEXT line's IRI and
  // arrive at the right answer for the wrong reason -- which is how this bug
  // stayed invisible for the prefixes that happened to be declared last.
  for (;;) {
    const m = /^\s*(?:PREFIX\s+[^\s:]*:\s*<[^>\s]*>|BASE\s*<[^>\s]*>)/i.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  const m = /^\s*(SELECT|CONSTRUCT|ASK|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD|WITH)\b/i
    .exec(s);
  return m ? m[1].toUpperCase() : null;
}

const READ_FORMS = ["SELECT", "CONSTRUCT", "ASK", "DESCRIBE"];

/**
 * The operative keyword of a GraphQL document, at the top level.
 *
 * The same problem as `queryFormOf' in another notation, and it has to be
 * solved the same way: `mutation' appearing inside a selection set, a string
 * or a comment is not a mutation, and a document that opens with a `fragment'
 * declaration is still whatever its operation says it is.  So the scan tracks
 * brace depth and strings, and reads only the identifiers that appear at
 * depth zero.
 *
 * An anonymous `{ … }' is a query -- that is what the shorthand means.
 */
export function graphqlOperationOf(text) {
  const s = String(text || "");
  let depth = 0, i = 0, sawSelection = false;
  while (i < s.length) {
    const c = s[i];
    if (c === "#") { while (i < s.length && s[i] !== "\n") i += 1; continue; }
    if (c === '"') {
      const triple = s.startsWith('"""', i);
      i += triple ? 3 : 1;
      while (i < s.length) {
        if (s[i] === "\\") { i += 2; continue; }
        if (triple ? s.startsWith('"""', i) : s[i] === '"') { i += triple ? 3 : 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === "{") { if (depth === 0) sawSelection = true; depth += 1; i += 1; continue; }
    if (c === "}") { depth -= 1; i += 1; continue; }
    if (depth === 0 && /[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      const word = s.slice(i, j).toLowerCase();
      if (word === "mutation" || word === "subscription" || word === "query") return word;
      i = j;
      continue;
    }
    i += 1;
  }
  // A selection set at the top level and no keyword before it: the anonymous
  // shorthand.  Decided from the scan rather than from the first character,
  // which a leading comment would otherwise answer for.
  return sawSelection ? "query" : null;
}

/**
 * True when a body only reads.
 *
 * The notation decides how to read the body, which is why it is a parameter:
 * a GraphQL `mutation' and a SPARQL `DELETE' are the same hazard in different
 * words, and a screen that only knows SPARQL keywords calls the first a read.
 */
export function bodyReadsOnly(text, mimeType = null) {
  if (text == null || text === "") return true;
  if (mimeType === "application/graphql+json") {
    // The JSON envelope: the document is in `query', whatever it is.
    try {
      const o = JSON.parse(String(text));
      return bodyReadsOnly(o && o.query, "application/graphql");
    } catch { return bodyReadsOnly(String(text), "application/graphql"); }
  }
  if (mimeType === "application/graphql") {
    const op = graphqlOperationOf(text);
    return op !== "mutation" && op !== "subscription";
  }
  // A score expression selects and narrows; it has no write form.  Falling
  // through to the SPARQL scan would be harmless but would also report a
  // nonsense `form' in a refusal, so it is named.
  if (mimeType === "application/score") return true;
  const form = queryFormOf(text);
  return form === null || READ_FORMS.includes(form);
}

/** Where a document may arrive.  `query' says `text'; `survey' says `body'. */
export const BODY_FIELDS = ["text", "body", "query", "update"];

/**
 * Why this call's ARGUMENTS may not go out, or null.  Work item U-11.
 *
 * Separated from the grant and exported, because the screen is needed in two
 * places that are not the same place.  A dashboard run has a grant and the
 * grant is the policy -- including a grant the user deliberately made
 * writable, which this must not then override.  A single-figure run has no
 * grant at all: §2 confirms the one query at Gate 1 and there is no budget to
 * charge.  But it offers `query', and offering `query' with its `mimeType'
 * left free offers `application/sparql-update' with it.
 *
 * So the adapter applies this directly when there is no grant, and the grant
 * applies it itself when there is one and it is read-only.  The screen is on
 * the ARGUMENT, which is the only place it can be: `selectTools' screens
 * names, and the name `query' is the same name whichever notation it carries.
 */
export function argumentRefusal(call, { tools = GRANTABLE_TOOLS } = {}) {
  const name = call?.name || "";
  if (tools && !tools.includes(name)) {
    return `\`${name}' is not one of the tools this run offers (${tools.join(", ")})`;
  }
  const input = call?.input || {};
  const mt = input.mimeType || null;
  if (mt && WRITE_NOTATIONS.includes(mt)) return `\`${mt}' writes, and this run reads`;
  if (mt && !READ_NOTATIONS.includes(mt)) {
    return `\`${mt}' is not a read notation (${READ_NOTATIONS.join(", ")})`;
  }
  // `accept' selects what comes back and cannot write; naming a write
  // notation there is a confusion rather than a hazard, and is said to be.
  if (input.accept && WRITE_NOTATIONS.includes(input.accept)) {
    return `\`${input.accept}' is a request notation, not something a result `
         + `can be asked for (${RESPONSE_NOTATIONS.join(", ")})`;
  }
  // EVERY argument that could carry a document, not one of them.  The two
  // tools spell it differently -- `survey' takes `body' in score notation and
  // `query' takes `text' -- and an earlier draft screened only `body', which
  // left the SPARQL of the one tool the screen exists for entirely unread.
  for (const field of BODY_FIELDS) {
    if (input[field] == null || input[field] === "") continue;
    if (!bodyReadsOnly(input[field], mt)) {
      const what = mt && mt.startsWith("application/graphql")
        ? `a GraphQL ${graphqlOperationOf(
             mt === "application/graphql+json"
               ? (() => { try { return JSON.parse(String(input[field])).query; } catch { return input[field]; } })()
               : input[field])}`
        : `a ${queryFormOf(input[field])}`;
      return `the \`${field}' argument is ${what}, and this run reads`;
    }
  }
  return null;
}


/** "acct/repo" from whatever the caller has: a pair, a string, an endpoint. */
export function repositoryKey(value) {
  if (!value) return null;
  if (typeof value === "object") {
    return value.account && value.repository ? `${value.account}/${value.repository}` : null;
  }
  const s = String(value);
  const m = s.match(/\/?([^/]+)\/([^/]+?)(?:\/(?:mcp|sparql))?\/?$/);
  return m ? `${m[1]}/${m[2]}` : (s.includes("/") ? s : null);
}

/**
 * A grant.  `spec' is what the user agreed to; everything else is bookkeeping.
 *
 * The object is deliberately small and synchronous: the adapter calls `check'
 * in a hot path, the pane reads `state()' to paint a meter, and neither should
 * have to await anything or guess at a shape.
 */
export function createGrant(spec = {}, { onChange = () => {}, now = () => Date.now() } = {}) {
  const limits = {
    ...DEFAULT_GRANT, ...spec,
    repositories: (spec.repositories || DEFAULT_GRANT.repositories).map(repositoryKey).filter(Boolean),
  };
  const spent = { queries: 0, rows: 0, bytes: 0 };
  const events = [];
  let revoked = null;          // the reason, once revoked
  const issued = now();

  const note = (event) => {
    const e = { at: new Date().toISOString(), ...event };
    events.push(e);
    try { onChange(e, api); } catch { /* a meter that throws must not stop a run */ }
    return e;
  };

  const remaining = () => ({
    queries: Math.max(0, limits.maxQueries - spent.queries),
    rows: Math.max(0, limits.maxRows - spent.rows),
    bytes: Math.max(0, limits.maxBytes - spent.bytes),
  });

  /** Why this call may not proceed, or null. */
  function refusalFor(call) {
    if (revoked) return `the grant was revoked: ${revoked}`;
    const name = call?.name || "";
    if (!GRANTABLE_TOOLS.includes(name)) {
      return `\`${name}' is not a tool this grant covers `
           + `(${GRANTABLE_TOOLS.join(", ")})`;
    }
    const input = call?.input || {};
    // The same screen the ungranted path uses, worded as the grant's: a
    // grant the user made writable is entitled to pass a write through, so
    // this is asked only when the grant says read-only.
    if (limits.readOnly) {
      const why = argumentRefusal(call, { tools: GRANTABLE_TOOLS });
      if (why) return `the grant is read-only: ${why}`;
    }
    const repo = repositoryKey(input.repository || input.repositoryId || null);
    if (repo && limits.repositories.length && !limits.repositories.includes(repo)) {
      return `\`${repo}' is outside the grant `
           + `(${limits.repositories.join(", ") || "no repository"})`;
    }
    if (spent.queries >= limits.maxQueries) {
      return `the grant allows ${limits.maxQueries} call(s) and all are spent`;
    }
    if (spent.bytes >= limits.maxBytes) {
      return `the grant's ${limits.maxBytes}-byte budget is spent`;
    }
    return null;
  }

  const api = {
    get limits() { return { ...limits }; },
    get spent() { return { ...spent }; },
    get revoked() { return revoked; },
    get events() { return events.slice(); },
    issued,

    /** Can this call go out?  Charges the call count when it can. */
    check(call) {
      const reason = refusalFor(call);
      if (reason) {
        note({ type: "refused", call: call?.name, reason });
        return { ok: false, reason };
      }
      spent.queries += 1;
      note({ type: "charged", call: call?.name, queries: spent.queries,
             remaining: remaining() });
      return { ok: true, reason: null };
    },

    /** What a call actually cost, once it is back.  Never refuses: it is spent. */
    chargeResult({ bytes = 0, rows = 0 } = {}) {
      spent.bytes += Math.max(0, Number(bytes) || 0);
      spent.rows += Math.max(0, Number(rows) || 0);
      note({ type: "spent", bytes: spent.bytes, rows: spent.rows, remaining: remaining() });
      return remaining();
    },

    /** Stop, now.  The next check refuses and says why. */
    revoke(reason = "the user revoked it") {
      if (revoked) return false;
      revoked = String(reason);
      note({ type: "revoked", reason: revoked });
      return true;
    },

    /**
     * Raise a ceiling, mid-run, without restarting.  Only upward: a grant that
     * could be narrowed from here would let a widening dialog be used to take
     * authority away silently, and the user who widens is not the one deciding
     * to revoke.  Revocation is its own operation and says so.
     */
    widen(patch = {}) {
      const changed = {};
      for (const key of ["maxQueries", "maxRows", "maxBytes"]) {
        if (patch[key] != null && Number(patch[key]) > limits[key]) {
          changed[key] = [limits[key], Number(patch[key])];
          limits[key] = Number(patch[key]);
        }
      }
      for (const r of (patch.repositories || []).map(repositoryKey).filter(Boolean)) {
        if (!limits.repositories.includes(r)) {
          limits.repositories.push(r);
          (changed.repositories || (changed.repositories = [])).push(r);
        }
      }
      if (patch.readOnly === false && limits.readOnly) {
        limits.readOnly = false;
        changed.readOnly = [true, false];
      }
      if (revoked && patch.reinstate) { note({ type: "reinstated", was: revoked }); revoked = null; }
      if (Object.keys(changed).length) note({ type: "widened", changed, limits: { ...limits } });
      return changed;
    },

    remaining,

    /** Everything a meter or a transcript needs, in one read. */
    state() {
      return { limits: { ...limits }, spent: { ...spent }, remaining: remaining(),
               revoked, issued };
    },

    /** One line, for a confirmation dialog and for the record. */
    summary() {
      const where = limits.repositories.length ? limits.repositories.join(", ") : "this repository";
      return `${where} · ${limits.readOnly ? "read-only" : "READ AND WRITE"} · `
           + `${limits.maxQueries} call(s) · ${limits.maxRows} rows · `
           + `${Math.round(limits.maxBytes / 1024)} KiB · for this ${limits.lifetime}`;
    },
  };
  return api;
}

export default createGrant;
