/**
 * A run's report, as a page that can be kept (§34.7).
 *
 * The answer to a cross-repository question is a document: headings, a
 * candidate table, a section saying what was not established, and the queries
 * it was drawn from.  In the pane it is one `white-space: pre-wrap' box,
 * which is right for reading it beside the transcript that produced it and
 * wrong for every other purpose -- sending it to someone, printing it,
 * keeping it beside the data it describes.  A pane cannot be sent; a file can.
 *
 * So the same text is rendered here as a standalone HTML document: no script,
 * no external stylesheet, no network reference of any kind, which is what
 * makes it safe to open from a `blob:' URL and sensible to keep in a
 * directory.  Everything that came from a model or a store is escaped before
 * it is written, including the text inside a code fence.
 *
 * The markdown handled is what an analysis report uses and nothing beyond it:
 * ATX headings, fenced code, pipe tables, bullet and numbered lists, block
 * quotes, and inline emphasis, strong, code and links.  A dialect wide enough
 * to be worth a dependency is not wide enough to be worth a dependency's
 * surface, and a construct that is not handled degrades to the paragraph it
 * reads as rather than to nothing.
 */

/** HTML text.  Everything written into the document goes through this. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Inline markdown, inside one line of text.
 *
 * Code spans are taken out first and put back last, so that a backtick span
 * containing an asterisk is not emphasised and a URL inside one is not linked
 * -- which is the usual way a hand-written renderer corrupts a report full of
 * SPARQL.
 */
