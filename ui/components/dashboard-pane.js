/**
 * The dashboard pane: Gate 0, Gate 1, Gate 2, and the page between them.
 *
 * This is §7 of `llm-result-rendering-plan.md' made into a surface.  The
 * exploration pane next door arrives at a QUERY and hands it to the view
 * editor; this one arrives at a PAGE -- several queries, a layout, computation
 * over the results and prose about them -- and the difference that matters is
 * not the output but where the user's word is required.
 *
 *   Gate 0  authority, once, before the model starts (D-O).  Repositories,
 *           read-only, a call ceiling, a row and byte budget, a lifetime.
 *           Charged per call, shown while it runs, revocable mid-run, and
 *           widenable a notch at a time without restarting.
 *   Phase 1 the model explores inside that grant.  No further confirmation:
 *           twelve dialogs is not twelve decisions, it is one dialog the user
 *           learns to dismiss.
 *   Gate 1  the PANEL SET, reviewed together -- every query, every transform's
 *           source, every sentence the model wrote and what it wrote it from.
 *           This is the last point before anything runs.
 *   Phase 2 the interface runs the panels itself, under the user's own token
 *           (D-I).  The model never executes anything.
 *   Phase 3 the page is mounted sandboxed (D-R) and the results are posted
 *           into it.  It binds; it does not embed (D-P).
 *   Gate 2  disposition: keep the panels as views, save the page, or discard.
 *
 * The pane shows the model's prose as well as its JSON, because the prose is
 * what makes the JSON reviewable: "the second panel is the same measure by
 * quarter rather than by region" is the sentence that lets someone read two
 * similar queries without diffing them.
 */

// The credentials are the exploration pane's: `paneState' is keyed by
// repository, so a key typed there is present here and neither pane asks
// twice.  This pane therefore has no Connection block of its own.
import { paneState } from "./mcp-pane-state.js";
import { createToolAdapter, DASHBOARD_TOOLS, DEFAULT_SYSTEM } from "../../lib/llm/tool-adapter.js";
import { createGrant, DEFAULT_GRANT } from "../../lib/llm/grant.js";
import { dashboardSystem, revisionSystem } from "../../lib/llm/dashboard-prompt.js";
import {
  withInputDigests, staleAssertions, dashboardRecord,
} from "../../lib/dashboard/spec.js";
import { mountDashboard } from "../../lib/dashboard/frame.js";
import {
  validateApplication, applicationFrom, mintId, specOf,
} from "../../lib/app/document.js";
import { applyPatch, patchFrom, panelDiff, classify } from "../../lib/app/patch.js";
import { makeDisclosure } from "./disclosure.js";
import { markStage } from "./provenance-note.js";
import { promptVerdict, answerVerdict, budgetLine } from "../../lib/llm/budget.js";
import { defaultValues, bindParameters } from "../../lib/app/parameters.js";
import { createRepairLoop, groupFailures, repairPrompt } from "../../lib/app/repair.js";
import {
  createInteractionBudget, budgetForPage, DEFAULT_INTERACTION,
} from "../../lib/app/interaction.js";
import { runPanels, payloadsFor, totals } from "../../lib/dashboard/runner.js";
import { putPanelSet, promoteView, sweep, runId, tempName } from "../../lib/dashboard/catalog.js";
import { listDashboards, readDashboard } from "../../lib/dashboard/archive.js";
import { recordRun } from "../../lib/mcp/transcript-store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slug = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "-");
const kib = (n) => `${Math.round((Number(n) || 0) / 1024)} KiB`;

/** The parameter values hiding in a restored state map, and nothing else. */
const pick = (state, parameters = []) => Object.fromEntries(
  parameters.filter((p) => state && state[p.name] != null).map((p) => [p.name, state[p.name]]));

/* ─────────────────────────── styling ─────────────────────────── */

const STYLE = `
.dashboard-pane { font-size: 12px; }
.dashboard-pane .dsh-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-weight: bold; background: #eef2f7;
  border-bottom: 1px solid #d7e0ea; }
.dashboard-pane .dsh-head .dsh-close {
  background: transparent; border: none; cursor: pointer; font-size: 15px;
  line-height: 1; color: #666; padding: 0 2px; }
.dashboard-pane .dsh-body { padding: 8px 10px 10px; }
.dashboard-pane section.dsh-stage {
  border: 1px solid #e2e6ea; border-radius: 4px; background: #fff;
  margin-bottom: 8px; }
.dashboard-pane section.dsh-stage > h3 {
  margin: 0; padding: 5px 9px; font-size: 11px; letter-spacing: .06em;
  text-transform: uppercase; color: #5b6672; background: #f7f9fb;
  border-bottom: 1px solid #eef1f4; display: flex; gap: 8px; align-items: baseline; }
.dashboard-pane section.dsh-stage > h3 .dsh-sub {
  font-weight: normal; letter-spacing: 0; text-transform: none; color: #8a94a0; }
.dashboard-pane .dsh-stage-body { padding: 8px 9px 9px; }
.dashboard-pane section.dsh-gate { border-color: #ecdcc8; }
.dashboard-pane section.dsh-gate > h3 { background: #fdf8f2; color: #8a5a1a;
  border-bottom-color: #f0e6d8; }

.dashboard-pane .dsh-grid {
  display: grid; grid-template-columns: auto 1fr; gap: 5px 9px; align-items: center; }
.dashboard-pane .dsh-grid label { color: #555; }
.dashboard-pane .dsh-grid input[type=text],
.dashboard-pane .dsh-grid input[type=number] {
  width: 100%; font-size: 12px; padding: 2px 4px; box-sizing: border-box;
  border: 1px solid #ccd3da; border-radius: 3px; }
.dashboard-pane .dsh-prompt {
  min-height: 50px; border: 1px solid #ccd3da; border-radius: 4px; padding: 7px 8px;
  background: #fff; font-size: 13px; line-height: 1.45; }
.dashboard-pane .dsh-prompt:empty::before { content: attr(data-placeholder); color: #aaa; }
.dashboard-pane .dsh-actions { display: flex; gap: 8px; align-items: center;
  flex-wrap: wrap; margin-top: 8px; }
.dashboard-pane .dsh-actions button { padding: 4px 13px; cursor: pointer; font-size: 12px; }
.dashboard-pane button.dsh-primary { background: #1f4e79; color: #fff;
  border: 1px solid #1a4166; border-radius: 3px; }
.dashboard-pane button.dsh-primary:disabled { background: #9fb3c6; border-color: #9fb3c6;
  cursor: default; }
.dashboard-pane .dsh-note { color: #666; }
.dashboard-pane .dsh-warn { color: #8a5a1a; }
.dashboard-pane .dsh-err  { color: #8a2b2b; }

.dashboard-pane .dsh-meter { display: flex; gap: 12px; flex-wrap: wrap;
  font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #44505c; }
.dashboard-pane .dsh-bar { height: 4px; background: #eef1f4; border-radius: 2px;
  overflow: hidden; margin-top: 3px; }
.dashboard-pane .dsh-bar > i { display: block; height: 100%; background: #6a9ad0; }
.dashboard-pane .dsh-bar.over > i { background: #c76b6b; }
.dashboard-pane .dsh-interaction { border: 1px solid #eef1f4; border-radius: 3px;
  padding: 5px 8px 6px; margin: 6px 0 8px; background: #fbfcfd; }
.dashboard-pane .dsh-interaction .dsh-actions { margin-top: 5px; }

.dashboard-pane .dsh-panel { border: 1px solid #eef1f4; border-radius: 3px;
  margin-bottom: 6px; }
.dashboard-pane .dsh-panel > header { display: flex; gap: 8px; align-items: baseline;
  padding: 4px 8px; background: #fbfcfd; border-bottom: 1px solid #f0f2f4; }
.dashboard-pane .dsh-panel > header b { font-family: ui-monospace, Menlo, monospace; }
.dashboard-pane .dsh-panel > header .dsh-kind {
  font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 1px 5px;
  border-radius: 8px; }
.dashboard-pane .dsh-kind-bound    { background: #e9f1f8; color: #1f4e79; }
.dashboard-pane .dsh-kind-derived  { background: #eaf2ea; color: #2d662d; }
.dashboard-pane .dsh-kind-asserted { background: #fdf3e0; color: #8a5a1a; }
.dashboard-pane .dsh-kind-param    { background: #f0eaf6; color: #5a3d7a; }
/* The show/hide control, as js/sparql-editor.js draws it on every view editor.
   It sits at the end of its header, which is itself the click target -- a 16px
   square is findable only by someone already hunting for it. */
.dashboard-pane .dsh-toggle {
  flex: none; margin-left: auto; width: 16px; height: 16px; padding: 1px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb;
  color: #111827; cursor: pointer; align-self: center; }
.dashboard-pane .dsh-toggle:hover { background: #eef1f4; }
.dashboard-pane .dsh-disclosing { cursor: pointer; user-select: none; }
/* A header whose own note already claims the right-hand margin: the caret
   follows it rather than fighting it for the same auto margin. */
.dashboard-pane .dsh-panel > header .dsh-note[style*="auto"] ~ .dsh-toggle { margin-left: 8px; }
.dashboard-pane pre.dsh-was { background: #fdf3f3; color: #7a5252;
  text-decoration: line-through; text-decoration-color: #d8b4b4; }
.dashboard-pane pre.dsh-pre { margin: 0; padding: 6px 8px; background: #fbfcfd;
  font-family: ui-monospace, Menlo, monospace; font-size: 11px; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }
.dashboard-pane p.dsh-prose { margin: 0 0 7px; font-size: 12.5px; line-height: 1.5;
  white-space: pre-wrap; }
.dashboard-pane .dsh-log { font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  color: #44505c; max-height: 160px; overflow: auto; white-space: pre-wrap; }
.dashboard-pane .dash-frame { display: block; }
`;

function ensureStyle(doc) {
  if (doc.getElementById("dashboard-pane-style")) return;
  const s = doc.createElement("style");
  s.id = "dashboard-pane-style";
  s.textContent = STYLE;
  doc.head.appendChild(s);
}

