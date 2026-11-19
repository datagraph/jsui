/**
 * Applying a change to a live DOM — once, for both places that have to.
 *
 * Part of U-64.  The reconciler (`reconcile.js`) runs in the main document,
 * where it can import what it likes.  The page frame cannot import anything
 * at all: it is a sandboxed iframe whose whole runtime is inlined into it as
 * text (§7 of `ui-generator.md`).  Both have to apply the same change to a
 * DOM and get the same result, and a second implementation of that would be
 * a second thing to prove — which is precisely the one thing in this design
 * that is proved rather than argued, by MutationObserver, in
 * `tests/ui-reconcile.browser.mjs`.
 *
 * So the applier is written once, here, with no imports and no module scope,
 * and delivered twice: imported as a function where modules work, and
 * inlined as `SOURCE` where they do not.  `SOURCE` is generated from the
 * function itself rather than written out beside it, so the two cannot drift.
 *
 * What it takes is a list of INSTRUCTIONS, not a tree and not a patch:
 * serialisable, already resolved against the before-state, and each one
 * naming the element it is about. Computing them is `instructionsFor` in
 * `reconcile.js`, which is where the knowledge of components and layout
 * lives; this module knows only how to carry one out.
 *
 *   {do: "remove",  name}
 *   {do: "insert",  name, parent, order, html}
 *   {do: "replace", name, html}            — a kind change; children are kept
 *   {do: "move",    name, parent, order}   — the node itself, not a copy
 *   {do: "set",     name, attributes, text?, css?, inner?}
 *
 * A key absent from a `set` means "leave it"; a key present and null means
 * "clear it".  That distinction is why the instructions are built rather than
 * inferred: `{text: null}` and `{}` are different changes.
 */

/**
 * Carry out a list of instructions against ROOT.
 *
 * Self-contained by construction: every helper is inside it, and it refers to
 * nothing outside its arguments.  That is what lets `SOURCE` below be its own
 * text.
 */
export function applyInstructions(list, root, options) {
  var opts = options || {};
  var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
  var faults = [];
  var done = { removed: [], added: [], moved: [], changed: [] };

  function fault(name, reason) {
    faults.push({ name: name, reason: String(reason) });
    if (typeof opts.onFault === "function") {
      try { opts.onFault({ name: name, reason: String(reason) }); } catch (e) { /* a reporter must not fail a page */ }
    }
  }

  function nodeFor(name) {
    if (!name) return null;
    return root.querySelector('[data-ui="' + String(name).replace(/"/g, '\\"') + '"]');
  }

  /* A component may move its light-DOM children into a region of its own --
     `panel' puts them below a title bar -- and an insert that went into the
     component element instead would land beside that region rather than in
     it, and only for the children added after the first mount. */
  function contentOf(el) {
    if (!el || !el.querySelector) return el;
    var region = el.querySelector(":scope > [data-ui-content]");
    return region || el;
  }

  function placeBefore(parentEl, order, except) {
    var key = order == null ? "" : String(order);
    var kids = parentEl.children;
    for (var i = 0; i < kids.length; i += 1) {
      var child = kids[i];
      if (child === except) continue;
      if (!child.getAttribute || child.getAttribute("data-ui") == null) continue;
      var theirs = child.getAttribute("data-ui-order") || "";
      if (theirs > key) return child;
    }
    return null;
  }

  function parse(html) {
    var holder = doc.createElement("template");
    holder.innerHTML = String(html == null ? "" : html);
    return holder.content.firstElementChild;
  }

  /* textContent would take the element children with it.  A paragraph with a
     span in it is unusual in a generated page and entirely possible in a
     hand-arranged one, and losing half of it is a fault found three edits
     later. */
  function setText(el, value) {
    var text = value == null ? "" : String(value);
    for (var i = 0; i < el.childNodes.length; i += 1) {
      if (el.childNodes[i].nodeType === 3) { el.childNodes[i].nodeValue = text; return; }
    }
    if (text) el.insertBefore(doc.createTextNode(text), el.firstChild);
  }

  function parentElFor(name) {
    if (name == null) return root;
    var el = nodeFor(name);
    return el ? contentOf(el) : null;
  }

  for (var n = 0; n < (list || []).length; n += 1) {
    var ins = list[n];
    var what = ins && ins.do;
    try {
      if (what === "remove") {
        var gone = nodeFor(ins.name);
        if (gone) { gone.remove(); done.removed.push(ins.name); }
      } else if (what === "replace") {
        var old = nodeFor(ins.name);
        if (!old) { fault(ins.name, "it is not in the page"); continue; }
        var fresh = parse(ins.html);
        if (!fresh) { fault(ins.name, "the replacement was empty"); continue; }
        /* The children are moved into the replacement rather than rebuilt: a
           change of kind is a change to this element, and its subtree did not
           ask for anything. */
        while (old.firstChild) fresh.appendChild(old.firstChild);
        old.replaceWith(fresh);
        done.changed.push(ins.name);
      } else if (what === "insert") {
        var into = parentElFor(ins.parent == null ? null : ins.parent);
        if (!into) { fault(ins.name, "its container `" + ins.parent + "' is not here"); continue; }
        var made = parse(ins.html);
        if (!made) { fault(ins.name, "it built nothing"); continue; }
        into.insertBefore(made, placeBefore(into, ins.order, null));
        done.added.push(ins.name);
      } else if (what === "move") {
        var moving = nodeFor(ins.name);
        if (!moving) { fault(ins.name, "it is not in the page"); continue; }
        var target = parentElFor(ins.parent == null ? null : ins.parent);
        if (!target) { fault(ins.name, "its new container `" + ins.parent + "' is not here"); continue; }
        if (ins.order != null) moving.setAttribute("data-ui-order", String(ins.order));
        var before = placeBefore(target, ins.order, moving);
        /* insertBefore where it already is records a mutation even though it
           changes nothing, and the whole post-condition is about which
           elements the DOM reports. */
        if (moving.parentNode !== target || moving.nextElementSibling !== before) {
          target.insertBefore(moving, before);
        }
        done.moved.push(ins.name);
      } else if (what === "set") {
        var el2 = nodeFor(ins.name);
        if (!el2) { fault(ins.name, "it is not in the page"); continue; }
        var attrs = ins.attributes || {};
        for (var k in attrs) {
          if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
          var v = attrs[k];
          if (v === null || v === undefined || v === false) el2.removeAttribute(k);
          else el2.setAttribute(k, v === true ? "" : String(v));
        }
        if ("css" in ins) {
          if (ins.css) el2.setAttribute("style", ins.css);
          else el2.removeAttribute("style");
        }
        if ("text" in ins) setText(el2, ins.text);
        if ("inner" in ins) el2.innerHTML = String(ins.inner == null ? "" : ins.inner);
        done.changed.push(ins.name);
      } else if (what) {
        fault(ins.name, "`" + what + "' is not an instruction");
      }
    } catch (e) {
      fault(ins && ins.name, (e && e.message) || e);
    }
  }
  done.faults = faults;
  return done;
}

/**
 * The same function, as text, for a page that cannot import.
 *
 * Taken from the function rather than written beside it: two copies of an
 * applier whose correctness is the one thing here that is measured would be
 * two things to measure, and only one of them would be.
 */
export const SOURCE = "(function(){\n"
  + applyInstructions.toString()
  + "\nwindow.DydraDomPatch = applyInstructions;\n})();\n";
