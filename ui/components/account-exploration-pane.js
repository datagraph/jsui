/**
 * The account's exploration pane (§34.4).
 *
 * The model connection became the account's in 2026-11-08, but it had no
 * surface of its own: the form that set it was drawn inside a repository's
 * exploration pane, and the one place a question could be asked across more
 * than one repository was the location bar -- a single line, with no choice of
 * stores, no transcript, and nowhere for an answer longer than a paragraph to
 * go.  So the connection read as a repository's property and the thing it
 * makes possible read as a trick of the chrome.
 *
 * This pane is where both belong.  It carries four things, in the order they
 * are needed:
 *
 *   1. The connection to the model -- location, key, workspace, model -- which
 *      is `connection-panel.js', the same controls the account's Connection
 *      tab draws, bound to the same object.  Typed here, it is set there.
 *   2. The stores: every MCP connection the session holds, each one offered
 *      with the state of its last handshake, and any repository the account
 *      may read offered to be connected.  Selecting more than one is what
 *      makes an analysis across a boundary askable rather than merely
 *      possible.  The connections are `lib/mcp/registry.js''s -- the same ones
 *      the repository panes present -- so a store connected in a pane appears
 *      here, and an exploration opened in either is continued by the other.
 *   3. The prompt, with what the press authorises stated beneath it before it
 *      is pressed (§35.2), and a way to stop a run that is going on too long.
 *   4. The transcript, drawn by `exchange-list.js', and beneath it the results:
 *      the answer, and whatever a dashboard or a figure draws from it.
 *
 * Nothing here is a second implementation of anything.  The budget, the brief
 * and the grant are `lib/llm/analysis-prompt.js''s and `lib/llm/grant.js''s --
 * the ones the location bar's data turn already runs under -- and the record
 * is `recordRun''s, one graph per store, as it has always been.
 */

import { createToolAdapter, ALLOW_TOOLS } from "../../lib/llm/tool-adapter.js";
import { analysisSystem, analysisBudget, analysisProgress } from "../../lib/llm/analysis-prompt.js";
import { createGrant } from "../../lib/llm/grant.js";
import { connectionFor, connectionRefusal, CONNECTION_PLACE } from "../../lib/app/connection.js";
import { ensureRepositories } from "../../lib/app/repositories.js";
import { recordRun } from "../../lib/mcp/transcript-store.js";
import { sparqlFrom } from "../../lib/mcp/mcp-client.js";
import { rowsIn, digestRequest } from "../../lib/format/transcript.js";
import {
  connections, connectedConnections, mcpConnectionFor, connectMcp, storesFor,
  sessionStore, onConnections, idFor,
} from "../../lib/mcp/registry.js";
import {
  createExchangeList, ensureExplorationStyle, duration, clip, prettyJson,
} from "./exchange-list.js";
import { renderConnectionInto } from "./connection-panel.js";
import { renderSessionLog } from "./session-log.js";
import { markStage } from "./provenance-note.js";
import { reportPage } from "../../lib/format/report.js";
import { saveControls } from "./report-controls.js";
import { openDashboardPane } from "./dashboard-pane.js";
import { openFigureGate } from "./figure-gate.js";
import { paneState } from "./mcp-pane-state.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slug = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "-");

/* ─────────────────────────── styling ─────────────────────────── */

/* The pane carries `.exploration-pane' as well, so the transcript, the chips
   and the blocks are the repository pane's and stay that way by construction.
   What is here is only what this pane has and that one does not. */