/* ─────────────────────────── small DOM helpers ─────────────────────────── */

function el(doc, tag, props = {}, children = []) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}

/**
 * The output ceiling for the one turn that writes the page.
 *
 * 16000 was the first guess and it was too small: a page of any substance,
 * written as a JSON string after a paragraph of prose, does not fit -- and the
 * failure it produces is the worst-shaped one available, because a block cut
 * off before its closing fence parses as NO BLOCK AT ALL.  The run then looks
 * like a model that declined to answer.  The number is stated to the model
 * too (`answerBudget'), since it is the only side that can spend it.
 */
export const ANSWER_TOKENS = 32000;

/**
 * The prose of a turn: what is left when the fenced blocks are taken out.
 *
 * The second replace is the one that matters.  A turn cut off inside its block
 * leaves a fence that never closes, and a pattern that only matches PAIRS
 * leaves the whole unfinished page sitting in the prose -- where the gate
 * presents it to the user as the model's answer.  Everything from an unmatched
 * fence to the end is the amputated block, not prose.
 */
function proseOf(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/```[\s\S]*$/, "")
    .trim();
}

/** An answer block begun and never closed: the mark of a turn cut off. */
function openFence(text) {
  return /```(?:dashboard|application|patch|json)\s*\n(?![\s\S]*```)/i.test(String(text || ""));
}

/**
 * One stage of the run, with the view editors' own show/hide control.
 *
 * A dashboard run leaves every stage on the screen -- the grant, the model's
 * work, the panel set, the page, the revise box -- because each of them is
 * evidence for the next and throwing one away would make the page the only
 * thing left to trust.  The cost is a column several screens long by the time
 * anyone is reading the page itself.  Collapsing is the answer to that, and
 * it is the one this interface already has: the same caret `js/sparql-editor.js'
 * puts on every view editor (`ui/components/disclosure.js').
 *
 * Open by default, all of them.  A stage that hid itself would be a gate that
 * hid what it was asking about.
 */
function stage(doc, title, sub, { gate = false, open = true, testid = null } = {}) {
  const sec = el(doc, "section", { class: `dsh-stage${gate ? " dsh-gate" : ""}` });
  const h = el(doc, "h3", {}, [el(doc, "span", { text: title })]);
  if (sub) h.appendChild(el(doc, "span", { class: "dsh-sub", text: sub }));
  sec.appendChild(h);
  const body = el(doc, "div", { class: "dsh-stage-body" });
  sec.appendChild(body);
  const toggle = makeDisclosure(doc, {
    header: h, body, open, className: "dsh-toggle",
    testid: testid ? `dashboard-toggle-${testid}` : null,
    labels: { shown: `Hide ${title}`, hidden: `Show ${title}` },
  });
  h.appendChild(toggle);
  // §2.6 R-P2: the disclosure is on the screen while the content is.  It is
  // added here, at construction, so that no stage can be built without one --
  // and appended to the SECTION rather than the body, so that collapsing a
  // stage does not fold its disclosure away.
  sec._provenance = markStage(sec, null,
                              { testid: testid ? `dashboard-provenance-${testid}` : null });
  sec._body = body;
  sec._sub = h.lastChild === toggle ? h.children[h.children.length - 2] : h.lastChild;
  sec._toggle = toggle;
  return sec;
}

/**
 * A box inside a stage -- one panel, transform, parameter or assertion -- with
 * the same control on its own header.
 *
 * These are what actually bury Gate 1: a query is a dozen lines and a
 * transform body can be thirty, and six of them put the run button below the
 * fold on the one screen where the user is deciding whether to press it.  The
 * header keeps the kind, the name and the note visible when the body is
 * hidden, which is what makes a collapsed set still readable as a list.
 */
function panelBox(doc, { kind, label, name, notes = [], body, open = true, testid = null }) {
  const box = el(doc, "div", { class: "dsh-panel" });
  const head = el(doc, "header", {}, [
    el(doc, "span", { class: `dsh-kind dsh-kind-${kind}`, text: label }),
    el(doc, "b", { text: name }),
    ...notes.filter(Boolean),
  ]);
  box.appendChild(head);
  if (body) box.appendChild(body);
  const toggle = makeDisclosure(doc, {
    header: head, body, open, className: "dsh-toggle",
    testid: testid ? `dashboard-toggle-${testid}` : null,
    labels: { shown: `Hide ${name}`, hidden: `Show ${name}` },
  });
  head.appendChild(toggle);
  box._toggle = toggle;
  return box;
}

/* ─────────────────────────── the pane ─────────────────────────── */

export function openDashboardPane(app, { container, accountName, repositoryName,
                                          prompt: seedPrompt = "" } = {}) {
  if (!container) return null;
  const doc = container.ownerDocument || document;
  ensureStyle(doc);

  const id = `dashboard-${slug(accountName)}-${slug(repositoryName)}`;
  const existing = container.querySelector(`#${id}`);
  if (existing) {
    existing.scrollIntoView({ behavior: "smooth", block: "start" });
    return existing._dashboardApi || null;
  }

  const auth = app?.state?.getAuthContext?.(accountName) || {};
  const host = auth.host || window.location.origin;
  const st = paneState(accountName, repositoryName, host);
  st.token = auth.token || st.token || null;
  const repoKey = `${accountName}/${repositoryName}`;

  const wrapper = el(doc, "div", {
    class: "view-editor dashboard-pane", id,
    dataset: { account: accountName, repository: repositoryName, testid: "dashboard-pane" },
  });
  wrapper.appendChild(el(doc, "div", { class: "dsh-head" }, [
    el(doc, "span", { text: `/${accountName}/${repositoryName} · dashboard` }),
    el(doc, "button", { type: "button", class: "dsh-close", title: "Close",
                        dataset: { testid: "dashboard-close" }, text: "×",
                        onclick: () => { teardown(); wrapper.remove(); } }),
  ]));
  const body = el(doc, "div", { class: "dsh-body" });
  wrapper.appendChild(body);
  container.appendChild(wrapper);

  /* ── state for the whole run ── */

  let grant = null;
  let adapterResult = null;
  /**
   * What produced the content on each stage, told to the stages (§2.6 R-P2).
   *
   * The model identifier used is the one the PROVIDER SERVED -- a family name
   * can be answered with a point release, and the served identifier is the
   * fact a reconstruction needs.  `provenanceOf' falls back to the requested
   * one and records which it got, rather than silently passing off one as the
   * other.
   *
   * Gate 0 is deliberately NOT marked: nothing on it came from a model, and
   * its footnote says exactly that.  Marking it would be the over-marking
   * that teaches a reader to stop reading these.
   */
  function markRun(result) {
    const p = result ? {
      model: result.model, servedModel: result.servedModel, served: result.served,
      provider: result.provider, endpoint: result.endpoint, at: result.at,
      account: accountName, repository: repositoryName,
    } : null;
    for (const sec of [phase1, gate1, stagePage, stageRevise, gatePatch, gate2]) {
      if (sec) markStage(sec, p);
    }
    return p;
  }
  let validated = null;         // {ok, document, errors, warnings, size}
  let results = null;           // {panel: {ok, text, digest, …}}
  let mounted = null;           // the frame handle
  let run = null;               // the catalogue run id
  let tempNames = [];           // what was written, for the sweep
  let viaCatalog = false;
  let aborter = null;

  // The document, its history, and what the page has become since it loaded.
  // `appDoc' is the authority (§6.2.1): the frame holds a copy it may have
  // patched in place, and these are what a rebuild or a reopen is built from.
  let appDoc = null;            // the normalised application document
  let patches = [];             // the operations that produced this revision
  let parameterValues = {};     // what the page has chosen (D-X)
  let appState = {};            // the bounded slice of §10.3
  let frameErrors = [];         // what the page has reported since the last fill
  let repair = null;            // the bounded loop of §11
  // What the PAGE may spend, as against what the MODEL may (§15 q.3).  Every
  // run it covers is a query the user authorised at Gate 1; it bounds how
  // often, not what.
  let interaction = null;
  let revising = false;
  let lastPrompt = "";
  let startedAt = null;

  const teardown = () => {
    try { mounted?.destroy(); } catch { /* already gone */ }
    if (tempNames.length && st.token) {
      // Best effort, and deliberately not awaited: a pane closing must not
      // hang on the catalogue.  What it cannot clean, the session sweep can.
      sweep({ host, account: accountName, repository: repositoryName, token: st.token,
              names: tempNames, run }).catch(() => {});
      tempNames = [];
    }
  };

  /* ── what has been made before ── */

  // Reopening is not a replay.  Nothing is sent to a model and no gate is
  // crossed: the queries were authorised when the dashboard was made, the page
  // is the one the user already saw, and running a saved query is what the
  // view editor does all day.  It is the baseline path of §1 applied to a page
  // -- which is also why a reopened dashboard is live rather than a snapshot,
  // and why its prose can turn out to be stale the moment the panels run.
  const archive = stage(doc, "Saved dashboards", "reopened live, not replayed", { testid: "archive" });
  archive.hidden = true;
  body.appendChild(archive);

  /* ── Gate 0: the grant ── */

  const gate0 = stage(doc, "Gate 0 — authority", "granted once, charged per call",
                        { gate: true, testid: "gate0" });
  body.appendChild(gate0);

  const promptEl = el(doc, "div", {
    class: "dsh-prompt", contenteditable: "true",
    dataset: { testid: "dashboard-prompt", placeholder: "Describe the dashboard…" },
    "data-placeholder": "Describe the dashboard you want…",
  });
  promptEl.textContent = seedPrompt || "";

  const field = (label, key, value, type = "number") => {
    const input = el(doc, "input", {
      type, value: String(value), id: `${id}-${key}`,
      dataset: { testid: `dashboard-grant-${key}` },
    });
    return { label: el(doc, "label", { for: `${id}-${key}`, text: label }), input };
  };
  const fQueries = field("calls", "queries", DEFAULT_GRANT.maxQueries);
  const fRows = field("rows", "rows", DEFAULT_GRANT.maxRows);
  const fBytes = field("KiB", "bytes", Math.round(DEFAULT_GRANT.maxBytes / 1024));
  const fRepos = field("repositories", "repos", repoKey, "text");
  const fRuns = field("page runs", "runs", DEFAULT_INTERACTION.maxRuns);
  const readOnly = el(doc, "input", { type: "checkbox", checked: true,
                                      dataset: { testid: "dashboard-grant-readonly" } });
  const catalogBox = el(doc, "input", { type: "checkbox",
                                        dataset: { testid: "dashboard-grant-catalog" } });

  const grid = el(doc, "div", { class: "dsh-grid" }, [
    fRepos.label, fRepos.input,
    fQueries.label, fQueries.input,
    fRows.label, fRows.input,
    fBytes.label, fBytes.input,
    // Set here because this is where the user decides what a run may cost --
    // but it is NOT the model's authority, and the note says so.  The model
    // never makes these calls; a control on the finished page does, against
    // a query this gate's successor will have shown them.
    fRuns.label, el(doc, "span", {}, [fRuns.input,
      el(doc, "span", { class: "dsh-note",
        text: " how many times the finished page may re-run a panel by itself "
            + "(a selector, a refresh). Renewable while you read it; not the model's to spend" })]),
    el(doc, "label", { text: "read-only" }),
    el(doc, "span", {}, [readOnly,
      el(doc, "span", { class: "dsh-note",
        text: " the model may read; it may never write, and never executes anything" })]),
    el(doc, "label", { text: "catalogue" }),
    el(doc, "span", {}, [catalogBox,
      el(doc, "span", { class: "dsh-note",
        text: " write each panel as a temporary view and run it by name "
            + "(reproducible, but a configuration write per panel)" })]),
  ]);

  const grantBtn = el(doc, "button", { type: "button", class: "dsh-primary",
                                       dataset: { testid: "dashboard-grant" },
                                       text: "Grant and run" });
  const grantStatus = el(doc, "span", { class: "dsh-note",
                                        dataset: { testid: "dashboard-status" } });
  const savedBtn = el(doc, "button", { type: "button", text: "Saved…",
                                       dataset: { testid: "dashboard-saved" } });
  gate0._body.append(
    promptEl,
    el(doc, "div", { style: "height:8px" }),
    grid,
    el(doc, "div", { class: "dsh-actions" }, [grantBtn, savedBtn, grantStatus]),
  );

  savedBtn.addEventListener("click", async () => {
    if (!archive.hidden) { archive.hidden = true; return; }
    archive.hidden = false;
    archive._body.replaceChildren(el(doc, "div", { class: "dsh-note", text: "reading…" }));
    const listed = await listDashboards({ host, account: accountName, token: st.token });
    if (!listed.ok) {
      archive._body.replaceChildren(el(doc, "div", { class: "dsh-err",
        text: `could not read <${accountName}>/mcp: ${listed.error}` }));
      return;
    }
    if (!listed.dashboards.length) {
      archive._body.replaceChildren(el(doc, "div", { class: "dsh-note",
        text: "nothing recorded yet — a dashboard is written to <"
            + accountName + ">/mcp as soon as its page exists" }));
      return;
    }
    // Grouped by document, newest revision first (§10.2): a page revised four
    // times is four records, and a list that showed all four would get longer
    // the more a user worked on one thing.
    archive._body.replaceChildren(...(listed.applications || []).map((g) => {
      const d = g.latest;
      const openBtn = el(doc, "button", { type: "button", text: "Open",
                                          dataset: { testid: "dashboard-open-saved" },
                                          onclick: () => openStored(d) });
      const row = el(doc, "div", { class: "dsh-actions" }, [
        openBtn,
        el(doc, "b", { text: d.title }),
        el(doc, "span", { class: "dsh-note",
          text: `${d.recorded || ""} ${d.repository || ""} ${d.disposition || ""}`.trim() }),
      ]);
      if (g.count > 1) {
        row.appendChild(el(doc, "span", { class: "dsh-note",
          dataset: { testid: "dashboard-revisions" },
          text: `revision ${d.revision} of ${g.count}` }));
        // Earlier revisions are reachable, and continuing from one FORKS
        // rather than rewriting history: the later revisions really happened.
        for (const older of g.revisions.slice(1)) {
          row.appendChild(el(doc, "button", { type: "button", text: `r${older.revision}`,
                                              title: `open revision ${older.revision}`,
                                              onclick: () => openStored(older, { fork: true }) }));
        }
      }
      return row;
    }));
  });

  /** Reopen one: read it, run its panels now, and mark what no longer holds. */
  async function openStored(entry, options = {}) {
    archive._body.prepend(el(doc, "div", { class: "dsh-note",
                                           text: `opening ${entry.title}…` }));
    const stored = await readDashboard({ host, account: accountName, token: st.token,
                                         uri: entry.uri });
    if (!stored.ok || !stored.complete) {
      archive._body.prepend(el(doc, "div", { class: "dsh-err",
        text: stored.ok ? "that record has no page or no panels — it predates the page being kept"
                        : `could not read it: ${stored.error}` }));
      return;
    }
    const v = validateApplication(stored.document || stored.spec);
    if (!v.ok) {
      archive._body.prepend(el(doc, "div", { class: "dsh-err",
        text: `the saved page no longer validates: ${v.errors.join("; ")}` }));
      return;
    }
    // The digests the record holds are what the prose was written against;
    // validation rebuilds the assertions, so they are put back (D-T).
    v.document.assertions = v.document.assertions.map((a) => ({
      ...a,
      inputDigests: (stored.spec.assertions.find((x) => x.id === a.id) || {}).inputDigests || {},
    }));
    validated = v;
    appDoc = v.document;
    // Opening an EARLIER revision forks: a new identity, starting at
    // revision 1, because continuing from r2 of a page that reached r4 is a
    // different page from here on and rewriting r3 and r4 would be a lie
    // about what happened (§10.2).
    if (options.fork || !appDoc.id) {
      appDoc = { ...appDoc, id: mintId(), revision: 1,
                 revisionOf: entry.application ? `${entry.application}#${entry.revision}` : null };
    }
    // §10.3: reopening puts the reader back where they were.
    appState = { ...(appDoc.state || {}) };
    parameterValues = { ...defaultValues(appDoc.parameters), ...pick(appState, appDoc.parameters) };
    patches = [];
    repair = createRepairLoop();
    interaction = interaction || createInteractionBudget({}, { onChange: () => paintInteraction() });
    viaCatalog = false;          // run the recorded query text; the temporary views are long gone
    run = runId();
    results = null;
    adapterResult = adapterResult || { ok: true, iterations: 0, events: [], finalText: "" };

    stagePage.hidden = false;
    const progress = el(doc, "div", { class: "dsh-log", dataset: { testid: "dashboard-progress" } });
    const holder = el(doc, "div", { dataset: { testid: "dashboard-frame-holder" } });
    const meter = el(doc, "div", { class: "dsh-interaction",
                                   dataset: { testid: "dashboard-interaction" } });
    stagePage._body.replaceChildren(progress, meter, holder);
    results = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: appDoc.panels,
      values: parameterValues, parameters: appDoc.parameters,
      onEvent: (e) => {
        if (e.type === "panel-done") {
          progress.appendChild(el(doc, "div", { class: e.ok ? "" : "dsh-err",
            text: e.ok ? `${e.name}: ${e.rows} rows` : `${e.name}: ${e.error}` }));
        }
      },
    });
    const stale = staleAssertions(appDoc, results);
    try { mounted?.destroy(); } catch { /* first mount */ }
    frameErrors = [];
    mounted = mountDashboard(holder, appDoc, {
      onRefresh: () => refresh({ fromPage: true }),
      onRun: (request) => runOnePanel(request),
      onState: ({ key, value }) => rememberState(key, value),
      onLayout: (request) => layoutGraph(request),
      onPropose: ({ what, detail }) => presentProposalFromPage(what, detail),
      onEvent: (e) => { if (e.type === "error") frameErrors.push(e); },
      doc,
    });
    mounted.post({ results: payloadsFor(appDoc, results), stale,
                   parameters: parameterValues, state: appState,
                   budget: budgetForPage(interaction) });
    paintInteraction();
    stageRevise.hidden = false;
    progress.appendChild(el(doc, "div", { class: stale.length ? "dsh-warn" : "dsh-note",
      text: stale.length
        ? `${stale.length} passage(s) were written against data that has since changed; `
        + `they are marked in the page.`
        : "every passage still matches the data it was written from." }));
    recorded = false;
    presentDisposition(entry.title, new Date());
  }

  /* ── Phase 1: the meter and the log ── */

  const phase1 = stage(doc, "Phase 1 — the model works inside the grant", "", { testid: "phase1" });
  phase1.hidden = true;
  body.appendChild(phase1);

  const meter = el(doc, "div", { class: "dsh-meter", dataset: { testid: "dashboard-meter" } });
  const bars = {};
  for (const key of ["calls", "rows", "bytes"]) {
    const bar = el(doc, "div", { class: "dsh-bar" }, [el(doc, "i", { style: "width:0%" })]);
    const box = el(doc, "div", { style: "min-width:120px" }, [
      el(doc, "span", { class: `dsh-${key}`, text: `${key} 0` }), bar]);
    bars[key] = { bar, fill: bar.firstChild, label: box.firstChild };
    meter.appendChild(box);
  }
  const revokeBtn = el(doc, "button", { type: "button", dataset: { testid: "dashboard-revoke" },
                                        text: "Revoke" });
  const widenBtn = el(doc, "button", { type: "button", dataset: { testid: "dashboard-widen" },
                                       text: "Widen (+6 calls)" });
  const runLog = el(doc, "div", { class: "dsh-log", dataset: { testid: "dashboard-log" } });
  phase1._body.append(meter,
    el(doc, "div", { class: "dsh-actions" }, [revokeBtn, widenBtn]),
    el(doc, "div", { style: "height:6px" }), runLog);

  const log = (line, cls = "") => {
    runLog.appendChild(el(doc, "div", { class: cls, text: line }));
    runLog.scrollTop = runLog.scrollHeight;
  };

  const paintMeter = () => {
    if (!grant) return;
    const s = grant.state();
    const set = (key, spent, limit) => {
      const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
      bars[key].fill.style.width = `${pct}%`;
      bars[key].bar.classList.toggle("over", pct >= 100);
      bars[key].label.textContent = key === "bytes"
        ? `bytes ${kib(spent)} of ${kib(limit)}`
        : `${key} ${spent} of ${limit}`;
    };
    set("calls", s.spent.queries, s.limits.maxQueries);
    set("rows", s.spent.rows, s.limits.maxRows);
    set("bytes", s.spent.bytes, s.limits.maxBytes);
    phase1._sub && (phase1._sub.textContent = s.revoked ? `revoked — ${s.revoked}` : grant.summary());
  };

  revokeBtn.addEventListener("click", () => {
    if (!grant) return;
    grant.revoke("the user revoked it mid-run");
    log("grant revoked — the next call the model makes will be refused", "dsh-warn");
    aborter?.abort?.();
    paintMeter();
  });
  widenBtn.addEventListener("click", () => {
    if (!grant) return;
    const changed = grant.widen({ maxQueries: grant.limits.maxQueries + 6,
                                  maxBytes: grant.limits.maxBytes + 1000000,
                                  reinstate: false });
    log(`grant widened: ${JSON.stringify(changed)}`);
    paintMeter();
  });

  /* ── Gate 1: the panel set ── */

  const gate1 = stage(doc, "Gate 1 — the panel set", "reviewed together, before anything runs",
                      { gate: true, testid: "gate1" });
  gate1.hidden = true;
  body.appendChild(gate1);

  /* ── Phase 2/3: the page ── */

  const stagePage = stage(doc, "The page", "sandboxed: scripts on, origin opaque, no network",
                           { testid: "page" });
  stagePage.hidden = true;
  body.appendChild(stagePage);

  /* ── the revise affordance: the second prompt, against the page ── */

  // U-32.  Until this existed, a second prompt could only produce a second
  // page: the model was handed the transcript and asked again, and whatever
  // the user liked about the first page had to survive being described rather
  // than being kept.  §3.1 called that the gap that makes the feature feel
  // absent, and this box is what closes it.
  const stageRevise = stage(doc, "Revise", "changes the page; does not replace it", { testid: "revise" });
  stageRevise.hidden = true;
  body.appendChild(stageRevise);

  const revisePrompt = el(doc, "div", {
    class: "dsh-prompt", contenteditable: "true",
    dataset: { testid: "dashboard-revise-prompt" },
    "data-placeholder": "What should change?",
  });
  const reviseBtn = el(doc, "button", { type: "button", class: "dsh-primary",
                                        dataset: { testid: "dashboard-revise" },
                                        text: "Revise" });
  const reviseStatus = el(doc, "span", { class: "dsh-note",
                                         dataset: { testid: "dashboard-revise-status" } });
  stageRevise._body.append(
    revisePrompt,
    el(doc, "div", { class: "dsh-actions" }, [reviseBtn, reviseStatus]),
  );

  /* ── the patch gate: whichever gate the change earns (D-W) ── */

  const gatePatch = stage(doc, "The change", "", { gate: true, testid: "patch" });
  gatePatch.hidden = true;
  body.appendChild(gatePatch);

  /* ── Gate 2: disposition ── */

  const gate2 = stage(doc, "Gate 2 — disposition", "", { gate: true, testid: "gate2" });
  gate2.hidden = true;
  body.appendChild(gate2);

  /* ─────────────── Phase 1 ─────────────── */

  let running = false;

  async function startRun() {
    if (running) return;
    const text = (promptEl.innerText || "").trim();
    if (!text) { grantStatus.textContent = "nothing to ask for"; return; }
    if (!st.llmKey) {
      grantStatus.textContent = "set a provider key in the exploration pane's Connection";
      return;
    }
    running = true;
    grantBtn.disabled = true;
    grantStatus.textContent = "running…";
    viaCatalog = catalogBox.checked;
    run = runId();

    interaction = createInteractionBudget(
      { maxRuns: Math.max(0, Number(fRuns.input.value) || DEFAULT_INTERACTION.maxRuns) },
      { onChange: () => paintInteraction() });

    grant = createGrant({
      repositories: String(fRepos.input.value || repoKey).split(/[,\s]+/).filter(Boolean),
      readOnly: readOnly.checked,
      maxQueries: Number(fQueries.input.value) || DEFAULT_GRANT.maxQueries,
      maxRows: Number(fRows.input.value) || DEFAULT_GRANT.maxRows,
      maxBytes: (Number(fBytes.input.value) || 2000) * 1024,
      lifetime: "run",
    }, { onChange: () => paintMeter() });

    phase1.hidden = false;
    runLog.replaceChildren();
    log(`grant: ${grant.summary()}`);
    log(viaCatalog ? "panels will be written as temporary views and run by name"
                   : "panels will be run directly; nothing is written to the catalogue");
    paintMeter();

    const started = new Date();
    const onEvent = (e) => {
      switch (e.type) {
        case "tools":
          log(`tools: ${e.names?.join(", ") || "(none)"}`
            + (e.withheld?.length ? `  withheld ${e.withheld.join(", ")}` : ""));
          break;
        case "primer": log(`primer ${e.uri}: ${e.ok ? `${e.chars} chars` : e.error}`); break;
        case "assistant":
          log(`turn ${e.iteration}: ${e.toolCalls} call(s)`
            + (e.usage ? `  ${e.usage.input_tokens}→${e.usage.output_tokens} tokens` : ""));
          break;
        case "tool_call": log(`  → ${e.name} ${e.input?.op || e.input?.of || ""}`.trimEnd()); break;
        case "digest":
          log(`  ← ${e.label}: ${e.form}, ${e.rows} rows, ${kib(e.bytes)} — `
            + `shape shown (${e.shownBytes} bytes)`);
          break;
        case "tool_result":
          if (!e.label) log(`  ← ${e.name}: ${e.ok ? `${(e.text || "").length} bytes` : e.text}`,
                            e.ok ? "" : "dsh-err");
          break;
        case "refused": log(`  ✗ refused: ${e.reason}`, "dsh-warn"); break;
        case "error": log(`error (${e.where}): ${e.error}`, "dsh-err"); break;
        default: break;
      }
    };

    // §13.9: the prompt is a budget too, spent on every request whether or not
    // the page turns out to want what it carries -- and spent out of the same
    // turn that has to carry the whole page.  Measured here rather than
    // guessed at.
    const system = dashboardSystem(DEFAULT_SYSTEM, { grant, digesting: true,
                                                     answerTokens: ANSWER_TOKENS,
                                                     request: text });
    const verdict = promptVerdict(system);
    log(`${budgetLine(verdict)}, answer ceiling ${ANSWER_TOKENS}`,
        verdict.ok ? (verdict.level === "warned" ? "dsh-warn" : "") : "dsh-err");
    if (!verdict.ok) {
      // REQ-23.1.4.  Measuring without refusing was the worst of the three
      // options: it paid for knowing and bought none of the protection, and
      // it taught the reader to scroll past a number that never meant
      // anything.  Nothing is sent.
      log(verdict.reason, "dsh-err");
      grantStatus.textContent = "refused — the prompt is over its ceiling";
      running = false;
      grantBtn.disabled = false;
      return null;
    }

    try {
      const adapter = createToolAdapter({
        provider: st.llmProvider, endpoint: st.llmEndpoint, apiKey: st.llmKey,
        workspaceId: st.llmWorkspace, model: st.llmModel,
        mcp: st.mcpEndpoint ? { endpoint: st.mcpEndpoint, token: st.token } : null,
        allowTools: DASHBOARD_TOOLS,
        grant,
        // A dozen result sets fit no context; one small one should not be
        // paraphrased.  The threshold, not a cap: `result_full' is offered.
        digestOver: 4000,
        maxTokens: ANSWER_TOKENS,
        maxIterations: 16,
        // The catalog is subsetted by what was asked for (§8.5): it costs
        // prompt tokens on every request, and they come out of the same turn
        // that has to carry the whole page.
        system: system,
        onEvent,
      });
      adapterResult = await adapter.run(text);
      st.session = adapterResult.session || st.session;
      markRun(adapterResult);
      grantStatus.textContent = adapterResult.ok
        ? `phase 1 done · ${adapterResult.iterations} turn(s)`
        : `phase 1 failed · ${adapterResult.error}`;
      presentProposal(text, started);
    } catch (e) {
      log(String(e), "dsh-err");
      grantStatus.textContent = "failed";
    } finally {
      running = false;
      grantBtn.disabled = false;
    }
  }

  grantBtn.addEventListener("click", startRun);

  /* ─────────────── Gate 1 ─────────────── */

  function presentProposal(promptText, started) {
    gate1.hidden = false;
    gate1._body.replaceChildren();

    const last = adapterResult?.lastTurn || {};
    const prose = proseOf(adapterResult?.finalText);
    if (prose) gate1._body.appendChild(el(doc, "p", { class: "dsh-prose", text: prose }));

    // Prose from an earlier turn is not the answer, and presenting it as one
    // is how a cut-off run came to read as a model that said its opening line
    // and stopped.  Say which turn it is from whenever it is not the last.
    const from = adapterResult?.textFromTurn || 0;
    if (prose && from && from < (adapterResult?.iterations || 0)) {
      gate1._body.appendChild(el(doc, "p", { class: "dsh-warn", dataset: { testid: "dsh-stale-prose" },
        text: `That is from turn ${from} of ${adapterResult.iterations}. The last turn `
            + `carried no prose of its own, so this is the most recent thing the model `
            + `said — not its answer.` }));
    }

    if (!adapterResult?.dashboard) {
      // Three ways to arrive with no block, and they are not one failure.
      // Cut off at the ceiling, cut off mid-block, or genuinely declined: the
      // first two are the interface's budget running out in the middle of the
      // model's answer, and the remedy for them is not the remedy for the
      // third.  They used to be reported identically, as the third.
      // `truncated' is set by the adapter for the stop reason it knows; the
      // three providers spell that reason three ways, and `answerVerdict'
      // holds the one list (REQ-23.1.4).  An open fence catches the case no
      // stop reason reports: a block that simply never closed.
      const verdictOnAnswer = answerVerdict({ stopReason: last.stopReason,
                                              text: last.text,
                                              maxTokens: ANSWER_TOKENS });
      const cut = Boolean(adapterResult?.truncated) || verdictOnAnswer.truncated
                || openFence(last.text);
      if (cut) {
        gate1._body.appendChild(el(doc, "p", { class: "dsh-err", dataset: { testid: "dsh-truncated" },
          text: `The last turn ran out of room: it stopped at the ${ANSWER_TOKENS}-token `
              + `output ceiling with the answer block still open, so there is no page to `
              + `run. Nothing is wrong with the exploration above — the whole page has to `
              + `be written in one turn and this one did not fit. Ask again for fewer `
              + `panels or a plainer page.` }));
      } else if (!last.text) {
        gate1._body.appendChild(el(doc, "p", { class: "dsh-err", dataset: { testid: "dsh-empty-turn" },
          text: `The last turn returned nothing to read: no prose, no block, no tool call`
              + `${last.stopReason ? ` (stop reason: ${last.stopReason})` : ""}. The raw `
              + `reply is below.` }));
      } else {
        gate1._body.appendChild(el(doc, "p", { class: "dsh-err", dataset: { testid: "dsh-no-block" },
          text: "The run produced no dashboard block. What the model said instead is above; "
              + "nothing will be run." }));
      }
      // What actually arrived, in every one of the three cases.  A gate that
      // reports an absence should show the thing it found absent from.
      const tail = last.text || last.response || "";
      if (tail) {
        gate1._body.appendChild(el(doc, "div", { class: "dsh-sub",
          text: `last turn, ${tail.length} characters — ending:` }));
        gate1._body.appendChild(el(doc, "pre", { class: "dsh-pre", dataset: { testid: "dsh-tail" },
          text: tail.length > 1600 ? `…${tail.slice(-1600)}` : tail }));
      }
      return;
    }

    validated = validateApplication(adapterResult.dashboard);
    appDoc = validated.document;
    // Identity is minted here, before the first revision is recorded, because
    // the record is written after the page is mounted and the revision has to
    // already have something to be a revision OF (§10.1).
    if (!appDoc.id) appDoc = { ...appDoc, id: mintId() };
    parameterValues = defaultValues(appDoc.parameters);
    appState = { ...(appDoc.state || {}) };
    patches = [];
    const spec = appDoc;
    const { errors, warnings } = validated;

    for (const e of errors) {
      gate1._body.appendChild(el(doc, "div", { class: "dsh-err", text: `error: ${e}` }));
    }
    for (const w of warnings) {
      gate1._body.appendChild(el(doc, "div", { class: "dsh-warn", text: `note: ${w}` }));
    }

    for (const p of spec.panels) {
      gate1._body.appendChild(panelBox(doc, {
        kind: "bound", label: "bound", name: p.name, testid: `panel-${p.name}`,
        notes: [
          el(doc, "span", { class: "dsh-note", text: p.caption || "" }),
          el(doc, "span", { class: "dsh-note", style: "margin-left:auto",
                            text: viaCatalog ? tempName(run, p.name) : p.accept }),
        ],
        body: el(doc, "pre", { class: "dsh-pre", text: p.query }),
      }));
    }
    for (const t of spec.transforms) {
      gate1._body.appendChild(panelBox(doc, {
        kind: "derived", label: "derived", name: t.name, testid: `transform-${t.name}`,
        notes: [el(doc, "span", { class: "dsh-note",
                                  text: `from ${t.inputs.join(", ") || "nothing"}` })],
        body: el(doc, "pre", { class: "dsh-pre", text: t.body }),
      }));
    }
    for (const x of spec.parameters) {
      gate1._body.appendChild(panelBox(doc, {
        kind: "param", label: "parameter", name: x.name, testid: `parameter-${x.name}`,
        notes: [el(doc, "span", { class: "dsh-note",
          text: `${x.kind}${x.datatype ? ` ${x.datatype}` : ""} · `
              + `used by ${spec.panels.filter((p) => p.parameters.includes(x.name))
                               .map((p) => p.name).join(", ") || "nothing"}` })],
        // What the control will admit, shown at the gate: this is the whole of
        // what the page may vary, and it is the one thing on this screen the
        // user is authorising to change after they have left it.
        body: el(doc, "pre", { class: "dsh-pre",
          text: x.domain
            ? (Array.isArray(x.domain.values)
                ? `one of: ${x.domain.values.join(", ")}`
                : (x.domain.from
                    ? `any value \`${x.domain.from}'.${x.domain.column || "(first column)"} returns`
                    : `between ${x.domain.min ?? "−∞"} and ${x.domain.max ?? "∞"}`))
            : "any value — no domain declared" }),
      }));
    }
    for (const a of spec.assertions) {
      gate1._body.appendChild(panelBox(doc, {
        kind: "asserted", label: "asserted", name: a.id, testid: `assertion-${a.id}`,
        notes: [el(doc, "span", { class: "dsh-note",
          text: a.inputs.length ? `written from ${a.inputs.join(", ")}`
                                : "outside knowledge — nothing here supports or contradicts it" })],
        body: el(doc, "pre", { class: "dsh-pre", text: a.text }),
      }));
    }

    // §13.9: what the page will weigh, which the model cannot measure and the
    // user pays for when they save or mail it.
    gate1._body.appendChild(sizeReport(validated.size));

    const runBtn = el(doc, "button", {
      type: "button", class: "dsh-primary", dataset: { testid: "dashboard-run-panels" },
      text: `Run ${spec.panels.length} ${spec.panels.length === 1 ? "panel" : "panels"}`,
    });
    runBtn.disabled = !validated.ok;
    // A disabled primary button with the panels laid out above it reads as a
    // broken gate rather than a refused document: the errors are at the top of
    // a long screen and the button is at the bottom.  Say it where it is.
    if (!validated.ok) {
      gate1._body.appendChild(el(doc, "p", { class: "dsh-err",
        dataset: { testid: "dsh-refused" },
        text: `Nothing will run: ${errors.length} error(s) above. The panels are shown `
            + `so you can see what was proposed, but the page was refused and the `
            + `queries have not been sent. Ask again in the exploration pane.` }));
    }
    const discard = el(doc, "button", { type: "button", text: "Discard",
                                        dataset: { testid: "dashboard-discard" },
                                        onclick: () => { gate1.hidden = true; } });
    gate1._body.appendChild(el(doc, "div", { class: "dsh-actions" }, [
      runBtn, discard,
      el(doc, "span", { class: "dsh-note",
        text: viaCatalog
          ? `${spec.panels.length} temporary view(s) will be written as tmp-${run}-*`
          : "run directly against the repository; nothing is written" }),
    ]));
    runBtn.addEventListener("click", () => executePanels(promptText, started));
  }

  /* ─────────────── Phase 2 and 3 ─────────────── */

  /**
   * The interaction meter (§15 q.3).
   *
   * It lives beside the page rather than beside the grant, because what it
   * measures is the page's behaviour and not the model's -- and because the
   * moment it matters is the moment a reader turns a selector and wonders
   * what that cost.  It is drawn even at zero, so that the first run moves
   * something the user has already seen rather than making a meter appear.
   */
  function paintInteraction() {
    if (!interaction) return;
    const holder = stagePage._body.querySelector('[data-testid="dashboard-interaction"]');
    if (!holder) return;
    const s = interaction.state();
    const used = Math.min(1, s.limits.maxRuns ? s.spent.runs / s.limits.maxRuns : 1);
    const bar = el(doc, "div", { class: `dsh-bar${s.remaining.runs ? "" : " over"}` },
                   [el(doc, "i", { style: `width:${Math.round(used * 100)}%` })]);
    const renew = el(doc, "button", {
      type: "button", dataset: { testid: "dashboard-interaction-renew" },
      text: `Allow ${interaction.limits.renewal} more`,
      onclick: () => {
        interaction.renew();
        log(`interaction budget renewed: ${interaction.summary()}`);
        // The page is told at once, so a control that greyed itself out
        // comes back without the reader having to touch it twice.
        mounted?.budget(budgetForPage(interaction));
      },
    });
    holder.replaceChildren(
      el(doc, "div", { class: "dsh-meter" }, [
        el(doc, "span", { dataset: { testid: "dashboard-interaction-meter" },
                          text: `page: ${interaction.summary()}` }),
      ]),
      bar,
      el(doc, "div", { class: "dsh-actions" }, [
        renew,
        el(doc, "span", { class: "dsh-note",
          text: s.remaining.runs
            ? "what the page may re-run by itself — the queries are the ones you approved"
            : "the page has stopped asking; nothing is lost, and the queries are "
            + "the ones you approved" }),
      ]),
    );
  }

  /** The page's inlined weight, broken out the way the model can act on it. */
  function sizeReport(size) {
    if (!size) return el(doc, "span", {});
    const line = `${kib(size.total)} inlined — markup ${kib(size.html)}, `
      + `styles ${kib(size.styles)}, script ${kib(size.script)}, `
      + `components ${kib(size.components)}`;
    const detail = Object.entries(size.perComponent || {})
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name} ${kib(n)}`).join(" · ");
    return el(doc, "div", { class: "dsh-note", dataset: { testid: "dashboard-size" },
                            text: detail ? `${line} (${detail})` : line });
  }

  async function executePanels(promptText, started) {
    lastPrompt = promptText;
    startedAt = started;
    const spec = appDoc;
    stagePage.hidden = false;
    const progress = el(doc, "div", { class: "dsh-log", dataset: { testid: "dashboard-progress" } });
    const holder = el(doc, "div", { dataset: { testid: "dashboard-frame-holder" } });
    const meter = el(doc, "div", { class: "dsh-interaction",
                                   dataset: { testid: "dashboard-interaction" } });
    stagePage._body.replaceChildren(progress, meter, holder);
    aborter = typeof AbortController !== "undefined" ? new AbortController() : null;

    if (viaCatalog) {
      const put = await putPanelSet({
        host, account: accountName, repository: repositoryName, token: st.token,
        panels: spec.panels, run,
        onEvent: (e) => progress.appendChild(el(doc, "div", {
          class: e.ok ? "" : "dsh-err",
          text: `catalogue ${e.name}: ${e.ok ? "written" : e.error}` })),
      });
      tempNames = put.written.filter((w) => w.ok).map((w) => w.name);
      if (!put.ok) {
        progress.appendChild(el(doc, "div", { class: "dsh-warn",
          text: "not every temporary view was written; the panels that failed will run directly" }));
      }
    }

    results = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: spec.panels, run, viaCatalog,
      // The declared defaults, bound as terms (D-X).  A page whose first
      // render used no parameter at all would show the reader something no
      // control of theirs produced, and then change under them on the first
      // selection.
      values: parameterValues, parameters: spec.parameters,
      signal: aborter?.signal,
      onEvent: (e) => {
        if (e.type === "panel-start") {
          progress.appendChild(el(doc, "div", { text: `running ${e.name}…`,
                                                dataset: { panel: e.name } }));
        } else {
          const line = progress.querySelector(`[data-panel="${CSS.escape(e.name)}"]`);
          const text = e.ok ? `${e.name}: ${e.rows} rows in ${e.ms} ms · ${String(e.digest).slice(0, 12)}`
                            : `${e.name}: ${e.error}`;
          if (line) { line.textContent = text; line.className = e.ok ? "" : "dsh-err"; }
          else progress.appendChild(el(doc, "div", { text, class: e.ok ? "" : "dsh-err" }));
        }
      },
    });

    const sums = totals(results);
    progress.appendChild(el(doc, "div", {
      text: `${sums.ok} of ${sums.panels} panels · ${sums.rows} rows · ${kib(sums.bytes)} `
          + `· ${sums.ms} ms` }));

    // D-T: the sentences the model wrote are stamped with the digests of what
    // it wrote them from, here, at the moment the data is in hand.
    appDoc = withInputDigests(spec, results);
    mountPage(promptText, started);
  }

  function mountPage(promptText, started) {
    const spec = appDoc;
    const holder = stagePage._body.querySelector('[data-testid="dashboard-frame-holder"]');
    try { mounted?.destroy(); } catch { /* first mount */ }
    repair = repair || createRepairLoop();
    frameErrors = [];
    mounted = mountDashboard(holder, spec, {
      onRefresh: () => refresh({ fromPage: true }),
      onRun: (request) => runOnePanel(request),
      onState: ({ key, value }) => rememberState(key, value),
      onLayout: (request) => layoutGraph(request),
      onPropose: ({ what, detail }) => presentProposalFromPage(what, detail),
      onEvent: (e) => {
        if (e.type !== "error") return;
        frameErrors.push(e);
        stagePage._body.appendChild(el(doc, "div", { class: "dsh-err",
          dataset: { testid: "dashboard-page-error" },
          text: `the page reported an error in ${e.where}: ${e.error}` }));
        // Debounced, because the frame reports one error per failing region
        // per fill and a page whose data arrives twice reports twice: the
        // loop should see one set of faults, not two.
        clearTimeout(repairTimer);
        repairTimer = setTimeout(() => attemptRepair(), 400);
      },
      doc,
    });
    mounted.post({ results: payloadsFor(spec, results), stale: [],
                   parameters: parameterValues, state: appState,
                   budget: budgetForPage(interaction) });
    paintInteraction();
    stageRevise.hidden = false;
    presentDisposition(promptText, started);
  }

  let repairTimer = null;

  /**
   * Run the whole set again.
   *
   * `fromPage' is the distinction the budget turns on: the Refresh button in
   * Gate 2 is the user pressing a button, and the user does not spend the
   * page's allowance; `dashboard.refresh()' is the page asking, and it costs
   * one run per panel -- otherwise the cheapest thing a page can ask for and
   * the most expensive would cost the same, and a page refreshing in a loop
   * would never reach the meter.
   */
  async function refresh({ fromPage = false } = {}) {
    if (!appDoc) return;
    const spec = appDoc;
    if (fromPage && interaction) {
      const allowed = interaction.check({ runs: spec.panels.length, panel: "(refresh)" });
      if (!allowed.ok) {
        mounted?.refuse({ request: { refresh: true }, reason: allowed.reason,
                          budget: budgetForPage(interaction) });
        log(`  ✗ refresh: ${allowed.reason}`, "dsh-warn");
        return;
      }
    }
    const fresh = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: spec.panels, run, viaCatalog,
      values: parameterValues, parameters: spec.parameters,
    });
    results = fresh;
    if (fromPage && interaction) {
      for (const r of Object.values(fresh)) {
        interaction.chargeResult({ rows: r.rows, bytes: r.bytes });
      }
    }
    // The page updates; the prose does not, and the difference is marked
    // rather than hidden (D-T).  A sentence written against data that has
    // moved is not deleted -- the user may still want it -- it is flagged.
    const stale = staleAssertions(spec, fresh);
    mounted?.post({ results: payloadsFor(spec, fresh), stale,
                    budget: budgetForPage(interaction) });
    if (stale.length) {
      stagePage._body.appendChild(el(doc, "div", { class: "dsh-warn",
        text: `${stale.length} passage(s) were written against data that has since changed; `
            + `they are marked in the page.` }));
    }
  }


  /* ─────────────── what the page may ask for ─────────────── */

  /**
   * One panel, re-run with values the page chose (D-X, U-34).
   *
   * The whole of a page's influence over what runs passes through here, and
   * three things make that safe rather than merely narrow: the panel must be
   * one the document declares, the values are checked against declared
   * domains before anything is fetched, and the query text is the one the
   * user authorised with a VALUES clause after it.  A refusal goes back to
   * the page with its reason, because a control that appears to hang is
   * worse than one that says no.
   */
  async function runOnePanel({ id, panel, parameters }) {
    if (!appDoc || !mounted) return;
    const target = appDoc.panels.find((p) => p.name === panel);
    if (!target) {
      mounted.refuse({ id, request: { panel }, reason: `\`${panel}' is not a panel of this page` });
      return;
    }
    const values = { ...parameterValues, ...(parameters || {}) };

    // The domain is checked here, before the budget is, because this check
    // is free and local: a value outside its declared domain never reaches
    // the store, so it must not cost the page a run.  The grant charges
    // before a call because it cannot know what the call will do; here we
    // can, and charging for a request we already know will not be made would
    // make the meter a tally of the reader's typing.
    const binding = bindParameters(target, values,
                                   { parameters: appDoc.parameters, results });
    if (!binding.ok) {
      const why = binding.refusals.map((r) => `${r.name}: ${r.reason}`).join("; ");
      mounted.refuse({ id, request: { panel, parameters }, reason: why,
                       budget: budgetForPage(interaction) });
      log(`  ✗ ${panel}: ${why}`, "dsh-warn");
      return;
    }

    // §15 q.3.  The page is not asking for authority -- the query is the one
    // authorised at Gate 1 -- it is asking to spend the user's store time
    // again, and that is what the meter is for.  Charged before the call,
    // like the grant: a refusal after the store has been read is a complaint,
    // not a limit.
    const allowed = interaction
      ? interaction.check({ panel, parameters })
      : { ok: true };
    if (!allowed.ok) {
      mounted.refuse({ id, request: { panel, parameters }, reason: allowed.reason,
                       budget: budgetForPage(interaction) });
      log(`  ✗ ${panel}: ${allowed.reason}`, "dsh-warn");
      return;
    }
    log(`page asked to re-run ${panel}`
      + (Object.keys(parameters || {}).length
          ? ` with ${Object.entries(parameters).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""));
    const fresh = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: [target], run, viaCatalog: false,
      values, parameters: appDoc.parameters, have: results,
    });
    const r = fresh[panel];
    if (!r?.ok) {
      mounted.refuse({ id, request: { panel, parameters },
                       reason: r?.error || "the panel did not run",
                       budget: budgetForPage(interaction) });
      log(`  ✗ ${panel}: ${r?.error || "did not run"}`, "dsh-warn");
      return;
    }
    results = fresh;
    parameterValues = values;
    interaction?.chargeResult({ rows: r.rows, bytes: r.bytes });
    const stale = staleAssertions(appDoc, results);
    mounted.post({ id, partial: true, results: payloadsFor(appDoc, { [panel]: r }),
                   stale, parameters: values, budget: budgetForPage(interaction) });
    log(`  ← ${panel}: ${r.rows} rows in ${r.ms} ms`);
  }

  /**
   * A bounded slice of what the page has become (§10.3).
   *
   * Which view is open and which parameters were chosen: enough that
   * reopening puts the reader back where they were, and not enough to become
   * a database.  It is written into the document, so it is recorded with it
   * and comes back on reopen.
   */
  function rememberState(key, value) {
    appState = { ...appState, [String(key)]: value };
    const text = JSON.stringify(appState);
    if (text.length > 8 * 1024) {
      delete appState[String(key)];
      mounted?.refuse({ request: { state: key },
                        reason: "state is limited to 8 KiB: it holds which view is open and "
                              + "which parameters were chosen. A page that wants more than "
                              + "that wants a repository, and it has one" });
      return;
    }
    if (appDoc) appDoc = { ...appDoc, state: appState };
  }

  /**
   * A graph, laid out (§8.4, U-42).
   *
   * The component emits DOT; the engine runs here, in the scripted
   * network-less frame beside the display frame, and the SVG goes back in
   * like any other result.  One graph vocabulary across this path and the
   * figure path, rather than two.  Loaded on demand: the engine is 800 KiB
   * and most pages never draw a graph.
   */
  async function layoutGraph({ dot, engine }) {
    try {
      const { layoutDot } = await import("../../lib/wasm/graphviz.js");
      const out = await layoutDot(dot, { engine, doc });
      if (!out.ok) log(`graph layout failed: ${out.error}`, "dsh-warn");
      return out;
    } catch (e) {
      return { ok: false, error: `the layout engine could not be loaded: ${String(e)}` };
    }
  }

  /**
   * Something the page asked for and may not do (D-Z).
   *
   * It surfaces here as a sentence and a prefilled revise box — never as an
   * action.  A page that could widen its own authority by asking politely
   * would make every other restriction in this file decorative.
   */
  function presentProposalFromPage(what, detail) {
    stageRevise.hidden = false;
    const text = typeof detail === "string" ? detail
      : (detail && detail.question) || JSON.stringify(detail || {});
    stageRevise._body.insertBefore(el(doc, "div", { class: "dsh-warn",
      dataset: { testid: "dashboard-proposal" },
      text: `The page proposes ${what}: ${text}. Nothing has been done; ask for it below `
          + `if you want it.` }), stageRevise._body.firstChild);
    revisePrompt.textContent = text;
  }

  /* ─────────────── the second prompt ─────────────── */

  /**
   * Revise: the model is given the page, not the transcript.
   *
   * The document's SHAPE goes — names, queries, slot ids, no transform
   * bodies — because the bodies are what make a document too large to send
   * and the shape is what a patch needs to address correctly (§15, q.2).
   */
  async function startRevision(text) {
    const ask = String(text ?? revisePrompt.innerText ?? "").trim();
    if (revising || !appDoc) return null;
    if (!ask) { reviseStatus.textContent = "nothing to change"; return null; }
    if (!st.llmKey) {
      reviseStatus.textContent = "set a provider key in the exploration pane's Connection";
      return null;
    }
    revising = true;
    reviseBtn.disabled = true;
    reviseStatus.textContent = "asking…";
    // §13.9: the prompt is a budget too, spent on every request whether or not
    // the page turns out to want what it carries -- and spent out of the same
    // turn that has to carry the whole page.  Measured here rather than
    // guessed at.
    const system = dashboardSystem(DEFAULT_SYSTEM, { grant, digesting: true,
                                                     answerTokens: ANSWER_TOKENS,
                                                     request: text });
    const verdict = promptVerdict(system);
    log(`${budgetLine(verdict)}, answer ceiling ${ANSWER_TOKENS}`,
        verdict.ok ? (verdict.level === "warned" ? "dsh-warn" : "") : "dsh-err");
    if (!verdict.ok) {
      // REQ-23.1.4, as above: refused before the call, not reported after it.
      log(verdict.reason, "dsh-err");
      reviseStatus.textContent = "refused — the prompt is over its ceiling";
      revising = false;
      reviseBtn.disabled = false;
      return null;
    }

    try {
      const adapter = createToolAdapter({
        provider: st.llmProvider, endpoint: st.llmEndpoint, apiKey: st.llmKey,
        workspaceId: st.llmWorkspace, model: st.llmModel,
        mcp: st.mcpEndpoint ? { endpoint: st.mcpEndpoint, token: st.token } : null,
        allowTools: DASHBOARD_TOOLS,
        grant,
        digestOver: 4000,
        maxTokens: ANSWER_TOKENS,
        maxIterations: 8,
        system: revisionSystem(DEFAULT_SYSTEM, { grant, document: appDoc,
                                                 answerTokens: ANSWER_TOKENS, request: ask }),
        onEvent: (e) => { if (e.type === "refused") log(`  ✗ refused: ${e.reason}`, "dsh-warn"); },
      });
      const out = await adapter.run(ask);
      st.session = out.session || st.session;
      // A revision is a new model answer, so the stages say so: the page on
      // the screen after it is applied was produced by THIS turn, and a
      // footnote still naming the first run's model would be false.
      markRun(out);
      reviseStatus.textContent = out.ok ? "answered" : `failed · ${out.error}`;
      return receiveRevision(out, ask);
    } catch (e) {
      reviseStatus.textContent = String(e);
      return null;
    } finally {
      revising = false;
      reviseBtn.disabled = false;
    }
  }

  reviseBtn.addEventListener("click", () => startRevision());

  /**
   * What came back: a patch, or a whole document, or neither.
   *
   * A model that answers a revision with a whole page has not done anything
   * wrong — it is what the first turn asks for — so the page is diffed
   * against the one on the screen and treated as the patch it amounts to.
   * Refusing it over its shape would throw away a turn for a formality.
   */
  function receiveRevision(out, ask) {
    const ops = patchFrom(out?.finalText);
    if (ops) return presentPatch(ops, { ask });
    const whole = applicationFrom(out?.finalText);
    if (whole) {
      const checked = validateApplication({ ...whole, id: appDoc.id, revision: appDoc.revision });
      if (!checked.ok) return refusePatch(checked.errors, ask);
      const after = { ...checked.document, revision: (appDoc.revision || 1) + 1,
                      revisionOf: `${appDoc.id}#${appDoc.revision || 1}` };
      return presentChange({ ok: true, document: after, warnings: checked.warnings,
                             classification: classify(appDoc, checked.document, []),
                             size: checked.size }, null, ask);
    }
    const cut = Boolean(out?.truncated) || openFence(out?.lastTurn?.text);
    return refusePatch([cut
      ? `The answer ran out of room at the ${ANSWER_TOKENS}-token ceiling with the block `
        + `still open, so there is nothing to apply. Ask for a smaller change.`
      : "The answer carried no patch block, so nothing has been changed."], ask);
  }

  /** Apply a patch to a copy, validate the result, and present what it is. */
  function presentPatch(ops, { ask = "" } = {}) {
    const applied = applyPatch(appDoc, ops);
    if (!applied.ok) return refusePatch(applied.errors, ask, ops);
    return presentChange(applied, ops, ask);
  }

  function refusePatch(errors, ask, ops = null) {
    gatePatch.hidden = false;
    gatePatch._body.replaceChildren();
    gatePatch._sub.textContent = "refused";
    gatePatch._body.appendChild(el(doc, "div", { class: "dsh-err",
      dataset: { testid: "dashboard-patch-refused" },
      text: "The change was refused whole — nothing was half-applied:" }));
    for (const e of errors) {
      gatePatch._body.appendChild(el(doc, "div", { class: "dsh-err", text: `error: ${e}` }));
    }
    if (ops) {
      gatePatch._body.appendChild(el(doc, "pre", { class: "dsh-pre",
        text: JSON.stringify(ops, null, 2).slice(0, 2000) }));
    }
    return { ok: false, errors, ask };
  }

  /**
   * The change, and the gate it earned (D-W).
   *
   * Which gate is not a judgement about this patch; it is read off a
   * comparison of the normalised document before and after.  A patch
   * described as a colour change and performing a query change gets Gate 1,
   * which is the whole point of computing the class rather than believing it.
   */
  function presentChange(applied, ops, ask) {
    const c = applied.classification;
    gatePatch.hidden = false;
    gatePatch._body.replaceChildren();
    gatePatch._sub.textContent = {
      presentational: "presentational — nothing re-runs, nothing is re-asked",
      computational: "computational — the bodies are checked, nothing asks the store",
      data: "data — this changes what runs against the store",
      authority: "authority — this needs a new grant",
    }[c.class] || c.class;
    gatePatch.dataset.patchClass = c.class;

    gatePatch._body.appendChild(el(doc, "div", { class: "dsh-note",
      dataset: { testid: "dashboard-patch-class" },
      text: `${c.class} · ${c.reasons.map((r) => r.why).join("; ") || "no change"}` }));
    for (const w of applied.warnings || []) {
      gatePatch._body.appendChild(el(doc, "div", { class: "dsh-warn", text: `note: ${w}` }));
    }

    if (c.class === "data" || c.class === "authority") {
      // The per-panel diff: the same question Gate 1 always asks, about a
      // smaller thing.  Showing the whole document again would bury the two
      // lines that changed in the thirty that did not.
      for (const d of panelDiff(appDoc, applied.document)) {
        if (d.change === "unchanged") continue;
        const box = panelBox(doc, {
          kind: d.change === "removed" ? "asserted" : "bound", label: d.change, name: d.name,
          testid: `diff-${d.name}`,
          body: el(doc, "div", {}, [
            d.before ? el(doc, "pre", { class: "dsh-pre dsh-was", text: d.before.query }) : null,
            d.after ? el(doc, "pre", { class: "dsh-pre", text: d.after.query }) : null,
          ]),
        });
        box.dataset.testid = `dashboard-diff-${d.name}`;
        gatePatch._body.appendChild(box);
      }
      const keeping = c.unchanged.filter((n) => !c.rerun.includes(n));
      if (keeping.length) {
        gatePatch._body.appendChild(el(doc, "div", { class: "dsh-note",
          text: `${keeping.join(", ")} ${keeping.length === 1 ? "is" : "are"} unchanged and will `
              + `not run again.` }));
      }
    }
    gatePatch._body.appendChild(sizeReport(applied.size));

    if (c.class === "authority") {
      gatePatch._body.appendChild(el(doc, "div", { class: "dsh-err",
        text: "A patch cannot widen a grant. Close this page and start again with the "
            + "authority you want to give." }));
      return { ok: false, classification: c };
    }

    // Presentational changes are applied without a gate, which is the point
    // of classifying at all: a change of colour that asked permission would
    // teach the user to stop reading the ones that matter.
    if (c.class === "presentational") {
      applyRevision(applied, ops, ask);
      return { ok: true, classification: c, applied: "immediately" };
    }

    const accept = el(doc, "button", {
      type: "button", class: "dsh-primary", dataset: { testid: "dashboard-patch-accept" },
      text: c.rerun.length
        ? `Run ${c.rerun.length} ${c.rerun.length === 1 ? "panel" : "panels"} and apply`
        : "Apply",
      onclick: () => applyRevision(applied, ops, ask),
    });
    const reject = el(doc, "button", {
      type: "button", text: "Discard", dataset: { testid: "dashboard-patch-discard" },
      onclick: () => { gatePatch.hidden = true; },
    });
    gatePatch._body.appendChild(el(doc, "div", { class: "dsh-actions" }, [accept, reject]));
    return { ok: true, classification: c, applied: "waiting" };
  }

  /**
   * Accepted: run only what changed, then change the page in place if the
   * runtime can (§6.2.1).
   *
   * Rebuilding would throw away scroll position, the open tab, a selection
   * and the parameter the reader just chose — which would make the cheap
   * change feel worse than the expensive one.
   */
  async function applyRevision(applied, ops, ask) {
    const c = applied.classification;
    gatePatch.hidden = true;
    const next = applied.document;
    if (c.rerun.length) {
      const progress = el(doc, "div", { class: "dsh-log",
                                        dataset: { testid: "dashboard-patch-progress" } });
      stagePage._body.appendChild(progress);
      results = await runPanels({
        host, account: accountName, repository: repositoryName, token: st.token,
        panels: next.panels.filter((p) => c.rerun.includes(p.name)), run, viaCatalog: false,
        values: parameterValues, parameters: next.parameters, have: results,
        onEvent: (e) => {
          if (e.type === "panel-done") {
            progress.appendChild(el(doc, "div", { class: e.ok ? "" : "dsh-err",
              text: e.ok ? `${e.name}: ${e.rows} rows in ${e.ms} ms` : `${e.name}: ${e.error}` }));
          }
        },
      });
      for (const name of c.dropped) delete results[name];
    }
    appDoc = withInputDigests({ ...next, state: appState }, results);
    patches = patches.concat(ops || []);
    frameErrors = [];
    // The markup and the data go together.  Applying the markup first and
    // posting the data a moment later would fill once with a transform's
    // inputs missing, and that momentary failure is indistinguishable from
    // a real one -- it would reach the pane as an error and start a repair
    // for a page that is about to be correct.
    const how = await mounted.update(appDoc, {
      ops: c.rebuild ? null : ops,
      post: { results: payloadsFor(appDoc, results),
              stale: staleAssertions(appDoc, results),
              parameters: parameterValues, state: appState,
              budget: budgetForPage(interaction) },
    });
    if (how.applied === "rebuild" && !c.rebuild) {
      log("the page could not apply that in place and was rebuilt", "dsh-warn");
    }
    reviseStatus.textContent = `revision ${appDoc.revision} · ${c.class} · `
      + `${how.applied === "in-place" ? "applied in place" : "rebuilt"}`;
    revisePrompt.textContent = "";
    recorded = false;
    record(ask || lastPrompt, startedAt || new Date(), "revised");
    return how;
  }

  /* ─────────────── repair (§11) ─────────────── */

  /**
   * A page that broke, and at most two attempts at fixing it.
   *
   * Everything here existed except the wiring: the frame already marked the
   * failing region and posted the error out, and the error was already shown
   * under the page — where the user read it and retyped their prompt.  That
   * last step is what this replaces.
   */
  async function attemptRepair() {
    if (!appDoc || !mounted || !st.llmKey) return;
    const failures = groupFailures(frameErrors);
    if (!repair?.mayAttempt(failures)) {
      if (failures.length && repair?.summary()?.exhausted) {
        stagePage._body.appendChild(el(doc, "div", { class: "dsh-warn",
          dataset: { testid: "dashboard-repair-exhausted" },
          text: `Two attempts did not fix this; both are above. An automatic loop that `
              + `cannot converge has to stop where you can see it.` }));
      }
      return;
    }
    const attempt = repair.count + 1;
    const { prompt } = repairPrompt(appDoc, failures, { attempt });
    stagePage._body.appendChild(el(doc, "div", { class: "dsh-note",
      dataset: { testid: "dashboard-repair" },
      text: `Repair attempt ${attempt} of 2: ${failures.map((f) => f.where).join(", ")}` }));
    const before = failures;
    frameErrors = [];
    const out = await startRepairTurn(prompt);
    const ops = patchFrom(out?.finalText);
    if (!ops) {
      repair.record({ failures: before, outcome: "no-patch" });
      stagePage._body.appendChild(el(doc, "div", { class: "dsh-warn",
        text: "The repair turn produced no patch." }));
      return;
    }
    const applied = applyPatch(appDoc, ops);
    if (!applied.ok) {
      repair.record({ failures: before, patch: ops, outcome: "invalid", errors: applied.errors });
      refusePatch(applied.errors, "repair", ops);
      return;
    }
    repair.record({ failures: before, patch: ops, outcome: "attempted" });
    // A repair is a patch like any other: one that changes a query stops at
    // Gate 1.  A bug is not authority.
    presentChange(applied, ops, "repair");
  }

  async function startRepairTurn(prompt) {
    try {
      const adapter = createToolAdapter({
        provider: st.llmProvider, endpoint: st.llmEndpoint, apiKey: st.llmKey,
        workspaceId: st.llmWorkspace, model: st.llmModel,
        allowTools: [], grant, maxTokens: ANSWER_TOKENS, maxIterations: 2,
        system: revisionSystem(DEFAULT_SYSTEM, { grant, document: appDoc,
                                                 answerTokens: ANSWER_TOKENS }),
      });
      return await adapter.run(prompt);
    } catch (e) {
      log(`repair failed: ${String(e)}`, "dsh-err");
      return null;
    }
  }

  /* ─────────────── Gate 2 ─────────────── */

  function presentDisposition(promptText, started) {
    gate2.hidden = false;
    gate2._body.replaceChildren();

    const keepRow = el(doc, "div", { class: "dsh-actions" });
    const nameInput = el(doc, "input", { type: "text", placeholder: "name to keep the panels under",
                                         dataset: { testid: "dashboard-keep-name" },
                                         style: "font-size:12px;padding:2px 4px" });
    const keep = el(doc, "button", { type: "button", text: "Keep the panels as views",
                                     dataset: { testid: "dashboard-keep" } });
    const save = el(doc, "button", { type: "button", text: "Download the page",
                                     dataset: { testid: "dashboard-save" } });
    const refreshBtn = el(doc, "button", { type: "button", text: "Refresh",
                                           dataset: { testid: "dashboard-refresh" },
                                           onclick: () => refresh() });
    const discard = el(doc, "button", { type: "button", text: "Discard",
                                        dataset: { testid: "dashboard-discard-page" } });
    keepRow.append(nameInput, keep, save, refreshBtn, discard);
    gate2._body.appendChild(keepRow);
    const outcome = el(doc, "div", { class: "dsh-note", style: "margin-top:6px" });
    gate2._body.appendChild(outcome);

    keep.addEventListener("click", async () => {
      const base = (nameInput.value || "").trim() || appDoc.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dashboard";
      const kept = [];
      for (const p of appDoc.panels) {
        const to = `${base}-${p.name}`;
        const res = await promoteView({
          host, account: accountName, repository: repositoryName, token: st.token,
          from: viaCatalog ? tempName(run, p.name) : null, to, query: p.query,
        });
        kept.push(`${to}: ${res.ok ? "kept" : res.put.error}`);
        if (res.ok && viaCatalog) tempNames = tempNames.filter((n) => n !== tempName(run, p.name));
      }
      outcome.textContent = kept.join(" · ");
      record(promptText, started, "promoted");
    });

    save.addEventListener("click", () => {
      // The combination the page is showing is recorded with it, so a
      // control in the saved copy can replay what it holds and say plainly
      // that it holds nothing else (§7.4).
      const replay = Object.keys(parameterValues).length
        ? { [JSON.stringify([null, parameterValues])]: payloadsFor(appDoc, results) } : null;
      const html = mounted.page(payloadsFor(appDoc, results),
                                { replay, parameters: parameterValues });
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = el(doc, "a", { href: url, download: `${slug(appDoc.title)}.html` });
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      outcome.textContent = "saved — the data is inlined, so the file still draws offline";
      record(promptText, started, "downloaded");
    });

    discard.addEventListener("click", () => {
      teardown();
      stagePage.hidden = true;
      gate2.hidden = true;
      outcome.textContent = "";
      record(promptText, started, "discarded");
    });

    // The run is recorded as soon as the page exists, with the disposition
    // still open: a browser closed at this point should not lose the record
    // of what ran.  A later disposition records again, which is why the
    // record carries one.
    record(promptText, started, "pending");
  }

  let recorded = false;
  async function record(promptText, started, disposition) {
    if (recorded && disposition === "pending") return;
    recorded = true;
    if (!appDoc) return;
    const dash = {
      ...dashboardRecord({ ...appDoc, state: appState }, results,
                         { grant, prompt: promptText, patches,
                           interaction: interaction?.state() || null }),
      disposition,
      via: viaCatalog ? "catalog" : "direct",
      panels: dashboardRecord(appDoc, results, { grant }).panels.map((p) => ({
        ...p, view: viaCatalog ? tempName(run, p.name) : null,
      })),
    };
    const kept = await recordRun({
      host, account: accountName, token: st.token,
      repository: repoKey, session: st.session,
      result: adapterResult, prompt: promptText, started,
      dashboard: dash,
    });
    log(kept.ok ? `recorded in <${kept.graph}> (${disposition})`
                : `not recorded: ${kept.error}`, kept.ok ? "" : "dsh-warn");
  }

  const api = { wrapper, state: st, start: startRun, refresh, revise: startRevision,
                get grant() { return grant; },
                get spec() { return appDoc ? specOf(appDoc) : null; },
                get document() { return appDoc; },
                get parameters() { return { ...parameterValues }; },
                get patches() { return patches.slice(); },
                get repair() { return repair?.summary() || null; },
                get interaction() { return interaction; },
                get results() { return results; } };
  wrapper._dashboardApi = api;
  promptEl.focus();
  return api;
}

export default openDashboardPane;
