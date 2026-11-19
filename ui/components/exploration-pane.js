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
 *   1. Connection -- this repository's MCP resource, and nothing else.  The
 *      endpoint and the token come from the session; it connects on open, so
 *      the pane is usable without a first ritual click, and it opens itself
 *      when there is something to attend to.
 *   2. The prompt, with Run and Session beside it.
 *   3. The transcript, drawn by `exchange-list.js'.
 *   4. The session log, when asked for -- the durable half of the same record.
 *
 * **Changed 2026-11-15 (§34.4).**  The model's endpoint, key, workspace and
 * model used to be typed HERE, which is how a credential that belongs to the
 * user came to be presented as a property of the repository being examined.
 * They moved to the account's connection in 2026-11-08 but the FORM stayed,
 * and a form is where a user thinks a thing lives: with no key set this pane
 * sprang its panel open, so the first place anyone met the key field was
 * inside one repository's surface.  The form is gone.  What is presented here
 * is what is genuinely this repository's -- the button, the handshake, and
 * the calls that follow -- and the connection it presents is held centrally
 * in `lib/mcp/registry.js', so the account's exploration pane can offer this
 * repository as a store and continue the exploration this pane opened.
 *
 * Entries are appended, never re-rendered, so an entry opened for reading stays
 * open while the run continues underneath it.
 */

import { sparqlFrom } from "../../lib/mcp/mcp-client.js";
import { createToolAdapter, FIGURE_TOOLS, DEFAULT_SYSTEM } from "../../lib/llm/tool-adapter.js";
import { figureSystem } from "../../lib/llm/figure-prompt.js";
import { openFigureGate } from "./figure-gate.js";
import { queriesRan } from "../../lib/figure/provenance.js";
import { markStage } from "./provenance-note.js";
import { renderSessionLog } from "./session-log.js";
import { recordRun } from "../../lib/mcp/transcript-store.js";
import { reportPage } from "../../lib/format/report.js";
import { saveControls } from "./report-controls.js";
import { paneState, paneStore } from "./mcp-pane-state.js";
import { connectionRefusal, CONNECTION_PLACE } from "../../lib/app/connection.js";
import { openDashboardPane } from "./dashboard-pane.js";
import {
  createExchangeList, ensureExplorationStyle, duration, clip, prettyJson,
} from "./exchange-list.js";
import { mcpConnectionFor, connectMcp, sessionStore } from "../../lib/mcp/registry.js";
import { rowsIn, digestRequest } from "../../lib/format/transcript.js";

const BASE_PATH = (typeof window !== "undefined" && window.APP_BASE_PATH) || "/ui";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clock = (d) => d.toTimeString().slice(0, 8);

const slug = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "-");

/* ─────────────────────────── the pane ─────────────────────────── */

