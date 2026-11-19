/**
 * The chrome as a presentation (U-72; D-AS, §9).
 *
 * The interface's own layout becomes an element tree like any other, held in
 * `<account>/ui` as the presentation named `workspace', so the same patch
 * protocol that rearranges a generated page rearranges the page it is
 * generated into.  What is addressable is the ARRANGEMENT and not the
 * internals: each band of the chrome is one `ui:Host' element naming a view
 * the build already has, and the view's own `render()' is untouched.
 *
 * The difference from a document presentation is the consequence of being
 * wrong.  A generated page that comes out badly can be discarded; a
 * workspace that comes out badly is the furniture the user is standing on,
 * saved, and reloaded on the next visit.  Three things answer that, and none
 * of them is a confirmation dialog:
 *
 *   1. the bands that make the interface usable at all are `ui:immutable',
 *      so the ordinary refusal path (U-66) rejects a patch that would drop
 *      one before it is ever applied;
 *   2. `?workspace=default' renders this file's arrangement without reading
 *      the account's, so a bad save is one URL away from being visible;
 *   3. `arrangementOf' checks the tree it is given and falls back to the
 *      default when a required host is missing, so a workspace that got past
 *      (1) by some other route still renders.
 *
 * (3) is belt and braces over (1) deliberately.  The cost of the check is a
 * comparison of two short lists on every render; the cost of not having it is
 * an account that cannot reach its own interface to repair it.
 */

import { node, view, index } from "./tree.js";
import { readPresentation, writePresentation } from "./ui-store.js";

/** The presentation that holds the chrome.  One per account. */
export const WORKSPACE_NAME = "workspace";

/** Its scope, as the catalogue records it. */
export const WORKSPACE_SCOPE = "workspace";

/**
 * The views the chrome mounts, in the order the default stacks them.
 *
 * These are ids of things the build already renders, not component names: a
 * host does not say how a header is drawn, it says that the header goes
 * here.  Adding one is a change to this list AND to the renderer that fills
 * it; the model can move and remove them but cannot invent one, and a host
 * nothing is registered for renders inert with the reason on it (U-61).
 */
export const WORKSPACE_HOSTS = Object.freeze([
  "flashes", "header", "tabs", "content", "footer", "location",
]);

/**
 * The hosts without which the interface cannot be used or repaired.
 *
 * `content' because there is otherwise nothing on the screen, and `location'
 * because the bar is how the arrangement is changed back — a bar that can be
 * typed out of existence is a bar that can remove the means of restoring it
 * (D-AU, point 1).
 */
export const REQUIRED_HOSTS = Object.freeze(["content", "location"]);

/** The hosts a patch may not touch (D-AP, §9). */
export const IMMUTABLE_HOSTS = Object.freeze(["header", "content", "footer", "location"]);

/** The element name for one host.  Stable, because the default must be. */
export const hostElement = (host) => `w-${host}`;

/** The root of the chrome's tree. */
export const CHROME_ELEMENT = "w-chrome";

/**
 * The arrangement shipped with the build.
 *
 * One column, the bands in reading order, and the location bar at the foot
 * where it is today.  Expressed as a grid rather than as document order so
 * that moving a band is one rewrite of `areas' and touches no child (D-AK) —
 * which is the whole claim this phase makes about the chrome.
 */
export function defaultWorkspace({ page = "main", title = "Workspace" } = {}) {
  return {
    id: WORKSPACE_NAME,
    revision: 1,
    title,
    uses: [],
    parameters: [], panels: [], transforms: [], assertions: [],
    views: [defaultWorkspaceView(page)],
  };
}

/** One routed page's band arrangement. */
export function defaultWorkspaceView(page = "main") {
  return view({
    name: page,
    title: "The interface's own layout",
    elements: [node({
      name: CHROME_ELEMENT,
      kind: "div",
      order: "a",
      immutable: true,
      // One band per row, `content' taking the slack so the footer and the
      // bar sit at the bottom of a short page as they do today.  Computed
      // from the host list rather than written out, because a row count that
      // drifts from the area count silently drops the last band.
      layout: { columns: "1fr",
                rows: WORKSPACE_HOSTS.map((h) => (h === "content" ? "1fr" : "auto")).join(" "),
                areas: WORKSPACE_HOSTS.map((h) => h) },
      children: WORKSPACE_HOSTS.map((host, i) => node({
        name: hostElement(host),
        kind: "host",
        host,
        order: String.fromCharCode(97 + i),
        placement: { area: host },
        immutable: IMMUTABLE_HOSTS.includes(host),
      })),
    })],
  });
}

