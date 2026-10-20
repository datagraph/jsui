/**
 * A place to run a compiled engine on the model's behalf.
 *
 * The figure frame (`lib/figure/frame.js') is `sandbox=""' and
 * `default-src 'none'': no script, by a decision (D-M) that is worth keeping
 * exactly as it is.  Model-authored SVG is active content, and the frame that
 * SHOWS it must not be able to act.  So a layout engine cannot go there.
 *
 * It does not follow that a layout engine cannot exist.  It follows that it
 * belongs in a different frame -- one that holds no model-authored markup at
 * all, only our code and a compiled engine, and that is given script and
 * nothing else:
 *
 *      sandbox="allow-scripts"            no same-origin, no forms,
 *                                         no top navigation, no popups
 *      default-src 'none'                 no network of any kind
 *      script-src 'unsafe-inline'         our two inline scripts; there is no
 *                  'wasm-unsafe-eval'     injection point, because the model's
 *                                         text never enters the DOCUMENT --
 *                                         it arrives afterwards, by
 *                                         postMessage, as an argument
 *      connect-src 'none'                 stated again, because an engine
 *                                         that phones home is the one thing
 *                                         a compiled blob could usefully do
 *
 * The model's text is therefore DATA to this frame, never code and never
 * markup.  What comes back is markup, and it is shown in the script-free
 * frame like any other figure -- so the engine's output is trusted no further
 * than the model's own output is.  That is the whole architecture:
 *
 *      model → DOT ──(data)──▶ engine frame ──(SVG)──▶ figure frame ──▶ user
 *                 allow-scripts, no network      sandbox="", no script
 *
 * The engine is committed to the repository (`vendor/'), not fetched: with
 * `default-src 'none'' it could not be fetched at run time anyway, and a
 * layout engine that arrives over the wire at the moment a picture is drawn
 * is a third party in the drawing.
 *
 * Nothing here is specific to graphviz.  A second engine -- a typesetter, a
 * projection, a layout for something else -- is a `vendor/' bundle, a driver
 * string, and a module like `lib/wasm/graphviz.js' that knows the shape of
 * its calls.  See that file for the smallest complete example.
 */

/* ── the policy ───────────────────────────────────────────────────────────── */

/** Script, and nothing else.  Not same-origin: the frame must not reach us. */
export const ENGINE_SANDBOX = "allow-scripts";

export const ENGINE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** How long one call may take before the frame is assumed wedged. */
export const DEFAULT_TIMEOUT = 15000;

/**
 * The document.
 *
 * Two inline scripts: the engine as vendored, then the driver.  Neither is
 * parameterised by anything the model wrote -- `buildEngineDocument' takes no
 * caller data at all beyond the two sources it is handed, which is what lets
 * `'unsafe-inline'' be the right call rather than a shortcut.
 *
 * A `</script' anywhere in either source would end the element early and turn
 * the rest into text.  Neither can be escaped (both are arbitrary JavaScript,
 * where `<\/script' is a syntax error outside a string), so the condition is
 * CHECKED instead, here, where it is cheap -- and again in
 * `tests/wasm-graphviz.test.mjs' against the vendored file itself.
 */
export function buildEngineDocument({ engineSource, driver, title = "engine" } = {}) {
  for (const [what, src] of [["engine", engineSource], ["driver", driver]]) {
    if (/<\/script/i.test(String(src || ""))) {
      throw new Error(`the ${what} source contains </script and cannot be inlined`);
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ENGINE_CSP}">
<title>${String(title).replace(/[<&]/g, "")}</title>
</head>
<body>
<script>${engineSource}</script>
<script>${driver}</script>
</body>
</html>`;
}

/* ── fetching a vendored engine ───────────────────────────────────────────── */

const sources = new Map();

/**
 * The engine's text, fetched once per URL and kept.
 *
 * This fetch is made by the PARENT, on its own origin, because the frame has
 * no network at all.  It is also why the engine is a classic script: an
 * opaque origin cannot resolve a module specifier, and a cross-origin module
 * `<script src>' would need CORS from a server nobody here configures.
 */
export function loadEngineSource(url, { fetch: f = null } = {}) {
  const key = String(url);
  if (!sources.has(key)) {
    const fetcher = f || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) return Promise.reject(new Error("no fetch available"));
    sources.set(key, Promise.resolve(fetcher(key)).then((res) => {
      if (!res.ok) throw new Error(`${res.status} fetching the engine`);
      return res.text();
    }).catch((e) => { sources.delete(key); throw e; }));
  }
  return sources.get(key);
}

/* ── the frame ────────────────────────────────────────────────────────────── */

let seq = 0;

/**
 * Start one engine frame and return a handle that can call into it.
 *
 * `call()' resolves with whatever the driver posts back for that id.  A call
 * that does not come back within `timeout' leaves the frame WEDGED -- the
 * engine is a compiled, synchronous blob, and a graph that takes forever to
 * lay out takes forever inside the frame's only thread -- so the frame is
 * destroyed, and the next call starts a new one.  The alternative is a tab
 * that burns a core until it is closed.
 */
export function createEngineFrame({
  name = "engine", engineSource, driver, doc = null, timeout = DEFAULT_TIMEOUT,
} = {}) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d) throw new Error("an engine frame needs a document");

  const page = buildEngineDocument({ engineSource, driver, title: name });
  const frame = d.createElement("iframe");
  frame.setAttribute("sandbox", ENGINE_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", `${name} (layout engine)`);
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;";
  frame.srcdoc = page;
  (d.body || d.documentElement).appendChild(frame);

  const view = d.defaultView || (typeof window !== "undefined" ? window : null);
  const pending = new Map();
  let dead = false;

  // The sender is identified by WINDOW, not by origin: a sandboxed frame's
  // origin is the string "null", which is also every other opaque origin's
  // origin, so it distinguishes nothing.  The window handle does.
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.__engine !== name) return;
    const waiting = pending.get(m.id);
    if (!waiting) return;
    pending.delete(m.id);
    clearTimeout(waiting.timer);
    waiting.resolve(m);
  };
  if (view) view.addEventListener("message", onMessage);

  function destroy(why = "destroyed") {
    dead = true;
    if (view) view.removeEventListener("message", onMessage);
    for (const [, waiting] of pending) {
      clearTimeout(waiting.timer);
      waiting.resolve({ ok: false, error: why });
    }
    pending.clear();
    frame.remove();
  }

  function call(payload, { timeout: t = timeout } = {}) {
    if (dead) return Promise.resolve({ ok: false, error: "the engine frame is gone" });
    const id = `${name}-${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // Not recoverable in place: see the note above.
        destroy(`the engine did not answer within ${t}ms`);
        resolve({ ok: false, error: `the engine did not answer within ${t}ms`,
                  timedOut: true });
      }, t);
      pending.set(id, { resolve, timer });
      const send = () => {
        if (frame.contentWindow) frame.contentWindow.postMessage({ ...payload, id }, "*");
      };
      // The frame may not have parsed yet.  A message posted into a document
      // that has not run its scripts is simply lost, so wait for load -- the
      // engine's own readiness is the driver's business, and it queues.
      if (frame.contentWindow && frame.dataset.loaded === "1") send();
      else frame.addEventListener("load", () => { frame.dataset.loaded = "1"; send(); },
                                  { once: true });
    });
  }

  return { frame, call, destroy, get dead() { return dead; }, page() { return page; } };
}

export default createEngineFrame;
