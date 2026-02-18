import { Router } from "./router.js";
import { AppState } from "./lib/app_state.js";
import { APP_CONFIG } from "./lib/config.js";
import { AdminApp } from "./ui/admin/app.js";
import { buildAdminRoutes } from "./ui/admin/routes.js";

const state = new AppState();
const app = new AdminApp({ state });
window.appState = state;
window.appInstance = app;

const basePath = APP_CONFIG.basePath.replace(/\/?$/, "/admin");

const router = new Router(
  buildAdminRoutes({ app }),
  (ctx) => app.renderNotFound({ ...ctx, state }),
  {
    basePath,
    updateLocation: false,
    onRouteChange: (path) => {
      app.updateLocationBar(path);
    },
  }
);

app.setRouter(router);
router.start();
