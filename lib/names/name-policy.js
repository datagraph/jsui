/**
 * What may be typed into a name, and what becomes of it.
 *
 * A name entered here becomes a path segment: <account>/<repository>, and a
 * view under that.  Every later reading of it -- a URL, a SPARQL service
 * description, a score operation naming a view, the session record -- assumes
 * it is one token.  A quote, a comma, a backslash or a space inside it does not
 * fail at the point of entry; it fails later, somewhere that cannot say what
 * went wrong.  So the control takes the name in hand as it is typed.
 *
 * Two separate jobs, deliberately kept apart:
 *
 *   sanitize  one character at a time, as it is typed.  Anything outside
 *             [A-Za-z0-9_-] becomes the separator.  Strictly one for one, so
 *             the caret never moves under the typist's hands -- a field that
 *             reflows while you type is worse than one that lets a comma
 *             through.  Runs are collapsed and the ends trimmed on the way
 *             out, not on the way in: trimming a trailing separator as it is
 *             typed makes `a-b' impossible to type.
 *
 *   check     the whole name, once it is proposed.  Length, emptiness, the
 *             reserved lists and the offensive list.  This is a refusal, not a
 *             correction: a name that is reserved has no mechanical repair, and
 *             guessing one would be presumptuous.
 *
 * The lists are configuration.  They live in config/names/ as plain text, one
 * term per line, and are read at run time -- they are adopted from the rails
 * service, which refuses the same names, and a deployment that needs a
 * different list edits the file rather than this module.  See that directory
 * for how each list is matched.
 */

const WORD = /[A-Za-z0-9_-]/;

/** The characters most worth naming, because they are the ones people type. */
export const INTERFERING = `'.,"\\ `;

export const DEFAULT_LIMITS = {
  separator: "-",
  kinds: {
    account:    { min: 1, max: 255, reserved: "accounts.txt" },
    repository: { min: 1, max: 255, reserved: "repositories.txt" },
    view:       { min: 1, max: 255, reserved: "views.txt" },
  },
  offensive: "offensive.txt",
};

/**
 * One character at a time, nothing moved.
 *
 * `collapse' is for the way out -- blur, or submit -- where runs become one
 * separator and the ends lose theirs.  While typing it stays false.
 */
export function sanitize(text, { separator = "-", collapse = false } = {}) {
  const sep = separator === "_" ? "_" : "-";
  let out = "";
  for (const ch of String(text ?? "")) out += WORD.test(ch) ? ch : sep;
  if (!collapse) return out;
  const esc = sep === "-" ? "\\-" : "_";
  return out.replace(new RegExp(`[${esc}]{2,}`, "g"), sep)
            .replace(new RegExp(`^[${esc}]+|[${esc}]+$`, "g"), "");
}

/** True when sanitising would change the text -- i.e. something was excluded. */
export function needsSanitizing(text, options) {
  return sanitize(text, options) !== String(text ?? "");
}

/** One list file: a term per line, '#' comments, blanks ignored. */
export function parseList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.toLowerCase());
}

/**
 * The segments a name is matched by: the whole thing, and each piece between
 * separators.  `catalog-fuckery' is caught by its second segment; `assistant'
 * is one segment and is caught by nothing, which is the point.
 */
export function segmentsOf(name) {
  const slug = sanitize(name, { collapse: true }).toLowerCase();
  return { slug, parts: slug.split(/[-_]+/).filter(Boolean) };
}

/** Whether a name trips the offensive list, and on which term. */
export function offensiveTerm(name, terms) {
  const { slug, parts } = segmentsOf(name);
  for (const term of terms) {
    if (!term) continue;
    if (slug === term) return term;
    // a segment that begins with the term, so inflections need not be listed
    if (parts.some((p) => p === term || p.startsWith(term))) return term;
  }
  return null;
}

/**
 * A policy over the loaded lists.  `check' answers with a reason a caller can
 * branch on and a message it can show unchanged.
 */
