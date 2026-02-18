import { BasePage } from "../pages/base_page.js";
import { escapeHtml, joinHtml } from "../utils.js";
import { APP_CONFIG } from "../../lib/config.js";
import { authenticateAccount } from "../../lib/auth.js";

const BASE_PATH = APP_CONFIG.basePath || "";
const ADMIN_PATH = `${BASE_PATH}/admin`;

// --- Helper: get auth context for current session ---

const getAuth = (state) => {
  const accountName = state.session?.accountName;
  if (!accountName) return null;
  return state.authStore.getAuth(accountName);
};

// --- Login ---

export class AdminLoginPage extends BasePage {
  getTitle() {
    return "Admin Login";
  }

  getBodyClass() {
    return "devise sessions new";
  }

  async renderContent() {
    let lastUsername = "";
    try {
      const stored = JSON.parse(window.localStorage.getItem("dydra.session"));
      lastUsername = stored?.accountName || "";
    } catch (e) { /* ignore */ }

    return `
      <div id="login-error" class="widget" style="display:none;">
        <div class="alert-error rounded">
          <p class="message">
            <span class="icon icon-alert"></span>
            <span id="login-error-text"></span>
          </p>
        </div>
      </div>
      <form id="inline-login-form" class="formtastic" onsubmit="return false;" data-testid="admin-login-form">
        <fieldset class="inputs">
          <ol>
            <li class="string optional"><label>Host</label><input type="text" name="host" placeholder="dydra.com" data-testid="admin-login-host-input" /></li>
            <li class="string optional"><label>Username</label><input type="text" name="login" value="${escapeHtml(lastUsername)}" data-testid="admin-login-username-input" /></li>
            <li class="password optional"><label>Password or Token</label><input type="password" name="password" data-testid="admin-login-password-input" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Log in" data-testid="admin-login-submit" /></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async afterRender() {
    const app = this.context?.app;
    const form = document.getElementById("inline-login-form");
    const errorBox = document.getElementById("login-error");
    const errorText = document.getElementById("login-error-text");
    if (!form || !app) return;

    const hostField = form.querySelector('[name="host"]');
    if (hostField) {
      hostField.value = new URLSearchParams(window.location.search).get("host") || window.location.host;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const host = form.querySelector('[name="host"]').value;
      const accountName = form.querySelector('[name="login"]').value;
      const secret = form.querySelector('[name="password"]').value;

      if (errorBox) errorBox.style.display = "none";
      app.showLocationMessage?.("Authenticating\u2026", 30000);

      try {
        // Step 1: authenticate
        const result = await authenticateAccount({ host, accountName, secret });

        app.showLocationMessage?.("Checking privileges\u2026", 30000);

        // Step 2: check admin privileges (but allow any authenticated user)
        let isAdmin = false;
        try {
          const userConfigUrl = `${result.baseUrl}/system/users/${encodeURIComponent(accountName)}/configuration`;
          const userResp = await fetch(userConfigUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${result.token}`,
            },
          });

          if (userResp.ok) {
            const userConfig = await userResp.json();
            isAdmin = userConfig.administrator_of === "http://dydra.com"
              || (Array.isArray(userConfig.administrator_of) && userConfig.administrator_of.includes("http://dydra.com"));
          }
        } catch (e) {
          console.warn("Could not determine admin status:", e.message);
        }

        // Store auth, admin status, and navigate
        app.state.authStore.setAuth(accountName, result.token, result.config, result.baseUrl);
        app.state.session.login(accountName);
        app.state.isAdmin = isAdmin;
        // Navigate first, then show success message after page renders
        const roleLabel = isAdmin ? "admin" : "user";
        const successMessage = `Authenticated as ${accountName} (${roleLabel})`;
        app.router.navigate("/");
        setTimeout(() => {
          app.showLocationMessage?.(successMessage, 3000);
        }, 100);
      } catch (error) {
        app.showLocationMessage?.(error.message || "Login failed.", 5000);
        if (errorBox && errorText) {
          errorBox.style.display = "block";
          errorText.textContent = error.message || "Login failed.";
        }
      }
    });
  }
}

// --- Dashboard with Tabs ---

export class AdminDashboardPage extends BasePage {
  constructor(options) {
    super(options);
    // Track which accounts are checked for repository filtering
    this.checkedAccounts = new Set();
    // Track which repositories are checked
    this.checkedRepos = new Set();
    // Sort state for query history
    this.queryHistorySort = { column: "timestamp", ascending: false };
    // Sort state for transaction history
    this.transactionHistorySort = { column: "timestamp", ascending: false };
    // Sort state for import history
    this.importHistorySort = { column: "timestamp", ascending: false };
    // Paging state for import history
    this.importHistoryPaging = { offset: 0, limit: 100 };
  }

  getTitle() {
    return "Administration";
  }

  getBodyClass() {
    return "application admin";
  }

  async getPaneTabs() {
    return {
      bar: `
        <div class="pane-tabs-bar">
          <ul data-tab-list>
            <li><a href="#admin-accounts" data-tab-link data-show-aside="true"><span class="tab-label">Accounts</span></a></li>
            <li><a href="#admin-repositories" data-tab-link data-show-aside="true"><span class="tab-label">Repositories</span></a></li>
            <li><a href="#admin-invitations" data-tab-link data-show-aside="true"><span class="tab-label">Invitations</span></a></li>
            <li><a href="#admin-query-history" data-tab-link data-show-aside="true"><span class="tab-label">Query History</span></a></li>
            <li><a href="#admin-transaction-history" data-tab-link data-show-aside="true"><span class="tab-label">Transaction History</span></a></li>
            <li><a href="#admin-import-history" data-tab-link data-show-aside="true"><span class="tab-label">Import History</span></a></li>
          </ul>
        </div>
      `,
      defaultTab: "#admin-accounts",
    };
  }

  async renderContent() {
    // Render empty panes - content will be loaded lazily when tab is selected
    return `
      <div id="admin-accounts" class="admin-pane" data-lazy="accounts"><p>Loading...</p></div>
      <div id="admin-repositories" class="admin-pane" data-lazy="repositories"><p>Loading...</p></div>
      <div id="admin-invitations" class="admin-pane" data-lazy="invitations"><p>Loading...</p></div>
      <div id="admin-query-history" class="admin-pane" data-lazy="query-history"><p>Loading...</p></div>
      <div id="admin-transaction-history" class="admin-pane" data-lazy="transaction-history"><p>Loading...</p></div>
      <div id="admin-import-history" class="admin-pane" data-lazy="import-history"><p>Loading...</p></div>
    `;
  }

  async renderSidebar() {
    return ""; // No sidebar for admin dashboard
  }

  async loadPaneContent(paneId, auth) {
    const pane = document.getElementById(paneId);
    if (!pane) return;

    const lazyType = pane.dataset.lazy;

    // For query-history: invalidate if the repo selection changed since last load
    if (lazyType === "query-history" && pane.dataset.loaded === "true") {
      const currentRepoKey = Array.from(this.checkedRepos).sort().join(",");
      if (currentRepoKey !== this._queryHistoryRepoSnapshot) {
        pane.dataset.loaded = "false";
      }
    }

    if (pane.dataset.loaded === "true") return;

    let content = "";

    try {
      switch (lazyType) {
        case "accounts":
          content = await this.renderAccountsPane(auth);
          break;
        case "repositories":
          content = await this.renderRepositoriesPane(auth);
          break;
        case "invitations":
          content = await this.renderInvitationsPane();
          break;
        case "query-history":
          content = await this.renderQueryHistoryPane(auth);
          break;
        case "transaction-history":
          content = await this.renderTransactionHistoryPane(auth);
          break;
        case "import-history":
          content = await this.renderImportHistoryPane(auth);
          break;
        default:
          content = "<p>Unknown pane type</p>";
      }
    } catch (e) {
      content = `<p>Error loading content: ${escapeHtml(e.message)}</p>`;
    }

    pane.innerHTML = content;
    pane.dataset.loaded = "true";

    // Snapshot the repo selection used for this query-history load
    if (lazyType === "query-history") {
      this._queryHistoryRepoSnapshot = Array.from(this.checkedRepos).sort().join(",");
    }

    // Attach handlers for the newly loaded content
    this.attachPaneHandlers(lazyType, auth);
  }

