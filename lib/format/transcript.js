/**
 * Making a transcript legible.
 *
 * Everything that passes through the exploration pane arrives as a string, and
 * the strings are of four quite different kinds: a JSON-RPC envelope, a SPARQL
 * query, the score notation the survey tool answers in, and the model's own
 * prose with queries fenced inside it.  Shown raw they all look the same --
 * one grey block of monospace -- which is why the pane was hard to read.
 *
 * These functions decide what a string *is* and cut it into the pieces a
 * renderer can style.  They are pure and know nothing about the DOM, so the
 * decisions can be tested on their own; ui/components/exploration-pane.js
 * turns the pieces into elements.
 */

/** Anything longer than this is clipped before it reaches the DOM. */
export const CLIP = 40000;

/**
 * Anything these functions are handed, as text.
 *
 * Callers pass whatever they have -- a response body that is already a string,
 * or a request body that is still the object it will be serialised from.  An
 * object must be formatted, not have String() called on it, or the transcript
 * reads `[object Object]' where the request should be.
 */
export function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

export function clip(text, max = CLIP) {
  const s = asText(text);
  return s.length <= max ? s
       : `${s.slice(0, max)}\n\n… ${s.length - max} more character(s) not shown.`;
}

/** Pretty-printed JSON, or null when the text is not JSON. */
export function prettyJson(text) {
  if (text && typeof text === "object") return asText(text);
  const s = asText(text).trim();
  if (!s || !/^[[{]/.test(s)) return null;
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return null; }
}

const SPARQL_HEAD = /^\s*(PREFIX|BASE|SELECT|CONSTRUCT|ASK|DESCRIBE|INSERT|DELETE|WITH|LOAD|CLEAR|DROP|CREATE)\b/i;

/**
 * What kind of text this is.  The order matters: a JSON document that happens
 * to begin with the word SELECT is still JSON, and score notation is the
 * residue -- what is neither JSON nor a query but is plainly structured.
 */
export function classify(text) {
  if (text && typeof text === "object") return "json";
  const s = asText(text).trim();
  if (!s) return "empty";
  if (prettyJson(s) !== null) return "json";
  if (SPARQL_HEAD.test(s)) return "sparql";
  // Score notation leads one of three ways: with an operation, with a
  // brace-delimited shape, or -- as a live answer does -- with a declaration
  // such as `session: "…"', because every survey answer restates the handle.
  // Prose does not begin with a lower-case word and a colon, which is what
  // makes that last test safe to apply to a model's answer as well.
  if (/^(catalog|profile|select|narrow|expand|materialize|connect|history)\b/i.test(s)) return "score";
  if (/^[({]/.test(s)) return "score";
  if (/^[a-z][\w-]*\s*:\s*\S/.test(s)) return "score";
  return "text";
}

/**
 * Split prose into alternating prose and fenced-code segments.
 *
 * This is the whole of the markdown handled, deliberately: a fenced block is
 * the one piece of structure that must not be reflowed, and everything else
 * reads perfectly well as a paragraph.  Returns [{kind:"text"|"code", lang, body}].
 */
export function fences(text) {
  const s = asText(text);
  const out = [];
  const re = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      const body = s.slice(last, m.index);
      if (body.trim()) out.push({ kind: "text", lang: "", body });
    }
    out.push({ kind: "code", lang: (m[1] || "").toLowerCase(), body: m[2] });
    last = re.lastIndex;
  }
  const tail = s.slice(last);
  if (tail.trim()) out.push({ kind: "text", lang: "", body: tail });
  // An unterminated fence is common in a truncated answer; keep it as prose
  // rather than losing it.
  return out.length ? out : (s.trim() ? [{ kind: "text", lang: "", body: s }] : []);
}

/**
 * One displayable block: the text in its best form, and the kind a renderer
 * should style it as.  JSON is re-indented, everything else is passed through.
 */
export function formatBlock(text) {
  const kind = classify(text);
  if (kind === "json") return { kind, body: clip(prettyJson(text)) };
  return { kind, body: clip(asText(text)) };
}

/** `1.2k`, `820` — token and character counts, short enough for a summary line. */
export function count(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return v < 1000 ? String(v) : `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
}

/** `256ms`, `4.3s` — durations read better at two scales. */
export function duration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return "";
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

/** What one message in a provider request amounts to, in a few words. */
function contentDigest(content) {
  if (typeof content === "string") return `${content.length} characters`;
  if (!Array.isArray(content)) return "";
  return content.map((b) => {
    if (b.type === "text") return `text ${String(b.text || "").length}c`;
    if (b.type === "tool_use") {
      const op = b.input && b.input.op ? ` ${b.input.op}` : "";
      return `tool_use ${b.name}${op}`;
    }
    if (b.type === "tool_result") {
      const t = Array.isArray(b.content) ? (b.content[0]?.text || "") : String(b.content || "");
      return `tool_result ${t.length}c${b.is_error ? " (error)" : ""}`;
    }
    return b.type || "?";
  }).join(", ");
}

/**
 * The provider request, digested.
 *
 * Shown whole it is the same five thousand characters of primer every turn,
 * with the one thing that changed buried in the middle.  The digest says what
 * varies -- which messages, carrying what -- and leaves the primer as a
 * measurement.  The whole body is still one disclosure away.
 */
export function digestRequest(body) {
  let o = body;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== "object") return null;
  const lines = [];
  if (o.model) lines.push(`model       ${o.model}`);
  if (o.max_tokens) lines.push(`max tokens  ${o.max_tokens}`);
  if (typeof o.system === "string") {
    lines.push(`system      ${o.system.length} characters`
             + " — the instructions and the server's own documentation");
  }
  if (Array.isArray(o.tools)) {
    lines.push(`tools       ${o.tools.map((t) => t.name).join(", ") || "(none offered)"}`);
  }
  if (Array.isArray(o.messages)) {
    lines.push(`messages    ${o.messages.length}`);
    for (const m of o.messages) {
      lines.push(`  ${String(m.role || "?").padEnd(10)}${contentDigest(m.content)}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

export const MARK = { ok: "✓", fail: "✗", pending: "…", note: "·" };

/**
 * The indicator line for one exchange — what you read when it is collapsed.
 *
 * It is assembled from parts rather than formatted ad hoc so that every row
 * lines up: time, side, what it was, how it went, how long, how much.
 */
export function summarize(x) {
  const bits = [];
  if (x.op) bits.push(x.op);
  if (x.http != null && x.http !== 200) bits.push(`HTTP ${x.http}`);
  if (x.stopReason) bits.push(x.stopReason);
  if (x.rows != null) bits.push(`${x.rows} row${x.rows === 1 ? "" : "s"}`);
  if (x.tokensIn != null || x.tokensOut != null) {
    bits.push(`${count(x.tokensIn)}↓ ${count(x.tokensOut)}↑`);
  }
  if (x.ms != null) bits.push(duration(x.ms));
  return bits.filter(Boolean).join(" · ");
}

/**
 * The row count a score payload reports, when it reports one.
 *
 * The survey tool answers in its own notation and states a cardinality in it;
 * reading it here keeps the number out of the body, where it would have to be
 * hunted for, and puts it in the summary line where it belongs.
 */
export function rowsIn(text) {
  const m = /\b(?:resultCount|rows|count)\s*[:=]\s*(\d+)/i.exec(asText(text));
  return m ? Number(m[1]) : null;
}

export default { asText, clip, prettyJson, classify, fences, formatBlock, count, duration,
                 summarize, rowsIn, digestRequest, MARK, CLIP };
