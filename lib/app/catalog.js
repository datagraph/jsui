/**
 * What the interface holds, listed (§33.4).
 *
 * The four arrangement verbs each take a name the user must already have:
 * `mount <presentation>', `apply <name>', `lift <presentation>#<anchor>',
 * `unmount <element>'.  Nothing in the interface said what those names were.
 * The account page lists the account's repositories and the repository page
 * lists its views, and between them there was no page that listed a
 * presentation -- although `<account>/ui' has recorded every one of them
 * since 2026-11-01, and two functions in `ui-store.js' already read them.
 *
 * The listings were there; the reading was not.  `listPresentations' had one
 * caller, which read two hundred rows to check that a single name was among
 * them and dropped the rest -- so `mount inventorie' could answer *there is
 * no presentation named `inventorie'* while holding, at that moment, the list
 * of every name there is.  `listArrangements' had no caller outside the
 * tests.  This module is the reading, and `catalogRefusal' is the other half:
 * a refusal that names what IS there.
 *
 * Three things it will not do.
 *
 * **It carries no text** (REQ-33.4.8).  A catalog is read before anything has
 * been admitted, and a presentation has four carriers of executable text
 * (§21.3) that the U-74 admission exists to hold back.  `listArrangements'
 * already omits `ui:template' for exactly this reason; `listPresentations'
 * projects name, title, scope, graph, vocabulary and time and no body.  An
 * entry here is metadata about a thing, never the thing.
 *
 * **It does not offer what cannot be done** (REQ-33.4.5, REQ-33.4.6).  A
 * `workspace' presentation is the chrome and is never mounted; a presentation
 * is mounted in one place at a time and the registry already says where.  An
 * entry carries that verdict, so that the catalog does not invite a refusal
 * it had the facts to prevent.
 *
 * **It does not act.**  Everything here is data.  The surface that shows it
 * runs the same verb the bar runs (REQ-33.4.3), because two ways to mount a
 * presentation is one more than can be kept in step.
 */

import { listPresentations, listArrangements, listMounts } from "./ui-store.js";
import { SCOPES } from "./vocabulary.js";
import { ALL, COMPONENTS } from "./toolbox/index.js";

/** The repository every account's presentations live in. */
export const UI_REPOSITORY = "ui";

/**
 * Whose catalogs to read.
 *
 * The signed-in account's own, always; and any other account whose `ui'
 * repository is in the permitted set, because that -- and not a guess about
 * who might have shared something -- is the measurable statement that this
 * reader may read another account's presentations.
 */
export function catalogAccounts(account, permitted = []) {
  const mine = String(account || "");
  const others = (permitted || [])
    .filter((r) => r && !r.own && r.repository === UI_REPOSITORY && r.account !== mine)
    .map((r) => r.account);
  return [mine, ...[...new Set(others)].sort()].filter(Boolean);
}

/**
 * Can this presentation be mounted, and if not, why not.
 *
 * The reason is the sentence the surface shows, so it is written as one.
 */
export function mountable(entry) {
  if (!entry) return { ok: false, reason: "there is nothing there" };
  if (entry.scope === "workspace") {
    return { ok: false,
             reason: "a workspace presentation is the chrome itself; it is never mounted" };
  }
  if (!SCOPES.includes(entry.scope)) {
    return { ok: false, reason: `\`${entry.scope}' is not a scope this interface knows` };
  }
  if (entry.foreign) {
    return { ok: false,
             reason: `\`${entry.name}' belongs to ${entry.owner}; the verbs resolve a name in `
                   + `your own interface repository, so it cannot be mounted by name here` };
  }
  if (entry.mountedAt) {
    return { ok: false,
             reason: `it is already mounted in \`${entry.mountedAt}'`
                   + `${entry.mountedIn ? ` at \`${entry.mountedIn}'` : ""}; a presentation is `
                   + `mounted in one place at a time — unmount it first` };
  }
  return { ok: true, reason: null };
}

const mountIndex = (mounts) => {
  const by = new Map();
  for (const m of mounts || []) if (m && m.presentation) by.set(m.presentation, m);
  return by;
};

/**
 * The catalog of one account's `ui' repository.
 *
 * `reader' is the account signed in; `account' owns what is being listed.
 * They differ exactly when a foreign catalog is read, and the difference is
 * what `foreign' records on every entry.
 */
export async function catalogOf({ host, account, reader = null, token, limit = 200, fetchImpl } = {}) {
  const who = String(reader || account || "");
  const where = { host, account, token, fetchImpl };
  const [presented, arranged, mounted] = await Promise.all([
    listPresentations({ ...where, limit }),
    listArrangements({ ...where, limit }),
    listMounts({ ...where, limit }),
  ]);
  const errors = [];
  if (!presented.ok) errors.push(`presentations in \`${account}/ui': ${presented.error}`);
  if (!arranged.ok) errors.push(`arrangements in \`${account}/ui': ${arranged.error}`);
  // A mount registry that cannot be read is not an empty one: say so, and let
  // every entry carry "not known" rather than "not mounted".
  if (!mounted.ok) errors.push(`the mount registry in \`${account}/ui': ${mounted.error}`);
  const foreign = String(account) !== who;
  const by = mountIndex(mounted.mounts);

  const presentations = (presented.presentations || []).map((p) => {
    const m = by.get(p.name) || null;
    const entry = {
      kind: "presentation",
      name: p.name, title: p.title, scope: p.scope || "document",
      modified: p.modified || null, vocabulary: p.vocabulary || null,
      owner: String(account), foreign,
      mountsKnown: Boolean(mounted.ok),
      mountedAt: m ? m.at : null, mountedIn: m ? m.element : null,
    };
    entry.mountable = mountable(entry);
    return entry;
  });

  const arrangements = (arranged.arrangements || []).map((a) => ({
    kind: "arrangement",
    name: a.name, title: a.title,
    of: a.of || null, anchor: a.anchor || null,
    modified: a.modified || null, creator: a.creator || null,
    // The stores the template will repeat its requests against, one line per
    // store as `<host> <account>/<repository>'.  Not the query text: that is
    // the fifth carrier of executable text and stays behind the admission.
    sources: a.sources || [],
    // Applying one RUNS requests, against these stores, under the reader's
    // own credentials -- which is why a pane gates it.  The catalog states
    // the fact; it does not decide what to do about it.
    reads: (a.sources || []).length,
  }));

  return { ok: presented.ok && arranged.ok, account: String(account), reader: who,
           foreign, presentations, arrangements, errors };
}

