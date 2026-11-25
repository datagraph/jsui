#!/usr/bin/env node
'use strict';

/*
 * Sets a Dydra manual in the Tschichold manner, in place.
 *
 *     user-manual/    the user manual   -- authored here, and set here
 *     admin-manual/   the admin manual  -- likewise
 *
 * The manuals were written against a stylesheet of their own and were, until
 * 2026-11-21, transformed into a generated copy for the documentation
 * collection. That left two styles of the same text, and the generated copy
 * went stale. So the transformation is now applied to the manual itself: what
 * is authored is what is published, which is what the collection does with
 * every other manual it holds.
 *
 * The manuals' own markup vocabulary maps almost one to one onto the
 * collection's, so this is a transformation rather than a rewrite:
 *
 *     h1 + the opening paragraph   ->  title block: chapter line, H1, lede
 *     h2                           ->  a numbered section, rail and numeral
 *     div.step + span.step-number  ->  p.step, then the step's own content
 *     div.note / div.warning       ->  div.admonition note / caution
 *     div.float-* / .panel / .wide ->  div.figure, flush left at the measure
 *     p|div.image-caption          ->  p.caption
 *     div.clear                    ->  dropped, there being no floats
 *     table                        ->  table.docutils in a scrolling box
 *     nav (prev/next)              ->  the pager band
 *
 * The click-to-zoom script goes too: figures are set at the full measure of
 * the text, so there is nothing to enlarge.
 *
 * It refuses to run twice over the same manual: a page already set in this
 * manner is left alone and reported, because a second pass would read the
 * generated markup as if it were the authored kind and make nonsense of it.
 * Edit such a page directly -- it is the source of record now.
 *
 *     node restyle-manual.js                 set every manual
 *     node restyle-manual.js user-manual     set one of them
 *     node restyle-manual.js --css PATH      take the stylesheet from PATH
 *     node restyle-manual.js --install       also put the manuals that have a
 *                                            place in the documentation
 *                                            collection into it, and reindex
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.dirname(path.resolve(__filename));

/* The documentation collection is a github repository, so it is not a sibling
   of this project. It owns the stylesheet; a copy travels with each manual so
   that the manual reads where it is written. */
const COLLECTION = path.resolve(HERE, '../../../../com/github/dydra/documentation');
const CSS = path.join(COLLECTION, 'site/shared/tschichold.css');

const MARK = 'tschichold.css';
const VLABEL_MAX = 28;

/* What distinguishes one manual from another is its wording, not its shape. */
const MANUALS = {
  'user-manual': {
    dir: 'user-manual',
    eyebrow: 'Graph Database · Triple Store · User Manual',
    chapno: 'Dydra Studio · user manual',
    footer: 'Dydra Studio · user manual',
    meta: 'User manual',
    suffix: 'Dydra Studio',
    title: 'Dydra Studio User Manual',
    /* its headings are prose, and carry no number of their own */
    stripChapter: false,
    stripSection: false,
    slug: 'studio',
  },
  'admin-manual': {
    dir: 'admin-manual',
    eyebrow: 'Graph Database · Triple Store · Admin Console Manual',
    chapno: 'Dydra admin console · manual',
    footer: 'Dydra admin console · manual',
    meta: 'Admin manual',
    suffix: 'Dydra Admin Console',
    title: 'Dydra Admin Console Manual',
    /* its chapters are "Chapter 4: Repository Operations" -- the rail says 04
       beside it -- and its sections are "4.6 Delete a Repository", which the
       prose cites by number and so keeps */
    stripChapter: true,
    stripSection: false,
    slug: null,
  },
};

// ---------------------------------------------------------------- text tools

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Markup out, one space in its place -- then the space a closing tag left in
   front of punctuation taken back out again, because "Ask , Compose" is the
   sort of thing a reader notices and a generator should not leave. */
function text(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1')
    .trim();
}

function first(re, s, fallback) {
  const m = re.exec(s || '');
  return m ? m[1] : fallback;
}

