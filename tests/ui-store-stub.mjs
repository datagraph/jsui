/**
 * A store `<account>/ui' can be driven against, in node or in a browser.
 *
 * The arrangement paths (U-80 … U-88) are the first ones in this interface
 * where the STORE is part of the behaviour rather than a place the result is
 * kept: a mount is once-only because an `INSERT … WHERE FILTER NOT EXISTS'
 * says so, an arrangement is listable without its template because the
 * listing does not project one, and an applied panel keeps its source
 * because the panel's own triple carries it.  None of that can be asserted
 * against a stub that answers everything with "fine".
 *
 * So this is a small triple store rather than a recording of expected
 * answers.  It is NOT a SPARQL implementation and does not pretend to be:
 * it reads the shapes this interface actually sends, and throws nothing at
 * anything else — an unrecognised query answers with no rows, which is what
 * a store with nothing in it would say and is the safe way to be wrong.
 *
 * What it does model, because the tests turn on it:
 *
 *   * named graphs, so a presentation written by `writePresentation' reads
 *     back through `readPresentation' as the same document;
 *   * the default graph, where the catalogue entries, the arrangements, the
 *     mount registry and the application records all live together;
 *   * `DROP SILENT GRAPH', `DELETE WHERE' and the guarded insert, in the
 *     order they arrive in one body — several statements in one update are
 *     one transaction, and the mount claim depends on the guard being read
 *     rather than ignored.
 *
 * The variable-to-predicate mapping is read out of the QUERY rather than
 * hard-coded: every select here binds `ui:name ?name', `ui:of ?panel' and so
 * on, so the query says what each column is and a stub that guessed would be
 * asserting its own guess.
 */

const UI = "http://dydra.com/ns/ui#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/* ── terms ────────────────────────────────────────────────────────────────── */

