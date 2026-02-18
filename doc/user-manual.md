# Dydra Studio User Manual

## Version 2026-02-07

This manual covers the user-facing features of Dydra Studio. Dydra Studio is a single-page web application that provides a comprehensive interface for managing RDF data repositories, executing SPARQL queries, and administering accounts on the Dydra platform.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Login and Authentication](#2-login-and-authentication)
3. [Account Management](#3-account-management)
4. [Repository Management](#4-repository-management)
5. [Data Import](#5-data-import)
6. [SPARQL Views](#6-sparql-views)
7. [Collaboration Management](#7-collaboration-management)
8. [Tips and Best Practices](#8-tips-and-best-practices)

---

## 1. Getting Started

### 1.1 Accessing the Application

Dydra Studio is accessed through your web browser. Navigate to the login page at:

**https://dydra.com/ui/user**

*Note: For visual references and screenshots, see the HTML version of this manual in the `doc/user-manual/` directory.*

### 1.2 Browser Requirements

The application requires a modern web browser with:
- JavaScript enabled
- ES6+ JavaScript support
- History API support (or hash-based routing fallback)

Supported browsers include:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

### 1.3 Application Overview

Dydra Studio provides two main interfaces:
- **User App**: General user interface for account management, repository operations, SPARQL queries, and data import/export
- **Console**: Administrative interface for system-wide management (covered in separate documentation)

This manual focuses on the **User App** functionality.

---

## 2. Login and Authentication

### 2.1 Logging In

To access your account and repositories, you must first log in:

1. **Navigate to the login page** by clicking "Login" in the navigation menu, or by visiting **https://dydra.com/ui/user** (or the `/login` route).

2. **Enter your credentials**:
   - **Host**: The Dydra service host (e.g., `dydra.com`). If left blank, the default host will be used.
   - **Username**: Your account name
   - **Password or Token**: Your account password or authentication token

3. **Click "Sign in"** or press Enter.

4. **Wait for authentication**: The system will authenticate you against the Dydra service API. You'll see a status message indicating "Authenticating..." during this process.

5. **Success**: Upon successful authentication, you'll be redirected to your account page and see a success message: "Authenticated as [account-name]".

### 2.2 Authentication Methods

The system supports two authentication methods:

- **Password Authentication**: Use your account password
- **Bearer Token Authentication**: Use an authentication token (useful for API access)

Both methods are entered in the same "Password or Token" field.

### 2.3 Multiple Accounts

The system supports multiple authenticated accounts simultaneously. You can:
- Switch between accounts using the account selector
- Access repositories from different accounts in separate tabs
- Maintain separate authentication sessions for each account

### 2.4 Session Management

- **Session Persistence**: The application persists only account name(s) across page reloads using browser storage. All other session data (including authentication tokens) exist only in JavaScript objects during a single page session and are discarded when the page is closed.
- **Logout**: Click "Logout" in the navigation menu to end your session and clear authentication data from memory. Account names may still be remembered in browser storage for convenience, but you will need to log in again to access your account.
- **Re-authentication**: If your session expires or you close the page, you'll need to log in again. Tokens are not persisted across page sessions.

### 2.5 Troubleshooting Login Issues

If login fails:
- Verify your username and password/token are correct
- Check that the host URL is correct
- Ensure your account exists and is active
- Check your internet connection
- Review any error messages displayed in the login form

---

## 3. Account Management

### 3.1 Viewing Your Account

After logging in, you'll be redirected to your account page, which displays:


*Figure 2: Account page layout showing repositories list*
- Account name (friendly ID)
- Email address
- Full name
- Homepage URL
- Blog URL
- Company/Organization
- Location
- Other profile information

### 3.2 Editing Account Metadata

To edit your account information:

1. **Navigate to your account page** by clicking "My Account" in the navigation menu or visiting `/account/[your-account-name]`.

2. **Click "Edit"** or navigate to `/account/[your-account-name]/edit`.

3. **Edit the desired fields** in the account settings tabs:
   - **Profile Tab**: Edit personal information
     - Real name
     - Email
     - Homepage
     - Blog
     - Organization
     - Location
     - Phone
     - Skype ID
     - Jabber ID
   - **Password Tab**: Change your password
   - **Settings Tab**: Configure account settings (e.g., region)
   - **Prefixes Tab**: Set default repository prefixes
   - **Console Tab**: View administrative information (if applicable)

4. **Make your changes**: The system tracks only the fields you modify. Unchanged fields are not sent to the server.

5. **Click "Save"** to save your changes.

6. **Confirmation**: You'll see a success message when changes are saved successfully.

### 3.3 Viewing Authentication Token

To view or reset your authentication token:

1. Navigate to `/account/[your-account-name]/auth_token`.

2. Click the button to view or reset your token.

3. **Important**: Keep your authentication token secure. It provides full access to your account.

### 3.4 Account Creation

If you need to create a new account:

1. Navigate to the signup page (`/signup`) or click "Signup" in the navigation menu.

2. Fill in the required information.

3. **Note**: Account creation may require an invitation code if invitation requirements are enabled on your Dydra instance.

---

## 4. Repository Management

### 4.1 Viewing Repositories

To view your repositories:

1. **Navigate to your account page** (`/account/[account-name]`).

2. The repositories list displays:
   - Repository name
   - Summary/description
   - Quad count (number of RDF statements)
   - Disk size
   - License information
   - Import status

3. **Click on a repository name** to view its details.

### 4.2 Creating a New Repository

To create a new repository:

1. **Navigate to your account page** or repositories list.

2. **Click the "New Repository" button** (typically labeled with a "+" icon or "New" text).

3. **Fill in the repository creation dialog**:
   - **Name**: Enter a unique repository name (required)
   - **Type**: Select the repository type:
     - `lmdb`: Standard LMDB repository
     - `lmdb-revisioned`: Revisioned LMDB repository (supports version history)

4. **Click "Create"** or press Enter.

5. **Success**: The new repository will appear in your repositories list, and you'll be redirected to the repository page.

### 4.3 Viewing Repository Details

The repository page displays:


*Figure 3: Repository page layout with views list and editor area*

- **Repository Information**:
  - Name, summary, description
  - Homepage URL
  - License
  - Quad count
  - Disk size
  - Import status

- **Repository Tabs**:
  - **About**: General information and metadata
  - **Query**: SPARQL query interface
  - **History**: Repository event history
  - **Resources**: Resource statistics
  - **Statistics**: Query and usage statistics
  - **Series**: Time-series data
  - **Revisions**: Version history (for revisioned repositories)
  - **Collaboration**: Collaborator management (see Section 7)

- **Repository Actions**:
  - **Import**: Import data into the repository
  - **Export**: Export repository data
  - **Clear**: Remove all triples from the repository
  - **Edit**: Edit repository metadata

### 4.4 Editing Repository Metadata

To edit repository information:

1. **Navigate to the repository page** (`/account/[account-name]/repositories/[repository-name]`).

2. **Click "Edit"** or navigate to `/account/[account-name]/repositories/[repository-name]/edit`.

3. **Edit the desired fields** in the repository settings tabs:
   - **About Tab**:
     - Name
     - Homepage
     - Summary
     - Description
     - License
   - **Privacy Tab**:
     - Permissions (Public/Private)
     - Permissible IP addresses (one per line)
   - **Prefixes Tab**:
     - Default repository prefixes (SPARQL prefix declarations)
   - **Collaborators Tab**: Manage repository collaborators (see Section 7)

4. **Make your changes**: Only modified fields are sent to the server.

5. **Click "Update"** to save your changes.

6. **Confirmation**: You'll see a success message when changes are saved.

### 4.5 Deleting a Repository

To delete a repository:

1. **Navigate to the repository list** on your account page.

2. **Click the delete button** (trash icon) next to the repository name.

3. **Confirm deletion** in the confirmation dialog.

4. **Warning**: Repository deletion is permanent and cannot be undone. All data in the repository will be lost.

### 4.6 Clearing Repository Data

To remove all triples from a repository (while keeping the repository itself):

1. **Navigate to the repository page**.

2. **Click the "Clear" button**.

3. **Confirm the action** in the confirmation dialog.

4. **Warning**: This action is permanent and cannot be undone. All RDF data in the repository will be deleted.

---

## 5. Data Import

### 5.1 Import Methods

The system supports importing data into repositories through two methods:

1. **File Upload**: Upload a local file from your computer
2. **URL Import**: Import data from a web URL

### 5.2 Importing from a Local File

To import data from a local file:

1. **Navigate to the repository page** where you want to import data.

2. **Click the "Import" button**.

3. **Select a file** from your computer using the file picker dialog.

4. **Supported file formats**:
   - Turtle (`.ttl`)
   - RDF/XML (`.rdf`, `.xml`)
   - N-Triples (`.nt`)
   - N-Quads (`.nq`)
   - TriG (`.trig`)
   - JSON-LD (`.jsonld`, `.json`)
   - CSV (`.csv`)

5. **Configure import options** (a popup will appear):
   - **Content Type**: Select the media type for your file (auto-detected from file extension)
   - **Asynchronous Import**: Check this box to perform the import asynchronously
     - Asynchronous imports allow you to continue working while the import processes in the background
     - You can optionally provide a notification URL for completion notifications

6. **Click "Import"** to start the import.

7. **Monitor progress**: The import button will show progress:
   - Upload progress with byte counts
   - Percentage complete
   - You can cancel the import by clicking the button during upload

8. **Completion**: You'll see a success message when the import completes.

### 5.3 Importing from a URL

To import data from a web URL:

1. **Navigate to the repository import page** (`/account/[account-name]/repositories/[repository-name]/import`).

2. **Select the "Import RDF from the web" tab**.

3. **Enter the URL** of the RDF data you want to import.

4. **Optionally specify a context** (for named graph imports).

5. **Click "Import"** to start the import.

6. **Monitor progress**: Similar to file uploads, you'll see progress indicators.

### 5.4 Import Options

**Content Type Selection**:
- The system auto-detects the content type based on file extension
- You can manually override the content type if needed
- Supported content types:
  - `text/turtle`
  - `application/rdf+xml`
  - `application/n-triples`
  - `application/n-quads`
  - `application/x-trig`
  - `application/ld+json`
  - `text/csv`

**Asynchronous Imports**:
- Enable asynchronous imports for large files
- The import will process in the background
- You can continue working while the import runs
- Optionally provide a notification URL to receive completion notifications

### 5.5 Import Status

After starting an import:
- The import button shows progress with byte counts
- You can cancel the import during upload
- Success or error messages are displayed when complete
- The repository's quad count will update after successful import

---

## 6. SPARQL Views

### 6.1 What are Views?

Views are saved SPARQL queries that can be executed repeatedly. They allow you to:
- Save frequently used queries
- Share queries with collaborators
- Execute queries with different result formats
- Organize queries by repository

### 6.2 Viewing Views

To see the views available in a repository:

1. **Navigate to the repository page**.

2. **Scroll to the "Views" section** in the repository content.

3. The views list displays:
   - View name (clickable link)
   - Account owner
   - Action buttons (edit, open in pane, open in window, delete)

### 6.3 Creating a View

To create a new view:

1. **Navigate to the repository page**.

2. **Click on the "Query" tab** or navigate to the SPARQL query interface.

3. **Write your SPARQL query** in the query editor.

4. **Test the query** by clicking "Run" or pressing Ctrl/Cmd+Enter.

5. **Save the query as a view**:
   - Click "Save As" in the query editor toolbar
   - Enter a name for the view
   - Click "Save"

6. **The view will appear** in the views list on the repository page.

**Note**: When creating a new view using the "New View" button, a confirmation popup will appear indicating that the view has been created. The popup will remind you to edit and save the query text to persist the view. Note that new views are created without query text, so you must enter and save the SPARQL query.

### 6.4 Editing a View

To edit an existing view:

1. **Navigate to the repository page**.

2. **Click on the view name** in the views list. This opens an editor panel in the repository pane. <strong>Note:</strong> The editor will open with the default SPARQL query template. The view's actual query text is NOT automatically loaded. You will need to manually enter or load the query text.

3. **Alternatively**, click the edit icon (pencil) next to the view name.

4. **Enter or modify the SPARQL query** in the editor.

5. **Save your changes**:
   - Click "Save" to update the existing view
   - Click "Save As" to create a new view with a different name

### 6.5 Executing a View

There are three ways to execute a view:

#### Method 1: Open in Current Pane Editor

1. **Click on the view name** in the views list.

2. The view opens in the editor panel within the current repository pane.

3. **Click "Run"** or press Ctrl/Cmd+Enter to execute.

4. **View results** in the results panel below the editor.

#### Method 2: Open in New Pane

1. **Click the pane button** (icon with overlapping squares) next to the view name.

2. A new pane opens with the view editor.

3. **Execute the query** as described in Method 1.

4. **Multiple panes** allow you to work with multiple views simultaneously.

#### Method 3: Open in New Window

1. **Click the window button** (link/external icon) next to the view name.

2. A new browser window opens displaying the view results in a table format.

3. **Select output format** using the format selector (JSON, XML, CSV, etc.).

4. **The new window** is independent and can be moved, resized, or closed separately.

### 6.6 View Execution Features

When executing a view, you have access to:


*Figure 4: View editor interface with query editor and results display*

- **Query Editor**:
  - Syntax highlighting
  - Autocomplete
  - Keyboard shortcuts (Ctrl/Cmd+Enter to execute)
  - Query reset (restore original query text)
  - Collapsible interface

- **Result Formats**:
  - JSON (application/sparql-results+json)
  - XML (application/sparql-results+xml)
  - SVG (image/vnd.dydra.SPARQL-RESULTS+GRAPHVIZ+SVG+XML)
  - HTML (text/html)
  - CSV (text/csv)
  - TSV (text/tab-separated-values)
  - Turtle (text/turtle)
  - N-Triples (application/n-triples)
  - RDF/XML (application/rdf+xml)
  - JSON-LD (application/ld+json)
  - SSE (application/sparql-query+sse)

- **Query Tabs**:
  - Multiple query executions create tabs
  - Each tab shows execution time and result count
  - Switch between tabs to view different results
  - Drag tabs outside the window to open as standalone windows

- **Event Log**:
  - View query execution history
  - See timestamps and execution times
  - Track query activities

### 6.7 Parameterized Queries

Views can include parameters for dynamic input:

1. **Define parameters** in your SPARQL query using placeholders (e.g., `?param`).

2. **When executing**, the editor will display input fields for each parameter.

3. **Enter values** for the parameters.

4. **Execute the query** with the parameter values substituted.

### 6.8 Deleting a View

To delete a view:

1. **Navigate to the repository page**.

2. **Find the view** in the views list.

3. **Click the delete button** (trash icon) next to the view name.

4. **Confirm deletion** in the confirmation dialog.

5. **Warning**: View deletion is permanent and cannot be undone.

### 6.9 Standalone Editor Windows

You can drag query editor tabs outside the application window to open them as standalone windows:

1. **Open a view** in the editor (any of the three methods above).

2. **Execute the query** to create a query tab.

3. **Drag the tab** outside the browser window.

4. **A new window opens** with the editor, preserving:
   - Query text
   - All query tabs and results
   - Authentication state

5. **Work independently** in the new window, which can be moved, resized, or closed separately.

---

## 7. Collaboration Management

### 7.1 Overview

Repository collaboration allows you to grant other accounts access to your repositories with specific permissions (read and/or write).

### 7.2 Accessing Collaboration Settings

To manage collaborators for a repository:

1. **Navigate to the repository page**.

2. **Click the "Collaboration" tab** in the repository management tabs, or navigate to the repository edit page and select the "Collaborators" tab.

3. The collaboration interface displays:
   - List of current collaborators
   - Permissions for each collaborator (read/write)
   - Controls to add, edit, or remove collaborators

### 7.3 Adding a Collaborator

To add a new collaborator:

1. **Navigate to the Collaboration tab** (see Section 7.2).

2. **Click the "New" button** (plus icon) in the collaboration controls.

3. **A new row appears** in the collaborators table.

4. **Enter the collaborator's account name** in the Account field.

5. **Set permissions**:
   - **Read**: Check this box to grant read access (view and query the repository)
   - **Write**: Check this box to grant write access (import data, modify repository)

6. **Click the "Save" button** (upload/checkmark icon) to save your changes.

7. **Confirmation**: The collaborator will be added, and you'll see a success message.

### 7.4 Editing Collaborator Permissions

To modify an existing collaborator's permissions:

1. **Navigate to the Collaboration tab**.

2. **Find the collaborator** in the collaborators table.

3. **Modify the permissions**:
   - Check or uncheck the "Read" checkbox
   - Check or uncheck the "Write" checkbox

4. **The Save button becomes enabled** when changes are detected.

5. **Click "Save"** to apply your changes.

### 7.5 Removing a Collaborator

To remove a collaborator:

1. **Navigate to the Collaboration tab**.

2. **Find the collaborator** in the collaborators table.

3. **Click the delete button** (X icon) in the Actions column for that collaborator.

4. **The row is removed** from the table.

5. **Click "Save"** to apply the removal.

### 7.6 Permission Types

**Read Permission**:
- Allows the collaborator to:
  - View repository metadata
  - Execute SPARQL queries
  - View repository statistics
  - Export repository data
- Does NOT allow:
  - Importing data
  - Modifying repository metadata
  - Deleting the repository

**Write Permission**:
- Includes all read permissions, plus:
  - Importing data
  - Modifying repository metadata
  - Managing collaborators (if they have write access)
- Does NOT allow:
  - Deleting the repository (only the owner can delete)

### 7.7 Collaboration Best Practices

- **Grant minimal permissions**: Only grant the permissions necessary for the collaborator's role
- **Review collaborators regularly**: Periodically review and remove collaborators who no longer need access
- **Use read-only for sharing**: Grant read-only access when you want to share data without allowing modifications
- **Document permissions**: Keep track of why each collaborator has access and what they're working on

---

## 8. Tips and Best Practices

### 8.1 Navigation Tips

- **Location Bar**: The editable location bar at the top shows your current route. You can type a URL directly to navigate.
- **Browser Navigation**: Use browser back/forward buttons to navigate through your history.
- **Tabs**: Open multiple repositories or views in separate tabs to work with multiple resources simultaneously.
- **Keyboard Shortcuts**: 
  - Ctrl/Cmd+Enter: Execute SPARQL query
  - Enter: Submit forms
  - Escape: Cancel dialogs

### 8.2 Query Editor Tips

- **Syntax Highlighting**: The editor provides syntax highlighting for SPARQL queries
- **Autocomplete**: Use autocomplete suggestions while typing
- **Multiple Tabs**: Execute multiple queries and compare results using tabs
- **Result Formats**: Experiment with different result formats to find the best one for your needs
- **Event Log**: Review the event log to track query execution history

### 8.3 Data Management Tips

- **Backup Important Data**: Export important repositories before making major changes
- **Test Imports**: Test imports on a small sample before importing large datasets
- **Use Asynchronous Imports**: For large files, use asynchronous imports to avoid browser timeouts
- **Monitor Progress**: Watch import progress indicators to track upload status
- **Verify Data**: After importing, execute a query to verify the data was imported correctly

### 8.4 Collaboration Tips

- **Start with Read-Only**: When adding new collaborators, start with read-only access and upgrade to write access if needed
- **Document Access**: Keep notes on why each collaborator has access
- **Regular Reviews**: Periodically review collaborator lists and remove unnecessary access
- **Clear Communication**: Communicate with collaborators about repository changes and expectations

### 8.5 Performance Tips

- **Limit Open Tabs**: Having too many tabs open can slow down the application
- **Close Unused Tabs**: Close tabs you're not actively using
- **Use Filters**: Use repository and view filters to find what you need quickly
- **Optimize Queries**: Write efficient SPARQL queries to reduce execution time

### 8.6 Troubleshooting

**Import Issues**:
- Verify file format is supported
- Check file size limits
- Ensure you have write permissions
- Try asynchronous import for large files

**Query Issues**:
- Check SPARQL syntax
- Verify repository contains the expected data
- Review error messages in the event log
- Try simpler queries to isolate issues

**Authentication Issues**:
- Verify username and password/token
- Check host URL is correct
- Clear browser cache and try again
- Contact administrator if problems persist

**Collaboration Issues**:
- Verify collaborator account names are correct
- Check that you have permission to manage collaborators
- Ensure permissions are saved (click Save button)
- Refresh the page if changes don't appear

---

## Appendix A: Supported File Formats

### Import Formats

- **Turtle** (`.ttl`): RDF serialization format
- **RDF/XML** (`.rdf`, `.xml`): XML-based RDF format
- **N-Triples** (`.nt`): Line-based RDF format
- **N-Quads** (`.nq`): N-Triples with graph context
- **TriG** (`.trig`): Turtle with named graphs
- **JSON-LD** (`.jsonld`, `.json`): JSON-based RDF format
- **CSV** (`.csv`): Comma-separated values

### Export Formats

- **Turtle** (`.ttl`)
- **N-Triples** (`.nt`)
- **N-Quads** (`.nq`)
- **RDF/XML** (`.rdf`)
- **JSON-LD** (`.jsonld`)
- **TriG** (`.trig`)
- **CSV** (`.csv`)

### Query Result Formats

- **JSON** (application/sparql-results+json)
- **XML** (application/sparql-results+xml)
- **SVG** (image/vnd.dydra.SPARQL-RESULTS+GRAPHVIZ+SVG+XML)
- **HTML** (text/html)
- **CSV** (text/csv)
- **TSV** (text/tab-separated-values)
- **Turtle** (text/turtle)
- **N-Triples** (application/n-triples)
- **RDF/XML** (application/rdf+xml)
- **JSON-LD** (application/ld+json)
- **SSE** (application/sparql-query+sse)

---

## Appendix B: Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Execute SPARQL Query | Ctrl+Enter (Windows/Linux) or Cmd+Enter (Mac) |
| Submit Form | Enter |
| Cancel Dialog | Escape |
| Close Tab | Click X button on tab |

---

## Appendix C: Glossary

- **Account**: A user account on the Dydra platform
- **Repository**: A container for RDF data
- **View**: A saved SPARQL query
- **Quad**: An RDF statement (subject, predicate, object, graph)
- **SPARQL**: Query language for RDF data
- **Collaborator**: An account with access to a repository
- **Token**: Authentication token for API access
- **Pane**: A tabbed interface element for viewing content
- **Import**: Adding data to a repository
- **Export**: Downloading data from a repository

---

## Revision History

- **2026-02-07**: Initial user manual based on requirements-20260207.md

---

## Support

For additional help or to report issues:
- **Email**: support@dydra.com
- Consult the application documentation
- Contact your system administrator
- Review error messages and logs for troubleshooting information
