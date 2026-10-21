/**
 * Patches: how the second prompt changes the first prompt's page.
 *
 * Implements D-V, D-W and §6 of `ui-generator.md'; work items U-29, U-30 and
 * the comparison half of U-31.
 *
 * The reason a follow-up answers with operations rather than with a new page
 * is not elegance, and it is worth stating where the code is, because the
 * elegant reading suggests a different design.  A page large enough to be
 * worth iterating on is a page too large to re-emit every turn: the output
 * ceiling is real, a fenced block that reaches it never closes, and a block
 * that never closes cannot be parsed, so the whole exploration is lost at the
 * last step.  A patch turn is bounded by the size of the change, which is what
 * a user's follow-up actually is.  Everything else patches buy -- the diff is
 * what the user reviews, the unchanged panels need not re-run, the page keeps
 * an identity across revisions -- is a second reason, not the first one.
 *
 * Two rules keep the protocol honest, and both are in `applyPatch':
 *
 *   1. A patch is applied to a COPY and the RESULT is validated, never the
 *      patch alone.  A patch is only meaningful against what it lands on: an
 *      operation that removes a panel is fine until a transform reads it.
 *   2. A patch that does not validate is refused WHOLE.  Half a patch is a
 *      page in a state no prompt asked for, and the failure mode of a partial
 *      apply is a document whose history no longer explains it.
 *
 * And one rule keeps the consent honest, which is `classify'.  If every
 * follow-up re-opened Gate 1 in full the gate would become the dialog users
 * learn to dismiss -- the argument that produced D-O -- and if none did, a
 * prompt could quietly widen what runs against the store.  So the class is
 * computed by comparing the normalised document BEFORE with the normalised
 * document AFTER, never by trusting the operation names, and anything it
 * cannot account for is treated as the stricter class.  A misclassification
 * that calls a data change presentational is a consent bug, not a cosmetic
 * one, which is why the default leans the way it does.
 */

import {
  canonical, liftLegacy, validateApplication, MAIN_VIEW,
} from "./document.js";

/** Every operation the protocol knows.  Anything else is refused. */
export const OPERATIONS = [
  "set-title", "set-panel", "remove-panel", "set-transform", "remove-transform",
  "set-assertion", "remove-assertion", "set-parameter", "remove-parameter",
  "set-view", "remove-view", "set-slot", "append-slot", "set-styles", "set-script",
  "use", "set-state",
];

/**
 * Operations that ask for authority rather than for a change.
 *
 * None of them is applied.  They are recognised so that a model which asks for
 * a wider grant inside a patch gets Gate 0 and a reason, rather than an
 * "unknown operation" that reads as a malformed answer.
 */
export const AUTHORITY_OPERATIONS = ["set-grant", "set-repository", "set-budget", "set-writable"];

/** The classes, weakest first.  `max' over a patch's changes picks the gate. */
export const CLASSES = ["presentational", "computational", "data", "authority"];

/** Which gate each class opens (D-W). */
export const GATE_FOR = {
  presentational: "none",
  computational: "gate1-lite",
  data: "gate1",
  authority: "gate0",
};

const stronger = (a, b) => (CLASSES.indexOf(a) >= CLASSES.indexOf(b) ? a : b);

/* ── reading the model's answer ───────────────────────────────────────────── */

/** The fenced block a follow-up turn answers in: a JSON array of operations. */
export function patchFrom(text) {
  const s = String(text || "");
  const fenced = s.match(/```(?:patch|json)\s*\n([\s\S]*?)```/i);
  if (!fenced) return null;
  try {
    const parsed = JSON.parse(fenced[1]);
    if (Array.isArray(parsed)) return parsed.every((o) => o && typeof o === "object") ? parsed : null;
    // A single operation written without its brackets is a shape a model
    // reaches for often enough to be worth accepting rather than refusing a
    // whole turn over.
    if (parsed && typeof parsed === "object" && typeof parsed.op === "string") return [parsed];
    return null;
  } catch {
    return null;
  }
}

/* ── addressing one element inside a view's markup ────────────────────────── */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
                      "link", "meta", "param", "source", "track", "wbr"]);

