/**
 * Bringing an editor panel into view (U-121).
 *
 * Its own file for the reason `results-tab.js' is: `ui/pages/index.js' is
 * served and 7 000 lines long, and what this does can only be judged in a
 * browser — a scroll that lands in the wrong place is invisible to every
 * assertion a string can make.  A file nobody can have cached is also the
 * only safe place for new exported surface.
 */

/**
 * Bring an editor panel to the top of the editors column.
 *
 * `scrollIntoView' was what did this, and it did two things where one was
 * wanted.  It scrolls EVERY scrollable ancestor: the editors column, which
 * is the intent, and then the page, so the column's top — and with it the
 * panel — is dragged up to the top of the window, taking the header, the
 * pane tabs and the repository's own lists off the top with it.  And because
 * the editor mounts and then sizes itself a frame or two after the scroll is
 * asked for, a `smooth' animation is still running while the panel grows:
 * it lands past where it aimed, and what ends up above the column's visible
 * top is the panel's title bar — the one part a reader needs, since it
 * carries the name and the controls.
 *
 * So: the column is scrolled and nothing else, by the measured distance from
 * the panel's top to the column's own content top — zero when the panel is
 * already the first one, so choosing the first view scrolls nothing.  Two
 * frames later, which is after the editor has sized itself, because a
 * distance measured before that is a distance to where the panel was.
 */
export const bringPanelIntoView = (wrapper) => {
  const column = wrapper?.closest?.(".view-editors-container");
  if (!column) return;
  const view = wrapper.ownerDocument?.defaultView || null;
  const settle = () => {
    const pad = view ? parseFloat(view.getComputedStyle(column).paddingTop) || 0 : 0;
    const top = column.getBoundingClientRect().top + column.clientTop + pad;
    const delta = wrapper.getBoundingClientRect().top - top;
    if (Math.abs(delta) < 1) return;
    column.scrollTo({ top: column.scrollTop + delta, behavior: "smooth" });
  };
  if (view && typeof view.requestAnimationFrame === "function") {
    view.requestAnimationFrame(() => view.requestAnimationFrame(settle));
  } else settle();
};
