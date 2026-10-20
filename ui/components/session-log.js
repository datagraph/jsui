/**
 * The session log, presented.
 *
 * The record is already ordered, already timestamped and already a tree -- the
 * work here is to show it as what it is: a sequence of operations, each with
 * what it was asked and what it returned, indented where the exploration
 * branched.  Nothing is fetched twice: a session is read when it is selected.
 *
 * This reads <account>/mcp, which is the account's store of explorations, so it
 * shows sessions from every repository in the account and says which repository
 * each belongs to rather than filtering to the current one.  A session is worth
 * finding again precisely when you have forgotten where you were.
 *
 * Legibility is the point of the layout.  An operation is a row of aligned
 * columns -- time, name, mark, operation, what it was given, what it returned --
 * because a column that always holds the same thing can be read down rather
 * than across; and a row whose parameters are longer than the column opens, so
 * that the long case does not set the width for every short one.
 *
 * Three records, read together.  The operations come from the service's own
 * exploration graph and say what ran; the transcript comes from the graph the
 * browser writes beside it and says what was shown -- the prompt, the documents
 * the model read, its prose, and the payload of every call it made; and the
 * JOURNAL comes from the MCP endpoint itself and says what was asked of the
 * service, by whom, against which repository, and what it answered.  Separate
 * graphs because the service rewrites its own from scratch on every operation;
 * one view because the question a reader has is about one run, not about which
 * process recorded which part of it.
 *
 * The journal is the only one of the three that covers a client other than this
 * page.  An autonomous model holding a token runs no exploration and writes no
 * transcript, so under the first two records its traffic was invisible; the
 * endpoint records every call it serves, and this pane lists those days beside
 * the explorations.  A session also shows the calls that drove it, joined by
 * the handle the call carried.
 */

import { listSessions, readSession, listJournals, readJournal, readSessionRequests }
  from "../../lib/mcp/session-log.js";
import { readTranscript } from "../../lib/mcp/transcript-store.js";
import { mountFigure } from "../../lib/figure/frame.js";
import { formatBlock, prettyJson, duration } from "../../lib/format/transcript.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const when = (date) => (date ? date.toLocaleString() : "—");

/** HH:MM:SS of a date, for the per-operation column. */
const clock = (date) => (date ? date.toTimeString().slice(0, 8) : "");

/** "4m ago", "yesterday" — what the list column wants, rather than a full date. */
function ago(date) {
  if (!date) return "—";
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  return date.toLocaleDateString();
}

const STATUS_MARK = { complete: "✓", evaluating: "…", error: "✗" };