/**
 * One attribute's value out of a tag's attribute text.
 *
 * Walked pair by pair rather than matched by one regular expression, because
 * `<div data-note="id=\'q\'" id="r">' has two things in it that look like an
 * id attribute and only one that is one.  A scan that found the first would
 * address the wrong element, which is the single worst thing this module can
 * do: `set-slot' would silently replace a card the prompt never mentioned.
 */
export function attributeNamed(attrs, name) {
  const s = String(attrs || "");
  const want = String(name).toLowerCase();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s/]/.test(s[i])) i += 1;
    const from = i;
    while (i < s.length && !/[\s=/>]/.test(s[i])) i += 1;
    const key = s.slice(from, i).toLowerCase();
    while (i < s.length && /\s/.test(s[i])) i += 1;
    let value = "";
    if (s[i] === "=") {
      i += 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        value = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
        i = close < 0 ? s.length : close + 1;
      } else {
        const start = i;
        while (i < s.length && !/[\s>]/.test(s[i])) i += 1;
        value = s.slice(start, i);
      }
    }
    if (key === want) return value;
    if (!key && i === from) i += 1;                // never stall on junk
  }
  return null;
}

/**
 * Where the element with this id begins and ends in a string of HTML.
 *
 * `set-slot' is the operation that earns the protocol -- it lets a model change
 * one card in a page of thirty without re-emitting the other twenty-nine --
 * and out here there is no DOM to do it with: the document is text until the
 * frame parses it.  So this is a scanner, and it is deliberately narrow.  It
 * finds the open tag that carries the id, reads to the end of that tag
 * honouring quoted attribute values, and then walks forward counting opens and
 * closes OF THE SAME TAG NAME until the depth returns to zero.
 *
 * What it does not do: understand optional end tags, parse comments
 * containing markup, or notice a `</div>' inside a script string.  A region
 * the model means to address later is a sectioning element with an id, and
 * for that case this is exact.  Anything it cannot find returns null, and the
 * caller refuses the operation rather than guessing -- which is the right
 * failure, because the alternative is silently replacing the wrong card.
 */
