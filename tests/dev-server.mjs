// Serve this working copy the way the host does: /ui/user is index.html,
// /ui/admin is admin.html, everything else under /ui/ is a file.
// The API still comes from the host chosen on the login form, which is why this
// works at all: the dydra responses carry Access-Control-Allow-Origin: *.
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8099);
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
  '.ttf':'font/ttf', '.map':'application/json' };

// Anything that is not a /ui/ asset is proxied to the upstream host, so the page
// and the API share an origin.  Without this the browser refuses the login: it
// carries an Authorization header, which makes it a preflighted request, and the
// upstream does not answer the preflight for a foreign origin.
const UPSTREAM = process.env.JSUI_UPSTREAM || 'dydra.com';

function proxy(req, res) {
  const headers = { ...req.headers, host: UPSTREAM };
  delete headers['accept-encoding'];
  // The browser sends Origin on a same-origin POST, and it names this dev server.
  // The MCP endpoint guards against DNS rebinding by requiring Origin to be absent
  // or to contain the request Host (spocq mcp-endpoint.lisp, mcp-origin-allowed-p),
  // so a forwarded `http://localhost:8100' is refused: "Forbidden: invalid Origin".
  // Once the request is re-issued from here it has no browser origin, so the honest
  // thing is to drop the header rather than forge one.  Note what that costs: this
  // proxy is outside the rebinding guard, which is tolerable for a local dev server
  // and would not be for anything else.
  delete headers.origin;
  delete headers.referer;
  const up = httpsRequest(
    { host: UPSTREAM, port: 443, path: req.url, method: req.method, headers },
    (r) => {
      const out = { ...r.headers };
      // A 401 from the upstream carries `WWW-Authenticate: Basic'.  The browser
      // acts on that itself -- it opens its own password dialog for any request
      // that was made without credentials -- and whatever is typed goes back as
      // Basic, which is not what this client authenticates with, so the dialog
      // reappears for ever.  Dropping the challenge lets the 401 reach jsui,
      // which has its own login.  It hides nothing: the status is unchanged, and
      // a request arriving here unauthenticated is still answered 401.
      delete out['www-authenticate'];
      res.writeHead(r.statusCode || 502, out);
      r.pipe(res);
    });
  up.on('error', (e) => { res.writeHead(502, {'Content-Type':'text/plain'}); res.end('proxy: ' + e.message); });
  req.pipe(up);
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const isAsset = path === '/' || path === '/ui' || path.startsWith('/ui/')
               || /\.(js|mjs|css|svg|png|jpg|ico|woff2?|ttf|map|html|json)$/.test(path);
  if (!isAsset) return proxy(req, res);
  if (path === '/ui/user' || path === '/ui' || path === '/') path = '/index.html';
  else if (path === '/ui/admin') path = '/admin.html';
  else if (path.startsWith('/ui/')) path = path.slice(3);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + path);
  }
}).listen(PORT, () => console.log(`jsui dev server on http://localhost:${PORT}/ui/user`));