const STYLE = `
.account-exploration-pane { border: 1px solid #d7e0ea; border-radius: 4px;
  background: #fff; margin-bottom: 14px; }
.account-exploration-pane .exp-stores { border: 1px solid #e2e6ea; border-radius: 4px;
  background: #fff; margin-bottom: 6px; }
.account-exploration-pane .exp-stores > summary {
  cursor: pointer; padding: 4px 8px; list-style: none; display: flex;
  align-items: baseline; gap: 8px; user-select: none; }
.account-exploration-pane .exp-stores > summary::-webkit-details-marker { display: none; }
.account-exploration-pane .exp-stores > summary::before {
  content: "\\25B8"; color: #999; font-size: 10px; width: 9px; flex: none; }
.account-exploration-pane .exp-stores[open] > summary::before { content: "\\25BE"; }
.account-exploration-pane .exp-store-list { padding: 4px 10px 8px; }
.account-exploration-pane .exp-store {
  display: flex; align-items: center; gap: 8px; padding: 3px 0;
  border-bottom: 1px solid #f3f5f7; font-size: 12px; }
.account-exploration-pane .exp-store:last-child { border-bottom: none; }
.account-exploration-pane .exp-store-id { flex: 1 1 auto; font-family: ui-monospace, Menlo, monospace; }
.account-exploration-pane .exp-store-add {
  display: flex; align-items: center; gap: 6px; padding: 6px 0 0; font-size: 12px; }
.account-exploration-pane .exp-store-add select { font-size: 12px; padding: 2px 4px; max-width: 260px; }
.account-exploration-pane .exp-authorises {
  font-size: 11px; color: #555; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; padding: 6px 8px; margin: 0 0 8px; white-space: pre-wrap; }
.account-exploration-pane .exp-results:empty { display: none; }
.account-exploration-pane .exp-results {
  border-top: 1px solid #e8edf2; margin-top: 10px; padding-top: 8px; }
.account-exploration-pane .exp-answer {
  border: 1px solid #e2e6ea; border-radius: 4px; padding: 8px 10px; background: #fcfdfe;
  font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
`;

