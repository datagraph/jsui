/**
 * Reusable arrangements: lift, apply, mount.
 *
 * Implements D-AV and §21 of `interface-as-rdf-plan.md'; work items U-80 to
 * U-88.  Phase 8.
 *
 * Reuse has two sources -- the whole presentation for a view, and a located
 * component inside one -- so an arrangement has two forms of name:
 *
 *   `inventory'                 the presentation itself
 *   `inventory#e-7k2m'          one element of it, anchored on `data-ui'
 *
 * The presentation half is not decoration.  A minted element name is unique
 * within a presentation and NOT within a rendered document, which composes
 * several; `resolve' in `dom-patch.js' looks an element up with a
 * document-wide `querySelector', so without the presentation scope two
 * arrangements from two presentations can name the same string and mean
 * different elements.
 *
 * Four things are worth saying before the code, because each of them is a
 * decision that removed work rather than adding it.
 *
 * **There is one placement, and it differs in one thing: identity.**  An
 * inclusion either keeps the source's element names -- in which case the
 * placed elements are still the source's and an edit through them is routed
 * back to it -- or it re-mints them, in which case they are new elements and
 * edits are local.  Write-back is not a second difference but a consequence
 * of the first: keeping the name is what makes the write addressable at the
 * source.
 *
 * **Identity is retained in exactly one case: an entire presentation, loaded
 * once.**  That is the mount, and `mount' here refuses a second one, the way
 * a named view has one editor presented for it and not several.  That rule is
 * what keeps `resolve' untouched: two mounts of one presentation would put
 * identical names into one document -- a certain collision, not a risk -- and
 * would have forced resolution to be scoped along the chain of mounts.
 *
 * **An applied component arrives with definitions and no content.**  It
 * repeats the requests the original performed, against whatever source the
 * inclusion had, under the READER's credentials; it does not carry the
 * original's results (D-AR).  So an apply costs queries, and a request that
 * cannot run is the apply failing rather than the component rendering empty:
 * a component that silently shows nothing is indistinguishable from one whose
 * query legitimately returned nothing.
 *
 * **Expansion is triggered only from outside the representation.**  Nothing
 * in a document can be interpreted as asking for an inclusion: a mount is a
 * `host' element and a host is inert until something external registers a
 * renderer for it (`reconcile.js').  So the expander is never re-entered by
 * the content it is expanding, there is no cycle check, no visited set and no
 * depth ceiling -- and `renders nothing by itself' is asserted as a test
 * rather than defended by machinery.
 *
 * On provenance: it is recorded and nothing reads it (§21.4.4).  The request
 * SOURCE is not provenance and is not covered by that -- it is read on every
 * re-run, and a template whose sources were treated as decoration could not
 * be repeated at all.  The two are kept in different fields here for exactly
 * that reason.
 */

import {
  node, view, index, insert, walk, find, mintName, treeFromHtml,
  NAME_RE as ELEMENT_NAME_RE,
} from "./tree.js";
import { NAME_RE as PRESENTATION_NAME_RE } from "./document.js";
import { SCOPES, isGenericKind } from "./vocabulary.js";
import { executableParts } from "./sharing.js";

/** The form of a template this build writes and reads. */
export const TEMPLATE_VERSION = 1;

/**
 * What a `host' element's `host' value says when the host is a presentation
 * rather than a registered view.
 *
 * A string convention inside a term that already exists, rather than a new
 * term: `ui:host' is written and read by every build, and an older one
 * meeting `presentation:inventory' finds no renderer registered under that
 * name and draws the band inert, with the sentence `reconcile.js' already
 * writes.  A new term would have been dropped on the floor instead, which is
 * the failure U-75 exists to prevent.
 */
export const MOUNT_SCHEME = "presentation:";

/** The `host' value that mounts a presentation. */
export const mountHostValue = (name) => MOUNT_SCHEME + String(name || "");

/** The presentation a host value mounts, or null when it hosts a view. */
export function mountedPresentation(value) {
  const s = String(value == null ? "" : value);
  return s.startsWith(MOUNT_SCHEME) ? s.slice(MOUNT_SCHEME.length) : null;
}

/** Kinds that have no nameable interior (D-AN, D-AS). */
const OPAQUE_KINDS = ["html", "host"];

/* ── names (U-80) ─────────────────────────────────────────────────────────── */

/** The XPath an element's name is SHOWN as.  Display only; never compared. */
export const xpathOf = (element) => `//*[@data-ui='${String(element)}']`;

