/**
 * Per-repository state for the MCP/LLM surfaces, in memory only.
 *
 * Two things show this state -- the exploration pane that opens beside the view
 * editors, and the older prompt tab in the repository pane -- and they must not
 * each ask for the same credentials.  Keying by "<account>/<repository>" means a
 * key typed in one is present in the other, and that closing a pane does not
 * lose it, while a reload does: the same rule AuthStore follows, for the same
 * reason.
 */

import { endpointFor } from "../../lib/mcp/mcp-client.js";
import { providerFor } from "../../lib/llm/providers.js";

const PANES = new Map();

/** The provider the panes open on; the seam is in lib/llm/providers.js. */
export const DEFAULT_PROVIDER = providerFor("anthropic");

export function paneState(account, repository, host) {
  const key = `${account}/${repository}`;
  if (!PANES.has(key)) {
    PANES.set(key, {
      account, repository,
      mcpEndpoint: endpointFor(host, account, repository),
      llmProvider: DEFAULT_PROVIDER.id,
      llmEndpoint: DEFAULT_PROVIDER.defaultEndpoint,
      llmKey: "", llmWorkspace: "",
      llmModel: DEFAULT_PROVIDER.defaultModel,
      llmModelOther: false, // the model was typed rather than chosen from the list
      llmModels: {},        // per location: {models: [{id, label}]}, as listed
      token: null,
      responses: [],      // the prompt tab's tabbed transcript
      exchanges: [],       // the exploration pane's transcript
      active: null,
      connected: null,     // null = not tried, true/false = the last attempt
      connectText: "",
      session: null,       // the exploration handle this pane is carrying
    });
  }
  return PANES.get(key);
}

/**
 * Any pane the user has already connected, for a surface that has no
 * repository of its own (U-72).
 *
 * The workspace is per account and names no repository, so there is no pane
 * key for it -- but asking for a second provider key to rearrange the
 * furniture would be absurd, and storing one somewhere else would be a
 * second credential to keep.  So the chrome borrows the connection the user
 * has already made, and says plainly when there is none.
 *
 * Preferring the named account's own panes is not cosmetic: a session may
 * hold a key for someone else's repository, and the one the user is working
 * in is the one they will recognise in a refusal.
 */
export function anyConnectedPane(account = null) {
  const connected = [...PANES.values()].filter((p) => p.llmKey);
  if (!connected.length) return null;
  return connected.find((p) => p.account === account) || connected[0];
}

export function forgetPaneState(account, repository) {
  PANES.delete(`${account}/${repository}`);
}

export default paneState;
