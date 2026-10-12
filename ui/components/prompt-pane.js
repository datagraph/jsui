/**
 * The prompt pane: compose a prompt, send it to MCP or to an LLM, and keep each
 * answer in its own timestamped tab beneath the prompt.
 *
 * Shape of the thing (plan §4b.3):
 *   - a prompt editor that holds text AND links, so a prompt can cite a view or
 *     a repository by URL and still be edited as prose;
 *   - a target: MCP or LLM;
 *   - execute;
 *   - below, a stack of response tabs, newest last, each labelled by the time it
 *     was sent and by its target.
 *
 * When either target yields a SPARQL query, the pane offers to register it as a
 * view.  It hands the query to jsui's own view creation through
 *   /account/:a/repositories/:r/views/new?query=…
 * rather than writing a view itself -- the same seam the MCP prototype stops at:
 * "the exploration is the draft; the view is the artifact".
 *
 * Credentials.  The MCP endpoint and token come from the session: this pane is
 * already inside an authenticated account.  The LLM location and bearer key are
 * typed into the page, exactly as the dydra host and token are, and are held in
 * memory for the life of the page like AuthStore's -- so the key is per client
 * instance by construction, not by a policy that has to be enforced.
 */

import {
  connect as mcpConnect, runOperation, payloadOf, sparqlFrom,
} from "../../lib/mcp/mcp-client.js";
import { createToolAdapter } from "../../lib/llm/tool-adapter.js";
import { renderSessionLog } from "./session-log.js";
// Shared with the exploration pane that opens beside the view editors, so a
// provider key typed in either is present in both.
import { paneState } from "./mcp-pane-state.js";
import { locationControl, modelControl, bindLlmSettings } from "./llm-settings.js";

const BASE_PATH = (typeof window !== "undefined" && window.APP_BASE_PATH) || "/ui";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const stamp = (d) => d.toTimeString().slice(0, 8);

/** Turn bare URLs in a prompt into real links, so a prompt can carry references. */
function linkify(html) {
  return html.replace(/(^|[\s>])((?:https?:\/\/)[^\s<]+)/g,
                      (_, pre, url) => `${pre}<a href="${esc(url)}" target="_blank">${esc(url)}</a>`);
}

function template(st) {
  return `
  <div class="prompt-pane" style="display:flex;flex-direction:column;gap:10px;padding:8px;">
    <div class="prompt-settings" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;">
      <label>MCP
        <input type="text" data-testid="prompt-mcp-endpoint" class="prompt-mcp-endpoint"
               value="${esc(st.mcpEndpoint)}" style="width:320px;font-size:12px;padding:2px 4px;" />
      </label>
      <label>LLM
        ${locationControl(st, { testid: "prompt-llm-endpoint" })}
      </label>
      <label>key
        <input type="password" data-testid="prompt-llm-key" class="prompt-llm-key"
               placeholder="api key" value="${esc(st.llmKey)}"
               style="width:120px;font-size:12px;padding:2px 4px;" />
      </label>
      <label>workspace
        <input type="text" data-testid="prompt-llm-workspace" class="prompt-llm-workspace"
               placeholder="wrkspc_… (org-scoped keys)" value="${esc(st.llmWorkspace)}"
               style="width:150px;font-size:12px;padding:2px 4px;" />
      </label>
      <label>model
        ${modelControl(st, { testid: "prompt-llm-model" })}
      </label>
    </div>

    <div class="prompt-editor" data-testid="prompt-editor" contenteditable="true"
         style="min-height:70px;border:1px solid #ccc;border-radius:4px;padding:8px;
                font-family:inherit;font-size:13px;background:#fff;"
         data-placeholder="Describe what you want to find…"></div>

    <div style="display:flex;gap:8px;align-items:center;">
      <select data-testid="prompt-target" class="prompt-target" style="font-size:12px;padding:2px 4px;">
        <option value="mcp">to MCP</option>
        <option value="llm">to LLM</option>
      </select>
      <button type="button" data-testid="prompt-execute" class="prompt-execute"
              style="padding:4px 12px;cursor:pointer;">Execute</button>
      <button type="button" data-testid="prompt-connect" class="prompt-connect"
              style="padding:4px 10px;cursor:pointer;">Connect</button>
      <button type="button" data-testid="prompt-session-log" class="prompt-session-log"
              style="padding:4px 10px;cursor:pointer;">Session log</button>
      <span class="prompt-status" data-testid="prompt-status" style="font-size:12px;color:#666;"></span>
    </div>

    <div class="prompt-session-log-panel" data-testid="prompt-session-log-panel"
         style="display:none;border:1px solid #eee;padding:8px;margin-bottom:8px;"></div>

    <div class="prompt-responses" data-testid="prompt-responses">
      <div class="prompt-response-tabs" data-testid="prompt-response-tabs"
           style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #ddd;padding-bottom:4px;"></div>
      <div class="prompt-response-body" data-testid="prompt-response-body"
           style="border:1px solid #eee;border-top:none;padding:8px;min-height:80px;
                  font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;
                  overflow:auto;max-height:340px;background:#fcfcfc;"></div>
    </div>
  </div>`;
}

