/**
 * The repositories a session may name (REQ-33.2.7, REQ-33.2.8; REQ-34.2.2).
 *
 * Two lists, read when the session begins and held for it: the account's own
 * repositories, and the ones it reaches through collaboration.  Their union is
 * the PERMITTED SET -- what a panel may name as a source (A-8, A-9) and what a
 * prompt may name as its context (A-15's second half).
 *
 * Both routes existed before this module and neither answer was kept.  The
 * account page reads `/system/accounts/{a}/repositories' to draw a list and
 * holds the rows in the page it drew; the account-level collaboration route
 * -- `GET /system/accounts/{a}/collaboration', built and tested as REQ-S-1 --
 * is read in exactly one place, when the Collaborations tab is opened, and its
 * answer is rendered into a table and dropped.  So the client has twice known
 * the whole set and twice forgotten it, and nothing downstream could ask what
 * an account may read.
 *
 * The two stay DISTINGUISHABLE (REQ-33.2.9).  A collaborated repository
 * carries the access mode the service reported -- or `null' where an older
 * service reported none, which is shown as unknown and never as "read" -- so
 * that a readable-only source is never offered where a write is meant.
 *
 * Nothing here caches across a reload.  The set is an authorization answer; a
 * stale one offers a repository the account no longer reaches, and the cost of
 * asking again is two requests per session.
 */

import { collaborationRows, collaborationPath, parseRepositoryId } from "../models/collaboration.js";

/** Where the account's own repositories are listed. */
export const repositoriesPath = (account) =>
  `/system/accounts/${encodeURIComponent(String(account))}/repositories`;

/**
 * The repositories the interface keeps for itself.
 *
 * `<account>/ui' holds the presentations, `<account>/mcp' the explorations and
 * the journal.  They are real repositories and the account may read them, so
 * they are IN the permitted set; they are marked rather than hidden, because a
 * surface offering sources to a panel wants to leave them out and a surface
 * answering "what may I name" would be lying if it did.
 */
export const INTERFACE_REPOSITORIES = Object.freeze(["ui", "mcp"]);

/** The service's own, which no panel has business reading. */
export const SYSTEM_REPOSITORIES = Object.freeze(["system"]);

const asArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.repositories)) return payload.repositories;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const nameOf = (entry) => {
  if (typeof entry === "string") return entry.trim();
  if (!entry) return "";
  return String(entry.name || entry.key || entry.id || "").trim();
};

/**
 * The account's own repositories, as permitted-set entries.
 *
 * `writable` is true because they are the account's: the token that listed
 * them is the owner's.  A collaboration says otherwise and says it per entry.
 */
export function ownRows(payload, { account } = {}) {
  const seen = new Set();
  const rows = [];
  for (const entry of asArray(payload)) {
    const repository = nameOf(entry);
    if (!repository || seen.has(repository)) continue;
    seen.add(repository);
    rows.push({
      account: String(account || ""), repository,
      id: `${account}/${repository}`,
      own: true, mode: "own", readable: true, writable: true,
      interface: INTERFACE_REPOSITORIES.includes(repository),
      system: SYSTEM_REPOSITORIES.includes(repository),
    });
  }
  return rows.sort((a, b) => a.repository.localeCompare(b.repository));
}

/** The collaborated ones, as the same kind of entry. */
export function collaboratedRows(payload, { account } = {}) {
  return collaborationRows(payload, { accountName: account }).map((r) => ({
    account: r.account, repository: r.repository, id: r.id,
    own: false, mode: r.mode, readable: r.readable, writable: r.writable,
    interface: false, system: false,
  }));
}

const getJson = async (url, token, doFetch) => {
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, body: null };
    return { ok: true, error: null, body: await res.json() };
  } catch (e) {
    return { ok: false, error: String(e), body: null };
  }
};

/**
 * Read both lists.
 *
 * One failing list does not lose the other: a collaboration route that is
 * down leaves the account's own repositories nameable, and the failure is
 * reported rather than shown as an empty collaboration -- "you collaborate on
 * nothing" and "we could not ask" are different answers and only one of them
 * is a fact.
 */
