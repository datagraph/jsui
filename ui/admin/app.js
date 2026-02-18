import { AdminLayoutView } from "./layout.js";
import { APP_CONFIG } from "../../lib/config.js";
import { BasePage } from "../pages/base_page.js";

class AdminNotFoundPage extends BasePage {
  async renderContent() {
    return `<h1>404 - Page Not Found</h1>`;
  }
}

export class AdminApp {
  constructor({ state, router = null }) {
    this.state = state;
    this.router = router;
    this.layout = new AdminLayoutView();
    this.root = document.getElementById("app");
  }

  setRouter(router) {
    this.router = router;
  }

  navLinks() {
    const basePath = APP_CONFIG.basePath || "";
    const isLoggedIn = this.state.session?.isLoggedIn();
    return {
      global: [],
      loggedIn: [
        `<a href="${basePath}/user" data-external>User</a>`,
        `<a href="#" data-action="logout">Log out</a>`,
      ],
      loggedOut: [],
    };
  }

  async renderPage(page) {
    try {
      console.log("[AdminApp] renderPage called for:", page.constructor.name);
      const navLinks = this.navLinks();
      const session = this.state.session;
      console.log("[AdminApp] isLoggedIn:", session?.isLoggedIn());
      const title = page.getTitle();
      document.title = title ? `${title} - Dydra Admin` : "Dydra Administration";
      document.body.className = page.getBodyClass() || "";

      page.setContext({ navLinks, session, app: this });
      const content = await page.renderContent();
      const paneTabs = await page.getPaneTabs();
      const paneTabsBar = paneTabs?.bar || "";
      const paneTabsDefault = paneTabs?.defaultTab || "";
      console.log("[AdminApp] paneTabsBar length:", paneTabsBar.length, "default:", paneTabsDefault);

      const html = this.layout.render({ navLinks, session, content, paneTabsBar, paneTabsDefault });
      this.root.innerHTML = html;
      console.log("[AdminApp] HTML rendered, #admin-tabs exists:", !!this.root.querySelector("#admin-tabs"));

      // Store current page for lazy loading support
      this.currentPage = page;

      this.initializeLogoutButton();
      this.initializeLocationBar();
      this.initializeTabs();
      await page.afterRender();
      console.log("[AdminApp] renderPage complete");
    } catch (error) {
      console.error("[AdminApp] Error in renderPage:", error);
      throw error;
    }
  }

  async renderNotFound(ctx) {
    await this.renderPage(new AdminNotFoundPage({ ...ctx, state: this.state }));
  }

  handleLogout() {
    this.state.authStore.clear();
    this.state.session.logout();
    this.router.navigate("/login", { replace: true });
  }

  initializeLogoutButton() {
    const logoutButton = this.root.querySelector('[data-action="logout"]');
    if (logoutButton) {
      if (logoutButton.dataset.logoutHandlerAttached === "true") return;
      logoutButton.dataset.logoutHandlerAttached = "true";
      logoutButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.handleLogout();
      }, true);
    }
  }

  initializeTabs() {
    const container = this.root.querySelector("#admin-tabs");
    if (!container) return;

    const links = Array.from(container.querySelectorAll("[data-tab-link]"))
      .filter((link) => (link.getAttribute("href") || "").startsWith("#"));

    if (!links.length) return;

    // Find panels in the content container (admin panes)
    const contentArea = this.root.querySelector("#content-container") || this.root;
    const panels = links
      .map((link) => {
        const href = link.getAttribute("href");
        const id = href.replace("#", "");
        return document.getElementById(id);
      })
      .filter(Boolean);

    if (!panels.length) return;

    const defaultTab = container.getAttribute("data-default-tab");
    let defaultPanel = null;
    if (defaultTab) {
      const tabId = defaultTab.replace("#", "");
      defaultPanel = panels.find(p => p.id === tabId);
    }
    if (!defaultPanel) {
      defaultPanel = panels[0];
    }

    const defaultLink = defaultPanel
      ? links.find((link) => link.getAttribute("href") === `#${defaultPanel.id}`) || links[0]
      : links[0];

    // Hide all panels first
    panels.forEach((panel) => {
      panel.style.display = "none";
    });
    // Show default panel
    if (defaultPanel) {
      defaultPanel.style.display = "block";
    }
    links.forEach((link) => link.classList.remove("active"));
    if (defaultLink) {
      defaultLink.classList.add("active");
    }

    // Store reference to current page for lazy loading
    const currentPage = this.currentPage;

    links.forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const panelId = link.getAttribute("href")?.replace("#", "");
        const panel = document.getElementById(panelId);
        if (!panel) return;

        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");

        panels.forEach((p) => {
          p.style.display = p === panel ? "block" : "none";
        });

        // Trigger lazy loading if the page supports it
        if (currentPage && typeof currentPage.loadPaneContent === "function") {
          const auth = this.state.session?.accountName
            ? this.state.authStore.getAuth(this.state.session.accountName)
            : null;
          await currentPage.loadPaneContent(panelId, auth);
        }
      });
    });
  }

  initializeLocationBar() {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    const input = bar.querySelector("#location-input");
    if (!display || !input) return;

    const currentPath = this.router?.currentPath || "/";
    display.textContent = currentPath;
    input.value = currentPath;
    input.style.display = "none";
    display.style.display = "block";

    display.addEventListener("click", () => {
      input.style.display = "block";
      display.style.display = "none";
      input.focus();
      input.select();
    });

    input.addEventListener("blur", () => {
      input.style.display = "none";
      display.style.display = "block";
      input.value = display.textContent;
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.router.navigate(input.value.trim() || "/");
        input.blur();
      }
      if (event.key === "Escape") {
        input.blur();
      }
    });
  }

  updateLocationBar(path) {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    const input = bar.querySelector("#location-input");
    if (!display || !input) return;
    display.textContent = path;
    input.value = path;
  }

  showLocationMessage(message, duration = 3000) {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    if (!display) return;

    const originalText = display.textContent;
    display.textContent = message;
    display.style.fontStyle = "italic";

    setTimeout(() => {
      display.textContent = originalText;
      display.style.fontStyle = "";
    }, duration);
  }
}
