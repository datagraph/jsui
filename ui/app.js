import { LayoutView } from "./components/layout.js";
import { NotFoundPage } from "./pages/index.js";
import { APP_CONFIG } from "../lib/config.js";
import { mountLocationBar } from "./components/location-bar.js";
import { target as makeTarget, describeTarget } from "../lib/app/instructions.js";
import {
  loadWorkspace, saveWorkspace, arrangementOf, restoreRequested, placeBand,
  WORKSPACE_NAME, CHROME_ELEMENT,
} from "../lib/app/workspace.js";
import {
  ensureRepository, listPresentations, listArrangements, listMounts, claimMount, releaseMount,
  writeArrangement, readArrangement, recordApplication, readPresentation,
} from "../lib/app/ui-store.js";
import {
  lift as liftArrangement, apply as applyArrangement,
  mount as mountPresentation, unmount as unmountPresentation, printName,
} from "../lib/app/arrangement.js";
import { installExpanders, expandInto } from "./components/mount-band.js";
import { runWorkspaceInstruction } from "../lib/app/workspace-instruction.js";
import { instructionSystem } from "../lib/llm/instruction-prompt.js";
import { createToolAdapter, DEFAULT_SYSTEM, ALLOW_TOOLS } from "../lib/llm/tool-adapter.js";
import { connectionFor, connectionRefusal } from "../lib/app/connection.js";
import { ensureRepositories } from "../lib/app/repositories.js";
import { classifyPrompt, contextRefusal, describeContext } from "../lib/app/prompt-context.js";
import { catalogRefusal, mountable } from "../lib/app/catalog.js";
import { mcpConnectionFor, storeFor, sessionStore } from "../lib/mcp/registry.js";
import { analysisSystem, analysisBudget, analysisProgress } from "../lib/llm/analysis-prompt.js";
import { createGrant } from "../lib/llm/grant.js";
import { recordRun } from "../lib/mcp/transcript-store.js";

/** The ceiling on an arrangement turn.  A patch against the chrome is small. */
export const INSTRUCTION_TOKENS = 8000;

export class App {
  constructor({ state, router = null }) {
    this.state = state;
    this.router = router;
    this.layout = new LayoutView();
    this.root = document.getElementById("app");
    // Map to store editor API instances by pane ID
    this.editorInstances = new Map();
    /**
     * What the location bar can address (U-77).
     *
     * A registry rather than a search of the DOM: the bar has to name what
     * an instruction will act on BEFORE the instruction is typed, and a
     * dashboard pane knows it is addressable while a `div' does not.  The
     * workspace is always in it; a pane adds itself when it has a page and
     * removes itself when it is closed.
     */
    this.uiTargets = new Map();
    this.locationBar = null;
    this.workspace = null;        // {account, document, arrangement, source}
  }

  /* ── the address book (U-77) ───────────────────────────────────────────── */

  /** Add something the bar can address.  Returns a function that removes it. */
  registerTarget(entry) {
    const t = makeTarget(entry);
    if (!t.id) return () => {};
    this.uiTargets.set(t.id, t);
    this.locationBar?.refresh();
    return () => this.unregisterTarget(t.id);
  }

  unregisterTarget(id) {
    this.uiTargets.delete(id);
    // The address may have been the thing that just went away; `refresh'
    // drops it rather than leaving the bar pointing at a closed pane.
    this.locationBar?.refresh();
  }

  /** The workspace first, then whatever is open, in the order it opened. */
  addressableTargets() {
    return [this.workspaceTarget(), ...this.uiTargets.values()].filter(Boolean);
  }

  /** Make something the address, by id.  What a pane calls when it is clicked. */
  addressTarget(id) {
    return this.locationBar?.setAddress(id) || null;
  }

  /**
   * The chrome, as something that can be addressed.
   *
   * Built on demand rather than registered, because it exists whether or not
   * anything has been opened and because its document changes under it every
   * time an instruction is applied.
   */
  workspaceTarget() {
    const self = this;
    return makeTarget({
      id: WORKSPACE_NAME, label: "workspace", kind: "workspace",
      document: () => self.workspace?.document || null,
      instruct: (text) => self.instructWorkspace(text),
      arrange: (instruction) => self.arrangeWorkspace(instruction),
    });
  }

  /** Route one instruction to whatever the bar is addressing. */
  async instruct({ target, text }) {
    if (!target) return { ok: false, message: "nothing is addressed" };
    if (typeof target.instruct === "function") return target.instruct(text);
    return { ok: false, message: `${describeTarget(target)} cannot take instructions` };
  }

  /**
   * Route one arrangement verb to whatever the bar is addressing (U-85).
   *
   * Separate from `instruct' because an arrangement verb is not asked of a
   * model: it is exact, and routing it through a turn would make an
   * operation that cannot be misread depend on one that can.  A target that
   * has no `arrange' says so, the way one with no `instruct' does -- the
   * chrome implements it below, and a pane that holds a document can
   * implement it without anything here changing.
   */
  async arrange({ target, instruction }) {
    if (!target) return { ok: false, message: "nothing is addressed" };
    if (typeof target.arrange === "function") return target.arrange(instruction);
    return { ok: false,
             message: `${describeTarget(target)} cannot be rearranged from here` };
  }

