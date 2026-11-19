# Test record — 2026-11-04, nl4 after the patched nl9 build

Run under `doc/manual-test-protocol.md`.  Every number here comes from a log in
this directory.  Two repositories are involved:

| | |
|---|---|
| `jsui/` | `/Users/Shared/Development/Source/Library/org/datagraph/jsui` |
| target | **nl4.dydra.com**, reached through `tests/dev-server.mjs` on :8100 |

```sh
cd jsui
PORT=8100 JSUI_UPSTREAM=nl4.dydra.com node tests/dev-server.mjs
JSUI_ORIGIN=http://localhost:8100 JSUI_UPSTREAM=nl4.dydra.com npx playwright test
node doc/test-record/20261104/protocol/protocol-nl4.mjs <outdir>
```

Credential: `~/.dydra/nl4.dydra.com.playwright.token`, used as `:<token>`.
The client is **this working copy**, so anything newer than the deployment is
being exercised; the server half is nl4 as patched.

## Summary

| suite | target | result | vs. 20261023 |
|---|---|---|---|
| **A** node unit | offline | **1 637 passed, 0 failed** (23 files) | was 1 090 |
| **B** browser | offline | **644 passed, 0 failed** (12 files) | was 462 |
| **C** playwright documented | → nl4 | **63 passed, 1 failed, 10 skipped** of 74, 6.1 min | was **50 / 14 / 10** |
| **D** protocol, parts the specs miss | → nl4 | **13 passed, 0 failed** (run twice, same) | new |
| **E** API probes | → nl4 | see Findings 1–3 | new |

**Thirteen of the fourteen failures in the previous run are gone.**  All of
them were one host fault.  The one that remains is the one the previous record
already identified as unexplained by it.

---

## Findings

### 1. FIXED — `DELETE …/views/<name>` → 501

Probed directly with the headers `putView`/`deleteView` actually send
(`Accept: application/n-quads`; without it the host answers an HTML Query Log
page and the probe means nothing):

| | before | now |
|---|---|---|
| `PUT …/views/<n>` | — | **201**, and the view is listed |
| `DELETE …/views/<n>` | **501** | **200**, and the view is gone from the listing |

This alone accounted for **11 of the 14** failures in C″: four in
`view-documented` and seven in `sparql-documented`, where each test's scratch
view could not be removed in cleanup.  All eleven now pass.

### 2. FIXED — the SPARQL surface, and the shape of an ASK

```
SELECT * WHERE { ?s ?p ?o } LIMIT 3   →  200  {"head":{"vars":[...]},"results":{"bindings":[]}}
ASK { ?s ?p ?o }                      →  200  {"head":{},"boolean":false}
```

The 500 is gone, and an ASK answers with a boolean rather than a unit table —
the encoder fix is in the running image.

### 3. FIXED — `/system/accounts/<a>/configuration` no longer serves `"NIL"`

nl4 now returns a real account document.  **A password login works on nl4
again**; the token is no longer the only way in, which retires finding 11 of
the previous record.  (Protocol §0.2 should be read with that in mind — the
caveat is now historical, not current.)

### 4. STILL OPEN — repository profile properties

`repository-documented.spec.js:46 › repository profile properties
[REQ-3.2.1, REQ-3.2.3]` — the **only** failure in C.

Unchanged from the previous record: the summary field never becomes editable,
the locator resolves to `<span class="value empty" data-editable="true"
data-repo-field="abstract">`, and `fill` refuses it.  It passes against
dydra.com.  Specific to this host or to the `test` repository on it.

### 5. NEW, and in the CLIENT — `executeUrl` names a route that does not exist

`lib/dashboard/catalog.js:38` builds a view's execution URL as
`/<account>/<repository>/<name>`.  That is not where a view runs:

| URL | nl4 | dydra.com |
|---|---|---|
| `/playwright/test/<view>` | **406** `Repository export type "<view>" is not supported` | **406** |
| `/playwright/test/views/<view>` | **200** `application/sparql-results+json` | — |

The server reads the last segment as an **export format** for the repository,
not as a view name.  Failing against both hosts makes this a client defect and
not a host regression.

**Reach:** `runPanel` uses `executeUrl` only when `viaCatalog` is set, which is
the "write the panels as temporary views and run them by name" checkbox in the
dashboard pane (`dashboard-pane.js:741`) and in the figure gate
(`figure-gate.js:282`).  Opt-in, so it is latent for anyone who leaves the box
alone — and broken for everyone who ticks it.

**Fix:** `/${account}/${repository}/views/${name}`.  `viewUrl` (the system path
for PUT and DELETE) is correct and unaffected.

**FIXED 2026-11-04** — see *Both defects fixed* below.

### 6. NEW, and in the CLIENT — the editors pane does not scroll to the editor it just added

