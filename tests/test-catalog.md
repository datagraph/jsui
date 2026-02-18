# Test Catalog

This document catalogs all Playwright tests for the Dydra JSUI **Studio** application (`index.html`), organized by functional area and mapped to requirements from `doc/requirements-20260207.md`.

**Scope:** These tests cover the **User App (Studio)** component only. The **Admin App** (`admin.html`) has separate requirements (Section 11, Section 12) that are not covered by this test suite.

## Test Organization

Each test category has its own spec file in the `tests/` directory. Tests reuse common helper functions for authentication, account management, repository management, and view management.

---

## 1. Authentication Tests (`authentication.spec.js`)

### Coverage: REQ-1.1.x, REQ-1.2.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `login with valid credentials` | Login with correct username/password, verify successful authentication | REQ-1.1.1, REQ-1.1.2 |
| `login with invalid credentials` | Attempt login with wrong password, verify error message | REQ-1.1.1, REQ-9.1.1 |
| `logout functionality` | Login, then logout, verify redirect to login page | REQ-1.2.2 |
| `navigation links based on auth status` | Verify different nav links shown when logged in vs logged out | REQ-1.2.3 |
| `session persistence of account name` | Login, reload page, verify account name is remembered | REQ-1.2.1 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-1.1.3 | Token storage in memory | Internal implementation detail |
| REQ-1.1.4 | Multiple authenticated accounts simultaneously | Requires multi-account test setup |

---

## 2. Account Management Tests (`account.spec.js`)

### Coverage: REQ-2.1.x, REQ-2.2.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `display account information` | View account details (email, fullname, homepage, etc.) | REQ-2.1.1, REQ-2.1.2 |
| `edit account profile fields` | Modify account fields, save, verify persistence | REQ-2.2.1, REQ-2.2.3 |
| `view authentication token` | Access and display account authentication token | REQ-2.2.4 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-2.1.3 | View account details for other accounts | Requires test account for "other" user |
| REQ-2.2.2 | Track only edited fields (delta updates) | Internal implementation detail |
| REQ-2.3.1 | Account creation | **Admin component** (not Studio) |

---

## 3. Repository Management Tests (`repository.spec.js`)

### Coverage: REQ-3.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `repository profile properties` | Modify homepage, summary, description, privacy; verify persistence | REQ-3.2.1, REQ-3.2.3 |
| `repository collaboration` | Add collaborator with read access, verify persistence, remove collaborator | REQ-3.7.1, REQ-3.7.2, REQ-3.7.3 |
| `repository creation` | Create new repository, verify it appears | REQ-3.3.1 |
| `repository prefixes` | Edit repository prefixes, save, verify persistence | REQ-3.2.1 |
| `repository clear` | Clear all triples with confirmation dialog | REQ-3.6.1 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-3.1.2 | Display quad count, disk size, license, import status | Verify all metadata fields displayed |
| REQ-3.2.2 | Track only edited fields (delta updates) | Internal implementation detail |

---

## 4. SPARQL Query Tests (`sparql.spec.js`)

### Coverage: REQ-4.1.x, REQ-4.3.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `execute SPARQL query` | Run a simple SELECT query, verify results displayed | REQ-4.1.1, REQ-4.1.2 |
| `query result formats - JSON` | Execute query with JSON response format | REQ-4.1.3 |
| `query result formats - CSV` | Execute query with CSV response format | REQ-4.1.3 |
| `query result formats - XML` | Execute query with XML response format | REQ-4.1.3 |
| `query execution time display` | Verify execution time is shown after query | REQ-4.3.4 |
| `query keyboard shortcut` | Execute query using Ctrl/Cmd+Enter | REQ-4.3.2 |
| `query reset functionality` | Modify query, reset to original | REQ-4.3.3 |
| `multiple query tabs` | Create multiple query tabs, switch between them | REQ-4.3.6 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-4.1.3 | SVG, HTML, TSV, Turtle, N-Triples, RDF/XML, JSON-LD, SSE formats | Additional format tests needed |
| REQ-4.1.4 | Display results in appropriate formats (tables, rendered HTML/SVG) | Format-specific rendering verification |
| REQ-4.1.5 | Parameterized queries with dynamic input fields | Requires parameterized view setup |
| REQ-4.1.6 | Query history with timestamps and execution times | Event log verification |
| REQ-4.3.1 | Collapsible query editor interface | UI state test |
| REQ-4.3.5 | Event log for query execution activities | Log display verification |
| REQ-4.3.7 | Drag query tabs to standalone windows | Browser window handling |
| REQ-4.3.8 | Preserve state when opening standalone editor window | Cross-window state test |

