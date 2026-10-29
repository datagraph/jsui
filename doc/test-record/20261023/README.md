# Consolidated test record — 2026-10-23

Produced under `spocq-gensrc/doc/code-generation/jsui-test-record-protocol.md`.
Every number below comes from a log in this directory; none is quoted from a
terminal.  **Each log begins with the module it exercises, the command that
produces it, and what that command needs** — so any entry here can be
reproduced from the log alone.

Two repositories are involved, referred to throughout by these names:

| | |
|---|---|
| `jsui/` | `/Users/Shared/Development/Source/Library/org/datagraph/jsui` |
| `spocq/gensrc/` | `/Users/Shared/Development/Source/Library/org/datagraph/spocq/gensrc` |

## Credentials

**No test in this record has a working credential built into it any more**
(changed 2026-10-24; see Finding 8).  Supply them one of three ways:

One convention for both halves: **`~/.dydra/<host>.<account>.<kind>`**,
outside every working copy, where no `git add -A` can reach it.

```sh
# jsui secrets — tests/credentials.js resolves, in order:
JSUI_PASSWORD=... npx playwright test               # 1. the environment
JSUI_TOKEN=...    npx playwright test               #    or a token
~/.dydra/<host>.playwright.password                 # 2. host-qualified
~/.dydra/<host>.playwright.token                    #    or a token
~/.dydra/playwright.password                        # 3. same on every host
~/.dydra/playwright.token                           #    or a token

# spocq store tokens — common.sh resolves, in order:
STORE_TOKEN=<token> ./run-all.sh                    # 1. the environment
~/.dydra/nl4.dydra.com.test.token                   # 2. host-qualified
STORE_TOKEN='' ./run-all.sh                         # explicitly anonymous
```

There is **no default**: an unset credential stops the run with a message
naming both the variable and the file it looked for.  A default that works is
a default nobody overrides.

A token is used as `:<token>`, which the login field accepts and `lib/auth.js`
reads as *this IS the bearer token*.  **Host-qualified beats bare, and within
a tier a password beats a token**: an unqualified `<account>.password` must
not shadow the token that is the only thing a particular host accepts.  That
is not hypothetical — it is how nl4 is reached (C′, finding 11).

The password host is the host the **API** is on, not the origin the client is
served from — against the dev server the page is `localhost` while the account
lives upstream, so a loopback origin resolves to `JSUI_UPSTREAM`, else
`dydra.com`.

## Summary

| suite | module | target | result |
|---|---|---|---|
| **A** node unit | `jsui/tests/*.test.mjs` | fixtures, offline | **1090 passed, 0 failed** |
| **B** browser | `jsui/tests/*.browser.mjs` | fixtures, offline | **462 passed, 0 failed** |
| **C** playwright documented | `jsui/tests/*-documented.spec.js` | working copy → dydra.com API | **65 passed, 0 failed, 9 skipped** of 74 |
| **C′** the same, → nl4 API | as above, `JSUI_UPSTREAM=nl4.dydra.com` | working copy → nl4, **before** the `task-request` patch | **52 passed, 12 failed, 10 skipped** of 74 — every failure is the SPARQL surface, bar one |
| **C″** the same, → nl4 patched | as above | working copy → nl4, **after** the patch | **50 passed, 14 failed, 10 skipped** of 74 — no SPARQL failure left; 11 of the 14 are finding 13 |
| **D** mcp endpoint | `spocq/gensrc/mcp/test/` | nl4, after the patch | **200 of 200 checks passed, 23 of 23 scripts** (was 184/200 with `01` unrunnable) |
| **E** lisp probes | `spocq/gensrc/test/` | nl4 listener | **57 passed, 0 failed**; 1 not runnable |

**The build is `20261023T131410`, and it is deployed on nl4.**  That is new
since the first pass of this record: the earlier runs went against
`20261021T170800`, which carried none of the event work.  Both the lifecycle
events and the `cached_slug` fix are now in the running image and are
exercised below.

---

## A. Node unit tests — 1090 passed, 0 failed

**Where:** `jsui/tests/*.test.mjs` — 18 files behind 14 npm scripts.

```sh
cd jsui
npm run test:<name>          # one script; the log per script is named for it
npm run test:unit            # the gate: all fourteen, chained
```

Needs node only: fixtures, no network, no credentials.

**Run them one at a time for a record.**  `test:unit` is `a && b && c …`, so
the first failure stops the chain and every later script is then *absent*
rather than failed:

```sh
for s in router adapter log format record names dashboard figure shape \
         provenance wasm app toolbox admin; do
  npm run --silent test:$s 2>&1 | tee doc/test-record/<date>/unit/$s.log
done
```

| script | module | passed |
|---|---|---|
| `app` | `tests/app-{document,patch,parameters,repair,budget}.test.mjs` | 238 |
| `figure` | `tests/figure.test.mjs` | 123 |
| `toolbox` | `tests/toolbox.test.mjs` | 122 |
| `dashboard` | `tests/dashboard.test.mjs` | 119 |
| `admin` | `tests/administration.test.mjs` | 102 |
| `adapter` | `tests/tool-adapter.test.mjs` | 94 |
| `shape` | `tests/result-shape.test.mjs` | 58 |
| `format` | `tests/transcript.test.mjs` | 48 |
| `provenance` | `tests/provenance.test.mjs` | 41 |
| `wasm` | `tests/wasm-graphviz.test.mjs` | 38 |
| `names` | `tests/name-policy.test.mjs` | 35 |
| `record` | `tests/transcript-store.test.mjs` | 31 |
| `log` | `tests/session-log.test.mjs` | 29 |
| `router` | `tests/router-query.test.mjs` | 12 |

## B. Browser tests — 462 passed, 0 failed

**Where:** `jsui/tests/*.browser.mjs` — 9 files.

```sh
cd jsui
npm run test:<name>          # pane name-ui editor-ui dashboard-ui figure-ui
                             # wasm-ui app-ui app-interaction admin-ui
npm run test:browser         # all nine
```

Each starts its own http server over the working copy and drives headless
chromium through playwright's **library API** — not the test runner, and not
against any host.  No credentials.

| script | module | passed |
|---|---|---|
| `pane` | `tests/exploration-pane.browser.mjs` | 99 |
| `dashboard-ui` | `tests/dashboard-frame.browser.mjs` | 82 |
| `wasm-ui` | `tests/wasm-graphviz.browser.mjs` | 68 |
| `app-interaction` | `tests/app-interaction.browser.mjs` | 66 |
| `figure-ui` | `tests/figure-frame.browser.mjs` | 47 |
| `app-ui` | `tests/app-frame.browser.mjs` | 42 |
| `admin-ui` | `tests/administration.browser.mjs` | 21 |
| `name-ui` | `tests/name-input.browser.mjs` | 19 |
| `editor-ui` | `tests/view-editor-layout.browser.mjs` | 18 |

## C. Playwright documented specs

**Where:** `jsui/tests/*-documented.spec.js` — 13 spec files, collected by
`jsui/playwright.config.js` (`testDir: ./tests`,
`testMatch: **/*-documented.spec.js`).  Helpers: `tests/test-helpers.js`,
`tests/doc-capture.js`, `tests/api-cleanup.js`.

