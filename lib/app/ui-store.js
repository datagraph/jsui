/**
 * `<account>/ui': where a presentation lives.
 *
 * Implements D-AT and §9 of `interface-as-rdf-plan.md'; work items U-67,
 * U-68 and U-75.
 *
 * Until now a page was recorded as a JSON literal -- `mcp:application' on an
 * `mcp:Dashboard', in `<account>/mcp'.  That is a good record and `archive.js'
 * reads it back, but it is one literal: the store cannot be asked anything
 * about the interface's structure, two clients cannot change it without one
 * overwriting the other, and setting one attribute rewrites the whole value.
 * This is the durable form instead.
 *
 * **A separate repository, and not more graphs in `<account>/mcp'.**
 * `persist-exploration' writes by deleting an exploration's graph and posting
 * it again whole; the transcript writer already had to take a graph of its
 * own to survive that.  An interface definition must not share a repository
 * with a writer that rewrites by deletion.  Beyond that a repository is the
 * unit of replication and of access control, and a presentation that is to be
 * shared should be shareable without also exposing the transcripts, which
 * hold every payload the model read.
 *
 * **One graph per presentation.**  Reading one is one bounded query, deleting
 * one is a graph drop, sharing or replicating one is a graph-level act, and a
 * presentation that is malformed cannot make its neighbours unreadable.
 *
 * **Revisioned, so history is the store's.**  The repository is created
 * `revisioned' and a past version of a presentation is an as-of read -- not a
 * version chain built out of triples, which would be a second history to keep
 * consistent with the real one.
 *
 * On what is NOT decomposed.  Four short name lists -- a panel's parameters,
 * a transform's inputs, an assertion's inputs, the document's `uses' -- are
 * stored as one newline-joined literal each, as the grid's area template is.
 * Their ORDER is part of the document's identity, which the patch classifier
 * compares; splitting them into triples would either lose it or need an index
 * beside every link, and the question they would answer -- which transforms
 * read this panel -- is answerable from the literal.  `state' is one JSON
 * literal for the reason §10.3 gives: it holds which view is open and which
 * parameters are chosen, and a page that wants more than that wants a
 * repository and has one.
 */

import { COMPONENTS } from "./toolbox/index.js";
import { T, UI, UIA, VOCABULARY_VERSION, SCOPES, localOf, isAttributeTerm } from "./vocabulary.js";
import {
  graphFromTree, treeFromGraph, iriFor, nameFromIri, RDF_TYPE, XSD, canonicalTree,
} from "./tree.js";
import { digestOf, screenPresentation } from "./sharing.js";
import { sourcesOf, remintElements } from "./arrangement.js";

/** The repository every presentation lives in. */
export const UI_REPOSITORY = "ui";

/** The class it has to be created as, for history to be an as-of read. */
export const UI_REPOSITORY_CLASS = "revisioned";

/** `<host>/<account>/ui'. */
export function uiRepository(host, account) {
  return `${String(host || "").replace(/\/$/, "")}/${encodeURIComponent(account)}/${UI_REPOSITORY}`;
}

/** The graph one presentation occupies, which is also the base for its parts. */
export function presentationGraph(host, account, name) {
  return `${uiRepository(host, account)}/presentations/${encodeURIComponent(name)}`;
}

/** A presentation's name, from its graph. */
export const presentationName = (graph) => {
  const s = String(graph || "");
  try { return decodeURIComponent(s.slice(s.lastIndexOf("/") + 1)); } catch { return s; }
};

/* ── talking to the store ─────────────────────────────────────────────────── */

const literalOf = (value) => {
  let out = "";
  for (const ch of String(value ?? "")) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, "0").toUpperCase()}`;
    else out += ch;
  }
  return `"${out}"`;
};

/** An IRI, refused rather than escaped: a broken one is a bug, not input. */
export function iriOf(value) {
  const s = String(value ?? "");
  if (!s || /[\s<>"{}|\\^`]/.test(s)) throw new Error(`not an IRI: ${s}`);
  return `<${s}>`;
}

/** One object term, as an update writes it. */
export function termOf(o) {
  if (o == null) return literalOf("");
  if (o.iri) return iriOf(o.iri);
  const base = literalOf(o.value);
  if (o.language) return `${base}@${o.language}`;
  if (o.datatype) return `${base}^^${iriOf(o.datatype)}`;
  return base;
}

/**
 * Read a graph, keeping the term kinds.
 *
 * `sparqlQuery' in `session-log.js' flattens every binding to its value,
 * which is right for a row of results and wrong here: an element's parent is
 * an IRI, its order is a string and its gap is an integer, and a loader that
 * could not tell them apart would have to guess from the predicate.
 */
