/**
 * Per-repository state for the MCP/LLM surfaces, in memory only.
 *
 * Two things show this state -- the exploration pane that opens beside the view
 * editors, and the older prompt tab in the repository pane -- and they must not
 * each ask for the same credentials.  Keying by "<account>/<repository>" means a
 * key typed in one is present in the other, and that closing a pane does not
 * lose it, while a reload does: the same rule AuthStore follows, for the same
 * reason.
 *
 * **Changed 2026-11-08 (§34.1; A-15).**  The connection to a model is no longer
 * part of this.  It was -- the provider, the location, the key, the workspace
 * and the model were keyed here by `<account>/<repository>' with everything
 * else -- and it made the credential a property of the repository being
 * examined, which it is not.  It now lives in `lib/app/connection.js', keyed by
 * account, and `attachConnection' gives this object a window onto it: reading
 * `st.llmKey' reads the account's connection and writing it writes the
 * account's connection, so the fields below behave exactly as they always did
 * and there is one of them rather than one per repository.
 *
 * **Changed 2026-11-15 (§34.4).**  The MCP half left too, and for the opposite
 * reason: it IS a repository's, but it is not a PANE's.  The endpoint, the
 * host token, the state of the last handshake and the live exploration handle
 * now live in `lib/mcp/registry.js', keyed by `<account>/<repository>', so
 * that a second surface -- the account's exploration pane, which has to offer
 * a choice of connected stores -- can find out what this pane connected, and
 * so that a run started anywhere continues the exploration a run started
 * somewhere else opened.  `attachMcp' forwards them exactly as
 * `attachConnection' forwards the model's.
 *
 * What is left here is what really is this surface's own: the transcripts it
 * has drawn and which tab of them is showing.
 */

import { attachConnection, DEFAULT_PROVIDER } from "../../lib/app/connection.js";
import { attachMcp, mcpConnectionFor, storeFor } from "../../lib/mcp/registry.js";

const PANES = new Map();

/** Re-exported so that the surfaces that read it need not know where it moved. */
export { DEFAULT_PROVIDER };

export function paneState(account, repository, host) {
  const key = `${account}/${repository}`;
  if (!PANES.has(key)) {
    PANES.set(key, attachMcp(attachConnection({
      account, repository,
      responses: [],      // the prompt tab's tabbed transcript
      exchanges: [],      // the exploration pane's transcript
      active: null,
    }, account), account, repository, host));
  }
  // The connection is made whether or not a pane was: a surface may ask for
  // the pane state of a repository the user has never opened a pane on.
  mcpConnectionFor(account, repository, host);
  return PANES.get(key);
}

/**
 * The store this pane reads, in the shape the tool adapter routes on (§34.3).
 *
 * A pane is one repository, so this is a set of one; it is written this way so
 * that a pane and the location bar hand the adapter the same kind of thing, and
 * the single-repository case stays the single-repository case all the way down.
 */
export function paneStore(st) {
  if (!st) return null;
  return storeFor(st.account && st.repository
    ? { account: st.account, repository: st.repository,
        mcpEndpoint: st.mcpEndpoint, token: st.token }
    : null);
}

/**
 * The connection an account is working under.
 *
 * `anyConnectedPane' stood here until 2026-11-08: a surface with no repository
 * of its own -- the chrome -- borrowed the credential from whichever pane
 * happened to have one, preferring the named account's.  There is nothing to
 * borrow now, because the connection was never the pane's to lend.
 */
export { connectionFor as connectionOf } from "../../lib/app/connection.js";

export function forgetPaneState(account, repository) {
  PANES.delete(`${account}/${repository}`);
}

export default paneState;
