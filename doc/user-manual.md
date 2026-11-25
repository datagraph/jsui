# Dydra Studio User Manual

## Version 2026-11-21

This manual covers what you can do in Dydra Studio. Dydra Studio is a single-page web application. From it you manage RDF data repositories, execute SPARQL queries, and administer your account on the Dydra platform.

Sections 1–7 describe the baseline interface, as of 2026-02-07. Sections 8, 9
and 10 cover what has come since: ask a language model about your data, compose
a whole page from several queries, and arrange the interface itself by asking
for it.

---

## Table of Contents

1. [Start Here](#1-start-here)
2. [Sign In](#2-sign-in)
3. [Manage Your Account](#3-manage-your-account)
4. [Manage Repositories](#4-manage-repositories)
5. [Import Data](#5-import-data)
6. [SPARQL Views](#6-sparql-views)
7. [Work With Collaborators](#7-work-with-collaborators)
8. [Ask a Model About Your Data](#8-ask-a-model-about-your-data)
9. [Compose a Page](#9-compose-a-page)
10. [Arrange the Interface](#10-arrange-the-interface)
11. [Tips and Best Practices](#11-tips-and-best-practices)

---

## 1. Start Here

### 1.1 Open the Application

Dydra Studio runs in your web browser. Go to the login page at:

**https://dydra.com/ui/user**

*Note: For visual references and screenshots, see the HTML version of this manual in the `doc/user-manual/` directory.*

### 1.2 Browser Requirements

The application needs a modern web browser with:
- JavaScript enabled
- ES6+ JavaScript support
- History API support (or hash-based routing fallback)

Chrome, Firefox, Safari and Edge all qualify, in their current versions.

### 1.3 The Two Interfaces

Dydra Studio offers two interfaces:
- **User App**: manage your account, work with repositories, run SPARQL queries, and import or export data
- **Console**: administer the system as a whole. Its own manual covers it.

This manual covers the **User App**.

---

## 2. Sign In

### 2.1 Sign In to Your Account

Sign in before you reach your account and your repositories:

1. **Navigate to the login page** by clicking "Login" in the navigation menu, or by visiting **https://dydra.com/ui/user** (or the `/login` route).

2. **Enter your credentials**:
   - **Host**: the Dydra service host — `dydra.com`, say. Leave it blank and the application uses the default.
   - **Username**: Your account name
   - **Password or Token**: Your account password or authentication token

3. **Click "Sign in"** or press Enter.

4. **Wait.** The application checks your credentials against the Dydra service API, and shows "Authenticating..." while it does.

5. **Arrive.** It then opens your account page and reports "Authenticated as [account-name]".

### 2.2 Two Ways to Prove Who You Are

Dydra Studio accepts two:

- **Password**: give your account password
- **Bearer token**: give an authentication token instead, which suits API access

Type either into the same "Password or Token" field.

### 2.3 Work With Several Accounts

Hold several accounts open at once, and:
- Switch between them with the account selector
- Open repositories from different accounts in separate tabs
- Keep a separate session for each

### 2.4 Hold a Session

- **What the browser remembers**: the application keeps only account names across a page reload, in browser storage. Every other piece of session data, tokens included, lives in JavaScript objects for the life of one page, and goes when you close it.
- **Sign out**: click "Logout" in the navigation menu. That ends your session and clears your credentials from memory. Browser storage may still hold the account names, for convenience; sign in again to reach the account.
- **Sign in again**: when your session lapses, or you close the page, sign in again. No token survives a page session.

### 2.5 When Sign-In Fails

If you cannot sign in, check that:
- Your username and password, or your token, are right
- The host URL is right
- Your account exists and is active
- Your network reaches the service
- The login form says something more — read it

---

## 3. Manage Your Account

### 3.1 Read Your Account

When you sign in, the application opens your account page. It shows:


*Figure 2: Account page layout showing repositories list*
- Account name (friendly ID)
- Email address
- Full name
- Homepage URL
- Blog URL
- Company/Organization
- Location
- Other profile information

### 3.2 Edit Your Account Metadata

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

4. **Make your changes.** The application tracks only the fields you touch, and sends those alone.

5. **Click "Save"**.

6. **Confirm.** The application reports success when the changes reach the server.

### 3.3 Find Your Authentication Token

To read or reset your authentication token:

1. Go to `/account/[your-account-name]/auth_token`.

2. Click the button to read or reset it.

3. **Important**: guard your token. Whoever holds it holds your account.

### 3.4 Create an Account

To create an account:

1. Go to the signup page (`/signup`), or click "Signup" in the navigation menu.

2. Fill in what it asks for.

3. **Note**: where your Dydra instance requires invitations, signup also asks for an invite code.

---

## 4. Manage Repositories

### 4.1 List Your Repositories

To see your repositories:

1. **Go to your account page** (`/account/[account-name]`).

2. The repositories list shows:
   - Repository name
   - Summary/description
   - Quad count (number of RDF statements)
   - Disk size
   - License information
   - Import status

3. **Click a repository name** to open it.

### 4.2 Create a Repository

To create a repository:

1. **Go to your account page**, or to the repositories list.

2. **Click "New Repository"** — the "+" icon, or the word "New".

3. **Fill in the dialog**:
   - **Name**: give it a name no other repository in the account holds (required)
   - **Type**: choose one:
     - `lmdb`: Standard LMDB repository
     - `lmdb-revisioned`: Revisioned LMDB repository (supports version history)

4. **Click "Create"** or press Enter.

5. **Arrive.** The repository joins your repositories list, and the application opens its page.

### 4.3 Read a Repository's Details

The repository page shows:


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

### 4.4 Edit Repository Metadata

To edit a repository's information:

1. **Go to the repository page** (`/account/[account-name]/repositories/[repository-name]`).

2. **Click "Edit"**, or go to `/account/[account-name]/repositories/[repository-name]/edit`.

3. **Edit the fields you want** in the repository settings tabs:
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

4. **Make your changes.** The application sends only the fields you touched.

5. **Click "Update"**.

6. **Confirm.** The application reports success when the changes reach the server.

### 4.5 Delete a Repository

To delete a repository:

1. **Go to the repository list** on your account page.

2. **Click the delete button** — the trash icon — beside the repository name.

3. **Confirm** in the dialog.

4. **Warning**: a delete is permanent. It removes everything in the repository, and nothing brings it back.

### 4.6 Clear a Repository

To remove every triple from a repository and keep the repository itself:

1. **Go to the repository page**.

2. **Click "Clear"**.

3. **Confirm** in the dialog.

4. **Warning**: a clear is permanent. It deletes every RDF statement in the repository, and nothing brings them back.

---

## 5. Import Data

### 5.1 Two Ways to Import

Import data into a repository either way:

1. **File upload**: send a file from your computer
2. **URL import**: name a web URL and let the service fetch it

### 5.2 Import From a Local File

To import data from a local file:

1. **Go to the repository** you want to import into.

2. **Click "Import"**.

3. **Choose a file** from your computer in the file picker.

4. **Formats you can import**:
   - Turtle (`.ttl`)
   - RDF/XML (`.rdf`, `.xml`)
   - N-Triples (`.nt`)
   - N-Quads (`.nq`)
   - TriG (`.trig`)
   - JSON-LD (`.jsonld`, `.json`)
   - CSV (`.csv`)

5. **Set the options** in the popup that opens:
   - **Content type**: the media type of your file. The dialog reads it from the extension; override it if it guessed wrong.
   - **Import in the background**: tick this and the import runs behind you, so you carry on working. Name a notification URL and the service tells it when the import finishes.

6. **Click "Import"**.

7. **Watch the progress.** The import button reports:
   - how many bytes have gone up
   - how far through it is
   - Click it during the upload to cancel.

8. **Finish.** The application reports success when the import completes.

### 5.3 Import From a URL

To import data from a web URL:

1. **Go to the repository's import page** (`/account/[account-name]/repositories/[repository-name]/import`).

2. **Choose the "Import RDF from the web" tab**.

3. **Type the URL** of the RDF data you want.

4. **Name a context**, if the data belongs in a named graph.

5. **Click "Import"**.

6. **Watch the progress**, as for a file upload.

### 5.4 Import Options

**Content type**:
- The dialog reads the content type from the file extension
- Override it yourself when it guesses wrong
- Choose from:
  - `text/turtle`
  - `application/rdf+xml`
  - `application/n-triples`
  - `application/n-quads`
  - `application/x-trig`
  - `application/ld+json`
  - `text/csv`

**Background imports**:
- Import a large file in the background
- It runs behind you, so you carry on working
- Name a notification URL and the service tells it when the import finishes

### 5.5 Import Status

Once an import starts:
- The import button counts the bytes as they go up
- Click it during the upload to cancel
- The application reports success, or the error, when it ends
- The repository's quad count rises once the import succeeds

---

## 6. SPARQL Views

### 6.1 What a View Is

A view is a saved SPARQL query. Run it as often as you like. Views let you:
- Keep a query you run often
- Share a query with collaborators
- Run one query and take the answer in any of several formats
- Group your queries by repository

### 6.2 List the Views in a Repository

To see a repository's views:

1. **Go to the repository page**.

2. **Scroll to the "Views" section**.

3. The views list shows:
   - View name (clickable link)
   - Account owner
   - Action buttons (edit, open in pane, open in window, delete)

### 6.3 Create a View

To create a new view:

1. **Navigate to the repository page**.

2. **Click on the "Query" tab** or navigate to the SPARQL query interface.

3. **Write your SPARQL query** in the query editor.

4. **Test the query** by clicking "Run" or pressing Ctrl/Cmd+Enter.

5. **Save the query as a view**:
   - Click "Save As" in the query editor toolbar
   - Enter a name for the view
   - Click "Save"

6. **The view joins** the views list on the repository page.

**Note**: the "New View" button opens a popup that confirms the view exists and reminds you to write the query text and save it. A view created this way holds no query text, so type the SPARQL in and save it.

### 6.4 Edit a View

To edit a view:

1. **Go to the repository page**.

2. **Click the view name** in the views list. An editor panel opens in the repository pane. <strong>Note:</strong> it opens on the default SPARQL template. It does <em>not</em> load the view's own query text; type or paste that yourself.

3. **Or** click the edit icon — the pencil — beside the view name.

4. **Write or change the SPARQL** in the editor.

5. **Save**:
   - Click "Save" to update the view
   - Click "Save As" to make a second view under another name

### 6.5 Execute a View

Three routes run a view:

#### Method 1: Open in Current Pane Editor

1. **Click the view name** in the views list.

2. The view opens in the editor panel within the current repository pane.

3. **Click "Run"**, or press Ctrl/Cmd+Enter.

4. **Read the results** in the panel below the editor.

#### Method 2: Open in New Pane

1. **Click the pane button** — the overlapping squares — beside the view name.

2. A pane opens with the view editor in it.

3. **Run the query** as in Method 1.

4. **Open several panes** and work on several views at once.

#### Method 3: Open in New Window

1. **Click the window button** — the external-link icon — beside the view name.

2. A browser window opens and shows the results as a table.

3. **Choose an output format** in the format selector — JSON, XML, CSV, and the rest.

4. **That window stands alone.** Move it, resize it, or close it on its own.

### 6.6 What the Editor Offers When You Run a View


*Figure 4: View editor interface with query editor and results display*

- **The query editor**:
  - highlights syntax
  - completes as you type
  - takes keyboard shortcuts (Ctrl/Cmd+Enter runs the query)
  - resets the query text to the last saved version
  - folds away when you want the room

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

- **Query tabs**:
  - Each run opens its own tab
  - A tab reports how long the run took and how many rows came back
  - Switch between tabs to compare answers
  - Drag a tab out of the window and it becomes a window of its own

- **The event log**:
  - keeps every run you made
  - stamps each with the time, and how long it took
  - so you can follow what you did

### 6.7 Parameterised Queries

A view may take parameters:

1. **Write placeholders** into your SPARQL — `?param`, say.

2. **Run it**, and the editor offers an input field for each one.

3. **Fill them in**.

4. **Run the query** with your values in place.

### 6.8 Delete a View

To delete a view:

1. **Go to the repository page**.

2. **Find the view** in the views list.

3. **Click the delete button** — the trash icon — beside the view name.

4. **Confirm** in the dialog.

5. **Warning**: a delete is permanent, and nothing brings the view back.

### 6.9 Editor Windows of Their Own

Drag a query editor tab out of the application window and it becomes a window of its own:

1. **Open a view** in the editor, by any of the three routes above.

2. **Run the query**, which opens a query tab.

3. **Drag that tab** outside the browser window.

4. **A window opens** with the editor in it, carrying:
   - the query text
   - every query tab and its results
   - your credentials

5. **Work on in it.** Move it, resize it, or close it on its own.

---

## 7. Work With Collaborators

### 7.1 Overview

Grant another account access to your repository — read, write, or both — and work on it together.

### 7.2 Open the Collaboration Settings

To manage a repository's collaborators:

1. **Go to the repository page**.

2. **Click the "Collaboration" tab**, or open the repository edit page and choose the "Collaborators" tab.

3. The collaboration interface shows:
   - List of current collaborators
   - Permissions for each collaborator (read/write)
   - Controls to add, edit, or remove collaborators

### 7.3 Add a Collaborator

To add a new collaborator:

1. **Go to the Collaboration tab** (see Section 7.2).

2. **Click "New"** — the plus icon — in the collaboration controls.

3. **A row appears** in the collaborators table.

4. **Type the collaborator's account name** into the Account field.

5. **Set the permissions**:
   - **Read**: tick this to let them read and query the repository
   - **Write**: tick this to let them import data and change the repository

6. **Click "Save"** — the checkmark icon.

7. **Confirm.** The collaborator joins the list, and the application reports success.

### 7.4 Change a Collaborator's Permissions

To change what a collaborator may do:

1. **Go to the Collaboration tab**.

2. **Find the collaborator** in the table.

3. **Change the permissions**:
   - tick or clear "Read"
   - tick or clear "Write"

4. **The Save button wakes** as soon as something differs.

5. **Click "Save"**.

### 7.5 Remove a Collaborator

To remove a collaborator:

1. **Go to the Collaboration tab**.

2. **Find the collaborator** in the table.

3. **Click the delete button** — the X — in that row's Actions column.

4. **The row goes** from the table.

5. **Click "Save"** to make the removal stick.

### 7.6 The Two Permissions

**Read** lets the collaborator:
- read the repository's metadata
- execute SPARQL queries
- read its statistics
- export its data

Read does **not** let them import data, change the metadata, or delete the
repository.

**Write** covers everything read covers, and also lets them:
- import data
- change the repository's metadata
- manage its collaborators

Write does **not** let them delete the repository. Only its owner may do that.

### 7.7 How to Share Well

- **Grant the least that works.** Give only what the collaborator's role needs.
- **Review the list.** Go through it from time to time and remove anyone who no longer needs access.
- **Share read-only.** Grant read when you want someone to see the data but not change it.
- **Write down why.** Record what each collaborator is working on and why they hold access.

---

## 8. Ask a Model About Your Data

Dydra Studio can put a language model in front of your repositories. The model
never reaches the store directly and never runs anything: it reads through the
repository's MCP endpoint, it proposes, and **the interface runs what you
approve, under your own credentials**. Everything in this section follows from
that one rule.

### 8.1 The Three Controls, and What Each One Does

Under the prompt box sit three buttons. They are not three sizes of the same
thing: they differ in what comes back, and in what you authorise to produce it.

| Control | What it does | What you get back | What it takes |
|---|---|---|---|
| **Ask** | A **question** | Prose, usually ending in a SPARQL query | The read-only tool set, for one turn |
| **Compose** | A **page** | A live document: panels, charts, prose, provenance marks, revisions | A grant with a budget, taken once before anything is sent |
| **Past runs** | **What already happened** | The record of past runs — nothing new | Nothing: it asks no model and runs no query |

In one line each:

- **Ask answers a question.** The model explores the stores you chose and
  writes an answer. Any query it ends with has *not* run; running it, drawing
  a figure from it, or keeping it as a view are each your own separate act.
- **Compose builds a page.** See [section 9](#9-compose-a-page).
- **Past runs shows what has already happened.** It opens the record of past
  explorations, what the interface showed the model in each, and the endpoint's
  own journal of what it served.

Both panes print that same line under the buttons, so you need not remember it.
Hovering any of the three gives you the longer sentence.

Two further controls are modes rather than actions:

- **Figure** changes what you *ask the model for*, not how anything is drawn.
  Tick it and the run tells the model that proposing a query is step 2 and
  drawing is step 3, and offers it `query` beside `survey`. The run reads the
  tick once, as it begins — tick it mid-run and nothing changes. **Draw it…**
  draws from any query in the transcript, ticked or not.
- **Stop** raises a flag the run reads between rounds. A call already in
  flight comes back and is recorded, because the store has already done the
  work. A stopped run reports itself as stopped and hands you the prose it had.

### 8.2 Connect a Model

The connection is a setting of **your account**, not of a repository:

1. Open your account page and choose the **Connection** tab, beside Profile,
   Configuration and Collaborations.
2. Choose the provider and the model, and enter the credential.

The page holds the credential in memory for its own life. It writes it to no
repository and to no browser storage, exactly as it treats your Dydra token.
Close the tab and it goes.

Every surface that asks a model anything — the exploration panes, the location
bar, a compose pane, the figure gate — draws on that one connection. None asks
you for the credential twice, and where you have set none they all refuse in
the same words and name the one place to set it.

A repository's **MCP endpoint**, its token and the exploration it holds open are
a different matter, and stay with the repository. A repository's exploration
pane says which connection it draws on; it does not own it.

### 8.3 Two Panes: One Repository, or Several

- **A repository's exploration pane** opens from the repository page. It
  explores that one repository.
- **The account's exploration pane** opens from the tab marked with the triple
  in the account's left margin. It carries the model connection and a choice of
  stores. Both panes ask with the same button, **Ask**; the chip beside it says
  what the press would reach — *no store chosen*, the store's name, or *across
  3 stores*, whose tooltip names them.

The permitted set — the repositories you may choose from — holds your own
repositories and the ones you collaborate on. The session reads it as it begins,
and refuses a repository outside it by name, before anything runs.

### 8.4 Ask From the Location Bar

The location bar is the one thing always on the screen, and it takes a question
about data as readily as an instruction about the interface. It works out which
you meant without asking you, and without spending a turn to find out:

- A path, or a line beginning `goto`, **navigates**.
- A line naming a repository — `compare classes in alice/sales and alice/costs`
  — is a **question about data**, and the reply names the stores it would read.
- Anything else is an **instruction about the interface**
  ([section 10](#10-arrange-the-interface)).

Nothing runs until you press the button in the reply. That button performs the
same operation as the account pane's **Ask**.

### 8.5 What You Learn Before Anything Runs

The interface discloses a run before it starts, in the terms the authority
itself holds rather than a summary of them. It tells you:

- which repositories the turn may reach, each with the account it belongs to;
- how many rounds of tool calls it may take and how many calls in all;
- that it **reads and never writes**, for this run;
- that it reads a large result as its shape first, and fetches the whole
  document on request;
- where it will write the record, and that you may stop the run while it goes.

Where a store offers no tools, the interface names it, and says why it offered
none, before you read an answer that quietly leaves it out.

### 8.6 Watch a Run, and Read the Exchange

While a run goes, the status line names the store it is asking, says what it is
asking for, and says how far into its rounds it has come — and it counts the
seconds of a request still in flight, so a long turn does not look like a
stopped one.

Below it, the **transcript** shows every exchange whole rather than summarised:
what the interface sent the model, what the model answered, the arguments of
each call it made, and the payload that came back. The same transcript appears
in both panes and in a compose pane.

### 8.7 What You Can Do With an Answer

- **Draw it…** on a query in the transcript renders a figure. The interface
  runs the query — never the model.
- **Add as a view** keeps the query in the repository's catalogue as an
  ordinary saved view.
- **Keep the report** renders the answer as a standalone HTML page carrying its
  own styles, no script and nothing to fetch, with the provenance line, the
  stores it read and the links to its record. One control opens it in its own
  window; the other saves it under a dated file name. Both panes offer it.
- **Past runs** then finds it again later.

Where you chose several stores, each query belongs to the store that produced
it. Where the interface cannot settle which — the prose names two stores, or
none — **Draw it…** and **Add as a view** refuse, and say what would make them
work, rather than run one repository's query against another.

### 8.8 What the Run Records

A run can write itself as RDF into your account's `mcp` repository: the prompt,
the documents the model read, each turn of its prose, and the payload of every
call. Where a run reached several stores it writes one record per store, so you
can attribute a cross-repository answer store by store. If it cannot write the
record it tells you, and keeps the answer.

---

## 9. Compose a Page

**Compose** is not a longer Ask. It takes a different shape of consent, for a
practical reason: a page is a set of queries you authorise *together*, and no
useful moment arrives at which to confirm the eighth of twelve. So you grant the
authority once, up front, against a stated budget, and watch a meter spend it.

Press **Compose** in either exploration pane. It opens its own pane beside the
one you were in, seeded with whatever you had typed.

### 9.1 The Four Stages

**Gate 0 — the grant.** Before the interface sends anything, you set — and see —
what the run may do: which repositories it may read, how many calls, how many
rows, how many bytes, and whether it may write. The meter beside the grant
counts the spending as it happens, and you may revoke the grant while the run
goes.

**Phase 1 — the exchange.** The model explores, through the same MCP endpoints
as an Ask, and proposes a page. The transcript shows every exchange; the run log
beside it keeps the terse record you read the grant, the meter and the budget
against.

**Gate 1 — the proposal.** You review the whole page as one unit: every panel's
query, every transform's source, every passage the model wrote. The gate lists
the errors and the warnings. If you asked for a chart and the page draws none,
it says so here — as a notice, never a refusal, since some results genuinely
cannot carry a chart.

**Phase 2 — the interface's own runs.** You approve, and **the interface** runs
the panels under your credentials. The page binds to what came back. It never
shows you rows the model reported.

**Gate 2 — the disposition.** Keep it, save it, refresh it, or discard it.

### 9.2 What a Page Holds

Every region of the page declares which of three kinds it is, and the page says
so where you can see it:

- **bound** — the interface ran that panel's query and filled the slot. Live: it
  refreshes.
- **derived** — a value the model computed, written as a function the page can
  re-run. Still live, because the function runs again when the data does.
- **asserted** — prose, judgement, a chart the model drew by hand. Nothing
  re-derives it, and the page marks it as the model's own work.

### 9.3 Where a Provenance Mark Comes From

Each region carries a mark, and **the interface writes it, not the model**. The
interface keeps its own ledger of everything it put in front of the model — the
prompt, the documentation it read, and every result with its repository, its
query, its shape and its digest — and adds to that ledger through the compose
and every revision after it. A region the model wrote takes its attribution from
that ledger: *written by the model from alice/sales, alice/costs*, listing the
sources in the order the run read them. Hover the mark to see them.

The mark keeps three statements apart, because they mean different things: the
run read data; the run read nothing from any store; and no record exists for
this page. A page carries its ledger into a downloaded copy and into its record,
so a page you reopen from the archive carries the same evidence a fresh one
does.

Beside that, the page carries the **Article 50** line: which model produced it,
when, and which repositories it read.

### 9.4 Revise a Page

The **Revise** box under the page is the location bar's instruction channel,
with its target already set to the page it sits in — the same mechanism, so the
same reply. Type what you want changed. Back comes a **patch**, not a new page:
your scroll position, the tab you had open and your selection all survive, and
the page numbers the revision and keeps it.

A change that needs new authority opens a gate. A presentational one does not.

### 9.5 A Page Stays Live

- **Refresh** re-runs the panels under your credentials.
- A control on the page may change a **parameter** — what a query asks *for* —
  and the page re-runs only the panels that depend on it, charging them against
  its own interaction budget. A page never rewrites its own query.
- Where results have moved under a passage, the page **marks it stale** in
  place rather than quietly running it again.

A copy you download stays live as well. It opens with the data it was saved
with and draws that without reaching anything, and its own **Refresh** runs the
same queries again: give it the address and a token of yours and the panels
refill, the computed values recompute, and any passage the numbers have moved
under is marked. Nothing of yours travels in the file — you type the token into
the tab, and it goes when you close it. A copy opened straight off the disk may
not be able to reach the service at all; most browsers refuse that. Serve the
file, or open the page again in Dydra.

### 9.6 What a Page Cannot Do

The page runs in a sandbox with no origin and no network. It fetches nothing,
reaches no credential of yours, reads no storage, and speaks to the rest of the
interface only through the one channel the interface opens for it. That is what
makes it safe to run a page a model wrote.

---

## 10. Arrange the Interface

The interface is not a program that draws from a graph. **The interface is the
graph.** Each presentation — a page you composed, and the surrounding chrome
itself — is a revisioned RDF element tree in your account's `ui` repository, and
what you see is an instance of it. So you rearrange the interface by asking for
it, and every arrangement keeps its history.

The [Arrangement](arrangement-manual/index.html) manual covers this at length,
with screenshots.

### 10.1 The Location Bar Is the Instruction Channel

There is one channel and not several. The bar addresses something — a page, the
workspace, an element in either — and a line that is not a path and not `goto`
is an instruction **against what it is addressing**. The bar says what that is
before you press, says back in one line what it did, and offers an **undo**
beside the reply. Undo is a revert to the previous revision, not a guess at the
inverse.

### 10.2 The Four Verbs That Need No Model

The interface settles four instructions itself, without asking a model, because
they are unambiguous:

- **lift** — take a named element subtree out of a presentation and keep it as a
  reusable **arrangement**: the names become placeholders, and it drops its
  position, so you can put it down anywhere.
- **apply** — put an arrangement into the addressed presentation. It mints fresh
  names and assigns a position between the neighbours you chose, in one change.
- **mount** — include a presentation by reference. Your edits write back as a
  revision of the source. You mount a presentation once; ask for it again and
  the interface takes you to where it already is.
- **unmount** — take it out again.

Anything else you type goes to the model as an instruction, carrying the
**outline** of what you address as its context — not the markup, which is the
largest thing on the screen and the least informative.

### 10.3 Name an Element

An arrangement verb names an element, and the interface shows you that name
rather than guess at it. While you type in the bar — and at no other moment — it
outlines every element the verb could take; the one under the pointer shows its
name and its kind in its own border; the bar says what the verb would do with
it; and a click types that name at the caret. It marks only the target the bar
addresses.

### 10.4 Apply an Arrangement That Carries Requests

An arrangement carries **request definitions and no results**. Apply it and the
interface repeats its requests against the sources they name, **under your
credentials** — so you get your data, not a copy of its author's. The whole
apply costs one charge against the re-run budget.

Where a request names a parameter the destination has not got, or a source
refuses you, the apply fails visibly and names the request and the reason. It
does not half-apply.

### 10.5 The Catalog

The catalog lists what your account holds — presentations, arrangements and the
component toolbox — where it lists your repositories and views. Each entry says
what you may do with it: its scope, where it is mounted, whose it is. No entry
carries executable text, because you read a catalog *before* you admit
anything.

### 10.6 Something From Another Account

The interface treats a presentation or arrangement from another account as
untrusted text. Four things in it execute, and it withholds all four until you
admit them: the page's script, its inline styles, its transform bodies, and the
request text an arrangement carries. Until you do, it shows the page with a
visible mark saying what it holds back.

It records the admission against the digest of exactly what you admitted, so
admitting one version does not admit the next. Before you first apply an
arrangement from another account, it shows you the request text **and the
distinct sources those requests name** — because what such a request discloses
is *you*, to an address its author chose.

A presentation you mount from another account stays read-only until you
**rename** it, which copies it into your account and makes it yours.

### 10.7 Workspaces

The chrome itself is a presentation — a set of host bands — so you arrange it
like anything else. A workspace mounts inside neither a workspace nor a
document; a document mounts in either. Arrange the interface into a state you
cannot read, and `?workspace=default` restores it.

---

## 11. Tips and Best Practices

### 11.1 Move Around Quickly

- **Location bar**: the editable location bar shows your current route. Type a path and it navigates; a line that is not a path instructs whatever the bar addresses.
- **Browser navigation**: the back and forward buttons walk your history.
- **Tabs**: open repositories and views in separate tabs, and work on several at once.
- **Keyboard shortcuts**:
  - Ctrl/Cmd+Enter: execute the SPARQL query
  - Enter: submit the form
  - Escape: cancel the dialog

### 11.2 Get More From the Query Editor

- **Read the highlighting.** The editor colours SPARQL as you type it.
- **Take the completions.** They save keystrokes and spelling.
- **Open several tabs.** Run several queries and compare their answers side by side.
- **Try other formats.** One of them will suit what you are doing better than the default.
- **Read the event log.** It holds every run you made.

### 11.3 Look After Your Data

- **Export before a large change.** Keep a copy of a repository that matters.
- **Try a sample first.** Import a small part of a large dataset before you import all of it.
- **Import large files in the background.** That avoids a browser timeout.
- **Watch the progress.** The indicators tell you how far an upload has come.
- **Query afterwards.** Run something simple to confirm that the data arrived.

### 11.4 Work With Others

- **Start read-only.** Grant read first, and raise it to write when the work calls for it.
- **Record why.** Keep a note of what each collaborator holds access for.
- **Review the list.** Go through it from time to time and remove access nobody needs.
- **Say what changed.** Tell collaborators about changes to the repository and what you expect of them.

### 11.5 Keep It Fast

- **Open fewer tabs.** Too many slow the application down.
- **Close what you finished with.**
- **Filter.** The repository and view filters find things faster than scrolling.
- **Write tight queries.** An efficient SPARQL query returns sooner.

### 11.6 When Something Goes Wrong

**An import gives trouble.** Check that:
- Dydra reads the file's format
- The file is within the size limit
- You hold write permission
- A background import succeeds where a direct one did not

**A query fails.** Check that:
- The SPARQL parses
- The repository holds the data you expect
- The event log says something more — read it
- A simpler query works, which narrows the fault

**Sign-in fails.** Check that:
- Your username and password, or your token, are right
- The host URL is right
- A cleared browser cache helps
- Your administrator knows, if it keeps happening

**Collaboration does not work.** Check that:
- You spelled each collaborator's account name correctly
- You may manage collaborators on this repository
- You clicked **Save** after setting the permissions
- A reload shows the change

---

## Appendix A: File Formats

### Formats You Can Import

- **Turtle** (`.ttl`): RDF serialization format
- **RDF/XML** (`.rdf`, `.xml`): XML-based RDF format
- **N-Triples** (`.nt`): Line-based RDF format
- **N-Quads** (`.nq`): N-Triples with graph context
- **TriG** (`.trig`): Turtle with named graphs
- **JSON-LD** (`.jsonld`, `.json`): JSON-based RDF format
- **CSV** (`.csv`): Comma-separated values

### Formats You Can Export

- **Turtle** (`.ttl`)
- **N-Triples** (`.nt`)
- **N-Quads** (`.nq`)
- **RDF/XML** (`.rdf`)
- **JSON-LD** (`.jsonld`)
- **TriG** (`.trig`)
- **CSV** (`.csv`)

### Formats a Query Can Answer In

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
- **SPARQL**: The query language for RDF data
- **Collaborator**: An account that holds access to a repository
- **Token**: A token that proves who you are to the API
- **Pane**: A tabbed element of the interface that shows content
- **Import**: To add data to a repository
- **Export**: To take data out of a repository
- **Exploration**: A conversation with a model about one or more repositories, kept in your account's `mcp` repository and findable again through **Past runs**
- **MCP**: The Model Context Protocol endpoint through which a model reads a repository. No other route reaches your data, and it reads and never writes unless you grant otherwise
- **Grant**: The authority you give a compose run before it sends anything — which repositories, how many calls, how many rows and bytes. A visible meter spends it, and you may revoke it while the run goes
- **Page** (composed): An application document the interface builds and runs: panels it fetched, values it recomputes, and passages the model wrote, each marked for which it is
- **Bound / derived / asserted**: The three kinds of region on a composed page — fetched by the interface, computed from what it fetched, and written by the model
- **Provenance mark**: The line under a region saying where it came from. The interface writes it, from its own record of what it showed the model
- **Presentation**: An element tree in your account's `ui` repository — a page, or the interface's own chrome — revisioned like any other data
- **Arrangement**: A piece of a presentation lifted out to be applied elsewhere. It carries requests, never results
- **Workspace**: The presentation that is the interface's own chrome

---

## Revision History

- **2026-11-21** (second revision): Rewrote the manual in the active voice — imperative headings, active verbs in place of passives and stacked gerunds — and set both this manual and the admin manual in the Tschichold manner used across the Dydra documentation collection.
- **2026-11-21**: Added section 8 (ask a model about your data — the exploration panes, and what **Ask**, **Compose** and **Past runs** each do), section 9 (compose a page — the gates, the three kinds of region, provenance, revision) and section 10 (arrange the interface — the location bar as the instruction channel, the four verbs, arrangements, the catalog, and text that arrives from another account). Tips renumbered 8 → 11; glossary extended. The controls were renamed the same day: one verb, **Ask**, in all three places it is reached from, with the scope beside it instead of inside the label; **Past runs** for the record browser, which had been called **Session** — the word also names the live exploration handle the interface carries between runs; and a visible one-line legend under the buttons in both panes. **Run** now means one thing only: execute this SPARQL query.
- **2026-02-07**: Initial user manual based on requirements-20260207.md

---

## Support

For help, or to report a fault:
- **Email** support@dydra.com
- Read the application documentation
- Ask your system administrator
- Read the error messages and the logs — they usually name the problem