  /**
   * The four verbs against the chrome.
   *
   * `mount' is the interesting one and the only one that touches the
   * registry: a presentation is loaded in one place at a time (§21.4.1), so
   * the claim is made against the store and a presentation already loaded
   * comes back as the place it is in rather than as a second copy.  The
   * claim is made AFTER the save, so a failed save cannot leave a claim
   * standing over a mount that is not there.
   */
  async arrangeWorkspace(instruction) {
    const accountName = this.state.session?.accountName || null;
    if (!accountName) return { ok: false, message: "sign in before rearranging the interface" };
    const auth = this.state.getAuthContext?.(accountName) || {};
    const where = { host: auth.host, account: accountName, token: auth.token };
    const held = await this.workspaceFor(this.workspace?.page || "main");
    const page = held.page;
    const document0 = held.document;

    const save = async (doc) => saveWorkspace({ ...where, document: doc });
    const redraw = async (doc) => {
      this.workspace = { ...held, document: doc,
                         arrangement: arrangementOf(doc, { page }), source: "account" };
      await this.redrawChrome();
    };
    const undoTo = (doc) => async () => {
      const back = await save(doc);
      if (back?.ok) await redraw(doc);
      return back?.ok ? { ok: true, message: "put back" }
                      : { ok: false, message: `it could not be put back: ${back?.error}` };
    };

    if (instruction.verb === "mount") {
      const listed = await listPresentations({ ...where, limit: 200 });
      const entry = (listed.presentations || []).find((p) => p.name === instruction.presentation);
      if (!entry) {
        // The listing is in hand at the moment of the refusal (REQ-33.4.4).
        // It used to be read, searched and dropped, so the one thing the user
        // needed -- what the names ARE -- was the one thing not said.
        return { ok: false,
                 message: listed.ok
                   ? catalogRefusal("presentation", instruction.presentation, listed.presentations)
                   : `the presentations in \`${accountName}/ui' could not be read: ${listed.error}` };
      }
      // A scope that cannot be mounted is refused here rather than deeper
      // down, so that the sentence names the scope (REQ-33.4.5).
      const allowed = mountable({ ...entry, owner: accountName, foreign: false });
      if (!allowed.ok) return { ok: false, message: `\`${entry.name}': ${allowed.reason}` };
      const loaded = await listMounts({ ...where });
      if (!loaded.ok) return { ok: false, message: `the mount registry could not be read: ${loaded.error}` };
      // Into the chrome's root unless the user named somewhere: a band
      // beside the root rather than inside it leaves the grid with two
      // roots, and `layoutOf' answers with no grid at all for that — the
      // whole arrangement lost to a default nobody chose.
      const made = mountPresentation({
        document: document0, presentation: instruction.presentation,
        scope: entry.scope || "document", mounting: "workspace",
        parent: instruction.into || CHROME_ELEMENT, loaded: loaded.mounts });
      if (!made.ok) return { ok: false, message: made.errors[0] };
      const placed = instruction.into ? made.document
        : placeBand(made.document, { page, element: made.element });
      const written = await save(placed);
      if (!written.ok) return { ok: false, message: `it could not be saved: ${written.error}` };
      const claimed = await claimMount({ ...where, presentation: instruction.presentation,
                                         at: WORKSPACE_NAME, element: made.element });
      await redraw(placed);
      return { ok: true,
               message: claimed.took
                 ? `\`${instruction.presentation}' is mounted — press Open in the band to `
                   + `draw it, which is the only thing that can`
                 : `\`${instruction.presentation}' is mounted here, but the registry says it is `
                   + `also in \`${claimed.mount?.at}' — one of the two is stale`,
               undo: undoTo(document0) };
    }

    if (instruction.verb === "unmount") {
      const out = unmountPresentation({ document: document0, element: instruction.element });
      if (!out.ok) return { ok: false, message: out.errors[0] };
      const written = await save(out.document);
      if (!written.ok) return { ok: false, message: `it could not be saved: ${written.error}` };
      if (out.presentation) await releaseMount({ ...where, presentation: out.presentation });
      await redraw(out.document);
      return { ok: true, message: `\`${out.presentation}' is no longer mounted`,
               undo: undoTo(document0) };
    }

    if (instruction.verb === "lift") {
      const source = { host: auth.host, account: accountName, repository: null };
      const lifted = liftArrangement({
        document: document0, source,
        name: printName({ presentation: instruction.presentation, element: instruction.element }) });
      if (!lifted.ok) return { ok: false, message: lifted.errors[0] };
      const kept = await writeArrangement({ ...where, name: instruction.as,
                                            template: lifted.template, creator: accountName });
      return kept.ok
        ? { ok: true, message: `lifted as \`${instruction.as}'` }
        : { ok: false, message: `it could not be kept: ${kept.error}` };
    }

    if (instruction.verb === "apply") {
      const got = await readArrangement({ ...where, name: instruction.arrangement });
      if (!got.ok) {
        // `readArrangement' answers *there is no arrangement named X*, which
        // is true and leaves the user with nothing to try.  The catalog is
        // one request away and the names are what they need (REQ-33.4.4).
        const held = await listArrangements({ ...where, limit: 200 });
        return { ok: false,
                 message: held.ok
                   ? catalogRefusal("arrangement", instruction.arrangement, held.arrangements)
                   : got.error };
      }
      const out = applyArrangement({ document: document0, template: got.template,
                                     parent: instruction.into });
      if (!out.ok) return { ok: false, message: out.errors[0] };
      const written = await save(out.document);
      if (!written.ok) return { ok: false, message: `it could not be saved: ${written.error}` };
      await recordApplication({ ...where, presentation: WORKSPACE_NAME,
                                arrangement: instruction.arrangement, requests: out.requests });
      await redraw(out.document);
      return { ok: true,
               message: `\`${instruction.arrangement}' applied — ${out.requests.length} request`
                      + `${out.requests.length === 1 ? "" : "s"} to repeat`,
               undo: undoTo(document0) };
    }
    return { ok: false, message: `\`${instruction.verb}' is not an arrangement verb` };
  }

  /* ── the chrome as a presentation (U-72) ───────────────────────────────── */

  /**
   * Read the account's workspace, once.
   *
   * Cached by account because `renderPage' runs on every navigation and the
   * arrangement does not change between them; re-read when the account does,
   * and never read at all under `?workspace=default', which is the whole
   * point of that route.
   */
  async workspaceFor(page = "main") {
    const accountName = this.state.session?.accountName || null;
    const restore = restoreRequested(typeof window !== "undefined" ? window.location.search : "");
    if (this.workspace && this.workspace.account === accountName
        && this.workspace.restore === restore && this.workspace.page === page) {
      return this.workspace;
    }
    const auth = accountName ? (this.state.getAuthContext?.(accountName) || {}) : {};
    let loaded;
    try {
      loaded = await loadWorkspace({ host: auth.host, account: accountName,
                                     token: auth.token, page, restore });
    } catch (error) {
      console.warn("[App] the workspace could not be read:", error);
      loaded = await loadWorkspace({ page, restore: true });
    }
    this.workspace = { account: accountName, page, restore, source: loaded.source,
                       why: loaded.why, document: loaded.document,
                       arrangement: arrangementOf(loaded.document, { page }) };
    return this.workspace;
  }

  /** Forget the arrangement, so the next render reads it again. */
  forgetWorkspace() { this.workspace = null; }

