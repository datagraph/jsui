export class AuthStore {
  constructor() {
    this.state = { tokens: {} };
  }

  getToken(accountName) {
    return this.state.tokens[accountName]?.token || null;
  }

  getConfig(accountName) {
    return this.state.tokens[accountName]?.config || null;
  }

  getAuth(accountName) {
    return this.state.tokens[accountName] || null;
  }

  setAuth(accountName, token, config = {}, host = "") {
    this.state.tokens[accountName] = { token, config, host };
  }

  listAccounts() {
    return Object.keys(this.state.tokens);
  }

  clear() {
    this.state.tokens = {};
  }

  clearAccount(accountName) {
    if (accountName && this.state.tokens[accountName]) {
      delete this.state.tokens[accountName];
    }
  }
}