const XPATH_RE = /^\/\/\*\[@data-ui=(?:'([^']+)'|"([^"]+)")\]$/;

/**
 * Read an arrangement name.
 *
 * `<presentation>' or `<presentation>#<path>', where the path is either the
 * bare anchor (`e-7k2m') or the XPath display form.  Both spell the same
 * name, which is the reason the anchor and not the expression is what gets
 * stored: two spellings of one component must not be two names.
 *
 * A path with more than one step is refused rather than parsed.  Every tree
 * element carries an anchor, so a path into a TREE never needs a second step;
 * a second step can therefore only be reaching inside an opaque leaf, where
 * it could only be positional -- and a positional name reads correctly until
 * the markup is regenerated, which for an `html' leaf is the normal case.
 */
export function parseName(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return { ok: false, reason: "an arrangement name is empty" };
  const hash = raw.indexOf("#");
  const presentation = hash < 0 ? raw : raw.slice(0, hash);
  const path = hash < 0 ? null : raw.slice(hash + 1);
  if (!PRESENTATION_NAME_RE.test(presentation)) {
    return { ok: false, reason: `\`${presentation}' is not a presentation name` };
  }
  if (hash < 0) {
    return { ok: true, form: "presentation", presentation, element: null, text: raw };
  }
  if (!path) {
    return { ok: false, reason: `\`${raw}' names a component of \`${presentation}' but not which one` };
  }
  const expressed = XPATH_RE.exec(path);
  const element = expressed ? (expressed[1] ?? expressed[2]) : path;
  if (!expressed && /[/[\]@]/.test(path)) {
    return { ok: false,
             reason: `\`${path}' is a path of more than one step; an element is named by its `
                   + `own anchor, and the interior of an \`html' or \`host' element has no `
                   + `anchors to name (D-AV)` };
  }
  if (!ELEMENT_NAME_RE.test(element)) {
    return { ok: false, reason: `\`${element}' is not an element anchor` };
  }
  return { ok: true, form: "component", presentation, element, text: raw };
}

/** The canonical spelling: the anchor, not the expression around it. */
export function printName({ presentation, element = null } = {}) {
  return element ? `${presentation}#${element}` : String(presentation);
}

/** The spelling shown in the bar and in a catalogue listing. */
export function displayName({ presentation, element = null } = {}) {
  return element ? `${presentation}#${xpathOf(element)}` : String(presentation);
}

/**
 * May this element be named?
 *
 * The refusal is the decision rather than a limitation.  An `html' or `host'
 * element is opaque by construction, so an arrangement cannot be located
 * inside one; the way to make its contents nameable is to convert the leaf to
 * a tree, which `promote' in `tree.js' already does one element at a time.
 */
export function nameable(roots, element) {
  const held = index(roots || []).get(String(element));
  if (!held) return { ok: false, reason: `there is no element \`${element}' here` };
  if (OPAQUE_KINDS.includes(held.node.kind)) {
    return { ok: false,
             reason: `\`${element}' is a \`${held.node.kind}' element: it is opaque, and an `
                   + `arrangement cannot be lifted from inside one -- convert it to a tree `
                   + `first, or lift the whole presentation (§33)` };
  }
  return { ok: true, node: held.node, parent: held.parent };
}

/* ── the scope pair (U-80, §21.4.3) ───────────────────────────────────────── */

/**
 * May a presentation of this scope be mounted in one of that scope?
 *
 * A workspace is refused in either container, for one reason said twice: a
 * workspace arranges jsui's own panes and there is one of it, so a second
 * inside the first arranges nothing further, and one inside a document is the
 * first case wearing a different name.  A document is permitted in either --
 * in a workspace, which is what composes a page into the chrome, and in
 * another document, which is the shape a component library takes.
 */
export function checkScopes({ mounted, mounting } = {}) {
  for (const [what, s] of [["mounted", mounted], ["mounting", mounting]]) {
    if (!SCOPES.includes(String(s))) {
      return { ok: false, reason: `\`${s}' is not a scope (${what})` };
    }
  }
  if (String(mounted) === "workspace") {
    return { ok: false,
             reason: `a workspace cannot be mounted in a ${mounting}: a workspace arranges the `
                   + `interface's own bands and there is one of it` };
  }
  return { ok: true };
}

/* ── lift (U-81) ──────────────────────────────────────────────────────────── */

const copy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

/** Every element name in a subtree, the root first. */
function namesOf(root) {
  const out = [root.name];
  walk(root.children, (n) => out.push(n.name));
  return out;
}

