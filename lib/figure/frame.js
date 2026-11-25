/**
 * The frame a model-authored figure is shown in.  D-M; work item U-15.
 *
 * A dashboard needs script (`lib/dashboard/frame.js'): it has tabs, a
 * refresh, and data that arrives after it is mounted.  A figure needs none of
 * that.  It is a picture, and a picture does not have to run in order to be
 * looked at.  So this frame takes the stronger of the two settings:
 *
 *      sandbox=""        every restriction, scripts included
 *
 * which is worth being explicit about, because model-authored SVG is active
 * content in a way that surprises people.  `<script>' inside an `<svg>' runs
 * when the SVG is inlined into a page.  So does `onload=' on any element,
 * `<animate>' driving an attribute, `<image href="…">' fetching from a host of
 * the author's choosing, and `xlink:href="javascript:…"'.  The pane that would
 * inline it runs on the same origin as the session token.
 *
 * The alternative to a sandbox is a sanitiser, and D-M's argument against one
 * is that it is a standing liability: every feature the format gains is a new
 * way for a hand-written allowlist to be wrong, and the list is only ever
 * audited after it has already been wrong once.  A frame with no script and
 * `default-src 'none'' is instead correct by construction, and stays correct
 * when the model starts producing things nobody anticipated -- which, since
 * the whole point of the exercise is rendering the service cannot do, it will.
 *
 * A figure that needs a program run over it -- a DOT graph, which has to be
 * laid out before it is anything to look at -- does not get one HERE.  The
 * layout happens first, in a frame that has script and no network and holds
 * no model-authored markup (`lib/wasm/engine-frame.js'), and what arrives
 * here is the SVG that came back, treated exactly as the model's own SVG is.
 * The rule the sandbox enforces is unchanged: the document that DISPLAYS
 * model content never runs anything.
 *
 * The saved copy keeps all of this and adds one thing (U-113).  It is two
 * documents, as the saved dashboard is: the figure, in this same frame under
 * this same empty sandbox, and around it a file that holds the query it was
 * drawn from and the digest of the document it was drawn from.  Pressing
 * Refresh there runs the query again under the reader's own credentials and
 * says whether the drawing is still of the data -- it never redraws, because
 * there is no model in a saved file and the provenance strip under the
 * picture is a statement about the picture that is there.  See
 * `./saved-runtime.js'.
 *
 * One consequence worth reading twice: with scripts off, NOTHING INSIDE THE
 * FRAME CAN MEASURE ITSELF.  The dashboard frame reports its height by
 * postMessage; this one cannot, and its document is cross-origin so the parent
 * cannot read it either.  The height therefore comes from the figure's own
 * `viewBox' ratio, computed out here before it is mounted.  That is not a
 * workaround: a figure that declares no viewBox cannot scale anyway, which is
 * why `figurePolicy' names its absence.
 */

import { contentDigest } from "../mcp/result-digest.js";
import { markSvg } from "./provenance-mark.js";
import { aspectOf } from "./spec.js";
import * as savedFigure from "./saved-runtime.js";

/* ── the policy ───────────────────────────────────────────────────────────── */

/** Every restriction.  The attribute is present and empty, which is the point. */
export const FIGURE_SANDBOX = "";

export const FIGURE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 10px; background: #fff; color: #1a1d21;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
figure { margin: 0; }
svg { display: block; width: 100%; height: auto; max-width: 100%; }
details.fig-src { margin-top: 8px; }
details.fig-src > summary { cursor: pointer; font-size: 11px; color: #5a6672;
  padding: 2px 0; }
