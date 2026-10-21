/**
 * The repair loop: a page that broke, and the smallest thing that could fix it.
 *
 * Implements D-AA and §11 of `ui-generator.md'; work item U-41.
 *
 * Every piece of this already existed and none of it was wired together.  The
 * validator catches a transform that does not parse, at Gate 1, before
 * anything is mounted.  The frame catches one that throws at run time, marks
 * the region `data-failed' in place and posts the error out with a name and a
 * message.  And then the error reaches the pane, is printed under the page,
 * and the user retypes the prompt.  That last step is the whole of what this
 * module replaces.
 *
 * Three rules, and each exists because the obvious version of an automatic
 * repair loop violates it:
 *
 *   TWO ATTEMPTS.  A loop that cannot converge must stop where a human can
 *   see it.  Three attempts is not meaningfully better than two and costs a
 *   third turn of the grant; unbounded is a page that rewrites itself all
 *   afternoon.  A page still broken after two is left broken, with both
 *   errors shown -- which is more useful than a third guess, because the two
 *   failed attempts are themselves evidence.
 *
 *   ONLY THE FAILING REGION'S SOURCE.  §2.5 again: the repair turn competes
 *   for the same output ceiling as everything else, and a turn that carries
 *   the whole document to fix one transform has less room to answer than one
 *   that carries the transform.  It is also a better prompt: a model shown
 *   one function and one stack trace does not have to decide what is
 *   relevant.
 *
 *   A REPAIR IS A PATCH LIKE ANY OTHER.  It is classified (D-W) and a repair
 *   that changes a panel query stops at Gate 1.  A bug is not authority: the
 *   fact that something is broken is not a reason to let the fix run a query
 *   the user has not seen.
 */

/** How many times the interface will try before leaving it to the user. */
export const MAX_ATTEMPTS = 2;

/**
 * Faults, grouped by the region they came from.
 *
 * The frame reports one error per failing region per fill, so a page whose
 * data arrives twice reports the same broken transform twice.  Grouping by
 * `where' keeps that from looking like two faults -- and keeps the repair
 * turn from carrying the same source twice.
 */
export function groupFailures(events = []) {
  const byWhere = new Map();
  for (const e of events) {
    if (!e || e.type !== "error" || !e.where) continue;
    const seen = byWhere.get(e.where);
    if (seen) { seen.count += 1; seen.error = e.error; continue; }
    byWhere.set(e.where, { where: e.where, error: e.error, count: 1 });
  }
  return [...byWhere.values()];
}

/**
 * What part of the document a fault is about.
 *
 * `where' is the frame's own label: `transform:growth', `bound:sales',
 * `derived:margin', `asserted:lead', `page', `promise', `fill', `ondata'.
 * Anything unrecognised is `page', which carries the page's own script --
 * the right default, because an error with no region is one the model's
 * script caused.
 */
export function locate(where) {
  const text = String(where || "");
  const at = text.indexOf(":");
  if (at < 0) return { kind: "page", name: null };
  return { kind: text.slice(0, at), name: text.slice(at + 1) };
}

/**
 * The source the model needs to see, and nothing else.
 *
 * Returns {kind, name, source, label} or null when the fault names something
 * the document does not contain -- which happens, and is worth not papering
 * over: a region that failed and is not in the document means the frame and
 * the document have come apart, and the right answer is a rebuild, not a
 * repair.
 */