  /**
   * One line typed into the bar against the chrome: an instruction, or a
   * question about data (§34.2).
   *
   * The bar used to send everything here to a model with `allowTools: []'
   * and no MCP endpoint, so a question about a repository could not be asked
   * from the one affordance that is always on the screen.  It can now, and
   * which of the two a line is, is decided WITHOUT a model: a line that names
   * a repository is about data, and everything else is about the interface,
   * as before.  `lib/app/prompt-context.js' is the whole of that decision and
   * the reason it is a module: reading an instruction as a question costs a
   * turn, and reading a question as an instruction edits the page instead of
   * answering it.
   *
   * The credential is the ACCOUNT'S (§34.1; A-15).  It used to be borrowed
   * from whichever exploration pane had one, which made a key typed about one
   * repository the credential for rearranging furniture that concerns none.
   */
  async instructWorkspace(text) {
    const accountName = this.state.session?.accountName || null;
    if (!accountName) return { ok: false, message: "sign in before rearranging the interface" };
    const connection = connectionFor(accountName);
    if (!connection.llmKey) {
      return { ok: false, message: connectionRefusal("nothing was asked") };
    }
    const auth = this.state.getAuthContext?.(accountName) || {};

    // What this account may name, read once for the session (REQ-33.2.7).
    const sets = await ensureRepositories({ host: auth.host, account: accountName,
                                            token: auth.token });
    const reading = classifyPrompt(text, { permitted: sets.permitted,
                                           address: { kind: "workspace" } });
    // A repository that was unmistakably named and is not one this account
    // may read refuses the line before anything runs (REQ-34.2.6).
    if (reading.kind === "refusal") return { ok: false, message: contextRefusal(reading) };
    if (reading.kind === "data") return this.offerDataTurn(reading, { accountName, auth, connection });
    const held = await this.workspaceFor(this.workspace?.page || "main");
    const page = held.page;

    const ask = async ({ text: asked, document: doc }) => {
      const adapter = createToolAdapter({
        provider: connection.llmProvider, endpoint: connection.llmEndpoint,
        apiKey: connection.llmKey,
        workspaceId: connection.llmWorkspace, model: connection.llmModel,
        allowTools: [], maxTokens: INSTRUCTION_TOKENS, maxIterations: 1,
        system: instructionSystem(DEFAULT_SYSTEM, {
          target: { kind: "workspace" }, document: doc, page,
          answerTokens: INSTRUCTION_TOKENS, request: asked,
        }),
      });
      return adapter.run(asked);
    };
    // `<account>/ui' is provisioned on the first write and not on every
    // page load: a reader who never rearranges anything should not have a
    // repository created for them, and the probe is one request per
    // session rather than one per save.
    const save = async (doc) => {
      if (!this._uiRepository || this._uiRepository.account !== accountName) {
        this._uiRepository = { account: accountName,
                               ready: await ensureRepository({ host: auth.host,
                                                               account: accountName,
                                                               token: auth.token }) };
      }
      const ready = this._uiRepository.ready;
      if (!ready?.ok) {
        this._uiRepository = null;      // try again next time; this may be transient
        return { ok: false, error: `\`${accountName}/ui' is not available: ${ready?.error}` };
      }
      return saveWorkspace({ host: auth.host, account: accountName,
                             token: auth.token, document: doc });
    };

    const out = await runWorkspaceInstruction({ document: held.document, text, ask, save });
    if (out.ok && out.document) {
      this.workspace = { ...held, document: out.document,
                         arrangement: arrangementOf(out.document, { page }), source: "account" };
      await this.redrawChrome();
      // The undo has to redraw too, and it is the module's own closure that
      // knows how to put the document back -- so it is wrapped here rather
      // than reimplemented.
      const putBack = out.undo;
      out.undo = async () => {
        const back = await putBack();
        if (back?.ok && back.document) {
          this.workspace = { ...held, document: back.document,
                             arrangement: arrangementOf(back.document, { page }) };
          await this.redrawChrome();
        }
        return back;
      };
    }
    return out;
  }

  /**
   * A question about data, disclosed before it is asked (REQ-34.2.5).
   *
   * Nothing runs here.  The reply names the stores the turn would read and
   * offers one press, because a turn that reaches two repositories authorises
   * more than one that reaches one -- and the bar, unlike a pane, has no gate
   * of its own to put that in.  The press is the gate.
   */
  offerDataTurn(reading, { accountName, auth, connection }) {
    if (reading.empty) {
      return { ok: false,
               message: "the workspace names no repository, so there is nothing to read — "
                      + "name one in the line, as `in alice/sales'" };
    }
    const where = describeContext(reading.repositories);
    const n = reading.repositories.length;
    const budget = analysisBudget(reading.repositories);
    return {
      ok: true,
      message: `${where} — under your credentials, nothing has run yet`,
      // What the press authorises, in the terms the grant itself holds
      // (§35.2).  "It will read two repositories" is the part the user
      // already knows from the line; what they cannot know unless it is said
      // is how long it may go on for and how much it may read.
      detail: `This would run an analysis across ${n} repositor${n === 1 ? "y" : "ies"}:\n`
            + `${reading.repositories.map((r) => `  · ${r.id}`).join("\n")}\n\n`
            + `Up to ${budget.rounds} rounds of tool calls, ${budget.grant.maxQueries} calls in all, `
            + `read-only, for this run.\nLarge results are read as their shape first; `
            + `the answer is recorded in \`${accountName}/mcp\` and can be stopped while it runs.`,
      confirm: {
        label: n === 1 ? "Ask" : `Ask across ${n}`,
        working: `asking ${reading.repositories.map((r) => r.id).join(", ")}…`,
        run: (controls) => this.askRepositories(reading, { accountName, auth, connection }, controls),
      },
    };
  }

  /**
   * The turn itself: one model, several stores (§34.3).
   *
   * Each named repository is carried as its own MCP endpoint with its own
   * token, because the service has one resource per repository and authorizes
   * it there; the adapter offers the model one tool per store and routes each
   * call by the name it was called under.  Nothing is written: the tools are
   * the default read-only set, and the chrome is not touched by the answer.
   */
  async askRepositories(reading, { accountName, auth, connection },
                        { progress = () => {}, stopped = () => null } = {}) {
    // Through the registry (§34.4), not derived here.  The bar used to build
    // each endpoint from the host and so could not be told otherwise: an
    // endpoint corrected in a repository's pane -- a proxy, a second host --
    // was that pane's private opinion and this turn went somewhere else.  Now
    // both read the one connection, and the handshake either has already
    // happened or will happen on the first call.
    const stores = reading.repositories.map((r) => {
      const conn = mcpConnectionFor(r.account, r.repository, auth.host);
      // The signed-in session's token, for every store: authorization is the
      // service's to make, per resource, and a collaboration is exactly the
      // case where this token may read a repository of another account.
      conn.token = auth.token ?? conn.token;
      return storeFor(conn);
    }).filter(Boolean);
    const ids = reading.repositories.map((r) => r.id);
    // What the turn may spend, and the brief it works under (§35.1, §35.2).
    const budget = analysisBudget(reading.repositories);
    const grant = createGrant(budget.grant);
    const watch = analysisProgress(progress, { rounds: budget.rounds });
    const started = new Date();
    const adapter = createToolAdapter({
      provider: connection.llmProvider, endpoint: connection.llmEndpoint,
      apiKey: connection.llmKey, workspaceId: connection.llmWorkspace,
      model: connection.llmModel,
      mcp: { repositories: stores },
      allowTools: ALLOW_TOOLS,
      // Not `DEFAULT_SYSTEM'.  That brief ends by asking for one SPARQL query
      // for the user to run in the view editor, which is operation 3 of the
      // design and the wrong deliverable here: no query spans two endpoints,
      // and what the question asks for is a comparison, not a query.
      system: analysisSystem({ stores: reading.repositories, asked: reading.text,
                               rounds: budget.rounds, answerTokens: budget.answerTokens }),
      maxIterations: budget.rounds,
      maxTokens: budget.answerTokens,
      digestOver: budget.digestOver,
      grant,
      // The exploration handles are the session's, not the run's (§34.4.3):
      // a second question about the same repository continues the first
      // one's exploration rather than opening a second beside it.
      sessions: sessionStore(),
      stop: stopped,
      onEvent: watch.onEvent,
    });
    let out;
    try { out = await adapter.run(reading.text); }
    catch (e) { return { ok: false, message: `the model could not be asked: ${e}` }; }

    const kept = await this.keepAnalysis({ out, stores, auth, accountName,
                                           prompt: reading.text, started });
    // Article 50 (§2.6): the model as SERVED, the stores it read, and the
    // date -- stated by the interface, never by the model.
    const served = out.servedModel || out.model;
    const spent = watch.calls.map(([id, n]) => `${id} ${n}`).join(", ")
               || `${watch.total()} calls`;
    // A run that answered only after its rounds ran out answered from fewer
    // calls than it wanted, and the reader is entitled to know that before
    // they act on the report rather than after.
    const cutShort = out.roundsExhausted
      ? ` · the exploration was stopped at the ${out.iterations}-round limit`
      : "";
    const footer = `— ${served}${out.served ? "" : " (requested, not confirmed)"}`
                 + ` · ${spent} · ${new Date().toISOString().slice(0, 10)}${cutShort}`
                 + `\n${kept.join("\n")}`;
    if (!out.ok) {
      // A run that was stopped, or that ran out of rounds, has usually said
      // something worth keeping -- the prose of its last complete turn -- and
      // it is handed over rather than discarded, labelled as partial.
      return { ok: false, message: `${out.error} — ${ids.join(", ")}`,
               detail: out.finalText ? `${out.finalText}\n\n${footer}` : footer };
    }
    const head = out.finalText.split("\n").find((l) => l.trim()) || "answered";
    const cut = out.truncated ? " — cut off at the answer ceiling" : "";
    return {
      ok: true,
      message: `${head.slice(0, 140)}${head.length > 140 ? "…" : ""}${cut}`,
      detail: `${out.finalText}\n\n${footer}`,
    };
  }