function renderTabs(root, st, app) {
  const bar = root.querySelector(".prompt-response-tabs");
  const body = root.querySelector(".prompt-response-body");
  if (!bar || !body) return;

  bar.innerHTML = st.responses.map((r) => `
    <button type="button" class="prompt-response-tab" data-n="${r.n}"
            data-testid="prompt-response-tab-${r.n}"
            style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #ccc;
                   border-radius:3px 3px 0 0;background:${r.n === st.active ? "#fff" : "#f0f0f0"};">
      ${esc(r.at)} ${esc(r.target)}${r.sparql ? " ◆" : ""}
    </button>`).join("");

  const current = st.responses.find((r) => r.n === st.active);
  if (!current) { body.innerHTML = `<span style="color:#999;">No response yet.</span>`; return; }

  body.innerHTML = `
    ${current.sparql ? `
      <div style="margin-bottom:8px;padding:6px;border:1px solid #cfe3cf;background:#f3faf3;">
        <div style="margin-bottom:4px;">This response compiled to a SPARQL query.</div>
        <button type="button" data-testid="prompt-add-view" class="prompt-add-view"
                style="padding:3px 10px;cursor:pointer;">Add as a view</button>
      </div>` : ""}
    <div>${esc(current.body)}</div>`;

  bar.querySelectorAll(".prompt-response-tab").forEach((b) => {
    b.addEventListener("click", () => { st.active = Number(b.dataset.n); renderTabs(root, st, app); });
  });
  const add = body.querySelector(".prompt-add-view");
  if (add) {
    add.addEventListener("click", () => {
      // jsui owns view creation; hand the query over.  views/new reads ?query=.
      const url = `${BASE_PATH}/account/${encodeURIComponent(st.account)}`
                + `/repositories/${encodeURIComponent(st.repository)}`
                + `/views/new?query=${encodeURIComponent(current.sparql)}`;
      if (app?.router?.navigate) app.router.navigate(url); else window.location.assign(url);
    });
  }
}

function addResponse(root, st, app, { target, title, body, sparql }) {
  const n = st.responses.length + 1;
  st.responses.push({ n, at: stamp(new Date()), target, title, body, sparql: sparql || null });
  st.active = n;
  renderTabs(root, st, app);
  return n;
}

async function executeMcp(root, st, app, promptText) {
  // `materialize` is the operation that compiles an exploration to SPARQL; the
  // prompt text is the shape it reads.
  const res = await runOperation({
    endpoint: st.mcpEndpoint, token: st.token,
    op: "materialize", body: promptText, mimeType: "sparql",
  });
  const text = payloadOf(res.message) ?? res.response ?? res.error ?? "";
  addResponse(root, st, app, {
    target: "MCP",
    title: "materialize",
    body: `HTTP ${res.status}  ${res.ms}ms\n\n${text}`,
    sparql: sparqlFrom(text),
  });
}

async function executeLlm(root, st, app, promptText, setStatus = () => {}) {
  if (!st.llmEndpoint) {
    addResponse(root, st, app, { target: "LLM", title: "no endpoint",
      body: "Set the LLM location and key above first." });
    return;
  }

  // Both transcripts are fed from the one event stream, because the model's
  // calls belong in two places for two reasons: under the turn that caused them,
  // as the reasoning trace, and beside the user's own operations, because that
  // is where the session record is being written.  Showing them twice is not
  // duplication -- it is the difference between "why did it answer that" and
  // "what has this session done".
  const onEvent = (e) => {
    switch (e.type) {
      case "tools":
        setStatus(e.ok ? `tools: ${e.names.join(", ")}` : "tools/list failed");
        // Always shown, not only on failure: what the model was *not* offered is
        // as much a part of the record as what it was.
        addResponse(root, st, app, {
          target: "MCP", title: "tools/list",
          body: e.ok
            ? `offered: ${e.names.join(", ")}\n`
            + `withheld: ${e.withheld.length ? e.withheld.join(", ") : "(none)"}\n\n`
            + `Deprecated spellings and anything outside the allow-list are not offered. `
            + `Access itself is the service's to enforce: every relayed call carries this `
            + `account's token.`
            : `${e.error}\n\nThe model will be asked without tools, and can then only `
            + `answer from the prompt.`,
        });
        break;

      case "assistant":
        if (e.text) {
          addResponse(root, st, app, {
            target: "LLM",
            title: e.toolCalls ? `turn ${e.iteration} → ${e.toolCalls} call(s)` : `turn ${e.iteration}`,
            body: `${e.stopReason}  ${e.ms}ms\n\n${e.text}`,
            sparql: sparqlFrom(e.text),
          });
        }
        setStatus(e.toolCalls ? "calling tools…" : "");
        break;

      case "tool_call":
        setStatus(`${e.name} ${e.input?.op || ""}…`.trim());
        break;

      case "tool_result":
        // The model's own call, shown in the MCP transcript next to the hand-written
        // ones.  It is the same endpoint and the same session, so it is the same record.
        addResponse(root, st, app, {
          target: "MCP",
          title: `${e.name} ${e.input?.op || ""} · via LLM`.trim(),
          body: `HTTP ${e.status}  ${e.ms}ms  ${e.ok ? "" : "(failed)"}\n`
              + `${JSON.stringify(e.input || {}, null, 2)}\n\n${e.text}`,
          sparql: sparqlFrom(e.text),
        });
        break;

      case "error":
        addResponse(root, st, app, { target: e.where === "provider" ? "LLM" : "MCP",
          title: "error", body: `${e.error}\n\n${e.response || ""}`.trim() });
        break;

      default:
        break;
    }
  };

  const adapter = createToolAdapter({
    provider: st.llmProvider,
    endpoint: st.llmEndpoint,
    apiKey: st.llmKey,
    workspaceId: st.llmWorkspace,
    model: st.llmModel,
    // With no MCP endpoint the adapter sends no tools at all, which is the
    // plain completion the pane used to make.
    mcp: st.mcpEndpoint ? { endpoint: st.mcpEndpoint, token: st.token } : null,
    onEvent,
  });

  const result = await adapter.run(promptText);
  setStatus(result.ok ? `${result.iterations} turn(s)` : "failed");
  return result;
}