const STYLE = `
.session-log { font-size: 12px; }
.session-log .sl-cols { display: flex; gap: 10px; min-height: 160px; }
.session-log .sl-list { width: 186px; flex: none; max-height: 330px; overflow: auto; }
.session-log .sl-detail { flex: 1; min-width: 0; max-height: 330px; overflow: auto; }

.session-log .sl-item {
  display: block; width: 100%; text-align: left; cursor: pointer;
  border: 1px solid #ddd; background: #fff; border-radius: 3px;
  padding: 4px 6px; margin-bottom: 4px; font-size: 11px; }
.session-log .sl-item:hover { background: #f7f9fb; }
.session-log .sl-item.sl-on { border-color: #9ab89a; background: #f3faf3; }
.session-log .sl-item .sl-id {
  font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
.session-log .sl-item .sl-repo { color: #555; }
.session-log .sl-item .sl-ago  { color: #999; }

.session-log .sl-head { margin-bottom: 8px; }
.session-log .sl-head .sl-head-id {
  font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 600; }
.session-log .sl-head .sl-head-meta { color: #666; }
.session-log .sl-head dl {
  display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; margin: 4px 0 0; }
.session-log .sl-head dt { color: #8a94a0; font-size: 11px; }
.session-log .sl-head dd { margin: 0; font-size: 11px; }

.session-log .sl-node {
  display: flex; gap: 8px; align-items: baseline;
  padding: 3px 4px; border-bottom: 1px solid #f1f3f5; }
.session-log .sl-node:hover { background: #fafbfc; }
.session-log .sl-node.sl-active { background: #f3faf3; }
.session-log .sl-caret { width: 9px; flex: none; color: #bbb; font-size: 9px; }
.session-log .sl-caret::before { content: "\\25B8"; }
.session-log details.sl-more[open] .sl-caret::before { content: "\\25BE"; }
.session-log .sl-caret-none::before { content: ""; }
.session-log .sl-t    { width: 54px; flex: none; color: #999;
                        font-family: ui-monospace, Menlo, monospace; }
.session-log .sl-n    { width: 26px; flex: none; color: #777;
                        font-family: ui-monospace, Menlo, monospace; }
.session-log .sl-m    { width: 12px; flex: none; }
.session-log .sl-op   { width: 86px; flex: none; font-weight: 600; }
.session-log .sl-args { flex: 1 1 auto; min-width: 0; color: #444;
                        font-family: ui-monospace, Menlo, monospace;
                        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-log .sl-rows { width: 62px; flex: none; text-align: right; color: #666; }
.session-log .sl-error .sl-m { color: #a33; }

.session-log details.sl-more { border: none; background: transparent; margin: 0; }
.session-log details.sl-more > summary {
  list-style: none; cursor: pointer; display: block; }
.session-log details.sl-more > summary::-webkit-details-marker { display: none; }
.session-log details.sl-more > summary::marker { content: ""; }
.session-log details.sl-more > div { padding: 2px 4px 7px 70px; }
.session-log pre.sl-pre {
  margin: 0; padding: 5px 7px; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  white-space: pre-wrap; word-break: break-word; max-height: 190px; overflow: auto; }
.session-log .sl-foot { margin-top: 6px; }
.session-log .sl-foot button { padding: 3px 10px; cursor: pointer; font-size: 11px; }
.session-log .sl-status { margin-left: 8px; color: #666; font-size: 11px; }
.session-log .sl-none { color: #999; padding: 6px 2px; }
.session-log .sl-section {
  margin: 10px 0 4px; padding-top: 7px; border-top: 1px solid #e6e9ec;
  font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .04em; }
.session-log .sl-run > summary { cursor: pointer; list-style: none; padding: 3px 2px; }
.session-log .sl-run > summary::-webkit-details-marker { display: none; }
.session-log .sl-run > summary::marker { content: ""; }
.session-log .sl-run-line { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.session-log .sl-run-prompt {
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #222; }
.session-log .sl-run-meta { color: #777; font-size: 11px; }
.session-log .sl-x { margin-left: 16px; }
.session-log .sl-x > summary { cursor: pointer; list-style: none; }
.session-log .sl-x > summary::-webkit-details-marker { display: none; }
.session-log .sl-x > summary::marker { content: ""; }
.session-log .sl-x-line {
  display: grid; grid-template-columns: 14px 22px 12px 88px 1fr auto;
  gap: 6px; align-items: baseline; padding: 2px 2px;
  font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
.session-log .sl-x-line:hover { background: #f6f8fa; }
.session-log .sl-x-sent .sl-x-kind { color: #8a5a17; }
.session-log .sl-x-received .sl-x-kind { color: #1f4e79; }
.session-log .sl-x-n { color: #999; text-align: right; }
.session-log .sl-x-what { color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-log .sl-x-size { color: #777; }
.session-log .sl-x > div { padding: 2px 4px 7px 36px; }

.session-log .sl-item.sl-journal { border-left: 3px solid #cbd5dd; }
.session-log .sl-item.sl-journal.sl-on { border-color: #9ab89a; }
.session-log .sl-item .sl-date { font-family: ui-monospace, Menlo, monospace; }
.session-log .sl-req > summary { cursor: pointer; list-style: none; }
.session-log .sl-req > summary::-webkit-details-marker { display: none; }
.session-log .sl-req > summary::marker { content: ""; }
.session-log .sl-req-line {
  display: grid; grid-template-columns: 9px 54px 76px 12px 150px 1fr auto;
  gap: 6px; align-items: baseline; padding: 2px 2px;
  border-bottom: 1px solid #f1f3f5; font-size: 11px; }
.session-log .sl-req-line:hover { background: #fafbfc; }
.session-log .sl-req-agent { color: #1f4e79; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.session-log .sl-req-what { font-family: ui-monospace, Menlo, monospace; color: #333;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-log .sl-req-note { color: #666; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.session-log .sl-req-size { color: #777; text-align: right; }
.session-log .sl-req-error .sl-m { color: #a33; }
.session-log .sl-req > div { padding: 2px 4px 7px 70px; }
.session-log .sl-pre-label { color: #8a94a0; font-size: 10px; margin: 4px 0 1px;
  text-transform: uppercase; letter-spacing: .04em; }
`;

