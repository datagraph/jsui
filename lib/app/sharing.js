/**
 * Reading a presentation somebody else wrote (U-74; D-AM).
 *
 * Every phase before this one had one account: the writer and the reader
 * were the same person, and the gates asked them about their own repository.
 * A shared presentation breaks that. The document arrives from a store, it
 * is rendered in the reader's frame, and the frame's channel reaches the
 * reader's panels, the reader's parameters and the reader's grant. So the
 * question is not "is this page well formed" — the validator already answers
 * that — but **which parts of it are text the reader's machine will execute
 * on the author's behalf**.
 *
 * There are three, and D-AM named one:
 *
 *   1. `ui:script` — the page-level script. Stated in the plan.
 *   2. a transform's `ui:body` — `new Function("inputs", "api", body)` in the
 *      frame, handed the same `api` the script gets. Not stated in the plan,
 *      and exactly as reachable.
 *   3. a `ui:Html` carrier's markup — the frame's CSP is
 *      `script-src 'unsafe-inline'`, so an inline `<script>` or an `onerror`
 *      in a blob runs like any other.
 *
 * All three are withheld from a reader who is not the author, together,
 * under one approval, against one digest of all of them. Separately
 * approving them would be three decisions about the same question, and a
 * reader who admitted the script would be surprised to find the transforms
 * still dead.
 *
 * A fourth place the same text lives, found by the tests rather than by
 * reading: `views[].html'. A view built from a tree carries a GENERATED
 * copy of its markup, and that copy is what the frame renders — so editing
 * the tree and leaving the projection alone withholds nothing at all. A view
 * that is still legacy markup has no tree to edit and IS the carrier. Both
 * are handled below, and both are in the fingerprint.
 *
 * **What is NOT withheld, and why it is safe to say so rather than guess.**
 * `ui:styles` stays. A foreign stylesheet in this frame cannot fetch: the
 * CSP is `default-src 'none'` with `img-src data:` and `font-src data:`, so
 * a `url()` reaches nothing and cannot report that the page was opened. It
 * can only make the page look wrong, inside a frame that shows nothing else.
 * Panels stay too — a foreign query runs against the READER's repository
 * with the reader's token, which is the strongest thing in the document, and
 * it is exactly what Gate 1 already exists to ask about. A second mechanism
 * for it would be a second place to get it right.
 */

import { htmlFromTree } from "./tree.js";
import { COMPONENTS } from "./toolbox/index.js";

/* ── who wrote it ─────────────────────────────────────────────────────────── */

/**
 * The author.
 *
 * `ui:creator' when the graph records one, the owning account otherwise. The
 * fallback matters: a presentation saved before `creator' was written is not
 * thereby authorless, and treating it as such would make every old page of
 * the reader's own look foreign.
 */
export function authorOf(meta, owner = null) {
  const creator = meta?.creator ? String(meta.creator).trim() : "";
  return creator || (owner == null ? null : String(owner));
}

/**
 * Is this someone else's?
 *
 * Compared case-insensitively on the account name, which is how accounts are
 * compared everywhere else. With no reader — nobody signed in — everything
 * is foreign: an anonymous reader has approved nothing, and defaulting the
 * other way would make "not signed in" the most permissive state there is.
 */
export function isForeign({ owner = null, creator = null, reader = null } = {}) {
  const author = creator || owner;
  if (!author) return true;
  if (!reader) return true;
  return String(author).trim().toLowerCase() !== String(reader).trim().toLowerCase();
}

/* ── the executable parts ─────────────────────────────────────────────────── */

/**
 * Every block of raw markup in a document, with where it is.
 *
 * Two shapes, because a document has two.  A view built from a tree carries
 * its markup in `ui:Html' elements; a view that predates the tree is one
 * markup blob with `elements: null', and that blob is the carrier itself.
 * Missing the second was the fault this suite caught: `withhold' edited the
 * tree and the frame went on rendering the view's generated `html'.
 */
export function carriersOf(document) {
  const found = [];
  const walk = (nodes, view) => {
    for (const n of nodes || []) {
      if (n.kind === "html" && String(n.html || "").trim()) {
        found.push({ view, name: n.name, bytes: String(n.html).length });
      }
      walk(n.children, view);
    }
  };
  for (const v of document?.views || []) {
    if (v.elements != null) { walk(v.elements, v.name); continue; }
    if (String(v.html || "").trim()) {
      found.push({ view: v.name, name: null, bytes: String(v.html).length });
    }
  }
  return found;
}

/**
 * What in this document is text something will execute.
 *
 * Returned as a list rather than as flags because it is what the reader is
 * shown: "a script, two transforms and one block of markup" is a sentence a
 * person can weigh, and "executable: true" is not.
 */
export function executableParts(document) {
  const parts = [];
  if (String(document?.script || "").trim()) {
    parts.push({ what: "script", where: "the page", bytes: String(document.script).length });
  }
  for (const t of document?.transforms || []) {
    if (String(t.body || "").trim()) {
      parts.push({ what: "transform", where: t.name, bytes: String(t.body).length });
    }
  }
  for (const c of carriersOf(document)) {
    parts.push({ what: "markup", where: c.name ? `${c.view}/${c.name}` : c.view, bytes: c.bytes });
  }
  return parts;
}

