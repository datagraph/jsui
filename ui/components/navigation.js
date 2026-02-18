import { joinHtml } from "../utils.js";

export class NavigationView {
  render({ navLinks, session }) {
    const loggedIn = session?.isLoggedIn();
    return `
      <div id="nav">
        <ul id="dydra-header-logged-out" class="nav" style="${loggedIn ? "display:none" : ""}">
          ${joinHtml(navLinks.loggedOut.map((link) => `<li>${link}</li>`))}
        </ul>
        <ul id="dydra-header-logged-in" class="nav" style="${loggedIn ? "" : "display:none"}">
          ${joinHtml(navLinks.loggedIn.map((link) => `<li>${link}</li>`))}
        </ul>
        <ul class="nav">
          ${joinHtml(navLinks.global.map((link) => `<li>${link}</li>`))}
        </ul>
      </div>
    `;
  }
}
