/**
 * The repositories an account may reach that it does not own (REQ-2.1.2).
 *
 * The server has had the answer all along, at
 *
 *      GET /system/accounts/{account}/collaboration   → [{"repository": "owner/name"}, …]
 *
 * which `read-collaborations' fills from the collaboration records.  Two
 * things about it are worth stating because neither is discoverable from the
 * client:
 *
 *   1. It is absent from the resource map in `admin.lisp''s own docstring,
 *      which lists `/repositories/{R}/collaboration' but not the account-level
 *      one.  That is why nothing here called it.
 *   2. It used to answer the repository IDENTIFIER and nothing else, so the
 *      interface could say WHICH repositories an account collaborates on and
 *      not whether the collaboration was read or read/write.  Fixed in the
 *      service on 2026-10-22 (S-5): each entry now carries `readable',
 *      `writable' and a one-word `mode'.  An entry WITHOUT them is still
 *      read here, because an older service answers the older shape and a
 *      client that breaks on it is worse than one that shows a blank column.
 *
 * A collaboration on a repository of one's own account is dropped: it is
 * technically recordable and it is not "indirect metadata" -- showing an
 * account its own repositories under the heading "collaborations" invites the
 * reader to think access came from somewhere it did not.
 */

const str = (x) => (x == null ? "" : String(x));

/** `"owner/name"' → `{account, repository, id}'; anything else → null. */
export function parseRepositoryId(id) {
  const text = str(id).trim().replace(/^\/+/, "");
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(text);
  if (!m) return null;
  return { account: m[1], repository: m[2], id: `${m[1]}/${m[2]}` };
}

/**
 * The access mode of one entry (S-5), from whichever of the three fields the
 * service sent.
 *
 * `mode' is the service's own one-word summary and is preferred.  The two
 * flags are read when it is absent, and an older service that sends neither
 * yields `null' -- which the table must show as unknown, never as "read".
 * Note that the JSON booleans arrive as real booleans; a string "false" would
 * be truthy, so each is compared rather than coerced.
 */
const flag = (v) => (v === true || v === "true" ? true
                   : v === false || v === "false" ? false : null);

function modeOf(entry) {
  if (!entry || typeof entry === "string") return { mode: null, readable: null, writable: null };
  const readable = flag(entry.readable);
  const writable = flag(entry.writable);
  const named = typeof entry.mode === "string" && entry.mode ? entry.mode : null;
  const mode = named
    ?? (writable === true ? "read-write"
      : readable === true ? "read"
      : readable === false && writable === false ? "none" : null);
  return { mode, readable, writable };
}

/**
 * The collaboration listing, as rows.
 *
 * Accepts the server's `[{repository: "a/b"}]' and the bare `["a/b"]' a
 * hand-written fixture is likely to use, because the shape is not stated
 * anywhere a reader of this file can check.
 */
export function collaborationRows(response, { accountName = null } = {}) {
  if (!Array.isArray(response)) return [];
  const seen = new Set();
  const rows = [];
  for (const entry of response) {
    const id = typeof entry === "string" ? entry : entry?.repository ?? entry?.id ?? null;
    const parsed = parseRepositoryId(id);
    if (!parsed || seen.has(parsed.id)) continue;
    if (accountName && parsed.account === String(accountName)) continue;   // not indirect
    seen.add(parsed.id);
    rows.push({ ...parsed, ...modeOf(entry) });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** The distinct accounts reached through collaboration — REQ-2.4.4's input. */
export function collaboratingAccounts(rows) {
  return [...new Set((rows || []).map((r) => r.account))].sort();
}

/** Where to ask. */
export function collaborationPath(accountName) {
  return `/system/accounts/${encodeURIComponent(String(accountName))}/collaboration`;
}

export default collaborationRows;
