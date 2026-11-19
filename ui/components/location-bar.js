/**
 * The location bar as the instruction channel (U-76, U-77, U-78; D-AU).
 *
 * The bar was already an instruction channel — it displays where you are,
 * takes a typed line, acts on Enter and reports back in place.  What this
 * adds is a second verb and a target: `goto' marks the navigation it did
 * before, everything else is an instruction against the thing the bar says
 * it is addressing, and the reply carries an undo because a presentational
 * change crosses no gate and would otherwise leave no trace at all.
 *
 * Why here and not in `app.js': the bar is the one surface where a wrong
 * reading of a line is expensive, and `app.js' cannot be tested.  Everything
 * that decides is in `lib/app/instructions.js' and everything that acts is a
 * callback supplied by the caller, so this module is a few hundred lines of
 * DOM and no policy.  The App wires it to the router and the registry; the
 * test wires it to two recording functions.
 */

import { parseInstruction, describeTarget } from "../../lib/app/instructions.js";

/** The ids the bar is made of.  `location-display' is load-bearing elsewhere. */
export const DISPLAY_ID = "location-display";
export const INPUT_ID = "location-input";
export const TARGET_ID = "location-target";
export const REPLY_ID = "location-reply";
/** Where an answer too long for the reply line is folded away (§34.2). */
export const DETAIL_ID = "location-detail";

const el = (doc, tag, attrs = {}, kids = []) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "dataset") { for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv; }
    else if (k === "text") n.textContent = v;
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) n.appendChild(kid);
  return n;
};

/**
 * Give the bar the two parts it did not have.
 *
 * Added rather than required of the markup so that a page rendered by an
 * older `LayoutView' — or by a test that writes the two original elements by
 * hand — still gets the whole behaviour.  The bar is the repair route; it
 * should not be the thing that needs repairing.
 */
function ensureParts(bar) {
  const doc = bar.ownerDocument;
  let targetEl = bar.querySelector(`#${TARGET_ID}`);
  if (!targetEl) {
    targetEl = el(doc, "span", { id: TARGET_ID, class: "location-target",
                                 dataset: { testid: "location-target" } });
    const input = bar.querySelector(`#${INPUT_ID}`);
    bar.insertBefore(targetEl, input || null);
  }
  let reply = bar.querySelector(`#${REPLY_ID}`);
  if (!reply) {
    reply = el(doc, "span", { id: REPLY_ID, class: "location-reply",
                              dataset: { testid: "location-reply" } });
    reply.hidden = true;
    bar.appendChild(reply);
  }
  return { targetEl, reply };
}

/**
 * Wire one bar.
 *
 * Every effect is a callback.  `instruct' is the only one that may be slow,
 * and the bar treats it as such: the input is disabled while it runs, so a
 * second Enter cannot start a second turn against a document the first one
 * is already changing.
 */