export function initPromptPane(app, pane, accountName, repositoryName) {
  const panel = pane.querySelector('.repository-meta-panel[data-panel="prompt"]');
  if (!panel || panel.dataset.promptReady === "true") {
    if (panel) {
      const st = paneState(accountName, repositoryName,
                           app?.state?.getAuthContext?.(accountName)?.host || window.location.origin);
      if (st) renderTabs(panel, st, app);
    }
    return;
  }
  const auth = app?.state?.getAuthContext?.(accountName) || {};
  const st = paneState(accountName, repositoryName, auth.host || window.location.origin);
  st.token = auth.token || null;

  panel.innerHTML = template(st);
  panel.dataset.promptReady = "true";

  const editor = panel.querySelector(".prompt-editor");
  const status = panel.querySelector(".prompt-status");
  const setStatus = (s) => { if (status) status.textContent = s; };

  // keep the typed settings in the pane's state
  const bind = (sel, key) => {
    const el = panel.querySelector(sel);
    if (el) el.addEventListener("change", () => { st[key] = el.value.trim(); });
  };
  bind(".prompt-mcp-endpoint", "mcpEndpoint");
  // location and model are linked menus; the key and workspace are read by
  // the same binding, because a new key re-reads the model list
  bindLlmSettings(panel, st, {
    keyInput: panel.querySelector(".prompt-llm-key"),
    workspaceInput: panel.querySelector(".prompt-llm-workspace"),
  });

  // links stay links: linkify on blur rather than on every keystroke, so the
  // caret is not moved while someone is typing a URL.
  editor.addEventListener("blur", () => {
    const html = editor.innerHTML;
    const next = linkify(html);
    if (next !== html) editor.innerHTML = next;
  });

  panel.querySelector(".prompt-connect").addEventListener("click", async () => {
    setStatus("connecting…");
    const { discover, survey } = await mcpConnect({ endpoint: st.mcpEndpoint, token: st.token });
    setStatus(discover.ok && survey.ok ? "connected" : "connect failed");
    addResponse(panel, st, app, {
      target: "MCP", title: "connect",
      body: `server/discover  HTTP ${discover.status}\n${discover.response}\n\n`
          + `survey op=connect  HTTP ${survey.status}\n${survey.response}`,
    });
  });

  // The log reads <account>/mcp, which is where the server records every survey
  // operation -- the model's relayed calls among them.  The response tabs are
  // this page's live tail of the same record; this is the durable half, and the
  // only half that survives a reload.
  const logPanel = panel.querySelector(".prompt-session-log-panel");
  let refreshLog = null;
  panel.querySelector(".prompt-session-log").addEventListener("click", () => {
    const showing = logPanel.style.display !== "none";
    logPanel.style.display = showing ? "none" : "block";
    if (!showing) {
      if (!refreshLog) {
        refreshLog = renderSessionLog(logPanel,
                                      { host: auth.host || window.location.origin,
                                        account: accountName, token: st.token });
      } else {
        refreshLog();
      }
    }
  });

  panel.querySelector(".prompt-execute").addEventListener("click", async () => {
    const promptText = (editor.innerText || "").trim();
    if (!promptText) { setStatus("nothing to send"); return; }
    const target = panel.querySelector(".prompt-target").value;
    setStatus("running…");
    try {
      if (target === "mcp") { await executeMcp(panel, st, app, promptText); setStatus(""); }
      else await executeLlm(panel, st, app, promptText, setStatus);
      if (refreshLog && logPanel.style.display !== "none") refreshLog();
    } catch (e) {
      setStatus("failed");
      addResponse(panel, st, app, { target: target.toUpperCase(), title: "error", body: String(e) });
    }
  });

  renderTabs(panel, st, app);
}

export default initPromptPane;
