/**
 * What a typed prompt is about, and which repositories it carries (§34.2).
 *
 * The location bar is the instruction channel for everything (D-AU), and
 * until now everything it could not decide without a model was sent to the
 * model as an instruction about the INTERFACE: with `allowTools: []' and no
 * MCP endpoint at all.  So a question about data could not be asked there,
 * for one repository or for six.  The pane could ask about data and knew
 * exactly one repository, its own.  Between them, a question that crosses two
 * repositories had nowhere to be typed.
 *
 * This module is the decision that makes the bar take both, and it is made
 * WITHOUT a model, because the bar's grammar is load-bearing (`instructions.js'):
 * reading an instruction as a question costs a turn, and reading a question as
 * an instruction edits the page instead of answering.
 *
 * The rule, stated plainly so that it can be taught in one line:
 *
 *     A prompt that NAMES a repository is about data.  Anything else is about
 *     the interface, as before.
 *
 * Naming one has three spellings, all of them things the user can see on the
 * screen already: `account/repository'; a URL of either form the interface
 * links to; or a bare repository name after one of a few citation words --
 * *in sales*, *from bob/parts*, *across sales and orders*.  A bare word on its
 * own is never a citation: every repository name is also an ordinary English
 * word for somebody, and "make the orders column wider" is not a question
 * about `orders'.
 *
 * What this deliberately does NOT do is guess.  "How many open orders are
 * there?" typed with no repository named is an instruction about the
 * interface, and will be answered as one.  The alternative is a classifier --
 * a model call before the model call -- which costs a turn on every line
 * typed and is wrong in a way the user cannot predict.  Naming the store you
 * mean is one word, and it is the same word that routes the call (§34.3).
 *
 * The repositories CARRIED by a turn are a second question, answered by
 * `contextFor': what was cited, or -- where nothing was -- the repository of
 * whatever the bar is addressing (REQ-34.2.3).  The workspace addresses no
 * repository, so a turn against it carries none and says so rather than
 * choosing one.
 */

import { resolveRepository, repositoryRefusal } from "./repositories.js";

/**
 * The words that make a following bare name a citation.
 *
 * Short and closed on purpose.  Every entry is a word that takes a place as
 * its object, which is why none of them is a verb the interface also uses:
 * `apply', `mount' and `lift' are the bar's own and are decided before this
 * module is reached.
 */
export const CITATION_CUES = Object.freeze([
  "in", "into", "from", "against", "across", "on", "over", "within", "about", "of",
]);

const CUE = new Set(CITATION_CUES);

