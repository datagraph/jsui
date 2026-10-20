/**
 * The single-figure path: Gate 1, the interface's own run, the drawing, Gate 2.
 *
 * §2 of `llm-result-rendering-plan.md'; work items U-13, U-14, U-15, U-17.
 *
 * This is not a pane.  It opens inside the exploration pane, under the turn
 * that produced the query, and that placement is the argument: a figure is
 * what an exploration is FOR, one step further on than "Add as a view".  A
 * separate pane would ask the user to carry the query across a boundary and
 * would lose the thing beside it -- the prose in which the model said what
 * the query returns and what it checked, which is most of what makes Gate 1
 * reviewable at all.
 *
 * The shape of the flow, and why it is this shape:
 *
 *   Gate 1   the query, the notation it will be asked for, and what the model
 *            says it will draw.  THE LAST POINT BEFORE ANYTHING RUNS.  Also
 *            where a result too large to send is headed off (§6), because
 *            afterwards the only lever left is a truncated document.
 *   Phase 2  the interface runs it, under the user's own token (D-I).  The
 *            model does not execute and never has.  What comes back is the
 *            authentic result, and it is shown beside the figure so the two
 *            can be compared -- which is the entire reason this is not just
 *            "let the model draw what it found".
 *   Phase 3  the result goes back to the model WITH its media type and the
 *            original question, and the model draws.  One call, no tools, no
 *            store: there is nothing for it to fetch and nothing to fetch it
 *            with.
 *   Gate 2   disposition.  Mount, download, or discard -- and `discard' is a
 *            real outcome that gets recorded, not a cancel.
 *
 * The temporary view (D-K, U-17) is optional and off by default, because §6
 * of the plan leaves its cost open and a single figure is the case where the
 * trade is least favourable: one configuration write and one entry to sweep,
 * for one query that the user is about to decide the fate of anyway.  When it
 * is asked for, Keep promotes it and Discard sweeps it, and a gate closed
 * without either sweeps on the way out.
 */

