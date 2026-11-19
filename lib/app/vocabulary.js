/**
 * The interface vocabulary: `ui:' written here, `uia:' generated from the
 * toolbox.
 *
 * Implements D-AL and §5 of `interface-as-rdf-plan.md'; work item U-57.
 *
 * `ui:' is small and hand-written, because it says what an interface IS --
 * elements, parents, order, layout, placement, the three region kinds -- and
 * that list is a design decision, not a derivation.
 *
 * `uia:' is the attributes components carry, and it is NOT hand-written.
 * Every component already declares its properties in its manifest, with a
 * type, a default and whether it is an attribute; writing the same list again
 * here would create two lists that have to agree, and they would not.  So the
 * attribute vocabulary is DERIVED from the manifests, which makes the toolbox
 * the single source of truth, makes an attribute checkable against the
 * component carrying it, and makes a new component extend the vocabulary
 * without a second edit anyone can forget.
 *
 * `vocabularyReport' is the build check that says so out loud: two components
 * declaring the same attribute name with incompatible types would mean one
 * `uia:' term with two meanings, which is the one way a derived vocabulary
 * can go wrong by itself.
 *
 * On the generic elements.  A tree has to be able to express an ordinary
 * page -- headings, sections, paragraphs -- or every page would be one opaque
 * blob and nothing would be addressable.  So there is a small allowlist of
 * plain HTML kinds beside the components.  It is an allowlist and not a
 * filter: `script', `style', `link', `iframe', `img' and `object' are absent
 * because the frame forbids the network and loading is not something an
 * element should be able to ask for by existing.  Anything outside the list
 * still has a home -- the `html' carrier (D-AN) -- which keeps the escape
 * hatch visible rather than silent.
 */

import { COMPONENTS } from "./toolbox/index.js";

/** The structural vocabulary. */
export const UI = "http://dydra.com/ns/ui#";

/** The attribute vocabulary, generated from the component manifests. */
export const UIA = "http://dydra.com/ns/ui/attribute#";

/**
 * The version a presentation is written against.
 *
 * Bumped for any change a reader must see.  It is recorded on the
 * presentation rather than inferred.
 *
 * A presentation written against a LATER version is read, not refused.  The
 * build notes that it came from a later interface and ignores the components
 * and operations it does not understand, each one marked where it sits.  That
 * replaces the earlier rule, which refused the page outright on the argument
 * that a half-read page looks finished and is missing something -- true, but
 * the remedy for it is to SAY SO, and refusal has a worse failure of its own:
 * one account opening a page a newer client wrote sees nothing at all, and a
 * vocabulary that can never be extended without taking every stored
 * presentation away from every build behind it is a vocabulary nobody can
 * extend.
 *
 * A vocabulary's instances outlive it: bb has already had to remove a slot
 * API it shipped, and a removed term here leaves stored presentations that
 * still use it.  Under this rule those presentations still open.
 */
export const VOCABULARY_VERSION = "2";

/** `ui:<local>'. */
export const term = (local) => UI + local;

/** `uia:<name>'. */
export const attributeTerm = (name) => UIA + encodeURIComponent(String(name));

/** The local part of a term in either namespace, or null for a foreign one. */
export function localOf(iri) {
  const s = String(iri || "");
  if (s.startsWith(UI)) return s.slice(UI.length);
  if (s.startsWith(UIA)) return decodeURIComponent(s.slice(UIA.length));
  return null;
}

/** True for a term in the attribute namespace. */
export const isAttributeTerm = (iri) => String(iri || "").startsWith(UIA);

/* ── the structural terms ─────────────────────────────────────────────────── */

/**
 * Every `ui:' term, by the key the in-memory tree uses for it.
 *
 * One table rather than a constant each, because the loader and the
 * serialiser both walk it and a term that appears in one and not the other is
 * exactly the bug a shared table prevents.
 */