function ensureStyle(doc) {
  if (doc.getElementById("session-log-style")) return;
  const s = doc.createElement("style");
  s.id = "session-log-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/** A one-line digest of what an operation was given. */
function argsLine(node) {
  const raw = node.parameters || node.shape || "";
  if (!raw) return "";
  const pretty = prettyJson(raw);
  if (pretty) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return Object.entries(o)
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join("  ");
      }
    } catch { /* fall through to the raw text */ }
  }
  return String(raw).replace(/\s+/g, " ").trim();
}

/** True when there is more to show than the row's own columns can hold. */
function hasMore(node) {
  const raw = node.parameters || node.shape || "";
  return Boolean(prettyJson(raw)) || String(raw).length > 60 || Boolean(node.suggestions);
}

function sessionRow(session, selected) {
  return `
    <button type="button" class="sl-item session-log-item${selected ? " sl-on" : ""}"
            data-uri="${esc(session.uri)}"
            data-testid="session-log-item-${esc(session.id)}">
      <div class="sl-id">${esc(session.id.slice(0, 8))}</div>
      <div class="sl-repo">${esc(session.repository || "—")}</div>
      <div class="sl-ago">${esc(ago(session.lastActive))}</div>
    </button>`;
}

function journalRow(journal, on) {
  const id = `${journal.repository || "?"} ${journal.date || ""}`.trim();
  return `
    <button type="button" class="sl-item sl-journal session-log-journal${on ? " sl-on" : ""}"
            data-uri="${esc(journal.uri)}"
            data-testid="session-log-journal-${esc(journal.date || journal.uri)}">
      <div class="sl-date">${esc(journal.date || "—")}</div>
      <div class="sl-repo">${esc(journal.repository || "—")}</div>
      <div class="sl-ago">requests</div>
    </button>`;
}

/** "tools/call sparql", or just the method when it names no tool. */
function requestWhat(r) {
  return [r.method || "—", r.tool].filter(Boolean).join(" ");
}

/** What it cost and what it carried, in one column. */
function requestSize(r) {
  const bits = [];
  if (r.responseSize != null) {
    bits.push(r.responseSize > 2048 ? `${Math.round(r.responseSize / 1024)}kB`
                                    : `${r.responseSize} ch`);
  }
  if (r.truncated) bits.push("cut");
  if (r.duration != null) bits.push(duration(r.duration));
  return bits.join(" · ");
}

/**
 * One journalled call.  The line is the audit answer -- who, what, against
 * what, how it ended -- and it opens onto the two messages, which are the
 * evidence for it.
 */
function requestEl(doc, r) {
  const mark = r.status === "error" ? "✗" : r.status === "complete" ? "✓" : "·";
  const note = [r.errorCode != null ? `error ${r.errorCode}` : null,
                r.client, r.era, r.exploration ? "exploration" : null]
    .filter(Boolean).join(" · ");
  const line = doc.createElement("div");
  line.className = `sl-req-line${r.status === "error" ? " sl-req-error" : ""}`;
  line.innerHTML = `
    <span class="sl-caret"></span>
    <span class="sl-t">${esc(clock(r.startedAt))}</span>
    <span class="sl-req-agent" title="${esc(r.agent || "")}">${esc(r.agent || "—")}</span>
    <span class="sl-m">${mark}</span>
    <span class="sl-req-what" title="${esc(requestWhat(r))}">${esc(requestWhat(r))}</span>
    <span class="sl-req-note" title="${esc(note)}">${esc(note)}</span>
    <span class="sl-req-size">${esc(requestSize(r))}</span>`;

  const d = doc.createElement("details");
  d.className = "sl-req";
  // -call-, not -request-: the two <pre>s below are -request- and -response-,
  // and a row named the same as the payload inside it is ambiguous to address
  d.dataset.testid = `session-log-call-${r.id}`;
  const sum = doc.createElement("summary");
  sum.appendChild(line);
  d.appendChild(sum);
  const body = doc.createElement("div");
  for (const [label, text, size] of [["request", r.request, r.requestSize],
                                     ["response", r.response, r.responseSize]]) {
    const h = doc.createElement("div");
    h.className = "sl-pre-label";
    h.textContent = label;
    body.appendChild(h);
    const pre = doc.createElement("pre");
    pre.className = "sl-pre";
    pre.dataset.testid = `session-log-${label}-${r.id}`;
    const { body: shown } = formatBlock(text || "");
    pre.textContent = (size != null && text && size > text.length)
      ? `${shown}\n\n… cut at ${text.length} of ${size} characters`
      : (shown || "—");
    body.appendChild(pre);
  }
  d.appendChild(body);
  return d;
}