/** `a/b' anywhere in a line, as a whole token. */
const QUALIFIED = /(^|[\s(,;"'`])([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=$|[\s),;.!?"'`])/g;
const URLS = /\bhttps?:\/\/[^\s<>"')]+/gi;
// A pasted interface link is as often a path as a URL — the address bar shows
// `/ui/account/bob/repositories/parts' and that is what lands in the prompt.
const PATHS = /(?:^|\s)(\/[A-Za-z0-9_\-./%]*\/repositories\/[A-Za-z0-9_\-.%]+[A-Za-z0-9_\-./%]*)/g;
const WORD = /[A-Za-z0-9][A-Za-z0-9_-]*/g;

/**
 * The account and repository a URL points at, by either spelling.
 *
 * The interface's own links read `/account/{a}/repositories/{r}[/views/{v}]';
 * the service's read `{host}/{a}/{r}[/sparql]'.  Both are shown to the user
 * in the page they are working in, so both are things they will paste.
 */
export function repositoryFromUrl(url) {
  let path = String(url || "").trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch { /* a malformed URL is read as a path */ }
  const parts = path.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const at = parts.indexOf("account");
  if (at >= 0 && parts[at + 1] && parts[at + 2] === "repositories" && parts[at + 3]) {
    return { account: parts[at + 1], repository: parts[at + 3], id: `${parts[at + 1]}/${parts[at + 3]}` };
  }
  // The service form.  `ui' is the interface's own prefix and is never an
  // account; `system' is the service's own tree and names no repository.
  const rest = parts[0] === "ui" ? parts.slice(1) : parts;
  if (rest.length >= 2 && rest[0] !== "system" && rest[0] !== "account") {
    return { account: rest[0], repository: rest[1], id: `${rest[0]}/${rest[1]}` };
  }
  return null;
}

const push = (into, entry) => {
  if (!into.some((e) => e.id === entry.id)) into.push(entry);
};

/**
 * Every repository a line cites, resolved against the permitted set.
 *
 * Returns what resolved and what did not.  An unresolved QUALIFIED name or
 * URL is reported -- it was unmistakably meant as a repository and is not one
 * this account may read (REQ-34.2.6) -- while an unresolved bare word after a
 * cue is not reported at all, because *in the usual way* cites nothing.
 */
export function citations(text, permitted = []) {
  const line = String(text || "");
  const named = [], unknown = [];
  // Where in the line each was cited, so that the order the user wrote them in
  // is the order they are offered, routed and disclosed in.
  const claim = (raw, how, at) => {
    const found = resolveRepository(raw, permitted);
    if (found.ok) push(named, { ...found.repository, citedAt: at, citedAs: how });
    else if (how !== "bare") unknown.push({ text: raw, how, at, why: repositoryRefusal(found) });
    return found.ok;
  };

  for (const m of line.matchAll(URLS)) {
    const seen = repositoryFromUrl(m[0]);
    if (seen) claim(seen.id, "url", m.index);
  }
  for (const m of line.matchAll(PATHS)) {
    const seen = repositoryFromUrl(m[1]);
    if (seen) claim(seen.id, "url", m.index);
  }
  for (const m of line.matchAll(QUALIFIED)) claim(`${m[2]}/${m[3]}`, "qualified", m.index);

  // Bare names, each introduced by a cue and continued by `and' or a comma:
  // *across sales, orders and bob/parts*.
  const words = [...line.matchAll(WORD)].map((m) => ({ word: m[0], at: m.index }));
  let open = false;
  for (let i = 0; i < words.length; i += 1) {
    const { word, at } = words[i];
    const lower = word.toLowerCase();
    if (CUE.has(lower)) { open = true; continue; }
    if (open) {
      const took = claim(word, "bare", at);
      // `and' and `,' keep the list open; anything else closes it, so that a
      // cue cannot reach across a whole sentence.
      const after = line.slice(at + word.length, at + word.length + 6);
      open = took && /^\s*(,|and\b)/i.test(after);
      continue;
    }
  }
  named.sort((a, b) => a.citedAt - b.citedAt);
  unknown.sort((a, b) => a.at - b.at);
  return { named, unknown };
}

/* ── what the turn is, and what it carries ────────────────────────────────── */

/**
 * Interface or data, and the repositories either way.
 *
 * `address' is what the bar is pointed at: `{kind, repository}' where a pane
 * knows its own, and `{kind: "workspace"}' for the chrome, which knows none.
 * `always' is for a surface that is a data prompt by construction -- an
 * exploration pane's box is not ambiguous and should not be parsed as though
 * it were.
 */
export function classifyPrompt(text, { permitted = [], address = null, always = null } = {}) {
  const cited = citations(text, permitted);
  const addressed = address && address.repository
    ? resolveRepository(address.repository, permitted)
    : { ok: false };
  const fallback = addressed.ok ? [addressed.repository] : [];
  const asked = always || (cited.named.length ? "data" : "interface");
  const repositories = cited.named.length ? cited.named : (asked === "data" ? fallback : []);
  // A name that was unmistakably meant as a repository and is not one this
  // account may read refuses the whole line, whatever else it named.  Running
  // the part that resolved would answer a question nobody asked -- about one
  // store, when two were named -- and the answer would not say so.
  const kind = cited.unknown.length ? "refusal" : asked;
  return {
    kind, asked, ok: cited.unknown.length === 0,
    repositories,
    cited: cited.named,
    unknown: cited.unknown,
    // A data turn with nothing to read is not a turn: say which it is.
    empty: asked === "data" && repositories.length === 0,
    text: String(text || ""),
  };
}

/**
 * The refusal for a prompt that names a repository this account may not read.
 *
 * One sentence per unreadable name, because two wrong names are two separate
 * things to fix and a reader given one of them will fix one and try again.
 */
export function contextRefusal(reading) {
  const bad = (reading && reading.unknown) || [];
  if (!bad.length) return null;
  return bad.map((u) => u.why).join("; ");
}

/**
 * What the user is told the turn will read, before it runs (REQ-34.2.5).
 *
 * The disclosure a pane makes names the requests; this names the stores, and
 * it is a separate sentence because a turn that may reach two repositories
 * authorises more than one that reaches one, whatever the requests say.
 */
export function describeContext(repositories = []) {
  if (!repositories.length) return "no repository — this turn cannot read data";
  const ids = repositories.map((r) => r.id);
  return ids.length === 1
    ? `reads ${ids[0]}`
    : `reads ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]} — ${ids.length} repositories`;
}

export default classifyPrompt;