export function inline(text) {
  const spans = [];
  let s = String(text ?? "").replace(/`([^`]+)`/g, (_, code) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });
  s = esc(s);
  // A link, then bare http(s), then emphasis.  `_' is deliberately not an
  // emphasis marker: it occurs inside identifiers far more often than it
  // occurs as italics, and `bldg_223p_anon' should not come out in italics.
  s = s.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g,
                (_, label, href) => `<a href="${href}">${label}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g,
                (_, lead, href) => `${lead}<a href="${href}">${href}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(spans[Number(i)])}</code>`);
}

const cell = (s) => inline(String(s).trim());

/** One pipe-table row, split on the bars that are not inside a code span. */
function cells(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
}

const isDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/**
 * Markdown to HTML, for the subset above.
 *
 * Written as one pass over the lines with a tiny block state, rather than as
 * a chain of regular expressions over the whole text: a table and a list are
 * both runs of lines, and a renderer that cannot see where a run ends puts
 * the paragraph after a table inside it.
 */
export function markdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*```([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;   // the closing fence, or the end of the text
      const lang = fence[1] ? ` data-lang="${esc(fence[1])}"` : "";
      out.push(`<pre${lang}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flush(); out.push("<hr />"); i += 1; continue; }

    // A table: a row of cells whose next line is the divider.
    if (/\|/.test(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const head = cells(line).map((c) => `<th>${cell(c)}</th>`).join("");
      const body = [];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        body.push(`<tr>${cells(lines[i]).map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`);
        i += 1;
      }
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      flush();
      const ordered = Boolean(number);
      const items = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[1]); i += 1; continue; }
        // A continuation line belongs to the item above it.
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]];
      i += 1;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${markdown(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (!line.trim()) { flush(); i += 1; continue; }
    paragraph.push(line);
    i += 1;
  }
  flush();
  return out.join("\n");
}

/* ── the page ────────────────────────────────────────────────────────────── */

/**
 * The stylesheet, inlined.
 *
 * A saved page has to render in a browser that has never seen this
 * application and may never reach the network again, so there is nothing to
 * link to.  It is also the only chance to make the report legible at a
 * printer's width, which the pane never has to be.
 */
const PAGE_STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; background: #fff; color: #1a1a1a;
  font: 15px/1.6 "Iowan Old Style", Palatino, Georgia, serif; }
main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
header { border-bottom: 1px solid #ddd; padding-bottom: 1rem; margin-bottom: 1.5rem; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 .4rem; }
h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 .4rem; }
h4, h5, h6 { font-size: 1rem; margin: 1.2rem 0 .3rem; }
p, li { margin: .6rem 0; }
.asked { font-style: italic; color: #333; margin: 0 0 .5rem; }
.meta { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #666;
  white-space: pre-wrap; margin: 0; }
code { font: .86em ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #f4f6f8; padding: .1em .3em; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #e3e8ee; border-radius: 4px;
  padding: .7rem .85rem; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.45; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .92em; }
th, td { border: 1px solid #dde3ea; padding: .35rem .5rem; text-align: left;
  vertical-align: top; }
th { background: #f6f8fa; }
blockquote { margin: 1rem 0; padding: .1rem 0 .1rem 1rem; border-left: 3px solid #dde3ea;
  color: #444; }
hr { border: 0; border-top: 1px solid #e3e8ee; margin: 2rem 0; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd; }
.stage { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #555;
  white-space: pre-wrap; margin: 0 0 .5rem; }
details { margin-top: 1.5rem; }
summary { cursor: pointer; font-size: .9rem; color: #555; }
.exchange { border-top: 1px solid #eef1f4; padding: .5rem 0;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.exchange .what { color: #333; }
.exchange .where { color: #777; }
@media (prefers-color-scheme: dark) {
  body { background: #16181c; color: #e6e8ea; }
  header, footer { border-color: #333a42; }
  code, pre { background: #1e2228; }
  pre { border-color: #333a42; }
  th { background: #1e2228; }
  th, td, blockquote, hr, .exchange { border-color: #333a42; }
  .meta, .stage, summary, .exchange .where { color: #9aa3ad; }
  a { color: #7fb2e5; }
}
@media print {
  body { background: #fff; color: #000; }
  details { display: none; }
}
`;

/** A file name that sorts by date and says what it is. */
export function reportFilename({ account, at = new Date(), label = "exploration" } = {}) {
  const stamp = (at instanceof Date ? at : new Date(at)).toISOString()
    .replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const slug = String(account || "report").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${label}-${slug}-${stamp}.html`;
}

/**
 * The whole document.
 *
 * `stage' is the Article 50 line the interface draws -- the model AS SERVED,
 * the date, the stores -- and it is written here for the same reason it is
 * written in the pane: the page states it, not the model, and a report that
 * leaves the building without it is the one case where losing it matters
 * most (§2.6).
 */
export function reportPage({
  title = "Exploration", asked = "", answer = "", stores = [],
  stage = "", records = [], exchanges = [], at = new Date(), account = null,
} = {}) {
  const when = (at instanceof Date ? at : new Date(at));
  const head = [
    `<h1>${esc(title)}</h1>`,
    asked ? `<p class="asked">${inline(asked)}</p>` : "",
    stores.length
      ? `<p class="meta">${esc(stores.join(", "))}</p>` : "",
    `<p class="meta">${esc(when.toISOString().slice(0, 10))}`
      + `${account ? ` · ${esc(account)}` : ""}</p>`,
  ].filter(Boolean).join("\n");

  const trail = exchanges.length
    ? `<details><summary>${exchanges.length} exchange(s) — what was asked of the stores`
    + `</summary>\n`
    + exchanges.map((x) => `<div class="exchange"><span class="what">${esc(x.title || "")}`
        + `</span> <span class="where">${esc([x.repository, x.status, x.ms ? `${x.ms}ms` : ""]
            .filter(Boolean).join(" · "))}</span></div>`).join("\n")
    + `</details>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="date" content="${esc(when.toISOString().slice(0, 10))}" />
<meta name="generator" content="Dydra Studio exploration pane" />
<title>${esc(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<header>
${head}
</header>
${markdown(answer) || "<p>(no answer)</p>"}
<footer>
${stage ? `<p class="stage">${esc(stage)}</p>` : ""}
${records.length ? `<p class="meta">${records.map((r) => inline(r)).join("<br />")}</p>` : ""}
</footer>
${trail}
</main>
</body>
</html>
`;
}

export default { reportPage, markdown, inline, esc, reportFilename };
