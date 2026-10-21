/**
 * What a result looks like, for a model that cannot be handed all of it.
 *
 * Implements D-Q and, with `contentDigest', D-T of
 * `llm-result-rendering-plan.md' §7.2.
 *
 * D-L stands: ONE figure from ONE query gets the whole result document, and
 * nothing here is a cap on what the model may ask for.  It may ask for any
 * result in full, and for all of them, up to the grant's byte budget.  What
 * this module changes is the DEFAULT -- what arrives unasked -- because a
 * dashboard is a dozen result sets, a dozen full documents fit no context, and
 * row 900 of a table that will only be charted buys nothing at all.  The model
 * spends its budget where the analysis needs the values: the series it is
 * writing prose about, the two sets it is joining by hand.
 *
 * So a digest is not a summary for the user's benefit.  It is an index: enough
 * for the model to decide the visual form, name the columns in a transform,
 * write a query that reduces instead of enumerating, and tell whether it needs
 * the rows at all.  Everything in it is therefore structural -- columns, types,
 * ranges, cardinality, a head sample -- and nothing in it is interpretation.
 *
 * `contentDigest' is the other half, and it is what makes an assertion
 * checkable later (D-T): prose written against a result carries the digest of
 * that result, and on refresh the pane recomputes it and can say the prose no
 * longer matches.  It must therefore be stable across reloads and cheap enough
 * to run on every panel of every refresh, which rules out crypto.subtle -- that
 * is async, and a synchronous call site cannot await it.  FNV-1a over two
 * offsets gives 128 bits of non-cryptographic hash, which is what is wanted:
 * this detects CHANGE, it does not resist an adversary, and there is no
 * adversary here -- both the before and the after came from the same store
 * through the same pane.
 */

/* ── identity ─────────────────────────────────────────────────────────────── */

/** FNV-1a, 32 bits, seeded.  Four of these make the digest below. */
function fnv1a(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (s.charCodeAt(i) >> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A stable content hash: 32 hex characters, same text always the same answer.
 *
 * Length is mixed in so that a truncation is not a near-miss, and four seeds
 * are used rather than one so that two documents differing in a single byte do
 * not collide in the low bits of a single 32-bit walk.
 */
export function contentDigest(text) {
  const s = String(text ?? "");
  const parts = [0x811c9dc5, 0x01234567, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => fnv1a(s, seed ^ (s.length >>> 0)));
  return parts.map((p) => p.toString(16).padStart(8, "0")).join("");
}

/* ── reading a result document ────────────────────────────────────────────── */

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATEISH = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}|$)/;
const IRISH = /^(?:https?|urn|file|mailto|tag|did|ftp):/i;

/** What a single cell is, as far as a model needs to know. */
export function cellType(value) {
  const v = String(value ?? "");
  if (!v) return "empty";
  if (IRISH.test(v)) return "iri";
  if (DATEISH.test(v)) return "date";
  // The LEXICAL form decides, not the value: "1180.0" is an xsd:decimal and
  // `Number.isInteger(1180.0)' is true, so asking the number would call a whole
  // column of decimals integers and mislead a model choosing an axis for it.
  if (NUMERIC.test(v)) return /[.eE]/.test(v) ? "decimal" : "integer";
  if (/^_:/.test(v)) return "blank";
  return "literal";
}

/** Separated values, honouring quotes where the notation uses them. */
function parseSeparated(text, sep) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && sep === ",") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").length);
}

/** SPARQL Results JSON, or null when the text is not that. */
function parseResultsJson(text) {
  let json;
  try { json = JSON.parse(text); } catch { return null; }
  if (json && typeof json.boolean === "boolean") {
    return { form: "boolean", value: json.boolean };
  }
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return null;
  const names = json.head?.vars || Object.keys(bindings[0] || {});
  // A term's value is what a figure draws; its kind is kept as a type hint
  // rather than carried into every cell, which is what `cellType' re-derives.
  const rows = bindings.map((b) => names.map((n) => (b[n] ? String(b[n].value) : "")));
  return { form: "table", names, rows };
}

/** N-Triples / Turtle, read for its shape, not parsed into a graph. */
function parseGraphish(text) {
  const lines = String(text || "").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^@?(prefix|base)\b/i.test(l));
  const predicates = new Map();
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(\S+)\s+(.*?)\s*\.?$/);
    if (m) predicates.set(m[2], (predicates.get(m[2]) || 0) + 1);
  }
  return { form: "graph", statements: lines.length, predicates, sample: lines.slice(0, 6) };
}

