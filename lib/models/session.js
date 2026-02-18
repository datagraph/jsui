const STORAGE_KEY = "dydra.session";

export class Session {
  constructor() {
    this.accountName = null;
    this._hasToken = false;  // In-memory only, not persisted
  }

  load() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      // Only restore accountName for pre-filling login form, not for auth state
      this.accountName = stored?.accountName || null;
    } catch (error) {
      this.accountName = null;
    }
    // Token state is never persisted - always start logged out
    this._hasToken = false;
  }

  save() {
    // Only persist accountName (for convenience in login form), never token state
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountName: this.accountName }));
  }

  login(accountName) {
    this.accountName = accountName;
    this._hasToken = true;
    this.save();
  }

  logout() {
    this._hasToken = false;
    // Keep accountName for login form pre-fill, but clear token state
    this.save();
  }

  isLoggedIn() {
    // Must have both accountName AND a valid token (in-memory)
    return Boolean(this.accountName && this._hasToken);
  }
}
