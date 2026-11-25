/**
 * The parts of the interface's own pages, as things that can be addressed
 * (U-115; D-AS, §9).
 *
 * U-72 made the chrome's ARRANGEMENT addressable: six bands, each a
 * `ui:Host' naming a view the build already draws, and the grid they sit in
 * is what a patch rewrites.  It stopped at the band.  `content' is one host,
 * the whole of what a routed page draws is inside it, and a host has no
 * nameable interior (D-AS) — so the account's properties, the repository's
 * properties, the view list and the open views were, between them, a single
 * addressable thing called `content'.  Nothing could be put beside anything
 * else.
 *
 * D-AS said what the next step was: "Individual views can be converted from
 * `ui:Host' to element trees afterwards, one at a time, with nothing else
 * changing."  This module is the cheaper half of that, and it is the half
 * that answers the question actually asked.  The panes are NOT converted to
 * element trees — their markup is written by the same six thousand lines of
 * template as before, and their handlers still find what they query for.
 * What changes is that each pane emits its parts as NAMED REGIONS inside one
 * grid, and the arrangement of that grid is an element tree held beside the
 * chrome's own in `<account>/ui'.
 *
 * Three consequences worth stating, because each is a limit as much as a
 * capability:
 *
 *   1. **A region is addressed by KIND, not by instance.**  The host value
 *      is `repository:views', never `repository:dflexlib:views'.  One
 *      arrangement serves every repository pane, which is what "rearrange
 *      the interface" means; an arrangement per repository would be a
 *      preference store with a presentation's name on it.
 *
 *   2. **A region is still opaque.**  It is a `host', so `lift' refuses it
 *      the way it refuses `content' (D-AS, `anchors.js').  Its interior is
 *      live state — editors, fetched metadata, a results table — and there
 *      is no definition of it to carry anywhere.  Rearranging is what it is
 *      for.
 *
 *   3. **The pane is the boundary.**  Regions of one pane can be put in any
 *      relation to each other, because they are items of one grid.  A region
 *      of the account pane cannot be put beside a region of the repository
 *      pane: those are two panes, only one of which is on the screen, and
 *      moving a node between them would take it away from the handlers that
 *      were bound over it.  That is not a limit of this model but of the
 *      panes, and it is where the conversion D-AS describes would have to
 *      begin.
 *
 * The grid is rewritten exactly as the chrome's is: `set-layout' on the
 * container, `set-placement' on a region, and the required ones are
 * `ui:immutable' so U-66 refuses a patch that would drop them before it is
 * applied.
 */

import { node, view, index } from "./tree.js";
import { gridStyle, placementStyle } from "./workspace.js";

/**
 * The regions each kind of pane declares.
 *
 * `required' marks the ones without which the pane is not the pane any more
 * — the view list and the editors of a repository, the repository list of an
 * account, the editor of a view.  Those are emitted `immutable', so they can
 * be moved anywhere and cannot be removed or left out of the template.  The
 * metadata regions are deliberately NOT required: hiding the properties
 * column is a reasonable thing to ask for and the build should not argue.
 *
 * `what' is the sentence a reader gets from the region's own tooltip and the
 * model gets in its contract.  One text, two readers, so they cannot drift.
 */
export const REGIONS = Object.freeze({
  account: Object.freeze([
    Object.freeze({ region: "metadata", title: "Account properties", required: false,
                    what: "the account's own properties, and the panels that edit them" }),
    Object.freeze({ region: "repositories", title: "Repositories", required: true,
                    what: "the account's repositories, as a list" }),
  ]),
  repository: Object.freeze([
    Object.freeze({ region: "metadata", title: "Repository properties", required: false,
                    what: "the repository's properties, its prefixes, its collaborators and its logs" }),
    Object.freeze({ region: "summary", title: "Summary", required: false,
                    what: "the repository's summary and readme" }),
    Object.freeze({ region: "views", title: "Views", required: true,
                    what: "the view list, from which a view is opened" }),
    Object.freeze({ region: "editors", title: "Editors", required: true,
                    what: "the open views — their text, their results, and any pane mounted beside them" }),
  ]),
  view: Object.freeze([
    Object.freeze({ region: "editor", title: "View", required: true,
                    what: "one view: its text and its results" }),
  ]),
  results: Object.freeze([
    Object.freeze({ region: "readings", title: "Readings", required: true,
                    what: "results sent here from a view's own result tab, each as it was "
                        + "read and saying when" }),
    Object.freeze({ region: "presentations", title: "Presentations", required: false,
                    what: "presentations moved here — each by reference, drawn when it is "
                        + "opened, at whatever width it was composed for" }),
  ]),
});

