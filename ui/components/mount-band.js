/**
 * The renderer a mounted presentation gets, and the press that runs it
 * (U-86, §21.4.3).
 *
 * A mount is a `ui:Host' element whose host value is `presentation:<name>'.
 * Until something registers a renderer for that value it is an inert band
 * with a sentence on it, which is what every build that predates this module
 * still shows and is the reason the mount was spelled as a host value rather
 * than as a new term.  This module is that renderer.
 *
 * **The press is the whole design.**  §21.4.3 settles termination
 * structurally: expansion is triggered only by an act EXTERNAL to the
 * representation of the included document, and nothing in a document may be
 * interpreted as asking for an inclusion.  That is why there is no cycle
 * check anywhere in phase 8 — not a visited set, not a depth ceiling, not an
 * assertion — and it is only true if the thing that expands a mount is a
 * person pressing a button that the chrome drew.  So:
 *
 *   * the band's markup is written by `LayoutView', not by the mounted
 *     document, and the mounted document never reaches `installExpanders';
 *   * `expand' is wired to a `click' and to nothing else: no observer, no
 *     timer, no `connectedCallback', nothing that a document arriving in
 *     the band could cause to fire;
 *   * what a press draws is reconciled into the band's content region with
 *     NO host registry of its own, so a mount inside the mounted
 *     presentation is drawn inert exactly as this one was before it was
 *     pressed, and takes its own press to open.
 *
 * The last of those is what makes "a document nested in a document" safe
 * without any of the machinery that was written for it and then deleted: the
 * nesting is as deep as the reader has pressed and not one band deeper.
 *
 * **A mounted presentation is drawn, not run.**  Its elements are built by
 * the reconciler against the toolbox this build has; its panels are not
 * executed here, so an element bound to data draws empty.  That is the
 * honest reading of a mount: the mount is a reference to a presentation, the
 * data belongs to the page that owns it, and filling it would mean spending
 * the reader's grant on a page they have only just opened.  `apply' is the
 * verb that brings a request with it, and it says so at a gate first.
 */

import { COMPONENTS } from "../../lib/app/toolbox/index.js";
import { mount as mountTree } from "../../lib/app/reconcile.js";
import { walk } from "../../lib/app/tree.js";
import { workspaceViewFor } from "../../lib/app/workspace.js";

/** The attribute a band carries the mounted presentation's name in. */
export const MOUNT_ATTRIBUTE = "data-ui-mount";

/** The region a press draws into. */
export const MOUNT_CONTENT_ATTRIBUTE = "data-ui-mount-content";

const escapeAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The band, before anything has been pressed.
 *
 * It says what is mounted, that it is not drawn yet, and — the part worth
 * the words — that nothing in a page can open it.  A reader who does not
 * know that reads an unopened mount as a loading failure.
 */
export function mountBandMarkup({ name, element = null }) {
  const who = escapeAttr(name);
  return `<div class="ui-mount" ${MOUNT_ATTRIBUTE}="${who}"`
       + `${element ? ` data-ui-at="${escapeAttr(element)}"` : ""}>`
       + `<div class="ui-mount-note">`
       + `<b>${who}</b> is mounted here, and is not drawn until you open it. `
       + `Nothing in a page can open it for you.`
       + `</div>`
       + `<div class="ui-mount-actions">`
       + `<button type="button" class="ui-mount-open" data-testid="mount-expand" `
       + `data-mount="${who}">Open ‘${who}’</button>`
       + `<span class="ui-mount-status" data-testid="mount-status"></span>`
       + `</div>`
       + `<div class="ui-mount-content" ${MOUNT_CONTENT_ATTRIBUTE}></div>`
       + `</div>`;
}

/** Every component kind a tree uses, `base' first because the rest need it. */
export function kindsOf(elements) {
  const kinds = new Set();
  walk(elements || [], (n) => { if (n.kind) kinds.add(String(n.kind)); });
  return ["base", ...[...kinds].filter((k) => k !== "base")];
}

/**
 * Put the components a tree needs into a document, once each.
 *
 * The frame inlines its toolbox; this document does not have one, because
 * the chrome has never needed it before.  Marked on the `<head>' element
 * rather than in a module-level set, so a second App in a second document
 * (a test harness, an opened window) installs its own.
 */
export function installComponents(doc, kinds, components = COMPONENTS) {
  const head = doc.head || doc.documentElement;
  const done = head.__uiToolbox || (head.__uiToolbox = new Set());
  const added = [];
  for (const kind of kinds) {
    if (done.has(kind)) continue;
    const c = components[kind];
    done.add(kind);
    if (!c) continue;                       // a generic kind needs nothing
    if (c.style) {
      const s = doc.createElement("style");
      s.textContent = c.style;
      head.appendChild(s);
    }
    if (c.source) {
      const s = doc.createElement("script");
      s.textContent = c.source;
      head.appendChild(s);
    }
    added.push(kind);
  }
  return added;
}

/**
 * Draw one mounted presentation into its band.
 *
 * `page' selects the view, the way the chrome's own arrangement is selected,
 * and falls back the same way.  Nothing is fetched here: the presentation
 * arrives already read, so the one place that touches the network is the
 * caller the press reaches, where a failure can be said in a sentence.
 */
export function expandInto(band, { presentation, name, revision = null, page = "main",
                                   components = COMPONENTS } = {}) {
  if (!band) return { ok: false, error: "there is no band to draw into" };
  const region = band.querySelector(`[${MOUNT_CONTENT_ATTRIBUTE}]`) || band;
  const view = workspaceViewFor(presentation, page);
  if (!view || !(view.elements || []).length) {
    return { ok: false, error: `\`${name}' has nothing to draw` };
  }
  installComponents(band.ownerDocument, kindsOf(view.elements), components);
  mountTree(view.elements, region, { components });
  band.setAttribute("data-ui-expanded", String(revision ?? ""));
  const note = band.querySelector(".ui-mount-note");
  if (note) {
    note.textContent = `${name}${revision == null ? "" : ` · revision ${revision}`}`
                     + ` — mounted by reference. Its own data is not run here.`;
  }
  const button = band.querySelector(".ui-mount-open");
  if (button) button.hidden = true;
  return { ok: true, view: view.name, elements: (view.elements || []).length };
}

/**
 * Wire every unopened band under ROOT.
 *
 * Called after the chrome is drawn.  `expand' does the reading and reports
 * its own outcome; this writes the outcome where the press was, because a
 * band that stays shut after a press with the reason somewhere else is a
 * band the reader will press again.
 */
export function installExpanders(root, { expand } = {}) {
  if (!root || typeof expand !== "function") return 0;
  const buttons = Array.from(root.querySelectorAll(`[${MOUNT_ATTRIBUTE}] .ui-mount-open`));
  let wired = 0;
  for (const button of buttons) {
    if (button.__uiWired) continue;
    button.__uiWired = true;
    wired += 1;
    button.addEventListener("click", async () => {
      const band = button.closest(`[${MOUNT_ATTRIBUTE}]`);
      const name = button.getAttribute("data-mount");
      const status = band?.querySelector(".ui-mount-status");
      button.disabled = true;
      if (status) status.textContent = "reading…";
      let out;
      try { out = await expand({ name, band }); }
      catch (e) { out = { ok: false, error: String(e) }; }
      if (status) status.textContent = out?.ok ? "" : `could not open: ${out?.error}`;
      button.disabled = false;
    });
  }
  return wired;
}

export default installExpanders;
