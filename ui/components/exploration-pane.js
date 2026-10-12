/**
 * The exploration pane: a peer of the view editors.
 *
 * This is the MCP/LLM surface moved out of the repository pane's tab strip and
 * into the editor column, where it sits beside the views it exists to produce.
 * That is the whole of the relocation argument: an exploration is a draft of a
 * view, so it belongs in the same column, opened by a button next to New, and
 * closed the same way.
 *
 * The pane is four things stacked, in the order they are needed:
 *
 *   1. Connection -- collapsed once it is working, and carrying both sets of
 *      credentials.  The MCP endpoint and this account's token come from the
 *      session; the LLM endpoint, key, workspace and model are typed here.  It
 *      connects on open, so the pane is usable without a first ritual click,
 *      and it opens itself when there is something to attend to.
 *   2. The prompt, with Run and Session beside it.
 *   3. The transcript: one collapsible entry per exchange, the indicator line
 *      and the text it belongs to in the same element rather than in two
 *      places.  Formatting is lib/format/transcript.js's business.
 *   4. The session log, when asked for -- the durable half of the same record.
 *
 * Entries are appended, never re-rendered, so an entry opened for reading stays
 * open while the run continues underneath it.
 */

import { connect as mcpConnect, sparqlFrom } from "../../lib/mcp/mcp-client.js";
import { createToolAdapter } from "../../lib/llm/tool-adapter.js";
import { renderSessionLog } from "./session-log.js";
import { paneState } from "./mcp-pane-state.js";
import { locationControl, modelControl, bindLlmSettings } from "./llm-settings.js";
import {
  formatBlock, fences, summarize, duration, MARK, clip, rowsIn, digestRequest, prettyJson,
} from "../../lib/format/transcript.js";

const BASE_PATH = (typeof window !== "undefined" && window.APP_BASE_PATH) || "/ui";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clock = (d) => d.toTimeString().slice(0, 8);