function requestsEl(doc, requests, heading) {
  const holder = doc.createElement("div");
  holder.dataset.testid = "session-log-requests";
  if (heading) {
    const h = doc.createElement("div");
    h.className = "sl-section";
    h.textContent = heading;
    holder.appendChild(h);
  }
  if (!requests || !requests.length) {
    const none = doc.createElement("div");
    none.className = "sl-none";
    none.textContent = "No calls recorded.";
    holder.appendChild(none);
    return holder;
  }
  for (const r of requests) holder.appendChild(requestEl(doc, r));
  return holder;
}

function journalHeaderEl(doc, journal, requests) {
  const agents = [...new Set((requests || []).map((r) => r.agent).filter(Boolean))];
  const errors = (requests || []).filter((r) => r.status === "error").length;
  const h = doc.createElement("div");
  h.className = "sl-head";
  h.innerHTML = `
    <div class="sl-head-id">${esc(journal.date || "—")}</div>
    <dl>
      <dt>repository</dt><dd>${esc(journal.repository || "—")}</dd>
      <dt>calls</dt><dd>${esc(String((requests || []).length))}${errors ? ` · ${esc(String(errors))} failed` : ""}</dd>
      <dt>agents</dt><dd>${esc(agents.join(", ") || "—")}</dd>
    </dl>`;
  return h;
}

function nodeEl(doc, node, session) {
  const mark = STATUS_MARK[node.status] || "·";
  const args = argsLine(node);
  const rows = node.resultCount == null ? ""
             : `${node.resultCount} row${node.resultCount === 1 ? "" : "s"}`;
  const active = node.name === session.activeNode;

  const row = doc.createElement("div");
  row.className = `sl-node session-log-node${active ? " sl-active" : ""}`
                + `${node.status === "error" ? " sl-error" : ""}`;
  row.dataset.testid = `session-log-node-${node.name}`;
  row.style.marginLeft = `${node.depth * 16}px`;
  // Every row carries the caret column, open or not, so the time column starts
  // at the same place whether or not there is more to show.
  row.innerHTML = `
    <span class="sl-caret${hasMore(node) ? "" : " sl-caret-none"}"></span>
    <span class="sl-t">${esc(clock(node.startedAt))}</span>
    <span class="sl-n">${esc(node.name)}</span>
    <span class="sl-m" title="${esc(node.status || "")}">${mark}</span>
    <span class="sl-op">${esc(node.operation || "—")}</span>
    <span class="sl-args" title="${esc(args)}">${esc(args)}</span>
    <span class="sl-rows">${esc(rows)}</span>`;

  if (!hasMore(node)) return row;

  // The long case gets its own disclosure rather than widening every row.
  const d = doc.createElement("details");
  d.className = "sl-more";
  const sum = doc.createElement("summary");
  sum.appendChild(row);
  d.appendChild(sum);
  const body = doc.createElement("div");
  const raw = node.parameters || node.shape || "";
  if (raw) {
    const { kind, body: text } = formatBlock(raw);
    const pre = doc.createElement("pre");
    pre.className = `sl-pre sl-kind-${kind}`;
    pre.textContent = text;
    body.appendChild(pre);
  }
  if (node.suggestions) {
    const pre = doc.createElement("pre");
    pre.className = "sl-pre";
    pre.textContent = `suggestions: ${node.suggestions}`;
    body.appendChild(pre);
  }
  d.appendChild(body);
  return d;
}

/* ── the transcript ──────────────────────────────────────────────────────── */

const KIND_MARK = {
  prompt: "✎", primer: "§", tools: "⚙", assistant: "✓",
  tool_call: "→", tool_result: "←", error: "✗",
  // Phase 2 and Phase 3 of the figure path.  `execute' is the one exchange
  // the INTERFACE made rather than the model, and it is marked differently
  // for that reason: reading down the column, the moment the run stopped
  // being the model's should be visible without reading the words.
  execute: "⇶", figure: "▦", refused: "⊘", digest: "≈",
};