  /**
   * Keep the analysis (§35.4).
   *
   * A report of several thousand words that exists only in a panel the next
   * instruction replaces is not a deliverable, and the machinery for keeping
   * one already exists: `recordRun' writes a run and its exchanges as RDF
   * into `<account>/mcp', which is where the exploration panes have been
   * filing theirs all along.
   *
   * One record per store, not one for the turn.  Each repository is its own
   * exploration with its own handle, and the events now say which store they
   * belong to (§34.3), so each graph can hold that store's calls together
   * with the question that was asked and the answer that came of it.  A
   * reader of one repository's record therefore sees a complete exploration
   * rather than half of a turn; the prose appears in both because it is about
   * both.
   *
   * A failure to record is reported and nothing else: the analysis happened,
   * and losing the answer because the filing cabinet was shut would be the
   * worse outcome.
   */
  async keepAnalysis({ out, stores, auth, accountName, prompt, started }) {
    const notes = [];
    for (const store of stores) {
      const id = `${store.account}/${store.repository}`;
      const session = (out.sessions && out.sessions[id]) || null;
      // The turn's own events (prompt, assistant prose, done) carry no
      // repository and belong in every store's record; a call's events carry
      // one and belong only in that store's.
      const events = (out.events || []).filter((e) => !e.repository || e.repository === id);
      let kept;
      try {
        kept = await recordRun({ host: auth.host, account: accountName, token: auth.token,
                                 repository: id, session, prompt, started,
                                 result: { ...out, events } });
      } catch (e) { kept = { ok: false, error: String(e) }; }
      notes.push(kept?.ok ? `recorded: ${id} → ${kept.graph}`
                          : (kept?.wrote
                              ? `partly recorded: ${id} (${kept.wrote} of ${kept.parts} `
                              + `parts; ${kept.error})`
                              : `not recorded: ${id} (${kept?.error || "unknown"})`));
    }
    return notes;
  }

  /**
   * Draw the page again under the new arrangement.
   *
   * The whole page, not the chrome alone: a band that moved takes its
   * contents with it, and the contents are a page's `render()' output rather
   * than anything this class holds.  Re-rendering is what the router already
   * does on every navigation, so it is a path that is exercised constantly
   * rather than one that only runs here.
   */
  async redrawChrome() {
    if (this.router?.renderCurrent) return this.router.renderCurrent();
    if (this.currentPage) return this.renderPage(this.currentPage);
    return null;
  }

  setRouter(router) {
    this.router = router;
  }

  navLinks() {
    const baseHost = APP_CONFIG.baseHost;
    const docsHost = APP_CONFIG.docsHost;
    const blogHost = APP_CONFIG.blogHost;
    const basePath = APP_CONFIG.basePath || "";
    const accountName = this.state.session?.accountName;
    const isLoggedIn = this.state.session?.isLoggedIn();
    // Check if we're on the login page by checking current path or window location
    const currentPath = this.router?.currentPath || this.router?.getCurrentPath?.() || window.location.pathname;
    const normalizedPath = currentPath.replace(/\/index\.html$/, "").replace(basePath, "") || "/";
    const isLoginPage = normalizedPath === "/login" || normalizedPath.endsWith("/login");
    
    return {
      global: [
        //`<a href="http://${baseHost}/" class="dydra-link-home">Home</a>`,
        `<a href="https://dydra.com/about" class="dydra-link-about" data-external target="_blank">About</a>`,
        `<a href="http://${docsHost}/" class="dydra-link-docs" target="_blank">Docs</a>`,
        `<a href="http://${blogHost}/" class="dydra-link-blog" target="_blank">Blog</a>`,
      ],
      loggedIn: [
        `<a href="#" class="dydra-link-logout" data-action="logout" data-testid="logout-link">Logout</a>`,
        `<a href="${basePath}/admin" class="dydra-link-admin" data-external target="_blank">Admin</a>`,
      ],
      loggedOut: [
        `<a href="/signup" class="dydra-link-signup" target="_blank">Signup</a>`,
        `<a href="${basePath}/admin" class="dydra-link-admin" data-external target="_blank">Admin</a>`,
      ],
    };
  }

