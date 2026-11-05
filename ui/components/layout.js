import { HeaderView } from "./header.js";
import { FooterView } from "./footer.js";
import { FlashesView } from "./flashes.js";
import { DISPLAY_ID, INPUT_ID, TARGET_ID, REPLY_ID } from "./location-bar.js";
import { mountedPresentation } from "../../lib/app/arrangement.js";
import { mountBandMarkup } from "./mount-band.js";

const escapeAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The chrome.
 *
 * Two ways out of here, and the difference is U-72.  Without a workspace
 * arrangement the bands are emitted in a fixed order, exactly as they were
 * before this phase — that path is kept because it is what every test and
 * every page that does not read the store still gets, and because the
 * arrangement is the thing being made addressable, not the bands.
 *
 * With one, the same bands are placed into a grid whose template came out of
 * `<account>/ui'.  Each band carries `data-ui' and `data-host', so the
 * reconciler can address it and the outline can name it, and nothing inside
 * a band is touched: a host says where the header goes and never what is in
 * it (D-AS).  The containers keep their ids, so every page's `render()' and
 * every selector in the stylesheet still finds what it is looking for.
 */
export class LayoutView {
  constructor() {
    this.header = new HeaderView();
    this.footer = new FooterView();
    this.flashes = new FlashesView();
  }

  /** The bands, each as the markup that goes in its area. */
  bands({ navLinks, session, content, sidebar, paneTabsBar, paneTabsDefault }) {
    const isLoggedIn = session?.isLoggedIn();

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

    return {
      flashes: this.flashes.render(),
      header: `<div id="header-container">${header}</div>`,
      tabs: `<div id="tabs-container">${tabsContainer}</div>`,
      content: `<div id="content-container">${sidebar ? `
          <div class="content-wrapper">
            <div class="content-main">
              ${content || ""}
            </div>
            <div id="sidebar-gutter"></div>
            <div id="aside">
              ${sidebar}
            </div>
          </div>
        ` : (content || "")}</div>`,
      footer: this.footer.render({ navLinks, session }),
      location: this.locationBar(),
    };
  }

  /**
   * The bar, with the two parts U-77 and U-78 need.
   *
   * `location-display' and `location-input' keep their ids and their order:
   * `showLocationMessage' writes to the first by id and several tests click
   * it.  The target and the reply are added after the display rather than
   * folded into it, so a message does not overwrite the address and an undo
   * does not disappear when a message times out.
   */
  locationBar() {
    return `<div id="location-bar" class="location-bar">
        <span id="${DISPLAY_ID}"></span>
        <span id="${TARGET_ID}" class="location-target" data-testid="location-target" hidden></span>
        <input id="${INPUT_ID}" type="text" />
        <span id="${REPLY_ID}" class="location-reply" data-testid="location-reply" hidden></span>
      </div>`;
  }

  render({ navLinks, session, content, sidebar, paneTabsBar = "", paneTabsDefault = "",
           workspace = null }) {
    const bands = this.bands({ navLinks, session, content, sidebar, paneTabsBar, paneTabsDefault });
    if (!workspace) {
      return `
      ${bands.flashes}
      ${bands.header}
      ${bands.tabs}
      ${bands.content}
      ${bands.footer}
      ${bands.location}
    `;
    }
    return this.arranged(bands, workspace);
  }

  /**
   * The bands, placed.
   *
   * A band the arrangement does not mention is still emitted, at the end and
   * without an area: the alternative is that a workspace saved before a host
   * existed silently loses it, and a band that appears in the wrong place is
   * a thing the user can see and say something about.  A band the
   * arrangement names twice is emitted once — the first placement wins — and
   * a host this build does not know renders as the reconciler's inert box
   * with the reason on it, which is the same answer `attach' gives.
   *
   * A host naming a PRESENTATION rather than one of this build's views is a
   * mount (U-86), and gets the band `mount-band.js' draws: a sentence and a
   * control, and nothing drawn until the control is pressed.  It is still an
   * unregistered host — a build older than phase 8 falls to the inert box
   * above and says so, which is the whole reason a mount was spelled inside
   * `ui:host' instead of as a term that build would drop.
   */
  arranged(bands, workspace) {
    const seen = new Set();
    const placed = [];
    for (const band of workspace.bands || []) {
      if (seen.has(band.host)) continue;
      seen.add(band.host);
      const mounts = mountedPresentation(band.host);
      const markup = mounts
        ? mountBandMarkup({ name: mounts, element: band.name })
        : (Object.prototype.hasOwnProperty.call(bands, band.host)
            ? bands[band.host]
            : `<div class="location-inert" data-inert="no view is registered as \`${escapeAttr(band.host)}'"></div>`);
      placed.push(`<div data-ui="${escapeAttr(band.name)}" data-host="${escapeAttr(band.host)}"`
                + `${band.style ? ` style="${escapeAttr(band.style)}"` : ""}>${markup}</div>`);
    }
    for (const [host, markup] of Object.entries(bands)) {
      if (!seen.has(host)) placed.push(`<div data-host="${escapeAttr(host)}" data-unplaced="">${markup}</div>`);
    }
    const style = workspace.rootStyle || "display:grid";
    return `
      <div id="chrome" data-ui="${escapeAttr(workspace.root || "w-chrome")}" style="${escapeAttr(style)}">
        ${placed.join("\n        ")}
      </div>
    `;
  }
}
