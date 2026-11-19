/**
 * The element tree: what a view is made of, once it is made of something.
 *
 * Implements D-AI, D-AK and D-AN of `interface-as-rdf-plan.md'; work items
 * U-59 and U-60.
 *
 * Today a view is `{name, title, html}' and the html is a string.  A patch
 * can address a slot inside it by id and can replace the whole view, and
 * between those two there is nothing: moving a component from one panel to
 * another is a re-emission of the markup.  This module is the shape that
 * sits underneath instead -- a tree of named elements, each with its own
 * identity, attributes, placement and bindings -- together with the four
 * mappings that keep it in step with everything already built:
 *
 *   treeFromGraph / graphFromTree   the durable form (one graph, D-AT)
 *   htmlFromTree                    the form the existing frame renders
 *   treeFromHtml                    the legacy carrier (D-AN)
 *
 * Three things are worth saying before the code.
 *
 * **Identity is minted, never positional.**  `e-7k2m' says nothing about
 * where the element is, because the first thing the model will do is move it,
 * and a name that encodes position becomes a lie at that moment -- taking the
 * revision history with it, since a rename reads as a delete and an insert.
 *
 * **Order is a key, not an index** (`order.js', D-AJ), so inserting writes one
 * triple and no sibling moves.
 *
 * **Layout is a grid subset and `style' is not consulted for arrangement**
 * (D-AK).  An element may carry free CSS and the reconciler will apply it,
 * but where a thing SITS is `layout' on the container and `area' on the
 * child, because those are the two the store can be asked about and a patch
 * can change one triple of.  Arrangement expressed only in free CSS would be
 * invisible to a query and unreachable by a patch, which is the whole point
 * of the exercise, so the validator says so when it sees it.
 *
 * On `html' and `host'.  Not every page is expressible as a tree and not
 * every pane should be: `html' carries markup the vocabulary cannot say, and
 * `host' mounts one of the interface's own views by id (D-AS).  Both are
 * leaves -- opaque by construction -- and both keep their identity, so a tree
 * holding one is still addressable everywhere else.  That is what makes
 * migration incremental rather than all at once.
 */

import { COMPONENTS } from "./toolbox/index.js";
import {
  T, UI, UIA, attributeTerm, localOf, isAttributeTerm, checkAttribute, checkKind,
  tagFor, attributesOf, isComponentKind,
} from "./vocabulary.js";
import { keyBetween, tagged, sorted, validKey, assignKeys } from "./order.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";

/** What a presentation may hold before it is refused: a page, not a database. */
export const MAX_ELEMENTS = 2000;

/** How deep it may nest.  Deeper than this is a loop someone did not notice. */
export const MAX_DEPTH = 32;

/** A name minted for an element: opaque, and not derived from where it sits. */
export const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A fresh element name.
 *
 * Random rather than sequential.  A counter would make two clients building
 * in parallel mint the same names, and would leak how many elements a page
 * has been through, which is nobody's business and is wrong as soon as one is
 * deleted.
 */
