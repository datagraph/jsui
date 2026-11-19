/**
 * The model connection, where the account's other settings are (§34.1).
 *
 * It was set in an exploration pane, which is a repository's surface, and was
 * held per repository.  A credential is a property of the user and of the
 * provider; it belongs beside the account's own fields, and this is that
 * panel.  The controls are the ones the panes already draw -- the two linked
 * menus from `llm-settings.js' -- bound here to the account's connection
 * rather than to a pane's state, so there is one of everything and no surface
 * has to borrow from another.
 *
 * Nothing here is written anywhere.  The key lives in memory for the life of
 * the page, exactly as the host token does, and a reload asks for it again:
 * moving the connection from the repository to the account changed where it
 * is keyed, not how long it lives.
 */

import { locationControl, modelControl, bindLlmSettings } from "./llm-settings.js";
import { connectionFor, CONNECTION_PLACE } from "../../lib/app/connection.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FIELD = "display:flex;gap:8px;align-items:center;margin:4px 0;font-size:12px;";
const LABEL = "min-width:92px;color:#4b5563;";

/** The panel's markup, for one account's connection. */
export function connectionMarkup(accountName) {
  const st = connectionFor(accountName);
  return `
    <div class="connection-panel" data-account="${esc(accountName)}" data-testid="account-connection">
      <p style="font-size:11px;color:#666;margin:0 0 6px;">
        One connection for this account. Every surface that asks a model anything —
        the location bar, the exploration panes, the prompt tab, the dashboards —
        uses it, and none of them asks for it again.
      </p>
      <div style="${FIELD}">
        <span style="${LABEL}">Location</span>
        ${locationControl(st, { testid: "connection-location", style: "flex:1;" })}
      </div>
      <div style="${FIELD}">
        <span style="${LABEL}">Model</span>
        ${modelControl(st, { testid: "connection-model", style: "flex:1;" })}
      </div>
      <div style="${FIELD}">
        <span style="${LABEL}">Key</span>
        <input type="password" class="connection-key" data-testid="connection-key"
          autocomplete="off" placeholder="provider API key"
          value="${esc(st.llmKey)}" style="flex:1;font-size:12px;padding:2px 4px;" />
      </div>
      <div style="${FIELD}">
        <span style="${LABEL}">Workspace</span>
        <input type="text" class="connection-workspace" data-testid="connection-workspace"
          value="${esc(st.llmWorkspace)}" style="flex:1;font-size:12px;padding:2px 4px;" />
      </div>
      <p class="connection-state" data-testid="connection-state"
         style="font-size:11px;color:#666;margin:6px 0 0;"></p>
      <p style="font-size:11px;color:#666;margin:4px 0 0;">
        Held in this browser for the life of the page and sent only to the location
        above. It is never written to a repository, and a reload asks again.
      </p>
    </div>`;
}

/** Fill a box with it and bind the controls to the account's connection. */
export function renderConnectionInto(box, { accountName } = {}) {
  if (!box) return null;
  const st = connectionFor(accountName);
  box.innerHTML = connectionMarkup(accountName);
  const root = box.querySelector(".connection-panel");
  const keyInput = root.querySelector(".connection-key");
  const workspaceInput = root.querySelector(".connection-workspace");
  const state = root.querySelector(".connection-state");
  const bound = bindLlmSettings(root, st, { keyInput, workspaceInput });
  const show = () => {
    state.textContent = st.llmKey
      ? `connected — ${st.llmModel} at ${st.llmEndpoint}`
      : `no key yet; until one is set, every surface will say so and name ${CONNECTION_PLACE}`;
  };
  keyInput.addEventListener("input", show);
  root.addEventListener("change", show);
  show();
  return bound;
}

export default renderConnectionInto;
