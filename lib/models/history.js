/**
 * Lifecycle events, as the server records them and the interface shows them.
 *
 * REQ-2.2.5, REQ-2.6.2, REQ-3.2.4, REQ-3.3.2, REQ-3.6.2, REQ-3.9.3, REQ-4.2.8,
 * REQ-4.3.9, REQ-4.5.2 -- "the system shall log X" -- are all one mechanism.
 * The server already records them: `record-lifecycle-event' in
 * `odbc/views.lisp' fires from `write-sql-account', `write-sql-repository' and
 * `write-sql-query', for :create, :update and :delete alike, and
 * `/system/accounts/.../history' reads them back.  So nothing has to be
 * emitted here.  What was missing is that the events are only PARTLY shown,
 * and that the one renderer there was read a field the server does not send.
 *
 * ── The field that was never there ──────────────────────────────────────────
 *
 * `format-events-json' (admin.lisp) emits, per event:
 *
 *      {"timestamp": …, "action": …, "agent": …, "details": …}
 *
 * and the table rendered a column headed "Actor" out of `e.actor', which no
 * event has ever carried.  Every row showed an empty cell, which reads as "no
 * agent recorded" rather than as a client bug -- the failure is invisible
 * precisely because an empty column looks like missing data.  `normalizeEvent'
 * accepts both spellings and answers one.
 *
 * ── Why an action needs translating ─────────────────────────────────────────
 *
 * The server's `make-lifecycle-event-type' composes the type as
 * {Create,Update,Delete} × {Account,Repository,Query}, so the wire carries
 * `CreateRepositoryEvent'.  "Query" there is what this interface calls a view.
 * Showing the raw token is defensible; showing "Repository created" is better,
 * and the raw token is kept beside it so that a type this interface has never
 * seen still displays instead of vanishing.
 */

/**
 * The five actions the service records, and the participle each one writes.
 *
 * `events.type' is a rails single-table-inheritance column, so the value is a
 * ruby class name: NOUN FIRST, `RepositoryClearedEvent'.  The service used to
 * compose it verb first -- `ClearRepositoryEvent' -- which matched none of
 * rails' classes; those rows exist on development hosts only and are read here
 * too, so that a development host's history still displays.
 */
export const ACTIONS = ["Created", "Updated", "Deleted", "Cleared", "Imported"];

/** The three things it records them about, and what this interface calls them. */
export const SUBJECTS = { Account: "account", Repository: "repository", Query: "view" };

/** What each participle reads as in the Action column. */
const PAST = {
  Created: "created", Updated: "modified", Deleted: "deleted",
  Cleared: "cleared", Imported: "imported into",
};

/** The verb-first spelling a development host may still hold. */
const LEGACY = { Create: "Created", Update: "Updated", Delete: "Deleted" };

const str = (x) => (x == null ? "" : String(x));

/**
 * One event, in the shape the table wants.
 *
 * `agent' first, `actor' second: the server says `agent', and an older
 * response -- or a test fixture written against the old renderer -- may say
 * `actor'.  Accepting both costs one `??' and removes a class of empty column.
 */
export function normalizeEvent(event) {
  const e = event || {};
  return {
    timestamp: str(e.timestamp ?? e.created_at ?? e.createdAt),
    action: str(e.action ?? e.type),
    agent: str(e.agent ?? e.actor ?? e.created_by ?? e.createdBy),
    details: str(e.details ?? e.event_descriptors ?? e.descriptors),
    target: str(e.target ?? ""),
  };
}

/** A list of them, newest first, with anything unreadable dropped rather than thrown. */
export function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map(normalizeEvent)
    .sort((a, b) => str(b.timestamp).localeCompare(str(a.timestamp)));
}

/**
 * `RepositoryCreatedEvent' → `{action: "Created", subject: "repository"}',
 * and the legacy `CreateRepositoryEvent' to the same thing with `legacy: true'.
 *
 * Returns nulls rather than guesses for a token that does not parse, so a
 * caller can fall back to the raw string.
 */
export function parseAction(action) {
  const text = str(action);
  // The current, rails-shaped spelling: noun then participle.
  const m = /^(Account|Repository|Query)(Created|Updated|Deleted|Cleared|Imported)Event$/
    .exec(text);
  if (m) return { action: m[2], subject: SUBJECTS[m[1]], raw: text, legacy: false };
  // The verb-first spelling written before 2026-10-23, on development hosts.
  const old = /^(Create|Update|Delete)(Account|Repository|Query)Event$/.exec(text);
  if (old) {
    return { action: LEGACY[old[1]], subject: SUBJECTS[old[2]], raw: text, legacy: true };
  }
  return { action: null, subject: null, raw: text, legacy: false };
}

/** What to put in the Action column. */
export function describeAction(action) {
  const { action: verb, subject, raw } = parseAction(action);
  if (!verb) return raw;
  const head = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;
  return `${head} ${PAST[verb]}`;
}

/** Where the events of a thing live.  One function, so three callers cannot disagree. */
export function historyPath({ account, repository = null, view = null } = {}) {
  if (!account) throw new Error("historyPath: an account is required");
  const seg = (s) => encodeURIComponent(String(s));
  if (view && repository) {
    return `/system/accounts/${seg(account)}/repositories/${seg(repository)}`
         + `/views/${seg(view)}/history`;
  }
  if (repository) return `/system/accounts/${seg(account)}/repositories/${seg(repository)}/history`;
  return `/system/accounts/${seg(account)}/history`;
}

/**
 * The filter parameters the history endpoints accept (REQ-2.5.4, REQ-3.8.4,
 * REQ-4.4.3).
 *
 * A `*' is translated to the SQL `%' the server matches with, because a user
 * typing a wildcard types the one they know from a shell, and the requirement
 * says both are supported. An empty filter yields an empty string, not "?",
 * so a caller may always concatenate.
 */
export function historyQuery({ type = null, first = null, last = null } = {}) {
  const p = new URLSearchParams();
  const t = str(type).trim();
  if (t) p.set("type", t.replace(/\*/g, "%"));
  if (str(first).trim()) p.set("first", str(first).trim());
  if (str(last).trim()) p.set("last", str(last).trim());
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Events of one action, for a caller that wants "when was this created". */
export function eventsOfAction(events, verb) {
  return normalizeEvents(events).filter((e) => parseAction(e.action).action === verb);
}

/** The timestamp of the earliest Create event, or null. */
export function createdAt(events) {
  // "Created", not "Create": `parseAction' normalises the legacy verb-first
  // spelling to the participle, so one name matches rows from either era.
  const creations = eventsOfAction(events, "Created");
  return creations.length ? creations[creations.length - 1].timestamp : null;
}

/** The timestamp of the most recent event of any kind, or null. */
export function lastEventAt(events) {
  const all = normalizeEvents(events);
  return all.length ? all[0].timestamp : null;
}

export default normalizeEvents;
