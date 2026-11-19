/**
 * The transcript: one collapsible entry per exchange, drawn the same way
 * wherever an exchange happens.
 *
 * It was the exploration pane's, written as a closure inside `openExplorationPane'
 * and therefore unreachable from anywhere else.  When the account gained an
 * exploration pane of its own (§34.4) there were two surfaces showing the same
 * conversation -- the model on the left, the service on the right, the
 * interface's own notices down the middle -- and a second copy of two hundred
 * lines of rendering is how two surfaces stop agreeing about what a failure
 * looks like.  So it is a module, and the two things that genuinely differ
 * between the surfaces are handed in: what "Add as a view" does with a query,
 * and what "Draw it…" opens.
 *
 * The styles are here with it, scoped to `.exploration-pane'; both panes carry
 * that class, which is the whole of their agreeing about appearance.
 */

import { setCaret } from "./disclosure.js";
import {
  formatBlock, fences, summarize, duration, MARK, clip, prettyJson,
} from "../../lib/format/transcript.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clock = (d) => d.toTimeString().slice(0, 8);

/* ─────────────────────────── styling ─────────────────────────── */

const STYLE = `
.exploration-pane { font-size: 12px; }
.exploration-pane .exp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-weight: bold; background: #eef2f7;
  border-bottom: 1px solid #d7e0ea; }
.exploration-pane .exp-head .exp-close {
  background: transparent; border: none; cursor: pointer; font-size: 15px;
  line-height: 1; color: #666; padding: 0 2px; }
.exploration-pane .exp-body { padding: 8px 10px 10px; }

.exploration-pane .exp-conn,
.exploration-pane .exp-x,
.exploration-pane .exp-raw { border: 1px solid #e2e6ea; border-radius: 4px;
  background: #fff; margin-bottom: 6px; }
.exploration-pane .exp-conn > summary,
.exploration-pane .exp-x > summary,
.exploration-pane .exp-raw > summary {
  cursor: pointer; padding: 4px 8px; list-style: none; display: flex;
  align-items: baseline; gap: 8px; user-select: none; }
.exploration-pane .exp-conn > summary::-webkit-details-marker,
.exploration-pane .exp-x > summary::-webkit-details-marker,
.exploration-pane .exp-raw > summary::-webkit-details-marker { display: none; }
.exploration-pane .exp-conn > summary::before,
.exploration-pane .exp-raw > summary::before {
  content: "\\25B8"; color: #999; font-size: 10px; width: 9px; flex: none; }
.exploration-pane .exp-conn[open] > summary::before,
.exploration-pane .exp-raw[open] > summary::before { content: "\\25BE"; }
.exploration-pane .exp-conn > summary:hover,
.exploration-pane .exp-x > summary:hover,
.exploration-pane .exp-raw > summary:hover { background: #f7f9fb; }

/* The exchange as a conversation: the model on the left, the service on the
   right, the pane's own notices down the middle.  Which side a thing is on is
   the fastest way to read who said it, so nothing else has to carry that. */
.exploration-pane .exp-row {
  display: flex; align-items: flex-start; gap: 5px; margin-bottom: 6px; }
.exploration-pane .exp-row-llm  { justify-content: flex-start; }
.exploration-pane .exp-row-mcp  { justify-content: flex-end; }
.exploration-pane .exp-row-note { justify-content: center; }
.exploration-pane .exp-row > .exp-x { margin-bottom: 0; max-width: 78%; min-width: 0; flex: 0 1 auto; }
.exploration-pane .exp-row-note > .exp-x { max-width: 90%; }
.exploration-pane .exp-row-llm  > .exp-x {
  border-radius: 10px 10px 10px 2px; background: #fdf8f2; border-color: #ecdcc8; }
.exploration-pane .exp-row-mcp  > .exp-x {
  border-radius: 10px 10px 2px 10px; background: #f4f8fc; border-color: #d3e0ec; }
.exploration-pane .exp-row-note > .exp-x {
  border-radius: 10px; background: #fafafa; border-color: #e6e6e6; }
.exploration-pane .exp-x-fail > summary { background: transparent; }
.exploration-pane .exp-row > .exp-x.exp-x-fail { border-color: #e2b6b6; background: #fdf6f6; }

/* The show/hide control sits on the outer margin -- the side the bubble is
   against -- so the controls form their own column and never move. */
.exploration-pane .exp-toggle {
  flex: none; margin-top: 3px; width: 16px; height: 16px; padding: 1px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb;
  color: #111827; cursor: pointer; }
.exploration-pane .exp-toggle:hover { background: #eef1f4; }

.exploration-pane .exp-conn-grid {
  display: grid; grid-template-columns: auto 1fr; gap: 4px 8px;
  align-items: center; padding: 6px 10px 8px; }
.exploration-pane .exp-conn-grid label { color: #555; }
.exploration-pane .exp-conn-grid input {
  width: 100%; font-size: 12px; padding: 2px 4px; box-sizing: border-box;
  border: 1px solid #ccd3da; border-radius: 3px; }
.exploration-pane .exp-conn-out {
  margin: 0 10px 8px; padding: 6px; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  white-space: pre-wrap; max-height: 150px; overflow: auto; color: #444; }

.exploration-pane .exp-chip {
  font-weight: normal; font-size: 11px; padding: 1px 6px; border-radius: 9px; }
.exploration-pane .exp-chip-ok   { background: #e8f4e8; color: #2d662d; }
.exploration-pane .exp-chip-fail { background: #fbeaea; color: #8a2b2b; }
.exploration-pane .exp-chip-wait { background: #f1f1f1; color: #666; }

.exploration-pane .exp-prompt {
  min-height: 56px; border: 1px solid #ccd3da; border-radius: 4px; padding: 7px 8px;
  background: #fff; font-size: 13px; line-height: 1.45; }
.exploration-pane .exp-prompt:empty::before {
  content: attr(data-placeholder); color: #aaa; }
.exploration-pane .exp-actions {
  display: flex; gap: 8px; align-items: center; margin: 7px 0 10px; }
.exploration-pane .exp-actions button { padding: 4px 14px; cursor: pointer; }
.exploration-pane .exp-status { color: #666; }

.exploration-pane .exp-x > summary { font-family: ui-monospace, Menlo, monospace; }
.exploration-pane .exp-x-time  { color: #999; flex: none; }
.exploration-pane .exp-x-side  { flex: none; width: 30px; font-weight: 600; }
.exploration-pane .exp-x-llm  .exp-x-side { color: #a2672a; }
.exploration-pane .exp-x-mcp  .exp-x-side { color: #1f4e79; }
.exploration-pane .exp-x-note .exp-x-side { color: #888; }
.exploration-pane .exp-x-title { flex: 1 1 auto; font-family: Helvetica, sans-serif;
  font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exploration-pane .exp-x-mark  { flex: none; }
.exploration-pane .exp-x-meta  { flex: none; color: #777; font-size: 11px; }
.exploration-pane .exp-x-store { flex: none; color: #1f4e79; font-size: 11px;
  background: #eef3f8; border-radius: 8px; padding: 0 6px; }
.exploration-pane .exp-x-fail > summary { background: #fdf6f6; }

.exploration-pane .exp-block { border-top: 1px solid #f0f2f4; padding: 6px 10px 8px; }
.exploration-pane .exp-block-label {
  font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: #8a94a0; margin-bottom: 3px; }
.exploration-pane pre.exp-pre {
  margin: 0; padding: 6px 8px; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  line-height: 1.45; white-space: pre-wrap; word-break: break-word;
  max-height: 260px; overflow: auto; }
.exploration-pane pre.exp-kind-sparql { background: #f6faf6; border-color: #dfeadf; }
.exploration-pane pre.exp-kind-json   { background: #fafbfd; }
.exploration-pane pre.exp-kind-score  { background: #fdfaf5; border-color: #f0e6d8; }
.exploration-pane p.exp-prose {
  margin: 0 0 7px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
.exploration-pane .exp-raw > summary { font-size: 11px; color: #888; }
.exploration-pane .exp-empty { color: #999; padding: 6px 2px; }
.exploration-pane .exp-addview {
  margin-top: 6px; padding: 3px 10px; cursor: pointer; font-size: 11px; }
.exploration-pane .exp-mode { display: inline-flex; align-items: center; gap: 4px;
  color: #555; cursor: pointer; }
.exploration-pane .exp-gate-holder:empty { display: none; }
`;

