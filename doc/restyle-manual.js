#!/usr/bin/env node
'use strict';

/*
 * Restyles the Dydra Studio user manual in the Tschichold manner.
 *
 *     user-manual/            authored here, and stays the source of record
 *     user-manual-tschichold/ generated -- do not edit
 *
 * The manual's own markup vocabulary maps almost one to one onto the
 * documentation collection's, so this is a transformation rather than a
 * rewrite:
 *
 *     h1 + the Overview paragraph  ->  title block: chapter line, H1, lede
 *     h2                           ->  a numbered section, rail and numeral
 *     div.step + span.step-number  ->  p.step, then the step's own content
 *     div.note / div.warning       ->  div.admonition note / caution
 *     div.float-* + p.image-caption->  div.figure + p.caption, flush left
 *     div.clear                    ->  dropped, there being no floats
 *     table                        ->  table.docutils in a scrolling box
 *     nav (prev/next)              ->  the pager band
 *
 * The click-to-zoom script goes too: figures are set at the full measure of
 * the text, so there is nothing to enlarge.
 *
 *     node restyle-manual.js               restyle into user-manual-tschichold
 *     node restyle-manual.js --css PATH    take the stylesheet from PATH
 *     node restyle-manual.js --install     also put it in the documentation
 *                                          collection and reindex there
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.dirname(path.resolve(__filename));
const IN = path.join(HERE, 'user-manual');
const OUT = path.join(HERE, 'user-manual-tschichold');

/* The documentation collection is a github repository, so it is not a sibling
   of this project. It owns the stylesheet; a copy travels with the manual so
   that the manual can be read where it is written, before it is installed. */
const COLLECTION = path.resolve(HERE, '../../../../com/github/dydra/documentation');
const CSS = path.join(COLLECTION, 'site/shared/tschichold.css');
const SLUG = 'studio';

const EYEBROW = 'Graph Database · Triple Store · User Manual';
const CHAPNO = 'Dydra Studio · user manual';
const FOOTER = 'Dydra Studio · user manual';

const VLABEL_MAX = 22;

