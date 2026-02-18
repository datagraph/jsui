# Query Editor Additions: Revision Selection and Asynchronous Requests

## Problem Statement

Two capabilities need to be added:

1. **Revision selection**: For repositories with "REVISIONED" in their class name, queries and view executions should be able to target a specific revision. The default is "HEAD". The revision list is available from `GET /system/accounts/{acct}/repositories/{repo}/revisions` with `Accept: text/plain`, fetched on demand only when the user interacts with the selector.

2. **Asynchronous request support**: It must be possible to indicate that a query, a view execution, or an import should be asynchronous. The client signals asynchronous intent by including an `AcceptAsynchronous: notify` header in the request. For queries and views, a notification location URL can optionally be specified via an `Asynchronous-Location` header.

Import already has an async checkbox in the import options popup. The question is where to place the controls for queries and views.

---

## Current UI Inventory

### SPARQL Editor Toolbar (inline and standalone)

The `sparql-editor.js` toolbar is a horizontal button bar:

```
[Toggle] [Title] .............. [LOG] [Media Type ▾] [Run ▶] [Save] [Reset] [Close]
```

This toolbar appears in three contexts:
- **Repository show page**: Inline editors opened from the view list (multiple can be open simultaneously)
- **QueryShowPage**: Standalone page for a single view (`/account/:acct/repositories/:repo/views/:view`)
- **SparqlPage**: Full query page (`/account/:acct/repositories/:repo/query`) with side panel containing saved queries and default prefixes

The editor sends queries via `fetch()` POST to the SPARQL endpoint with `Content-Type: application/sparql-query` and an `Accept` header set by the media type selector.

### View List (Repository Show Page)

Each view entry in the query catalog:

```
[link-icon] accountName  viewName          [execute-icon] [trash-icon]
```

The view name is a clickable link that opens the view in an inline SPARQL editor on the same page. Multiple views can be opened simultaneously in the editors area to the right of the catalog.

The execute icon is an external link that navigates to `/{acct}/{repo}/{view}` in a new browser tab. This is a direct HTTP GET handled entirely by the SPOCQ server — the server executes the view's stored SPARQL query and returns an HTML results document. The SPA has no involvement in this request beyond constructing the `<a href>` URL. Because it is a plain navigation, no custom HTTP headers can be attached.

### QueryShowPage (Standalone View Page)

Reached via `/account/:acct/repositories/:repo/views/:view`. Renders a full SPARQL editor pre-loaded with the view's query text. The editor's run button POSTs the query to `/{acct}/{repo}/sparql`. This context uses `fetch()` and can set arbitrary headers.

### SparqlPage (Full Query Page)

Reached via `/account/:acct/repositories/:repo/query`. Renders the editor with a side panel containing saved views and default prefixes. The editor's run button POSTs to `/{acct}/{repo}/sparql` via `fetch()`.

### Import Options Popup

Currently a fixed-position popup with:
- File name display
- Media type dropdown
- "Asynchronous import" checkbox (sets `AcceptAsynchronous: notify` header)
- Import / Cancel buttons

---

## Revision Selection Alternatives

The revision selector applies only to repositories with "REVISIONED" in `config.class`. It affects the SPARQL endpoint URL by appending a revision parameter. The list is fetched on demand from the revisions endpoint.

### Alternative R1: Dropdown in the Editor Toolbar

Add a revision dropdown to the SPARQL editor toolbar, between the media type selector and the run button:

```
[Toggle] [Title] ... [LOG] [Media Type ▾] [Revision ▾] [Run ▶] [Save] [Reset] [Close]
```

**Behavior**:
- Only rendered when the repository class contains "REVISIONED"
- Initially shows "HEAD"
- On first open (click/focus), fetches the revision list from the endpoint
- Selected revision is appended as a query parameter on the SPARQL endpoint: `?revision={value}`

**Pros**:
- Directly adjacent to the run button — the revision is part of execution context
- Visible and discoverable
- Works in all three editor contexts (inline, standalone, full query page)
- Consistent with the existing media type dropdown pattern

**Cons**:
- Adds width to an already dense toolbar
- The `sparql-editor.js` toolbar would need a new option to pass in and render the revision selector

