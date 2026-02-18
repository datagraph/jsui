import { NavigationView } from "./navigation.js";

export class HeaderView {
  constructor() {
    this.navigation = new NavigationView();
  }

  render({ navLinks, session }) {
    return `
      <div id="header">
        <div class="wrapper">
          <a href="/" id="logo">Dydra</a>
          ${this.navigation.render({ navLinks, session })}
        </div>
      </div>
    `;
  }
}