/** The named parts a subtree points at: panels, transforms, assertions. */
function referencesOf(root) {
  const bound = new Set(), derived = new Set(), asserted = new Set(), binds = new Set();
  const take = (n) => {
    if (n.bound) bound.add(n.bound);
    if (n.derived) derived.add(n.derived);
    if (n.asserted) asserted.add(n.asserted);
    if (n.binds) binds.add(n.binds);
  };
  take(root);
  walk(root.children, take);
  return { bound, derived, asserted, binds };
}

/**
 * A located component, as a template.
 *
 * The same tree with every minted name replaced by a placeholder and every
 * order key dropped, plus the request definitions it points at and the source
 * each of those runs against.
 *
 * Order keys are dropped rather than kept because a key is meaningful only
 * among the siblings it was minted between (D-AJ); carrying one into another
 * presentation would place the element by an accident of where it used to
 * sit.  The root's own placement goes for the same reason.
 */
export function lift({ document: doc, name, source = null, revision = null,
                       scope = "document" } = {}) {
  const d = doc || {};
  const parsed = typeof name === "string" ? parseName(name) : { ok: true, ...name };
  if (!parsed.ok) return { ok: false, errors: [parsed.reason], template: null };
  if (parsed.form === "presentation" || !parsed.element) {
    return liftWhole({ document: d, presentation: parsed.presentation, source, revision, scope });
  }
  const holder = (d.views || []).find((v) => index(v.elements || []).has(parsed.element));
  if (!holder) {
    return { ok: false, template: null,
             errors: [`there is no element \`${parsed.element}' in \`${parsed.presentation}'`] };
  }
  const can = nameable(holder.elements, parsed.element);
  if (!can.ok) return { ok: false, template: null, errors: [can.reason] };

  const root = node(copy(can.node));
  const placeholders = new Map();
  for (const n of namesOf(root)) placeholders.set(n, `p-${placeholders.size}`);
  const rename = (n) => {
    n.name = placeholders.get(n.name) || n.name;
    n.order = null;
    for (const c of n.children) rename(c);
  };
  rename(root);
  root.placement = null;

  const refs = referencesOf(can.node);
  const panelsByName = new Map((d.panels || []).map((p) => [p.name, p]));
  const transformsByName = new Map((d.transforms || []).map((t) => [t.name, t]));
  const assertionsById = new Map((d.assertions || []).map((a) => [a.id, a]));
  const parametersByName = new Map((d.parameters || []).map((p) => [p.name, p]));

  // A transform reads panels; a panel reads parameters.  Collect through both
  // so that a lifted chart brings the query that feeds it and the parameter
  // the query is bound to, and not just the element that drew it.
  const wantPanels = new Set(refs.bound);
  for (const t of refs.derived) {
    for (const i of transformsByName.get(t)?.inputs || []) wantPanels.add(i);
  }
  const wantParameters = new Set(refs.binds);
  for (const p of wantPanels) {
    for (const name0 of panelsByName.get(p)?.parameters || []) wantParameters.add(name0);
  }

  const unresolved = [];
  const panels = [];
  for (const p of wantPanels) {
    const held = panelsByName.get(p);
    if (!held) { unresolved.push({ what: "panel", name: p }); continue; }
    panels.push({ ...copy(held), source: copy(source) });
  }
  const transforms = [];
  for (const t of refs.derived) {
    const held = transformsByName.get(t);
    if (!held) { unresolved.push({ what: "transform", name: t }); continue; }
    transforms.push(copy(held));
  }
  const assertions = [];
  for (const a of refs.asserted) {
    const held = assertionsById.get(a);
    if (!held) { unresolved.push({ what: "assertion", name: a }); continue; }
    assertions.push(copy(held));
  }
  const parameters = [];
  for (const p of wantParameters) {
    const held = parametersByName.get(p);
    if (!held) { unresolved.push({ what: "parameter", name: p }); continue; }
    parameters.push(copy(held));
  }

  return {
    ok: true,
    errors: [],
    template: {
      version: TEMPLATE_VERSION,
      // Provenance.  Recorded; nothing reads it to decide anything (§21.4.4).
      source: { presentation: parsed.presentation, element: parsed.element,
                view: holder.name, revision: revision == null ? null : String(revision) },
      root,
      placeholders: [...placeholders.values()],
      panels, transforms, assertions, parameters,
      // What the source document did not have.  An apply refuses on these:
      // §21.4.2's failure case, caught where it can still be explained.
      unresolved,
    },
  };
}