Reported from manual use, reproduced here with measurements.  See its own
section below.  **FIXED 2026-11-04.**

### 7. NEW, and in the CLIENT — a successful arrangement leaves the bar silent

Found 2026-11-05 while writing `doc/arrangement-manual/`, not by the protocol.

`App.instructWorkspace` (`ui/app.js:179`) calls `await this.redrawChrome()`
when a change was applied, and the redraw replaces the whole chrome — the
location bar with it.  The bar's `submit` then calls `say(message, {undo})`
from a closure that captured the OLD `#location-reply`, which is now detached.
The message and the undo are written into a node that is no longer in the
document.

Measured in a browser against the two orders of operation:

```
redraw inside instruct (what the App does):  reply hidden, text "", undo buttons 0
no redraw              (what the test does): reply shown, "set-layout — saved undo", 1
```

A **refused** instruction returns before the `if (out.ok && out.document)`
guard and so redraws nothing — its reply appears normally.  So refusals are
visible and successes are silent, which is the wrong way round, and the undo
that D-AU names as the trace a presentational change would otherwise not leave
is exactly the thing that goes missing.

**Why it survived:** `tests/location-bar.browser.mjs` asserts the undo (claim
4), but its stubbed `instruct` only records and returns — it never redraws.
The test and the App differ in the one respect that matters.

**Fix.**  Resolve the reply element at use time rather than at mount time: in
`ui/components/location-bar.js`, have `say()` and `clearReply()` take
`doc.getElementById(REPLY_ID)` and fall back to the captured node.  The ids are
fixed and the redrawn bar carries the same ones, so the old closure writes into
the new bar — which is the wanted behaviour here.  Add a case to the browser
test whose `instruct` redraws the chrome before it returns, or the next change
to this path will do it again.

Documented meanwhile in `doc/arrangement-manual/index.html` §6, with the
figure.

### 8. Noted — the host reports a stale base URI

Repository and view metadata from nl4 carries `https://nxp-dev.dydra.com/...`
in `uri`, `URL` and `IDENTIFIER`, and the page title reads
`Dydra [nxp-dev.dydra.com]`.  Nothing in this run depended on it.  Not
investigated.

---

## The editors-pane scroll defect

**Symptom.** Open a view's editor — or create a new view — and nothing
visibly happens.  The editor *is* added; it is added below the fold of a
container that does not move.

**Measured** (`protocol/supplementary-nl4.log`, 1440×900 viewport, three views
opened in turn from the Views list):

```
protoscroll1: editors 0→1  scrollY 0→0  editor top=209/900   inView=true
protoscroll2: editors 1→2  scrollY 0→0  editor top=686/900   inView=true
protoscroll3: editors 2→3  scrollY 0→0  editor top=1163/900  inView=false
```

**Why it is worse than "below the fold"** (`protocol/scroll-probe.mjs`): the
window cannot scroll at all — `document.scrollHeight` is 900, exactly the
viewport.  The only scrollable element is the container itself:

```
.view-editors-container   overflow-y: auto   scrollHeight 1459   clientHeight 478   ← scrolls
.view-editors             visible
.repository-views-layout  visible
#repository-queries       visible
#chrome                   visible            scrollHeight 900    clientHeight 900
body.repositories         visible            scrollHeight 900    clientHeight 900
```

So the third editor sits at 1163px inside a 478px-tall scroller that is left
at `scrollTop: 0`.  `protocol/editor-scroll-defect.png` is the screenshot:
three editors open, the pane showing only the **first**.

**Where it is.**  `ui/pages/index.js`, in `createEditorPanel` — and the
function already contains the right call, on the other branch.  Every line
number in this section is as the file stood BEFORE the fix; the fix adds four
lines to each copy, so the later ones have moved down.



```js
if (openViews.has(viewSlug)) {
  const existing = openViews.get(viewSlug);
  existing.scrollIntoView({ behavior: "smooth", block: "start" });   // :3751
  return;
}
…
container.appendChild(wrapper);                                       // :3763  — no scroll
openViews.set(viewSlug, wrapper);
```

Re-opening an editor that is **already** open scrolls to it; **adding** one
does not.  That asymmetry is backwards from what a user expects and is plainly
an oversight rather than a decision.  The second copy of the block has the same
shape: `:6004` scrolls, `:6016` does not.

**Every path that adds an editor is affected**, not just the new-view one:

| line | path |
|---|---|
| `:3914` | clicking a view in the Views list (`.view-edit`) |
| `:4185` | the views listing in the other pane |
| `:4299` | **New** → name it → the editor is added |
| `:6170`, `:6406`, `:6522` | the same three, in the second copy |