### Alternative R2: Dropdown in the Repository Pane Header

Add a revision dropdown at the repository level, above the view list, next to the "Editors" heading or as part of the repository metadata bar:

```
Editors   Revision: [HEAD ▾]
─────────────────────────────
[inline editor 1]
[inline editor 2]
```

**Behavior**:
- Appears once per repository pane
- All inline editors within that pane inherit the selected revision
- On first open, fetches the revision list

**Pros**:
- Set once, applies to all queries in the pane — less repetition
- Does not add clutter to each editor toolbar
- Natural location: the revision is a property of the repository, not the query

**Cons**:
- Only affects the repository show page inline editors
- The standalone QueryShowPage and SparqlPage would need their own revision selectors (duplicated logic)
- Creates a disconnect: the setting is visually far from the run button

### Alternative R3: Dropdown in the Side Panel (SparqlPage Only) + Toolbar Elsewhere

On the SparqlPage, add a "Repository" section to the side panel (accordion) with a revision dropdown. On the repository show page and QueryShowPage, use R1 (toolbar placement).

**SparqlPage side panel**:
```
▼ Views
  [New] [query list...]

▼ Repository
  Revision: [HEAD ▾]

▼ Default Prefixes
  [prefix table...]
```

**Pros**:
- Side panel has room; does not crowd the toolbar
- Groups repository-level settings together
- Other contexts still get the toolbar dropdown

**Cons**:
- Inconsistent placement across the three editor contexts
- More implementation effort (two different placements)

### Recommendation

**R1 (toolbar dropdown)** provides the most consistent experience across all contexts and follows the established pattern of the media type dropdown. The toolbar already flexes to accommodate optional elements. The revision selector would be conditionally rendered only for revisioned repositories, so it adds no clutter for non-revisioned repositories.

---

## Asynchronous Request Alternatives

The client signals asynchronous intent by including an `AcceptAsynchronous: notify` header in the request. The server may then return 202 Accepted with a job location instead of blocking for the full result. Optionally, the client can include an `Asynchronous-Location` header specifying a URL where the server should POST a completion notification.

These headers can be set on any `fetch()` request (SPARQL queries, import POST), but cannot be set on plain browser navigations (external view execution links).

### Alternative A1: Checkbox + URL Field in the Editor Toolbar

Add an async toggle next to the run button, with a popover for the notification URL:

```
[Media Type ▾] [Revision ▾] [Async ☐] [Run ▶] ...
```

Clicking "Async" or its label toggles the checkbox. When checked, a small popover or inline text field appears for the notification URL (optional).

**Pros**:
- Adjacent to the run button — directly modifies how the query executes
- Compact: checkbox is small; URL field only appears when async is checked
- Consistent with the existing toolbar control pattern

**Cons**:
- The notification URL field needs careful placement to avoid crowding
- A popover adds interaction complexity

### Alternative A2: Settings Row Below the Editor Toolbar

Add a collapsible settings row below the button bar:

```
[Toggle] [Title] ... [Media Type ▾] [Run ▶] [Save] [⚙ Settings]
───────────────────────────────────────────────────────────────────
☐ Asynchronous    Notification URL: [________________________]
Revision: [HEAD ▾]
```

The settings row is hidden by default and toggled by a gear icon in the toolbar.

**Pros**:
- Keeps the main toolbar clean
- Groups all secondary execution options (async, revision, notification URL) together
- Room for additional settings in the future
- URL field has proper width

**Cons**:
- Hidden by default — may not be discovered
- Extra click to access
- Adds vertical space when expanded

### Alternative A3: Inline Below the Query Text Area

Place the async checkbox and notification URL field between the query text area and the results area:

```
[query text area]
───────────────────────────────────────────────────────────────────
☐ Asynchronous    Notification URL: [________________________]
Revision: [HEAD ▾]
───────────────────────────────────────────────────────────────────
[query results]
```

**Pros**:
- Clear visual separation from the editor and results
- Plenty of horizontal space for the URL field
- Visible without extra clicks

**Cons**:
- Takes permanent vertical space even when not needed
- Interrupts the visual flow from query to results
- Does not exist in the current layout structure — would require adding a new section to the editor

### Alternative A4: Combined Settings Popover from Toolbar

