/**
 * `graph' — a node-and-edge drawing, laid out by the vendored engine.
 *
 * Tier 2 and special (§8.4).  This component computes no layout, because
 * nobody should: `vendor/graphviz' is already in the tree and already runs in
 * a scripted, network-less frame beside the display frame, and the figure
 * path already draws `kind: "dot"' figures through it.  So the component
 * emits DOT, the pane lays it out, and the SVG comes back -- ONE GRAPH
 * VOCABULARY ACROSS BOTH PATHS rather than two.
 *
 * It declares `needs: ["graphviz"]', which the validator checks against what
 * this host can provide and refuses at Gate 1 with a reason if it cannot.
 * That is the extension point: a second engine is a `vendor/' bundle, a
 * driver string and a wrapper.
 *
 * A saved copy has no pane and therefore no engine.  It says so, with the
 * DOT shown, rather than presenting an empty box -- the same honest
 * degradation §7.4 asks of a parameterised control.
 */

export const NAME = "graph";
export const ELEMENT = "dydra-graph";

export const STYLE = `
dydra-graph { display: block; }
dydra-graph svg { max-width: 100%; height: auto; }
dydra-graph pre { font-size: 11px; background: #fbfcfd; border: 1px solid #eef1f4;
  border-radius: 3px; padding: 6px 8px; overflow: auto; margin: 0; }
dydra-graph .dydra-graph-why { color: #8a5a1a; font-size: 11px; margin-bottom: 4px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-graph", class extends HTMLElement {
    static get observedAttributes() { return ["engine", "dot"]; }
    connectedCallback() { UI.accepts(this); this.draw(); }
    attributeChangedCallback() { if (this.isConnected) this.draw(); }
    /**
     * Two columns are an edge list; three add a label.  A result bound to a
     * graph is the commonest case by far and writing the DOT by hand for it
     * would be a transform the model should not have to write.
     */
    setData(value) {
      var t = UI.asTable(value);
      if (!t.rows.length) { this._dot = null; this.draw(); return; }
      var q = function (s) { return '"' + String(s == null ? "" : s).replace(/"/g, '\\"') + '"'; };
      var lines = ["digraph G {", "  rankdir=LR; node [shape=box, fontsize=10];"];
      t.rows.slice(0, 200).forEach(function (r) {
        var edge = "  " + q(r[0]) + " -> " + q(r[1]);
        if (r.length > 2 && r[2] != null && r[2] !== "") edge += " [label=" + q(r[2]) + "]";
        lines.push(edge + ";");
      });
      lines.push("}");
      this._dot = lines.join("\n");
      this.draw();
    }
    get dot() { return this._dot != null ? this._dot : this.getAttribute("dot"); }
    set dot(v) { this._dot = v; this.draw(); }
    draw() {
      var self = this;
      var source = this.dot;
      if (!source) { this.replaceChildren(UI.empty("no graph to draw")); return; }
      if (!window.dashboard || !window.dashboard.layout) {
        this.showSource("no layout engine is available here");
        return;
      }
      window.dashboard.layout(source, this.getAttribute("engine") || "dot").then(function (svg) {
        var holder = UI.el("div", {});
        /* The SVG arrives from the engine frame, which parses DOT and emits
           markup; it is inserted as markup because that is what it is.  The
           frame it lands in has an opaque origin, no network and no
           credential, which is the whole reason that is safe (D-R). */
        holder.innerHTML = String(svg);
        self.replaceChildren(holder);
        if (window.dashboard) window.dashboard.resize();
      }, function (e) {
        self.showSource(String((e && e.message) || e));
      });
    }
    showSource(why) {
      this.replaceChildren(
        UI.el("div", { class: "dydra-graph-why", text: why }),
        UI.el("pre", { text: String(this.dot || "") })
      );
      if (window.dashboard) window.dashboard.resize();
    }
  });
})();
`;

export const MANIFEST = {
  name: "graph", element: "dydra-graph", version: "1.0", tier: 2,
  description: "A node-and-edge drawing; the interface lays it out with graphviz.",
  properties: { dot: { type: "string", attribute: true,
                       description: "DOT source; or bind a two- or three-column result" },
                engine: { enum: ["dot", "neato", "fdp", "sfdp", "circo", "twopi"],
                          default: "dot", attribute: true } },
  methods: { setData: { parameters: ["table"] } }, events: {}, slots: [],
  needs: ["graphviz"],
  examples: ['<section data-bound="edges"><dydra-graph engine="dot"></dydra-graph></section>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST,
                 needs: { components: ["base"], capabilities: ["graphviz"] }, tier: 2 };
