/**
 * The LLM location and model, as two linked menus.
 *
 * They were two free text fields, and they are not independent: a model name
 * means something only at the location that serves it.  So the location is a
 * menu of the registered providers, the model menu is filled from that
 * location's own model list, and changing the one refills the other.  Each menu
 * ends in "other…", which opens a text field beside it for a value the menu
 * does not offer -- a proxy or a self-hosted server for the location, a model
 * the list leaves out for the model.
 *
 * The list needs the key, so it is read when a key is present and read again
 * when the key or the location changes.  It is kept in the shared pane state,
 * keyed by location, so the prompt tab and the exploration pane ask once.
 *
 * Both panes lay their fields out differently, so this module renders the two
 * controls as fragments for each pane's own template and binds them afterwards.
 */

import {
  presetProviders, providerFor, providerForEndpoint, listModels,
} from "../../lib/llm/providers.js";

const OTHER = "__other__";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const presetFor = (endpoint) => presetProviders().find((p) => p.defaultEndpoint === endpoint) || null;

/** The location menu and its "other" field.  `testid' names the menu. */
export function locationControl(st, { id = "", testid, style = "" } = {}) {
  const preset = presetFor(st.llmEndpoint);
  const options = presetProviders().map((p) =>
    `<option value="${esc(p.id)}"${preset === p ? " selected" : ""}>${esc(p.label)}</option>`).join("")
    + `<option value="${OTHER}"${preset ? "" : " selected"}>other…</option>`;
  return `<span class="llm-pick" style="display:inline-flex;gap:4px;align-items:center;${style}">`
    + `<select class="llm-location"${id ? ` id="${esc(id)}"` : ""} data-testid="${esc(testid)}"`
    + ` title="${esc(st.llmEndpoint)}" style="font-size:12px;padding:1px 2px;max-width:100%;">${options}</select>`
    + `<input type="text" class="llm-location-other" data-testid="${esc(testid)}-other"`
    + ` placeholder="https://…/v1/messages or …/v1/chat/completions"`
    + ` value="${esc(preset ? "" : st.llmEndpoint)}"${preset ? " hidden" : ""}`
    + ` style="flex:1;min-width:180px;font-size:12px;padding:2px 4px;" /></span>`;
}

/** The model menu, its "other" field, and a note on where the list came from. */
export function modelControl(st, { id = "", testid, style = "" } = {}) {
  return `<span class="llm-pick" style="display:inline-flex;gap:4px;align-items:center;${style}">`
    + `<select class="llm-model"${id ? ` id="${esc(id)}"` : ""} data-testid="${esc(testid)}"`
    + ` style="font-size:12px;padding:1px 2px;max-width:220px;">${modelOptions(st)}</select>`
    + `<input type="text" class="llm-model-other" data-testid="${esc(testid)}-other"`
    + ` placeholder="model id" value="${esc(st.llmModel)}"${st.llmModelOther ? "" : " hidden"}`
    + ` style="flex:1;min-width:120px;font-size:12px;padding:2px 4px;" />`
    + `<span class="llm-models-note" data-testid="${esc(testid)}-note"`
    + ` style="font-size:11px;color:#888;white-space:nowrap;"></span></span>`;
}

/** The models known for the current location, the current model always among them. */
function knownModels(st) {
  const listed = st.llmModels?.[st.llmEndpoint]?.models;
  const models = listed && listed.length
    ? [...listed]
    : [{ id: providerForEndpoint(st.llmEndpoint).defaultModel,
         label: providerForEndpoint(st.llmEndpoint).defaultModel }];
  if (st.llmModel && !models.some((m) => m.id === st.llmModel)) {
    models.unshift({ id: st.llmModel, label: st.llmModel });
  }
  return models;
}

function modelOptions(st) {
  return knownModels(st).map((m) =>
    `<option value="${esc(m.id)}"${!st.llmModelOther && m.id === st.llmModel ? " selected" : ""}>`
    + `${esc(m.label)}${m.label !== m.id ? ` (${esc(m.id)})` : ""}</option>`).join("")
    + `<option value="${OTHER}"${st.llmModelOther ? " selected" : ""}>other…</option>`;
}

/**
 * Bind the two controls inside `root' to the shared state.  `keyInput' and
 * `workspaceInput' are the pane's own fields: the list is re-read when the key
 * changes, and the workspace hint follows the provider.
 */