Add a single settings button (gear icon) to the toolbar. Clicking it opens a popover panel with all execution options:

```
[Media Type ▾] [⚙] [Run ▶] ...

  ┌──────────────────────────────────┐
  │ ☐ Asynchronous                   │
  │ Notification URL: [___________]  │
  │ Revision: [HEAD ▾]              │
  └──────────────────────────────────┘
```

**Pros**:
- Minimal toolbar footprint — one icon
- All secondary settings in one place
- Pattern already established by the import options popup
- Popover closes on outside click; does not consume persistent space

**Cons**:
- All settings hidden behind a click
- Popover positioning can be tricky in the inline editor context
- Must manage popover open/close state

---

## View Execution (External Link)

### Current Behavior

The execute icon in the view list is an `<a>` tag with `data-external target="_blank"`:

```html
<a href="{host}/{acct}/{repo}/{view}" data-external target="_blank">
  <img src="images/link.svg" />
</a>
```

Clicking it causes the browser to navigate to `/{acct}/{repo}/{view}` in a new tab. The SPOCQ server receives this as a plain GET request, executes the view's stored query, and returns an HTML document containing the results. The browser renders this HTML directly. The SPA is not involved — no JavaScript runs in the context of that request.

Because this is a browser navigation, only the URL and standard browser headers (`Accept`, `Cookie`, etc.) can influence the request. Custom headers like `AcceptAsynchronous` or `Asynchronous-Location` cannot be included. The `Accept` header is the browser's default (typically `text/html,...`).

### What Revision and Async Would Mean Here

- **Revision**: The server should execute the view against a specific repository revision rather than HEAD. The revision identifier must be conveyed in the request.
- **Asynchronous**: The server should accept the request and return a 202 with a job location rather than blocking. This is only useful if the result page can poll for completion — the returned HTML document would need to include polling logic, or the server would need to redirect to a status page.

### Alternative V1: Query Parameters on the URL

Append parameters to the view execution URL:

```
/{acct}/{repo}/{view}?revision={rev}
```

For async:
```
/{acct}/{repo}/{view}?revision={rev}&asynchronous=notify
```

The execute icon's `href` is constructed dynamically from the current repository pane state (if R2 is used for revision) or from a pane-level revision selector.

**Behavior**:
- The `<a href>` is updated when the revision selector changes
- If async is enabled at the pane level, `&asynchronous=notify` is appended
- The SPOCQ server must recognize these query parameters and treat them equivalently to the corresponding headers

**Pros**:
- The link remains a simple `<a>` — standard browser navigation
- The URL is bookmarkable and shareable
- No JavaScript needed at click time
- Revision parameter is straightforward for the server to implement

**Cons**:
- Requires SPOCQ to support `?revision=` and `?asynchronous=` query parameters (in addition to or instead of headers)
- Async via browser navigation has limited utility: the server must return an HTML page that handles the asynchronous flow (e.g., a polling page), since there is no client-side code to process a 202 response
- No way to specify a notification URL via query parameter in a meaningful way for a browser navigation

### Alternative V2: Replace Link with Fetch + Display

Replace the external `<a>` link with a button that performs a `fetch()` with custom headers, then opens the result in a new tab:

```javascript
button.addEventListener('click', async () => {
  const headers = {
    Accept: 'text/html',
    Authorization: `Bearer ${token}`
  };
  if (selectedRevision !== 'HEAD') {
    headers['Revision'] = selectedRevision;
  }
  if (asyncEnabled) {
    headers['AcceptAsynchronous'] = 'notify';
    if (notificationUrl) {
      headers['Asynchronous-Location'] = notificationUrl;
    }
  }

  const resp = await fetch(`${host}/${acct}/${repo}/${view}`, { headers });

  if (resp.status === 202) {
    // Async: server accepted the request
    const location = resp.headers.get('Location');
    showStatusMessage(`Async request accepted. Job: ${location}`);
  } else if (resp.ok) {
    // Synchronous: open HTML result in new tab
    const html = await resp.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    URL.revokeObjectURL(url);
  } else {
    alert(`View execution failed: ${resp.status}`);
  }
});
```