export function mintName(random = Math.random) {
  let out = "e-";
  for (let i = 0; i < 8; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/* ── the node ─────────────────────────────────────────────────────────────── */

/**
 * One element, with every field present.
 *
 * Absent values are `null' rather than missing, for the reason `document.js'
 * gives: two trees that mean the same thing must serialise identically, or
 * the patch classifier reports changes that did not happen.
 */
export function node(fields = {}) {
  const f = fields || {};
  return {
    name: f.name ? String(f.name) : mintName(),
    kind: String(f.kind || "div"),
    order: f.order == null ? null : String(f.order),
    attributes: { ...(f.attributes || {}) },
    text: f.text == null ? null : String(f.text),
    style: f.style == null ? null : String(f.style),
    layout: f.layout ? normaliseLayout(f.layout) : null,
    placement: f.placement ? normalisePlacement(f.placement) : null,
    bound: f.bound == null ? null : String(f.bound),
    derived: f.derived == null ? null : String(f.derived),
    asserted: f.asserted == null ? null : String(f.asserted),
    binds: f.binds == null ? null : String(f.binds),
    default: f.default === undefined ? null : f.default,
    behavior: f.behavior == null ? null : String(f.behavior),
    host: f.host == null ? null : String(f.host),
    html: f.html == null ? null : String(f.html),
    immutable: Boolean(f.immutable),
    // Every child goes through `node' whether or not it looks built already.
    // The earlier `c.name ? c : node(c)' could not tell a built node from a
    // raw object that happened to carry a name -- which is every tree a model
    // or a test writes by hand -- and left those unnormalised, so two trees
    // that meant the same thing serialised differently and the classifier
    // reported changes that had not happened.  `node' is idempotent.
    children: [].concat(f.children || []).map((c) => node(c)),
  };
}

function normaliseLayout(layout) {
  const l = layout || {};
  const areas = l.areas == null ? null
    : (Array.isArray(l.areas) ? l.areas.map((r) => String(r).trim()).filter(Boolean)
                              : String(l.areas).split("\n").map((r) => r.trim()).filter(Boolean));
  return {
    columns: l.columns == null ? null : String(l.columns),
    rows: l.rows == null ? null : String(l.rows),
    gap: l.gap == null ? null : Number(l.gap),
    areas: areas && areas.length ? areas : null,
  };
}

function normalisePlacement(placement) {
  const p = placement || {};
  if (p.area != null && String(p.area).trim()) return { area: String(p.area).trim(), column: null, row: null };
  const column = p.column == null ? null : String(p.column);
  const row = p.row == null ? null : String(p.row);
  return column || row ? { area: null, column, row } : null;
}

/** A view: a name, a title, and the roots of its tree. */
export function view(fields = {}) {
  const f = fields || {};
  return {
    name: String(f.name || "main"),
    title: f.title == null ? null : String(f.title),
    elements: [].concat(f.elements || []).map((c) => node(c)),
  };
}

/* ── walking ──────────────────────────────────────────────────────────────── */

/** Every node, parents before children, siblings in order. */
export function walk(roots, visit, parent = null, depth = 0) {
  for (const child of sorted(roots || [])) {
    visit(child, parent, depth);
    walk(child.children, visit, child, depth + 1);
  }
}

/** name → {node, parent, depth}, for the whole tree. */
export function index(roots) {
  const map = new Map();
  walk(roots, (n, parent, depth) => map.set(n.name, { node: n, parent, depth }));
  return map;
}

/** The node with this name, or null. */
export function find(roots, name) {
  return index(roots).get(String(name))?.node || null;
}

/**
 * Insert a node under a parent, after a given sibling.
 *
 * The one place a key is minted, so that every insert in the system agrees
 * about what "after" means.  `after' null means first; `before' null means
 * last.
 */
export function insert(roots, { parent = null, after = null, before = null, writer = null } = {}, child) {
  const siblings = sorted(parent ? parent.children : roots);
  const lo = after ? (siblings.find((s) => s.name === after)?.order ?? null)
                   : (before ? null : (siblings.length ? siblings[siblings.length - 1].order : null));
  const hiFrom = after ? siblings[siblings.findIndex((s) => s.name === after) + 1]
                       : (before ? siblings.find((s) => s.name === before) : null);
  const hi = hiFrom ? hiFrom.order : null;
  const key = keyBetween(lo, hi);
  child.order = writer ? tagged(key, writer) : key;
  (parent ? parent.children : roots).push(child);
  return child;
}

/**
 * Take an element out of a tree, with everything under it.
 *
 * Returns {node, parent} and leaves the tree without it, or null when there is
 * no such element.  Paired with `insert' this is what a move is: the node
 * object is the SAME one on the way back in, which is what lets the
 * reconciler relocate the DOM node rather than build a new one.
 */
export function detach(roots, name) {
  const want = String(name);
  const held = index(roots).get(want);
  if (!held) return null;
  const siblings = held.parent ? held.parent.children : roots;
  const at = siblings.findIndex((n) => n.name === want);
  if (at < 0) return null;
  const [node0] = siblings.splice(at, 1);
  return { node: node0, parent: held.parent };
}

/** The view, among several, whose tree holds this element. */
export function viewHolding(views, name) {
  for (const v of views || []) {
    if (v.elements && index(v.elements).has(String(name))) return v;
  }
  return null;
}

/**
 * Every element of a markup view, which is one: the view promoted to a tree.
 *
 * A markup view has no addressable parts (D-AN).  Promoting it gives it one --
 * the carrier holding exactly the markup it had -- so that something can be
 * put BESIDE the old page without the old page being reinterpreted.  It
 * happens when a patch first asks to insert into such a view, and not before:
 * promoting every view on load would make the slot operations unreachable for
 * pages that only ever wanted them.
 */
export function promote(viewSpec, { random = Math.random } = {}) {
  if (viewSpec.elements && viewSpec.elements.length) return viewSpec.elements;
  const carried = treeFromHtml(viewSpec.html, { random });
  viewSpec.elements = carried;
  return carried;
}

/* ── the outline the model is shown ───────────────────────────────────────── */

/**
 * A view's tree, as the indented outline a model reads instead of its markup.
 *
 * Two reasons, and the second is the one that made it necessary.  Markup is
 * several times the size of the tree it came from, and the prompt budget is
 * spent on every turn.  And markup does not SAY what is addressable: a model
 * shown `<dydra-panel label="Sales">' has to infer that the thing it may move
 * is identified somewhere in that tag, whereas an outline puts the name in
 * the first column of every line.
 */
export function outlineOf(roots, { indent = 0, components = COMPONENTS } = {}) {
  const lines = [];
  walk(roots, (n, parent, depth) => {
    const pad = "  ".repeat(depth + indent);
    const bits = [];
    if (n.placement?.area) bits.push(`area=${n.placement.area}`);
    else if (n.placement?.column || n.placement?.row) {
      bits.push(`at=${n.placement.column || "auto"}/${n.placement.row || "auto"}`);
    }
    if (n.layout) {
      const grid = [n.layout.columns && `cols=${n.layout.columns}`,
                    n.layout.areas && `areas=${n.layout.areas.map((r) => `"${r}"`).join(" ")}`]
        .filter(Boolean).join(" ");
      if (grid) bits.push(`grid(${grid})`);
    }
    if (n.bound) bits.push(`shows panel ${n.bound}`);
    if (n.derived) bits.push(`shows transform ${n.derived}`);
    if (n.asserted) bits.push(`shows assertion ${n.asserted}`);
    if (n.binds) bits.push(`edits parameter ${n.binds}`);
    for (const [k, v] of Object.entries(n.attributes || {})) {
      bits.push(`${k}=${JSON.stringify(v)}`);
    }
    if (n.text) bits.push(`text=${JSON.stringify(n.text.slice(0, 40))}`);
    if (n.kind === "html") bits.push("(markup, not addressable inside)");
    if (n.kind === "host") bits.push(`mounts ${n.host}`);
    if (n.immutable) bits.push("IMMUTABLE — cannot be changed, moved or hidden");
    lines.push(`${pad}${n.name}  ${n.kind}${bits.length ? "  " + bits.join("  ") : ""}`);
  });
  return lines.join("\n");
}

/* ── the markup the frame renders ─────────────────────────────────────────── */

const VOID = new Set(["br", "hr"]);

const escapeText = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

/**
 * The CSS a node's layout and placement come to.
 *
 * Generated here as well as applied by the reconciler, because both paths
 * have to produce the same page: the frame renders the html, the reconciler
 * mounts the tree, and if they disagree the page quietly stops being what the
 * document says it is.  `tests/ui-reconcile.browser.mjs' asserts they do not.
 */
export function styleFor(n) {
  const parts = [];
  if (n.layout) {
    parts.push("display:grid");
    if (n.layout.columns) parts.push(`grid-template-columns:${n.layout.columns}`);
    if (n.layout.rows) parts.push(`grid-template-rows:${n.layout.rows}`);
    // Single quotes: CSS takes either, and an area template in double quotes
    // would have to be escaped into every attribute it is written to.
    if (n.layout.areas) parts.push(`grid-template-areas:${n.layout.areas.map((r) => `'${r}'`).join(" ")}`);
    if (n.layout.gap != null && Number.isFinite(n.layout.gap)) parts.push(`gap:${n.layout.gap}px`);
  }
  if (n.placement) {
    if (n.placement.area) parts.push(`grid-area:${n.placement.area}`);
    else {
      if (n.placement.column) parts.push(`grid-column:${n.placement.column}`);
      if (n.placement.row) parts.push(`grid-row:${n.placement.row}`);
    }
  }
  if (n.style) parts.push(String(n.style).replace(/;\s*$/, ""));
  return parts.join(";");
}

/** One element's attributes, as the DOM should hold them. */
export function attributesFor(n, components = COMPONENTS) {
  const out = {};
  for (const [k, v] of Object.entries(n.attributes || {})) {
    if (v === null || v === undefined || v === false) continue;
    out[k] = v === true ? "" : String(v);
  }
  if (n.bound) out["data-bound"] = n.bound;
  if (n.derived) out["data-derived"] = n.derived;
  if (n.asserted) out["data-asserted"] = n.asserted;
  if (n.binds) out["data-binds"] = n.binds;
  if (n.behavior) out["data-behavior"] = n.behavior;
  if (n.host) out["data-host"] = n.host;
  if (n.immutable) out["data-immutable"] = "";
  const style = styleFor(n);
  if (style) out.style = style;
  out["data-ui"] = n.name;
  // The order key is written into the DOM as well as into the graph, so that
  // the reconciler can place an inserted element among its siblings from the
  // patch alone, without being handed the whole tree to look the neighbours
  // up in.  A patch arrives as a change; it should not need the thing it is
  // a change to.
  if (n.order != null) out["data-ui-order"] = String(n.order);
  return out;
}

/** A view's markup, which is what `views[].html' becomes. */
export function htmlFromTree(roots, { components = COMPONENTS, indent = 0 } = {}) {
  const out = [];
  for (const n of sorted(roots || [])) out.push(elementHtml(n, components, indent));
  return out.join("\n");
}

function elementHtml(n, components, depth) {
  const pad = "  ".repeat(Math.min(depth, 12));
  const tag = tagFor(n.kind, components) || "div";
  const attrs = attributesFor(n, components);
  const written = Object.entries(attrs)
    .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`)).join("");
  if (VOID.has(tag)) return `${pad}<${tag}${written}>`;

  let inner = "";
  if (n.kind === "html") inner = String(n.html || "");
  else if (n.text != null) inner = escapeText(n.text);
  const kids = sorted(n.children || []);
  if (kids.length) {
    inner += (inner ? "\n" : "\n") + kids.map((k) => elementHtml(k, components, depth + 1)).join("\n")
           + `\n${pad}`;
  }
  return `${pad}<${tag}${written}>${inner}</${tag}>`;
}

/* ── the legacy carrier ───────────────────────────────────────────────────── */

/**
 * A view's markup, as a tree of one opaque element (D-AN).
 *
 * This is the whole of the migration story and it is deliberately not a
 * parser.  A parser would have to decide what every piece of markup a model
 * has ever written MEANS in this vocabulary, would get some of it wrong, and
 * would get it wrong silently -- on pages that render correctly today.  One
 * opaque element renders byte for byte what it rendered before, keeps an
 * identity, and can have addressable siblings put beside it.  A page becomes
 * a tree in the parts the model has since touched, which is the only
 * migration anybody has to agree to.
 */
export function treeFromHtml(html, { name = null, random = Math.random } = {}) {
  const markup = String(html || "");
  if (!markup.trim()) return [];
  const n = node({ name: name || mintName(random), kind: "html", html: markup });
  n.order = keyBetween(null, null);
  return [n];
}

/** True when a view is still carried as one opaque element. */
export const isLegacyTree = (roots) =>
  Array.isArray(roots) && roots.length === 1 && roots[0]?.kind === "html"
  && !(roots[0].children || []).length;

/* ── the graph ────────────────────────────────────────────────────────────── */

/** The IRI conventions, in one place so the loader and the writer agree. */
export const iriFor = {
  view: (base, name) => `${base}#v-${encodeURIComponent(name)}`,
  element: (base, name) => `${base}#${encodeURIComponent(name)}`,
  layout: (base, name) => `${base}#${encodeURIComponent(name)}-layout`,
  panel: (base, name) => `${base}#pan-${encodeURIComponent(name)}`,
  transform: (base, name) => `${base}#tr-${encodeURIComponent(name)}`,
  assertion: (base, name) => `${base}#as-${encodeURIComponent(name)}`,
  parameter: (base, name) => `${base}#par-${encodeURIComponent(name)}`,
};

/** The local name in an IRI this module minted, with its prefix stripped. */
export function nameFromIri(iri, prefix = "") {
  const s = String(iri || "");
  const hash = s.indexOf("#");
  const local = hash < 0 ? s : s.slice(hash + 1);
  const bare = prefix && local.startsWith(prefix) ? local.slice(prefix.length) : local;
  try { return decodeURIComponent(bare); } catch { return bare; }
}

const lit = (value, datatype = null) => ({ value: String(value), datatype, iri: null });
const int = (n) => ({ value: String(Math.trunc(Number(n))), datatype: `${XSD}integer`, iri: null });
const bool = (b) => ({ value: b ? "true" : "false", datatype: `${XSD}boolean`, iri: null });
const ref = (iri) => ({ value: null, datatype: null, iri: String(iri) });

/**
 * One view's tree, as triples.
 *
 * `base' is the presentation's own IRI; every subject is a fragment of it, so
 * a presentation is self-contained and moving one between graphs is a textual
 * substitution rather than a rewrite.
 *
 * Layout is a NAMED resource derived from the element -- `<#e-7k2m-layout>'
 * -- and not a blank node, although a blank node is what the vocabulary
 * sketch showed.  A patch has to be able to say DELETE on it, and a blank
 * node cannot be named in an update without matching a pattern that may hit
 * more than one.  The derived name costs nothing and makes `set-layout' the
 * same shape as every other operation.
 *
 * `areas' is one literal with the rows separated by newlines, rather than an
 * `rdf:List'.  A list would reintroduce exactly the ordering problem D-AJ
 * exists to avoid, for a value whose rows are already written in order by CSS
 * itself.
 */
export function graphFromTree(viewSpec, { base, components = COMPONENTS } = {}) {
  if (!base) throw new Error("graphFromTree: a base IRI is required");
  const v = view(viewSpec);
  const viewIri = iriFor.view(base, v.name);
  const triples = [
    { s: viewIri, p: RDF_TYPE, o: ref(T.View) },
    { s: viewIri, p: T.name, o: lit(v.name) },
  ];
  if (v.title != null) triples.push({ s: viewIri, p: T.title, o: lit(v.title) });

  walk(v.elements, (n, parent) => {
    const s = iriFor.element(base, n.name);
    const parentIri = parent ? iriFor.element(base, parent.name) : viewIri;
    triples.push({ s, p: RDF_TYPE, o: ref(T.Element) });
    triples.push({ s, p: T.parent, o: ref(parentIri) });
    triples.push({ s, p: T.order, o: lit(n.order == null ? "" : n.order) });
    triples.push({ s, p: T.kind, o: lit(n.kind) });

    for (const [k, value] of Object.entries(n.attributes || {})) {
      if (value === null || value === undefined) continue;
      const declared = attributesOf(n.kind, components).get(k);
      const o = typeof value === "boolean" ? bool(value)
              : (typeof value === "number" ? int(value)
              : (declared?.type === "number" ? int(value)
              : (declared?.type === "boolean" ? bool(value !== "false" && value !== false)
              : lit(value))));
      triples.push({ s, p: attributeTerm(k), o });
    }

    if (n.text != null) triples.push({ s, p: T.text, o: lit(n.text) });
    if (n.style != null) triples.push({ s, p: T.style, o: lit(n.style) });
    if (n.html != null) triples.push({ s, p: T.html, o: lit(n.html) });
    if (n.host != null) triples.push({ s, p: T.host, o: lit(n.host) });
    if (n.behavior != null) triples.push({ s, p: T.behavior, o: lit(n.behavior) });
    if (n.immutable) triples.push({ s, p: T.immutable, o: bool(true) });
    if (n.bound) triples.push({ s, p: T.bound, o: ref(iriFor.panel(base, n.bound)) });
    if (n.derived) triples.push({ s, p: T.derived, o: ref(iriFor.transform(base, n.derived)) });
    if (n.asserted) triples.push({ s, p: T.asserted, o: ref(iriFor.assertion(base, n.asserted)) });
    if (n.binds) triples.push({ s, p: T.binds, o: ref(iriFor.parameter(base, n.binds)) });
    if (n.default !== null && n.default !== undefined) triples.push({ s, p: T.default, o: lit(n.default) });

    if (n.placement?.area) triples.push({ s, p: T.area, o: lit(n.placement.area) });
    if (n.placement?.column) triples.push({ s, p: T.column, o: lit(n.placement.column) });
    if (n.placement?.row) triples.push({ s, p: T.row, o: lit(n.placement.row) });

    if (n.layout) {
      const l = iriFor.layout(base, n.name);
      triples.push({ s, p: T.layout, o: ref(l) });
      triples.push({ s: l, p: RDF_TYPE, o: ref(T.Grid) });
      if (n.layout.columns != null) triples.push({ s: l, p: T.columns, o: lit(n.layout.columns) });
      if (n.layout.rows != null) triples.push({ s: l, p: T.rows, o: lit(n.layout.rows) });
      if (n.layout.gap != null && Number.isFinite(n.layout.gap)) {
        triples.push({ s: l, p: T.gap, o: int(n.layout.gap) });
      }
      if (n.layout.areas) triples.push({ s: l, p: T.areas, o: lit(n.layout.areas.join("\n")) });
    }
  });
  return triples;
}

/**
 * The views a graph holds, each with its tree.
 *
 * Reads what is there and reports what it cannot place, rather than throwing:
 * a presentation is read back from a store that other writers can reach, so
 * "one element has a parent that is not in the graph" has to be a finding
 * rather than an exception that loses the other ninety.
 */
export function treeFromGraph(triples, { base = null, components = COMPONENTS } = {}) {
  const bySubject = new Map();
  for (const t of triples || []) {
    let held = bySubject.get(t.s);
    if (!held) { held = new Map(); bySubject.set(t.s, held); }
    const list = held.get(t.p) || [];
    list.push(t.o);
    held.set(t.p, list);
  }
  const one = (s, p) => bySubject.get(s)?.get(p)?.[0] ?? null;
  const text = (s, p) => { const o = one(s, p); return o == null ? null : (o.iri ?? o.value); };
  const types = (s) => (bySubject.get(s)?.get(RDF_TYPE) || []).map((o) => o.iri);

  const warnings = [];
  const views = [];
  const nodes = new Map();      // element IRI -> node
  const parentOf = new Map();   // element IRI -> parent IRI

  for (const [s] of bySubject) {
    if (!types(s).includes(T.Element)) continue;
    const kind = text(s, T.kind) || "div";
    const attributes = {};
    for (const [p, objects] of bySubject.get(s)) {
      if (!isAttributeTerm(p)) continue;
      const name = localOf(p);
      const o = objects[0];
      attributes[name] = o.datatype === `${XSD}integer` ? Number(o.value)
                       : (o.datatype === `${XSD}boolean` ? o.value === "true" : o.value);
    }
    const layoutIri = one(s, T.layout)?.iri || null;
    const layout = layoutIri && bySubject.has(layoutIri) ? {
      columns: text(layoutIri, T.columns),
      rows: text(layoutIri, T.rows),
      gap: one(layoutIri, T.gap) ? Number(one(layoutIri, T.gap).value) : null,
      areas: text(layoutIri, T.areas),
    } : null;

    const n = node({
      name: nameFromIri(s),
      kind,
      order: text(s, T.order),
      attributes,
      text: text(s, T.text),
      style: text(s, T.style),
      html: text(s, T.html),
      host: text(s, T.host),
      behavior: text(s, T.behavior),
      immutable: text(s, T.immutable) === "true",
      bound: one(s, T.bound)?.iri ? nameFromIri(one(s, T.bound).iri, "pan-") : null,
      derived: one(s, T.derived)?.iri ? nameFromIri(one(s, T.derived).iri, "tr-") : null,
      asserted: one(s, T.asserted)?.iri ? nameFromIri(one(s, T.asserted).iri, "as-") : null,
      binds: one(s, T.binds)?.iri ? nameFromIri(one(s, T.binds).iri, "par-") : null,
      default: text(s, T.default),
      layout,
      placement: { area: text(s, T.area), column: text(s, T.column), row: text(s, T.row) },
      children: [],
    });
    nodes.set(s, n);
    const parent = one(s, T.parent)?.iri || null;
    if (!parent) warnings.push(`element \`${n.name}' has no parent and was dropped`);
    else parentOf.set(s, parent);
  }

  for (const [s] of bySubject) {
    if (!types(s).includes(T.View)) continue;
    const name = text(s, T.name) || nameFromIri(s, "v-");
    views.push({ iri: s, name, title: text(s, T.title), elements: [] });
  }
  if (!views.length && nodes.size) {
    warnings.push("the graph holds elements but no view; they were read into `main'");
    views.push({ iri: base ? iriFor.view(base, "main") : "#v-main", name: "main", title: null, elements: [] });
  }
  const viewByIri = new Map(views.map((v) => [v.iri, v]));

  for (const [s, n] of nodes) {
    const parent = parentOf.get(s);
    if (!parent) continue;
    if (viewByIri.has(parent)) { viewByIri.get(parent).elements.push(n); continue; }
    const holder = nodes.get(parent);
    if (holder) holder.children.push(n);
    else warnings.push(`element \`${n.name}' names a parent that is not in the graph and was dropped`);
  }

  // A cycle cannot be built from a tree, but it can be WRITTEN into a graph,
  // and a reader that recursed into one would hang rather than report.
  const placed = new Set();
  for (const v of views) walk(v.elements, (n) => placed.add(n.name));
  for (const [, n] of nodes) {
    if (!placed.has(n.name)) warnings.push(`element \`${n.name}' is in a cycle and was dropped`);
  }

  return { views: views.map((v) => view(v)), warnings };
}

/* ── validation ───────────────────────────────────────────────────────────── */

/**
 * Check a tree.  Returns {ok, errors, warnings, count, depth}.
 *
 * The placement check is the one worth pointing at: a child in area `main' of
 * a parent whose template never mentions `main' renders in the implicit grid,
 * somewhere plausible, and nobody notices until the page is on a screen.  It
 * is a question the graph can answer, so it is answered here.
 */
export function validateTree(roots, { components = COMPONENTS, where = "view",
                                      lenient = false } = {}) {
  const errors = [], warnings = [];
  const seen = new Set();
  let count = 0, deepest = 0;

  walk(roots, (n, parent, depth) => {
    count += 1;
    deepest = Math.max(deepest, depth + 1);
    if (!NAME_RE.test(n.name)) errors.push(`${where}: \`${n.name}' is not a usable element name`);
    if (seen.has(n.name)) errors.push(`${where}: element \`${n.name}' appears twice`);
    seen.add(n.name);

    if (n.order != null && n.order !== "" && !validKey(n.order)) {
      errors.push(`${where}: element \`${n.name}' has an unusable order key ${JSON.stringify(n.order)}`);
    }

    // `lenient' is set when the presentation says it came from a later
    // interface than this build.  An unknown kind is then a component from
    // the future rather than a mistake, so it is noted and left in place --
    // the reconciler's own fault boundary draws it as a marked placeholder
    // (`build' in `reconcile.js'), which is what "ignore what you do not
    // understand" has to mean on a screen.  Without that flag an unknown kind
    // is a typo, and a typo that renders as a grey box is worse than one that
    // is reported.
    const kind = checkKind(n.kind, components);
    if (!kind.ok) (lenient ? warnings : errors).push(`${where}: element \`${n.name}': ${kind.error}`);

    for (const [k, v] of Object.entries(n.attributes || {})) {
      const checked = checkAttribute(n.kind, k, v, components);
      if (!checked.ok) (lenient ? warnings : errors).push(`${where}: element \`${n.name}': ${checked.error}`);
    }

    if (n.kind === "html") {
      if ((n.children || []).length) {
        errors.push(`${where}: element \`${n.name}' carries markup, so it cannot also have children`);
      }
      if (n.html == null) warnings.push(`${where}: element \`${n.name}' carries no markup`);
    }
    if (n.kind === "host") {
      if ((n.children || []).length) {
        errors.push(`${where}: element \`${n.name}' mounts a view, so it cannot also have children`);
      }
      if (!n.host) errors.push(`${where}: element \`${n.name}' mounts a view but names none`);
    }

    // D-AK: arrangement is the grid subset, not free CSS.
    if (n.style && /(^|;)\s*(display\s*:\s*grid|grid-|position\s*:|float\s*:)/i.test(n.style)) {
      warnings.push(`${where}: element \`${n.name}' arranges itself in \`style', which no query can `
                  + `read and no patch can move; use a layout and an area`);
    }

    if (n.placement?.area) {
      const template = parent?.layout?.areas || null;
      if (!template) {
        warnings.push(`${where}: element \`${n.name}' is placed in area \`${n.placement.area}', `
                    + `but its container declares no areas`);
      } else {
        const declared = new Set(template.join(" ").split(/\s+/).filter((a) => a && a !== "."));
        if (!declared.has(n.placement.area)) {
          errors.push(`${where}: element \`${n.name}' is placed in area \`${n.placement.area}', `
                    + `which its container's template does not declare `
                    + `(it declares ${[...declared].join(", ") || "none"})`);
        }
      }
    }
  });

  if (count > MAX_ELEMENTS) {
    errors.push(`${where}: ${count} elements; the limit is ${MAX_ELEMENTS}`);
  }
  if (deepest > MAX_DEPTH) {
    errors.push(`${where}: nested ${deepest} deep; the limit is ${MAX_DEPTH}`);
  }
  return { ok: errors.length === 0, errors, warnings, count, depth: deepest };
}

/* ── the diff the reconciler consumes ─────────────────────────────────────── */

const sameLayout = (a, b) =>
  JSON.stringify(a ? normaliseLayout(a) : null) === JSON.stringify(b ? normaliseLayout(b) : null);
const samePlacement = (a, b) =>
  JSON.stringify(a ? normalisePlacement(a) : null) === JSON.stringify(b ? normalisePlacement(b) : null);

/**
 * What changed between two trees, element by element.
 *
 * The reconciler works from THIS and not from the model's text, which is what
 * makes "no unrelated component is disturbed" a property of the architecture
 * rather than a hope about what was emitted: an element absent from the diff
 * is an element the reconciler never touches, and
 * `tests/ui-reconcile.browser.mjs' asserts that with a MutationObserver.
 */
export function diffTrees(before, after) {
  const a = index(before || []);
  const b = index(after || []);
  const added = [], removed = [], moved = [], changed = [];

  for (const [name, { node: n, parent }] of b) {
    if (a.has(name)) continue;
    added.push({ name, parent: parent ? parent.name : null, order: n.order, node: n });
  }
  // A node added with its subtree is reported once, for the root of it: the
  // reconciler builds a subtree in one go, and reporting the descendants
  // again would have it build them twice.
  const addedNames = new Set(added.map((x) => x.name));
  const addedRoots = added.filter((x) => !x.parent || !addedNames.has(x.parent));

  for (const [name] of a) if (!b.has(name)) removed.push({ name });
  const removedNames = new Set(removed.map((x) => x.name));
  const removedRoots = removed.filter((x) => {
    const parent = a.get(x.name)?.parent;
    return !parent || !removedNames.has(parent.name);
  });

  for (const [name, { node: was, parent: wasParent }] of a) {
    const now = b.get(name);
    if (!now) continue;
    const is = now.node, isParent = now.parent;
    const fromParent = wasParent ? wasParent.name : null;
    const toParent = isParent ? isParent.name : null;
    if (fromParent !== toParent || was.order !== is.order) {
      moved.push({ name, from: fromParent, to: toParent, order: is.order });
    }
    const fields = {};
    if (was.kind !== is.kind) fields.kind = is.kind;
    if (was.text !== is.text) fields.text = is.text;
    if (was.style !== is.style) fields.style = is.style;
    if (was.html !== is.html) fields.html = is.html;
    if (was.host !== is.host) fields.host = is.host;
    if (was.behavior !== is.behavior) fields.behavior = is.behavior;
    if (Boolean(was.immutable) !== Boolean(is.immutable)) fields.immutable = Boolean(is.immutable);
    if (was.bound !== is.bound) fields.bound = is.bound;
    if (was.derived !== is.derived) fields.derived = is.derived;
    if (was.asserted !== is.asserted) fields.asserted = is.asserted;
    if (was.binds !== is.binds) fields.binds = is.binds;
    if (String(was.default) !== String(is.default)) fields.default = is.default;
    if (!sameLayout(was.layout, is.layout)) fields.layout = is.layout;
    if (!samePlacement(was.placement, is.placement)) fields.placement = is.placement;
    // Style, layout and placement are three sources of one attribute, so a
    // change to any of them is reported as the attribute they come to.  The
    // reconciler would otherwise have to hold the other two to write the one.
    if (fields.layout !== undefined || fields.placement !== undefined
        || fields.style !== undefined) fields.css = styleFor(is);

    const attributes = {};
    const names = new Set([...Object.keys(was.attributes || {}), ...Object.keys(is.attributes || {})]);
    for (const k of names) {
      const from = was.attributes?.[k], to = is.attributes?.[k];
      if (from === to) continue;
      attributes[k] = to === undefined ? null : to;
    }
    if (Object.keys(attributes).length) fields.attributes = attributes;
    // `node' is the element as it now is.  The reconciler reads only the
    // fields the diff names -- except when the KIND changed, where the node
    // has to be built again and there is nothing else to build it from.
    if (Object.keys(fields).length) changed.push({ name, fields, node: is });
  }

  return {
    added: addedRoots, removed: removedRoots, moved, changed,
    empty: !addedRoots.length && !removedRoots.length && !moved.length && !changed.length,
  };
}

/* ── a tree, in a form two of them can be compared in ─────────────────────── */

/**
 * The tree with its children in order and its keys in a fixed sequence.
 *
 * `canonical' in `document.js' sorts object keys, so this only has to settle
 * the order of the CHILDREN -- but it has to settle it, because the classifier
 * compares two normalised documents and a tree whose children arrived in a
 * different order would read as a change that did not happen.
 */
export function canonicalTree(roots) {
  return sorted(roots || []).map((n) => ({
    name: n.name, kind: n.kind, order: n.order,
    attributes: Object.fromEntries(Object.entries(n.attributes || {}).sort(
      ([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
    text: n.text, style: n.style, html: n.html, host: n.host, behavior: n.behavior,
    bound: n.bound, derived: n.derived, asserted: n.asserted, binds: n.binds,
    default: n.default === undefined ? null : n.default,
    layout: n.layout ? normaliseLayout(n.layout) : null,
    placement: n.placement ? normalisePlacement(n.placement) : null,
    immutable: Boolean(n.immutable),
    children: canonicalTree(n.children),
  }));
}

export { normaliseLayout, normalisePlacement, RDF_TYPE, XSD };
