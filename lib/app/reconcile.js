/**
 * The reconciler: a change to the graph becomes the smallest change to the
 * DOM that realises it.
 *
 * Implements D-AO and §6 of `interface-as-rdf-plan.md'; work items U-61,
 * U-62 and U-63.
 *
 * This module is where the first claim of the design is either true or it is
 * not.  "The model can insert, modify, relocate and remove parts of an
 * existing interface without recreating the page or disturbing unrelated
 * components" is not a thing a model can be trusted to do, and it is not a
 * thing a diffing library does by itself either -- a virtual DOM reconciler
 * compares two renderings and is free to replace anything it finds
 * convenient.  Here the rule is explicit and narrow:
 *
 *      AN ELEMENT ABSENT FROM THE DIFF IS NEVER TOUCHED.
 *
 * `tests/ui-reconcile.browser.mjs' asserts it with a MutationObserver over
 * the whole root, which is the only way to assert it honestly: nothing about
 * the source of a reconciler tells you what it did to the DOM.
 *
 * Three consequences worth stating, because each is a decision and not an
 * implementation detail.
 *
 * **A move moves the node.**  Relocating an element re-parents the EXISTING
 * node rather than building a new one at the destination, so a text field
 * keeps its value and its caret, a chart keeps its canvas, a details element
 * keeps whether it was open, and a custom element is not disconnected and
 * reconnected.  Rebuilding would be simpler and would look identical in a
 * screenshot, which is exactly why it is worth being deliberate about.
 *
 * **Position comes from the DOM, not from a tree.**  Every element carries
 * its order key in `data-ui-order', so an insert finds its place among its
 * siblings from the patch alone.  A reconciler that needed the whole
 * after-tree to place one element would be a renderer with extra steps.
 *
 * **Every element has a boundary.**  A component whose constructor throws, a
 * host nothing registered, an attribute a manifest rejects: the element is
 * replaced by an inert placeholder carrying its own identity and a short
 * reason, and its parent and siblings are untouched.  This is bb's lesson --
 * a crashing overlay there is hidden without affecting its siblings -- and
 * the alternative is that one bad element takes a page the user was in the
 * middle of using.
 */

import { COMPONENTS } from "./toolbox/index.js";
import { tagFor } from "./vocabulary.js";
import { sorted } from "./order.js";
import { attributesFor, styleFor, diffTrees, htmlFromTree, walk } from "./tree.js";
import { applyInstructions } from "./dom-patch.js";

/** The attribute an element's identity lives in. */
export const ID_ATTRIBUTE = "data-ui";

/** The attribute its order key lives in. */
export const ORDER_ATTRIBUTE = "data-ui-order";

/** Set on an element the reconciler could not build, with the reason. */
export const FAULT_ATTRIBUTE = "data-ui-fault";

/** Set on an element that rendered but whose behaviour could not be resolved. */
export const INERT_ATTRIBUTE = "data-ui-inert";

const docOf = (root) => root?.ownerDocument || globalThis.document;

/** The element with this identity, within ROOT. */
export function nodeFor(root, name) {
  if (!root || !name) return null;
  const selector = `[${ID_ATTRIBUTE}="${String(name).replace(/"/g, '\\"')}"]`;
  return root.querySelector(selector);
}

const orderOf = (el) => (el?.getAttribute?.(ORDER_ATTRIBUTE) ?? "");

/** The attribute a component marks its content region with. */
export const CONTENT_ATTRIBUTE = "data-ui-content";

/**
 * Where an element's children actually live.
 *
 * Usually the element itself.  But a component may move its light-DOM
 * children into a region of its own -- `panel' puts them below a title bar --
 * and an insert that went into the component element instead would land
 * outside that region: beside the border rather than inside it, and only for
 * the children added after the first mount, which is the kind of fault that
 * looks like a styling bug.  So a component that relocates its children
 * marks the destination and the reconciler reads the mark.
 */
function contentOf(el) {
  if (!el?.querySelector) return el;
  const region = el.querySelector(`:scope > [${CONTENT_ATTRIBUTE}]`);
  return region || el;
}

/**
 * Where an element with this key belongs among a parent's current children.
 *
 * Returns the sibling to insert before, or null for the end.  Elements the
 * reconciler did not put there -- a host's own content, a carrier's markup --
 * have no key and are left where they are: they sort last, which keeps an
 * inserted element among the elements rather than inside somebody's content.
 */
