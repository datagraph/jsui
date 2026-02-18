# Dydra JSUI

This is a JavaScript single-page application (SPA) providing the web user interface for [Dydra](https://dydra.com), a cloud-hosted RDF graph database with SPARQL query support. Served from the `/ui` base path on the Dydra host.

The UI is split into two independent applications sharing a common codebase:

- **Studio** (`index.html` / `app.js`) — the user-facing workspace for interacting with RDF repositories
- **Admin** (`admin.html` / `admin-app.js`) — the administration interface for managing accounts, repositories, and invitations

The suggested nginx configuration (see doc/nginx-config.md) is to allow the locations `/ui/user` and `/ui/admin`.
---

## Implementation Summary

The project is written in **vanilla JavaScript ES modules** with no build step or third-party framework. It uses the browser's native module system (`<script type="module">`) and targets modern browsers.

### Entry Points

| File | Description |
|------|-------------|
| `index.html` | Studio app shell; mounts `#app` and loads `app.js` |
| `admin.html` | Admin app shell; mounts `#app` and loads `admin-app.js` |
| `app.js` | Studio bootstrap: creates `AppState`, `App`, and `Router`; starts routing |
| `admin-app.js` | Admin bootstrap: same pattern, scoped to `/admin` routes |
| `signup.html` | Standalone signup page |
| `reset_password.html` | Standalone password-reset page |

### Client-Side Router (`router.js`)

A custom router with no dependencies that supports:

- **Named dynamic segments** — e.g. `/account/:account_name/repositories/:repository_name`
- **History API** (`pushState`/`popState`) in production; **hash URLs** (`#/path`) when served from `file://`
- **Configurable base path** — strips `/ui` prefix before matching routes
- **Internal navigation stack** — `goBack()` / `goForward()` maintain an in-memory history independent of the browser's history
- **Link interception** — a document-level click listener intercepts same-origin `<a>` tags and routes them client-side without a full page load; external links, file links, and links with `data-external` or `data-action` attributes bypass the router

### Application State (`lib/app_state.js`)

`AppState` is the single source of truth. It holds:

- **Session** — currently logged-in account name, persisted across page loads
- **AuthStore** — per-account Bearer tokens stored in memory
- **Cache** — in-memory lists of `Account`, `Repository`, `Query`, and `Invitation` objects, pre-populated from `lib/sample_data.js` for development and augmented from the backend at runtime
- **Open-pane tracking** — which accounts, repositories, and views are currently open as tabs
- **Trackers** — per-account and per-repository `GraphObject` instances managed by `ReplicationManager`

Data is fetched through `RdfStoreAdapter`, which delegates to an injected `rdfClient`. When no live client is available, the adapter returns empty results and the state falls back to cached sample data.

### Authentication (`lib/auth.js`)

`authenticateAccount` issues a `GET /system/accounts/:name/configuration` request using either:

- **Bearer token** — if the secret starts with `Bearer `, `:`, or `token:`
- **Basic auth** — otherwise, base64-encodes `accountName:secret`

On success the server returns an `accessToken` that is stored in `AuthStore` and sent on subsequent API requests.

### Domain Models (`lib/models/`)

Plain classes with no inheritance:

| Model | Key properties |
|-------|----------------|
| `Account` | `friendlyId`, `email`, `fullname`, `homepage` |
| `Repository` | `friendlyId`, `accountId`, `quadCount`, `diskSize`, `prefixes`, `privacy_setting` |
| `Query` | `friendlyId`, `repositoryId`, query text |
| `Invitation` | invitation metadata |
| `Session` | `accountName`, `isLoggedIn()`, persisted to `localStorage` |

`Repository` and `Account` declare `_persistentProperties` and `_editableProperties` static arrays used by `ReplicationManager` to track which fields need to be synced.

### Replication (`lib/replication/`)

`ReplicationManager` wraps domain objects in `GraphObject` instances that track dirty state. When a property changes, the replicator records which fields were edited so only deltas are sent on save. `GraphObject` uses a class registry (`GraphObject.getClass` / `setClass`) so instances survive across route transitions.

### UI Layer (`ui/`)

`App` (Studio) and `AdminApp` (Admin) own the DOM root (`#app`) and implement a **tabbed pane** interface:

- **Tabs bar** — a horizontally scrollable list of open panes (Info, Login, per-account, per-repository, per-view)
- **Content area** — one `<div>` per open pane; only the active pane is visible (`display: block`)
- **Location bar** — a URL-like display that reflects the current route and accepts typed navigation
- **Pane actions** — close (×) and save buttons per tab; drag-to-detach for view/editor panes opens a standalone editor window via `sessionStorage` transfer

`App.renderPage(page)` renders a full page into the `#app` root, then calls `page.afterRender()` for any post-render initialization (event binding, editor setup, etc.).

#### Pages (`ui/pages/`)

Each route maps to a page class that extends `BasePage` and implements:

- `getTitle()` — document title
- `getBodyClass()` — CSS class on `<body>`
- `renderContent()` — returns an HTML string
- `renderSidebar()` — optional sidebar HTML
- `getPaneTabs()` — optional tab bar and default tab for paned layouts
- `afterRender()` — post-render hook

Key pages include `HomePage`, `LoginPage`, `SignupPage`, `AccountRoute`, `RepositoryRoute`, `SparqlPage`, `ViewRoute`, `RepositoryImportPage`, `StandaloneEditorPage`, and `NotFoundPage`.

#### Components (`ui/components/`)

Shared rendering helpers: `LayoutView`, `HeaderView`, `FooterView`, `NavigationView`, `FlashesView`.

#### Admin Sub-Application (`ui/admin/`)

Mirrors the Studio structure with its own `AdminApp`, routes, pages, and layout, scoped to `/admin`.

### SPARQL Editor (`js/`)

Two pre-built JavaScript assets provide the query editor:

| File | Description |
|------|-------------|
| `js/yasqe-wrapper.js` | Thin wrapper around the YASQE CodeMirror-based SPARQL editor |
| `js/sparql-editor.js` | `SparqlEditor` custom element integrating YASQE with query execution, result display, multi-tab management, and format selection |

Editor instances are stored in `App.editorInstances` (a `Map` keyed by pane ID) so their state survives tab switches.

### Stylesheets (`stylesheets/`, `css/`)

| File | Description |
|------|-------------|
| `stylesheets/style.css` | Main application stylesheet, as adopted from the legacy web interface |
| `stylesheets/jsui-overrides.css` | Overrides for third-party widget styles |
| `stylesheets/handheld.css` | Responsive / mobile adjustments |
| `css/dydra.reboot.css` | CSS reset/normalize layer |
| `css/dydra.admin.css` | Admin-specific styles |

---

## Directory Structure

```
jsui/
├── index.html               # Studio SPA entry point
├── admin.html               # Admin SPA entry point
├── app.js                   # Studio bootstrap
├── admin-app.js             # Admin bootstrap
├── router.js                # Client-side router
├── signup.html              # Standalone signup page
├── reset_password.html      # Standalone password-reset page
│
├── lib/                     # Core library
│   ├── config.js            # App configuration (hosts, base path, feature flags)
│   ├── app_state.js         # Central state container
│   ├── auth.js              # Authentication (Basic / Bearer)
│   ├── auth_store.js        # In-memory token storage
│   ├── sample_data.js       # Development fixture data
│   ├── models/              # Domain model classes
│   │   ├── account.js
│   │   ├── repository.js
│   │   ├── query.js
│   │   ├── invitation.js
│   │   └── session.js
│   ├── persistence/         # Data access layer
│   │   ├── adapter.js       # Abstract PersistenceAdapter
│   │   └── rdf_store_adapter.js  # RDF client delegate
│   └── replication/         # Dirty-state tracking
│       ├── graph-object.js
│       ├── graph-database.js
│       ├── graph-environment.js
│       ├── revision-identifier.js
│       └── replication_manager.js
│
├── ui/                      # UI layer
│   ├── app.js               # App class (tab management, rendering, navigation)
│   ├── routes.js            # Studio route table
│   ├── utils.js             # Shared UI utilities
│   ├── components/          # Layout components
│   │   ├── layout.js        # LayoutView (full page wrapper)
│   │   ├── header.js
│   │   ├── footer.js
│   │   ├── navigation.js
│   │   └── flashes.js
│   ├── pages/               # Page classes (one per route)
│   │   ├── base_page.js
│   │   └── index.js         # Re-exports all pages
│   └── admin/               # Admin sub-application
│       ├── app.js           # AdminApp class
│       ├── routes.js        # Admin route table
│       ├── layout.js
│       └── pages.js
│
├── js/                      # Pre-built JS assets
│   ├── yasqe-wrapper.js     # YASQE SPARQL editor wrapper
│   ├── sparql-editor.js     # SparqlEditor custom element
│   └── save-login.js        # Login credential save helper
│
├── stylesheets/             # CSS stylesheets
│   ├── style.css
│   ├── jsui-overrides.css
│   └── handheld.css
│
├── css/                     # Additional CSS
│   ├── dydra.reboot.css
│   └── dydra.admin.css
│
├── fonts/                   # Local font files
├── webfonts/                # Web font files (Font Awesome etc.)
├── images/                  # Image assets (logos, icons)
├── assets/                  # Miscellaneous static assets
│
├── tests/                   # Playwright end-to-end tests
│   ├── test-helpers.js      # Shared helper functions
│   ├── authentication-documented.spec.js
│   ├── account-documented.spec.js
│   ├── repository-documented.spec.js
│   ├── sparql-documented.spec.js
│   ├── view-documented.spec.js
│   ├── navigation-documented.spec.js
│   ├── import-export-documented.spec.js
│   ├── ui-components-documented.spec.js
│   ├── doc-capture.js       # PDF screenshot capture module
│   ├── test-catalog.md      # Test coverage catalogue
│   └── pdfs/                # Generated documentation PDFs (git-ignored)
│
├── tests-archive/           # Archived earlier test iterations
├── tests-results/           # Playwright test result output
│
├── doc/                     # Project documentation
│   ├── requirements-*.md/pdf    # Functional requirements
│   ├── implementation.md/pdf    # Implementation notes
│   ├── analysis-*.md/pdf        # Design analysis
│   ├── api.md/pdf               # API reference
│   ├── improvements.md/pdf      # Backlog / improvement notes
│   ├── user-manual/
│       ├── index.html       # The users' manual
│   ├── nginx-config.md          # Server deployment guide
│   └── instructions/            # Developer instructions
│
├── package.json             # npm metadata (Playwright dev dependency)
├── package-lock.json
├── .gitignore
└── LICENSE                  # AGPL-3.0
```

---

## Running Tests

Dependencies:

```bash
npm install
npx playwright install
```

Run the full test suite:

```bash
npx playwright test
```

Run a specific spec file:

```bash
npx playwright test tests/authentication-documented.spec.js
npx playwright test tests/sparql-documented.spec.js
```

Run tests matching a keyword:

```bash
npx playwright test -g "repository"
npx playwright test -g "login"
```

Generate PDF documentation screenshots alongside test runs:

```bash
CAPTURE_DOCS=true npx playwright test tests/repository-documented.spec.js
```

PDF output is written to `tests/pdfs/` grouped by functional area, with an `index.html` linking captures to requirement IDs.

---

## Configuration

`lib/config.js` exports `APP_CONFIG`:

| Key | Default | Description |
|-----|---------|-------------|
| `baseHost` | `dydra.com` | Primary service hostname |
| `blogHost` | `blog.dydra.com` | Blog hostname |
| `docsHost` | `docs.dydra.com` | Documentation hostname |
| `basePath` | `/ui` | URL prefix under which the app is served |
| `requireSignupInvite` | `true` | Gate signup behind an invitation |
| `showAccountBalances` | `false` | Show billing balance in account UI |

---

## License

AGPL-3.0. See `LICENSE`.
