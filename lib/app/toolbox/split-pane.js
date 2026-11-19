/**
 * `split-pane' — two regions and a divider the reader can drag.
 *
 * Tier 1.  Where the divider sits is the READER's and not the document's
 * (D-AR): it is kept in the page's `state' under a key of the element's own
 * name, so it survives a reopen and is never written back into the graph.  A
 * ratio in the graph would make every drag a revision of the presentation,
 * which is the clearest small example of why the definition and the session
 * are separated at all.
 */

export const NAME = "split-pane";
export const ELEMENT = "dydra-split-pane";

export const STYLE = `
dydra-split-pane { display: flex; align-items: stretch; width: 100%; }
dydra-split-pane[direction="column"] { flex-direction: column; }
dydra-split-pane > .dydra-split-a, dydra-split-pane > .dydra-split-b {
  overflow: auto; min-width: 0; min-height: 0; }
dydra-split-pane > .dydra-split-bar { flex: 0 0 6px; cursor: col-resize; background: #eef1f4;
  border-left: 1px solid #e2e6ea; border-right: 1px solid #e2e6ea; }
dydra-split-pane[direction="column"] > .dydra-split-bar { cursor: row-resize;
  border: 0; border-top: 1px solid #e2e6ea; border-bottom: 1px solid #e2e6ea; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-split-pane", class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector(":scope > .dydra-split-bar")) return;
      var self = this;
      var kids = Array.prototype.slice.call(this.children);
      /* data-ui-content on the first region: the reconciler inserts a new
         child where the existing ones are, and this component moves them. */
      var a = UI.el("div", { class: "dydra-split-a", "data-ui-content": "" });
      var b = UI.el("div", { class: "dydra-split-b" });
      if (kids[0]) a.appendChild(kids[0]);
      kids.slice(1).forEach(function (k) { b.appendChild(k); });
      var bar = UI.el("div", { class: "dydra-split-bar" });
      this.replaceChildren(a, bar, b);
      this.apply(this.ratio());
      bar.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { bar.setPointerCapture(e.pointerId); } catch (x) {}
        var column = self.getAttribute("direction") === "column";
        var move = function (ev) {
          var box = self.getBoundingClientRect();
          var span = column ? box.height : box.width;
          if (!span) return;
          var at = column ? (ev.clientY - box.top) : (ev.clientX - box.left);
          self.apply(Math.max(0.1, Math.min(0.9, at / span)));
        };
        var up = function () {
          bar.removeEventListener("pointermove", move);
          bar.removeEventListener("pointerup", up);
          if (window.dashboard && window.dashboard.state) {
            window.dashboard.state.set(self.stateKey(), self._ratio);
          }
        };
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", up);
      });
    }
    stateKey() { return "split:" + (this.getAttribute("data-ui") || this.id || "pane"); }
    ratio() {
      var held = window.dashboard && window.dashboard.state
        ? window.dashboard.state.get(this.stateKey()) : null;
      if (held != null) return Number(held);
      var declared = Number(this.getAttribute("ratio"));
      return declared > 0 && declared < 1 ? declared : 0.5;
    }
    apply(ratio) {
      this._ratio = ratio;
      var a = this.querySelector(":scope > .dydra-split-a");
      var b = this.querySelector(":scope > .dydra-split-b");
      if (!a || !b) return;
      a.style.flex = "0 0 " + (ratio * 100) + "%";
      b.style.flex = "1 1 auto";
    }
  });
})();
`;

export const MANIFEST = {
  name: "split-pane", element: "dydra-split-pane", version: "1.0", tier: 1,
  description: "Two regions and a divider the reader can drag.",
  properties: { direction: { enum: ["row", "column"], default: "row", attribute: true },
                ratio: { type: "number", default: 0.5, attribute: true,
                         description: "the first region's share; where the reader drags it is kept in page state, not here" } },
  methods: {}, events: {}, slots: ["(two children)"], needs: [],
  notes: "the divider's position is the reader's and is not written to the document",
  examples: ['<dydra-split-pane ratio="0.4"><div data-bound="parts"></div><div data-bound="detail"></div></dydra-split-pane>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 1 };
