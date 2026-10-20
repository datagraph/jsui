/**
 * Reorderable panels whose text is still usable.
 *
 * The view editors are reordered by dragging, and the way that was arranged --
 * `draggable="true"' on the whole panel -- is also what stopped the mouse
 * working inside them.  In Firefox a mousedown anywhere beneath a draggable
 * element begins a drag gesture, so inside the panel a click does not place
 * the caret (it lands at offset 0) and a sweep selects nothing.  Chromium
 * exempts form controls, which is why this went unnoticed for so long, and why
 * it was reported as "when a new view is created it is not possible to use the
 * mouse to position in the text": the new view is simply the first one you
 * type into.
 *
 * Cancelling `dragstart' over the text does not fix it.  By the time that
 * event fires the browser has already decided the gesture was a drag rather
 * than a selection, and cancelling it only means neither happens.
 *
 * So the panel is not draggable at rest.  It becomes draggable for the
 * duration of a gesture that begins on its title bar, and stops being
 * draggable the moment that gesture ends.  `draggable' is read when the drag
 * is initiated, not when the listener was attached, so setting it in
 * `pointerdown' is in time.
 */

/** What may start a drag: the panel's own title bar, by either name. */
export const HANDLE_SELECTOR = ".dialog-header, .view-editor-header";

/** And what may not, even within it -- a control on the bar is a control. */
export const HANDLE_EXCLUDE = "button, input, select, textarea, a, [contenteditable]";

/**
 * Let WRAPPER be dragged by its title bar and by nothing else.
 *
 * Returns a function that undoes it, for a panel that outlives its container.
 */
export function makeDragHandleOnly(wrapper) {
  if (!wrapper) return () => {};
  wrapper.draggable = false;
  const take = (event) => {
    const target = event.target;
    wrapper.draggable = Boolean(
      target?.closest?.(HANDLE_SELECTOR) && !target.closest(HANDLE_EXCLUDE));
  };
  const release = () => { wrapper.draggable = false; };
  wrapper.addEventListener("pointerdown", take);
  wrapper.addEventListener("pointerup", release);
  wrapper.addEventListener("pointercancel", release);
  wrapper.addEventListener("dragend", release);
  return () => {
    wrapper.removeEventListener("pointerdown", take);
    wrapper.removeEventListener("pointerup", release);
    wrapper.removeEventListener("pointercancel", release);
    wrapper.removeEventListener("dragend", release);
  };
}

export default makeDragHandleOnly;