  async renderPage(page) {
    console.log("[App] renderPage() called for:", page.constructor.name);
    try {
      const navLinks = this.navLinks();
      const session = this.state.session;
      const title = page.getTitle();
      document.title = title || "Dydra";
      document.body.className = page.getBodyClass() || "";

      this.currentPage = page;
      page.setContext({ navLinks, session, app: this });
      console.log("[App] Rendering content...");
      const content = await page.renderContent();
      console.log("[App] Content rendered, length:", content?.length || 0);
      const sidebar = await page.renderSidebar();
      const paneTabs = await page.getPaneTabs();
      const paneTabsBar = paneTabs?.bar || "";
      const paneTabsDefault = paneTabs?.defaultTab || "";
      console.log("[App] paneTabsBar length:", paneTabsBar?.length || 0);
      console.log("[App] paneTabsDefault:", paneTabsDefault);
      console.log("[App] Calling LayoutView render() for page:", page.constructor.name);
      // U-72: the bands are placed by the account's own arrangement.  One
      // view, named `main', is wired -- the model and the store hold a view
      // per routed page, but the App has no stable name for a route (every
      // repository is its own path), so that waits for one.
      const workspace = await this.workspaceFor("main");
      const html = this.layout.render({ navLinks, session, content, sidebar, paneTabsBar,
                                        paneTabsDefault, workspace: workspace.arrangement });
      console.log("[App] Layout used: StandardLayout");
      console.log("[App] Rendered HTML length:", html?.length || 0);
      console.log("[App] Rendered HTML includes header-container:", html?.includes('header-container') || false);
      console.log("[App] Rendered HTML includes tabs-container:", html?.includes('tabs-container') || false);
      console.log("[App] Rendered HTML includes content-container:", html?.includes('content-container') || false);
      console.log("[App] Setting innerHTML, length:", html?.length || 0);
      this.root.innerHTML = html;
      console.log("[App] Page rendered, initializing components");
      this.initializeTabs();
      this.initializeLocationBar();
      this.initializeMounts();
      this.initializePaneNav();
      this.initializeLogoutButton();
      console.log("[App] Calling page.afterRender()");
      await page.afterRender();
      console.log("[App] Page initialization complete");
    } catch (error) {
      console.error("[App] Error in renderPage:", error);
      throw error;
    }
  }

