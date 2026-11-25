/**
 * The results pane (U-120).
 *
 * A station of its own, reached by a tab in the left margin, holding the two
 * things a reader keeps rather than reads once:
 *
 *   **readings** — results sent out of a view's own result tabs, each as it
 *     was read and saying when;
 *   **presentations** — presentations moved here by name, each drawn only
 *     when it is opened.
 *
 * It replaces the band U-117 put across the repository pane, and the reason
 * is worth writing down because the band was built, deployed and then taken
 * out in a day.  A repository pane's results region said that what is kept
 * belongs to one repository and is looked at beside that repository's view
 * list.  Neither is true.  The immediate result of running a view is in that
 * view's own result tabs and was never in question; what is KEPT is kept to
 * be compared, which means compared with readings from other repositories
 * and with presentations that were composed somewhere else entirely.  A
 * destination scoped to one repository cannot hold that, and a destination
 * the width of a column cannot hold what it does hold.
 *
 * Three consequences, each a limit as much as a capability:
 *
 *   1. **The margin tab is the drop target, and it is in the margin.**  Only
 *      one pane is displayed at a time, so while a reader is dragging out of
 *      an editor the results pane is hidden, and an element inside a
 *      `display:none' ancestor has no layout box and can receive no drop —
 *      which is exactly the defect the band was built to fix and fixed by
 *      accident.  So the tab takes the drop.  It belongs in the strip of
 *      small icons down the left of the pane the reader is dragging IN —
 *      beside Profile, Configuration, Logs, Exploration — and not in the
 *      bar of pane tabs across the top, which is a list of what is open and
 *      says nothing about where a thing can be sent.  The strip is where
 *      this interface puts the things a pane can be asked to show, the
 *      exploration tab included, and the graph is the mark: a reading drawn.
 *
 *   2. **A presentation is moved here by reference, and for this page.**  A
 *      band is a name and a press (§21.4.3): nothing is drawn until someone
 *      opens it, and nothing in a page can open it for them.  No mount is
 *      claimed in the store for it, because a claim is a durable record and
 *      this pane is not durable — it holds what this page holds and says so.
 *
 *   3. **The pane itself is arranged like every other pane.**  Its two parts
 *      are regions of the kind `results' (U-115), arranged in the view
 *      `results-pane' of the workspace presentation.  Moving the
 *      presentations above the readings is an instruction to the workspace
 *      and not a setting here.
 */

import { regionMarkup } from "../../lib/app/regions.js";
import { mountResultSheet } from "./result-sheet.js";
import { mountBandMarkup, MOUNT_ATTRIBUTE } from "./mount-band.js";
import { listPresentations } from "../../lib/app/ui-store.js";
import { catalogRefusal, mountable } from "../../lib/app/catalog.js";

/* The tab, the attribute that marks it and the showing of the pane are in
   `results-tab.js', a file of their own.  Not a tidiness: this module is
   already served, and a browser holding a cached copy of it link-errors on
   an import of a name the cached copy does not export — the whole interface
   goes blank, and `npm run check:deploy' calls that fatal.  A file nobody
   can have cached is the exempt case, so new surface goes in a new file. */
import { RESULTS_PANE_ID, TAB_ATTRIBUTE, ACTIVE, resultsMarginTab,
         showResultsPane } from "./results-tab.js";

/** The pane's element, and the tab that reaches it. */
export { RESULTS_PANE_ID };
/** What the location bar addresses it as.  A destination: `… in results#'. */
export const RESULTS_TARGET_ID = "results";
/** The container the moved presentations' bands are appended to. */
export const MOUNTS_ATTRIBUTE = "data-results-mounts";

/**
 * The tab as `buildGlobalTabs' wanted one, which it no longer does.
 *
 * Kept, and only for that reason: a deployed build imports this name, and a
 * browser with that build cached and this module fresh would link-error on
 * its absence exactly as it would on a name that was never there.  It
 * answers a tab for the bar across the top, which is where this does not go.
 */
export const resultsTab = () => ({
  id: RESULTS_PANE_ID, label: "Results", location: "", showAside: false,
  closeable: false, saveable: false, type: "results",
});

const escapeAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The pane's markup.
 *
 * Hidden on arrival like every other pane but the default one.
 *
 * It carries a margin strip of its own, holding the same tab marked open.
 * That is not decoration: showing this pane hides the pane whose margin the
 * reader pressed, and with it the tab they pressed, so without one here
 * there would be no way back and no mark saying where they are.  The strip
 * is outside the region grid because it is the pane's own chrome and not one
 * of its parts — an arrangement that could move it could strand the reader.
 */
