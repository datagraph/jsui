/**
 * Parameters: the one place a page influences what runs, and the reason that
 * is safe.
 *
 * Implements D-X and §13.3 of `ui-generator.md'; work item U-33.
 *
 * §3.2's gap is that a page cannot ask a question: every query is fixed when
 * the user authorises it, so a region selector is not expressible and the
 * only way to see another region is another whole run.  The obvious fix --
 * let the page send query text -- is D-I inverted and is refused outright
 * (D-Z).  The fix taken instead is the one SPARQL already has for exactly
 * this: INLINE DATA.
 *
 *      SPARQL 1.1 §18.2.5, and the `ValuesClause' at the end of the Query
 *      production: a `VALUES' clause written after the whole query joins its
 *      rows with the query's pattern before projection and before the
 *      solution modifiers.
 *
 * That is worth dwelling on, because it is what makes D-X's promise literal
 * rather than approximate.  The query the user read at Gate 1 is not parsed
 * here, not rewritten, not interpolated into, and not wrapped.  It is
 * APPENDED TO.  Byte for byte, up to the last character the model wrote, the
 * text that runs is the text that was authorised, and the only thing after it
 * is a clause that binds named variables to terms this module built.
 *
 * Which leaves one thing to get right, and it is the thing this module exists
 * for: turning a value from a page into an RDF term.  One encoder, one place
 * to get quoting, language tags and datatypes right, one place to test.  Its
 * rules are deliberately narrow:
 *
 *   - a datatype is written as a FULL IRI, never as a prefixed name, because
 *     a prefixed name depends on a prologue the appended clause does not have
 *     and the query may not declare;
 *   - `xsd:string' with no language is written as a plain literal, which is
 *     the same term and avoids the question entirely;
 *   - an IRI parameter is checked for the characters that would end the
 *     `<...>' early, and refused rather than escaped, because a value that
 *     needs escaping to sit in an IRI is not an IRI;
 *   - everything else is refused with a reason, which the page is shown.
 *
 * A value outside its declared domain never reaches the encoder at all.  The
 * domain is checked first, against the enumeration, the range, or the values
 * a named panel actually returned -- read off the result, not asserted by the
 * model.
 */

import { tableOf } from "../mcp/result-digest.js";

const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** The prefixes a datatype may be written with.  Anything else must be a full IRI. */
export const DATATYPE_PREFIXES = { xsd: XSD, rdf: RDF };

/** Datatypes whose lexical form this module will check before binding. */
const NUMERIC = new Set(["integer", "decimal", "double", "float", "long", "int",
                         "short", "byte", "nonNegativeInteger", "positiveInteger",
                         "negativeInteger", "nonPositiveInteger", "unsignedLong",
                         "unsignedInt", "unsignedShort", "unsignedByte"]);

