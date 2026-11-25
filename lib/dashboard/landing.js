/**
 * Where a revision landed, said out loud (U-116).
 *
 * A reader asked for a matrix to be placed in another pane, read
 * `revision 3 · presentational · applied in place', and found the page
 * exactly as it had been.  Nothing had failed: the patch parsed, the
 * classifier passed it, every operation applied, and the status line was
 * reporting all of that truthfully.  What it was not reporting is the only
 * thing the reader was about to look for — whether anything changed where
 * they were looking.
 *
 * The three ways a revision is applied and invisible:
 *
 *   1. **it moved nothing.**  A patch can be well formed, presentational and
 *      empty of effect — a `set-title' alone, a `set-attribute' writing the
 *      value that was already there, an `insert-element' of a component that
 *      renders nothing.  "Applied" is true; "changed" is not.
 *   2. **it landed in another view.**  A document has several views and one
 *      is on screen.  A change to a view that is not showing is applied,
 *      correctly, into a `<section hidden>' — and the page in front of the
 *      reader is untouched.
 *   3. **it made a view.**  A new view forces a rebuild, and the rebuild
 *      shows whichever view `state.view' names, which is not the new one.
 *      The thing that was asked for exists and is one tab away, with nothing
 *      saying so.
 *
 * None of these is a fault to be fixed by refusing it — each is a reasonable
 * thing to have asked for.  What was wrong is that the interface said
 * "applied in place" to all three and left the reader to conclude that the
 * instruction had been understood and ignored.
 *
 * This module decides what the reply says.  It is a separate module, and not
 * three lines in the pane, for two reasons: the decision is worth testing
 * without a browser, and a new export on an existing module is the shape
 * that has taken the whole interface down three times now
 * (`reference_jsui_deploy_cache`) — a new file is the one thing no cache can
 * hold a stale copy of.
 */

/** Views a document has, by name. */
const viewNames = (d) => (d?.views || []).map((v) => String(v?.name ?? ""));

/**
 * What to say about one applied revision.
 *
 * `how' is what `mountDashboard.update' answered with; `before' and `after'
 * are the document as it stood and as it now is; `ops' is the patch.
 * Returns `{short, note, level, changed}` — `short' for the status line,
 * `note' for the log beneath the page, both null when the ordinary answer is
 * the true one.
 */
export function whereItLanded(how, { before = null, after = null, ops = null } = {}) {
  const made = viewNames(after).filter((n) => !viewNames(before).includes(n));
  const shown = how?.shown == null
    ? (after?.state?.view || viewNames(after)[0] || null)
    : String(how.shown);

  /* A rebuild redraws everything, so "nothing changed here" cannot be read
     off the instruction counts — there were none.  The one case worth saying
     is the third: a view was added and the reader is not looking at it. */
  if (how?.applied !== "in-place") {
    if (made.length) {
      const which = made.map((n) => `\`${n}\``).join(", ");
      return {
        changed: true,
        short: `added ${made.length === 1 ? "view" : "views"} ${which}`,
        level: "dsh-note",
        note: `The change was put in ${made.length === 1 ? "a new view" : "new views"}, `
            + `${which}, and the page is showing \`${shown}\`. `
            + `Nothing on this tab has changed — the new `
            + `${made.length === 1 ? "one is" : "ones are"} beside it.`,
      };
    }
    return { changed: true, short: null, note: null, level: null };
  }

  const here = Number(how?.here || 0);
  const elsewhere = Number(how?.elsewhere || 0);
  const documentOps = Number(how?.ops || 0);

  if (here > 0) return { changed: true, short: null, note: null, level: null };

  if (elsewhere > 0) {
    const which = (how.views || []).filter((v) => v !== shown).map((n) => `\`${n}\``).join(", ");
    return {
      changed: true,
      short: `changed ${which || "another view"}, not the one on screen`,
      level: "dsh-note",
      note: `${elsewhere} ${elsewhere === 1 ? "element" : "elements"} changed in `
          + `${which || "another view"}, and the page is showing \`${shown}\`. `
          + `The change is there, not here.`,
    };
  }

  /* Nothing moved anywhere.  A patch of document operations only — a title,
     a stylesheet, a panel re-run — is the ordinary case of that and is not
     worth a warning; a patch that addressed elements and moved none is. */
  const addressedElements = (ops || []).some((o) => ELEMENT_OPS.includes(String(o?.op || "")));
  if (!addressedElements && documentOps) {
    return { changed: true, short: null, note: null, level: null };
  }
  return {
    changed: false,
    short: "nothing on the page changed",
    level: "dsh-warn",
    note: `The patch was accepted and applied, and no element on the page changed. `
        + `That is what happens when a change is asked for somewhere this page `
        + `cannot reach — another pane, or another presentation. A page can only `
        + `be revised in place; to put an arrangement somewhere else, lift it `
        + `(\`lift <presentation> as <name>\`) and apply it where it is wanted `
        + `(\`apply <name> to <that presentation>#\`, with the hash: it says `
        + `the presentation itself rather than an element of this one).`,
  };
}

/** The element operations, named here so this module imports nothing. */
const ELEMENT_OPS = ["insert-element", "set-attribute", "move-element",
                     "remove-element", "set-layout", "set-placement"];

export default whereItLanded;