/** What an exchange was, in the width of a column. */
function exchangeWhat(x) {
  if (x.kind === "tool_call" || x.kind === "tool_result") {
    return [x.tool, x.op].filter(Boolean).join(" ") || x.kind;
  }
  if (x.kind === "primer") return x.document || "primer";
  if (x.kind === "execute") return x.document ? `run view ${x.document}` : "run query";
  if (x.kind === "figure") return `figure · ${x.document || "svg"}`;
  if (x.kind === "assistant") return `turn ${x.iteration ?? ""}`.trim();
  if (x.kind === "error") return x.error || "error";
  return x.kind;
}

/** What it carried, in the same width. */
function exchangeSize(x) {
  const bits = [];
  if (x.rows != null) bits.push(`${x.rows} row${x.rows === 1 ? "" : "s"}`);
  if (x.bytes != null) bits.push(x.bytes > 2048 ? `${Math.round(x.bytes / 1024)}kB` : `${x.bytes} ch`);
  if (x.truncated) bits.push("cut");
  if (x.ms != null) bits.push(duration(x.ms));
  return bits.join(" · ");
}

function exchangeEl(doc, x) {
  const line = doc.createElement("div");
  line.className = `sl-x-line sl-x-${x.direction || "received"}`;
  line.innerHTML = `
    <span class="sl-caret"></span>
    <span class="sl-x-n">${esc(x.ordinal ?? "")}</span>
    <span class="sl-x-kind" title="${esc(x.kind || "")}">${KIND_MARK[x.kind] || "·"}</span>
    <span class="sl-x-what" title="${esc(exchangeWhat(x))}">${esc(exchangeWhat(x))}</span>
    <span class="sl-x-args" title="${esc(x.arguments || "")}">${esc(x.arguments || "")}</span>
    <span class="sl-x-size">${esc(exchangeSize(x))}</span>`;

  // An exchange with nothing in it is a line; one that carried content opens,
  // because the content is the reason the record was kept.
  if (!x.content) { line.classList.add("sl-x-flat"); return line; }
  const d = doc.createElement("details");
  d.className = "sl-x";
  d.dataset.testid = `session-log-exchange-${x.ordinal}`;
  d.dataset.kind = x.kind || "";
  const sum = doc.createElement("summary");
  sum.appendChild(line);
  d.appendChild(sum);
  const body = doc.createElement("div");

  // D-N keeps the figure with its result, and a record of a picture that
  // shows only its source is a record nobody opens.  It is previewed in the
  // same script-free frame the pane used (lib/figure/frame.js), because the
  // policy is a property of the figure, not of the pane that happened to
  // mount it first: a session log that inlined the SVG instead would be the
  // one place in the application where model-authored markup runs.
  if (x.kind === "figure" && x.content) {
    const holder = doc.createElement("div");
    holder.className = "sl-figure";
    holder.dataset.testid = `session-log-figure-${x.ordinal}`;
    let caption = null, engine = null;
    try {
      const a = JSON.parse(x.arguments || "{}");
      caption = a.caption || null;
      engine = a.engine || null;
    } catch { /* none */ }
    try {
      // A DOT figure in the log is laid out again on replay, by the same
      // engine that drew it the first time: the record keeps the source,
      // which is the thing worth keeping, and the picture is derived from it
      // here as it was there.
      mountFigure(holder, { kind: x.document === "dot" ? "dot" : "svg", text: x.content },
                  { caption, engine, doc, minHeight: 120, maxHeight: 460,
                    meta: { rows: x.rows, resultDigest: null } });
      body.appendChild(holder);
    } catch { /* the source below is still the record */ }
  }

  const { kind, body: text } = formatBlock(x.content);
  const pre = doc.createElement("pre");
  pre.className = `sl-pre sl-kind-${kind}`;
  pre.dataset.testid = `session-log-content-${x.ordinal}`;
  pre.textContent = x.truncated ? `${text}\n\n… cut at ${text.length} of ${x.bytes} characters` : text;
  body.appendChild(pre);
  d.appendChild(body);
  return d;
}