function ensureStyle(doc) {
  if (doc.getElementById("account-exploration-style")) return;
  const s = doc.createElement("style");
  s.id = "account-exploration-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/* ─────────────────────────── the pane ─────────────────────────── */

/**
 * Open (or reveal) the account's exploration pane in `container'.
 *
 * One per account, by construction: the pane IS the account's connection made
 * visible, and a second one would be a second opinion about a single object.
 */
export function openAccountExplorationPane(app, { container, accountName } = {}) {
  if (!container || !accountName) return null;
  const doc = container.ownerDocument || document;
  ensureExplorationStyle(doc);
  ensureStyle(doc);

  const id = `account-exploration-${slug(accountName)}`;
  const existing = doc.getElementById(id);
  if (existing) {
    existing.scrollIntoView({ behavior: "smooth", block: "start" });
    existing.querySelector(".exp-prompt")?.focus();
    return existing._explorationApi || null;
  }

  const auth = app?.state?.getAuthContext?.(accountName) || {};
  const host = auth.host || window.location.origin;
  const connection = connectionFor(accountName);

  /** The stores the next press would reach, by id.  The user's choice, kept. */
  const chosen = new Set();
  const exchanges = [];

  const wrapper = doc.createElement("div");
  wrapper.className = "exploration-pane account-exploration-pane";
  wrapper.id = id;
  wrapper.dataset.account = accountName;
  wrapper.dataset.testid = "account-exploration-pane";
  wrapper.innerHTML = `
    <div class="exp-head">
      <span>${esc(accountName)} · exploration</span>
      <button type="button" class="exp-close" data-testid="account-exploration-close"
              title="Close">×</button>
    </div>
    <div class="exp-body">
      <details class="exp-conn" data-testid="account-exploration-connection">
        <summary>
          <span>Model</span>
          <span class="exp-chip exp-chip-wait" data-testid="account-exploration-chip">no key</span>
        </summary>
        <div class="exp-conn-box" style="padding:6px 10px 8px;"></div>
      </details>

      <details class="exp-stores" data-testid="account-exploration-stores" open>
        <summary>
          <span>Stores</span>
          <span class="exp-chip exp-chip-wait"
                data-testid="account-exploration-stores-chip">none chosen</span>
        </summary>
        <div class="exp-store-list" data-testid="account-exploration-store-list"></div>
      </details>

      <div class="exp-prompt" contenteditable="true" data-testid="account-exploration-prompt"
           data-placeholder="Ask across the stores you have chosen…"></div>
      <div class="exp-actions">
        <button type="button" class="exp-run" data-testid="account-exploration-ask">Ask</button>
        <button type="button" class="exp-stop" data-testid="account-exploration-stop"
                hidden>Stop</button>
        <button type="button" class="exp-session" data-testid="account-exploration-session"
                >Session</button>
        <button type="button" class="exp-dashboard" data-testid="account-exploration-compose"
                title="Compose a page from several queries">Compose</button>
        <span class="exp-status" data-testid="account-exploration-status"></span>
      </div>
      <p class="exp-authorises" data-testid="account-exploration-authorises"></p>

      <div class="exp-session-panel" data-testid="account-exploration-session-panel" hidden
           style="border:1px solid #e2e6ea;border-radius:4px;padding:8px;margin-bottom:10px;"></div>

      <div class="exp-exchanges" data-testid="account-exploration-exchanges"></div>
      <div class="exp-results" data-testid="account-exploration-results"></div>
    </div>`;

  // §2.6 R-P2: the disclosure is on the screen while the content is, before
  // anything has run, so a reader sees "nothing here came from a model" become
  // a model and a date rather than a mark appearing from nowhere at the end.
  markStage(wrapper, null, { testid: "account-exploration-provenance" });
  container.insertBefore(wrapper, container.firstChild);

  const q = (sel) => wrapper.querySelector(sel);
  const connDetails = q(".exp-conn");
  const connChip = q(".exp-chip");
  const storesChip = q('[data-testid="account-exploration-stores-chip"]');
  const storeList = q(".exp-store-list");
  const prompt = q(".exp-prompt");
  const statusEl = q(".exp-status");
  const authorises = q(".exp-authorises");
  const askButton = q(".exp-run");
  const stopButton = q(".exp-stop");
  const sessionPanel = q(".exp-session-panel");
  const results = q(".exp-results");

  const setStatus = (s) => { statusEl.textContent = s || ""; };

  /* ── the model ── */

  renderConnectionInto(q(".exp-conn-box"), { accountName });
  const showConnection = () => {
    const ok = Boolean(connection.llmKey);
    connChip.className = `exp-chip exp-chip-${ok ? "ok" : "wait"}`;
    connChip.textContent = ok ? connection.llmModel : "no key";
  };
  // The panel writes straight to the account's connection, so there is nothing
  // to keep in step -- only the chip, which is this pane's own summary of it.
  wrapper.addEventListener("input", showConnection);
  wrapper.addEventListener("change", showConnection);
  showConnection();
  // Open when there is something to attend to, which is the one rule the
  // repository pane had and the only part of it worth keeping.
  if (!connection.llmKey) connDetails.open = true;

  /* ── the stores ── */

  // What the account may name, read once (REQ-33.2.7).  Offered as things to
  // connect; a repository that is already connected is listed from the
  // registry instead, with the state of its handshake.
  let permitted = [];
  ensureRepositories({ host, account: accountName, token: auth.token })
    .then((sets) => { permitted = sets.permitted || []; drawStores(); })
    .catch(() => { /* the registry's own entries are still listed */ });

  const describeBudget = () => {
    const ids = [...chosen];
    if (!ids.length) {
      authorises.textContent =
        "Choose at least one store. Nothing runs until Ask is pressed, and what it "
      + "would be allowed to do is stated here first.";
      return;
    }
    const budget = analysisBudget(ids.map((i) => ({ id: i })));
    authorises.textContent =
      `Ask would run an analysis across ${ids.length} `
    + `repositor${ids.length === 1 ? "y" : "ies"}:\n`
    + `${ids.map((i) => `  · ${i}`).join("\n")}\n`
    + `Up to ${budget.rounds} rounds of tool calls, ${budget.grant.maxQueries} calls in all, `
    + `read-only, for this run. Large results are read as their shape first; the answer `
    + `is recorded in \`${accountName}/mcp\` and the run can be stopped while it goes.`;
  };

  const showChosen = () => {
    const n = chosen.size;
    storesChip.className = `exp-chip exp-chip-${n ? "ok" : "wait"}`;
    storesChip.textContent = n ? `${n} chosen` : "none chosen";
    askButton.textContent = n > 1 ? `Ask across ${n}` : "Ask";
    describeBudget();
  };

  /** One row: what it is, whether it answered, and the one button it needs. */
  function storeRow(conn) {
    const row = doc.createElement("div");
    row.className = "exp-store";
    row.dataset.testid = `account-exploration-store-${slug(conn.id)}`;
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.dataset.testid = `account-exploration-choose-${slug(conn.id)}`;
    box.checked = chosen.has(conn.id);
    // A store that has not answered yet is chosen AND connected by the same
    // press: the choice is the intent, and a second click to say "yes, really"
    // is the ritual this pane exists to remove.
    box.addEventListener("change", async () => {
      if (box.checked) {
        chosen.add(conn.id);
        showChosen();
        if (conn.connected !== true) await connectStore(conn);
      } else {
        chosen.delete(conn.id);
        showChosen();
      }
    });
    const name = doc.createElement("span");
    name.className = "exp-store-id";
    name.textContent = conn.id;
    name.title = conn.mcpEndpoint;
    const chip = doc.createElement("span");
    const state = conn.connected === true ? "ok" : conn.connected === false ? "fail" : "wait";
    chip.className = `exp-chip exp-chip-${state}`;
    chip.dataset.testid = `account-exploration-state-${slug(conn.id)}`;
    chip.textContent = conn.connected === true ? "connected"
                     : conn.connected === false ? "failed" : "not connected";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "exp-addview";
    button.dataset.testid = `account-exploration-connect-${slug(conn.id)}`;
    button.textContent = conn.connected === true ? "Reconnect" : "Connect";
    button.addEventListener("click", () => connectStore(conn));
    row.append(box, name, chip, button);
    return row;
  }

  /** Connect one, and say so in the transcript: a handshake is an exchange. */
  async function connectStore(conn) {
    setStatus(`connecting ${conn.id}…`);
    const shown = (r) => clip(prettyJson(r.response) || r.response || "(no body)", 4000);
    const out = await connectMcp(conn, {
      format: ({ discover, survey }) =>
        `server/discover   HTTP ${discover.status}   ${duration(discover.ms)}\n`
      + `${shown(discover)}\n\n`
      + `survey op=connect HTTP ${survey.status}   ${duration(survey.ms)}\n`
      + `${shown(survey)}`,
    });
    add({ kind: "mcp", title: "connect", status: out.ok ? "ok" : "fail",
          repository: conn.id, response: conn.connectText || out.error || "" });
    setStatus(out.ok ? `${conn.id} connected` : `${conn.id}: ${out.error}`);
    return out.ok;
  }

  /** Every connection the session holds, plus what is left to connect. */
  function drawStores() {
    storeList.textContent = "";
    const held = connections();
    for (const conn of held) storeList.appendChild(storeRow(conn));
    if (!held.length) {
      const note = doc.createElement("div");
      note.style.cssText = "color:#777;font-size:12px;padding:2px 0 6px;";
      note.textContent = "No store is connected yet. Name one below, or open a repository's "
                       + "Explore pane — a connection made there appears here.";
      storeList.appendChild(note);
    }
    const known = new Set(held.map((c) => c.id));
    const free = permitted.filter((r) => r.readable !== false && !r.system && !known.has(r.id));
    const adder = doc.createElement("div");
    adder.className = "exp-store-add";
    const select = doc.createElement("select");
    select.dataset.testid = "account-exploration-add-store";
    select.innerHTML = `<option value="">add a repository…</option>`
      + free.map((r) => `<option value="${esc(r.id)}">${esc(r.id)}`
                      + `${r.interface ? " (the interface's own)" : ""}`
                      + `${r.own ? "" : " — collaboration"}</option>`).join("");
    select.disabled = free.length === 0;
    select.addEventListener("change", async () => {
      const picked = select.value;
      if (!picked) return;
      const [account, repository] = picked.split("/");
      const conn = mcpConnectionFor(account, repository, host);
      // The host token, for every store: authorization is the service's to
      // make, per resource, and a collaboration is exactly the case where
      // this token may read a repository of another account.
      conn.token = conn.token || auth.token || null;
      chosen.add(conn.id);
      select.value = "";
      drawStores();
      showChosen();
      await connectStore(conn);
    });
    adder.appendChild(select);
    storeList.appendChild(adder);
    showChosen();
  }

  // A pane that is open while a repository pane connects something should show
  // it without being reopened: the registry is the one place that knows.
  const unwatch = onConnections(() => { if (wrapper.isConnected) drawStores(); });

  // Every connection the session already holds gets this account's token, so
  // that a store listed here can be connected without opening its pane first.
  for (const conn of connections()) conn.token = conn.token || auth.token || null;
  drawStores();

  /* ── the transcript ── */

  const { add } = createExchangeList(wrapper.querySelector(".exp-exchanges"), {
    doc, store: exchanges, testid: "account-exploration",
    emptyText: "Nothing asked yet.",
    // A query the model wrote in a turn that carried several stores belongs to
    // the store the turn was reading, and the entry says which; where it does
    // not, this pane cannot know, and offering a view in the wrong repository
    // is worse than not offering one.
    addView: (entry) => {
      const where = entry.repository || (chosen.size === 1 ? [...chosen][0] : null);
      if (!where) { setStatus("that query names no repository to add it to"); return; }
      const [account, repository] = where.split("/");
      const url = `${(typeof window !== "undefined" && window.APP_BASE_PATH) || "/ui"}`
                + `/account/${encodeURIComponent(account)}`
                + `/repositories/${encodeURIComponent(repository)}`
                + `/views/new?query=${encodeURIComponent(entry.sparql)}`;
      if (app?.router?.navigate) app.router.navigate(url); else window.location.assign(url);
    },
    // U-13, across stores.  The gate runs the query itself and asks the model
    // to draw what came back, so it has to know WHICH repository to run it in;
    // the entry says, and where it does not the gate is not offered, because
    // running one repository's query against another is not a near miss.
    draw: (entry, gateHolder) => {
      const where = entry.repository || (chosen.size === 1 ? [...chosen][0] : null);
      if (!where) { setStatus("that query names no repository to draw it from"); return null; }
      const [account, repository] = where.split("/");
      const st = paneState(account, repository, host);
      return openFigureGate(gateHolder, {
        doc, host, account, repository, state: st,
        prompt: entry.promptText || "", text: entry.response || "",
        query: entry.sparql, session: st.session, ran: [],
        onStatus: setStatus,
        onDone: ({ figure, recorded }) => {
          add({ kind: "note", title: `figure · ${figure.disposition || "drawn"}`,
                status: recorded?.ok ? "ok" : "fail", repository: where,
                response: `${figure.kind} figure, drawn from ${figure.rows ?? "?"} row(s) `
                        + `of ${figure.mimeType || "the result"} (digest ${figure.resultDigest}).\n`
                        + (recorded?.ok
                            ? `Recorded in <${recorded.graph}>.`
                            : `Not recorded: ${recorded?.error}`) });
        },
      });
    },
  });

  /* ── the session log ── */

  let refreshLog = null;
  q(".exp-session").addEventListener("click", () => {
    const showing = !sessionPanel.hidden;
    sessionPanel.hidden = showing;
    if (showing) return;
    if (!refreshLog) {
      refreshLog = renderSessionLog(sessionPanel, { host, account: accountName,
                                                    token: auth.token });
    } else refreshLog();
  });

  /* ── composing a page ── */

  // A dashboard is granted authority once, up front, over one repository (D-O),
  // so it is offered when exactly one store is chosen and refused otherwise --
  // with the reason, rather than by a control that is simply dead.
  q(".exp-dashboard").addEventListener("click", () => {
    if (chosen.size !== 1) {
      setStatus(chosen.size
        ? "a composed page is granted over one repository; choose one store"
        : "choose a store to compose from");
      return;
    }
    const [account, repository] = [...chosen][0].split("/");
    openDashboardPane(app, { container: results, accountName: account,
                             repositoryName: repository,
                             prompt: (prompt.innerText || "").trim() });
  });

  /* ── the run ── */

  let running = false;
  let stopReason = null;
  /** The question the last run was given, which the saved page states. */
  let lastAsked = "";

  stopButton.addEventListener("click", () => {
    stopReason = "stopped from the exploration pane";
    stopButton.disabled = true;
    setStatus("stopping after this call…");
  });

  async function ask() {
    if (running) return;
    const text = (prompt.innerText || "").trim();
    if (!text) { setStatus("nothing to ask"); return; }
    if (!connection.llmKey) {
      connDetails.open = true;
      setStatus(connectionRefusal("nothing was asked"));
      add({ kind: "note", title: "no model is connected", status: "fail",
            response: `${connectionRefusal("nothing was asked")}\n\n`
                    + `The Model panel at the top of this pane is ${CONNECTION_PLACE}.` });
      return;
    }
    const stores = storesFor([...chosen]);
    if (!stores.length) {
      setStatus("choose at least one store");
      return;
    }
    const unreachable = [...chosen].filter((i) =>
      connectedConnections().every((c) => c.id !== i));
    if (unreachable.length) {
      add({ kind: "note", title: "asking anyway", status: "note",
            response: `${unreachable.join(", ")} has not answered a handshake. `
                    + `The turn will still offer the model its tools; a store that `
                    + `cannot be reached reports that per call rather than failing the run.` });
    }

    running = true;
    stopReason = null;
    stopButton.hidden = false;
    stopButton.disabled = false;
    askButton.disabled = true;
    const started = new Date();
    lastAsked = text;
    const ids = stores.map((s) => `${s.account}/${s.repository}`);
    add({ kind: "note", title: "prompt", status: "note", response: text,
          responseLabel: `asked of ${ids.join(", ")}` });

    const budget = analysisBudget(ids.map((i) => ({ id: i })));
    const grant = createGrant(budget.grant);
    const watch = analysisProgress(setStatus, { rounds: budget.rounds });

    // The same events the repository pane draws, with the store named on each
    // one -- which is the single addition a multi-store transcript needs.
    const onEvent = (e) => {
      watch.onEvent(e);
      switch (e.type) {
        case "tools":
          add({ kind: "mcp", title: "tools/list", status: e.ok ? "ok" : "fail", ms: e.ms,
                repository: e.repository,
                response: e.ok
                  ? `offered:  ${e.names.join(", ")}\nwithheld: `
                  + `${e.withheld.length ? e.withheld.join(", ") : "(none)"}`
                  : `${e.error}\n\nThe model will be asked without this store's tools.` });
          break;
        case "primer":
          add({ kind: "mcp", title: `resources/read ${e.uri}`, status: e.ok ? "ok" : "fail",
                ms: e.ms, repository: e.repository,
                response: e.ok ? `${e.chars} characters folded into the system prompt.`
                               : `${e.error}` });
          break;
        case "assistant":
          add({ kind: "llm",
                title: e.toolCalls ? `turn ${e.iteration} → ${e.toolCalls} call(s)`
                                   : `turn ${e.iteration}`,
                status: "ok", ms: e.ms, stopReason: e.stopReason,
                tokensIn: e.usage?.input_tokens, tokensOut: e.usage?.output_tokens,
                request: digestRequest(e.request) || e.request || null,
                requestLabel: "sent to the model",
                promptText: text,
                response: e.text || "(no text in this turn)", responseLabel: "answer",
                prose: true,
                raw: [{ label: "the request in full", text: e.request },
                      { label: "the response in full", text: e.response }],
                sparql: sparqlFrom(e.text || ""),
                open: !e.toolCalls });
          break;
        case "tool_result":
          add({ kind: "mcp", title: `${e.name} ${e.input?.op || ""}`.trim(),
                status: e.ok ? "ok" : "fail", ms: e.ms, http: e.status,
                repository: e.repository, op: e.input?.op || null,
                rows: rowsIn(e.text),
                request: JSON.stringify(e.input || {}, null, 2), requestLabel: "arguments",
                response: e.text || "(empty payload)", responseLabel: "payload",
                raw: [{ label: "the JSON-RPC request", text: e.request }],
                sparql: sparqlFrom(e.text || "") });
          break;
        case "session_lost":
          add({ kind: "note", title: `session refused · ${e.repository || ""}`.trim(),
                status: "fail", repository: e.repository,
                response: `${e.text}\n\n`
                        + `The store issued this handle and then refused it. `
                        + (e.recovering
                            ? `A new exploration is being opened and the call repeated once; `
                            + `the operations before this point belong to the handle that was lost.`
                            : `It could not be reopened here, so the model is told what happened `
                            + `and may connect again itself.`) });
          break;
        case "session_retry":
          add({ kind: "note", title: `call repeated · ${e.repository || ""}`.trim(),
                status: e.ok ? "ok" : "fail", repository: e.repository,
                response: e.ok
                  ? `Answered on the second attempt, under a new handle.`
                  : `Refused again under a new handle. This is the store's, not the `
                  + `model's: the handle it issued is not one it will accept.` });
          break;
        case "session":
          add({ kind: "note", title: `exploration session · ${e.repository || ""}`.trim(),
                status: "note", repository: e.repository,
                response: `${e.session}\n\n`
                        + (e.carried
                            ? `Carried from an exploration already open on this repository, `
                            + `so this run joins it rather than starting a second one.`
                            : `Every later call to this store carries this handle, so the `
                            + `operations form one tree in <${accountName}>/mcp.`) });
          break;
        case "error":
          add({ kind: e.where === "provider" ? "llm" : "mcp", title: `error · ${e.where}`,
                status: "fail", ms: e.ms, http: e.status, repository: e.repository,
                response: `${e.error}`,
                raw: [{ label: "the response in full", text: e.response }] });
          break;
        default: break;
      }
    };

    let out = null;
    try {
      const adapter = createToolAdapter({
        provider: connection.llmProvider, endpoint: connection.llmEndpoint,
        apiKey: connection.llmKey, workspaceId: connection.llmWorkspace,
        model: connection.llmModel,
        mcp: { repositories: stores },
        allowTools: ALLOW_TOOLS,
        system: analysisSystem({ stores: ids.map((i) => ({ id: i })), asked: text,
                                 rounds: budget.rounds, answerTokens: budget.answerTokens }),
        maxIterations: budget.rounds,
        maxTokens: budget.answerTokens,
        digestOver: budget.digestOver,
        grant,
        sessions: sessionStore(),
        stop: () => stopReason,
        onEvent,
      });
      out = await adapter.run(text);
    } catch (e) {
      add({ kind: "note", title: "the model could not be asked", status: "fail",
            response: String(e) });
      setStatus("failed");
      running = false; stopButton.hidden = true; askButton.disabled = false;
      return null;
    }

    // One record per store, not one for the turn: each repository is its own
    // exploration with its own handle, and the events say which store they
    // belong to (§34.3; §35.4).
    const kept = [];
    for (const store of stores) {
      const sid = idFor(store.account, store.repository);
      const events = (out.events || []).filter((e) => !e.repository || e.repository === sid);
      let note;
      try {
        note = await recordRun({ host, account: accountName, token: auth.token,
                                 repository: sid, session: (out.sessions || {})[sid] || null,
                                 prompt: text, started, result: { ...out, events } });
      } catch (e) { note = { ok: false, error: String(e) }; }
      // A record written in several requests can land in part.  Said as
      // "partly", because "not recorded" would send a reader looking for
      // nothing when most of it is there (§34.6).
      kept.push(note?.ok
        ? `recorded: ${sid} → ${note.graph}`
        : (note?.wrote
            ? `partly recorded: ${sid} → ${note.graph} `
            + `(${note.wrote} of ${note.parts} parts; ${note.error})`
            : `not recorded: ${sid} (${note?.error || "unknown"})`));
    }

    // Article 50 (§2.6): the model as SERVED, the stores it read, the date --
    // stated by the interface, never by the model.
    markStage(wrapper, { model: out.model, servedModel: out.servedModel, served: out.served,
                         provider: out.provider, endpoint: out.endpoint, at: out.at,
                         account: accountName, repository: ids.join(", ") });

    const spent = watch.calls.map(([i, n]) => `${i} ${n}`).join(", ") || `${watch.total()} calls`;
    const cutShort = out.roundsExhausted
      ? ` · the exploration was stopped at the ${out.iterations}-round limit` : "";
    const footer = `— ${out.servedModel || out.model}`
                 + `${out.served ? "" : " (requested, not confirmed)"}`
                 + ` · ${spent} · ${new Date().toISOString().slice(0, 10)}${cutShort}`;

    showAnswer(out, footer, kept);
    add({ kind: "note", title: "transcript", status: kept.every((k) => k.startsWith("recorded"))
            ? "ok" : "fail",
          response: kept.join("\n") });
    // A run that reached no store did not answer the question, whatever it
    // wrote (§34.5).  Said here rather than left to the reader of a footer
    // that says `0 calls\', because the prose above it reads like an answer.
    if (out.ok && !out.calls) {
      add({ kind: "note", title: "nothing was asked of any store", status: "fail",
            response: `The model took ${out.iterations} turn(s) and made no tool call, `
                    + `so what it wrote above is written from the question and the `
                    + `brief alone -- not from these repositories. Read the tools/list `
                    + `entries above: if no tool was offered, the run had nothing to `
                    + `call.` });
    }
    setStatus(out.ok
                ? (out.calls ? `done · ${out.iterations} turn(s)`
                             : `answered nothing · no store was read`)
                : `failed · ${out.error}`);
    if (refreshLog && !sessionPanel.hidden) refreshLog();
    running = false;
    stopButton.hidden = true;
    askButton.disabled = false;
    return out;
  }

  /**
   * The answer, where a report can be read (§35.4).
   *
   * Beneath the transcript rather than inside it: a transcript entry is one
   * exchange and collapses, and a report of several thousand words that
   * collapses into a summary line is a report nobody reads.  It is also where
   * a composed page and a figure are placed, so that everything the run
   * produced is in one column under the question that produced it.
   */
  function showAnswer(out, footer, kept) {
    const box = doc.createElement("div");
    box.className = "exp-answer";
    box.dataset.testid = "account-exploration-answer";
    const body = doc.createElement("div");
    body.textContent = out.finalText || out.error || "(no answer)";
    const foot = doc.createElement("div");
    foot.style.cssText = "margin-top:8px;color:#777;font-size:11px;white-space:pre-wrap;";
    foot.textContent = `${footer}\n${kept.join("\n")}`;
    box.append(body, foot, reportControls(out, footer, kept));
    results.insertBefore(box, results.firstChild);
  }

  /**
   * What this pane's report is made of (§34.7).
   *
   * The controls themselves come from `report-controls.js', because keeping
   * a report means the same thing in both panes.  What belongs to this pane
   * is what goes into it -- several stores, one record line per store, and
   * the question as it was asked across all of them.
   *
   * The page is rendered when the button is pressed, not here: the transcript
   * write may still be in flight as the answer appears, and a report rendered
   * early would say "not recorded" for a record that landed a second later.
   */
  function reportControls(out, footer, kept) {
    return saveControls(doc, {
      testid: "account-exploration",
      account: accountName,
      onStatus: setStatus,
      page: () => reportPage({
        title: `Exploration — ${[...chosen].join(", ") || accountName}`,
        asked: out.asked || lastAsked,
        answer: out.finalText || out.error || "",
        stores: out.repositories || [...chosen],
        stage: footer.replace(/^—\s*/, ""),
        records: kept,
        exchanges: exchanges.map((x) => ({ title: x.title, repository: x.repository,
                                           status: x.status, ms: x.ms })),
        at: new Date(), account: accountName,
      }),
    });
  }

  askButton.addEventListener("click", ask);
  prompt.addEventListener("keydown", (e) => {
    // Enter makes a paragraph; the press is the authorisation, so it takes a
    // modifier -- the same rule the repository pane's prompt follows.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(); }
  });

  q(".exp-close").addEventListener("click", () => {
    unwatch();
    unregister?.();
    wrapper.remove();
  });

  // U-77: the location bar can address this pane, so a question typed there
  // can be sent here instead of to the chrome -- and so an arrangement verb
  // has somewhere to land.  The pane takes an instruction as a prompt, which
  // is exactly what it is.
  const unregister = app?.registerTarget?.({
    id: `exploration/${accountName}`, label: "exploration", kind: "presentation",
    element: () => wrapper,
    instruct: async (line) => {
      prompt.innerText = String(line || "");
      const out = await ask();
      if (!out) return { ok: false, message: "the exploration pane could not ask" };
      return out.ok
        ? { ok: true, message: (out.finalText || "").split("\n").find((l) => l.trim())
                              || "answered — the report is in the exploration pane",
            detail: out.finalText }
        : { ok: false, message: out.error, detail: out.finalText || "" };
    },
  });

  const api = { wrapper, ask, add, chosen, results,
                choose: (sid) => { chosen.add(sid); drawStores(); showChosen(); } };
  wrapper._explorationApi = api;
  showChosen();
  prompt.focus();
  return api;
}

/* ─────────────────────────── the launcher ─────────────────────────── */

let launcherInstalled = false;

/**
 * One delegated handler for the exploration tab in the account's left margin.
 *
 * Delegation for the same reason the Explore button uses it: the account pane
 * is rendered from more than one place and re-rendered on tab changes, and a
 * listener on the document cannot be bound twice and cannot be missed.
 */
export function installAccountExplorationLauncher(app) {
  if (launcherInstalled || typeof document === "undefined") return;
  launcherInstalled = true;
  document.addEventListener("click", (event) => {
    const tab = event.target.closest?.(".exploration-tab");
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    const pane = tab.closest(".account-pane");
    const container = pane?.querySelector(".account-pane-content");
    const accountName = tab.dataset.account || pane?.dataset.account;
    if (!container || !accountName) return;
    const open = container.querySelector(".account-exploration-pane");
    // The tab toggles: a second press closes what the first opened, which is
    // what a tab in a margin is taken to do.
    if (open) {
      open.querySelector(".exp-close")?.click();
      tab.classList.remove("open");
      return;
    }
    openAccountExplorationPane(app, { container, accountName });
    tab.classList.add("open");
  }, true);
}

export default openAccountExplorationPane;
