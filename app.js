import { Router } from "./router.js";
import { AppState } from "./lib/app_state.js";
import { APP_CONFIG } from "./lib/config.js";
import { App } from "./ui/app.js";
import { buildRoutes } from "./ui/routes.js";

console.log("[App] Initializing application");
const state = new AppState();
const app = new App({ state });
window.appState = state;
window.appInstance = app;
console.log("[App] Creating router");
const router = new Router(
  buildRoutes({ app }),
  (ctx) => app.renderNotFound({ ...ctx, state }),
  {
    basePath: APP_CONFIG.basePath,
    updateLocation: false,
    onRouteChange: (path) => {
      app.updateLocationBar(path);
      app.updatePaneNav();
    },
  }
);

app.setRouter(router);
console.log("[App] Starting router");
router.start();

// Track navigation events to debug server requests
window.addEventListener("beforeunload", (e) => {
  console.log("[App] beforeunload event fired");
});
window.addEventListener("unload", (e) => {
  console.log("[App] unload event fired");
});
window.addEventListener("popstate", (e) => {
  console.log("[App] popstate event fired:", e.state);
});
window.addEventListener("hashchange", (e) => {
  console.log("[App] hashchange event fired:", e.oldURL, "->", e.newURL);
});

// Monitor for any programmatic navigation
try {
  const originalLocationAssign = window.location.assign.bind(window.location);
  const originalLocationReplace = window.location.replace.bind(window.location);
  const originalLocationReload = window.location.reload.bind(window.location);

  try {
    Object.defineProperty(window.location, 'assign', {
      value: function(...args) {
        console.log("[App] window.location.assign() called with:", args);
        console.trace("[App] Location assign stack trace");
        return originalLocationAssign(...args);
      },
      writable: true,
      configurable: true
    });
  } catch (e) {
    console.warn("[App] Could not override location.assign:", e);
  }

  try {
    Object.defineProperty(window.location, 'replace', {
      value: function(...args) {
        console.log("[App] window.location.replace() called with:", args);
        console.trace("[App] Location replace stack trace");
        return originalLocationReplace(...args);
      },
      writable: true,
      configurable: true
    });
  } catch (e) {
    console.warn("[App] Could not override location.replace:", e);
  }

  try {
    Object.defineProperty(window.location, 'reload', {
      value: function(...args) {
        console.log("[App] window.location.reload() called with:", args);
        console.trace("[App] Location reload stack trace");
        return originalLocationReload(...args);
      },
      writable: true,
      configurable: true
    });
  } catch (e) {
    console.warn("[App] Could not override location.reload:", e);
  }
} catch (e) {
  console.warn("[App] Could not set up location monitoring:", e);
}

// Track errors that might cause navigation
window.addEventListener("error", (e) => {
  console.error("[App] Global error:", e.error, e.message, e.filename, e.lineno);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[App] Unhandled promise rejection:", e.reason);
});

console.log("[App] Application initialization complete");