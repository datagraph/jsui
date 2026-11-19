# Manual test protocol — jsui

2026-11-03.  Companion to `doc/test-record/`; the record is where a *run* of
this protocol is written down, this file is the protocol itself.

## What this covers, and why it exists

The automated suites are green and they are not enough.  They are green
because every one of them runs against a fixture or a headless page it built
itself: 1 637 node assertions over module behaviour and 644 over a headless
DOM, with no host, no credential and no model.  They establish that the parts
behave; they cannot establish that the thing in front of a person works,
because three of its four parties are absent.

Three kinds of claim only a person at a browser can settle:

1. **The credential path.**  Two different credentials, held in one document,
   each reaching one processor and neither reaching the other.  A fixture can
   assert the shape of a request; only a run proves that the token the user
   typed is what the store saw.
2. **The model path.**  What a model actually proposes for a sentence a person
   actually typed, and whether the screens hold when it proposes something
   else.  No fixture has an opinion.
3. **Judgement.**  Whether the arrangement that came back is the arrangement
   that was asked for, whether the page is legible, whether the refusal said
   something a person can act on.

So the protocol below is ordered by credential: nothing with a model until the
store path is proven, nothing written until the read path is proven.

## 0 — Setup

### 0.1 Choose the target and say which it was

| target | command | what it tests |
|---|---|---|
| **working copy → live API** | `node tests/dev-server.mjs` then `http://localhost:8099/ui/user` | this tree, which is the only way to exercise anything newer than the deployment |
| **deployed** | `https://dydra.com/ui/user` | what a user has |

`tests/dev-server.mjs` serves this working copy at `/ui/`, proxies everything
else to `JSUI_UPSTREAM` (default `dydra.com`), and so keeps page and API on one
origin — without which the login's `Authorization` header makes every call
preflighted and the upstream does not answer the preflight.

```sh
cd jsui
node tests/dev-server.mjs                         # :8099 → dydra.com
JSUI_UPSTREAM=nl4.dydra.com node tests/dev-server.mjs
```

**Verified 2026-11-03:** the dev server serves this version.  `/ui/user` → 200;
`/ui/ui/app.js`, `/ui/lib/app/{ui-store,reconcile,instructions,sharing}.js`,
`/ui/lib/llm/instruction-prompt.js` and `/ui/ui/components/location-bar.js` all
200; a proxied `/system/accounts/<a>/configuration` returns the upstream's 401
rather than the server's own 404.  Nothing about the RDF-interface work needs a
build step, so the answer stays yes as long as `ROOT` is the working copy.

One caveat, and it is the usual one: **hard-reload after every edit.**  `/ui/`
is served with no `Cache-Control`, so a soft reload mixes old and new modules
and reports it as *doesn't provide an export named …*.

### 0.2 Credentials

No credential has a working default; each is read from the environment or from
`~/.dydra/`, in the order `tests/credentials.js` documents.  Needed here:

| | |
|---|---|
| a **dydra account** | password, or `:<token>` in the same field |
| a **second repository** on that account | for part 9 — two are needed and one must be the one not open |
| a **model provider key** | typed into the pane in part 5; it is the user's own, held in the page |

On a host whose `/system/accounts/<a>/configuration` does not serve an account
document — nl4 answers the JSON string `"NIL"` — a password login has nowhere
to fetch a token from, and **only a token login works**.

### 0.3 Record as you go

Per step: what was typed, what appeared, and — for anything with a model in it
— the provider, the model as *served*, and the repository.  A screenshot of a
refusal is worth more than a screenshot of a success.

### 0.4 Two things about the interface that will otherwise waste your time

Learned by driving it (test record 20261104); neither is a defect.

- **The location bar is an address bar.**  What is on the screen is
  `#location-display`; clicking it reveals `#location-input`
  (`location-bar.js:225`).  Typing at the input without clicking the display
  first is typing into something that is `display: none`.
- **Navigation is in-app and the URL never changes.**  The router runs with
  `updateLocation: false`, so `location.pathname` stays `/ui/user` the whole
  session and the bar's display is the only thing that reports where you are.
  Loading a deep path afresh does not land you where you expect — and to open
  a *second* repository you must return to the account tab first, because the
  account pane is `display: none` while a repository is open and a hidden
  pane's links cannot be clicked.

---

## 1 — Login