**Pros**:
- Full control over request headers — revision, async, notification URL all supported
- Can properly handle a 202 async response (display job status, poll for results)
- Consistent with how the SPARQL editor sends queries

**Cons**:
- The new tab shows a `blob:` URL rather than the meaningful `/{acct}/{repo}/{view}` URL
- The URL is not bookmarkable or shareable
- More complex than a simple link
- If the result document references relative resources (CSS, images), they will not resolve from the blob URL

### Alternative V3: Fetch + Redirect to Server URL

A hybrid: perform a fetch to check if async is needed or to set headers, then redirect:

```javascript
if (needsCustomHeaders) {
  // Use fetch with headers, display result via blob
  // (same as V2)
} else {
  // Plain navigation — no custom headers needed
  window.open(`${host}/${acct}/${repo}/${view}?revision=${rev}`, '_blank');
}
```

**Pros**:
- Uses the simple link when possible (revision-only via query parameter)
- Falls back to fetch only when async headers are required
- Best of both worlds for the common case

**Cons**:
- Two code paths to maintain
- Inconsistent behavior: sometimes a real URL, sometimes a blob URL

### Alternative V4: Inline Result Display

Instead of opening a new tab, display the view execution result in the editors area of the repository pane, similar to how the SPARQL editor shows results:

```javascript
button.addEventListener('click', async () => {
  const headers = { Accept: 'text/html', Authorization: `Bearer ${token}` };
  if (selectedRevision !== 'HEAD') headers['Revision'] = selectedRevision;
  if (asyncEnabled) headers['AcceptAsynchronous'] = 'notify';

  const resp = await fetch(`${host}/${acct}/${repo}/${view}`, { headers });
  const html = await resp.text();

  // Render in an iframe or shadow DOM within the editors area
  const iframe = document.createElement('iframe');
  iframe.srcdoc = html;
  editorsContainer.appendChild(iframe);
});
```

**Pros**:
- Full header control
- Result stays within the SPA context — no new tab needed
- Real URL not required since it is displayed inline
- Can handle 202 async responses gracefully

**Cons**:
- An iframe is needed to isolate the server's HTML from the SPA's DOM and styles
- The result rendering may differ from the standalone page experience
- Does not open in a new tab (may be unexpected if the user wanted a separate window)

### Recommendation

**V3 (fetch + redirect hybrid)** balances simplicity and capability. For the common case (revision only, no async), a query parameter on a direct link works. When async is enabled, the fetch path provides full header control. If the SPOCQ server can be extended to support `?revision=` as a query parameter, the direct link path covers revision selection cleanly.

For async view execution specifically, V2/V4 are necessary since browser navigation cannot carry the `AcceptAsynchronous` header. The choice between V2 (new tab) and V4 (inline) depends on whether the result should open separately or stay within the repository page.

---

## Import: Already Addressed

The import options popup (`showImportOptionsPopup`) already includes an "Asynchronous import" checkbox that sets the `AcceptAsynchronous: notify` header on the XMLHttpRequest. No additional changes are needed for import unless a notification URL is also required, in which case a text field can be added to the existing popup (visible only when the async checkbox is checked), and its value included as an `Asynchronous-Location` header.

---

## Combined Recommendation

1. **Revision**: Use **R1** — add a conditional dropdown to the `sparql-editor.js` toolbar. Pass the repository class into the editor config; only render the dropdown when the class contains "REVISIONED". Fetch the revision list on first dropdown interaction.

2. **Async + notification URL for queries**: Use **A4** — add a gear icon to the toolbar that opens a settings popover containing the async checkbox and notification URL field. When async is checked, the `AcceptAsynchronous: notify` header is included in the `fetch()` call. When a notification URL is provided, an `Asynchronous-Location` header is included.

3. **View execution**: Use **V3** — for revision-only, append `?revision={rev}` to the direct link URL. When async is enabled, replace the navigation with a `fetch()` that includes the `AcceptAsynchronous: notify` header and handles the 202 response.

4. **Import notification URL**: Add a text field to the existing import options popup, visible only when the async checkbox is checked, and include its value as an `Asynchronous-Location` header.

This combination adds two elements to the editor toolbar (revision dropdown + settings gear) while keeping the toolbar manageable, and reuses the existing import popup pattern for the notification URL.
