/**
 * What a line typed into the location bar means (U-76, U-77; D-AU).
 *
 * The bar is the one affordance that is always on the screen, so it is where
 * arrangement instructions go.  That makes its grammar load-bearing in a way
 * a prompt box's is not: the same control navigates, re-addresses and asks a
 * model for a change, and reading one as another is not symmetric.  Sending
 * `/account/alice' to a model wastes a turn.  Reading "add a panel for the
 * open orders" as a path produces a 404 and loses the sentence.
 *
 * So the grammar is tiny and decidable without a model:
 *
 *   goto <path>        navigate            — the preface, stated
 *   <path>             navigate            — what the bar does today, kept
 *   goto <name>        re-address          — change what an instruction acts on
 *   anything else      instruct            — against the address shown
 *
 * `goto' before a path is redundant and allowed, because the alternative is
 * sending a path to a model when the user forgot a keyword, and that is the
 * worse surprise of the two.
 *
 * Nothing here touches the DOM, the router or a provider: this module decides
 * what a line MEANS, and the bar decides what to do about it.  That is what
 * makes the decision testable without a browser, and the decision is the part
 * that is easy to get wrong.
 */

/** The word that marks navigation.  One word, lower case, not configurable. */
export const NAVIGATION_PREFACE = "goto";

/** The target kinds an address can have. */
export const TARGET_KINDS = Object.freeze(["workspace", "presentation"]);

/**
 * Is this text a location rather than a sentence?
 *
 * Deliberately narrow.  A path starts with `/', a URL with a scheme, and a
 * query or fragment with its own punctuation; everything else is prose, even
 * when it contains a slash ("put the chart beside the table 2/3 of the way
 * across" is not a path).  A bare word is NOT a path: `goto workspace' has to
 * reach the address resolver, or the one target that is not a page would be
 * unreachable.
 */
export function pathLike(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/^[/?#]/.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\.{1,2}(\/|$)/.test(s)) return true;
  return false;
}

/** A URL or a path, reduced to what the router takes. */
export function pathOf(text) {
  const s = String(text || "").trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return `${u.pathname}${u.search}${u.hash}` || "/";
    } catch { return s; }
  }
  return s;
}

/* ── the address ──────────────────────────────────────────────────────────── */

/**
 * One addressable thing: the workspace, or a presentation on the screen.
 *
 * `id' is what the bar stores and what `goto' matches first; `label' is what
 * it shows and what a user is likely to type.  `instruct' is how the target
 * takes an instruction, which is the whole reason the registry exists: the
 * bar does not know what a dashboard pane is, and the pane does not know
 * there is a bar.
 *
 * `arrange' is the second channel (U-85).  It is carried here rather than
 * folded into `instruct' because the two are asked of different things: an
 * instruction is read by a model, an arrangement verb is exact.  A target
 * that offers one and not the other is ordinary -- the chrome mounts and
 * cannot be lifted from, a pane is lifted from and does not mount -- so each
 * is optional and each absence is reported in its own words.
 */
export function target(fields = {}) {
  const f = fields || {};
  const kind = TARGET_KINDS.includes(f.kind) ? f.kind : "presentation";
  return {
    id: String(f.id || ""),
    label: String(f.label || f.id || ""),
    kind,
    presentation: f.presentation == null ? null : String(f.presentation),
    instruct: typeof f.instruct === "function" ? f.instruct : null,
    arrange: typeof f.arrange === "function" ? f.arrange : null,
    outline: typeof f.outline === "function" ? f.outline : null,
    document: typeof f.document === "function" ? f.document : null,
  };
}

const fold = (s) => String(s || "").trim().toLowerCase();

/**
 * Which target a name refers to.
 *
 * Exact before prefix before substring, and an ambiguous match is a refusal
 * rather than a guess: re-addressing silently to the wrong analysis makes the
 * NEXT instruction act on something the user did not mean, and that one may
 * not be presentational.
 */
export function resolveTarget(name, targets = []) {
  const want = fold(name);
  const all = (targets || []).filter(Boolean);
  if (!want) return { ok: false, reason: "no target named", candidates: all };
  const by = (test) => all.filter(test);
  const exact = by((t) => fold(t.id) === want || fold(t.label) === want);
  if (exact.length === 1) return { ok: true, target: exact[0], how: "exact" };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };
  const prefix = by((t) => fold(t.id).startsWith(want) || fold(t.label).startsWith(want));
  if (prefix.length === 1) return { ok: true, target: prefix[0], how: "prefix" };
  if (prefix.length > 1) return { ok: false, reason: "ambiguous", candidates: prefix };
  const inside = by((t) => fold(t.id).includes(want) || fold(t.label).includes(want));
  if (inside.length === 1) return { ok: true, target: inside[0], how: "substring" };
  if (inside.length > 1) return { ok: false, reason: "ambiguous", candidates: inside };
  return { ok: false, reason: "unknown", candidates: all };
}