const slug = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "-");

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
`;

function ensureStyle(doc) {
  if (doc.getElementById("exploration-pane-style")) return;
  const s = doc.createElement("style");
  s.id = "exploration-pane-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/* ─────────────────────────── blocks ─────────────────────────── */

/** A labelled block of text, styled by what the text turns out to be. */
function blockEl(label, text, { prose = false } = {}) {
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

/* The page's own show/hide glyph, as js/sparql-editor.js draws it on every view
   editor: a caret down when the thing is shown, a caret right when it is not. */
const SVG_NS = "http://www.w3.org/2000/svg";
const CARET = { open: "M6 10l6 6l6 -6h-12", shut: "M10 18l6 -6l-6 -6v12" };

function caretSvg(doc, open) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ width: 12, height: 12, viewBox: "0 0 24 24",
                                        fill: "none", stroke: "currentColor",
                                        "stroke-width": 1, "stroke-linecap": "round",
                                        "stroke-linejoin": "round" })) {
    svg.setAttribute(k, String(v));
  }
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", open ? CARET.open : CARET.shut);
  svg.appendChild(path);
  return svg;
}

function setCaret(btn, open) {
  const doc = btn.ownerDocument;
  btn.replaceChildren(caretSvg(doc, open));
  btn.title = open ? "Hide" : "Show";
  btn.setAttribute("aria-expanded", String(open));
}

/** A collapsed-by-default block, for the envelope nobody reads until they must. */
function rawEl(label, text) {
  const d = document.createElement("details");
  d.className = "exp-raw";
  const s = document.createElement("summary");
  s.textContent = label;
  d.appendChild(s);
  d.appendChild(blockEl(label, text));
  return d;
}

/* ─────────────────────────── the pane ─────────────────────────── */

export function openExplorationPane(app, { container, accountName, repositoryName }) {
  if (!container) return null;
  const doc = container.ownerDocument || document;
  ensureStyle(doc);

  const id = `exploration-${slug(accountName)}-${slug(repositoryName)}`;
  const existing = container.querySelector(`#${id}`);
  if (existing) {
    existing.scrollIntoView({ behavior: "smooth", block: "start" });
    const p = existing.querySelector(".exp-prompt");
    if (p) p.focus();
    return existing._explorationApi || null;
  }

  const auth = app?.state?.getAuthContext?.(accountName) || {};
  const host = auth.host || window.location.origin;
  const st = paneState(accountName, repositoryName, host);
  st.token = auth.token || st.token || null;

  const wrapper = doc.createElement("div");
  wrapper.className = "view-editor exploration-pane";
  wrapper.id = id;
  wrapper.dataset.account = accountName;
  wrapper.dataset.repository = repositoryName;
  wrapper.dataset.testid = "exploration-pane";
  wrapper.innerHTML = `
    <div class="exp-head">
      <span>/${esc(accountName)}/${esc(repositoryName)} · exploration</span>
      <button type="button" class="exp-close" data-testid="exploration-close" title="Close">×</button>
    </div>
    <div class="exp-body">
      <details class="exp-conn" data-testid="exploration-connection">
        <summary>
          <span>Connection</span>
          <span class="exp-chip exp-chip-wait" data-testid="exploration-chip">connecting…</span>
        </summary>
        <div class="exp-conn-grid">
          <label for="${id}-mcp">MCP</label>
          <input id="${id}-mcp" type="text" class="exp-mcp-endpoint"
                 data-testid="exploration-mcp-endpoint" value="${esc(st.mcpEndpoint)}" />
          <label for="${id}-llm">LLM</label>
          ${locationControl(st, { id: `${id}-llm`, testid: "exploration-llm-endpoint" })}
          <label for="${id}-key">key</label>
          <input id="${id}-key" type="password" class="exp-llm-key"
                 data-testid="exploration-llm-key" placeholder="provider api key"
                 value="${esc(st.llmKey)}" />
          <label for="${id}-ws">workspace</label>
          <input id="${id}-ws" type="text" class="exp-llm-workspace"
                 data-testid="exploration-llm-workspace"
                 placeholder="wrkspc_… (org-scoped keys only)" value="${esc(st.llmWorkspace)}" />
          <label for="${id}-model">model</label>
          ${modelControl(st, { id: `${id}-model`, testid: "exploration-llm-model" })}
          <span></span>
          <span><button type="button" class="exp-reconnect" data-testid="exploration-reconnect"
                        style="padding:3px 10px;cursor:pointer;font-size:11px;">Reconnect</button></span>
        </div>
        <pre class="exp-conn-out" data-testid="exploration-connect-output"></pre>
      </details>

      <div class="exp-prompt" contenteditable="true" data-testid="exploration-prompt"
           data-placeholder="Describe what you want to find…"></div>
      <div class="exp-actions">
        <button type="button" class="exp-run" data-testid="exploration-run">Run</button>
        <button type="button" class="exp-session" data-testid="exploration-session">Session</button>
        <span class="exp-status" data-testid="exploration-status"></span>
      </div>

      <div class="exp-session-panel" data-testid="exploration-session-panel" hidden
           style="border:1px solid #e2e6ea;border-radius:4px;padding:8px;margin-bottom:10px;"></div>

      <div class="exp-exchanges" data-testid="exploration-exchanges"></div>
    </div>`;
  container.appendChild(wrapper);

  const q = (sel) => wrapper.querySelector(sel);
  const connDetails = q(".exp-conn");
  const chip = q(".exp-chip");
  const connOut = q(".exp-conn-out");
  const prompt = q(".exp-prompt");
  const statusEl = q(".exp-status");
  const list = q(".exp-exchanges");
  const sessionPanel = q(".exp-session-panel");

  const setStatus = (s) => { statusEl.textContent = s || ""; };
  const setChip = (kind, text) => {
    chip.className = `exp-chip exp-chip-${kind}`;
    chip.textContent = text;
  };

  // Open when there is something to attend to: no key yet, or a failure.
  if (!st.llmKey) connDetails.open = true;

  /* settings are kept in the shared state, so the prompt tab sees them too */
  const bind = (sel, key) => {
    const el = q(sel);
    if (el) el.addEventListener("change", () => { st[key] = el.value.trim(); });
  };
  bind(".exp-mcp-endpoint", "mcpEndpoint");
  // location and model are linked menus; a new key re-reads the model list
  bindLlmSettings(wrapper, st, {
    keyInput: q(".exp-llm-key"),
    workspaceInput: q(".exp-llm-workspace"),
  });

  /* ── the transcript ── */

  let n = 0;
  const empty = doc.createElement("div");
  empty.className = "exp-empty";
  empty.textContent = "Nothing run yet.";
  list.appendChild(empty);

  function add(x) {
    if (empty.parentNode) empty.remove();
    n += 1;
    const entry = { n, at: new Date(), ...x };
    st.exchanges.push(entry);

    const d = doc.createElement("details");
    d.className = `exp-x exp-x-${entry.kind}${entry.status === "fail" ? " exp-x-fail" : ""}`;
    d.dataset.testid = `exploration-exchange-${n}`;
    const side = entry.kind === "llm" ? "LLM" : entry.kind === "mcp" ? "MCP" : "·";
    const mark = MARK[entry.status] || MARK.note;
    const sum = doc.createElement("summary");
    sum.innerHTML = `
      <span class="exp-x-time">${esc(clock(entry.at))}</span>
      <span class="exp-x-side">${esc(side)}</span>
      <span class="exp-x-title">${esc(entry.title)}</span>
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

    if (entry.sparql) {
      const holder = doc.createElement("div");
      holder.className = "exp-block";
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "exp-addview";
      b.dataset.testid = `exploration-add-view-${n}`;
      b.textContent = "Add as a view";
      b.addEventListener("click", () => {
        // jsui owns view creation; hand the query over.  views/new reads ?query=.
        const url = `${BASE_PATH}/account/${encodeURIComponent(accountName)}`
                  + `/repositories/${encodeURIComponent(repositoryName)}`
                  + `/views/new?query=${encodeURIComponent(entry.sparql)}`;
        if (app?.router?.navigate) app.router.navigate(url); else window.location.assign(url);
      });
      holder.appendChild(b);
      d.appendChild(holder);
    }

    // Failures and the final answer open themselves; routine traffic does not,
    // or a run of twenty calls would bury the thing you are reading.
    if (entry.status === "fail" || entry.open) d.open = true;

    const row = doc.createElement("div");
    row.className = `exp-row exp-row-${entry.kind}`;
    row.dataset.testid = `exploration-row-${n}`;

    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "exp-toggle";
    toggle.dataset.testid = `exploration-toggle-${n}`;
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

  /* ── connect ── */

  async function doConnect() {
    setChip("wait", "connecting…");
    connOut.textContent = "";
    let discover, survey;
    try {
      ({ discover, survey } = await mcpConnect({ endpoint: st.mcpEndpoint, token: st.token }));
    } catch (e) {
      st.connected = false;
      setChip("fail", "connect failed");
      connOut.textContent = String(e);
      connDetails.open = true;
      return false;
    }
    const ok = discover.ok && survey.ok;
    st.connected = ok;
    // Both answers are JSON; indented they can be read, on one line they cannot.
    const shown = (r) => clip(prettyJson(r.response) || r.response || "(no body)", 4000);
    st.connectText =
      `server/discover   HTTP ${discover.status}   ${duration(discover.ms)}\n`
    + `${shown(discover)}\n\n`
    + `survey op=connect HTTP ${survey.status}   ${duration(survey.ms)}\n`
    + `${shown(survey)}`;
    connOut.textContent = st.connectText;
    setChip(ok ? "ok" : "fail", ok ? "connected" : (discover.error || survey.error || "connect failed"));
    if (!ok) connDetails.open = true;
    return ok;
  }

  q(".exp-reconnect").addEventListener("click", doConnect);

  /* ── the session log ── */

  let refreshLog = null;
  q(".exp-session").addEventListener("click", () => {
    const showing = !sessionPanel.hidden;
    sessionPanel.hidden = showing;
    if (showing) return;
    if (!refreshLog) {
      refreshLog = renderSessionLog(sessionPanel, { host, account: accountName, token: st.token });
    } else {
      refreshLog();
    }
  });

  /* ── run ── */

  let running = false;

  async function run() {
    if (running) return;
    const text = (prompt.innerText || "").trim();
    if (!text) { setStatus("nothing to send"); return; }
    if (!st.llmKey) {
      connDetails.open = true;
      setStatus("set a provider key in Connection, above");
      q(".exp-llm-key")?.focus();
      return;
    }
    running = true;
    setStatus("running…");
    add({ kind: "note", title: "prompt", status: "note", response: text, responseLabel: "sent" });

    const onEvent = (e) => {
      switch (e.type) {
        case "tools":
          setStatus(e.ok ? `tools: ${e.names.join(", ")}` : "tools/list failed");
          add({
            kind: "mcp", title: "tools/list", status: e.ok ? "ok" : "fail", ms: e.ms,
            response: e.ok
              ? `offered:  ${e.names.join(", ")}\nwithheld: ${e.withheld.length ? e.withheld.join(", ") : "(none)"}`
              + `\n\nDeprecated spellings and anything outside the allow-list are not offered.`
              + `\nAccess itself is the service's to enforce: every relayed call carries this account's token.`
              : `${e.error}\n\nThe model will be asked without tools, and can then only answer from the prompt.`,
          });
          break;

        case "primer":
          add({ kind: "mcp", title: `resources/read ${e.uri}`, status: e.ok ? "ok" : "fail",
                ms: e.ms,
                response: e.ok
                  ? `${e.chars} characters folded into the system prompt.`
                  : `${e.error}\n\nWithout it the model has to guess the operations.` });
          break;

        case "assistant":
          add({
            kind: "llm", title: e.toolCalls ? `turn ${e.iteration} → ${e.toolCalls} call(s)` : `turn ${e.iteration}`,
            status: "ok", ms: e.ms, stopReason: e.stopReason,
            tokensIn: e.usage?.input_tokens, tokensOut: e.usage?.output_tokens,
            request: digestRequest(e.request) || e.request || null,
            requestLabel: "sent to the model",
            response: e.text || "(no text in this turn)", responseLabel: "answer", prose: true,
            raw: [{ label: "the request in full", text: e.request },
                  { label: "the response in full", text: e.response }],
            sparql: sparqlFrom(e.text || ""),
            open: !e.toolCalls,
          });
          setStatus(e.toolCalls ? "calling tools…" : "");
          break;

        case "tool_call":
          setStatus(`${e.name} ${e.input?.op || ""}…`.trim());
          break;

        case "tool_result":
          add({
            kind: "mcp", title: `${e.name} ${e.input?.op || ""}`.trim() + " · via LLM",
            status: e.ok ? "ok" : "fail", ms: e.ms, http: e.status,
            op: e.input?.op || null,
            // the cardinality the payload states belongs in the indicator line,
            // not buried in the body where it has to be hunted for
            rows: rowsIn(e.text),
            request: JSON.stringify(e.input || {}, null, 2), requestLabel: "arguments",
            response: e.text || "(empty payload)", responseLabel: "payload",
            raw: [{ label: "the JSON-RPC request", text: e.request }],
            sparql: sparqlFrom(e.text || ""),
          });
          break;

        case "session":
          add({ kind: "note", title: "exploration session", status: "note",
                response: `${e.session}\n\nEvery later call in this run carries this handle, `
                        + `so the operations form one tree in <${accountName}>/mcp.` });
          break;

        case "error":
          add({ kind: e.where === "provider" ? "llm" : "mcp", title: `error · ${e.where}`,
                status: "fail", ms: e.ms, http: e.status,
                response: `${e.error}`, raw: [{ label: "the response in full", text: e.response }] });
          break;

        default:
          break;
      }
    };

    try {
      const adapter = createToolAdapter({
        provider: st.llmProvider,
        endpoint: st.llmEndpoint,
        apiKey: st.llmKey,
        workspaceId: st.llmWorkspace,
        model: st.llmModel,
        mcp: st.mcpEndpoint ? { endpoint: st.mcpEndpoint, token: st.token } : null,
        onEvent,
      });
      const result = await adapter.run(text);
      st.session = result.session || st.session;
      setStatus(result.ok ? `done · ${result.iterations} turn(s)` : `failed · ${result.error}`);
      if (refreshLog && !sessionPanel.hidden) refreshLog();
    } catch (e) {
      add({ kind: "note", title: "run failed", status: "fail", response: String(e) });
      setStatus("failed");
    } finally {
      running = false;
    }
  }

  q(".exp-run").addEventListener("click", run);
  prompt.addEventListener("keydown", (e) => {
    // Enter makes a paragraph; the run is deliberate, so it takes a modifier.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
  });

  q(".exp-close").addEventListener("click", () => { wrapper.remove(); });

  const api = { wrapper, state: st, run, connect: doConnect, add };
  wrapper._explorationApi = api;

  // Connect on open: the pane is for exploring, and a first click that only
  // says "yes, really" is a ritual, not a decision.
  doConnect();
  prompt.focus();
  return api;
}

/* ─────────────────────────── the launcher ─────────────────────────── */

let launcherInstalled = false;

/**
 * One delegated handler for every Explore button on the page.
 *
 * Delegation rather than per-button binding because the repository pane is
 * rendered from more than one place and re-rendered on tab changes; a listener
 * on the document cannot be bound twice and cannot be missed.
 */
export function installExplorationLauncher(app) {
  if (launcherInstalled || typeof document === "undefined") return;
  launcherInstalled = true;
  document.addEventListener("click", (event) => {
    const btn = event.target.closest?.(".view-explore-btn");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const pane = btn.closest(".repository-pane");
    const container = pane?.querySelector(".view-editors-container");
    const accountName = btn.dataset.account || pane?.dataset.account;
    const repositoryName = btn.dataset.repository || pane?.dataset.repository;
    if (!container || !accountName || !repositoryName) {
      console.warn("[Exploration] no editor container for", accountName, repositoryName);
      return;
    }
    openExplorationPane(app, { container, accountName, repositoryName });
  }, true);
}

export default openExplorationPane;