/* ── the composite: a whole presentation as one arrangement (§33) ─────────── */

/**
 * The elements of one view, however that view carries them.
 *
 * A composed page is markup with ids on its regions, not a tree -- that is
 * what Compose writes and what `promote' converts the first time a patch
 * addresses an element.  A composite lift must not convert anything: the
 * source document is somebody's open page and a lift is a READ.  So the
 * markup is carried as the one `html' leaf `treeFromHtml' makes of it, on a
 * copy, and the source is left exactly as it was found.
 *
 * That leaf is opaque, which is the usual reason a lift is refused -- and is
 * not a reason here, because nothing is being lifted from INSIDE it.  The
 * whole of it is being lifted, markup and all, which is the one case where an
 * opaque carrier is not in the way.
 */
function viewElements(v, { random = Math.random } = {}) {
  if (v?.elements?.length) return copy(v.elements);
  return treeFromHtml(v?.html || "", { random });
}

/**
 * A whole presentation, as a template (§33; work item U-114).
 *
 * The reason this exists is the matrix: a page arranged as one row per
 * repository is a shape somebody wants again over three other repositories,
 * and until now the only reusable unit was ONE element.  Lifting the row
 * three times and reassembling the grid by hand reproduces the arrangement
 * and loses the thing that was arranged.
 *
 * It differs from a component lift in three ways, and each is a consequence
 * of "whole" rather than a separate decision.
 *
 * **Every definition travels, not the referenced ones.**  A component lift
 * walks the subtree for `bound'/`derived'/`asserted'/`binds' and takes what
 * it finds.  That walk cannot see inside an `html' carrier, where a composed
 * page's `data-bound' regions actually are, so a composite that reasoned the
 * same way would carry a page's markup and none of its queries -- an apply
 * that reports success and shows an empty page, which is the failure
 * §21.4.2 rules out.  A whole presentation's panels are its panels; there is
 * nothing to work out.
 *
 * **`uses' travels.**  Which is only interesting for the markup case: an
 * element tree declares its components by the kinds in it and `apply' reads
 * them off the tree, but a carrier's components are named inside the markup
 * where no walk will find them.  Carrying the source's `uses' is how an
 * applied page arrives with its toolbox rather than as a column of unknown
 * elements.
 *
 * **The stylesheet and the page's script do NOT travel.**  A component lift
 * has never carried them and a composite does not either: a page's `script'
 * is one of the four carriers §20 withholds behind an admission, and an
 * apply is not that path.  What arrives is structure and requests, which is
 * what an arrangement has always meant.  It is said in the reply rather than
 * discovered, because a page that arrives plainer than it left looks broken.
 *
 * Two refusals, both narrow:
 *
 *   - a WORKSPACE is refused, for the reason `checkScopes' refuses mounting
 *     one: the chrome arranges jsui's own bands, and a copy of it inside a
 *     page is a column of hosts nothing will register a renderer for;
 *   - a presentation of more than one view is refused, naming them.  A
 *     composite is placed as ONE element, and three tabs flattened into one
 *     column is a different page from the one that was lifted.  The view's
 *     own root is lifted by anchor instead, which is exact.
 */
export function liftWhole({ document: doc, presentation, source = null, revision = null,
                            scope = "document", random = Math.random } = {}) {
  const d = doc || {};
  if (String(scope) === "workspace") {
    return { ok: false, template: null,
             errors: [`\`${presentation}' is a workspace: it arranges the interface's own `
                    + `bands, and a copy of it inside a page is a column of hosts with `
                    + `nothing registered to draw them`] };
  }
  const views = (d.views || []).filter(Boolean);
  if (!views.length) {
    return { ok: false, template: null,
             errors: [`\`${presentation}' has no view to lift`] };
  }
  if (views.length > 1) {
    const named = views.map((v) => `\`${v.name}'`).join(", ");
    return { ok: false, template: null,
             errors: [`\`${presentation}' has ${views.length} views (${named}); a composite is `
                    + `placed as one element, and tabs flattened into one column would be a `
                    + `different page — lift the view's own root by its anchor instead`] };
  }
  const holder = views[0];
  const roots = viewElements(holder, { random });
  if (!roots.length) {
    return { ok: false, template: null,
             errors: [`view \`${holder.name}' of \`${presentation}' is empty`] };
  }

  /* One root is the arrangement; several get a container, because what is
     applied has to be one element to place.  The container is a plain `div'
     with no layout of its own: a grid belongs to the element that declared
     it, and inventing one here would arrange the page a second way. */
  const root = roots.length === 1
    ? node(copy(roots[0]))
    : node({ name: "composite", kind: "div", children: roots.map((r) => node(copy(r))) });

  const placeholders = new Map();
  for (const n of namesOf(root)) placeholders.set(n, `p-${placeholders.size}`);
  const rename = (n) => {
    n.name = placeholders.get(n.name) || n.name;
    n.order = null;
    for (const c of n.children) rename(c);
  };
  rename(root);
  root.placement = null;

  const panels = (d.panels || []).map((p) => ({ ...copy(p), source: copy(source) }));

  return {
    ok: true,
    errors: [],
    template: {
      version: TEMPLATE_VERSION,
      // `element' is null and `whole' is true: the two together say what was
      // taken, and the catalogue prints the difference rather than showing an
      // entry whose source reads as a page with a missing element name.
      source: { presentation, element: null, view: holder.name, whole: true,
                revision: revision == null ? null : String(revision) },
      root,
      placeholders: [...placeholders.values()],
      panels,
      transforms: copy(d.transforms || []),
      assertions: copy(d.assertions || []),
      parameters: copy(d.parameters || []),
      uses: copy(d.uses || []),
      // Nothing can be unresolved: every definition the page had is here.
      unresolved: [],
    },
  };
}