export function ensureExplorationStyle(doc) {
  if (doc.getElementById("exploration-pane-style")) return;
  const s = doc.createElement("style");
  s.id = "exploration-pane-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/* ─────────────────────────── blocks ─────────────────────────── */

/** A labelled block of text, styled by what the text turns out to be. */
export function blockEl(label, text, { prose = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "exp-block";
  const lab = document.createElement("div");
  lab.className = "exp-block-label";
  lab.textContent = label;
  wrap.appendChild(lab);

  if (prose) {
    // The model answers in prose with queries fenced inside it.  Reflowing the
    // prose and leaving the fences alone is the whole difference between a wall
    // of monospace and something that can be read.
    const parts = fences(text);
    if (!parts.length) {
      const p = document.createElement("p");
      p.className = "exp-prose";
      p.textContent = "(no text)";
      wrap.appendChild(p);
    }
    for (const part of parts) {
      if (part.kind === "code") {
        const pre = document.createElement("pre");
        const kind = part.lang === "sparql" || part.lang === "sq" ? "sparql" : (part.lang || "text");
        pre.className = `exp-pre exp-kind-${kind}`;
        pre.textContent = clip(part.body);
        wrap.appendChild(pre);
      } else {
        const p = document.createElement("p");
        p.className = "exp-prose";
        p.textContent = part.body.trim();
        wrap.appendChild(p);
      }
    }
    return wrap;
  }

  const { kind, body } = formatBlock(text);
  const pre = document.createElement("pre");
  pre.className = `exp-pre exp-kind-${kind}`;
  pre.textContent = body || "(empty)";
  wrap.appendChild(pre);
  return wrap;
}

/** A collapsed-by-default block, for the envelope nobody reads until they must. */
export function rawEl(label, text) {
  const d = document.createElement("details");
  d.className = "exp-raw";
  const s = document.createElement("summary");
  s.textContent = label;
  d.appendChild(s);
  d.appendChild(blockEl(label, text));
  return d;
}


/* ─────────────────────────── the list ─────────────────────────── */

/**
 * Draw exchanges into `list', in the order they happen.
 *
 * Entries are appended, never re-rendered, so an entry opened for reading
 * stays open while the run continues underneath it.  `store' is the array the
 * surface keeps them in -- the pane's, so that closing and reopening a pane
 * does not lose what it said.
 *
 * `addView' and `draw' are what a surface can do with a query the model
 * wrote.  A surface that passes neither simply shows the query; a repository's
 * pane passes both, because it knows which repository the view would go into.
 * `draw' is handed the entry and an empty element to open into, and returns
 * something with `destroy()' or nothing.
 */
export function createExchangeList(list, {
  doc = (typeof document !== "undefined" ? document : null),
  store = [],
  emptyText = "Nothing run yet.",
  testid = "exploration",
  addView = null,
  addViewLabel = "Add as a view",
  draw = null,
  drawLabel = "Draw it…",
} = {}) {
  if (!list || !doc) return { add: () => null, count: () => 0 };

  let n = 0;
  const empty = doc.createElement("div");
  empty.className = "exp-empty";
  empty.textContent = emptyText;
  list.appendChild(empty);

  function add(x) {
    if (empty.parentNode) empty.remove();
    n += 1;
    const entry = { n, at: new Date(), ...x };
    store.push(entry);

    const d = doc.createElement("details");
    d.className = `exp-x exp-x-${entry.kind}${entry.status === "fail" ? " exp-x-fail" : ""}`;
    d.dataset.testid = `${testid}-exchange-${n}`;
    const side = entry.kind === "llm" ? "LLM" : entry.kind === "mcp" ? "MCP" : "·";
    const mark = MARK[entry.status] || MARK.note;
    const sum = doc.createElement("summary");
    // Which repository a call went to, when the surface carries more than one.
    // It is the one fact a multi-store transcript cannot be read without, and
    // it belongs in the indicator line rather than inside the payload.
    sum.innerHTML = `
      <span class="exp-x-time">${esc(clock(entry.at))}</span>
      <span class="exp-x-side">${esc(side)}</span>
      <span class="exp-x-title">${esc(entry.title)}</span>
      ${entry.repository ? `<span class="exp-x-store">${esc(entry.repository)}</span>` : ""}
      <span class="exp-x-mark">${mark}</span>
      <span class="exp-x-meta">${esc(summarize(entry))}</span>`;
    d.appendChild(sum);

    if (entry.request != null) d.appendChild(blockEl(entry.requestLabel || "request", entry.request));
    if (entry.response != null) {
      d.appendChild(blockEl(entry.responseLabel || "response", entry.response,
                            { prose: Boolean(entry.prose) }));
    }
    for (const r of [].concat(entry.raw || [])) {
      if (r && r.text) d.appendChild(rawEl(r.label, r.text));
    }

    if (entry.sparql && (addView || draw)) {
      const holder = doc.createElement("div");
      holder.className = "exp-block";
      const gateHolder = doc.createElement("div");
      gateHolder.className = "exp-gate-holder";
      gateHolder.dataset.testid = `${testid}-gate-holder-${n}`;

      if (addView) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "exp-addview";
        b.dataset.testid = `${testid}-add-view-${n}`;
        b.textContent = addViewLabel;
        b.addEventListener("click", () => addView(entry));
        holder.appendChild(b);
      }

      if (draw) {
        // U-13: the second thing one can do with a query the model wrote.
        // Beside "Add as a view" because it is the same decision one step
        // further on -- this query, run now, and drawn -- and because the
        // prose it sits under is most of what makes the query reviewable.
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "exp-addview";
        b.dataset.testid = `${testid}-draw-${n}`;
        b.textContent = drawLabel;
        b.title = "Run this query here and ask the model to draw the result";
        let gate = null;
        b.addEventListener("click", () => {
          if (gate) { gate.destroy(); gate = null; b.textContent = drawLabel; return; }
          b.textContent = "Close the gate";
          gate = draw(entry, gateHolder) || null;
          if (!gate) b.textContent = drawLabel;
          d.open = true;
        });
        holder.appendChild(b);
      }
      d.appendChild(holder);
      d.appendChild(gateHolder);
    }

    // Failures and the final answer open themselves; routine traffic does not,
    // or a run of twenty calls would bury the thing you are reading.
    if (entry.status === "fail" || entry.open) d.open = true;

    const row = doc.createElement("div");
    row.className = `exp-row exp-row-${entry.kind}`;
    row.dataset.testid = `${testid}-row-${n}`;

    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "exp-toggle";
    toggle.dataset.testid = `${testid}-toggle-${n}`;
    setCaret(toggle, d.open);
    toggle.addEventListener("click", () => {
      d.open = !d.open;
      // `toggle' is dispatched asynchronously, so turn the caret here as well:
      // a control that lags its own click by a frame reads as a missed press.
      setCaret(toggle, d.open);
    });
    // The summary is still a disclosure in its own right, so the button follows
    // the element rather than keeping its own idea of the state.
    d.addEventListener("toggle", () => setCaret(toggle, d.open));

    // Outer margin: left of a left-hand bubble, right of a right-hand one.
    if (entry.kind === "mcp") { row.appendChild(d); row.appendChild(toggle); }
    else { row.appendChild(toggle); row.appendChild(d); }

    list.appendChild(row);
    row.scrollIntoView({ block: "nearest" });
    return d;
  }

  return { add, count: () => n, element: list };
}

export { duration, clip, prettyJson };
export default createExchangeList;
