/**
 * The application document: what a model-built page IS, once it is allowed to
 * have more than one prompt behind it.
 *
 * Implements D-U and §5 of `ui-generator.md'; work item U-27.
 *
 * A dashboard, as `lib/dashboard/spec.js' has had it until now, is a proposal:
 * one prompt in, one page out, nothing afterwards.  The moment a second prompt
 * is allowed to change the first one's page, the page needs three things it
 * did not need before -- an identity that survives the change, a shape that a
 * patch can address a part of, and a validator that can be handed the RESULT
 * of a patch rather than the output of a model.  That is this module.  It is
 * deliberately not a file tree (D-U): a run is already recorded as RDF, Gate 1
 * already validates one object, and a second persistence design would have to
 * be kept consistent with the first for no gain the patch protocol does not
 * already give.
 *
 * The generalisation is conservative by construction.  Today's spec --
 * {title, panels, transforms, assertions, html} -- is a valid application
 * document with one unnamed view and no parameters, and `validateDashboard'
 * is now a projection of `validateApplication' rather than a second validator.
 * If that projection changed any existing behaviour the generalisation would
 * be wrong, which is why the existing dashboard assertions are left as they
 * were and run against the new path unaltered.
 *
 * What is added beyond today's checks is listed in §5.3 and implemented in
 * `checkParameters', `checkViews', `checkUses' and `checkSize'.  Three of
 * them exist for the same reason the transform-body check exists: the failure
 * they prevent happens inside the frame, after the page is on the screen,
 * where what reaches the user is a blank region and no reason for it.
 *
 * On normalisation.  Everything downstream -- the frame, the record, the
 * patch classifier -- reads the normalised document, and the classifier
 * compares two of them for equality.  So normalisation is not tidying: key
 * order is fixed, absent values are `null' rather than missing, and two
 * documents that mean the same thing must serialise identically.  Anything
 * that breaks that makes D-W report changes that did not happen.
 */

import { queryFormOf, stripComments } from "../llm/grant.js";
import { COMPONENTS } from "./toolbox/index.js";

/** The document format version.  Bumped only for a change a reader must see. */
export const DOCUMENT_VERSION = 1;

/** The component contract version (§13.10), recorded in the document. */
export const TOOLBOX_VERSION = "1";

/** A name a slot, panel, view or parameter can carry. */
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** The read forms a panel query may take.  A panel never writes. */
export const READ_FORMS = ["SELECT", "CONSTRUCT", "ASK", "DESCRIBE"];

/** The name a legacy single-view document's view is given. */
export const MAIN_VIEW = "main";

/** What a page may weigh, inlined, before the gate refuses it (§13.9). */
export const MAX_PAGE_BYTES = 512 * 1024;

/** What `state' may weigh (§10.3): enough to reopen where you were, not a database. */
export const MAX_STATE_BYTES = 8 * 1024;

/** The kinds a parameter's value may take. */
export const PARAMETER_KINDS = ["literal", "iri"];

/* ── reading the model's answer ───────────────────────────────────────────── */

/**
 * The fenced block the model answers in.
 *
 * `dashboard' is what the prompt has always asked for and what every recorded
 * run carries; `application' is what a document with views or parameters is
 * called in the prompt now.  Both are read, because a model told about one
 * name will occasionally write the other, and refusing an answer over its
 * label would throw away a whole run for a word.
 */
export function applicationFrom(text) {
  const s = String(text || "");
  const fenced = s.match(/```(?:application|dashboard|json)\s*\n([\s\S]*?)```/i);
  if (!fenced) return null;
  try {
    const parsed = JSON.parse(fenced[1]);
    if (!parsed || typeof parsed !== "object") return null;
    return (parsed.panels || parsed.html || parsed.views) ? parsed : null;
  } catch {
    return null;
  }
}

/* ── the slots a page refers to ───────────────────────────────────────────── */

const ATTR = (name) => new RegExp(`data-${name}\\s*=\\s*["']([^"']+)["']`, "gi");

/** Every slot the HTML names, by kind, in document order. */
export function slotsOf(html) {
  const s = String(html || "");
  const read = (kind) => {
    const out = [];
    for (const m of s.matchAll(ATTR(kind))) out.push(m[1].trim());
    return out;
  };
  return { bound: read("bound"), derived: read("derived"), asserted: read("asserted"),
           view: read("view") };
}

