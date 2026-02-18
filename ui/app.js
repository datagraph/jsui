import { LayoutView } from "./components/layout.js";
import { NotFoundPage } from "./pages/index.js";
import { APP_CONFIG } from "../lib/config.js";

export class App {
  constructor({ state, router = null }) {
    this.state = state;
    this.router = router;
    this.layout = new LayoutView();
    this.root = document.getElementById("app");
    // Map to store editor API instances by pane ID
    this.editorInstances = new Map();
  }

  setRouter(router) {
    this.router = router;
  }

  navLinks() {
    const baseHost = APP_CONFIG.baseHost;
    const docsHost = APP_CONFIG.docsHost;
    const blogHost = APP_CONFIG.blogHost;
    const basePath = APP_CONFIG.basePath || "";
    const accountName = this.state.session?.accountName;
    const isLoggedIn = this.state.session?.isLoggedIn();
    // Check if we're on the login page by checking current path or window location
    const currentPath = this.router?.currentPath || this.router?.getCurrentPath?.() || window.location.pathname;
    const normalizedPath = currentPath.replace(/\/index\.html$/, "").replace(basePath, "") || "/";
    const isLoginPage = normalizedPath === "/login" || normalizedPath.endsWith("/login");
    
    return {
      global: [
        //`<a href="http://${baseHost}/" class="dydra-link-home">Home</a>`,
        `<a href="https://dydra.com/about" class="dydra-link-about" data-external target="_blank">About</a>`,
        `<a href="http://${docsHost}/" class="dydra-link-docs" target="_blank">Docs</a>`,
        `<a href="http://${blogHost}/" class="dydra-link-blog" target="_blank">Blog</a>`,
      ],
      loggedIn: [
        `<a href="#" class="dydra-link-logout" data-action="logout" data-testid="logout-link">Logout</a>`,
        `<a href="${basePath}/admin" class="dydra-link-admin" data-external target="_blank">Admin</a>`,
      ],
      loggedOut: [
        `<a href="/signup" class="dydra-link-signup" target="_blank">Signup</a>`,
        `<a href="${basePath}/admin" class="dydra-link-admin" data-external target="_blank">Admin</a>`,
      ],
    };
  }

  async renderPage(page) {
    console.log("[App] renderPage() called for:", page.constructor.name);
    try {
      const navLinks = this.navLinks();
      const session = this.state.session;
      const title = page.getTitle();
      document.title = title || "Dydra";
      document.body.className = page.getBodyClass() || "";

      page.setContext({ navLinks, session, app: this });
      console.log("[App] Rendering content...");
      const content = await page.renderContent();
      console.log("[App] Content rendered, length:", content?.length || 0);
      const sidebar = await page.renderSidebar();
      const paneTabs = await page.getPaneTabs();
      const paneTabsBar = paneTabs?.bar || "";
      const paneTabsDefault = paneTabs?.defaultTab || "";
      console.log("[App] paneTabsBar length:", paneTabsBar?.length || 0);
      console.log("[App] paneTabsDefault:", paneTabsDefault);
      console.log("[App] Calling LayoutView render() for page:", page.constructor.name);
      const html = this.layout.render({ navLinks, session, content, sidebar, paneTabsBar, paneTabsDefault });
      console.log("[App] Layout used: StandardLayout");
      console.log("[App] Rendered HTML length:", html?.length || 0);
      console.log("[App] Rendered HTML includes header-container:", html?.includes('header-container') || false);
      console.log("[App] Rendered HTML includes tabs-container:", html?.includes('tabs-container') || false);
      console.log("[App] Rendered HTML includes content-container:", html?.includes('content-container') || false);
      console.log("[App] Setting innerHTML, length:", html?.length || 0);
      this.root.innerHTML = html;
      console.log("[App] Page rendered, initializing components");
      this.initializeTabs();
      this.initializeLocationBar();
      this.initializePaneNav();
      this.initializeLogoutButton();
      console.log("[App] Calling page.afterRender()");
      await page.afterRender();
      console.log("[App] Page initialization complete");
    } catch (error) {
      console.error("[App] Error in renderPage:", error);
      throw error;
    }
  }