const unescape_ = (s) => String(s).replace(/\\(u[0-9A-Fa-f]{4}|.)/g, (m, c) => {
  if (c[0] === "u") return String.fromCodePoint(parseInt(c.slice(1), 16));
  return { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" }[c] ?? c;
});

const TERM = /<([^>\s]*)>|"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]*)>|@([A-Za-z-]+))?/y;

/** Read one term at POS, or null.  Returns `[term, next]'. */
function readTerm(text, pos) {
  TERM.lastIndex = pos;
  const m = TERM.exec(text);
  if (!m) return null;
  const term = m[1] !== undefined
    ? { type: "uri", value: m[1] }
    : { type: "literal", value: unescape_(m[2]),
        ...(m[3] ? { datatype: m[3] } : {}), ...(m[4] ? { "xml:lang": m[4] } : {}) };
  return [term, TERM.lastIndex];
}

const PREFIXED = /\b(ui|rdf):([A-Za-z][A-Za-z0-9_-]*)/y;

/** `ui:name' and `a' as IRIs, so both spellings of a statement parse. */
function readPredicate(text, pos) {
  const at = skip(text, pos);
  if (text.startsWith("a ", at) || text.startsWith("a\n", at) || text.startsWith("a\t", at)) {
    return [{ type: "uri", value: RDF_TYPE }, at + 1];
  }
  PREFIXED.lastIndex = at;
  const m = PREFIXED.exec(text);
  if (m) {
    const base = m[1] === "ui" ? UI : "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    return [{ type: "uri", value: base + m[2] }, PREFIXED.lastIndex];
  }
  return readTerm(text, at);
}

function readObject(text, pos) {
  const at = skip(text, pos);
  PREFIXED.lastIndex = at;
  const m = PREFIXED.exec(text);
  if (m) {
    const base = m[1] === "ui" ? UI : "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    return [{ type: "uri", value: base + m[2] }, PREFIXED.lastIndex];
  }
  return readTerm(text, at);
}

const skip = (text, pos) => {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
};

/**
 * The statements inside one `{ … }' block, in turtle's subject-predicate
 * shape: `<s> <p> <o> .' and `<s> a ui:X ; ui:of "y" ; ui:at "z" .'
 */
export function readTriples(block) {
  const out = [];
  let pos = 0;
  let subject = null;
  while (pos < block.length) {
    pos = skip(block, pos);
    if (pos >= block.length) break;
    const ch = block[pos];
    if (ch === "." ) { subject = null; pos += 1; continue; }
    if (ch === ";") { pos += 1; }
    else {
      const s = readTerm(block, skip(block, pos));
      if (!s) break;
      subject = s[0].value;
      pos = s[1];
    }
    const p = readPredicate(block, pos);
    if (!p) break;
    const o = readObject(block, p[1]);
    if (!o) break;
    out.push({ s: subject, p: p[0].value, o: o[0] });
    pos = o[1];
  }
  return out;
}

/* ── the store ────────────────────────────────────────────────────────────── */

const blockOf = (text, from) => {
  const open = text.indexOf("{", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") { depth -= 1; if (!depth) return text.slice(open + 1, i); }
  }
  return null;
};

export function uiStore({ existing = [] } = {}) {
  /** The default graph: catalogue entries, arrangements, mounts, records. */
  let base = [...existing];
  /** One array per named graph: a presentation each. */
  const graphs = new Map();
  const calls = [];

  const dropSubject = (s) => { base = base.filter((t) => t.s !== s); };

  /**
   * One update body, as its statements.
   *
   * Split on the semicolons OUTSIDE any brace, because turtle uses the same
   * character to continue a subject: `INSERT { <s> a ui:Mount ; ui:of "x" }'
   * is one statement and splitting on every `;' tears its block in half.
   */
  function statements(body) {
    const out = [];
    let depth = 0, from = 0, quoted = false;
    const text = String(body);
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) { if (ch === "\\") i += 1; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') quoted = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ";" && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
    }
    out.push(text.slice(from));
    return out;
  }

  function update(body) {
    for (const raw of statements(body)) {
      const text = raw.trim();
      if (!text) continue;
      let m;
      if ((m = /^DROP\s+SILENT\s+GRAPH\s+<([^>]*)>/i.exec(text))) {
        graphs.delete(m[1]);
      } else if (/^(PREFIX[\s\S]*?)?\s*DELETE\s+WHERE/i.test(text)) {
        const block = blockOf(text, text.search(/DELETE\s+WHERE/i)) || "";
        const s = /<([^>]*)>/.exec(block);
        if (s) dropSubject(s[1]);
      } else if (/DELETE\s*\{[\s\S]*WHERE/i.test(text)) {
        // `forgetApplications': every record of one type at one presentation.
        const where = text.slice(text.search(/WHERE/i));
        const type = /a\s+ui:(\w+)/.exec(where);
        const at = /ui:at\s+"((?:[^"\\]|\\.)*)"/.exec(where);
        const typed = type ? UI + type[1] : null;
        const subjects = new Set(base
          .filter((t) => t.p === RDF_TYPE && (!typed || t.o.value === typed))
          .map((t) => t.s));
        for (const s of subjects) {
          if (at && !base.some((t) => t.s === s && t.p === UI + "at"
                                     && t.o.value === unescape_(at[1]))) continue;
          dropSubject(s);
        }
      } else if (/^(PREFIX[\s\S]*?)?\s*INSERT\s*\{/i.test(text) && /WHERE/i.test(text)) {
        // The guarded claim.  The guard is READ, because what it enforces is
        // the once-only rule of §21.4.1 and a stub that ignored it would
        // make that rule pass for the wrong reason.
        const insert = blockOf(text, text.search(/INSERT\s*\{/i)) || "";
        const where = text.slice(text.search(/WHERE/i));
        const guard = /FILTER\s+NOT\s+EXISTS\s*\{\s*<([^>]*)>\s+a\s+ui:(\w+)/i.exec(where);
        if (guard) {
          const held = base.some((t) => t.s === guard[1] && t.p === RDF_TYPE
                                        && t.o.value === UI + guard[2]);
          if (held) continue;
        }
        base.push(...readTriples(insert));
      } else if (/^(PREFIX[\s\S]*?)?\s*INSERT\s+DATA/i.test(text)) {
        const inner = blockOf(text, text.search(/INSERT\s+DATA/i)) || "";
        const named = /^\s*GRAPH\s+<([^>]*)>/i.exec(inner);
        if (named) {
          const block = blockOf(inner, 0) || "";
          graphs.set(named[1], readTriples(block));
        } else {
          base.push(...readTriples(inner));
        }
      }
    }
    return { ok: true, status: 200, text: async () => "" };
  }

  const rows = (bindings) => ({
    ok: true, status: 200,
    headers: { get: () => "application/sparql-results+json" },
    text: async () => JSON.stringify({ head: {}, results: { bindings } }),
  });

  function query(text) {
    if (/^\s*ASK/i.test(text)) return rows([{}]);

    const graph = /GRAPH\s+<([^>]*)>\s*\{\s*\?s\s+\?p\s+\?o/i.exec(text);
    if (graph) {
      return rows((graphs.get(graph[1]) || []).map((t) => ({
        s: { type: "uri", value: t.s }, p: { type: "uri", value: t.p }, o: t.o })));
    }

    // What each column is, read off the query: `ui:name ?name' says that the
    // column `name' is the object of `ui:name'.
    const columns = new Map();
    for (const m of text.matchAll(/\bui:(\w+)\s+\?(\w+)/g)) columns.set(m[2], UI + m[1]);
    // What the subject has to be, and what it has to be typed as.
    const typed = /(?:\?(\w+)|<([^>]*)>)\s+a\s+ui:(\w+)/.exec(text);
    if (!typed) return rows([]);
    const subjectVar = typed[1] || null;
    const only = typed[2] || null;
    const type = UI + typed[3];
    // Literal equalities written inline: `ui:at "report"'.
    const required = [...text.matchAll(/\bui:(\w+)\s+"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => [UI + m[1], unescape_(m[2])]);

    const subjects = [...new Set(base.filter((t) => t.p === RDF_TYPE && t.o.value === type)
                                     .map((t) => t.s))];
    const out = [];
    for (const s of subjects) {
      if (only && s !== only) continue;
      const held = base.filter((t) => t.s === s);
      const value = (p) => held.find((t) => t.p === p)?.o || null;
      if (required.some(([p, v]) => value(p)?.value !== v)) continue;
      const b = {};
      if (subjectVar) b[subjectVar] = { type: "uri", value: s };
      for (const [name, p] of columns) {
        const o = value(p);
        if (o) b[name] = o;
      }
      out.push(b);
    }
    return rows(out);
  }

  /** What `fetchImpl' (and a browser's `fetch') is given. */
  const fetchImpl = async (url, init = {}) => {
    const body = String(init?.body || "");
    const type = init?.headers?.["Content-Type"] || init?.headers?.["content-type"] || "";
    calls.push({ url: String(url), type, body });
    if (/sparql-update/.test(type)) return update(body);
    if (/sparql-query/.test(type)) return query(body);
    // The repository probe's fallback: creating `<account>/ui'.
    return { ok: true, status: 201, headers: { get: () => "application/json" },
             text: async () => "{}" };
  };

  return {
    fetchImpl, calls,
    triples: () => [...base],
    graph: (name) => [...(graphs.get(name) || [])],
    graphNames: () => [...graphs.keys()],
  };
}

export default uiStore;