/** The view a routed page should use, falling back to the first one there is. */
export function workspaceViewFor(document, page = "main") {
  const views = document?.views || [];
  return views.find((v) => v.name === page) || views.find((v) => v.name === "main") || views[0] || null;
}

/**
 * Give a band a row of its own in the chrome's grid (U-86).
 *
 * A mounted presentation arrives as a `host' element with no placement, and
 * a grid child with no area is auto-placed into an implicit row AFTER every
 * explicit one — which puts it below the location bar, off the bottom of a
 * full-height chrome, where the reader has to go looking for the thing they
 * just asked for.  "It worked, and you cannot see it" is the failure §21.4.2
 * rules out for an applied component, and it is no better here.
 *
 * So the row is made for it, directly below `content': the band is the only
 * new thing on the screen and it belongs where the reader is already
 * looking, not under the furniture.  Nothing else moves — the other bands
 * keep their areas, and the row is one more line in a template that was
 * already computed from a list (D-AK).
 *
 * Copies rather than mutates: the document it is given is the one `mount'
 * built, whose element NODES are still shared with the document before the
 * mount, and that one is the undo.
 */
export function placeBand(document, { page = "main", element } = {}) {
  const view = workspaceViewFor(document, page);
  const root = (view?.elements || [])[0];
  if (!view || !root || !Array.isArray(root.layout?.areas)) return document;
  const band = (root.children || []).find((n) => n.name === element);
  if (!band || band.placement?.area) return document;

  const areas = [...root.layout.areas];
  const rows = String(root.layout.rows || "").split(/\s+/).filter(Boolean);
  const after = areas.findIndex((row) => /(^|\s)content(\s|$)/.test(row));
  const where = after < 0 ? areas.length : after + 1;
  const columns = String(areas[0] || "x").trim().split(/\s+/).length;
  areas.splice(where, 0, new Array(columns).fill(element).join(" "));
  if (rows.length) rows.splice(where, 0, "auto");

  const placed = {
    ...root,
    layout: { ...root.layout, areas, ...(rows.length ? { rows: rows.join(" ") } : {}) },
    children: (root.children || []).map((n) => (n.name === element
      ? { ...n, placement: { ...(n.placement || {}), area: element } } : n)),
  };
  return {
    ...document,
    views: (document.views || []).map((v) => (v === view
      ? { ...v, elements: v.elements.map((n) => (n === root ? placed : n)) } : v)),
  };
}

/* ── what a renderer needs ────────────────────────────────────────────────── */

/**
 * Reduce a workspace view to the thing `LayoutView' places its bands into.
 *
 * Returns the root's own style, each host with the style that puts it in its
 * area, and — when the tree could not be used — the default's arrangement
 * with `fellBack' saying why.  A renderer gets one shape whatever happened,
 * because a renderer that has to handle a missing workspace is a renderer
 * with two layouts in it, and the second one is never looked at again.
 */
export function arrangementOf(viewOrDocument, { page = "main" } = {}) {
  const v = viewOrDocument && viewOrDocument.views
    ? workspaceViewFor(viewOrDocument, page) : viewOrDocument;
  const checked = checkArrangement(v);
  if (!checked.ok) {
    const fallback = defaultWorkspaceView(page);
    return { ...layoutOf(fallback), ok: false, fellBack: checked.reason, view: fallback };
  }
  return { ...layoutOf(v), ok: true, fellBack: null, view: v };
}

/** Is this tree one the chrome can be rendered into? */
export function checkArrangement(v) {
  if (!v || !Array.isArray(v.elements) || !v.elements.length) {
    return { ok: false, reason: "the workspace has no elements" };
  }
  const hosts = new Set();
  for (const { node: n } of index(v.elements).values()) {
    if (n.kind === "host" && n.host) hosts.add(n.host);
  }
  const missing = REQUIRED_HOSTS.filter((h) => !hosts.has(h));
  if (missing.length) {
    return { ok: false, reason: `the workspace does not place ${missing.join(" or ")}` };
  }
  return { ok: true, reason: null, hosts: [...hosts] };
}

/** The root's grid and each host's area, as inline style strings. */
function layoutOf(v) {
  const roots = v.elements || [];
  const root = roots.length === 1 ? roots[0] : null;
  const bands = [];
  for (const { node: n } of index(roots).values()) {
    if (n.kind !== "host" || !n.host) continue;
    bands.push({ name: n.name, host: n.host, area: n.placement?.area || null,
                 style: placementStyle(n), immutable: Boolean(n.immutable) });
  }
  return { root: root ? root.name : null, rootStyle: root ? gridStyle(root) : "", bands };
}