/** The score notation an MCP survey answers in: `key: value' lines. */
function looksLikeScore(text) {
  return /^\s*\w[\w-]*\s*:\s*/.test(String(text || "")) && !/^\s*[{[]/.test(String(text || ""));
}

/**
 * The digest of one result document.
 *
 * `mimeType' is a hint, not an authority: the pane asks for one notation and
 * the service may answer in another, and a digest that trusted the request
 * would describe a document that is not there.  The text decides; the hint
 * only breaks ties between CSV and TSV.
 */
/**
 * A result as a table, when the columns themselves are wanted rather than
 * their shape.
 *
 * `digestResult' describes a result; this reads one.  The only caller is the
 * parameter machinery (D-X), which has to know what values a panel's column
 * actually returned before it will admit one of them as a parameter value --
 * a domain read off the data rather than asserted by the model.
 */
export function tableOf(text, mimeType = null) {
  const s = typeof text === "string" ? text : (text == null ? "" : String(text));
  const json = parseResultsJson(s);
  if (json?.form === "boolean") return { names: ["value"], rows: [[String(json.value)]] };
  if (json) return { names: json.names, rows: json.rows };
  const sep = mimeType === "text/csv" || (s.includes(",") && !s.includes("\t")) ? "," : "\t";
  const table = parseSeparated(s, sep);
  if (!table.length) return { names: [], rows: [] };
  return { names: table[0].map((n) => n.replace(/^\?/, "")), rows: table.slice(1) };
}

export function digestResult(text, mimeType = null, { sample = 5, maxDistinct = 5000 } = {}) {
  const s = typeof text === "string" ? text : (text == null ? "" : String(text));
  const base = { mimeType, bytes: s.length, digest: contentDigest(s) };

  const json = parseResultsJson(s);
  if (json?.form === "boolean") {
    return { ...base, form: "boolean", value: json.value, rows: 1, columns: [], sample: [] };
  }

  let names = null, rows = null;
  if (json) { names = json.names; rows = json.rows; }
  else if (/^\s*[@<_]|^\s*\w+:\w+\s+\S/.test(s) && !looksLikeScore(s)) {
    const g = parseGraphish(s);
    return {
      ...base, form: "graph", rows: g.statements, statements: g.statements,
      predicates: [...g.predicates.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([name, count]) => ({ name, count })),
      columns: [], sample: g.sample,
    };
  } else if (looksLikeScore(s)) {
    return { ...base, form: "score", rows: null, columns: [],
             sample: s.split("\n").slice(0, 12) };
  } else {
    const sep = mimeType === "text/csv" || (s.includes(",") && !s.includes("\t")) ? "," : "\t";
    const table = parseSeparated(s, sep);
    if (!table.length) return { ...base, form: "unknown", rows: 0, columns: [], sample: [] };
    names = table[0].map((n) => n.replace(/^\?/, ""));
    rows = table.slice(1);
  }

  const columns = names.map((name, i) => {
    const types = new Map();
    const seen = new Set();
    let empty = 0, min = null, max = null, sum = 0, numeric = 0;
    const examples = [];
    for (const r of rows) {
      const v = r[i] ?? "";
      const t = cellType(v);
      types.set(t, (types.get(t) || 0) + 1);
      if (t === "empty") { empty += 1; continue; }
      if (seen.size < maxDistinct) seen.add(v);
      if (examples.length < 3 && !examples.includes(v)) examples.push(v);
      if (t === "integer" || t === "decimal") {
        const n = Number(v);
        numeric += 1; sum += n;
        min = min === null || n < min ? n : min;
        max = max === null || n > max ? n : max;
      } else if (t === "date") {
        min = min === null || v < min ? v : min;
        max = max === null || v > max ? v : max;
      }
    }
    return {
      name,
      types: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ type: t, count: n })),
      distinct: seen.size >= maxDistinct ? `${maxDistinct}+` : seen.size,
      empty,
      ...(min !== null ? { min, max } : {}),
      ...(numeric ? { mean: Math.round((sum / numeric) * 1000) / 1000 } : {}),
      examples,
    };
  });

  return {
    ...base, form: "table", rows: rows.length, names, columns,
    sample: rows.slice(0, sample),
  };
}

/* ── showing it to the model ──────────────────────────────────────────────── */

const n = (v) => Number(v).toLocaleString("en-US");

/**
 * The digest as the model reads it.
 *
 * Deliberately terse and deliberately tabular: this is read by something that
 * pays per token, and the sentence "the region column contains twelve distinct
 * literal values" costs four times what the line below it does and says less.
 * The last line is the part that makes it a default rather than a limit -- it
 * states, every time, how to get the whole document.
 */
export function renderDigest(d, { name = null, howToAsk = null } = {}) {
  if (!d) return "(no result)";
  const head = [`${name ? name + " — " : ""}${d.form}`,
                d.rows != null ? `${n(d.rows)} ${d.form === "graph" ? "statements" : "rows"}` : null,
                d.columns?.length ? `${d.columns.length} columns` : null,
                `${n(d.bytes)} bytes`,
                d.mimeType || null,
                `digest ${d.digest.slice(0, 12)}`].filter(Boolean).join(" · ");
  const out = [head];

  if (d.form === "boolean") out.push(`  value: ${d.value}`);

  for (const c of d.columns || []) {
    const kinds = c.types.map((t) => `${t.type}`).join("/");
    const range = c.min != null ? `  ${c.min}…${c.max}` : "";
    const mean = c.mean != null ? `  mean ${c.mean}` : "";
    const eg = c.examples.length ? `  e.g. ${c.examples.map((e) => JSON.stringify(e)).join(", ")}` : "";
    out.push(`  ${c.name}  ${kinds}  ${c.distinct} distinct`
           + `${c.empty ? `  ${c.empty} empty` : ""}${range}${mean}${eg}`);
  }

  if (d.predicates?.length) {
    out.push("  predicates:");
    for (const p of d.predicates.slice(0, 12)) out.push(`    ${p.name}  ${n(p.count)}`);
  }

  if (d.sample?.length) {
    out.push(`  sample (${d.sample.length} of ${d.rows != null ? n(d.rows) : "?"}):`);
    for (const row of d.sample) {
      out.push(`    ${Array.isArray(row) ? row.join("\t") : row}`);
    }
  }

  out.push(howToAsk
    || "  This is the shape, not the data. Ask for the full document when the "
     + "analysis needs the values; a query that reduces is cheaper than one that enumerates.");
  return out.join("\n");
}

/** Rows a result claims, for charging the grant.  Null when it cannot be told. */
export function rowsOf(d) {
  return d && typeof d.rows === "number" ? d.rows : 0;
}

export default digestResult;
