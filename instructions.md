# Dydra JSUI — Implementation Instructions

This document is a consolidated technical specification for the Dydra JavaScript user interface. It is intended as a complete prompt for implementing the client application and its test suite. Read it in full before writing any code.

---

## 1. Project Identity

**Dydra JSUI** is the browser-based front end for Dydra, a cloud-hosted RDF graph database that exposes a RESTful `/system/` management API, Graph Store protocol and SPARQL query endpoints. The UI consists of two independent single-page applications (SPAs) that share a common library layer:

| App | HTML shell | JS entry | Base path | Purpose |
|---|---|---|---|---|
| Studio (user app) | `index.html` | `app.js` | `/ui/user` | Account management, repositories, SPARQL queries, imports |
| Admin console | `admin.html` | `admin-app.js` | `/ui/admin` | System-wide account/repository administration, history monitoring |

Both SPAs are served as static files by nginx. **There is no build step.** All JavaScript is plain ES modules loaded directly by the browser via `<script type="module">`. No transpiler, bundler, or package manager is involved at runtime. The only `package.json` dependency is `@playwright/test` for the test suite.

---

## 2. Technology Constraints

- **Language**: Vanilla JavaScript (ES2020+). No TypeScript, no JSX, no framework.
- **Modules**: Native ES modules (`import`/`export`). No CommonJS except in test helpers (which use `require` because Playwright's Node.js runner supports it).
- **Rendering**: Server-side HTML strings assembled in JavaScript and inserted into the DOM via `innerHTML`. No virtual DOM, no template engine.
- **Styling**: Pre-existing CSS in `stylesheets/style.css` and `stylesheets/jsui-overrides.css`. Do not create new stylesheets unless adding a self-contained feature (e.g., a documentation page).
- **Dependencies**: Zero runtime third-party libraries except YASQE (the SPARQL CodeMirror editor, loaded via `js/yasqe-wrapper.js`).

---

## 3. Project Structure

```
jsui/
├── index.html                  # Studio SPA shell
├── admin.html                  # Admin SPA shell
├── app.js                      # Studio bootstrap
├── admin-app.js                # Admin bootstrap
├── router.js                   # Shared client-side router
│
├── lib/                        # Shared library layer
│   ├── config.js               # APP_CONFIG singleton
│   ├── auth.js                 # authenticateAccount()
│   ├── auth_store.js           # AuthStore class
│   ├── app_state.js            # AppState class (central state)
│   ├── sample_data.js          # Dev fixture data
│   ├── models/
│   │   ├── account.js
│   │   ├── repository.js
│   │   ├── query.js
│   │   ├── session.js
│   │   ├── invitation.js
│   │   └── import_job.js
│   ├── persistence/
│   │   ├── adapter.js
│   │   └── rdf_store_adapter.js
│   └── replication/
│       ├── graph-object.js     # Proxy-based dirty-state tracking
│       └── replication_manager.js
│
├── ui/
│   ├── utils.js                # escapeHtml(), joinHtml()
│   ├── app.js                  # Studio App class (868 lines)
│   ├── routes.js               # Studio route table
│   ├── pages/
│   │   ├── base_page.js        # BasePage base class
│   │   └── index.js            # All 26 Studio page classes (7265 lines)
│   ├── components/
│   │   ├── layout.js           # LayoutView
│   │   ├── header.js
│   │   ├── footer.js
│   │   ├── navigation.js
│   │   └── flashes.js
│   └── admin/
│       ├── app.js              # AdminApp class (233 lines)
│       ├── routes.js           # Admin route table
│       ├── pages.js            # All admin page classes (2146 lines)
│       └── layout.js           # AdminLayoutView
│
├── js/
│   ├── yasqe-wrapper.js        # SPARQL editor wrapper
│   ├── sparql-editor.js        # <sparql-editor> custom element
│   └── save-login.js
│
├── stylesheets/
│   ├── style.css               # Main stylesheet
│   ├── jsui-overrides.css      # Third-party overrides
│   └── handheld.css            # Responsive
│
├── tests/
│   ├── doc-capture.js          # DocCapture class + REQ catalog (CommonJS)
│   ├── test-helpers.js         # Shared Playwright helpers (ES module)
│   ├── authentication-documented.spec.js
│   ├── account-documented.spec.js
│   ├── repository-documented.spec.js
│   ├── sparql-documented.spec.js
│   ├── view-documented.spec.js
│   ├── navigation-documented.spec.js
│   ├── import-export-documented.spec.js
│   ├── ui-components-documented.spec.js
│   └── admin-documented.spec.js
│
└── doc/
    ├── requirements-20260207.md       # Canonical functional requirements
    ├── user-manual/                   # HTML user manual (Knuth voice)
    ├── admin-manual/                  # HTML admin manual (Knuth voice)
    │   └── images/                   # Playwright screenshots fill this
    └── user-manual-freeman/           # HTML user manual (Morgan Freeman voice)
```

---

## 4. Configuration

`lib/config.js` exports the single configuration object. Do not hardcode hostnames elsewhere.

```javascript
export const APP_CONFIG = {
  baseHost: "dydra.com",
  blogHost: "blog.dydra.com",
  docsHost: "docs.dydra.com",
  requireSignupInvite: true,
  showAccountBalances: false,
  basePath: "/ui",          // All SPA paths are under /ui
};
```

The admin console base path is computed at bootstrap:
```javascript
const basePath = APP_CONFIG.basePath.replace(/\/?$/, "/admin");  // → "/ui/admin"
```

---

## 5. Authentication

### 5.1 `lib/auth.js` — `authenticateAccount()`

```javascript
authenticateAccount({ host, accountName, secret })
  → Promise<{ token, config, baseUrl }>
```

- `host` may be a bare hostname (`dydra.com`) — the function normalises it to `https://dydra.com`.
- `secret` is either a password or a token. Tokens in the form `Bearer <t>`, `:<t>`, or `token:<t>` produce a `Bearer` header; anything else produces `Basic base64(accountName:secret)`.
- Makes `GET /system/accounts/{accountName}/configuration` with the constructed `Authorization` header.
- On success returns `{ token: config.accessToken, config, baseUrl }`. The full `config` JSON is returned — callers must not make a second request to obtain it.
- On failure throws an `Error` with an informative message (HTTP status + body excerpt).

### 5.2 `lib/auth_store.js` — `AuthStore`

In-memory token store (a `Map` wrapped in `state.tokens`). The key is always `accountName`.

```javascript
authStore.setAuth(accountName, token, config, host)
authStore.getAuth(accountName)   // → { token, config, host } | null
authStore.getToken(accountName)  // → string | null
authStore.getConfig(accountName) // → config object | null
authStore.listAccounts()         // → string[]
authStore.clear()
authStore.clearAccount(accountName)
```

Tokens are **never** written to `localStorage` or `sessionStorage`. Only the account name is persisted (under `dydra.session`).

### 5.3 Admin Privilege Detection

Admin status is determined once at login from `result.config.administrator_of`:

```javascript
const adminOf = result.config.administrator_of;
const isAdmin = adminOf === "http://dydra.com"
  || (Array.isArray(adminOf) && adminOf.includes("http://dydra.com"));
app.state.isAdmin = isAdmin;
```

This is stored on `app.state` (not in AuthStore) and gates all admin write operations. **Do not make a second request** to determine admin status; the configuration is already returned by `authenticateAccount`.

---

## 6. State Management

`lib/app_state.js` exports `AppState`, a singleton created in each bootstrap file.

Key properties:
- `state.session` — `Session` instance. `session.accountName` is the currently logged-in account. `session.isLoggedIn()` returns boolean.
- `state.authStore` — `AuthStore` instance.
- `state.isAdmin` — boolean set by the admin login flow (admin app only).
- `state.cache` — object holding `Account[]`, `Repository[]`, `Query[]`, `Invitation[]` arrays.
- `state.openAccounts`, `state.openRepositories` — Sets tracking which tabs are open.

`window.appState` and `window.appInstance` are assigned at bootstrap, making them accessible from Playwright tests via `page.evaluate(() => window.appState)`.

---

## 7. Router

`router.js` exports `Router`. It implements HTML5 History API routing with a configurable `basePath`.

```javascript
const router = new Router(routes, notFoundHandler, {
  basePath: "/ui/admin",
  updateLocation: false,          // Admin: location bar is managed manually
  onRouteChange: (path) => { ... }
});
router.start();
router.navigate("/some/path", { replace: false });
router.canGoBack();
router.canGoForward();
```

Routes are plain objects `{ path, handler }`. Path segments prefixed with `:` are dynamic (e.g., `/account/:account_name`). The handler receives a context object `{ params, query, state, app }`.

Document-level link clicks are intercepted; only same-origin, same-basePath links trigger client-side navigation. External links and links with `target` attributes are not intercepted.

---

## 8. Page System

### 8.1 `BasePage`

All pages extend `BasePage` (`ui/pages/base_page.js`). The contract:

```javascript
class MyPage extends BasePage {
  getTitle()         // → string: document.title value
  getBodyClass()     // → string: CSS classes set on <body>
  async renderContent()   // → HTML string for the main content area
  async renderSidebar()   // → HTML string | "" for the sidebar
  async afterRender()     // Called after innerHTML is set; attach event listeners here
  async getPaneTabs()     // → { bar: HTML string, defaultTab: "#id" } | null
  useHomeLayout()    // → boolean: use home page layout variant
}
```

The page system:
1. `app.renderPage(pageInstance)` calls `renderContent()` and `renderSidebar()` to get HTML strings.
2. Sets them into the DOM via `innerHTML`.
3. Calls `afterRender()`.

`this.context` is set by `app.renderPage()` before rendering. It contains `{ app, state, navLinks, params, query }`. Within `afterRender()`, access `this.context.app.state` to get `AppState`.

### 8.2 Admin Dashboard — Lazy Pane Loading

`AdminDashboardPage` renders six empty pane divs immediately. Content is loaded on first tab click:

```html
<div id="admin-accounts" class="admin-pane" data-lazy="accounts"><p>Loading...</p></div>
<div id="admin-repositories" class="admin-pane" data-lazy="repositories"><p>Loading...</p></div>
<!-- ... -->
```

The `loadPaneContent(paneId, auth)` method checks `pane.dataset.loaded`. If `"true"`, it returns immediately (cached). Otherwise it calls the appropriate `render*Pane(auth)` method, sets `pane.innerHTML`, and marks `pane.dataset.loaded = "true"`.

**Query History invalidation**: The query history pane is additionally invalidated when the checked-repository set changes. The snapshot is stored in `this._queryHistoryRepoSnapshot`.

### 8.3 Admin Privilege Branching

Non-admin accounts must not call privileged endpoints. The canonical pattern in pane renderers:

```javascript
const isAdmin = this.context?.app?.state?.isAdmin;
if (isAdmin) {
  // fetch privileged endpoint
} else {
  // use locally available data (e.g., [state.session.accountName])
}
```

Specifically, `GET /system/accounts` (the full account list) is admin-only. Non-admin users see only their own account.

---

## 9. Admin Console — Tabs and Selectors

The tab bar uses `data-tab-link` and `href="#pane-id"` for tab links:

```html
<a href="#admin-accounts" data-tab-link data-show-aside="true">Accounts</a>
<a href="#admin-repositories" data-tab-link>Repositories</a>
<a href="#admin-invitations" data-tab-link>Invitations</a>
<a href="#admin-query-history" data-tab-link>Query History</a>
<a href="#admin-transaction-history" data-tab-link>Transaction History</a>
<a href="#admin-import-history" data-tab-link>Import History</a>
```

History panes that contain both a table and a graph use an inner sub-tab mechanism:

```html
<button data-history-tab="table">Table</button>
<button data-history-tab="graph">Graph</button>
```

### 9.1 Login Form — `data-testid` Attributes

| Element | `data-testid` |
|---|---|
| Form | `admin-login-form` |
| Host input | `admin-login-host-input` |
| Username input | `admin-login-username-input` |
| Password input | `admin-login-password-input` |
| Submit button | `admin-login-submit` |

### 9.2 Account Pane Selectors

| Element | Selector |
|---|---|
| Account checkbox | `.account-checkbox[data-account="{name}"]` |
| Account details link | `.account-details[data-account="{name}"]` |
| Delete account button | `[data-testid="admin-account-delete-btn-{name}"]` |
| New account button | `[data-testid="admin-new-account-btn"]` |
| New account dialog — name input | `.new-account-name` |
| New account dialog — OK | `.new-account-ok` |

### 9.3 Repository Pane Selectors

| Element | Selector |
|---|---|
| Repository checkbox | `.repo-checkbox` |
| Delete repository button | `[data-testid="admin-repo-delete-btn-{account}-{repo}"]` |
| New repository button | `[data-testid="admin-new-repo-btn"]` |
| New repo dialog — account select | `.new-repo-account` |
| New repo dialog — name input | `.new-repo-name` |
| New repo dialog — OK | `.new-repo-ok` |

### 9.4 Invitation Pane Selectors

| Element | Selector |
|---|---|
| Delete invitation link | `.invite-delete[data-email="{email}"]` |
| New invitation button | `[data-testid="admin-new-invite-btn"]` |
| New invite dialog — email input | `.new-invite-email` |
| New invite dialog — OK | `.new-invite-ok` |

### 9.5 Delete Confirmations

All admin delete operations use the browser's `confirm()` dialog. In Playwright tests, handle with:

```javascript
page.on('dialog', (dialog) => dialog.accept());
```

Scope this listener to the delete action and remove it afterwards (`page.off`) to avoid leakage.

---

## 10. Studio App — Key Selectors

Login form:

| Element | `data-testid` |
|---|---|
| Username input | `login-username-input` |
| Password input | `login-password-input` |
| Submit button | `login-submit` |

Repository fields use `data-testid` based on the field name from `REPOSITORY_FIELD_DEFS` in `ui/pages/index.js`. Empty fields display `"-"` and require a double-click to enter edit mode (`activateRepoField()` in `test-helpers.js`).

Account profile fields use `data-field` attributes and similarly require double-click for empty values (`activateAccountField()` in `test-helpers.js`).

---

## 11. API Endpoints Reference

All requests are authenticated with `Authorization: Bearer {token}` and `Accept: application/json` unless noted.

### Authentication
| Method | URL | Notes |
|---|---|---|
| GET | `/system/accounts/{name}/configuration` | Returns `{ accessToken, administrator_of, ... }` |

### Account Management
| Method | URL | Notes |
|---|---|---|
| GET | `/system/accounts` | Admin only — returns all accounts |
| POST | `/system/accounts` | Create account |
| DELETE | `/system/accounts/{name}` | Delete account |
| POST | `/system/accounts/{name}/configuration` | Update account fields |
| GET | `/system/users/{name}/configuration` | User-level config (deprecated in login flow) |

### Repository Management
| Method | URL | Notes |
|---|---|---|
| GET | `/system/accounts/{name}/repositories` | List repositories |
| POST | `/system/accounts/{name}/repositories` | Create repository |
| DELETE | `/system/accounts/{name}/repositories/{repo}` | Delete repository |
| POST | `/system/accounts/{name}/repositories/{repo}/configuration` | Update repo fields |
| POST | `/system/accounts/{name}/repositories/{repo}/collaboration` | Update collaborators |

### SPARQL
| Method | URL | Notes |
|---|---|---|
| GET/POST | `/{account}/{repo}/sparql` | Execute SPARQL query |
| GET/PUT/DELETE | `/system/accounts/{name}/repositories/{repo}/views/{view}` | View CRUD |

### Invitations
| Method | URL | Notes |
|---|---|---|
| GET | `/system/invitations` | List invitations |
| POST | `/system/invitations` | Create invitation |
| DELETE | `/system/invitations/{id}` | Delete invitation |
| POST | `/system/invitations/{id}/resend` | Resend invitation |

### History (Admin)
| Method | URL | Notes |
|---|---|---|
| GET | `/system/history/queries` | Query history log |
| GET | `/system/history/transactions` | Transaction history log |
| GET | `/system/history/imports` | Import history log |

Request headers for all admin history endpoints: `Authorization: Bearer {token}`, `Cache-Control: no-cache`.

---

## 12. Testing

### 12.1 Setup

```
npm install          # installs @playwright/test
npx playwright install chromium
```

`playwright.config.js` at the project root collects `tests/*-documented.spec.js`
with one worker. `JSUI_ORIGIN` selects the target and defaults to the live
`https://dydra.com` deployment; point it at `http://localhost:8099` with
`node tests/dev-server.mjs` running to test the working copy instead. The dev
server serves `/ui/` from this tree and proxies everything else to
`JSUI_UPSTREAM` (default `dydra.com`); a host whose certificate node will not
verify needs `JSUI_UPSTREAM_INSECURE=1` beside it, or node refuses the upstream
and every API call fails as a socket error. **`nl4.dydra.com` is not such a
host** — measured 27 Oct 2026, its chain verifies and node accepts it — so do
not pass the switch for nl4.

**Test credentials have no defaults** (changed 2026-10-24). They are resolved
by `tests/credentials.js`, in this order:

1. the environment — `JSUI_PASSWORD=...` or `JSUI_TOKEN=...`
2. `~/.dydra/<host>.<account>.password`, then `~/.dydra/<host>.<account>.token`
3. `~/.dydra/<account>.password`, then `~/.dydra/<account>.token`

**Host-qualified beats bare, and within a tier a password beats a token.** An
unqualified `<account>.password` must not shadow the token that is the only
thing a particular host accepts — which is how nl4 is reached, since its
`/system/accounts/<a>/configuration` answers the JSON string `"NIL"` and a
password login has nowhere to get a token from.

A token is supplied to the login field as `:<token>`; `lib/auth.js` reads the
leading `:` as *this IS the bearer token* and does not look the account's
configuration up. When a test needs an `Authorization` header of its own, it
must use `authorizationFor()` rather than composing `Basic btoa(user +
":" + secret)` in page context — that is a 401 the moment the secret is a
token.

This is the convention the shell test suites already use for bearer tokens
(`~/.dydra/<host>.<account>.token`), with `.password` added beside it. Both
live outside the working copy, where no `git add -A` can reach them. The host
is the one the API is on, not the origin the client is served from: a loopback
origin (the dev server) resolves to `JSUI_UPSTREAM`, else `dydra.com`.

| Variable | Default |
|---|---|
| `JSUI_ACCOUNT` | `playwright` |
| `JSUI_PASSWORD` / `JSUI_TOKEN` | **none — raises when neither resolves** |
| `ADMIN_USERNAME` | `JSUI_ACCOUNT` |
| `ADMIN_PASSWORD` | `JSUI_PASSWORD` |

A working password used to sit here and in six source files. This repository
has a github remote and those files are tracked, so it was published; the
value must be treated as compromised and rotated.

### 12.2 Running Tests

```bash
# Run all tests
npx playwright test

# Run a single spec file
npx playwright test tests/admin-documented.spec.js

# Generate documentation PDFs/screenshots
CAPTURE_DOCS=true npx playwright test

# Admin tests with custom credentials
ADMIN_USERNAME=myaccount ADMIN_PASSWORD=mytoken \
  CAPTURE_DOCS=true npx playwright test tests/admin-documented.spec.js
```

### 12.3 Test File Conventions

Each spec file:
- Covers one functional area, named `{area}-documented.spec.js`.
- Has `CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true'` at the top.
- Creates `new DocCapture(page, 'tests/pdfs/{area}', { enabled: CAPTURE_ENABLED })` per test.
- Calls `capture.writeManifest()` and `capture.writeIndex()` at the end of each test.
- Defines requirement functions named `REQ_{section}_{id}_{description}(page, capture)`.
- Uses `test.describe('{Area}', () => { ... })` grouping.

### 12.4 `DocCapture` API (`tests/doc-capture.js`)

`DocCapture` is CommonJS. Import with `require`:

```javascript
const { DocCapture, REQ } = require('./doc-capture.js');
```

The `REQ` catalog maps short keys to requirement metadata:

```javascript
REQ['1.1.1']    // → { id: 'REQ-1.1.1', title: '...', section: 'authentication' }
REQ['A.3.3']    // → { id: 'REQ-A.3.3', title: 'Create Account', section: 'admin-accounts' }
```

Usage pattern within a test:

```javascript
const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });

await capture.requirement(REQ['A.3.1'], async (cap) => {
  await cap.before('Accounts pane loading');
  // ... interact with page ...
  await cap.after('Accounts list displayed');
  await cap.step('step-name', 'Description of intermediate state');
});

await capture.writeManifest();
await capture.writeIndex();
```

`cap.before()`, `cap.after()`, and `cap.step()` take screenshots when `CAPTURE_ENABLED` is true. Output goes to `tests/pdfs/{section}/`.

### 12.5 Manual Image Capture

Tests that cover the admin console also save screenshots directly into `doc/admin-manual/images/` using the exact filenames referenced by the HTML manual. Pattern:

```javascript
const MANUAL_IMAGES_DIR = path.join(process.cwd(), 'doc', 'admin-manual', 'images');

async function saveManualImage(page, name) {
  await page.screenshot({ path: path.join(MANUAL_IMAGES_DIR, name), fullPage: false });
}
```

The exact image filenames are listed in `doc/admin-manual/` HTML files as `src="images/{name}.png"`.

### 12.6 Waiting for Admin Panes

```javascript
// Wait until a pane's dataset.loaded becomes "true"
await page.waitForFunction(
  (id) => { const el = document.getElementById(id); return el && el.dataset.loaded === 'true'; },
  panelId,
  { timeout: 12000 }
);
```

### 12.7 `test-helpers.js` (Studio App)

Shared helpers for studio tests (ES module):

| Helper | Purpose |
|---|---|
| `login(page, username, password)` | Navigate to user app and log in |
| `logout(page)` | Navigate to `/logout` |
| `openRepository(page, account, repo)` | Open or create a repository pane |
| `deleteRepositoryViaAPI(page, account, repo)` | Delete via `window.appState` + fetch |
| `createView(page, viewName, queryText)` | Create a saved view |
| `deleteView(page, viewName)` | Delete a view |
| `activateRepoField(page, testId)` | Double-click empty repo field to enter edit mode |
| `activateAccountField(page, fieldName)` | Double-click empty account field to enter edit mode |
| `waitForSaveComplete(page, urlPattern, method)` | Wait for a specific response |
| `getPaneId(account, repo)` | Compute tab pane DOM ID |

---

## 13. Documentation

### 13.1 Functional Requirements

The canonical requirements document is:

**`doc/requirements-20260207.md`** — Version 2026-02-07, supersedes all earlier versions. Each requirement carries a status: `[satisfied]`, `[to be satisfied]`, or `[deprecated]`.

The requirements are organised as:
- §1: Authentication and Session Management (REQ-1.x.x)
- §2: Account Management (REQ-2.x.x)
- §3: Repository Management (REQ-3.x.x)
- §4: SPARQL Query Management (REQ-4.x.x)
- §5: Navigation and Routing (REQ-5.x.x)
- §6: User Interface Components (REQ-6.x.x)
- §7: Data Persistence and Synchronisation (REQ-7.x.x)
- §9: Error Handling (REQ-9.x.x)
- §A: Admin Console (REQ-A.x.x)

### 13.2 HTML Manuals

| Path | Contents |
|---|---|
| `doc/user-manual/` | Knuth-voice user manual, 7 chapters + appendices |
| `doc/user-manual-freeman/` | Morgan Freeman-voice user manual, same structure |
| `doc/admin-manual/` | Knuth-voice admin manual, 7 chapters + appendices |

Admin manual chapters:
1. `login.html` — Authentication, privilege detection, session lifecycle
2. `dashboard.html` — Tabbed layout, lazy loading, location bar, cross-tab dependencies
3. `account-operations.html` — Account table, Details dialog, create/delete (admin only)
4. `repository-operations.html` — Filtered by selected accounts, create/delete (admin only)
5. `invitations.html` — Issue, resend, delete invitations
6. `system-monitoring.html` — Query, transaction, and import history; graphs; sorting; pagination
7. `appendices.html` — Route reference, API endpoints, keyboard shortcuts, glossary

Each HTML manual file loads `manual.js` (image popup behaviour) and `manual.css`.

---

## 14. Key Architectural Decisions

These decisions are intentional and must be preserved:

1. **No build step.** Files are served as-is. Adding a bundler requires explicit discussion and server configuration changes.

2. **HTML string rendering.** Pages return HTML strings from `renderContent()`; the app sets `innerHTML`. Do not introduce a virtual DOM or client-side templating library.

3. **Tokens in memory only.** `AuthStore` is a plain in-memory `Map`. Tokens must never be written to `localStorage`, `sessionStorage`, cookies, or any persistent store.

4. **Single privilege check at login.** Admin status (`app.state.isAdmin`) is determined once from the `administrator_of` field in the `authenticateAccount` response. It is not re-fetched during the session.

5. **Non-admin isolation.** Non-admin users authenticated to the admin console see only their own account and have all write controls hidden. They must not trigger requests to privileged endpoints (e.g., `GET /system/accounts`).

6. **Lazy tab loading with `dataset.loaded`.** Admin dashboard panes are loaded on first tab activation and cached. The `data-loaded="true"` attribute on the pane div is the canonical loaded signal. Query-history additionally invalidates when the repository selection changes.

7. **`data-testid` for testability.** Interactive elements in forms and dialogs carry `data-testid` attributes. New interactive elements should follow the same convention. The test suite must not use fragile XPath or positional selectors when `data-testid` is available.

8. **Admin SPA entry point.** nginx uses `location = /ui/admin` (exact-match) to serve `admin.html`. Sub-paths such as `/ui/admin/login` return 404 — the SPA JS never runs. Every Playwright navigation to the admin console must target `https://dydra.com/ui/admin` with no suffix. The router starts, reads the URL, finds no active session, and renders the login form in-memory without altering the browser URL. This is why the admin router uses `updateLocation: false`.

9. **`window.appState` and `window.appInstance`.** These globals are assigned at bootstrap for Playwright test access via `page.evaluate()`.

---

## 15. Extending the Application

### Adding a new Studio page

1. Create a class in `ui/pages/index.js` extending `BasePage`.
2. Add a route entry in `ui/routes.js`.
3. If the page needs auth, check `this.context.state.session.isLoggedIn()` in `renderContent()` and redirect if not.
4. Add `data-testid` to all interactive elements.
5. Add requirement entries to `tests/doc-capture.js` REQ catalog.
6. Add a new `{area}-documented.spec.js` test file following the conventions in §12.

### Adding a new admin pane or operation

1. Add the pane div and tab link in `AdminDashboardPage.getPaneTabs()` and `renderContent()`.
2. Add a case in `loadPaneContent()`.
3. Implement `render{Name}Pane(auth)` following the privilege branching pattern (§8.3).
4. Attach event handlers in `attachPaneHandlers()`.
5. Add `data-testid` attributes to all interactive elements.
6. Add REQ entries to `tests/doc-capture.js`.
7. Add test cases to `tests/admin-documented.spec.js`.
8. Add a chapter or section to `doc/admin-manual/` and list placeholder `<img src="images/{name}.png">` elements where screenshots belong.
9. Add `saveManualImage(page, '{name}.png')` calls in the corresponding test.

### Adding a new test

Follow the pattern in an existing spec file. Each test should:
- Accept `{ page }` from Playwright.
- Create a `DocCapture` instance.
- Call one or more requirement functions.
- Call `capture.writeManifest()` and `capture.writeIndex()`.

Requirement functions should be pure async functions — they do not access `test` or `expect` directly (those belong in the `test()` body). This keeps them composable.

---

## 16. Reference Implementations

The following existing files serve as the canonical reference for each concern:

| Concern | Reference file |
|---|---|
| Admin login page (full lifecycle) | `ui/admin/pages.js` — `AdminLoginPage` |
| Admin dashboard (tabs, lazy load) | `ui/admin/pages.js` — `AdminDashboardPage` |
| Admin route table | `ui/admin/routes.js` |
| Studio page structure | `ui/pages/index.js` — `AccountRoute`, `RepositoryRoute` |
| Studio route table | `ui/routes.js` |
| Auth flow | `lib/auth.js` |
| Token storage | `lib/auth_store.js` |
| State management | `lib/app_state.js` |
| Client-side routing | `router.js` |
| DocCapture and REQ catalog | `tests/doc-capture.js` |
| Admin test suite | `tests/admin-documented.spec.js` |
| Studio test suite | `tests/authentication-documented.spec.js` |
| Studio test helpers | `tests/test-helpers.js` |
| Functional requirements | `doc/requirements-20260207.md` |
| Admin manual | `doc/admin-manual/` (all HTML files) |
| User manual | `doc/user-manual/` (all HTML files) |