/**
 * A grid, written out.
 *
 * `styleFor' in `tree.js' does this for an element the reconciler builds; the
 * chrome is written as a markup string by `LayoutView' rather than built, so
 * the two have to agree.  They are kept separate rather than shared because
 * the chrome's root also needs a height that no element tree would carry.
 */
export function gridStyle(n) {
  const parts = ["display:grid"];
  if (n?.layout?.columns) parts.push(`grid-template-columns:${n.layout.columns}`);
  if (n?.layout?.rows) parts.push(`grid-template-rows:${n.layout.rows}`);
  if (n?.layout?.areas) {
    parts.push(`grid-template-areas:${n.layout.areas.map((r) => `'${r}'`).join(" ")}`);
  }
  if (n?.layout?.gap != null && Number.isFinite(n.layout.gap)) parts.push(`gap:${n.layout.gap}px`);
  if (n?.style) parts.push(String(n.style).replace(/;\s*$/, ""));
  return parts.join(";");
}

/** Where one band sits in its parent's grid. */
export function placementStyle(n) {
  const parts = [];
  if (n?.placement?.area) parts.push(`grid-area:${n.placement.area}`);
  else {
    if (n?.placement?.column) parts.push(`grid-column:${n.placement.column}`);
    if (n?.placement?.row) parts.push(`grid-row:${n.placement.row}`);
  }
  if (n?.style) parts.push(String(n.style).replace(/;\s*$/, ""));
  return parts.join(";");
}

/* ── the store ────────────────────────────────────────────────────────────── */

/**
 * Should this request read the account's workspace at all?
 *
 * `?workspace=default' is the restore route: it renders the build's own
 * arrangement without reading the saved one, and it is deliberately a query
 * parameter rather than a setting — a setting lives in the thing that may be
 * broken, and a URL can be typed into a browser that has shown nothing.
 */
export function restoreRequested(search) {
  if (!search) return false;
  const q = typeof search === "string" ? search : String(search || "");
  try {
    const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
    return params.get("workspace") === "default";
  } catch { return /(^|[?&])workspace=default(&|$)/.test(q); }
}

/**
 * The workspace this account should be shown.
 *
 * Every failure answers with the default and a reason rather than with an
 * error: there is no useful state in which the interface declines to draw
 * itself, and a missing workspace on a fresh account is the ordinary case
 * rather than a fault.
 */
export async function loadWorkspace({
  host, account, token, page = "main", restore = false, fetchImpl,
} = {}) {
  if (restore) {
    return { ok: true, source: "default", document: defaultWorkspace({ page }),
             why: "restored: the account's own workspace was not read" };
  }
  if (!host || !account) {
    return { ok: true, source: "default", document: defaultWorkspace({ page }),
             why: "no account is signed in" };
  }
  let read;
  try {
    // `reader' said outright, although it is the default: the workspace is
    // always the signed-in account's own, and saying so is what stops a
    // later change here from quietly becoming an unscreened read (U-74).
    read = await readPresentation({ host, account, token, name: WORKSPACE_NAME,
                                    reader: account, fetchImpl });
  } catch (e) {
    return { ok: true, source: "default", document: defaultWorkspace({ page }),
             why: `the workspace could not be read: ${String(e)}` };
  }
  if (!read.ok || !read.document) {
    return { ok: true, source: "default", document: defaultWorkspace({ page }),
             why: (read.errors || [])[0] || "there is no saved workspace" };
  }
  if (!workspaceViewFor(read.document, page)) {
    // A workspace that has been arranged for other pages but not this one:
    // the default view is added rather than the whole document refused, so
    // one unvisited page does not discard the arrangement of the others.
    return { ok: true, source: "account", why: `no arrangement for \`${page}' yet`,
             document: { ...read.document, views: [...read.document.views, defaultWorkspaceView(page)] },
             meta: read.meta };
  }
  return { ok: true, source: "account", document: read.document, meta: read.meta, why: null };
}

/** Write the chrome back.  One presentation, scope `workspace'. */
export async function saveWorkspace({
  host, account, token, document, creator = null, created = null, fetchImpl, now,
} = {}) {
  return writePresentation({
    host, account, token, name: WORKSPACE_NAME, document,
    scope: WORKSPACE_SCOPE, creator, created, fetchImpl, now,
  });
}

export default defaultWorkspace;
