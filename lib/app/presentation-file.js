/**
 * A presentation, as a file somebody can keep (U-122).
 *
 * The results pane holds a presentation BY REFERENCE: a name and a press,
 * nothing written, nothing run, and gone on a reload (U-120, §21.4.3).  That
 * is the right thing for a station, and it is not a thing a reader can send
 * to anyone.  A download is the other half — the presentation as one file,
 * away from this interface and away from this account.
 *
 * **It is the same file a composed page downloads to, and deliberately.**
 * U-111 already settled what a saved page is: two documents, the file and a
 * sandboxed frame; the data inlined so it draws with no network; the panels'
 * own queries inlined so the reader can ask again; and the credential typed
 * in by whoever opens it, held in a closure for as long as the tab is open
 * and written nowhere.  A presentation that downloaded to some second kind
 * of artifact would be a second set of answers to all of those questions,
 * and the questions are not different.  So this builds a `spec' and hands it
 * to `buildSavedPage', which is the dashboard's own builder.
 *
 * The one real difference is the DATA, and it is the honest one: a
 * presentation held by reference has not been run, so there is none.  The
 * file therefore opens empty with its Refresh offered, rather than opening
 * with somebody else's rows in it — which is what "runnable in the same way
 * as the compositions are" has to mean for a document that was never run
 * here.  `Run` fills it under the reader's own credentials, against the
 * addresses the panels themselves carry.
 *
 * Nothing here touches the DOM or the network.  The reading is the caller's
 * (it is `readPresentation', the same call the press makes) and so is the
 * saving; what is here is the conversion, which is where the judgement is
 * and which is therefore the part worth being able to test in node.
 */

import { htmlFromTree } from "./tree.js";
import { COMPONENTS } from "./toolbox/index.js";
import { buildSavedPage } from "../dashboard/frame.js";

/**
 * A presentation's views, as the markup a saved page is made of.
 *
 * `htmlFromTree' is not a convenience here, it is the bridge the tree model
 * was written with: "a view's markup, which is what `views[].html' becomes".
 * An element carries `data-bound', `data-derived' and `data-asserted' into
 * the markup, which is exactly what the saved page's own runtime fills — so
 * the file's parts are filled by the mechanism that fills a composed page's,
 * not by a copy of it.
 *
 * A `host' element has no view registered in a file and is built inert and
 * marked with the reason, which is what it is: the chrome's bands belong to
 * the interface, and a mount inside a presentation is another presentation
 * that this file does not contain.
 */
export function specOfPresentation(presentation, { components = COMPONENTS } = {}) {
  const d = presentation || {};
  const views = (d.views || []).map((v) => ({
    name: v.name,
    title: v.title ?? null,
    html: htmlFromTree(v.elements || [], { components }),
  }));
  return {
    title: d.title || d.id || "",
    uses: d.uses || [],
    parameters: d.parameters || [],
    panels: d.panels || [],
    transforms: d.transforms || [],
    assertions: d.assertions || [],
    views,
    styles: d.styles || "",
    script: d.script || "",
    state: d.state || {},
    notes: d.notes ?? null,
  };
}

/**
 * Where a copy of this presentation would run its queries.
 *
 * A panel's own `ui:source' is the authority (U-84): it is written when the
 * panel is recorded and it is what a re-run has always used.  The page-level
 * address is the fallback for panels that carry none, which read "where the
 * page runs" — and in a file there is no page running anywhere, so the one
 * taken from the panels stands in.
 *
 * Null when nothing says.  That is reported rather than guessed: a file whose
 * Refresh is offered and then refuses, having been given an address nobody
 * wrote down, is worse than a file that says up front what it cannot do.
 */
export function sourceOfPresentation(presentation, fallback = null) {
  const whole = (s) => Boolean(s && s.host && s.account && s.repository);
  for (const p of presentation?.panels || []) {
    if (whole(p?.source)) return { ...p.source };
  }
  return whole(fallback) ? { ...fallback } : null;
}

/** A name for the file, out of the presentation's own name. */
export function fileNameFor(name) {
  const base = String(name || "presentation").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "presentation"}.html`;
}

/**
 * The file, and what to say about it.
 *
 * The sentence is not a flourish.  Two things about this copy are invisible
 * from looking at it and both matter to whoever is about to send it on: that
 * it holds no data yet, and whether it holds an address it can ask at.  A
 * download that said only "saved" would leave both to be discovered by the
 * person it was sent to.
 */
export function presentationFile(presentation, { name, components = COMPONENTS,
                                                 fallback = null, at = null } = {}) {
  const spec = specOfPresentation(presentation, { components });
  if (!spec.views.length || !spec.views.some((v) => v.html.trim())) {
    return { ok: false, error: `\`${name}' has nothing to draw, so there is nothing to save` };
  }
  const source = sourceOfPresentation(presentation, fallback);
  const html = buildSavedPage(spec, { results: {}, source, components, at });
  const panels = spec.panels.length;
  const message = source
    ? `\`${name}' saved as a page. It holds no data — nothing has run — and `
    + `${panels === 1 ? "its query runs" : `its ${panels} queries run`} against `
    + `${source.account}/${source.repository} when you press Refresh in it, under a `
    + `credential you type into the file. The file never holds one.`
    : `\`${name}' saved as a page. It draws, but it records no address to run `
    + `${panels === 1 ? "its query" : "its queries"} against — no panel says where it `
    + `ran — so its Refresh will say so rather than ask for a credential.`;
  return { ok: true, html, name: fileNameFor(name), source, panels, message };
}

export default presentationFile;
