import {
  AdminLoginPage,
  AdminDashboardPage,
  ManageAccountsPage,
  ManageAccountPage,
  ManageRepositoriesPage,
  AdminInvitationsPage,
  AdminInviteNewPage,
  QueryHistoryPage,
  TransactionHistoryPage,
} from "./pages.js";

export const buildAdminRoutes = ({ app }) => [
  { path: "/login", handler: (ctx) => {
    app.renderPage(new AdminLoginPage({ ...ctx, state: app.state }));
  }},
  { path: "/", handler: (ctx) => {
    if (!app.state.session?.isLoggedIn()) {
      app.router.navigate("/login", { replace: true });
      return;
    }
    app.renderPage(new AdminDashboardPage({ ...ctx, state: app.state }));
  }},
  { path: "/manage/accounts", handler: (ctx) => app.renderPage(new ManageAccountsPage({ ...ctx, state: app.state })) },
  { path: "/manage/accounts/:account_name", handler: (ctx) => app.renderPage(new ManageAccountPage({ ...ctx, state: app.state })) },
  { path: "/manage/repositories", handler: (ctx) => app.renderPage(new ManageRepositoriesPage({ ...ctx, state: app.state })) },
  { path: "/invitations", handler: (ctx) => app.renderPage(new AdminInvitationsPage({ ...ctx, state: app.state })) },
  { path: "/invite", handler: (ctx) => app.renderPage(new AdminInviteNewPage({ ...ctx, state: app.state })) },
  { path: "/history/queries", handler: (ctx) => app.renderPage(new QueryHistoryPage({ ...ctx, state: app.state })) },
  { path: "/history/transactions", handler: (ctx) => app.renderPage(new TransactionHistoryPage({ ...ctx, state: app.state })) },
  { path: "/logout", handler: () => app.handleLogout() },
];