---

## 5. View Management Tests (`view.spec.js`)

### Coverage: REQ-4.2.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `create view` | Create new SPARQL view with query text | REQ-4.2.1 |
| `edit view` | Modify view query text, save changes | REQ-4.2.1, REQ-4.2.3 |
| `delete view` | Delete view with confirmation | REQ-4.2.1 |
| `open view in pane editor` | Open existing view in the repository pane editor | REQ-4.2.5 |
| `execute view` | Run a saved view and verify results | REQ-4.2.2 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-4.2.4 | List views from repository configuration | Implicit in view tests |
| REQ-4.2.6 | Open view in a new pane | Multi-pane test |
| REQ-4.2.7 | Open view results in new window with table display | Browser window handling |

---

## 6. Navigation Tests (`navigation.spec.js`)

### Coverage: REQ-5.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `client-side routing` | Navigate to different routes, verify URL changes | REQ-5.1.1 |
| `browser back/forward` | Use browser navigation, verify correct pages | REQ-5.1.2 |
| `tab management` | Open multiple tabs, switch between them, close tabs | REQ-6.3.1, REQ-6.3.2 |
| `location bar display` | Verify location bar shows current path | REQ-5.2.4 |
| `direct URL navigation` | Navigate directly to repository URL | REQ-5.1.3, REQ-5.1.4 |
| `navigation between account and repositories` | Switch between account and repository views | REQ-5.2.5 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-5.1.5 | Configurable base path for subdirectory deployment | Deployment configuration test |
| REQ-5.2.1 | Navigation links for Home, About, Docs, Blog | External link verification |
| REQ-5.2.2 | Navigation links for My Account, Logout (authenticated) | Partial coverage via auth tests |
| REQ-5.2.3 | Navigation links for Signup, Login (not authenticated) | Partial coverage via auth tests |
| REQ-5.2.6 | Cross-app navigation between user and admin SPAs | Requires admin app |

---

## 7. Import/Export Tests (`import-export.spec.js`)

### Coverage: REQ-3.4.x, REQ-3.5.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `import Turtle file` | Upload .ttl file, verify import success | REQ-3.4.4, REQ-3.4.7 |
| `import N-Triples file` | Upload .nt file, verify import success | REQ-3.4.4, REQ-3.4.7 |
| `import N-Quads file` | Upload .nq file, verify import success | REQ-3.4.4, REQ-3.4.7 |
| `import from URL` | Import from remote URL | REQ-3.4.3 |
| `import progress display` | Verify progress indicator during import | REQ-3.4.6 |
| `export Turtle format` | Export repository as Turtle | REQ-3.5.1 |
| `export N-Triples format` | Export repository as N-Triples | REQ-3.5.1, REQ-3.5.2 |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-3.4.1 | Basic import support | Covered by file tests |
| REQ-3.4.2 | Display import job status and notifications | Notification verification |
| REQ-3.4.5 | Asynchronous imports with AcceptAsynchronous header | Async header test |
| REQ-3.4.6 | Import progress with abort capability | Abort functionality test |
| REQ-3.4.7 | Auto-detect .rdf, .xml, .trig, .jsonld, .json, .csv | Additional format tests |
| REQ-3.5.1 | Export N-Quads, RDF/XML, JSON-LD, TriG, CSV formats | Additional format tests |

---

## 8. UI Component Tests (`ui-components.spec.js`)

### Coverage: REQ-6.x, REQ-9.x

| Test Name | Description | Requirements |
|-----------|-------------|--------------|
| `flash message display` | Trigger action that shows flash message | REQ-6.2.1 |
| `loading indicator` | Verify loading indicator during async operations | REQ-6.2.2 |
| `error message display` | Trigger error, verify user-friendly message | REQ-9.1.2 |
| `404 page` | Navigate to unknown route, verify 404 page | REQ-9.1.3 |
| `modal dialog behavior` | Open and close modal dialogs | REQ-6.2.3 |
| `confirmation dialog` | Verify confirmation dialog behavior | REQ-6.2.3 |
| `responsive layout elements` | Test layout at different viewport sizes | REQ-6.1.3 |
| `keyboard navigation` | Tab through interactive elements | Accessibility |
| `tooltip display` | Verify tooltip display on hover | UI feedback |

