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
import { dashboardSystem } from "../../lib/llm/dashboard-prompt.js";
import {
  validateDashboard, withInputDigests, staleAssertions, dashboardRecord,
} from "../../lib/dashboard/spec.js";
import { mountDashboard } from "../../lib/dashboard/frame.js";
import { runPanels, payloadsFor, totals } from "../../lib/dashboard/runner.js";
import { putPanelSet, promoteView, sweep, runId, tempName } from "../../lib/dashboard/catalog.js";
import { listDashboards, readDashboard } from "../../lib/dashboard/archive.js";
import { recordRun } from "../../lib/mcp/transcript-store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slug = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "-");
const kib = (n) => `${Math.round((Number(n) || 0) / 1024)} KiB`;

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
  return /```(?:dashboard|json)\s*\n(?![\s\S]*```)/i.test(String(text || ""));
}

function stage(doc, title, sub, { gate = false } = {}) {
  const sec = el(doc, "section", { class: `dsh-stage${gate ? " dsh-gate" : ""}` });
  const h = el(doc, "h3", {}, [el(doc, "span", { text: title })]);
  if (sub) h.appendChild(el(doc, "span", { class: "dsh-sub", text: sub }));
  sec.appendChild(h);
  const body = el(doc, "div", { class: "dsh-stage-body" });
  sec.appendChild(body);
  sec._body = body;
  sec._sub = h.lastChild;
  return sec;
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
  let validated = null;         // {ok, spec, errors, warnings}
  let results = null;           // {panel: {ok, text, digest, …}}
  let mounted = null;           // the frame handle
  let run = null;               // the catalogue run id
  let tempNames = [];           // what was written, for the sweep
  let viaCatalog = false;
  let aborter = null;

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
  const archive = stage(doc, "Saved dashboards", "reopened live, not replayed");
  archive.hidden = true;
  body.appendChild(archive);

  /* ── Gate 0: the grant ── */

  const gate0 = stage(doc, "Gate 0 — authority", "granted once, charged per call", { gate: true });
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
  const readOnly = el(doc, "input", { type: "checkbox", checked: true,
                                      dataset: { testid: "dashboard-grant-readonly" } });
  const catalogBox = el(doc, "input", { type: "checkbox",
                                        dataset: { testid: "dashboard-grant-catalog" } });

  const grid = el(doc, "div", { class: "dsh-grid" }, [
    fRepos.label, fRepos.input,
    fQueries.label, fQueries.input,
    fRows.label, fRows.input,
    fBytes.label, fBytes.input,
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
    archive._body.replaceChildren(...listed.dashboards.map((d) => {
      const openBtn = el(doc, "button", { type: "button", text: "Open",
                                          dataset: { testid: "dashboard-open-saved" },
                                          onclick: () => openStored(d) });
      return el(doc, "div", { class: "dsh-actions" }, [
        openBtn,
        el(doc, "b", { text: d.title }),
        el(doc, "span", { class: "dsh-note",
          text: `${d.recorded || ""} ${d.repository || ""} ${d.disposition || ""}`.trim() }),
      ]);
    }));
  });

  /** Reopen one: read it, run its panels now, and mark what no longer holds. */
  async function openStored(entry) {
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
    const v = validateDashboard(stored.spec);
    if (!v.ok) {
      archive._body.prepend(el(doc, "div", { class: "dsh-err",
        text: `the saved page no longer validates: ${v.errors.join("; ")}` }));
      return;
    }
    // The digests the record holds are what the prose was written against;
    // validation rebuilds the assertions, so they are put back (D-T).
    v.spec.assertions = v.spec.assertions.map((a) => ({
      ...a,
      inputDigests: (stored.spec.assertions.find((x) => x.id === a.id) || {}).inputDigests || {},
    }));
    validated = v;
    viaCatalog = false;          // run the recorded query text; the temporary views are long gone
    run = runId();
    results = null;
    adapterResult = adapterResult || { ok: true, iterations: 0, events: [], finalText: "" };

    stagePage.hidden = false;
    const progress = el(doc, "div", { class: "dsh-log", dataset: { testid: "dashboard-progress" } });
    const holder = el(doc, "div", { dataset: { testid: "dashboard-frame-holder" } });
    stagePage._body.replaceChildren(progress, holder);
    results = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: v.spec.panels,
      onEvent: (e) => {
        if (e.type === "panel-done") {
          progress.appendChild(el(doc, "div", { class: e.ok ? "" : "dsh-err",
            text: e.ok ? `${e.name}: ${e.rows} rows` : `${e.name}: ${e.error}` }));
        }
      },
    });
    const stale = staleAssertions(v.spec, results);
    try { mounted?.destroy(); } catch { /* first mount */ }
    mounted = mountDashboard(holder, v.spec, { onRefresh: () => refresh(),
                                               onEvent: () => {}, doc });
    mounted.post({ results: payloadsFor(v.spec, results), stale });
    progress.appendChild(el(doc, "div", { class: stale.length ? "dsh-warn" : "dsh-note",
      text: stale.length
        ? `${stale.length} passage(s) were written against data that has since changed; `
        + `they are marked in the page.`
        : "every passage still matches the data it was written from." }));
    recorded = false;
    presentDisposition(entry.title, new Date());
  }

  /* ── Phase 1: the meter and the log ── */

  const phase1 = stage(doc, "Phase 1 — the model works inside the grant", "");
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
                      { gate: true });
  gate1.hidden = true;
  body.appendChild(gate1);

  /* ── Phase 2/3: the page ── */

  const stagePage = stage(doc, "The page", "sandboxed: scripts on, origin opaque, no network");
  stagePage.hidden = true;
  body.appendChild(stagePage);

  /* ── Gate 2: disposition ── */

  const gate2 = stage(doc, "Gate 2 — disposition", "", { gate: true });
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
        system: dashboardSystem(DEFAULT_SYSTEM, { grant, digesting: true,
                                                  answerTokens: ANSWER_TOKENS }),
        onEvent,
      });
      adapterResult = await adapter.run(text);
      st.session = adapterResult.session || st.session;
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
      const cut = Boolean(adapterResult?.truncated) || openFence(last.text);
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

    validated = validateDashboard(adapterResult.dashboard);
    const { spec, errors, warnings } = validated;

    for (const e of errors) {
      gate1._body.appendChild(el(doc, "div", { class: "dsh-err", text: `error: ${e}` }));
    }
    for (const w of warnings) {
      gate1._body.appendChild(el(doc, "div", { class: "dsh-warn", text: `note: ${w}` }));
    }

    for (const p of spec.panels) {
      const box = el(doc, "div", { class: "dsh-panel" });
      box.appendChild(el(doc, "header", {}, [
        el(doc, "span", { class: "dsh-kind dsh-kind-bound", text: "bound" }),
        el(doc, "b", { text: p.name }),
        el(doc, "span", { class: "dsh-note", text: p.caption || "" }),
        el(doc, "span", { class: "dsh-note", style: "margin-left:auto",
                          text: viaCatalog ? tempName(run, p.name) : p.accept }),
      ]));
      box.appendChild(el(doc, "pre", { class: "dsh-pre", text: p.query }));
      gate1._body.appendChild(box);
    }
    for (const t of spec.transforms) {
      const box = el(doc, "div", { class: "dsh-panel" });
      box.appendChild(el(doc, "header", {}, [
        el(doc, "span", { class: "dsh-kind dsh-kind-derived", text: "derived" }),
        el(doc, "b", { text: t.name }),
        el(doc, "span", { class: "dsh-note", text: `from ${t.inputs.join(", ") || "nothing"}` }),
      ]));
      box.appendChild(el(doc, "pre", { class: "dsh-pre", text: t.body }));
      gate1._body.appendChild(box);
    }
    for (const a of spec.assertions) {
      const box = el(doc, "div", { class: "dsh-panel" });
      box.appendChild(el(doc, "header", {}, [
        el(doc, "span", { class: "dsh-kind dsh-kind-asserted", text: "asserted" }),
        el(doc, "b", { text: a.id }),
        el(doc, "span", { class: "dsh-note",
          text: a.inputs.length ? `written from ${a.inputs.join(", ")}`
                                : "outside knowledge — nothing here supports or contradicts it" }),
      ]));
      box.appendChild(el(doc, "pre", { class: "dsh-pre", text: a.text }));
      gate1._body.appendChild(box);
    }

    const runBtn = el(doc, "button", {
      type: "button", class: "dsh-primary", dataset: { testid: "dashboard-run-panels" },
      text: `Run ${spec.panels.length} ${spec.panels.length === 1 ? "panel" : "panels"}`,
    });
    runBtn.disabled = !validated.ok;
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

  async function executePanels(promptText, started) {
    const spec = validated.spec;
    stagePage.hidden = false;
    const progress = el(doc, "div", { class: "dsh-log", dataset: { testid: "dashboard-progress" } });
    const holder = el(doc, "div", { dataset: { testid: "dashboard-frame-holder" } });
    stagePage._body.replaceChildren(progress, holder);
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
    validated.spec = withInputDigests(spec, results);
    mountPage(promptText, started);
  }

  function mountPage(promptText, started) {
    const spec = validated.spec;
    const holder = stagePage._body.querySelector('[data-testid="dashboard-frame-holder"]');
    try { mounted?.destroy(); } catch { /* first mount */ }
    mounted = mountDashboard(holder, spec, {
      onRefresh: () => refresh(),
      onEvent: (e) => {
        if (e.type === "error") {
          stagePage._body.appendChild(el(doc, "div", { class: "dsh-err",
            text: `the page reported an error in ${e.where}: ${e.error}` }));
        }
      },
      doc,
    });
    mounted.post({ results: payloadsFor(spec, results), stale: [] });
    presentDisposition(promptText, started);
  }

  async function refresh() {
    if (!validated?.spec) return;
    const spec = validated.spec;
    const fresh = await runPanels({
      host, account: accountName, repository: repositoryName, token: st.token,
      panels: spec.panels, run, viaCatalog,
    });
    results = fresh;
    // The page updates; the prose does not, and the difference is marked
    // rather than hidden (D-T).  A sentence written against data that has
    // moved is not deleted -- the user may still want it -- it is flagged.
    const stale = staleAssertions(spec, fresh);
    mounted?.post({ results: payloadsFor(spec, fresh), stale });
    if (stale.length) {
      stagePage._body.appendChild(el(doc, "div", { class: "dsh-warn",
        text: `${stale.length} passage(s) were written against data that has since changed; `
            + `they are marked in the page.` }));
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
      const base = (nameInput.value || "").trim() || validated.spec.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dashboard";
      const kept = [];
      for (const p of validated.spec.panels) {
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
      const html = mounted.page(payloadsFor(validated.spec, results));
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = el(doc, "a", { href: url, download: `${slug(validated.spec.title)}.html` });
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
    const dash = {
      ...dashboardRecord(validated.spec, results, { grant, prompt: promptText }),
      disposition,
      via: viaCatalog ? "catalog" : "direct",
      panels: dashboardRecord(validated.spec, results, { grant }).panels.map((p) => ({
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

  const api = { wrapper, state: st, start: startRun, refresh,
                get grant() { return grant; },
                get spec() { return validated?.spec || null; },
                get results() { return results; } };
  wrapper._dashboardApi = api;
  promptEl.focus();
  return api;
}

export default openDashboardPane;