export async function readGraph({ host, account, token, graph, revision = null, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const query = `SELECT ?s ?p ?o WHERE { GRAPH ${iriOf(graph)} { ?s ?p ?o } }`;
  let endpoint = `${uiRepository(host, account)}/sparql`;
  if (revision) endpoint += `?revision=${encodeURIComponent(revision)}`;
  const at = Date.now();
  let res, text;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: query,
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, error: String(e), triples: [], ms: Date.now() - at };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    return { ok: false, status: res.status, triples: [], ms: Date.now() - at,
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  const triples = json.results.bindings.map((b) => ({
    s: b.s?.value,
    p: b.p?.value,
    o: b.o?.type === "uri"
      ? { iri: b.o.value, value: null, datatype: null }
      : { iri: null, value: b.o?.value ?? "", datatype: b.o?.datatype || null,
          language: b.o?.["xml:lang"] || null },
  }));
  return { ok: true, status: res.status, triples, ms: Date.now() - at };
}

/** Post one update.  Several statements in one body is one transaction. */
export async function writeUpdate({ host, account, token, update, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const at = Date.now();
  try {
    const res = await doFetch(`${uiRepository(host, account)}/sparql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-update",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: update,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bytes: update.length, ms: Date.now() - at,
             ...(res.ok ? {} : { error: (text || `HTTP ${res.status}`).slice(0, 400) }) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - at, error: String(e) };
  }
}

/** Triples as the body of an `INSERT DATA' over one graph. */
export function insertData(graph, triples) {
  const lines = triples.map((t) => `    ${iriOf(t.s)} ${iriOf(t.p)} ${termOf(t.o)} .`);
  return `INSERT DATA {\n  GRAPH ${iriOf(graph)} {\n${lines.join("\n")}\n  }\n}`;
}

/* ── provisioning ─────────────────────────────────────────────────────────── */

/**
 * Make sure `<account>/ui' is there, and revisioned.
 *
 * Reported rather than thrown.  An account that cannot create a repository --
 * a collaborator rather than an owner -- should be told that, not handed a
 * stack trace in place of their page.
 */
export async function ensureRepository({ host, account, token, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(host || "").replace(/\/$/, "");
  const url = `${base}/system/accounts/${encodeURIComponent(account)}/repositories`;
  try {
    const probe = await doFetch(`${uiRepository(host, account)}/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query",
                 Accept: "application/sparql-results+json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: "ASK {}",
    });
    if (probe.ok) return { ok: true, created: false };
    if (probe.status !== 404) {
      return { ok: false, created: false, status: probe.status,
               error: `\`${account}/ui' answered ${probe.status}` };
    }
  } catch (e) {
    return { ok: false, created: false, status: 0, error: String(e) };
  }
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify({ name: UI_REPOSITORY, type: UI_REPOSITORY_CLASS }),
    });
    if (res.ok || res.status === 201) return { ok: true, created: true };
    const text = await res.text();
    return { ok: false, created: false, status: res.status,
             error: (text || `HTTP ${res.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, created: false, status: 0, error: String(e) };
  }
}

/* ── a presentation, as triples ───────────────────────────────────────────── */

const lit = (v) => ({ value: String(v), datatype: null, iri: null });
const int = (n) => ({ value: String(Math.trunc(Number(n))), datatype: `${XSD}integer`, iri: null });
const when = (d) => ({ value: (d instanceof Date ? d : new Date(d)).toISOString(),
                       datatype: `${XSD}dateTime`, iri: null });
const ref = (iri) => ({ value: null, datatype: null, iri: String(iri) });
const joined = (list) => [].concat(list || []).map((x) => String(x)).join("\n");
const split = (text) => String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * A validated application document, as the triples of one presentation.
 *
 * `document' is what `validateApplication' returned -- normalised, with its
 * views already carrying element trees.  A view that is still markup is
 * written as the one opaque carrier, which is how a page recorded before any
 * of this reaches the store without being reinterpreted (D-AN).
 */
export function graphFromPresentation(document, {
  base, name, scope = "document", creator = null, created = null, modified = null,
  components = COMPONENTS,
} = {}) {
  if (!base) throw new Error("graphFromPresentation: a base IRI is required");
  if (!SCOPES.includes(scope)) throw new Error(`not a scope: ${scope}`);
  const d = document || {};
  const triples = [
    { s: base, p: RDF_TYPE, o: ref(T.Presentation) },
    { s: base, p: T.name, o: lit(name || d.id || "untitled") },
    { s: base, p: T.title, o: lit(d.title || "") },
    { s: base, p: T.scope, o: lit(scope) },
    { s: base, p: T.vocabulary, o: lit(VOCABULARY_VERSION) },
    { s: base, p: T.toolbox, o: lit(d.toolbox || "1") },
    { s: base, p: T.revision, o: int(d.revision || 1) },
  ];
  if (d.id) triples.push({ s: base, p: T.default, o: lit(d.id) });
  if (creator) triples.push({ s: base, p: T.creator, o: lit(creator) });
  if (created) triples.push({ s: base, p: T.created, o: when(created) });
  if (modified) triples.push({ s: base, p: T.modified, o: when(modified) });
  if (d.uses?.length) triples.push({ s: base, p: T.uses, o: lit(joined(d.uses)) });
  if (d.styles != null) triples.push({ s: base, p: T.styles, o: lit(d.styles) });
  if (d.script != null) {
    triples.push({ s: base, p: T.script, o: lit(d.script) });
    triples.push({ s: base, p: T.scriptDigest, o: lit(digestOf(d.script)) });
  }
  if (d.state && Object.keys(d.state).length) {
    triples.push({ s: base, p: T.state, o: lit(JSON.stringify(d.state)) });
  }
  if (d.notes) triples.push({ s: base, p: T.caption, o: lit(d.notes) });

  for (const p of d.parameters || []) {
    const s = iriFor.parameter(base, p.name);
    triples.push({ s, p: RDF_TYPE, o: ref(T.Parameter) },
                  { s, p: T.name, o: lit(p.name) },
                  { s, p: T.kind, o: lit(p.kind) });
    if (p.datatype) triples.push({ s, p: T.datatype, o: lit(p.datatype) });
    if (p.language) triples.push({ s, p: T.language, o: lit(p.language) });
    if (p.label) triples.push({ s, p: T.label, o: lit(p.label) });
    if (p.default != null) triples.push({ s, p: T.default, o: lit(p.default) });
    const dom = p.domain;
    if (dom?.values) triples.push({ s, p: T.domainValues, o: lit(joined(dom.values)) });
    if (dom?.from) triples.push({ s, p: T.domainFrom, o: ref(iriFor.panel(base, dom.from)) });
    if (dom?.column) triples.push({ s, p: T.domainColumn, o: lit(dom.column) });
    if (dom?.min != null) triples.push({ s, p: T.domainMin, o: lit(dom.min) });
    if (dom?.max != null) triples.push({ s, p: T.domainMax, o: lit(dom.max) });
  }

  for (const p of d.panels || []) {
    const s = iriFor.panel(base, p.name);
    triples.push({ s, p: RDF_TYPE, o: ref(T.Panel) },
                  { s, p: T.name, o: lit(p.name) },
                  { s, p: T.query, o: lit(p.query) },
                  { s, p: T.accept, o: lit(p.accept) });
    if (p.form) triples.push({ s, p: T.form, o: lit(p.form) });
    if (p.caption) triples.push({ s, p: T.caption, o: lit(p.caption) });
    if (p.title) triples.push({ s, p: T.title, o: lit(p.title) });
    if (p.parameters?.length) triples.push({ s, p: T.parameters, o: lit(joined(p.parameters)) });
    // Where this panel's request goes, when that is not where the page is
    // open (U-84).  An applied component repeats the original's requests
    // against whatever source the inclusion had, under the READER's
    // credentials, so the source has to survive the save -- it is read on
    // every re-run, which is what makes it different from provenance.
    if (p.source && (p.source.host || p.source.account || p.source.repository)) {
      triples.push({ s, p: T.source,
                     o: lit(joined([p.source.host || "", p.source.account || "",
                                    p.source.repository || ""])) });
    }
  }

  for (const t of d.transforms || []) {
    const s = iriFor.transform(base, t.name);
    triples.push({ s, p: RDF_TYPE, o: ref(T.Transform) },
                  { s, p: T.name, o: lit(t.name) },
                  { s, p: T.body, o: lit(t.body) });
    if (t.inputs?.length) triples.push({ s, p: T.inputs, o: lit(joined(t.inputs)) });
    if (t.caption) triples.push({ s, p: T.caption, o: lit(t.caption) });
  }

  for (const a of d.assertions || []) {
    const s = iriFor.assertion(base, a.id);
    triples.push({ s, p: RDF_TYPE, o: ref(T.Assertion) },
                  { s, p: T.name, o: lit(a.id) },
                  { s, p: T.text, o: lit(a.text) },
                  { s, p: T.kind, o: lit(a.kind) });
    if (a.inputs?.length) triples.push({ s, p: T.inputs, o: lit(joined(a.inputs)) });
    // What the inputs held when the assertion was written: the record that
    // lets a reader be told the prose is older than the data it cites.
    if (a.inputDigests) triples.push({ s, p: T.digests, o: lit(JSON.stringify(a.inputDigests)) });
  }

  for (const v of d.views || []) {
    triples.push({ s: base, p: T.view, o: ref(iriFor.view(base, v.name)) });
    const elements = v.elements && v.elements.length
      ? v.elements
      : legacyCarrier(v.html, v.name);
    triples.push(...graphFromTree({ name: v.name, title: v.title, elements },
                                  { base, components }));
  }
  return triples;
}

/** A markup view, as the one opaque element that carries it (D-AN). */
function legacyCarrier(html, viewName) {
  const markup = String(html || "");
  if (!markup.trim()) return [];
  return [{ name: `e-html-${String(viewName).replace(/[^a-z0-9-]/gi, "").toLowerCase() || "main"}`,
            kind: "html", order: "a", html: markup, attributes: {}, children: [] }];
}

/**
 * `digestOf' now lives in `sharing.js' and is re-exported here.
 *
 * It moved because what it is for turned out to matter: written into a
 * presentation as `ui:scriptDigest' it is CHANGE DETECTION, against no
 * adversary, and a shared presentation has one.  The approval a reader gives
 * is recorded against `fingerprint' (SHA-256 over every executable part),
 * not against this (U-74).
 */

/* ── reading one back ─────────────────────────────────────────────────────── */

/**
 * The document a presentation's triples describe.
 *
 * Refuses outright when the vocabulary is ahead of this build (U-75).  Not
 * "read as much as possible": a presentation written against a later
 * vocabulary may use terms this build drops on the floor, and what that
 * produces is a page that looks finished and is missing something -- the
 * failure the toolbox version check already exists to prevent.
 */
export function presentationFromGraph(triples, { base, components = COMPONENTS } = {}) {
  const bySubject = new Map();
  for (const t of triples || []) {
    let held = bySubject.get(t.s);
    if (!held) { held = new Map(); bySubject.set(t.s, held); }
    held.set(t.p, [...(held.get(t.p) || []), t.o]);
  }
  const one = (s, p) => bySubject.get(s)?.get(p)?.[0] ?? null;
  const text = (s, p) => { const o = one(s, p); return o == null ? null : (o.iri ?? o.value); };
  const all = (s, p) => bySubject.get(s)?.get(p) || [];
  const typed = (type) => [...bySubject.keys()].filter((s) =>
    (bySubject.get(s).get(RDF_TYPE) || []).some((o) => o.iri === type));

  const root = base && bySubject.has(base) ? base : typed(T.Presentation)[0];
  if (!root) {
    return { ok: false, errors: ["the graph holds no presentation"], warnings: [], document: null, meta: null };
  }
  const vocabulary = text(root, T.vocabulary) || VOCABULARY_VERSION;
  // A presentation from a LATER interface is read, and what this build does
  // not understand is noted and skipped (`VOCABULARY_VERSION').  The note is
  // the whole of the mechanism: a half-read page that does not say so looks
  // finished and is missing something, which is what the old refusal was
  // defending against -- but refusing it outright meant a page written by a
  // newer client could not be opened at all, by anyone behind it, which is
  // the worse of the two failures and the one that cannot be worked around.
  const later = Number(vocabulary) > Number(VOCABULARY_VERSION);
  const earlier = Number(vocabulary) < Number(VOCABULARY_VERSION);
  const versionNotes = later
    ? [`this presentation was written against interface vocabulary ${vocabulary}; this `
     + `interface has version ${VOCABULARY_VERSION}, so anything newer than it understands `
     + `is shown as unavailable rather than drawn`]
    : [];

  const parameters = typed(T.Parameter).map((s) => {
    const dom = {};
    if (one(s, T.domainValues)) dom.values = split(text(s, T.domainValues));
    if (one(s, T.domainFrom)) dom.from = nameFromIri(text(s, T.domainFrom), "pan-");
    if (one(s, T.domainColumn)) dom.column = text(s, T.domainColumn);
    if (one(s, T.domainMin)) dom.min = Number(text(s, T.domainMin));
    if (one(s, T.domainMax)) dom.max = Number(text(s, T.domainMax));
    return {
      name: text(s, T.name), kind: text(s, T.kind) || "literal",
      datatype: text(s, T.datatype), language: text(s, T.language),
      label: text(s, T.label), default: text(s, T.default),
      domain: Object.keys(dom).length ? dom : null,
    };
  });

  const panels = typed(T.Panel).map((s) => {
    const [h, a, r] = split(text(s, T.source));
    return {
      name: text(s, T.name), query: text(s, T.query), accept: text(s, T.accept),
      form: text(s, T.form), caption: text(s, T.caption), title: text(s, T.title),
      parameters: split(text(s, T.parameters)),
      // Absent for every panel written before U-84, which is the ordinary
      // case: no source means the panel runs where the page runs.
      source: (h || a || r) ? { host: h || null, account: a || null, repository: r || null }
                            : null,
    };
  });

  const transforms = typed(T.Transform).map((s) => ({
    name: text(s, T.name), body: text(s, T.body),
    inputs: split(text(s, T.inputs)), caption: text(s, T.caption),
  }));

  const assertions = typed(T.Assertion).map((s) => {
    let digests = null;
    const written = text(s, T.digests);
    if (written) { try { digests = JSON.parse(written); } catch { digests = null; } }
    return {
      id: text(s, T.name), text: text(s, T.text), kind: text(s, T.kind),
      inputs: split(text(s, T.inputs)), inputDigests: digests,
    };
  });

  const { views, warnings } = treeFromGraph(triples, { base: root, components });
  // The declaration order the validator depends on: a presentation lists its
  // views, and the graph has no order of its own.
  const declared = all(root, T.view).map((o) => nameFromIri(o.iri, "v-"));
  const byName = new Map(views.map((v) => [v.name, v]));
  const ordered = [...declared.map((n) => byName.get(n)).filter(Boolean),
                   ...views.filter((v) => !declared.includes(v.name))];

  const stateText = text(root, T.state);
  let state = {};
  if (stateText) { try { state = JSON.parse(stateText); } catch { warnings.push("`state' did not parse and was dropped"); } }

  const document = {
    id: text(root, T.default) || text(root, T.name),
    revision: Number(text(root, T.revision)) || 1,
    title: text(root, T.title) || "",
    toolbox: text(root, T.toolbox) || "1",
    uses: split(text(root, T.uses)),
    parameters, panels, transforms, assertions,
    views: ordered.map((v) => ({ name: v.name, title: v.title,
                                 elements: canonicalTree(v.elements) })),
    styles: text(root, T.styles),
    script: text(root, T.script),
    state,
    notes: text(root, T.caption),
  };
  const meta = {
    name: text(root, T.name), scope: text(root, T.scope) || "document",
    // `later' is what a caller passes on as `lenient' to `validateApplication'
    // and what the chrome shows as a mark on the page.
    vocabulary, later, earlier, creator: text(root, T.creator),
    created: text(root, T.created), modified: text(root, T.modified),
    scriptDigest: text(root, T.scriptDigest),
  };
  return { ok: true, document, meta, warnings: [...versionNotes, ...warnings], errors: [] };
}

/* ── the operations ───────────────────────────────────────────────────────── */

/** Every presentation in the catalogue, newest first. */
export async function listPresentations({ host, account, token, limit = 100, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const query = `PREFIX ui: <${UI}>
SELECT ?presentation ?name ?title ?scope ?modified ?graph ?vocabulary
WHERE {
  ?presentation a ui:Presentation ;
                ui:name ?name .
  OPTIONAL { ?presentation ui:title      ?title }
  OPTIONAL { ?presentation ui:scope      ?scope }
  OPTIONAL { ?presentation ui:modified   ?modified }
  OPTIONAL { ?presentation ui:graph      ?graph }
  OPTIONAL { ?presentation ui:vocabulary ?vocabulary }
}
LIMIT ${Number(limit) || 100}`;
  let res, text;
  try {
    res = await doFetch(`${uiRepository(host, account)}/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query",
                 Accept: "application/sparql-results+json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: query,
    });
    text = await res.text();
  } catch (e) { return { ok: false, status: 0, error: String(e), presentations: [] }; }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    return { ok: false, status: res.status, presentations: [],
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  const presentations = json.results.bindings.map((b) => ({
    uri: b.presentation?.value,
    name: b.name?.value,
    title: b.title?.value || b.name?.value || "(untitled)",
    scope: b.scope?.value || "document",
    modified: b.modified?.value || null,
    graph: b.graph?.value || b.presentation?.value,
    vocabulary: b.vocabulary?.value || null,
  }));
  presentations.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
  return { ok: true, status: res.status, presentations };
}

/**
 * One presentation, at HEAD or at a past revision (U-68), screened for
 * whoever is about to read it (U-74).
 *
 * `account' owns the repository; `reader' is the account signed in.  They
 * are the same in every path built before this one, and `reader' defaults
 * to `account' so that those paths keep their behaviour exactly -- a
 * default of `null' would have made every existing caller read its OWN
 * pages as foreign, which is the kind of change that gets a security
 * measure turned off.
 *
 * `admission' is what `readAdmission' returned: the reader's own record
 * that they have agreed to run this author's code, at a stated fingerprint.
 * Passing none means none has been given.
 */
export async function readPresentation({
  host, account, token, name, revision = null, components = COMPONENTS, fetchImpl,
  reader = undefined, admission = null, crypto,
} = {}) {
  const graph = presentationGraph(host, account, name);
  const read = await readGraph({ host, account, token, graph, revision, fetchImpl });
  if (!read.ok) return { ...read, document: null, meta: null, errors: [read.error] };
  if (!read.triples.length) {
    return { ok: false, status: read.status, document: null, meta: null, warnings: [],
             errors: [`there is no presentation named \`${name}'`] };
  }
  const built = presentationFromGraph(read.triples, { base: graph, components });
  if (!built.ok) return { ...built, status: read.status, graph, revision, ms: read.ms };
  const assumed = reader === undefined;
  const screened = await screenPresentation({
    document: built.document, meta: built.meta, owner: account,
    reader: assumed ? account : reader, admission,
    ...(crypto ? { crypto } : {}),
  });
  // The default is fail-OPEN, which is the one place in U-74 that is, and it
  // is recorded rather than left to be inferred: every caller written before
  // this phase reads its own account's pages, and a default of `null' would
  // have made all of them foreign overnight.  `assumedOwner' is how a caller
  // -- or a test -- can tell that nobody actually said who was reading.
  return { ...built, document: screened.document,
           sharing: { ...screened, assumedOwner: assumed },
           status: read.status, graph, revision, ms: read.ms };
}

/**
 * Write one presentation: the graph and its catalogue entry, in one request.
 *
 * `DROP SILENT' then `INSERT DATA' rather than a computed difference.  A
 * whole-presentation save is the coarse operation -- it is what "save this
 * page" means -- and the element operations (U-64) are what writes a change
 * as a change.  Both statements go in one body so that the graph is never
 * seen empty by a reader, which matters now that another client may be
 * reading it.
 */
export async function writePresentation({
  host, account, token, name, document, scope = "document", creator = null,
  created = null, now = () => new Date(), components = COMPONENTS, fetchImpl,
} = {}) {
  const graph = presentationGraph(host, account, name);
  const modified = now();
  let triples;
  try {
    triples = graphFromPresentation(document, {
      base: graph, name, scope, creator, created: created || modified, modified, components,
    });
  } catch (e) { return { ok: false, status: 0, graph, error: String(e) }; }

  const entry = [
    { s: graph, p: RDF_TYPE, o: ref(T.Presentation) },
    { s: graph, p: T.name, o: lit(name) },
    { s: graph, p: T.title, o: lit(document?.title || "") },
    { s: graph, p: T.scope, o: lit(scope) },
    { s: graph, p: T.vocabulary, o: lit(VOCABULARY_VERSION) },
    { s: graph, p: T.graph, o: ref(graph) },
    { s: graph, p: T.modified, o: when(modified) },
  ];
  if (creator) entry.push({ s: graph, p: T.creator, o: lit(creator) });
  if (created) entry.push({ s: graph, p: T.created, o: when(created) });

  const update = [
    `DROP SILENT GRAPH ${iriOf(graph)}`,
    insertData(graph, triples),
    `DELETE WHERE { ${iriOf(graph)} ?p ?o }`,
    `INSERT DATA {\n${entry.map((t) => `  ${iriOf(t.s)} ${iriOf(t.p)} ${termOf(t.o)} .`).join("\n")}\n}`,
  ].join(" ;\n");

  const written = await writeUpdate({ host, account, token, update, fetchImpl });
  return { ...written, graph, name, triples: triples.length };
}

/** Remove one presentation, graph and catalogue entry together. */
export async function deletePresentation({ host, account, token, name, fetchImpl } = {}) {
  const graph = presentationGraph(host, account, name);
  const update = [
    `DROP SILENT GRAPH ${iriOf(graph)}`,
    `DELETE WHERE { ${iriOf(graph)} ?p ?o }`,
  ].join(" ;\n");
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })), graph, name };
}

/** The repository's revisions, newest first: the history of every presentation. */
export async function listRevisions({ host, account, token, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(host || "").replace(/\/$/, "");
  const url = `${base}/system/accounts/${encodeURIComponent(account)}`
            + `/repositories/${UI_REPOSITORY}/revisions`;
  try {
    const res = await doFetch(url, {
      headers: { Accept: "text/plain", ...(token ? { Authorization: "Bearer " + token } : {}) },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, revisions: [], error: text.slice(0, 200) };
    return { ok: true, status: res.status,
             revisions: text.trim().split("\n").map((r) => r.trim()).filter(Boolean) };
  } catch (e) { return { ok: false, status: 0, revisions: [], error: String(e) }; }
}

/**
 * Put a presentation back the way it was at a revision (U-68).
 *
 * Read as of, write as now.  Reverting is a new revision and not a rewind:
 * the history between is still there, which is what a user who reverts by
 * mistake needs and what a shared presentation requires -- someone else may
 * have read the version being undone.
 */
export async function revertPresentation({
  host, account, token, name, revision, scope = "document", creator = null,
  components = COMPONENTS, fetchImpl, now = () => new Date(),
} = {}) {
  const was = await readPresentation({ host, account, token, name, revision, components, fetchImpl });
  if (!was.ok) return { ok: false, graph: was.graph, errors: was.errors, revision };
  const written = await writePresentation({
    host, account, token, name, document: was.document,
    scope: was.meta?.scope || scope, creator: creator || was.meta?.creator,
    created: was.meta?.created, components, fetchImpl, now,
  });
  return { ...written, revertedFrom: revision };
}

/* ── admissions: the reader's own record of whose code they will run ──────── */

/**
 * Where an admission is written: the READER's `ui' repository, default graph.
 *
 * Not in the presentation's own graph, and not in the author's repository,
 * for a reason that is close to the whole point of U-74: an approval is a
 * statement the reader makes about the author, and a store the author can
 * write is not somewhere it can be kept.  Putting it in the reader's own
 * `ui' also means it replicates and is revisioned with everything else the
 * reader owns, and that revoking it is an ordinary delete.
 *
 * The subject is the foreign presentation's graph IRI, which is global and
 * stable; `ui:of' records the author's account name separately because it is
 * what the reader is shown and a graph IRI is not.
 */
export const admissionIri = (graph) => String(graph);

/** What the reader has agreed to run from one presentation, if anything. */
export async function readAdmission({
  host, reader, token, graph, fetchImpl,
} = {}) {
  if (!host || !reader || !graph) return { ok: true, admission: null, status: 0 };
  const query = `PREFIX ui: <${UI}>
SELECT ?fingerprint ?admitted ?of
WHERE {
  ${iriOf(graph)} a ui:Admission ;
                  ui:fingerprint ?fingerprint .
  OPTIONAL { ${iriOf(graph)} ui:admitted ?admitted }
  OPTIONAL { ${iriOf(graph)} ui:of       ?of }
}
LIMIT 1`;
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let res, text;
  try {
    res = await doFetch(`${uiRepository(host, reader)}/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query",
                 Accept: "application/sparql-results+json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: query,
    });
    text = await res.text();
  } catch (e) { return { ok: false, status: 0, admission: null, error: String(e) }; }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    // An unreadable admission store is NOT an admission.  Failing open here
    // would mean that breaking the reader's own repository is how you get
    // your code run in it.
    return { ok: false, status: res.status, admission: null,
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  const b = json.results.bindings[0];
  if (!b) return { ok: true, status: res.status, admission: null };
  return { ok: true, status: res.status,
           admission: { graph, fingerprint: b.fingerprint?.value || null,
                        at: b.admitted?.value || null, of: b.of?.value || null } };
}

/**
 * Record that the reader will run this author's code, at this fingerprint.
 *
 * Refuses a fingerprint that is absent or not a SHA-256 — 64 hex digits —
 * rather than storing whatever it was handed.  The one way this mechanism
 * fails quietly is by recording an approval against something weak, and the
 * check costs a regular expression.
 */
export async function admitPresentation({
  host, reader, token, graph, fingerprint, of = null, fetchImpl, now = () => new Date(),
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(fingerprint || ""))) {
    return { ok: false, status: 0,
             error: "an admission needs a SHA-256 fingerprint; this interface could not "
                  + "compute one, so nothing has been recorded" };
  }
  const at = now();
  const triples = [
    { s: graph, p: RDF_TYPE, o: ref(T.Admission) },
    { s: graph, p: T.fingerprint, o: lit(fingerprint) },
    { s: graph, p: T.admitted, o: when(at) },
  ];
  if (of) triples.push({ s: graph, p: T.of, o: lit(of) });
  const update = [
    `DELETE WHERE { ${iriOf(graph)} ?p ?o }`,
    `INSERT DATA {\n${triples.map((t) => `  ${iriOf(t.s)} ${iriOf(t.p)} ${termOf(t.o)} .`).join("\n")}\n}`,
  ].join(" ;\n");
  const written = await writeUpdate({ host, account: reader, token, update, fetchImpl });
  return { ...written, graph, fingerprint, at: at.toISOString() };
}

/** Take it back.  An ordinary delete, because an admission is ordinary data. */
export async function withdrawAdmission({ host, reader, token, graph, fetchImpl } = {}) {
  const update = `DELETE WHERE { ${iriOf(graph)} ?p ?o }`;
  return { ...(await writeUpdate({ host, account: reader, token, update, fetchImpl })), graph };
}

/** Everything the reader has admitted, so it can be reviewed and revoked. */
export async function listAdmissions({ host, reader, token, limit = 200, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const query = `PREFIX ui: <${UI}>
SELECT ?graph ?fingerprint ?admitted ?of
WHERE {
  ?graph a ui:Admission ; ui:fingerprint ?fingerprint .
  OPTIONAL { ?graph ui:admitted ?admitted }
  OPTIONAL { ?graph ui:of       ?of }
}
LIMIT ${Number(limit) || 200}`;
  let res, text;
  try {
    res = await doFetch(`${uiRepository(host, reader)}/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query",
                 Accept: "application/sparql-results+json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: query,
    });
    text = await res.text();
  } catch (e) { return { ok: false, status: 0, admissions: [], error: String(e) }; }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    return { ok: false, status: res.status, admissions: [],
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  const admissions = json.results.bindings.map((b) => ({
    graph: b.graph?.value, fingerprint: b.fingerprint?.value,
    at: b.admitted?.value || null, of: b.of?.value || null,
  }));
  admissions.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return { ok: true, status: res.status, admissions };
}

/**
 * Open somebody else's presentation: read the admission, then the page.
 *
 * One call, because the two halves are only correct together and a caller
 * that forgot the first would get an unscreened document with no indication
 * that anything was missing.  An admission store that could not be read
 * yields no admission and the warning that says why -- never a page with its
 * code running.
 */
export async function openPresentation({
  host, account, token, name, reader, revision = null, components = COMPONENTS,
  fetchImpl, crypto,
} = {}) {
  const graph = presentationGraph(host, account, name);
  let admission = null;
  const warnings = [];
  if (reader && String(reader).toLowerCase() !== String(account).toLowerCase()) {
    const held = await readAdmission({ host, reader, token, graph, fetchImpl });
    if (held.ok) admission = held.admission;
    else warnings.push(`your admissions could not be read (${held.error}); `
                     + `nothing in this page will run`);
  }
  const read = await readPresentation({ host, account, token, name, revision, components,
                                        fetchImpl, reader, admission,
                                        ...(crypto ? { crypto } : {}) });
  return { ...read, warnings: [...(read.warnings || []), ...warnings], admission };
}

/** What changed between two revisions of one presentation, element by element. */
export async function comparePresentations({
  host, account, token, name, from, to = null, components = COMPONENTS, fetchImpl,
} = {}) {
  const [a, b] = await Promise.all([
    readPresentation({ host, account, token, name, revision: from, components, fetchImpl }),
    readPresentation({ host, account, token, name, revision: to, components, fetchImpl }),
  ]);
  if (!a.ok || !b.ok) {
    return { ok: false, errors: [...(a.errors || []), ...(b.errors || [])] };
  }
  const views = new Map();
  for (const v of a.document.views) views.set(v.name, { before: v.elements, after: [] });
  for (const v of b.document.views) {
    const held = views.get(v.name) || { before: [], after: [] };
    held.after = v.elements; views.set(v.name, held);
  }
  return { ok: true, from, to, views: [...views.entries()].map(([name, { before, after }]) => ({ name, before, after })) };
}

/* ── the arrangement catalogue (U-83) ─────────────────────────────────────── */

/**
 * Where one reusable arrangement is recorded.
 *
 * Beside the presentation entries, in the same default graph, so that
 * listing the catalogue is one query and an arrangement replicates and is
 * revisioned with everything else the account owns.
 */
export const arrangementIri = (host, account, name) =>
  `${uiRepository(host, account)}/arrangements/${encodeURIComponent(name)}`;

/** One SELECT against the account's own `ui' repository. */
async function select({ host, account, token, query, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let res, text;
  try {
    res = await doFetch(`${uiRepository(host, account)}/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query",
                 Accept: "application/sparql-results+json",
                 ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: query,
    });
    text = await res.text();
  } catch (e) { return { ok: false, status: 0, rows: [], error: String(e) }; }
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error body is not JSON */ }
  if (!res.ok || !json?.results?.bindings) {
    return { ok: false, status: res.status, rows: [],
             error: (text || `HTTP ${res.status}`).slice(0, 400) };
  }
  return { ok: true, status: res.status, rows: json.results.bindings };
}

/**
 * Record a template under a name.
 *
 * The template travels as one JSON literal rather than as triples.  It is
 * read back whole, by one reader, and never queried part-way: making it
 * triples would buy a query nobody asks and cost a second serialisation of
 * the element tree, which is the thing most likely to drift from `tree.js'.
 * What IS kept as triples is everything a listing shows -- the name, what it
 * was lifted from, and the sources its requests name -- so the catalogue can
 * be listed, and screened, WITHOUT reading the templates (U-88).
 */
export async function writeArrangement({
  host, account, token, name, template, title = null, creator = null,
  fetchImpl, now = () => new Date(),
} = {}) {
  const subject = arrangementIri(host, account, name);
  const at = now();
  const sources = sourcesOf(template)
    .map((s) => (s ? `${s.host || ""} ${s.account || ""}/${s.repository || ""}`.trim() : ""))
    .filter(Boolean);
  const triples = [
    { s: subject, p: RDF_TYPE, o: ref(T.Arrangement) },
    { s: subject, p: T.name, o: lit(name) },
    { s: subject, p: T.title, o: lit(title || name) },
    { s: subject, p: T.of, o: lit(template?.source?.presentation || "") },
    { s: subject, p: T.template, o: lit(JSON.stringify(template)) },
    { s: subject, p: T.modified, o: when(at) },
  ];
  if (template?.source?.element) {
    triples.push({ s: subject, p: T.anchor, o: lit(template.source.element) });
  }
  if (template?.source?.revision != null) {
    triples.push({ s: subject, p: T.revision, o: lit(String(template.source.revision)) });
  }
  if (sources.length) triples.push({ s: subject, p: T.source, o: lit(joined(sources)) });
  if (creator) triples.push({ s: subject, p: T.creator, o: lit(creator) });
  const update = [
    `DELETE WHERE { ${iriOf(subject)} ?p ?o }`,
    `INSERT DATA {\n${triples.map((t) => `  ${iriOf(t.s)} ${iriOf(t.p)} ${termOf(t.o)} .`).join("\n")}\n}`,
  ].join(" ;\n");
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })), uri: subject, name };
}

/**
 * The catalogue, listable without reading the templates.
 *
 * `ui:template' is deliberately not projected.  A listing is shown before
 * anything has been admitted, and a template carries the author's query text
 * (§21.3's fifth carrier); putting it in the listing would disclose what the
 * admission exists to hold back.
 */
export async function listArrangements({ host, account, token, limit = 200, fetchImpl } = {}) {
  const query = `PREFIX ui: <${UI}>
SELECT ?arrangement ?name ?title ?of ?anchor ?modified ?source ?creator
WHERE {
  ?arrangement a ui:Arrangement ; ui:name ?name .
  OPTIONAL { ?arrangement ui:title    ?title }
  OPTIONAL { ?arrangement ui:of       ?of }
  OPTIONAL { ?arrangement ui:anchor   ?anchor }
  OPTIONAL { ?arrangement ui:modified ?modified }
  OPTIONAL { ?arrangement ui:source   ?source }
  OPTIONAL { ?arrangement ui:creator  ?creator }
}
LIMIT ${Number(limit) || 200}`;
  const got = await select({ host, account, token, query, fetchImpl });
  if (!got.ok) return { ...got, arrangements: [] };
  const arrangements = got.rows.map((b) => ({
    uri: b.arrangement?.value,
    name: b.name?.value,
    title: b.title?.value || b.name?.value,
    of: b.of?.value || null,
    anchor: b.anchor?.value || null,
    modified: b.modified?.value || null,
    creator: b.creator?.value || null,
    sources: (b.source?.value || "").split("\n").filter(Boolean),
  }));
  arrangements.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
  return { ok: true, status: got.status, arrangements };
}

/** One arrangement, template and all. */
export async function readArrangement({ host, account, token, name, fetchImpl } = {}) {
  const subject = arrangementIri(host, account, name);
  const query = `PREFIX ui: <${UI}>
SELECT ?template ?of ?anchor ?revision ?creator
WHERE {
  ${iriOf(subject)} a ui:Arrangement ; ui:template ?template .
  OPTIONAL { ${iriOf(subject)} ui:of       ?of }
  OPTIONAL { ${iriOf(subject)} ui:anchor   ?anchor }
  OPTIONAL { ${iriOf(subject)} ui:revision ?revision }
  OPTIONAL { ${iriOf(subject)} ui:creator  ?creator }
}
LIMIT 1`;
  const got = await select({ host, account, token, query, fetchImpl });
  if (!got.ok) return { ...got, template: null };
  const b = got.rows[0];
  if (!b) return { ok: false, status: got.status, template: null,
                   error: `there is no arrangement named \`${name}'` };
  let template = null;
  try { template = JSON.parse(b.template.value); }
  catch (e) { return { ok: false, status: got.status, template: null,
                       error: `the arrangement \`${name}' is not readable: ${e}` }; }
  return { ok: true, status: got.status, template, uri: subject,
           creator: b.creator?.value || null };
}

/** Remove one. */
export async function deleteArrangement({ host, account, token, name, fetchImpl } = {}) {
  const subject = arrangementIri(host, account, name);
  const update = `DELETE WHERE { ${iriOf(subject)} ?p ?o }`;
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })), uri: subject, name };
}

/* ── where an applied component's requests go (U-84) ──────────────────────── */

/**
 * Where one apply is recorded: which arrangement went into which page.
 *
 * PROVENANCE, and nothing else (§21.4.4).  Nothing reads this to decide
 * anything -- the thing an applied component actually needs, the source its
 * requests run against, is on the panel itself (`ui:source'), because it is
 * read on every re-run and must travel with the page rather than beside it.
 * That division is the point: a field consulted at run time and a field kept
 * for the record are different fields, and a template whose sources were
 * treated as provenance could not be repeated at all.
 *
 * It goes where admissions go, in the reader's own catalogue, so that the
 * question "where did this come from" stays answerable by query without
 * putting an answer nobody consults into every presentation graph.
 */
export const applicationIri = (host, account, presentation, panel) =>
  `${uiRepository(host, account)}/applications/${encodeURIComponent(presentation)}`
  + `/${encodeURIComponent(panel)}`;

/**
 * Record what an apply just placed.
 *
 * Written AFTER the presentation, by the caller, because the panel names are
 * only settled once the apply has minted them.  A record left behind by a
 * panel that was later deleted is harmless: nothing consults it.
 */
export async function recordApplication({
  host, account, token, presentation, arrangement = null, requests = [],
  fetchImpl, now = () => new Date(),
} = {}) {
  const at = now();
  const written = [];
  const statements = [];
  for (const r of requests || []) {
    if (!r?.panel) continue;
    const subject = applicationIri(host, account, presentation, r.panel);
    const s = r.source || {};
    const triples = [
      { s: subject, p: RDF_TYPE, o: ref(T.Application) },
      { s: subject, p: T.at, o: lit(presentation) },
      { s: subject, p: T.of, o: lit(r.panel) },
      { s: subject, p: T.source, o: lit(joined([s.host || "", s.account || "", s.repository || ""])) },
      { s: subject, p: T.modified, o: when(at) },
    ];
    if (arrangement) triples.push({ s: subject, p: T.name, o: lit(arrangement) });
    statements.push(`DELETE WHERE { ${iriOf(subject)} ?p ?o }`);
    statements.push(`INSERT DATA {\n${triples.map((t) => `  ${iriOf(t.s)} ${iriOf(t.p)} ${termOf(t.o)} .`).join("\n")}\n}`);
    written.push({ panel: r.panel, uri: subject });
  }
  if (!statements.length) return { ok: true, status: 0, written: [] };
  const update = statements.join(" ;\n");
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })), written };
}