export function openExplorationPane(app, { container, accountName, repositoryName }) {
  if (!container) return null;
  const doc = container.ownerDocument || document;
  ensureExplorationStyle(doc);

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
  // The same object the registry holds; `st' is a window onto it, and the
  // handshake is performed against the connection rather than against the
  // pane, so a second surface sees it happen.
  const conn = mcpConnectionFor(accountName, repositoryName, host);

  // Every query this exploration actually sent, across all of its runs.  The
  // figure gate compares its proposal against these: the query in a turn's
  // prose was typed again, and a retyped query can lose its `FROM' clause
  // without losing anything a reader would notice.  Kept here rather than on
  // the entry, because the exploration is the unit -- a query sent in the
  // first run is still what ran when a gate opens under the third.
  const ran = [];
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
        <div class="exp-conn-note" data-testid="exploration-conn-note"
             style="font-size:11px;color:#666;padding:2px 0 4px;">
          This is the connection to <b>this repository's</b> MCP resource, and it is
          shared: the account's exploration pane offers it as a store once it is
          connected, and a run started there continues the exploration started here
          (§34.4). The model is connected once, for the account, in
          ${esc(CONNECTION_PLACE)}.
        </div>
        <div class="exp-conn-grid">
          <label for="${id}-mcp">MCP</label>
          <input id="${id}-mcp" type="text" class="exp-mcp-endpoint"
                 data-testid="exploration-mcp-endpoint" value="${esc(st.mcpEndpoint)}" />
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
        <button type="button" class="exp-dashboard" data-testid="exploration-dashboard"
                title="Compose a page from several queries">Compose</button>
        <label class="exp-mode" title="Ask for a figure drawn from the result, in three steps:
explore, propose a query, then draw from what the interface fetched">
          <input type="checkbox" class="exp-figure-mode"
                 data-testid="exploration-figure-mode" /> Figure
        </label>
        <span class="exp-status" data-testid="exploration-status"></span>
      </div>

      <div class="exp-save-slot" data-testid="exploration-save-slot"></div>

      <div class="exp-session-panel" data-testid="exploration-session-panel" hidden
           style="border:1px solid #e2e6ea;border-radius:4px;padding:8px;margin-bottom:10px;"></div>

      <div class="exp-exchanges" data-testid="exploration-exchanges"></div>
    </div>`;

  // §2.6 R-P2: the disclosure is on the screen while the content is, in a
  // small face at the foot of the pane.  Added before anything has run, so a
  // reader sees "nothing here came from a model" become a model and a date
  // rather than a mark appearing from nowhere at the end.
  markStage(wrapper, null, { testid: "exploration-provenance" });
  container.appendChild(wrapper);

  const q = (sel) => wrapper.querySelector(sel);
  const connDetails = q(".exp-conn");
  const chip = q(".exp-chip");
  const connOut = q(".exp-conn-out");
  const prompt = q(".exp-prompt");
  const statusEl = q(".exp-status");
  const list = q(".exp-exchanges");
  const sessionPanel = q(".exp-session-panel");
  const saveSlot = q(".exp-save-slot");
  const figureMode = q(".exp-figure-mode");

  const setStatus = (s) => { statusEl.textContent = s || ""; };
  const setChip = (kind, text) => {
    chip.className = `exp-chip exp-chip-${kind}`;
    chip.textContent = text;
  };

  // The endpoint is the registry's, so a correction typed here is the
  // correction everywhere -- including in a run started from the account's
  // pane, which used to derive its own and could not be told otherwise.
  q(".exp-mcp-endpoint").addEventListener("change", (e) => {
    st.mcpEndpoint = e.target.value.trim();
  });

  /* ── the transcript ── */

  // Drawn by `exchange-list.js', which the account's exploration pane draws
  // with too.  What is this pane's own is what it can do with a query: it
  // knows which repository one belongs to, so it can offer the view and the
  // figure that the account's pane, carrying several stores, has to ask about.
  const { add } = createExchangeList(list, {
    doc, store: st.exchanges, testid: "exploration",
    addView: (entry) => {
      // jsui owns view creation; hand the query over.  views/new reads ?query=.
      const url = `${BASE_PATH}/account/${encodeURIComponent(accountName)}`
                + `/repositories/${encodeURIComponent(repositoryName)}`
                + `/views/new?query=${encodeURIComponent(entry.sparql)}`;
      if (app?.router?.navigate) app.router.navigate(url); else window.location.assign(url);
    },
    draw: (entry, gateHolder) => openFigureGate(gateHolder, {
      doc, host, account: accountName, repository: repositoryName, state: st,
      prompt: entry.promptText || st.lastPrompt || "",
      text: entry.response || "", query: entry.sparql, session: st.session,
      ran: ran.slice(),
      onStatus: setStatus,
      onDone: ({ figure, recorded }) => {
        add({ kind: "note", title: `figure · ${figure.disposition || "drawn"}`,
              status: recorded?.ok ? "ok" : "fail",
              response: `${figure.kind} figure, drawn from ${figure.rows ?? "?"} row(s) `
                      + `of ${figure.mimeType || "the result"} (digest ${figure.resultDigest}).\n`
                      + (figure.promotedTo ? `Kept as the view ${figure.promotedTo}.\n` : "")
                      + (recorded?.ok
                          ? `Recorded in <${recorded.graph}>, with the query and the result digest.`
                          : `Not recorded: ${recorded?.error}`) });
      },
    }),
  });

  /* ── connect ── */

  // The handshake itself is the registry's (§34.4): whichever surface presses
  // the button, every other surface sees the result.  What stays here is the
  // presentation of it -- the chip, and the two answers laid out so they can
  // be read -- because this is the repository's pane and that is where a
  // repository's connection is presented.
  async function doConnect() {
    setChip("wait", "connecting…");
    connOut.textContent = "";
    const shown = (r) => clip(prettyJson(r.response) || r.response || "(no body)", 4000);
    const out = await connectMcp(conn, {
      format: ({ discover, survey }) =>
        `server/discover   HTTP ${discover.status}   ${duration(discover.ms)}\n`
      + `${shown(discover)}\n\n`
      + `survey op=connect HTTP ${survey.status}   ${duration(survey.ms)}\n`
      + `${shown(survey)}`,
    });
    connOut.textContent = st.connectText;
    setChip(out.ok ? "ok" : "fail", out.ok ? "connected" : (out.error || "connect failed"));
    if (!out.ok) connDetails.open = true;
    return out.ok;
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

  /* ── the dashboard pane ── */

  // A dashboard is not a bigger exploration, it is a different shape of
  // consent: authority granted once up front rather than a query confirmed at
  // the end (D-O).  So it opens its own pane, beside this one, seeded with
  // whatever has been typed here -- the prompt is usually most of the way
  // there already, and retyping it is the kind of friction that stops people
  // trying the thing at all.
  q(".exp-dashboard").addEventListener("click", () => {
    openDashboardPane(app, {
      container, accountName, repositoryName,
      prompt: (prompt.innerText || "").trim(),
    });
  });

  /* ── run ── */

  let running = false;

  async function run() {
    if (running) return;
    const text = (prompt.innerText || "").trim();
    if (!text) { setStatus("nothing to send"); return; }
    if (!st.llmKey) {
      // The pane no longer holds a key field to open, because the key is not
      // this repository's (§34.1).  So it says where the setting is, in the
      // one wording every other surface uses, and stops.
      setStatus(connectionRefusal("nothing was asked"));
      add({ kind: "note", title: "no model is connected", status: "fail",
            response: `${connectionRefusal("nothing was asked")}\n\n`
                    + `The exploration tab in the account's left margin carries the `
                    + `same setting, beside the choice of stores to ask across.` });
      return;
    }
    running = true;
    const started = new Date();
    // Where this run's entries begin in the pane's transcript, so the report
    // can carry its own exchanges rather than every exchange the pane has
    // held since it was opened.
    const from = st.exchanges.length;
    // The last run's controls go now rather than when this one finishes: a
    // run that throws leaves none, and a button that saves the PREVIOUS
    // answer under a pane that is reporting a failure is a trap.
    saveSlot.replaceChildren();
    // The gate opened under a later turn needs the question the run started
    // from: a figure drawn without it is a generic rendering of the columns
    // rather than an answer to what was asked.
    st.lastPrompt = text;
    const figuring = figureMode.checked;
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
            promptText: text,
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
          ran.push(...queriesRan([e]));
          break;

        case "session_lost":
          add({ kind: "note", title: "session refused", status: "fail",
                response: `${e.text}\n\n`
                        + `The store issued this handle and then refused it. `
                        + (e.recovering
                            ? `A new exploration is being opened and the call repeated once.`
                            : `It could not be reopened here.`) });
          break;

        case "session_retry":
          add({ kind: "note", title: "call repeated", status: e.ok ? "ok" : "fail",
                response: e.ok ? `Answered on the second attempt, under a new handle.`
                               : `Refused again under a new handle.` });
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
        // The repository this pane reads, in the shape the adapter routes on:
        // one store, named, so that every event the turn produces says which
        // repository the call went to (REQ-34.3.5).
        mcp: paneStore(st),
        // The exploration handles outlive the run (§34.4.3): a second Run in
        // this pane, and a run started from the account's pane, continue the
        // exploration the first one opened rather than opening another.
        sessions: sessionStore(),
        // Figure mode changes two things and nothing else: the model is told
        // that drawing is step 3 and that this call ends at a proposal
        // (U-12), and `query' joins the offered tools, because a figure is
        // drawn from a query and a model that can only survey must guess at
        // what its own SPARQL would return (U-11).  The argument screen in
        // the adapter is what keeps that from being a write tool.
        ...(figuring ? { system: figureSystem(DEFAULT_SYSTEM),
                         allowTools: FIGURE_TOOLS } : {}),
        onEvent,
      });
      const result = await adapter.run(text);
      st.session = result.session || st.session;
      // What produced what is now on this pane (§2.6 R-P2).  The identifier
      // is the one the provider SERVED: the model asked for is the request,
      // and the request is not the fact a reconstruction needs.
      st.lastProvenance = {
        model: result.model, servedModel: result.servedModel, served: result.served,
        provider: result.provider, endpoint: result.endpoint, at: result.at,
        account: accountName, repository: repositoryName,
      };
      markStage(wrapper, st.lastProvenance);
      if (result.ok && !result.calls) {
        add({ kind: "note", title: "nothing was asked of this repository", status: "fail",
              response: `The model took ${result.iterations} turn(s) and made no tool call, `
                      + `so what it wrote is written from the question alone -- not from `
                      + `this repository.` });
      }
      setStatus(result.ok
                  ? (result.calls ? `done · ${result.iterations} turn(s)`
                                  : `answered nothing · the repository was not read`)
                  : `failed · ${result.error}`);

      // Keep the run.  The service records which operations ran; only this side
      // ever saw what they returned, or what the model was told, so if it is
      // not written here it is not written anywhere.  A failed run is recorded
      // too: what it got through before it stopped is the part worth reading.
      const kept = await recordRun({
        host, account: accountName, token: st.token,
        repository: `${accountName}/${repositoryName}`,
        session: st.session, result, prompt: text, started,
      });
      add({
        kind: "note", title: "transcript",
        status: kept.ok ? "ok" : (kept.wrote ? "note" : "fail"),
        ms: kept.ms,
        response: kept.ok
          ? `${kept.exchanges} exchange(s) written to <${kept.graph}> `
          + `in ${kept.parts} request(s)\n\n`
          + `in <${accountName}>/mcp, beside the exploration the service records. `
          + `The payloads are kept whole, so what the model read can be read again.`
          // A record written in several requests can land in part: what did
          // land is in the graph and is worth saying so, because "not
          // recorded" would send a reader looking for nothing (§32.2).
          : (kept.wrote
              ? `partly recorded: ${kept.wrote} of ${kept.parts} part(s) written `
              + `to <${kept.graph}>\n\n${kept.error}`
              : `not recorded: ${kept.error}\n\n`
              + `The run itself is unaffected; the record of it is what is missing.`),
      });
      // The report, where it can be kept (§34.8).  Offered for a failed run
      // too: a run that stopped halfway still wrote down what it read, and
      // that is the copy somebody will want to send on.
      showReport(result, text, kept, st.exchanges.slice(from));
      if (refreshLog && !sessionPanel.hidden) refreshLog();
    } catch (e) {
      add({ kind: "note", title: "run failed", status: "fail", response: String(e) });
      setStatus("failed");
    } finally {
      running = false;
    }
  }

  /* ── keeping the report ── */

  /**
   * The run, as a page that can be kept (§34.8).
   *
   * The account's pane has an answer box to hang these on; this one has a
   * transcript, whose entries collapse -- so the controls sit under the
   * actions, where they are in view whether or not the turn that holds the
   * answer is open.  They appear once there is something to keep and are
   * replaced by each run, because the one anybody wants is the last one.
   *
   * What is reported is this repository: one store, one record line, and the
   * exchanges of this run alone.  The Article 50 line is composed here in the
   * same shape the account's pane uses -- the model AS SERVED, what was asked
   * of the store, and the date -- because the saved copy is the one that
   * leaves the interface that would otherwise be stating it.
   */
  function showReport(result, asked, kept, mine) {
    const id = `${accountName}/${repositoryName}`;
    const line = kept?.ok
      ? `recorded: ${id} → ${kept.graph}`
      : (kept?.wrote
          ? `partly recorded: ${id} → ${kept.graph} `
          + `(${kept.wrote} of ${kept.parts} parts; ${kept.error})`
          : `not recorded: ${id} (${kept?.error || "unknown"})`);
    const stage = `${result.servedModel || result.model || "an unidentified model"}`
                + `${result.served ? "" : " (requested, not confirmed)"}`
                + ` · ${id} ${result.calls || 0} call(s)`
                + ` · ${new Date().toISOString().slice(0, 10)}`;

    saveSlot.replaceChildren(saveControls(doc, {
      testid: "exploration",
      account: `${accountName}-${repositoryName}`,
      onStatus: setStatus,
      page: () => reportPage({
        title: `Exploration — ${id}`,
        asked,
        answer: result.finalText || result.error || "",
        stores: [id],
        stage,
        records: [line],
        exchanges: mine.map((x) => ({ title: x.title, repository: id,
                                      status: x.status, ms: x.ms })),
        at: new Date(), account: accountName,
      }),
    }));
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