/** The kinds of pane that declare regions at all. */
export const REGION_KINDS = Object.freeze(Object.keys(REGIONS));

/** The default grid for each kind, as the build ships it. */
const DEFAULT_LAYOUT = Object.freeze({
  // Today's account pane is a reversed flex row: properties on the left,
  // repositories taking the rest.  Written as a grid so that swapping the
  // columns is one rewrite of `areas' and touches no region (D-AK).
  account: Object.freeze({
    columns: "auto minmax(300px, 1fr)", rows: "minmax(0, 1fr)", gap: 16,
    areas: ["metadata repositories"],
  }),
  // And today's repository pane: properties on the left, the summary across
  // the working surface, and the two lists that are the surface itself side
  // by side beneath it.  `auto' rather than `260px' for the properties
  // column because the sidebar sets its own width and padding and the cell
  // should not argue with it.
  //
  // There is no results region here, and U-120 is the correction that took
  // it out.  A repository's own results belong to the view that was run, in
  // that view's result tabs, where they already were; a result KEPT is kept
  // somewhere else, and somewhere else is a pane of its own, because what is
  // kept there did not all come from one repository.
  repository: Object.freeze({
    columns: "auto 300px minmax(300px, 1fr)", rows: "auto minmax(0, 1fr)", gap: 12,
    areas: ["metadata summary summary",
            "metadata views   editors"],
  }),
  view: Object.freeze({
    columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)", gap: 0, areas: ["editor"],
  }),
  // The results pane (U-120).  One column and the whole width of the window,
  // because both of the things kept here are as wide as they were composed
  // to be: a reading is as wide as its widest row, and a presentation moved
  // here was arranged for a window and not for a margin.  The readings take
  // the height they need and the presentations take the rest.
  results: Object.freeze({
    columns: "minmax(0, 1fr)", rows: "auto minmax(0, 1fr)", gap: 16,
    areas: ["readings", "presentations"],
  }),
});

/** The host value one region answers to.  Kind first, so a sort groups them. */
export const regionHost = (kind, region) => `${kind}:${region}`;

/** The element anchor one region answers to. */
export const regionElement = (kind, region) => `r-${kind}-${region}`;

/** The container the regions of one kind of pane sit in. */
export const regionRoot = (kind) => `r-${kind}-pane`;

/** The view of the workspace that holds one kind of pane's arrangement. */
export const regionViewName = (kind) => `${kind}-pane`;

/** `repository:views' → {kind, region}, and null for anything else. */
export function parseRegionHost(host) {
  const m = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/i.exec(String(host || ""));
  if (!m) return null;
  const kind = m[1];
  const declared = REGIONS[kind];
  if (!declared) return null;
  const found = declared.find((r) => r.region === m[2]);
  return found ? { kind, region: m[2], declared: found } : null;
}

/** What one kind declares, or an empty list for a kind that declares nothing. */
export const regionsOf = (kind) => REGIONS[String(kind || "")] || [];

/** The regions of one kind that a patch may not drop. */
export const requiredRegions = (kind) =>
  regionsOf(kind).filter((r) => r.required).map((r) => r.region);

/**
 * The arrangement of one kind of pane, as the build ships it.
 *
 * One root holding one `host' element per region, placed by area.  The same
 * shape as `defaultWorkspaceView' and for the same reason: the thing that
 * renders it should not be able to tell whether it came from the build or
 * from the account's store.
 */
export function defaultRegionView(kind) {
  const declared = regionsOf(kind);
  if (!declared.length) return null;
  const layout = DEFAULT_LAYOUT[kind] || null;
  return view({
    name: regionViewName(kind),
    title: `The arrangement of a ${kind} pane`,
    elements: [node({
      name: regionRoot(kind),
      kind: "div",
      order: "a",
      immutable: true,
      layout: layout ? { ...layout, areas: [...layout.areas] } : null,
      children: declared.map((r, i) => node({
        name: regionElement(kind, r.region),
        kind: "host",
        host: regionHost(kind, r.region),
        order: String.fromCharCode(97 + i),
        placement: { area: r.region },
        immutable: Boolean(r.required),
      })),
    })],
  });
}

