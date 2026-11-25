/**
 * The identifiers, on the page (U-104).
 *
 * An arrangement verb takes an element by its minted anchor, and until this
 * module there was nowhere on the screen that an anchor appeared.  The
 * interface knew every one of them -- they are in `data-ui' on the elements
 * themselves -- and showed none.
 *
 * Three decisions, and each of them is about restraint rather than about
 * drawing.
 *
 * **It is on while a line is being typed, and otherwise it is not.**  An
 * interface that outlined something under every pointer movement would be
 * unusable for the thing it is mostly used for, which is reading.  The
 * location bar being open is exactly the moment an identifier is wanted,
 * because the bar is the only place one can be typed (D-AU).
 *
 * **A click is taken only where the line is waiting for an element.**  With
 * the bar open and `lift ' typed, a press on a component is unambiguous and
 * types its name.  With the bar open and nothing typed -- or prose typed, or
 * `apply ' waiting for an ARRANGEMENT name -- the page behaves exactly as it
 * always does, because stealing a press there would break the interface in
 * the ordinary case to serve the rare one.
 *
 * **The listeners are on the root and not on the elements.**  The reconciler
 * moves, replaces and removes the nodes under it (D-AO), and a listener
 * attached to an element is a listener attached to something that may not be
 * there after the next patch -- or, worse, that survives on a detached node
 * and keeps a document alive.  `mouseover' and `mouseout' bubble and
 * `mouseenter' and `mouseleave' do not, which is why the pair that reads
 * worse is the pair that is used.
 *
 * What it draws is a badge in the element's own top border, in the manner of
 * a legend, and one line in the bar.  The badge is where the eye already is;
 * the line is where the name is about to be typed, and it stays after the
 * pointer has moved on so that it can be read and copied.
 */

import { expectation, argumentCheck, anchorBadge, anchorLine, anchorArgument,
         anchorTable } from "../../lib/app/anchors.js";

/** On the element under the pointer: `yes' when the verb could take it. */
export const HOVER_ATTRIBUTE = "data-ui-hover";
/** On every element the verb being typed could take. */
export const CANDIDATE_ATTRIBUTE = "data-ui-candidate";
/** The badge drawn in an element's border. */
export const BADGE_CLASS = "ui-anchor-badge";
export const BADGE_ID = "ui-anchor-badge";

/**
 * Wire one root.
 *
 * `viewFor' answers, for one element in this document, which presentation it
 * belongs to and the tree of that presentation -- the chrome's own, or a
 * mounted presentation's once a band has been opened.  Everything else here
 * is DOM.
 */