| # | do | expect |
|---|---|---|
| 1.1 | Open `/ui/user` signed out | the login form: **Host**, **Username**, **Password or Token** |
| 1.2 | Submit with the password wrong | an error *in the page*, and no browser password dialog |
| 1.3 | Fill Host with the full origin incl. scheme, then sign in | the account pane |
| 1.4 | Reload | still signed in |

1.2 is not pedantry.  A 401 carries `WWW-Authenticate: Basic`; if that reaches
the browser it opens its own dialog, whatever is typed goes back as Basic,
which is not what this client authenticates with, and the dialog never stops.
The dev server strips the challenge; the deployment must not reintroduce it.

1.3: the Host field must carry the scheme.  `normalizeHost` prepends `https://`
to a bare `localhost:8099`, and every call then dies on `ERR_SSL_PROTOCOL_ERROR`.

**Proves:** one credential, held in the page, reaching the service.

---

## 2 — The account, and opening a repository

| # | do | expect |
|---|---|---|
| 2.1 | Read the account pane | the repository list, and the account sidebar |
| 2.2 | Open a repository | a repository pane, and a **new tab** in the tab bar for it |
| 2.3 | Open a second repository | a second tab; the first pane is still open and now hidden |
| 2.4 | Click back to the first tab | it returns with its state, not re-fetched from zero |
| 2.5 | Read the repository pane's panels | profile · settings · ips · prefixes · collaboration · logs |
| 2.6 | Edit one profile field and save | the value persists across a reload |

2.3 is the step part 9 depends on, so note exactly what happens: **both panes
are in the document and exactly one is displayed.**  `showOnlyPane` sets
`display: block` on the target and `display: none` on every other pane
(`ui/app.js:705`).  Two repositories are *open*; one is *visible*.

**Proves:** the read path, and the pane model that part 9 will test the limits
of.

---

## 3 — SPARQL, by hand

Before any model touches the store, establish that the store answers.

| # | do | expect |
|---|---|---|
| 3.1 | Open the query page for the repository | the editor |
| 3.2 | Run `SELECT * WHERE { ?s ?p ?o } LIMIT 10` | rows, with the query and what answered it readable together |
| 3.3 | Run an `ASK` | a boolean answer, *not* an empty table — an answer is not a table |
| 3.4 | Save it as a view, re-run from the view, then delete the view | all three succeed |

3.4 is the one most likely to fail against a host behind on patches: `DELETE
…/views/<name>` answered **501** on nl4 before the `20260929-mcp` bundle, and
that one fault failed 11 tests of the documented suite by itself.  If it fails
here, every later step that creates a scratch view will leave litter;
`npm run clean:test-repos` is the sweep.

**Proves:** the service half, unaided — so that a later failure can be charged
to the model path rather than to the store.

---

## 4 — The chrome's own arrangement, before any model

The location bar is the only affordance always on the screen, and it is both
the navigator and the instruction channel.  Test the half that needs no model
first, because a grammar that mis-reads a line is not symmetric: a path sent
to a model wastes a turn and money; a sentence read as a path produces a 404
and loses the sentence.

| # | type into the bar | expect |
|---|---|---|
| 4.1 | `/account/<you>/repositories` | navigation |
| 4.2 | `goto /account/<you>` | navigation — the preface before a path is redundant and allowed |
| 4.3 | `goto workspace` | the target indicator reads **workspace**; nothing navigates |
| 4.4 | a bare word that is not a target | a refusal naming what *is* addressable — never a nearest match |

4.4 matters more than it looks: an ambiguous address must refuse rather than
guess, because the thing a wrong guess re-addresses is the thing the *next*
sentence will change.

**Proves:** the grammar decides navigate-vs-instruct without a model.

---

## 5 — Connecting a model

| # | do | expect |
|---|---|---|
| 5.1 | Open the exploration pane on the repository | the prompt editor, the MCP endpoint field, the key field |
| 5.2 | Enter the provider key | it is accepted and **not** echoed back anywhere a log would see it |
| 5.3 | Set the MCP endpoint and connect | a connected state, and the tool list the endpoint offers |
| 5.4 | Inspect the grant before asking anything | which repositories · read-only · a query count · a row and byte ceiling · an expiry |

5.4 is the step people skip.  The grant is consulted twice — the model is
*told* what it may ask for, and every call it then makes is *charged* against
the same grant — so reading it now is reading the policy both halves of part 6
will be judged against.

**Proves:** the second credential is in the page, and the page is the only
place both are.

---

## 6 — An exploration