export const T = Object.freeze({
  // classes
  Presentation: term("Presentation"),
  View: term("View"),
  Element: term("Element"),
  Grid: term("Grid"),
  Panel: term("Panel"),
  Transform: term("Transform"),
  Assertion: term("Assertion"),
  Parameter: term("Parameter"),

  // the presentation and its catalogue entry
  graph: term("graph"),
  scope: term("scope"),
  vocabulary: term("vocabulary"),
  toolbox: term("toolbox"),
  revision: term("revision"),
  name: term("name"),
  title: term("title"),
  created: term("created"),
  modified: term("modified"),
  creator: term("creator"),
  script: term("script"),
  scriptDigest: term("scriptDigest"),
  styles: term("styles"),
  view: term("view"),

  // structure
  parent: term("parent"),
  order: term("order"),
  kind: term("kind"),
  text: term("text"),
  html: term("html"),
  host: term("host"),
  style: term("style"),
  immutable: term("immutable"),

  // layout and placement
  layout: term("layout"),
  columns: term("columns"),
  rows: term("rows"),
  gap: term("gap"),
  areas: term("areas"),
  area: term("area"),
  column: term("column"),
  row: term("row"),

  // the document's named parts, which the elements point at
  query: term("query"),
  accept: term("accept"),
  form: term("form"),
  caption: term("caption"),
  body: term("body"),
  inputs: term("inputs"),
  parameters: term("parameters"),
  uses: term("uses"),
  state: term("state"),
  digests: term("digests"),
  datatype: term("datatype"),
  language: term("language"),
  label: term("label"),
  domainValues: term("domainValues"),
  domainFrom: term("domainFrom"),
  domainColumn: term("domainColumn"),
  domainMin: term("domainMin"),
  domainMax: term("domainMax"),

  // what an element shows, and what it edits
  bound: term("bound"),
  derived: term("derived"),
  asserted: term("asserted"),
  binds: term("binds"),
  default: term("default"),
  behavior: term("behavior"),

  // Admissions (U-74).  These never appear in a presentation graph: an
  // admission is the READER's record, in the reader's own repository, that
  // they have agreed to run somebody else's code.  So adding them does not
  // move `VOCABULARY_VERSION' -- an older build reading a presentation
  // written by this one still sees exactly the terms it knows.
  Admission: term("Admission"),
  fingerprint: term("fingerprint"),
  admitted: term("admitted"),
  of: term("of"),

  // Arrangements and mounts (U-83, U-86).  Catalogue records, like
  // `Admission' above: they live beside the presentation entries and never
  // inside a presentation graph, so adding them does not move
  // `VOCABULARY_VERSION' either -- a build that does not know them still
  // reads every presentation this one writes.
  //
  // That is not a convenience, it is the reason a mount is a `host' element
  // with `presentation:<name>' in the EXISTING `ui:host' rather than a new
  // term: an older build meeting one finds no renderer registered under that
  // name and draws the band inert with a sentence saying so, where a new
  // term would have been dropped on the floor and the band would have been
  // missing with nothing said.
  Arrangement: term("Arrangement"),
  Mount: term("Mount"),
  Application: term("Application"),
  anchor: term("anchor"),
  template: term("template"),
  source: term("source"),
  at: term("at"),
});

/** The two scopes a presentation may have (D-AS). */
export const SCOPES = Object.freeze(["document", "workspace"]);

/* ── the kinds an element may be ──────────────────────────────────────────── */

/**
 * Plain HTML elements a tree may name directly.
 *
 * Structure and text only.  Nothing here loads anything, and nothing here
 * runs anything.
 */
export const GENERIC_ELEMENTS = Object.freeze([
  "div", "section", "article", "aside", "header", "footer", "nav", "main",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "strong", "em", "small", "code", "pre", "blockquote",
  "ul", "ol", "li", "dl", "dt", "dd",
  "figure", "figcaption", "hr", "br", "a", "label", "fieldset", "legend",
]);

/** Kinds that are not elements in the ordinary sense; each has its own rule. */
export const STRUCTURAL_KINDS = Object.freeze(["html", "host"]);