/* "Chapter 4: Repository Operations" -> "Repository Operations". A chapter
   gives up its number because the rail numeral and the chapter line beside it
   already carry it, and nothing in the prose cites a chapter by a heading. */
function unchapter(title, M) {
  if (!M.stripChapter) return title;
  return String(title).replace(/^\s*Chapter\s+\d+\s*:\s*/i, '').trim();
}

/* A section keeps its number. The admin manual is a reference and cites its
   own sections in the prose -- "See Section 1.4" -- so the number is part of
   the text, not decoration the rail can take over. */
function unsection(title, M) {
  if (!M.stripSection) return title;
  return String(title).replace(/^\s*\d+(?:\.\d+)*\s+/, '').trim();
}

/* Words that may end a sentence but must not end a label: a rail reading
   "step 1 \u2014 find the" is worse than one reading "step 1". */
const VLABEL_TAIL = new Set(
  ('a an the and or of to in into for with from by on at as is are was be it its ' +
   'this that these those your our their his her my').split(' '));

/* A terse lowercase rail label. A heading too long for the rail is cut at its
   own first break -- a dash, a colon, a comma, a bracket -- since a heading
   that has one has already said where its short form ends; failing that it is
   cut back to a word boundary. Either way it does not end on a word that was
   leading somewhere. */
