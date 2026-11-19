/**
 * The catalog of presentations, arrangements and components (§33.4).
 *
 * The account page lists the account's repositories; the repository page
 * lists its views; and until now there was nowhere that listed the things the
 * four arrangement verbs take.  A user who had not written down the name of a
 * presentation had no way to find it, and the one refusal they would meet --
 * *there is no presentation named X* -- was issued by code that had the whole
 * list in its hand.
 *
 * So this is the third listing, in the place the other two are, and it is
 * deliberately the same kind of thing: names, what each one is, when it last
 * changed, and what can be done with it.  The doing is not reimplemented
 * here (REQ-33.4.3): the buttons type the verb into the location bar and
 * submit it, so the catalog cannot drift from the bar, and anything the bar
 * refuses the catalog refuses in the same words.
 *
 * It carries no text from any presentation (REQ-33.4.8).  The two store
 * listings it reads already withhold the carriers -- `ui:template' is not
 * projected, and a presentation's script, styles and queries are not in the
 * catalog query at all -- so what is shown here is metadata about a thing and
 * never the thing.  A catalog is read before anything has been admitted.
 */

import { catalog, componentRows } from "../../lib/app/catalog.js";
import { ensureRepositories } from "../../lib/app/repositories.js";
import { WORKSPACE_NAME } from "../../lib/app/workspace.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A timestamp as a date, or nothing.  The hour is noise in a listing. */
const day = (t) => (t ? String(t).slice(0, 10) : "");

const NOTE = "color:#666;font-style:italic;";

function presentationRow(p) {
  const where = !p.mountsKnown ? "—"
    : p.mountedAt ? `in <code>${esc(p.mountedAt)}</code>${p.mountedIn ? ` at <code>${esc(p.mountedIn)}</code>` : ""}`
    : "not mounted";
  const verb = p.mountedAt ? (p.mountedIn ? `unmount ${p.mountedIn}` : null) : `mount ${p.name}`;
  const act = p.foreign
    ? `<span style="${NOTE}" title="${esc(p.mountable.reason || "")}">${esc(p.owner)}'s</span>`
    : (verb && (p.mountable.ok || p.mountedAt)
        ? `<button type="button" class="catalog-verb" data-verb="${esc(verb)}"
             data-testid="catalog-verb-${esc(p.name)}">${esc(verb.split(" ")[0])}</button>`
        : `<span style="${NOTE}" title="${esc(p.mountable.reason || "")}">—</span>`);
  return `
    <tr data-testid="catalog-presentation-${esc(p.name)}">
      <td><code>${esc(p.name)}</code></td>
      <td>${esc(p.title && p.title !== p.name ? p.title : "")}</td>
      <td>${esc(p.scope)}</td>
      <td>${where}</td>
      <td>${esc(day(p.modified))}</td>
      <td style="text-align:right;">${act}</td>
    </tr>`;
}

function arrangementRow(a) {
  const from = a.of ? `${esc(a.of)}${a.anchor ? `#${esc(a.anchor)}` : ""}` : "—";
  // What applying it would read, under the reader's own credentials.
  const runs = a.reads
    ? `${esc(a.sources.join("; "))}`
    : `<span style="${NOTE}">no requests</span>`;
  return `
    <tr data-testid="catalog-arrangement-${esc(a.name)}">
      <td><code>${esc(a.name)}</code></td>
      <td>${esc(a.title && a.title !== a.name ? a.title : "")}</td>
      <td>${from}</td>
      <td>${runs}</td>
      <td>${esc(day(a.modified))}</td>
      <td style="text-align:right;">
        <button type="button" class="catalog-verb" data-verb="apply ${esc(a.name)}"
          data-testid="catalog-apply-${esc(a.name)}">apply</button></td>
    </tr>`;
}

function componentRow(c) {
  return `
    <tr data-testid="catalog-component-${esc(c.name)}">
      <td><code>${esc(c.name)}</code></td>
      <td><code>&lt;${esc(c.element)}&gt;</code></td>
      <td>${esc(c.description)}</td>
      <td>${c.bound ? "bound to data" : "layout"}</td>
    </tr>`;
}

const table = (head, rows, empty) => (rows.length
  ? `<table class="catalog-table" style="width:100%;border-collapse:collapse;font-size:12px;">
       <thead><tr>${head.map((h) => `<th style="text-align:left;padding:2px 6px 2px 0;border-bottom:1px solid #ddd;">${esc(h)}</th>`).join("")}</tr></thead>
       <tbody>${rows.join("")}</tbody></table>`
  : `<p style="${NOTE}">${esc(empty)}</p>`);

/** The catalog as HTML, from a reading of the store. */
export function renderCatalog(read, { components = [] } = {}) {
  const errors = read.errors.length
    ? `<p style="color:#b91c1c;font-size:11px;">${read.errors.map(esc).join("<br>")}</p>` : "";
  return `
    ${errors}
    <h4 style="margin:6px 0 2px;">Presentations</h4>
    ${table(["Name", "Title", "Scope", "Mounted", "Changed", ""],
            read.presentations.map(presentationRow),
            "This account has no presentations yet. One is written the first time "
            + "an instruction changes the interface.")}
    <h4 style="margin:12px 0 2px;">Arrangements</h4>
    ${table(["Name", "Title", "Lifted from", "Would read", "Changed", ""],
            read.arrangements.map(arrangementRow),
            "No arrangement has been lifted yet. `lift <presentation>#<element> as <name>' "
            + "makes one.")}
    <h4 style="margin:12px 0 2px;">Components</h4>
    <p style="${NOTE}font-size:11px;margin:2px 0 4px;">The toolbox a generated page may
      use. The model is given this list on every request; it is here because you are
      entitled to the same vocabulary.</p>
    ${table(["Name", "Element", "What it is", "Kind"], components.map(componentRow), "none")}
  `;
}

/**
 * Fill one box with the catalog, and wire its buttons to the location bar.
 *
 * The buttons do not call `arrangeWorkspace'.  They address the workspace and
 * submit the line a user would have typed, which is the same path, the same
 * refusals and the same reply -- including the undo.
 */
export async function renderCatalogInto(box, { app, accountName } = {}) {
  if (!box) return null;
  const auth = app?.state?.getAuthContext?.(accountName) || {};
  box.innerHTML = `<p style="${NOTE}">Reading ${esc(accountName)}/ui…</p>`;
  const sets = await ensureRepositories({ host: auth.host, account: accountName,
                                          token: auth.token });
  const read = await catalog({ host: auth.host, account: accountName, token: auth.token,
                               permitted: sets.permitted });
  box.innerHTML = renderCatalog(read, { components: componentRows() });
  for (const button of box.querySelectorAll(".catalog-verb")) {
    button.addEventListener("click", async () => {
      const bar = app?.locationBar;
      if (!bar) return;
      button.disabled = true;
      bar.setAddress(WORKSPACE_NAME);
      try { await bar.submit(button.dataset.verb); }
      finally { button.disabled = false; }
      // What the verb did changes what the catalog says: a mount is now
      // somewhere, an unmount is nowhere.  Read it again rather than guess.
      await renderCatalogInto(box, { app, accountName });
    });
  }
  return read;
}

export default renderCatalogInto;
