/**
 * The figure proposal, and what can be said about a figure before it is shown.
 *
 * The §2 counterpart of `lib/dashboard/spec.js', and deliberately much
 * smaller.  A dashboard needs a content contract because it has three kinds
 * of region and a page to bind them into; a figure is one query and one
 * picture, and the only things that have to be settled before the user is
 * asked to authorise anything are what will run, in what notation, and what
 * the picture is supposed to be.
 *
 * Two things here are worth stating plainly, because both are easy to get
 * wrong in the same direction:
 *
 * 1. `figurePolicy' REPORTS; it does not sanitise.  D-M's argument is that a
 *    hand-written allowlist over SVG is a standing liability -- every feature
 *    anyone adds to the format is a new way for the list to be wrong -- and
 *    that the sandbox is correct by construction instead.  Removing a
 *    `<script>' here would weaken that: it would make the pane look like the
 *    thing standing between the user and active content, when the frame is.
 *    So the policy walk says what will silently not work, and the figure is
 *    mounted exactly as the model wrote it.
 *
 * 2. The notation is the MODEL's choice and the interface's to validate
 *    (D-L).  `accept' is an input selector for a reader that pays by the
 *    token; it is not a license to ask the store for anything at all, so a
 *    notation the query form cannot produce is corrected, with the correction
 *    visible at Gate 1 rather than applied quietly.
 */

import { sparqlFrom } from "../mcp/mcp-client.js";
import { queryFormOf } from "../llm/grant.js";
import { contentDigest } from "../mcp/result-digest.js";
import { divergenceFrom } from "./provenance.js";
import { RESULT_NOTATIONS } from "../llm/figure-prompt.js";

/**
 * The layout engines a DOT figure may ask for.
 *
 * Stated here as well as in `lib/wasm/graphviz.js' would be a second place to
 * forget, so it is imported -- but the import must not drag the engine
 * loader into a page that is only validating a proposal, and it does not:
 * `lib/wasm/graphviz.js' loads the 800K bundle on first LAYOUT, not on
 * import.
 */
import { DOT_ENGINES, DEFAULT_ENGINE, ENGINE_NOTES } from "../wasm/graphviz.js";
export { DOT_ENGINES, DEFAULT_ENGINE, ENGINE_NOTES };

export const FIGURE_KINDS = ["svg", "dot"];

/** Query forms the interface will run on a model's proposal. */
export const RUNNABLE_FORMS = ["SELECT", "CONSTRUCT", "ASK", "DESCRIBE"];

/** The name a kept figure's view gets, before the user renames it. */
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * The `figure' block of a proposal: the model's own description of what it
 * means to draw, read out of the prose it wrote around it.
 */
export function figureSpecFrom(text) {
  const s = String(text || "");
  const fence = /```figure[^\S\n]*\n([\s\S]*?)```/gi;
  let last = null;
  for (let m = fence.exec(s); m; m = fence.exec(s)) last = m[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The notation a form can actually be asked for, and what was asked. */
export function acceptFor(query, asked) {
  const form = queryFormOf(query) || "SELECT";
  const allowed = RESULT_NOTATIONS[form] || RESULT_NOTATIONS.SELECT;
  if (asked && allowed.includes(asked)) return { accept: asked, corrected: false, allowed };
  return { accept: allowed[0], corrected: Boolean(asked), allowed };
}

/**
 * A proposal, checked.  Returns what Gate 1 needs to show and run.
 *
 * Nothing is thrown and nothing is dropped: a proposal with problems still
 * comes back, with its problems listed, because the user reading Gate 1 is
 * better served by "this is what it wants to run and here is what is wrong
 * with it" than by an empty gate and a console message.
 */
export function validateProposal({ query, text = "", spec = null, ran = [] } = {}) {
  const errors = [], warnings = [];
  // The query may be handed in, or read out of the prose it was fenced in:
  // the gate has it either way and should not have to know which.
  const sparql = String(query || sparqlFrom(text) || "").trim();
  const figure = { kind: "svg", title: null, caption: null, accept: null, why: null,
                   ...(spec || figureSpecFrom(text) || {}) };

  if (!sparql) errors.push("the turn carried no SPARQL query");
  const form = queryFormOf(sparql);
  if (sparql && !form) errors.push("the query does not begin with a SPARQL keyword");
  else if (sparql && !RUNNABLE_FORMS.includes(form)) {
    errors.push(`a ${form} is not something this will run: a figure is drawn from a read`);
  }

  figure.kind = String(figure.kind || "svg").toLowerCase();
  if (!FIGURE_KINDS.includes(figure.kind)) {
    warnings.push(`\`${figure.kind}' is not a figure kind; svg will be asked for`);
    figure.kind = "svg";
  }
  // A DOT figure is laid out by the vendored engine before it is mounted
  // (`lib/wasm/graphviz.js'), so the engine is a real choice and a wrong one
  // is worth correcting here -- at the gate, visibly -- rather than silently
  // when the picture comes out radial for no reason the user can see.
  if (figure.kind === "dot") {
    const asked = String(figure.engine || "").toLowerCase().trim();
    if (asked && !DOT_ENGINES.includes(asked)) {
      warnings.push(`\`${figure.engine}' is not a layout engine offered here; `
                  + `\`${DEFAULT_ENGINE}' will be used instead (${DOT_ENGINES.join(", ")})`);
      figure.engine = DEFAULT_ENGINE;
    } else {
      figure.engine = asked || DEFAULT_ENGINE;
    }
  } else if (figure.engine) {
    delete figure.engine;
  }
  if (!figure.caption) warnings.push("the proposal carries no caption");

  const chosen = acceptFor(sparql, figure.accept);
  if (chosen.corrected) {
    warnings.push(`\`${figure.accept}' is not a notation a ${form} produces here; `
                + `\`${chosen.accept}' will be asked for instead`);
  }
  figure.accept = chosen.accept;

  // Is this the query that ran?  The query in the prose was TYPED AGAIN, and
  // a retyped query loses things -- a `FROM' clause above all, which costs
  // nothing in validity and everything in what comes back.  The comparison
  // is against what the interface itself relayed, because that is the only
  // record of what was actually sent.  Only a dataset change is raised: a
  // model proposing a better query than the one it explored with is what the
  // three-step contract asks for, and warning about that would train the
  // user to click past this.
  const divergence = divergenceFrom(sparql, ran);
  if (divergence.kind === "dataset") warnings.push(divergence.note);

  return { ok: errors.length === 0, errors, warnings, query: sparql, form, figure,
           notations: chosen.allowed, divergence };
}

