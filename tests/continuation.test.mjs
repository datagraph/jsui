/**
 * Carrying an exploration into its follow-up.
 *
 * The explore pane's "next steps" box continues the run that produced the
 * answer above it, which means the next turn is sent with the previous one in
 * front of it.  Three things have to hold for that to be worth doing twice:
 *
 *   - the conversation stays VALID.  A run that exhausted its rounds ends on a
 *     user turn carrying tool results, and a second user message after it gets
 *     the whole conversation refused.  An open tail is closed first.
 *   - the pairing survives.  A tool result is carried as a result block with
 *     its id, however big it was; only its CONTENT is stated instead.  Drop the
 *     block and the call that produced it has no answer.
 *   - it stays BOUNDED.  The fourth follow-up must not be three runs of result
 *     rows, so a conversation past the ceiling is trimmed at an exchange
 *     boundary -- never mid-exchange.
 *
 * Loading note: as in analysis.test.mjs, lib/ is copied into a scratch package
 * that declares "type": "module".
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-continuation-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (p) => import(pathToFileURL(join(scratch, "lib", ...p.split("/"))).href);

const C = await load("llm/continuation.js");

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`  ok   ${what}`); }
  else { fail += 1; console.log(`  FAIL ${what}`); }
};
const section = (s) => console.log(`\n${s}`);

const big = "x".repeat(40000);

/* An Anthropic run: question, a turn that called a tool, the results, an
   answer.  The shape `tool-adapter.js' actually pushes. */
const anthropic = (closed = true) => [
  { role: "user", content: "which types does b59 hold?" },
  { role: "assistant",
    content: [{ type: "text", text: "Let me look." },
              { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog" } }] },
  { role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
  ...(closed ? [{ role: "assistant", content: [{ type: "text", text: "86 types." }] }] : []),
];

// --------------------------------------------------------------- the payloads

section("what a carried result keeps");
{
  const carried = C.continuationFrom({ messages: anthropic(), finalText: "86 types." },
                                     { asked: "which types does b59 hold?" });
  const results = carried.filter((m) => Array.isArray(m.content)
                                     && m.content.some((b) => b.type === "tool_result"));
  ok(results.length === 1, "the result turn is carried, not dropped");
  const block = results[0].content[0];
  ok(block.tool_use_id === "t1",
     "and it keeps the id of the call it answers — without it the conversation is refused");
  ok(block.content.length < 5000,
     "its payload is cut to the ceiling rather than carried whole");
  ok(/40000 characters/.test(block.content),
     "and says how much was elided, so the model can ask for it again");
  ok(carried.some((m) => m.role === "assistant"),
     "the answer the run wrote is carried too");
}

section("the shapes the three providers use");
{
  const chat = C.elide({ role: "tool", tool_call_id: "c1", content: big }, 100);
  ok(chat.tool_call_id === "c1" && chat.content.length < 400,
     "Chat Completions: a `tool' message is shortened in place, id kept");
  const responses = C.elide({ type: "function_call_output", call_id: "r1", output: big }, 100);
  ok(responses.call_id === "r1" && responses.output.length < 400,
     "Responses: a `function_call_output' item likewise");
  const small = { role: "tool", tool_call_id: "c2", content: "3 rows" };
  ok(C.elide(small, 100) === small,
     "a payload under the ceiling is the same object — nothing is rewritten needlessly");
  const odd = { role: "system", content: "something else" };
  ok(C.elide(odd, 100) === odd, "and an unrecognised shape is carried untouched");
}

// ------------------------------------------------------------------ the tail

section("a run that ended without replying");
{
  const open = anthropic(false);          // ends on the tool_result turn
  ok(C.endsOpen(open), "the list is recognised as awaiting a reply");
  const carried = C.continuationFrom({ messages: open, finalText: "86 types, from the closing turn." },
                                     { asked: "which types?" });
  const last = carried[carried.length - 1];
  ok(last.role === "assistant",
     "so an assistant turn is appended before anything else can be — the API refuses two user turns");
  ok(/86 types/.test(last.content),
     "carrying the answer the closing turn did write, rather than a placeholder");
}
{
  const carried = C.continuationFrom(
    { messages: anthropic(false), finalText: "" }, { asked: "which types?" });
  ok(carried[carried.length - 1].role === "assistant",
     "and when the run wrote nothing at all the tail is still closed");
}

// ----------------------------------------------------------------- the bound

section("what a fourth follow-up carries");
{
  // Three exchanges, each opening with a plain user message.
  const three = [...anthropic(), ...anthropic(), ...anthropic()];
  const whole = C.continuationFrom({ messages: three, finalText: "86 types." },
                                   { asked: "q", payloadChars: 1000000, maxChars: 1000000 });
  ok(whole.length === three.length, "under the ceiling, everything is carried");

  const trimmed = C.continuationFrom({ messages: three, finalText: "86 types." },
                                     { asked: "q", payloadChars: 1000000, maxChars: 90000 });
  ok(trimmed.length < three.length, "over it, the oldest exchanges are dropped");
  ok(C.isPlainUser(trimmed[0]),
     "and what remains begins at an exchange boundary, so no result is left without its call");
}
{
  // One exchange too large to carry at all: the digest, not a broken list.
  const one = anthropic();
  const digest = C.continuationFrom({ messages: one, finalText: "86 types." },
                                    { asked: "which types?", payloadChars: 1000000,
                                      maxChars: 100 });
  ok(digest.length === 2 && digest[0].role === "user" && digest[1].role === "assistant",
     "a single exchange past the ceiling is carried as the question and the answer");
  ok(digest[0].content === "which types?" && /86 types/.test(digest[1].content),
     "which is the least a follow-up needs to mean anything");
}

section("nothing to carry");
{
  ok(C.continuationFrom(null).length === 0, "no previous run carries nothing");
  ok(C.continuationFrom({ messages: [], finalText: "an answer" }, { asked: "a question" })
      .length === 2,
     "a run that kept no messages still carries its exchange");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
