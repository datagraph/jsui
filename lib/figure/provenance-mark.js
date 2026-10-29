/**
 * The ledger drawn into a figure.  `ui-generator.md' §2.6.1, work item U-48.
 *
 * A figure leaves this interface more easily than anything else it produces:
 * it is one <svg> element and copying it is a right-click.  That is exactly
 * why the mark cannot live in the pane around it -- a footnote beside the
 * picture is gone the moment the picture travels, which is the moment
 * Article 50(4) is engaged.
 *
 * Four rules, each because the obvious implementation gets it wrong:
 *
 *   THE INTERFACE DRAWS IT, NOT THE MODEL.  A mark the model is asked to
 *   include is a mark it can omit, misstate or lose to a token ceiling -- and
 *   the run where it does that is the run whose provenance matters most.  So
 *   the figure is marked after it comes back, by this function, from facts
 *   the interface holds.
 *
 *   INSIDE THE `viewBox'.  Outside it, the ledger is a sibling element and
 *   travels only as far as the clipboard chooses to take it.
 *
 *   THE DRAWING IS MOVED, NOT COVERED.  The `viewBox' grows by the ledger's
 *   height and the original content is translated into what is left.  A
 *   ledger laid over the figure's corner can sit on a data point, and a
 *   provenance mark that destroys evidence is an own goal.
 *
 *   <metadata> BESIDE IT.  The visible line is for a reader; the metadata is
 *   for a program, and R-P4 wants both.  A reader can crop a ledger out of a
 *   screenshot; the metadata survives the file.
 */

import { provenanceOf, provenanceLine, provenanceRecord } from "../provenance.js";

/** Height of the ledger band, in the figure's own user units. */
export const LEDGER_HEIGHT = 18;

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** `viewBox="0 0 W H"' → the four numbers, or null if it says nothing usable. */
export function viewBoxOf(svg) {
  const m = /\bviewBox\s*=\s*["']\s*([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)\s*["']/
    .exec(String(svg || ""));
  if (!m) return null;
  const n = m.slice(1, 5).map(Number);
  return n.every((x) => Number.isFinite(x)) && n[2] > 0 && n[3] > 0
    ? { x: n[0], y: n[1], width: n[2], height: n[3] } : null;
}

/** Is this already marked?  Marking twice would stack ledgers on a redraw. */
export function isMarked(svg) {
  return /\bdata-provenance\s*=\s*["']ai["']/.test(String(svg || ""));
}

/**
 * The ledger, as SVG source.
 *
 * Styled with presentation attributes rather than a <style> block: the figure
 * frame allows inline style, but a copied SVG may land somewhere that does
 * not, and a mark that depends on CSS to be legible is a mark that can be
 * made illegible by its surroundings.
 */
function ledger(text, { x, y, width }, height) {
  const pad = 6;
  const size = Math.max(7, Math.min(11, Math.round(height * 0.55)));
  return [
    `<g data-provenance="ai" aria-label="${esc(text)}">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f7f8fa"/>`,
    `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="#e2e6ea" stroke-width="1"/>`,
    `<text x="${x + pad}" y="${y + height - Math.round(height * 0.33)}"`,
    ` font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${size}"`,
    ` fill="#5b6672" xml:space="preserve">${esc(text)}</text>`,
    `</g>`,
  ].join("");
}

/** The machine-readable half (R-P4), as RDF/XML inside the figure. */
function metadata(p) {
  const r = provenanceRecord(p);
  const rows = Object.entries(r)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `    <${k.replace(":", "_")}>${esc(v)}</${k.replace(":", "_")}>`);
  return ["<metadata data-provenance=\"ai\">",
          "  <ai_provenance xmlns:ai=\"https://artificialintelligenceact.eu/article/50/\">",
          ...rows,
          "  </ai_provenance>",
          "</metadata>"].join("\n");
}

/**
 * Mark one SVG document.  Returns the source, marked; or unchanged, with
 * `ok:false' and a reason, when it cannot be done safely.
 *
 * Never throws and never half-marks: a figure that cannot be marked is still
 * a figure, and the pane says so rather than showing nothing.  The caller is
 * expected to surface `reason' — silently unmarked is the one outcome §2.6
 * does not allow.
 */
export function markSvg(source, provenance = {}, { height = LEDGER_HEIGHT } = {}) {
  const svg = String(source || "");
  if (!svg.trim()) return { ok: false, svg, reason: "there is no figure to mark" };
  if (isMarked(svg)) return { ok: true, svg, already: true, reason: null };

  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return { ok: false, svg, reason: "the figure has no <svg> element" };
  const box = viewBoxOf(open[0]);
  if (!box) {
    return { ok: false, svg,
             reason: "the figure has no usable viewBox, so a band cannot be added "
                   + "without guessing at its scale" };
  }
  const close = svg.lastIndexOf("</svg>");
  if (close < 0) return { ok: false, svg, reason: "the <svg> element is not closed" };

  const p = provenanceOf(provenance);
  const text = provenanceLine(p, { prefix: "AI-generated ·" });

  // The content between the open tag and the close, moved down by nothing and
  // the band added BELOW it: the viewBox grows at the bottom, so nothing in
  // the original drawing moves relative to anything else in it.
  const inner = svg.slice(open.index + open[0].length, close);
  const grown = `${box.x} ${box.y} ${box.width} ${box.height + height}`;
  const head = open[0]
    .replace(/\bviewBox\s*=\s*["'][^"']*["']/i, `viewBox="${grown}"`)
    // A fixed height would now letterbox or crop: the band is extra geometry.
    .replace(/\s\bheight\s*=\s*["'][^"']*["']/i, "")
    .replace(/\s\bwidth\s*=\s*["'][^"']*["']/i, "");

  const band = ledger(text, { x: box.x, y: box.y + box.height, width: box.width }, height);
  return { ok: true, already: false, reason: null, text,
           svg: `${head}\n${metadata(p)}\n${inner}\n${band}\n</svg>` };
}

export default markSvg;