function placeBefore(parentEl, key, except = null) {
  const k = String(key ?? "");
  for (const child of parentEl.children) {
    if (child === except) continue;
    const theirs = child.getAttribute?.(ID_ATTRIBUTE) == null ? null : orderOf(child);
    if (theirs == null) continue;
    if (theirs > k) return child;
  }
  return null;
}

/* ── building ─────────────────────────────────────────────────────────────── */

function placeholder(doc, name, reason, attribute = FAULT_ATTRIBUTE) {
  const el = doc.createElement("div");
  el.setAttribute(ID_ATTRIBUTE, String(name || "?"));
  el.setAttribute(attribute, String(reason || "").slice(0, 200));
  el.textContent = "";
  return el;
}

/**
 * One element, built.
 *
 * `html' is the one place markup from the graph enters as markup, and it is
 * the pre-existing path: a carrier holds exactly what the model wrote and
 * what the frame has always inlined (D-AN).  A presentation read from
 * somebody else's account is a different question and is answered where it
 * arises, by withholding rather than by sanitising (D-AM, U-74).
 */
function create(n, ctx) {
  const { components = COMPONENTS } = ctx;
  const doc = ctx.doc;
  const tag = tagFor(n.kind, components);
  if (!tag) throw new Error(`\`${n.kind}' is not an element this build can make`);
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attributesFor(n, components))) el.setAttribute(k, v);

  if (n.kind === "html") {
    el.innerHTML = String(n.html ?? "");
  } else if (n.kind === "host") {
    // nothing here: `attach' below mounts it, on both paths
  } else if (n.text != null) {
    el.textContent = n.text;
  }
  attach(el, n, ctx);
  return el;
}

/**
 * Mount what an element needs from the running build: its host, its
 * behaviour.
 *
 * Separate from `create' because the two paths into a DOM no longer share a
 * builder.  An element that is MOUNTED is built here; an element that is
 * INSERTED by a patch arrives as markup, parsed by the applier, because the
 * applier also runs in a frame that cannot be handed a registry of functions.
 * So resolution happens afterwards, against the node that landed, and both
 * paths call this.
 *
 * An unresolvable reference leaves the element inert and visibly marked. It
 * does not fetch, and it does not fail the page (D-AM).
 */
function attach(el, n, ctx) {
  if (n.kind === "host") {
    const mountHost = ctx.hosts && ctx.hosts[n.host];
    if (typeof mountHost === "function") { el.removeAttribute(INERT_ATTRIBUTE); mountHost(el, n); }
    else {
      el.setAttribute(INERT_ATTRIBUTE, `no view is registered as \`${n.host}'`);
      report(ctx, n.name, `host \`${n.host}' is not registered`);
    }
  }
  if (n.behavior) {
    const behaviour = ctx.behaviors && ctx.behaviors[n.behavior];
    if (typeof behaviour === "function") { el.removeAttribute(INERT_ATTRIBUTE); behaviour(el, n); }
    else {
      el.setAttribute(INERT_ATTRIBUTE, `no behaviour is registered as \`${n.behavior}'`);
      report(ctx, n.name, `behaviour \`${n.behavior}' is not registered`);
    }
  }
}

function report(ctx, name, reason) {
  if (typeof ctx.onFault === "function") {
    try { ctx.onFault({ name, reason: String(reason) }); } catch { /* a reporter must not fail a page */ }
  }
}

/** One element and everything under it, each inside its own boundary. */
export function build(n, ctx) {
  let el;
  try {
    el = create(n, ctx);
  } catch (e) {
    report(ctx, n.name, e?.message || e);
    return placeholder(ctx.doc, n.name, e?.message || String(e));
  }
  if (n.kind !== "html" && n.kind !== "host") {
    // Appended to the element, not to its content region: at build time the
    // component has not been connected yet, so there is no region, and the
    // component's own connectedCallback is what moves them into it.
    for (const child of sorted(n.children || [])) {
      try { el.appendChild(build(child, ctx)); }
      catch (e) { report(ctx, child.name, e?.message || e); }
    }
  }
  return el;
}

/**
 * Build a whole view into ROOT, replacing what is there.
 *
 * The one operation that is allowed to touch everything, because it is the
 * one that is not a change: opening a presentation.
 */
export function mount(elements, root, options = {}) {
  const ctx = { components: COMPONENTS, ...options, doc: docOf(root) };
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const n of sorted(elements || [])) root.appendChild(build(n, ctx));
  return root;
}

/* ── changing ─────────────────────────────────────────────────────────────── */

