import {
  HomePage,
  LoginPage,
  SignupPage,
  ResetPasswordPage,
  ConfirmationsPage,
  UnlocksPage,
  AccountRoute,
  AccountEditPage,
  AccountNewPage,
  AccountAuthTokenPage,
  RepositoriesIndexPage,
  RepositoryRoute,
  RepositoryEditPage,
  RepositoryImportPage,
  SparqlPage,
  ViewRoute,
  StandaloneEditorPage,
  InvitationsNewPage,
  InvitationsSuccessPage,
  InvitationsIndexPage,
  MaintenancePage,
  RpcTestPage,
  RepositoryQueryLogsPage,
  TemplatePage,
  NotFoundPage,
  openLoginPane,
  openInfoPane,
  openAccountPane,
  openRepositoryPane,
  openViewPane,
} from "./pages/index.js";

export const buildRoutes = ({ app }) => [
  { path: "/login", handler: async (ctx) => {
    const paneId = "tab-login";
    const existingPane = document.getElementById(paneId);
    const contentContainer = document.getElementById("content-container");
    if (existingPane) {
      // Pane already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else if (contentContainer) {
      // DOM structure exists but login pane doesn't - create it dynamically
      await openLoginPane(app);
    } else {
      // No DOM structure yet - render full LoginPage
      await app.renderPage(new LoginPage({ ...ctx, state: app.state }));
    }
  }},
  { path: "/info", handler: async (ctx) => {
    const paneId = "tab-info";
    const existingPane = document.getElementById(paneId);
    const contentContainer = document.getElementById("content-container");
    if (existingPane) {
      // Pane already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else if (contentContainer) {
      // DOM structure exists but info pane doesn't - create it dynamically
      await openInfoPane(app);
    } else {
      // No DOM structure yet - render full HomePage (which includes info content)
      await app.renderPage(new HomePage({ ...ctx, state: app.state }));
    }
  }},
  { path: "/", handler: (ctx) => app.renderPage(new HomePage({ ...ctx, state: app.state })) },
  { path: "/signup", handler: (ctx) => app.renderPage(new SignupPage({ ...ctx, state: app.state })) },
  { path: "/reset_password", handler: (ctx) => app.renderPage(new ResetPasswordPage({ ...ctx, state: app.state })) },
  { path: "/confirmations/new", handler: (ctx) => app.renderPage(new ConfirmationsPage({ ...ctx, state: app.state })) },
  { path: "/unlocks/new", handler: (ctx) => app.renderPage(new UnlocksPage({ ...ctx, state: app.state })) },
  { path: "/logout", handler: (ctx) => app.handleLogout(ctx) },
  { path: "/account", handler: (ctx) => app.renderPage(new RepositoriesIndexPage({ ...ctx, state: app.state })) },
  { path: "/account/new", handler: (ctx) => app.renderPage(new AccountNewPage({ ...ctx, state: app.state })) },
  { path: "/account", handler: (ctx) => app.renderMyAccount(ctx) },
  { path: "/invite", handler: (ctx) => app.renderPage(new InvitationsNewPage({ ...ctx, state: app.state })) },
  { path: "/invite/success", handler: (ctx) => app.renderPage(new InvitationsSuccessPage({ ...ctx, state: app.state })) },
  { path: "/invitations", handler: (ctx) => app.renderPage(new InvitationsIndexPage({ ...ctx, state: app.state })) },
  { path: "/repositories", handler: (ctx) => app.renderPage(new RepositoriesIndexPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name", handler: async (ctx) => {
    const accountName = ctx.params.account_name;
    const paneId = `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
    const existingPane = document.getElementById(paneId);
    if (existingPane) {
      // Pane already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else {
      // Pane doesn't exist - open it directly (which will create it)
      await openAccountPane(app, accountName);
    }
  }},
  { path: "/account/:account_name/edit", handler: (ctx) => app.renderPage(new AccountEditPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/auth_token", handler: (ctx) => app.renderPage(new AccountAuthTokenPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories", handler: (ctx) => app.renderPage(new RepositoriesIndexPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/import", handler: (ctx) => app.renderPage(new RepositoryImportPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/query", handler: (ctx) => app.renderPage(new SparqlPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/views/:view_name/execute", handler: (ctx) => app.renderPage(new ViewRoute({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/views/:view_name/meta", handler: (ctx) => app.renderPage(new ViewRoute({ ...ctx, state: app.state })) },
  // IMPORTANT: /views/new must come BEFORE /views/:view_name to prevent "new" from being treated as a view name
  { path: "/account/:account_name/repositories/:repository_name/views/new", handler: async (ctx) => {
    const accountName = ctx.params.account_name;
    const repositoryName = ctx.params.repository_name;
    const paneId = `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
    const existingPane = document.getElementById(paneId);
    
    // Ensure the repository pane is open and active
    if (!existingPane) {
      await openRepositoryPane(app, accountName, repositoryName);
    } else {
      app.activateTab(`#${paneId}`);
    }
    
    // Wait a bit for handlers to be initialized, then trigger the "New" button click
    // This ensures the view creation dialog opens and creates the editor in the repository pane's editor list
    setTimeout(() => {
      const pane = document.getElementById(paneId);
      if (pane) {
        const newBtn = pane.querySelector(".view-new-btn");
        if (newBtn) {
          // Trigger the click event to open the view creation dialog
          // The dialog's submit handler will add the view to the repository list and create the editor in the repository pane
          newBtn.click();
        } else {
          console.warn("[Routes] New view button not found in repository pane");
        }
      }
    }, 150);
  }},
  { path: "/account/:account_name/repositories/:repository_name/edit", handler: (ctx) => app.renderPage(new RepositoryEditPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/query_logs", handler: (ctx) => app.renderPage(new RepositoryQueryLogsPage({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/status", handler: (ctx) => app.renderPage(new RepositoryRoute({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/size", handler: (ctx) => app.renderPage(new RepositoryRoute({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name/meta", handler: (ctx) => app.renderPage(new RepositoryRoute({ ...ctx, state: app.state })) },
  { path: "/account/:account_name/repositories/:repository_name", handler: async (ctx) => {
    const accountName = ctx.params.account_name;
    const repositoryName = ctx.params.repository_name;
    const paneId = `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
    const existingPane = document.getElementById(paneId);
    if (existingPane) {
      // Pane already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else {
      // Pane doesn't exist - open it directly (which will create it)
      await openRepositoryPane(app, accountName, repositoryName);
    }
  }},
  { path: "/standalone-editor", handler: (ctx) => app.renderPage(new StandaloneEditorPage({ ...ctx, state: app.state })) },
  { path: "/_maintenance", handler: (ctx) => app.renderPage(new MaintenancePage({ ...ctx, state: app.state })) },
  { path: "/_rpc_test", handler: (ctx) => app.renderPage(new RpcTestPage({ ...ctx, state: app.state })) },
  { path: "/_template", handler: (ctx) => app.renderPage(new TemplatePage({ ...ctx, state: app.state })) },
  { path: "/404", handler: (ctx) => app.renderPage(new NotFoundPage({ ...ctx, state: app.state })) },
];