/**
 * A row cap, applied at Gate 1 -- the last point before anything runs.
 *
 * §6 of the plan asks for the size problem to be headed off here rather than
 * discovered three steps later as a truncated figure, and this is the lever
 * it names.  A query that already ends in a LIMIT is left alone: the model
 * chose that number for a reason it stated, and silently tightening it would
 * make the figure disagree with the caption the user just read.
 */
export function capRows(query, limit) {
  const q = String(query || "");
  const n = Math.trunc(Number(limit) || 0);
  if (n <= 0) return { query: q, applied: false, had: /\bLIMIT\s+\d+/i.test(q) };
  if (/\bLIMIT\s+\d+\s*$/i.test(q.trim())) return { query: q, applied: false, had: true };
  return { query: `${q.trim()}\nLIMIT ${n}`, applied: true, had: false };
}

/* ── what the sandbox will quietly refuse ────────────────────────────────── */

const PROBES = [
  [/<script[\s>]/i, "a <script> element — scripts are disabled in the frame, so it will not run"],
  [/\son[a-z]+\s*=/i, "an inline event handler (onload=, onclick=) — handlers never fire"],
  [/<foreignObject[\s/>]/i, "a <foreignObject> — not available; text must be <text>"],
  [/(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i,
   "an external reference — default-src 'none' blocks it, leaving a gap where it was"],
  [/@import\b/i, "an @import — stylesheets are not loaded"],
  [/url\(\s*["']?(?:https?:)?\/\//i, "a url() to the network — not loaded"],
  [/<!DOCTYPE|<!ENTITY/i, "a doctype or entity declaration — strip it; the figure is embedded, not a document"],
  [/xlink:href\s*=\s*["']?(?!#)/i, "an xlink:href that is not a fragment — not resolved"],
];

/**
 * What the policy will drop, said out loud.
 *
 * None of this is a refusal.  It is what a reader needs in order to
 * understand a figure that came out with a hole in it, and what the pane
 * shows beside the preview so the hole is explained rather than mysterious.
 */
export function figurePolicy(text, kind = "svg") {
  const s = String(text || "");
  const notes = [];
  for (const [re, why] of PROBES) if (re.test(s)) notes.push(why);
  if (kind === "svg") {
    if (!/<svg[\s>]/i.test(s)) notes.push("no <svg> element: nothing will render");
    else if (!/viewBox\s*=/i.test(s)) {
      notes.push("no viewBox — the figure cannot scale to the pane and may be clipped");
    }
  }
  return notes;
}

/** The viewBox ratio, for a frame that has no script to measure itself with. */
export function aspectOf(svgText, fallback = 16 / 9) {
  const m = /viewBox\s*=\s*["']\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)[ ,]+([\d.eE+]+)[ ,]+([\d.eE+]+)/i
    .exec(String(svgText || ""));
  if (!m) return fallback;
  const w = Number(m[3]), h = Number(m[4]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : fallback;
}

/* ── the record ──────────────────────────────────────────────────────────── */

/**
 * One figure, as the transcript keeps it (D-N).
 *
 * The figure, the query it was drawn from, the digest of the exact document
 * it was drawn from, and the disposition the user chose.  The digest is the
 * part that makes the record answer the question it exists to answer: a
 * figure found a month later can be matched against a re-run of the same
 * query, and "this is a picture of data that no longer looks like this" is
 * then a fact rather than a suspicion.
 */
export function figureRecord({
  figure, proposal, result, prompt = null, disposition = null, view = null,
  via = null, promotedTo = null,
} = {}) {
  return {
    kind: figure?.kind || null,
    engine: figure?.kind === "dot"
      ? (figure?.engine || proposal?.figure?.engine || DEFAULT_ENGINE) : null,
    caption: figure?.caption || proposal?.figure?.caption || null,
    title: proposal?.figure?.title || null,
    text: figure?.text || null,
    complete: figure?.complete !== false,
    figureDigest: figure?.text ? contentDigest(figure.text) : null,
    query: proposal?.query || null,
    accept: proposal?.figure?.accept || null,
    mimeType: result?.mimeType || null,
    resultDigest: result?.digest || null,
    rows: result?.rows ?? null,
    bytes: result?.bytes ?? (result?.text ? result.text.length : null),
    view, promotedTo, via, disposition, prompt,
    policy: figure?.text ? figurePolicy(figure.text, figure.kind) : [],
  };
}

export default validateProposal;