| # | do | expect |
|---|---|---|
| 6.1 | Ask a question about the data in plain words | prose, and one or more proposed calls |
| 6.2 | Watch what is sent | the prompt, the tool definitions, the primer, and what the grant allows — and no dydra token |
| 6.3 | Watch what runs | the call goes out **under your own token**, re-credentialled by the interface |
| 6.4 | Read the result | rows, and a provenance note naming the model *as served*, the date and the repository |
| 6.5 | Ask something that needs more queries than the grant allows | **REFUSED, unsent** — and the count was charged before the call, not after |
| 6.6 | Ask for something that would write | refused on the arguments, not on the tool name |
| 6.7 | Open the session log | every call listed, with its request and its response |

6.6 is the claim worth attacking deliberately.  A name-only allow-list cannot
tell a `survey` that reads from a `survey` whose body carries an update
notation or an operative `DELETE`; the screen is on the **arguments**.  Try to
get a write past it and record what happened.

6.5: a refusal that arrives *after* the store has been read is not a limit, it
is a complaint.  Check the query count moved before the result did.

**Proves:** the model proposes and runs nothing; the interface runs, under the
user's authority, and records what it ran.

---

## 7 — A presentation, and arranging it

| # | do | expect |
|---|---|---|
| 7.1 | Ask for a page — a table and a chart of the same data | a generated presentation in the pane |
| 7.2 | Read the location bar | it is now addressed to that presentation, by its title, without your having said so |
| 7.3 | Type `put the chart above the table` | a patch, applied, with an **undo** beside the reply |
| 7.4 | Press undo | it goes back |
| 7.5 | Type an instruction that would change a query or the grant | **GATED** — consent asked, showing the panels side by side |
| 7.6 | Reload the page, reopen the presentation | the arrangement survived; the divider position did not go into the graph |
| 7.7 | `goto workspace`, then `make the location bar the top band` | the chrome rearranges |
| 7.8 | Try to remove `content` or `location` from the template | refused — including the form of it that looks like a layout change and is really a deletion: leaving a host without an area |
| 7.9 | Reload with `?workspace=default` | the arrangement this build shipped with |

7.5 vs 7.8 is the one fork in the arrangement path and it is deliberate: on the
chrome a data-class instruction is **refused**, on a presentation it is
**gated**.  The chrome has no data, so a gate there would be asking a reader to
authorise a query against a repository the workspace never names.

7.9 is the escape hatch, and it is why `location` is immutable: a bar that can
be typed out of existence is a bar that can remove the means of restoring it.

**Proves:** arrangement is addressable, reversible, persistent, and screened.

---

## 8 — A presentation from somewhere else

| # | do | expect |
|---|---|---|
| 8.1 | Open a presentation authored by another account | it renders, with a **mark** above the views saying whose code it carries |
| 8.2 | Look for the author's script, transform and markup | **withheld** — a placeholder where the markup was |
| 8.3 | Admit it, reopen | it runs |
| 8.4 | List your admissions | whose code, and which page |
| 8.5 | Withdraw the admission, reopen | behind the mark again |
| 8.6 | Download the standalone copy while withheld | the copy carries the withholding too |

The admission is kept in **your** repository, not the author's: a store the
author can write is not somewhere your approval can be kept.  Confirm that by
checking which repository was read.

**Proves:** executable text from a third party is consent-gated, and the gate
is not where the author can reach it.

---

## 9 — Two repositories at once, next to each other

This is the step the rest of the protocol was ordered to reach, and it needs a
statement of what the build actually supports before it can be run honestly.

### 9.1 What the chrome cannot do, and why

**The workspace arrangement cannot put two repositories side by side.**  Three
independent reasons, all by construction:

- `WORKSPACE_HOSTS` is `flashes · header · tabs · content · footer · location`
  (`lib/app/workspace.js:49`).  There is **one** `content`.  The grammar can
  move it, name its area, even remove the bands around it — it cannot make a
  second one, and a host naming something unregistered renders inert.
- A host says *where* a band goes and never *what is in it*.  Repository panes
  live inside `content`, and `showOnlyPane` keeps exactly one displayed.
- The workspace contract explicitly refuses a data-bound element: *"The
  workspace declares no panels, and an element that names one is refused."*

So step 2.3 is the ceiling for the chrome: two repositories **open**, one
**visible**.  Record that as the result, not as a failure to reproduce.

### 9.2 What does do it

A **presentation** can, because a presentation has panels, a split-pane
component and an arrangement channel.  One thing is still missing and shapes
the test: `runPanels` takes a *single* repository for the whole page
(`lib/dashboard/runner.js:192`); a panel carries a name, a query and its
parameters, and **no repository of its own**.  The second repository therefore
has to come in through the query, by federation.