/** A datatype as a full IRI, or null when it cannot be resolved to one. */
export function datatypeIri(datatype) {
  const d = String(datatype || "").trim();
  if (!d) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(d) || /^urn:/i.test(d)) return d;
  const m = /^([A-Za-z][A-Za-z0-9_-]*):([^\s<>"{}|\\^`]+)$/.exec(d);
  if (m && DATATYPE_PREFIXES[m[1]]) return DATATYPE_PREFIXES[m[1]] + m[2];
  return null;
}

/** A literal's lexical form, escaped for a SPARQL quoted string. */
export function escapeLiteral(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * One value as one RDF term.  Returns {ok, term} or {ok:false, reason}.
 *
 * Never throws and never produces a term it is unsure of: a term this
 * function will not write is a request the page is refused, which is a
 * reported outcome.  A term written wrong is a query that runs and means
 * something else, which is not.
 */
export function termFor(parameter, value) {
  const p = parameter || {};
  if (value == null) return { ok: false, reason: "no value given" };
  if (typeof value === "object") {
    return { ok: false, reason: "a parameter takes one value, not an object" };
  }
  const text = String(value);
  // A control character would be written literally into the query text and
  // read as whitespace or worse; there is no legitimate parameter value that
  // needs one.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    return { ok: false, reason: "the value contains a control character" };
  }

  if (p.kind === "iri") {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) {
      return { ok: false, reason: `\`${text}' is not an absolute IRI` };
    }
    if (/[\s<>"{}|\\^`]/.test(text)) {
      return { ok: false, reason: "an IRI may not contain a space or any of <>\"{}|\\^`" };
    }
    return { ok: true, term: `<${text}>` };
  }

  const iri = p.datatype ? datatypeIri(p.datatype) : null;
  if (p.datatype && !iri) {
    return { ok: false,
             reason: `the datatype \`${p.datatype}' is not a full IRI and not a prefix this `
                   + `interface knows (${Object.keys(DATATYPE_PREFIXES).join(", ")})` };
  }
  const local = iri && iri.startsWith(XSD) ? iri.slice(XSD.length) : null;
  if (local && NUMERIC.has(local) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    return { ok: false, reason: `\`${text}' is not a ${local}` };
  }
  if (local === "boolean" && !/^(true|false|0|1)$/.test(text)) {
    return { ok: false, reason: `\`${text}' is not a boolean` };
  }
  const quoted = `"${escapeLiteral(text)}"`;
  if (p.language) {
    if (!/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(String(p.language))) {
      return { ok: false, reason: `\`${p.language}' is not a language tag` };
    }
    return { ok: true, term: `${quoted}@${p.language}` };
  }
  // A plain literal and an xsd:string literal are the same term; writing the
  // plain form keeps the clause shorter and removes one thing to get wrong.
  if (!iri || iri === `${XSD}string`) return { ok: true, term: quoted };
  return { ok: true, term: `${quoted}^^<${iri}>` };
}

/* ── domains ──────────────────────────────────────────────────────────────── */

/** The values a panel's column actually returned, as strings. */
export function columnValues(payload, column) {
  if (!payload || !payload.ok) return null;
  const t = tableOf(payload.text, payload.mimeType);
  if (!t.names.length) return null;
  const at = column ? t.names.indexOf(column) : 0;
  if (at < 0) return null;
  const out = [];
  const seen = new Set();
  for (const row of t.rows) {
    const v = row[at];
    if (v == null || v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Is this value one the parameter admits?  Returns {ok} or {ok:false, reason}.
 *
 * `results' is what the interface last ran, which is where a `from' domain
 * gets its values: the enumeration a selector offers is the one the store
 * returned, not one the model wrote down.  A domain that names a panel which
 * has not run yet is not a reason to refuse -- the page cannot have offered a
 * value it did not have -- so that case admits the value and says so.
 */
export function checkValue(parameter, value, { results = {} } = {}) {
  const p = parameter || {};
  const term = termFor(p, value);
  if (!term.ok) return term;
  const d = p.domain;
  if (!d) return { ok: true, term: term.term };

  if (Array.isArray(d.values)) {
    const admitted = d.values.map((v) => String(v));
    if (!admitted.includes(String(value))) {
      return { ok: false,
               reason: `\`${value}' is not one of ${admitted.slice(0, 8).map((v) => `\`${v}'`).join(", ")}`
                     + (admitted.length > 8 ? ` (and ${admitted.length - 8} more)` : "") };
    }
    return { ok: true, term: term.term };
  }
  if (d.min != null || d.max != null) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, reason: `\`${value}' is not a number` };
    if (d.min != null && n < Number(d.min)) {
      return { ok: false, reason: `${n} is below the lowest value this takes, ${d.min}` };
    }
    if (d.max != null && n > Number(d.max)) {
      return { ok: false, reason: `${n} is above the highest value this takes, ${d.max}` };
    }
    return { ok: true, term: term.term };
  }
  if (d.from) {
    const values = columnValues(results[d.from], d.column);
    if (values == null) {
      return { ok: true, term: term.term, unchecked: `\`${d.from}' has not run` };
    }
    if (!values.includes(String(value))) {
      return { ok: false,
               reason: `\`${value}' is not among the ${values.length} value(s) \`${d.from}' returned` };
    }
    return { ok: true, term: term.term };
  }
  return { ok: true, term: term.term };
}

/* ── binding ──────────────────────────────────────────────────────────────── */

/**
 * The query the panel will run, with the values bound.
 *
 * Returns {ok, query, bound, refusals}.  The query is the panel's own text
 * with a `VALUES' clause appended -- nothing is parsed, nothing is replaced,
 * and a panel with no parameters, or none supplied, gets its text back
 * unchanged and identical.
 *
 * A value this refuses stops the whole binding rather than being dropped: a
 * panel run with two of its three parameters bound is a query the user never
 * saw and never authorised, and it would quietly return the wrong rows
 * instead of visibly returning none.
 */
export function bindParameters(panel, values = {}, { parameters = [], results = {} } = {}) {
  const declared = [].concat(panel?.parameters || []);
  const query = String(panel?.query || "");
  if (!declared.length) return { ok: true, query, bound: {}, refusals: [] };

  const byName = new Map((parameters || []).map((p) => [p.name, p]));
  const names = [], terms = [], bound = {}, refusals = [];
  for (const name of declared) {
    const p = byName.get(name);
    if (!p) {
      refusals.push({ name, reason: `\`${name}' is not a declared parameter of this page` });
      continue;
    }
    const given = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : p.default;
    if (given == null) continue;                    // unbound: the query keeps its own variable
    const checked = checkValue(p, given, { results });
    if (!checked.ok) { refusals.push({ name, reason: checked.reason }); continue; }
    names.push(`?${name}`);
    terms.push(checked.term);
    bound[name] = given;
  }
  if (refusals.length) {
    return { ok: false, query, bound: {}, refusals };
  }
  if (!names.length) return { ok: true, query, bound: {}, refusals: [] };
  // On its own line, because the last line of the query may end in a comment
  // and a `#' runs to the end of ITS line, which would swallow the clause.
  return {
    ok: true,
    query: `${query}\nVALUES (${names.join(" ")}) { (${terms.join(" ")}) }`,
    bound,
    refusals: [],
  };
}

/** The values a page should start with: every parameter's declared default. */
export function defaultValues(parameters = []) {
  const out = {};
  for (const p of parameters) if (p.default != null) out[p.name] = p.default;
  return out;
}

export default bindParameters;