export function mountLocationBar(bar, {
  navigate = () => {},
  targets = () => [],
  instruct = null,
  arrange = null,
  path = () => "/",
  onAddress = () => {},
} = {}) {
  if (!bar) return null;
  const doc = bar.ownerDocument;
  const display = bar.querySelector(`#${DISPLAY_ID}`);
  const input = bar.querySelector(`#${INPUT_ID}`);
  if (!display || !input) return null;
  const { targetEl, reply } = ensureParts(bar);

  let addressed = null;          // the target an unprefaced line acts on
  let working = false;

  const currentPath = () => String(path() || "/");

  function showPath(p) {
    display.textContent = p;
    if (doc.activeElement !== input) input.value = p;
  }

  /**
   * What the bar says it will act on.
   *
   * Shown whenever there is one, and not only when it is unusual: the whole
   * point of the address is that the user can see what an unprefaced
   * sentence means BEFORE pressing Enter, and a target that only appears
   * once it is surprising is one nobody learns to read.
   */
  function showAddress() {
    if (!addressed) { targetEl.textContent = ""; targetEl.hidden = true; return; }
    targetEl.hidden = false;
    targetEl.textContent = `→ ${describeTarget(addressed)}`;
    targetEl.title = "what an instruction typed here will change";
  }

  /**
   * The reply element, resolved when it is used and not when it was wired.
   *
   * The chrome is redrawn in place after an arrangement changes it, which
   * replaces the bar's DOM — so the node captured at mount time is, from that
   * moment, an orphan nobody can see.  Every reply written to it after a
   * redraw was written into nothing: the successful mount, the applied
   * arrangement, the undo beside them.  Only the refusals were ever visible,
   * because a refusal returns before the redraw.
   *
   * Resolving by id at use time costs one lookup and fixes every one of them.
   * The captured node remains the fallback, because a bar that was never in
   * the document (the tests, and the figure harness) has no id to find.
   */
  const replyNode = () => doc.getElementById(REPLY_ID) || reply;

  function clearReply() {
    const node = replyNode();
    node.hidden = true;
    node.replaceChildren();
    const detail = doc.getElementById(DETAIL_ID);
    if (detail) detail.remove();
  }

  /**
   * The reply, with an undo beside it when there is something to undo.
   *
   * `undo' is a function the caller supplies with the result, not an inverse
   * the bar computes: a change the model made in four operations has no
   * inverse the bar could write, and the presentation is revisioned, so
   * putting it back is a read of the previous revision and a write of it as
   * current (D-AU, point 3).
   */
  function say(message, { undo = null, tone = "", detail = null, confirm = null } = {}) {
    clearReply();
    if (!message) return;
    const node = replyNode();
    node.hidden = false;
    node.className = `location-reply${tone ? " " + tone : ""}`;
    node.appendChild(el(doc, "span", { text: String(message) }));

    /**
     * What a turn ANSWERED, as against what it did (§34.2).
     *
     * An arrangement's reply is one sentence and fits; an answer about data
     * is prose and does not.  It is folded rather than truncated, and folded
     * rather than put somewhere else: the bar is where the question was
     * typed, and an answer that appears in another panel is an answer the
     * user has to go and find.
     */
    if (detail) {
      const box = el(doc, "div", { id: DETAIL_ID, class: "location-detail",
                                   dataset: { testid: "location-detail" } });
      box.hidden = true;
      box.appendChild(el(doc, "pre", { class: "location-detail-text", text: String(detail) }));
      const more = el(doc, "button", { type: "button", class: "location-more",
                                       dataset: { testid: "location-more" }, text: "show" });
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.textContent = box.hidden ? "show" : "hide";
      });
      node.appendChild(doc.createTextNode(" "));
      node.appendChild(more);
      /**
       * A way to keep it (§35.4).
       *
       * A report of several thousand words is written into a panel that the
       * next instruction replaces.  The run is also recorded as RDF, which is
       * the durable copy; this is the one the reader can paste into the
       * document they are actually writing, and it costs a button.
       */
      const copy = el(doc, "button", { type: "button", class: "location-more",
                                       dataset: { testid: "location-copy" }, text: "copy" });
      copy.addEventListener("click", async () => {
        try {
          await doc.defaultView.navigator.clipboard.writeText(String(detail));
          copy.textContent = "copied";
        } catch { copy.textContent = "cannot copy"; }
      });
      node.appendChild(doc.createTextNode(" "));
      node.appendChild(copy);
      (node.parentNode || bar).appendChild(box);
    }

    /**
     * The press that lets a turn run (REQ-34.2.5).
     *
     * A turn that will read a repository says which before it reads it, and
     * the saying is not a formality: the stores are named in the reply and
     * nothing is asked until this is pressed.  An interface instruction has
     * no button, because it reads nothing.
     */
    if (confirm && typeof confirm.run === "function") {
      const go = el(doc, "button", { type: "button", class: "location-confirm",
                                     dataset: { testid: "location-confirm" },
                                     text: confirm.label || "Ask" });
      /**
       * While it runs (§35.3).
       *
       * A turn that reads one repository answers in a few seconds and a
       * frozen "asking…" is honest enough.  An analysis across two is tens
       * of calls and minutes, and a line that says nothing for minutes is
       * indistinguishable from a line that has died.  So the reply is built
       * here rather than through `say': a text node that the run updates as
       * it goes, and a `stop' beside it.
       *
       * The stop is a FLAG the run reads, not an abort of the request in
       * flight: the call that is out when it is pressed is allowed to come
       * back and be recorded, and nothing further is sent.  Cancelling the
       * fetch would lose that call from the transcript while the store had
       * already done the work.
       */
      go.addEventListener("click", async () => {
        go.disabled = true;
        clearReply();
        const live = replyNode();
        live.hidden = false;
        live.className = "location-reply";
        const line = el(doc, "span", { text: confirm.working || "asking…" });
        live.appendChild(line);
        let stopped = null;
        const halt = el(doc, "button", { type: "button", class: "location-stop",
                                         dataset: { testid: "location-stop" }, text: "stop" });
        halt.addEventListener("click", () => {
          stopped = "stopped by the user";
          halt.disabled = true;
          line.textContent = "stopping — the call in flight will finish…";
        });
        live.appendChild(doc.createTextNode(" "));
        live.appendChild(halt);
        let out;
        try {
          out = await confirm.run({
            progress: (text) => { if (text && !stopped) line.textContent = String(text); },
            stopped: () => stopped,
          });
        } catch (e) { out = { ok: false, message: String(e) }; }
        say(out?.message || (out?.ok === false ? "nothing came back" : "done"),
            { undo: out?.undo || null, detail: out?.detail || null,
              tone: out?.ok === false ? "location-err" : "" });
      });
      node.appendChild(doc.createTextNode(" "));
      node.appendChild(go);
    }

    if (typeof undo === "function") {
      const button = el(doc, "button", { type: "button", class: "location-undo",
                                         dataset: { testid: "location-undo" }, text: "undo" });
      button.addEventListener("click", async () => {
        button.disabled = true;
        let out;
        try { out = await undo(); } catch (e) { out = { ok: false, message: String(e) }; }
        say(out?.message || (out?.ok === false ? "the undo failed" : "put back"),
            { tone: out?.ok === false ? "location-err" : "" });
      });
      node.appendChild(doc.createTextNode(" "));
      node.appendChild(button);
    }
  }

  async function submit(line) {
    const read = parseInstruction(line, { targets: targets() });
    switch (read.kind) {
      case "empty":
        return read;

      case "navigate":
        clearReply();
        navigate(read.path);
        return read;

      case "address": {
        addressed = read.target;
        showAddress();
        onAddress(addressed);
        say(`addressing ${describeTarget(addressed)} — type a change, or \`goto\` somewhere`);
        return read;
      }

      case "refusal":
        say(read.reason, { tone: "location-err" });
        return read;

      case "arrangement": {
        // The four arrangement verbs go down the same channel and against
        // the same addressed target as prose (U-85, D-AU), and are kept
        // apart from `instruct' for one reason: they are not asked of a
        // model.  `lift inventory#e-7k2m as stock-card' is exact, it costs
        // nothing to be sure about, and sending it to be interpreted would
        // make a deterministic operation depend on a turn that can fail.
        if (!addressed) {
          say("nothing is addressed — `goto' something first, or click into it",
              { tone: "location-err" });
          return { ...read, refused: "no target" };
        }
        if (typeof arrange !== "function") {
          say("this interface cannot arrange anything here", { tone: "location-err" });
          return { ...read, refused: "no channel" };
        }
        if (working) return { ...read, refused: "busy" };
        working = true;
        input.disabled = true;
        say(`${read.verb} — ${describeTarget(addressed)}`);
        let done;
        try { done = await arrange({ target: addressed, instruction: read }); }
        catch (e) { done = { ok: false, message: String(e) }; }
        finally { working = false; input.disabled = false; }
        say(done?.message || (done?.ok ? "done" : "nothing was changed"),
            { undo: done?.undo || null, detail: done?.detail || null,
              confirm: done?.confirm || null,
              tone: done?.ok === false ? "location-err" : "" });
        return { ...read, result: done };
      }

      case "instruct": {
        if (!addressed) {
          const open = targets();
          say(open.length
                ? `nothing is addressed — \`goto ${open[0].label}' first, or click into it`
                : "nothing is addressed, and nothing is open to address",
              { tone: "location-err" });
          return { ...read, refused: "no target" };
        }
        if (typeof instruct !== "function") {
          say("this interface cannot take instructions here", { tone: "location-err" });
          return { ...read, refused: "no channel" };
        }
        if (working) return { ...read, refused: "busy" };
        working = true;
        input.disabled = true;
        say(`asking — ${describeTarget(addressed)}`);
        let out;
        try {
          out = await instruct({ target: addressed, text: read.text });
        } catch (e) {
          out = { ok: false, message: String(e) };
        } finally {
          working = false;
          input.disabled = false;
        }
        say(out?.message || (out?.ok ? "done" : "nothing was changed"),
            { undo: out?.undo || null, detail: out?.detail || null,
              confirm: out?.confirm || null,
              tone: out?.ok === false ? "location-err" : "" });
        return { ...read, result: out };
      }

      default:
        return read;
    }
  }

  /* ── the affordance, unchanged in how it feels ── */

  showPath(currentPath());
  input.style.display = "none";
  display.style.display = "block";
  showAddress();

  const open = () => {
    input.style.display = "block";
    display.style.display = "none";
    input.focus();
    input.select();
  };
  const close = () => {
    input.style.display = "none";
    display.style.display = "block";
    input.value = display.textContent;
  };

  display.addEventListener("click", open);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const value = input.value.trim();
      // Closed first, and the line kept: an instruction takes a turn to
      // answer, and leaving the input open over it invites a second Enter
      // against a document the first one is still changing.
      input.blur();
      input.value = display.textContent;
      Promise.resolve(submit(value)).catch(() => {});
    }
    if (event.key === "Escape") input.blur();
  });

  const api = {
    submit,
    say,
    clearReply,
    setPath(p) { showPath(String(p || "/")); },
    address() { return addressed; },
    /** Take the address, by target or by id, and say so without a reply line. */
    setAddress(which) {
      const next = typeof which === "string"
        ? (targets().find((t) => t.id === which) || null) : (which || null);
      const changed = (next?.id || null) !== (addressed?.id || null);
      addressed = next;
      showAddress();
      if (changed) onAddress(addressed);
      return addressed;
    },
    /** The address survives only while its target does (U-77). */
    refresh() {
      if (addressed && !targets().some((t) => t.id === addressed.id)) {
        addressed = null;
        onAddress(null);
      }
      showAddress();
    },
  };
  bar._locationBar = api;
  return api;
}

export default mountLocationBar;