function runEl(doc, run) {
  const d = doc.createElement("details");
  d.className = "sl-run";
  d.dataset.testid = `session-log-run-${run.id}`;
  d.open = true;
  const sum = doc.createElement("summary");
  const meta = [run.ended ? clock(run.ended) : "", `${run.exchanges.length} exchange(s)`,
                run.iterations != null ? `${run.iterations} turn(s)` : "",
                run.ok ? "" : "failed"].filter(Boolean).join(" · ");
  sum.innerHTML = `
    <div class="sl-run-line">
      <span class="sl-caret"></span>
      <span class="sl-run-prompt" title="${esc(run.prompt || "")}">${esc(run.prompt || "(no prompt)")}</span>
      <span class="sl-run-meta">${esc(meta)}</span>
    </div>`;
  d.appendChild(sum);
  const body = doc.createElement("div");
  for (const x of run.exchanges) body.appendChild(exchangeEl(doc, x));
  if (run.error) {
    const pre = doc.createElement("pre");
    pre.className = "sl-pre";
    pre.textContent = run.error;
    body.appendChild(pre);
  }
  d.appendChild(body);
  return d;
}

/**
 * The transcript section.  Absent is not empty: a session explored from
 * somewhere other than this pane has operations and no transcript, and saying
 * so is more use than showing nothing.
 */
function transcriptEl(doc, transcript) {
  const wrap = doc.createElement("div");
  wrap.dataset.testid = "session-log-transcript";
  const head = doc.createElement("div");
  head.className = "sl-section";
  const runs = transcript?.runs || [];
  const model = transcript?.model ? ` · ${transcript.model}` : "";
  head.textContent = runs.length
    ? `transcript — what the model was shown${model}`
    : "transcript";
  wrap.appendChild(head);
  if (!runs.length) {
    const none = doc.createElement("div");
    none.className = "sl-none";
    none.textContent = transcript?.ok === false
      ? `No transcript read: ${transcript.error}`
      : "No transcript was recorded for this session.";
    wrap.appendChild(none);
    return wrap;
  }
  for (const run of runs) wrap.appendChild(runEl(doc, run));
  return wrap;
}

function headerEl(doc, session) {
  const h = doc.createElement("div");
  h.className = "sl-head";
  h.innerHTML = `
    <div class="sl-head-id">${esc(session.id)}</div>
    <dl>
      <dt>repository</dt><dd>${esc(session.repository || "—")}</dd>
      <dt>opened</dt><dd>${esc(when(session.created))}</dd>
      <dt>last active</dt><dd>${esc(when(session.lastActive))} · ${esc(ago(session.lastActive))}</dd>
      <dt>version</dt><dd>${esc(session.version ?? "—")}</dd>
      <dt>active node</dt><dd>${esc(session.activeNode || "—")}</dd>
    </dl>`;
  return h;
}

function paintDetail(doc, el, view) {
  el.innerHTML = "";
  if (!view) {
    el.innerHTML = `<div class="sl-none">Select a session or a day's requests.</div>`;
    return;
  }
  if (view.kind === "journal") {
    el.appendChild(journalHeaderEl(doc, view.journal, view.requests));
    el.appendChild(requestsEl(doc, view.requests));
    return;
  }
  const session = view.session;
  el.appendChild(headerEl(doc, session));
  if (!session.nodes.length) {
    const none = doc.createElement("div");
    none.className = "sl-none";
    none.textContent = "This session recorded no operations.";
    el.appendChild(none);
  } else {
    const holder = doc.createElement("div");
    holder.dataset.testid = "session-log-nodes";
    for (const node of session.nodes) holder.appendChild(nodeEl(doc, node, session));
    el.appendChild(holder);
  }
  el.appendChild(transcriptEl(doc, view.transcript));
  // The calls that drove the operations above: the same run seen from the
  // endpoint rather than from the orchestrator, and the only part of it a
  // client other than this page would also have produced.
  el.appendChild(requestsEl(doc, view.requests, "calls"));
}

/**
 * Render the log into CONTAINER.  Returns a function that refreshes the list,
 * so a caller that has just run an exploration can show it without rebuilding
 * the pane.
 */
