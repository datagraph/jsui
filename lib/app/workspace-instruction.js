/**
 * One instruction against the chrome, from the bar to the store (U-72, U-78).
 *
 * The model call is an argument.  Everything that can be wrong here — a
 * patch that does not parse, a patch refused by the immutable
 * post-condition, a change that turns out to reach the data class, a write
 * that fails, the undo that has to be offered afterwards — can then be
 * exercised in node against a function that returns a canned answer, which
 * is the only way any of it gets tested at all: the alternative is a browser,
 * a provider key and a model that may answer differently tomorrow.
 *
 * The App supplies `ask' (a provider turn) and `save' (a write to
 * `<account>/ui'); this module decides what to do with what comes back, and
 * what the bar should say about it.
 */

import { applyPatch, patchFrom, classify } from "./patch.js";
import { validateApplication } from "./document.js";

/**
 * Apply one instruction to a workspace document.
 *
 * Returns what the bar prints: `{ok, message, document, undo}'.  `undo' is
 * present only when something was actually written, and it is a function
 * rather than an inverse — see D-AU, point 3.
 */
export async function runWorkspaceInstruction({
  document: current, text, ask, save = null, revisionOf = null,
} = {}) {
  if (!current) return { ok: false, message: "there is no workspace to change" };
  const asked = String(text || "").trim();
  if (!asked) return { ok: false, message: "nothing was asked" };
  if (typeof ask !== "function") {
    return { ok: false, message: "no model is connected — set a provider key in an exploration pane" };
  }

  let answer;
  try { answer = await ask({ text: asked, document: current }); }
  catch (e) { return { ok: false, message: `the model could not be asked: ${String(e)}` }; }
  if (answer && answer.ok === false && answer.error) {
    return { ok: false, message: `the model refused: ${answer.error}` };
  }

  const ops = patchFrom(answer?.finalText);
  if (!ops) {
    return { ok: false,
             message: answer?.truncated
               ? "the answer ran out of room with the patch block still open — ask for a smaller change"
               : "the answer carried no patch, so nothing has been changed" };
  }

  const applied = applyPatch(current, ops);
  if (!applied.ok) {
    return { ok: false, ops, message: `refused whole: ${(applied.errors || []).join("; ")}` };
  }

  /**
   * The chrome has no data, so a change to it cannot be a data change.
   *
   * If the classifier says otherwise the model has written a panel or a
   * parameter into the furniture, and the right answer is to refuse rather
   * than to raise a gate: a gate here would ask the user to authorise a
   * query against a repository the workspace never names.
   */
  const c = applied.classification || classify(current, applied.document, ops);
  if (c && c.class !== "presentational") {
    return { ok: false, ops, classification: c,
             message: `refused: the interface itself holds no data, and this would `
                    + `${(c.reasons || []).map((r) => r.why).join("; ") || "change the data it shows"}` };
  }

  const checked = validateApplication({ ...applied.document, id: current.id || "workspace" });
  if (!checked.ok) {
    return { ok: false, ops, message: `refused whole: ${(checked.errors || []).join("; ")}` };
  }
  const next = { ...checked.document, revision: (current.revision || 1) + 1,
                 revisionOf: revisionOf || `${current.id || "workspace"}#${current.revision || 1}` };

  if (typeof save !== "function") {
    return { ok: true, ops, document: next, classification: c, saved: false,
             message: `${describe(ops)} — not saved: this interface has no store` };
  }
  let written;
  try { written = await save(next); }
  catch (e) { written = { ok: false, error: String(e) }; }
  if (!written?.ok) {
    return { ok: false, ops, document: next, classification: c, saved: false,
             message: `changed, but not saved: ${written?.error || "the write failed"}` };
  }
  return {
    ok: true, ops, document: next, classification: c, saved: true,
    message: `${describe(ops)} — saved`,
    // The undo is built here, holding the document as it was BEFORE the
    // write, because that is the only moment anything knows it.  A revert is
    // a new revision rather than a rewind (U-68): whoever has already read
    // the version being undone still has something that happened.
    undo: async () => {
      let back;
      try { back = await save(current); }
      catch (e) { back = { ok: false, error: String(e) }; }
      return back?.ok
        ? { ok: true, message: "put back", document: current }
        : { ok: false, message: `could not put it back: ${back?.error || "the write failed"}` };
    },
  };
}

/** What a patch did, in a line the bar can hold. */
export function describe(ops) {
  const counts = new Map();
  for (const o of ops || []) counts.set(o.op, (counts.get(o.op) || 0) + 1);
  const said = [...counts.entries()].map(([op, n]) => (n === 1 ? op : `${op} ×${n}`));
  if (!said.length) return "nothing changed";
  return said.join(", ");
}

export default runWorkspaceInstruction;
