/**
 * The press that writes a presentation to a file (U-122).
 *
 * The judgement is next door in `lib/app/presentation-file.js', which turns
 * a presentation into the same saved page a composed dashboard downloads to
 * and can be tested in node.  What is here is the part that needs a browser:
 * a blob, an anchor, and a click.
 *
 * Its own file rather than another export on `mount-band.js', for the reason
 * the last two were: a module that is already served link-errors in a
 * browser holding a cached copy of it the moment a fresh module imports a
 * name that copy does not have, and the whole interface goes blank.  A file
 * nobody can have cached is the exempt case.
 */

import { presentationFile } from "../../lib/app/presentation-file.js";

/**
 * Hand the browser a file.
 *
 * The object URL is revoked on a timer rather than immediately: Firefox
 * reads it after the click returns, and revoking in the same turn gives a
 * download that silently produces nothing.  Ten seconds is the figure the
 * dashboard's own download has used since it was written.
 */
export function offerFile(doc, { name, html, type = "text/html" }) {
  if (!doc?.body) return false;
  const url = doc.defaultView.URL.createObjectURL(new Blob([html], { type }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  doc.defaultView.setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 10000);
  return true;
}

/**
 * One presentation, downloaded.
 *
 * The reading is the caller's and is the same `readPresentation' the Open
 * press makes — so Download asks for exactly what Open asks for and no more,
 * and a presentation a reader may not read is refused in one place for both.
 */
export function downloadPresentation(presentation, { name, doc = null, fallback = null } = {}) {
  const target = doc || (typeof document === "undefined" ? null : document);
  if (!target) return { ok: false, error: "there is no document to save from" };
  const built = presentationFile(presentation, { name, fallback });
  if (!built.ok) return built;
  if (!offerFile(target, { name: built.name, html: built.html })) {
    return { ok: false, error: "this page could not hand the file to the browser" };
  }
  return { ok: true, message: built.message, name: built.name, source: built.source };
}

export default downloadPresentation;