/**
 * The ids a view's regions carry.
 *
 * `set-slot' addresses by id, so a view whose regions have none can only be
 * revised by replacing the whole view -- which is the expensive case the patch
 * protocol exists to avoid.  Gate 1 says so rather than discovering it on the
 * second prompt.
 */
export function idsOf(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) out.push(m[1].trim());
  return out;
}

/**
 * Things the frame's content policy will refuse, found before it refuses them.
 *
 * These are warnings, not errors.  The sandbox and the CSP already make each
 * one harmless -- an external image simply does not load -- but a blank panel
 * with no explanation is a bad way to learn that, and Gate 1 is the place to
 * say it while the page can still be changed.
 */
export function policyWarnings(html) {
  const s = String(html || "");
  const out = [];
  const flag = (re, what) => { if (re.test(s)) out.push(what); };
  flag(/<script[^>]*\bsrc\s*=/i, "a <script src=…> — external scripts are blocked; inline it");
  flag(/<(?:img|image)[^>]+\bsrc\s*=\s*["']https?:/i, "an external image — blocked; use a data: URI or draw it");
  flag(/<link[^>]+\bhref\s*=\s*["']https?:/i, "an external stylesheet — blocked; inline the CSS");
  flag(/@import\s+url/i, "a CSS @import — blocked");
  flag(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket/i,
       "a network call — the frame has connect-src 'none' and no credentials; "
     + "data arrives by postMessage only");
  flag(/<iframe/i, "a nested <iframe> — not mounted");
  flag(/localStorage|sessionStorage|document\.cookie/i,
       "browser storage — the frame's origin is opaque, so these throw or are empty");
  return out;
}

/**
 * Does a transform body parse?
 *
 * `frame.js' builds each transform with `new Function("inputs", "api", body)'
 * and calls it.  If the body does not parse, the throw happens at that
 * construction, inside the frame, after the page is already on the screen --
 * and what reaches the user is the frame's stack trace with no message in it
 * (Firefox leaves the message out of `SyntaxError.prototype.stack'), reading
 * as "the page reported an error in transform:census" and nothing more.
 *
 * The same construction here answers the same question before anything is
 * mounted, and Gate 1 is where a fault in the model's own code belongs.
 * Nothing is RUN: constructing a Function parses its body and stops.
 *
 * Only a SyntaxError is the model's fault.  A page served under a content
 * policy without `unsafe-eval' makes `new Function' throw an EvalError here
 * whatever the body says, and a validator that rejected every transform on
 * those grounds would be worse than one that does not check -- so that case
 * returns null and the frame, which does allow eval, stays the only check.
 */
export function bodyFault(body) {
  try {
    new Function("inputs", "api", body);          // parsed, never called
    return null;
  } catch (e) {
    return e instanceof SyntaxError ? (e.message || "does not parse") : null;
  }
}

/* ── what a panel's query projects ────────────────────────────────────────── */

/**
 * The variables a SELECT names, as far as the text can say.
 *
 * It has to be allowed not to know: `SELECT *\', a sub-select, an expression
 * with no alias.  `null\' means "cannot tell", and every check built on this
 * says nothing rather than guessing when it gets one.  Over-reporting here
 * would refuse working pages and reject sound results, which is much worse
 * than missing one.
 *
 * Read ITEM BY ITEM rather than by pattern, because a projection mixes the
 * two kinds freely and the earlier reading did not: given
 *
 *      SELECT ?type (COUNT(?s) AS ?count)
 *
 * it saw a parenthesis, took the aliases, and answered `["count"]\' -- a
 * confident, wrong list that omits the column the figure is drawn along.
 * Under-reporting silently is the one failure this function must not have,
 * since its callers trust a non-null answer to be complete.
 */
export function projectedVariables(query) {
  // PREFIX and BASE first: a projection list is only findable once they are
  // out of the way, and nearly every real query carries them.
  let s = stripComments(query);
  for (;;) {
    const m = /^\s*(?:PREFIX\s+[^\s:]*:\s*<[^>\s]*>|BASE\s*<[^>\s]*>)/i.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  const m = /^\s*SELECT\s+(?:(?:DISTINCT|REDUCED)\s+)?([\s\S]*?)\s*(?:\bWHERE\b|\{)/i.exec(s);
  if (!m) return null;
  const list = m[1].trim();
  if (!list || list === "*") return null;

  const names = [];
  for (let i = 0; i < list.length;) {
    const c = list[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === "(") {
      // An expression projection.  Scan to the MATCHING parenthesis, so that
      // a nested call -- COUNT(DISTINCT ?s) -- does not end the item early,
      // and take the alias it must carry.
      let depth = 0, j = i;
      for (; j < list.length; j += 1) {
        if (list[j] === "(") depth += 1;
        else if (list[j] === ")" && --depth === 0) break;
      }
      if (depth !== 0) return null;
      const as = /\bAS\s+[?$]([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/i.exec(list.slice(i, j + 1));
      if (!as) return null;
      names.push(as[1]);
      i = j + 1;
      continue;
    }
    const word = /^[^\s()]+/.exec(list.slice(i))[0];
    if (!/^[?$][A-Za-z_][A-Za-z0-9_]*$/.test(word)) return null;
    names.push(word.slice(1));
    i += word.length;
  }
  return names.length ? names : null;
}

/** Does a query mention `?name' as a variable at all? */
export function mentionsVariable(query, name) {
  return new RegExp(`[?$]${name}\\b`).test(String(query || ""));
}

/* ── normalisation ────────────────────────────────────────────────────────── */

const str = (v) => (v == null ? null : String(v));
/**
 * The toolbox keyed by element name as well, so `uses' accepts either.
 *
 * Built per call rather than once at module scope because `components' is a
 * parameter: a caller passing a cut-down toolbox (the tests do) must get an
 * index of THAT toolbox, not of the real one.
 */
function componentsByElement(components) {
  const index = {};
  for (const [name, c] of Object.entries(components || {})) {
    if (c?.element) index[c.element] = name;
  }
  return index;
}

const trimmed = (v) => String(v ?? "").trim();
const list = (v) => [].concat(v == null ? [] : v);

/**
 * The legacy shape, lifted.
 *
 * `{…, html}' becomes `{…, views: [{name: "main", html}]}'.  This is the whole
 * of the compatibility story for a document, and it is why nothing recorded
 * has to be migrated: a record written before views existed reads as a
 * one-view application, and one written after reads as itself.
 */
export function liftLegacy(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  if (Array.isArray(r.views) && r.views.length) return r;
  if (r.html == null) return r;
  const { html, ...rest } = r;
  return { ...rest, views: [{ name: MAIN_VIEW, title: null, html: String(html) }] };
}

/* ── validation ───────────────────────────────────────────────────────────── */

/**
 * Check an application document.  Returns {ok, document, errors, warnings,
 * slots, size}.
 *
 * `errors' stop the page; `warnings' are shown at Gate 1 and do not stop it.
 * The returned `document' is normalised, so everything downstream reads one
 * shape and two equivalent documents serialise identically (which is what D-W
 * rests on).
 *
 * `components' is the toolbox catalog, and defaults to the real one so that
 * no caller can forget to check: `uses' naming something that is not there
 * would otherwise be discovered as a custom element that never upgraded,
 * which looks like a styling fault rather than a missing component.  Pass
 * `null' for a context that genuinely has no toolbox; `uses' is then carried
 * through unchecked rather than refused.
 */
export function validateApplication(input, {
  defaultAccept = "text/tab-separated-values",
  components = COMPONENTS,
  maxPageBytes = MAX_PAGE_BYTES,
  maxStateBytes = MAX_STATE_BYTES,
} = {}) {
  const errors = [], warnings = [];
  const raw = liftLegacy(input);
  const panels = [], transforms = [], assertions = [], parameters = [], views = [];
  const seen = new Set();

  // Names that were declared and then REJECTED, which is not the same as names
  // that were never declared.  The difference is the difference between one
  // error and eighteen: a single rejected panel used to be reported again by
  // every transform that read it, every assertion that cited it and every slot
  // that bound it, and the one line saying why was lost among its own
  // consequences.  A reference to a rejected name is the first fault seen from
  // somewhere else, so it is not reported twice.
  //
  // Only REJECTED, though -- not merely declared.  A reference to a name
  // declared further down is a forward reference, which is a fault of the
  // referrer and the only thing standing between this validator and a cycle
  // (declaration order IS dependency order), so that one is still reported.
  const rejected = new Set();

  const unique = (name, what) => {
    if (!NAME_RE.test(name || "")) { errors.push(`${what} has an unusable name: ${JSON.stringify(name)}`); return false; }
    if (seen.has(name)) { errors.push(`${what} \`${name}' is declared twice`); return false; }
    seen.add(name);
    return true;
  };

  /* --- parameters, first, because a panel may name one ------------------- */

  const parameterNames = new Set();
  for (const p of list(raw.parameters)) {
    const name = trimmed(p?.name);
    if (!NAME_RE.test(name)) {
      errors.push(`parameter has an unusable name: ${JSON.stringify(p?.name)}`);
      continue;
    }
    if (parameterNames.has(name)) {
      errors.push(`parameter \`${name}' is declared twice`);
      continue;
    }
    const kind = PARAMETER_KINDS.includes(p?.kind) ? p.kind : "literal";
    const domain = p?.domain && typeof p.domain === "object" ? p.domain : null;
    parameterNames.add(name);
    parameters.push({
      name, kind,
      datatype: str(p?.datatype) || (kind === "literal" ? "xsd:string" : null),
      language: str(p?.language) || null,
      label: str(p?.label) || name,
      domain: domain
        ? (Array.isArray(domain.values)
            ? { values: domain.values.map((v) => String(v)) }
            : (domain.from
                ? { from: trimmed(domain.from), column: trimmed(domain.column) || null }
                : (domain.min != null || domain.max != null
                    ? { min: domain.min == null ? null : Number(domain.min),
                        max: domain.max == null ? null : Number(domain.max) }
                    : null)))
        : null,
      default: p?.default === undefined ? null : p.default,
    });
  }

  /* --- panels ------------------------------------------------------------ */

  for (const p of list(raw.panels)) {
    const name = trimmed(p?.name);
    if (!unique(name, "panel")) continue;
    const query = trimmed(p?.query);
    const form = queryFormOf(query);
    if (!query) {
      errors.push(`panel \`${name}' has no query`); rejected.add(name); continue;
    }
    if (!form) {
      errors.push(`panel \`${name}' does not begin with a query form`);
      rejected.add(name); continue;
    }
    if (!READ_FORMS.includes(form)) {
      errors.push(`panel \`${name}' is a ${form}; a panel reads, it does not write`);
      rejected.add(name);
      continue;
    }
    const uses = list(p?.parameters).map((x) => trimmed(x)).filter(Boolean);
    let faulted = false;
    for (const u of uses) {
      if (!parameterNames.has(u)) {
        errors.push(`panel \`${name}' names parameter \`${u}', which is not declared`);
        faulted = true;
      } else if (!mentionsVariable(query, u)) {
        // A declared parameter that binds nothing is a control that does
        // nothing: the page gets a selector, the user turns it, and the same
        // rows come back.  That reads as a broken page, so it is refused here
        // where it can still be fixed.
        errors.push(`panel \`${name}' names parameter \`${u}', but its query never uses ?${u}`);
        faulted = true;
      }
    }
    if (faulted) { rejected.add(name); continue; }
    panels.push({
      name, query, form,
      accept: String(p?.accept || defaultAccept),
      parameters: uses,
      caption: p?.caption ? String(p.caption) : null,
      title: p?.title ? String(p.title) : null,
    });
  }

  const panelNames = new Set(panels.map((p) => p.name));
  const known = new Set(panelNames);

  /* --- a parameter's domain, now that the panels are known --------------- */

  for (const p of parameters) {
    const d = p.domain;
    if (!d || !d.from) continue;
    if (!panelNames.has(d.from)) {
      if (!rejected.has(d.from)) {
        errors.push(`parameter \`${p.name}' takes its values from \`${d.from}', which is not a panel`);
      }
      continue;
    }
    const panel = panels.find((x) => x.name === d.from);
    const columns = projectedVariables(panel.query);
    if (d.column && columns && !columns.includes(d.column)) {
      errors.push(`parameter \`${p.name}' takes its values from \`${d.from}'.\`${d.column}', `
                + `which that panel does not return (it returns ${columns.join(", ")})`);
    }
    if (!d.column && columns && columns.length > 1) {
      warnings.push(`parameter \`${p.name}' names no column of \`${d.from}', `
                  + `which returns ${columns.length}; the first is used`);
    }
  }
  for (const p of parameters) {
    if (!panels.some((x) => x.parameters.includes(p.name))) {
      warnings.push(`parameter \`${p.name}' is declared but no panel uses it`);
    }
  }

  /* --- transforms -------------------------------------------------------- */

  for (const t of list(raw.transforms)) {
    const name = trimmed(t?.name);
    if (!unique(name, "transform")) continue;
    const inputs = list(t?.inputs).map((i) => trimmed(i));
    const body = trimmed(t?.body);
    if (!body) {
      errors.push(`transform \`${name}' has no body`); rejected.add(name); continue;
    }
    const fault = bodyFault(body);
    if (fault) {
      errors.push(`transform \`${name}' does not compile: ${fault}`);
      rejected.add(name); continue;
    }
    // Inputs must already be declared.  Declaration order IS the dependency
    // order, which is cheaper to state than to compute and leaves no way to
    // write a cycle: a transform cannot name one that has not been seen.
    const unknown = inputs.filter((i) => !known.has(i));
    if (unknown.length) {
      const missing = unknown.filter((i) => !rejected.has(i));
      if (missing.length) {
        errors.push(`transform \`${name}' reads ${missing.map((u) => `\`${u}'`).join(", ")}, `
                  + `which ${missing.length > 1 ? "are" : "is"} not declared above it`);
      }
      rejected.add(name);
      continue;
    }
    if (!inputs.length) {
      warnings.push(`transform \`${name}' names no inputs, so nothing refreshes it`);
    }
    transforms.push({ name, inputs, body, caption: t?.caption ? String(t.caption) : null });
    known.add(name);
  }

  /* --- assertions -------------------------------------------------------- */

  for (const a of list(raw.assertions)) {
    const id = trimmed(a?.id || a?.name);
    if (!unique(id, "assertion")) continue;
    const inputs = list(a?.inputs).map((i) => trimmed(i));
    const unknown = inputs.filter((i) => !known.has(i));
    if (unknown.length) {
      const missing = unknown.filter((i) => !rejected.has(i));
      if (missing.length) {
        errors.push(`assertion \`${id}' cites ${missing.map((u) => `\`${u}'`).join(", ")}, `
                  + `which ${missing.length > 1 ? "are" : "is"} not declared`);
      }
      rejected.add(id);
      continue;
    }
    // An assertion with no inputs is outside knowledge, which is allowed and
    // is exactly what the goal asks for -- but it can never be checked against
    // the store, and the page must say so rather than imply a provenance it
    // does not have.
    assertions.push({
      id, inputs, text: String(a?.text || ""),
      kind: inputs.length ? "derived-from-results" : "outside-knowledge",
      inputDigests: a?.inputDigests && typeof a.inputDigests === "object" ? a.inputDigests : null,
    });
  }

  /* --- views ------------------------------------------------------------- */

  const viewNames = new Set();
  for (const v of list(raw.views)) {
    const name = trimmed(v?.name) || MAIN_VIEW;
    if (!NAME_RE.test(name)) {
      errors.push(`view has an unusable name: ${JSON.stringify(v?.name)}`);
      continue;
    }
    if (viewNames.has(name)) {
      errors.push(`view \`${name}' is declared twice`);
      continue;
    }
    viewNames.add(name);
    views.push({ name, title: str(v?.title), html: String(v?.html || "") });
  }
  if (!views.length) {
    errors.push("the proposal carries no html");
  } else if (!views.some((v) => v.html.trim())) {
    errors.push("the proposal carries no html");
  }

  const html = views.map((v) => v.html).join("\n");
  const slots = slotsOf(html);

  for (const b of slots.bound) {
    if (!panelNames.has(b) && !rejected.has(b)) {
      errors.push(`the page binds \`${b}', which is not a panel`);
    }
  }
  for (const d of slots.derived) {
    if (!transforms.some((t) => t.name === d) && !rejected.has(d)) {
      errors.push(`the page shows derived \`${d}', which is not a transform`);
    }
  }
  for (const a of slots.asserted) {
    if (!assertions.some((x) => x.id === a) && !rejected.has(a)) {
      errors.push(`the page marks asserted \`${a}', which is not declared`);
    }
  }
  for (const target of new Set(slots.view)) {
    if (!viewNames.has(target)) {
      errors.push(`the page navigates to view \`${target}', which does not exist`);
    }
  }
  for (const p of panels) {
    if (!slots.bound.includes(p.name)
        && !transforms.some((t) => t.inputs.includes(p.name))
        && !assertions.some((x) => x.inputs.includes(p.name))
        && !parameters.some((x) => x.domain?.from === p.name)) {
      warnings.push(`panel \`${p.name}' is run but never used — it costs a query for nothing`);
    }
  }
  // Only when none were PROPOSED.  "Nothing comes from the store" said of a
  // page whose three panels were just rejected describes the validator, not
  // the proposal, and sits under the errors as though it were a fourth fault.
  if (!panels.length && !list(raw.panels).length) {
    warnings.push("no panels: nothing on this page comes from the store");
  }
  // A view with no ids can only be revised by replacing it whole, which is the
  // case the patch protocol exists to avoid.  Said once per view, at the gate,
  // while the page can still be asked for again.
  for (const v of views) {
    if (v.html.trim() && !idsOf(v.html).length) {
      warnings.push(`view \`${v.name}' gives its regions no id, so a later change `
                  + `can only replace the whole view`);
    }
  }

  warnings.push(...policyWarnings(html));

  /* --- the toolbox ------------------------------------------------------- */

  const uses = [];
  const byElement = componentsByElement(components);
  for (const raw0 of list(raw.uses).map((x) => trimmed(x)).filter(Boolean)) {
    // The catalog shows each component by its ELEMENT name -- `<dydra-table>'
    // is the heading the model reads and the tag it writes into the markup --
    // so naming the element in `uses' is what the interface taught it to do.
    // Demanding the bare name here refused three correct declarations on a
    // live page and disabled the run button with no way forward.  The mapping
    // is one-to-one, so this is a spelling, not a guess: resolve it, and say
    // nothing, because there is nothing for the model to have done better.
    const u = components && !components[raw0] && byElement[raw0] ? byElement[raw0] : raw0;
    if (uses.includes(u)) continue;
    if (components && !components[u]) {
      errors.push(`\`uses' names component \`${raw0}', which is not in the toolbox`);
      continue;
    }
    uses.push(u);
  }
  if (components) {
    for (const u of uses.slice()) {
      for (const dep of list(components[u]?.needs?.components)) {
        if (!uses.includes(dep)) {
          if (!components[dep]) {
            errors.push(`component \`${u}' depends on \`${dep}', which is not in the toolbox`);
          } else {
            // A dependency the model did not name is added rather than
            // refused: the model is choosing what it wants on the page, not
            // administering a dependency graph.
            uses.push(dep);
            // Silently for a hidden component: `base' is an implementation
            // detail of the toolbox, not a choice the model made or can
            // unmake, and reporting it would be noise at every gate.
            if (!components[dep].hidden) {
              warnings.push(`component \`${u}' needs \`${dep}', which has been added to \`uses'`);
            }
          }
        }
      }
      for (const cap of list(components[u]?.needs?.capabilities)) {
        if (!AVAILABLE_CAPABILITIES.includes(cap)) {
          errors.push(`component \`${u}' needs \`${cap}', which this interface cannot provide`);
        }
      }
    }
  }

  /* --- state ------------------------------------------------------------- */

  let state = {};
  if (raw.state && typeof raw.state === "object" && !Array.isArray(raw.state)) {
    const text = JSON.stringify(raw.state);
    if (text.length > maxStateBytes) {
      errors.push(`\`state' is ${text.length} bytes; the limit is ${maxStateBytes}. `
                + `State holds which view is open and which parameters are chosen — `
                + `a page that wants more than that wants a repository, and it has one`);
    } else {
      state = raw.state;
    }
  }

  /* --- the contract version (§13.10) ------------------------------------- */

  // Refused rather than mounted subtly wrong.  A document written against a
  // later toolbox may name components this build does not have, or use ones
  // it does have differently; rendering it anyway would produce a page that
  // looks finished and is not.  The version is recorded IN THE DOCUMENT
  // rather than imported by a URL, because the frame cannot import anything.
  const toolbox = str(raw.toolbox) || TOOLBOX_VERSION;
  if (toolbox !== TOOLBOX_VERSION) {
    errors.push(`this page was written against toolbox version ${toolbox}; `
              + `this interface has version ${TOOLBOX_VERSION}`);
  }

  /* --- the document ------------------------------------------------------ */

  const document = {
    application: DOCUMENT_VERSION,
    id: str(raw.id),
    revision: Number(raw.revision) > 0 ? Math.floor(Number(raw.revision)) : 1,
    title: String(raw.title || "Dashboard"),
    toolbox,
    uses,
    parameters, panels, transforms, assertions, views,
    styles: raw.styles == null ? null : String(raw.styles),
    script: raw.script == null ? null : String(raw.script),
    state,
    notes: raw.notes ? String(raw.notes) : null,
  };

  const size = sizeOf(document, components);
  if (size.total > maxPageBytes) {
    errors.push(`the page is ${Math.round(size.total / 1024)} KiB inlined `
              + `(markup ${Math.round(size.html / 1024)}, styles ${Math.round(size.styles / 1024)}, `
              + `script ${Math.round(size.script / 1024)}, components ${Math.round(size.components / 1024)}); `
              + `the limit is ${Math.round(maxPageBytes / 1024)} KiB`);
  }

  return { ok: errors.length === 0, document, errors, warnings, slots, size };
}

/** Capabilities a component may declare a need for, and this host can supply. */
export const AVAILABLE_CAPABILITIES = ["graphviz"];

/**
 * What the page will weigh once it is inlined.
 *
 * The model cannot measure this -- it does not know the runtime's size, or a
 * component's, or that `uses' pulls in a dependency -- and the failure mode is
 * a page too large to post, save or mail, discovered after it is built.  So it
 * is measured here and reported at Gate 1 with the components broken out,
 * because that is the line the model can act on.
 */
export function sizeOf(document, components = null) {
  const bytes = (s) => (s == null ? 0 : String(s).length);
  const html = (document.views || []).reduce((n, v) => n + bytes(v.html), 0);
  const styles = bytes(document.styles);
  const script = bytes(document.script);
  let used = 0;
  const per = {};
  for (const u of document.uses || []) {
    const c = components?.[u];
    const n = c ? bytes(c.source) + bytes(c.style) : 0;
    per[u] = n;
    used += n;
  }
  const st = document.state || {};
  const data = Object.keys(st).length ? bytes(JSON.stringify(st)) : 0;
  return { html, styles, script, components: used, perComponent: per, state: data,
           total: html + styles + script + used + data };
}

/* ── identity ─────────────────────────────────────────────────────────────── */

/**
 * A document id.
 *
 * Minted here rather than by the store, because the identity has to exist
 * before the first revision is recorded and the record is written after the
 * page is mounted.  Time-ordered so a listing sorts usefully even when the
 * recorded timestamps are missing.
 */
export function mintId(now = new Date()) {
  const t = now.toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const r = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `app-${t}-${r}`;
}

/**
 * The document as a stable string.
 *
 * Used for comparison, not for storage: D-W classifies a patch by comparing
 * the normalised document before with the normalised document after, and that
 * comparison is only as sound as the determinism of this function.
 */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/* ── projections ──────────────────────────────────────────────────────────── */

/** The views of a document, or the one view a legacy spec implies. */
export function viewsOf(docOrSpec) {
  const d = docOrSpec || {};
  if (Array.isArray(d.views) && d.views.length) return d.views;
  return [{ name: MAIN_VIEW, title: null, html: String(d.html || "") }];
}

/**
 * The legacy spec, out of a document.
 *
 * Everything that reads `spec.html' keeps reading it.  A multi-view document
 * projects to the concatenation of its views, which is what a reader with no
 * notion of views should see: all of the page, in order.
 */
export function specOf(document) {
  const views = viewsOf(document);
  return {
    title: document.title,
    panels: document.panels || [],
    transforms: document.transforms || [],
    assertions: document.assertions || [],
    html: views.map((v) => v.html).join("\n"),
    notes: document.notes ?? null,
  };
}

export default validateApplication;
