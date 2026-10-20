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
 * One consequence worth reading twice: with scripts off, NOTHING INSIDE THE
 * FRAME CAN MEASURE ITSELF.  The dashboard frame reports its height by
 * postMessage; this one cannot, and its document is cross-origin so the parent
 * cannot read it either.  The height therefore comes from the figure's own
 * `viewBox' ratio, computed out here before it is mounted.  That is not a
 * workaround: a figure that declares no viewBox cannot scale anyway, which is
 * why `figurePolicy' names its absence.
 */

import { contentDigest } from "../mcp/result-digest.js";
import { aspectOf } from "./spec.js";

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
 * There is no second form for download.  A dashboard needs one, because its
 * live page is empty until the pane posts data in; a figure is already
 * self-contained, so what is previewed and what is saved are the same
 * document, which is one fewer thing that can differ between what a user
 * approved and what they then sent to someone.
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
  drawing = null, layout = null,
} = {}) {
  const kind = figure?.kind === "dot" ? "dot" : "svg";
  const source = String(figure?.text || "");
  const drawn = kind === "dot" && drawing ? String(drawing) : null;
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
  minHeight = 160, maxHeight = 1200, at = null,
  drawing = null, engine = null, layout = true,
} = {}) {
  const d = doc || container.ownerDocument || document;
  const kind = figure?.kind === "dot" ? "dot" : "svg";
  ensurePaneStyle(d);

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
    page = buildFigurePage(figure, { caption, title, meta, notes, at,
                                     drawing: drawn, layout: layoutMeta });
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
