/**
 * The Results tab, and the showing of the pane behind it (U-120).
 *
 * Its own file for two reasons that happen to agree.
 *
 * The first is the deploy rule.  `results-pane.js' is served, so a browser
 * can hold a cached copy of it; a fresh module importing a name that copy
 * does not export is a LINK error, which takes the whole interface out, and
 * `tests/deploy-check.mjs' reports it as fatal.  A file that has never been
 * served cannot have been cached, so new exported surface goes in a new file.
 *
 * The second is that the tab is not the pane.  The tab is drawn into other
 * panes' margins — a repository's strip of small icons, an account's — and
 * `ui/pages/index.js' draws those, so what it needs is a markup function and
 * not the pane module.  The pane is what the tab shows.
 */

/** The pane's element. */
export const RESULTS_PANE_ID = "tab-results";
/** What marks a margin tab as this pane's, wherever a strip of them is drawn. */
export const TAB_ATTRIBUTE = "data-results-tab";
/** The class a drag lights the margin tab up with. */
export const ACTIVE = "drag-active";
/** Which pane the station covered, so the tab can put it back. */
let covered = null;

/**
 * The tab, for a pane's left margin.
 *
 * A `.manage-tab' like the others in the strip, so it inherits the strip's
 * size, spacing and hover and needs no layout of its own; `results-tab' sets
 * it apart, because like `exploration-tab' it selects no panel BESIDE it and
 * must be kept out of the switcher that would blank the sidebar for it.
 *
 * Not a tab in the bar across the top, which was the first attempt and the
 * wrong place twice over: that bar lists what is OPEN, one entry per account,
 * repository and view, and a station that is always there would sit in it
 * claiming to be a document; and a destination for a drag belongs beside the
 * thing being dragged, not above it.
 */
export const resultsMarginTab = ({ open = false } = {}) =>
  `<button type="button" class="manage-tab results-tab${open ? " open" : ""}" ${TAB_ATTRIBUTE}`
  + ` data-testid="margin-tab-results"`
  + ` title="Results — readings kept here and presentations moved here.`
  + ` Drop a result tab on this icon to keep it.">`
  + `<img src="./images/chart-line.svg" alt="Results" width="16" height="16" /></button>`;

/**
 * Show the station, or go back to what it covered.
 *
 * `activateTab' cannot do this, and the reason is the correction: it works
 * from a link in the bar across the top, and this pane deliberately has none.
 * So the showing is done here — the same two lines `activateTab' does, plus
 * remembering which pane was in front so the tab can put it back.  Going
 * back DOES go through `activateTab', because the pane returned to has a tab
 * up there and with it a body class, an aside and an active mark to restore.
 *
 * `show: true' is the drop's call: a drop asks to see what landed and must
 * never be read as a second press that takes it away again.
 */
export function showResultsPane(app, { show = false } = {}) {
  const root = app?.root || (typeof document === "undefined" ? null : document);
  const container = root?.querySelector?.("#content-container");
  const pane = container?.querySelector?.(`#${RESULTS_PANE_ID}`);
  if (!pane) return false;
  const panes = Array.from(container.querySelectorAll(
    ".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
  const showing = pane.style.display !== "none";

  if (showing && !show) {
    const back = covered
      || panes.find((p) => p.id && p.id !== RESULTS_PANE_ID)?.id
      || null;
    covered = null;
    pane.style.display = "none";
    mark(root, false);
    if (back && typeof app?.activateTab === "function") app.activateTab(`#${back}`);
    else if (back) { const b = container.querySelector(`#${back}`); if (b) b.style.display = "block"; }
    return false;
  }

  if (!showing) {
    covered = panes.find((p) => p.id !== RESULTS_PANE_ID && p.style.display !== "none")?.id
           || covered;
  }
  for (const p of panes) p.style.display = p.id === RESULTS_PANE_ID ? "block" : "none";
  // Nothing in the top bar is this pane, so nothing up there may claim to be:
  // an active mark left on the repository would say the reader is looking at
  // a page they are not.
  for (const l of root.querySelectorAll("[data-tab-link]")) l.classList.remove("active");
  const aside = root.querySelector("#aside");
  if (aside) aside.style.display = "none";
  mark(root, true);
  return true;
}

/** The tabs say whether the station is the thing in front. */
const mark = (root, open) => {
  for (const tab of root.querySelectorAll(`[${TAB_ATTRIBUTE}]`)) tab.classList.toggle("open", open);
};