/** What the bar prints as the thing an instruction would act on. */
export function describeTarget(t) {
  if (!t) return "nothing";
  if (t.kind === "workspace") return `${t.label} (the arrangement)`;
  return t.label;
}

/** The sentence a refusal to re-address should carry. */
export function addressRefusal(result, name) {
  const named = (result.candidates || []).map((t) => t.label).filter(Boolean);
  if (result.reason === "ambiguous") {
    return `\`${name}' names more than one thing: ${named.join(", ")}`;
  }
  return named.length
    ? `there is nothing addressed as \`${name}' — try ${named.join(", ")}`
    : `there is nothing addressed as \`${name}', and nothing else is open`;
}

/* ── the grammar ──────────────────────────────────────────────────────────── */

/**
 * Read one typed line.
 *
 * With `targets' supplied, `goto <name>' resolves here and comes back as an
 * `address' or a `refusal'; without them it comes back as `address' with the
 * name unresolved, which is what the parser tests want and what a caller
 * holding its own registry can finish.
 */
export function parseInstruction(line, { targets = null } = {}) {
  const raw = String(line == null ? "" : line);
  const text = raw.trim();
  if (!text) return { kind: "empty", text: "" };

  const prefaced = /^goto\b\s*/i.exec(text);
  if (prefaced) {
    const rest = text.slice(prefaced[0].length).trim();
    if (!rest) {
      return { kind: "refusal", text,
               reason: "`goto' needs somewhere to go — a path, or the name of what is open" };
    }
    if (pathLike(rest)) return { kind: "navigate", path: pathOf(rest), preface: "goto", text };
    if (!targets) return { kind: "address", name: rest, target: null, text };
    const found = resolveTarget(rest, targets);
    if (found.ok) return { kind: "address", name: rest, target: found.target, text };
    return { kind: "refusal", text, reason: addressRefusal(found, rest), candidates: found.candidates };
  }

  if (pathLike(text)) return { kind: "navigate", path: pathOf(text), preface: null, text };
  const arranged = parseArrangement(text);
  if (arranged) return arranged;
  return { kind: "instruct", text };
}

/* ── arrangements on the same channel (U-85) ──────────────────────────────── */

const ARRANGEMENT_NAME = "[A-Za-z][A-Za-z0-9_-]{0,63}";
const ANCHOR = "[a-z][a-z0-9-]{1,63}";

const FORMS = [
  // lift <presentation>#<anchor> as <name>
  { verb: "lift",
    re: new RegExp(`^lift\\s+(${ARRANGEMENT_NAME})#(?:\\/\\/\\*\\[@data-ui='(${ANCHOR})'\\]|(${ANCHOR}))`
                 + `\\s+as\\s+(${ARRANGEMENT_NAME})$`, "i"),
    read: (m) => ({ presentation: m[1], element: m[2] || m[3], as: m[4] }) },
  // apply <name> [to|into <element>]
  { verb: "apply",
    re: new RegExp(`^apply\\s+(${ARRANGEMENT_NAME})(?:\\s+(?:in|into|to)\\s+(${ANCHOR}))?$`, "i"),
    read: (m) => ({ arrangement: m[1], into: m[2] || null }) },
  // mount <presentation> [in|into <element>]
  { verb: "mount",
    re: new RegExp(`^mount\\s+(${ARRANGEMENT_NAME})(?:\\s+(?:in|into)\\s+(${ANCHOR}))?$`, "i"),
    read: (m) => ({ presentation: m[1], into: m[2] || null }) },
  // unmount <element>
  { verb: "unmount",
    re: new RegExp(`^unmount\\s+(${ANCHOR})$`, "i"),
    read: (m) => ({ element: m[1] }) },
];

/**
 * Is this line one of the four arrangement verbs?
 *
 * Whole-string matches only, and every name checked against the shape it has
 * to have.  The bar is the instruction channel for EVERYTHING (D-AU), so a
 * verb claimed here is a sentence taken away from the model: `mount the chart
 * beside the table' has to stay prose, and it does, because the text after
 * the name is not consumed.  The cost of being wrong in the other direction
 * is a refusal the user can read, which is why the grammar is strict rather
 * than forgiving.
 */
export function parseArrangement(text) {
  const s = String(text || "").trim();
  for (const form of FORMS) {
    const m = form.re.exec(s);
    if (m) return { kind: "arrangement", verb: form.verb, ...form.read(m), text: s };
  }
  return null;
}

export default parseInstruction;