function vlabel(title) {
  /* the rail numeral stands beside the label, and a heading that carries its
     own number has already said it -- so the label says only the name */
  const label = text(title).toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .replace(/^appendix\s+[a-z]\s*:\s*/, '');
  /* a heading short enough to stand whole is already well formed */
  if (label.length <= VLABEL_MAX) return label;

  const brk = /\s*[\u2014\u2013:,(\[]/.exec(label);
  if (brk && brk.index >= 2) {
    const head = label.slice(0, brk.index).trim();
    if (head.length <= VLABEL_MAX) return trimTail(head) || head;
  }

  const out = [];
  for (const word of label.split(' ')) {
    if (out.length && (out.join(' ') + ' ' + word).length > VLABEL_MAX) break;
    out.push(word);
  }
  const cut = out.join(' ') || label.slice(0, VLABEL_MAX);
  return trimTail(cut) || cut;
}

function trimTail(label) {
  const words = label.replace(/[\s\u2014\u2013:,;.\-]+$/, '').split(' ');
  while (words.length > 1 && VLABEL_TAIL.has(words[words.length - 1])) words.pop();
  const out = words.join(' ').replace(/[\s\u2014\u2013:,;.\-]+$/, '');
  return VLABEL_TAIL.has(out) ? '' : out;
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
      const inner = /^\s*<(p|ul|ol|table|pre|div)\b/i.test(rest)
        ? rest : `<p>${rest}</p>`;
      return `<div class="${cls}">\n<p class="admonition-title">${escape(label.trim())}</p>\n` +
             `${inner}\n</div>`;
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

/* every image wrapper becomes a figure at the full measure */
function figures(html) {
  html = html.replace(
    /<div\s+class="(?:float-right|float-left|panel|wide)"\s*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    (m, body) => `<div class="figure">\n${body.trim()}\n</div>\n</div>`);
  html = html.replace(
    /<div\s+class="(?:float-right|float-left|panel|wide)"\s*>([\s\S]*?)<\/div>/gi,
    (m, body) => `<div class="figure">\n${body.trim()}\n</div>`);
  html = html.replace(/<p\s+class="image-caption"\s*>([\s\S]*?)<\/p>/gi,
                      (m, body) => `<p class="caption">${body}</p>`);
  html = html.replace(/<div\s+class="image-caption"\s*>([\s\S]*?)<\/div>/gi,
                      (m, body) => `<p class="caption">${body}</p>`);
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

function shell(M, { title, meta, chapno, headline, lede, blocks, pager, date }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(text(lede)).slice(0, 300)}">${date ? `
<meta name="date" content="${escape(date)}">` : ''}
<link rel="stylesheet" href="tschichold.css" type="text/css">
</head>
<body>
<div class="container">

  <header class="masthead">
    <div>
      <div class="eyebrow">${M.eyebrow}</div>
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
    <div class="fl">${M.footer}<br>&copy; ${new Date().getFullYear()} Dydra</div>
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

/* Previous, Contents, Next. The band names only pages this manual holds, so
   it is right wherever the manual is read -- here, or installed in the
   collection. */
function pagerBand(prev, next) {
  const cells = [];
  if (prev) {
    cells.push(`    <a class="cell" href="${prev.file}"><span class="dir">Previous</span> ${escape(prev.title)}</a>`);
    /* on the first chapter, Previous already is the front page */
    if (prev.file !== 'index.html') {
      cells.push('    <a class="cell" href="index.html"><span class="dir">Up</span> Contents</a>');
    }
  }
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

/* the chapters, in the order the manual's own front page lists them. An entry
   that points outside the manual -- another manual, a worked example -- is
   listed but not set: it is not this manual's to rewrite. */
function chapters(indexHtml, M) {
  const nav = first(/<nav\s*>([\s\S]*?)<\/nav>/i, indexHtml, '');
  const out = [];
  const re = /<a\s+href="([^"]+)"\s*>\s*<h2\s*>([\s\S]*?)<\/h2>\s*<p\s*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(nav)) !== null) {
    out.push({
      file: m[1],
      title: unchapter(text(m[2]), M),
      blurb: text(m[3]),
      foreign: m[1].includes('/'),
    });
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
function split(body, M) {
  const parts = [];
  const re = /<h2\s*>([\s\S]*?)<\/h2>/gi;
  let m;
  let last = null;
  let cursor = 0;
  let preamble = '';
  while ((m = re.exec(body)) !== null) {
    if (last === null) preamble = body.slice(0, m.index);
    else last.html = body.slice(cursor, m.index);
    last = { title: unsection(m[1].trim(), M), html: '' };
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

function alreadySet(file) {
  return fs.readFileSync(file, 'utf8').includes(MARK);
}

function setManual(M, cssFrom) {
  const IN = path.join(HERE, M.dir);
  if (!fs.existsSync(IN)) {
    console.error(`no manual at ${IN}`);
    return false;
  }
  console.log(`\n${M.dir}`);

  const indexFile = path.join(IN, 'index.html');
  if (alreadySet(indexFile)) {
    console.log('  already set in this manner -- left alone');
    return true;
  }

  const indexHtml = fs.readFileSync(indexFile, 'utf8');
  const chs = chapters(indexHtml, M);
  if (!chs.length) {
    console.error('  found no chapters in the front page navigation');
    return false;
  }
  const own = chs.filter((c) => !c.foreign);

  /* the front page */
  const front = parse(indexHtml);
  const frontSplit = split(front.body, M);
  const opening = frontSplit.parts.find(
    (p) => /^(Welcome|Preface|Overview|Introduction)/i.test(text(p.title)));
  const lifted = lift(opening, front.sub);
  const frontSections = frontSplit.parts
    .map((p) => (p === opening ? lifted.rest : p))
    .filter((p) => p && !chs.some((c) => text(c.title) === text(p.title)))
    .map((p) => ({ ...p, html: content(p.html) }));

  /* the manual states its own version in its footer; the collection lists
     that rather than the modification time of this copy */
  const version = first(/<meta\s+name="date"\s+content="([^"]+)"/i, indexHtml,
                 first(/Manual Version:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i, indexHtml,
                 first(/Version:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i, indexHtml, '')));

  fs.writeFileSync(indexFile, shell(M, {
    title: front.heading || M.title,
    meta: M.meta,
    chapno: M.chapno,
    headline: front.heading || M.title,
    lede: lifted.lede,
    date: version,
    blocks: { toc: contentsList(chs), sections: sections(frontSections) },
    pager: pagerBand(null, own[0]),
  }));
  console.log(`  index.html: front page, ${chs.length} chapters ` +
              `(${chs.length - own.length} elsewhere), ` +
              `${frontSections.length} sections`);

  /* the chapters */
  own.forEach((chapter, i) => {
    const file = path.join(IN, chapter.file);
    if (alreadySet(file)) {
      console.log(`  ${chapter.file}: already set -- left alone`);
      return;
    }
    const html = fs.readFileSync(file, 'utf8');
    const page = parse(html);
    const { preamble, parts } = split(page.body, M);

    /* a chapter opens with an Overview section; its first paragraph is the
       lede, and it does not need a numbered section of its own */
    const overview = parts.find((p) => /^(Overview|Preface)$/i.test(text(p.title)));
    const liftedHere = lift(overview, chapter.blurb);
    const rest = parts
      .map((p) => (p === overview ? liftedHere.rest : p))
      .filter((p) => p)
      .map((p) => ({ ...p, html: content(p.html) }));
    if (text(preamble)) {
      rest.unshift({ title: 'Introduction', id: 'introduction', html: content(preamble) });
    }

    fs.writeFileSync(file, shell(M, {
      title: `${unchapter(page.heading, M)} — ${M.suffix}`,
      meta: `${M.meta}<br>${escape(chapter.title)}`,
      chapno: `${M.chapno} · ${String(i + 1).padStart(2, '0')}`,
      headline: unchapter(page.heading, M),
      lede: liftedHere.lede,
      date: version,
      blocks: { toc: '', sections: sections(rest) },
      pager: pagerBand(i ? own[i - 1] : { file: 'index.html', title: 'Front page' },
                       own[i + 1] || null),
    }));
    console.log(`  ${chapter.file}: ${rest.length} sections`);
  });

  /* the stylesheet travels with the manual, so it reads where it is written */
  if (fs.existsSync(cssFrom)) {
    fs.copyFileSync(cssFrom, path.join(IN, 'tschichold.css'));
    console.log(`  tschichold.css: from ${path.relative(HERE, cssFrom)}`);
  } else {
    console.warn(`  ! no stylesheet at ${cssFrom} -- keeping whatever is there`);
  }

  /* and the old one goes, with the script that enlarged the figures: they are
     set at the measure of the text now, so there is nothing to enlarge */
  for (const gone of ['manual.css', 'manual.js']) {
    const f = path.join(IN, gone);
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      console.log(`  ${gone}: removed`);
    }
  }

  missingFigures(IN);
  return true;
}

/* Figures the manual asks for and does not have. Carried over as written --
   the screenshots have to be taken from the running application -- but said
   out loud rather than left to be noticed in a browser. */
function missingFigures(IN) {
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
    console.warn(`  ! ${absent.length} figures are referenced and not present:`);
    for (const a of absent) console.warn(`      ${a}`);
  }
}

/* Putting a manual in place is this project's business; the collection only
   regenerates its index pages. A manual with no slug has no place there yet. */
function install(M) {
  if (!M.slug) {
    console.log(`\n${M.dir}: no place in the collection -- not installed`);
    return;
  }
  const IN = path.join(HERE, M.dir);
  const into = path.join(COLLECTION, 'site', 'manuals', M.slug);
  if (!fs.existsSync(path.join(COLLECTION, 'site'))) {
    console.error(`\nno collection at ${COLLECTION} -- nothing installed`);
    process.exit(1);
  }
  fs.rmSync(into, { recursive: true, force: true });
  fs.cpSync(IN, into, { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
  console.log(`\ninstalled in ${path.relative(HERE, into)}`);
  try {
    execFileSync('make', ['-C', COLLECTION, 'index'], { stdio: 'inherit' });
  } catch (e) {
    console.warn('could not reindex the collection: ' + e.message);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cssArg = argv.indexOf('--css');
  const cssFrom = cssArg > -1 ? argv[cssArg + 1] : CSS;
  const named = argv.filter((a) => !a.startsWith('--') && a !== cssFrom);
  const wanted = named.length ? named : Object.keys(MANUALS);

  for (const name of wanted) {
    const M = MANUALS[name.replace(/\/$/, '')];
    if (!M) {
      console.error(`no such manual: ${name}`);
      process.exit(1);
    }
    if (!setManual(M, cssFrom)) process.exit(1);
    if (argv.includes('--install')) install(M);
  }
}

main();
