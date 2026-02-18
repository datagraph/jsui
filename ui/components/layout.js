import { HeaderView } from "./header.js";
import { FooterView } from "./footer.js";
import { FlashesView } from "./flashes.js";

export class LayoutView {
  constructor() {
    this.header = new HeaderView();
    this.footer = new FooterView();
    this.flashes = new FlashesView();
  }

  render({ navLinks, session, content, sidebar, paneTabsBar = "", paneTabsDefault = "" }) {
    const isLoggedIn = session?.isLoggedIn();

    // Single header - show appropriate nav links based on login state
    const header = `
      <div id="header">
        <div class="wrapper">
          <a href="/login" id="logo">Dydra</a>
          <div id="nav">
            <ul class="nav">
              ${(isLoggedIn ? navLinks.loggedIn : navLinks.loggedOut).map((link) => `<li>${link}</li>`).join('')}
              ${navLinks.global.map((link) => `<li>${link}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;

    // Single tabs container - use paneTabsBar from page, add data-default-tab
    const tabsContainer = paneTabsBar
      ? paneTabsBar.replace('<div class="pane-tabs-bar">', `<div class="pane-tabs-bar" data-default-tab="${paneTabsDefault}">`)
      : '';

    return `
      ${this.flashes.render()}
      <div id="header-container">
        ${header}
      </div>
      <div id="tabs-container">
        ${tabsContainer}
      </div>
      <div id="content-container">
        ${sidebar ? `
          <div class="content-wrapper">
            <div class="content-main">
              ${content || ""}
            </div>
            <div id="sidebar-gutter"></div>
            <div id="aside">
              ${sidebar}
            </div>
          </div>
        ` : (content || "")}
      </div>
      ${this.footer.render({ navLinks, session })}
      <div id="location-bar" class="location-bar">
        <span id="location-display"></span>
        <input id="location-input" type="text" />
      </div>
    `;
  }
}
