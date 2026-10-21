/**
 * The dashboard the model proposes, and what makes it reviewable.
 *
 * Implements D-P, D-S and the declaration half of D-T from
 * `llm-result-rendering-plan.md' §7.2, and work items U-21, U-25 and U-26.
 *
 * A page is not one kind of thing.  An earlier draft of D-P had only two --
 * regions the pane fills from its own runs, and everything else, lumped
 * together as a static mode that was "not live" -- and that made the model's
 * own work second-class, when combining and interpreting results is the point
 * of involving a model at all.  There are three:
 *
 *   BOUND     `data-bound="panel"'      a slot the pane fills from its own run
 *                                       of that panel's query.  Live; the data
 *                                       is the UI's own, so §4.4(4) of the
 *                                       client plan holds at page scale.
 *   DERIVED   `data-derived="transform"' a value the model COMPUTED, expressed
 *                                       as a recipe the pane can re-run: a
 *                                       declared function over named result
 *                                       sets.  Everything the store cannot be
 *                                       asked for lives here, and it stays
 *                                       live, because the function is re-run
 *                                       against fresh results on refresh.
 *   ASSERTED  `data-asserted="id"'      prose, judgement, outside knowledge, a
 *                                       table the model merged by hand.  Not
 *                                       re-derivable from the store by
 *                                       anything.  Admitted, and marked.
 *
 * Analytic text is the third kind and it is wanted: a dashboard that cannot say
 * what its numbers mean is a worse product than one that can.  Nothing here
 * forbids it.  What it must do is declare itself, and declare WHICH RESULTS IT
 * WAS WRITTEN FROM -- `inputs' on an assertion -- because that is what lets the
 * pane notice later that the data moved and the sentence did not (D-T).  A
 * transcribed number cannot tell you it has become false; one that carries the
 * digest of what it was written against can.
 *
 * The model is also expected to prefer the cheapest route that can say the
 * thing: one query (bound) over a transform (derived) over its own reading
 * (asserted).  Not because its arithmetic is suspect -- because the first two
 * survive a refresh and the third does not.  That preference is stated in the
 * system prompt; this module only records which route each region took.
 *
 * On parsing HTML with regular expressions.  This module validates a proposal
 * before it is mounted and the page has no DOM to parse it with yet; the real
 * binding happens inside the frame, against a real DOM, in `frame.js'.  So the
 * scan here is deliberately conservative: it over-reports rather than under-
 * reports, and nothing SAFETY-critical rests on it.  What keeps a hostile page
 * harmless is the sandbox (D-R), never this scan.
 */

import { contentDigest } from "../mcp/result-digest.js";
import {
  NAME_RE, applicationFrom, slotsOf, policyWarnings, specOf, validateApplication,
} from "../app/document.js";

export { NAME_RE, slotsOf, policyWarnings };

/**
 * The fenced block the model answers in.  One block, so there is one answer.
 *
 * Reading is `lib/app/document.js''s now: a dashboard is an application
 * document with one view, and the two were never going to stay two readers of
 * the same block without drifting apart.
 */
export const dashboardFrom = applicationFrom;

/**
 * Check a proposal.  Returns {ok, spec, document, errors, warnings, slots, size}.
 *
 * A projection of `validateApplication' (U-27), not a second validator: the
 * generalisation is only correct if today's shape is literally the one-view
 * case of it, and the way to keep that true is to have one implementation and
 * project.  `spec' is what every existing caller reads; `document' is the
 * normalised application document underneath, for the callers that patch it.
 */
export function validateDashboard(input, options = {}) {
  const r = validateApplication(input, options);
  return { ...r, spec: specOf(r.document) };
}

/* ── provenance and staleness ─────────────────────────────────────────────── */

/**
 * Stamp each assertion with the digests of the results it was written from.
 *
 * This is D-T's declaration step.  `results' is {panelName: {digest}} as the
 * runner produced it.  On a later refresh the runner computes the digests
 * again and `staleAssertions' says which sentences were written against data
 * that is no longer there.
 */