```sh
cd jsui
node tests/dev-server.mjs &                              # :8099, serves the WORKING COPY,
                                                         # proxies everything else upstream
JSUI_ORIGIN=http://localhost:8099 CAPTURE_DOCS=true npx playwright test
```

Needs network, and **it signs in and writes**: it creates, renames and deletes
repositories and views on the account it signs in as.  `workers: 1` is a
correctness setting, not a speed one.  Environment: `JSUI_ORIGIN`,
`JSUI_API_HOST`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JSUI_ACCOUNT`,
`JSUI_REPOSITORY`, `JSUI_COLLABORATOR`.

**Target the dev server, not the deployed origin.**  `JSUI_ORIGIN` defaults to
`https://dydra.com`, which serves a client that does not contain this work:

| module | dydra.com | dev server |
|---|---|---|
| `/ui/ui/components/history-table.js` | **404** | 200 |
| `/ui/ui/components/deletion-controls.js` | **404** | 200 |
| `/ui/lib/models/{roles,history,collaboration,accounts}.js` | **404** | 200 |
| `/ui/lib/llm/budget.js` | **404** | 200 |

Output: `tests/pdfs/<area>/` with a `manifest.json` and `index.html` per area,
and `tests/report/index.html`.  A `--list` also writes that report, with every
test resultless, which renders as *all skipped* — check its timestamp before
believing it.

**74 tests in 13 spec files: 65 passed, 0 failed, 9 skipped, in 6.8 minutes**
(`playwright/run-devserver-20261026.log`, 26 Oct).  This is the pass to cite:
it is the first one taken through `tests/credentials.js`, after the literal
passwords were removed (finding 8).

The 23 Oct pass is kept beside it as `playwright/run-devserver.log` — 64
passed, **1 failed**, 9 skipped in 7.4 minutes, the failure being
`events-documented.spec.js › history filters [REQ-2.5.4]`, which passed in
2.4s when re-run alone (`playwright/rerun-events.log`).

**Both flakes seen so far have now failed to recur.**  The 23 Oct pass lost
that test to a 20-second timeout; the pass before it lost
`sparql-documented.spec.js › query execution time display [REQ-4.3.4]` to a
`502` from the proxy's upstream.  Neither reappeared on 26 Oct.  The common
factor is the suite's duration — one worker, seven minutes against a live
service, with `retries: 0` in `playwright.config.js`, so a single slow
response or dropped connection fails a test outright.  `retries: 1` would make
the suite usable as a gate and would also hide exactly this signal, so it is
noted rather than changed.

The nine skips, each with its reason stated in the run:

| skipped | why |
|---|---|
| `order the listing by any column [REQ-2.4.3]` | needs two accounts; this agent sees one |
| `event table columns and agent [REQ-2.5.3, REQ-3.8.3]` | no event has been recorded yet |
| `event type names [REQ-3.8.1, REQ-3.8.7]` | likewise |
| `edit account profile fields [REQ-2.2.1, REQ-2.2.3]` | pre-existing |
| `create and delete account [REQ-A.3.3, REQ-A.3.4]` | pre-existing; needs an administrator |
| `create and delete repository [REQ-A.4.2, REQ-A.4.3]` | pre-existing |
| `create and delete invitation [REQ-A.5.2, REQ-A.5.3]` | pre-existing |
| `transaction history [REQ-A.6.3]` | pre-existing |
| `import history table and graph [REQ-A.6.4, REQ-A.6.5]` | pre-existing |

**The two event skips did not clear, and the reason is a target mismatch
rather than a defect.**  The 26 Oct pass created, renamed and deleted
repositories and views, which is exactly what should write a lifecycle row —
and both tests skipped again for want of one.  The recording hooks are in
build `20261023T131410`, which is deployed on **nl4**; the suite's API target
is `JSUI_UPSTREAM`, which defaults to **dydra.com**, a different and older
image.  The dev server serves the working-copy client but proxies every API
call upstream, so the client under test was current and the service behind it
was not.

**That run was then made, and it does not clear them** — see C′ below.  Both
hosts are now known to be unable to exercise the event work, for different
reasons, and neither reason is in the client.

### C′  The same suite against nl4 — 52 passed, 12 failed, 10 skipped

```sh
cd jsui
JSUI_UPSTREAM=nl4.dydra.com JSUI_UPSTREAM_INSECURE=1 node tests/dev-server.mjs &
JSUI_ORIGIN=http://localhost:8099 JSUI_UPSTREAM=nl4.dydra.com \
  CAPTURE_DOCS=true npx playwright test
```

Log: `playwright/run-nl4-20261027.log`, 6.9 minutes.  Two earlier attempts are
superseded and the second is kept for what it records about the host:
`run-nl4-20261026.log` was **13 passed, 53 failed** because the client could
not sign in at all.

**The way in is a token, not a password.**  The login field is "Password or
Token", and `lib/auth.js` reads a leading `:` as *this IS the bearer token,
do not go and ask for one* — which skips
`/system/accounts/<a>/configuration` entirely, and that resource is the one
nl4 answers `"NIL"` (finding 11).  `~/.dydra/` already held
`nl4.dydra.com.playwright.token` and `nl4.dydra.com.test.token`, so nothing
had to be issued.  `tests/credentials.js` now resolves either kind:

```
1. $JSUI_PASSWORD / $ADMIN_PASSWORD
2. $JSUI_TOKEN    / $ADMIN_TOKEN            → used as ":<token>"
3. ~/.dydra/<host>.<account>.password
4. ~/.dydra/<host>.<account>.token          → used as ":<token>"
5. ~/.dydra/<account>.password
6. ~/.dydra/<account>.token                 → used as ":<token>"
```

**Host-qualified beats bare, and within a tier a password beats a token** —
otherwise the unqualified `~/.dydra/playwright.password`, which exists, would
shadow the nl4 token, which is the only thing that host accepts.  dydra.com
still resolves to the password, so the 26 Oct pass remains comparable.

`JSUI_UPSTREAM_INSECURE=1` was added to `tests/dev-server.mjs` and used for
this run, on the reading that nl4 served a certificate node would not accept.
**That reading was wrong, and the switch is not needed for nl4.**  Re-measured
27 Oct: the host presents a Sectigo-issued `*.dydra.com` certificate with the
full four-certificate chain, valid 13 Jul 2026 to 27 Jan 2027, and
`openssl s_client` answers `Verify return code: 0 (ok)`.  `curl` with ordinary
verification reaches it, and so does node — `socket.authorized === true`.  The
option stays in the dev server as an opt-in for hosts that genuinely need it;
it should not be passed for nl4.

#### Superseded: C″, the same suite after the `task-request` patch

The 52/12/10 run below was made against a host that answered 500 to every
SPARQL request.  That is fixed (finding 9), and the suite was re-run the same
evening: **50 passed, 14 failed, 10 skipped**, log
`playwright/run-nl4-20261027b.log`, 7.1 minutes, no `JSUI_UPSTREAM_INSECURE`.

