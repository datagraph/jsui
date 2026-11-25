/**
 * Carrying one exploration into the next turn.
 *
 * The explore pane asked a question and got an answer; the answer ends in
 * candidate next steps; the reader wants the second of them, for storeys above
 * three.  "The second one" is a sentence that means nothing to a model that has
 * been handed a fresh message list, so a follow-up has to arrive with what came
 * before it -- and `adapter.run' builds its list from the prompt alone.
 *
 * This is what goes in front of it.  The previous run's own messages, not a
 * paraphrase of them: the model sees the turns it took and the results it read,
 * so the next instruction can refer to any of it.
 *
 * Two things make that safe to do more than once.
 *
 *   BOUNDED.  A payload that reached the model as 40 KB of rows is carried as
 *   its size and a sentence saying it can be asked for again.  Without this the
 *   fourth follow-up carries three runs of result rows and the budget is spent
 *   on re-reading them.  The elision is of the CONTENT of a result block, never
 *   of the block, because the block is what pairs with the call that produced
 *   it -- drop the block and the provider refuses the conversation.
 *
 *   VALID.  A run that was stopped, or that exhausted its rounds, ends on a
 *   user turn carrying tool results: the adapter's closing reply is not pushed
 *   back onto the list.  Appending a second user message after that one gets
 *   the whole conversation refused -- Anthropic requires the roles to
 *   alternate -- so an open tail is closed with the answer the run did write
 *   before anything is added.
 *
 * Three providers, three shapes for the same thing, all three handled here
 * rather than in the pane: Anthropic carries results as `tool_result' blocks
 * inside a user message, Chat Completions as `tool' messages, and the Responses
 * API as `function_call_output' items.  Nothing else in this module knows which
 * provider ran, and it does not need to.
 */

/** Characters of prior conversation a follow-up may carry. */
export const DEFAULT_CARRY = 60000;

/** Characters of any one carried tool result, past which it is stated instead. */
export const DEFAULT_PAYLOAD = 4000;

const str = (v) => (typeof v === "string" ? v : "");

const sizeOf = (m) => {
  try { return JSON.stringify(m).length; } catch { return 0; }
};

const elidedTo = (n) =>
  `[${n} characters of results from an earlier turn, elided from this one. `
  + `Ask the store again if the detail is needed.]`;

const shrink = (s, limit) =>
  (typeof s === "string" && s.length > limit)
    ? `${s.slice(0, limit)}\n\n${elidedTo(s.length)}`
    : s;

/**
 * One message with its oversized result payloads stated rather than repeated.
 * Shapes it does not recognise are returned untouched: carrying a message
 * whole is always correct, and guessing at an unknown shape is not.
 */
export function elide(message, limit = DEFAULT_PAYLOAD) {
  if (!message || typeof message !== "object") return message;

  // Chat Completions: one message per result.
  if (message.role === "tool" && typeof message.content === "string") {
    const content = shrink(message.content, limit);
    return content === message.content ? message : { ...message, content };
  }
  // Responses API: an item, with no role at all.
  if (message.type === "function_call_output" && typeof message.output === "string") {
    const output = shrink(message.output, limit);
    return output === message.output ? message : { ...message, output };
  }
  // Anthropic: blocks inside a user turn.
  if (Array.isArray(message.content)) {
    let touched = false;
    const content = message.content.map((b) => {
      if (b && b.type === "tool_result" && typeof b.content === "string"
          && b.content.length > limit) {
        touched = true;
        return { ...b, content: shrink(b.content, limit) };
      }
      return b;
    });
    return touched ? { ...message, content } : message;
  }
  return message;
}

/** Whether MESSAGE is an exchange boundary a carried conversation may start at. */
export const isPlainUser = (m) =>
  Boolean(m) && m.role === "user" && typeof m.content === "string";

/**
 * Whether the list ends on a turn the model has not replied to -- results
 * handed over with no answer after them.  Such a list cannot be followed by a
 * user message.
 */
export function endsOpen(messages) {
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === "assistant") return false;
  if (last.type === "function_call_output") return true;
  if (last.role === "tool") return true;
  if (last.role === "user") return true;
  // An assistant item from the Responses API carries no role; anything else
  // that is not plainly a user turn is treated as answered.
  return false;
}

/**
 * The messages to put in front of a follow-up instruction.
 *
 * PREVIOUS is a run's return value; ASKED is the question that started it,
 * which the run does not carry and which the pane does.  Returns [] when there
 * is nothing to carry, so a caller can pass the result unconditionally.
 */
export function continuationFrom(previous, {
  asked = "", maxChars = DEFAULT_CARRY, payloadChars = DEFAULT_PAYLOAD,
} = {}) {
  if (!previous) return [];
  const answer = str(previous.finalText) || str(previous.lastTurn?.text);
  const digest = () => [
    ...(asked ? [{ role: "user", content: asked }] : []),
    ...(answer ? [{ role: "assistant", content: answer }] : []),
  ];

  let messages = Array.isArray(previous.messages)
    ? previous.messages.map((m) => elide(m, payloadChars))
    : [];
  if (!messages.length) return digest();

  // Drop whole exchanges from the front rather than individual messages: a
  // result block whose call has been dropped is an invalid conversation, and
  // every exchange begins with the plain user message that opened it.
  const total = (list) => list.reduce((n, m) => n + sizeOf(m), 0);
  if (total(messages) > maxChars) {
    const starts = messages.reduce(
      (acc, m, i) => (i > 0 && isPlainUser(m) ? [...acc, i] : acc), []);
    for (const i of starts) {
      if (total(messages) <= maxChars) break;
      messages = messages.slice(i);
    }
  }
  // Still over after trimming to the last boundary: the run itself was larger
  // than a follow-up may carry, so what is carried is the exchange.
  if (total(messages) > maxChars) return digest();

  if (endsOpen(messages)) {
    messages = [...messages, {
      role: "assistant",
      content: answer || "(the turn ended before an answer was written)",
    }];
  }
  return messages;
}