export function withInputDigests(spec, results = {}) {
  const digestFor = (name) => results[name]?.digest ?? null;
  return {
    ...spec,
    assertions: spec.assertions.map((a) => ({
      ...a,
      inputDigests: Object.fromEntries(a.inputs.map((i) => [i, digestFor(i)])),
    })),
  };
}

/** Assertions whose inputs have moved since they were written. */
export function staleAssertions(spec, results = {}) {
  const out = [];
  for (const a of spec.assertions || []) {
    const was = a.inputDigests || {};
    const moved = a.inputs.filter((i) => was[i] && results[i]?.digest && was[i] !== results[i].digest);
    if (moved.length) out.push({ id: a.id, moved, text: a.text });
  }
  return out;
}

/**
 * The record of one dashboard, for the transcript (D-S).
 *
 * The page alone does not answer "what was this drawn from": it answers it for
 * bound regions, since they name a view, and not at all for the other two.  So
 * the record carries the queries, the transform sources, the assertions and
 * the digest of every result they were made from, and the page's own digest so
 * that the artifact and the record can be matched up later.
 */
export function dashboardRecord(spec, results = {}, { grant = null, prompt = null,
                                                     patches = null,
                                                     interaction = null } = {}) {
  const views = Array.isArray(spec.views) && spec.views.length ? spec.views : null;
  const html = views ? views.map((v) => v.html).join("\n") : String(spec.html || "");
  return {
    title: spec.title,
    // Identity, and where in its history this is (U-28).  A record without
    // them is a page that happened once; with them it is one revision of a
    // thing that can be reopened, continued and compared with what it was.
    // Absent on a record written before revisions existed, which is why every
    // reader treats them as optional rather than required.
    id: spec.id ?? null,
    revision: spec.revision ?? null,
    revisionOf: spec.revisionOf ?? null,
    toolbox: spec.toolbox ?? null,
    uses: Array.isArray(spec.uses) ? spec.uses : null,
    parameters: Array.isArray(spec.parameters) && spec.parameters.length ? spec.parameters : null,
    views: views ? views.map((v) => ({ name: v.name, title: v.title ?? null, html: v.html })) : null,
    styles: spec.styles ?? null,
    script: spec.script ?? null,
    state: spec.state && Object.keys(spec.state).length ? spec.state : null,
    // The operations that produced this revision from the last one, which is
    // the history the archive cannot otherwise show: two pages differ, and
    // without the patch nothing says which change was asked for.
    patches: Array.isArray(patches) && patches.length ? patches : null,
    // What the PAGE spent after it was mounted, as against what the model
    // spent before it was (§15 q.3).  Kept because the two are different
    // questions and a record that conflated them could answer neither: the
    // grant says what was authorised, this says what reading the page cost.
    interaction: interaction || null,
    // The page itself, not only its digest.  A record that can say a dashboard
    // existed and not show it is an index, not an archive, and the thing a
    // user wants a week later is the page.  It is one literal of a few
    // kilobytes, well inside MAX_CONTENT.
    html,
    pageDigest: contentDigest(html),
    prompt,
    // A grant object or a state already read out of one: a run that recorded
    // the grant at the moment of the proposal has the latter, and refusing
    // it would lose the record over a shape.
    grant: grant ? (typeof grant.state === "function" ? grant.state() : grant) : null,
    panels: spec.panels.map((p) => ({
      name: p.name, query: p.query, accept: p.accept,
      parameters: p.parameters?.length ? p.parameters : null,
      digest: results[p.name]?.digest ?? null,
      rows: results[p.name]?.rows ?? null,
      ok: results[p.name]?.ok ?? null,
    })),
    transforms: spec.transforms.map((t) => ({ name: t.name, inputs: t.inputs, body: t.body })),
    assertions: spec.assertions.map((a) => ({
      id: a.id, kind: a.kind, inputs: a.inputs, text: a.text,
      inputDigests: a.inputDigests || null,
    })),
  };
}

export default validateDashboard;
