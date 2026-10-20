/**
 * The name field, as a control over its own content.
 *
 * Attaching this to a text input makes the field refuse what a name may not
 * contain while it is being typed, and makes the whole name answerable before
 * it is submitted.  The two happen at different moments on purpose -- see
 * lib/names/name-policy.js -- and this module is only the part that touches
 * the DOM: the filtering as you type, the caret, the one-line explanation, and
 * the state of the button that would accept the name.
 *
 * Replacement rather than rejection.  A character outside [A-Za-z0-9_-] is
 * replaced by the separator, not dropped: a dropped character makes a typist
 * who was not looking at the field lose a word boundary -- "query results"
 * becomes "queryresults" -- while a replaced one leaves the shape of what was
 * typed.  One character in, one character out, so the caret stays where the
 * typist put it.
 */

import { namePolicy, loadNamePolicy, needsSanitizing } from "../../lib/names/name-policy.js";

/**
 * Take charge of INPUT.
 *
 * `kind' selects the reserved list -- "account", "repository" or "view".
 * `onState' is called with each check so a dialog can enable or disable its
 * own Create button.  Returns { check, value, destroy }.
 */
export function attachNameControl(input, { kind = "repository", message, onState } = {}) {
  if (!input) return { check: () => ({ ok: false, reason: "empty" }), value: () => "",
                       destroy: () => {} };
  const doc = input.ownerDocument || document;
  const policy = () => namePolicy();
  const sep = policy().separator || "-";

  let msgEl = message || null;
  if (!msgEl) {
    msgEl = doc.createElement("div");
    msgEl.className = "name-note";
    msgEl.dataset.testid = `${kind}-name-note`;
    msgEl.style.cssText = "font-size:11px;margin-top:4px;min-height:14px;color:#777;";
    input.after(msgEl);
  }

  const say = (text, bad) => {
    msgEl.textContent = text || "";
    msgEl.style.color = bad ? "#dc3545" : "#777";
  };

  const state = () => {
    const res = policy().check(input.value, kind);
    say(res.ok ? "" : res.message, !res.ok);
    try { onState?.(res); } catch { /* a dialog that throws must not lock the field */ }
    return res;
  };

  const onInput = () => {
    const before = input.value;
    // One for one, so the caret is where it was.  Runs and edges are tidied on
    // the way out, not here: trimming a trailing separator as it is typed
    // makes a two-word name impossible to type.
    const after = policy().sanitize(before, { collapse: false });
    if (after !== before) {
      const at = input.selectionStart;
      input.value = after;
      try { input.setSelectionRange(at, at); } catch { /* not a text input */ }
      say(`${sep === "_" ? "Underscores" : "Hyphens"} replace spaces and punctuation.`, false);
      try { onState?.(policy().check(input.value, kind)); } catch { /* as above */ }
      return;
    }
    state();
  };

  const onBlur = () => {
    const tidy = policy().sanitize(input.value, { collapse: true });
    if (tidy !== input.value) input.value = tidy;
    state();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("blur", onBlur);
  // Paste arrives as an input event, so it is already covered; what is not is
  // a value set by the page itself, which the caller can settle with check().

  return {
    check: () => { onBlur(); return state(); },
    value: () => input.value,
    note: msgEl,
    destroy: () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
    },
  };
}

/**
 * Take charge of every marked field on the page, now and later.
 *
 * A dialog built in JavaScript can attach the control itself; a field that is
 * part of a rendered page cannot, because the page is re-rendered by the
 * router and nothing holds a reference to it afterwards.  So a field says what
 * it is with `data-name-kind' and this picks it up the first time it is
 * touched -- one listener for the document, whatever the router does to the
 * markup under it.
 */
export function installNameControls(doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc || doc.__nameControlsInstalled) return;
  doc.__nameControlsInstalled = true;
  const take = (el) => {
    if (!el || el.dataset.nameBound === "true") return;
    el.dataset.nameBound = "true";
    attachNameControl(el, { kind: el.dataset.nameKind || "account" });
  };
  for (const event of ["focusin", "input"]) {
    doc.addEventListener(event, (e) => {
      const el = e.target?.closest?.("input[data-name-kind]");
      if (el) take(el);
    }, true);
  }
}

/**
 * Read the lists once per page.  Called at start-up; a control attached before
 * it finishes still sanitises, and starts refusing reserved names the moment
 * the lists arrive.
 */
export function installNamePolicy(basePath = "") {
  return loadNamePolicy({ basePath }).catch(() => namePolicy());
}

export { needsSanitizing };
export default attachNameControl;
