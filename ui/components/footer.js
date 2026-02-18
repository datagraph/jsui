import { joinHtml } from "../utils.js";

export class FooterView {
  render({ navLinks, session, appVersion = "" }) {
    const loggedIn = session?.isLoggedIn();
    return `
      <div id="footer">
        <div class="wrapper">
          <p id="copyright">
            A product of
            <a href="http://datagraph.org/">Datagraph, GmbH</a>
            ${joinHtml(navLinks.global.map((link) => `&nbsp;&bull;&nbsp;<span>${link}</span>`))}
            <span id="dydra-footer-logged-in" style="${loggedIn ? "" : "display:none"}">
              ${joinHtml(navLinks.loggedIn.map((link) => `&nbsp;&bull;&nbsp;<span>${link}</span>`))}
            </span>
            <span id="dydra-footer-logged-out" style="${loggedIn ? "display:none" : ""}">
              ${joinHtml(navLinks.loggedOut.map((link) => `&nbsp;&bull;&nbsp;<span>${link}</span>`))}
            </span>
            &nbsp;&bull;&nbsp;
            <span><a href="https://dydra.com/legal" target="legal">Legal</a></span>
          </p>
          <p id="footer-links">
            ${appVersion ? `Software revision <span>${appVersion}</span>` : ""}
            ${appVersion ? "" : `
              <a href="https://github.com/dydra/support/blob/master/README.rst#readme">Support</a>
              &nbsp;&bull;&nbsp;
              <a href="https://github.com/dydra">GitHub</a>
              &nbsp;&bull;&nbsp;
              <a href="http://twitter.com/dydradata">Twitter</a>
              &nbsp;&bull;&nbsp;
              <a href="http://feeds.feedburner.com/dydra">RSS</a>
            `}
          </p>
        </div>
      </div>
      <div id="waitMessage" style="display:none">
        <img src="/images/loading_large.gif" alt="Loading" />
        <div class="message">Loading...</div>
      </div>
    `;
  }
}
