/**
 * The show/hide control, as the view editors draw it.
 *
 * `js/sparql-editor.js' has drawn this caret on every view editor since
 * before any of these panes existed, and a reader who has learned it there
 * should not have to learn it again in each new pane.  So the glyph lives
 * here once rather than being redrawn per pane: a caret DOWN when the thing
 * is shown, a caret RIGHT when it is not, 12px, `currentColor', one path.
 *
 * It is a <button>, not a <details>/<summary>, because the things it collapses
 * are already structured -- a stage with a heading, a panel with a header --
 * and wrapping them in a disclosure would mean rebuilding that structure
 * around the control.  `aria-expanded' and the title carry what the glyph
 * says, so the state is readable without seeing it.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Down when open, right when shut: the editor's own two paths. */
export const CARET = { open: "M6 10l6 6l6 -6h-12", shut: "M10 18l6 -6l-6 -6v12" };

export function caretSvg(doc, open) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ width: 12, height: 12, viewBox: "0 0 24 24",
                                        fill: "none", stroke: "currentColor",
                                        "stroke-width": 1, "stroke-linecap": "round",
                                        "stroke-linejoin": "round" })) {
    svg.setAttribute(k, String(v));
  }
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", open ? CARET.open : CARET.shut);
  svg.appendChild(path);
  return svg;
}

/** Turn an existing control to face the state it is now in. */
export function setCaret(btn, open, { shown = "Hide", hidden = "Show" } = {}) {
  const doc = btn.ownerDocument;
  btn.replaceChildren(caretSvg(doc, open));
  btn.title = open ? shown : hidden;
  btn.setAttribute("aria-expanded", String(open));
  return btn;
}

/**
 * A caret that hides one element, and the header that carries it.
 *
 * The HEADER is the control, not just the button: a 16px target at the end of
 * a row is findable only by someone already looking for it, and these headers
 * hold nothing else to click.  The button stays a button so that it is
 * reachable from the keyboard and announces its state; its click simply
 * bubbles to the header, so there is one handler and no double toggle.
 *
 * Returns the button, with `open` readable and `toggle()` callable, so a
 * caller that collapses a region for some other reason can keep the caret
 * honest.
 */
export function makeDisclosure(doc, { header, body, open = true, className = "dsh-toggle",
                                      testid = null, labels = {}, onToggle = null } = {}) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = className;
  if (testid) btn.dataset.testid = testid;
  let shown = Boolean(open);

  const apply = () => {
    setCaret(btn, shown, labels);
    if (body) body.hidden = !shown;
    if (header) header.setAttribute("aria-expanded", String(shown));
  };
  const set = (next) => {
    const was = shown;
    shown = Boolean(next);
    apply();
    if (was !== shown && onToggle) onToggle(shown);
  };

  if (header) {
    header.classList.add("dsh-disclosing");
    header.addEventListener("click", (e) => {
      // A selection dragged across the heading is not a press.
      if (doc.getSelection && String(doc.getSelection() || "")) return;
      // Anything else interactive in the header keeps its own meaning.
      if (e.target !== btn && e.target.closest
          && e.target.closest("a, input, select, textarea") ) return;
      if (e.target !== btn && e.target.closest("button") && e.target.closest("button") !== btn) return;
      set(!shown);
    });
  } else {
    btn.addEventListener("click", () => set(!shown));
  }

  Object.defineProperty(btn, "open", { get: () => shown, set });
  btn.toggle = () => set(!shown);
  apply();
  return btn;
}

export default makeDisclosure;