Fewer passes and more failures is not a regression.  Eleven of the twelve
earlier failures were the 500; all of them are gone, including the four import
tests, which now pass.  What the 500 had been hiding is a **second host fault,
in view management**, which fails thirteen tests of its own:

| failures (C″) | cause |
|---|---|
| 4 × `view-documented` | `DELETE …/views/<name>` → **501** (finding 13) |
| 7 × `sparql-documented` | the scratch view each creates cannot be removed — the same 501 in cleanup |
| 1 × `sparql-documented › query reset` | reads back `LIMIT 999`, not the saved query |
| 1 × `view-documented › edit view` | reads back `LIMIT 10`, not the modified query |
| 1 × `repository-documented › profile properties` | **not** the 501 — see below |

The last two of the view failures are the same defect seen from the other
side: a save that does not come back.  No SPARQL failure remains.

`repository profile properties [REQ-3.2.1, REQ-3.2.3]` fails because the
summary field never becomes editable: the locator resolves to
`<span class="value empty" data-editable="true" data-repo-field="abstract">`
and `fill` refuses it.  It passes against dydra.com, so it is specific to
this host or to the `test` repository there, and it is the one failure not
explained by the SPARQL surface.  Open.

Two more lines read as failures but are counted as passes: `browser
back/forward [REQ-5.1.2]` and `navigation between account and repositories
[REQ-5.2.5]` carry `test.fail()`, holding open a requirement that is under
review rather than asserting either way.  The list reporter marks them ✘;
playwright counts them in the 52 (and in C″'s 50).

#### Three failures this record caused, and fixed

Introducing the token broke three tests, all the same way.  Three specs built
their own header inside `page.evaluate`:

```js
Authorization: `Basic ${btoa(`${user}:${password}`)}`
```

With the secret now `:<token>`, that base64s a token as though it were a
password, and the service answers 401.  Five sites across
`events-documented`, `accounts-pane-documented` and
`collaboration-documented`.  They now call `authorizationFor()` in
`credentials.js`, which applies the client's own rules — `:`, `token:` or
`bearer ` mean Bearer, anything else means Basic — and composes the header
**in node**, passing a finished string into the page.  That also keeps the
password out of the page's context.  All three pass.

#### The event skips did not clear, and the reason is finding 12

`events offered and fetched per account [REQ-2.5.1, REQ-2.5.2]` and
`history filters [REQ-2.5.4]` now pass against nl4.  The two that read an
event TABLE still skip, because the account has no events — see finding 12.

## D. MCP endpoint — 200 of 200 checks passed

**Where:** `spocq/gensrc/mcp/test/` — 23 numbered scripts plus `shakedown.sh`.

```sh
cd spocq/gensrc/mcp/test
export STORE_HOST=https://nl4.dydra.com MCP_PATH=/test/test/mcp \
       MCP_INSECURE=1 STORE_ACCOUNT=test
./run-all.sh                                     # 01 first, fatal on failure
for s in 0[2-9]-*.sh [12][0-9]-*.sh; do bash $s; done   # what was run here
MCP_URL=<url> MCP_TOKEN=<token> ./shakedown.sh   # requirement-keyed roll-up
cd spocq/gensrc && ./utilities/execute-spocq < mcp/test/mcp-selftest.lisp
```

`MCP_INSECURE=1` is needed to run `mcp_call.py` from THIS machine, and the
reason is local, not nl4's: the host's certificate chain verifies (see C′), and
python fails with `CERTIFICATE_VERIFY_FAILED` because its own trust store does
not carry the chain's root, which `openssl`, `curl` and node all do.  The
better fix is to furnish that python with the certificates; until then it is a
workaround for a client, not a property of the host.  The
token resolves from `~/.dydra/nl4.dydra.com.test.token` with nothing in the
environment — `STORE_ACCOUNT` defaults to `test`, which is the account that
file names.  **The token is accepted**: `/test/test/sparql` answers `401`
unauthenticated and `200` with it.

`run-all.sh` could still not be used, because its prerequisite cannot run —
see below.  The 22 scripts it would run afterwards were run directly, against
the fixture a previous pass had already loaded, which is still in place
(`09` finds `http://test/test/schema`, `07` finds `Alice Smith`).

**22 scripts: 18 passed, 4 failed; 184 of 200 checks.**
Log: `mcp/run-nl4-20261026.log`.

| script | checks | | script | checks |
|---|---|---|---|---|
| `02-initialize` | **3/4** | | `13-discover` | 10/10 |
| `03-tools-list` | 21/21 | | `14-headers` | 14/14 |
| `04-resources-list` | 10/10 | | `15-tool-errors` | 15/15 |
| `05-graphql-query-persons` | 7/7 | | `16-notation-sparql` | 21/21 |
| `06-graphql-query-filter` | 4/4 | | `17-notation-graphql` | 7/7 |
| `07-sparql-select` | 5/5 | | `18-notation-score` | 7/7 |
| `08-sparql-describe` | 4/4 | | `19-score-session` | **8/16** |
| `09-list-graphs` | 4/4 | | `20-score-resolve` | **2/5** |
| `10-resources-read-schema` | 8/8 | | `21-score-materialize` | **0/4** |
| `11-resources-read-graphs` | 6/6 | | `22-score-resources` | 12/12 |
| `12-resources-read-types` | 6/6 | | `23-describe-depth` | 10/10 |

**The protocol surface is sound.**  Everything the 2026-07-28 era specifies —
`server/discover`, the stateless header validation, the tool and resource
manifests, `isError` versus JSON-RPC, the three request notations and their
paired responses, DESCRIBE form and depth — passes in full, 15 tools listed
and ordered deterministically.  The three failing areas are the score
*session*, and they are one defect (finding 10).  `02`'s single failure is the
legacy-era `ping`.

### D.1  `01-import` could not run — CLOSED 27 Oct

```
POST https://nl4.dydra.com/test/test/sparql   →  HTTP 500       (before)
                                              →  PASS, 4 checks  (after)
```

`01-import.sh` clears with `DROP SILENT ALL` over `POST …/sparql` before it
loads `data/dataset.nq`, and that surface answered 500 on nl4 for every
repository and every request form.  `run-all.sh` treats `01`'s failure as
fatal and exits, which is why the suite had to be driven script by script.
With finding 9 patched, `./run-all.sh` completes unattended.

### D.2  The re-run: 200 of 200, 23 of 23

Log: `mcp/run-nl4-20261027.log`.  The 23 Oct log is kept beside it.

```sh
cd spocq/gensrc/mcp/test
export STORE_HOST=https://nl4.dydra.com MCP_PATH=/test/test/mcp \
       MCP_INSECURE=1 STORE_ACCOUNT=test
./run-all.sh
```

Every script passes, `01-import` included; the harness's own line reads
`Results: 22 passed, 0 failed` because it counts the twenty-two it drives
after running `01` itself.  **The sixteen score-session failures are gone
too** — see finding 10.

## E. Lisp probes — 57 passed, 0 failed, 1 not runnable

**Where:** `spocq/gensrc/test/`.

```sh
cd spocq/gensrc
./utilities/execute-spocq < test/alf-probe.lisp      # 17 checks, account listing fields
./utilities/execute-spocq < test/collab-probe.lisp   # 25 checks, the collaboration model
sbcl --script test/cached-slug-test.lisp             # 15 checks, no image needed
python3 -I test/balance.py <file.lisp>...            # a paren lint, not a test
```

`execute-spocq` ssh's to nl4 and runs `/opt/spocq/spocq-listener` — **the
binary, not a server**.  Note that `push-source` excludes `/test/`: the probes
exist only on the development machine and are piped in, never found on a host.

| probe | result |
|---|---|
| `alf-probe.lisp` | **17 passed, 0 failed** |
| `collab-probe.lisp` | **25 passed, 0 failed** |
| `cached-slug-test.lisp` | **15 passed, 0 failed** |
| `balance.py` (lint) | 5 files balanced |
| `patch-readcheck.lisp` | **not runnable** |

`patch-readcheck.lisp` must run in a bare SBCL (`sbcl --script
test/patch-readcheck.lisp`), not through `execute-spocq`: it `make-package`s
the spocq packages, which already exist in an image.  It loads
`/tmp/stubs.lisp` — one package per prefix the patch files name, one symbol
per reference, generated *from the files themselves* — and **that generator is
not in the repository**, so the check cannot be repeated by anyone.
Committing it is an open item.

### E.1  What the running image has

`lisp/identity.log`, against build `20261023T131410`:

```
BUILD     20261023T131410
REVISION  development-gensrc@bf329b06efb2ee7dfc474804f68c30c5bae9b685

spocq.i    COMPUTE-CACHED-SLUG, ENSURE-SQL-CACHED-SLUG, LIFECYCLE-EVENT-TYPES,
           MAKE-LIFECYCLE-EVENT-TYPE, READ-COLLABORATIONS, READ-SQL-EVENTS,
           WRITE-SQL-{ACCOUNT,REPOSITORY,QUERY}            all FBOUND
spocq.si   RECORD-REPOSITORY-OPERATION-EVENT, RECORD-GRAPH-STORE-UPDATE,
           COMPUTE-GET-ACCOUNTS, ACCOUNT-LIFECYCLE-TIMES   all FBOUND
```

All fifteen event types are generated in the image —
`AccountCreatedEvent` … `QueryImportedEvent` — and `compute-cached-slug`
answers `"mcp"→"mcp"`, `"my repo"→"my-repo"`, `"MixedCase"→"MixedCase"`,
`""→NIL` there as it does in the standalone test.

**Two corrections to the first pass of this record.**  It reported
`RECORD-REPOSITORY-OPERATION-EVENT`, `RECORD-GRAPH-STORE-UPDATE` and
`COMPUTE-GET-ACCOUNTS` as `NO-SYMBOL`; that was **my error** — they are
defined in `org.datagraph.spocq.server.implementation` (`spocq.si`) and the
probe looked in `spocq.i`.  The absence of `LIFECYCLE-EVENT-TYPES` was real.
And it said the build was deployed nowhere; it is now on nl4.

---

## Findings

**1. Every PDF manifest was `[]`.**  All twelve directories under
`tests/pdfs/` held an empty array while 130 PDFs sat beside them, so every
`index.html` rendered empty and no capture could be cited against its
requirement.  Cause: each test built its own `DocCapture` and
`writeManifest()` wrote that test's captures over the previous test's — last
writer won, and a last test that captured nothing wrote `[]`.  Fixed in
`jsui/tests/doc-capture.js`: merged on disk, with entries whose file is gone
pruned.

**2. The service overstates `Content-Length`.**  Measured against dydra.com:

| request | answer | body sent |
|---|---|---|
| `POST …/collaboration`, success | `204 No Content`, `Content-Length: 33` | 0 bytes |
| `POST …/collaboration`, refusal | `400 Bad Request`, `Content-Length: 2166` | 362 bytes |

A 204 carries no content (RFC 9110 §15.3.5), and a declared length must be the
length sent.  `curl` tolerates the short read; the browser and node's http
client wait on a keep-alive connection for bytes that never arrive.  **In the
browser the collaboration pane's Save sits on "Saving…" for ever and a refusal
is never shown to the user.**  `http:no-content` is in `spocq-server/http`,
which `push-source` excludes, so this is recorded, not patched;
`jsui/tests/dev-server.mjs` works around it for the harness.

**3. The collaboration Save control never returned after a save.**  Fixed in
`jsui/ui/pages/index.js`: the success path called
`updateCollaborationSaveButton` while the button still read "Saving…", and
that function refuses to touch a button in that state, so `disabled` stayed
true.

**4. `JSUI_ORIGIN` never applied.**  Every helper navigated with an absolute
`https://dydra.com`, and `login()` never filled the Host field.  Both fixed in
`jsui/tests/test-helpers.js`.

**5. `cached_slug` was NULL on every self-provisioned row.**  Fixed in
`spocq/gensrc/odbc/views.lisp` and `store/rdfcache/rdfcache.lisp`, built as
`20261023T131410`.

`dydra-admin create-repository` — the external CLI run from
`initialize-repository-storage` (`core/classes.lisp:4588`) — INSERTs the
repositories row without a slug.  `initialize-repository-metadata` then
guarded its own insert with `(unless (read-sql-repository …))`, which the
CLI's row satisfied, so the branch carrying `:cached-slug` was skipped exactly
when it was needed.  Hence `revprobe`, `revprobe3`, `mcpprobe`, `mcp`, `repl`
with NULL, beside rails-made rows that all have one.  The account path had the
same shape, with an unconditional insert that would have put a second row
beside the CLI's.

It is not cosmetic: rails addresses these rows by the slug
(`has_friendly_id :name`, `slug_column = :cached_slug`), and the service's own
authorization queries match `name = X OR cached_slug = X`.

Now `ensure-sql-cached-slug` runs inside `write-sql-account`,
`write-sql-repository` and `write-sql-query`, so no path can write a NULL, and
the two metadata initialisers complete an existing row rather than skipping
it.  The rule is the one already in the tree at `spocq-server/repository.lisp`
— the name with spaces hyphenated, **not** downcased, because the `name = X`
half of those disjunctions must keep matching.

**The five existing NULL rows are not repaired.**  The fix completes a row the
next time that repository is initialised; it does not sweep the table.
`UPDATE repositories SET cached_slug = name WHERE cached_slug IS NULL` would,
and is left to be run deliberately.

**8. Working credentials were committed, in both repositories.**  Found and
removed 2026-10-24; **they are still in the git history and must be treated as
compromised and rotated.**

The account password appeared as a literal default in six jsui files —
`tests/test-helpers.js` (both `login` and `adminLogin`),
`tests/clean-test-repos.mjs`, `tests/admin-documented.spec.js`,
`tests/zz-shot-documented.spec.js`, `doc/demo-dydra-studio.js` and
`instructions.md` — plus three in `tests-inst/`.  jsui's remote is
`git@github.com:datagraph/jsui.git` and all of those are tracked; `git log -S`
puts the string in the tree from the **initial commit** (2026-02-18), again in
`7d9764f` (2026-03-02) and `3ba0513` (2026-10-12).

A store bearer token appeared the same way in four spocq `common.sh` files
(`mcp/test`, `graphql/test`, `graphql/test/mutation-test`,
`graphql/test/graphql-http-test`).  spocq has remotes
`git@github.com:lisp/spocq.git` and a gitlab origin; two of the four are
tracked, and the token entered the history in `b0a37dd` (2026-02-25).

Now: jsui resolves through `tests/credentials.js` — environment, then
`~/.dydra/<host>.<account>.password`, then `~/.dydra/<account>.password`,
then **raise**.  The shell suites resolve `STORE_TOKEN` from the environment,
then `~/.dydra/<host>.<account>.token` — the convention
`mcp-demonstration.sh` already used — then **exit 2**, with `STORE_TOKEN=''`
still meaning a deliberate anonymous run.  Verified both ways: unset refuses
with the variable named, configured runs normally.

`tests-inst/` is tracked too, so its literals were replaced with the
undefined identifier `REDACTED_SEE_TESTS_CREDENTIALS` — that frozen copy is
not to be run, and now fails rather than authenticating if someone tries.

The four tracked `src/` copies were corrected too, on request.

**The audit widened once the `src/` tree was searched.**  The token is
`james`', not a test account's, and `spocq/src/javascripts/utilities/
system.nq` and `system.system.nq` are full production metadata exports —
**1,298 accounts, 1,299 accessToken and 1,302 encryptedPassword triples**.
They were never committed, but they were not ignored either, so one
`git add -A` would have published every production credential; they are
ignored as of today.  See **`CREDENTIAL-RESET.md`** beside this file for which
accounts on which hosts to reset, and for what was deliberately left alone.

**6. The service has recorded no lifecycle events.**
`GET /system/accounts/playwright/history` answers `[]`.  The recording hooks
are in the running build now, but no operation has yet been performed through
it that would write one, so the event table can still only be exercised empty.

**7. The test account is not an administrator.**  The accounts pane carries
the narrowed note, so REQ-2.4.4 and REQ-2.6.1 are asserted in their
non-administrator half — which is also the requirement.  The specs read the
role off the pane and say which half they tested.

**9. nl4 cannot serve SPARQL over HTTP at all.**  Build `20261023T131410`,
the one carrying the event and `cached_slug` work, answers every request to
every repository's `/sparql` with:

```
HTTP 500  [NO-APPLICABLE-METHOD-ERROR] There is no applicable method for the
          generic function #<STANDARD-GENERIC-FUNCTION
          (COMMON-LISP:SETF ORG.DATAGRAPH.SPOCQ.IMPLEMENTATION::TASK-REQUEST) (0)>
          when called with arguments
          (#<…SPOCQ-REQUEST POST /test/test/sparql …>
```

Reproduced on `/test/test`, `/test/foaf` and `/test/mcp`, as GET with
`?query=`, as POST `application/sparql-query`, as POST
`application/x-www-form-urlencoded`, and as POST `application/sparql-update`;
the same query against dydra.com answers 200.  **`(0)` is the method count**:
the writer generic exists and has no methods, so a slot accessor the request
path calls was not defined in the image that was loaded.

Three things narrow it.  The **graph store** surface (`…/service`) works.
The **MCP** tool path queries the same repositories successfully — `07`
returns `Alice Smith` out of the store — so the engine, the dictionary and
the repository are all fine.  And suite E talks to the `spocq-listener`
binary through `execute-spocq`, never to the server, which is why 57 lisp
checks pass against a host whose query endpoint is dead.  **A probe that runs
the binary cannot see this class of fault**; only an HTTP request can.

It is not a jsui defect; it is a property of what is deployed on that host.

**Cause, 27 Oct.**  `graph-store-query` in
`spocq-server/response-functions.lisp` stashes the http request on the query
before it generates the response headers:

```lisp
(setf (spocq.i::task-commit-constraint query) (http:request-header request "Commit-Constraint"))
(setf (spocq.i::task-request query) request)
```

In gensrc that writer is a slot accessor — `core/classes.lisp` gives `task` a
`request` slot with `:accessor task-request`.  **The revision deployed on nl4
has no such slot**, and neither does the other host revision: `task` carries
`request-exchange`, `request-routing-key`, `request-location`,
`request-content-type`, `request-signature` and `request-content`, and no
`request`.  The two lines above are adjacent, and `commit-constraint` *is* a
slot there, so the first succeeds and only the second finds nothing.  The
generic with no methods comes from a patch that declares the writer under an
`(unless (fboundp …))` guard without defining a method — which is what turned
an `undefined function` at load time into a `no-applicable-method` at request
time, and why nothing in the listener's banner ever said so.

**Patched** as `task-request.lisp` in both copies of the `20260929-mcp`
bundle (`spocq-b86ed687` and `spocq-e4826228`), registered in
`*mcp-patch-prerequisites*`, banner bumped to `20261027`.  It defines the
accessor over a weak table keyed by the task rather than redefining a
fifty-slot class, and it does nothing at all on an image whose `task` class
has the slot.

**RESOLVED on nl4, 27 Oct**, by delivering `task-request.lisp` and the updated
`load.lisp` to the host's patch directory and restarting.  Verified directly:

| request | before | after |
|---|---|---|
| `GET …/playwright/test/sparql?query=SELECT…` | 500 | **200** |
| `POST`, `application/sparql-query`, `ASK` | 500 | **200** |
| `POST`, `application/sparql-update`, `INSERT DATA` + `DROP` | 500 | **200** |
| `SELECT ?g (COUNT(*)) … GROUP BY ?g` | 500 | **200**, the named graphs |

An unqualified `SELECT * WHERE { ?s ?p ?o }` answers 200 with no bindings,
which is right: every quad in that repository is in a named graph and the
default graph is empty.  Suite C against nl4 was re-run on the fixed host —
see C″ — and the four import failures are gone with the rest.

**10. A score session handle is dead on arrival.**  `19`, `20` and `21` fail
for one reason, in two calls:

```
connect  →  session: "FC3E2B9A-D0D8-11F1-95F8-3BCB8CEB8DDD"
history  →  isError: Unknown exploration session:
            FC3E2B9A-D0D8-11F1-95F8-3BCB8CEB8DDD.  It may have expired;
            call survey with op=connect for a new handle.
```

The handle the server has just issued is not recognised by the request that
follows it, with no delay between them, so every test that explores across
more than one call fails: survey and select against a handle, history, the
tree, the session resource, disconnect, name resolution, the shaped select,
and the whole of materialize.  `22-score-resources` passes because it reads
the grammar and the operations list, which need no session.

One check does pass — *a released handle no longer resolves* — which is the
same observation read as a success.

This is the "session handles unstable" symptom the earlier nl4 shakedown
recorded, now reduced to two calls.  Sessions are persisted as RDF in
`<account>/mcp` and the graph is read before the process cache, so a
persisted read that fails, or a second request served by a process that
shares no cache, would both look like this.  Which of those it is has not
been established, and finding 9 sits close enough to it to be worth ruling
out first.

**RESOLVED, 27 Oct, and it WAS finding 9.**  With the `task-request` patch
loaded and nothing else changed, `19-score-session` (16 checks),
`20-score-resolve` (5) and `21-score-materialize` (4) all pass.  Ruling out
finding 9 first was the right order and it turned out to be the whole of it:
a session is persisted as RDF in `<account>/mcp` and read back before the
process cache, that read-back goes over the SPARQL surface, and that surface
was answering 500 to everything.  A handle issued into a store that cannot
be queried is a handle that does not exist on the next call — which is
exactly what "dead on arrival" looked like.  The reading in the paragraph
above — *a persisted read that fails* — was right; what it could not see was
why the read failed.

**11. nl4 answers the sign-in endpoint with `"NIL"`.**
`GET /system/accounts/<account>/configuration` returns HTTP 200,
`content-type: application/json`, body `"NIL"` — a JSON string where the
account document belongs.  `lib/auth.js` reads `accessToken` off it, finds
nothing, and reports *Server did not return an access token*.  **No client
can log in to that host.**

It answered correctly earlier the same day, so something changed under it
rather than it never having worked.  **It is worked around, not fixed**: a
`:<token>` login does not read this resource at all, which is how C′ now runs
against that host (and `lib/auth.js` carries the note explaining why it no
longer refuses to proceed without an `accessToken`).  A password login to nl4
still cannot succeed.

**The corrected SQL database did not change it.**  As of 27 Oct nl4's rails
titles its pages `Dydra [nl4.dydra.com]`, where before it said
`nxp-dev.dydra.com` — so that half took.  This endpoint still answers `"NIL"`,
`/…/sparql` still answers the same 500, and the service still reports
repository URIs as `https://nxp-dev.dydra.com/playwright/…`.  Taken with findings 9 and 10 and the
`Unknown database 'nxp_dev'` error, nl4's metadata path is the common
element: a 500 from one endpoint, `"NIL"` from another, a missing method on
the SPARQL surface, and a session handle that does not survive the request
that issues it.  Whether those are one fault or four has not been
established, and nothing here says they are.

**Because of this, the lifecycle-event assertions cannot presently be
exercised anywhere.**  dydra.com serves `…/history` and returns `[]` from a
build with no recording hooks; nl4 has the hooks and refuses the session.
The two tests are correct to skip on the first and fail on the second; the
gap is in the hosts, not in the specs.

**12. The account has no events of its own; its repositories do.**  This is
why the two event-table tests skip, and it is neither the build nor the host:

```
GET /system/accounts/playwright/repositories/test/history
  → [{"agent": "test", "action": "RepositoryCreatedEvent",
      "target": {"type": "repository", "name": "playwright/test"}, …}]

GET /system/accounts/playwright/history          → []
```

**Both answers are the same on dydra.com and on nl4.**  The recording works,
and `RepositoryCreatedEvent` is the current rails-shaped spelling, noun
first.  The accounts pane reads the account resource, which is empty because
nothing has written an account-scoped event: the playwright account predates
the hooks, and the only test that would write one —
`account-documented › edit account profile fields` — is held behind
`JSUI_ALLOW_ACCOUNT_WRITE=1`.

That gate is not timidity.  Saving the account configuration runs
`propagate-account-metadata`, which deletes the account's and the owner's
statements and rewrites them from the SQL row; the row's
`encrypted_password` is stale with respect to a password reset, so the save
silently undoes the reset.  Measured in this tree: **10/10 logins succeed
before a suite run, 0/10 after**.  So the one action that would populate the
account's history is the one known to break that account's authentication —
and on nl4, where the way in is a token held in the same metadata, it would
take the token with it.

Three ways out, none taken here: fix the propagation; point the write at a
throwaway account nothing else uses; or settle whether an account's history
is meant to aggregate the events of its repositories, which would make the
pane non-empty without writing anything.  **The third is a requirements
question, not a defect** — REQ-2.5.1 does not say which it is.

**13. nl4 has no DELETE on a saved view, and says it does.**  Found by C″,
after finding 9 stopped masking it.  `DELETE
/system/accounts/<a>/repositories/<r>/views/<name>` answers:

```
501  method (:DELETE x #<MIME:TEXT/HTML>) not among those implemented
     for resource (".../views/sparql-run-1793060612103" . (:GET :HEAD :OPTIONS))
```

for every view, existing or not, and for every `Accept` tried —
`application/json`, `text/html`, `*/*`,
`application/sparql-results+json`.  **`OPTIONS` on the same URL answers
`Allow: DELETE,GET,HEAD,OPTIONS,PATCH,PUT,POST`**, so the advertised method
set and the implemented one disagree; a client that asks is told the wrong
thing.  dydra.com implements it: the same `DELETE` there answers 200.

It accounts for eleven of C″'s fourteen failures — four view tests delete
directly, seven sparql tests fail in cleanup because the scratch view each
creates cannot be removed.  `GET` and `PUT` work (`PUT` answers 201 and the
view appears in the collection), so views can be made on nl4 and not unmade;
the suite leaves them behind, and this run left seven.

Two further observations from the same probe, neither chased further:

- The collection answers with URLs built on the **old deployment name** —
  `"URL": "https://nxp-dev.dydra.com/playwright/test/sparql-run-…"` — so the
  SQL correction has not reached everything that names the host.  A `PUT`
  to a fresh name returns 201 and the subsequent `GET` of that name answers
  500, while an older view reads back 200.
- Two C″ failures are a save that does not come back (`edit view` reads
  `LIMIT 10`, `query reset` reads `LIMIT 999`).  Consistent with the above,
  not established.

Not a jsui defect: the client issues the request the requirement specifies
and the host refuses the method.

**PATCH WRITTEN 27 Oct, not yet delivered.**
`patches/20260929-mcp/view-delete.lisp`, in both host copies of the bundle,
banner `20261028`.  The nl9 revision's `administration` carries three `:get`
clauses and one `:put` for this resource and no `:delete` at all, so the
request falls to the method combination's default branch -- which is where the
501 is generated, and why the verb list in its text is the set of verbs that
happen to have a method rather than a statement of policy.  de17 is not short
of it: `patches/user-20260202.lisp` defines both the route and a
three-argument `graph-store-delete-view`, so the file guards itself and stands
aside there.

It does the deletion itself rather than calling `graph-store-delete-view`,
for a reason worth recording: that generic takes TWO arguments on b86ed687
and on de17's base source, and three after `user-20260202.lisp` redefines it.
More to the point, the two-argument one reads the view name out of
`(http:resource-path resource)` through `*view-identifier-scanner*` -- and
that parse gives the wrong name on this route.  The scanner reads as three
segments, `/account/repo/view`, but its third register is
`(:inverted-char-class #\.)`, which excludes the dot and nothing else.  A
slash is not a dot, so on the seven-segment administration path it swallows
the rest:

```
/system/accounts/playwright/repositories/test/views/sparql-run-1793071306901
  account "system"  repository "accounts"
  view    "playwright/repositories/test/views/sparql-run-1793071306901"
```

It does not fail; it succeeds with a name that is most of the path.  (An
earlier note in this file said the parse returns NIL and the helper answers
400.  That was wrong -- the regex was read as anchored on both ends when only
the dot is excluded from its last register.)  `user-20260202.lisp`'s
three-argument version reads `(resource-view resource)` instead, and so does
this patch.  **That same parse is in `graph-store-put-view`, which is finding
14.**

Checked under SBCL 2.1.2 before delivery: reads (3 forms), compiles without a
warning, and six behavioural cases in a stub image -- delete succeeds and
answers 200 with the activity-stream record, an empty view name 400, an absent
view 404, an unauthorized agent 401, an image that already has a `:delete`
keeps its own method, and an image without the resource class installs
nothing.

**RESOLVED on nl4, 27 Oct**, measured after the redeploy:

| request | before | after |
|---|---|---|
| `DELETE …/views/run-view-1793060732471` | 501 | **200** + the activity-stream record |
| `GET` the same name afterwards | 200 | **404** |
| `DELETE` it a second time | 501 | **404** |
| `DELETE …/views/no-such-view-27oct` | 501 | **404** |

`Service-Quality: Administration`, so spocq answered.  Thirteen more scratch
views deleted 200 each; the collection went 28 → 14.  The four live outcomes
are the four the stub-image harness predicted.

The first redeploy did not come up at all -- every spocq route answered 502 for
half an hour.  The cause was in the bundle's `load.lisp`, not in the patch: the
docstring of `*mcp-patch-prerequisites*` contained an unescaped pair of ASCII
quotes (`"corrections this revision predates"`), which closed the string early
and left `defparameter` with nine subforms.  A reader pass cannot see this --
the form still reads, as one well-formed top-level form, and the file still
reports the form count of a sound file -- so `gensrc/test/patch-readcheck.lisp`
now checks the SHAPE of each `defparameter`/`defvar`/`defconstant` it reads as
well.  Both bundle copies sweep clean, 52 files each.

**The `Allow` header is a SECOND fault and is not fixed.**  It is not specific
to views: `graph-store-options` in `spocq-server/response-functions.lisp`
answers with the constant list `'(:delete :get :head :options :patch :put
:post)` for every resource it is reached for, so every route on these images
advertises every verb whether or not it implements one.  gensrc does the same
(`response-functions.lisp:899`).  Correcting it means computing the list from
the applicable methods -- which the http layer already does for the OPTIONS the
method combination synthesises when nothing intercepts it -- and that changes
what every route in the image says about itself.  That is a decision about the
whole route table, not about views.

**14. the view PUT stores the name as a path fragment, so what it creates
cannot afterwards be addressed.**  Found while clearing the views finding 13
had stranded.  `graph-store-put-view` takes the name from the request PATH
through `*view-identifier-scanner*`, whose last register excludes the dot and
not the slash, so on `/system/accounts/<a>/repositories/<r>/views/<name>` the
name it records is

```
playwright/repositories/test/views/<name>
```

Reproduced in one request on nl4, 27 Oct: `PUT …/views/probe-rq-27oct` with
`Content-Type: application/sparql-query` answers 201, and the collection then
lists `"NAME": "playwright/repositories/test/views/probe-rq-27oct"`.

Such a view cannot be removed by any name a client can put in a path: not the
tail, which is what it asked for and what `resource-view` binds, and not the
stored form, since the route table binds `:view` to a single segment.  Tried
and refused 404: the tail; the stored form, raw and percent-encoded; the
public graph-store route with the bare name; and the public route with a
crafted path that makes the same parse yield the stored name.

Fourteen views on `playwright/test` carry such a name — the thirteen the
27 Oct 03:21 run created plus `probe-rq-27oct`, which this probe added.  The
00:23 and 00:33 batches carried bare names and all deleted cleanly, so
whatever created those did not go through this path.

*Correction, same day.*  This entry first called those fourteen **permanent**.
They are not.  The two-argument `graph-store-delete-view` on this revision
(`response-functions.lisp:747`) parses the request path with the same scanner
the PUT does, so on the administration path it computes the same long name and
would find the row.  The reason none of the five attempts above reached them is
that every one of them went through a reader that takes the name from
`resource-view` — the three `:get` clauses and the `:delete` this bundle adds.
The rows are being cleared directly; no patch is needed for that.

**PATCH WRITTEN, 27 Oct — `view-put.lisp`.**  `graph-store-put-view` gains a
method specialized to
`|/system/accounts/:account/repositories/:repository/views/:view|` that takes
the name from `(resource-view resource)`, the accessor every reader of the
route already uses.  This is what gensrc does: its `graph-store-put-view` has
no path parse left in it, and e4826228 has the gensrc form through
`patches/user-20260202.lisp`; b86ed687 is the stale one.

The method is specialized to the view resource class rather than replacing the
`repository-resource` method as gensrc does, because gensrc also defines
`resource-view` on `|/:account/:repository/:graph|` (`resources.lisp:247`) and
neither host revision has that method — a `repository-resource` replacement
would leave the public view PUT with no applicable `resource-view` and turn it
into a 500.  (That is already latent on de17, by way of `user-20260202.lisp`;
not corrected here.)  Specializing narrowly leaves the public route on the
inherited parse, where the three-segment path makes it correct.

Checked in a stub image before delivery — the inherited method first, to
reproduce the fault, then the patch loaded over it:

| | stored name | status |
|---|---|---|
| inherited method, admin path | `playwright/repositories/test/views/probe-1` | 201 |
| patched, new view | `probe-1` | 201 |
| patched, existing view | `probe-1` | 200 |
| patched, not authorized | nothing written | 401 |
| patched, empty `:view` | nothing written | 400 |
| public graph-store route | `myview` | 201 (inherited, unchanged) |

Bundle revision `20261029` / `20261029-de17`.

**RESOLVED on nl4, 27 Oct.**  Deployed and measured against a collection the
host owner had just cleared, so the run started from `[ ]`:

| request | result |
|---|---|
| `PUT …/views/probe-put-27oct` (`application/sparql-query`) | **201**, `Location: /system/accounts/playwright/repositories/test/views/probe-put-27oct` |
| the collection afterwards | `"NAME": "probe-put-27oct"` — bare, not the path |
| `GET` it, json and `application/sparql-query` | 200, 200 |
| `PUT` it again with different text | **200**, same name, text replaced |
| `DELETE` it | **200** |
| `PUT /playwright/test/probe-pub-27oct` (public route, `application/sparql`) | **201**, `"NAME": "probe-pub-27oct"` |
| `DELETE …/views/probe-pub-27oct` | **200** |

The public graph store route is unchanged, which is what the narrow
specialization was for.  Both probes were removed; the collection is `[ ]`
again.

Two further observations from the same probe:

- `PUT` with `Content-Type: application/json` answers **501** on nl4, so the
  JSON clause gensrc has for this resource is not on that image; only the
  `application/sparql-query` form is served.
- The collection still answers with URLs on the old deployment name,
  `https://nxp-dev.dydra.com/playwright/test/<view>`, and `SITE-URL` is
  `http://dydra.com/...` while `IDENTIFIER` is `https://nxp-dev...`.  Three
  hostnames for one view.

Not a jsui defect either: the client PUT the name it meant.

**15. a view that is not there answers 500, not 404, for two of three Accept
types.**  Found while verifying finding 14, after the deployment; unrelated to
it — `view-put` adds a method to `graph-store-put-view`, which no GET calls.
Against nl4, for both a name just deleted and one that never existed:

| `Accept` | status |
|---|---|
| `*/*` | 404 |
| `application/json` | **500** |
| `application/sparql-query` | **500** |

Two different causes, both in the 404 path rather than in the lookup:

```
[NO-APPLICABLE-METHOD-ERROR] ... COMPUTE-INSTANCE-MODEL
  when called with arguments (NIL #<MIME:APPLICATION/JSON>)
```

— the deployed json clause binds `model` in the same `let*` as `view`, so
`compute-instance-model` runs on NIL before anything tests it.  The NIL
argument identifies the clause: it is the lookup's result, not the name.  That
is gensrc's shape (`admin.lisp:795`), not b86ed687's.  And

```
[NO-APPLICABLE-METHOD-ERROR] ... DE.SETF.HTTP:ENCODE-RESPONSE
  when called with arguments (404 #<SPOCQ-RESPONSE 500> #<MIME:APPLICATION/SPARQL-QUERY>)
```

*I first read the second as an encoder gap — the 404 raised correctly and the
server unable to serialize it as `application/sparql-query`.  That was wrong,
and it is wrong in a way worth keeping on the page.*  The content being
encoded is the **integer** 404, and it is a return value, not a condition.
`admin.lisp:525` ends

```lisp
      (cond (view
             (write-string (spocq.i::view-query view) ...)
             (terpri ...)
             nil)
            ;; just, in case
            (http:not-found))
```

`(http:not-found)` there is a `cond` **clause** with a test and no body, not a
call.  `def-condition` (de.setf.http `conditions.lisp:84`) emits
`(defconstant ,name ,code)` beside the function, so the symbol is also a
constant bound to 404: the clause evaluates it, 404 is true, and the `cond`
returns 404 as the resource function's value.  `encode-response` has methods
for a string, a vector, a solution field, NIL and an `http:condition` — none
for an integer.  The same three characters inside an `if` are a call and
signal, which is why the `*/*` clause two forms above is right.

The decisive measurement: the **public** route `/:account/:repository/:view`
answers 404 for a missing view under `*/*`, `application/json`,
`application/sparql-query` *and* `application/sparql-results+json`.  A 404 was
always encodable for that media type, so the fault was never in the encoders
and nothing needs adding to them.

A grep cannot find this; the text is identical in both positions.  Reading the
file and walking the forms can — a `cond` clause whose only element is a symbol
in the `HTTP` package naming a condition is the whole signature.  That check is
now `gensrc/test/condition-clause-check.lisp`, beside `patch-readcheck.lisp`
and sharing its reader (`patch-reader.lisp`, extracted from it).  Run over four
trees, 3,498 of 4,180 files read, it reports **three** findings, and all three
are the same clause — the view `:get` for `application/sparql-query` in
`spocq-server/admin.lisp`, in `spocq-b86ed687`, `spocq-e4826228` and
`spocq-llm`.  gensrc has `(t (http:not-found))` there and is clean.  The 682
files it cannot read use feature expressions, `#.` or reader macros the image
defines; those are reported as read errors, not as passes.

**PATCH WRITTEN, 27 Oct — `view-not-found.lisp`.**  Both clauses are replaced
by ones that look the view up and signal `http:not-found` at the point of
retrieval, before a model is computed or a body is written.  Checked in a stub
image, the deployed shapes first and the patch loaded over them:

| | before | after |
|---|---|---|
| the mechanism, alone: `(cond (nil :body) (demo))` | returns `404` | — |
| the mechanism, alone: `(if nil :body (demo))` | signals | — |
| sparql-query, view present | body written | body written |
| sparql-query, view missing | **returns 404 as a value** | **signals 404** |
| json, view present | body written | body written |
| json, view missing | **errors inside `compute-instance-model`** | **signals 404** |
| json, empty `:view` | — | signals 400 |
| json, not authorized | — | signals 401 |

Bundle revision `20261030` / `20261030-de17`.  The `(response-type t)` clause
is left alone: it uses an `if` and already answers 404.

---

## Not covered

- **The provider half of the llm loop has never run with a real key.**  Every
  adapter test drives a fixture.  `ALLOW_TOOLS` is `[survey]`;
  `*mcp-journal-synchronous*` is still `T`.
- REQ-28.1.2, REQ-28.1.10 — replication, blocked on D1: the commit path and the
  websocket fan-out are disconnected (`propagation.lisp`, 549 lines of which
  347 are commented out).
- REQ-30.1.5 (journal retention), REQ-30.1.6 (deferred), REQ-22.1.7
  (deployment).
- REQ-S-6 — implemented and modelled, never exercised against a live store.
- The event model is still gensrc-only on the host *sources*: neither host
  revision's `src/odbc/views.lisp` carries it (958 lines against gensrc's
  1690), so the host patch bundles cannot use it.