export function resultsPaneMarkup({ arrangement = null } = {}) {
  const readings = `
      <div class="results-readings">
        <h2>Readings</h2>
        <div class="result-sheet-box" data-testid="results-sheet-box"></div>
      </div>`;
  const presentations = `
      <div class="results-mounts" ${MOUNTS_ATTRIBUTE} data-testid="results-mounts">
        <h2>Presentations</h2>
        <p class="results-empty" data-testid="results-mounts-empty">Nothing has been moved here.
          <code>mount &lt;presentation&gt; in results#</code> puts one here by reference, and it is
          drawn when you open it.</p>
      </div>`;
  return `<div id="${RESULTS_PANE_ID}" class="pane results-pane" style="display:none">`
       + `<div class="results-margin">${resultsMarginTab({ open: true })}</div>`
       + regionMarkup({ kind: "results", arrangement, parts: { readings, presentations } })
       + `</div>`;
}

/**
 * Wire the pane: the sheet, the tab's drop, and the address.
 *
 * Idempotent in the two ways that matter.  The sheet is mounted on the box
 * and remembers it, so a second call over the same DOM returns the same
 * handle with its readings intact; the tab's listeners and the registration
 * are marked on the nodes and on the app, so a page that renders twice does
 * not take a drop twice or register a second target.
 */
export function mountResultsPane(app, { run = null, hostFor = null } = {}) {
  const root = app?.root || (typeof document === "undefined" ? null : document);
  const pane = root?.querySelector?.(`#${RESULTS_PANE_ID}`);
  if (!pane) return null;

  const box = pane.querySelector(".result-sheet-box");
  const sheet = box
    ? mountResultSheet(box, { run, hostFor, onNote: () => showCount() })
    : null;

  /**
   * How many readings are held, on every tab that reaches them.
   *
   * There is one tab per pane — a repository's strip, an account's, the
   * station's own — and only the one in the pane that is displayed can be
   * seen, which is the point: the count must be wherever the reader is.  The
   * pane is hidden most of the time, so a drop that landed somewhere they
   * are not looking has to say so where they ARE.  It counts readings and
   * not everything, because that is what a drag adds.
   */
  function showCount() {
    if (!sheet) return;
    const n = sheet.count();
    for (const tab of root.querySelectorAll(`[${TAB_ATTRIBUTE}]`)) {
      let badge = tab.querySelector(".tab-count");
      if (!badge) {
        badge = tab.ownerDocument.createElement("span");
        badge.className = "tab-count";
        badge.setAttribute("data-testid", "results-tab-count");
        tab.appendChild(badge);
      }
      badge.textContent = n ? String(n) : "";
      badge.hidden = !n;
    }
  }
  showCount();

  if (sheet) {
    for (const tab of root.querySelectorAll(`[${TAB_ATTRIBUTE}]`)) {
      if (tab.__resultsDrop) continue;
      tab.__resultsDrop = true;
      /* A drag is claimed only when it carries something this pane can read.
         The editors' own reordering drag crosses this strip on its way past,
         and a tab that lit up for it would be offering a drop that fails. */
      const mine = (event) => {
        const types = event.dataTransfer?.types;
        if (!types) return false;
        const has = (t) => (typeof types.includes === "function"
          ? types.includes(t) : Array.prototype.indexOf.call(types, t) >= 0);
        return has("application/json") || has("text/plain");
      };
      const over = (event) => {
        if (!mine(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        tab.classList.add(ACTIVE);
      };
      tab.addEventListener("dragenter", over);
      tab.addEventListener("dragover", over);
      tab.addEventListener("dragleave", () => tab.classList.remove(ACTIVE));
      tab.addEventListener("drop", (event) => {
        event.preventDefault();
        tab.classList.remove(ACTIVE);
        const dt = event.dataTransfer;
        const text = dt ? (dt.getData("application/json") || dt.getData("text/plain")) : "";
        const took = sheet.addDropText(text);
        showCount();
        // A drop names this destination deliberately, so the destination is
        // brought forward: the reader asked to see it there.
        if (took) showResultsPane(app, { show: true });
      });
      // The press, which is the other half: a tab in a margin shows what is
      // behind it, and shows it from wherever the reader is standing.
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showResultsPane(app);
      });
    }
  }

  if (app && !app.__resultsTarget) app.__resultsTarget = registerResults(app);
  // A band already in the pane -- one moved here before a re-render -- is
  // wired by the chrome's own expander, which reads the presentation by name
  // when the press comes.
  app?.initializeMounts?.();
  return sheet;
}

