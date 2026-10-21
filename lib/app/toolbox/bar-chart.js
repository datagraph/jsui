/**
 * `bar-chart' — categories against one measure, drawn by hand.
 *
 * Tier 2.  Open question 5 of §15 asks whether the toolbox wants a charting
 * engine; this is the answer it proposes -- build bar and line by hand, which
 * is a day's work and no dependency, and count what the next three requests
 * ask for.  So: no axes library, no scales package, no legend engine.  A
 * linear scale, a baseline, and labels that are dropped rather than
 * overlapped.
 *
 * SVG rather than canvas, because an SVG survives being saved into a file and
 * read with no script, which is what `standalone' produces, and because a
 * canvas chart in a page that cannot be re-run is a blank rectangle.
 */

export const NAME = "bar-chart";
export const ELEMENT = "dydra-bar-chart";

export const STYLE = `
dydra-bar-chart { display: block; }
dydra-bar-chart svg { width: 100%; height: auto; display: block; }
dydra-bar-chart .dydra-bar { fill: #6a9ad0; }
dydra-bar-chart .dydra-bar:hover { fill: #1f4e79; }
dydra-bar-chart .dydra-axis { stroke: #d7e0ea; stroke-width: 1; }
dydra-bar-chart text { font: 10px -apple-system, "Segoe UI", Helvetica, sans-serif; fill: #5b6672; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  UI.define("dydra-bar-chart", class extends HTMLElement {
    static get observedAttributes() { return ["x", "y", "height", "orientation"]; }
    connectedCallback() { UI.accepts(this); this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    setData(value) { this._data = UI.asTable(value); this.render(); }
    get data() { return this._data || { names: [], rows: [] }; }
    set data(v) { this.setData(v); }
    render() {
      var self = this, t = this.data;
      if (!t.rows.length) { this.replaceChildren(UI.empty("no data to chart")); return; }
      var xi = this.hasAttribute("x") ? UI.column(t, this.getAttribute("x")) : 0;
      var yi = this.hasAttribute("y") ? UI.column(t, this.getAttribute("y"))
                                      : t.names.length - 1;
      if (xi < 0 || yi < 0) {
        this.replaceChildren(UI.empty("x or y names a column this result does not have"));
        return;
      }
      var H = Number(this.getAttribute("height")) || 180;
      var W = 600, padL = 46, padB = 26, padT = 8, padR = 8;
      var rows = t.rows.slice(0, 60);
      var values = rows.map(function (r) { return Number(r[yi]) || 0; });
      var top = Math.max.apply(null, values.concat([0]));
      var bottom = Math.min.apply(null, values.concat([0]));
      var span = (top - bottom) || 1;
      var plotH = H - padB - padT, plotW = W - padL - padR;
      var step = plotW / rows.length;
      var zero = padT + plotH * (top / span);

      var g = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
                           "aria-label": t.names[yi] + " by " + t.names[xi] });
      g.appendChild(svg("line", { class: "dydra-axis", x1: padL, y1: zero, x2: W - padR, y2: zero }));
      /* Three gridline labels, not a tick algorithm: the point of the chart is
         the shape, and a reader who needs the number reads the table. */
      [top, (top + bottom) / 2, bottom].forEach(function (v) {
        var y = padT + plotH * ((top - v) / span);
        var label = svg("text", { x: padL - 5, y: y + 3, "text-anchor": "end" });
        label.textContent = UI.number(Math.round(v * 100) / 100);
        g.appendChild(label);
      });
      rows.forEach(function (r, i) {
        var v = Number(r[yi]) || 0;
        var y = padT + plotH * ((top - Math.max(v, 0)) / span);
        var h = Math.max(1, plotH * (Math.abs(v) / span));
        var bar = svg("rect", { class: "dydra-bar", x: padL + i * step + step * 0.15,
                                y: y, width: Math.max(1, step * 0.7), height: h });
        var title = svg("title");
        title.textContent = String(r[xi]) + ": " + String(r[yi]);
        bar.appendChild(title);
        bar.addEventListener("click", function () {
          var o = {};
          t.names.forEach(function (n, j) { o[n] = r[j]; });
          self.dispatchEvent(new CustomEvent("select", { detail: { datum: o, index: i } }));
        });
        g.appendChild(bar);
        /* A label every nth bar, chosen so that about twelve fit: labels that
           overlap are worse than labels that are absent. */
        var every = Math.ceil(rows.length / 12);
        if (i % every === 0) {
          var lab = svg("text", { x: padL + i * step + step / 2, y: H - 8,
                                  "text-anchor": "middle" });
          lab.textContent = String(r[xi]).slice(0, 12);
          g.appendChild(lab);
        }
      });
      this.replaceChildren(g);
      if (window.dashboard) window.dashboard.resize();
    }
  });
})();
`;

export const MANIFEST = {
  name: "bar-chart", element: "dydra-bar-chart", version: "1.0", tier: 2,
  description: "Bars for one measure across categories.",
  properties: { data: { type: "table", description: "set by the bound slot, or as a property" },
                x: { type: "string", default: "the first column", attribute: true },
                y: { type: "string", default: "the last column", attribute: true },
                height: { type: "number", default: 180, attribute: true } },
  methods: { setData: { parameters: ["table"] } },
  events: { select: { detail: { datum: "object", index: "number" } } },
  slots: [], needs: [],
  examples: ['<section data-bound="sales"><dydra-bar-chart x="month" y="total"></dydra-bar-chart></section>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
