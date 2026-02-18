const DEFAULT_ROUTE = "/";

const normalizePath = (value) => {
  if (!value) return DEFAULT_ROUTE;
  if (!value.startsWith("/")) return `/${value}`;
  return value;
};

const compileRoute = (path) => {
  const keys = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), keys };
};

const matchRoute = (path, route) => {
  const { regex, keys } = route.compiled;
  const match = path.match(regex);
  if (!match) return null;
  const params = {};
  keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1]);
  });
  return params;
};

export class Router {
  constructor(routes = [], onNotFound, { basePath = "", updateLocation = true, onRouteChange } = {}) {
    this.routes = routes.map((route) => ({
      ...route,
      compiled: compileRoute(route.path),
    }));
    this.onNotFound = onNotFound;
    this.useHash = window.location.protocol === "file:";
    this.basePath = basePath.replace(/\/$/, "");
    this.updateLocation = updateLocation;
    this.onRouteChange = onRouteChange;
    this.currentPath = null;
    this.historyStack = [];
    this.historyIndex = -1;
    this.isHistoryNavigation = false;
    this.handlePopState = this.handlePopState.bind(this);
    this.handleLinkClick = this.handleLinkClick.bind(this);
  }

  stripBasePath(path) {
    if (!this.basePath) return path;
    if (path === this.basePath) return "/";
    if (path.startsWith(`${this.basePath}/`)) {
      return path.slice(this.basePath.length) || "/";
    }
    return path;
  }