/** Every pane arrangement the build ships, in kind order. */
export const defaultRegionViews = () => REGION_KINDS.map((k) => defaultRegionView(k)).filter(Boolean);

/**
 * The workspace document with a view for every kind of pane.
 *
 * Called by whoever has just read the workspace, rather than by the reader
 * itself, so that `workspace.js' knows nothing about regions and the
 * dependency runs one way.  A kind the stored document already arranges is
 * left exactly as it is, including an arrangement that this build would now
 * refuse: `regionArrangementOf' is where that is decided, and it answers
 * with the default and a reason rather than with a rewrite nobody asked for.
 */
export function ensureRegionViews(document) {
  if (!document) return document;
  const views = [...(document.views || [])];
  let added = 0;
  for (const kind of REGION_KINDS) {
    const name = regionViewName(kind);
    if (views.some((v) => v && v.name === name)) continue;
    const made = defaultRegionView(kind);
    if (made) { views.push(made); added += 1; }
  }
  return added ? { ...document, views } : document;
}

/* ── what a renderer needs ────────────────────────────────────────────────── */

/**
 * Is this tree one a pane of this kind can be drawn into?
 *
 * The chrome's own check asks for `content' and `location' because without
 * them the interface cannot be used or repaired (D-AU).  A pane's check asks
 * for the regions marked required, and for nothing else: a pane that has
 * lost its properties column is a pane someone arranged that way.
 */
export function checkRegionArrangement(v, kind) {
  const wanted = requiredRegions(kind);
  if (!v || !Array.isArray(v.elements) || !v.elements.length) {
    return { ok: false, reason: `there is no arrangement for a ${kind} pane` };
  }
  const have = new Set();
  for (const { node: n } of index(v.elements).values()) {
    if (n.kind === "host" && n.host) {
      const parsed = parseRegionHost(n.host);
      if (parsed && parsed.kind === kind) have.add(parsed.region);
    }
  }
  const missing = wanted.filter((r) => !have.has(r));
  if (missing.length) {
    return { ok: false, reason: `the arrangement does not place ${missing.join(" or ")}` };
  }
  return { ok: true, reason: null, regions: [...have] };
}

/**
 * Reduce a workspace document to what one kind of pane's renderer places
 * its regions into.
 *
 * Returns the container's own style, each region with the style that puts it
 * in its area, and — when the stored tree could not be used — the build's
 * arrangement with `fellBack' saying why.  Deliberately the same shape and
 * the same fallback discipline as `arrangementOf': a renderer that has to
 * handle a missing arrangement is a renderer with two layouts in it.
 */
export function regionArrangementOf(documentOrView, { kind } = {}) {
  const k = String(kind || "");
  const v = documentOrView && documentOrView.views
    ? (documentOrView.views || []).find((x) => x && x.name === regionViewName(k)) || null
    : documentOrView;
  const checked = checkRegionArrangement(v, k);
  if (!checked.ok) {
    const fallback = defaultRegionView(k);
    if (!fallback) return { kind: k, root: null, rootStyle: "", regions: [], ok: false,
                            fellBack: `\`${k}' declares no regions`, view: null };
    return { ...regionLayoutOf(fallback, k), kind: k, ok: false,
             fellBack: checked.reason, view: fallback };
  }
  return { ...regionLayoutOf(v, k), kind: k, ok: true, fellBack: null, view: v };
}

/** The container's grid and each region's area, as inline style strings. */
export function regionLayoutOf(v, kind) {
  const roots = v?.elements || [];
  const root = roots.length === 1 ? roots[0] : null;
  const regions = [];
  for (const { node: n } of index(roots).values()) {
    if (n.kind !== "host" || !n.host) continue;
    const parsed = parseRegionHost(n.host);
    regions.push({
      name: n.name,
      host: n.host,
      kind: parsed ? parsed.kind : null,
      region: parsed ? parsed.region : null,
      what: parsed ? parsed.declared.what : null,
      area: n.placement?.area || null,
      style: placementStyle(n),
      immutable: Boolean(n.immutable),
    });
  }
  return { root: root ? root.name : null, rootStyle: root ? gridStyle(root) : "",
           regions, kind: String(kind || "") };
}

