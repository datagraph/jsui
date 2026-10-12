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

export function forgetPaneState(account, repository) {
  PANES.delete(`${account}/${repository}`);
}

export default paneState;