/**
 * What was applied into this presentation, and from which arrangement.
 *
 * The sources are reported too, as they were at the time of the apply, but
 * the panel's own `ui:source' is what a re-run uses -- this is the record,
 * not the instruction.
 */
export async function readApplications({ host, account, token, presentation, fetchImpl } = {}) {
  const query = `PREFIX ui: <${UI}>
SELECT ?panel ?source ?name
WHERE {
  ?application a ui:Application ; ui:at ${termOf(lit(presentation))} ; ui:of ?panel .
  OPTIONAL { ?application ui:source ?source }
  OPTIONAL { ?application ui:name   ?name }
}`;
  const got = await select({ host, account, token, query, fetchImpl });
  if (!got.ok) return { ...got, sources: {} };
  const sources = {};
  for (const b of got.rows) {
    if (!b?.panel?.value) continue;
    const [h, a, r] = String(b.source?.value || "").split("\n");
    sources[b.panel.value] = { host: h || null, account: a || null, repository: r || null,
                               arrangement: b.name?.value || null };
  }
  return { ok: true, status: got.status, sources };
}

/** Forget them: what a delete of the presentation leaves behind otherwise. */
export async function forgetApplications({ host, account, token, presentation, fetchImpl } = {}) {
  const update = `PREFIX ui: <${UI}>
DELETE { ?a ?p ?o }
WHERE { ?a a ui:Application ; ui:at ${termOf(lit(presentation))} ; ?p ?o }`;
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })), presentation };
}