details.fig-src > pre.fig-dot { margin-top: 5px; }
pre.fig-dot { margin: 0; padding: 8px; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  line-height: 1.45; white-space: pre; overflow: auto; max-height: 70vh; }
figcaption { margin-top: 7px; font-size: 11.5px; line-height: 1.45; color: #3a4450; }
.fig-prov { margin-top: 7px; padding-top: 6px; border-top: 1px solid #edf0f3;
  font-size: 10.5px; line-height: 1.5; color: #8a94a0; }
.fig-note { margin-top: 7px; padding: 5px 7px; font-size: 11px; color: #8a5a1a;
  background: #fdf3e0; border: 1px solid #f0dcb8; border-radius: 3px; }
`;

/**
 * The provenance line, which the model does not write and cannot remove.
 *
 * D-N: a figure is never presented as the repository's own output.  The
 * statement goes in the artifact rather than only in the transcript for the
 * same reason as the dashboard's footer -- the artifact is the part that gets
 * saved, mailed and shown to someone who was not here -- and here it carries
 * the digest of the exact document the picture was drawn from, so a copy
 * found later can be matched against a re-run of the query.
 */
function provenance(meta) {
  const bits = [];
  bits.push("Drawn by a language model");
  if (meta.view) bits.push(`from the view <code>${esc(meta.view)}</code>`);
  else if (meta.query) bits.push("from one repository query");
  if (meta.rows != null) bits.push(`over ${meta.rows} row(s)`);
  const head = `${bits.join(" ")}.`;
  const digest = meta.resultDigest
    ? ` Result ${esc(meta.mimeType || "document")}, digest <code>${esc(meta.resultDigest)}</code>.` : "";
  const when = meta.at ? ` Rendered ${esc(meta.at)}.` : "";
  // The layout is not the model's work and is not claimed as it: a laid-out
  // graph is the model's STRUCTURE and graphviz's geometry, and a reader
  // comparing two drawings of the same graph needs to know which engine drew
  // each.  It says "in the browser" because that is the surprising part.
  const laid = meta.layout?.engine
    ? ` Laid out in the browser by graphviz${meta.layout.version ? ` ${esc(meta.layout.version)}` : ""}`
      + ` (<code>${esc(meta.layout.engine)}</code>), from the DOT source below.`
    : "";
  return `<div class="fig-prov">${head}${digest}${laid}${when} `
       + `The query was run by the interface, under the user's own credentials; `
       + `the picture is the model's rendering of what came back.</div>`;
}

/**
 * The whole document: a `srcdoc', and the same bytes as a saved file.
 *
 * There is no second FIGURE for download.  A dashboard has one, because its
 * live page is empty until the pane posts data in; a figure is already
 * self-contained, so what is previewed and what is saved are the same
 * document, which is one fewer thing that can differ between what a user
 * approved and what they then sent to someone.
 *
 * A download does wrap it (`buildSavedFigure', U-113): the saved file puts
 * this document in a frame and adds the query beside it, so the file can be
 * asked later whether the picture is still a picture of the data.  The
 * wrapper is chrome.  THIS document is unchanged by it, carried into the file
 * byte for byte as a `srcdoc' attribute -- which is also why a saved figure
 * still draws with JavaScript turned off, as it always did.
 *
 * A DOT figure that has been laid out carries BOTH: the drawing, and the
 * source it was laid out from, in a `<details>'.  The pane shows the two as
 * tabs, which it can because it has script; the saved file uses `<details>'
 * because it has none and must not need any.  Either way the source travels
 * with the picture -- a graph whose source is somewhere else is a graph
 * nobody can correct.
 */
export function buildFigurePage(figure, {
  caption = null, title = null, meta = {}, notes = [], at = null,
  drawing = null, layout = null, aiProvenance = null,
} = {}) {
  const kind = figure?.kind === "dot" ? "dot" : "svg";
  // §2.6.1 / U-48: the ledger is drawn INTO the picture, by the interface,
  // after the model's answer has come back.  Here, because this is the one
  // place both the mounted frame and the saved file are composed -- a figure
  // marked only on its way to the screen would travel unmarked, which is the
  // case Article 50(4) is actually about.  A DOT figure is marked on the SVG
  // graphviz returned, for the same reason: the model never writes the mark.
  // Named `aiProvenance' and not `provenance': this file already has a
  // `provenance()' that writes the D-S strip -- which route a figure took and
  // what it digests to -- and the two are different disclosures about
  // different things.  One says the interface fetched this; the other says a
  // model drew it.
  const marked = (text) => {
    if (!aiProvenance) return String(text || "");
    const out = markSvg(String(text || ""), aiProvenance);
    return out.ok ? out.svg : String(text || "");
  };
  const source = kind === "svg" ? marked(figure?.text) : String(figure?.text || "");
  const drawn = kind === "dot" && drawing ? marked(drawing) : null;
  const body = kind === "svg"
    ? source
    : drawn
      ? `${drawn}\n<details class="fig-src"><summary>DOT source</summary>`
        + `<pre class="fig-dot">${esc(source)}</pre></details>`
      : `<pre class="fig-dot">${esc(source)}</pre>`;
  const cap = caption || figure?.caption || null;
  const note = kind === "dot" && !drawn
    ? [layout?.error
        ? `This DOT did not lay out: ${layout.error}. The source is shown as written.`
        : "This is a DOT graph description, shown as its source because it has not "
        + "been laid out. Save it and run it through graphviz to see the drawing.",
       ...notes]
    : notes;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(FIGURE_CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || cap || "Figure")}</title>
<style>${STYLE}</style>
</head>
<body>
<figure>
${body}
${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}
</figure>
${note.map((n) => `<div class="fig-note">${esc(n)}</div>`).join("\n")}
${provenance({ ...meta, layout: drawn ? layout : null, at: at || new Date().toISOString() })}
</body>
</html>`;
}

/* ── the saved copy, which can check itself (U-113) ───────────────────────── */

/**
 * The chrome of the saved file.  The file's, not the figure's.
 *
 * Deliberately unlike `STYLE': what is inside the frame is the figure, and
 * what is out here is the interface's own furniture, so a reader can tell at
 * a glance which of the two they are looking at -- the same distinction the
 * saved dashboard draws, and for the same reason.
 */
const SAVED_FIGURE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 10px; background: #f6f7f9; color: #1a1d21;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.saved-bar { background: #fff; border: 1px solid #e2e6ea; border-radius: 4px;
  padding: 7px 10px; margin-bottom: 8px; }
.saved-status { color: #5b6672; margin-right: 10px; }
.saved-actions button { font: inherit; font-size: 12px; margin-right: 6px;
  padding: 2px 8px; border: 1px solid #c8cfd6; border-radius: 3px; background: #fbfcfd;
  cursor: pointer; }
.saved-form { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.saved-form[hidden] { display: none; }
.saved-form label { display: block; font-size: 11px; color: #5b6672; }
.saved-form input { display: block; font: inherit; font-size: 12px; padding: 2px 5px;
  border: 1px solid #c8cfd6; border-radius: 3px; min-width: 150px; }
.saved-form button { font: inherit; font-size: 12px; padding: 3px 9px;
  border: 1px solid #c8cfd6; border-radius: 3px; background: #fbfcfd; cursor: pointer; }
.saved-note { flex-basis: 100%; margin: 0 0 5px; font-size: 11px; color: #8a94a0; }
.saved-log { margin-top: 7px; font-size: 11.5px; color: #5b6672;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.saved-log[hidden] { display: none; }
.saved-err { color: #8a2b2b; }
.saved-mark { background: #fdf3e0; border: 1px solid #f0dcb8; border-radius: 4px;
  padding: 7px 10px; margin-bottom: 8px; font-size: 12px; line-height: 1.5; color: #7a5a1a; }
.saved-mark[hidden] { display: none; }
.saved-frame { width: 100%; border: 1px solid #e2e6ea; border-radius: 4px;
  background: #fff; display: block; min-height: 160px; }
.saved-after { margin-top: 8px; }
.saved-after:empty { display: none; }
.saved-table { border-collapse: collapse; background: #fff; font-size: 11.5px;
  width: 100%; border: 1px solid #e2e6ea; }
.saved-table th, .saved-table td { border: 1px solid #eef1f4; padding: 2px 6px;
  text-align: left; vertical-align: top; }
.saved-table th { background: #fbfcfd; font-weight: 600; color: #3a4450; }
.saved-source { margin-top: 8px; font-size: 11.5px; color: #5b6672; }
.saved-source > summary { cursor: pointer; }
.saved-source pre { margin: 5px 0 0; padding: 7px 9px; background: #fff;
  border: 1px solid #e2e6ea; border-radius: 3px; font-family: ui-monospace, Menlo, monospace;
  font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
`;

/** One address as an origin, or null when it is not one this can name. */
function originOf(host) {
  const text = String(host || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    return u.origin === "null" ? null : u.origin;
  } catch { return null; }
}

/**
 * The policy the saved FILE runs under.
 *
 * It is not the figure's policy.  The figure keeps `FIGURE_CSP', declared in
 * its own document, and a srcdoc frame is enforced under the INTERSECTION of
 * the two -- so `connect-src' opening out here cannot open it in there, where
 * the model's drawing is.  There is no `unsafe-eval' and no `frame-src' for
 * anything but this file's own srcdoc, because nothing at this level compiles
 * anything or loads anything.
 */
export function savedFigurePolicy(origin = null) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "script-src 'unsafe-inline'",
    "frame-src 'self'",
    `connect-src ${origin || "'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Whether this tree can build a figure that checks itself. */
export function savedFigureIsRefreshable() {
  return (savedFigure.missingFigureSource?.() || []).length === 0;
}

/** The one line a copy that cannot check itself carries about why. */
export const NO_CHECK = "dydra-figure: no check";

/** What a built figure says about itself, or null when it is the full one. */
export function savedFigureTrouble(html) {
  const m = new RegExp(`<!-- ${NO_CHECK}: ([\\s\\S]*?) -->`).exec(String(html || ""));
  return m ? m[1] : null;
}

/** An attribute value: the two characters that can end one, and the ampersand. */
const attr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * The figure as a file that can say whether it is still true (U-113).
 *
 * `page' is the figure document, unchanged -- the same bytes the pane has on
 * the screen, carried here as a `srcdoc' ATTRIBUTE rather than written by a
 * script.  That is the part worth being careful about: it means this file
 * still draws with JavaScript turned off, exactly as the one-document copy
 * always did.  Everything the script adds is the check, and the check is the
 * only thing that was ever going to need one.
 *
 * Without a query or an address there is nothing to check against, so the
 * plain document is returned as it stands.  A figure nobody can re-run is
 * still a figure; it is the silent version of that that this feature exists
 * to stop.
 */
export function buildSavedFigure({
  page, title = null, query = null, accept = null, mimeType = null,
  digest = null, rows = null, source = null, at = null, aspect = null,
} = {}) {
  const document_ = String(page || "");
  const origin = originOf(source?.host);
  if (!query || !origin || !source?.account || !source?.repository) return document_;

  let runtime;
  try { runtime = savedFigure.savedFigureRuntime(); }
  catch (e) {
    /* Why, and not just that: a copy without its check looks exactly like one
       with it, so the reason travels in the file and the gate says it aloud. */
    const why = String(e?.message || e).replace(/-->/g, "-- >");
    savedFigure.repairMissingSource?.();
    return document_.replace(/^<!doctype html>/i, `<!doctype html>\n<!-- ${NO_CHECK}: ${why} -->`);
  }

  const stamp = at || new Date().toISOString();
  const payload = JSON.stringify({
    query, accept: accept || mimeType || null, mimeType, digest, rows,
    source: { host: String(source.host).replace(/\/$/, ""),
              account: source.account, repository: source.repository },
    at: stamp, aspect: aspect && aspect > 0 ? aspect : null,
  }).replace(/</g, "\\u003c");

  /* A box of about the right shape for a reader with no script, refined to
     the pixel by the runtime when there is one.  The ratio is the figure's
     own viewBox; a DOT graph still shown as its source has none, and gets a
     fixed box it scrolls inside. */
  const box = aspect && aspect > 0
    ? `aspect-ratio: ${Number(aspect).toFixed(4)} / 1;`
    : "height: 420px;";
  const name = title || "Figure";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(savedFigurePolicy(origin))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>${SAVED_FIGURE_STYLE}</style>
</head>
<body>
<div class="saved-bar" id="saved-figure-bar"></div>
<div class="saved-mark" id="saved-figure-mark" hidden></div>
<iframe id="saved-figure-frame" class="saved-frame" style="${box}"
 sandbox="${attr(FIGURE_SANDBOX)}" referrerpolicy="no-referrer"
 title="${esc(name)}" srcdoc="${attr(document_)}"></iframe>
<div class="saved-after" id="saved-figure-after"></div>
<details class="saved-source">
<summary>the query this was drawn from</summary>
<pre>${esc(query)}</pre>
</details>
<script type="application/json" id="saved-figure-data">${payload}</script>
<script>${runtime}</script>
</body>
</html>`;
}

/* ── mounting ─────────────────────────────────────────────────────────────── */

/** The tab strip, which lives out here because the frame has no script. */
const PANE_STYLE = `
.fig-mount { display: block; }
.fig-mount .fig-tabs { display: flex; gap: 2px; margin: 0 0 -1px; }
.fig-mount .fig-tabs button { font: inherit; font-size: 11px; padding: 3px 10px;
  border: 1px solid #e2e6ea; border-bottom-color: transparent; background: #f6f8fa;
  color: #5a6672; border-radius: 3px 3px 0 0; cursor: pointer; }
.fig-mount .fig-tabs button[aria-selected="true"] { background: #fff; color: #1a1d21;
  border-bottom-color: #fff; }
.fig-mount .fig-tabs .fig-tab-note { margin-left: auto; align-self: center;
  font-size: 10.5px; color: #8a94a0; }
.fig-mount .fig-tabs .fig-tab-engine { align-self: center; font-size: 10.5px;
  margin-left: 5px; border: 1px solid #e2e6ea; border-radius: 3px; background: #fff;
  color: #5a6672; padding: 1px 2px; }
.fig-mount pre.fig-source { margin: 0; padding: 8px; background: #fbfcfd;
  border: 1px solid #e2e6ea; border-radius: 0 4px 4px 4px; font-family: ui-monospace, Menlo, monospace;
  font-size: 11px; line-height: 1.45; white-space: pre; overflow: auto; max-height: 420px; }
`;

function ensurePaneStyle(d) {
  if (!d.head || d.getElementById("figure-frame-style")) return;
  const s = d.createElement("style");
  s.id = "figure-frame-style";
  s.textContent = PANE_STYLE;
  d.head.appendChild(s);
}

/**
 * Put a figure on the screen.
 *
 * Returns a handle rather than an element, to match `mountDashboard': the
 * caller owns the data, this owns the frame.  `page()' is what a download
 * writes and `digest()' is what the record stores, and both are the same
 * bytes that are on the screen.
 *
 * A DOT figure is laid out first (`lib/wasm/graphviz.js'), which is the one
 * asynchronous thing a mount does.  It is started here rather than by each
 * caller because "a graph is drawn, not transcribed" is a property of the
 * figure and not of the pane that happened to mount it -- the same argument
 * the session log makes for using this frame at all.  The engine module is
 * imported dynamically so that nothing which merely BUILDS a page pays for
 * it, and `layout: false' turns the whole thing off for a caller that wants
 * the source and nothing else.
 */
export function mountFigure(container, figure, {
  caption = null, title = null, meta = {}, notes = [], doc = null,
  minHeight = 160, maxHeight = 1200, at = null, source: ranAgainst = null,
  drawing = null, engine = null, layout = true, aiProvenance = null,
} = {}) {
  const d = doc || container.ownerDocument || document;
  const kind = figure?.kind === "dot" ? "dot" : "svg";
  ensurePaneStyle(d);

  /* One stamp for the mount, not one per draw.  The figure was drawn once;
     changing the layout engine asks graphviz the same question a second way
     and does not make it a newer picture.  It also has to be the same string
     in the document and in what the saved copy records about the document,
     or a reader comparing the two is comparing two different claims. */
  const stamp = at || new Date().toISOString();

  let drawn = kind === "dot" ? drawing || null : null;
  let layoutMeta = drawn ? { engine: engine || "dot", version: null } : null;
  let page = "";

  const mount = d.createElement("div");
  mount.className = "fig-mount";
  const tabs = d.createElement("div");
  tabs.className = "fig-tabs";
  const holder = d.createElement("div");
  const source = d.createElement("pre");
  source.className = "fig-source";
  source.dataset.testid = "figure-source";
  source.textContent = String(figure?.text || "");
  source.hidden = true;
  mount.append(tabs, holder, source);
  container.replaceChildren(mount);

  const frame = d.createElement("iframe");
  frame.className = "fig-frame";
  // Empty, not absent: an absent attribute is no sandbox at all, and the two
  // spellings look alike in a diff.  Scripts are not enabled here and must
  // never be -- a figure that needs to run is a dashboard (lib/dashboard),
  // and a figure that needs a layout engine is laid out BEFORE it is mounted,
  // in a frame of its own (lib/wasm/engine-frame.js).
  frame.setAttribute("sandbox", FIGURE_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", title || caption || "Figure");
  frame.style.cssText = "width:100%;border:1px solid #e2e6ea;border-radius:4px;"
                      + `background:#fff;display:block;min-height:${minHeight}px;`;
  holder.appendChild(frame);

  const view = d.defaultView || (typeof window !== "undefined" ? window : null);

  // Sized from the viewBox, because nothing in the frame can report a height
  // and nothing out here can read one: the document is cross-origin by
  // construction.  A DOT figure that has been laid out has a viewBox like any
  // other; one still shown as source is text of unknown length, so it is
  // given a fixed box and scrolls inside it.
  const relayout = () => {
    const ratio = kind === "svg" ? aspectOf(figure?.text)
                : drawn ? aspectOf(drawn) : null;
    const w = frame.clientWidth || container.clientWidth || 0;
    const h = ratio && w ? Math.round(w / ratio) + 96 : 420;
    frame.style.height = `${Math.min(maxHeight, Math.max(minHeight, h))}px`;
  };

  function draw() {
    page = buildFigurePage(figure, { caption, title, meta, notes, at: stamp,
                                     drawing: drawn, layout: layoutMeta, aiProvenance });
    frame.srcdoc = page;
    relayout();
  }

  function select(which) {
    const drawing_ = which !== "source";
    holder.hidden = !drawing_;
    source.hidden = drawing_;
    for (const b of tabs.querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b.dataset.tab === (drawing_ ? "drawing" : "source")));
    }
  }

  // The tabs are out here because the frame has no script and will not be
  // given any.  The saved page says the same thing with `<details>'.
  function tabStrip(engines = null) {
    tabs.replaceChildren();
    if (kind !== "dot" || !drawn) return;
    tabs.setAttribute("role", "tablist");
    for (const [key, label] of [["drawing", "Drawing"], ["source", "DOT source"]]) {
      const b = d.createElement("button");
      b.type = "button";
      b.dataset.tab = key;
      b.dataset.testid = `figure-tab-${key}`;
      b.setAttribute("role", "tab");
      b.textContent = label;
      b.addEventListener("click", () => select(key));
      tabs.appendChild(b);
    }
    const note = d.createElement("span");
    note.className = "fig-tab-note";
    note.dataset.testid = "figure-layout-note";
    note.textContent = layoutMeta?.version
      ? `graphviz ${layoutMeta.version}, in this browser:`
      : "laid out in this browser:";
    tabs.appendChild(note);

    // Changing the engine is a re-layout, not a re-draw: the same source,
    // asked a different question about itself.  Doing it here costs nothing
    // and saves a round trip to the model, which would otherwise be asked to
    // produce the identical graph again in the hope of a better picture.
    if (engines?.length) {
      const sel = d.createElement("select");
      sel.className = "fig-tab-engine";
      sel.dataset.testid = "figure-engine";
      for (const name of engines) {
        const o = d.createElement("option");
        o.value = name;
        o.textContent = name;
        if (name === layoutMeta?.engine) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { relayoutWith(sel.value); });
      tabs.appendChild(sel);
    }
    select("drawing");
  }

  draw();
  tabStrip();
  if (view) view.addEventListener("resize", relayout);

  // The layout, if there is one to do.  `ready' settles either way, with the
  // outcome, so a caller can report it; nothing waits on it to show the
  // figure, because the source is already on the screen.
  async function relayoutWith(which) {
    let out, engines = null;
    try {
      const gv = await import("../wasm/graphviz.js");
      engines = gv.DOT_ENGINES;
      out = await gv.layoutDot(figure.text, { engine: which || gv.DEFAULT_ENGINE, doc: d });
    } catch (e) {
      out = { ok: false, error: `the layout engine did not load: ${e.message || e}` };
    }
    if (!frame.isConnected) return out;
    if (out.ok) {
      drawn = out.svg;
      layoutMeta = { engine: out.engine, version: out.version };
    } else {
      layoutMeta = { engine: which || "dot", error: out.error };
      drawn = null;
    }
    draw();
    tabStrip(engines);
    return out;
  }

  const ready = kind === "dot" && !drawn && layout
    ? relayoutWith(engine)
    : Promise.resolve({ ok: Boolean(drawn), already: true });

  return {
    frame,
    ready,
    page() { return page; },
    digest() { return contentDigest(page); },
    /**
     * What a download writes: the same figure, in a file that can check it.
     *
     * `page()' stays what it was -- the figure document alone -- because it
     * is what the record digests, and a digest that started covering the
     * interface's own furniture would stop matching the figures taken before
     * today.  This is that document, carried in a file with the query beside
     * it.  Without a `source' there is nowhere to check against and the two
     * are the same bytes.
     */
    savedPage() {
      return buildSavedFigure({
        page, title: title || caption, query: meta.query || null,
        accept: meta.accept || null, mimeType: meta.mimeType || null,
        digest: meta.resultDigest || null, rows: meta.rows == null ? null : meta.rows,
        source: ranAgainst, at: stamp,
        aspect: kind === "svg" ? aspectOf(figure?.text, 0)
              : drawn ? aspectOf(drawn, 0) : 0,
      });
    },
    /** Why this copy cannot check itself, or null when it can. */
    savedTrouble(of) { return savedFigureTrouble(of || this.savedPage()); },
    drawing() { return drawn; },
    layout() { return layoutMeta; },
    setEngine(which) { return relayoutWith(which); },
    select,
    relayout,
    destroy() {
      if (view) view.removeEventListener("resize", relayout);
      mount.remove();
    },
  };
}

export default mountFigure;
