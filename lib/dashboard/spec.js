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

import { queryFormOf } from "../llm/grant.js";
import { contentDigest } from "../mcp/result-digest.js";

/** A name a slot can carry: short, and safe in an attribute and a key. */
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** The read forms a panel query may take.  A panel never writes. */
const READ_FORMS = ["SELECT", "CONSTRUCT", "ASK", "DESCRIBE"];

/** The fenced block the model answers in.  One block, so there is one answer. */
export function dashboardFrom(text) {
  const s = String(text || "");
  const fenced = s.match(/```(?:dashboard|json)\s*\n([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : null;
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && (parsed.panels || parsed.html) ? parsed : null;
  } catch {
    return null;
  }
}

/* ── the slots a page refers to ───────────────────────────────────────────── */

const ATTR = (name) => new RegExp(`data-${name}\\s*=\\s*["']([^"']+)["']`, "gi");

/** Every slot the HTML names, by kind, in document order. */
export function slotsOf(html) {
  const s = String(html || "");
  const read = (kind) => {
    const out = [];
    for (const m of s.matchAll(ATTR(kind))) out.push(m[1].trim());
    return out;
  };
  return { bound: read("bound"), derived: read("derived"), asserted: read("asserted") };
}

/**
 * Things the frame's content policy will refuse, found before it refuses them.
 *
 * These are warnings, not errors.  The sandbox and the CSP already make each
 * one harmless -- an external image simply does not load -- but a blank panel
 * with no explanation is a bad way to learn that, and Gate 1 is the place to
 * say it while the page can still be changed.
 */
export function policyWarnings(html) {
  const s = String(html || "");
  const out = [];
  const flag = (re, what) => { if (re.test(s)) out.push(what); };
  flag(/<script[^>]*\bsrc\s*=/i, "a <script src=…> — external scripts are blocked; inline it");
  flag(/<(?:img|image)[^>]+\bsrc\s*=\s*["']https?:/i, "an external image — blocked; use a data: URI or draw it");
  flag(/<link[^>]+\bhref\s*=\s*["']https?:/i, "an external stylesheet — blocked; inline the CSS");
  flag(/@import\s+url/i, "a CSS @import — blocked");
  flag(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket/i,
       "a network call — the frame has connect-src 'none' and no credentials; "
     + "data arrives by postMessage only");
  flag(/<iframe/i, "a nested <iframe> — not mounted");
  flag(/localStorage|sessionStorage|document\.cookie/i,
       "browser storage — the frame's origin is opaque, so these throw or are empty");
  return out;
}

/**
 * Does a transform body parse?
 *
 * `frame.js' builds each transform with `new Function("inputs", "api", body)'
 * and calls it.  If the body does not parse, the throw happens at that
 * construction, inside the frame, after the page is already on the screen --
 * and what reaches the user is the frame's stack trace with no message in it
 * (Firefox leaves the message out of `SyntaxError.prototype.stack'), reading
 * as "the page reported an error in transform:census" and nothing more.
 *
 * The same construction here answers the same question before anything is
 * mounted, and Gate 1 is where a fault in the model's own code belongs.
 * Nothing is RUN: constructing a Function parses its body and stops.
 *
 * Only a SyntaxError is the model's fault.  A page served under a content
 * policy without `unsafe-eval' makes `new Function' throw an EvalError here
 * whatever the body says, and a validator that rejected every transform on
 * those grounds would be worse than one that does not check -- so that case
 * returns null and the frame, which does allow eval, stays the only check.
 */
function bodyFault(body) {
  try {
    new Function("inputs", "api", body);          // parsed, never called
    return null;
  } catch (e) {
    return e instanceof SyntaxError ? (e.message || "does not parse") : null;
  }
}

/* ── validation ───────────────────────────────────────────────────────────── */

/**
 * Check a proposal.  Returns {ok, spec, errors, warnings}.
 *
 * `errors' stop the page: it names a panel that does not exist, or a panel
 * whose query writes.  `warnings' are shown at Gate 1 and do not stop it.
 * The returned `spec' is normalised -- defaults filled, names trimmed -- so
 * everything downstream reads one shape.
 */
export function validateDashboard(input, { defaultAccept = "text/tab-separated-values" } = {}) {
  const errors = [], warnings = [];
  const raw = input && typeof input === "object" ? input : {};
  const panels = [], transforms = [], assertions = [];
  const seen = new Set();

  // Names that were declared and then REJECTED, which is not the same as names
  // that were never declared.  The difference is the difference between one
  // error and eighteen: a single rejected panel used to be reported again by
  // every transform that read it, every assertion that cited it and every slot
  // that bound it, and the one line saying why was lost among its own
  // consequences.  A reference to a rejected name is the first fault seen from
  // somewhere else, so it is not reported twice.
  //
  // Only REJECTED, though -- not merely declared.  A reference to a name
  // declared further down is a forward reference, which is a fault of the
  // referrer and the only thing standing between this validator and a cycle
  // (declaration order IS dependency order), so that one is still reported.
  const rejected = new Set();

  const unique = (name, what) => {
    if (!NAME_RE.test(name || "")) { errors.push(`${what} has an unusable name: ${JSON.stringify(name)}`); return false; }
    if (seen.has(name)) { errors.push(`${what} \`${name}' is declared twice`); return false; }
    seen.add(name);
    return true;
  };

  for (const p of [].concat(raw.panels || [])) {
    const name = String(p?.name || "").trim();
    if (!unique(name, "panel")) continue;
    const query = String(p?.query || "").trim();
    const form = queryFormOf(query);
    if (!query) {
      errors.push(`panel \`${name}' has no query`); rejected.add(name); continue;
    }
    if (!form) {
      errors.push(`panel \`${name}' does not begin with a query form`);
      rejected.add(name); continue;
    }
    if (!READ_FORMS.includes(form)) {
      errors.push(`panel \`${name}' is a ${form}; a panel reads, it does not write`);
      rejected.add(name);
      continue;
    }
    panels.push({
      name, query, form,
      accept: String(p?.accept || defaultAccept),
      caption: p?.caption ? String(p.caption) : null,
      title: p?.title ? String(p.title) : null,
    });
  }

  const panelNames = new Set(panels.map((p) => p.name));
  const known = new Set(panelNames);

  for (const t of [].concat(raw.transforms || [])) {
    const name = String(t?.name || "").trim();
    if (!unique(name, "transform")) continue;
    const inputs = [].concat(t?.inputs || []).map((i) => String(i).trim());
    const body = String(t?.body || "").trim();
    if (!body) {
      errors.push(`transform \`${name}' has no body`); rejected.add(name); continue;
    }
    const fault = bodyFault(body);
    if (fault) {
      errors.push(`transform \`${name}' does not compile: ${fault}`);
      rejected.add(name); continue;
    }
    // Inputs must already be declared.  Declaration order IS the dependency
    // order, which is cheaper to state than to compute and leaves no way to
    // write a cycle: a transform cannot name one that has not been seen.
    const unknown = inputs.filter((i) => !known.has(i));
    if (unknown.length) {
      const missing = unknown.filter((i) => !rejected.has(i));
      if (missing.length) {
        errors.push(`transform \`${name}' reads ${missing.map((u) => `\`${u}'`).join(", ")}, `
                  + `which ${missing.length > 1 ? "are" : "is"} not declared above it`);
      }
      rejected.add(name);
      continue;
    }
    if (!inputs.length) {
      warnings.push(`transform \`${name}' names no inputs, so nothing refreshes it`);
    }
    transforms.push({ name, inputs, body, caption: t?.caption ? String(t.caption) : null });
    known.add(name);
  }

  for (const a of [].concat(raw.assertions || [])) {
    const id = String(a?.id || a?.name || "").trim();
    if (!unique(id, "assertion")) continue;
    const inputs = [].concat(a?.inputs || []).map((i) => String(i).trim());
    const unknown = inputs.filter((i) => !known.has(i));
    if (unknown.length) {
      const missing = unknown.filter((i) => !rejected.has(i));
      if (missing.length) {
        errors.push(`assertion \`${id}' cites ${missing.map((u) => `\`${u}'`).join(", ")}, `
                  + `which ${missing.length > 1 ? "are" : "is"} not declared`);
      }
      rejected.add(id);
      continue;
    }
    // An assertion with no inputs is outside knowledge, which is allowed and
    // is exactly what the goal asks for -- but it can never be checked against
    // the store, and the page must say so rather than imply a provenance it
    // does not have.
    assertions.push({
      id, inputs, text: String(a?.text || ""),
      kind: inputs.length ? "derived-from-results" : "outside-knowledge",
    });
  }

  const html = String(raw.html || "");
  if (!html.trim()) errors.push("the proposal carries no html");
  const slots = slotsOf(html);

  for (const b of slots.bound) {
    if (!panelNames.has(b) && !rejected.has(b)) {
      errors.push(`the page binds \`${b}', which is not a panel`);
    }
  }
  for (const d of slots.derived) {
    if (!transforms.some((t) => t.name === d) && !rejected.has(d)) {
      errors.push(`the page shows derived \`${d}', which is not a transform`);
    }
  }
  for (const a of slots.asserted) {
    if (!assertions.some((x) => x.id === a) && !rejected.has(a)) {
      errors.push(`the page marks asserted \`${a}', which is not declared`);
    }
  }
  for (const p of panels) {
    if (!slots.bound.includes(p.name)
        && !transforms.some((t) => t.inputs.includes(p.name))
        && !assertions.some((x) => x.inputs.includes(p.name))) {
      warnings.push(`panel \`${p.name}' is run but never used — it costs a query for nothing`);
    }
  }
  // Only when none were PROPOSED.  "Nothing comes from the store" said of a
  // page whose three panels were just rejected describes the validator, not
  // the proposal, and sits under the errors as though it were a fourth fault.
  if (!panels.length && ![].concat(raw.panels || []).length) {
    warnings.push("no panels: nothing on this page comes from the store");
  }

  warnings.push(...policyWarnings(html));

  const spec = {
    title: String(raw.title || "Dashboard"),
    panels, transforms, assertions, html,
    notes: raw.notes ? String(raw.notes) : null,
  };
  return { ok: errors.length === 0, spec, errors, warnings, slots };
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
export function dashboardRecord(spec, results = {}, { grant = null, prompt = null } = {}) {
  return {
    title: spec.title,
    // The page itself, not only its digest.  A record that can say a dashboard
    // existed and not show it is an index, not an archive, and the thing a
    // user wants a week later is the page.  It is one literal of a few
    // kilobytes, well inside MAX_CONTENT.
    html: spec.html,
    pageDigest: contentDigest(spec.html),
    prompt,
    // A grant object or a state already read out of one: a run that recorded
    // the grant at the moment of the proposal has the latter, and refusing
    // it would lose the record over a shape.
    grant: grant ? (typeof grant.state === "function" ? grant.state() : grant) : null,
    panels: spec.panels.map((p) => ({
      name: p.name, query: p.query, accept: p.accept,
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