/* ── the mount registry (U-86) ────────────────────────────────────────────── */

/** Where the record of one presentation's mount lives. */
export const mountIri = (host, account, presentation) =>
  `${uiRepository(host, account)}/mounts/${encodeURIComponent(presentation)}`;

/**
 * Claim the single mount of a presentation.
 *
 * `INSERT … WHERE NOT EXISTS' rather than read-then-write, because the thing
 * being enforced is a uniqueness constraint and a read followed by a write is
 * two clients both finding it free.  The store decides; this reports what the
 * store did, and `took' false means somebody else has it.
 */
export async function claimMount({
  host, account, token, presentation, at, element = null, fetchImpl, now = () => new Date(),
} = {}) {
  const subject = mountIri(host, account, presentation);
  const stamp = now();
  const update = `PREFIX ui: <${UI}>
INSERT {
  ${iriOf(subject)} a ui:Mount ;
    ui:of ${termOf(lit(presentation))} ;
    ui:at ${termOf(lit(at))} ;
    ${element ? `ui:name ${termOf(lit(element))} ;\n    ` : ""}ui:modified ${termOf(when(stamp))} .
}
WHERE {
  FILTER NOT EXISTS { ${iriOf(subject)} a ui:Mount }
}`;
  const written = await writeUpdate({ host, account, token, update, fetchImpl });
  if (!written.ok) return { ...written, took: false, uri: subject };
  const held = await readMount({ host, account, token, presentation, fetchImpl });
  const took = Boolean(held.ok && held.mount && held.mount.at === String(at)
                       && (!element || held.mount.element === String(element)));
  return { ...written, took, uri: subject, mount: held.mount || null };
}