// ---------------------------------------------------------------- text tools

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function text(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function first(re, s, fallback) {
  const m = re.exec(s || '');
  return m ? m[1] : fallback;
}

/* A terse lowercase rail label, cut back to a word boundary. */
function vlabel(title) {
  const label = text(title).toLowerCase();
  if (label.length <= VLABEL_MAX) return label;
  const out = [];
  for (const word of label.split(' ')) {
    if (out.length && (out.join(' ') + ' ' + word).length > VLABEL_MAX) break;
    out.push(word);
  }
  return out.join(' ');
}

function reindent(html) {
  return html.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    .map((l) => '      ' + l).join('\n');
}

// ----------------------------------------------------------- the transforms

/* div.note and div.warning become admonitions, keeping any "Label:" lead-in
   as the admonition's title. */
function admonitions(html) {
  return html.replace(
    /<div\s+class="(note|warning)"\s*>([\s\S]*?)<\/div>/gi,
    (m, kind, body) => {
      const label = first(/^\s*<strong>\s*([^<:]+):?\s*<\/strong>/i, body,
                          kind === 'warning' ? 'Caution' : 'Note');
      const rest = body.replace(/^\s*<strong>[^<]*<\/strong>\s*/i, '').trim();
      const cls = kind === 'warning' ? 'admonition caution' : 'admonition note';
      return `<div class="${cls}">\n<p class="admonition-title">${escape(label.trim())}</p>\n` +
             `<p>${rest}</p>\n</div>`;
    });
}

/* div.step carries its number in a span; the number becomes a step line and
   the remainder ordinary flow. */
function steps(html) {
  return html.replace(
    /<div\s+class="step"\s*>\s*<span\s+class="step-number"\s*>([^<]*)<\/span>([\s\S]*?)<\/div>/gi,
    (m, number, body) => {
      const label = number.replace(/:\s*$/, '').trim();
      const parts = body.trim();
      /* a step is a sentence, sometimes followed by a list */
      const split = parts.match(/^([\s\S]*?)(<(?:ul|ol)[\s\S]*)$/i);
      const lead = split ? split[1].trim() : parts;
      const tail = split ? split[2].trim() : '';
      return `<p class="step">${escape(label)}</p>\n` +
             (lead ? `<p>${lead}</p>\n` : '') + (tail ? tail + '\n' : '');
    });
}

/* the floated image wrappers become figures at the full measure */
function figures(html) {
  html = html.replace(
    /<div\s+class="(?:float-right|float-left)"\s*>([\s\S]*?)<\/div>/gi,
    (m, body) => `<div class="figure">\n${body.trim()}\n</div>`);
  html = html.replace(/<p\s+class="image-caption"\s*>/gi, '<p class="caption">');
  html = html.replace(/<div\s+class="clear"\s*>\s*<\/div>/gi, '');
  return html;
}

function tables(html) {
  return html.replace(/<table(\s[^>]*)?>([\s\S]*?)<\/table>/gi,
    (m, attrs, body) =>
      `<div class="tablewrap">\n<table class="docutils">${body}</table>\n</div>`);
}

function content(html) {
  return tables(figures(steps(admonitions(html))));
}

/* The opening section gives up its first paragraph to be the lede. Whatever
   else it holds stays a section of its own, so nothing is dropped. */
function lift(section, fallback) {
  if (!section) return { lede: fallback, rest: null };
  const m = /<p\s*>([\s\S]*?)<\/p>/i.exec(section.html);
  if (!m) return { lede: fallback, rest: section };
  const remainder = section.html.slice(0, m.index) +
                    section.html.slice(m.index + m[0].length);
  return {
    lede: m[1].trim(),
    rest: text(remainder) || /<(img|table|ul|ol|pre)/i.test(remainder)
      ? { ...section, html: remainder } : null,
  };
}

// ------------------------------------------------------------------ the page

function shell({ title, meta, chapno, headline, lede, blocks, pager, date }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(text(lede)).slice(0, 300)}">${date ? `
<meta name="date" content="${escape(date)}">` : ''}
<!-- Generated by ../restyle-manual.js from user-manual/. Do not edit here;
     edit the manual and run it again. -->
<link rel="stylesheet" href="tschichold.css" type="text/css">
</head>
<body>
<div class="container">

  <header class="masthead">
    <div>
      <div class="eyebrow">${EYEBROW}</div>
      <div class="wordmark"><a href="index.html">dydra (1.2)</a></div>
    </div>
    <div class="meta">${meta}</div>
  </header>

  <section class="title">
    <div class="rail"><div class="vlabel">chapter</div></div>
    <div class="content">
      <p class="chapno">${escape(chapno)}</p>
      <h1>${headline}</h1>
${lede ? `      <p class="lede">${lede}</p>\n` : ''}${blocks.toc || ''}    </div>
  </section>

${blocks.sections}${pager}
  <footer class="footer">
    <div class="wm"><a href="index.html">dydra (1.2)</a></div>
    <div class="fl">${FOOTER}<br>&copy; ${new Date().getFullYear()} Dydra</div>
    <div class="disclaimer">
      <p>This documentation describes a <strong>Dydra 1.2 preview</strong>: what is
      written here is subject to change before release.</p>
      <p class="service"><a href="https://dydra.com/login">Login</a><a href="https://dydra.com/signup">Sign up</a><a href="https://dydra.com/legal/terms_of_service">Legal</a></p>
    </div>
  </footer>

</div>
</body>
</html>
`;
}

function sections(items) {
  return items.map((s, i) => {
    const last = i === items.length - 1;
    return `  <section class="section${last ? '' : ' heavy'}" id="${s.id}">
    <div class="rail"><div class="numeral">${String(i + 1).padStart(2, '0')}</div><div class="vlabel">${escape(vlabel(s.title))}</div></div>
    <div class="content">
      <h2>${s.title}</h2>
${reindent(s.html)}
    </div>
  </section>
`;
  }).join('\n');
}

