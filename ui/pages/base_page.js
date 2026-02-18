export class BasePage {
  constructor({ state, params = {} } = {}) {
    this.state = state;
    this.params = params;
    this.context = {};
  }

  getTitle() {
    return "Dydra";
  }

  getBodyClass() {
    return "";
  }

  setContext(context = {}) {
    this.context = context;
  }

  async renderContent() {
    return "";
  }

  async renderSidebar() {
    return "";
  }

  async afterRender() {
    return;
  }

  async getPaneTabs() {
    return null;
  }

  useHomeLayout() {
    return false;
  }
}