/** Where this presentation is loaded, if it is. */
export async function readMount({ host, account, token, presentation, fetchImpl } = {}) {
  const subject = mountIri(host, account, presentation);
  const query = `PREFIX ui: <${UI}>
SELECT ?at ?name ?modified
WHERE {
  ${iriOf(subject)} a ui:Mount ; ui:at ?at .
  OPTIONAL { ${iriOf(subject)} ui:name     ?name }
  OPTIONAL { ${iriOf(subject)} ui:modified ?modified }
}
LIMIT 1`;
  const got = await select({ host, account, token, query, fetchImpl });
  if (!got.ok) return { ...got, mount: null };
  const b = got.rows[0];
  if (!b) return { ok: true, status: got.status, mount: null };
  return { ok: true, status: got.status,
           mount: { presentation, at: b.at?.value || null,
                    element: b.name?.value || null, modified: b.modified?.value || null } };
}

/** Everything currently loaded: what `mount' in `arrangement.js' is given. */
export async function listMounts({ host, account, token, limit = 200, fetchImpl } = {}) {
  const query = `PREFIX ui: <${UI}>
SELECT ?mount ?of ?at ?name ?modified
WHERE {
  ?mount a ui:Mount ; ui:of ?of ; ui:at ?at .
  OPTIONAL { ?mount ui:name     ?name }
  OPTIONAL { ?mount ui:modified ?modified }
}
LIMIT ${Number(limit) || 200}`;
  const got = await select({ host, account, token, query, fetchImpl });
  if (!got.ok) return { ...got, mounts: [] };
  return { ok: true, status: got.status,
           mounts: got.rows.map((b) => ({
             uri: b.mount?.value, presentation: b.of?.value, at: b.at?.value,
             element: b.name?.value || null, modified: b.modified?.value || null })) };
}