export function mountAnchorLedger(root, {
  viewFor = () => null,
  note = () => {},
  onPick = null,
  doc = root?.ownerDocument || globalThis.document,
} = {}) {
  if (!root) return null;

  let active = false;                 // is a line being typed at all
  let verb = null, wants = null;      // what that line is waiting for
  let marking = true;                 // would an operation typed here act HERE
  let hovered = null;                 // the element under the pointer
  let marked = [];                    // what carries the candidate attribute
  let swallow = false;                // a pick happened; eat the click behind it
  const tables = new WeakMap();       // one anchor table per view object

  const badge = doc.createElement("div");
  badge.id = BADGE_ID;
  badge.className = BADGE_CLASS;
  badge.setAttribute("data-testid", "anchor-badge");
  badge.hidden = true;

  /** The element with an identity at or above TARGET, within the root. */
  const anchored = (target) => {
    const el = target?.closest?.(`[data-ui]`);
    return el && root.contains(el) ? el : null;
  };

  /** What this element is: its presentation, and its row in that tree. */
  function entryFor(el) {
    const held = viewFor(el);
    if (!held?.view) return null;
    let table = tables.get(held.view);
    if (!table) { table = anchorTable(held.view); tables.set(held.view, table); }
    const entry = table.get(el.getAttribute("data-ui"));
    return entry ? { presentation: held.presentation || null, entry } : null;
  }

  /* ── the badge, in the element's own border ── */

  function showBadge(el, text, ok) {
    if (!badge.isConnected) (doc.body || doc.documentElement).appendChild(badge);
    badge.textContent = text;
    badge.dataset.ok = ok ? "yes" : "no";
    badge.hidden = false;
    const box = el.getBoundingClientRect();
    const x = box.left + (doc.defaultView?.scrollX || 0);
    const y = box.top + (doc.defaultView?.scrollY || 0);
    badge.style.left = `${Math.max(0, Math.round(x + 8))}px`;
    badge.style.top = `${Math.max(0, Math.round(y))}px`;
  }

  const hideBadge = () => { badge.hidden = true; };

  /* ── what the verb could take ── */

  function unmark() {
    for (const el of marked) el.removeAttribute(CANDIDATE_ATTRIBUTE);
    marked = [];
  }

  /**
   * Mark every element the line could name.
   *
   * Recomputed when the EXPECTATION changes and not on every keystroke: the
   * set depends on the verb and on whether an element is what comes next,
   * and neither changes while a name is being spelled out.
   */
  function mark() {
    unmark();
    if (!active || wants !== "element") return;
    for (const el of root.querySelectorAll("[data-ui]")) {
      const held = entryFor(el);
      if (held && argumentCheck(verb, held.entry).ok) {
        el.setAttribute(CANDIDATE_ATTRIBUTE, "");
        marked.push(el);
      }
    }
  }

  /* ── the pointer ── */

  function enter(el) {
    const held = entryFor(el);
    if (!held) return;
    hovered = el;
    const check = argumentCheck(verb, held.entry);
    el.setAttribute(HOVER_ATTRIBUTE, check.ok && wants === "element" ? "yes" : "no");
    showBadge(el, anchorBadge(held.entry), check.ok);
    note(anchorLine({ presentation: held.presentation, entry: held.entry, verb }));
  }

  function leave() {
    if (hovered) hovered.removeAttribute(HOVER_ATTRIBUTE);
    hovered = null;
    hideBadge();
  }

  const onOver = (event) => {
    if (!active) return;
    const el = anchored(event.target);
    if (!el || el === hovered) return;
    leave();
    enter(el);
  };

  const onOut = (event) => {
    if (!active || !hovered) return;
    // `mouseout' fires on the way into a CHILD as well as on the way out of
    // the element, so the one that matters is the one whose destination is
    // outside what is highlighted.
    const to = event.relatedTarget;
    if (to && hovered.contains(to)) return;
    leave();
  };

  /**
   * A press on a candidate types its name.
   *
   * On `mousedown' and not on `click', and cancelled: the input has the
   * caret, and a press anywhere else would blur it and close the bar before
   * a click could ever be delivered.  Cancelling the press keeps the caret
   * where it is, which is also where the name is about to go.
   */
  const onDown = (event) => {
    swallow = false;
    if (!active || wants !== "element" || typeof onPick !== "function") return;
    const el = anchored(event.target);
    if (!el) return;
    const held = entryFor(el);
    if (!held || !argumentCheck(verb, held.entry).ok) return;
    event.preventDefault();
    event.stopPropagation();
    swallow = true;
    onPick(anchorArgument({ presentation: held.presentation, entry: held.entry, verb }));
  };

  /**
   * And the click that press would otherwise have become.
   *
   * Cancelling `mousedown' stops the focus moving and stops a drag; it does
   * NOT stop the click, which would still reach whatever was pressed -- a
   * button, a tab, a link.  A press that types a name must not also do the
   * thing the element does, so the one click that follows a pick is taken
   * as well, and exactly one: the flag is cleared by the next press whether
   * or not a click ever arrived.
   */
  const onClick = (event) => {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // A badge is placed against a rectangle that scrolling invalidates.  It is
  // taken away rather than followed: the pointer is about to be somewhere
  // else anyway, and a badge that lags its element is a badge pointing at the
  // wrong thing.
  const onScroll = () => { if (hovered) leave(); };

  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("mousedown", onDown, true);
  root.addEventListener("click", onClick, true);
  doc.defaultView?.addEventListener("scroll", onScroll, true);

  const api = {
    /**
     * The line as it stands, which decides what is lit and what a press does.
     *
     * `marking' is whether the bar is addressing THIS -- the chrome -- and
     * not something else.  An operation goes where the bar says it goes, so
     * lighting up a candidate in a document that is not the address would be
     * offering a press that lands as a refusal somewhere else.  The name is
     * still shown: a name is true whoever is addressed, and the user looking
     * at one page while composing against another is looking for exactly
     * that.
     */
    setLine(text, { marking: here = marking } = {}) {
      const read = expectation(text);
      const wanted = here ? read.wants : null;
      const changed = read.verb !== verb || wanted !== wants || here !== marking;
      verb = read.verb; wants = wanted; marking = here;
      if (changed) {
        mark();
        if (hovered) { const el = hovered; leave(); enter(el); }
      }
      return read;
    },
    /** A line is being typed: identities are worth showing. */
    enable(text = "", { marking: here = true } = {}) {
      active = true;
      api.setLine(text, { marking: here });
      mark();
      return api;
    },
    /** It is not: put everything back. */
    disable() {
      active = false;
      verb = null; wants = null; marking = true;
      leave();
      unmark();
      note("");
      return api;
    },
    hovered() { return hovered ? hovered.getAttribute("data-ui") : null; },
    candidates() { return marked.map((el) => el.getAttribute("data-ui")); },
    destroy() {
      api.disable();
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      root.removeEventListener("mousedown", onDown, true);
      root.removeEventListener("click", onClick, true);
      doc.defaultView?.removeEventListener("scroll", onScroll, true);
      badge.remove();
    },
  };
  return api;
}

export default mountAnchorLedger;
