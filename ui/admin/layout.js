import { FooterView } from "../components/footer.js";

export class AdminLayoutView {
  constructor() {
    this.footer = new FooterView();
  }

  render({ navLinks, session, content, paneTabsBar = "", paneTabsDefault = "" }) {
    const isLoggedIn = session?.isLoggedIn();

    // Admin header - simpler than main app
    const header = `
      <div id="header">
        <div class="wrapper">
          <a href="/" id="logo">Dydra Admin</a>
          <div id="nav">
            <ul class="nav">
              ${isLoggedIn
                ? navLinks.loggedIn.map((link) => `<li>${link}</li>`).join('')
                : navLinks.loggedOut.map((link) => `<li>${link}</li>`).join('')
              }
              ${navLinks.global.map((link) => `<li>${link}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;

    // Tabs bar - only shown when logged in and tabs are provided
    const tabsBar = (isLoggedIn && paneTabsBar) ? `
      <div id="tabs-container">
        <div id="admin-tabs" data-tabs data-default-tab="${paneTabsDefault}">
          ${paneTabsBar}
        </div>
      </div>
    ` : '';

    return `
      <div id="header-container">
        ${header}
      </div>
      ${tabsBar}
      <div id="content-container">
        ${content || ""}
      </div>
      ${this.footer.render({ navLinks, session })}
      <div id="location-bar" class="location-bar">
        <span id="location-display"></span>
        <input id="location-input" type="text" />
      </div>
    `;
  }
}