/**
 * Attributes a generic element may carry.
 *
 * `href' is here and `src' is not: a link is a navigation the user performs,
 * a source is a fetch the page performs, and the frame forbids the second.
 * A link is still reported by `policyWarnings' in `document.js', which is the
 * right place for a judgement rather than a refusal.
 */
export const GENERIC_ATTRIBUTES = Object.freeze({
  id: { type: "string" },
  class: { type: "string" },
  title: { type: "string" },
  lang: { type: "string" },
  role: { type: "string" },
  hidden: { type: "boolean" },
  href: { type: "string" },
  for: { type: "string" },
  "aria-label": { type: "string" },
  "aria-hidden": { type: "boolean" },
});

/** True when KIND names a toolbox component. */
export const isComponentKind = (kind, components = COMPONENTS) =>
  Boolean(components && components[kind] && !components[kind].hidden);

/** True when KIND names a plain element. */
export const isGenericKind = (kind) => GENERIC_ELEMENTS.includes(String(kind));

/** The DOM tag a kind becomes: the component's element, or the kind itself. */
export function tagFor(kind, components = COMPONENTS) {
  const k = String(kind || "");
  if (k === "html" || k === "host") return "div";
  const c = components && components[k];
  if (c && c.element) return c.element;
  return isGenericKind(k) ? k : null;
}

/* ── the attribute vocabulary, generated ──────────────────────────────────── */

const declarationOf = (p) => ({
  type: p?.enum ? "enum" : String(p?.type || "string"),
  values: p?.enum ? [...p.enum] : null,
  default: p?.default === undefined ? null : p.default,
  required: Boolean(p?.required),
  description: p?.description ? String(p.description) : null,
});

/**
 * A manifest type as the set of things it admits.
 *
 * `string|number' is a real declaration -- `metric' takes either -- so a type
 * is a SET and two declarations agree when their sets meet.  `value' being
 * `string|number' on `metric' and `string' on `term' is a narrowing, not a
 * disagreement: the predicate carries a string in both, and refusing the pair
 * would mean renaming one of two attributes that genuinely mean the same
 * thing.  Two sets that do not meet at all -- a number here and a boolean
 * there -- would give one predicate two readings, and that is the conflict
 * this is here to find.
 */
const admits = (type) => new Set(String(type || "string").split("|").map((t) => t.trim()).filter(Boolean));

const typesMeet = (a, b) => {
  const x = admits(a), y = admits(b);
  for (const t of x) if (y.has(t)) return true;
  return false;
};

/** The wider of two types, for the term's recorded reading. */
const widen = (a, b) => [...new Set([...admits(a), ...admits(b)])].sort().join("|");

/**
 * The attributes a kind may carry: a component's declared ones, or the
 * generic set.
 *
 * A component property that is not an attribute -- `pairs' on `key-value',
 * `data' on `table' -- is deliberately absent.  Those are set by the frame
 * from a bound slot, and a stored presentation that carried one would be
 * storing data rather than structure.
 */
export function attributesOf(kind, components = COMPONENTS) {
  const out = new Map();
  const k = String(kind || "");
  if (isComponentKind(k, components)) {
    const props = components[k]?.manifest?.properties || {};
    for (const [name, p] of Object.entries(props)) {
      if (p?.attribute) out.set(name, declarationOf(p));
    }
  }
  for (const [name, p] of Object.entries(GENERIC_ATTRIBUTES)) {
    if (!out.has(name)) out.set(name, declarationOf(p));
  }
  return out;
}

/**
 * Every `uia:' term the toolbox implies, and anything inconsistent about it.
 *
 * One term per attribute NAME, shared by every component that declares it --
 * `uia:label' is one predicate whether a panel or a metric carries it, which
 * is what makes "every element with a label" a query.  The price is that two
 * components declaring the same name with different types would give one
 * predicate two meanings, so that is what the report looks for.
 */
