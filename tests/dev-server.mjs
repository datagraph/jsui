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

// Some development hosts serve a certificate node will not verify -- the proxy
// then answers every API call with a socket error and the client reads it as the
// service being down.  Opt-in, and named for what it gives up: nothing verifies
// the upstream is who it claims to be.
//
// NOT needed for nl4.dydra.com, whatever an earlier reading of this file said:
// measured 27 Oct 2026, that host presents a complete, valid chain and node
// accepts it unaided.  Pass this only for a host that has actually been shown
// to need it.
const INSECURE = process.env.JSUI_UPSTREAM_INSECURE === '1';

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
    { host: UPSTREAM, port: 443, path: req.url, method: req.method, headers,
      ...(INSECURE ? { rejectUnauthorized: false } : {}) },
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
      const status = r.statusCode || 502;

      // ── The upstream's Content-Length cannot be trusted ──────────────────
      //
      // Measured 2026-10-23 against dydra.com:
      //
      //   POST .../collaboration, success  ->  204 No Content, Content-Length: 33,
      //                                        no body at all
      //   POST .../collaboration, refusal  ->  400 Bad Request, Content-Length: 2166,
      //                                        362 bytes sent
      //
      // Both are malformed: a 204 carries no content (RFC 9110 §15.3.5), and a
      // declared length must be the length actually sent.  curl tolerates the
      // short read and returns what arrived; a STRICT client -- the browser,
      // and node's own http client, which is what this proxy is built on --
      // waits for the missing bytes on a keep-alive connection that never
      // closes.  So the fetch never settles: in the browser the collaboration
      // pane's Save sits on "Saving…" for ever and a refusal is never shown,
      // and through this proxy every POST to that resource hung.
      //
      // What follows is a WORKAROUND in the harness, not a fix.  The defect is
      // in the service's response framing (spocq-server/http, which
      // push-source excludes); it is recorded in the test record.  Here: a
      // bodiless status is forwarded without framing headers, and a response
      // small enough to hold is buffered and re-sent under the length it
      // ACTUALLY had, so a truncated body arrives complete-as-sent instead of
      // hanging.  Anything large keeps streaming, untouched.
      if (status === 204 || status === 304) {
        delete out['content-length'];
        delete out['transfer-encoding'];
        res.writeHead(status, out);
        r.resume();
        res.end();
        return;
      }

      const declared = Number(out['content-length']);
      const BUFFER_LIMIT = 8 * 1024 * 1024;
      if (!Number.isFinite(declared) || declared > BUFFER_LIMIT) {
        res.writeHead(status, out);
        r.pipe(res);
        return;
      }

      const chunks = [];
      let received = 0;
      // The socket stays open after a short body, so 'end' may never come;
      // this fires when the upstream has gone quiet with the body incomplete.
      let idle = null;
      const finish = () => {
        if (res.headersSent) return;
        clearTimeout(idle);
        const body = Buffer.concat(chunks);
        if (body.length !== declared) {
          console.warn(`[dev-server] ${status} ${req.method} ${req.url}: upstream `
                     + `declared Content-Length ${declared}, sent ${body.length}`);
        }
        out['content-length'] = String(body.length);
        delete out['transfer-encoding'];
        res.writeHead(status, out);
        res.end(body);
      };
      const nudge = () => {
        clearTimeout(idle);
        idle = setTimeout(finish, 1500);
      };
      r.on('data', (c) => { chunks.push(c); received += c.length;
                            if (received >= declared) finish(); else nudge(); });
      r.on('end', finish);
      r.on('aborted', finish);
      r.on('error', finish);
      nudge();
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