**Fix.**  `wrapper.scrollIntoView({ behavior: "smooth", block: "start" })` on
the newly created wrapper, in both copies.  Place it **after**
`window.createSparqlEditor(...)` returns, not next to the `appendChild`: at
append time the wrapper is an empty div with no height, and scrolling to it
lands somewhere that is about to move.

---

## Both defects fixed, and verified

Both were fixed in the working copy on the same day they were found, on the
user's word.  Neither fix is committed.

| file | change |
|---|---|
| `lib/dashboard/catalog.js` | `executeUrl` emits `/<account>/<repository>/views/<name>` |
| `ui/pages/index.js` | `wrapper.scrollIntoView({ behavior: "smooth", block: "start" })` after `createSparqlEditor` returns, in **both** copies of `createEditorPanel` |

### The route, against the live host

A view written, run by both spellings, and deleted — nl4, `test/foaf`:

```
PUT  /system/accounts/test/repositories/foaf/views/<n>   201
GET  /test/foaf/<n>                                      406   ← what the client used to send
GET  /test/foaf/views/<n>                                200   ← what it sends now
DELETE …/views/<n>                                       200
```

### The scroll, in the running client

Four editors opened in turn at 1440×900, measuring the scroller itself rather
than the window — the window still cannot scroll, which was never the point:

```
add sv1: editors=1 scrollTop=0     (max 95)    newEditorTopInPane=9   visible=true
add sv2: editors=2 scrollTop=477   (max 584)   newEditorTopInPane=89  visible=true
add sv3: editors=3 scrollTop=954   (max 1061)  newEditorTopInPane=89  visible=true
add sv4: editors=4 scrollTop=1431  (max 1538)  newEditorTopInPane=89  visible=true
```

Against the defect's own measurements — `scrollTop` 0 throughout, the third
editor at 1163px in a 478px scroller — the pane now follows each addition.
`protocol/editor-scroll-fixed.png` is the screenshot: the pane is showing
`/playwright/test/sv4`, the editor just added.

### The suites, after the fix

| suite | result |
|---|---|
| node unit (offline) | 1 637 passed, 0 failed |
| browser (offline) | 644 passed, 0 failed |
| playwright documented → nl4 | 63 passed, 1 failed, 10 skipped — the baseline, unchanged |

One test had to change with the code: `tests/figure-frame.browser.mjs` stubbed
the execution URL in the defective spelling and asserted it.  Its stub now
tells a write from a run by **method** — both paths carry `views` — and its
assertion names the corrected path.

A first full documented run also failed `view-documented.spec.js:136 edit
view` at the delete step.  It passes in isolation and did not recur on a second
full run; recorded as a flake, not as a regression.

---

## What did not run

Protocol parts **5 through 9** need a model provider key, and none is available
in this environment (`ANTHROPIC_API_KEY` unset; `~/.dydra/` holds store tokens
and one stale OpenAI key).  Not run, and therefore not claimed:

| part | |
|---|---|
| 5 | connecting a model, and reading the grant |
| 6 | an exploration — including the two refusal screens, which are the parts most worth attacking |
| 7 | a presentation, the gate, and arranging by instruction |
| 8 | a foreign presentation and its admission |
| 9 | two repositories side by side |

Everything that needs no model ran: parts 1, 2, 3, 4, 10, and §9.1 — the
structural claim that the chrome shows one repository at a time.

## What did run, of the protocol proper

| part | result |
|---|---|
| 1 login | the form shows, a token login succeeds, the session survives a reload (C) |
| 2.2 / 2.3 | a tab per repository; **both panes in the document, exactly one displayed** |
| 3 SPARQL | SELECT, ASK, and the view round trip — by API probe and by the documented specs |
| 4.1 | a path navigates — `display` becomes the path, the shown pane changes |
| 4.2 | `goto` before a path also navigates |
| 4.3 | `goto workspace` re-addresses — target reads `→ workspace (the arrangement)` — and does **not** navigate |
| 4.4 | an unknown name is refused: *there is nothing addressed as `zzz-no-such-target' — try workspace*.  No nearest match |
| 9.1 | confirmed on the running client: six hosts (`flashes header tabs content footer location`), one `content` |

Two notes for the protocol document itself, from driving it:

- **The bar is an address bar.**  `#location-display` is what is shown;
  clicking it reveals `#location-input` (`location-bar.js:225`).  A tester —
  or a driver — who types at the input without clicking the display is typing
  into something that is `display: none`.
- **Navigation is in-app and the URL never changes.**  The router runs with
  `updateLocation: false`, so `location.pathname` stays `/ui/user` throughout.
  Opening a second repository means going back to the account tab first,
  because the account pane is `display: none` while a repository is open and a
  hidden pane's links cannot be clicked.

Both belong in §0 of the protocol; neither is a defect.
