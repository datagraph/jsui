/**
 * `term' — an RDF term shown as what it is.
 *
 * Tier 2.  A cell of a SPARQL result is not a string: it is an IRI, or a
 * literal with a datatype, or one with a language tag, and a table that shows
 * all three as bare text throws away the one distinction the store exists to
 * keep.  The shortening is presentational only -- the full IRI stays in the
 * title and in the text that is copied.
 */

export const NAME = "term";
export const ELEMENT = "dydra-term";

export const STYLE = `
dydra-term { display: inline-block; font-variant-numeric: tabular-nums; }
dydra-term > .dydra-term-iri { color: #1f4e79; }
dydra-term > .dydra-term-tag { color: #8a94a0; font-size: 10.5px; margin-left: 3px; }
`;

export const SOURCE = String.raw`
(function () {
  var UI = window.DydraUI;
  var WELL_KNOWN = {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf",
    "http://www.w3.org/2000/01/rdf-schema#": "rdfs",
    "http://www.w3.org/2001/XMLSchema#": "xsd",
    "http://www.w3.org/2002/07/owl#": "owl",
    "http://xmlns.com/foaf/0.1/": "foaf",
    "http://purl.org/dc/terms/": "dcterms",
    "http://www.w3.org/2004/02/skos/core#": "skos"
  };
  function shorten(iri) {
    for (var ns in WELL_KNOWN) {
      if (iri.indexOf(ns) === 0) return WELL_KNOWN[ns] + ":" + iri.slice(ns.length);
    }
    var cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
    return cut > 0 && cut < iri.length - 1 ? "…" + iri.slice(cut) : iri;
  }
  UI.define("dydra-term", class extends HTMLElement {
    static get observedAttributes() { return ["value", "datatype", "language"]; }
    connectedCallback() { UI.accepts(this); this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    setData(value) {
      var t = UI.asTable(value);
      this._value = t.rows.length ? t.rows[0][0] : null;
      this.render();
    }
    get value() { return this._value != null ? this._value : this.getAttribute("value"); }
    set value(v) { this._value = v; this.render(); }
    render() {
      var v = this.value;
      if (v == null || v === "") { this.replaceChildren(UI.empty("—")); return; }
      var text = String(v);
      var dt = this.getAttribute("datatype"), lang = this.getAttribute("language");
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) || /^urn:/i.test(text)) {
        var a = UI.el("span", { class: "dydra-term-iri", text: shorten(text), title: text });
        this.replaceChildren(a);
        return;
      }
      var kids = [document.createTextNode(text)];
      if (lang) kids.push(UI.el("span", { class: "dydra-term-tag", text: "@" + lang }));
      else if (dt) kids.push(UI.el("span", { class: "dydra-term-tag", text: shorten(dt) }));
      this.replaceChildren.apply(this, kids);
    }
  });
})();
`;

export const MANIFEST = {
  name: "term", element: "dydra-term", version: "1.0", tier: 2,
  description: "An RDF term: an IRI shortened, or a literal with its datatype or language.",
  properties: { value: { type: "string", attribute: true },
                datatype: { type: "string", attribute: true },
                language: { type: "string", attribute: true } },
  methods: { setData: { parameters: ["table|value"] } }, events: {}, slots: [], needs: [],
  examples: ['<dydra-term value="http://xmlns.com/foaf/0.1/Person"></dydra-term>'],
};

export default { name: NAME, element: ELEMENT, source: SOURCE, style: STYLE,
                 manifest: MANIFEST, needs: { components: ["base"] }, tier: 2 };
