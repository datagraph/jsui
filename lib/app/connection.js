/**
 * The connection to a model, as a setting of the ACCOUNT (§34.1; A-15).
 *
 * It used to belong to a repository.  `paneState' keyed the provider, the
 * location, the credential, the workspace and the model by
 * `<account>/<repository>', together with the things that really are a
 * repository's -- its MCP endpoint, that endpoint's token, the exploration
 * session and the transcript -- and three consequences followed, all of them
 * visible in the client:
 *
 *   1. The chrome, which rearranges the interface and reads no data at all,
 *      had no connection of its own and BORROWED one from whichever pane
 *      happened to hold a key (`anyConnectedPane').  Its refusal when there
 *      was none sent the user to "an exploration pane's Connection" -- a
 *      repository's surface -- to configure something no repository is
 *      involved in.
 *   2. The same key, typed into two panes, was two credentials as far as the
 *      state was concerned, and which one a surface used depended on which
 *      pane had been opened first.
 *   3. A turn could reach one repository, because the connection it travelled
 *      on was one repository's.  Crossing a boundary was impossible to ASK
 *      for, never mind to route.
 *
 * The credential is a property of the user and of the provider.  It is not a
 * property of the thing being examined, and this module is where that is
 * written down: one connection per signed-in account, held in memory for the
 * life of the page exactly as `AuthStore' holds the host token, never written
 * to a repository and never to browser storage.  A reload loses it, which is
 * the rule it had before and the reason it is still true.
 *
 * What is genuinely per repository stays in `mcp-pane-state.js'.  That module
 * now carries the repository's half and reaches here for the connection, so
 * every surface -- the location bar, the exploration pane, the prompt tab,
 * the dashboard pane, the figure gate -- reads one object however it got
 * there, and no surface asks for the key a second time.
 */

import { providerFor } from "../llm/providers.js";

/** The provider the interface opens on; the seam is in `lib/llm/providers.js'. */
export const DEFAULT_PROVIDER = providerFor("anthropic");

/**
 * Where the connection is set, in the words a refusal should use.
 *
 * One string, because six surfaces refuse and they must all name the same
 * place (REQ-34.1.6).  The old refusals named three different ones.
 */
export const CONNECTION_PLACE = "the account's Connection settings";

/**
 * The fields that belong to the connection rather than to a repository.
 *
 * Named rather than inferred: `attachConnection' forwards exactly these, and
 * a field added to the connection that is not listed here would be set on one
 * pane and invisible in the next, which is the bug this module exists to end.
 */
export const CONNECTION_FIELDS = Object.freeze([
  "llmProvider",      // the registered provider id
  "llmEndpoint",      // the location, which may be a proxy the menu does not list
  "llmKey",           // the bearer credential, in memory only
  "llmWorkspace",     // the provider's workspace/organisation, where it has one
  "llmModel",         // the model id
  "llmModelOther",    // the model was typed rather than chosen from the list
  "llmModels",        // per location: {models: [{id, label}]}, as listed
]);

const CONNECTIONS = new Map();

const blank = () => ({
  llmProvider: DEFAULT_PROVIDER.id,
  llmEndpoint: DEFAULT_PROVIDER.defaultEndpoint,
  llmKey: "",
  llmWorkspace: "",
  llmModel: DEFAULT_PROVIDER.defaultModel,
  llmModelOther: false,
  llmModels: {},
});

/**
 * The connection for one account, made on first ask.
 *
 * Keyed by account and not globally: a session may be signed in to more than
 * one account, and a key is as likely to be per account as not.  Keyed by
 * account and not by `<account>/<repository>': that is the whole change.
 */
export function connectionFor(account) {
  const key = String(account || "");
  if (!CONNECTIONS.has(key)) CONNECTIONS.set(key, blank());
  return CONNECTIONS.get(key);
}

/** Is there a credential to run with?  The one test every surface makes. */
export function isConnected(account) {
  return Boolean(connectionFor(account).llmKey);
}

/** Sign-out, and the tests. */
export function forgetConnection(account) {
  CONNECTIONS.delete(String(account || ""));
}

/** Every account that has one, for a surface that has to say where it came from. */
export function connectedAccounts() {
  return [...CONNECTIONS.entries()].filter(([, c]) => c.llmKey).map(([a]) => a).sort();
}

/**
 * The one refusal, in the one wording (REQ-34.1.6).
 *
 * `what' names what will not happen, so that the sentence reads as the
 * surface's own and still points at a single place.
 */
export function connectionRefusal(what = "there is nothing to ask") {
  return `no model is connected — set a provider key in ${CONNECTION_PLACE}; ${what}`;
}

/**
 * Give `state' the connection's fields, by reference.
 *
 * Accessors rather than a copy, and this is the load-bearing decision: the
 * controls in `llm-settings.js' write `st.llmKey = …' on a keystroke, and a
 * copy would make the pane the owner again the moment anything was typed.
 * Forwarding means the pane holds no connection state at all -- it holds a
 * window onto the account's -- so a key typed in one surface IS the key in
 * every other, with no event, no refresh and nothing to keep in step.
 *
 * Returns `state', so a caller can attach and return in one expression.
 */
export function attachConnection(state, account) {
  const connection = connectionFor(account);
  for (const field of CONNECTION_FIELDS) {
    delete state[field];
    Object.defineProperty(state, field, {
      enumerable: true,
      configurable: true,
      get: () => connection[field],
      set: (v) => { connection[field] = v; },
    });
  }
  return state;
}

export default connectionFor;