### Open Requirements
| Requirement | Description | Notes |
|-------------|-------------|-------|
| REQ-6.1.1 | Consistent page layout (header, nav, content, footer) | Layout structure test |
| REQ-6.1.2 | Home layout variant for landing pages | Home page layout test |
| REQ-6.3.3 | Track open accounts and repositories in tabs | Tab state persistence |
| REQ-6.3.4 | Tabbed sub-panes within dashboard panes | Sub-pane test |
| REQ-9.1.1 | Error messages for authentication failures | Covered in auth tests |
| REQ-9.2.1 | Handle network errors gracefully | Network failure simulation |
| REQ-9.2.2 | Retry mechanisms for failed operations | Retry behavior test |

---

## Common Test Helpers (`test-helpers.js`)

Shared functions used across all test specs:

```javascript
// Authentication
login(page, username, password)
logout(page)

// Repository Management
openRepository(page, accountName, repositoryName)
deleteRepository(page, accountName, repositoryName)

// View Management
createView(page, viewName, queryText)
deleteView(page, viewName)
openViewInEditor(page, viewName)

// Navigation
openCollaborationPanel(page)
openProfilePanel(page)
openSettingsPanel(page)
openPrefixesPanel(page)

// Utilities
waitForSaveComplete(page, urlPattern)
waitForNetworkIdle(page)
getPaneId(accountName, repositoryName)
```

---

## Test Execution

Run all tests:
```bash
npx playwright test
```

Run specific category:
```bash
npx playwright test tests/authentication.spec.js
npx playwright test tests/repository.spec.js
npx playwright test tests/sparql.spec.js
```

Run tests matching pattern:
```bash
npx playwright test -g "repository"
npx playwright test -g "login"
```

---

## Requirements Coverage Summary

### Studio Component Coverage

| Section | Spec File | Status | Open Requirements |
|---------|-----------|--------|-------------------|
| 1. Authentication | authentication.spec.js | Partial | REQ-1.1.3, REQ-1.1.4 |
| 2. Account Management | account.spec.js | Partial | REQ-2.1.3, REQ-2.2.2 |
| 3. Repository Management | repository.spec.js, import-export.spec.js | Partial | REQ-3.1.2, REQ-3.2.2, REQ-3.4.2, REQ-3.4.5, REQ-3.4.6 (abort) |
| 4. SPARQL Queries | sparql.spec.js, view.spec.js | Partial | REQ-4.1.3 (formats), REQ-4.1.4, REQ-4.1.5, REQ-4.1.6, REQ-4.2.6, REQ-4.2.7, REQ-4.3.1, REQ-4.3.5, REQ-4.3.7, REQ-4.3.8 |
| 5. Navigation | navigation.spec.js | Partial | REQ-5.1.5, REQ-5.2.1, REQ-5.2.6 |
| 6. UI Components | ui-components.spec.js | Partial | REQ-6.1.1, REQ-6.1.2, REQ-6.3.3, REQ-6.3.4 |
| 7. Data Persistence | — | Not Tested | REQ-7.x (internal implementation) |
| 8. Invitation System | — | Not Tested | REQ-8.1.1, REQ-8.1.2, REQ-8.1.3 |
| 9. Error Handling | ui-components.spec.js | Partial | REQ-9.2.1, REQ-9.2.2 |
| 10. Configuration | — | Not Tested | REQ-10.x (deployment configuration) |

### Admin Component (Not Covered by Studio Tests)

| Section | Description | Status |
|---------|-------------|--------|
| 2.3 Account Creation | REQ-2.3.1 | Admin component |
| 11. Administration Interface | REQ-11.1.x through REQ-11.6.x | Admin component |
| 12. Data Visualization | REQ-12.1.x | Admin component |

### Non-Functional Requirements (Not Directly Tested)