export function regionSource(document_, where) {
  const { kind, name } = locate(where);
  const d = document_ || {};
  const views = d.views || [];
  const html = views.map((v) => v.html).join("\n");

  if (kind === "transform" || kind === "derived") {
    const t = (d.transforms || []).find((x) => x.name === name);
    if (!t) return null;
    return { kind: "transform", name,
             label: `transform \`${name}', which reads ${t.inputs.join(", ") || "nothing"}`,
             source: t.body };
  }
  if (kind === "bound") {
    const p = (d.panels || []).find((x) => x.name === name);
    if (!p) return null;
    return { kind: "panel", name, label: `panel \`${name}'`, source: p.query };
  }
  if (kind === "asserted") {
    const a = (d.assertions || []).find((x) => x.id === name);
    if (!a) return null;
    return { kind: "assertion", name, label: `assertion \`${name}'`, source: a.text };
  }
  if (kind === "patch") {
    return { kind: "patch", name, label: `applying a patch operation \`${name}'`, source: "" };
  }
  // `page', `promise', `fill', `ondata': the model's own script, or the
  // markup if it did not write one.
  return { kind: "script", name: null,
           label: d.script ? "the page's own script" : "the page's markup",
           source: d.script || html.slice(0, 4000) };
}

/**
 * The turn sent to the model.
 *
 * Deliberately plain, and deliberately ending with the instruction rather
 * than beginning with it: a repair prompt that opens with "fix this" and
 * then shows the error invites a model to start writing before it has read
 * the stack.
 */
export function repairPrompt(document_, failures, { attempt = 1 } = {}) {
  const lines = [
    attempt > 1
      ? `The previous repair did not work. This is attempt ${attempt} of ${MAX_ATTEMPTS}.`
      : "The page you wrote is on the screen and part of it failed at run time.",
    "",
  ];
  let found = 0;
  for (const f of failures) {
    const region = regionSource(document_, f.where);
    lines.push(`**${region ? region.label : f.where}** reported:`, "", "```", String(f.error || "").slice(0, 1200), "```", "");
    if (region && region.source) {
      found += 1;
      lines.push("Its source, which is the only part of the page sent to you:", "",
                 "```", String(region.source).slice(0, 4000), "```", "");
    }
  }
  lines.push(
    "Answer with a ```patch block holding the smallest set of operations that fixes",
    "this, and nothing else — no explanation of the page, no re-emission of the parts",
    "that work. If the fault is in a panel query the user will be asked to authorise",
    "the change before it runs, so say in one sentence why the query has to change.",
    "If you cannot tell what is wrong from what is above, say so instead of guessing:",
    "a wrong patch costs the user the attempt.",
  );
  return { prompt: lines.join("\n"), regions: found };
}

/**
 * The loop's bookkeeping.
 *
 * Not a state machine with a timer in it: the pane drives, this remembers.
 * What it remembers is what the record has to carry (D-AA: every attempt
 * visible in the pane AND in the record) and what the decision to stop rests
 * on.
 */
export function createRepairLoop({ maxAttempts = MAX_ATTEMPTS } = {}) {
  const attempts = [];
  return {
    get attempts() { return attempts.slice(); },
    get count() { return attempts.length; },
    /** Is another automatic attempt allowed, for these faults? */
    mayAttempt(failures = []) {
      if (!failures.length) return false;
      if (attempts.length >= maxAttempts) return false;
      // The same faults as last time, unchanged, means the last patch did
      // nothing.  Trying again with the same input is the definition of a
      // loop that cannot converge, so it stops one attempt early.
      const last = attempts[attempts.length - 1];
      if (last && signature(last.failures) === signature(failures)
          && last.outcome === "unchanged") return false;
      return true;
    },
    record({ failures, patch = null, outcome = "attempted", errors = null }) {
      attempts.push({ at: new Date().toISOString(), failures: failures.map((f) => ({ ...f })),
                      patch, outcome, errors });
      return attempts[attempts.length - 1];
    },
    /** What the pane shows, and what the record keeps. */
    summary() {
      if (!attempts.length) return null;
      return {
        attempts: attempts.length,
        exhausted: attempts.length >= maxAttempts,
        regions: [...new Set(attempts.flatMap((a) => a.failures.map((f) => f.where)))],
        outcomes: attempts.map((a) => a.outcome),
      };
    },
  };
}

const signature = (failures = []) =>
  failures.map((f) => `${f.where}|${String(f.error || "").split("\n")[0]}`).sort().join("\n");

export { signature as failureSignature };

export default createRepairLoop;