  activateTab(tabSelector) {
    if (!tabSelector) return;

    // Find the tabs list (it's in the pane-tabs-bar)
    const tabsList = this.root.querySelector("[data-tab-list]");
    if (!tabsList) {
      console.warn("[activateTab] No tabs list found");
      return;
    }

    // Find the link for this tab
    const link = tabsList.querySelector(`a[href="${tabSelector}"]`);
    if (!link) {
      console.warn("[activateTab] Tab link not found:", tabSelector);
      return;
    }

    // Find all tab links
    const contentArea = this.root.querySelector("#content-container");
    if (!contentArea) {
      console.warn("[activateTab] Content container not found");
      return;
    }

    const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));

    // Get ALL panes in the content area
    const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));

    const panelId = tabSelector.replace("#", "");
    const targetPanel = contentArea.querySelector(`#${CSS.escape(panelId)}`);

    if (!targetPanel) {
      console.warn("[activateTab] Panel not found:", panelId);
      return;
    }

    // Hide ALL panes, then show only the target
    allPanes.forEach((pane) => {
      pane.style.display = pane.id === panelId ? "block" : "none";
    });

    // Update active link
    allLinks.forEach((l) => l.classList.remove("active"));
    link.classList.add("active");

    // Update body class
    const bodyClass = link.getAttribute("data-body-class");
    if (bodyClass) {
      document.body.className = bodyClass;
    }

    // Update aside visibility
    const aside = this.root.querySelector("#aside");
    if (aside) {
      aside.style.display = link.dataset.showAside === "true" ? "" : "none";
    }

    // Update location bar
    const location = link.getAttribute("data-location");
    if (location) {
      this.updateLocationBar(location);
    }
  }

  async renderNotFound(ctx) {
    await this.renderPage(new NotFoundPage({ ...ctx, state: this.state }));
  }

  async renderMyAccount(ctx) {
    const current = this.state.getCurrentAccount();
    if (!current) {
      this.router.navigate("/login", { replace: true });
      return;
    }
    const basePath = APP_CONFIG.basePath || "";
    this.router.navigate(`${basePath}/account/${current.friendlyId}`, { replace: true });
  }

  handleLogout() {
    console.log("[Logout] handleLogout() called");
    
    // Store account name before clearing state (to preserve it for login form pre-fill)
    const accountName = this.state.session?.accountName;
    
    // Close all view panes first (they depend on repositories)
    const openViews = this.state.listOpenViews();
    for (const { accountName: viewAccount, repositoryName, viewName } of openViews) {
      this.state.removeOpenView(viewAccount, repositoryName, viewName);
      // Remove view pane from DOM if it exists
      const viewPaneId = `tab-view-${viewAccount.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${viewName.replace(/[^a-z0-9_-]/gi, "-")}`;
      const viewPane = document.getElementById(viewPaneId);
      if (viewPane) {
        viewPane.remove();
      }
      // Remove view tab from tabs bar if it exists
      const viewTab = document.querySelector(`[data-tab-link][href="#${viewPaneId}"]`);
      if (viewTab) {
        const tabListItem = viewTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Close all repository panes (they depend on accounts)
    const openRepositories = Array.from(this.state.listOpenRepositories());
    for (const { accountName: repoAccount, repositoryName } of openRepositories) {
      this.state.removeOpenRepository(repoAccount, repositoryName);
      // Remove repository pane from DOM if it exists
      const repoPaneId = `tab-repository-${repoAccount.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
      const repoPane = document.getElementById(repoPaneId);
      if (repoPane) {
        repoPane.remove();
      }
      // Remove repository tab from tabs bar if it exists
      const repoTab = document.querySelector(`[data-tab-link][href="#${repoPaneId}"]`);
      if (repoTab) {
        const tabListItem = repoTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Close all account panes
    const openAccounts = Array.from(this.state.listOpenAccounts());
    for (const accountNameToClose of openAccounts) {
      this.state.removeOpenAccount(accountNameToClose);
      // Remove account pane from DOM if it exists
      const accountPaneId = `tab-account-${accountNameToClose.replace(/[^a-z0-9_-]/gi, "-")}`;
      const accountPane = document.getElementById(accountPaneId);
      if (accountPane) {
        accountPane.remove();
      }
      // Remove account tab from tabs bar if it exists
      const accountTab = document.querySelector(`[data-tab-link][href="#${accountPaneId}"]`);
      if (accountTab) {
        const tabListItem = accountTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Clear all editor instances
    if (this.editorInstances) {
      this.editorInstances.clear();
    }
    
    // Clear repository config cache
    if (this.state._repoConfigCache) {
      this.state._repoConfigCache.clear();
    }
    
    // Clear authentication tokens for all accounts
    console.log("[Logout] Clearing auth store");
    this.state.authStore.clear();
    
    // Clear session state (this preserves accountName for login form pre-fill)
    console.log("[Logout] Clearing session");
    this.state.session.logout();

    // Update header links to show Signup instead of Logout
    this.updateHeaderLinks();

    // Navigate to login page (this will trigger a full page re-render, cleaning up any remaining UI)
    console.log("[Logout] Navigating to /login");
    console.log("[Logout] Router instance:", this.router);
    console.log("[Logout] Router updateLocation:", this.router?.updateLocation);
    this.router.navigate("/login", { replace: true });
    console.log("[Logout] Navigation called, handleLogout() complete");
  }

  updateHeaderLinks() {
    const navLinks = this.navLinks();
    const isLoggedIn = this.state.session?.isLoggedIn();
    const nav = this.root.querySelector("#nav ul.nav");
    if (!nav) return;

    // Build new links HTML
    const linksHtml = [
      ...(isLoggedIn ? navLinks.loggedIn : navLinks.loggedOut),
      ...navLinks.global,
    ].map((link) => `<li>${link}</li>`).join('');

    nav.innerHTML = linksHtml;

    // Re-initialize logout button handler if logged in
    if (isLoggedIn) {
      this.initializeLogoutButton();
    }
  }

  /**
   * The bar, as the instruction channel (U-76; D-AU).
   *
   * Everything it used to do it still does -- click to type, Enter to go,
   * Escape to give up -- and a bare path still navigates with or without the
   * preface.  What is new is that a line which is NOT a path is an
   * instruction against whatever the bar says it is addressing, which is the
   * only affordance on the screen that is always there and therefore the
   * only one that can be asked for a change before anything has been
   * generated.
   *
   * The behaviour is in `components/location-bar.js' over a grammar in
   * `lib/app/instructions.js'; this method is the wiring, and deliberately
   * holds no decisions of its own.
   */
  initializeLocationBar() {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const was = this.locationBar?.address() || null;
    this.locationBar = mountLocationBar(bar, {
      navigate: (path) => this.router?.navigate(path || "/"),
      targets: () => this.addressableTargets(),
      instruct: (request) => this.instruct(request),
      arrange: (request) => this.arrange(request),
      path: () => this.router?.currentPath || this.router?.getCurrentPath?.() || "/",
    });
    // The page was redrawn, not reloaded: an address the user set before the
    // redraw is still the one they mean, and losing it on every navigation
    // would make the target feel accidental.
    if (was && this.locationBar) this.locationBar.setAddress(was.id);
  }

  /**
   * The press that opens a mounted presentation (U-86, §21.4.3).
   *
   * Wired here, from outside every document on the screen, because that is
   * the claim phase 8 rests on: expansion is triggered by an act external to
   * the representation, so there is no cycle to guard against and no visited
   * set anywhere in the phase.  A mounted document reaching this method
   * would make that claim false, and it cannot: the only thing that calls it
   * is `renderPage', against the chrome the App itself just drew.
   *
   * What a press draws is the mounted presentation's own tree, reconciled
   * into the band with no host registry — so a mount inside it is drawn as
   * inert as this one was, and takes its own press.
   */
  initializeMounts() {
    installExpanders(this.root, { expand: (request) => this.expandMount(request) });
  }

  /** Read one mounted presentation and draw it where it is mounted. */
  async expandMount({ name, band }) {
    const accountName = this.state.session?.accountName || null;
    if (!accountName) return { ok: false, error: "sign in to open a mounted presentation" };
    const auth = this.state.getAuthContext?.(accountName) || {};
    const read = await readPresentation({ host: auth.host, account: accountName,
                                          token: auth.token, name, reader: accountName });
    if (!read.ok) return { ok: false, error: read.errors?.[0] || read.error || "it could not be read" };
    return expandInto(band, { presentation: read.document, name,
                              revision: read.document?.revision ?? null });
  }

  showLocationMessage(message, duration = 3000) {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    if (!display) return;

    const originalText = display.textContent;
    display.textContent = message;
    display.style.fontStyle = "italic";

    setTimeout(() => {
      display.textContent = originalText;
      display.style.fontStyle = "";
    }, duration);
  }

  updateLocationBar(path) {
    if (this.locationBar) { this.locationBar.setPath(path); return; }
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    const input = bar.querySelector("#location-input");
    if (!display || !input) return;
    display.textContent = path;
    input.value = path;
  }

  initializePaneNav() {
    const backButtons = Array.from(this.root.querySelectorAll('[data-action="nav-back"]'));
    const forwardButtons = Array.from(this.root.querySelectorAll('[data-action="nav-forward"]'));
    if (!backButtons.length || !forwardButtons.length || !this.router) return;
    backButtons.forEach((button) => {
      button.onclick = () => this.router.goBack();
    });
    forwardButtons.forEach((button) => {
      button.onclick = () => this.router.goForward();
    });
    this.updatePaneNav();
  }

  updatePaneNav() {
    const backButtons = Array.from(this.root.querySelectorAll('[data-action="nav-back"]'));
    const forwardButtons = Array.from(this.root.querySelectorAll('[data-action="nav-forward"]'));
    if (!backButtons.length || !forwardButtons.length || !this.router) return;
    const canBack = this.router.canGoBack();
    const canForward = this.router.canGoForward();
    backButtons.forEach((button) => {
      button.disabled = !canBack;
    });
    forwardButtons.forEach((button) => {
      button.disabled = !canForward;
    });
  }

  initializeLogoutButton() {
    console.log("[Logout] initializeLogoutButton called");
    const logoutButton = this.root.querySelector('[data-action="logout"]');
    console.log("[Logout] Button found:", !!logoutButton, logoutButton);
    if (logoutButton) {
      console.log("[Logout] Button href:", logoutButton.getAttribute("href"));
      console.log("[Logout] Button data-action:", logoutButton.getAttribute("data-action"));
      // Check if handler already attached (prevent duplicates)
      if (logoutButton.dataset.logoutHandlerAttached === "true") {
        console.log("[Logout] Handler already attached, skipping");
        return;
      }
      logoutButton.dataset.logoutHandlerAttached = "true";
      // Use capture phase to ensure our handler runs before router's handler
      logoutButton.addEventListener("click", (e) => {
        console.log("[Logout] Click handler FIRED");
        console.log("[Logout] Event target:", e.target);
        console.log("[Logout] Event currentTarget:", e.currentTarget);
        console.log("[Logout] Event phase:", e.eventPhase, "(1=CAPTURING, 2=AT_TARGET, 3=BUBBLING)");
        console.log("[Logout] Event defaultPrevented before:", e.defaultPrevented);
        console.log("[Logout] Calling preventDefault()");
        e.preventDefault();
        console.log("[Logout] Event defaultPrevented after:", e.defaultPrevented);
        console.log("[Logout] Calling stopPropagation()");
        e.stopPropagation();
        console.log("[Logout] Calling stopImmediatePropagation()");
        e.stopImmediatePropagation();
        console.log("[Logout] Calling handleLogout()");
        this.handleLogout();
        console.log("[Logout] handleLogout() returned");
      }, true); // Use capture phase
      console.log("[Logout] Event listener attached in CAPTURE phase");
    } else {
      console.warn("[Logout] Logout button not found!");
    }
  }

  initializeTabs() {
    // Find the visible tabs container (either #login-tabs or #loggedin-tabs)
    const loginTabs = this.root.querySelector("#login-tabs");
    const loggedInTabs = this.root.querySelector("#loggedin-tabs");
    const visibleTabsContainer = (loginTabs && loginTabs.style.display !== "none") ? loginTabs :
                                  (loggedInTabs && loggedInTabs.style.display !== "none") ? loggedInTabs : null;

    // Find the tabs list within the visible container
    const tabsList = visibleTabsContainer?.querySelector("[data-tab-list]") || this.root.querySelector("[data-tab-list]");
    if (!tabsList) {
      console.log("[App] initializeTabs: No tabs list found");
      return;
    }

    // Get all tab links, including intro tab which uses href="/"
    const links = Array.from(tabsList.querySelectorAll("[data-tab-link]"));

    // Find panels in the content-container
    const contentArea = this.root.querySelector("#content-container");
    if (!contentArea) {
      console.log("[App] initializeTabs: No content container found");
      return;
    }

    // Get ALL panes in the content area (not just those with tabs)
    const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));

    // Build panels array from links for mapping
    const panels = links
        .map((link) => {
          const href = link.getAttribute("href");
          if (!href || !href.startsWith("#")) return null;
          const id = href.replace("#", "");
          return contentArea.querySelector(`#${CSS.escape(id)}`);
        })
        .filter(Boolean);

      if (!links.length || !panels.length) {
        console.log("[App] initializeTabs: No links or panels found", { links: links.length, panels: panels.length });
        return;
      }

      // Get default tab from the wrapper div (data-default-tab is on #login-tabs or #loggedin-tabs)
      const tabsWrapper = tabsList.closest("[data-default-tab]") || visibleTabsContainer;
      const defaultTab = tabsWrapper?.getAttribute("data-default-tab") || null;
      console.log("[App] initializeTabs: defaultTab attribute:", defaultTab);
      console.log("[App] initializeTabs: Available panels:", panels.map(p => p.id));
      console.log("[App] initializeTabs: Available links:", links.map(l => l.getAttribute("href")));
      
      let defaultPanel = null;
      if (defaultTab) {
        // Try multiple selectors to find the default panel
        const selectors = [
          defaultTab,
          `#${defaultTab.replace("#", "")}`,
          `.account-pane${defaultTab}`,
          `.repository-pane${defaultTab}`,
          `.pane ${defaultTab}`,
        ];
        for (const selector of selectors) {
          defaultPanel = contentArea.querySelector(selector);
          if (defaultPanel) {
            console.log("[App] initializeTabs: Found default panel with selector:", selector, defaultPanel.id);
            break;
          }
        }
        // If still not found, try finding by ID in panels array
        if (!defaultPanel) {
          const tabId = defaultTab.replace("#", "");
          defaultPanel = panels.find(p => p.id === tabId);
          if (defaultPanel) {
            console.log("[App] initializeTabs: Found default panel in panels array:", defaultPanel.id);
          }
        }
      }
      if (!defaultPanel) {
        defaultPanel = panels[0];
        console.log("[App] initializeTabs: Using first panel as default:", defaultPanel?.id);
      }
      
      const defaultLink = defaultPanel 
        ? links.find((link) => {
            const href = link.getAttribute("href");
            const linkPanelId = href === "/" ? "tab-info" : (href?.startsWith("#") ? href.replace("#", "") : null);
            return linkPanelId === defaultPanel.id;
          }) || links[0]
        : links[0];
      console.log("[App] initializeTabs: Default panel:", defaultPanel?.id, "Default link:", defaultLink?.getAttribute("href"));

      // Helper function to hide all panes and show only the target
      // Query DOM fresh each time to handle dynamically added panes
      const showOnlyPane = (targetId) => {
        const currentPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
        currentPanes.forEach((pane) => {
          pane.style.display = pane.id === targetId ? "block" : "none";
        });
      };

      // Hide ALL panes first, then show default
      allPanes.forEach((pane) => {
        pane.style.display = "none";
      });
      // Show default panel
      if (defaultPanel) {
        defaultPanel.style.display = "block";
        console.log("[App] initializeTabs: Set default panel display to block:", defaultPanel.id);
      }
      links.forEach((link) => link.classList.remove("active"));
      if (defaultLink) {
        defaultLink.classList.add("active");
        const bodyClass = defaultLink.getAttribute("data-body-class");
        if (bodyClass) {
          document.body.className = bodyClass;
        }
      }
      const aside = this.root.querySelector("#aside");
      if (aside) {
        aside.style.display = defaultLink?.dataset.showAside === "true" ? "" : "none";
      }
      links.forEach((link, index) => {
        link.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();

          const location = link.getAttribute("data-location");
          const href = link.getAttribute("href");
          // Handle intro tab which uses href="/" instead of href="#tab-info"
          const panelId = href === "/" ? "tab-info" : (href?.startsWith("#") ? href.replace("#", "") : null);

          // Find the target panel
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;

          if (targetPanel) {
            // Panel exists - hide ALL panes and show only this one
            showOnlyPane(panelId);
            links.forEach((item) => item.classList.remove("active"));
            link.classList.add("active");
            const bodyClass = link.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = this.root.querySelector("#aside");
            if (aside) {
              aside.style.display = link.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              this.updateLocationBar(location);
            }
          } else if (location && this.router) {
            // Panel doesn't exist - navigate to create it
            this.router.navigate(location);
          }
        });
      });

    tabsList.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-tab-action]");
        if (!actionButton) return;
        event.preventDefault();
        event.stopPropagation();
        const action = actionButton.getAttribute("data-tab-action");
        const tabId = actionButton.getAttribute("data-tab-id");
        const tabType = actionButton.getAttribute("data-tab-type");
        const accountName = actionButton.getAttribute("data-account");
        const repositoryName = actionButton.getAttribute("data-repository");
        const viewName = actionButton.getAttribute("data-view");
        if (action === "close") {
          // Find the tab link that contains this close button
          const tabLink = actionButton.closest("[data-tab-link]");
          if (tabLink) {
            // Find all tab links in order
            const allTabLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            const currentIndex = allTabLinks.indexOf(tabLink);
            
            // Determine which tab should be active next: right if exists, otherwise left
            let nextTabLink = null;
            if (currentIndex < allTabLinks.length - 1) {
              // Tab to the right exists
              nextTabLink = allTabLinks[currentIndex + 1];
            } else if (currentIndex > 0) {
              // Tab to the left exists
              nextTabLink = allTabLinks[currentIndex - 1];
            }
            
            // Store the next tab href to activate after closing
            const nextTabHref = nextTabLink ? nextTabLink.getAttribute("href") : null;
            this.closePane({ tabType, tabId, accountName, repositoryName, viewName, nextTabHref });
          } else {
            this.closePane({ tabType, tabId, accountName, repositoryName, viewName });
          }
        }
        if (action === "save") {
          if (actionButton.getAttribute("aria-disabled") === "true") {
            return;
          }
          this.savePane({ tabType, tabId, accountName, repositoryName });
        }
      });

      // Add drag handlers for view pane tabs
      const viewTabLinks = tabsList.querySelectorAll('[data-tab-type="view"]');
      viewTabLinks.forEach((link) => {
        link.setAttribute("draggable", "true");
        let dragSessionId = null;

        link.addEventListener("dragstart", (event) => {
          const tabId = link.getAttribute("data-tab-id");
          const accountName = link.getAttribute("data-account");
          const repositoryName = link.getAttribute("data-repository");
          const viewName = link.getAttribute("data-view");

          if (!tabId || !accountName || !repositoryName || !viewName) {
            event.preventDefault();
            return;
          }

          // Get editor instance
          const editorApi = this.editorInstances.get(tabId);
          if (!editorApi) {
            console.warn("[App] No editor instance found for tab:", tabId);
            event.preventDefault();
            return;
          }

          // Extract editor state
          const queryText = editorApi.getQuery();
          const queryTabs = editorApi.getQueryTabs();
          const currentTabId = editorApi.getCurrentTabId();

          // Get authentication token
          const auth = this.state.getAuthContext(accountName);
          const host = auth?.host || window.location.origin;
          const accessToken = this.state.getAuthToken(accountName);
          const viewUrl = `${host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(viewName)}`;

          // Generate session ID
          dragSessionId = `editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Prepare data to transfer
          const transferData = {
            accountName,
            repositoryName,
            viewName,
            viewUrl,
            accessToken,
            queryText,
            results: queryTabs,
            currentTabId,
            sessionId: dragSessionId,
          };

          // Store in sessionStorage
          try {
            sessionStorage.setItem(`editor-session-${dragSessionId}`, JSON.stringify(transferData));
          } catch (e) {
            console.error("[App] Failed to store editor data in sessionStorage:", e);
            event.preventDefault();
            return;
          }

          // Set drag data
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", dragSessionId);
          }
        });

        link.addEventListener("dragend", (event) => {
          // Check if drag ended outside window
          const clientX = event.clientX;
          const clientY = event.clientY;

          // If coordinates are 0,0, the drag was cancelled (ESC key)
          if (clientX === 0 && clientY === 0) {
            if (dragSessionId) {
              sessionStorage.removeItem(`editor-session-${dragSessionId}`);
            }
            return;
          }

          // Check if drag ended outside window bounds
          const isOutsideWindow =
            clientX < 0 ||
            clientY < 0 ||
            clientX > window.innerWidth ||
            clientY > window.innerHeight;

          if (isOutsideWindow && dragSessionId) {
            const accountName = link.getAttribute("data-account");
            const auth = this.state.getAuthContext(accountName);
            const accessToken = this.state.getAuthToken(accountName);

            // Encode token for URL hash
            const encodedToken = encodeURIComponent(accessToken || "");

            // Open new window
            const basePath = APP_CONFIG.basePath || "/ui";
            const url = `${basePath}/standalone-editor#sessionId=${dragSessionId}&token=${encodedToken}`;
            const newWindow = window.open(
              url,
              "_blank",
              "width=1200,height=800,scrollbars=yes,resizable=yes"
            );

            if (!newWindow) {
              // Popup blocked
              alert("Popup blocked. Please allow popups for this site to open editor in new window.");
              sessionStorage.removeItem(`editor-session-${dragSessionId}`);
            } else {
              // Clean up sessionStorage after a delay (let new window read it first)
              setTimeout(() => {
                try {
                  sessionStorage.removeItem(`editor-session-${dragSessionId}`);
                } catch (e) {
                  // Ignore cleanup errors
                }
              }, 5000);
            }
          } else if (dragSessionId) {
            // Drag ended inside window, clean up
            sessionStorage.removeItem(`editor-session-${dragSessionId}`);
          }
        });
      });
  }

  closePane({ tabType, tabId, accountName, repositoryName, viewName, nextTabHref }) {
    if (!this.state) return;
    
    let paneId;
    if (tabType === "account" && accountName) {
      paneId = `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenAccount(accountName);
      // Remove pane and tab
      const pane = document.getElementById(paneId);
      if (pane) pane.remove();
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) tabLink.closest("li")?.remove();
      // If we're currently viewing this account, activate login pane instead
      if (this.router?.currentPath?.startsWith(`/account/${accountName}`)) {
        // Activate login pane (it should exist, but if not, navigate to create it)
        const loginPane = document.getElementById("tab-login");
        if (loginPane) {
          this.activateTab("#tab-login");
        } else {
          // Login pane doesn't exist - navigate to /login which will create it
          this.router.navigate("/login");
        }
        return;
      }
      // If not currently viewing this account, just remove it and activate next tab
      // (handled by the code below)
    } else if (tabType === "repository" && accountName && repositoryName) {
      paneId = `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenRepository(accountName, repositoryName);
      // Remove pane and tab
      const pane = document.getElementById(paneId);
      if (pane) pane.remove();
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) tabLink.closest("li")?.remove();
      // If we're currently viewing this repository, activate account pane instead
      if (this.router?.currentPath?.startsWith(`/account/${accountName}/repositories/${repositoryName}`)) {
        // Activate account pane (it should exist)
        const accountPaneId = `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
        const accountPane = document.getElementById(accountPaneId);
        if (accountPane) {
          this.activateTab(`#${accountPaneId}`);
        } else {
          // Account pane doesn't exist - navigate to account which will create it
          this.router.navigate(`/account/${accountName}`);
        }
        return;
      }
      // If not currently viewing this repository, just remove it and activate next tab
      // (handled by the code below)
    } else if (tabType === "view" && accountName && repositoryName && viewName) {
      paneId = `tab-view-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${viewName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenView(accountName, repositoryName, viewName);
    } else {
      // Fallback: use tabId if provided
      paneId = tabId;
    }
    
    // Remove the pane element from DOM
    if (paneId) {
      const pane = document.getElementById(paneId);
      if (pane) {
        pane.remove();
      }
    }
    
    // Remove the tab from the tabs bar
    if (paneId) {
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) {
        tabLink.closest("li")?.remove();
      }
    }
    
    // Activate the next tab if specified, otherwise activate the rightmost or leftmost tab
    if (nextTabHref) {
      this.activateTab(nextTabHref);
    } else {
      // Find the next tab to activate (right, then left)
      const tabsList = document.querySelector("[data-tab-list]");
      if (tabsList) {
        const allTabs = Array.from(tabsList.querySelectorAll("li"));
        const currentTabIndex = paneId ? allTabs.findIndex(li => {
          const link = li.querySelector(`[href="#${paneId}"]`);
          return link !== null;
        }) : -1;
        
        if (currentTabIndex >= 0) {
          // Try to activate tab to the right
          if (currentTabIndex < allTabs.length - 1) {
            const nextTab = allTabs[currentTabIndex + 1];
            const nextLink = nextTab.querySelector("[data-tab-link]");
            if (nextLink) {
              this.activateTab(nextLink.getAttribute("href"));
              return;
            }
          }
          // Otherwise activate tab to the left
          if (currentTabIndex > 0) {
            const prevTab = allTabs[currentTabIndex - 1];
            const prevLink = prevTab.querySelector("[data-tab-link]");
            if (prevLink) {
              this.activateTab(prevLink.getAttribute("href"));
              return;
            }
          }
        }
      }
    }
  }

  async savePane({ tabType, tabId, accountName, repositoryName }) {
    if (window.saveAccountPane && tabType === "account") {
      await window.saveAccountPane(accountName);
    }
    if (window.saveRepositoryPane && tabType === "repository") {
      await window.saveRepositoryPane(accountName, repositoryName);
    }
  }
}