/**
 * Give it up.
 *
 * Taking up a revised source is `releaseMount' then `claimMount' -- the
 * replacement §21.4.1 describes -- and not a refresh, which is why there is
 * no third function here.
 */
export async function releaseMount({ host, account, token, presentation, fetchImpl } = {}) {
  const subject = mountIri(host, account, presentation);
  const update = `DELETE WHERE { ${iriOf(subject)} ?p ?o }`;
  return { ...(await writeUpdate({ host, account, token, update, fetchImpl })),
           uri: subject, presentation };
}

/* ── the rename, which is the fork (U-87) ─────────────────────────────────── */

/**
 * Copy a presentation under a new name, and its view with it.
 *
 * A presentation and the view it presents share a name (D-AV), so renaming
 * one without the other would leave a presentation presenting nothing.  The
 * two halves cannot be one revision, because the view lives in another
 * repository: this reports both outcomes rather than pretending otherwise,
 * and writes the presentation FIRST so that a half-done rename leaves a page
 * that can be looked at rather than a view nothing presents.
 *
 * The copy is not the original with a different label: every element name is
 * minted afresh (`remintElements'), because the fork and its source can both
 * be open at once and `resolve' is document-wide.
 *
 * The original is left alone.  A rename that deleted it would make the one
 * irreversible operation in this phase the one a user reaches for when they
 * are least sure -- `deletePresentation' is there for when they are.
 */
