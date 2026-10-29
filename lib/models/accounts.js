/**
 * The account listing: what a row holds, how it is ordered, and who sees it.
 *
 * REQ-2.4.1 … REQ-2.4.4.  The listing that existed showed one column -- the
 * name -- for administrators, and for everyone else a list of one.  The
 * requirement asks for four columns, ordering by any of them, and a
 * visibility rule.
 *
 * ── What the server can and cannot answer ───────────────────────────────────
 *
 * `GET /system/accounts' reaches `compute-get-accounts', which declares the
 * dimensions `(id uri title readable writable)' and then collects `(list
 * name)' -- one field per row against five declared columns.  So the response
 * carries names and nothing else, and the four columns REQ-2.4.2 asks for are
 * not in it:
 *
 *   name              from the listing
 *   creation          NOT in the listing; the accounts table has no
 *                     `created_at' either, so it comes from the account's
 *                     first CreateAccountEvent
 *   last use          NOT in the listing; derived as the most recent event
 *   repository count  NOT in the listing; one request per account
 *
 * This module therefore separates the row the listing CAN fill from the
 * fields that each cost a request, so the table can draw immediately and
 * fill in behind -- and so that the cost is visible in the code rather than
 * hidden in a loop.  The server-side fix is named in the requirements report:
 * `compute-get-accounts' should fill the dimensions it declares and add the
 * three derived fields, after which `enrichAccount' becomes dead code.
 */

import { createdAt, lastEventAt } from "./history.js";

/** The columns a row may carry, in display order. */
export const COLUMNS = [
  { key: "name", label: "Account", kind: "text" },
  { key: "created", label: "Created", kind: "time" },
  { key: "lastUsed", label: "Last use", kind: "time" },
  { key: "repositories", label: "Repositories", kind: "number" },
];

/**
 * A row from whatever the listing gave.
 *
 * The listing answers a bare string, an object with one of several name keys,
 * or an object keyed BY name -- three shapes seen from three code paths, all
 * of which have to land in one row.
 */
export function accountRow(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    return { name, created: null, lastUsed: null, repositories: null, pending: true };
  }
  const name = entry.name ?? entry.id ?? entry.friendlyId ?? entry.account ?? null;
  if (!name) return null;
  return {
    name: String(name),
    created: entry.created ?? entry.created_at ?? null,
    lastUsed: entry.lastUsed ?? entry.last_used ?? null,
    repositories: typeof entry.repositories === "number" ? entry.repositories : null,
    pending: !(typeof entry.repositories === "number"),
  };
}

/** Rows from a listing response in any of its shapes, de-duplicated by name. */
export function accountRows(response) {
  const list = Array.isArray(response)
    ? response
    : (response && typeof response === "object" ? Object.keys(response) : []);
  const seen = new Set();
  const rows = [];
  for (const entry of list) {
    const row = accountRow(entry);
    if (!row || seen.has(row.name)) continue;
    seen.add(row.name);
    rows.push(row);
  }
  return rows;
}

/**
 * The three fields the listing does not carry, from what a caller fetched.
 *
 * Kept separate from `accountRow' so that a row is never half-built: a row
 * with `pending: true' is one nothing has been fetched for yet, and the table
 * can say so rather than show a blank that reads as zero.
 */
export function enrichAccount(row, { events = null, repositories = null } = {}) {
  const r = { ...row };
  if (Array.isArray(events)) {
    r.created = createdAt(events) ?? r.created;
    r.lastUsed = lastEventAt(events) ?? r.lastUsed;
  }
  if (Array.isArray(repositories)) r.repositories = repositories.length;
  else if (typeof repositories === "number") r.repositories = repositories;
  r.pending = r.repositories == null;
  return r;
}

/**
 * REQ-2.4.3: ordered optionally by any field.
 *
 * A null sorts last whichever direction is asked for, because a row whose
 * repository count has not arrived yet is not a row with zero repositories,
 * and letting it sort as one would put every unfetched account at the top of
 * an ascending sort -- which is exactly where it will be misread.
 */
export function sortAccounts(rows, field = "name", direction = "asc") {
  const key = COLUMNS.some((c) => c.key === field) ? field : "name";
  const kind = COLUMNS.find((c) => c.key === key).kind;
  const sign = direction === "desc" ? -1 : 1;
  const cmp = (a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;            // nulls last, both directions
    if (y == null) return -1;
    if (kind === "number") return sign * (Number(x) - Number(y));
    if (kind === "time") return sign * String(x).localeCompare(String(y));
    return sign * String(x).localeCompare(String(y), undefined, { sensitivity: "base" });
  };
  return [...rows].sort((a, b) => cmp(a, b) || String(a.name).localeCompare(String(b.name)));
}

/**
 * REQ-2.4.4: who appears in the listing.
 *
 * An administrator sees everything.  Everyone else sees their own account and
 * any account that owns a repository they collaborate on -- which is the
 * client-side reading of "and any for which they are a collaborator".  The
 * server applies its own rule on top (`compute-get-accounts' lists
 * `agent-accounts'), so this narrows a response, never widens one: an account
 * named in `collaborations' that the listing did not return stays absent.
 */
export function visibleAccounts(rows, { administrator = false, accountName = null,
                                        collaborations = [] } = {}) {
  if (administrator) return [...rows];
  const allowed = new Set([accountName, ...collaborations].filter(Boolean).map(String));
  return rows.filter((r) => allowed.has(String(r.name)));
}

export default accountRows;