/* ── the requests an applied component repeats (U-84, U-88) ───────────────── */

/** Every request a template will run, with the source it runs against. */
export function requestsOf(template) {
  return (template?.panels || []).map((p) => ({
    panel: p.name, query: p.query, accept: p.accept, form: p.form || null,
    parameters: [...(p.parameters || [])], source: copy(p.source),
  }));
}

/**
 * What text in this template something will execute (§21.3, REQ-33.3.3).
 *
 * The same reading `sharing.js' gives a presentation, given a template --
 * which is a document with one view in it, so it is shimmed into that shape
 * rather than read a second way.  Two implementations of "what is executable
 * here" would disagree the day either is corrected, and this is the one place
 * where disagreeing matters.
 *
 * It exists because a composite carries more than a component lift ever did:
 * a whole page's markup and every transform the page defines.  An arrangement
 * is NOT yet behind the U-74 admission -- REQ-33.3.3 is still planned -- so
 * what an apply can bring in from another account is disclosed in words
 * instead, beside the requests U-88 already shows.  A disclosure is weaker
 * than an admission and is not offered as a substitute for one; it is the
 * difference between a reader who could have known and one who could not.
 */
export function templateParts(template) {
  return executableParts({
    script: null,
    transforms: template?.transforms || [],
    views: [{ name: template?.source?.view || "main", elements: [template?.root].filter(Boolean) }],
  });
}

