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
 */

import { listSessions, readSession } from "../../lib/mcp/session-log.js";
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

function paintDetail(doc, el, session) {
  el.innerHTML = "";
  if (!session) {
    el.innerHTML = `<div class="sl-none">Select a session.</div>`;
    return;
  }
  el.appendChild(headerEl(doc, session));
  if (!session.nodes.length) {
    const none = doc.createElement("div");
    none.className = "sl-none";
    none.textContent = "This session recorded no operations.";
    el.appendChild(none);
    return;
  }
  const holder = doc.createElement("div");
  holder.dataset.testid = "session-log-nodes";
  for (const node of session.nodes) holder.appendChild(nodeEl(doc, node, session));
  el.appendChild(holder);
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
  let selected = null;

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
    listEl.innerHTML = sessions.length
      ? sessions.map((s) => sessionRow(s, s.uri === selected?.uri)).join("")
      : `<div class="sl-none">No sessions recorded.</div>`;
    listEl.querySelectorAll(".session-log-item").forEach((b) => {
      b.addEventListener("click", () => open(b.dataset.uri));
    });
  };

  async function open(uri) {
    say("reading…");
    const res = await readSession({ host, account, token, sessionUri: uri });
    if (!res.ok) { say(`read failed: ${res.error}`); return; }
    selected = res.session;
    paintList();
    paintDetail(doc, detailEl, selected);
    say(`${selected.nodes.length} operation(s) · ${duration(res.ms)}`);
  }

  async function refresh() {
    say("loading…");
    const res = await listSessions({ host, account, token });
    if (!res.ok) {
      // the account may simply have no exploration repository yet, which is not
      // an error worth dressing up as one
      sessions = [];
      paintList();
      detailEl.innerHTML = `<div class="sl-none">${esc(res.error)}</div>`;
      say("");
      return;
    }
    sessions = res.sessions;
    paintList();
    say(`${sessions.length} session(s) · ${duration(res.ms)}`);
    if (sessions.length && !selected) await open(sessions[0].uri);
    else paintDetail(doc, detailEl, selected);
  }

  container.querySelector(".session-log-refresh").addEventListener("click", refresh);
  refresh();
  return refresh;
}

export default renderSessionLog;