export function findElementById(html, id) {
  const s = String(html || "");
  const want = String(id);
  const open = /<([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = open.exec(s))) {
    const [whole, name, attrs] = m;
    if (attributeNamed(attrs, "id") !== want) continue;
    const start = m.index;
    const afterOpen = m.index + whole.length;
    if (attrs.trimEnd().endsWith("/") || VOID.has(name.toLowerCase())) {
      return { start, end: afterOpen, name, openEnd: afterOpen, inner: [afterOpen, afterOpen] };
    }
    const tag = new RegExp(`<(/?)${name}\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "gi");
    tag.lastIndex = afterOpen;
    let depth = 1, t;
    while ((t = tag.exec(s))) {
      if (t[1] === "/") {
        depth -= 1;
        if (depth === 0) {
          return { start, end: t.index + t[0].length, name, openEnd: afterOpen,
                   inner: [afterOpen, t.index] };
        }
      } else if (!(t[2] || "").trimEnd().endsWith("/")) {
        depth += 1;
      }
    }
    return null;                                   // opened and never closed
  }
  return null;
}

/** Replace the element with this id.  Returns null when there is no such id. */
export function replaceElementById(html, id, replacement) {
  const at = findElementById(html, id);
  if (!at) return null;
  return String(html).slice(0, at.start) + String(replacement) + String(html).slice(at.end);
}

/** Append inside the element with this id, or at the end when no id is given. */
export function appendIntoElement(html, id, addition) {
  if (!id) return String(html || "") + String(addition);
  const at = findElementById(html, id);
  if (!at) return null;
  const s = String(html);
  return s.slice(0, at.inner[1]) + String(addition) + s.slice(at.inner[1]);
}

/* ── applying ─────────────────────────────────────────────────────────────── */

const byName = (listing, name) => listing.findIndex((x) => (x.name ?? x.id) === name);

function upsert(listing, name, value, keyName = "name") {
  const at = byName(listing, name);
  const entry = { ...(at >= 0 ? listing[at] : {}), ...value, [keyName]: name };
  if (at >= 0) listing[at] = entry; else listing.push(entry);
}

/**
 * Apply a patch and validate what it produced.
 *
 * Returns {ok, document, errors, warnings, classification, applied, size}.
 * On failure, `document' is the UNCHANGED input: the caller can keep showing
 * the page it has while it reports why the change was refused.
 */
export function applyPatch(current, ops, options = {}) {
  const before = liftLegacy(current && typeof current === "object" ? current : {});
  const errors = [];
  const operations = Array.isArray(ops) ? ops : [];
  if (!operations.length) {
    return { ok: false, document: before, errors: ["the patch is empty"], warnings: [],
             classification: null, applied: [] };
  }

  // A deep copy, because every operation below mutates and a refused patch
  // must leave the caller's document exactly as it was.
  const next = JSON.parse(JSON.stringify(before));
  next.panels = [].concat(next.panels || []);
  next.transforms = [].concat(next.transforms || []);
  next.assertions = [].concat(next.assertions || []);
  next.parameters = [].concat(next.parameters || []);
  next.views = [].concat(next.views || []);
  next.uses = [].concat(next.uses || []);
  if (!next.views.length) next.views = [{ name: MAIN_VIEW, title: null, html: "" }];

  const viewFor = (op) => {
    const name = op.view ? String(op.view) : (next.views.length === 1 ? next.views[0].name : null);
    if (!name) {
      errors.push(`\`${op.op}' must name a view: this document has `
                + `${next.views.length} of them`);
      return null;
    }
    const v = next.views.find((x) => x.name === name);
    if (!v) { errors.push(`\`${op.op}' names view \`${name}', which does not exist`); return null; }
    return v;
  };
  const drop = (listing, name) => {
    const at = byName(listing, name);
    if (at < 0) return false;
    listing.splice(at, 1);
    return true;
  };

  const applied = [];
  for (const op of operations) {
    const kind = String(op?.op || "");
    if (AUTHORITY_OPERATIONS.includes(kind)) {
      errors.push(`\`${kind}' asks for authority, which a patch cannot grant; `
                + `it is a proposal for Gate 0, not an operation`);
      continue;
    }
    if (!OPERATIONS.includes(kind)) {
      errors.push(`unknown operation \`${kind || "(none)"}'`);
      continue;
    }
    switch (kind) {
      case "set-title":
        next.title = String(op.value ?? op.title ?? "");
        break;
      case "set-panel":
        if (!op.name) { errors.push("`set-panel' names no panel"); break; }
        upsert(next.panels, String(op.name), op.value && typeof op.value === "object" ? op.value : {});
        break;
      case "remove-panel":
        if (!drop(next.panels, String(op.name))) {
          errors.push(`\`remove-panel' names \`${op.name}', which is not a panel`);
        }
        break;
      case "set-transform":
        if (!op.name) { errors.push("`set-transform' names no transform"); break; }
        upsert(next.transforms, String(op.name), op.value && typeof op.value === "object" ? op.value : {});
        break;
      case "remove-transform":
        if (!drop(next.transforms, String(op.name))) {
          errors.push(`\`remove-transform' names \`${op.name}', which is not a transform`);
        }
        break;
      case "set-assertion":
        if (!(op.name || op.id)) { errors.push("`set-assertion' names no assertion"); break; }
        upsert(next.assertions, String(op.name || op.id),
               op.value && typeof op.value === "object" ? op.value : {}, "id");
        break;
      case "remove-assertion":
        if (!drop(next.assertions, String(op.name || op.id))) {
          errors.push(`\`remove-assertion' names \`${op.name || op.id}', which is not an assertion`);
        }
        break;
      case "set-parameter":
        if (!op.name) { errors.push("`set-parameter' names no parameter"); break; }
        upsert(next.parameters, String(op.name), op.value && typeof op.value === "object" ? op.value : {});
        break;
      case "remove-parameter":
        if (!drop(next.parameters, String(op.name))) {
          errors.push(`\`remove-parameter' names \`${op.name}', which is not a parameter`);
        }
        break;
      case "set-view": {
        if (!op.name) { errors.push("`set-view' names no view"); break; }
        const name = String(op.name);
        const value = op.value && typeof op.value === "object" ? op.value : { html: op.html };
        upsert(next.views, name, { title: value.title ?? null, html: String(value.html ?? "") });
        break;
      }
      case "remove-view":
        if (next.views.length === 1) {
          errors.push("`remove-view' would leave the page with no views");
        } else if (!drop(next.views, String(op.name))) {
          errors.push(`\`remove-view' names \`${op.name}', which is not a view`);
        }
        break;
      case "set-slot": {
        const v = viewFor(op);
        if (!v) break;
        if (!op.id) { errors.push("`set-slot' names no id"); break; }
        const replaced = replaceElementById(v.html, String(op.id), String(op.html ?? ""));
        if (replaced == null) {
          errors.push(`\`set-slot' addresses id \`${op.id}', which view \`${v.name}' `
                    + `does not contain`);
          break;
        }
        v.html = replaced;
        break;
      }
      case "append-slot": {
        const v = viewFor(op);
        if (!v) break;
        const added = appendIntoElement(v.html, op.id ? String(op.id) : null, String(op.html ?? ""));
        if (added == null) {
          errors.push(`\`append-slot' addresses id \`${op.id}', which view \`${v.name}' `
                    + `does not contain`);
          break;
        }
        v.html = added;
        break;
      }
      case "set-styles":
        next.styles = op.value == null ? null : String(op.value);
        break;
      case "set-script":
        next.script = op.value == null ? null : String(op.value);
        break;
      case "set-state":
        next.state = op.value && typeof op.value === "object" ? op.value : {};
        break;
      case "use": {
        for (const add of [].concat(op.add || [])) {
          const name = String(add);
          if (!next.uses.includes(name)) next.uses.push(name);
        }
        for (const rm of [].concat(op.remove || [])) {
          const at = next.uses.indexOf(String(rm));
          if (at >= 0) next.uses.splice(at, 1);
        }
        break;
      }
      default:
        errors.push(`unknown operation \`${kind}'`);
    }
    applied.push(kind);
  }

  if (errors.length) {
    // Refused whole.  Half a patch is a page in a state no prompt asked for.
    return { ok: false, document: before, errors, warnings: [], classification: null,
             applied: [] };
  }

  const checked = validateApplication(next, options);
  if (!checked.ok) {
    return { ok: false, document: before, errors: checked.errors, warnings: checked.warnings,
             classification: null, applied: [] };
  }

  const was = validateApplication(before, options);
  const classification = classify(was.document, checked.document, operations);

  const document = {
    ...checked.document,
    revision: (Number(before.revision) || 1) + 1,
    revisionOf: before.id ? `${before.id}#${Number(before.revision) || 1}` : null,
  };
  return { ok: true, document, errors: [], warnings: checked.warnings,
           classification, applied, size: checked.size };
}

/* ── classification (D-W) ─────────────────────────────────────────────────── */

const panelKey = (p) => canonical({ query: p.query, accept: p.accept,
                                    parameters: p.parameters || [] });
const parameterKey = (p) => canonical({ kind: p.kind, datatype: p.datatype,
                                        language: p.language, domain: p.domain });

/**
 * What a patch re-authorises, computed from what it changed.
 *
 * Never from the operation names: a `set-panel' that only corrects a caption
 * changes nothing that runs, and a `set-slot' that binds a panel which was not
 * bound before changes what is posted into the page.  The names are consulted
 * for exactly one thing -- an operation this version does not recognise forces
 * the stricter class, because an unclassifiable change must not be waved
 * through on the strength of a document comparison that did not understand it.
 */
export function classify(before, after, ops = []) {
  const reasons = [];
  let level = "presentational";
  const note = (klass, why) => { level = stronger(level, klass); reasons.push({ klass, why }); };

  const bp = new Map((before.panels || []).map((p) => [p.name, p]));
  const ap = new Map((after.panels || []).map((p) => [p.name, p]));
  const runs = [], dropped = [];
  for (const [name, p] of ap) {
    const was = bp.get(name);
    if (!was) { note("data", `panel \`${name}' is new`); runs.push(name); continue; }
    if (panelKey(was) !== panelKey(p)) {
      note("data", `panel \`${name}' asks the store something different`);
      runs.push(name);
    } else if (canonical(was) !== canonical(p)) {
      note("presentational", `panel \`${name}' changed its caption or title`);
    }
  }
  for (const [name] of bp) {
    if (!ap.has(name)) { note("data", `panel \`${name}' is gone`); dropped.push(name); }
  }

  const bx = new Map((before.parameters || []).map((p) => [p.name, p]));
  const ax = new Map((after.parameters || []).map((p) => [p.name, p]));
  for (const [name, p] of ax) {
    const was = bx.get(name);
    if (!was) note("data", `parameter \`${name}' is new`);
    else if (parameterKey(was) !== parameterKey(p)) {
      note("data", `parameter \`${name}' changed what values it admits`);
    } else if (canonical(was) !== canonical(p)) {
      note("presentational", `parameter \`${name}' changed its label or default`);
    }
  }
  for (const [name] of bx) if (!ax.has(name)) note("data", `parameter \`${name}' is gone`);

  const cmp = (kind, key, was, now, klass) => {
    const b = new Map((was || []).map((x) => [x[key], x]));
    const a = new Map((now || []).map((x) => [x[key], x]));
    for (const [name, x] of a) {
      const had = b.get(name);
      if (!had) note(klass, `${kind} \`${name}' is new`);
      else if (canonical(had) !== canonical(x)) note(klass, `${kind} \`${name}' changed`);
    }
    for (const [name] of b) if (!a.has(name)) note(klass, `${kind} \`${name}' is gone`);
  };
  cmp("transform", "name", before.transforms, after.transforms, "computational");
  cmp("assertion", "id", before.assertions, after.assertions, "computational");

  const bv = new Map((before.views || []).map((v) => [v.name, v]));
  const av = new Map((after.views || []).map((v) => [v.name, v]));
  for (const [name, v] of av) {
    const had = bv.get(name);
    if (!had) note("presentational", `view \`${name}' is new`);
    else if (canonical(had) !== canonical(v)) note("presentational", `view \`${name}' changed`);
  }
  for (const [name] of bv) if (!av.has(name)) note("presentational", `view \`${name}' is gone`);

  if (String(before.styles ?? "") !== String(after.styles ?? "")) {
    note("presentational", "the stylesheet changed");
  }
  if (String(before.script ?? "") !== String(after.script ?? "")) {
    note("presentational", "the page's own script changed");
  }
  if (canonical(before.uses || []) !== canonical(after.uses || [])) {
    note("presentational", "the components the page uses changed");
  }
  if (String(before.title ?? "") !== String(after.title ?? "")) {
    note("presentational", "the title changed");
  }

  for (const op of ops) {
    const kind = String(op?.op || "");
    if (AUTHORITY_OPERATIONS.includes(kind)) note("authority", `\`${kind}' asks for authority`);
    else if (!OPERATIONS.includes(kind)) note("data", `\`${kind}' is not an operation this version knows`);
  }

  // Two things the runtime cannot do in place (§6.2.1), so the page has to be
  // rebuilt even though nothing it asks the store for has changed.
  const rebuild = canonical(before.uses || []) !== canonical(after.uses || [])
                || String(before.script ?? "") !== String(after.script ?? "")
                || canonical((before.views || []).map((v) => v.name))
                   !== canonical((after.views || []).map((v) => v.name));

  return {
    class: level,
    gate: GATE_FOR[level],
    reasons,
    rerun: runs,
    dropped,
    rebuild,
    unchanged: [...ap.keys()].filter((n) => !runs.includes(n)),
  };
}

/**
 * What Gate 1 shows for a data-class patch: the panels, side by side.
 *
 * The point of the per-panel diff is that the user is being asked the same
 * question Gate 1 always asks -- may this run against the store -- about a
 * smaller thing.  Showing the whole document again would bury the two lines
 * that changed in the thirty that did not, and a gate nobody reads is the
 * failure D-O was written about.
 */
export function panelDiff(before, after) {
  const b = new Map((before.panels || []).map((p) => [p.name, p]));
  const a = new Map((after.panels || []).map((p) => [p.name, p]));
  const out = [];
  for (const [name, p] of a) {
    const was = b.get(name);
    if (!was) out.push({ name, change: "added", before: null, after: p });
    else if (panelKey(was) !== panelKey(p)) out.push({ name, change: "changed", before: was, after: p });
    else out.push({ name, change: "unchanged", before: was, after: p });
  }
  for (const [name, p] of b) if (!a.has(name)) out.push({ name, change: "removed", before: p, after: null });
  return out;
}

export default applyPatch;