export function renderSessionLog(container, { host, account, token }) {
  if (!container) return () => {};
  const doc = container.ownerDocument || document;
  ensureStyle(doc);
  let sessions = [];
  let journals = [];
  let view = null;        // what the detail pane is showing
  let selectedUri = null; // and which list row is lit

  container.innerHTML = `
    <div class="session-log" data-testid="session-log">
      <div class="sl-cols">
        <div class="sl-list session-log-list" data-testid="session-log-list"></div>
        <div class="sl-detail session-log-detail" data-testid="session-log-detail"></div>
      </div>
      <div class="sl-foot">
        <button type="button" class="session-log-refresh" data-testid="session-log-refresh">Refresh</button>
        <span class="sl-status session-log-status" data-testid="session-log-status"></span>
      </div>
    </div>`;

  const listEl = container.querySelector(".session-log-list");
  const detailEl = container.querySelector(".session-log-detail");
  const statusEl = container.querySelector(".session-log-status");
  const say = (s) => { statusEl.textContent = s; };

  const paintList = () => {
    const parts = [];
    if (sessions.length) {
      parts.push(`<div class="sl-section">explorations</div>`);
      parts.push(...sessions.map((s) => sessionRow(s, s.uri === selectedUri)));
    }
    if (journals.length) {
      parts.push(`<div class="sl-section">requests</div>`);
      parts.push(...journals.map((j) => journalRow(j, j.uri === selectedUri)));
    }
    listEl.innerHTML = parts.length
      ? parts.join("")
      : `<div class="sl-none">Nothing recorded yet.</div>`;
    // .sl-item, not .session-log-item: both kinds of row carry it, and the
    // handler tells them apart by the journal class rather than by two queries
    listEl.querySelectorAll(".sl-item").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.classList.contains("sl-journal")) openJournal(b.dataset.uri);
        else openSession(b.dataset.uri);
      });
    });
  };

  async function openSession(uri) {
    say("reading…");
    // Three records at once: they are separate graphs for the writers' sake,
    // and one run for the reader's.
    const [res, tr, calls] = await Promise.all([
      readSession({ host, account, token, sessionUri: uri }),
      readTranscript({ host, account, token, exploration: uri }),
      readSessionRequests({ host, account, token, sessionUri: uri }),
    ]);
    if (!res.ok) { say(`read failed: ${res.error}`); return; }
    selectedUri = uri;
    view = { kind: "session", session: res.session, transcript: tr,
             requests: calls.ok ? calls.requests : [] };
    paintList();
    paintDetail(doc, detailEl, view);
    const kept = (tr.runs || []).reduce((n, r) => n + r.exchanges.length, 0);
    say(`${res.session.nodes.length} operation(s)`
      + (kept ? ` · ${kept} exchange(s) recorded` : "")
      + (view.requests.length ? ` · ${view.requests.length} call(s)` : "")
      + ` · ${duration(res.ms)}`);
  }

  async function openJournal(uri) {
    say("reading…");
    const res = await readJournal({ host, account, token, journalUri: uri });
    if (!res.ok) { say(`read failed: ${res.error}`); return; }
    selectedUri = uri;
    const journal = journals.find((j) => j.uri === uri) || { uri };
    view = { kind: "journal", journal, requests: res.requests };
    paintList();
    paintDetail(doc, detailEl, view);
    say(`${res.requests.length} call(s) · ${duration(res.ms)}`);
  }

  async function refresh() {
    say("loading…");
    // One store, two questions; a failure on either is not a reason to show
    // neither, so they are reported separately and the pane shows what it got.
    const [s, j] = await Promise.all([
      listSessions({ host, account, token }),
      listJournals({ host, account, token }),
    ]);
    sessions = s.ok ? s.sessions : [];
    journals = j.ok ? j.journals : [];
    paintList();
    if (!s.ok && !j.ok) {
      // the account may simply have no exploration repository yet, which is not
      // an error worth dressing up as one
      detailEl.innerHTML = `<div class="sl-none">${esc(s.error)}</div>`;
      say("");
      return;
    }
    say(`${sessions.length} session(s) · ${journals.length} day(s) of requests`
      + ` · ${duration(Math.max(s.ms || 0, j.ms || 0))}`);
    if (!selectedUri && sessions.length) await openSession(sessions[0].uri);
    else if (!selectedUri && journals.length) await openJournal(journals[0].uri);
    else paintDetail(doc, detailEl, view);
  }

  container.querySelector(".session-log-refresh").addEventListener("click", refresh);
  refresh();
  return refresh;
}

export default renderSessionLog;