export function makePolicy({ limits = DEFAULT_LIMITS, reserved = {}, offensive = [] } = {}) {
  const sep = limits.separator === "_" ? "_" : "-";

  function check(raw, kind = "repository") {
    const spec = limits.kinds?.[kind] || DEFAULT_LIMITS.kinds[kind] || { min: 1, max: 255 };
    const text = String(raw ?? "");
    const clean = sanitize(text, { separator: sep, collapse: true });
    const lower = clean.toLowerCase();

    if (!clean) {
      return { ok: false, reason: "empty", name: clean,
               message: `A ${kind} name needs at least one letter or digit.` };
    }
    if (clean.length < (spec.min ?? 1)) {
      return { ok: false, reason: "short", name: clean,
               message: `A ${kind} name must be at least ${spec.min} characters.` };
    }
    if (clean.length > (spec.max ?? 255)) {
      return { ok: false, reason: "long", name: clean, limit: spec.max,
               message: `A ${kind} name may be at most ${spec.max} characters; `
                      + `this one is ${clean.length}.` };
    }
    const list = reserved[kind] || [];
    if (list.includes(lower)) {
      return { ok: false, reason: "reserved", name: clean, term: lower,
               message: `"${clean}" is reserved: the service uses that name itself. `
                      + `Please choose another.` };
    }
    const term = offensiveTerm(clean, offensive);
    if (term) {
      return { ok: false, reason: "offensive", name: clean, term,
               message: `"${clean}" is not an acceptable ${kind} name.` };
    }
    // The name is usable; whether it is *as typed* is a separate question the
    // caller may want to mention.
    return { ok: true, name: clean, changed: clean !== text.trim() };
  }

  return { check, limits, reserved, offensive, separator: sep,
           sanitize: (t, o) => sanitize(t, { separator: sep, ...o }) };
}

/* ── loading the configuration ───────────────────────────────────────────── */

let loaded = null;        // the policy, once read
let loading = null;       // the read in flight, so concurrent callers share it

/**
 * Read config/names/ and build the policy.
 *
 * A list that cannot be read is an empty list, not a failure: a name control
 * that refuses to work because a text file 404ed would be a worse outcome than
 * one that lets `admin' through, and the service refuses that name anyway.
 * What is never skipped is the sanitising, which needs no configuration.
 */
export async function loadNamePolicy({ basePath = "", fetchImpl, force = false } = {}) {
  if (loaded && !force) return loaded;
  if (loading && !force) return loading;
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const dir = `${String(basePath).replace(/\/$/, "")}/config/names`;

  const read = async (file) => {
    try {
      const res = await doFetch(`${dir}/${file}`);
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  };

  loading = (async () => {
    let limits = DEFAULT_LIMITS;
    const limitsText = await read("limits.json");
    if (limitsText) {
      try {
        const parsed = JSON.parse(limitsText);
        limits = { ...DEFAULT_LIMITS, ...parsed,
                   kinds: { ...DEFAULT_LIMITS.kinds, ...(parsed.kinds || {}) } };
      } catch { /* a malformed limits file leaves the defaults standing */ }
    }
    const reserved = {};
    for (const [kind, spec] of Object.entries(limits.kinds)) {
      reserved[kind] = parseList(await read(spec.reserved || `${kind}s.txt`));
    }
    const offensive = parseList(await read(limits.offensive || "offensive.txt"));
    loaded = makePolicy({ limits, reserved, offensive });
    loading = null;
    return loaded;
  })();
  return loading;
}

/** The policy as loaded, or one that sanitises and checks lengths only. */
export function namePolicy() {
  return loaded || makePolicy();
}

/** For tests, and for a deployment that swaps the lists at run time. */
export function setNamePolicy(policy) { loaded = policy; loading = null; return loaded; }

export default { sanitize, loadNamePolicy, namePolicy, makePolicy, parseList };