| Section | Description | Notes |
|---------|-------------|-------|
| 13. Performance | REQ-13.x | Requires performance benchmarking |
| 14. Browser Compatibility | REQ-14.x | Requires multi-browser test matrix |
| 15. Security | REQ-15.x | Requires security audit |
| 16. Maintainability | REQ-16.x | Code quality metrics |
| 17. External Services | REQ-17.x | API integration tests |
| 18. External Libraries | REQ-18.x | Dependency verification |

---

## Documentation Capture Architecture

The test suite includes infrastructure for capturing PDF screenshots mapped to requirements, enabling automatic generation of visual documentation.

### Files

| File | Purpose |
|------|---------|
| `doc-capture.js` | Core module: `DocCapture` class, `REQ` catalog, `CaptureContext` |
| `*-documented.spec.js` | Test specs with integrated documentation capture |

### Design Pattern

Tests are factored into requirement-named functions that both validate the requirement AND capture documentation:

```javascript
async function REQ_3_2_1_editRepositoryMetadata(page, capture, testData) {
  await capture.requirement(REQ['3.2.1'], async (cap) => {
    // Capture: Form displayed with current values
    await cap.before('Repository profile panel with editable fields');

    // ... perform test actions ...

    // Capture: Form filled with new values
    await cap.step('form-filled', 'Profile fields populated with new values');

    // ... submit form ...

    // Capture: After form submission
    await cap.after('Repository metadata fields edited');
  });
}
```

### Benefits

1. **Traceability** - Function names map directly to requirements (e.g., `REQ_3_2_1_editRepositoryMetadata`)
2. **Consistent naming** - PDFs auto-named: `req-3-2-1-edit-repository-metadata-before.pdf`
3. **Composability** - Tests combine requirement functions; documentation runs them individually
4. **Selective capture** - Enable/disable via `CAPTURE_DOCS=true` environment variable
5. **Generated index** - HTML index links captures to requirements

### Capture Points

| Method | Usage |
|--------|-------|
| `cap.before(description)` | Before action: form displayed, entity visible |
| `cap.step(name, description)` | Intermediate: form filled, dialog open |
| `cap.after(description)` | After action: result displayed, save complete |

### Running with Documentation

```bash
# Generate documentation PDFs
CAPTURE_DOCS=true npx playwright test tests/repository-documented.spec.js

# Fast test run (no PDFs)
npx playwright test tests/repository-documented.spec.js
```

### Output Structure

```
tests/pdfs/
├── repository/
│   ├── req-3-2-1-edit-repository-metadata-before.pdf
│   ├── req-3-2-1-edit-repository-metadata-form-filled.pdf
│   ├── req-3-2-1-edit-repository-metadata-after.pdf
│   ├── req-3-2-3-save-repository-configuration-before.pdf
│   ├── req-3-2-3-save-repository-configuration-after.pdf
│   ├── manifest.json
│   └── index.html
├── collaboration/
│   └── ...
└── sparql/
    └── ...
```

### Requirements Catalog (`REQ`)

The `doc-capture.js` module exports a `REQ` object mapping requirement IDs to metadata:

```javascript
const REQ = {
  '3.2.1': { id: 'REQ-3.2.1', title: 'Edit Repository Metadata', section: 'repository' },
  '3.2.3': { id: 'REQ-3.2.3', title: 'Save Repository Configuration', section: 'repository' },
  // ...
};
```

This enables consistent naming and grouping in the generated documentation index.

---

## Future Test Additions

### Priority 1: Functional Gaps
- Multiple authenticated accounts (REQ-1.1.4)
- Parameterized queries (REQ-4.1.5)
- Query history display (REQ-4.1.6)
- Async import with AcceptAsynchronous header (REQ-3.4.5)
- Import abort capability (REQ-3.4.6)

### Priority 2: UI/UX Completeness
- All SPARQL result formats (REQ-4.1.3)
- Standalone editor windows (REQ-4.3.7, REQ-4.3.8)
- View in new pane/window (REQ-4.2.6, REQ-4.2.7)
- Collapsible editor interface (REQ-4.3.1)
- Event log display (REQ-4.3.5)

### Priority 3: Admin Component
- Separate test suite for `admin.html`
- Account administration (REQ-11.2.x)
- Repository administration (REQ-11.3.x)
- Invitation management (REQ-11.4.x)
- History and monitoring (REQ-11.5.x)
- Data visualization graphs (REQ-12.x)
