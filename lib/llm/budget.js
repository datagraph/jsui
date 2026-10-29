/**
 * The prompt and answer budgets, which now refuse (REQ-23.1.4).
 *
 * §13.9 of the generator plan put both on the screen and neither in the way:
 * the pane measured the system prompt, logged "prompt: 34 KiB (~8700
 * tokens)", and sent it regardless.  Measuring without refusing is the worst
 * of the three options -- it costs the work of knowing and buys none of the
 * protection, and it trains a reader to scroll past a number that never means
 * anything.
 *
 * Two different failures, so two verdicts.
 *
 * ── Before the call: the prompt ─────────────────────────────────────────────
 *
 * A prompt that is too long does not fail cleanly.  It either costs a large
 * request that the provider rejects at the far end -- after the user has
 * waited -- or, worse, it fits, and the answer is squeezed into whatever the
 * context has left.  The failure then looks like a model that gave up early,
 * which sends the reader looking at the model.  So the prompt is checked here,
 * before anything is sent, and a refusal names the two things that are
 * actually adjustable: the catalog subset and the grant.
 *
 * ── After the call: the answer ──────────────────────────────────────────────
 *
 * An answer cut at the ceiling is already detected -- `stop_reason' is carried
 * through the adapter -- but it was reported as a note beside the result
 * rather than as a refusal of it.  For a page or a figure that is the wrong
 * shape: a truncated page still has markup, and markup still renders (the
 * same property that makes a truncated SVG dangerous).  `answerVerdict' makes
 * it a refusal, so the caller must handle it rather than display it.
 *
 * Both are DEFAULTS, not policy: a caller passes its own ceiling.  The numbers
 * below are the ones the dashboard path measured in practice, with headroom,
 * and they are stated as characters because that is what the interface can
 * count without a tokenizer.  Four characters to the token is the conventional
 * approximation and is wrong in both directions for any particular text; it is
 * used only to report a token estimate beside the character count, never to
 * decide the verdict.
 */

/** Characters, not tokens: what the interface can count exactly. */
export const PROMPT_CEILING = 120000;

/** The share of the ceiling above which the prompt is worth warning about. */
export const PROMPT_WARN = 0.75;

const chars = (x) => (typeof x === "string" ? x.length : Number(x) || 0);

/** The conventional estimate, for display only. */
export const tokensIn = (text) => Math.ceil(chars(text) / 4);

/**
 * May this prompt be sent?
 *
 * `{ok}' alone would be enough to gate the call; the rest is what the pane
 * shows, and keeping it in one object means the log line and the refusal
 * cannot disagree about the size.
 */
export function promptVerdict(prompt, { ceiling = PROMPT_CEILING, warnAt = PROMPT_WARN } = {}) {
  const size = chars(prompt);
  const tokens = Math.ceil(size / 4);
  const share = ceiling > 0 ? size / ceiling : 0;
  const base = { size, tokens, ceiling, share, kiB: Math.round(size / 1024) };
  if (size > ceiling) {
    return { ...base, ok: false, level: "refused",
             reason: `the prompt is ${Math.round(size / 1024)} KiB (~${tokens} tokens), `
                   + `over the ${Math.round(ceiling / 1024)} KiB ceiling. Nothing was sent. `
                   + `Name fewer components so the catalog is subsetted smaller, or lower `
                   + `the grant — both reduce the prompt, and the answer has to share the `
                   + `same turn.` };
  }
  if (share >= warnAt) {
    return { ...base, ok: true, level: "warned",
             reason: `the prompt is ${Math.round(share * 100)}% of its ceiling `
                   + `(${Math.round(size / 1024)} KiB, ~${tokens} tokens); the answer shares `
                   + `the same turn.` };
  }
  return { ...base, ok: true, level: "ok", reason: null };
}

/** The stop reasons that mean "cut off", across the three provider shapes. */
const CUT = new Set(["max_tokens", "length", "max_output_tokens", "incomplete"]);

/**
 * Was this answer complete?
 *
 * Refuses rather than annotates, because the caller's next act is to parse
 * markup out of it, and half of a page parses.
 */
export function answerVerdict({ stopReason = null, text = "", maxTokens = null } = {}) {
  const reason = String(stopReason || "").toLowerCase();
  const cut = CUT.has(reason);
  const size = chars(text);
  if (cut) {
    return { ok: false, truncated: true, stopReason: reason, size,
             reason: `the answer stopped at the output ceiling`
                   + (maxTokens ? ` of ${maxTokens} tokens` : "")
                   + `, so it is the beginning of an answer and not an answer. It is not `
                   + `shown, because a page or a figure cut part way still renders and `
                   + `looks finished. Ask for less in one turn.` };
  }
  if (!size) {
    return { ok: false, truncated: false, stopReason: reason, size,
             reason: `the model returned no text`
                   + (reason ? ` (stop reason: ${reason})` : "") + `.` };
  }
  return { ok: true, truncated: false, stopReason: reason, size, reason: null };
}

/** One line for the pane's log, whatever the verdict. */
export function budgetLine(verdict) {
  if (!verdict) return "";
  return `prompt: ${verdict.kiB} KiB (~${verdict.tokens} tokens) of `
       + `${Math.round(verdict.ceiling / 1024)} KiB — ${verdict.level}`;
}

export default promptVerdict;
