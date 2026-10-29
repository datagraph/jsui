/**
 * The lifecycle-event table, and the collaboration table beside it.
 *
 * REQ-2.5.3, REQ-3.8.3, REQ-4.4.2 for the first; REQ-2.1.2 for the second.
 * Both were inline in `ui/pages/index.js'.  They are here because the admin
 * app shows the same events, and because a renderer that reads a field the
 * server does not send (see below) is exactly the kind of thing that should
 * be assertable without standing up the application.
 *
 * ── The column that was always empty ────────────────────────────────────────
 *
 * `format-events-json' in `spocq-server/admin.lisp' emits
 * `{timestamp, action, agent, details}'.  The table read `e.actor', which no
 * event has ever carried, under a heading of "Actor".  Every cell was blank,
 * for every account, since the tab was built — and a blank column reads as
 * "nothing recorded", not as a bug, which is why it was never reported.
 */

import { normalizeEvents, describeAction } from "../../lib/models/history.js";
import { collaborationRows } from "../../lib/models/collaboration.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const EMPTY = `<p style="color: #666; font-style: italic;">No events recorded.</p>`;

/**
 * Events as a table, newest first.
 *
 * The raw event type stays on the row (`title') and on the cell
 * (`data-action'), because `describeAction' is a translation and a reader
 * checking the interface against the record should be able to see what the
 * server actually said.
 */
export function renderHistoryTable(events, { empty = EMPTY } = {}) {
  const rows = normalizeEvents(events);
  if (rows.length === 0) return empty;
  return `
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;" data-testid="history-table">
      <thead>
        <tr style="border-bottom: 2px solid #dee2e6;">
          <th style="text-align: left; padding: 6px 8px;">Time</th>
          <th style="text-align: left; padding: 6px 8px;">Action</th>
          <th style="text-align: left; padding: 6px 8px;">Agent</th>
          <th style="text-align: left; padding: 6px 8px;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((e, i) => `
          <tr style="border-bottom: 1px solid #eee; background: ${i % 2 === 0 ? "#fff" : "#f8f9fa"};" title="${esc(e.action)}">
            <td style="padding: 4px 8px; white-space: nowrap;">${esc(e.timestamp)}</td>
            <td style="padding: 4px 8px;" data-action="${esc(e.action)}">${esc(describeAction(e.action))}</td>
            <td style="padding: 4px 8px;" data-agent="${esc(e.agent)}">${esc(e.agent)}</td>
            <td style="padding: 4px 8px; word-break: break-word;">${esc(e.details)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/**
 * The repositories an account reaches but does not own (REQ-2.1.2).
 *
 * The Access column is drawn only when the service actually said something
 * (S-5, fixed 2026-10-22).  An older service answers the identifier alone,
 * and against one of those the column is omitted entirely with a note saying
 * why -- rather than drawn and filled with a guess, which would read as
 * "read only" and be wrong in exactly the cases that matter.
 */
export function renderCollaborationTable(response, { accountName = null, basePath = "" } = {}) {
  const rows = collaborationRows(response, { accountName });
  if (rows.length === 0) {
    return `<p style="color: #666; font-style: italic;">No repositories are shared with this account.</p>`;
  }
  const withMode = rows.some((r) => r.mode);
  return `
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;" data-testid="collaboration-table">
      <thead>
        <tr style="border-bottom: 2px solid #dee2e6;">
          <th style="text-align: left; padding: 6px 8px;">Owner</th>
          <th style="text-align: left; padding: 6px 8px;">Repository</th>
          ${withMode ? `<th style="text-align: left; padding: 6px 8px;">Access</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr style="border-bottom: 1px solid #eee; background: ${i % 2 === 0 ? "#fff" : "#f8f9fa"};" data-collaboration="${esc(r.id)}">
            <td style="padding: 4px 8px;"><a href="${basePath}/account/${encodeURIComponent(r.account)}">${esc(r.account)}</a></td>
            <td style="padding: 4px 8px;"><a href="${basePath}/account/${encodeURIComponent(r.account)}/repositories/${encodeURIComponent(r.repository)}">${esc(r.repository)}</a></td>
            ${withMode ? `<td style="padding: 4px 8px;" data-mode="${esc(r.mode || "")}">${esc(r.mode || "unknown")}</td>` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${withMode ? "" : `<p style="color: #8a94a0; font-size: 11px; margin-top: 6px;">
      This service reports which repositories are shared and not whether the access
      is read or read/write.
    </p>`}
  `;
}

export default renderHistoryTable;