export function vocabularyReport(components = COMPONENTS) {
  const terms = new Map();
  const conflicts = [];
  for (const [kind, component] of Object.entries(components || {})) {
    if (component?.hidden) continue;
    const props = component?.manifest?.properties || {};
    for (const [name, p] of Object.entries(props)) {
      if (!p?.attribute) continue;
      const decl = declarationOf(p);
      const held = terms.get(name);
      if (!held) {
        terms.set(name, { name, term: attributeTerm(name), type: decl.type,
                          values: decl.values, components: [kind] });
        continue;
      }
      held.components.push(kind);
      if (!typesMeet(held.type, decl.type)) {
        conflicts.push(`\`${name}' is ${held.type} on \`${held.components[0]}' `
                     + `and ${decl.type} on \`${kind}', which have no reading in common`);
      } else if (held.type !== decl.type) {
        held.type = widen(held.type, decl.type);
      } else if (held.type === "enum" && String(held.values) !== String(decl.values)) {
        conflicts.push(`\`${name}' enumerates ${held.values.join("|")} on `
                     + `\`${held.components[0]}' and ${decl.values.join("|")} on \`${kind}'`);
      }
    }
  }
  for (const [name, p] of Object.entries(GENERIC_ATTRIBUTES)) {
    if (!terms.has(name)) {
      terms.set(name, { name, term: attributeTerm(name), type: declarationOf(p).type,
                        values: null, components: ["(generic)"] });
    }
  }
  return {
    ok: conflicts.length === 0,
    terms: [...terms.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    conflicts,
  };
}

/* ── checking one attribute ───────────────────────────────────────────────── */

/**
 * An attribute's value, coerced to what its declaration says, or an error.
 *
 * Coercion rather than refusal for the types that have one honest reading --
 * `"3"' for a number, `""' and `"true"' for a boolean, because that is what
 * an attribute looks like once it has been through the DOM.  An enum is
 * refused, because guessing which member was meant would put a value on the
 * page that nothing asked for.
 */
export function coerceAttribute(declaration, value) {
  const d = declaration || { type: "string" };
  if (value === null || value === undefined) return { ok: true, value: null };
  switch (d.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `${JSON.stringify(value)} is not a number` };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      const s = String(value).toLowerCase();
      if (s === "" || s === "true" || s === "1") return { ok: true, value: true };
      if (s === "false" || s === "0") return { ok: true, value: false };
      return { ok: false, error: `${JSON.stringify(value)} is not true or false` };
    }
    case "enum": {
      const s = String(value);
      if (!d.values || d.values.includes(s)) return { ok: true, value: s };
      return { ok: false, error: `${JSON.stringify(s)} is not one of ${d.values.join(", ")}` };
    }
    default:
      return { ok: true, value: String(value) };
  }
}

/**
 * Check one attribute against the kind that carries it.
 *
 * Returns {ok, value, error}.  An attribute the kind does not declare is an
 * error rather than a warning: it would reach the DOM, do nothing, and look
 * like a component that ignores its own properties.
 */
export function checkAttribute(kind, name, value, components = COMPONENTS) {
  const n = String(name || "");
  if (!n) return { ok: false, error: "an attribute with no name" };
  if (n.startsWith("data-") || n.startsWith("on")) {
    return { ok: false, error: `\`${n}' is set by the runtime, not by a presentation` };
  }
  const declared = attributesOf(kind, components).get(n);
  if (!declared) return { ok: false, error: `\`${kind}' has no attribute \`${n}'` };
  const coerced = coerceAttribute(declared, value);
  return coerced.ok ? { ok: true, value: coerced.value }
                    : { ok: false, error: `\`${kind}'.\`${n}': ${coerced.error}` };
}

/** Check a kind. Returns {ok, error}. */
export function checkKind(kind, components = COMPONENTS) {
  const k = String(kind || "");
  if (!k) return { ok: false, error: "an element with no kind" };
  if (STRUCTURAL_KINDS.includes(k)) return { ok: true };
  if (isComponentKind(k, components)) return { ok: true };
  if (isGenericKind(k)) return { ok: true };
  return { ok: false, error: `\`${k}' is neither a component nor a plain element; `
                           + `markup this vocabulary cannot express belongs in an \`html' element` };
}
