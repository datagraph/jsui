/**
 * The name an element answers to, as something the reader can see (U-104).
 *
 * `lift inventory#i-row as stock-card' is exact, and that is the whole point
 * of it: the bar parses it, nothing interprets it, and it either names a
 * component or it does not.  The cost of that exactness was never written
 * down -- `i-row' is not on the screen anywhere.  It is in the graph, it is
 * in the outline the MODEL is shown (`outlineOf', `tree.js'), it is in the
 * catalogue once something has been lifted, and it is in `data-ui' in the
 * DOM.  A person composing the operation had no reading of the interface
 * that would tell them what to type.
 *
 * So this module answers two questions about one element, and the surfaces
 * that show the answer hold no policy of their own:
 *
 *   WHAT IS IT CALLED, and what is it -- `i-row · stack', and what it shows.
 *   MAY THE VERB TAKE IT, and when not, in the words of the refusal that
 *   would otherwise have come back after the Enter.
 *
 * The second is the reason this is a module and not a `title' attribute.
 * The four verbs want four different things, and an interface that lit up
 * every element for every verb would be telling the user that `unmount
 * i-head' is a sentence.  It is not: `i-head' mounts nothing, and the only
 * way to find that out today is to type it and read the refusal.
 *
 * On where the refusals come from: each one is the sentence its operation
 * already answers with, said before the Enter rather than after.  They are
 * duplicated here in wording and not in logic -- `lift' still checks
 * `nameable', `unmount' still checks what the element hosts -- because a
 * hover that guesses wrong and a verb that refuses are not the same failure,
 * and the second must remain the authority.
 */

import { walk } from "./tree.js";
import { idsOf } from "./document.js";
import { mountedPresentation } from "./arrangement.js";

/** The verbs that take an element as an argument. */
export const ARRANGEMENT_VERBS = Object.freeze(["lift", "apply", "mount", "unmount"]);

/** Kinds with no nameable interior (D-AN, D-AS) -- `nameable' refuses these. */
const OPAQUE_KINDS = ["html", "host"];

/** What an element shows, in the words the outline uses. */
function showsOf(n) {
  if (n.bound) return `shows panel ${n.bound}`;
  if (n.derived) return `shows transform ${n.derived}`;
  if (n.asserted) return `shows assertion ${n.asserted}`;
  if (n.binds) return `edits parameter ${n.binds}`;
  return null;
}

/** One element, as much of it as a reader hovering over it needs. */
export function anchorOf(n, parent = null, depth = 0) {
  const kind = String(n?.kind || "");
  return {
    name: String(n?.name || ""),
    kind,
    opaque: OPAQUE_KINDS.includes(kind),
    host: n?.host || null,
    mounts: kind === "host" ? mountedPresentation(n.host) : null,
    immutable: Boolean(n?.immutable),
    shows: showsOf(n || {}),
    parent: parent ? String(parent.name) : null,
    depth,
  };
}

/** Every element of a view, by name. */
export function anchorTable(view) {
  const out = new Map();
  walk(view?.elements || [], (n, parent, depth) => {
    out.set(String(n.name), anchorOf(n, parent, depth));
  });
  return out;
}

/* ── what a half-typed line is waiting for ────────────────────────────────── */

/**
 * The verb on this line, and the argument it is up to.
 *
 * Read from a line that is still being typed, so every answer is about a
 * sentence that is not finished.  `wants' is `element' only where an element
 * is what comes next: `apply stock-card' is waiting for an ARRANGEMENT name
 * and lighting the page up there would be an invitation to click something
 * that cannot be typed in that position.
 *
 * `lift' wants an element from its first character, because what follows the
 * verb is `<presentation>#<anchor>' and the presentation half is spelled by
 * whichever element is picked.
 */
export function expectation(line) {
  const s = String(line == null ? "" : line).replace(/^\s+/, "");
  const m = /^([A-Za-z]+)(\s[\s\S]*)?$/.exec(s);
  if (!m) return { verb: null, wants: null };
  const verb = m[1].toLowerCase();
  if (!ARRANGEMENT_VERBS.includes(verb)) return { verb: null, wants: null };
  // The verb alone, with no space after it, is still being typed: `mou' is
  // not `mount', and `mount' may yet become `mounted-thing' in a sentence.
  if (!m[2]) return { verb, wants: null };
  const rest = m[2];
  if (verb === "lift" || verb === "unmount") return { verb, wants: "element" };
  // `apply X into Y' and `mount X into Y': the element is the tail, and only
  // once the preposition that introduces it has been typed.
  return { verb, wants: /\b(?:in|into|to)\s+\S*$/i.test(rest) ? "element" : "arrangement" };
}

/* ── may the verb take this element ───────────────────────────────────────── */

/**
 * Whether VERB could take this element, and the sentence either way.
 *
 * An unknown verb -- which is every line that is not one of the four -- says
 * the element is addressable and nothing more.  That is the honest answer: a
 * name is worth reading whether or not an operation is being composed, and
 * the alternative is an interface that shows nothing until it is sure what
 * you are doing.
 */