**9.2.1 — Pre-check, by hand, before involving a model.**  In the query page of
repository **A**, run:

```sparql
SELECT ?s ?p ?o WHERE {
  SERVICE <https://<host>/<account>/<B>/sparql> { ?s ?p ?o }
} LIMIT 10
```

If this does not answer, stop here and record it: the rest of 9.2 is then
testing the store's federation and not the interface, and a model asked to
produce something the store cannot run will look like a model fault.

**9.2.2 — Ask for the page.**  In the exploration pane on **A**:

> *a page with two tables side by side — the left one the classes in this
> repository, the right one the classes in `<account>/<B>`, which you reach
> with `SERVICE <https://<host>/<account>/<B>/sparql>`*

| expect | |
|---|---|
| two panels | one plain, one federated |
| a `split-pane` or two-column `grid` | the two tables beside each other |
| both panels screened as reads | a `SELECT` containing `SERVICE` is a read; the screen is on the query *form*, and passes it |
| the provenance note | one model, one date, and the repository the page was run against — **A** |

**9.2.3 — Arrange it.**  Address the presentation and instruct it:

| # | type | expect |
|---|---|---|
| a | `make the two tables equal width` | applied, undo offered |
| b | `put them one above the other` | applied |
| c | `put them back side by side` | applied |
| d | drag the split-pane divider, then reload | the divider position came back, and it is **not** a revision of the document |

(d) is the small clear case of the whole design: where the divider sits is the
reader's, so it lives in the session; what the page *is* is the document's, so
it lives in the graph.  If a drag bumps the revision, that is a defect.

**9.2.4 — Check the authority.**  In the session log, confirm the federated
panel went out under **your** token like every other call, charged against the
same grant, and that the model never held it.

### 9.3 Record

Three outcomes are all legitimate and must be told apart:

| outcome | what it means |
|---|---|
| 9.2.1 fails | the store does not federate; the interface is untested on this point |
| 9.2.1 passes, 9.2.2 fails | the model did not produce the page; retry with the query given verbatim before concluding anything about the interface |
| both pass | two repositories, side by side, arranged by instruction — and the chrome limitation in 9.1 is the only thing left |

---

## 10 — Leaving

| # | do | expect |
|---|---|---|
| 10.1 | Sign out | the credentials are gone from the page |
| 10.2 | Reload | signed out |
| 10.3 | Sign in again | the workspace arrangement from part 7 is still there — it is saved for the account |
| 10.4 | `npm run clean:test-repos` | the scratch repositories and views this run created are gone |

---

## Appendix — known stops

Verified against nl4 on 2026-11-04.  The struck-through rows are historical
and are kept because a host behind on patches, or a browser holding an old
module, still shows them.

| stop | where | note |
|---|---|---|
| ~~`DELETE …/views/<name>` → 501~~ | 3.4 | **fixed on nl4.**  On a host without the `20260929-mcp` bundle it fails 11 documented tests by itself |
| ~~configuration serves `"NIL"`~~ | 1.3 | **fixed on nl4** — it serves a real account document, so a password login works again.  Elsewhere, use `:<token>` |
| repository summary field never becomes editable | 2.6 | seen on nl4, not on dydra.com; **still open** — the one documented-spec failure |
| ~~a view does not run at `/<account>/<repo>/<view>`~~ | 7.1, 9.2 with the catalogue box ticked | **fixed 2026-11-04** in `lib/dashboard/catalog.js`: `executeUrl` now carries `views`.  A browser still serving the old module answers 406 on a host that has the view |
| ~~the editors pane does not scroll to a new editor~~ | 3.4, and every step that opens one | **fixed 2026-11-04** in `ui/pages/index.js`, both copies of `createEditorPanel`.  A browser still serving the old module leaves the pane at `scrollTop: 0` and the click looks like it did nothing |
| a successful arrangement reports nothing | 7, and every arrangement instruction | **client defect** found 2026-11-05: the chrome redraw detaches the bar before its reply is written, so the confirmation and the undo are lost.  A refusal still reports.  See `doc/arrangement-manual/` §6 |
| stale modules after a deploy | anywhere | `/ui/` carries no `Cache-Control`; hard-reload, and `curl` to see what is really served |
| two repositories in the **chrome** | 9.1 | not supported, by construction — confirmed on the running client: six hosts, one `content` |