/**
 * The whole catalog this reader may see, across every account it may read.
 *
 * One entry per name per account, own first.  A failure to read one account's
 * repository does not lose the others: the errors are collected and the rest
 * is returned, because a catalog that is empty because something was
 * unreachable looks exactly like a catalog that is empty.
 */
export async function catalog({ host, account, token, permitted = [], accounts = null,
                                limit = 200, fetchImpl } = {}) {
  const who = String(account || "");
  const read = accounts || catalogAccounts(who, permitted);
  const parts = await Promise.all(read.map((a) =>
    catalogOf({ host, account: a, reader: who, token, limit, fetchImpl })));
  const presentations = [], arrangements = [], errors = [];
  for (const part of parts) {
    presentations.push(...part.presentations);
    arrangements.push(...part.arrangements);
    errors.push(...part.errors);
  }
  const newest = (a, b) => String(b.modified || "").localeCompare(String(a.modified || ""));
  const ownFirst = (a, b) => (a.foreign === b.foreign ? newest(a, b) : (a.foreign ? 1 : -1));
  return {
    ok: errors.length === 0, reader: who, accounts: read,
    presentations: presentations.sort(ownFirst),
    arrangements: arrangements.sort(ownFirst),
    errors, at: new Date().toISOString(),
  };
}

/* ── the refusal that names what is there (REQ-33.4.4) ────────────────────── */

const quoted = (names) => names.map((n) => `\`${n}'`).join(", ");

/**
 * `there is no presentation named X' — and here is what there is.
 *
 * `limit' is stated rather than silent: a listing cut off without saying so
 * reads as the whole of a short catalog, and the user then concludes the
 * thing they are looking for does not exist.
 */
export function catalogRefusal(kind, name, entries = [], { limit = 12 } = {}) {
  const held = (entries || []).filter(Boolean);
  const head = `there is no ${kind} named \`${name}'`;
  if (!held.length) return `${head}, and this account holds none`;
  const own = held.filter((e) => !e.foreign);
  const offer = (own.length ? own : held);
  const shown = offer.slice(0, limit);
  const more = offer.length - shown.length;
  return `${head} — it may name ${quoted(shown.map((e) => e.name))}`
       + `${more > 0 ? `, and ${more} more` : ""}`;
}

/** The names, for a caller that wants to offer them its own way. */
export function namesOf(entries = []) {
  return (entries || []).filter(Boolean).map((e) => e.name);
}

/* ── the toolbox, for the user (REQ-33.4.9) ───────────────────────────────── */

/**
 * The components, as rows a person can read.
 *
 * `componentCatalog' has built this list on every prompt since U-38 and has
 * shown it to nobody but the model: the model is told the vocabulary and the
 * user is left to infer it from what the model happens to use.  Same source,
 * same manifests, no second list to keep in step -- the difference is that
 * this one carries no prompt prose and no examples-as-instructions, because
 * it is read rather than obeyed.
 */
export function componentRows({ tier = null } = {}) {
  return ALL
    .filter((c) => !c.hidden && (tier == null || c.tier <= Number(tier)))
    .map((c) => {
      const m = c.manifest || {};
      return {
        kind: "component",
        name: c.name, element: c.element, tier: c.tier,
        description: m.description || "",
        properties: Object.keys(m.properties || {}),
        events: Object.keys(m.events || {}),
        bound: c.tier >= 2,
        example: (m.examples && m.examples[0]) || null,
      };
    });
}

/** One component by name, for a detail view. */
export function componentRow(name) {
  const c = COMPONENTS[String(name || "")];
  if (!c || c.hidden) return null;
  return componentRows({}).find((r) => r.name === c.name) || null;
}

export default catalog;