export function argumentCheck(verb, entry) {
  if (!entry) return { ok: false, role: null, reason: "this is not a named element" };
  switch (String(verb || "")) {
    case "lift":
      if (entry.opaque) {
        return { ok: false, role: null,
                 reason: `a \`${entry.kind}' element is opaque: an arrangement cannot be `
                       + `lifted from inside one — \`lift <presentation> as <name>' takes `
                       + `the whole of it, markup and all` };
      }
      return { ok: true, role: "lift this" };
    case "apply":
      if (entry.opaque) {
        return { ok: false, role: null,
                 reason: `a \`${entry.kind}' element has no interior to place anything in` };
      }
      return { ok: true, role: "apply into this" };
    case "mount":
      if (entry.opaque) {
        return { ok: false, role: null,
                 reason: `a \`${entry.kind}' element has no interior to mount into` };
      }
      return { ok: true, role: "mount into this" };
    case "unmount":
      return entry.mounts
        ? { ok: true, role: `unmount \`${entry.mounts}'` }
        : { ok: false, role: null, reason: "nothing is mounted here" };
    default:
      return { ok: true, role: "addressable" };
  }
}

/* ── what is shown ────────────────────────────────────────────────────────── */

/** The badge drawn against the element itself: short enough to sit in a border. */
export function anchorBadge(entry) {
  if (!entry) return "";
  return `${entry.name} · ${entry.kind}`;
}

/**
 * The line the bar carries while the pointer is over an element.
 *
 * The full name first, because it is the thing that gets typed, and then
 * what would happen to it.  A refusal is said as a refusal and not as an
 * absence: an element that simply stopped lighting up would read as the
 * interface having lost interest.
 */
export function anchorLine({ presentation = null, entry = null, verb = null } = {}) {
  if (!entry) return "";
  const full = presentation ? `${presentation}#${entry.name}` : entry.name;
  const what = [entry.kind, entry.shows, entry.mounts ? `mounts \`${entry.mounts}'` : null,
                entry.immutable ? "immutable" : null].filter(Boolean).join(", ");
  const named = ARRANGEMENT_VERBS.includes(String(verb || ""));
  const check = argumentCheck(verb, entry);
  const tail = !named ? "" : (check.ok ? ` — ${check.role}` : ` — ${check.reason}`);
  return `${full} · ${what}${tail}`;
}

/**
 * What picking this element puts into the line being typed.
 *
 * `lift' takes the qualified name and everything else takes the anchor: the
 * presentation half is not decoration in a lift (two presentations may mint
 * the same anchor), and is not accepted at all in the other three, whose
 * element argument is spelled bare.
 */
export function anchorArgument({ presentation = null, entry = null, verb = null } = {}) {
  if (!entry) return "";
  return verb === "lift" && presentation ? `${presentation}#${entry.name}` : entry.name;
}

/**
 * Every element of a view, resolved for one verb.
 *
 * Computed here and handed over whole -- to the ledger in this document, and
 * through `postMessage' to the one inside a page's frame, which is a sandbox
 * that cannot import a module and must not hold a copy of these rules.
 */
export function anchorsFor(view, verb, { presentation = null } = {}) {
  const out = {};
  for (const [name, entry] of anchorTable(view)) {
    const check = argumentCheck(verb, entry);
    out[name] = { name, kind: entry.kind, badge: anchorBadge(entry),
                  line: anchorLine({ presentation, entry, verb }),
                  argument: anchorArgument({ presentation, entry, verb }),
                  ok: check.ok, role: check.role, reason: check.reason || null };
  }
  return out;
}

/**
 * The standing answer: what every addressable thing on a page is called.
 *
 * `anchorsFor' answers while an operation is being composed.  This answers
 * when nobody is composing anything, which turned out to be the question
 * people actually have -- a reader looking at a tab captioned `view pmulti'
 * and a table above it captioned nothing has no way to tell that the first
 * is a PANEL name and the second has no name at all.  Neither is an element
 * anchor, and nothing on the screen said so.
 *
 * Two kinds, because a page has two and they are addressed by different
 * things:
 *
 *   elements  a tree's own anchors.  What `lift' takes, spelled as it would
 *             be typed -- qualified by the presentation, because that half
 *             is not decoration.
 *   ids       a view that is still markup has these and no anchors at all.
 *             They are addressed by an INSTRUCTION, which rewrites that
 *             region, and never by an arrangement verb.  Saying so here is
 *             the whole reason they are included: an id looks exactly like
 *             an anchor, and the way to find out that it is not was to type
 *             it and read a refusal.
 *
 * Text only.  What the frame does with it is write a `title', which is why
 * nothing here is a judgement about an operation: a tooltip that advised is
 * a second place the rules live.
 */
export function anchorTips(doc, { presentation = null } = {}) {
  const elements = {};
  const ids = {};
  for (const v of doc?.views || []) {
    if (v.elements?.length) {
      for (const [name, entry] of anchorTable(v)) {
        elements[name] = anchorLine({ presentation, entry, verb: null });
      }
      continue;
    }
    for (const id of idsOf(v.html)) {
      if (ids[id]) continue;
      ids[id] = `\`${id}' · an id in view \`${v.name}', not an element anchor — this view `
              + `is markup, so the region is changed by an instruction and cannot be lifted`;
    }
  }
  return { elements, ids };
}

export default anchorTable;