  getCurrentPath() {
    if (this.useHash) {
      return normalizePath(window.location.hash.replace(/^#/, ""));
    }
    // Strip .html extension and normalize entry point names
    // /ui/user -> /, /ui/admin -> /admin, index.html -> "", admin.html -> admin
    let rawPath = window.location.pathname;
    if (rawPath.endsWith("/index.html")) {
      rawPath = rawPath.replace(/\/index\.html$/, "");
    } else if (rawPath.endsWith("/user")) {
      rawPath = rawPath.replace(/\/user$/, "");
    } else if (rawPath.endsWith(".html")) {
      rawPath = rawPath.replace(/\.html$/, "");
    }
    return normalizePath(this.stripBasePath(rawPath));
  }

  findRoute(path) {
    for (const route of this.routes) {
      const params = matchRoute(path, route);
      if (params) {
        return { route, params };
      }
    }
    return null;
  }

  handlePath(path) {
    console.log("[Router] handlePath() called with:", path);
    const normalized = normalizePath(path);
    console.log("[Router] Normalized to:", normalized);
    this.currentPath = normalized;
    const match = this.findRoute(normalized);
    console.log("[Router] Route match found:", !!match, match ? match.route.path : "none");
    if (match) {
      console.log("[Router] Calling route handler for:", match.route.path);
      match.route.handler({ params: match.params, path: normalized });
      console.log("[Router] Route handler completed");
    } else if (this.onNotFound) {
      console.log("[Router] No route match, calling onNotFound");
      this.onNotFound({ path: normalized });
    }
    if (this.onRouteChange) {
      console.log("[Router] Calling onRouteChange with:", normalized);
      this.onRouteChange(normalized);
    }
    this.isHistoryNavigation = false;
  }

  recordHistory(path, { replace = false } = {}) {
    if (replace && this.historyIndex >= 0) {
      this.historyStack[this.historyIndex] = path;
      return;
    }
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    }
    this.historyStack.push(path);
    this.historyIndex = this.historyStack.length - 1;
  }

  canGoBack() {
    return this.historyIndex > 0;
  }

  canGoForward() {
    return this.historyIndex >= 0 && this.historyIndex < this.historyStack.length - 1;
  }

  goBack() {
    if (!this.canGoBack()) return;
    this.historyIndex -= 1;
    this.isHistoryNavigation = true;
    this.handlePath(this.historyStack[this.historyIndex]);
  }

  goForward() {
    if (!this.canGoForward()) return;
    this.historyIndex += 1;
    this.isHistoryNavigation = true;
    this.handlePath(this.historyStack[this.historyIndex]);
  }

  navigate(path, { replace = false } = {}) {
    console.log("[Router] navigate() called with path:", path, "replace:", replace);
    const normalized = normalizePath(path);
    console.log("[Router] Normalized path:", normalized);
    console.log("[Router] updateLocation:", this.updateLocation);
    if (!this.updateLocation) {
      const target = this.stripBasePath(normalized);
      console.log("[Router] updateLocation is false, handling path directly:", target);
      if (!this.isHistoryNavigation) {
        this.recordHistory(target, { replace });
      }
      this.handlePath(target);
      return;
    }
    const targetPath = this.basePath && !normalized.startsWith(this.basePath)
      ? `${this.basePath}${normalized}`
      : normalized;
    if (this.useHash) {
      if (replace) {
        window.location.replace(`#${normalized}`);
      } else {
        window.location.hash = normalized;
      }
      return;
    }
    if (replace) {
      window.history.replaceState({}, "", targetPath);
    } else {
      window.history.pushState({}, "", targetPath);
    }
    this.handlePopState();
  }

  handlePopState() {
    const path = this.getCurrentPath();
    if (!this.isHistoryNavigation) {
      this.recordHistory(path, { replace: true });
    }
    this.handlePath(path);
  }

  handleLinkClick(event) {
    const anchor = event.target.closest("a");
    console.log("[Router] handleLinkClick called");
    console.log("[Router] Event target:", event.target);
    console.log("[Router] Anchor found:", !!anchor, anchor);
    if (!anchor || anchor.target || anchor.hasAttribute("download")) {
      console.log("[Router] Skipping: no anchor, has target, or has download attribute");
      return;
    }
    // Skip links with data-action attribute (handled by app-specific handlers)
    if (anchor.hasAttribute("data-action")) {
      const dataAction = anchor.getAttribute("data-action");
      console.log("[Router] Skipping link with data-action:", dataAction);
      return;
    }
    // Skip tab links (handled by tab click handlers in initializeTabs)
    if (anchor.hasAttribute("data-tab-link")) {
      console.log("[Router] Skipping: link has data-tab-link attribute");
      return;
    }
    let href = anchor.getAttribute("href");
    console.log("[Router] Link href:", href);
    if (!href || href.startsWith("mailto:") || href.startsWith("#")) {
      console.log("[Router] Skipping: no href, mailto, or hash link");
      return;
    }
    // Skip links with data-external attribute (always navigate externally)
    if (anchor.hasAttribute("data-external")) {
      console.log("[Router] Skipping: link has data-external attribute");
      return;
    }
    if (href.startsWith("http")) {
      try {
        const url = new URL(href);
        // Always allow external links (different origin) to navigate normally
        if (url.origin !== window.location.origin) {
          console.log("[Router] External link, allowing browser navigation:", href);
          return;
        }
        // For same-origin absolute URLs, extract pathname for routing
        href = `${url.pathname}${url.search}${url.hash}`;
      } catch (error) {
        return;
      }
    }
    if (!href.startsWith("/")) {
      console.log("[Router] Skipping: href does not start with /");
      return;
    }
    // Skip links to actual files (e.g. .html, .css, .js) — let the browser navigate
    if (/\.\w+$/.test(href.split("?")[0])) {
      console.log("[Router] Skipping: link points to a file:", href);
      return;
    }
    console.log("[Router] Preventing default and navigating to:", href);
    event.preventDefault();
    this.navigate(href);
    console.log("[Router] Navigation initiated");
  }

  start() {
    console.log("[Router] Router.start() called");
    window.addEventListener("popstate", this.handlePopState);
    window.addEventListener("hashchange", this.handlePopState);
    console.log("[Router] Attaching document click listener (BUBBLE phase)");
    document.addEventListener("click", this.handleLinkClick, false); // Explicitly bubble phase
    this.handlePopState();
    console.log("[Router] Router initialization complete");
  }
}
