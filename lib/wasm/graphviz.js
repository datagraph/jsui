/**
 * Graph layout, in the browser, for a figure the model wrote as DOT.
 *
 * The first engine to go into `lib/wasm/engine-frame.js', and the reason it
 * was written.  Until now a `dot' figure was shown as its own source, with a
 * note saying to run graphviz oneself, because nothing in the figure frame
 * could lay a graph out and nothing could be fetched into it.  The frame has
 * not changed -- it still runs no script.  What changed is that the layout
 * happens BEFORE the figure is mounted, in a frame that holds no
 * model-authored markup, and what reaches the figure frame is ordinary SVG.
 *
 * Why this is worth the 800K in `vendor/':
 *
 *   A model writing SVG does the layout itself, in one forward pass, with no
 *   backtracking: it must commit to the first node's coordinates before it
 *   has written the twelfth, and it cannot measure text.  What it produces is
 *   a remembered arrangement, not a computed one -- which is why a graph it
 *   draws looks like neither `dot' nor `neato'.  Writing DOT instead is a few
 *   hundred tokens of structure rather than a few thousand of geometry, it
 *   cannot be truncated into something that looks finished, and the layout is
 *   then done by a program that does rank assignment and crossing reduction
 *   properly.  For a graph, that is strictly better in every term that
 *   matters -- cost, failure mode, and the picture.
 *
 * What the model gets to choose is the ENGINE, because `dot' and `neato'
 * answer different questions and only the author of the graph knows which
 * one is being asked.
 */

import { createEngineFrame, loadEngineSource } from "./engine-frame.js";

/** Where the vendored engine lives, relative to this module. */
export const ENGINE_URL = new URL("../../vendor/graphviz/graphviz.js", import.meta.url).href;

/**
 * The layout engines, in the order they are offered.
 *
 * `patchwork' and `osage' are left out: both lay out a treemap rather than a
 * graph, and a model that picks one from a list without knowing that
 * produces a picture of the wrong kind with no error.
 */
export const DOT_ENGINES = ["dot", "neato", "fdp", "sfdp", "circo", "twopi"];

export const DEFAULT_ENGINE = "dot";

/** One line each, for the prompt and for the engine menu in the pane. */
export const ENGINE_NOTES = {
  dot: "layered, for a graph with a direction — hierarchies, pipelines, flows",
  neato: "spring model, for an undirected graph of no great size",
  fdp: "force-directed, like neato but better on graphs with clusters",
  sfdp: "multiscale force-directed, for a large graph",
  circo: "circular, for a graph with cyclic structure",
  twopi: "radial, for a graph with one clear centre",
};

/* ── the driver, which runs inside the frame ──────────────────────────────── */

/**
 * The frame's entire program.
 *
 * It is a string, like the dashboard runtime, for the same reason: it is not
 * this document's code, it is the other document's, and keeping it as source
 * makes that visible.  It loads the engine once, on the first call, so a
 * session that never draws a graph never instantiates a megabyte of WASM.
 *
 * Note what it does NOT do: it never touches `document', never writes markup,
 * and never returns anything but a string.  The SVG it produces is treated
 * out here exactly as the model's own SVG is -- shown in the script-free
 * frame, walked by `figurePolicy' -- because `URL=' in DOT becomes a link in
 * the output, and the engine is faithful to whatever it was given.
 */
export const GRAPHVIZ_DRIVER = String.raw`
(function () {
  var loading = null;
  function engine() {
    if (!loading) loading = GraphvizWasm.Graphviz.load();
    return loading;
  }
  function reply(id, body) {
    parent.postMessage(Object.assign({ __engine: "graphviz", id: id }, body), "*");
  }
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || typeof m !== "object" || event.source !== parent) return;
    var id = m.id;
    if (m.op !== "layout") { reply(id, { ok: false, error: "unknown operation" }); return; }
    engine().then(function (gv) {
      var svg = gv.layout(String(m.source || ""), "svg", m.engine || "dot");
      reply(id, { ok: true, svg: svg, version: gv.version(), engine: m.engine || "dot" });
    }, function (e) {
      reply(id, { ok: false, error: String((e && e.message) || e) });
    }).catch(function (e) {
      reply(id, { ok: false, error: String((e && e.message) || e) });
    });
  });
})();
`;

/* ── normalising what comes back ──────────────────────────────────────────── */

/**
 * Graphviz writes a standalone document; a figure is a fragment.
 *
 * Three removals, and no more than three.  The XML declaration and the
 * doctype belong to a file, not to an element inlined in a page -- and
 * `figurePolicy' would rightly report the doctype as something the frame will
 * not honour.  The `width'/`height' pair is in points and would pin the
 * drawing to the size graphviz chose; the `viewBox' stays, so the figure
 * scales to the pane and the frame can be sized from its ratio exactly as a
 * model-drawn figure is.
 *
 * Nothing else is touched.  This is our own engine's output, not a
 * sanitiser's input: the protection is the frame, here as everywhere.
 */
export function svgFragment(svg) {
  return String(svg || "")
    .replace(/<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/<!DOCTYPE[\s\S]*?>\s*/i, "")
    .replace(/(<svg\b[^>]*?)\s+width="[^"]*"\s+height="[^"]*"/i, "$1")
    .trim();
}

/* ── the service ──────────────────────────────────────────────────────────── */

let shared = null;

/** The one frame, started on first use and kept for the session. */
export function graphvizFrame({ doc = null, engineSource = null } = {}) {
  if (shared && !shared.dead) return Promise.resolve(shared);
  const source = engineSource
    ? Promise.resolve(engineSource)
    : loadEngineSource(ENGINE_URL);
  return source.then((text) => {
    if (shared && !shared.dead) return shared;
    shared = createEngineFrame({
      name: "graphviz", engineSource: text, driver: GRAPHVIZ_DRIVER, doc,
    });
    return shared;
  });
}

/** Drop the frame; the next call starts a new one. */
export function releaseGraphviz() {
  if (shared) { shared.destroy("released"); shared = null; }
}

/**
 * Lay out DOT and give back SVG.
 *
 * Never throws and never rejects: a figure that does not lay out is a figure
 * shown as its source with the engine's complaint beside it, which is what
 * the pane did for every DOT figure until now.  A caller that treats failure
 * as exceptional would turn a bad graph into a broken page.
 */
export async function layoutDot(source, {
  engine = DEFAULT_ENGINE, doc = null, timeout = undefined, engineSource = null,
} = {}) {
  const chosen = DOT_ENGINES.includes(engine) ? engine : DEFAULT_ENGINE;
  if (!String(source || "").trim()) return { ok: false, error: "there is no DOT source" };
  let frame;
  try {
    frame = await graphvizFrame({ doc, engineSource });
  } catch (e) {
    return { ok: false, error: `the layout engine did not load: ${e.message || e}` };
  }
  const out = await frame.call({ op: "layout", source: String(source), engine: chosen },
                               timeout === undefined ? {} : { timeout });
  if (!out.ok) return { ok: false, error: out.error || "the layout failed", engine: chosen };
  return {
    ok: true, engine: chosen, version: out.version || null,
    svg: svgFragment(out.svg),
  };
}

export default layoutDot;