/** The distinct sources those requests name.  What U-88 shows the reader. */
export function sourcesOf(template) {
  const seen = new Map();
  for (const r of requestsOf(template)) {
    const s = r.source;
    const key = s ? `${s.host || ""}/${s.account || ""}/${s.repository || ""}` : "";
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/**
 * What a reader is shown before an arrangement from another account is first
 * applied (U-88, §21.3).
 *
 * The request text AND where each request goes.  §20 withholds four carriers
 * of executable text; a request is a fifth and the four-carrier screen does
 * not look at it, because no script runs.  The disclosure here is of the
 * READER, not of the author's data: the author chose the address and the
 * reader supplies the credentials, and a reader shown the query but not its
 * destination has been shown the uninteresting half.
 */
export function describeRequests(template) {
  const lines = [];
  for (const r of requestsOf(template)) {
    const s = r.source;
    const where = s
      ? `${s.host || "(this host)"} ${s.account || "?"}/${s.repository || "?"}`
      : "(no source recorded)";
    lines.push(`${r.panel} → ${where}`);
    lines.push(...String(r.query || "").split("\n").map((l) => `    ${l}`));
  }
  return lines.join("\n");
}

/* ── apply (U-82, U-84) ───────────────────────────────────────────────────── */

const shortTag = (random) => mintName(random).slice(2, 6);

/** Is a destination's definition of a name the same thing the template means? */
function sameParameter(a, b) {
  return a.kind === b.kind
      && (a.datatype || null) === (b.datatype || null)
      && (a.language || null) === (b.language || null);
}

/**
 * Can this template be applied here?
 *
 * Both failures are the apply failing, visibly, rather than the component
 * rendering empty -- which is §21.4.2's rule and the reason it is one rule
 * and not two: authorisation is the reader's, so a request that cannot run
 * and a request that may not run are the same event to the person watching.
 */
export function checkApply({ document: doc, template } = {}) {
  const errors = [];
  if (!template || template.version !== TEMPLATE_VERSION) {
    return { ok: false, errors: [`this arrangement is written against template form `
                               + `${template?.version}; this interface reads ${TEMPLATE_VERSION}`] };
  }
  for (const u of template.unresolved || []) {
    errors.push(`the arrangement names a ${u.what} \`${u.name}' that its source did not define, `
              + `so the component cannot be recreated here`);
  }
  const mine = new Map(((doc || {}).parameters || []).map((p) => [p.name, p]));
  for (const p of template.parameters || []) {
    const held = mine.get(p.name);
    if (held && !sameParameter(held, p)) {
      errors.push(`\`${p.name}' is a ${held.kind} here and a ${p.kind} in the arrangement; `
                + `applying it would bind the request to a different parameter`);
    }
  }
  for (const r of requestsOf(template)) {
    if (!r.source) errors.push(`no source is recorded for \`${r.panel}', so there is nothing to `
                             + `repeat the request against`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Put a template into a document.
 *
 * Names re-minted, keys assigned between the chosen neighbours, the request
 * definitions merged in, as one patch (D-AO) -- so an apply is one revision
 * and `undo' is the revert that already exists.
 *
 * Panel, transform and parameter names are kept when they are free and minted
 * afresh when they are taken, rather than reused.  Reusing a taken name would
 * silently point the applied component at the destination's data, which is
 * the one outcome nobody asked for: the arrangement is a recipe, and a recipe
 * that quietly changes ingredients is a different dish.
 */
export function apply({ document: doc, template, view: viewName = null,
                        parent = null, after = null, before = null,
                        writer = null, random = Math.random } = {}) {
  const check = checkApply({ document: doc, template });
  if (!check.ok) return { ...check, document: doc, elements: [], requests: [] };

  const d = { ...(doc || {}) };
  d.views = [...(d.views || [])].map((v) => ({ ...v, elements: [...(v.elements || [])] }));
  const target = viewName ? d.views.find((v) => v.name === viewName) : d.views[0];
  if (!target) {
    return { ok: false, document: doc, elements: [], requests: [],
             errors: [`there is no view \`${viewName || "(the first)"}' to apply into`] };
  }

  const taken = (list, key) => new Set((list || []).map((x) => x[key]));
  const freshIn = (used, want) => {
    if (!used.has(want)) { used.add(want); return want; }
    let out = `${want}-${shortTag(random)}`;
    while (used.has(out)) out = `${want}-${shortTag(random)}`;
    used.add(out);
    return out;
  };

  const panelNames = taken(d.panels, "name");
  const transformNames = taken(d.transforms, "name");
  const assertionIds = taken(d.assertions, "id");
  const parameterNames = taken(d.parameters, "name");

  const panelMap = new Map(), transformMap = new Map(), assertionMap = new Map();
  const parameterMap = new Map();

  // A parameter the destination already defines the same way is SHARED, not
  // copied.  That is the one reuse that is right: D-AQ makes a control a
  // parameter editor, so two components bound to one parameter are two views
  // of one value, which is what a reader moving a slider expects.
  for (const p of template.parameters || []) {
    if (parameterNames.has(p.name)) { parameterMap.set(p.name, p.name); continue; }
    parameterNames.add(p.name);
    parameterMap.set(p.name, p.name);
    d.parameters = [...(d.parameters || []), copy(p)];
  }
  for (const p of template.panels || []) {
    const name = freshIn(panelNames, p.name);
    panelMap.set(p.name, name);
    const merged = { ...copy(p), name,
                     parameters: (p.parameters || []).map((x) => parameterMap.get(x) || x) };
    d.panels = [...(d.panels || []), merged];
  }
  for (const t of template.transforms || []) {
    const name = freshIn(transformNames, t.name);
    transformMap.set(t.name, name);
    d.transforms = [...(d.transforms || []),
                    { ...copy(t), name,
                      inputs: (t.inputs || []).map((i) => panelMap.get(i) || i) }];
  }
  for (const a of template.assertions || []) {
    const id = freshIn(assertionIds, a.id);
    assertionMap.set(a.id, id);
    d.assertions = [...(d.assertions || []),
                    { ...copy(a), id,
                      inputs: (a.inputs || []).map((i) => panelMap.get(i) || i) }];
  }

  // The components the placed subtree is made of, added to what the page
  // declares it uses.  Without this an applied component arrives INERT: the
  // frame inlines only the toolbox a document asks for, so a `panel' or a
  // `select' the destination never used renders as an unknown element — an
  // apply that reports success and shows an empty space, which is exactly
  // the outcome §21.4.2 rules out for a request that cannot run, arrived at
  // by another road.  It also makes `classify' ask for a rebuild, which is
  // what inlining a component into a running frame takes.
  const uses = [...(d.uses || [])];
  walk([template.root], (n) => {
    /* `html' and `host' are structural and name no component.  Declaring one
       in `uses' asks the toolbox for a component of that name and gets a
       refusal of the whole document -- which a composite of a page that is
       still markup would hit every time, its root being exactly an `html'
       leaf. */
    if (!n.kind || OPAQUE_KINDS.includes(n.kind) || isGenericKind(n.kind)) return;
    if (!uses.includes(n.kind)) uses.push(n.kind);
  });
  /* And the ones the template declared.  A composite of a page that is still
     markup names its components INSIDE the markup, where the walk above
     cannot see them, so without this the commonest composite arrives as a
     column of unknown elements -- which looks like a broken apply and is a
     missing declaration (§33). */
  for (const u of template.uses || []) if (u && !uses.includes(u)) uses.push(u);
  d.uses = uses;

  const minted = new Map();
  const rebuild = (n) => {
    const fresh = node({
      ...copy(n),
      name: mintName(random),
      order: null,
      bound: n.bound ? (panelMap.get(n.bound) || n.bound) : null,
      derived: n.derived ? (transformMap.get(n.derived) || n.derived) : null,
      asserted: n.asserted ? (assertionMap.get(n.asserted) || n.asserted) : null,
      binds: n.binds ? (parameterMap.get(n.binds) || n.binds) : null,
      children: [],
    });
    minted.set(n.name, fresh.name);
    fresh.children = (n.children || []).map(rebuild);
    return fresh;
  };
  const root = rebuild(template.root);

  const parentNode = parent ? find(target.elements, parent) : null;
  if (parent && !parentNode) {
    return { ok: false, document: doc, elements: [], requests: [],
             errors: [`there is no element \`${parent}' to apply into`] };
  }
  if (parentNode && OPAQUE_KINDS.includes(parentNode.kind)) {
    return { ok: false, document: doc, elements: [], requests: [],
             errors: [`\`${parent}' is a \`${parentNode.kind}' element and has no interior to `
                    + `place anything in`] };
  }
  // Keys are assigned once, here, by the same `insert' every other placement
  // goes through -- so an applied subtree sits among its new siblings by the
  // rule they were already ordered by, and not by where it used to be.
  insert(target.elements, { parent: parentNode, after, before, writer }, root);

  const requests = (template.panels || []).map((p) => ({
    panel: panelMap.get(p.name), from: p.name, source: copy(p.source),
    parameters: (p.parameters || []).map((x) => parameterMap.get(x) || x),
  }));

  return {
    ok: true, errors: [], document: d, view: target.name,
    element: root.name,
    elements: [...minted.values()],
    names: { elements: Object.fromEntries(minted), panels: Object.fromEntries(panelMap),
             transforms: Object.fromEntries(transformMap),
             assertions: Object.fromEntries(assertionMap),
             parameters: Object.fromEntries(parameterMap) },
    requests,
    // One charge, however many requests it runs (§21.4.2, U-71): the user
    // asked for one thing.
    charge: 1,
    provenance: copy(template.source),
  };
}

/* ── mount (U-86) ─────────────────────────────────────────────────────────── */

/** Every mount in a document: the element, and what it mounts. */
export function mountsOf(doc) {
  const out = [];
  for (const v of (doc || {}).views || []) {
    walk(v.elements || [], (n) => {
      const p = n.kind === "host" ? mountedPresentation(n.host) : null;
      if (p) out.push({ view: v.name, element: n.name, presentation: p });
    });
  }
  return out;
}

/**
 * Include a whole presentation by reference.
 *
 * No lift, no template, no re-minting: the mounted presentation keeps its own
 * graph and its own names, and an edit through the mount is a new revision of
 * the source.  A given presentation is mounted in ONE place at a time -- the
 * rule a named view already follows, where there is one editor presented for
 * it -- and a second request resolves to where it already is rather than
 * making another of it.
 *
 * `loaded' is the registry: `[{presentation, at, element}]'.  Passing none
 * means nothing is known to be loaded, which is the right default for a
 * caller that has not got the store, not an assertion that nothing is.
 */
export function mount({ document: doc, presentation, scope = "document",
                        mounting = "document", view: viewName = null,
                        parent = null, after = null, before = null,
                        loaded = [], writer = null, random = Math.random } = {}) {
  const parsed = parseName(presentation);
  if (!parsed.ok) return { ok: false, errors: [parsed.reason], document: doc };
  if (parsed.form !== "presentation") {
    return { ok: false, document: doc,
             errors: [`\`${parsed.text}' names one element; a mount takes a whole presentation, `
                    + `and one element is lifted and applied instead (D-AV)`] };
  }
  const scopes = checkScopes({ mounted: scope, mounting });
  if (!scopes.ok) return { ok: false, errors: [scopes.reason], document: doc };

  const already = (loaded || []).find((m) => m.presentation === parsed.presentation);
  if (already) {
    return { ok: false, document: doc, resolveTo: already,
             errors: [`\`${parsed.presentation}' is already loaded in \`${already.at}'; a `
                    + `presentation is mounted in one place at a time, so this resolves to `
                    + `where it is`] };
  }
  const d = { ...(doc || {}) };
  d.views = [...(d.views || [])].map((v) => ({ ...v, elements: [...(v.elements || [])] }));
  const target = viewName ? d.views.find((v) => v.name === viewName) : d.views[0];
  if (!target) {
    return { ok: false, document: doc,
             errors: [`there is no view \`${viewName || "(the first)"}' to mount into`] };
  }
  const parentNode = parent ? find(target.elements, parent) : null;
  if (parent && !parentNode) {
    return { ok: false, document: doc, errors: [`there is no element \`${parent}' to mount into`] };
  }
  const element = node({ name: mintName(random), kind: "host",
                         host: mountHostValue(parsed.presentation) });
  insert(target.elements, { parent: parentNode, after, before, writer }, element);
  return { ok: true, errors: [], document: d, view: target.name,
           element: element.name, presentation: parsed.presentation };
}

/**
 * Take a mount out again.
 *
 * Named rather than left to the generic remove because taking up a revised
 * source is exactly this followed by `mount' (§21.4.1): there is no refresh,
 * and a revised source reaches an inclusion only by replacing the inclusion.
 */
export function unmount({ document: doc, element, view: viewName = null } = {}) {
  const d = { ...(doc || {}) };
  d.views = [...(d.views || [])].map((v) => ({ ...v, elements: [...(v.elements || [])] }));
  for (const v of d.views) {
    if (viewName && v.name !== viewName) continue;
    const held = index(v.elements).get(String(element));
    if (!held) continue;
    const siblings = held.parent ? held.parent.children : v.elements;
    const at = siblings.findIndex((n) => n.name === String(element));
    if (at >= 0) {
      const [gone] = siblings.splice(at, 1);
      return { ok: true, document: d, view: v.name,
               presentation: mountedPresentation(gone.host), errors: [] };
    }
  }
  return { ok: false, document: doc, errors: [`there is no mount \`${element}' here`] };
}

/* ── the fork (U-87) ──────────────────────────────────────────────────────── */

/**
 * The same document with every element name minted afresh.
 *
 * What a rename produces, and the reason it is a re-mint rather than a copy
 * of the names: a rename is the manual fork (D-AV), so the source and the
 * fork can both be open at once, and `resolve' in `dom-patch.js' is
 * document-wide.  Two presentations carrying identical names are the one
 * collision the once-only mount rule does not cover, because they are two
 * NAMES and the rule is per name.  Re-minting removes it at the only moment
 * it can be removed cheaply.
 *
 * Panels, transforms, parameters and assertions keep their names: they are
 * document-local already, nothing outside the document addresses them, and
 * changing them would break the bindings the elements carry for no gain.
 */
export function remintElements(doc, { random = Math.random } = {}) {
  const d = { ...(doc || {}) };
  const minted = new Map();
  const rebuild = (n) => {
    const fresh = node({ ...copy(n), name: mintName(random), children: [] });
    fresh.order = n.order == null ? null : String(n.order);
    minted.set(n.name, fresh.name);
    fresh.children = (n.children || []).map(rebuild);
    return fresh;
  };
  d.views = (d.views || []).map((v) => ({
    ...v, elements: (v.elements || []).map(rebuild),
  }));
  return { document: d, names: Object.fromEntries(minted) };
}

export default { parseName, printName, lift, liftWhole, apply, mount, unmount,
                 templateParts, remintElements };