/* ── the address (U-118: `… in results#') ─────────────────────────────────── */

function registerResults(app) {
  if (typeof app.registerTarget !== "function") return null;
  return app.registerTarget({
    id: RESULTS_TARGET_ID, label: "results", kind: "presentation",
    arrange: (instruction) => arrangeResults(app, instruction),
  });
}

/** Where the moved presentations go, and the sentence that is there instead. */
function mountsRegion(app) {
  const root = app?.root || (typeof document === "undefined" ? null : document);
  return root?.querySelector?.(`#${RESULTS_PANE_ID} [${MOUNTS_ATTRIBUTE}]`) || null;
}

async function arrangeResults(app, instruction) {
  const verb = instruction?.verb;
  if (verb === "mount") return mountHere(app, instruction.presentation);
  if (verb === "unmount") return unmountHere(app, instruction.presentation);
  return { ok: false,
           message: `the results pane holds readings and references, and neither has a `
                  + `definition to \`${verb}': what was read is a reading and what was moved `
                  + `here is a name. \`goto workspace' arranges the pane itself — its parts are `
                  + `\`r-results-readings' and \`r-results-presentations', in the view `
                  + `\`results-pane'` };
}

/**
 * Move one presentation here.
 *
 * The name is resolved against the account's own catalogue before anything
 * is drawn, so a misspelling comes back with the names it may have meant
 * rather than as an empty band.  Nothing is read here: the band carries the
 * name, and the press reads it — which is what keeps expansion external to
 * the document (§21.4.3) and what makes this three lines rather than a
 * second renderer.
 */
async function mountHere(app, name) {
  const region = mountsRegion(app);
  if (!region) return { ok: false, message: "the results pane is not in this page" };
  const accountName = app?.state?.session?.accountName || null;
  if (!accountName) return { ok: false, message: "sign in before moving a presentation here" };
  const auth = app.state.getAuthContext?.(accountName) || {};
  const listed = await listPresentations({ host: auth.host, account: accountName,
                                           token: auth.token, limit: 200 });
  if (!listed.ok) {
    return { ok: false, message: `the presentations in \`${accountName}/ui' could not be read: `
                               + `${listed.error}` };
  }
  const entry = (listed.presentations || []).find((p) => p.name === name);
  if (!entry) return { ok: false, message: catalogRefusal("presentation", name, listed.presentations) };
  const allowed = mountable({ ...entry, owner: accountName, foreign: false, mountedAt: null });
  if (!allowed.ok) return { ok: false, message: `\`${name}': ${allowed.reason}` };
  if (bandFor(region, name)) {
    return { ok: false, message: `\`${name}' is already in the results pane` };
  }
  region.querySelector(".results-empty")?.remove();
  const holder = region.ownerDocument.createElement("div");
  holder.className = "results-mount";
  holder.innerHTML = mountBandMarkup({ name });
  region.appendChild(holder);
  app.initializeMounts?.();
  showResultsPane(app, { show: true });
  return { ok: true,
           message: `\`${name}' is in the results pane — open it there to draw it. It is held `
                  + `by reference for this page: nothing is written, and nothing in the page `
                  + `can open it for you`,
           undo: async () => unmountHere(app, name) };
}

function unmountHere(app, name) {
  const region = mountsRegion(app);
  const band = region ? bandFor(region, name) : null;
  if (!band) return { ok: false, message: `\`${name}' is not in the results pane` };
  (band.closest(".results-mount") || band).remove();
  if (!region.querySelector(`[${MOUNT_ATTRIBUTE}]`)) {
    const said = region.ownerDocument.createElement("p");
    said.className = "results-empty";
    said.setAttribute("data-testid", "results-mounts-empty");
    said.textContent = "Nothing has been moved here.";
    region.appendChild(said);
  }
  return { ok: true, message: `\`${name}' is no longer in the results pane` };
}

const bandFor = (region, name) =>
  region.querySelector(`[${MOUNT_ATTRIBUTE}="${escapeAttr(name)}"]`);

export default mountResultsPane;