/* ── the digest the approval is about ─────────────────────────────────────── */

/**
 * A short, fast, NON-cryptographic digest.
 *
 * Moved here from `ui-store.js' (which re-exports it) because it belongs
 * with the thing it is about. It is written into a presentation as
 * `ui:scriptDigest' by the author's own save, where it answers "has this
 * changed since I last looked" — a change-detection aid, against no
 * adversary.
 *
 * **It must never carry a trust decision.** Sixty-four bits of FNV is
 * forgeable by anyone who wants a reader's earlier approval to cover later
 * code, and that is precisely the adversary a shared presentation has.
 * `fingerprint' below is what an approval is recorded against.
 */
export function digestOf(text) {
  const s = String(text ?? "");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2166136261);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0")) + ((h2 >>> 0).toString(16).padStart(8, "0"));
}

/** Is a digest strong enough to record an approval against? */
export function strongDigestAvailable(crypto = globalThis.crypto) {
  return Boolean(crypto && crypto.subtle && typeof crypto.subtle.digest === "function");
}

/**
 * Everything executable in this document, as one SHA-256.
 *
 * One digest over all three parts, in a fixed order, each length-prefixed so
 * that moving a byte from one part to the next cannot leave the digest
 * unchanged. Returns `null' where SubtleCrypto is unavailable — which is not
 * a detail: `crypto.subtle' needs a secure context, so an interface served
 * over plain HTTP has none, and the honest consequence is stated in
 * `screenPresentation' rather than papered over with the weak digest.
 */
export async function fingerprint(document, { crypto = globalThis.crypto } = {}) {
  if (!strongDigestAvailable(crypto)) return null;
  const parts = [];
  parts.push("script", String(document?.script ?? ""));
  for (const t of [...(document?.transforms || [])].sort((a, b) =>
                     String(a.name).localeCompare(String(b.name)))) {
    parts.push(`transform:${t.name}`, String(t.body ?? ""));
  }
  const carriers = [];
  const walk = (nodes, view) => {
    for (const n of nodes || []) {
      if (n.kind === "html") carriers.push([`${view}/${n.name}`, String(n.html ?? "")]);
      walk(n.children, view);
    }
  };
  for (const v of document?.views || []) {
    if (v.elements != null) walk(v.elements, v.name);
    else carriers.push([v.name, String(v.html ?? "")]);
  }
  carriers.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [where, markup] of carriers) parts.push(`markup:${where}`, markup);

  // Length-prefixed, so "ab" + "c" and "a" + "bc" are different inputs.
  const text = parts.map((p) => `${p.length}:${p}`).join("");
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── withholding ──────────────────────────────────────────────────────────── */

/** The markup a withheld carrier is replaced by.  Written here, so it is ours. */
export function withheldMarkup(author) {
  const who = String(author || "another account")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
                                   '"': "&quot;", "'": "&#39;" }[c]));
  return `<div class="dash-withheld" data-withheld="markup">`
       + `Markup written by ${who} is not shown until you admit it.</div>`;
}

/** The body a withheld transform is replaced by: a string literal, and nothing else. */
export function withheldBody(author) {
  return `return ${JSON.stringify(`withheld — written by ${author || "another account"}`)};`;
}

/**
 * The document with every executable part taken out.
 *
 * A copy; the caller's document is not touched. Each part is REPLACED rather
 * than removed, and the replacements are chosen so that the page still draws
 * and still says what is missing:
 *
 *   - the script simply goes, because nothing shows where it was;
 *   - a transform keeps its name and returns a sentence, so the slot that
 *     reads it says "withheld" instead of being silently empty;
 *   - a carrier keeps its element, so the tree shape — and therefore every
 *     element name a later patch addresses — is unchanged.
 *
 * Removing the transform instead would leave `data-derived' slots that
 * nothing fills, which looks like a page with nothing to say there. That is
 * the failure the frame's own "did not run" message exists to prevent, and
 * it would be a poor thing to reintroduce here.
 */