  async renderAccountsPane(auth) {
    if (!auth) return "<p>Not authenticated.</p>";

    const url = `${auth.host}/system/accounts?_=${Date.now()}`;
    const resp = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
        "Cache-Control": "no-cache",
      },
    });

    if (!resp.ok) {
      return `<p>Error loading accounts: ${resp.status}</p>`;
    }

    const data = await resp.json();
    // Handle array of objects with id field, array of strings, or object with keys
    const accounts = Array.isArray(data)
      ? data.map((item) => typeof item === "string" ? item : (item.id || item.name || item.friendlyId))
      : Object.keys(data);
    // Sort alphabetically (case-insensitive)
    accounts.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const isAdmin = this.context?.app?.state?.isAdmin;
    return `
      <h2>
        <span class="action">
          <button type="button" class="admin-refresh-accounts-btn" data-testid="admin-refresh-accounts-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
          ${isAdmin ? `<button type="button" class="admin-new-account-btn" data-testid="admin-new-account-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">New</button>` : ""}
        </span>
        Accounts
      </h2>
      <div class="scrollable-list" style="max-height:400px;overflow-y:auto;border:1px solid #ccc;">
        <table class="admin" style="width:100%;">
          <thead style="position:sticky;top:0;background:#eee;z-index:1;">
            <tr>
              <th style="width:30px;"><input type="checkbox" class="account-checkbox-all" title="Check/uncheck all" /></th>
              <th>Account</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${accounts.map((name, i) => `
              <tr class="${i % 2 === 0 ? "even" : "odd"}">
                <td><input type="checkbox" class="account-checkbox" data-account="${escapeHtml(name)}" ${this.checkedAccounts.has(name) ? "checked" : ""} /></td>
                <td><a href="${BASE_PATH}/account/${encodeURIComponent(name)}" data-external>${escapeHtml(name)}</a></td>
                <td class="actions">
                  <a href="#" class="account-details" data-account="${escapeHtml(name)}">Details</a>
                  ${isAdmin ? `<button type="button" class="account-delete-btn" data-account="${escapeHtml(name)}" data-testid="admin-account-delete-btn-${escapeHtml(name)}" style="background:transparent;border:none;padding:4px;cursor:pointer;margin-left:8px;vertical-align:middle;" title="Delete Account">
                    <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width:16px;height:16px;opacity:0.6;" />
                  </button>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  async renderRepositoriesPane(auth) {
    if (!auth) return "<p>Not authenticated.</p>";

    const isAdmin = this.context?.app?.state?.isAdmin;
    // Only fetch repositories for checked accounts
    const checkedAccountsList = Array.from(this.checkedAccounts);
    if (checkedAccountsList.length === 0) {
      return `
        <h2>
          <span class="action">
            <button type="button" class="admin-refresh-repos-btn" data-testid="admin-refresh-repos-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
            ${isAdmin ? `<button type="button" class="admin-new-repo-btn" data-testid="admin-new-repo-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">New</button>` : ""}
          </span>
          Repositories
        </h2>
        <p>No accounts selected. Check accounts in the Accounts tab to see their repositories.</p>
      `;
    }

    // Get repositories for each checked account
    const rows = [];
    for (const accountName of checkedAccountsList) {
      try {
        const reposUrl = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories?_=${Date.now()}`;
        const reposResp = await fetch(reposUrl, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.token}`,
            "Cache-Control": "no-cache",
          },
        });
        if (reposResp.ok) {
          const reposData = await reposResp.json();
          // Handle array of objects with id field, array of strings, or object with keys
          const repoNames = Array.isArray(reposData)
            ? reposData.map((item) => typeof item === "string" ? item : (item.id || item.name || item.friendlyId))
            : Object.keys(reposData);
          for (const repoName of repoNames) {
            rows.push({ accountName, repoName });
          }
        }
      } catch (e) { /* skip */ }
    }

    // Sort by account/repo path
    rows.sort((a, b) => {
      const pathA = `${a.accountName}/${a.repoName}`.toLowerCase();
      const pathB = `${b.accountName}/${b.repoName}`.toLowerCase();
      return pathA.localeCompare(pathB);
    });

    // Store rows for query history filtering
    this._lastRepoRows = rows;

    return `
      <h2>
        <span class="action">
          <button type="button" class="admin-refresh-repos-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
          ${isAdmin ? `<button type="button" class="admin-new-repo-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">New</button>` : ""}
        </span>
        Repositories
      </h2>
      <div class="scrollable-list" style="max-height:400px;overflow-y:auto;border:1px solid #ccc;">
        <table class="admin" style="width:100%;">
          <thead style="position:sticky;top:0;background:#eee;z-index:1;">
            <tr>
              <th style="width:30px;"><input type="checkbox" class="repo-checkbox-all" title="Check/uncheck all" /></th>
              <th>Repository</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => {
              const repoKey = `${r.accountName}/${r.repoName}`;
              return `
              <tr class="${i % 2 === 0 ? "even" : "odd"}">
                <td><input type="checkbox" class="repo-checkbox" data-account="${escapeHtml(r.accountName)}" data-repo="${escapeHtml(r.repoName)}" ${this.checkedRepos.has(repoKey) ? "checked" : ""} /></td>
                <td><a href="${BASE_PATH}/account/${encodeURIComponent(r.accountName)}/repositories/${encodeURIComponent(r.repoName)}" data-external>${escapeHtml(r.accountName)}/${escapeHtml(r.repoName)}</a></td>
                <td class="actions">
                  <a href="${BASE_PATH}/account/${encodeURIComponent(r.accountName)}/repositories/${encodeURIComponent(r.repoName)}" data-external>View</a>
                  ${isAdmin ? `<button type="button" class="repo-delete-btn" data-account="${escapeHtml(r.accountName)}" data-repo="${escapeHtml(r.repoName)}" data-testid="admin-repo-delete-btn-${escapeHtml(r.accountName)}-${escapeHtml(r.repoName)}" style="background:transparent;border:none;padding:4px;cursor:pointer;margin-left:8px;vertical-align:middle;" title="Delete Repository">
                    <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width:16px;height:16px;opacity:0.6;" />
                  </button>` : ""}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  async renderInvitationsPane() {
    const isAdmin = this.context?.app?.state?.isAdmin;
    const invitations = await this.state.listInvitations();
    return `
      <h2>
        ${isAdmin ? `<span class="action"><button type="button" class="admin-new-invite-btn" data-testid="admin-new-invite-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">New</button></span>` : ""}
        Invitations
      </h2>
      <table class="admin">
        <tr><th>Email</th><th>Referred Via</th><th>Invite Code</th><th>Account</th>${isAdmin ? "<th>&nbsp;</th>" : ""}</tr>
        ${joinHtml(invitations.map((inv, i) => `
          <tr class="${i % 2 === 0 ? "even" : "odd"}">
            <td>${escapeHtml(inv.email)}</td>
            <td>${escapeHtml(inv.httpReferrer || "")}</td>
            <td>${escapeHtml(inv.inviteCode || "")}</td>
            <td>${inv.accountName ? `<a href="${BASE_PATH}/account/${escapeHtml(inv.accountName)}" data-external>${escapeHtml(inv.accountName)}</a>` : ""}</td>
            ${isAdmin ? `<td class="actions">
              <a href="#" class="invite-send" data-email="${escapeHtml(inv.email)}">Send</a> |
              <a href="#" class="invite-delete" data-email="${escapeHtml(inv.email)}">Delete</a>
            </td>` : ""}
          </tr>
        `))}
      </table>
    `;
  }

  renderHistoryStub(title) {
    return `
      <h2>${escapeHtml(title)}</h2>
      <p>History data will be displayed here when the API endpoint is available.</p>
    `;
  }

  // Helper: Round to next power of ten
  roundToPowerOfTen(value) {
    if (value <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
  }

  // Helper: Parse timestamp to Date
  parseTimestamp(ts) {
    if (!ts) return null;
    const date = new Date(ts);
    return isNaN(date.getTime()) ? null : date;
  }

  // Helper: Render SVG graph
  renderGraph({ entries, xField, yField, yLabel, width = 800, height = 300, padding = { top: 20, right: 40, bottom: 60, left: 60 }, clickable = false, getClickData = null, useLogScale = false }) {
    if (!entries || entries.length === 0) {
      return `<div style="margin:20px 0;padding:20px;border:1px solid #ddd;background:#f9f9f9;text-align:center;color:#666;">No data available for graph</div>`;
    }

    // Extract and parse data points
    const dataPoints = [];
    for (const entry of entries) {
      const timestamp = this.parseTimestamp(entry[xField]);
      const yValue = Number(entry[yField]) || 0;
      if (timestamp) {
        dataPoints.push({ timestamp, yValue, entry });
      }
    }

    if (dataPoints.length === 0) {
      return `<div style="margin:20px 0;padding:20px;border:1px solid #ddd;background:#f9f9f9;text-align:center;color:#666;">No valid timestamps found</div>`;
    }

    // Sort by timestamp
    dataPoints.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate scales - ensure timestamps are numbers (milliseconds)
    const minTime = dataPoints[0].timestamp instanceof Date ? dataPoints[0].timestamp.getTime() : Number(dataPoints[0].timestamp);
    const maxTime = dataPoints[dataPoints.length - 1].timestamp instanceof Date ? dataPoints[dataPoints.length - 1].timestamp.getTime() : Number(dataPoints[dataPoints.length - 1].timestamp);
    
    // Y-axis scaling
    let maxY, minY, roundedMaxY, roundedMinY;
    if (useLogScale) {
      const yValues = dataPoints.map(d => d.yValue).filter(v => v > 0);
      if (yValues.length === 0) {
        return `<div style="margin:20px 0;padding:20px;border:1px solid #ddd;background:#f9f9f9;text-align:center;color:#666;">No positive values for log scale</div>`;
      }
      minY = Math.min(...yValues);
      maxY = Math.max(...yValues);
      roundedMinY = Math.pow(10, Math.floor(Math.log10(minY)));
      roundedMaxY = Math.pow(10, Math.ceil(Math.log10(maxY)));
    } else {
      maxY = Math.max(...dataPoints.map(d => d.yValue), 1);
      minY = 0;
      roundedMaxY = this.roundToPowerOfTen(maxY);
      roundedMinY = 0;
    }

    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    const timeRange = maxTime - minTime;
    const xScale = (time) => {
      if (timeRange === 0) {
        // Single point or all same timestamp - center it
        return padding.left + graphWidth / 2;
      }
      return padding.left + ((time - minTime) / timeRange) * graphWidth;
    };
    
    const yScale = (value) => {
      if (useLogScale) {
        if (value <= 0) return padding.top + graphHeight;
        const logMin = Math.log10(roundedMinY);
        const logMax = Math.log10(roundedMaxY);
        const logValue = Math.log10(value);
        const normalized = (logValue - logMin) / (logMax - logMin);
        return padding.top + graphHeight - (normalized * graphHeight);
      } else {
        if (roundedMaxY === 0) return padding.top + graphHeight / 2;
        return padding.top + graphHeight - (value / roundedMaxY) * graphHeight;
      }
    };

    // Generate Y-axis labels
    let yTickValues = [];
    if (useLogScale) {
      const logMin = Math.log10(roundedMinY);
      const logMax = Math.log10(roundedMaxY);
      const logRange = logMax - logMin;
      const numTicks = Math.min(6, Math.ceil(logRange) + 1);
      for (let i = 0; i < numTicks; i++) {
        const logValue = logMin + (logRange / (numTicks - 1)) * i;
        yTickValues.push(Math.pow(10, logValue));
      }
    } else {
      const yTicks = 5;
      for (let i = 0; i <= yTicks; i++) {
        yTickValues.push((roundedMaxY / yTicks) * i);
      }
    }

    // Generate time grid markers
    const generateTimeGrid = (minTime, maxTime) => {
      const rangeMs = maxTime - minTime;
      if (rangeMs === 0) {
        const singleDate = new Date(minTime);
        return { 
          gridTimes: [minTime], 
          formatFunc: (date) => {
            const d = new Date(date);
            return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
          }, 
          labelFormat: "" 
        };
      }
      
      const rangeMinutes = rangeMs / (1000 * 60);
      const rangeHours = rangeMs / (1000 * 60 * 60);
      const rangeDays = rangeMs / (1000 * 60 * 60 * 24);
      const rangeYears = rangeDays / 365.25;
      
      let intervalMs, formatFunc, labelFormat;
      
      // Check for year-spanning ranges first (>= 365 days)
      if (rangeDays >= 365) {
        // Use 6-month intervals (January and June) for year-spanning ranges
        const minDate = new Date(minTime);
        const maxDate = new Date(maxTime);
        
        // Find the most recent January or June at or before minTime
        let startYear = minDate.getFullYear();
        let startMonth = minDate.getMonth(); // 0-11
        
        // Determine starting point: if we're in Jan-Jun, use Jan; if Jul-Dec, use Jun
        if (startMonth < 6) {
          // Jan-Jun: use January of current year
          startMonth = 0;
        } else {
          // Jul-Dec: use June of current year
          startMonth = 5;
        }
        
        const gridTimes = [];
        let currentDate = new Date(startYear, startMonth, 1, 0, 0, 0, 0);
        
        // If current date is after minTime, we need to go back to the previous interval
        if (currentDate.getTime() > minTime) {
          if (startMonth === 0) {
            // We're at Jan but minTime is before it, go to June of previous year
            currentDate = new Date(startYear - 1, 5, 1, 0, 0, 0, 0);
          } else {
            // We're at Jun but minTime is before it, go to January of current year
            currentDate = new Date(startYear, 0, 1, 0, 0, 0, 0);
          }
        }
        
        // Generate markers at January and June until we're past maxTime
        // Include a bit of padding to ensure we cover the range
        const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
        // Ensure maxTime and minTime are numbers (timestamps in milliseconds)
        const maxTimeNum = typeof maxTime === 'number' ? maxTime : (maxTime instanceof Date ? maxTime.getTime() : Number(maxTime));
        const minTimeNum = typeof minTime === 'number' ? minTime : (minTime instanceof Date ? minTime.getTime() : Number(minTime));
        const maxTimeWithPadding = maxTimeNum + sixMonthsMs;
        
        // Generate markers at January and June until we're past maxTime
        while (currentDate.getTime() <= maxTimeWithPadding) {
          // Always include the marker (we'll filter in rendering if needed)
          gridTimes.push(currentDate.getTime());
          
          // Move to next 6-month interval (January -> June, June -> January)
          if (currentDate.getMonth() === 0) {
            // January -> June of same year
            currentDate = new Date(currentDate.getFullYear(), 5, 1, 0, 0, 0, 0);
          } else {
            // June -> January of next year
            currentDate = new Date(currentDate.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
          }
        }
        
        // Sort to ensure proper order
        gridTimes.sort((a, b) => a - b);
        
        // Ensure we have at least 2 markers
        if (gridTimes.length === 0) {
          gridTimes.push(minTimeNum);
          gridTimes.push(maxTimeNum);
        }
        
        formatFunc = (date) => {
          const d = new Date(date);
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        };
        labelFormat = "6 Months";
        
        return { gridTimes, formatFunc, labelFormat };
      } else if (rangeDays >= 7) {
        // Use days - try to get about 5-10 markers
        const targetMarkers = Math.min(10, Math.max(5, Math.ceil(rangeDays / 7)));
        const daysPerMarker = Math.max(1, Math.ceil(rangeDays / targetMarkers));
        intervalMs = daysPerMarker * 24 * 60 * 60 * 1000;
        formatFunc = (date) => {
          const d = new Date(date);
          return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)}`;
        };
        labelFormat = "Days";
      } else if (rangeHours >= 12) {
        // Use hours - try to get about 5-10 markers
        const targetMarkers = Math.min(10, Math.max(5, Math.ceil(rangeHours / 12)));
        const hoursPerMarker = Math.max(1, Math.ceil(rangeHours / targetMarkers));
        intervalMs = hoursPerMarker * 60 * 60 * 1000;
        formatFunc = (date) => {
          const d = new Date(date);
          const month = d.getMonth() + 1;
          const day = d.getDate();
          const hour = d.getHours();
          return `${month}/${day} ${hour}:00`;
        };
        labelFormat = "Hours";
      } else if (rangeMinutes >= 1) {
        // Use minutes - try to get about 5-10 markers
        const targetMarkers = Math.min(10, Math.max(5, Math.ceil(rangeMinutes / 15)));
        const minutesPerMarker = Math.max(1, Math.ceil(rangeMinutes / targetMarkers));
        // Round to nice intervals: 1, 5, 10, 15, 30, 60
        let niceInterval = minutesPerMarker;
        if (minutesPerMarker <= 1) niceInterval = 1;
        else if (minutesPerMarker <= 5) niceInterval = 5;
        else if (minutesPerMarker <= 10) niceInterval = 10;
        else if (minutesPerMarker <= 15) niceInterval = 15;
        else if (minutesPerMarker <= 30) niceInterval = 30;
        else niceInterval = 60;
        intervalMs = niceInterval * 60 * 1000;
        const capturedInterval = niceInterval; // Capture for closure
        formatFunc = (date) => {
          const d = new Date(date);
          const hour = d.getHours();
          const minutes = Math.floor(d.getMinutes() / capturedInterval) * capturedInterval;
          return `${hour}:${minutes.toString().padStart(2, '0')}`;
        };
        labelFormat = "Minutes";
      } else {
        // Very short range - use seconds or show at least start and end
        intervalMs = Math.max(1000, rangeMs / 5); // At least 5 markers
        formatFunc = (date) => {
          const d = new Date(date);
          return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
        };
        labelFormat = "Seconds";
      }
      
      // Round minTime down to nearest interval
      const startTime = Math.floor(minTime / intervalMs) * intervalMs;
      const gridTimes = [];
      for (let t = startTime; t <= maxTime + intervalMs; t += intervalMs) {
        gridTimes.push(t);
      }
      
      // Ensure we have at least 2 markers (start and end)
      if (gridTimes.length < 2) {
        gridTimes.push(minTime);
        gridTimes.push(maxTime);
        gridTimes.sort((a, b) => a - b);
      }
      
      return { gridTimes, formatFunc, labelFormat };
    };
    
    let { gridTimes, formatFunc } = generateTimeGrid(minTime, maxTime);
    
    // Ensure we have at least start and end markers if gridTimes is empty or formatFunc is missing
    if (!gridTimes || gridTimes.length === 0 || !formatFunc) {
      gridTimes = [minTime, maxTime];
      formatFunc = (date) => {
        const d = new Date(date);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
      };
    }

    // Format timestamp for display
    const formatTime = (date) => {
      return date.toISOString().replace('T', ' ').substring(0, 19);
    };

    // Generate SVG
    let svg = `<svg width="${width}" height="${height}" style="border:1px solid #ddd;background:#fff;margin:20px 0;" xmlns="http://www.w3.org/2000/svg">`;

    // Draw Y-axis grid lines
    for (const tick of yTickValues) {
      const y = yScale(tick);
      svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1" />`;
    }

    // Draw X-axis grid lines (time markers)
    if (gridTimes && gridTimes.length > 0) {
      for (const gridTime of gridTimes) {
        // Ensure gridTime is a number
        const gridTimeNum = typeof gridTime === 'number' ? gridTime : (gridTime instanceof Date ? gridTime.getTime() : Number(gridTime));
        const x = xScale(gridTimeNum);
        // Draw grid lines for all times within the graph area
        // Use a wider range to ensure we catch all relevant markers
        if (x >= padding.left - 5 && x <= width - padding.right + 5) {
          svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#c0c0c0" stroke-width="1.5" />`;
        }
      }
    }

    // Draw axes
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#333" stroke-width="2" />`;
    svg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#333" stroke-width="2" />`;

    // Draw Y-axis labels
    for (const tick of yTickValues) {
      const y = yScale(tick);
      let label;
      if (useLogScale) {
        if (tick >= 1000000) {
          label = `${(tick / 1000000).toFixed(1)}M`;
        } else if (tick >= 1000) {
          label = `${(tick / 1000).toFixed(1)}K`;
        } else {
          label = tick.toString();
        }
      } else {
        label = tick >= 1000000 ? `${(tick / 1000000).toFixed(1)}M` : tick >= 1000 ? `${(tick / 1000).toFixed(1)}K` : tick.toString();
      }
      svg += `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#666">${escapeHtml(label)}</text>`;
    }

    // Draw X-axis labels (time grid markers)
    if (gridTimes && gridTimes.length > 0 && formatFunc) {
      const labelY = height - padding.bottom + 18;
      for (const gridTime of gridTimes) {
        // Ensure gridTime is a number
        const gridTimeNum = typeof gridTime === 'number' ? gridTime : (gridTime instanceof Date ? gridTime.getTime() : Number(gridTime));
        const x = xScale(gridTimeNum);
        // Draw labels that are within or near the visible range
        // Use a wider range to ensure we catch all relevant labels
        if (x >= padding.left - 20 && x <= width - padding.right + 20) {
          try {
            const date = new Date(gridTimeNum);
            if (!isNaN(date.getTime())) {
              const label = formatFunc(date);
              if (label && label.trim()) {
                svg += `<text x="${x}" y="${labelY}" text-anchor="middle" font-size="12" fill="#000" dominant-baseline="hanging" font-weight="normal">${escapeHtml(label)}</text>`;
              }
            }
          } catch (e) {
            // Skip invalid dates - but log for debugging
            console.warn("Error formatting grid time:", gridTimeNum, e);
          }
        }
      }
    }

    // Draw Y-axis label
    svg += `<text x="${padding.left - 30}" y="${height / 2}" text-anchor="middle" font-size="12" fill="#333" transform="rotate(-90 ${padding.left - 30} ${height / 2})">${escapeHtml(yLabel)}</text>`;
    
    // Draw X-axis label (Time)
    svg += `<text x="${(padding.left + width - padding.right) / 2}" y="${height - 5}" text-anchor="middle" font-size="12" fill="#333">Time</text>`;

    // Draw data points and lines
    let pathData = '';
    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      const x = xScale(point.timestamp);
      const y = yScale(point.yValue);
      
      if (i === 0) {
        pathData = `M ${x} ${y}`;
      } else {
        pathData += ` L ${x} ${y}`;
      }

      // Draw point
      if (clickable && getClickData) {
        const clickData = getClickData(point.entry);
        const timestampStr = point.timestamp ? new Date(point.timestamp).toISOString() : '';
        svg += `<circle cx="${x}" cy="${y}" r="2" fill="#0066cc" stroke="#fff" stroke-width="0.5" style="cursor:pointer;" class="graph-point" data-account="${escapeHtml(clickData.account || '')}" data-signature="${escapeHtml(clickData.signature || '')}" data-timestamp="${escapeHtml(timestampStr)}" data-repository="${escapeHtml(clickData.repository || '')}" />`;
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="1.5" fill="#0066cc" />`;
      }
    }

    // Draw line
    svg += `<path d="${pathData}" fill="none" stroke="#0066cc" stroke-width="1" />`;

    svg += `</svg>`;
    return svg;
  }

  async renderQueryHistoryPane(auth) {
    if (!auth) return "<p>Not authenticated.</p>";

    // Determine which repositories to query - use checked repos, or all checked accounts' repos
    const reposToQuery = [];
    if (this.checkedRepos.size > 0) {
      for (const key of this.checkedRepos) {
        const [accountName, repoName] = key.split("/");
        reposToQuery.push({ accountName, repoName });
      }
    } else {
      return `
        <h2>
          <span class="action">
            <button type="button" class="admin-refresh-query-history-btn" data-testid="admin-refresh-query-history-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
          </span>
          Query History
        </h2>
        <p>No repositories selected. Check repositories in the Repositories tab to see their query history.</p>
      `;
    }

    // Fetch service_history for each selected repository
    const allEntries = [];
    for (const { accountName, repoName } of reposToQuery) {
      try {
        const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repoName)}/service_history?_=${Date.now()}`;
        const resp = await fetch(url, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.token}`,
            "Cache-Control": "no-cache",
          },
        });
        if (resp.ok) {
          const contentType = resp.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await resp.json();
            if (Array.isArray(data)) {
              allEntries.push(...data);
            }
          }
        }
      } catch (e) { /* skip */ }
    }

    // Sort entries
    this.sortQueryHistoryEntries(allEntries);

    const sortIndicator = (col) => {
      if (this.queryHistorySort.column !== col) return "";
      return this.queryHistorySort.ascending ? " \u25B2" : " \u25BC";
    };

    // Render graph - convert run_time from ms to seconds
    const graphHtml = allEntries.length > 0 ? this.renderGraph({
      entries: allEntries.map(entry => ({
        ...entry,
        run_time: entry.run_time ? entry.run_time / 1000 : 0 // Convert ms to seconds
      })),
      xField: "timestamp",
      yField: "run_time",
      yLabel: "Run Time (s)",
      clickable: true,
      getClickData: (entry) => ({ account: entry.account, signature: entry.signature, repository: entry.repository })
    }) : "";

    return `
      <h2>
        <span class="action">
          <button type="button" class="admin-refresh-query-history-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
        </span>
        Query History
      </h2>
      <div class="history-tabs-container">
        <div class="history-tabs-bar">
          <button type="button" class="history-tab active" data-history-tab="table" title="Table">
            <img src="${BASE_PATH}/images/logs.svg" alt="Table" width="16" height="16" />
          </button>
          <button type="button" class="history-tab" data-history-tab="graph" title="Graph">
            <img src="${BASE_PATH}/images/chart-line.svg" alt="Graph" width="16" height="16" />
          </button>
        </div>
        <div class="history-tab-content" data-history-content="table" style="display:block;">
          <div class="scrollable-list" style="max-height:400px;overflow-y:auto;border:1px solid #ccc;">
            <table class="admin" style="width:100%;">
              <thead style="position:sticky;top:0;background:#eee;z-index:1;">
                <tr>
                  <th class="sortable-header" data-sort-col="timestamp" style="cursor:pointer;">Timestamp${sortIndicator("timestamp")}</th>
                  <th class="sortable-header" data-sort-col="elapsed_time" style="cursor:pointer;">Elapsed${sortIndicator("elapsed_time")}</th>
                  <th class="sortable-header" data-sort-col="run_time" style="cursor:pointer;">Run Time${sortIndicator("run_time")}</th>
                  <th class="sortable-header" data-sort-col="account" style="cursor:pointer;">Account${sortIndicator("account")}</th>
                  <th class="sortable-header" data-sort-col="repository" style="cursor:pointer;">Repository${sortIndicator("repository")}</th>
                  <th class="sortable-header" data-sort-col="signature" style="cursor:pointer;">Signature${sortIndicator("signature")}</th>
                </tr>
              </thead>
              <tbody>
                ${allEntries.map((entry, i) => `
                  <tr class="${i % 2 === 0 ? "even" : "odd"}">
                    <td>${escapeHtml(String(entry.timestamp || ""))}</td>
                    <td style="text-align:right;">${escapeHtml(String(entry.elapsed_time ?? ""))}</td>
                    <td style="text-align:right;">${escapeHtml(String(entry.run_time ?? ""))}</td>
                    <td>${escapeHtml(String(entry.account || ""))}</td>
                    <td>${escapeHtml(String(entry.repository || ""))}</td>
                    <td style="font-family:monospace;font-size:11px;">${entry.signature && entry.account ? `<a href="#" class="query-signature-link" data-account="${escapeHtml(String(entry.account))}" data-signature="${escapeHtml(String(entry.signature))}" data-timestamp="${escapeHtml(String(entry.timestamp || ""))}" data-repository="${escapeHtml(String(entry.repository || ""))}">${escapeHtml(String(entry.signature))}</a>` : escapeHtml(String(entry.signature || ""))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          ${allEntries.length === 0 ? "<p>No query history data available for the selected repositories.</p>" : ""}
        </div>
        <div class="history-tab-content" data-history-content="graph" style="display:none;">
          ${graphHtml}
        </div>
      </div>
    `;
  }

  sortQueryHistoryEntries(entries) {
    const { column, ascending } = this.queryHistorySort;
    entries.sort((a, b) => {
      let valA = a[column] ?? "";
      let valB = b[column] ?? "";
      if (column === "elapsed_time" || column === "run_time") {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return ascending ? valA - valB : valB - valA;
      }
      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      const cmp = valA.localeCompare(valB);
      return ascending ? cmp : -cmp;
    });
  }

  async renderTransactionHistoryPane(auth) {
    if (!auth) return "<p>Not authenticated.</p>";

    let allEntries = [];
    try {
      const url = `${auth.host}/system/service_history/transactions?_=${Date.now()}`;
      const resp = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
          "Cache-Control": "no-cache",
        },
      });
      if (resp.ok) {
        const contentType = resp.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const json = await resp.json();
          // Response is paginated: { data: [...] }
          allEntries = Array.isArray(json) ? json : (json.data || []);
        }
      } else {
        return `<h2>Transaction History</h2><p>Error loading transactions: ${resp.status}</p>`;
      }
    } catch (e) {
      return `<h2>Transaction History</h2><p>Error: ${escapeHtml(e.message)}</p>`;
    }

    // Sort entries
    this.sortTransactionHistoryEntries(allEntries);

    const sortIndicator = (col) => {
      if (this.transactionHistorySort.column !== col) return "";
      return this.transactionHistorySort.ascending ? " \u25B2" : " \u25BC";
    };

    return `
      <h2>
        <span class="action">
          <button type="button" class="admin-refresh-txn-history-btn" data-testid="admin-refresh-txn-history-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
        </span>
        Transaction History
      </h2>
      <div class="scrollable-list" style="max-height:400px;overflow-y:auto;border:1px solid #ccc;">
        <table class="admin" style="width:100%;">
          <thead style="position:sticky;top:0;background:#eee;z-index:1;">
            <tr>
              <th class="txn-sortable-header" data-sort-col="timestamp" style="cursor:pointer;">Timestamp${sortIndicator("timestamp")}</th>
              <th class="txn-sortable-header" data-sort-col="uuid" style="cursor:pointer;">UUID${sortIndicator("uuid")}</th>
              <th class="txn-sortable-header" data-sort-col="account_key" style="cursor:pointer;">Account${sortIndicator("account_key")}</th>
              <th class="txn-sortable-header" data-sort-col="repository_key" style="cursor:pointer;">Repository${sortIndicator("repository_key")}</th>
              <th class="txn-sortable-header" data-sort-col="insert_count" style="cursor:pointer;">Insert${sortIndicator("insert_count")}</th>
              <th class="txn-sortable-header" data-sort-col="remove_count" style="cursor:pointer;">Remove${sortIndicator("remove_count")}</th>
              <th class="txn-sortable-header" data-sort-col="agent_key" style="cursor:pointer;">Agent${sortIndicator("agent_key")}</th>
              <th class="txn-sortable-header" data-sort-col="agent_tag" style="cursor:pointer;">Agent Tag${sortIndicator("agent_tag")}</th>
            </tr>
          </thead>
          <tbody>
            ${allEntries.map((entry, i) => `
              <tr class="${i % 2 === 0 ? "even" : "odd"}">
                <td>${escapeHtml(String(entry.timestamp || ""))}</td>
                <td style="font-family:monospace;font-size:11px;">${escapeHtml(String(entry.uuid || ""))}</td>
                <td>${escapeHtml(String(entry.account_key || ""))}</td>
                <td>${escapeHtml(String(entry.repository_key || ""))}</td>
                <td style="text-align:right;">${escapeHtml(String(entry.insert_count ?? ""))}</td>
                <td style="text-align:right;">${escapeHtml(String(entry.remove_count ?? ""))}</td>
                <td>${escapeHtml(String(entry.agent_key || ""))}</td>
                <td style="font-size:11px;">${escapeHtml(String(entry.agent_tag || ""))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${allEntries.length === 0 ? "<p>No transaction history data available.</p>" : ""}
    `;
  }

  sortTransactionHistoryEntries(entries) {
    const { column, ascending } = this.transactionHistorySort;
    entries.sort((a, b) => {
      let valA = a[column] ?? "";
      let valB = b[column] ?? "";
      if (column === "insert_count" || column === "remove_count") {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return ascending ? valA - valB : valB - valA;
      }
      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      const cmp = valA.localeCompare(valB);
      return ascending ? cmp : -cmp;
    });
  }

  async renderImportHistoryPane(auth) {
    if (!auth) return "<p>Not authenticated.</p>";

    const { offset, limit } = this.importHistoryPaging;
    let allEntries = [];
    try {
      const url = `${auth.host}/system/service_history/imports?offset=${offset}&limit=${limit}&_=${Date.now()}`;
      const resp = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
          "Cache-Control": "no-cache",
        },
      });
      if (resp.ok) {
        const contentType = resp.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const json = await resp.json();
          allEntries = Array.isArray(json) ? json : (json.data || []);
        }
      } else {
        return `<h2>Import History</h2><p>Error loading import history: ${resp.status}</p>`;
      }
    } catch (e) {
      return `<h2>Import History</h2><p>Error: ${escapeHtml(e.message)}</p>`;
    }

    // Sort entries
    this.sortImportHistoryEntries(allEntries);

    const sortIndicator = (col) => {
      if (this.importHistorySort.column !== col) return "";
      return this.importHistorySort.ascending ? " \u25B2" : " \u25BC";
    };

    // Render graph
    const graphHtml = allEntries.length > 0 ? this.renderGraph({
      entries: allEntries,
      xField: "timestamp",
      yField: "quad_count",
      yLabel: "Quads",
      useLogScale: true
    }) : "";

    return `
      <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>Import History</span>
        <span class="action" style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="admin-refresh-import-history-btn" data-testid="admin-refresh-import-history-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">Refresh</button>
          <span style="display:flex;align-items:center;gap:4px;">
            <label style="font-size:12px;font-weight:normal;">Offset:</label>
            <button type="button" class="imp-page-prev icon icon-square-chevron-down" style="border:none;padding:0;cursor:pointer;" title="Previous page"></button>
            <input type="number" class="imp-offset-input" value="${offset}" min="0" style="width:60px;padding:2px 4px;font-size:12px;text-align:right;" />
            <button type="button" class="imp-page-next icon icon-square-chevron-up" style="border:none;padding:0;cursor:pointer;" title="Next page"></button>
          </span>
          <span style="display:flex;align-items:center;gap:4px;">
            <label style="font-size:12px;font-weight:normal;">Limit:</label>
            <input type="number" class="imp-limit-input" value="${limit}" min="1" max="1000" style="width:60px;padding:2px 4px;font-size:12px;text-align:right;" />
          </span>
          <span style="font-size:12px;color:#666;font-weight:normal;">Showing ${allEntries.length} entries</span>
        </span>
      </h2>
      <div class="history-tabs-container">
        <div class="history-tabs-bar">
          <button type="button" class="history-tab active" data-history-tab="table" title="Table">
            <img src="${BASE_PATH}/images/logs.svg" alt="Table" width="16" height="16" />
          </button>
          <button type="button" class="history-tab" data-history-tab="graph" title="Graph">
            <img src="${BASE_PATH}/images/chart-line.svg" alt="Graph" width="16" height="16" />
          </button>
        </div>
        <div class="history-tab-content" data-history-content="table" style="display:block;">
          <div class="scrollable-list" style="max-height:400px;overflow-y:auto;border:1px solid #ccc;">
            <table class="admin" style="width:100%;">
              <thead style="position:sticky;top:0;background:#eee;z-index:1;">
                <tr>
                  <th class="imp-sortable-header" data-sort-col="timestamp" style="cursor:pointer;">Timestamp${sortIndicator("timestamp")}</th>
                  <th class="imp-sortable-header" data-sort-col="uuid" style="cursor:pointer;">UUID${sortIndicator("uuid")}</th>
                  <th class="imp-sortable-header" data-sort-col="account_key" style="cursor:pointer;">Account${sortIndicator("account_key")}</th>
                  <th class="imp-sortable-header" data-sort-col="repository_key" style="cursor:pointer;">Repository${sortIndicator("repository_key")}</th>
                  <th class="imp-sortable-header" data-sort-col="agent_key" style="cursor:pointer;">Agent${sortIndicator("agent_key")}</th>
                  <th class="imp-sortable-header" data-sort-col="source_uri" style="cursor:pointer;">Source${sortIndicator("source_uri")}</th>
                  <th class="imp-sortable-header" data-sort-col="quad_count" style="cursor:pointer;">Quads${sortIndicator("quad_count")}</th>
                  <th class="imp-sortable-header" data-sort-col="success" style="cursor:pointer;">Success${sortIndicator("success")}</th>
                </tr>
              </thead>
              <tbody>
                ${allEntries.map((entry, i) => `
                  <tr class="${i % 2 === 0 ? "even" : "odd"}">
                    <td>${escapeHtml(String(entry.timestamp || ""))}</td>
                    <td style="font-family:monospace;font-size:11px;">${escapeHtml(String(entry.uuid || ""))}</td>
                    <td>${escapeHtml(String(entry.account_key || ""))}</td>
                    <td>${escapeHtml(String(entry.repository_key || ""))}</td>
                    <td>${escapeHtml(String(entry.agent_key || ""))}</td>
                    <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(String(entry.source_uri || ""))}">${escapeHtml(String(entry.source_uri || ""))}</td>
                    <td style="text-align:right;">${escapeHtml(String(entry.quad_count ?? ""))}</td>
                    <td>${entry.success ? "Yes" : "No"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          ${allEntries.length === 0 ? "<p>No import history data available.</p>" : ""}
        </div>
        <div class="history-tab-content" data-history-content="graph" style="display:none;">
          ${graphHtml}
        </div>
      </div>
    `;
  }

  sortImportHistoryEntries(entries) {
    const { column, ascending } = this.importHistorySort;
    entries.sort((a, b) => {
      let valA = a[column] ?? "";
      let valB = b[column] ?? "";
      if (column === "quad_count") {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return ascending ? valA - valB : valB - valA;
      }
      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      const cmp = valA.localeCompare(valB);
      return ascending ? cmp : -cmp;
    });
  }

  attachPaneHandlers(lazyType, auth) {
    const app = this.context?.app;

    if (lazyType === "accounts") {
      const refreshAccountsBtn = document.querySelector(".admin-refresh-accounts-btn");
      if (refreshAccountsBtn && auth) {
        refreshAccountsBtn.addEventListener("click", async () => {
          const pane = document.getElementById("admin-accounts");
          if (pane) {
            pane.dataset.loaded = "false";
            await this.loadPaneContent("admin-accounts", auth);
          }
        });
      }
      const newAccountBtn = document.querySelector(".admin-new-account-btn");
      if (newAccountBtn && auth && app) {
        newAccountBtn.addEventListener("click", () => {
          this.showNewAccountDialog(auth, app);
        });
      }
      document.querySelectorAll(".account-details").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const accountName = link.dataset.account;
          if (auth) this.showAccountDetails(accountName, auth);
        });
      });

      // Handle "check all" checkbox
      const checkAllBox = document.querySelector(".account-checkbox-all");
      const allCheckboxes = document.querySelectorAll(".account-checkbox");
      if (checkAllBox) {
        checkAllBox.addEventListener("change", async () => {
          const isChecked = checkAllBox.checked;
          allCheckboxes.forEach((cb) => {
            cb.checked = isChecked;
            const accountName = cb.dataset.account;
            if (isChecked) {
              this.checkedAccounts.add(accountName);
            } else {
              this.checkedAccounts.delete(accountName);
            }
          });
          // Refresh repositories pane if it's already loaded
          const reposPane = document.getElementById("admin-repositories");
          if (reposPane && reposPane.dataset.loaded === "true") {
            reposPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-repositories", auth);
          }
        });
      }

      // Handle individual checkbox changes - update checked accounts and refresh repos pane
      allCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", async () => {
          const accountName = checkbox.dataset.account;
          if (checkbox.checked) {
            this.checkedAccounts.add(accountName);
          } else {
            this.checkedAccounts.delete(accountName);
          }
          // Update "check all" checkbox state
          if (checkAllBox) {
            const allChecked = Array.from(allCheckboxes).every((cb) => cb.checked);
            const someChecked = Array.from(allCheckboxes).some((cb) => cb.checked);
            checkAllBox.checked = allChecked;
            checkAllBox.indeterminate = someChecked && !allChecked;
          }
          // Refresh repositories pane if it's already loaded
          const reposPane = document.getElementById("admin-repositories");
          if (reposPane && reposPane.dataset.loaded === "true") {
            reposPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-repositories", auth);
          }
        });
      });

      // Handle account delete buttons
      document.querySelectorAll(".account-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const accountName = btn.dataset.account;
          if (!confirm(`Are you sure you want to delete account "${accountName}"? This action cannot be undone.`)) return;

          // Disable button and change icon opacity during delete
          const wasDisabled = btn.disabled;
          btn.disabled = true;
          const img = btn.querySelector("img");
          if (img) img.style.opacity = "0.3";

          try {
            const resp = await fetch(`${auth.host}/system/accounts/${encodeURIComponent(accountName)}`, {
              method: "DELETE",
              headers: {
                Accept: "application/n-triples",
                Authorization: `Bearer ${auth.token}`,
              },
            });
            if (resp.ok || resp.status === 200 || resp.status === 204) {
              // Parse N-Triples response if available
              const ntriples = await resp.text();
              if (ntriples.trim()) {
                this.showDeleteResultDialog(ntriples, () => {
                  this.checkedAccounts.delete(accountName);
                  btn.closest("tr")?.remove();
                  this.refreshRepositoriesPane(auth);
                });
              } else {
                this.checkedAccounts.delete(accountName);
                btn.closest("tr")?.remove();
                this.refreshRepositoriesPane(auth);
              }
            } else {
              const errorText = await resp.text();
              alert(`Failed to delete account (${resp.status}): ${errorText}`);
            }
          } catch (error) {
            alert(`Error deleting account: ${error.message}`);
          } finally {
            btn.disabled = wasDisabled;
            if (img) img.style.opacity = "0.6";
          }
        });
      });
    }

    if (lazyType === "repositories") {
      const refreshReposBtn = document.querySelector(".admin-refresh-repos-btn");
      if (refreshReposBtn && auth) {
        refreshReposBtn.addEventListener("click", async () => {
          const pane = document.getElementById("admin-repositories");
          if (pane) {
            pane.dataset.loaded = "false";
            await this.loadPaneContent("admin-repositories", auth);
          }
        });
      }
      const newRepoBtn = document.querySelector(".admin-new-repo-btn");
      if (newRepoBtn && auth && app) {
        newRepoBtn.addEventListener("click", () => {
          this.showNewRepositoryDialog(auth, app);
        });
      }

      // Handle "check all" checkbox for repositories
      const repoCheckAllBox = document.querySelector(".repo-checkbox-all");
      const allRepoCheckboxes = document.querySelectorAll(".repo-checkbox");
      if (repoCheckAllBox) {
        repoCheckAllBox.addEventListener("change", () => {
          const isChecked = repoCheckAllBox.checked;
          allRepoCheckboxes.forEach((cb) => {
            cb.checked = isChecked;
            const repoKey = `${cb.dataset.account}/${cb.dataset.repo}`;
            if (isChecked) {
              this.checkedRepos.add(repoKey);
            } else {
              this.checkedRepos.delete(repoKey);
            }
          });
        });
      }

      // Handle individual repo checkbox changes
      allRepoCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const repoKey = `${checkbox.dataset.account}/${checkbox.dataset.repo}`;
          if (checkbox.checked) {
            this.checkedRepos.add(repoKey);
          } else {
            this.checkedRepos.delete(repoKey);
          }
          // Update "check all" checkbox state
          if (repoCheckAllBox) {
            const allChecked = Array.from(allRepoCheckboxes).every((cb) => cb.checked);
            const someChecked = Array.from(allRepoCheckboxes).some((cb) => cb.checked);
            repoCheckAllBox.checked = allChecked;
            repoCheckAllBox.indeterminate = someChecked && !allChecked;
          }
        });
      });

      // Handle repository delete buttons
      document.querySelectorAll(".repo-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const accountName = btn.dataset.account;
          const repoName = btn.dataset.repo;
          if (!confirm(`Are you sure you want to delete repository "${repoName}" in account "${accountName}"? This action cannot be undone.`)) return;

          // Disable button and change icon opacity during delete
          const wasDisabled = btn.disabled;
          btn.disabled = true;
          const img = btn.querySelector("img");
          if (img) img.style.opacity = "0.3";

          try {
            const resp = await fetch(`${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repoName)}`, {
              method: "DELETE",
              headers: {
                Accept: "application/n-triples",
                Authorization: `Bearer ${auth.token}`,
              },
            });
            if (resp.ok || resp.status === 200 || resp.status === 204) {
              // Parse N-Triples response if available
              const ntriples = await resp.text();
              if (ntriples.trim()) {
                this.showDeleteResultDialog(ntriples, () => {
                  btn.closest("tr")?.remove();
                });
              } else {
                btn.closest("tr")?.remove();
              }
            } else {
              const errorText = await resp.text();
              alert(`Failed to delete repository (${resp.status}): ${errorText}`);
            }
          } catch (error) {
            alert(`Error deleting repository: ${error.message}`);
          } finally {
            btn.disabled = wasDisabled;
            if (img) img.style.opacity = "0.6";
          }
        });
      });
    }

    if (lazyType === "query-history") {
      const queryPane = document.getElementById("admin-query-history");
      if (queryPane) {
        // Attach sort handlers directly to each th element
        queryPane.querySelectorAll(".sortable-header").forEach((th) => {
          th.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const col = th.dataset.sortCol;
            if (this.queryHistorySort.column === col) {
              this.queryHistorySort.ascending = !this.queryHistorySort.ascending;
            } else {
              this.queryHistorySort.column = col;
              this.queryHistorySort.ascending = true;
            }
            const currentAuth = getAuth(this.state);
            queryPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-query-history", currentAuth);
          });
        });

        // Refresh button
        const refreshBtn = queryPane.querySelector(".admin-refresh-query-history-btn");
        if (refreshBtn) {
          refreshBtn.addEventListener("click", async () => {
            const currentAuth = getAuth(this.state);
            queryPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-query-history", currentAuth);
          });
        }

        // Signature links — fetch query text
        queryPane.querySelectorAll(".query-signature-link").forEach((link) => {
          link.addEventListener("click", async (e) => {
            e.preventDefault();
            const account = link.dataset.account;
            const signature = link.dataset.signature;
            const timestamp = link.dataset.timestamp;
            const repository = link.dataset.repository;
            const currentAuth = getAuth(this.state);
            if (!currentAuth) return;
            try {
              const resp = await fetch(
                `${currentAuth.host}/system/service_history/queries/${encodeURIComponent(account)}/${encodeURIComponent(signature)}`,
                {
                  headers: {
                    Accept: "application/sparql-query",
                    Authorization: `Bearer ${currentAuth.token}`,
                  },
                }
              );
              if (resp.ok) {
                const queryText = await resp.text();
                this.showQueryTextDialog(signature, queryText, timestamp, account, repository);
              } else {
                alert(`Failed to retrieve query (${resp.status})`);
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });

        // Graph point clicks — fetch query text
        queryPane.querySelectorAll(".graph-point").forEach((point) => {
          point.addEventListener("click", async (e) => {
            e.preventDefault();
            const account = point.dataset.account;
            const signature = point.dataset.signature;
            const timestamp = point.dataset.timestamp;
            const repository = point.dataset.repository;
            if (!account || !signature) return;
            const currentAuth = getAuth(this.state);
            if (!currentAuth) return;
            try {
              const resp = await fetch(
                `${currentAuth.host}/system/service_history/queries/${encodeURIComponent(account)}/${encodeURIComponent(signature)}`,
                {
                  headers: {
                    Accept: "application/sparql-query",
                    Authorization: `Bearer ${currentAuth.token}`,
                  },
                }
              );
              if (resp.ok) {
                const queryText = await resp.text();
                this.showQueryTextDialog(signature, queryText, timestamp, account, repository);
              } else {
                alert(`Failed to retrieve query (${resp.status})`);
              }
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          });
        });

        // History tabs switching
        queryPane.querySelectorAll(".history-tab").forEach((tab) => {
          tab.addEventListener("click", () => {
            const targetTab = tab.dataset.historyTab;
            // Update active tab
            queryPane.querySelectorAll(".history-tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            // Show/hide content
            queryPane.querySelectorAll(".history-tab-content").forEach((content) => {
              content.style.display = content.dataset.historyContent === targetTab ? "block" : "none";
            });
          });
        });
      }
    }

    if (lazyType === "transaction-history") {
      const txnPane = document.getElementById("admin-transaction-history");
      if (txnPane) {
        // Attach sort handlers directly to each th element
        txnPane.querySelectorAll(".txn-sortable-header").forEach((th) => {
          th.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const col = th.dataset.sortCol;
            if (this.transactionHistorySort.column === col) {
              this.transactionHistorySort.ascending = !this.transactionHistorySort.ascending;
            } else {
              this.transactionHistorySort.column = col;
              this.transactionHistorySort.ascending = true;
            }
            const currentAuth = getAuth(this.state);
            txnPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-transaction-history", currentAuth);
          });
        });

        // Refresh button
        const refreshBtn = txnPane.querySelector(".admin-refresh-txn-history-btn");
        if (refreshBtn) {
          refreshBtn.addEventListener("click", async () => {
            const currentAuth = getAuth(this.state);
            txnPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-transaction-history", currentAuth);
          });
        }
      }
    }

    if (lazyType === "import-history") {
      const impPane = document.getElementById("admin-import-history");
      if (impPane) {
        // Attach sort handlers
        impPane.querySelectorAll(".imp-sortable-header").forEach((th) => {
          th.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const col = th.dataset.sortCol;
            if (this.importHistorySort.column === col) {
              this.importHistorySort.ascending = !this.importHistorySort.ascending;
            } else {
              this.importHistorySort.column = col;
              this.importHistorySort.ascending = true;
            }
            const currentAuth = getAuth(this.state);
            impPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-import-history", currentAuth);
          });
        });

        // Refresh button
        const refreshBtn = impPane.querySelector(".admin-refresh-import-history-btn");
        if (refreshBtn) {
          refreshBtn.addEventListener("click", async () => {
            const currentAuth = getAuth(this.state);
            impPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-import-history", currentAuth);
          });
        }

        // Paging controls
        const offsetInput = impPane.querySelector(".imp-offset-input");
        const limitInput = impPane.querySelector(".imp-limit-input");
        const prevBtn = impPane.querySelector(".imp-page-prev");
        const nextBtn = impPane.querySelector(".imp-page-next");

        const reloadWithPaging = async () => {
          const currentAuth = getAuth(this.state);
          impPane.dataset.loaded = "false";
          await this.loadPaneContent("admin-import-history", currentAuth);
        };

        if (offsetInput) {
          offsetInput.addEventListener("change", async () => {
            const val = parseInt(offsetInput.value, 10);
            if (!isNaN(val) && val >= 0) {
              this.importHistoryPaging.offset = val;
              await reloadWithPaging();
            }
          });
        }

        if (limitInput) {
          limitInput.addEventListener("change", async () => {
            const val = parseInt(limitInput.value, 10);
            if (!isNaN(val) && val >= 1) {
              this.importHistoryPaging.limit = val;
              await reloadWithPaging();
            }
          });
        }

        if (prevBtn) {
          prevBtn.addEventListener("click", async () => {
            const newOffset = Math.max(0, this.importHistoryPaging.offset - this.importHistoryPaging.limit);
            this.importHistoryPaging.offset = newOffset;
            await reloadWithPaging();
          });
        }

        if (nextBtn) {
          nextBtn.addEventListener("click", async () => {
            this.importHistoryPaging.offset += this.importHistoryPaging.limit;
            await reloadWithPaging();
          });
        }

        // History tabs switching
        impPane.querySelectorAll(".history-tab").forEach((tab) => {
          tab.addEventListener("click", () => {
            const targetTab = tab.dataset.historyTab;
            // Update active tab
            impPane.querySelectorAll(".history-tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            // Show/hide content
            impPane.querySelectorAll(".history-tab-content").forEach((content) => {
              content.style.display = content.dataset.historyContent === targetTab ? "block" : "none";
            });
          });
        });
      }
    }

    if (lazyType === "invitations") {
      const newInviteBtn = document.querySelector(".admin-new-invite-btn");
      if (newInviteBtn && auth && app) {
        newInviteBtn.addEventListener("click", () => {
          this.showNewInvitationDialog(auth, app);
        });
      }

      if (auth) {
        document.querySelectorAll(".invite-send").forEach((link) => {
          link.addEventListener("click", async (e) => {
            e.preventDefault();
            const email = link.dataset.email;
            try {
              const resp = await fetch(`${auth.host}/invitations`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ email }),
              });
              if (resp.ok) {
                alert(`Invitation sent to ${email}`);
              } else {
                alert(`Failed to send invitation (${resp.status})`);
              }
            } catch (error) {
              alert(`Error: ${error.message}`);
            }
          });
        });

        document.querySelectorAll(".invite-delete").forEach((link) => {
          link.addEventListener("click", async (e) => {
            e.preventDefault();
            const email = link.dataset.email;
            if (!confirm(`Delete invitation for ${email}?`)) return;
            try {
              const resp = await fetch(`${auth.host}/invitations/${encodeURIComponent(email)}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${auth.token}`,
                },
              });
              if (resp.ok) {
                link.closest("tr")?.remove();
              } else {
                alert(`Failed to delete invitation (${resp.status})`);
              }
            } catch (error) {
              alert(`Error: ${error.message}`);
            }
          });
        });
      }
    }
  }

  async afterRender() {
    const app = this.context?.app;
    const auth = getAuth(this.state);

    // Load the first pane (accounts) immediately
    await this.loadPaneContent("admin-accounts", auth);
  }

  async refreshRepositoriesPane(auth) {
    const reposPane = document.getElementById("admin-repositories");
    if (reposPane && reposPane.dataset.loaded === "true") {
      reposPane.dataset.loaded = "false";
      await this.loadPaneContent("admin-repositories", auth);
    }
  }

  showDeleteResultDialog(ntriples, onClose) {
    const lines = ntriples.trim().split(/\r?\n/).filter(Boolean);
    let subject = "";
    const pairs = [];
    for (const line of lines) {
      const match = line.trim().match(/^(<[^>]+>)\s+(<[^>]+>)\s+(.+)\s*\.$/);
      if (match) {
        if (!subject) subject = match[1];
        pairs.push([match[2], match[3]]);
      }
    }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:600px;width:90%;max-height:70vh;display:flex;flex-direction:column;";
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px 0;font-size:14px;word-break:break-all;">${escapeHtml(subject)}</h3>
      <ul style="list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;">
        ${pairs.map(([p, o]) => `<li style="padding:4px 0;border-bottom:1px solid #eee;font-size:13px;"><strong>${escapeHtml(p)}</strong> ${escapeHtml(o)}</li>`).join("")}
      </ul>
      <button id="delete-result-close" style="margin-top:12px;align-self:flex-end;padding:6px 16px;cursor:pointer;">OK</button>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const closeOverlay = () => {
      overlay.remove();
      if (onClose) onClose();
    };
    dialog.querySelector("#delete-result-close").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  }

  showQueryTextDialog(signature, queryText, timestamp = null, account = null, repository = null) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:700px;width:90%;max-height:70vh;display:flex;flex-direction:column;";
    
    let headerInfo = `<div style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #ddd;">`;
    headerInfo += `<div style="font-size:14px;font-family:monospace;font-weight:bold;margin-bottom:4px;">${escapeHtml(signature)}</div>`;
    if (timestamp) {
      const date = new Date(timestamp);
      const formattedTime = date.toISOString().replace('T', ' ').substring(0, 19);
      headerInfo += `<div style="font-size:12px;color:#666;margin-bottom:2px;">Timestamp: ${escapeHtml(formattedTime)}</div>`;
    }
    if (account) {
      headerInfo += `<div style="font-size:12px;color:#666;margin-bottom:2px;">Account: ${escapeHtml(account)}</div>`;
    }
    if (repository) {
      headerInfo += `<div style="font-size:12px;color:#666;">Repository: ${escapeHtml(repository)}</div>`;
    }
    headerInfo += `</div>`;
    
    dialog.innerHTML = `
      ${headerInfo}
      <pre style="margin:0;padding:12px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;overflow:auto;flex:1;font-size:13px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(queryText)}</pre>
      <button class="query-text-close" style="margin-top:12px;align-self:flex-end;padding:6px 16px;cursor:pointer;">OK</button>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const closeOverlay = () => overlay.remove();
    dialog.querySelector(".query-text-close").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  }

  showNewAccountDialog(auth, app) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px 0;">New Account</h3>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;margin-bottom:4px;">Account Name</label>
        <input type="text" class="new-account-name" placeholder="username" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div style="text-align:right;">
        <button class="new-account-cancel" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
        <button class="new-account-ok" style="padding:6px 12px;cursor:pointer;">Create</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector(".new-account-name");
    const okBtn = dialog.querySelector(".new-account-ok");
    const cancelBtn = dialog.querySelector(".new-account-cancel");
    input.focus();

    const close = () => overlay.remove();
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const submit = async () => {
      const name = input.value.trim();
      if (!name) return;
      close();
      try {
        const url = `${auth.host}/system/accounts`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ name }),
        });
        if (resp.ok || resp.status === 201) {
          // Add new account to checked set
          this.checkedAccounts.add(name);
          // Clear loaded state so pane will refresh
          const accountsPane = document.getElementById("admin-accounts");
          if (accountsPane) {
            accountsPane.dataset.loaded = "false";
          }
          // Reload the accounts pane directly
          await this.loadPaneContent("admin-accounts", auth);
          // Also refresh repositories if loaded
          const reposPane = document.getElementById("admin-repositories");
          if (reposPane && reposPane.dataset.loaded === "true") {
            reposPane.dataset.loaded = "false";
            await this.loadPaneContent("admin-repositories", auth);
          }
        } else {
          const errorText = await resp.text();
          alert(`Failed to create account (${resp.status}): ${errorText}`);
        }
      } catch (error) {
        alert(`Failed to create account: ${error.message}`);
      }
    };

    okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.stopPropagation(); submit(); }
      if (e.key === "Escape") close();
    });
  }

  async showNewRepositoryDialog(auth, app) {
    // First, fetch list of accounts for the dropdown
    let accounts = [];
    try {
      const url = `${auth.host}/system/accounts?_=${Date.now()}`;
      const resp = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
          "Cache-Control": "no-cache",
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        accounts = Array.isArray(data) ? data : Object.keys(data).map((k) => ({ name: k }));
      }
    } catch (e) {
      alert(`Error loading accounts: ${e.message}`);
      return;
    }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px 0;">New Repository</h3>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;margin-bottom:4px;">Account</label>
        <select class="new-repo-account" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;">
          ${accounts.map((acct) => {
            const name = acct.name || acct.friendlyId || acct;
            return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
          }).join("")}
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;margin-bottom:4px;">Repository Name</label>
        <input type="text" class="new-repo-name" placeholder="my-repository" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div style="text-align:right;">
        <button class="new-repo-cancel" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
        <button class="new-repo-ok" style="padding:6px 12px;cursor:pointer;">Create</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const accountSelect = dialog.querySelector(".new-repo-account");
    const nameInput = dialog.querySelector(".new-repo-name");
    const okBtn = dialog.querySelector(".new-repo-ok");
    const cancelBtn = dialog.querySelector(".new-repo-cancel");
    nameInput.focus();

    const close = () => overlay.remove();
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const submit = async () => {
      const accountName = accountSelect.value;
      const repoName = nameInput.value.trim();
      if (!accountName || !repoName) return;
      close();
      try {
        const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ name: repoName }),
        });
        if (resp.ok || resp.status === 201) {
          // Clear loaded state so pane will refresh
          const reposPane = document.getElementById("admin-repositories");
          if (reposPane) {
            reposPane.dataset.loaded = "false";
          }
          // Reload the repositories pane directly
          await this.loadPaneContent("admin-repositories", auth);
        } else {
          const errorText = await resp.text();
          alert(`Failed to create repository (${resp.status}): ${errorText}`);
        }
      } catch (error) {
        alert(`Failed to create repository: ${error.message}`);
      }
    };

    okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.stopPropagation(); submit(); }
      if (e.key === "Escape") close();
    });
  }

  showNewInvitationDialog(auth, app) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px 0;">New Invitation</h3>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;margin-bottom:4px;">Email Address</label>
        <input type="email" class="new-invite-email" placeholder="user@example.com" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div style="text-align:right;">
        <button class="new-invite-cancel" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
        <button class="new-invite-ok" style="padding:6px 12px;cursor:pointer;">Send</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector(".new-invite-email");
    const okBtn = dialog.querySelector(".new-invite-ok");
    const cancelBtn = dialog.querySelector(".new-invite-cancel");
    input.focus();

    const close = () => overlay.remove();
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const submit = async () => {
      const email = input.value.trim();
      if (!email) return;
      close();
      try {
        const resp = await fetch(`${auth.host}/invitations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ email }),
        });
        if (resp.ok) {
          alert(`Invitation sent to ${email}`);
          // Clear loaded state so pane will refresh
          const invitationsPane = document.getElementById("admin-invitations");
          if (invitationsPane) {
            invitationsPane.dataset.loaded = "false";
          }
          // Reload the invitations pane directly
          await this.loadPaneContent("admin-invitations", auth);
        } else {
          const errorText = await resp.text();
          alert(`Failed to send invitation (${resp.status}): ${errorText}`);
        }
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    };

    okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.stopPropagation(); submit(); }
      if (e.key === "Escape") close();
    });
  }

  async showAccountDetails(accountName, auth) {
    let config = {};
    try {
      const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/configuration?_=${Date.now()}`;
      const resp = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
          "Cache-Control": "no-cache",
        },
      });
      if (resp.ok) config = await resp.json();
    } catch (e) { /* ignore */ }

    const fields = Object.entries(config).filter(([k]) => k !== "accessToken");

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:400px;max-height:80vh;overflow:auto;";
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px 0;">Account: ${escapeHtml(accountName)}</h3>
      <table class="admin" style="width:100%;">
        <tr><th>Property</th><th>Value</th></tr>
        ${fields.map(([key, value], i) => `
          <tr class="${i % 2 === 0 ? "even" : "odd"}">
            <td>${escapeHtml(key)}</td>
            <td>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</td>
          </tr>
        `).join("")}
      </table>
      <div style="text-align:right;margin-top:12px;">
        <button class="details-close" style="padding:6px 12px;cursor:pointer;">Close</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    dialog.querySelector(".details-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }
}

// Keep separate page classes for direct URL access, but they're less important now

export class ManageAccountsPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const accountsTab = document.querySelector('[href="#admin-accounts"]');
    if (accountsTab) accountsTab.click();
  }
}

export class ManageAccountPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const accountsTab = document.querySelector('[href="#admin-accounts"]');
    if (accountsTab) accountsTab.click();
    // Show details for this account
    const auth = getAuth(this.state);
    if (auth && this.params.account_name) {
      this.showAccountDetails(this.params.account_name, auth);
    }
  }
}

export class ManageRepositoriesPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const reposTab = document.querySelector('[href="#admin-repositories"]');
    if (reposTab) reposTab.click();
  }
}

export class AdminInvitationsPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const invitationsTab = document.querySelector('[href="#admin-invitations"]');
    if (invitationsTab) invitationsTab.click();
  }
}

export class AdminInviteNewPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const invitationsTab = document.querySelector('[href="#admin-invitations"]');
    if (invitationsTab) invitationsTab.click();
    // Show new invitation dialog
    const auth = getAuth(this.state);
    const app = this.context?.app;
    if (auth && app) {
      this.showNewInvitationDialog(auth, app);
    }
  }
}

export class QueryHistoryPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const tab = document.querySelector('[href="#admin-query-history"]');
    if (tab) tab.click();
  }
}

export class TransactionHistoryPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    const tab = document.querySelector('[href="#admin-transaction-history"]');
    if (tab) tab.click();
  }
}

export class PaymentHistoryPage extends AdminDashboardPage {
  async afterRender() {
    await super.afterRender();
    // Payment history removed, redirect to dashboard
    const accountsTab = document.querySelector('[href="#admin-accounts"]');
    if (accountsTab) accountsTab.click();
  }
}