import { sparqlFrom, figureFrom } from "../../lib/mcp/mcp-client.js";
import { createToolAdapter } from "../../lib/llm/tool-adapter.js";
import {
  renderSystem, renderPrompt, FIGURE_MAX_TOKENS,
} from "../../lib/llm/figure-prompt.js";
import {
  validateProposal, figurePolicy, figureRecord, capRows,
} from "../../lib/figure/spec.js";
import { mountFigure } from "../../lib/figure/frame.js";
import { runPanel } from "../../lib/dashboard/runner.js";
import { putView, deleteView, promoteView, runId, tempName } from "../../lib/dashboard/catalog.js";
import { digestResult, renderDigest } from "../../lib/mcp/result-digest.js";
import { recordRun } from "../../lib/mcp/transcript-store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * How much of a result is sent back for drawing.
 *
 * Not a policy about what may be seen -- the user has the whole document in
 * front of them -- but about what fits in one request alongside a figure's
 * worth of output tokens.  Past it the head is sent and the model is TOLD it
 * is the head (`renderPrompt' says so), because a model drawing a total from
 * a document it believes is complete produces a figure that is wrong in the
 * one way nobody checks.
 */
export const MAX_RENDER_CHARS = 60000;

/* ─────────────────────────── styling ─────────────────────────── */

const STYLE = `
.fig-gate { border: 1px solid #ecdcc8; border-radius: 4px; background: #fffdfa;
  margin: 6px 0 2px; font-size: 12px; }
.fig-gate > h4 { margin: 0; padding: 5px 9px; font-size: 11px; letter-spacing: .06em;
  text-transform: uppercase; color: #8a5a1a; background: #fdf8f2;
  border-bottom: 1px solid #f0e6d8; display: flex; gap: 8px; align-items: baseline; }
.fig-gate > h4 .fig-sub { font-weight: normal; letter-spacing: 0; text-transform: none;
  color: #a08a6a; }
.fig-gate .fig-body { padding: 8px 9px 9px; }
.fig-gate .fig-grid { display: grid; grid-template-columns: auto 1fr; gap: 5px 9px;
  align-items: center; margin-bottom: 7px; }
.fig-gate .fig-grid label { color: #555; }
.fig-gate .fig-grid select, .fig-gate .fig-grid input[type=text],
.fig-gate .fig-grid input[type=number] {
  font-size: 12px; padding: 2px 4px; border: 1px solid #ccd3da; border-radius: 3px;
  box-sizing: border-box; max-width: 100%; }
.fig-gate pre.fig-pre { margin: 0 0 7px; padding: 6px 8px; background: #fbfcfd;
  border: 1px solid #eef1f4; border-radius: 3px; font-family: ui-monospace, Menlo, monospace;
  font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow: auto; }
.fig-gate pre.fig-kind-sparql { background: #f6faf6; border-color: #dfeadf; }
.fig-gate .fig-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 8px; }
.fig-gate .fig-actions button { padding: 4px 13px; cursor: pointer; font-size: 12px; }
.fig-gate button.fig-primary { background: #1f4e79; color: #fff; border: 1px solid #1a4166;
  border-radius: 3px; }
.fig-gate button.fig-primary:disabled { background: #9fb3c6; border-color: #9fb3c6;
  cursor: default; }
.fig-gate .fig-note { color: #666; }
.fig-gate .fig-warn { color: #8a5a1a; }
.fig-gate .fig-err { color: #8a2b2b; }
.fig-gate .fig-caption { font-size: 12.5px; line-height: 1.5; margin: 0 0 6px; }
.fig-gate .fig-prov { font-size: 11px; color: #8a94a0; margin-top: 5px; }
.fig-gate .fig-holder { margin-top: 7px; }
.fig-gate ul.fig-list { margin: 0 0 7px; padding-left: 17px; color: #8a5a1a; }
.fig-gate ul.fig-list li { margin: 1px 0; }
`;

function ensureStyle(doc) {
  if (doc.getElementById("figure-gate-style")) return;
  const s = doc.createElement("style");
  s.id = "figure-gate-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/* ─────────────────────────── small helpers ─────────────────────────── */

function el(doc, tag, props = {}, children = []) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "testid") n.dataset.testid = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}

const pre = (doc, text, kind = "") =>
  el(doc, "pre", { class: `fig-pre${kind ? ` fig-kind-${kind}` : ""}`, text });

const list = (doc, items, cls = "fig-list") =>
  items.length ? el(doc, "ul", { class: cls }, items.map((i) => el(doc, "li", { text: i }))) : null;

/* ─────────────────────────── the gate ─────────────────────────── */

/**
 * Open the gate under one turn.  Returns a handle; `destroy' sweeps.
 *
 * `state' is the exploration pane's `paneState': the LLM credentials are
 * already there and asking for them twice would be the kind of friction that
 * stops people using the thing at all.
 */
export function openFigureGate(container, {
  doc = null, host, account, repository, state,
  prompt = "", text = "", query = null, session = null,
  onStatus = () => {}, onDone = () => {},
} = {}) {
  const d = doc || container.ownerDocument || document;
  ensureStyle(d);

  const proposal = validateProposal({ query: query || sparqlFrom(text) || "", text });
  const run = runId();
  const started = new Date();

  const wrap = el(d, "div", { class: "fig-gate", testid: "figure-gate" });
  const head = el(d, "h4", {}, [
    el(d, "span", { text: "Gate 1 — authorise the run" }),
    el(d, "span", { class: "fig-sub", testid: "figure-gate-stage", text: "nothing has run yet" }),
  ]);
  const body = el(d, "div", { class: "fig-body" });
  wrap.appendChild(head);
  wrap.appendChild(body);
  container.appendChild(wrap);

  const stage = (title, sub) => {
    head.firstChild.textContent = title;
    head.lastChild.textContent = sub || "";
  };

  // What the run accumulates, for the record at the end.
  const events = [];
  const note = (e) => { events.push({ at: new Date().toISOString(), ...e }); return e; };
  let temp = null;             // the temporary view's name, once written
  let promoted = null;         // the name it was kept under
  let phase2 = null;           // the result document and its shape
  let drawn = null;            // {kind, text, caption, complete}
  let mounted = null;          // the figure frame handle
  let disposition = null;

  /* ── Gate 1 ─────────────────────────────────────────────────────────── */

  function gate1() {
    body.replaceChildren();
    stage("Gate 1 — authorise the run", "nothing has run yet");

    if (!proposal.ok) {
      body.appendChild(el(d, "div", { class: "fig-err", testid: "figure-errors",
                                      text: proposal.errors.join("; ") }));
      body.appendChild(el(d, "div", { class: "fig-actions" },
        [el(d, "button", { type: "button", text: "Close", onclick: () => api.destroy() })]));
      return;
    }

    const f = proposal.figure;
    body.appendChild(el(d, "p", { class: "fig-caption", testid: "figure-intent",
      text: `${f.title || "A figure"} — ${f.caption || "no caption was given"}`
          + (f.kind === "dot" ? ` [a graph, laid out here with ${f.engine || "dot"}]` : "")
          + (f.why ? ` (${f.why})` : "") }));
    body.appendChild(pre(d, proposal.query, "sparql"));

    const warn = list(d, proposal.warnings);
    if (warn) { warn.dataset.testid = "figure-warnings"; body.appendChild(warn); }

    const grid = el(d, "div", { class: "fig-grid" });
    const accept = el(d, "select", { class: "fig-accept", testid: "figure-accept" },
      proposal.notations.map((n) => el(d, "option", { value: n, text: n,
                                                      ...(n === f.accept ? { selected: "" } : {}) })));
    grid.appendChild(el(d, "label", { text: "notation" }));
    grid.appendChild(accept);

    // §6: the last point at which a result too large to send can be headed
    // off.  There is no estimate to show -- nothing has run -- so what is
    // offered is the lever itself, beside a statement of what happens
    // without it.
    const limit = el(d, "input", { type: "number", min: "1", class: "fig-limit",
                                   testid: "figure-limit", placeholder: "as written",
                                   style: "width:9em" });
    grid.appendChild(el(d, "label", { text: "row cap" }));
    grid.appendChild(limit);

    const viaCatalog = el(d, "input", { type: "checkbox", testid: "figure-catalog" });
    grid.appendChild(el(d, "label", { text: "temp view" }));
    grid.appendChild(el(d, "span", {}, [viaCatalog,
      el(d, "span", { class: "fig-note",
        text: ` write it as ${tempName(run, "figure")} and run it by name `
            + `(re-executable and auditable from the catalogue; one configuration `
            + `write, swept when this closes)` })]));
    body.appendChild(grid);

    body.appendChild(el(d, "div", { class: "fig-note", testid: "figure-gate1-note",
      text: `The query runs under your own credentials, not the model's. Over `
          + `${MAX_RENDER_CHARS.toLocaleString()} characters only the head goes back `
          + `for drawing, and the model is told so.` }));

    const go = el(d, "button", { type: "button", class: "fig-primary",
                                 testid: "figure-run", text: "Run it and draw" });
    go.addEventListener("click", () => {
      const capped = capRows(proposal.query, limit.value);
      phase2run({ query: capped.query, accept: accept.value, capped: capped.applied,
                  viaCatalog: viaCatalog.checked });
    });
    body.appendChild(el(d, "div", { class: "fig-actions" }, [
      go,
      el(d, "button", { type: "button", testid: "figure-cancel", text: "Cancel",
                        onclick: () => api.destroy() }),
    ]));
  }

  /* ── Phase 2: the interface's own run ───────────────────────────────── */

  async function phase2run({ query: q, accept, capped, viaCatalog }) {
    body.replaceChildren();
    stage("Phase 2 — the interface runs it", accept);
    const status = el(d, "div", { class: "fig-note", testid: "figure-status",
                                  text: "running…" });
    body.appendChild(status);
    onStatus("running the query…");

    if (viaCatalog) {
      const name = tempName(run, "figure");
      status.textContent = `writing ${name}…`;
      const put = await putView({ host, account, repository, name, query: q,
                                  token: state.token });
      if (put.ok) { temp = name; note({ type: "temp-view", name, ok: true }); }
      else {
        // Not fatal: the direct route runs the same text and writes nothing,
        // so a catalogue that refuses the entry costs provenance, not the run.
        note({ type: "temp-view", name, ok: false, error: put.error });
        body.appendChild(el(d, "div", { class: "fig-warn", testid: "figure-temp-failed",
          text: `the temporary view could not be written (${put.error}); `
              + `running the query directly instead` }));
      }
    }

    const result = await runPanel({
      host, account, repository, token: state.token,
      panel: { name: "figure", query: q, accept },
      run: temp ? run : null, viaCatalog: Boolean(temp),
    });
    note({ type: "execute", ok: result.ok, ms: result.ms, status: result.status,
           name: "figure", view: temp, via: result.via, accept, query: q,
           text: result.text, rows: result.rows, error: result.error || null });

    if (!result.ok) {
      status.remove();
      stage("Phase 2 failed", `HTTP ${result.status || 0}`);
      body.appendChild(el(d, "div", { class: "fig-err", testid: "figure-run-error",
                                      text: result.error || "the query did not run" }));
      body.appendChild(el(d, "div", { class: "fig-actions" }, [
        el(d, "button", { type: "button", text: "Back", onclick: gate1 }),
        el(d, "button", { type: "button", text: "Close", onclick: () => api.destroy() }),
      ]));
      onStatus(`the query failed · ${result.error || result.status}`);
      return;
    }

    const shape = result.shape || digestResult(result.text, result.mimeType);
    phase2 = { ...result, shape, capped, accept, query: q };

    status.remove();
    body.appendChild(el(d, "div", { class: "fig-note", testid: "figure-result-note",
      text: `${result.rows ?? "?"} row(s), ${result.text.length.toLocaleString()} characters, `
          + `${result.mimeType || accept}, digest ${result.digest}`
          + (capped ? " · capped at Gate 1" : "")
          + (temp ? ` · via ${temp}` : " · run directly, nothing written") }));
    const seen = el(d, "details", {}, [
      el(d, "summary", { text: "the result the figure is drawn from" }),
      pre(d, renderDigest(shape, { name: "result" })),
    ]);
    seen.dataset.testid = "figure-result";
    body.appendChild(seen);

    await phase3draw();
  }

  /* ── Phase 3: the model draws ───────────────────────────────────────── */

  async function phase3draw(again = null) {
    stage("Phase 3 — the model draws", "sending the result back");
    const status = el(d, "div", { class: "fig-note", testid: "figure-draw-status",
                                  text: "drawing…" });
    body.appendChild(status);
    onStatus("drawing…");

    const whole = phase2.text || "";
    const truncated = whole.length > MAX_RENDER_CHARS;
    const document_ = truncated ? whole.slice(0, MAX_RENDER_CHARS) : whole;
    const ask = renderPrompt({
      prompt: again ? `${prompt}\n\nThe user then asked: ${again}` : prompt,
      query: phase2.query, figure: proposal.figure, mimeType: phase2.mimeType,
      document: document_, rows: phase2.rows, bytes: whole.length, truncated,
      view: temp,
    });

    // No MCP: there is nothing for the model to fetch here and nothing to
    // fetch it with.  That is Phase 3's whole shape -- one document in, one
    // figure out -- and passing `mcp: null' is how it is enforced rather
    // than merely intended.
    const adapter = createToolAdapter({
      provider: state.llmProvider, endpoint: state.llmEndpoint, apiKey: state.llmKey,
      workspaceId: state.llmWorkspace, model: state.llmModel,
      mcp: null, primeWith: [], system: renderSystem(),
      maxTokens: FIGURE_MAX_TOKENS, maxIterations: 1,
      onEvent: (e) => { events.push(e); },
    });
    const out = await adapter.run(ask);
    status.remove();

    const fig = out.figure || figureFrom(out.finalText || "");
    const assistant = [...out.events].reverse().find((e) => e.type === "assistant");
    const ranOut = assistant?.stopReason === "max_tokens";

    if (!fig) {
      stage("Phase 3 produced no figure", out.error || "");
      body.appendChild(el(d, "div", { class: "fig-err", testid: "figure-none",
        text: out.error
          ? `the model could not be reached: ${out.error}`
          : "the turn carried no figure. What it said instead:" }));
      if (out.finalText) body.appendChild(pre(d, out.finalText));
      body.appendChild(drawAgainActions());
      onStatus("no figure");
      return;
    }

    // A figure cut off at the token limit is refused rather than shown.  It
    // would render -- that is the problem.  A chart missing its last series
    // looks like a chart, and nothing about it says it is incomplete.
    if (!fig.complete || ranOut) {
      drawn = fig;
      stage("Phase 3 — the figure is incomplete", ranOut ? "stopped at the token limit" : "unterminated");
      body.appendChild(el(d, "div", { class: "fig-err", testid: "figure-truncated",
        text: ranOut
          ? "The turn stopped at the token limit and the figure is cut off. It is not "
          + "shown: a truncated figure still draws, and a chart missing its last series "
          + "looks finished. Ask for a simpler one."
          : "The figure is not terminated — it was cut off somewhere. It is not shown, "
          + "because a partial figure renders and does not look partial." }));
      body.appendChild(pre(d, fig.text.slice(0, 1200)));
      body.appendChild(drawAgainActions());
      onStatus("the figure was truncated");
      return;
    }

    drawn = fig;
    note({ type: "figure", ok: true, kind: fig.kind, text: fig.text,
           caption: fig.caption || proposal.figure.caption });
    gate2();
  }

  function drawAgainActions(extra = []) {
    const askAgain = el(d, "input", { type: "text", testid: "figure-again",
      placeholder: "say what to change, then Draw again", style: "flex:1 1 180px" });
    return el(d, "div", { class: "fig-actions" }, [
      askAgain,
      el(d, "button", { type: "button", testid: "figure-draw-again", text: "Draw again",
                        onclick: () => { body.replaceChildren(); phase3draw(askAgain.value.trim() || null); } }),
      ...extra,
      el(d, "button", { type: "button", testid: "figure-discard", text: "Discard",
                        onclick: () => discard() }),
    ]);
  }

  /* ── Gate 2: disposition ────────────────────────────────────────────── */

  function gate2() {
    stage("Gate 2 — what happens to it", drawn.kind);
    const caption = drawn.caption || proposal.figure.caption;
    const notes = figurePolicy(drawn.text, drawn.kind);

    const holder = el(d, "div", { class: "fig-holder", testid: "figure-holder" });
    body.appendChild(holder);
    mounted = mountFigure(holder, drawn, {
      caption, title: proposal.figure.title, notes, doc: d,
      engine: proposal.figure.engine || null,
      meta: { view: promoted || temp, query: phase2.query, rows: phase2.rows,
              mimeType: phase2.mimeType, resultDigest: phase2.digest },
    });
    // A graph that does not lay out is not a failed run: the source is there,
    // the result is there, and the user can still keep the query.  So it is
    // reported where the picture would have been, and nothing else changes.
    mounted.ready.then((out) => {
      if (drawn.kind !== "dot" || out.ok || out.already) return;
      holder.appendChild(el(d, "div", { class: "fig-warn", testid: "figure-layout-error",
        text: `the graph did not lay out: ${out.error}. Its source is above, as written.` }));
    });

    if (notes.length) {
      const l = list(d, notes);
      l.dataset.testid = "figure-policy";
      body.appendChild(el(d, "div", { class: "fig-warn", testid: "figure-policy-head",
        text: "the frame will not honour the following, and says nothing when it does not:" }));
      body.appendChild(l);
    }

    const keepName = el(d, "input", { type: "text", testid: "figure-keep-name",
      placeholder: "name to keep the query as", style: "width:14em" });

    const actions = el(d, "div", { class: "fig-actions" }, [
      keepName,
      el(d, "button", { type: "button", class: "fig-primary", testid: "figure-keep",
                        text: "Keep the query as a view", onclick: () => keep(keepName.value.trim()) }),
      el(d, "button", { type: "button", testid: "figure-download", text: "Download",
                        onclick: () => download() }),
      el(d, "button", { type: "button", testid: "figure-draw-again-2", text: "Draw again",
                        onclick: () => { body.replaceChildren(); phase3draw(null); } }),
      el(d, "button", { type: "button", testid: "figure-discard", text: "Discard",
                        onclick: () => discard() }),
    ]);
    body.appendChild(actions);
    body.appendChild(el(d, "div", { class: "fig-prov", testid: "figure-provenance",
      text: "The figure is the model's rendering of the result above; the result is the "
          + "interface's own run. Both go into the record either way — a figure you "
          + "discard is recorded as discarded." }));
    onStatus("a figure is ready");
  }

  /* ── the three dispositions, and the record ─────────────────────────── */

  async function keep(name) {
    disposition = "kept";
    if (name) {
      const res = await promoteView({ host, account, repository, token: state.token,
                                      from: temp, to: name, query: phase2.query });
      if (res.ok) { promoted = name; temp = null; }
      else {
        body.appendChild(el(d, "div", { class: "fig-err", testid: "figure-keep-error",
          text: `the view was not written: ${res.put.error}` }));
        return;
      }
    }
    stage("Kept", promoted ? `as the view ${promoted}` : "the figure stays in the record");
    await record();
  }

  function download() {
    disposition = disposition || "downloaded";
    const page = mounted.page();
    const base = (proposal.figure.title || "figure").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 48);
    const blob = new Blob([page], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = d.createElement("a");
    a.href = url;
    a.download = `${base || "figure"}.html`;
    d.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    record();
  }

  async function discard() {
    disposition = "discarded";
    await record();
    await api.destroy();
  }

  /**
   * The record (U-16, D-N).
   *
   * Its own run in the transcript, carrying the same session handle as the
   * exploration that produced the query.  Two runs rather than one because
   * there were two: the user authorised a second thing at Gate 1, and a
   * record that folded it into the first would make the authorisation
   * invisible.  They join on the exploration and read in order.
   */
  // Keyed by the disposition rather than a boolean: downloading and then
  // keeping are two decisions and the second carries information the first
  // could not (the name the query was kept under).  Writing the same one
  // twice is the only thing guarded against.
  let recordedAs = null;
  async function record() {
    if (recordedAs !== null && recordedAs === disposition) return null;
    recordedAs = disposition;
    const fig = figureRecord({
      figure: drawn, proposal, result: phase2, prompt, disposition,
      view: temp, promotedTo: promoted, via: phase2?.via || null,
    });
    const kept = await recordRun({
      host, account, token: state.token,
      repository: `${account}/${repository}`,
      session, result: { ok: true, iterations: 1, events,
                         provider: state.llmProvider, model: state.llmModel },
      prompt, started, figure: fig,
    });
    body.appendChild(el(d, "div", { class: kept.ok ? "fig-note" : "fig-warn",
      testid: "figure-record",
      text: kept.ok
        ? `recorded in <${kept.graph}> — the query, the result digest and the figure together`
        : `not recorded: ${kept.error}. The figure is unaffected; the record of it is what is missing.` }));
    onDone({ figure: fig, recorded: kept });
    return kept;
  }

  const api = {
    el: wrap,
    get state() { return { proposal, temp, promoted, disposition, drawn, phase2 }; },
    /** Close, and sweep anything this wrote that was not kept (U-17). */
    async destroy() {
      // Closing the gate on a figure nobody decided about is itself an
      // outcome, and the one that says the run produced something the user
      // did not want enough to keep.  It is worth as much in the record as
      // an explicit discard.
      if (drawn && recordedAs === null) { disposition = "abandoned"; await record(); }
      if (temp) {
        // Only the name this gate wrote, and only while it is still
        // temporary: a sweep that could reach a promoted view would be a
        // worse failure than a stale entry left behind.
        await deleteView({ host, account, repository, name: temp, token: state.token });
        temp = null;
      }
      if (mounted) mounted.destroy();
      wrap.remove();
    },
  };

  gate1();
  return api;
}

export default openFigureGate;