export async function renamePresentation({
  host, account, token, from, to, scope = "document", creator = null,
  repository = null, copyView = null, components = COMPONENTS, fetchImpl,
  random = Math.random, now = () => new Date(),
} = {}) {
  const read = await readPresentation({ host, account, token, name: from,
                                        components, fetchImpl });
  if (!read.ok) {
    return { ok: false, from, to, presentation: read, view: null,
             errors: read.errors || [read.error] };
  }
  const existing = await readGraph({ host, account, token,
                                     graph: presentationGraph(host, account, to), fetchImpl });
  if (existing.ok && existing.triples.length) {
    return { ok: false, from, to, presentation: null, view: null,
             errors: [`there is already a presentation named \`${to}'`] };
  }
  const { document: forked, names } = remintElements(read.document, { random });
  const written = await writePresentation({
    host, account, token, name: to, document: forked,
    scope: read.meta?.scope || scope, creator, now, components, fetchImpl,
  });
  if (!written.ok) return { ok: false, from, to, presentation: written, view: null,
                            errors: [written.error] };
  let view = null;
  if (copyView && repository) {
    view = await copyView({ host, account, token, repository, from, to, fetchImpl });
  }
  return { ok: Boolean(written.ok && (!copyView || !repository || view?.ok)),
           from, to, presentation: written, view, names,
           errors: view && !view.ok ? [`the presentation was copied to \`${to}' but its view `
                                      + `was not: ${view.error}`] : [] };
}

export { UI, UIA, VOCABULARY_VERSION, digestOf };