function pagerBand(prev, next) {
  const cells = [];
  if (prev) {
    cells.push(`    <a class="cell" href="${prev.file}"><span class="dir">Previous</span> ${escape(prev.title)}</a>`);
  }
  cells.push('    <a class="cell" href="../index.html"><span class="dir">Up</span> Manuals</a>');
  cells.push('    <span class="spacer"></span>');
  if (next) {
    cells.push(`    <a class="cell" href="${next.file}"><span class="dir">Next</span> ${escape(next.title)}</a>`);
  }
  return `  <nav class="band pager" aria-label="Manual">\n${cells.join('\n')}\n  </nav>\n\n`;
}

// ------------------------------------------------------------------ reading

function slug(s) {
  return text(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* the chapters, in the order the manual's own front page lists them */
function chapters(indexHtml) {
  const nav = first(/<nav\s*>([\s\S]*?)<\/nav>/i, indexHtml, '');
  const out = [];
  const re = /<a\s+href="([^"]+)"\s*>\s*<h2\s*>([\s\S]*?)<\/h2>\s*<p\s*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(nav)) !== null) {
    out.push({ file: m[1], title: text(m[2]), blurb: text(m[3]) });
  }
  return out;
}

/* a page's h1, and the body of its div.content */
function parse(html) {
  const heading = first(/<header[\s\S]*?<h1\s*>([\s\S]*?)<\/h1>/i, html, '');
  const sub = first(/<header[\s\S]*?<h1\s*>[\s\S]*?<\/h1>\s*<p\s*>([\s\S]*?)<\/p>/i, html, '');
  let body = first(/<div\s+class="content"\s*>([\s\S]*)<\/div>\s*<\/div>/i, html, '');
  body = body.replace(/<nav\s*>[\s\S]*?<\/nav>/gi, '');
  return { heading: heading.trim(), sub: sub.trim(), body };
}

/* split a body at its h2s */
function split(body) {
  const parts = [];
  const re = /<h2\s*>([\s\S]*?)<\/h2>/gi;
  let m;
  let last = null;
  let cursor = 0;
  let preamble = '';
  while ((m = re.exec(body)) !== null) {
    if (last === null) preamble = body.slice(0, m.index);
    else last.html = body.slice(cursor, m.index);
    last = { title: m[1].trim(), html: '' };
    last.id = slug(last.title);
    parts.push(last);
    cursor = m.index + m[0].length;
  }
  if (last) last.html = body.slice(cursor);
  else preamble = body;
  return { preamble, parts };
}

// ------------------------------------------------------------------ writing

/* the chapters, with what the manual's front page says each one covers */
function contentsList(chs) {
  const rows = chs.map((c, i) => `          <li><a href="${c.file}">
            <span class="tn">${String(i + 1).padStart(2, '0')}</span>
            <span><span class="et">${escape(c.title)}</span><span class="eb">${escape(c.blurb)}</span></span>
          </a></li>`);
  return `      <nav class="toc" aria-label="Contents">
        <div class="toc-label">Contents</div>
        <ul class="entries">
${rows.join('\n')}
        </ul>
      </nav>
`;
}