/**
 * A diff, as the instructions that realise it.
 *
 * Serialisable and already resolved: each one names an element and carries
 * whatever markup it needs, so the thing that carries them out needs to know
 * nothing about components, layout or the tree.  That is what lets the page
 * frame -- which can import nothing -- use the same applier as this document
 * (`dom-patch.js`).
 *
 * Order is not incidental.  Removals first, so a name this patch frees can be
 * used again by it.  Then kind replacements, because a node whose kind
 * changed has to exist in its new form before anything is moved into or
 * beside it.  Then insertions and moves, both of which need their containers
 * present.  Field updates last, so they land on the node that ended up in the
 * tree rather than on one that was about to be replaced.
 */
export function instructionsFor(diff, options = {}) {
  const components = options.components || COMPONENTS;
  const out = [];
  const markup = (n) => htmlFromTree([{ ...n, order: n.order }], { components });

  for (const { name } of diff.removed || []) out.push({ do: "remove", name });

  const replaced = new Set();
  for (const entry of diff.changed || []) {
    if (!("kind" in entry.fields) || !entry.node) continue;
    replaced.add(entry.name);
    out.push({ do: "replace", name: entry.name, html: markup({ ...entry.node, children: [] }) });
  }

  for (const add of diff.added || []) {
    out.push({ do: "insert", name: add.name, parent: add.parent ?? null,
               order: add.node?.order ?? add.order ?? null, html: markup(add.node) });
  }

  for (const move of diff.moved || []) {
    out.push({ do: "move", name: move.name, parent: move.to ?? null, order: move.order ?? null });
  }

  const DATA_FIELD = {
    bound: "data-bound", derived: "data-derived", asserted: "data-asserted",
    binds: "data-binds", behavior: "data-behavior", host: "data-host",
  };
  for (const entry of diff.changed || []) {
    const { fields } = entry;
    const set = { do: "set", name: entry.name, attributes: { ...(fields.attributes || {}) } };
    for (const [field, attribute] of Object.entries(DATA_FIELD)) {
      if (field in fields) set.attributes[attribute] = fields[field] ?? null;
    }
    if ("immutable" in fields) set.attributes["data-immutable"] = fields.immutable ? true : null;
    if ("css" in fields) set.css = fields.css || styleFor(entry.node || {});
    if ("text" in fields) set.text = fields.text;
    if ("html" in fields) set.inner = fields.html;
    const touches = Object.keys(set.attributes).length || "css" in set || "text" in set
                 || "inner" in set;
    // A kind change already carried its attributes in the replacement markup;
    // what is left of the entry still applies to the new node.
    if (touches) out.push(set);
    else if (!replaced.has(entry.name)) out.push(set);
  }
  return out;
}

/**
 * Apply one diff to a mounted view.
 *
 * Returns what it did, which is what the test asserts against.  The work is
 * `dom-patch.js`'s, so that the page frame and this document are running the
 * same applier rather than two that agree today.
 */
export function apply(diff, root, options = {}) {
  const ctx = { components: COMPONENTS, ...options };
  // One list of faults whichever half produced them: the applier's, and the
  // ones `attach' raises for a host or a behaviour nothing registered.  A
  // caller should not have to ask two places whether the patch went in.
  const raised = [];
  const onFault = options.onFault;
  ctx.onFault = (f) => {
    raised.push(f);
    if (typeof onFault === "function") { try { onFault(f); } catch { /* a reporter must not fail a page */ } }
  };
  const instructions = instructionsFor(diff, ctx);
  const done = applyInstructions(instructions, root, { onFault: ctx.onFault });

  // Hosts and behaviours are resolved here rather than in the applier: a
  // registry of functions is not serialisable and has no business crossing
  // into a frame.  Everything inserted or rebuilt by this patch is visited,
  // and nothing else is.
  const resolve = (n) => {
    if (!n.host && !n.behavior) return;
    const el = nodeFor(root, n.name);
    if (el) attach(el, n, ctx);
  };
  for (const add of diff.added || []) if (add.node) walk([add.node], resolve);
  for (const entry of diff.changed || []) {
    if (!entry.node) continue;
    if ("kind" in entry.fields || "host" in entry.fields || "behavior" in entry.fields) {
      resolve(entry.node);
    }
  }
  return { ...done, instructions, faults: raised };
}

/** Diff two trees and apply the result: the ordinary way in. */
export function reconcile(before, after, root, options = {}) {
  const diff = diffTrees(before, after);
  return { diff, applied: diff.empty ? null : apply(diff, root, options) };
}

/** Every element the reconciler owns, by name. */
export function mountedNames(root) {
  return [...root.querySelectorAll(`[${ID_ATTRIBUTE}]`)].map((e) => e.getAttribute(ID_ATTRIBUTE));
}