/* ── the markup ───────────────────────────────────────────────────────────── */

/** The class on the container, and on each region.  Styled, and queried. */
export const REGIONS_CLASS = "ui-regions";
export const REGION_CLASS = "ui-region";
/** The attribute a region carries its host value in. */
export const REGION_ATTRIBUTE = "data-region";

const escapeAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The tooltip a region carries.
 *
 * Every addressable thing says its own name at any moment, which is the
 * amendment REQ-35.8.1 took when the composite tables turned out to have no
 * caption to read a name from.  A region's name is the anchor, because the
 * anchor is what the four verbs take; what it IS comes second, in the words
 * the model is given for the same region, so the two cannot drift.
 */
export function regionTip({ name, host, what }) {
  const parsed = parseRegionHost(host);
  const said = what || parsed?.declared?.what || null;
  return `${name}  ·  ${host}${said ? ` — ${said}` : ""}`
       + `\nA part of the interface itself: it can be rearranged by an instruction`
       + ` to the workspace, and it cannot be lifted.`;
}

/**
 * One kind of pane's regions, placed.
 *
 * `parts' maps a region name to the markup the page built for it.  The rules
 * are the chrome's, said again because a reader who has learned one should
 * not have to learn the other:
 *
 *   * a region the arrangement places and the page did not build renders as
 *     an inert box with the reason on it — visible, not silent;
 *   * a region the page built and the arrangement does not place is emitted
 *     at the end without an area, so a pane arranged before a region existed
 *     does not silently lose it;
 *   * a region named twice is emitted once, the first placement winning.
 */
export function regionMarkup({ kind, arrangement = null, parts = {}, tips = true } = {}) {
  const k = String(kind || "");
  const placement = arrangement && arrangement.kind === k
    ? arrangement : regionArrangementOf(null, { kind: k });
  const seen = new Set();
  const out = [];
  for (const r of placement.regions || []) {
    if (r.kind && r.kind !== k) continue;
    const region = r.region || r.name;
    if (seen.has(region)) continue;
    seen.add(region);
    const built = Object.prototype.hasOwnProperty.call(parts, region) ? parts[region] : null;
    const inner = built == null
      ? `<div class="location-inert" data-inert="the interface draws nothing as `
        + `\`${escapeAttr(r.host)}'"></div>`
      : built;
    out.push(regionBox({ r, region, inner, tips }));
  }
  for (const [region, built] of Object.entries(parts)) {
    if (seen.has(region) || built == null) continue;
    const declared = regionsOf(k).find((d) => d.region === region) || null;
    out.push(regionBox({
      r: { name: regionElement(k, region), host: regionHost(k, region),
           what: declared?.what || null, style: "", unplaced: true },
      region, inner: built, tips,
    }));
  }
  return `<div class="${REGIONS_CLASS}" data-ui="${escapeAttr(placement.root || regionRoot(k))}"`
       + ` data-regions="${escapeAttr(k)}" style="${escapeAttr(placement.rootStyle || "display:grid")}">`
       + out.join("") + `</div>`;
}

/** One region, wrapped.  Its interior is whatever the page wrote. */
function regionBox({ r, region, inner, tips }) {
  const title = tips ? regionTip({ name: r.name, host: r.host, what: r.what }) : null;
  return `<div class="${REGION_CLASS}" data-ui="${escapeAttr(r.name)}"`
       + ` ${REGION_ATTRIBUTE}="${escapeAttr(r.host)}" data-host="${escapeAttr(r.host)}"`
       + ` data-region-name="${escapeAttr(region)}"`
       + (r.unplaced ? ` data-unplaced=""` : "")
       + (r.immutable ? ` data-immutable=""` : "")
       + (r.style ? ` style="${escapeAttr(r.style)}"` : "")
       + (title ? ` title="${escapeAttr(title)}" data-ui-tip=""` : "")
       + `>${inner}</div>`;
}

export default regionMarkup;