  activateTab(tabSelector) {
    if (!tabSelector) return;

    // Find the tabs list (it's in the pane-tabs-bar)
    const tabsList = this.root.querySelector("[data-tab-list]");
    if (!tabsList) {
      console.warn("[activateTab] No tabs list found");
      return;
    }

    // Find the link for this tab
    const link = tabsList.querySelector(`a[href="${tabSelector}"]`);
    if (!link) {
      console.warn("[activateTab] Tab link not found:", tabSelector);
      return;
    }

    // Find all tab links
    const contentArea = this.root.querySelector("#content-container");
    if (!contentArea) {
      console.warn("[activateTab] Content container not found");
      return;
    }

    const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));

    // Get ALL panes in the content area
    const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));

    const panelId = tabSelector.replace("#", "");
    const targetPanel = contentArea.querySelector(`#${CSS.escape(panelId)}`);

    if (!targetPanel) {
      console.warn("[activateTab] Panel not found:", panelId);
      return;
    }

    // Hide ALL panes, then show only the target
    allPanes.forEach((pane) => {
      pane.style.display = pane.id === panelId ? "block" : "none";
    });

    // Update active link
    allLinks.forEach((l) => l.classList.remove("active"));
    link.classList.add("active");

    // Update body class
    const bodyClass = link.getAttribute("data-body-class");
    if (bodyClass) {
      document.body.className = bodyClass;
    }

    // Update aside visibility
    const aside = this.root.querySelector("#aside");
    if (aside) {
      aside.style.display = link.dataset.showAside === "true" ? "" : "none";
    }

    // Update location bar
    const location = link.getAttribute("data-location");
    if (location) {
      this.updateLocationBar(location);
    }
  }

  async renderNotFound(ctx) {
    await this.renderPage(new NotFoundPage({ ...ctx, state: this.state }));
  }

  async renderMyAccount(ctx) {
    const current = this.state.getCurrentAccount();
    if (!current) {
      this.router.navigate("/login", { replace: true });
      return;
    }
    const basePath = APP_CONFIG.basePath || "";
    this.router.navigate(`${basePath}/account/${current.friendlyId}`, { replace: true });
  }

  handleLogout() {
    console.log("[Logout] handleLogout() called");
    
    // Store account name before clearing state (to preserve it for login form pre-fill)
    const accountName = this.state.session?.accountName;
    
    // Close all view panes first (they depend on repositories)
    const openViews = this.state.listOpenViews();
    for (const { accountName: viewAccount, repositoryName, viewName } of openViews) {
      this.state.removeOpenView(viewAccount, repositoryName, viewName);
      // Remove view pane from DOM if it exists
      const viewPaneId = `tab-view-${viewAccount.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${viewName.replace(/[^a-z0-9_-]/gi, "-")}`;
      const viewPane = document.getElementById(viewPaneId);
      if (viewPane) {
        viewPane.remove();
      }
      // Remove view tab from tabs bar if it exists
      const viewTab = document.querySelector(`[data-tab-link][href="#${viewPaneId}"]`);
      if (viewTab) {
        const tabListItem = viewTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Close all repository panes (they depend on accounts)
    const openRepositories = Array.from(this.state.listOpenRepositories());
    for (const { accountName: repoAccount, repositoryName } of openRepositories) {
      this.state.removeOpenRepository(repoAccount, repositoryName);
      // Remove repository pane from DOM if it exists
      const repoPaneId = `tab-repository-${repoAccount.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
      const repoPane = document.getElementById(repoPaneId);
      if (repoPane) {
        repoPane.remove();
      }
      // Remove repository tab from tabs bar if it exists
      const repoTab = document.querySelector(`[data-tab-link][href="#${repoPaneId}"]`);
      if (repoTab) {
        const tabListItem = repoTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Close all account panes
    const openAccounts = Array.from(this.state.listOpenAccounts());
    for (const accountNameToClose of openAccounts) {
      this.state.removeOpenAccount(accountNameToClose);
      // Remove account pane from DOM if it exists
      const accountPaneId = `tab-account-${accountNameToClose.replace(/[^a-z0-9_-]/gi, "-")}`;
      const accountPane = document.getElementById(accountPaneId);
      if (accountPane) {
        accountPane.remove();
      }
      // Remove account tab from tabs bar if it exists
      const accountTab = document.querySelector(`[data-tab-link][href="#${accountPaneId}"]`);
      if (accountTab) {
        const tabListItem = accountTab.closest("li");
        if (tabListItem) {
          tabListItem.remove();
        }
      }
    }
    
    // Clear all editor instances
    if (this.editorInstances) {
      this.editorInstances.clear();
    }
    
    // Clear repository config cache
    if (this.state._repoConfigCache) {
      this.state._repoConfigCache.clear();
    }
    
    // Clear authentication tokens for all accounts
    console.log("[Logout] Clearing auth store");
    this.state.authStore.clear();
    
    // Clear session state (this preserves accountName for login form pre-fill)
    console.log("[Logout] Clearing session");
    this.state.session.logout();

    // Update header links to show Signup instead of Logout
    this.updateHeaderLinks();

    // Navigate to login page (this will trigger a full page re-render, cleaning up any remaining UI)
    console.log("[Logout] Navigating to /login");
    console.log("[Logout] Router instance:", this.router);
    console.log("[Logout] Router updateLocation:", this.router?.updateLocation);
    this.router.navigate("/login", { replace: true });
    console.log("[Logout] Navigation called, handleLogout() complete");
  }

  updateHeaderLinks() {
    const navLinks = this.navLinks();
    const isLoggedIn = this.state.session?.isLoggedIn();
    const nav = this.root.querySelector("#nav ul.nav");
    if (!nav) return;

    // Build new links HTML
    const linksHtml = [
      ...(isLoggedIn ? navLinks.loggedIn : navLinks.loggedOut),
      ...navLinks.global,
    ].map((link) => `<li>${link}</li>`).join('');

    nav.innerHTML = linksHtml;

    // Re-initialize logout button handler if logged in
    if (isLoggedIn) {
      this.initializeLogoutButton();
    }
  }

  initializeLocationBar() {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    const input = bar.querySelector("#location-input");
    if (!display || !input) return;

    const currentPath = this.router?.currentPath || this.router?.getCurrentPath?.() || "/";
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
        const value = input.value.trim();
        let path = value;
        if (value.startsWith("http")) {
          try {
            path = new URL(value).pathname;
          } catch (error) {
            path = value;
          }
        }
        this.router.navigate(path || "/");
        input.blur();
      }
      if (event.key === "Escape") {
        input.blur();
      }
    });
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

  updateLocationBar(path) {
    const bar = this.root.querySelector("#location-bar");
    if (!bar) return;
    const display = bar.querySelector("#location-display");
    const input = bar.querySelector("#location-input");
    if (!display || !input) return;
    display.textContent = path;
    input.value = path;
  }

  initializePaneNav() {
    const backButtons = Array.from(this.root.querySelectorAll('[data-action="nav-back"]'));
    const forwardButtons = Array.from(this.root.querySelectorAll('[data-action="nav-forward"]'));
    if (!backButtons.length || !forwardButtons.length || !this.router) return;
    backButtons.forEach((button) => {
      button.onclick = () => this.router.goBack();
    });
    forwardButtons.forEach((button) => {
      button.onclick = () => this.router.goForward();
    });
    this.updatePaneNav();
  }

  updatePaneNav() {
    const backButtons = Array.from(this.root.querySelectorAll('[data-action="nav-back"]'));
    const forwardButtons = Array.from(this.root.querySelectorAll('[data-action="nav-forward"]'));
    if (!backButtons.length || !forwardButtons.length || !this.router) return;
    const canBack = this.router.canGoBack();
    const canForward = this.router.canGoForward();
    backButtons.forEach((button) => {
      button.disabled = !canBack;
    });
    forwardButtons.forEach((button) => {
      button.disabled = !canForward;
    });
  }

  initializeLogoutButton() {
    console.log("[Logout] initializeLogoutButton called");
    const logoutButton = this.root.querySelector('[data-action="logout"]');
    console.log("[Logout] Button found:", !!logoutButton, logoutButton);
    if (logoutButton) {
      console.log("[Logout] Button href:", logoutButton.getAttribute("href"));
      console.log("[Logout] Button data-action:", logoutButton.getAttribute("data-action"));
      // Check if handler already attached (prevent duplicates)
      if (logoutButton.dataset.logoutHandlerAttached === "true") {
        console.log("[Logout] Handler already attached, skipping");
        return;
      }
      logoutButton.dataset.logoutHandlerAttached = "true";
      // Use capture phase to ensure our handler runs before router's handler
      logoutButton.addEventListener("click", (e) => {
        console.log("[Logout] Click handler FIRED");
        console.log("[Logout] Event target:", e.target);
        console.log("[Logout] Event currentTarget:", e.currentTarget);
        console.log("[Logout] Event phase:", e.eventPhase, "(1=CAPTURING, 2=AT_TARGET, 3=BUBBLING)");
        console.log("[Logout] Event defaultPrevented before:", e.defaultPrevented);
        console.log("[Logout] Calling preventDefault()");
        e.preventDefault();
        console.log("[Logout] Event defaultPrevented after:", e.defaultPrevented);
        console.log("[Logout] Calling stopPropagation()");
        e.stopPropagation();
        console.log("[Logout] Calling stopImmediatePropagation()");
        e.stopImmediatePropagation();
        console.log("[Logout] Calling handleLogout()");
        this.handleLogout();
        console.log("[Logout] handleLogout() returned");
      }, true); // Use capture phase
      console.log("[Logout] Event listener attached in CAPTURE phase");
    } else {
      console.warn("[Logout] Logout button not found!");
    }
  }

  initializeTabs() {
    // Find the visible tabs container (either #login-tabs or #loggedin-tabs)
    const loginTabs = this.root.querySelector("#login-tabs");
    const loggedInTabs = this.root.querySelector("#loggedin-tabs");
    const visibleTabsContainer = (loginTabs && loginTabs.style.display !== "none") ? loginTabs :
                                  (loggedInTabs && loggedInTabs.style.display !== "none") ? loggedInTabs : null;

    // Find the tabs list within the visible container
    const tabsList = visibleTabsContainer?.querySelector("[data-tab-list]") || this.root.querySelector("[data-tab-list]");
    if (!tabsList) {
      console.log("[App] initializeTabs: No tabs list found");
      return;
    }

    // Get all tab links, including intro tab which uses href="/"
    const links = Array.from(tabsList.querySelectorAll("[data-tab-link]"));

    // Find panels in the content-container
    const contentArea = this.root.querySelector("#content-container");
    if (!contentArea) {
      console.log("[App] initializeTabs: No content container found");
      return;
    }

    // Get ALL panes in the content area (not just those with tabs)
    const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));

    // Build panels array from links for mapping
    const panels = links
        .map((link) => {
          const href = link.getAttribute("href");
          if (!href || !href.startsWith("#")) return null;
          const id = href.replace("#", "");
          return contentArea.querySelector(`#${CSS.escape(id)}`);
        })
        .filter(Boolean);

      if (!links.length || !panels.length) {
        console.log("[App] initializeTabs: No links or panels found", { links: links.length, panels: panels.length });
        return;
      }

      // Get default tab from the wrapper div (data-default-tab is on #login-tabs or #loggedin-tabs)
      const tabsWrapper = tabsList.closest("[data-default-tab]") || visibleTabsContainer;
      const defaultTab = tabsWrapper?.getAttribute("data-default-tab") || null;
      console.log("[App] initializeTabs: defaultTab attribute:", defaultTab);
      console.log("[App] initializeTabs: Available panels:", panels.map(p => p.id));
      console.log("[App] initializeTabs: Available links:", links.map(l => l.getAttribute("href")));
      
      let defaultPanel = null;
      if (defaultTab) {
        // Try multiple selectors to find the default panel
        const selectors = [
          defaultTab,
          `#${defaultTab.replace("#", "")}`,
          `.account-pane${defaultTab}`,
          `.repository-pane${defaultTab}`,
          `.pane ${defaultTab}`,
        ];
        for (const selector of selectors) {
          defaultPanel = contentArea.querySelector(selector);
          if (defaultPanel) {
            console.log("[App] initializeTabs: Found default panel with selector:", selector, defaultPanel.id);
            break;
          }
        }
        // If still not found, try finding by ID in panels array
        if (!defaultPanel) {
          const tabId = defaultTab.replace("#", "");
          defaultPanel = panels.find(p => p.id === tabId);
          if (defaultPanel) {
            console.log("[App] initializeTabs: Found default panel in panels array:", defaultPanel.id);
          }
        }
      }
      if (!defaultPanel) {
        defaultPanel = panels[0];
        console.log("[App] initializeTabs: Using first panel as default:", defaultPanel?.id);
      }
      
      const defaultLink = defaultPanel 
        ? links.find((link) => {
            const href = link.getAttribute("href");
            const linkPanelId = href === "/" ? "tab-info" : (href?.startsWith("#") ? href.replace("#", "") : null);
            return linkPanelId === defaultPanel.id;
          }) || links[0]
        : links[0];
      console.log("[App] initializeTabs: Default panel:", defaultPanel?.id, "Default link:", defaultLink?.getAttribute("href"));

      // Helper function to hide all panes and show only the target
      // Query DOM fresh each time to handle dynamically added panes
      const showOnlyPane = (targetId) => {
        const currentPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
        currentPanes.forEach((pane) => {
          pane.style.display = pane.id === targetId ? "block" : "none";
        });
      };

      // Hide ALL panes first, then show default
      allPanes.forEach((pane) => {
        pane.style.display = "none";
      });
      // Show default panel
      if (defaultPanel) {
        defaultPanel.style.display = "block";
        console.log("[App] initializeTabs: Set default panel display to block:", defaultPanel.id);
      }
      links.forEach((link) => link.classList.remove("active"));
      if (defaultLink) {
        defaultLink.classList.add("active");
        const bodyClass = defaultLink.getAttribute("data-body-class");
        if (bodyClass) {
          document.body.className = bodyClass;
        }
      }
      const aside = this.root.querySelector("#aside");
      if (aside) {
        aside.style.display = defaultLink?.dataset.showAside === "true" ? "" : "none";
      }
      links.forEach((link, index) => {
        link.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();

          const location = link.getAttribute("data-location");
          const href = link.getAttribute("href");
          // Handle intro tab which uses href="/" instead of href="#tab-info"
          const panelId = href === "/" ? "tab-info" : (href?.startsWith("#") ? href.replace("#", "") : null);

          // Find the target panel
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;

          if (targetPanel) {
            // Panel exists - hide ALL panes and show only this one
            showOnlyPane(panelId);
            links.forEach((item) => item.classList.remove("active"));
            link.classList.add("active");
            const bodyClass = link.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = this.root.querySelector("#aside");
            if (aside) {
              aside.style.display = link.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              this.updateLocationBar(location);
            }
          } else if (location && this.router) {
            // Panel doesn't exist - navigate to create it
            this.router.navigate(location);
          }
        });
      });

    tabsList.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-tab-action]");
        if (!actionButton) return;
        event.preventDefault();
        event.stopPropagation();
        const action = actionButton.getAttribute("data-tab-action");
        const tabId = actionButton.getAttribute("data-tab-id");
        const tabType = actionButton.getAttribute("data-tab-type");
        const accountName = actionButton.getAttribute("data-account");
        const repositoryName = actionButton.getAttribute("data-repository");
        const viewName = actionButton.getAttribute("data-view");
        if (action === "close") {
          // Find the tab link that contains this close button
          const tabLink = actionButton.closest("[data-tab-link]");
          if (tabLink) {
            // Find all tab links in order
            const allTabLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            const currentIndex = allTabLinks.indexOf(tabLink);
            
            // Determine which tab should be active next: right if exists, otherwise left
            let nextTabLink = null;
            if (currentIndex < allTabLinks.length - 1) {
              // Tab to the right exists
              nextTabLink = allTabLinks[currentIndex + 1];
            } else if (currentIndex > 0) {
              // Tab to the left exists
              nextTabLink = allTabLinks[currentIndex - 1];
            }
            
            // Store the next tab href to activate after closing
            const nextTabHref = nextTabLink ? nextTabLink.getAttribute("href") : null;
            this.closePane({ tabType, tabId, accountName, repositoryName, viewName, nextTabHref });
          } else {
            this.closePane({ tabType, tabId, accountName, repositoryName, viewName });
          }
        }
        if (action === "save") {
          if (actionButton.getAttribute("aria-disabled") === "true") {
            return;
          }
          this.savePane({ tabType, tabId, accountName, repositoryName });
        }
      });

      // Add drag handlers for view pane tabs
      const viewTabLinks = tabsList.querySelectorAll('[data-tab-type="view"]');
      viewTabLinks.forEach((link) => {
        link.setAttribute("draggable", "true");
        let dragSessionId = null;

        link.addEventListener("dragstart", (event) => {
          const tabId = link.getAttribute("data-tab-id");
          const accountName = link.getAttribute("data-account");
          const repositoryName = link.getAttribute("data-repository");
          const viewName = link.getAttribute("data-view");

          if (!tabId || !accountName || !repositoryName || !viewName) {
            event.preventDefault();
            return;
          }

          // Get editor instance
          const editorApi = this.editorInstances.get(tabId);
          if (!editorApi) {
            console.warn("[App] No editor instance found for tab:", tabId);
            event.preventDefault();
            return;
          }

          // Extract editor state
          const queryText = editorApi.getQuery();
          const queryTabs = editorApi.getQueryTabs();
          const currentTabId = editorApi.getCurrentTabId();

          // Get authentication token
          const auth = this.state.getAuthContext(accountName);
          const host = auth?.host || window.location.origin;
          const accessToken = this.state.getAuthToken(accountName);
          const viewUrl = `${host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(viewName)}`;

          // Generate session ID
          dragSessionId = `editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Prepare data to transfer
          const transferData = {
            accountName,
            repositoryName,
            viewName,
            viewUrl,
            accessToken,
            queryText,
            results: queryTabs,
            currentTabId,
            sessionId: dragSessionId,
          };

          // Store in sessionStorage
          try {
            sessionStorage.setItem(`editor-session-${dragSessionId}`, JSON.stringify(transferData));
          } catch (e) {
            console.error("[App] Failed to store editor data in sessionStorage:", e);
            event.preventDefault();
            return;
          }

          // Set drag data
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", dragSessionId);
          }
        });

        link.addEventListener("dragend", (event) => {
          // Check if drag ended outside window
          const clientX = event.clientX;
          const clientY = event.clientY;

          // If coordinates are 0,0, the drag was cancelled (ESC key)
          if (clientX === 0 && clientY === 0) {
            if (dragSessionId) {
              sessionStorage.removeItem(`editor-session-${dragSessionId}`);
            }
            return;
          }

          // Check if drag ended outside window bounds
          const isOutsideWindow =
            clientX < 0 ||
            clientY < 0 ||
            clientX > window.innerWidth ||
            clientY > window.innerHeight;

          if (isOutsideWindow && dragSessionId) {
            const accountName = link.getAttribute("data-account");
            const auth = this.state.getAuthContext(accountName);
            const accessToken = this.state.getAuthToken(accountName);

            // Encode token for URL hash
            const encodedToken = encodeURIComponent(accessToken || "");

            // Open new window
            const basePath = APP_CONFIG.basePath || "/ui";
            const url = `${basePath}/standalone-editor#sessionId=${dragSessionId}&token=${encodedToken}`;
            const newWindow = window.open(
              url,
              "_blank",
              "width=1200,height=800,scrollbars=yes,resizable=yes"
            );

            if (!newWindow) {
              // Popup blocked
              alert("Popup blocked. Please allow popups for this site to open editor in new window.");
              sessionStorage.removeItem(`editor-session-${dragSessionId}`);
            } else {
              // Clean up sessionStorage after a delay (let new window read it first)
              setTimeout(() => {
                try {
                  sessionStorage.removeItem(`editor-session-${dragSessionId}`);
                } catch (e) {
                  // Ignore cleanup errors
                }
              }, 5000);
            }
          } else if (dragSessionId) {
            // Drag ended inside window, clean up
            sessionStorage.removeItem(`editor-session-${dragSessionId}`);
          }
        });
      });
  }

  closePane({ tabType, tabId, accountName, repositoryName, viewName, nextTabHref }) {
    if (!this.state) return;
    
    let paneId;
    if (tabType === "account" && accountName) {
      paneId = `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenAccount(accountName);
      // Remove pane and tab
      const pane = document.getElementById(paneId);
      if (pane) pane.remove();
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) tabLink.closest("li")?.remove();
      // If we're currently viewing this account, activate login pane instead
      if (this.router?.currentPath?.startsWith(`/account/${accountName}`)) {
        // Activate login pane (it should exist, but if not, navigate to create it)
        const loginPane = document.getElementById("tab-login");
        if (loginPane) {
          this.activateTab("#tab-login");
        } else {
          // Login pane doesn't exist - navigate to /login which will create it
          this.router.navigate("/login");
        }
        return;
      }
      // If not currently viewing this account, just remove it and activate next tab
      // (handled by the code below)
    } else if (tabType === "repository" && accountName && repositoryName) {
      paneId = `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenRepository(accountName, repositoryName);
      // Remove pane and tab
      const pane = document.getElementById(paneId);
      if (pane) pane.remove();
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) tabLink.closest("li")?.remove();
      // If we're currently viewing this repository, activate account pane instead
      if (this.router?.currentPath?.startsWith(`/account/${accountName}/repositories/${repositoryName}`)) {
        // Activate account pane (it should exist)
        const accountPaneId = `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
        const accountPane = document.getElementById(accountPaneId);
        if (accountPane) {
          this.activateTab(`#${accountPaneId}`);
        } else {
          // Account pane doesn't exist - navigate to account which will create it
          this.router.navigate(`/account/${accountName}`);
        }
        return;
      }
      // If not currently viewing this repository, just remove it and activate next tab
      // (handled by the code below)
    } else if (tabType === "view" && accountName && repositoryName && viewName) {
      paneId = `tab-view-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${viewName.replace(/[^a-z0-9_-]/gi, "-")}`;
      this.state.removeOpenView(accountName, repositoryName, viewName);
    } else {
      // Fallback: use tabId if provided
      paneId = tabId;
    }
    
    // Remove the pane element from DOM
    if (paneId) {
      const pane = document.getElementById(paneId);
      if (pane) {
        pane.remove();
      }
    }
    
    // Remove the tab from the tabs bar
    if (paneId) {
      const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
      if (tabLink) {
        tabLink.closest("li")?.remove();
      }
    }
    
    // Activate the next tab if specified, otherwise activate the rightmost or leftmost tab
    if (nextTabHref) {
      this.activateTab(nextTabHref);
    } else {
      // Find the next tab to activate (right, then left)
      const tabsList = document.querySelector("[data-tab-list]");
      if (tabsList) {
        const allTabs = Array.from(tabsList.querySelectorAll("li"));
        const currentTabIndex = paneId ? allTabs.findIndex(li => {
          const link = li.querySelector(`[href="#${paneId}"]`);
          return link !== null;
        }) : -1;
        
        if (currentTabIndex >= 0) {
          // Try to activate tab to the right
          if (currentTabIndex < allTabs.length - 1) {
            const nextTab = allTabs[currentTabIndex + 1];
            const nextLink = nextTab.querySelector("[data-tab-link]");
            if (nextLink) {
              this.activateTab(nextLink.getAttribute("href"));
              return;
            }
          }
          // Otherwise activate tab to the left
          if (currentTabIndex > 0) {
            const prevTab = allTabs[currentTabIndex - 1];
            const prevLink = prevTab.querySelector("[data-tab-link]");
            if (prevLink) {
              this.activateTab(prevLink.getAttribute("href"));
              return;
            }
          }
        }
      }
    }
  }

  async savePane({ tabType, tabId, accountName, repositoryName }) {
    if (window.saveAccountPane && tabType === "account") {
      await window.saveAccountPane(accountName);
    }
    if (window.saveRepositoryPane && tabType === "repository") {
      await window.saveRepositoryPane(accountName, repositoryName);
    }
  }
}
