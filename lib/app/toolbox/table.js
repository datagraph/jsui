/**
 * `table' — the default renderer, promoted and given sorting and paging.
 *
 * Tier 2 (§8.3), and the one component whose existence is already proven:
 * the frame's own `tableElement' has drawn every bound slot that declared no
 * renderer since the dashboard path was built.  What it cannot do is sort or
 * page, and both of those are things a reader asks for about a table they are
 * already looking at -- which is to say, things that must happen WITHOUT a
 * round trip to the store.  That is the whole argument for the component: a
 * sort that re-ran the query would spend the grant on a question already
 * answered.
 */

export const NAME = "table";
export const ELEMENT = "dydra-table";

export const STYLE = `
dydra-table { display: block; }
dydra-table table { border-collapse: collapse; font-size: 12px; width: 100%; }
dydra-table th, dydra-table td { border-bottom: 1px solid #edf0f3;
  padding: 3px 8px 3px 0; text-align: left; vertical-align: top; }
dydra-table th { color: #5b6672; font-weight: 600; white-space: nowrap; }
dydra-table[sortable] th { cursor: pointer; user-select: none; }
dydra-table th[aria-sort] { color: #1f4e79; }
dydra-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
dydra-table tr[aria-selected="true"] { background: #eef4fa; }
dydra-table .dydra-pager { display: flex; gap: 8px; align-items: baseline;
  font-size: 11px; color: #5b6672; padding-top: 5px; }
dydra-table .dydra-pager button { font: inherit; cursor: pointer; padding: 1px 7px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  UI.define("dydra-table", class extends HTMLElement {
    connectedCallback() {
      UI.accepts(this);
      this._page = 0;
      if (!this._data) this.render();
    }
    setData(value) { this._data = UI.asTable(value); this._page = 0; this.render(); }
    get data() { return this._data || { names: [], rows: [] }; }
    set data(v) { this.setData(v); }
    get pageSize() { return Math.max(1, Number(this.getAttribute("page-size")) || 25); }
    sortBy(column, descending) {
      this._sort = { column: column, desc: !!descending };
      this.render();
    }
    clearSelection() {
      this.querySelectorAll('tr[aria-selected="true"]').forEach(function (tr) {
        tr.removeAttribute("aria-selected"); });
    }
    /** The rows as they are shown: sorted, before paging. */
    get rows() {
      var t = this.data, rows = t.rows.slice();
      var s = this._sort;
      if (s && s.column >= 0) {
        var i = s.column;
        var numeric = rows.every(function (r) { return !r[i] || UI.isNumber(r[i]); });
        rows.sort(function (a, b) {
          var x = a[i] == null ? "" : a[i], y = b[i] == null ? "" : b[i];
          var c = numeric ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y));
          return s.desc ? -c : c;
        });
      }
      return rows;
    }
    render() {
      var self = this, t = this.data;
      if (!t.names.length) { this.replaceChildren(UI.empty("no columns to show")); return; }
      var sortable = this.hasAttribute("sortable");
      var paged = this.hasAttribute("paged");
      var all = this.rows;
      var size = this.pageSize;
      var pages = paged ? Math.max(1, Math.ceil(all.length / size)) : 1;
      this._page = Math.min(this._page || 0, pages - 1);
      var shown = paged ? all.slice(this._page * size, (this._page + 1) * size)
                        : all.slice(0, 500);

      var tr = UI.el("tr");
      t.names.forEach(function (n, i) {
        var th = UI.el("th", { text: n });
        if (self._sort && self._sort.column === i) {
          th.setAttribute("aria-sort", self._sort.desc ? "descending" : "ascending");
        }
        if (sortable) {
          th.addEventListener("click", function () {
            var desc = self._sort && self._sort.column === i && !self._sort.desc;
            self.sortBy(i, desc);
            self.dispatchEvent(new CustomEvent("sort-change",
              { detail: { column: n, descending: desc } }));
          });
        }
        tr.appendChild(th);
      });
      var body = UI.el("tbody");
      shown.forEach(function (r, ri) {
        var row = UI.el("tr");
        r.forEach(function (c) {
          var td = UI.el("td", { text: c == null ? "" : String(c) });
          if (UI.isNumber(c)) td.className = "num";
          row.appendChild(td);
        });
        row.addEventListener("click", function () {
          self.clearSelection();
          row.setAttribute("aria-selected", "true");
          var o = {};
          t.names.forEach(function (n, i) { o[n] = r[i]; });
          self.dispatchEvent(new CustomEvent("row-select",
            { detail: { row: o, index: ri } }));
        });
        body.appendChild(row);
      });
      var table = UI.el("table", {}, [UI.el("thead", {}, [tr]), body]);
      var kids = [table];
      if (paged && pages > 1) {
        var back = UI.el("button", { type: "button", text: "‹" });
        var fwd = UI.el("button", { type: "button", text: "›" });
        back.addEventListener("click", function () { self._page -= 1; self.render(); });
        fwd.addEventListener("click", function () { self._page += 1; self.render(); });
        back.disabled = this._page === 0;
        fwd.disabled = this._page >= pages - 1;
        kids.push(UI.el("div", { class: "dydra-pager" }, [
          back, fwd,
          UI.el("span", { text: all.length + " rows · page " + (this._page + 1) + " of " + pages })
        ]));
      } else if (all.length > shown.length) {
        kids.push(UI.el("div", { class: "dydra-pager" },
          [UI.el("span", { text: all.length + " rows, first " + shown.length + " shown" })]));
      }
      this.replaceChildren.apply(this, kids);
      if (window.dashboard) window.dashboard.resize();
    }
  });
})();
`;

export const MANIFEST = {
  name: "table", element: "dydra-table", version: "1.0", tier: 2,
  description: "Rows and columns, optionally sortable and paged, with no round trip.",
  properties: { data: { type: "table", description: "set by the bound slot, or as a property" },
                sortable: { type: "boolean", attribute: true },
                paged: { type: "boolean", attribute: true },
                "page-size": { type: "number", default: 25, attribute: true } },
  methods: { setData: { parameters: ["table"] }, sortBy: { parameters: ["number", "boolean"] },
             clearSelection: { parameters: [] } },
  events: { "row-select": { detail: { row: "object", index: "number" } },
            "sort-change": { detail: { column: "string", descending: "boolean" } } },
  slots: [], needs: [],
  examples: ['<section data-bound="sales"><dydra-table sortable paged page-size="20"></dydra-table></section>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