- Rails has classes for 4 of the 15 generated event type names.

## To run what is missing

1. ~~A token for nl4 in `STORE_TOKEN` → suite D.~~  **CLOSED 27 Oct.**  Two
   things were wanted and both arrived.  The credential, 26 Oct: the token
   resolves from `~/.dydra/nl4.dydra.com.test.token` and is accepted.  Then
   finding 9, 27 Oct: `01-import` needs the `/sparql` surface, which was
   answering 500 on that host, and `task-request.lisp` fixed it.  `./run-all.sh`
   now runs end to end unattended — **200 of 200 checks, 23 of 23 scripts**
   (§D.2, log `mcp/run-nl4-20261027.log`).
2. An administrator credential → the other half of REQ-2.4.4 and REQ-2.6.1.
3. **An account-scoped event** → the two event-table assertions.  Not a host
   problem any more: C′ signs in to nl4 and the other two event tests pass
   there.  What is missing is a row, and writing one means either fixing
   `propagate-account-metadata`, or running
   `JSUI_ALLOW_ACCOUNT_WRITE=1` against a throwaway account, or deciding that
   an account's history should aggregate its repositories' events
   (finding 12).
4. ~~The `/tmp/stubs.lisp` generator committed → `patch-readcheck`.~~
   **CLOSED 27 Oct.**  `gensrc/test/patch-readcheck.lisp` no longer reads that
   file: it derives the stub packages and symbols from the file it is about to
   read, skipping comments, strings and `#\\` character literals, and installs a
   `<urn:...>` reader macro for the IRIs.  All 52 files of each bundle copy now
   read; before, a missing stub stopped the run early and reported a form count
   that looked like a pass.
5. `UPDATE repositories SET cached_slug = name WHERE cached_slug IS NULL` →
   the five rows that predate finding 5.
6. **Rotate the account password and the store token** (finding 8), and decide
   what to do about the four `src/` copies and the git history in both
   repositories.