export async function loadRepositories({ host, account, token, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(host || "").replace(/\/$/, "");
  const [mine, theirs] = await Promise.all([
    getJson(`${base}${repositoriesPath(account)}`, token, doFetch),
    getJson(`${base}${collaborationPath(account)}`, token, doFetch),
  ]);
  const errors = [];
  if (!mine.ok) errors.push(`own repositories: ${mine.error}`);
  if (!theirs.ok) errors.push(`collaborations: ${theirs.error}`);
  const own = mine.ok ? ownRows(mine.body, { account }) : [];
  const collaborated = theirs.ok ? collaboratedRows(theirs.body, { account }) : [];
  return {
    ok: mine.ok && theirs.ok, account: String(account || ""),
    own, collaborated, permitted: [...own, ...collaborated], errors,
    at: new Date().toISOString(),
  };
}

/* ── held for the session ─────────────────────────────────────────────────── */

const HELD = new Map();

/** Keep what was read, so that a prompt need not re-ask on every line typed. */
export function rememberRepositories(sets) {
  if (!sets || !sets.account) return sets;
  HELD.set(sets.account, sets);
  return sets;
}

/** What was read, or `null' when the session has not read it yet. */
export function repositoriesFor(account) {
  return HELD.get(String(account || "")) || null;
}

/** Sign-out, a change of collaboration, and the tests. */
export function forgetRepositories(account) {
  HELD.delete(String(account || ""));
}

/** Read it if it has not been read, and hold it. */
export async function ensureRepositories({ host, account, token, fetchImpl } = {}) {
  const held = repositoriesFor(account);
  if (held) return held;
  return rememberRepositories(await loadRepositories({ host, account, token, fetchImpl }));
}

/* ── naming one ───────────────────────────────────────────────────────────── */

const fold = (s) => String(s || "").trim().toLowerCase();

/**
 * Which repository a name refers to.
 *
 * `account/repository' is exact and unambiguous.  A bare name is resolved
 * against the permitted set, the account's own first -- `sales' means your
 * `sales' when you have one, whoever else has one too -- and a bare name that
 * two collaborations both answer to is a refusal rather than a guess, by the
 * argument `resolveTarget' makes: the wrong store answers the question as
 * confidently as the right one, and nothing downstream can tell.
 */
export function resolveRepository(name, permitted = []) {
  const want = String(name || "").trim();
  const all = (permitted || []).filter(Boolean);
  if (!want) return { ok: false, reason: "no repository named", candidates: all };
  const qualified = parseRepositoryId(want);
  if (qualified) {
    const hit = all.find((r) => r.id === qualified.id);
    return hit ? { ok: true, repository: hit, how: "qualified" }
               : { ok: false, reason: "unknown", named: qualified.id, candidates: all };
  }
  if (/[/\s]/.test(want)) return { ok: false, reason: "not a repository name", named: want, candidates: all };
  const bare = fold(want);
  const mine = all.filter((r) => r.own && fold(r.repository) === bare);
  if (mine.length === 1) return { ok: true, repository: mine[0], how: "own" };
  const any = all.filter((r) => fold(r.repository) === bare);
  if (any.length === 1) return { ok: true, repository: any[0], how: "bare" };
  if (any.length > 1) return { ok: false, reason: "ambiguous", named: want, candidates: any };
  return { ok: false, reason: "unknown", named: want, candidates: all };
}

/** The sentence a refusal to name a repository should carry (REQ-34.2.6). */
export function repositoryRefusal(result, { limit = 12 } = {}) {
  const named = result.named ? `\`${result.named}'` : "that";
  if (result.reason === "ambiguous") {
    return `${named} names more than one repository: ${result.candidates.map((r) => r.id).join(", ")}`;
  }
  const offer = (result.candidates || []).filter((r) => !r.system).map((r) => r.id);
  const shown = offer.slice(0, limit);
  const more = offer.length - shown.length;
  if (!shown.length) return `${named} is not a repository this account may read, and no other is listed`;
  return `${named} is not a repository this account may read — it may name `
       + `${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}

/** One entry, as a line. */
export function describeRepository(r) {
  if (!r) return "";
  const how = r.own ? "own" : (r.mode || "collaboration, access unknown");
  return `${r.id} (${how})`;
}

export default loadRepositories;