export function bindLlmSettings(root, st, { keyInput = null, workspaceInput = null } = {}) {
  const loc = root.querySelector(".llm-location");
  const locOther = root.querySelector(".llm-location-other");
  const model = root.querySelector(".llm-model");
  const modelOther = root.querySelector(".llm-model-other");
  const note = root.querySelector(".llm-models-note");
  if (!loc || !model) return { refresh: async () => {} };

  let generation = 0;

  const showWorkspaceHint = () => {
    if (workspaceInput) workspaceInput.placeholder = providerFor(st.llmProvider).workspaceHint || "";
  };

  const renderModels = () => {
    model.innerHTML = modelOptions(st);
    modelOther.hidden = !st.llmModelOther;
  };

  const setNote = (text, title = "") => {
    if (!note) return;
    note.textContent = text;
    note.title = title;
  };

  /** Read the list for the current location.  A later call supersedes an earlier one. */
  async function refresh() {
    const endpoint = st.llmEndpoint;
    const mine = ++generation;
    if (!endpoint) { setNote(""); renderModels(); return; }
    if (!st.llmKey) { setNote("a key lists the models"); renderModels(); return; }
    setNote("listing…");
    const r = await listModels({ endpoint, apiKey: st.llmKey, workspaceId: st.llmWorkspace });
    if (mine !== generation) return;
    if (!r.ok) {
      setNote("no model list", r.error || "");
      renderModels();
      return;
    }
    st.llmModels = { ...(st.llmModels || {}), [endpoint]: { models: r.models } };
    // A model left over from another location is replaced by this one's; one
    // typed by hand is the user's word and is kept.
    if (!st.llmModelOther && r.models.length && !r.models.some((m) => m.id === st.llmModel)) {
      const preferred = providerForEndpoint(endpoint).defaultModel;
      st.llmModel = r.models.some((m) => m.id === preferred) ? preferred : r.models[0].id;
    }
    setNote(`${r.models.length} model${r.models.length === 1 ? "" : "s"}`);
    renderModels();
  }

  /** A new location: its provider, and a model that belongs to it. */
  function setLocation(endpoint) {
    st.llmEndpoint = endpoint;
    st.llmProvider = providerForEndpoint(endpoint).id;
    loc.title = endpoint;
    if (!st.llmModelOther) {
      const listed = st.llmModels?.[endpoint]?.models;
      if (!listed || !listed.some((m) => m.id === st.llmModel)) {
        st.llmModel = providerForEndpoint(endpoint).defaultModel;
      }
    }
    showWorkspaceHint();
    renderModels();
    return refresh();
  }

  loc.addEventListener("change", () => {
    if (loc.value === OTHER) {
      locOther.hidden = false;
      locOther.value = locOther.value || st.llmEndpoint;
      locOther.focus();
      if (locOther.value.trim()) setLocation(locOther.value.trim());
    } else {
      locOther.hidden = true;
      setLocation(providerFor(loc.value).defaultEndpoint);
    }
  });
  locOther.addEventListener("change", () => {
    const v = locOther.value.trim();
    if (v) setLocation(v);
  });

  model.addEventListener("change", () => {
    if (model.value === OTHER) {
      st.llmModelOther = true;
      modelOther.hidden = false;
      modelOther.value = st.llmModel || "";
      modelOther.focus();
    } else {
      st.llmModelOther = false;
      modelOther.hidden = true;
      st.llmModel = model.value;
    }
  });
  modelOther.addEventListener("change", () => {
    const v = modelOther.value.trim();
    if (v) st.llmModel = v;
  });

  if (keyInput) {
    keyInput.addEventListener("change", () => {
      st.llmKey = keyInput.value.trim();
      refresh();
    });
  }
  if (workspaceInput) {
    workspaceInput.addEventListener("change", () => {
      st.llmWorkspace = workspaceInput.value.trim();
    });
  }

  showWorkspaceHint();
  if (st.llmKey && !st.llmModels?.[st.llmEndpoint]) refresh();
  else if (st.llmModels?.[st.llmEndpoint]) {
    const n = st.llmModels[st.llmEndpoint].models.length;
    setNote(`${n} model${n === 1 ? "" : "s"}`);
  } else setNote(st.llmKey ? "" : "a key lists the models");

  return { refresh };
}

export default bindLlmSettings;