export function withhold(document, { author = null } = {}) {
  const taken = [];
  const next = JSON.parse(JSON.stringify(document || {}));
  if (String(next.script || "").trim()) {
    taken.push({ what: "script", where: "the page", bytes: String(next.script).length });
    next.script = null;
  }
  next.transforms = (next.transforms || []).map((t) => {
    if (!String(t.body || "").trim()) return t;
    taken.push({ what: "transform", where: t.name, bytes: String(t.body).length });
    return { ...t, body: withheldBody(author) };
  });
  const walk = (nodes, view) => {
    let touched = false;
    for (const n of nodes || []) {
      if (n.kind === "html" && String(n.html || "").trim()) {
        taken.push({ what: "markup", where: `${view}/${n.name}`, bytes: String(n.html).length });
        n.html = withheldMarkup(author);
        touched = true;
      }
      if (walk(n.children, view)) touched = true;
    }
    return touched;
  };
  for (const v of next.views || []) {
    if (v.elements == null) {
      if (!String(v.html || "").trim()) continue;
      taken.push({ what: "markup", where: v.name, bytes: String(v.html).length });
      v.html = withheldMarkup(author);
      continue;
    }
    // THE PROJECTION, which is what the frame actually renders.  A view
    // built from a tree carries a generated copy of its markup; editing the
    // tree and leaving that copy alone withholds nothing.  Regenerated with
    // the same function `document.js' used, so a screened document is
    // byte-identical to one the validator would have produced from this
    // tree -- anything else would make the patch classifier report changes
    // that did not happen.
    if (walk(v.elements, v.name)) {
      v.html = htmlFromTree(v.elements, { components: COMPONENTS });
    }
  }
  return { document: next, withheld: taken };
}

/* ── what the reader is told ──────────────────────────────────────────────── */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The list, as a phrase: "a script, 2 transforms and 1 block of markup". */
export function describeWithheld(withheld) {
  const counts = { script: 0, transform: 0, markup: 0 };
  for (const w of withheld || []) counts[w.what] = (counts[w.what] || 0) + 1;
  const said = [];
  if (counts.script) said.push("the page's script");
  if (counts.transform) said.push(plural(counts.transform, "transform", "transforms"));
  if (counts.markup) said.push(plural(counts.markup, "block of markup", "blocks of markup"));
  if (!said.length) return "";
  if (said.length === 1) return said[0];
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

/**
 * The mark the page carries.
 *
 * One sentence saying who wrote it, one saying what is not running, and one
 * saying what would change that — in that order, because the first is the
 * fact the reader needs to weigh the other two.
 */
export function noticeFor({ author, withheld = [], trusted = null, reason = null } = {}) {
  const who = author || "another account";
  if (reason === "no-strong-digest") {
    return `Written by ${who}. Its ${describeWithheld(withheld)} will not run here: `
         + `this page is not served over a secure connection, so the interface cannot `
         + `compute a digest an approval could safely be recorded against.`;
  }
  if (trusted) {
    return `Written by ${who}. You admitted this version`
         + `${trusted.at ? ` on ${String(trusted.at).slice(0, 10)}` : ""}, so its code is running.`;
  }
  if (!withheld.length) return `Written by ${who}. It carries no code.`;
  return `Written by ${who}. Its ${describeWithheld(withheld)} ${
    withheld.length === 1 ? "is" : "are"} not running. `
       + `Admit it only if you would run ${who}'s code yourself.`;
}

/* ── the one entry point ──────────────────────────────────────────────────── */

/**
 * Screen a presentation for the account about to read it.
 *
 * The reader's own presentation comes back untouched and unexamined — not
 * even fingerprinted — because a digest of your own page answers no question
 * and would make opening one cost a hash of every transform in it.
 *
 * A foreign one comes back withheld unless the reader has already admitted
 * **this exact fingerprint**. An admission of an earlier version does not
 * carry: that is the whole reason the approval is recorded against a digest
 * rather than against the presentation's name.
 */
export async function screenPresentation({
  document, meta = null, owner = null, reader = null, admission = null,
  crypto = globalThis.crypto,
} = {}) {
  const author = authorOf(meta, owner);
  const foreign = isForeign({ owner, creator: meta?.creator || null, reader });
  if (!foreign) {
    return { document, foreign: false, author, withheld: [], fingerprint: null,
             trusted: true, notice: null, admissible: false, reason: null };
  }
  const parts = executableParts(document);
  if (!parts.length) {
    return { document, foreign: true, author, withheld: [], fingerprint: null,
             trusted: true, notice: noticeFor({ author, withheld: [] }),
             admissible: false, reason: null };
  }
  const print = await fingerprint(document, { crypto });
  if (!print) {
    // No digest, no approval, and therefore no admission: an approval that
    // could not be tied to the code it approved would be worse than none,
    // because the reader would believe they had made a decision.
    const { document: safe, withheld } = withhold(document, { author });
    return { document: safe, foreign: true, author, withheld, fingerprint: null,
             trusted: false, admissible: false, reason: "no-strong-digest",
             notice: noticeFor({ author, withheld, reason: "no-strong-digest" }) };
  }
  if (admission && admission.fingerprint === print) {
    return { document, foreign: true, author, withheld: [], fingerprint: print,
             trusted: true, admissible: false, reason: null,
             notice: noticeFor({ author, withheld: parts, trusted: admission }) };
  }
  const { document: safe, withheld } = withhold(document, { author });
  return {
    document: safe, foreign: true, author, withheld, fingerprint: print,
    trusted: false, admissible: true,
    reason: admission ? "changed-since-admitted" : null,
    notice: admission
      ? `Written by ${author}. It has CHANGED since you admitted it, so its `
      + `${describeWithheld(withheld)} ${withheld.length === 1 ? "is" : "are"} not running again.`
      : noticeFor({ author, withheld }),
  };
}

export default screenPresentation;