function main() {
  const cssArg = process.argv.indexOf('--css');
  const cssFrom = cssArg > -1 ? process.argv[cssArg + 1] : CSS;

  if (!fs.existsSync(IN)) {
    console.error(`no manual at ${IN}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const indexHtml = fs.readFileSync(path.join(IN, 'index.html'), 'utf8');
  const chs = chapters(indexHtml);
  if (!chs.length) {
    console.error('found no chapters in the front page navigation');
    process.exit(1);
  }

  /* the front page */
  const front = parse(indexHtml);
  const frontSplit = split(front.body);
  const welcome = frontSplit.parts.find((p) => /^Welcome/i.test(text(p.title)));
  const lifted = lift(welcome, front.sub);
  const frontSections = frontSplit.parts
    .map((p) => (p === welcome ? lifted.rest : p))
    .filter((p) => p && !chs.some((c) => text(c.title) === text(p.title)))
    .map((p) => ({ ...p, html: content(p.html) }));
  const lede = lifted.lede;

  /* the manual states its own version in its footer; the collection lists
     that rather than the modification time of this copy */
  const version = first(/Manual Version:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i, indexHtml, '');

  fs.writeFileSync(path.join(OUT, 'index.html'), shell({
    title: front.heading || 'Dydra Studio User Manual',
    meta: 'User manual',
    chapno: CHAPNO,
    headline: front.heading,
    lede,
    date: version,
    blocks: { toc: contentsList(chs), sections: sections(frontSections) },
    pager: pagerBand(null, chs[0]),
  }));
  console.log(`  index.html: front page, ${chs.length} chapters, ` +
              `${frontSections.length} sections`);

  /* the chapters */
  chs.forEach((chapter, i) => {
    const html = fs.readFileSync(path.join(IN, chapter.file), 'utf8');
    const page = parse(html);
    const { preamble, parts } = split(page.body);

    /* a chapter opens with an Overview section; its first paragraph is the
       lede, and it does not need a numbered section of its own */
    const overview = parts.find((p) => /^Overview$/i.test(text(p.title)));
    const lifted = lift(overview, chapter.blurb);
    const chapterLede = lifted.lede;
    const rest = parts
      .map((p) => (p === overview ? lifted.rest : p))
      .filter((p) => p)
      .map((p) => ({ ...p, html: content(p.html) }));
    if (text(preamble)) rest.unshift({ title: 'Introduction', id: 'introduction', html: content(preamble) });

    fs.writeFileSync(path.join(OUT, chapter.file), shell({
      title: `${page.heading} — Dydra Studio`,
      meta: `User manual<br>${escape(chapter.title)}`,
      chapno: `${CHAPNO} · ${String(i + 1).padStart(2, '0')}`,
      headline: page.heading,
      lede: chapterLede,
      blocks: { toc: '', sections: sections(rest) },
      pager: pagerBand(i ? chs[i - 1] : { file: 'index.html', title: 'Front page' },
                       chs[i + 1] || null),
    }));
    console.log(`  ${chapter.file}: ${rest.length} sections`);
  });

  /* the figures, and a copy of the stylesheet so the manual reads in place */
  const images = path.join(IN, 'images');
  if (fs.existsSync(images)) {
    fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(images)) {
      if (f.startsWith('.')) continue;
      fs.copyFileSync(path.join(images, f), path.join(OUT, 'images', f));
      n += 1;
    }
    console.log(`  images/: ${n} files`);
  }

  if (fs.existsSync(cssFrom)) {
    fs.copyFileSync(cssFrom, path.join(OUT, 'tschichold.css'));
    console.log(`  tschichold.css: from ${path.relative(HERE, cssFrom)}`);
  } else {
    console.warn(`  ! no stylesheet at ${cssFrom} -- keeping whatever is there`);
  }

  missingFigures();

  if (process.argv.includes('--install')) install();
}

/* Figures the manual asks for and does not have. Carried over as written --
   the screenshots have to be taken from the running application -- but said
   out loud rather than left to be noticed in a browser. */
function missingFigures() {
  const absent = [];
  for (const f of fs.readdirSync(IN)) {
    if (!f.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(IN, f), 'utf8');
    const re = /<img[^>]*src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!fs.existsSync(path.join(IN, m[1]))) absent.push(`${f}: ${m[1]}`);
    }
  }
  if (absent.length) {
    console.warn(`\n  ! ${absent.length} figures are referenced but not in ` +
                 'user-manual/images:');
    for (const a of absent) console.warn(`      ${a}`);
  }
}

/* Putting the manual in place is this project's business; the collection only
   regenerates its index pages. */
function install() {
  const into = path.join(COLLECTION, 'site', 'manuals', SLUG);
  if (!fs.existsSync(path.join(COLLECTION, 'site'))) {
    console.error(`\nno collection at ${COLLECTION} -- nothing installed`);
    process.exit(1);
  }
  fs.rmSync(into, { recursive: true, force: true });
  fs.cpSync(OUT, into, { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
  console.log(`\ninstalled in ${path.relative(HERE, into)}`);
  try {
    execFileSync('make', ['-C', COLLECTION, 'index'], { stdio: 'inherit' });
  } catch (e) {
    console.warn('could not reindex the collection: ' + e.message);
  }
}

main();
