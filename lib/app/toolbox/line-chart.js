/**
 * `line-chart' — one or more measures against an ordered first column.
 *
 * Tier 2, and the same argument as `bar-chart': hand-drawn SVG, a linear
 * scale, no engine.  What it adds is several series, because a line chart
 * with one series is usually a bar chart that wanted to be smaller, and the
 * case that actually recurs is two measures against the same months.
 */

export const NAME = "line-chart";
export const ELEMENT = "dydra-line-chart";

export const STYLE = `
dydra-line-chart { display: block; }
dydra-line-chart svg { width: 100%; height: auto; display: block; }
dydra-line-chart path { fill: none; stroke-width: 1.6; }
dydra-line-chart .dydra-s0 { stroke: #1f4e79; }
dydra-line-chart .dydra-s1 { stroke: #c76b6b; }
dydra-line-chart .dydra-s2 { stroke: #2d662d; }
dydra-line-chart .dydra-s3 { stroke: #8a5a1a; }
dydra-line-chart .dydra-axis { stroke: #d7e0ea; stroke-width: 1; }
dydra-line-chart text { font: 10px -apple-system, "Segoe UI", Helvetica, sans-serif; fill: #5b6672; }
dydra-line-chart .dydra-legend { font-size: 11px; color: #5b6672; display: flex; gap: 12px;
  flex-wrap: wrap; padding-top: 3px; }
dydra-line-chart .dydra-legend i { display: inline-block; width: 10px; height: 2px;
  vertical-align: middle; margin-right: 4px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var NS = "http://www.w3.org/2000/svg";
  var COLOURS = ["#1f4e79", "#c76b6b", "#2d662d", "#8a5a1a"];
  function svg(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  UI.define("dydra-line-chart", class extends HTMLElement {
    static get observedAttributes() { return ["x", "y", "height"]; }
    connectedCallback() { UI.accepts(this); this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    setData(value) { this._data = UI.asTable(value); this.render(); }
    get data() { return this._data || { names: [], rows: [] }; }
    set data(v) { this.setData(v); }
    render() {
      var t = this.data;
      if (t.rows.length < 2) { this.replaceChildren(UI.empty("a line needs at least two points")); return; }
      var xi = this.hasAttribute("x") ? UI.column(t, this.getAttribute("x")) : 0;
      if (xi < 0) { this.replaceChildren(UI.empty("x names a column this result does not have")); return; }
      var series = (this.getAttribute("y") || "").split(/\s*,\s*/).filter(Boolean)
        .map(function (n) { return UI.column(t, n); }).filter(function (i) { return i >= 0; });
      if (!series.length) {
        series = t.names.map(function (n, i) { return i; }).filter(function (i) {
          return i !== xi && t.rows.every(function (r) { return !r[i] || UI.isNumber(r[i]); });
        }).slice(0, 4);
      }
      if (!series.length) { this.replaceChildren(UI.empty("no numeric column to plot")); return; }

      var H = Number(this.getAttribute("height")) || 180;
      var W = 600, padL = 46, padB = 24, padT = 8, padR = 8;
      var plotH = H - padB - padT, plotW = W - padL - padR;
      var all = [];
      series.forEach(function (i) {
        t.rows.forEach(function (r) { if (UI.isNumber(r[i])) all.push(Number(r[i])); });
      });
      var top = Math.max.apply(null, all), bottom = Math.min.apply(null, all);
      if (top === bottom) { top += 1; bottom -= 1; }
      var span = top - bottom;
      var step = t.rows.length > 1 ? plotW / (t.rows.length - 1) : plotW;

      var g = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
                           "aria-label": "a line chart over " + t.names[xi] });
      [top, (top + bottom) / 2, bottom].forEach(function (v) {
        var y = padT + plotH * ((top - v) / span);
        g.appendChild(svg("line", { class: "dydra-axis", x1: padL, y1: y, x2: W - padR, y2: y }));
        var label = svg("text", { x: padL - 5, y: y + 3, "text-anchor": "end" });
        label.textContent = UI.number(Math.round(v * 100) / 100);
        g.appendChild(label);
      });
      series.forEach(function (si, n) {
        var d = "";
        t.rows.forEach(function (r, i) {
          if (!UI.isNumber(r[si])) return;
          var x = padL + i * step;
          var y = padT + plotH * ((top - Number(r[si])) / span);
          d += (d ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        });
        if (d) g.appendChild(svg("path", { class: "dydra-s" + (n % 4), d: d }));
      });
      [0, t.rows.length - 1].forEach(function (i) {
        var lab = svg("text", { x: padL + i * step, y: H - 7,
                                "text-anchor": i === 0 ? "start" : "end" });
        lab.textContent = String(t.rows[i][xi]).slice(0, 16);
        g.appendChild(lab);
      });

      var legend = UI.el("div", { class: "dydra-legend" });
      series.forEach(function (si, n) {
        var item = UI.el("span", {});
        var swatch = UI.el("i", {});
        swatch.style.background = COLOURS[n % 4];
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(t.names[si]));
        legend.appendChild(item);
      });
      this.replaceChildren(g, legend);
      if (window.dashboard) window.dashboard.resize();
    }
  });
})();
`;

export const MANIFEST = {
  name: "line-chart", element: "dydra-line-chart", version: "1.0", tier: 2,
  description: "One or more measures against an ordered first column.",
  properties: { data: { type: "table" },
                x: { type: "string", default: "the first column", attribute: true },
                y: { type: "string", default: "every numeric column",
                     description: "comma-separated column names", attribute: true },
                height: { type: "number", default: 180, attribute: true } },
  methods: { setData: { parameters: ["table"] } }, events: {}, slots: [], needs: [],
  examples: ['<section data-bound="sales"><dydra-line-chart x="month" y="total,cost"></dydra-line-chart></section>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
