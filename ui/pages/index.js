import { BasePage } from "./base_page.js";
import { escapeHtml, joinHtml } from "../utils.js";
import { NavigationView } from "../components/navigation.js";
import { APP_CONFIG } from "../../lib/config.js";
import { authenticateAccount } from "../../lib/auth.js";

export const errorMessages = () => `
  <div class="widget">
    <div class="alert-error rounded">
      <p class="message">
        <span class="icon icon-alert"></span>
        Oops, something went wrong. Please check the form and try again.
      </p>
    </div>
  </div>
`;

export const BASE_PATH = APP_CONFIG.basePath || "";

// Helper function to safely get response text, handling cases where content length doesn't match
const getResponseText = async (response) => {
  try {
    return await response.text();
  } catch (error) {
    // If reading the response fails (e.g., content length mismatch), try to get what we can
    try {
      // Clone the response to avoid consuming it
      const clonedResponse = response.clone();
      const text = await clonedResponse.text();
      return text;
    } catch (cloneError) {
      // If cloning also fails, return error information
      return `[Error reading response: ${error.message}]`;
    }
  }
};

// Helper function to ensure view name is just the base name (not a full path)
// This ensures that even if a view name somehow contains a path, we extract just the base name
const ensureBaseViewName = (viewName) => {
  if (!viewName) return viewName;
  // If it contains slashes, extract just the last part
  return viewName.includes("/") ? viewName.split("/").pop() : viewName;
};

// Helper function to extract local part from an IRI
// Returns the fragment (#name) if present, otherwise the last path segment
const extractLocalPart = (iri) => {
  if (!iri || typeof iri !== "string") return iri;
  // Remove angle brackets if present
  const cleanIri = iri.replace(/^<|>$/g, "");
  try {
    const url = new URL(cleanIri);
    // If there's a hash fragment, use that (without the #)
    if (url.hash && url.hash.length > 1) {
      return url.hash.slice(1);
    }
    // Otherwise, use the last path segment
    const pathParts = url.pathname.split("/").filter(Boolean);
    return pathParts.length > 0 ? pathParts[pathParts.length - 1] : cleanIri;
  } catch (e) {
    // If URL parsing fails, try simple string operations
    const hashIndex = cleanIri.indexOf("#");
    if (hashIndex >= 0 && hashIndex < cleanIri.length - 1) {
      return cleanIri.substring(hashIndex + 1);
    }
    const parts = cleanIri.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : cleanIri;
  }
};

// Helper function to parse N-Triples and extract property-value pairs
// Returns array of [property, value] pairs where property is local part of predicate
// and value is either literal value or local part of IRI
const parseNTriples = (ntriples) => {
  const lines = ntriples.trim().split(/\r?\n/).filter(Boolean);
  let subject = "";
  const pairs = [];
  
  for (const line of lines) {
    // Match N-Triples format: <subject> <predicate> <object> .
    // or <subject> <predicate> "literal" .
    // or <subject> <predicate> "literal"@lang .
    // or <subject> <predicate> "literal"^^<type> .
    const match = line.trim().match(/^(<[^>]+>)\s+(<[^>]+>)\s+(.+?)\s*\.$/);
    if (match) {
      const [, subj, pred, obj] = match;
      if (!subject) subject = subj;
      
      // Extract local part of predicate
      const property = extractLocalPart(pred);
      
      // Parse object - check if it's a literal or IRI
      let value;
      if (obj.startsWith('"')) {
        // It's a literal - extract the value
        // Handle: "value", "value"@lang, "value"^^<type>
        const literalMatch = obj.match(/^"((?:[^"\\]|\\.)*)"(?:\@[^@]+|(?:\^\^<[^>]+>))?$/);
        if (literalMatch) {
          // Unescape the string
          value = literalMatch[1].replace(/\\(.)/g, "$1");
        } else {
          value = obj;
        }
      } else if (obj.startsWith("<")) {
        // It's an IRI - extract local part
        value = extractLocalPart(obj);
      } else {
        // Fallback - use as is
        value = obj;
      }
      
      pairs.push([property, value]);
    }
  }
  
  return { subject, pairs };
};

// Helper function to find all editor instances for a given view
const findEditorsForView = (app, accountName, repositoryName, viewName) => {
  if (!app || !app.editorInstances) return [];
  const baseViewName = ensureBaseViewName(viewName);
  const editors = [];
  // Check both repository pane editors and separate pane editors
  const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
  const paneId = paneIdView(accountName, repositoryName, baseViewName);
  if (app.editorInstances.has(repoEditorId)) {
    editors.push(app.editorInstances.get(repoEditorId));
  }
  if (app.editorInstances.has(paneId)) {
    editors.push(app.editorInstances.get(paneId));
  }
  return editors;
};

const deviseLinks = () => `
  <h5>Already have an account?</h5>
  <p><a href="/login">Log in</a></p>
  <h5>Have an invite code?</h5>
  <p><a href="/signup">Register now</a></p>
  <a href="${BASE_PATH}/reset_password.html">Forgot your password?</a>
  <a href="/confirmations/new">Didn't receive confirmation instructions?</a>
  <a href="/unlocks/new">Didn't receive unlock instructions?</a>
`;

const tabIdFromAccount = (accountName) => `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;

const normalizeRepositories = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.repositories)) return payload.repositories;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const updateAccountConfiguration = async ({ host, token, accountName, config }) => {
  if (!host || !token || !accountName) return null;
  const response = await fetch(
    `${host}/system/accounts/${encodeURIComponent(accountName)}/configuration`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(config || {}),
    }
  );
  if (!response.ok) {
    const errorText = await getResponseText(response);
    throw new Error(`Save failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }
  return response.json();
};

const updateRepositoryConfiguration = async ({ host, token, accountName, repositoryName, config }) => {
  if (!host || !token || !accountName || !repositoryName) return null;
  const response = await fetch(
    `${host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/configuration`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(config || {}),
    }
  );
  if (!response.ok) {
    const errorText = await getResponseText(response);
    throw new Error(`Save failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }
  return response.json();
};


// Helper function to invalidate the repository config cache
const invalidateRepositoryConfigCache = (state, accountName, repositoryName) => {
  if (!state._repoConfigCache) return;
  const cacheKey = `repo-config-${accountName}-${repositoryName}`;
  state._repoConfigCache.delete(cacheKey);
};

const fetchRepositoryConfig = async (state, accountName, repositoryName, forceRefresh = false) => {
  const auth = state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) return null;
  
  // Check cache first to avoid duplicate fetches (unless force refresh)
  const cacheKey = `repo-config-${accountName}-${repositoryName}`;
  if (!state._repoConfigCache) {
    state._repoConfigCache = new Map();
  }
  if (!forceRefresh && state._repoConfigCache.has(cacheKey)) {
    return state._repoConfigCache.get(cacheKey);
  }
  
  try {
    const response = await fetch(
      `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/configuration`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
      }
    );
    if (!response.ok) return null;
    const config = await response.json();
    // Cache the config
    state._repoConfigCache.set(cacheKey, config);
    return config;
  } catch (error) {
    return null;
  }
};

const fetchRepositoryCollaboration = async (state, accountName, repositoryName) => {
  const auth = state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) return [];
  try {
    const response = await fetch(
      `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/collaboration`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
      }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
};

const renderRepositoryCollaborationTable = (collaborators = [], isDirty = false) => {
  const rows = collaborators.map((collaborator, index) => {
    const account = collaborator?.account || collaborator?.name || "Unknown";
    const readAccess = collaborator?.read === true;
    const writeAccess = collaborator?.write === true;
    return `
      <tr class="${index % 2 === 0 ? "even" : "odd"}" data-collaborator-index="${index}">
        <td>
          <input type="text" class="collab-account-input" value="${escapeHtml(String(account))}" data-original="${escapeHtml(String(account))}" style="width: 100%; border: 1px solid #ddd; padding: 4px;" />
        </td>
        <td class="collab-flag" style="text-align: center;">
          <input type="checkbox" class="collab-read-checkbox" data-testid="collab-read-checkbox-${escapeHtml(String(account))}" ${readAccess ? "checked" : ""} data-original="${readAccess}" />
        </td>
        <td class="collab-flag" style="text-align: center;">
          <input type="checkbox" class="collab-write-checkbox" data-testid="collab-write-checkbox-${escapeHtml(String(account))}" ${writeAccess ? "checked" : ""} data-original="${writeAccess}" />
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="collaboration-controls" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <button type="button" class="collab-new-btn" data-testid="collab-new-btn" style="background: #007bff; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;" title="Add Collaborator">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      </button>
      <button type="button" class="collab-save-btn" data-testid="collab-save-btn" disabled style="background: #28a745; color: white; border: none; padding: 6px; border-radius: 4px; cursor: not-allowed; opacity: 0.6; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;" title="Save Changes">
        <img src="./images/file-upload.svg" alt="Save" width="16" height="16" />
      </button>
    </div>
    <table class="collaboration-table">
      <thead>
        <tr>
          <th>Account</th>
          <th style="text-align: center;">Read</th>
          <th style="text-align: center;">Write</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="text-align: center; padding: 12px; color: #666;">No collaborators yet. Click "New" to add one.</td></tr>'}
      </tbody>
    </table>
    <div class="collaboration-data" data-collaboration="${escapeHtml(JSON.stringify(collaborators))}" style="display: none;"></div>
  `;
};

const saveRepositoryCollaboration = async (state, accountName, repositoryName, collaborators) => {
  const auth = state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    throw new Error("Not authenticated");
  }
  const response = await fetch(
    `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/collaboration`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(collaborators),
    }
  );
  if (!response.ok) {
    throw new Error(`Save failed: ${response.status} ${response.statusText}`);
  }
  // 204 No Content responses don't have a body, so don't try to parse JSON
  if (response.status === 204) {
    return null;
  }
  // Only try to parse JSON if there's content
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return null;
};

const getCollaboratorsFromTable = (content) => {
  const rows = content.querySelectorAll(".collaboration-table tbody tr");
  const collaborators = [];
  rows.forEach((row) => {
    const accountInput = row.querySelector(".collab-account-input");
    const readCheckbox = row.querySelector(".collab-read-checkbox");
    const writeCheckbox = row.querySelector(".collab-write-checkbox");
    if (accountInput && accountInput.value.trim()) {
      const read = readCheckbox?.checked || false;
      const write = writeCheckbox?.checked || false;
      // Include all collaborators, even if both read and write are false
      collaborators.push({
        account: accountInput.value.trim(),
        read: read,
        write: write,
      });
    }
  });
  return collaborators;
};

const checkCollaborationDirty = (content) => {
  const dataDiv = content.querySelector(".collaboration-data");
  if (!dataDiv) return false;
  const original = JSON.parse(dataDiv.dataset.collaboration || "[]");
  const current = getCollaboratorsFromTable(content);
  return JSON.stringify(original) !== JSON.stringify(current);
};

const updateCollaborationSaveButton = (content) => {
  const saveBtn = content.querySelector(".collab-save-btn");
  if (!saveBtn) return;
  // Check if save is in progress (button is disabled and shows "Saving...")
  const isSaving = saveBtn.disabled && saveBtn.innerHTML.includes("Saving");
  if (isSaving) {
    // Don't change state if save is in progress
    return;
  }
  const isDirty = checkCollaborationDirty(content);
  saveBtn.disabled = !isDirty;
  saveBtn.style.opacity = isDirty ? "1" : "0.6";
  saveBtn.style.cursor = isDirty ? "pointer" : "not-allowed";
  saveBtn.setAttribute("aria-disabled", isDirty ? "false" : "true");
};

// Load repository history tab data
const loadRepositoryHistoryTab = async (app, accountName, repositoryName, contentElement, tabName) => {
  if (!app || !accountName || !repositoryName || !contentElement) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    contentElement.textContent = "Error: Not authenticated";
    return;
  }

  try {
    contentElement.textContent = `Loading ${tabName} data...`;
    
    let url;
    switch (tabName) {
      case "events":
        url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/history`;
        break;
      case "resources":
        url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/storage`;
        break;
      case "statistics":
        url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/service_statistics`;
        break;
      case "series":
        url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/service_history`;
        break;
      case "revisions":
        url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/revisions`;
        break;
      default:
        contentElement.textContent = `Unknown tab: ${tabName}`;
        return;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!response.ok) {
      const errorText = await getResponseText(response);
      throw new Error(`Failed to load ${tabName}: ${response.status} ${response.statusText} - ${errorText}`);
    }

    let data;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Format data based on tab type
    if (tabName === "events") {
      if (Array.isArray(data) && data.length > 0) {
        let formattedHistory = "";
        data.forEach((entry, index) => {
          const timestamp = entry.timestamp || "Unknown time";
          const agent = entry.agent || "Unknown agent";
          const summary = entry.summary || "No summary available";
          formattedHistory += `${timestamp} - ${agent}\n${summary}`;
          if (index < data.length - 1) {
            formattedHistory += "\n\n";
          }
        });
        contentElement.textContent = formattedHistory;
      } else {
        contentElement.textContent = "No history data available";
      }
    } else {
      // For other tabs, display as formatted JSON
      contentElement.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    }
  } catch (error) {
    console.error(`Error loading ${tabName}:`, error);
    contentElement.textContent = `Error loading ${tabName}: ${error.message}`;
  }
};

const loadRepositoryCollaboration = async (app, pane) => {
  if (!app || !pane) return;
  const content = pane.querySelector(".collaboration-content");
  if (!content || content.dataset.collaborationState === "loaded") {
    // Re-attach event handlers if already loaded
    setupCollaborationHandlers(app, pane, content);
    return;
  }
  const accountName = pane.dataset.account;
  const repositoryName = pane.dataset.repository;
  if (!accountName || !repositoryName) return;
  content.dataset.collaborationState = "loading";
  const collaborators = await fetchRepositoryCollaboration(app.state, accountName, repositoryName);
  content.innerHTML = renderRepositoryCollaborationTable(collaborators, false);
  content.dataset.collaborationState = "loaded";
  setupCollaborationHandlers(app, pane, content);
};

const setupCollaborationHandlers = (app, pane, content) => {
  const accountName = pane.dataset.account;
  const repositoryName = pane.dataset.repository;
  if (!accountName || !repositoryName) return;

  // New button
  const newBtn = content.querySelector(".collab-new-btn");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      const tbody = content.querySelector(".collaboration-table tbody");
      if (!tbody) return;
      // Remove empty message if present
      const emptyRow = tbody.querySelector("td[colspan]");
      if (emptyRow) {
        emptyRow.closest("tr")?.remove();
      }
      const newRow = document.createElement("tr");
      newRow.className = tbody.children.length % 2 === 0 ? "even" : "odd";
      newRow.innerHTML = `
        <td>
          <input type="text" class="collab-account-input" data-testid="collab-account-input" value="" data-original="" style="width: 100%; border: 1px solid #ddd; padding: 4px;" placeholder="Account name" />
        </td>
        <td class="collab-flag" style="text-align: center;">
          <input type="checkbox" class="collab-read-checkbox" data-testid="collab-read-checkbox-new" data-original="false" />
        </td>
        <td class="collab-flag" style="text-align: center;">
          <input type="checkbox" class="collab-write-checkbox" data-testid="collab-write-checkbox-new" data-original="false" />
        </td>
      `;
      tbody.appendChild(newRow);
      setupRowHandlers(content, newRow);
      updateCollaborationSaveButton(content);
      newRow.querySelector(".collab-account-input")?.focus();
    });
  }

  // Save button
  const saveBtn = content.querySelector(".collab-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;
      const collaborators = getCollaboratorsFromTable(content);
      saveBtn.disabled = true;
      const originalContent = saveBtn.innerHTML;
      saveBtn.innerHTML = '<span style="font-size: 12px;">Saving...</span>';
      try {
        await saveRepositoryCollaboration(app.state, accountName, repositoryName, collaborators);
        // Update the stored data
        const dataDiv = content.querySelector(".collaboration-data");
        if (dataDiv) {
          dataDiv.dataset.collaboration = JSON.stringify(collaborators);
        }
        updateCollaborationSaveButton(content);
        saveBtn.innerHTML = '<img src="./images/file-upload.svg" alt="Save" width="16" height="16" />';
        // Show success message or reload
        content.dataset.collaborationState = "needs-reload";
      } catch (error) {
        console.error("Failed to save collaboration:", error);
        let errorMessage = error.message;
        // If error has a response, try to get its text
        if (error.response) {
          try {
            const errorText = await getResponseText(error.response);
            errorMessage += errorText ? ` - ${errorText}` : "";
          } catch (e) {
            // Ignore errors reading response
          }
        }
        alert(`Failed to save collaboration: ${errorMessage}`);
        saveBtn.innerHTML = originalContent;
        saveBtn.disabled = false;
        updateCollaborationSaveButton(content);
      }
    });
  }

  // Input handlers for existing rows
  const rows = content.querySelectorAll(".collaboration-table tbody tr");
  rows.forEach((row) => setupRowHandlers(content, row));
};

const setupRowHandlers = (content, row) => {
  // No delete button - deletion is done by unchecking both read and write checkboxes
  // Add change handlers to checkboxes and input to update save button state
  const readCheckbox = row.querySelector(".collab-read-checkbox");
  const writeCheckbox = row.querySelector(".collab-write-checkbox");
  const accountInput = row.querySelector(".collab-account-input");
  
  const updateHandler = () => {
    updateCollaborationSaveButton(content);
  };
  
  if (readCheckbox) {
    readCheckbox.addEventListener("change", updateHandler);
  }
  if (writeCheckbox) {
    writeCheckbox.addEventListener("change", updateHandler);
  }
  if (accountInput) {
    accountInput.addEventListener("input", updateHandler);
  }
};

// Status message helper
const showStatusMessage = (message, duration = 3000) => {
  const locationBar = document.querySelector("#location-bar");
  if (!locationBar) return;
  const display = locationBar.querySelector("#location-display");
  if (!display) return;
  
  const originalText = display.textContent;
  display.textContent = message;
  
  setTimeout(() => {
    if (display.textContent === message) {
      display.textContent = originalText;
    }
  }, duration);
};

// Format byte count for display
const formatBytes = (bytes) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

// Show dialog to choose import source (local file or remote URL)
const showImportSourceDialog = () => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:400px;width:90%;box-shadow:0 4px 6px rgba(0,0,0,0.1);";
    dialog.innerHTML = `
      <h3 style="margin:0 0 16px 0;font-size:16px;">Import Source</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <input type="radio" name="import-source" value="local" checked style="margin:0;" />
          <span>Local File</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <input type="radio" name="import-source" value="remote" style="margin:0;" />
          <span>Remote URL</span>
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
        <button type="button" class="import-source-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;">Cancel</button>
        <button type="button" class="import-source-continue" data-testid="import-source-continue" style="padding:6px 16px;border:none;border-radius:4px;background:#007bff;color:#fff;cursor:pointer;">Continue</button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    
    dialog.querySelector(".import-source-cancel").addEventListener("click", () => close(null));
    dialog.querySelector(".import-source-continue").addEventListener("click", () => {
      const selected = dialog.querySelector('input[name="import-source"]:checked');
      close(selected ? selected.value : null);
    });
    
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    
    // Allow Enter key to continue
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const selected = dialog.querySelector('input[name="import-source"]:checked');
        close(selected ? selected.value : null);
      } else if (e.key === "Escape") {
        close(null);
      }
    });
  });
};

// Show dialog to enter remote URL
const showRemoteUrlDialog = () => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
    
    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:500px;width:90%;box-shadow:0 4px 6px rgba(0,0,0,0.1);";
    dialog.innerHTML = `
      <h3 style="margin:0 0 16px 0;font-size:16px;">Import from Remote URL</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:14px;font-weight:bold;">URL</span>
          <input type="url" class="remote-url-input" data-testid="import-remote-url-input" placeholder="https://example.com/data.ttl" style="padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;" />
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
        <button type="button" class="remote-url-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;">Cancel</button>
        <button type="button" class="remote-url-import" data-testid="import-remote-url-continue" style="padding:6px 16px;border:none;border-radius:4px;background:#007bff;color:#fff;cursor:pointer;">Import</button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const urlInput = dialog.querySelector(".remote-url-input");
    urlInput.focus();
    
    const close = (url) => {
      overlay.remove();
      resolve(url);
    };
    
    const handleImport = () => {
      const url = urlInput.value.trim();
      if (!url) {
        alert("Please enter a URL");
        return;
      }
      try {
        new URL(url); // Validate URL
        close(url);
      } catch (e) {
        alert("Please enter a valid URL");
      }
    };
    
    dialog.querySelector(".remote-url-cancel").addEventListener("click", () => close(null));
    dialog.querySelector(".remote-url-import").addEventListener("click", handleImport);
    
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleImport();
      }
    });
    
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
  });
};

// Helper function to determine content type from URL or extension
const detectContentTypeFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split(".").pop();
    const contentTypeMap = {
      ttl: "text/turtle",
      rdf: "application/rdf+xml",
      xml: "application/rdf+xml",
      nt: "application/n-triples",
      nq: "application/n-quads",
      trig: "application/x-trig",
      jsonld: "application/ld+json",
      json: "application/ld+json",
      csv: "text/csv",
    };
    return extension ? contentTypeMap[extension] : null;
  } catch (e) {
    return null;
  }
};

// Repository operation handlers (Import, Export, Clear)
const handleRepositoryImport = async (app, accountName, repositoryName, button) => {
  if (!app || !accountName || !repositoryName) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    alert("Not authenticated");
    return;
  }

  // First, ask user to choose import source
  const importSource = await showImportSourceDialog();
  if (!importSource) return; // User cancelled

  if (importSource === "local") {
    // Local file import - existing flow
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttl,.rdf,.xml,.nt,.nq,.trig,.jsonld,.json,.csv";
    input.style.display = "none";
    
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Determine content type from file extension
      const fileNameParts = file.name.split(".");
      const hasExtension = fileNameParts.length > 1;
      const extension = hasExtension ? fileNameParts.pop().toLowerCase() : null;
      const contentTypeMap = {
        ttl: "text/turtle",
        rdf: "application/rdf+xml",
        xml: "application/rdf+xml",
        nt: "application/n-triples",
        nq: "application/n-quads",
        trig: "application/x-trig",
        jsonld: "application/ld+json",
        json: "application/ld+json",
        csv: "text/csv",
      };
      const detectedContentType = extension ? contentTypeMap[extension] : null;

      // Show import options popup (media type selection + async option)
      const importOptions = await showImportOptionsPopup(button, file.name, detectedContentType);
      if (!importOptions) return; // User cancelled
      const contentType = importOptions.contentType;
      const useAsync = importOptions.async;

      // Disable import and export buttons when import starts
      const wasDisabled = button.disabled;
      button.disabled = true;
      const originalText = button.textContent;
      const originalOnClick = button.onclick;
      button.textContent = `Importing ${file.name} (${formatBytes(file.size)})...`;
      const exportBtn = document.querySelector(`.repo-export-btn[data-account="${accountName}"][data-repository="${repositoryName}"]`);
      const exportWasDisabled = exportBtn?.disabled;
      if (exportBtn) exportBtn.disabled = true;

      const restoreButtons = () => {
        button.disabled = wasDisabled;
        button.textContent = originalText;
        button.onclick = originalOnClick;
        if (exportBtn) exportBtn.disabled = exportWasDisabled;
      };

      // Perform the import using XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${auth.host}/${accountName}/${repositoryName}/service`);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("Authorization", `Bearer ${auth.token}`);
      if (useAsync) {
        xhr.setRequestHeader("AcceptAsynchronous", "notify");
      }
      if (importOptions.notificationUrl) {
        xhr.setRequestHeader("Asynchronous-Location", importOptions.notificationUrl);
      }

      // Upload progress tracking
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          button.textContent = `Importing... ${formatBytes(e.loaded)}/${formatBytes(e.total)} (${pct}%)`;
        } else {
          button.textContent = `Importing... ${formatBytes(e.loaded)}`;
        }
      };

      // Enable cancel: repurpose the button during upload
      button.disabled = false;
      button.textContent = `Cancel Import (${formatBytes(file.size)})`;
      button.onclick = () => {
        xhr.abort();
      };

      xhr.onload = () => {
        restoreButtons();
        if (xhr.status >= 200 && xhr.status < 300) {
          showStatusMessage(`File "${file.name}" imported successfully to repository "${repositoryName}"`);
        } else {
          console.error("Import failed:", xhr.status, xhr.statusText, xhr.responseText);
          alert(`Failed to import file "${file.name}": ${xhr.status} ${xhr.statusText} - ${xhr.responseText}`);
        }
      };

      xhr.onerror = () => {
        restoreButtons();
        console.error("Error importing data:", xhr.statusText);
        alert(`Failed to import file "${file.name}": Network error`);
      };

      xhr.onabort = () => {
        restoreButtons();
        showStatusMessage("Import cancelled.");
      };

      xhr.send(file);
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  } else if (importSource === "remote") {
    // Remote URL import
    const remoteUrl = await showRemoteUrlDialog();
    if (!remoteUrl) return; // User cancelled

    // Determine content type from URL
    const detectedContentType = detectContentTypeFromUrl(remoteUrl);
    const fileName = remoteUrl.split("/").pop().split("?")[0] || "remote-data";

    // Show import options popup (media type selection + async option)
    const importOptions = await showImportOptionsPopup(button, fileName, detectedContentType);
    if (!importOptions) return; // User cancelled
    const contentType = importOptions.contentType;
    const useAsync = importOptions.async;

    // Disable import and export buttons when import starts
    const wasDisabled = button.disabled;
    button.disabled = true;
    const originalText = button.textContent;
    const originalOnClick = button.onclick;
    button.textContent = `Fetching from ${remoteUrl}...`;
    const exportBtn = document.querySelector(`.repo-export-btn[data-account="${accountName}"][data-repository="${repositoryName}"]`);
    const exportWasDisabled = exportBtn?.disabled;
    if (exportBtn) exportBtn.disabled = true;

    const restoreButtons = () => {
      button.disabled = wasDisabled;
      button.textContent = originalText;
      button.onclick = originalOnClick;
      if (exportBtn) exportBtn.disabled = exportWasDisabled;
    };

    try {
      // Fetch data from remote URL
      const fetchResponse = await fetch(remoteUrl);
      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch from URL: ${fetchResponse.status} ${fetchResponse.statusText}`);
      }
      const blob = await fetchResponse.blob();
      const file = new File([blob], fileName, { type: contentType });

      button.textContent = `Importing ${fileName} (${formatBytes(file.size)})...`;

      // Perform the import using XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${auth.host}/${accountName}/${repositoryName}/service`);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("Authorization", `Bearer ${auth.token}`);
      if (useAsync) {
        xhr.setRequestHeader("AcceptAsynchronous", "notify");
      }
      if (importOptions.notificationUrl) {
        xhr.setRequestHeader("Asynchronous-Location", importOptions.notificationUrl);
      }

      // Upload progress tracking
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          button.textContent = `Importing... ${formatBytes(e.loaded)}/${formatBytes(e.total)} (${pct}%)`;
        } else {
          button.textContent = `Importing... ${formatBytes(e.loaded)}`;
        }
      };

      // Enable cancel: repurpose the button during upload
      button.disabled = false;
      button.textContent = `Cancel Import (${formatBytes(file.size)})`;
      button.onclick = () => {
        xhr.abort();
      };

      xhr.onload = () => {
        restoreButtons();
        if (xhr.status >= 200 && xhr.status < 300) {
          showStatusMessage(`Data from "${remoteUrl}" imported successfully to repository "${repositoryName}"`);
        } else {
          console.error("Import failed:", xhr.status, xhr.statusText, xhr.responseText);
          alert(`Failed to import from URL "${remoteUrl}": ${xhr.status} ${xhr.statusText} - ${xhr.responseText}`);
        }
      };

      xhr.onerror = () => {
        restoreButtons();
        console.error("Error importing data:", xhr.statusText);
        alert(`Failed to import from URL "${remoteUrl}": Network error`);
      };

      xhr.onabort = () => {
        restoreButtons();
        showStatusMessage("Import cancelled.");
      };

      xhr.send(file);
    } catch (error) {
      restoreButtons();
      console.error("Error fetching remote URL:", error);
      alert(`Failed to fetch from URL "${remoteUrl}": ${error.message}`);
    }
  }
};

// Show popup for import options (media type selection and async option)
// When detectedContentType is provided, that option is pre-selected.
// Returns { contentType, async } or null if cancelled.
const showImportOptionsPopup = (button, fileName, detectedContentType) => {
  return new Promise((resolve) => {
    // Check if form is already visible
    const existingForm = document.querySelector(`#import-media-type-form-${fileName}`);
    if (existingForm) {
      existingForm.remove();
    }

    // Create popup form container
    const formContainer = document.createElement("div");
    formContainer.id = `import-media-type-form-${fileName}`;
    formContainer.style.cssText = `
      position: fixed;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      z-index: 10000;
    `;

    // Create fields container
    const fieldsContainer = document.createElement("div");
    fieldsContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    // Create file name display
    const fileNameLabel = document.createElement("div");
    fileNameLabel.textContent = `File: ${fileName}`;
    fileNameLabel.style.cssText = "font-size: 12px; color: #666; margin-bottom: 4px;";

    // Create media type field
    const mediaTypeContainer = document.createElement("div");
    mediaTypeContainer.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

    const mediaTypeLabel = document.createElement("label");
    mediaTypeLabel.textContent = "Media Type";
    mediaTypeLabel.style.cssText = "font-size: 12px; font-weight: bold; color: #333; margin: 0;";

    const mediaTypeSelect = document.createElement("select");
    mediaTypeSelect.setAttribute("data-testid", "import-media-type-select");
    mediaTypeSelect.style.cssText = "width: 160px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;";
    mediaTypeSelect.innerHTML = `
      <option value="text/turtle">Turtle</option>
      <option value="application/rdf+xml">RDF/XML</option>
      <option value="application/n-triples">N-Triples</option>
      <option value="application/n-quads">N-Quads</option>
      <option value="application/ld+json">JSON-LD</option>
      <option value="text/csv">CSV</option>
      <option value="application/x-trig">TriG</option>
    `;
    if (detectedContentType) {
      mediaTypeSelect.value = detectedContentType;
    }

    mediaTypeContainer.appendChild(mediaTypeLabel);
    mediaTypeContainer.appendChild(mediaTypeSelect);

    // Create async checkbox
    const asyncContainer = document.createElement("div");
    asyncContainer.style.cssText = "display: flex; align-items: center; gap: 6px; margin-top: 4px;";
    const asyncCheckbox = document.createElement("input");
    asyncCheckbox.type = "checkbox";
    asyncCheckbox.id = `import-async-${fileName}`;
    asyncCheckbox.setAttribute("data-testid", "import-async-checkbox");
    asyncCheckbox.style.cssText = "margin: 0;";
    const asyncLabel = document.createElement("label");
    asyncLabel.htmlFor = asyncCheckbox.id;
    asyncLabel.textContent = "Asynchronous import";
    asyncLabel.style.cssText = "font-size: 12px; color: #333; margin: 0; cursor: pointer;";
    asyncContainer.appendChild(asyncCheckbox);
    asyncContainer.appendChild(asyncLabel);

    // Create notification URL field (hidden until async checked)
    const notifyContainer = document.createElement("div");
    notifyContainer.style.cssText = "display: none; flex-direction: column; gap: 2px; margin-top: 4px;";
    const notifyLabel = document.createElement("label");
    notifyLabel.textContent = "Notification URL";
    notifyLabel.style.cssText = "font-size: 12px; font-weight: bold; color: #333; margin: 0;";
    const notifyInput = document.createElement("input");
    notifyInput.type = "url";
    notifyInput.placeholder = "https://...";
    notifyInput.setAttribute("data-testid", "import-notify-url-input");
    notifyInput.style.cssText = "width: 160px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;";
    notifyContainer.appendChild(notifyLabel);
    notifyContainer.appendChild(notifyInput);

    asyncCheckbox.addEventListener("change", () => {
      notifyContainer.style.display = asyncCheckbox.checked ? "flex" : "none";
      if (!asyncCheckbox.checked) {
        notifyInput.value = "";
      }
    });

    // Create buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = "display: flex; gap: 8px; margin-top: 8px;";

    // Create confirm button
    const confirmButton = document.createElement("button");
    confirmButton.textContent = "Import";
    confirmButton.setAttribute("data-testid", "import-confirm-btn");
    confirmButton.style.cssText = `
      background: #6f42c1;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    // Create cancel button
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.setAttribute("data-testid", "import-cancel-btn");
    cancelButton.style.cssText = `
      background: #6c757d;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    // Add elements to form
    fieldsContainer.appendChild(fileNameLabel);
    fieldsContainer.appendChild(mediaTypeContainer);
    fieldsContainer.appendChild(asyncContainer);
    fieldsContainer.appendChild(notifyContainer);
    formContainer.appendChild(fieldsContainer);
    buttonsContainer.appendChild(confirmButton);
    buttonsContainer.appendChild(cancelButton);
    formContainer.appendChild(buttonsContainer);

    // Append to body first to measure width
    document.body.appendChild(formContainer);

    // Position form below the import button, aligned to left edge
    const buttonRect = button.getBoundingClientRect();
    formContainer.style.left = `${buttonRect.left}px`;
    formContainer.style.top = `${buttonRect.bottom + 8}px`;

    // Set up timeout to auto-close
    const timeoutId = setTimeout(() => {
      formContainer.remove();
      document.removeEventListener("click", handleOutsideClick);
      resolve(null);
    }, 10000);

    // Handle form submission
    const handleSubmit = () => {
      const selectedType = mediaTypeSelect.value;
      const useAsync = asyncCheckbox.checked;
      formContainer.remove();
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleOutsideClick);
      resolve({ contentType: selectedType, async: useAsync, notificationUrl: notifyInput.value.trim() });
    };

    // Handle cancel
    const handleCancel = () => {
      formContainer.remove();
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleOutsideClick);
      resolve(null);
    };

    // Add event listeners
    confirmButton.addEventListener("click", handleSubmit);
    cancelButton.addEventListener("click", handleCancel);

    // Add keyboard support
    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    mediaTypeSelect.addEventListener("keydown", handleKeyDown);

    // Close on outside click
    const handleOutsideClick = (e) => {
      if (!formContainer.contains(e.target) && !button.contains(e.target)) {
        formContainer.remove();
        clearTimeout(timeoutId);
        document.removeEventListener("click", handleOutsideClick);
        resolve(null);
      }
    };

    // Add outside click listener after a small delay
    setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 100);

    // Focus on media type select
    mediaTypeSelect.focus();
  });
};

const handleRepositoryExport = async (app, accountName, repositoryName, button) => {
  if (!app || !accountName || !repositoryName) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    alert("Not authenticated");
    return;
  }

  // Check if form is already visible
  const existingForm = document.querySelector(`#export-data-form-${accountName}-${repositoryName}`);
  if (existingForm) {
    existingForm.remove();
    // Button state will be restored by the existing form's cleanup handlers
    return;
  }

  // Disable button to prevent multiple popups
  const wasButtonDisabled = button.disabled;
  const originalButtonText = button.textContent;
  button.disabled = true;

  // Helper to restore button state when popup is cancelled
  const restoreButtonState = () => {
    if (button.disabled && button.textContent !== "Exporting...") {
      button.disabled = wasButtonDisabled;
      button.textContent = originalButtonText;
    }
  };

  // Create popup form container
  const formContainer = document.createElement("div");
  formContainer.id = `export-data-form-${accountName}-${repositoryName}`;
  formContainer.style.cssText = `
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    z-index: 10000;
  `;

  // Create fields container for horizontal layout
  const fieldsContainer = document.createElement("div");
  fieldsContainer.style.cssText = "display: flex; align-items: center; gap: 12px;";

  // Create media type field
  const mediaTypeContainer = document.createElement("div");
  mediaTypeContainer.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
  
  const mediaTypeLabel = document.createElement("label");
  mediaTypeLabel.textContent = "Media Type";
  mediaTypeLabel.style.cssText = "font-size: 12px; font-weight: bold; color: #333; margin: 0;";
  
  const mediaTypeSelect = document.createElement("select");
  mediaTypeSelect.style.cssText = "width: 160px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;";
    mediaTypeSelect.innerHTML = `
      <option value="text/turtle">Turtle</option>
      <option value="application/rdf+xml">RDF/XML</option>
      <option value="application/n-triples">N-Triples</option>
      <option value="application/n-quads">N-Quads</option>
      <option value="application/ld+json">JSON-LD</option>
      <option value="text/csv">CSV</option>
      <option value="application/x-trig">TriG</option>
    `;

  mediaTypeContainer.appendChild(mediaTypeLabel);
  mediaTypeContainer.appendChild(mediaTypeSelect);

  // Add fields to fields container
  fieldsContainer.appendChild(mediaTypeContainer);

  // Create confirm button
  const confirmButton = document.createElement("button");
  confirmButton.textContent = "Export";
  confirmButton.setAttribute("data-testid", "export-confirm-btn");
  confirmButton.style.cssText = `
    background: #28a745;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    margin-top: 20px;
  `;

  // Add elements to form
  formContainer.appendChild(fieldsContainer);
  formContainer.appendChild(confirmButton);

  // Append to body first to measure width
  document.body.appendChild(formContainer);
  
  // Position form so its right edge aligns with the export button's right edge
  const buttonRect = button.getBoundingClientRect();
  const formWidth = formContainer.offsetWidth;
  formContainer.style.left = `${buttonRect.right - formWidth}px`;
  formContainer.style.top = `calc(${buttonRect.top}px - 8px)`;

  // Set up timeout to auto-close
  const timeoutId = setTimeout(() => {
    formContainer.remove();
    document.removeEventListener("click", handleOutsideClick);
    restoreButtonState();
  }, 10000);

  // Handle form submission
  const handleSubmit = async () => {
    const selectedType = mediaTypeSelect.value;

    // Disable export, import, and confirm buttons when export starts
    button.disabled = true;
    button.textContent = "Exporting...";
    confirmButton.disabled = true;
    const originalConfirmText = confirmButton.textContent;
    confirmButton.textContent = "Exporting...";
    const importBtn = document.querySelector(`.repo-import-btn[data-account="${accountName}"][data-repository="${repositoryName}"]`);
    const importWasDisabled = importBtn?.disabled;
    if (importBtn) importBtn.disabled = true;

    // Remove form
    formContainer.remove();
    clearTimeout(timeoutId);
    document.removeEventListener("click", handleOutsideClick);

    try {
      showStatusMessage(`Exporting repository "${repositoryName}" as ${selectedType}...`);

      const response = await fetch(`${auth.host}/${accountName}/${repositoryName}/service`, {
        method: "GET",
        headers: {
          Accept: selectedType,
          Authorization: `Bearer ${auth.token}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const extension = selectedType.includes("turtle") ? "ttl" :
                         selectedType.includes("rdf+xml") ? "rdf" :
                         selectedType.includes("n-triples") ? "nt" :
                         selectedType.includes("ld+json") ? "jsonld" :
                         selectedType.includes("csv") ? "csv" :
                         selectedType.includes("trig") ? "trig" :
                         selectedType.includes("graphviz") ? "gv" : "txt";
        a.download = `${repositoryName}.${extension}`;
        a.click();
        URL.revokeObjectURL(url);
        showStatusMessage(`Repository "${repositoryName}" exported successfully`);
      } else {
        const errorText = await getResponseText(response);
        throw new Error(`Export failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error("Error exporting data:", error);
      let errorMessage = error.message;
      // If error has a response, try to get its text
      if (error.response) {
        try {
          const errorText = await getResponseText(error.response);
          errorMessage += errorText ? ` - ${errorText}` : "";
        } catch (e) {
          // Ignore errors reading response
        }
      }
      alert(`Failed to export repository "${repositoryName}": ${errorMessage}`);
    } finally {
      // Re-enable buttons when operation completes or fails
      button.disabled = wasButtonDisabled;
      button.textContent = originalButtonText;
      if (importBtn) importBtn.disabled = importWasDisabled;
      // Note: confirmButton is removed with formContainer, so no need to restore it
    }
  };

  // Add event listeners
  confirmButton.addEventListener("click", handleSubmit);

  // Add keyboard support (Enter key triggers export)
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      formContainer.remove();
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleOutsideClick);
      restoreButtonState();
    }
  };

  mediaTypeSelect.addEventListener("keydown", handleKeyDown);

  // Close on outside click
  const handleOutsideClick = (e) => {
    if (!formContainer.contains(e.target) && !button.contains(e.target)) {
      formContainer.remove();
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleOutsideClick);
      restoreButtonState();
    }
  };

  // Add outside click listener after a small delay to prevent immediate closure
  setTimeout(() => {
    document.addEventListener("click", handleOutsideClick);
  }, 100);

  // Focus on media type select
  mediaTypeSelect.focus();
};

const handleRepositoryDelete = async (app, accountName, repositoryName, button) => {
  if (!app || !accountName || !repositoryName) return;
  // Check if button is already disabled (another delete in progress)
  if (button.disabled) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    alert("Not authenticated");
    return;
  }

  // Disable button immediately to prevent duplicate clicks/handlers
  button.disabled = true;

  if (!confirm(`Are you sure you want to delete repository "${repositoryName}" in account "${accountName}"? This action cannot be undone.`)) {
    button.disabled = false;
    return;
  }

  // Update button appearance to show delete in progress
  const originalContent = button.innerHTML;
  button.innerHTML = `<img src="${BASE_PATH}/images/trash.svg" alt="Deleting..." style="width: 16px; height: 16px; opacity: 0.3;" />`;

  try {
    const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}`;
    const headers = {
      Accept: "application/n-triples",
      Authorization: `Bearer ${auth.token}`,
    };
    // Do not set Accept-Encoding header
    const response = await fetch(url, {
      method: "DELETE",
      headers: headers,
    });

    if (response.status === 200) {
      const ntriples = await response.text();
      const { subject, pairs } = parseNTriples(ntriples);
      // Show result in an overlay div with table format
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
      const dialog = document.createElement("div");
      dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:600px;width:90%;max-height:70vh;display:flex;flex-direction:column;";
      dialog.innerHTML = `
        <h3 style="margin:0 0 12px 0;font-size:14px;word-break:break-all;display:flex;align-items:center;gap:8px;">
          <span style="color:#666;font-weight:normal;">${response.status}</span>
          <span>${escapeHtml(subject)}</span>
        </h3>
        <div style="overflow-y:auto;flex:1;border:1px solid #ddd;border-radius:4px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;">Property</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;">Value</th>
              </tr>
            </thead>
            <tbody>
              ${pairs.map(([p, o]) => `
                <tr>
                  <td style="padding:8px;border-bottom:1px solid #eee;word-break:break-word;">${escapeHtml(p)}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;word-break:break-word;">${escapeHtml(o)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <button id="delete-result-close" style="margin-top:12px;align-self:flex-end;padding:6px 16px;cursor:pointer;">OK</button>
      `;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      const closeOverlay = () => {
        overlay.remove();
        // Remove repository from state
        app.state.removeOpenRepository(accountName, repositoryName);

        // Remove the repository entry from the DOM list
        const repoEntry = button.closest(".repository");
        if (repoEntry) {
          const repoList = repoEntry.closest(".repository-list, .repo-list, ul");
          repoEntry.remove();
          // Re-stripe remaining entries
          if (repoList) {
            repoList.querySelectorAll(".repository").forEach((el, i) => {
              el.className = `repository ${i % 2 === 0 ? "odd" : "even"}`;
            });
          }
        }

        // Close the repository pane tab if it's open
        const paneId = `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
        const repoPane = document.getElementById(paneId);
        if (repoPane) {
          repoPane.remove();
        }
        // Remove the tab from the tabs bar
        const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
        if (tabLink) {
          const tabLi = tabLink.closest("li");
          if (tabLi) {
            tabLi.remove();
          }
        }

        // Navigate to account pane
        if (app.router) {
          app.router.navigate(`${BASE_PATH}/account/${encodeURIComponent(accountName)}`);
        }
      };
      dialog.querySelector("#delete-result-close").addEventListener("click", closeOverlay);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
    } else {
      const errorText = await getResponseText(response);
      alert(`Delete failed (${response.status}): ${errorText}`);
    }
  } catch (error) {
    console.error("Error deleting repository:", error);
    let errorMessage = error.message;
    // If error has a response, try to get its text
    if (error.response) {
      try {
        const errorText = await getResponseText(error.response);
        errorMessage += errorText ? ` - ${errorText}` : "";
      } catch (e) {
        // Ignore errors reading response
      }
    }
    alert(`Failed to delete repository "${repositoryName}": ${errorMessage}`);
  } finally {
    // Re-enable button when operation fails (on success, the entry is removed from DOM)
    button.disabled = false;
    button.innerHTML = originalContent;
  }
};

const handleViewDelete = async (app, accountName, repositoryName, viewName, button) => {
  if (!app || !accountName || !repositoryName || !viewName) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    alert("Not authenticated");
    return;
  }

  if (!confirm(`Are you sure you want to delete view "${viewName}" from repository "${repositoryName}"? This action cannot be undone.`)) {
    return;
  }

  // Disable button when delete starts
  const wasDisabled = button.disabled;
  button.disabled = true;
  const originalContent = button.innerHTML;
  button.innerHTML = `<img src="${BASE_PATH}/images/trash.svg" alt="Deleting..." style="width: 16px; height: 16px; opacity: 0.3;" />`;

  try {
    const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(ensureBaseViewName(viewName))}`;
    const headers = {
      Accept: "application/n-triples",
      Authorization: `Bearer ${auth.token}`,
    };
    // Do not set Accept-Encoding header
    const response = await fetch(url, {
      method: "DELETE",
      headers: headers,
    });

    if (response.ok) {
      // Invalidate the repository config cache so views are refreshed on next fetch
      invalidateRepositoryConfigCache(app.state, accountName, repositoryName);
      
      // Parse N-Triples response
      const ntriples = await response.text();
      const { subject, pairs } = parseNTriples(ntriples);
      
      // Show result in an overlay div with table format if we have pairs
      if (pairs.length > 0) {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
        const dialog = document.createElement("div");
        dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;max-width:600px;width:90%;max-height:70vh;display:flex;flex-direction:column;";
        dialog.innerHTML = `
          <h3 style="margin:0 0 12px 0;font-size:14px;word-break:break-all;display:flex;align-items:center;gap:8px;">
            <span style="color:#666;font-weight:normal;">${response.status}</span>
            <span>${escapeHtml(subject || `View "${viewName}" Deletion Result`)}</span>
          </h3>
          <div style="overflow-y:auto;flex:1;border:1px solid #ddd;border-radius:4px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#f5f5f5;">
                  <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;">Property</th>
                  <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;">Value</th>
                </tr>
              </thead>
              <tbody>
                ${pairs.map(([p, o]) => `
                  <tr>
                    <td style="padding:8px;border-bottom:1px solid #eee;word-break:break-word;">${escapeHtml(p)}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;word-break:break-word;">${escapeHtml(o)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <button id="delete-result-close" style="margin-top:12px;align-self:flex-end;padding:6px 16px;cursor:pointer;">OK</button>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        const closeOverlay = () => {
          overlay.remove();
        };
        dialog.querySelector("#delete-result-close").addEventListener("click", closeOverlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
      } else {
        showStatusMessage(`View "${viewName}" deleted successfully`);
      }
      
      // Find the view item and remove it from the DOM
      const viewItem = button.closest(".query");
      if (viewItem) {
        const queryContainer = viewItem.closest(".query-container");
        viewItem.remove();
        // If no views left, show the empty message
        if (queryContainer && queryContainer.querySelectorAll(".query").length === 0) {
          queryContainer.innerHTML = `
            <div class="query">
              <p>No queries have been defined for this repository yet. <strong><a href="${BASE_PATH}/account/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/new">Create one now!</a></strong></p>
            </div>
          `;
        }
      }
      
      // Remove the editor from the repository pane's editor stack if it exists
      const baseViewName = ensureBaseViewName(viewName);
      // Use specific .repository-pane selector to avoid matching buttons or other elements
      const repositoryPane = document.querySelector(`.repository-pane[data-account="${escapeHtml(accountName)}"][data-repository="${escapeHtml(repositoryName)}"]`);
      if (repositoryPane) {
        const editorsContainer = repositoryPane.querySelector(".view-editors-container");
        if (editorsContainer) {
          // Find the editor wrapper by data-view-name attribute
          // Try multiple approaches since the attribute may be set via dataset or directly
          let editorWrapper = editorsContainer.querySelector(`.view-editor[data-view-name="${baseViewName}"]`);
          if (!editorWrapper) {
            editorWrapper = editorsContainer.querySelector(`.view-editor[data-view-name="${escapeHtml(baseViewName)}"]`);
          }
          // If still not found, try finding by iterating through all editors
          if (!editorWrapper) {
            const allEditors = editorsContainer.querySelectorAll(".view-editor");
            for (const editor of allEditors) {
              if (editor.dataset.viewName === baseViewName || editor.dataset.viewName === escapeHtml(baseViewName)) {
                editorWrapper = editor;
                break;
              }
            }
          }
          if (editorWrapper) {
            console.log("[handleViewDelete] Removing editor for view:", baseViewName);
            // Remove the editor instance from app.editorInstances if it exists
            if (app && app.editorInstances) {
              const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
              app.editorInstances.delete(repoEditorId);
            }
            // Remove the editor wrapper from the DOM
            editorWrapper.remove();
            console.log("[handleViewDelete] Editor removed successfully");
          } else {
            console.warn("[handleViewDelete] Editor wrapper not found for view:", baseViewName, "in repository pane. Checking all editors...");
            // Log all editors for debugging
            const allEditors = editorsContainer.querySelectorAll(".view-editor");
            allEditors.forEach((e, i) => console.log(`  Editor ${i}: data-view-name="${e.dataset.viewName}"`));
          }
        } else {
          console.warn("[handleViewDelete] No view-editors-container found in repository pane");
        }
      } else {
        console.warn("[handleViewDelete] Repository pane not found for:", accountName, repositoryName);
      }

      // Also close the separate view pane if it exists
      const viewPaneId = `tab-view-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
      const viewPane = document.getElementById(viewPaneId);
      if (viewPane) {
        console.log("[handleViewDelete] Removing separate view pane:", viewPaneId);
        // Remove from state
        app.state.removeOpenView(accountName, repositoryName, baseViewName);
        // Remove editor instance
        if (app.editorInstances) {
          app.editorInstances.delete(viewPaneId);
        }
        // Remove the pane
        viewPane.remove();
        // Remove the tab
        const tabLink = document.querySelector(`[data-tab-link][href="#${viewPaneId}"]`);
        if (tabLink) {
          const tabLi = tabLink.closest("li");
          if (tabLi) {
            tabLi.remove();
          }
        }
        // Activate another tab
        if (app.activateTab) {
          const tabsList = document.querySelector("[data-tab-list]");
          if (tabsList) {
            const remainingTabs = tabsList.querySelectorAll("[data-tab-link]");
            if (remainingTabs.length > 0) {
              const lastTab = remainingTabs[remainingTabs.length - 1];
              const href = lastTab.getAttribute("href");
              if (href) {
                app.activateTab(href);
              }
            }
          }
        }
      }
    } else {
      const errorText = await getResponseText(response);
      throw new Error(`Delete failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
  } catch (error) {
    console.error("Error deleting view:", error);
    let errorMessage = error.message;
    // If error has a response, try to get its text
    if (error.response) {
      try {
        const errorText = await getResponseText(error.response);
        errorMessage += errorText ? ` - ${errorText}` : "";
      } catch (e) {
        // Ignore errors reading response
      }
    }
    alert(`Failed to delete view "${viewName}": ${errorMessage}`);
  } finally {
    // Re-enable button when operation completes or fails
    button.disabled = wasDisabled;
    button.innerHTML = originalContent;
  }
};

const handleRepositoryClear = async (app, accountName, repositoryName, button) => {
  if (!app || !accountName || !repositoryName) return;
  const auth = app.state.getAuthContext(accountName);
  if (!auth?.token || !auth?.host) {
    alert("Not authenticated");
    return;
  }

  if (!confirm(`Are you sure you want to clear all data from repository "${repositoryName}" in account "${accountName}"? This action cannot be undone.`)) {
    return;
  }

  // Disable button when clear starts
  const wasDisabled = button?.disabled || false;
  if (button) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Clearing...";
  }

  try {
    const response = await fetch(`${auth.host}/${accountName}/${repositoryName}/service`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (response.ok) {
      showStatusMessage(`All data cleared from repository "${repositoryName}"`);
    } else {
      const errorText = await getResponseText(response);
      throw new Error(`Clear failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
  } catch (error) {
    console.error("Error clearing repository:", error);
    let errorMessage = error.message;
    // If error has a response, try to get its text
    if (error.response) {
      try {
        const errorText = await getResponseText(error.response);
        errorMessage += errorText ? ` - ${errorText}` : "";
      } catch (e) {
        // Ignore errors reading response
      }
    }
    alert(`Failed to clear repository "${repositoryName}": ${errorMessage}`);
  } finally {
    // Re-enable button when operation completes or fails
    if (button) {
      button.disabled = wasDisabled;
      button.textContent = originalText || "Clear";
    }
  }
};

export const buildLoginContent = (state = null) => {
  // Get last username from localStorage if available
  let lastUsername = "";
  if (state) {
    try {
      const stored = JSON.parse(window.localStorage.getItem("dydra.session"));
      lastUsername = stored?.accountName || "";
    } catch (error) {
      // Ignore errors
    }
  }
  
  return `
  <div id="login-error" class="widget" style="display:none;">
    <div class="alert-error rounded">
      <p class="message">
        <span class="icon icon-alert"></span>
        <span id="login-error-text"></span>
      </p>
    </div>
  </div>
  <form id="inline-login-form" class="formtastic" onsubmit="return false;" data-testid="login-form">
    <fieldset class="inputs">
      <ol>
        <li class="string optional"><label>Host</label><input type="text" name="host" placeholder="dydra.com" data-testid="login-host-input" /></li>
        <li class="string optional"><label>Username</label><input type="text" name="login" value="${escapeHtml(lastUsername)}" data-testid="login-username-input" /></li>
        <li class="password optional"><label>Password or Token</label><input type="password" name="password" data-testid="login-password-input" /></li>
      </ol>
    </fieldset>
    <fieldset class="buttons">
      <ol>
        <li class="commit"><input type="submit" value="Log in" data-testid="login-submit" /></li>
      </ol>
    </fieldset>
  </form>
  <div id="login-status" class="small text-muted" data-testid="login-status"></div>
  <p class="password-recovery-link"><a href="${BASE_PATH}/reset_password.html" data-testid="login-forgot-password-link">Forgot your password?</a></p>
  <p class="invite-request-link"><a href="${BASE_PATH}/invite" data-testid="login-invite-link">Request an invitation</a></p>
`;
};

export const buildInfoContent = () => {
  return `
    <div id="feature">
      <div class="wrapper">
        <div id="feature-0">
          <div id="feature-1">
            <div id="feature-2">
              <h1 id="logo">Dydra</h1>
              <div id="intro">
                <h1>Networks Made Friendly</h1>
                <p>
                  <strong>Dydra&nbsp;</strong>
                  is a powerful&nbsp;
                  <strong>graph database&nbsp;</strong>
                  in the cloud,
                  allowing your business to make the most of highly connected data, such as social networks.
                  <br />
                  It's fast, easy to use and affordable.
                  <a href="http://${APP_CONFIG.docsHost}/dydra">Learn more&nbsp;&raquo;</a>
                  <br />
                  <a href="${BASE_PATH}/account/jhacker">Visit a sample account</a>
                </p>
              </div>
              <div id="datatree"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="demo">
      <div class="wrapper">
        <div id="demo-intro">
          <h2>Here's what we've been up to</h2>
          <ul>
            <li><a href="http://blog.dydra.com/2015/10/08/nxp-data-hub">NXP Wins the EU Linked data Award</a></li>
            <li><a href="http://blog.dydra.com/2015/09/15/rdf-patches">Looking for an RDF Patch Format</a></li>
          </ul>
        </div>
        <ul id="demo-paginator">
          <li id="demo-paginator-indicator"></li>
          <li class="active"><a href="#code-create"><span class="number">1</span>Create</a></li>
          <li><a href="#code-import"><span class="number">2</span>Import</a></li>
          <li><a href="#code-query"><span class="number">3</span>Query</a></li>
        </ul>
        <div id="code">
          <div id="code-create" class="demo-snippet">
            <p class="command">$ dydra create foaf</p>
            <p class="output">
              Username: jhacker<br />
              Created http://dydra.com/jhacker/foaf
            </p>
          </div>
          <div id="code-import" class="demo-snippet" style="display:none">
            <p class="command">$ dydra import foaf &lt;br/&gt;http://datagraph.org/jhacker/foaf.nt</p>
            <p class="output">Imported 10 triples into http://dydra.com/jhacker/foaf</p>
          </div>
          <div id="code-query" class="demo-snippet" style="display:none">
            <p class="command">$ dydra query foaf &lt;br/&gt;'select distinct ?s where { ?s ?p ?o }'</p>
            <p class="output">&laquo;http://dydra.com/jhacker/#self&raquo;</p>
          </div>
        </div>
      </div>
    </div>
    <div id="main">
      <div id="main-0">
        <div class="wrapper">
          <div id="content">
            <div id="mainteinability" class="block">
              <h5>Hassle-free operations</h5>
              <p>We take care of system administration and maintenance. You just use it.</p>
            </div>
            <div id="reliability" class="block">
              <h5>Reliability comes standard</h5>
              <p>We focus on data integrity and availability. You focus on your business.</p>
            </div>
            <div id="scalability" class="block">
              <h5>Always in balance</h5>
              <p>Dydra grows with your data. Worrying about scaling is a thing of the past.</p>
            </div>
            <div id="affordability" class="block">
              <h5>Saves you money</h5>
              <p>The basic plan is free. We'll offer more powerful paid tiers after the beta period.</p>
            </div>
          </div>
          <div id="aside">
            <form id="join-beta" onsubmit="return false;">
              <h3>Get an Account</h3>
              <p>Enter your email address and we'll<br />send you an access code.</p>
              <p class="textfield">
                <input id="invitation_email" name="invitation[email]" type="text" value="Your email address..." />
                <a class="disabled submit" href="#">Notify Me</a>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
`;
};

const renderPaneTabsBar = ({ tabs = [], avatarUrl = "" } = {}) => `
  <div class="pane-tabs-bar">
    ${avatarUrl ? `<img class="tabs-avatar" src="${avatarUrl}" alt="avatar" />` : ""}
    <ul data-tab-list>
      ${tabs.map((tab) => `
        <li>
          <a href="#${tab.id}" data-tab-link data-location="${tab.location || ""}" data-show-aside="${tab.showAside ? "true" : "false"}" data-body-class="${tab.bodyClass || ""}">
            <span class="tab-label">${tab.label}</span>
            ${(tab.closeable || tab.saveable) ? `
              <span class="tab-actions-vertical">
                ${tab.closeable ? `<span class="tab-icon tab-close" data-tab-action="close" data-tab-id="${tab.id}" data-tab-type="${tab.type || ""}" data-account="${tab.accountName || ""}" data-repository="${tab.repositoryName || ""}" data-view="${tab.viewName || ""}" data-testid="tab-close-${tab.id}"></span>` : ""}
                ${tab.saveable ? `<span class="tab-icon tab-save" data-tab-action="save" data-tab-id="${tab.id}" data-tab-type="${tab.type || ""}" data-account="${tab.accountName || ""}" data-repository="${tab.repositoryName || ""}" data-testid="tab-save-${tab.id}" aria-disabled="true"></span>` : ""}
              </span>
            ` : ""}
          </a>
        </li>
      `).join("")}
    </ul>
  </div>
`;

const renderAccountPane = ({ accountName, account, repos, config = {}, authToken = "", tracker = null }) => `
  <div id="${paneIdAccount(accountName)}" class="account-pane" data-account="${escapeHtml(accountName)}">
    <div class="account-pane-layout">
      <div class="account-pane-content">
        ${renderAccountRepositories({ account, repos })}
      </div>
      ${renderAccountSidebar({
        account,
        accountName,
        config,
        authToken,
        tracker,
      })}
    </div>
  </div>
`;

const REPOSITORY_FIELD_DEFS = {
  homepage: { title: "Homepage", field: "homepage", type: "url", editable: true },
  summary: { title: "Summary", field: "abstract", type: "text", editable: true },
  description: { title: "Description", field: "description", type: "textarea", editable: true },
  privacy_setting: { title: "Privacy setting", field: "privacy_setting", type: "text", editable: true },
  permissible_ip_addresses: { title: "Permissible IP addresses", field: "permissible_ip_addresses", type: "textarea", editable: true },
  class: { title: "Class", field: "class", type: "text", editable: false },
  title: { title: "Title", field: "title", type: "text", editable: false },
  owner: { title: "Owner", field: "owner", type: "text", editable: false },
  name: { title: "Repository Name", field: "name", type: "text", editable: false },
  id: { title: "ID", field: "id", type: "text", editable: false },
  has_parent: { title: "Has parent", field: "has_parent", type: "text", editable: false },
  has_owner: { title: "Has owner", field: "has_owner", type: "text", editable: false },
  uuid: { title: "UUID", field: "uuid", type: "text", editable: false },
};

const REPOSITORY_PANE_REGISTRY = {
  profile: {
    title: "Profile",
    fieldKeys: ["name", "homepage", "summary", "description", "privacy_setting"],
  },
  settings: {
    title: "Configuration",
    fieldKeys: ["class", "owner", "id", "has_parent", "has_owner", "uuid"],
  },
  ips: {
    title: "Permissible IPs",
    fieldKeys: ["permissible_ip_addresses"],
  },
};

const REPOSITORY_SETTINGS_EXCLUDE = new Set([
  ...Object.keys(REPOSITORY_FIELD_DEFS),
  "@type",
  "accountname",
  "accesstoken",
  "abstract",
  "privacysetting",
  "class",
  "title",
  "name",
  "views",
  "prefixes",
]);

const buildRepositoryFieldDefs = (config = {}) => {
  const defs = { ...REPOSITORY_FIELD_DEFS };
  // Add any additional fields from config to defs (but they won't appear in panes unless explicitly listed in registry)
  Object.entries(config || {}).forEach(([key, value]) => {
    if (REPOSITORY_SETTINGS_EXCLUDE.has(key)) return;
    if (value === undefined || value === null || value === "") return;
    if (defs[key]) return;
    const title = key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
    defs[key] = {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      field: key,
      type: "text",
      editable: false,
    };
  });
  return defs;
};

const resolveRepositoryFieldValue = ({ fieldKey, defs, tracker, config, repository }) => {
  const def = defs[fieldKey];
  if (!def) return "";
  const sources = [tracker, config, repository];
  const keys = [def.field];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }
  }
  return "";
};

const renderRepositoryPane = async (state, accountName, repositoryName) => {
  const account = await state.getAccount(accountName);
  const repository = await state.getRepository(accountName, repositoryName);
  // Check if tracker already has config to avoid duplicate fetch
  let tracker = state.getRepositoryTracker(accountName, repositoryName);
  let config = null;
  // Always fetch fresh config to ensure we have the latest views (including deletions)
  // This ensures that if a view was deleted directly on the service, it won't appear in the list
  config = await fetchRepositoryConfig(state, accountName, repositoryName, true);
  tracker = state.ensureRepositoryTracker(accountName, repositoryName, config || {});
  const defs = buildRepositoryFieldDefs(config || {});
  const privacyValue = tracker?.privacy_setting ?? config?.privacy_setting ?? config?.privacySetting ?? "private";
  const permissibleValue = tracker?.permissible_ip_addresses ?? config?.permissible_ip_addresses ?? "";
  const classValue = config?.class ?? "LMDB-REPOSITORY";
  const profileKeys = REPOSITORY_PANE_REGISTRY.profile.fieldKeys;
  // Prefixes is a string with entries separated by \n
  const prefixes = String(tracker?.prefixes ?? config?.prefixes ?? "");
  const prefixesText = prefixes;
  const auth = state.getAuthContext(accountName);
  const host = auth?.host || window.location.origin;
  const encodedAccount = encodeURIComponent(accountName);
  const encodedRepository = encodeURIComponent(repositoryName);
  const graphStoreUrl = `${host}/${encodedAccount}/${encodedRepository}/service`;
  const sparqlUrl = `${host}/${encodedAccount}/${encodedRepository}/sparql`;
  const directDownloadUrl = `${host}/${encodedAccount}/${encodedRepository}.ttl`;
  const views = await fetchRepositoryViews(state, accountName, repositoryName, config);
  return `
    <div id="${paneIdRepository(accountName, repositoryName)}" class="repository-pane" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-class="${escapeHtml(classValue)}">
      <div class="repository-pane-layout">
        <div class="repository-pane-content">
          <div id="repository-detail">
            <div id="repository-summary">
              ${repository?.summary ? `<p>${escapeHtml(repository.summary)}</p>` : ""}
            </div>
          </div>
          <div id="repository-queries">
            <div class="block">
              <div class="repository-views-layout">
                <div class="query-catalog">
                  <h2>Views <button type="button" class="view-new-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="view-new-btn" style="
                    font-size: 13px; padding: 2px 8px; margin-left: 8px; cursor: pointer; vertical-align: middle;
                  ">New</button></h2>
                  <div class="query-container">
                    ${views.length ? joinHtml(views.map((view, index) => `
                      <div class="query ${index % 2 === 0 ? "even" : "odd"}">
                        <a class="view-edit" data-view-name="${escapeHtml(view.friendlyId)}" data-action="open-view" data-testid="view-edit-${escapeHtml(view.friendlyId)}" href="#">${escapeHtml(view.name)}</a>
                        <span style="float: right; display: flex; align-items: center; gap: 4px;">
                          <span class="owner"> <a href="${BASE_PATH}/account/${escapeHtml(accountName)}">${escapeHtml(accountName)}</a> </span>
                          <button type="button" class="view-pane-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(view.friendlyId)}" data-testid="view-pane-btn-${escapeHtml(view.friendlyId)}" style="
                            background: transparent;
                            border: none;
                            padding: 2px;
                            cursor: pointer;"
                            title="Open view in new pane">
                            <img src="${BASE_PATH}/images/folder-plus.svg" alt="Edit Pane" style="width: 16px; height: 16px; opacity: 0.6;" />
                          </button>
                          <button type="button" class="view-window-button" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(view.friendlyId)}" data-testid="view-window-btn-${escapeHtml(view.friendlyId)}" style="
                            background: transparent;
                            border: none;
                            padding: 2px;
                            cursor: pointer;
                          " title="Open view results in new window">
                            <img src="${BASE_PATH}/images/link.svg" alt="Open in window" style="width: 16px; height: 16px; opacity: 0.6;" />
                          </button>
                          <button type="button" class="view-delete-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(view.friendlyId)}" data-testid="view-delete-btn-${escapeHtml(view.friendlyId)}" style="
                            background: transparent;
                            border: none;
                            padding: 2px;
                            cursor: pointer;
                          " title="Delete View">
                            <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width: 16px; height: 16px; opacity: 0.6;" />
                          </button>
                        </span>
                      </div>
                    `)) : `
                      <div class="query">
                        <p>No queries have been defined for this repository yet. <strong><a href="${BASE_PATH}/account/${escapeHtml(accountName)}/repositories/${escapeHtml(repositoryName)}/views/new">Create one now!</a></strong></p>
                      </div>
                    `}
                  </div>
                </div>
                <div class="view-editors">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <h2 style="margin: 0;">Editors</h2>
                      ${/revisioned/i.test(classValue) ? `
                        <label style="font-size: 12px; color: #666; margin: 0;">Revision:</label>
                        <select class="pane-revision-select" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" style="font-size: 10px; height: 20px; padding: 2px 4px; border: 1px solid #d1d5db; border-radius: 4px;">
                          <option value="HEAD" selected>HEAD</option>
                        </select>
                      ` : ''}
                    </div>
                    <div class="repository-operation-buttons" style="display: flex; gap: 8px;">
                      <button type="button" class="repo-import-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="repo-import-btn" style="
                        background: #6f42c1;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                      " title="Import Data">Import</button>
                      <button type="button" class="repo-export-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="repo-export-btn" style="
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                      " title="Export Data">Export</button>
                      <button type="button" class="repo-clear-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="repo-clear-btn" style="
                        background: #dc3545;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                      " title="Clear Repository Content">Clear</button>
                    </div>
                  </div>
                  <div class="view-editors-container"></div>
                </div>
              </div>
            </div>
          </div>
          <div id="repository-about">
            <h2>Readme</h2>
            <div id="repository-markdown">
              ${(() => {
                const descriptionDef = defs.description;
                const descriptionValue = descriptionDef ? resolveRepositoryFieldValue({ fieldKey: "description", defs, tracker, config, repository }) : null;
                const descriptionText = descriptionValue ? (DISPLAY_TYPE_HANDLERS[descriptionDef?.type] || DISPLAY_TYPE_HANDLERS.text).format(descriptionValue) : "";
                return descriptionText ? `<p>${escapeHtml(descriptionText)}</p>` : `<p>A description has not been added for this repository yet.</p>`;
              })()}
            </div>
          </div>
        </div>
        <div class="repository-sidebar">
          <div class="repository-meta-tabs">
            <button type="button" class="manage-tab active" data-tab="profile" data-testid="repo-tab-profile" title="Profile"><img src="./images/database.svg" alt="Profile" width="16" height="16" /></button>
            <button type="button" class="manage-tab" data-tab="settings" data-testid="repo-tab-settings" title="Configuration"><img src="./images/settings.svg" alt="Configuration" width="16" height="16" /></button>
            <button type="button" class="manage-tab" data-tab="ips" data-testid="repo-tab-ips" title="Permissible IPs" ${privacyValue === "readByAuthenticatedUserOrIP" ? "" : "disabled"} style="${privacyValue === "readByAuthenticatedUserOrIP" ? "" : "opacity: 0.5; cursor: not-allowed;"}"><img src="./images/world-check.svg" alt="Permissible IPs" width="16" height="16" /></button>
            <button type="button" class="manage-tab" data-tab="prefixes" data-testid="repo-tab-prefixes" title="Prefixes"><img src="./images/puzzle.svg" alt="Prefixes" width="16" height="16" /></button>
            <button type="button" class="manage-tab" data-tab="collaboration" data-testid="repo-tab-collaboration" title="Collaboration"><img src="./images/users.svg" alt="Collaboration" width="16" height="16" /></button>
            <button type="button" class="manage-tab" data-tab="logs" data-testid="repo-tab-logs" title="Logs"><img src="./images/logs.svg" alt="Logs" width="16" height="16" /></button>
          </div>
          <div class="repository-meta-panel active" data-panel="profile">
            ${profileKeys.map((fieldKey) => {
              const def = defs[fieldKey];
              if (!def) return "";
              const rawValue = resolveRepositoryFieldValue({ fieldKey, defs, tracker, config, repository });
              const formatted = (DISPLAY_TYPE_HANDLERS[def.type] || DISPLAY_TYPE_HANDLERS.text).format(
                typeof rawValue === "object" ? JSON.stringify(rawValue, null, 2) : rawValue
              );
              const isEmpty = !formatted || formatted === "";
              // Non-editable fields should be displayed as read-only text
              if (def.editable === false) {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <span class="value">${escapeHtml(String(formatted))}</span>
                  </div>
                `;
              }
              // Special handling for privacy_setting - show as select dropdown
              if (fieldKey === "privacy_setting") {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <select class="repo-config-input" data-repo-field="privacy_setting" data-testid="repo-field-privacy">
                      <option value="private" ${privacyValue === "private" ? "selected" : ""}>Private</option>
                      <option value="readByIP" ${privacyValue === "readByIP" ? "selected" : ""}>Read By IP</option>
                      <option value="readByAuthenticatedUser" ${privacyValue === "readByAuthenticatedUser" ? "selected" : ""}>Read By Authenticated User</option>
                      <option value="readByAuthenticatedUserOrIP" ${privacyValue === "readByAuthenticatedUserOrIP" ? "selected" : ""}>Read By Authenticated User Or IP</option>
                      <option value="public" ${privacyValue === "public" ? "selected" : ""}>Public</option>
                    </select>
                  </div>
                `;
              }
              // Empty editable fields show "-" inline with label, click to edit
              if (isEmpty) {
                return `
                  <div class="repo-meta-field has-empty-value">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <span class="value empty" data-repo-field="${escapeHtml(def.field)}" data-field-type="${escapeHtml(def.type)}" data-testid="repo-field-${escapeHtml(def.field)}" data-editable="true">-</span>
                  </div>
                `;
              }
              // Editable fields with values: render as inputs/textarea
              if (def.type === "textarea") {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <textarea class="repo-config-input" data-repo-field="${escapeHtml(def.field)}" data-testid="repo-field-${escapeHtml(def.field)}" rows="3">${escapeHtml(String(formatted))}</textarea>
                  </div>
                `;
              }
              return `
                <div class="repo-meta-field">
                  <span class="label">${escapeHtml(def.title)}:</span>
                  <input class="repo-config-input" data-repo-field="${escapeHtml(def.field)}" data-testid="repo-field-${escapeHtml(def.field)}" type="${escapeHtml(def.type)}" value="${escapeHtml(String(formatted))}" />
                </div>
              `;
            }).join("")}
          </div>
          <div class="repository-meta-panel" data-panel="settings">
            ${REPOSITORY_PANE_REGISTRY.settings.fieldKeys.map((fieldKey) => {
              const def = defs[fieldKey];
              if (!def) return "";
              const rawValue = resolveRepositoryFieldValue({ fieldKey, defs, tracker, config, repository });
              const formatted = (DISPLAY_TYPE_HANDLERS[def.type] || DISPLAY_TYPE_HANDLERS.text).format(rawValue);
              const isEmpty = !formatted || formatted === "";
              // Check editability from tracker's editableProperties() if available, otherwise use def.editable
              let isEditable = def.editable === true;
              if (tracker && typeof tracker.editableProperties === "function") {
                const editableProps = tracker.editableProperties();
                isEditable = editableProps.includes(fieldKey);
              }
              // Non-editable fields should be displayed as read-only text
              if (!isEditable) {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <span class="value">${escapeHtml(String(formatted))}</span>
                  </div>
                `;
              }
              // Empty editable fields show "-" inline with label, click to edit
              if (isEmpty) {
                return `
                  <div class="repo-meta-field has-empty-value">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <span class="value empty" data-repo-field="${escapeHtml(def.field)}" data-field-type="${escapeHtml(def.type)}" data-editable="true">-</span>
                  </div>
                `;
              }
              if (def.type === "textarea") {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <textarea class="repo-config-input" data-repo-field="${escapeHtml(def.field)}" rows="3">${escapeHtml(String(formatted))}</textarea>
                  </div>
                `;
              }
              return `
                <div class="repo-meta-field">
                  <span class="label">${escapeHtml(def.title)}:</span>
                  <input class="repo-config-input" data-repo-field="${escapeHtml(def.field)}" type="${escapeHtml(def.type)}" value="${escapeHtml(String(formatted))}" />
                </div>
              `;
            }).join("")}
            <div class="repo-meta-field">
              <span class="label">Graph Store Protocol:</span>
              <span class="value"><a href="${escapeHtml(graphStoreUrl)}" target="_blank">${escapeHtml(graphStoreUrl)}</a></span>
            </div>
            <div class="repo-meta-field">
              <span class="label">SPARQL Endpoint:</span>
              <span class="value"><a href="${escapeHtml(sparqlUrl)}" target="_blank">${escapeHtml(sparqlUrl)}</a></span>
            </div>
            <div class="repo-meta-field">
              <span class="label">Direct Download:</span>
              <span class="value"><a href="${escapeHtml(directDownloadUrl)}" target="_blank">${escapeHtml(directDownloadUrl)}</a></span>
            </div>
          </div>
          <div class="repository-meta-panel" data-panel="ips">
            ${(() => {
              const def = defs.permissible_ip_addresses;
              if (!def) return "";
              const rawValue = resolveRepositoryFieldValue({ fieldKey: "permissible_ip_addresses", defs, tracker, config, repository });
              const formatted = Array.isArray(permissibleValue) ? permissibleValue.join("\n") : String(permissibleValue || "");
              // Check editability from tracker's editableProperties() if available, otherwise use def.editable
              let isEditable = def.editable === true;
              if (tracker && typeof tracker.editableProperties === "function") {
                const editableProps = tracker.editableProperties();
                isEditable = editableProps.includes("permissible_ip_addresses");
              }
              if (isEditable) {
                return `
                  <div class="repo-meta-field">
                    <span class="label">${escapeHtml(def.title)}:</span>
                    <textarea class="repo-config-input" data-repo-field="permissible_ip_addresses" rows="5">${escapeHtml(formatted)}</textarea>
                  </div>
                `;
              }
              return `
                <div class="repo-meta-field">
                  <span class="label">${escapeHtml(def.title)}:</span>
                  <span class="value">${escapeHtml(formatted)}</span>
                </div>
              `;
            })()}
          </div>
          <div class="repository-meta-panel" data-panel="prefixes">
            <div class="repo-meta-field">
              <span class="label">Prefixes:</span>
              <textarea class="repo-config-input repo-prefixes-input" data-repo-field="prefixes" rows="8" placeholder="Enter prefixes (one per line, separated by newlines)">${escapeHtml(prefixesText)}</textarea>
            </div>
          </div>
          <div class="repository-meta-panel" data-panel="collaboration">
            <div class="collaboration-content" data-collaboration-state="loading">Loading collaboration data...</div>
          </div>
          <div class="repository-meta-panel" data-panel="logs">
            <div class="repository-logs-overlay" style="display: none;">
              <div class="repository-logs-content">
                <div class="repository-logs-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 12px; background: #f8f9fa; border-bottom: 1px solid #dee2e6;">
                  <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Repository History</h3>
                  <button type="button" class="close-logs-overlay" data-testid="repo-logs-close-btn" style="background: none; border: none; color: #666; cursor: pointer; padding: 4px 8px; font-size: 18px;" title="Close">×</button>
        </div>
                <div class="repository-history-tabs" style="display: flex; border-bottom: 1px solid #dee2e6; margin-bottom: 0; background: #f8f9fa;">
                  <button class="history-tab-btn active" data-history-tab="events" data-testid="history-tab-events" style="background: #007bff; color: white; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; margin-right: 2px;">Events</button>
                  <button class="history-tab-btn" data-history-tab="resources" data-testid="history-tab-resources" style="background: #e9ecef; color: #495057; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; margin-right: 2px;">Resources</button>
                  <button class="history-tab-btn" data-history-tab="statistics" data-testid="history-tab-statistics" style="background: #e9ecef; color: #495057; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; margin-right: 2px;">Statistics</button>
                  <button class="history-tab-btn" data-history-tab="series" data-testid="history-tab-series" style="background: #e9ecef; color: #495057; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; margin-right: 2px;">Series</button>
                  <button class="history-tab-btn" data-history-tab="revisions" data-testid="history-tab-revisions" style="background: #e9ecef; color: #495057; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; margin-right: 2px;">Revisions</button>
                </div>
                <div class="repository-history-content" style="background: #f8f9fa; border: 1px solid #dee2e6; border-top: none; border-radius: 0 0 4px 4px; padding: 12px; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.4; min-height: 300px; max-height: calc(100vh - 300px); overflow-y: auto; white-space: pre-wrap;">Loading events data...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

const paneIdAccount = (accountName) => `tab-account-${accountName.replace(/[^a-z0-9_-]/gi, "-")}`;
const paneIdRepository = (accountName, repositoryName) =>
  `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}`;
const paneIdView = (accountName, repositoryName, viewName) =>
  `tab-view-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${viewName.replace(/[^a-z0-9_-]/gi, "-")}`;

const buildGlobalTabs = async (state, { includeInfo = false } = {}) => {
  const tabs = [];
  if (includeInfo) {
    tabs.push({ id: "tab-info", label: "Info", location: `${BASE_PATH}/info`, showAside: false });
  }
  tabs.push({ id: "tab-login", label: "Login", location: `${BASE_PATH}/login`, showAside: false });

  const accountNames = state.listOpenAccounts();
  for (const accountName of accountNames) {
    const account = await state.getAccount(accountName);
    const label = escapeHtml(account?.friendlyId || accountName);
    const path = encodeURIComponent(accountName);
    tabs.push({
      id: paneIdAccount(accountName),
      label,
      location: `${BASE_PATH}/account/${path}`,
      showAside: false,
      closeable: true,
      saveable: true,
      type: "account",
      accountName,
      bodyClass: "accounts show",
    });
  }

  const repos = state.listOpenRepositories();
  for (const { accountName, repositoryName } of repos) {
    const account = await state.getAccount(accountName);
    const repository = await state.getRepository(accountName, repositoryName);
    const accountLabel = escapeHtml(account?.friendlyId || accountName);
    const repositoryLabel = escapeHtml(repository?.friendlyId || repositoryName);
    const accountPath = encodeURIComponent(accountName);
    const repositoryPath = encodeURIComponent(repositoryName);
    tabs.push({
      id: paneIdRepository(accountName, repositoryName),
      label: `<span class="tab-label">${accountLabel}<br />${repositoryLabel}</span>`,
      location: `${BASE_PATH}/account/${accountPath}/repositories/${repositoryPath}`,
      showAside: false,
      closeable: true,
      saveable: true,
      type: "repository",
      accountName,
      repositoryName,
      bodyClass: "repositories show",
    });
  }

  const views = state.listOpenViews();
  for (const { accountName, repositoryName, viewName } of views) {
    const accountPath = encodeURIComponent(accountName);
    const repositoryPath = encodeURIComponent(repositoryName);
    const viewPath = encodeURIComponent(viewName);
    tabs.push({
      id: paneIdView(accountName, repositoryName, viewName),
      label: escapeHtml(viewName),
      location: `${BASE_PATH}/account/${accountPath}/repositories/${repositoryPath}/views/${viewPath}`,
      showAside: false,
      closeable: true,
      saveable: false,
      type: "view",
      accountName,
      repositoryName,
      viewName,
      bodyClass: "queries show",
    });
  }
  return tabs;
};

const buildAccountPanes = async (state) => Promise.all(
  state.listOpenAccounts().map(async (accountName) => {
    const account = await state.getAccount(accountName);
    const repos = await fetchAccountRepositories(state, accountName);
    const config = state.getAuthContext(accountName)?.config || {};
    const tracker = state.ensureAccountTracker(accountName, config);
    return renderAccountPane({
      accountName,
      account,
      repos,
      config,
      authToken: state.getAuthToken(accountName) || "",
      tracker,
    });
  })
);

const buildRepositoryPanes = async (state) => Promise.all(
  state.listOpenRepositories().map(({ accountName, repositoryName }) =>
    renderRepositoryPane(state, accountName, repositoryName)
  )
);

const renderViewPane = (state, accountName, repositoryName, viewName) => {
  return `
    <div id="${paneIdView(accountName, repositoryName, viewName)}" class="view-pane" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(viewName)}">
      <div class="view-pane-content">
        <div id="sparql-editor-container-${escapeHtml(accountName)}-${escapeHtml(repositoryName)}-${escapeHtml(viewName)}"></div>
      </div>
    </div>
  `;
};

const buildViewPanes = async (state) => Promise.all(
  state.listOpenViews().map(({ accountName, repositoryName, viewName }) =>
    renderViewPane(state, accountName, repositoryName, viewName)
  )
);

export const openLoginPane = async (app) => {
  // Check if the pane already exists in the DOM
  const paneId = "tab-login";
  const existingPane = document.getElementById(paneId);
  
  if (existingPane) {
    // Pane already exists - just activate its tab
    app.activateTab(`#${paneId}`);
    return;
  }
  
  // Instead of re-rendering the entire page, manipulate the DOM directly
  // This preserves all existing DOM elements including repository pane editors
  
  // 1. Add the tab to the tabs bar
  const tabsList = document.querySelector("[data-tab-list]");
  if (tabsList) {
    const location = `${BASE_PATH}/login`;
    
    const tabLi = document.createElement("li");
    tabLi.innerHTML = `
      <a href="#${paneId}" data-tab-link data-location="${location}" data-show-aside="false" data-body-class="">
        <span class="tab-label">Login</span>
      </a>
    `;
    tabsList.appendChild(tabLi);
    
    // Attach event handler to the new tab link (without resetting all panes)
    const newLink = tabLi.querySelector("[data-tab-link]");
    if (newLink) {
      const contentArea = app.root.querySelector("#content-container");
      if (contentArea) {
        newLink.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          
          const location = newLink.getAttribute("data-location");
          const href = newLink.getAttribute("href");
          const panelId = href?.startsWith("#") ? href.replace("#", "") : null;
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;
          
          if (targetPanel) {
            // Hide all panes and show only this one
            const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
            allPanes.forEach((pane) => {
              pane.style.display = pane.id === panelId ? "block" : "none";
            });
            // Update active state
            const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            allLinks.forEach((item) => item.classList.remove("active"));
            newLink.classList.add("active");
            const bodyClass = newLink.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = app.root.querySelector("#aside");
            if (aside) {
              aside.style.display = newLink.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              app.updateLocationBar(location);
            }
          } else if (location && app.router) {
            app.router.navigate(location);
          }
        });
      }
    }
  }
  
  // 2. Create the pane element and add it to the content container
  const contentContainer = document.getElementById("content-container");
  if (contentContainer) {
    const loginContent = buildLoginContent(app.state);
    const paneHtml = `<div id="${paneId}" class="pane">${loginContent}</div>`;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    contentContainer.appendChild(newPane);
    
    // 3. Initialize login form handlers
    await setupInlineLogin(app);
    
    // 4. Activate the new pane's tab
    app.activateTab(`#${paneId}`);
  }
};

export const openInfoPane = async (app) => {
  // Check if the pane already exists in the DOM
  const paneId = "tab-info";
  const existingPane = document.getElementById(paneId);

  if (existingPane) {
    // Pane already exists - just activate its tab
    app.activateTab(`#${paneId}`);
    return;
  }

  // Manipulate the DOM directly to preserve existing panes

  // 1. Add the tab to the tabs bar
  const tabsList = document.querySelector("[data-tab-list]");
  if (tabsList) {
    const location = `${BASE_PATH}/info`;

    const tabLi = document.createElement("li");
    tabLi.innerHTML = `
      <a href="#${paneId}" data-tab-link data-location="${location}" data-show-aside="false" data-body-class="">
        <span class="tab-label">Info</span>
      </a>
    `;
    tabsList.appendChild(tabLi);

    // Attach event handler to the new tab link (without resetting all panes)
    const newLink = tabLi.querySelector("[data-tab-link]");
    if (newLink) {
      const contentArea = app.root.querySelector("#content-container");
      if (contentArea) {
        newLink.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          
          const location = newLink.getAttribute("data-location");
          const href = newLink.getAttribute("href");
          const panelId = href?.startsWith("#") ? href.replace("#", "") : null;
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;
          
          if (targetPanel) {
            // Hide all panes and show only this one
            const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
            allPanes.forEach((pane) => {
              pane.style.display = pane.id === panelId ? "block" : "none";
            });
            // Update active state
            const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            allLinks.forEach((item) => item.classList.remove("active"));
            newLink.classList.add("active");
            const bodyClass = newLink.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = app.root.querySelector("#aside");
            if (aside) {
              aside.style.display = newLink.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              app.updateLocationBar(location);
            }
          } else if (location && app.router) {
            app.router.navigate(location);
          }
        });
      }
    }
  }

  // 2. Create the pane element and add it to the content container
  const contentContainer = document.getElementById("content-container");
  if (contentContainer) {
    const infoContent = buildInfoContent();
    const paneHtml = `<div id="${paneId}" class="pane">${infoContent}</div>`;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    contentContainer.appendChild(newPane);

    // 3. Activate the new pane's tab
    app.activateTab(`#${paneId}`);
  }
};

export const openAccountPane = async (app, accountName) => {
  // Check if the pane already exists in the DOM
  const paneId = paneIdAccount(accountName);
  const existingPane = document.getElementById(paneId);
  
  if (existingPane) {
    // Pane already exists - just activate its tab
    app.activateTab(`#${paneId}`);
    return;
  }
  
  // Add account to open state
  app.state.addOpenAccount(accountName);
  
  // Instead of re-rendering the entire page, manipulate the DOM directly
  // This preserves all existing DOM elements including repository pane editors
  
  // 1. Fetch account data
  const account = await app.state.getAccount(accountName);
  const repos = await fetchAccountRepositories(app.state, accountName);
  const config = app.state.getAuthContext(accountName)?.config || {};
  const tracker = app.state.ensureAccountTracker(accountName, config);
  
  // 2. Add the tab to the tabs bar (only if it doesn't already exist)
  const tabsList = document.querySelector("[data-tab-list]");
  if (tabsList) {
    // Check if tab already exists
    const existingTab = tabsList.querySelector(`[data-tab-link][href="#${paneId}"]`);
    if (existingTab) {
      // Tab already exists - just activate it and the pane
      app.activateTab(`#${paneId}`);
    } else {
      const accountPath = encodeURIComponent(accountName);
      const location = `${BASE_PATH}/account/${accountPath}`;
      const label = escapeHtml(account?.friendlyId || accountName);

      const tabLi = document.createElement("li");
      tabLi.innerHTML = `
        <a href="#${paneId}" data-tab-link data-location="${location}" data-show-aside="false" data-body-class="accounts show">
          <span class="tab-label">${label}</span>
          <span class="tab-actions-vertical">
            <span class="tab-icon tab-close" data-tab-action="close" data-tab-id="${paneId}" data-tab-type="account" data-account="${escapeHtml(accountName)}"></span>
            <span class="tab-icon tab-save" data-tab-action="save" data-tab-id="${paneId}" data-tab-type="account" data-account="${escapeHtml(accountName)}" aria-disabled="true"></span>
          </span>
        </a>
      `;
      tabsList.appendChild(tabLi);
    
    // Attach event handler to the new tab link (without resetting all panes)
    const newLink = tabLi.querySelector("[data-tab-link]");
    if (newLink) {
      const contentArea = app.root.querySelector("#content-container");
      if (contentArea) {
        newLink.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          
          const location = newLink.getAttribute("data-location");
          const href = newLink.getAttribute("href");
          const panelId = href?.startsWith("#") ? href.replace("#", "") : null;
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;
          
          if (targetPanel) {
            // Hide all panes and show only this one
            const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
            allPanes.forEach((pane) => {
              pane.style.display = pane.id === panelId ? "block" : "none";
            });
            // Update active state
            const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            allLinks.forEach((item) => item.classList.remove("active"));
            newLink.classList.add("active");
            const bodyClass = newLink.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = app.root.querySelector("#aside");
            if (aside) {
              aside.style.display = newLink.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              app.updateLocationBar(location);
            }
          } else if (location && app.router) {
            app.router.navigate(location);
          }
        });
      }
    }
    } // close else block for existing tab check
  }

  // 3. Create the pane element and add it to the content container
  const contentContainer = document.getElementById("content-container");
  if (contentContainer) {
    const paneHtml = renderAccountPane({
      accountName,
      account,
      repos,
      config,
      authToken: app.state.getAuthToken(accountName) || "",
      tracker,
    });
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    contentContainer.appendChild(newPane);
    
    // 4. Initialize account pane handlers
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    
    // 5. Activate the new pane's tab (this will hide all other panes including intro)
    app.activateTab(`#${paneId}`);

    // After authentication, hide the intro tab from the tabs bar and remove the intro pane
    // The login tab remains visible so users can authenticate additional accounts
    const infoPane = document.getElementById("tab-info");
    if (infoPane) {
      infoPane.remove();
    }
    const introTab = document.querySelector('[data-tab-link][href="#tab-info"]');
    if (introTab) {
      const tabLi = introTab.closest("li");
      if (tabLi) {
        tabLi.remove();
      }
    }
  }
};

export const openRepositoryPane = async (app, accountName, repositoryName) => {
  // Check if the pane already exists in the DOM
  const paneId = paneIdRepository(accountName, repositoryName);
  const existingPane = document.getElementById(paneId);
  
  if (existingPane) {
    // Pane already exists - invalidate cache and re-render to get fresh view list
    // This ensures that if a view was deleted directly on the service, it won't appear
    invalidateRepositoryConfigCache(app.state, accountName, repositoryName);
    // Re-render the pane with fresh data
    const paneHtml = await renderRepositoryPane(app.state, accountName, repositoryName);
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    existingPane.replaceWith(newPane);
    // Re-initialize handlers for the new pane
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    // Activate the tab
    app.activateTab(`#${paneId}`);
    return;
  }
  
  // Ensure account is in open state (needed for tabs)
  app.state.addOpenAccount(accountName);
  app.state.addOpenRepository(accountName, repositoryName);
  
  // Instead of re-rendering the entire page, manipulate the DOM directly
  // This preserves all existing DOM elements including repository pane editors
  
  // 1. Add the tab to the tabs bar (only if it doesn't already exist)
  const tabsList = document.querySelector("[data-tab-list]");
  if (tabsList) {
    // Check if tab already exists
    const existingTab = tabsList.querySelector(`[data-tab-link][href="#${paneId}"]`);
    if (existingTab) {
      // Tab already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else {
      const account = await app.state.getAccount(accountName);
      const repository = await app.state.getRepository(accountName, repositoryName);
      const accountLabel = escapeHtml(account?.friendlyId || accountName);
      const repositoryLabel = escapeHtml(repository?.friendlyId || repositoryName);
      const accountPath = encodeURIComponent(accountName);
      const repositoryPath = encodeURIComponent(repositoryName);
      const location = `${BASE_PATH}/account/${accountPath}/repositories/${repositoryPath}`;

      const tabLi = document.createElement("li");
      tabLi.innerHTML = `
        <a href="#${paneId}" data-tab-link data-location="${location}" data-show-aside="false" data-body-class="repositories show">
          <span class="tab-label">${accountLabel}<br />${repositoryLabel}</span>
          <span class="tab-actions-vertical">
            <span class="tab-icon tab-close" data-tab-action="close" data-tab-id="${paneId}" data-tab-type="repository" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="tab-close-${paneId}"></span>
            <span class="tab-icon tab-save" data-tab-action="save" data-tab-id="${paneId}" data-tab-type="repository" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-testid="tab-save-${paneId}" aria-disabled="true"></span>
          </span>
        </a>
      `;
      tabsList.appendChild(tabLi);
    
    // Attach event handler to the new tab link (without resetting all panes)
    const newLink = tabLi.querySelector("[data-tab-link]");
    if (newLink) {
      const contentArea = app.root.querySelector("#content-container");
      if (contentArea) {
        newLink.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          
          const location = newLink.getAttribute("data-location");
          const href = newLink.getAttribute("href");
          const panelId = href?.startsWith("#") ? href.replace("#", "") : null;
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;
          
          if (targetPanel) {
            // Hide all panes and show only this one
            const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
            allPanes.forEach((pane) => {
              pane.style.display = pane.id === panelId ? "block" : "none";
            });
            // Update active state
            const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            allLinks.forEach((item) => item.classList.remove("active"));
            newLink.classList.add("active");
            const bodyClass = newLink.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = app.root.querySelector("#aside");
            if (aside) {
              aside.style.display = newLink.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              app.updateLocationBar(location);
            }
          } else if (location && app.router) {
            app.router.navigate(location);
          }
        });
      }
    }
    } // close else block for existing tab check
  }

  // 2. Create the pane element and add it to the content container
  const contentContainer = document.getElementById("content-container");
  if (contentContainer) {
    const paneHtml = await renderRepositoryPane(app.state, accountName, repositoryName);
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    contentContainer.appendChild(newPane);
    
    // 3. Initialize repository pane handlers
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    
    // 4. Activate the new pane's tab (this will hide all other panes including login)
    app.activateTab(`#${paneId}`);
  }
};

export const openViewPane = async (app, accountName, repositoryName, viewName) => {
  // Ensure we always use just the base name for the view
  const baseViewName = ensureBaseViewName(viewName);
  // Check if the pane already exists in the DOM
  const paneId = paneIdView(accountName, repositoryName, baseViewName);
  const existingPane = document.getElementById(paneId);
  
  if (existingPane) {
    // Pane already exists - just activate its tab
    app.activateTab(`#${paneId}`);
    return;
  }
  
  // Ensure account and repository are in open state (needed for tabs)
  app.state.addOpenAccount(accountName);
  app.state.addOpenRepository(accountName, repositoryName);
  
  // Add the view to the open views state (this prevents duplicates at state level)
  app.state.addOpenView(accountName, repositoryName, baseViewName);
  
  // Instead of re-rendering the entire page, manipulate the DOM directly
  // This preserves all existing DOM elements including repository pane editors
  
  // 1. Add the tab to the tabs bar (only if it doesn't already exist)
  const tabsList = document.querySelector("[data-tab-list]");
  if (tabsList) {
    // Check if tab already exists
    const existingTab = tabsList.querySelector(`[data-tab-link][href="#${paneId}"]`);
    if (existingTab) {
      // Tab already exists - just activate it
      app.activateTab(`#${paneId}`);
    } else {
      const account = await app.state.getAccount(accountName);
      const accountPath = encodeURIComponent(accountName);
      const repositoryPath = encodeURIComponent(repositoryName);
      const viewPath = encodeURIComponent(baseViewName);
      const location = `${BASE_PATH}/account/${accountPath}/repositories/${repositoryPath}/views/${viewPath}`;

      const tabLi = document.createElement("li");
      tabLi.innerHTML = `
        <a href="#${paneId}" data-tab-link data-location="${location}" data-show-aside="false" data-body-class="queries show">
          <span class="tab-label">${escapeHtml(baseViewName)}</span>
          <span class="tab-actions-vertical">
            <span class="tab-icon tab-close" data-tab-action="close" data-tab-id="${paneId}" data-tab-type="view" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(baseViewName)}" data-testid="tab-close-${paneId}"></span>
          </span>
        </a>
      `;
      tabsList.appendChild(tabLi);
    
    // Attach event handler to the new tab link (without resetting all panes)
    const newLink = tabLi.querySelector("[data-tab-link]");
    if (newLink) {
      const contentArea = app.root.querySelector("#content-container");
      if (contentArea) {
        newLink.addEventListener("click", (event) => {
          if (event.target.closest("[data-tab-action]")) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          
          const location = newLink.getAttribute("data-location");
          const href = newLink.getAttribute("href");
          const panelId = href?.startsWith("#") ? href.replace("#", "") : null;
          const targetPanel = panelId ? contentArea.querySelector(`#${CSS.escape(panelId)}`) : null;
          
          if (targetPanel) {
            // Hide all panes and show only this one
            const allPanes = Array.from(contentArea.querySelectorAll(".pane, .account-pane, .repository-pane, .view-pane, #tab-info, #tab-login"));
            allPanes.forEach((pane) => {
              pane.style.display = pane.id === panelId ? "block" : "none";
            });
            // Update active state
            const allLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
            allLinks.forEach((item) => item.classList.remove("active"));
            newLink.classList.add("active");
            const bodyClass = newLink.getAttribute("data-body-class");
            if (bodyClass) {
              document.body.className = bodyClass;
            }
            const aside = app.root.querySelector("#aside");
            if (aside) {
              aside.style.display = newLink.dataset.showAside === "true" ? "" : "none";
            }
            if (location) {
              app.updateLocationBar(location);
            }
          } else if (location && app.router) {
            app.router.navigate(location);
          }
        });
      }
    }

    // Attach direct click handler to the close button for reliable closing
    const closeButton = tabLi.querySelector("[data-tab-action='close']");
    if (closeButton) {
      closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Find the next tab to activate (right if exists, otherwise left)
        const allTabLinks = Array.from(tabsList.querySelectorAll("[data-tab-link]"));
        const currentLink = tabLi.querySelector("[data-tab-link]");
        const currentIndex = currentLink ? allTabLinks.indexOf(currentLink) : -1;
        let nextTabHref = null;
        if (currentIndex >= 0) {
          if (currentIndex < allTabLinks.length - 1) {
            nextTabHref = allTabLinks[currentIndex + 1].getAttribute("href");
          } else if (currentIndex > 0) {
            nextTabHref = allTabLinks[currentIndex - 1].getAttribute("href");
          }
        }

        // Close the pane using the app's closePane method
        if (app.closePane) {
          app.closePane({
            tabType: "view",
            tabId: paneId,
            accountName,
            repositoryName,
            viewName: baseViewName,
            nextTabHref
          });
        } else {
          // Fallback: manual close
          app.state.removeOpenView(accountName, repositoryName, baseViewName);
          if (app.editorInstances) {
            app.editorInstances.delete(paneId);
          }
          const pane = document.getElementById(paneId);
          if (pane) pane.remove();
          tabLi.remove();
          if (nextTabHref && app.activateTab) {
            app.activateTab(nextTabHref);
          }
        }
      });
    }
    } // close else block for existing tab check
  }

  // 2. Create the pane element and add it to the content container
  const contentContainer = document.getElementById("content-container");
  if (contentContainer) {
    const paneHtml = renderViewPane(app.state, accountName, repositoryName, baseViewName);
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = paneHtml;
    const newPane = tempDiv.firstElementChild;
    contentContainer.appendChild(newPane);
    
    // 3. Initialize the editor in the new pane
    await initializeViewPanes(app);
    
    // 4. Activate the new pane's tab
    app.activateTab(`#${paneId}`);
  }
};

const setupInlineLogin = async (app) => {
  console.log("[Login] setupInlineLogin called");
  const form = document.getElementById("inline-login-form");
  const status = document.getElementById("login-status");
  const errorBox = document.getElementById("login-error");
  const errorText = document.getElementById("login-error-text");
  console.log("[Login] Form found:", !!form, "App:", !!app);
  if (!form || !app) {
    console.warn("[Login] Form or app not found, returning");
    return;
  }
  const hostParam = new URLSearchParams(window.location.search).get("host");
  const accountParam = new URLSearchParams(window.location.search).get("account");
  const hostField = form.querySelector('[name="host"]');
  if (hostField) {
    hostField.value = hostParam || window.location.host;
  }
  if (accountParam) {
    const loginField = form.querySelector('[name="login"]');
    if (loginField) {
      loginField.value = accountParam;
    }
  }

  form.addEventListener("submit", async (e) => {
    console.log("[Login] Form submit event fired");
    console.log("[Login] Event:", e);
    console.log("[Login] Event defaultPrevented:", e.defaultPrevented);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log("[Login] Prevented default, processing login");
    const host = form.querySelector('[name="host"]').value;
    const accountName = form.querySelector('[name="login"]').value;
    const secret = form.querySelector('[name="password"]').value;
    console.log("[Login] Form values - host:", host, "account:", accountName, "hasPassword:", !!secret);
    if (errorBox && errorText) {
      errorBox.style.display = "none";
      errorText.textContent = "";
    }
    app.showLocationMessage?.("Authenticating\u2026", 30000);
    try {
      console.log("[Login] Calling authenticateAccount");
      const result = await authenticateAccount({ host, accountName, secret });
      console.log("[Login] Authentication successful");
      // Clear password field for security
      const passwordField = form.querySelector('[name="password"]');
      if (passwordField) {
        passwordField.value = "";
      }
      app.state.authStore.setAuth(accountName, result.token, result.config, result.baseUrl);
      app.state.setAccountFromConfig(accountName, result.config);
      app.state.session.login(accountName);
      // Update header links to show Logout instead of Signup
      if (app.updateHeaderLinks) {
        app.updateHeaderLinks();
      }
      console.log("[Login] Navigating to account page");
      const successMessage = `Authenticated as ${accountName}`;
      app.router.navigate(`${BASE_PATH}/account/${accountName}`);
      setTimeout(() => {
        app.showLocationMessage?.(successMessage, 3000);
      }, 100);
      console.log("[Login] Navigation called");
    } catch (error) {
      console.error("[Login] Authentication error:", error);
      const message = error.message || "Login failed.";
      app.showLocationMessage?.(message, 5000);
      if (errorBox && errorText) {
        errorBox.style.display = "block";
        errorText.textContent = message;
      }
    }
  });
  console.log("[Login] Form submit handler attached");

};

const initializePaneEditing = (app) => {
  console.log("[ViewEditor] initializePaneEditing called", { app: !!app });
  if (!app) {
    console.log("[ViewEditor] No app provided, returning");
    return;
  }
  document.querySelectorAll(".account-pane .foaf-value[data-editable='true']:not([data-pane-handler-bound])").forEach((field) => {
    field.dataset.paneHandlerBound = "true";
    field.addEventListener("dblclick", () => {
      if (field.tagName.toLowerCase() === "input") return;
      const type = field.dataset.type || "text";
      const rawValue = field.textContent;
      // Don't use "-" placeholder as actual value
      const value = field.classList.contains("empty") ? "" : rawValue;
      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      input.className = "profile-input";
      input.dataset.field = field.dataset.field;
      input.dataset.type = field.dataset.type || "text";
      input.dataset.original = value;
      // Add editing class to parent for proper layout (input on new line)
      const parent = field.closest(".foaf-field");
      if (parent) {
        parent.classList.remove("has-empty-value");
        parent.classList.add("editing");
      }
      field.replaceWith(input);
      input.focus();
      input.select();
      // Save button appears only after a value is modified.
    });
  });

  document.querySelectorAll(".repository-pane .repo-meta-value:not([data-pane-handler-bound])").forEach((field) => {
    field.dataset.paneHandlerBound = "true";
    field.addEventListener("dblclick", () => {
      if (field.tagName.toLowerCase() === "input") return;
      const type = field.dataset.repoType || "text";
      const value = field.textContent;
      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      input.className = "repo-meta-input";
      input.dataset.repoField = field.dataset.repoField;
      input.dataset.repoType = field.dataset.repoType || "text";
      input.dataset.original = value;
      field.replaceWith(input);
      input.focus();
      input.select();
      // Save button appears only after a value is modified.
    });
  });

  // Handle empty repository profile/settings fields (click to edit)
  document.querySelectorAll(".repository-pane .value.empty[data-editable='true']:not([data-pane-handler-bound])").forEach((field) => {
    field.dataset.paneHandlerBound = "true";
    field.addEventListener("dblclick", () => {
      if (field.tagName.toLowerCase() === "input" || field.tagName.toLowerCase() === "textarea") return;
      const fieldName = field.dataset.repoField;
      const fieldType = field.dataset.fieldType || "text";
      const parent = field.closest(".repo-meta-field");

      let inputEl;
      if (fieldType === "textarea") {
        inputEl = document.createElement("textarea");
        inputEl.className = "repo-config-input";
        inputEl.rows = 3;
      } else {
        inputEl = document.createElement("input");
        inputEl.type = fieldType;
        inputEl.className = "repo-config-input";
      }
      inputEl.value = "";
      inputEl.dataset.repoField = fieldName;

      if (parent) {
        parent.classList.remove("has-empty-value");
        parent.classList.add("editing");
      }
      field.replaceWith(inputEl);
      inputEl.focus();
    });
  });

  const updateSaveButtonVisibility = (pane, selector, tracker) => {
    if (!pane) return;
    const tabId = pane.getAttribute("id");
    const saveButton = document.querySelector(`[data-tab-id="${tabId}"][data-tab-action="save"]`);
    if (!saveButton) return;
    const deltas = tracker?.deltas ? tracker.deltas() : {};
    const hasChanges = Object.keys(deltas || {}).length > 0;
    saveButton.setAttribute("aria-disabled", hasChanges ? "false" : "true");
  };

  const readAccountFieldValue = (pane, fieldName) => {
    const input = pane.querySelector(`input.profile-input[data-field="${fieldName}"]`);
    if (input) return input.value || "";
    const span = pane.querySelector(`.foaf-value[data-field="${fieldName}"]`);
    return span ? span.textContent || "" : "";
  };

  document.querySelectorAll(".account-pane").forEach((pane) => {
    pane.addEventListener("input", (event) => {
      const input = event.target.closest("input.profile-input") || event.target.closest("input.password-input");
      if (!input) return;
      const accountName = pane.dataset.account;
      if (accountName && app?.state) {
        const tracker = app.state.getAccountTracker(accountName);
        if (tracker && input.dataset.field) {
          const handler = DISPLAY_TYPE_HANDLERS[input.dataset.type] || DISPLAY_TYPE_HANDLERS.text;
          tracker[input.dataset.field] = handler.parse(input.value);
          if (input.dataset.field === "firstname" || input.dataset.field === "familyname") {
            const first = readAccountFieldValue(pane, "firstname");
            const last = readAccountFieldValue(pane, "familyname");
            const fullName = `${first} ${last}`.trim();
            tracker.fullname = fullName;
            const fullNameSpan = pane.querySelector('.foaf-value[data-field="fullname"]');
            if (fullNameSpan && fullNameSpan.tagName.toLowerCase() === "span") {
              fullNameSpan.textContent = fullName;
            }
          }
        }
        updateSaveButtonVisibility(pane, "input.profile-input,input.password-input", tracker);
      }
    });
  });

  const updateRepositoryField = (tracker, field, value) => {
    if (!tracker || !field) return;
    if (field === "permissible_ip_addresses") {
      const lines = String(value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      tracker[field] = lines;
      return;
    }
    if (field === "prefixes") {
      // Prefixes is a string with entries separated by \n
      // Just store the string value as-is
      tracker[field] = String(value || "");
      return;
    }
    tracker[field] = value;
  };

  // Function to update IPs tab state based on privacy setting
  const updateIPsTabState = (pane) => {
    const accountName = pane.dataset.account;
    const repositoryName = pane.dataset.repository;
    if (!accountName || !repositoryName || !app?.state) return;
    
    const tracker = app.state.getRepositoryTracker(accountName, repositoryName);
    const config = tracker?.config || {};
    const privacyValue = tracker?.privacy_setting ?? config?.privacy_setting ?? config?.privacySetting ?? "private";
    
    const ipsTab = pane.querySelector('.manage-tab[data-tab="ips"]');
    if (ipsTab) {
      const isEnabled = privacyValue === "readByAuthenticatedUserOrIP";
      ipsTab.disabled = !isEnabled;
      ipsTab.style.opacity = isEnabled ? "1" : "0.5";
      ipsTab.style.cursor = isEnabled ? "pointer" : "not-allowed";
      
      // If the tab is disabled and currently active, switch to profile tab
      if (!isEnabled && ipsTab.classList.contains("active")) {
        const profileTab = pane.querySelector('.manage-tab[data-tab="profile"]');
        if (profileTab) {
          profileTab.click();
        }
      }
    }
  };

  document.querySelectorAll(".repository-pane").forEach((pane) => {
    // Update IPs tab state on initial load
    updateIPsTabState(pane);
    
    pane.querySelectorAll(".repository-sidebar .manage-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        // Don't allow clicking disabled tabs
        if (tab.disabled) return;
        
        const target = tab.getAttribute("data-tab");
        const accountName = pane.dataset.account;
        const repositoryName = pane.dataset.repository;
        pane.querySelectorAll(".repository-sidebar .manage-tab").forEach((item) => item.classList.remove("active"));
        pane.querySelectorAll(".repository-meta-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.getAttribute("data-panel") === target);
        });
        tab.classList.add("active");
        if (target === "collaboration") {
          const content = pane.querySelector(".collaboration-content");
          if (content?.dataset.collaborationState === "needs-reload") {
            content.dataset.collaborationState = "";
          }
          loadRepositoryCollaboration(app, pane);
        }
        if (target === "logs") {
          const overlay = pane.querySelector(".repository-logs-overlay");
          if (overlay) {
            overlay.style.display = "block";
            // Load events by default
            const contentElement = overlay.querySelector(".repository-history-content");
            if (contentElement && accountName && repositoryName) {
              loadRepositoryHistoryTab(app, accountName, repositoryName, contentElement, "events");
            }
          }
        } else {
          // Hide overlay when switching to other tabs
          const overlay = pane.querySelector(".repository-logs-overlay");
          if (overlay) {
            overlay.style.display = "none";
          }
        }
      });
    });
    
    // Close logs overlay button
    const closeLogsBtn = pane.querySelector(".close-logs-overlay");
    if (closeLogsBtn) {
      closeLogsBtn.addEventListener("click", () => {
        const overlay = pane.querySelector(".repository-logs-overlay");
        if (overlay) {
          overlay.style.display = "none";
        }
        // Switch back to profile tab
        const profileTab = pane.querySelector('.manage-tab[data-tab="profile"]');
        if (profileTab) {
          profileTab.click();
        }
      });
    }
    
    // History tab buttons
    pane.querySelectorAll(".history-tab-btn:not([data-handler-bound])").forEach((btn) => {
      btn.dataset.handlerBound = "true";
      btn.addEventListener("click", () => {
        const accountName = pane.dataset.account;
        const repositoryName = pane.dataset.repository;
        if (!accountName || !repositoryName) return;
        
        const tabName = btn.getAttribute("data-history-tab");
        const contentElement = pane.querySelector(".repository-history-content");
        if (contentElement) {
          // Update active state
          pane.querySelectorAll(".history-tab-btn").forEach((b) => {
            b.style.background = "#e9ecef";
            b.style.color = "#495057";
          });
          btn.style.background = "#007bff";
          btn.style.color = "white";
          
          // Load the selected tab
          loadRepositoryHistoryTab(app, accountName, repositoryName, contentElement, tabName);
        }
      });
    });
    
    const handleRepositoryInput = (event) => {
      const input = event.target.closest(".repo-config-input, input.repo-meta-input");
      if (!input) return;
      const accountName = pane.dataset.account;
      const repositoryName = pane.dataset.repository;
      if (accountName && repositoryName && app?.state) {
        const tracker = app.state.getRepositoryTracker(accountName, repositoryName);
        const field = input.dataset.repoField;
        if (tracker && field) {
          updateRepositoryField(tracker, field, input.value);
          // Update IPs tab state when privacy setting changes
          if (field === "privacy_setting") {
            updateIPsTabState(pane);
          }
        }
        updateSaveButtonVisibility(pane, ".repo-config-input", tracker);
      }
    };
    pane.addEventListener("input", handleRepositoryInput);
    pane.addEventListener("change", handleRepositoryInput);
  });

  // Repository operation buttons (Import, Export, Clear)
  // Use data-handler-bound attribute to prevent duplicate handlers when initializePaneEditing is called multiple times
  document.querySelectorAll(".repo-import-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      const repositoryName = btn.dataset.repository;
      handleRepositoryImport(app, accountName, repositoryName, btn);
    });
  });

  document.querySelectorAll(".repo-export-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      const repositoryName = btn.dataset.repository;
      handleRepositoryExport(app, accountName, repositoryName, btn);
    });
  });

  document.querySelectorAll(".repo-clear-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      const repositoryName = btn.dataset.repository;
      handleRepositoryClear(app, accountName, repositoryName, btn);
    });
  });

  document.querySelectorAll(".repo-delete-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      const repositoryName = btn.dataset.repository;
      handleRepositoryDelete(app, accountName, repositoryName, btn);
    });
  });

  document.querySelectorAll(".view-delete-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      const repositoryName = btn.dataset.repository;
      const viewName = btn.dataset.view;
      handleViewDelete(app, accountName, repositoryName, viewName, btn);
    });
  });

  // New Repository button
  document.querySelectorAll(".repo-new-btn:not([data-handler-bound])").forEach((btn) => {
    btn.dataset.handlerBound = "true";
    btn.addEventListener("click", () => {
      const accountName = btn.dataset.account;
      if (!accountName) return;
      const auth = app.state.getAuthContext(accountName);
      if (!auth?.token || !auth?.host) {
        alert("Not authenticated");
        return;
      }

      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
      const dialog = document.createElement("div");
      dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
      dialog.innerHTML = `
        <h3 style="margin:0 0 12px 0;">New Repository</h3>
        <div style="margin-bottom:8px;">
          <label style="display:block;font-size:13px;margin-bottom:4px;">Name</label>
          <input type="text" class="new-repo-name" placeholder="Repository name" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:13px;margin-bottom:4px;">Type</label>
          <select class="new-repo-type" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;">
            <option value="lmdb">lmdb</option>
            <option value="lmdb-revisioned">lmdb-revisioned</option>
          </select>
        </div>
        <div style="text-align:right;">
          <button class="new-repo-cancel" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
          <button class="new-repo-ok" style="padding:6px 12px;cursor:pointer;">Create</button>
        </div>
      `;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const nameInput = dialog.querySelector(".new-repo-name");
      const typeSelect = dialog.querySelector(".new-repo-type");
      const okBtn = dialog.querySelector(".new-repo-ok");
      const cancelBtn = dialog.querySelector(".new-repo-cancel");
      nameInput.focus();

      const close = () => overlay.remove();
      cancelBtn.addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

      // Add error message element to dialog
      const errorDiv = document.createElement("div");
      errorDiv.style.cssText = "color: #dc3545; font-size: 12px; margin-top: 8px; display: none;";
      dialog.querySelector("h3").after(errorDiv);

      const submit = async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        // Check if repository already exists
        const existingRepos = await fetchAccountRepositories(app.state, accountName);
        const existingRepo = existingRepos.find(r => r.name === name || r.friendlyId === name);
        if (existingRepo) {
          errorDiv.textContent = `Repository "${name}" already exists.`;
          errorDiv.style.display = "block";
          // Close dialog after a brief delay and navigate to existing repository
          setTimeout(() => {
            close();
            app.state.addOpenAccount(accountName);
            app.state.addOpenRepository(accountName, name);
            if (app.router) {
              app.router.navigate(`${BASE_PATH}/account/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(name)}`);
            }
          }, 1500);
          return;
        }

        const type = typeSelect.value;
        try {
          const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify({ name, type }),
          });
          if (response.status === 200 || response.status === 201) {
            // Close dialog after successful creation
            close();
            // Add to the displayed repository list
            const repoList = btn.closest("#account-repositories");
            if (repoList) {
              // Remove empty-state message if present
              const emptyMsg = repoList.querySelector("p");
              if (emptyMsg) emptyMsg.remove();

              const entry = document.createElement("div");
              entry.className = "repository odd";
              entry.innerHTML = `
                <div class="title blank">
                  <a href="${BASE_PATH}/account/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(name)}">${escapeHtml(name)}</a>
                  <span class="stats">
                    <button type="button" class="repo-delete-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(name)}" style="
                      background: transparent; border: none; padding: 4px; cursor: pointer; margin-left: 8px; vertical-align: middle;
                    " title="Delete Repository">
                      <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width: 16px; height: 16px; opacity: 0.6;" />
                    </button>
                  </span>
                </div>
              `;

              // Insert alphabetically
              const existing = Array.from(repoList.querySelectorAll(".repository"));
              const insertBefore = existing.find((el) => {
                const link = el.querySelector(".title a");
                return link && link.textContent.trim().localeCompare(name) > 0;
              });
              if (insertBefore) {
                repoList.insertBefore(entry, insertBefore);
              } else {
                repoList.appendChild(entry);
              }

              // Re-stripe
              repoList.querySelectorAll(".repository").forEach((el, i) => {
                el.className = `repository ${i % 2 === 0 ? "odd" : "even"}`;
              });

              // Wire delete button (check for handler-bound to prevent duplicates)
              const delBtn = entry.querySelector(".repo-delete-btn:not([data-handler-bound])");
              if (delBtn) {
                delBtn.dataset.handlerBound = "true";
                delBtn.addEventListener("click", () => {
                  handleRepositoryDelete(app, accountName, name, delBtn);
                });
              }
            }

            app.state.addOpenAccount(accountName);
            app.state.addOpenRepository(accountName, name);
            if (app.router) {
              app.router.navigate(`${BASE_PATH}/account/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(name)}`);
            }
          } else {
            const errorText = await getResponseText(response);
            alert(`Failed to create repository (${response.status}): ${errorText}`);
          }
        } catch (error) {
          let errorMessage = error.message;
          // If error has a response, try to get its text
          if (error.response) {
            try {
              const errorText = await getResponseText(error.response);
              errorMessage += errorText ? ` - ${errorText}` : "";
            } catch (e) {
              // Ignore errors reading response
            }
          }
          alert(`Failed to create repository: ${errorMessage}`);
        }
      };

      okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.stopPropagation(); submit(); }
        if (e.key === "Escape") close();
      });
    });
  });

  // Initialize view editors for repository panes
  try {
    console.log("[ViewEditor] initializePaneEditing: checking for createSparqlEditor", typeof window.createSparqlEditor);
    if (typeof window.createSparqlEditor === "function") {
      console.log("[ViewEditor] createSparqlEditor is available, looking for repository panes");
      const panes = document.querySelectorAll(".repository-pane");
      console.log("[ViewEditor] Found repository panes:", panes.length);
      panes.forEach(async (pane) => {
      const accountName = pane.dataset.account;
      const repositoryName = pane.dataset.repository;
      if (!accountName || !repositoryName) {
        console.log("[ViewEditor] Skipping pane: missing account or repository", { accountName, repositoryName });
        return;
      }
      const container = pane.querySelector(".view-editors-container");
      if (!container) {
        console.log("[ViewEditor] No view-editors-container found in pane", { accountName, repositoryName });
        return;
      }
      console.log("[ViewEditor] Initializing for pane", { accountName, repositoryName });
      const auth = app.state.getAuthContext(accountName);
      const sparqlEndpoint = `${auth?.host || window.location.origin}/${accountName}/${repositoryName}/sparql`;
      const accessToken = app.state.getAuthToken(accountName);
      
      // Map to track editors currently in this container (prevents duplicates within this container only)
      // Check DOM for existing editors and populate the map (in case we're re-initializing after tab switch)
      const openViews = new Map();
      const existingEditors = container.querySelectorAll(".view-editor");
      existingEditors.forEach((editor) => {
        const viewName = editor.dataset.viewName;
        if (viewName) {
          openViews.set(viewName, editor);
        }
      });

      const repoClass = pane.dataset.class || '';
      const revisionsEndpoint = /revisioned/i.test(repoClass)
        ? `${auth?.host || window.location.origin}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/revisions`
        : '';

      const createEditorPanel = async (view) => {
        // Ensure we always use just the base name for the view
        const baseViewName = ensureBaseViewName(view.friendlyId);
        console.log("[ViewEditor] createEditorPanel called for view", baseViewName);
        if (openViews.has(view.friendlyId)) {
          const existing = openViews.get(view.friendlyId);
          existing.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "view-editor";
        wrapper.draggable = true;
        wrapper.dataset.viewName = baseViewName;

        const body = document.createElement("div");
        body.className = "view-editor-body";

        // Prevent drag from starting when interacting with editor content (textarea, CodeMirror)
        // Use dragstart event which is more reliable than mousedown for preventing unwanted drags
        wrapper.addEventListener("dragstart", (event) => {
          const target = event.target;
          // Only allow drag if it starts on the wrapper itself or its title bar
          // Cancel drag if it starts within editor content
          if (target.closest("textarea, .CodeMirror, .yasqe, .CodeMirror-scroll, .sparql-editor-content, input, select")) {
            event.preventDefault();
          }
        });

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        openViews.set(view.friendlyId, wrapper);

        const viewUrl = `${auth?.host || window.location.origin}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(baseViewName)}`;
        // Fetch view text based on queryText value:
        // - null: new view, don't fetch (use default)
        // - undefined: existing view, fetch it
        // - string: use provided value
        let viewText;
        if (view.queryText === null) {
          // New view - don't fetch
          viewText = null;
        } else if (view.queryText !== undefined) {
          // queryText was explicitly provided
          viewText = view.queryText;
        } else {
          // queryText is undefined - fetch it for existing view
          viewText = await fetchViewText({
          auth,
          accountName,
          repositoryName,
            viewName: baseViewName,
        });
        }
        const editorApi = window.createSparqlEditor({
          container: body,
          viewUrl,
          sparqlEndpoint,
          accessToken,
          accountName,
          repositoryName,
          repositoryClass: repoClass,
          revisionsEndpoint,
          viewName: baseViewName,
          sparql: viewText !== null ? (viewText || "SELECT * WHERE { ?s ?p ?o } LIMIT 10") : "SELECT * WHERE { ?s ?p ?o } LIMIT 10",
          options: {
            title: `/${accountName}/${repositoryName}/${baseViewName}`,
            initialState: "open",
            showEventLog: true,
            showEditorToggle: true,
            showMediaTypeSelector: true,
            showSaveButton: true,
            showResetButton: true,
            showCloseButton: true,
            onQueryBlur: (queryText) => {
              // Synchronize query text to all other editors for this view
              const otherEditors = findEditorsForView(app, accountName, repositoryName, baseViewName).filter(e => e !== editorApi);
              otherEditors.forEach((otherEditor) => {
                if (otherEditor && otherEditor.setQuery) {
                  try {
                    otherEditor.setQuery(queryText);
                  } catch (e) {
                    console.warn("[ViewEditor] Failed to synchronize query text:", e);
                  }
                }
              });
            },
            onClose: () => {
              openViews.delete(view.friendlyId);
              // Remove editor instance from map if app is available
              // Use a different key for repository pane editors to avoid conflicts with separate pane editors
              if (app && app.editorInstances) {
                const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
                app.editorInstances.delete(repoEditorId);
              }
              wrapper.remove();
            },
          },
        });
        
        // Store editor API instance if app is available
        // Use a different key for repository pane editors to avoid conflicts with separate pane editors
        if (app && app.editorInstances) {
          const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
          app.editorInstances.set(repoEditorId, editorApi);
        }
      };

      const getDragAfterElement = (containerEl, y) => {
        const elements = [...containerEl.querySelectorAll(".view-editor:not(.dragging)")];
        return elements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
          }
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      };

      container.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = container.querySelector(".view-editor.dragging");
        if (!dragging) return;
        const afterElement = getDragAfterElement(container, event.clientY);
        if (!afterElement) {
          container.appendChild(dragging);
        } else {
          container.insertBefore(dragging, afterElement);
        }
      });

      container.addEventListener("dragstart", (event) => {
        const target = event.target.closest(".view-editor");
        if (!target) return;
        target.classList.add("dragging");
      });

      container.addEventListener("dragend", (event) => {
        const target = event.target.closest(".view-editor");
        if (!target) return;
        target.classList.remove("dragging");
      });

      // Attach click handlers to view-edit links (opens view editor in current pane)
      const viewEditLinks = pane.querySelectorAll(".view-edit");
      console.log("[ViewEditor] Found", viewEditLinks.length, "view-edit links in pane", accountName, repositoryName);
      viewEditLinks.forEach((link) => {
        // Prevent duplicate handlers
        if (link.dataset.viewEditHandlerAttached === "true") {
          console.log("[ViewEditor] Handler already attached to view-edit link, skipping");
          return;
        }
        link.dataset.viewEditHandlerAttached = "true";
        console.log("[ViewEditor] Attaching handler to view-edit link", {
          viewName: link.dataset.viewName,
          text: link.textContent.trim()
        });
        link.addEventListener("click", async (event) => {
          console.log("[ViewEditor] view-edit link clicked", {
            viewName: link.dataset.viewName,
            target: event.target,
            currentTarget: event.currentTarget
          });
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const clickedViewName = link.dataset.viewName;
          if (!clickedViewName) {
            console.warn("[ViewEditor] view-edit clicked but no viewName in dataset");
            return;
          }
          console.log("[ViewEditor] Creating editor panel for view:", clickedViewName);
          const view = {
            friendlyId: clickedViewName,
            name: link.textContent.trim(),
            // Don't set queryText - let createEditorPanel fetch it for existing views
          };
          await createEditorPanel(view);
          console.log("[ViewEditor] Editor panel created");
        }, true);
      });

      // Attach click handlers to view-pane-btn buttons (opens view in a new pane/tab)
      pane.querySelectorAll(".view-pane-btn:not([data-handler-bound])").forEach((btn) => {
        btn.dataset.handlerBound = "true";
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const viewAcct = btn.dataset.account;
          const viewRepo = btn.dataset.repository;
          const viewName = btn.dataset.view;
          if (!viewAcct || !viewRepo || !viewName) return;
          await openViewPane(app, viewAcct, viewRepo, viewName);
        }, true); // Use capture phase to intercept before router
      });

      // Attach click handlers to view-window-button buttons (opens view HTML results in new window)
      const windowButtons = pane.querySelectorAll(".view-window-button:not([data-handler-bound])");
      console.log("[ViewEditor] Found", windowButtons.length, "view-window-button buttons in pane", accountName, repositoryName);
      windowButtons.forEach((btn) => {
        btn.dataset.handlerBound = "true";
        console.log("[ViewEditor] Attaching handler to view-window-button", {
          viewName: btn.dataset.view,
          account: btn.dataset.account,
          repository: btn.dataset.repository
        });
        btn.addEventListener("click", async (event) => {
          console.log("[ViewEditor] view-window-button clicked", {
            viewName: btn.dataset.view,
            account: btn.dataset.account,
            repository: btn.dataset.repository,
            target: event.target,
            currentTarget: event.currentTarget
          });
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const viewName = btn.dataset.view;
          if (!viewName) {
            console.warn("[ViewEditor] view-window-button clicked but no viewName in dataset");
            return;
          }
          const auth = app.state.getAuthContext(accountName);
          const host = auth?.host || window.location.origin;
          const accessToken = app.state.getAuthToken(accountName);
          const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(viewName)}.html`;
          console.log("[ViewEditor] Fetching view HTML with auth token:", viewHtmlUrl);
          
          try {
            const response = await fetch(viewHtmlUrl, {
              headers: {
                'Accept': 'text/html',
                'Authorization': `Bearer ${accessToken}`
              }
            });
            
            if (!response.ok) {
              console.error("[ViewEditor] Failed to fetch view HTML:", response.status, response.statusText);
              const errorText = await getResponseText(response);
              alert(`Failed to load view: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
              return;
            }
            
            const htmlContent = await response.text();
            console.log("[ViewEditor] HTML content fetched, opening in new window");
            
            const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
            if (newWindow) {
              newWindow.document.title = `Dydra View: ${accountName}/${repositoryName}/${viewName}`;
              newWindow.document.write(htmlContent);
              newWindow.document.close();
              newWindow.focus();
            } else {
              console.warn("[ViewEditor] Failed to open new window - popup blocked?");
              alert("Popup blocked. Please allow popups for this site to open view in new window.");
            }
          } catch (error) {
            console.error("[ViewEditor] Error fetching view HTML:", error);
            let errorMessage = error.message;
            // If error has a response, try to get its text
            if (error.response) {
              try {
                const errorText = await getResponseText(error.response);
                errorMessage += errorText ? ` - ${errorText}` : "";
              } catch (e) {
                // Ignore errors reading response
              }
            }
            alert(`Failed to load view: ${errorMessage}`);
          }
        }, true); // Use capture phase to intercept before router
      });

      // "New" view button
      const newBtn = pane.querySelector(".view-new-btn:not([data-handler-bound])");
      if (newBtn) {
        newBtn.dataset.handlerBound = "true";
        newBtn.addEventListener("click", () => {
          // Show a name input dialog
          const overlay = document.createElement("div");
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
          const dialog = document.createElement("div");
          dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
          dialog.innerHTML = `
            <h3 style="margin:0 0 12px 0;">New View</h3>
            <input type="text" data-testid="new-view-name-input" placeholder="View name" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
            <div style="margin-top:12px;text-align:right;">
              <button class="new-view-cancel" data-testid="new-view-cancel-btn" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
              <button class="new-view-ok" data-testid="new-view-ok-btn" style="padding:6px 12px;cursor:pointer;">Create</button>
            </div>
          `;
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);

          const input = dialog.querySelector("input");
          const okBtn = dialog.querySelector(".new-view-ok");
          const cancelBtn = dialog.querySelector(".new-view-cancel");
          input.focus();

          // Add error message element to dialog
          const errorDiv = document.createElement("div");
          errorDiv.style.cssText = "color: #dc3545; font-size: 12px; margin-top: 8px; display: none;";
          dialog.querySelector("h3").after(errorDiv);

          const close = () => overlay.remove();
          cancelBtn.addEventListener("click", close);
          overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

          const submit = async () => {
            const name = input.value.trim();
            if (!name) return;

            const queryContainer = pane.querySelector(".query-container");
            if (!queryContainer) {
              close();
              return;
            }

            // Check if view already exists
            const existingViews = await fetchRepositoryViews(app.state, accountName, repositoryName);
            const existingView = existingViews.find(v => v.name === name || v.friendlyId === name || ensureBaseViewName(v.friendlyId) === name);
            if (existingView) {
              errorDiv.textContent = `View "${name}" already exists.`;
              errorDiv.style.display = "block";
              // Close dialog after a brief delay and open existing view in editor
              setTimeout(() => {
                close();
                // Open the existing view in the editor
                const viewEditLink = queryContainer.querySelector(`.view-edit[data-view-name="${escapeHtml(name)}"]`);
                if (viewEditLink) {
                  viewEditLink.click();
                } else {
                  // Fallback: create editor for the existing view
                  createEditorPanel({ friendlyId: name, queryText: undefined });
                }
              }, 1500);
              return;
            }

            // Remove "no queries" placeholder if present
            const placeholder = queryContainer.querySelector("p");
            if (placeholder) placeholder.closest(".query")?.remove();

            // Build the new entry - order must match the initial render
            const entry = document.createElement("div");
            entry.className = "query";
            const host = auth?.host || window.location.origin;
            entry.innerHTML = `
              <a class="view-edit" data-view-name="${escapeHtml(name)}" data-action="open-view" data-testid="view-edit-${escapeHtml(name)}" href="#">${escapeHtml(name)}</a>
              <span style="float: right; display: flex; align-items: center; gap: 4px;">
                <span class="owner"> <a href="${BASE_PATH}/account/${encodeURIComponent(accountName)}">${escapeHtml(accountName)}</a> </span>
                <button type="button" class="view-pane-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" data-testid="view-pane-btn-${escapeHtml(name)}" style="
                  background: transparent;
                  border: none;
                  padding: 2px;
                  cursor: pointer;"
                  title="Open view in new pane">
                  <img src="${BASE_PATH}/images/folder-plus.svg" alt="Edit Pane" style="width: 16px; height: 16px; opacity: 0.6;" />
                </button>
                <button type="button" class="view-window-button" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" data-testid="view-window-btn-${escapeHtml(name)}" style="
                  background: transparent;
                  border: none;
                  padding: 2px;
                  cursor: pointer;
                " title="Open view results in new window">
                  <img src="${BASE_PATH}/images/link.svg" alt="Open in window" style="width: 16px; height: 16px; opacity: 0.6;" />
                </button>
                <button type="button" class="view-delete-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" data-testid="view-delete-btn-${escapeHtml(name)}" style="
                  background: transparent;
                  border: none;
                  padding: 2px;
                  cursor: pointer;
                " title="Delete View">
                  <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width: 16px; height: 16px; opacity: 0.6;" />
                </button>
              </span>
            `;

            // Insert alphabetically among existing entries
            const entries = Array.from(queryContainer.querySelectorAll(".query"));
            const insertBefore = entries.find((el) => {
              const link = el.querySelector(".view-edit");
              return link && link.textContent.trim().localeCompare(name) > 0;
            });
            if (insertBefore) {
              queryContainer.insertBefore(entry, insertBefore);
            } else {
              queryContainer.appendChild(entry);
            }

            // Re-stripe odd/even
            queryContainer.querySelectorAll(".query").forEach((el, i) => {
              el.className = `query ${i % 2 === 0 ? "even" : "odd"}`;
            });

            // Attach view-edit handler
            const editLink = entry.querySelector(".view-edit");
            if (editLink) {
              // Prevent duplicate handlers
              if (editLink.dataset.viewEditHandlerAttached === "true") {
                console.log("[ViewEditor] Handler already attached to dynamically created view-edit link, skipping");
              } else {
                editLink.dataset.viewEditHandlerAttached = "true";
                editLink.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  const clickedViewName = editLink.dataset.viewName;
                  if (!clickedViewName) return;
                  const view = {
                    friendlyId: clickedViewName,
                    name: editLink.textContent.trim(),
                    // Don't set queryText - let createEditorPanel fetch it for existing views
                  };
                  await createEditorPanel(view);
                }, true);
              }
            }
            
            // Attach view-pane-btn handler
            const paneBtn = entry.querySelector(".view-pane-btn");
            if (paneBtn) {
              paneBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                await openViewPane(app, accountName, repositoryName, name);
              }, true); // Use capture phase to intercept before router
            }
            
            // Attach view-window-button handler
            const windowBtn = entry.querySelector(".view-window-button");
            if (windowBtn) {
              windowBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(name)}.html`;
                
                try {
                  const response = await fetch(viewHtmlUrl, {
                    headers: {
                      'Accept': 'text/html',
                      'Authorization': `Bearer ${accessToken}`
                    }
                  });
                  
                  if (!response.ok) {
                    const errorText = await getResponseText(response);
                    alert(`Failed to load view: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
                    return;
                  }
                  
                  const htmlContent = await response.text();
                  const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
                  if (newWindow) {
                    newWindow.document.title = `Dydra View: ${accountName}/${repositoryName}/${name}`;
                    newWindow.document.write(htmlContent);
                    newWindow.document.close();
                    newWindow.focus();
                  } else {
                    alert("Popup blocked. Please allow popups for this site to open view in new window.");
                  }
                } catch (error) {
                  let errorMessage = error.message;
                  // If error has a response, try to get its text
                  if (error.response) {
                    try {
                      const errorText = await getResponseText(error.response);
                      errorMessage += errorText ? ` - ${errorText}` : "";
                    } catch (e) {
                      // Ignore errors reading response
                    }
                  }
                  alert(`Failed to load view: ${errorMessage}`);
                }
              }, true);
            }
            
            // Attach view-delete-btn handler
            const deleteBtn = entry.querySelector(".view-delete-btn");
            if (deleteBtn) {
              deleteBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                await handleViewDelete(app, accountName, repositoryName, name, deleteBtn);
              }, true);
            }
            
            // Attach view-editor-btn handler
            const editorBtn = entry.querySelector(".view-editor-btn");
            if (editorBtn) {
              editorBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(name)}.html`;
                window.open(viewHtmlUrl, '_blank');
              });
            }
            
            // Close dialog
            close();
            
            // Show confirmation popup indicating the view needs to be edited and saved
            const confirmOverlay = document.createElement("div");
            confirmOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;";
            const confirmDialog = document.createElement("div");
            confirmDialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;max-width:500px;";
            confirmDialog.innerHTML = `
              <h3 style="margin:0 0 12px 0;">View Created</h3>
              <p style="margin:0 0 16px 0;line-height:1.5;">The view "${escapeHtml(name)}" has been created. Please edit the query text and save it to persist the view.</p>
              <div style="text-align:right;">
                <button class="view-created-ok" style="padding:6px 12px;cursor:pointer;">OK</button>
              </div>
            `;
            confirmOverlay.appendChild(confirmDialog);
            document.body.appendChild(confirmOverlay);
            
            const confirmOkBtn = confirmDialog.querySelector(".view-created-ok");
            const closeConfirm = () => confirmOverlay.remove();
            confirmOkBtn.addEventListener("click", closeConfirm);
            confirmOverlay.addEventListener("click", (e) => { if (e.target === confirmOverlay) closeConfirm(); });
            confirmOkBtn.focus();
            
            // Create editor panel with null queryText to indicate it's a new view (don't fetch)
            await createEditorPanel({ friendlyId: name, name, queryText: null });
          };

          okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.stopPropagation(); submit(); }
            if (e.key === "Escape") close();
          });
        });
      }

      // Pane-level revision selector for execute links
      const paneRevSelect = pane.querySelector('.pane-revision-select');
      if (paneRevSelect) {
        let paneRevsLoaded = false;
        const loadPaneRevisions = () => {
          if (paneRevsLoaded) return;
          paneRevsLoaded = true;
          const revAcct = paneRevSelect.dataset.account;
          const revRepo = paneRevSelect.dataset.repository;
          const revAuth = app.state.getAuthContext(revAcct);
          if (!revAuth?.token || !revAuth?.host) return;
          const revEndpoint = `${revAuth.host}/system/accounts/${encodeURIComponent(revAcct)}/repositories/${encodeURIComponent(revRepo)}/revisions`;
          fetch(revEndpoint, {
            headers: { 'Accept': 'text/plain', 'Authorization': `Bearer ${revAuth.token}` }
          })
          .then(r => r.ok ? r.text() : Promise.reject('Failed'))
          .then(text => {
            text.trim().split('\n').filter(Boolean).forEach(rev => {
              const opt = document.createElement('option');
              opt.value = rev.trim();
              opt.textContent = rev.trim();
              paneRevSelect.appendChild(opt);
            });
          })
          .catch(err => console.warn('Could not load pane revisions:', err));
        };
        paneRevSelect.addEventListener('mousedown', loadPaneRevisions);
        paneRevSelect.addEventListener('focus', loadPaneRevisions);

        paneRevSelect.addEventListener('change', () => {
          const selectedRev = paneRevSelect.value;
          pane.querySelectorAll('a[data-external]').forEach(link => {
            const baseUrl = link.href.split('?')[0];
            link.href = selectedRev === 'HEAD' ? baseUrl : baseUrl + '?revision=' + encodeURIComponent(selectedRev);
          });
        });
      }
    });
    } else {
      console.log("[ViewEditor] window.createSparqlEditor is not a function");
    }
  } catch (error) {
    console.error("[ViewEditor] Error initializing view editors:", error);
  }
};

window.saveAccountPane = async (accountName) => {
  if (!accountName || !window.appState) return;
  const pane = document.getElementById(paneIdAccount(accountName));
  if (!pane) return;
  const auth = window.appState.getAuthContext(accountName);
  const tracker = window.appState.getAccountTracker(accountName);
  const deltas = tracker?.deltas ? tracker.deltas() : {};
  const configUpdates = {};
  Object.entries(deltas || {}).forEach(([field, values]) => {
    configUpdates[field] = values[0];
  });
  if (configUpdates.firstname !== undefined || configUpdates.familyname !== undefined) {
    const first =
      configUpdates.firstname ??
      tracker?.firstname ??
      tracker?.first_name ??
      "";
    const last =
      configUpdates.familyname ??
      tracker?.familyname ??
      tracker?.family_name ??
      tracker?.last_name ??
      tracker?.lastname ??
      "";
    configUpdates.fullname = `${first} ${last}`.trim();
  }
  if (!Object.keys(configUpdates).length) {
    const saveButton = document.querySelector(`[data-tab-id="${paneIdAccount(accountName)}"][data-tab-action="save"]`);
    if (saveButton) saveButton.setAttribute("aria-disabled", "true");
    return;
  }
  const updated = await updateAccountConfiguration({
    host: auth?.host,
    token: auth?.token,
    accountName,
    config: configUpdates,
  });
  const mergedConfig = { ...(auth?.config || {}), ...(updated || configUpdates) };
  if (auth) {
    window.appState.authStore.setAuth(accountName, auth.token, mergedConfig, auth.host);
  }
  window.appState.setAccountFromConfig(accountName, mergedConfig);
  pane.querySelectorAll("input.profile-input").forEach((input) => {
    const newValue = input.value;
    const span = document.createElement("span");
    span.className = "foaf-value";
    span.dataset.field = input.dataset.field;
    span.dataset.type = input.dataset.type || "text";
    span.dataset.editable = "true";
    span.textContent = newValue;
    input.replaceWith(span);
  });
  const fullNameSpan = pane.querySelector('.foaf-value[data-field="fullname"]');
  if (fullNameSpan) {
    const first =
      mergedConfig.firstname ||
      mergedConfig.first_name ||
      configUpdates.firstname ||
      "";
    const last =
      mergedConfig.familyname ||
      mergedConfig.family_name ||
      mergedConfig.last_name ||
      mergedConfig.lastname ||
      configUpdates.familyname ||
      "";
    fullNameSpan.textContent = `${first} ${last}`.trim();
  }
  if (tracker?.setStateClean) {
    tracker.setStateClean();
  }
  const saveButton = document.querySelector(`[data-tab-id="${paneIdAccount(accountName)}"][data-tab-action="save"]`);
  if (saveButton) saveButton.setAttribute("aria-disabled", "true");
};

window.saveRepositoryPane = async (accountName, repositoryName) => {
  if (!accountName || !repositoryName || !window.appState) return;
  const pane = document.getElementById(paneIdRepository(accountName, repositoryName));
  if (!pane) return;
  const auth = window.appState.getAuthContext(accountName);
  const tracker = window.appState.getRepositoryTracker(accountName, repositoryName);
  const deltas = tracker?.deltas ? tracker.deltas() : {};
  const configUpdates = {};
  Object.entries(deltas || {}).forEach(([field, values]) => {
    let value = values[0];
    if (field === "permissible_ip_addresses" && typeof value === "string") {
      value = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    if (field === "prefixes") {
      // Prefixes is a string with entries separated by \n
      // Just use the string value as-is
      value = String(value || "");
    }
    configUpdates[field] = value;
  });
  if (!Object.keys(configUpdates).length) {
    const saveButton = document.querySelector(`[data-tab-id="${paneIdRepository(accountName, repositoryName)}"][data-tab-action="save"]`);
    if (saveButton) saveButton.setAttribute("aria-disabled", "true");
    return;
  }
  await updateRepositoryConfiguration({
    host: auth?.host,
    token: auth?.token,
    accountName,
    repositoryName,
    config: configUpdates,
  });
  // Invalidate cache to ensure fresh data on next fetch
  invalidateRepositoryConfigCache(window.appState, accountName, repositoryName);
  // Update the Readme section if description was saved
  if (configUpdates.description !== undefined) {
    const readmeContainer = pane.querySelector("#repository-markdown");
    if (readmeContainer) {
      const descriptionText = configUpdates.description || "";
      readmeContainer.innerHTML = descriptionText ? `<p>${escapeHtml(descriptionText)}</p>` : `<p>A description has not been added for this repository yet.</p>`;
    }
  }
  const saveButton = document.querySelector(`[data-tab-id="${paneIdRepository(accountName, repositoryName)}"][data-tab-action="save"]`);
  if (saveButton) saveButton.setAttribute("aria-disabled", "true");
  if (tracker?.setStateClean) {
    tracker.setStateClean();
  }
};

const normalizeViews = (views = []) => {
  if (!Array.isArray(views)) return [];
  return views.map((view) => {
    if (typeof view === "string") {
      // Extract base name from path (e.g., "account/repo/view" -> "view")
      const baseName = view.split("/").pop();
      return { friendlyId: baseName, name: baseName };
    }
    const id = view?.name || view?.id || view?.key;
    // Extract base name from path if it contains slashes
    const baseId = id ? (id.includes("/") ? id.split("/").pop() : id) : "view";
    const baseName = view?.name ? (view.name.includes("/") ? view.name.split("/").pop() : view.name) : baseId;
    return { friendlyId: baseId, name: baseName || baseId || "View" };
  }).filter((view) => view.friendlyId);
};

const fetchRepositoryViews = async (state, accountName, repositoryName, config = null) => {
  // Always fetch fresh config to ensure we have the latest views
  // Don't rely on tracker state which might be stale from a previous window
  if (!config) {
    config = await fetchRepositoryConfig(state, accountName, repositoryName, true);
  }
  
  // If we have config with views, use it
  if (config?.views) {
    const views = normalizeViews(config.views || []);
        if (views.length) return views.sort((a, b) => a.name.localeCompare(b.name));
      }
  
  // Fall back to listQueries if config doesn't have views
  const queries = await state.listQueries(accountName, repositoryName);
  return queries.map((query) => {
    // Extract base name from path if it contains slashes
    const friendlyId = query.friendlyId ? (query.friendlyId.includes("/") ? query.friendlyId.split("/").pop() : query.friendlyId) : "";
    const name = query.name ? (query.name.includes("/") ? query.name.split("/").pop() : query.name) : friendlyId;
    return { friendlyId, name, queryText: query.queryText };
  })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const fetchViewText = async ({ auth, accountName, repositoryName, viewName }) => {
  if (!auth?.token || !auth?.host) return "";
  const response = await fetch(
    `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(ensureBaseViewName(viewName))}`,
    {
      method: "GET",
      headers: {
        Accept: "application/sparql-query",
        Authorization: `Bearer ${auth.token}`,
      },
    }
  );
  if (!response.ok) {
    return "";
  }
  return response.text();
};

const fetchAccountRepositories = async (state, accountName) => {
  let repos = await state.listRepositories(accountName);
  repos = [...repos].sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
  const auth = state.getAuthContext(accountName);
  if (auth?.token && auth?.host) {
    try {
      const response = await fetch(
        `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        const remoteRepos = normalizeRepositories(data);
        if (remoteRepos.length) {
          repos = remoteRepos.map((repo, index) => ({
            friendlyId: repo.name || repo.key || repo.id || `repo-${index}`,
            name: repo.name || repo.key || repo.id || `repo-${index}`,
            summary: repo.summary || "",
            quadCount: repo.quads || repo.quad_count || repo.statements || 0,
            diskSize: repo.disk_size || repo.size || "",
          }));
          repos = repos.sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
        }
      }
    } catch (error) {
      // Fall back to cached repositories.
    }
  }
  return repos;
};

const renderAccountRepositories = ({ account, repos }) => `
  <div id="account">
    <div id="account-repositories">
      <h2>
        <span class="action"><button type="button" class="repo-new-btn" data-account="${escapeHtml(account?.friendlyId || "")}" data-testid="repo-new-btn" style="font-size:13px;padding:2px 8px;cursor:pointer;">New Repository</button></span>
        Repositories
      </h2>
      ${repos.length ? joinHtml(repos.map((repo, index) => `
        <div class="repository ${index % 2 === 0 ? "odd" : "even"}">
          <div class="title ${repo.summary ? "" : "blank"}">
            <a href="${BASE_PATH}/account/${escapeHtml(account?.friendlyId || "")}/repositories/${escapeHtml(repo.friendlyId)}">${escapeHtml(repo.name)}</a>
            <span class="stats">
              ${repo.name === "system" ? "" : `<button type="button" class="repo-delete-btn" data-account="${escapeHtml(account?.friendlyId || "")}" data-repository="${escapeHtml(repo.friendlyId)}" style="
                background: transparent;
                border: none;
                padding: 4px;
                cursor: pointer;
                margin-left: 8px;
                vertical-align: middle;
              " title="Delete Repository">
                <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width: 16px; height: 16px; opacity: 0.6;" />
              </button>`}
            </span>
          </div>
          ${repo.summary ? `<div class="summary">${escapeHtml(repo.summary)}</div>` : ""}
        </div>
      `)) : `
        <p>You have not created any repositories yet. <button type="button" class="repo-new-btn" data-account="${escapeHtml(account?.friendlyId || "")}" data-testid="repo-new-btn-empty" style="font-size:13px;padding:2px 8px;cursor:pointer;">Create one now.</button></p>
      `}
    </div>
  </div>
`;

const DISPLAY_TYPE_HANDLERS = {
  text: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
  email: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
  url: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
  tel: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
  textarea: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
  readonly: {
    parse: (value) => value,
    format: (value) => String(value ?? ""),
  },
};

const ACCOUNT_FIELD_DEFS = {
  accountname: { title: "Account Name", field: "accountname", type: "text", editable: false },
  firstname: {
    title: "First name",
    field: "firstname",
    type: "text",
    editable: true,
    aliases: ["first_name", "firstName"],
  },
  familyname: {
    title: "Last name",
    field: "familyname",
    type: "text",
    editable: true,
    aliases: ["family_name", "familyName", "last_name", "lastName", "lastname"],
  },
  fullname: {
    title: "Full name",
    field: "fullname",
    type: "text",
    editable: false,
    aliases: ["full_name", "fullName"],
    compute: (values) => `${values.firstname} ${values.familyname}`.trim(),
  },
  email: { title: "Email", field: "email", type: "email", editable: true },
  homepage: { title: "Homepage", field: "homepage", type: "url", editable: true },
  blog: { title: "Blog", field: "blog", type: "url", editable: true },
  company: { title: "Organization", field: "company", type: "text", editable: true },
  location: { title: "Location", field: "location", type: "text", editable: true },
  phone: { title: "Phone", field: "phone", type: "tel", editable: true },
  skype_id: { title: "Skype ID", field: "skype_id", type: "text", editable: true },
  jabber_id: { title: "Jabber ID", field: "jabber_id", type: "text", editable: true },
  workinfo: {
    title: "Work info",
    field: "workinfo",
    type: "text",
    editable: true,
    aliases: ["work_info"],
  },
  uuid: { title: "UUID", field: "uuid", type: "text", editable: false },
  account_of: { title: "Account of", field: "account_of", type: "text", editable: false },
  has_owner: { title: "Has owner", field: "has_owner", type: "text", editable: false },
  id: { title: "ID", field: "id", type: "text", editable: false },
  administrator_of: { title: "Administrator of", field: "administrator_of", type: "text", editable: false },
  setting: { title: "Setting", field: "setting", type: "text", editable: false },
};

const ACCOUNT_PANE_REGISTRY = {
  profile: {
    title: "Profile",
    fieldKeys: [
      "accountname",
      "firstname",
      "familyname",
      "fullname",
      "email",
      "homepage",
      "blog",
      "company",
      "location",
      "phone",
      "skype_id",
      "jabber_id",
      "workinfo",
    ],
  },
  settings: {
    title: "Configuration",
    fieldKeys: [
      "accountname",
      "uuid",
      "account_of",
      "has_owner",
      "id",
      "administrator_of",
      "setting",
    ],
  },
};

const buildAccountFieldDefs = () => ({ ...ACCOUNT_FIELD_DEFS });

const resolveAccountFieldValue = ({ fieldKey, defs, tracker, config, account, accountName, values }) => {
  const def = defs[fieldKey];
  if (!def) return "";
  if (def.compute) {
    return def.compute(values);
  }
  if (fieldKey === "accountname" && accountName) {
    return accountName;
  }
  const sources = [tracker, config, account];
  const keys = [def.field, ...(def.aliases || [])];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }
  }
  return "";
};

const renderAccountSidebar = ({ account, accountName, containerId = "", config = {}, authToken = "", tracker = null } = {}) => {
  const defs = buildAccountFieldDefs();
  const values = { firstname: "", familyname: "" };
  const profileKeys = ACCOUNT_PANE_REGISTRY.profile.fieldKeys;
  const settingsKeys = ACCOUNT_PANE_REGISTRY.settings.fieldKeys;
  const profileFields = profileKeys.map((fieldKey) => {
    if (fieldKey === "firstname") {
      values.firstname = resolveAccountFieldValue({ fieldKey, defs, tracker, config, account, accountName, values });
    }
    if (fieldKey === "familyname") {
      values.familyname = resolveAccountFieldValue({ fieldKey, defs, tracker, config, account, accountName, values });
    }
    const value = resolveAccountFieldValue({ fieldKey, defs, tracker, config, account, accountName, values });
    return { fieldKey, def: defs[fieldKey], value };
  });
  // Prefixes is a string with entries separated by \n
  const prefixes = String(config?.prefixes || config?.prefixes_map || "");
  const prefixesText = prefixes;
  const tokenValue = config?.accessToken || authToken || "";
  
  return `
    <div${containerId ? ` id="${containerId}"` : ""} class="account-sidebar">
      <div class="account-manage block">
        <div class="manage-tabs">
          <button type="button" class="manage-tab active" data-tab="profile" title="Profile"><img src="./images/user.svg" alt="Profile" width="16" height="16" /></button>
          <button type="button" class="manage-tab" data-tab="settings" title="Configuration"><img src="./images/settings.svg" alt="Configuration" width="16" height="16" /></button>
          <button type="button" class="manage-tab" data-tab="authentication" title="Authentication"><img src="./images/lock.svg" alt="Authentication" width="16" height="16" /></button>
          <button type="button" class="manage-tab" data-tab="prefixes" title="Prefixes"><img src="./images/puzzle.svg" alt="Prefixes" width="16" height="16" /></button>
        </div>
        <div class="manage-tab-content">
          <div class="tab-panel active" data-panel="profile">
            ${profileFields.map(({ def, fieldKey, value }) => {
              if (!def) return "";
              const formatted = (DISPLAY_TYPE_HANDLERS[def.type] || DISPLAY_TYPE_HANDLERS.text).format(value);
              // Check editability from tracker's editableProperties() if available, otherwise use def.editable
              let isEditable = def.editable === true;
              if (tracker && typeof tracker.editableProperties === "function") {
                const editableProps = tracker.editableProperties();
                isEditable = editableProps.includes(fieldKey);
              }
              // Account name and fullname (computed) are never editable
              if (fieldKey === "accountname" || fieldKey === "fullname") {
                isEditable = false;
              }
              // Empty editable fields show "-" inline with label
              const isEmpty = !formatted && isEditable;
              const displayValue = formatted || (isEditable ? '-' : '');
              return `
                <div class="foaf-field${isEmpty ? " has-empty-value" : ""}">
                  <span class="foaf-label">${def.title}</span>
                  <span class="foaf-value${!isEditable ? " readonly" : ""}${isEmpty ? " empty" : ""}" data-field="${fieldKey}" data-type="${def.type}" data-editable="${isEditable ? "true" : "false"}">${escapeHtml(displayValue)}</span>
                </div>
              `;
            }).join("")}
          </div>
          <div class="tab-panel" data-panel="authentication">
            <div class="foaf-field">
              <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
                <span class="foaf-label">Access Token</span>
                <button type="button" class="reset-token-btn" data-account="${escapeHtml(accountName)}" title="Click reset to generate a new access token.">Reset</button>
              </div>
              <span class="foaf-value token-value readonly">${escapeHtml(tokenValue)}</span>
            </div>
            <div class="foaf-field" style="margin-top: 16px;">
              <span class="foaf-label">New Password</span>
              <input type="password" class="password-input" data-field="password" />
            </div>
            <div class="foaf-field">
              <span class="foaf-label">Confirm</span>
              <input type="password" class="password-input" data-field="password_confirmation" />
            </div>
            <div class="foaf-field">
              <span class="foaf-label">Current</span>
              <input type="password" class="password-input" data-field="current_password" />
            </div>
          </div>
          <div class="tab-panel" data-panel="settings">
            ${settingsKeys.length ? settingsKeys.map((key) => {
              const def = defs[key];
              const rawValue = resolveAccountFieldValue({ fieldKey: key, defs, tracker, config, account, accountName, values });
              if (rawValue === undefined || rawValue === null || rawValue === "") {
                return "";
              }
              const formatted = (DISPLAY_TYPE_HANDLERS[def?.type] || DISPLAY_TYPE_HANDLERS.text).format(
                typeof rawValue === "object" ? JSON.stringify(rawValue) : rawValue
              );
              const label = def?.title || key.replace(/_/g, " ");
              return `
                <div class="foaf-field">
                  <span class="foaf-label">${escapeHtml(label)}</span>
                  <span class="foaf-value readonly">${escapeHtml(String(formatted))}</span>
                </div>
              `;
            }).join("") : `<div class="sidebar-note">No settings data.</div>`}
          </div>
          <div class="tab-panel" data-panel="prefixes">
              <div class="foaf-field">
              <span class="foaf-label">Prefixes:</span>
              <textarea class="prefix-input" data-field="prefixes" rows="8" placeholder="Enter prefixes (one per line, separated by newlines)">${escapeHtml(prefixesText)}</textarea>
              </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

const initializeViewPanes = async (app) => {
  if (!app || typeof window.createSparqlEditor !== "function") return;

  const viewPanes = document.querySelectorAll(".view-pane");
  for (const pane of viewPanes) {
    const accountName = pane.dataset.account;
    const repositoryName = pane.dataset.repository;
    const viewName = pane.dataset.view;
    if (!accountName || !repositoryName || !viewName) continue;

    // Ensure we always use just the base name for the view
    const baseViewName = ensureBaseViewName(viewName);

    const containerId = `sparql-editor-container-${accountName}-${repositoryName}-${baseViewName}`;
    const container = pane.querySelector(`#${CSS.escape(containerId)}`);
    if (!container || container.dataset.initialized === "true") continue;
    container.dataset.initialized = "true";

    const auth = app.state.getAuthContext(accountName);
    const host = auth?.host || window.location.origin;
    const accessToken = app.state.getAuthToken(accountName);
    const sparqlEndpoint = `${host}/${accountName}/${repositoryName}/sparql`;
    const viewUrl = `${host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(baseViewName)}`;

    // Fetch repository config to get class for revision support
    const repoConfig = await fetchRepositoryConfig(app.state, accountName, repositoryName);
    const repoClass = repoConfig?.class || '';
    const revisionsEndpoint = /revisioned/i.test(repoClass)
      ? `${host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/revisions`
      : '';

    // Fetch view text
    const viewText = await fetchViewText({
      auth,
      accountName,
      repositoryName,
      viewName: baseViewName,
    });

    const editorApi = window.createSparqlEditor({
      container,
      viewUrl,
      sparqlEndpoint,
      accessToken,
      accountName,
      repositoryName,
      repositoryClass: repoClass,
      revisionsEndpoint,
          viewName: baseViewName,
          sparql: viewText !== null ? (viewText || "SELECT * WHERE { ?s ?p ?o } LIMIT 10") : "SELECT * WHERE { ?s ?p ?o } LIMIT 10",
      options: {
            title: `/${accountName}/${repositoryName}/${baseViewName}`,
        initialState: "open",
        showEventLog: true,
        showEditorToggle: true,
        showMediaTypeSelector: true,
        showSaveButton: true,
        showResetButton: true,
        showCloseButton: true,
        onQueryBlur: (queryText) => {
          // Synchronize query text to all other editors for this view
          const otherEditors = findEditorsForView(app, accountName, repositoryName, baseViewName).filter(e => e !== editorApi);
          otherEditors.forEach((otherEditor) => {
            if (otherEditor && otherEditor.setQuery) {
              try {
                otherEditor.setQuery(queryText);
              } catch (e) {
                console.warn("[ViewEditor] Failed to synchronize query text:", e);
              }
            }
          });
        },
        onClose: () => {
          app.state.removeOpenView(accountName, repositoryName, baseViewName);
          // Remove editor instance from map
          const paneId = paneIdView(accountName, repositoryName, baseViewName);
          if (app.editorInstances) {
            app.editorInstances.delete(paneId);
          }
          pane.remove();
          // Remove the tab from the tabs bar
          const tabLink = document.querySelector(`[data-tab-link][href="#${paneId}"]`);
          if (tabLink) {
            tabLink.closest("li")?.remove();
          }
        },
      },
    });
    
    // Store editor API instance
    const paneId = paneIdView(accountName, repositoryName, baseViewName);
    if (app.editorInstances) {
      app.editorInstances.set(paneId, editorApi);
    }
  }
};

const attachAccountSidebarHandlers = (app) => {
  if (!app) return;
  // Use :not([data-handler-bound]) to prevent duplicate handlers when called multiple times
  document.querySelectorAll(".account-sidebar .foaf-value[data-editable='true']:not([data-handler-bound])").forEach((field) => {
    field.dataset.handlerBound = "true";
    field.addEventListener("dblclick", () => {
      if (field.tagName.toLowerCase() === "input") return;
      const type = field.dataset.type || "text";
      const rawValue = field.textContent;
      // Don't use "-" placeholder as actual value
      const value = field.classList.contains("empty") ? "" : rawValue;
      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      input.className = "profile-input";
      input.dataset.field = field.dataset.field;
      input.dataset.type = field.dataset.type || "text";
      input.dataset.original = value;
      // Add editing class to parent for proper layout (input on new line)
      const parent = field.closest(".foaf-field");
      if (parent) {
        parent.classList.remove("has-empty-value");
        parent.classList.add("editing");
      }
      field.replaceWith(input);
      input.focus();
      input.select();
    });
  });

  document.querySelectorAll(".account-sidebar:not([data-input-handler-bound])").forEach((sidebar) => {
    sidebar.dataset.inputHandlerBound = "true";
    sidebar.addEventListener("input", (event) => {
      const input = event.target.closest("input.profile-input");
      if (!input) {
        // Handle prefix textarea
        const textarea = event.target.closest("textarea.prefix-input");
        if (textarea && textarea.dataset.field === "prefixes") {
          const pane = sidebar.closest(".account-pane");
          const accountName = pane?.dataset.account;
          if (accountName && app?.state) {
            const tracker = app.state.getAccountTracker(accountName);
            if (tracker) {
              // Prefixes is a string with entries separated by \n
              // Just store the string value as-is
              tracker.prefixes = String(textarea.value || "");
              updateSaveButtonVisibility(pane, "textarea.prefix-input", tracker);
            }
          }
        }
        return;
      }
    });
  });

  document.querySelectorAll(".reset-token-btn:not([data-handler-bound])").forEach((button) => {
    button.dataset.handlerBound = "true";
    button.addEventListener("click", async () => {
      const accountName = button.getAttribute("data-account");
      const sidebar = button.closest(".account-sidebar");
      if (!sidebar) return;
      const auth = app.state.getAuthContext(accountName);
      if (!auth?.token || !auth?.host) return;
      try {
        const url = `${auth.host}/${encodeURIComponent(accountName)}/auth_token`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Accept: "text/html",
          },
        });
        if (!response.ok) {
          const errorText = await getResponseText(response);
          alert(`Failed to reset token (${response.status})${errorText ? ` - ${errorText}` : ""}`);
          return;
        }
        const html = await response.text();
        // Parse the token from the HTML response
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const tokenEl = doc.querySelector("#auth_token") || doc.querySelector("textarea");
        const newToken = tokenEl ? tokenEl.textContent.trim() : html.trim();
        if (newToken) {
          const config = { ...(auth.config || {}), accessToken: newToken };
          app.state.authStore.setAuth(accountName, auth.token, config, auth.host);
          const tokenValue = sidebar.querySelector(".token-value");
          if (tokenValue) tokenValue.textContent = newToken;
        }
      } catch (error) {
        console.error("Failed to reset token:", error);
        let errorMessage = error.message;
        // If error has a response, try to get its text
        if (error.response) {
          try {
            const errorText = await getResponseText(error.response);
            errorMessage += errorText ? ` - ${errorText}` : "";
          } catch (e) {
            // Ignore errors reading response
          }
        }
        alert(`Failed to reset token: ${errorMessage}`);
      }
    });
  });

  document.querySelectorAll(".account-pane").forEach((pane) => {
    pane.querySelectorAll(".account-sidebar .manage-tab:not([data-handler-bound])").forEach((tab) => {
      tab.dataset.handlerBound = "true";
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        pane.querySelectorAll(".account-sidebar .manage-tab").forEach((item) => item.classList.remove("active"));
        pane.querySelectorAll(".account-sidebar .tab-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.getAttribute("data-panel") === target);
        });
        tab.classList.add("active");
      });
    });
  });
};

export class HomePage extends BasePage {
  constructor(options) {
    super(options);
    this.navigation = new NavigationView();
  }

  useHomeLayout() {
    return false;
  }

  getTitle() {
    return "Dydra";
  }

  getBodyClass() {
    return "home";
  }

  async renderContent() {
    const { navLinks, session } = this.context || {};
    const currentAccount = session?.accountName
      ? await this.state.getAccount(session.accountName)
      : null;
    const infoContent = `
      <div id="feature">
        <div class="wrapper">
          <div id="feature-0">
            <div id="feature-1">
              <div id="feature-2">
                <h1 id="logo">Dydra</h1>
                ${this.navigation.render({ navLinks, session })}
                <div id="intro">
                  <h1>Networks Made Friendly</h1>
                  <p>
                    <strong>Dydra&nbsp;</strong>
                    is a powerful&nbsp;
                    <strong>graph database&nbsp;</strong>
                    in the cloud,
                    allowing your business to make the most of highly connected data, such as social networks.
                    <br />
                    It's fast, easy to use and affordable.
                    <a href="http://${APP_CONFIG.docsHost}/dydra">Learn more&nbsp;&raquo;</a>
                    <br />
                    <a href="${BASE_PATH}/account/jhacker">Visit a sample account</a>
                  </p>
                </div>
                <div id="datatree"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="demo">
        <div class="wrapper">
          <div id="demo-intro">
            <h2>Here's what we've been up to</h2>
            <ul>
              <li><a href="http://blog.dydra.com/2015/10/08/nxp-data-hub">NXP Wins the EU Linked data Award</a></li>
              <li><a href="http://blog.dydra.com/2015/09/15/rdf-patches">Looking for an RDF Patch Format</a></li>
            </ul>
          </div>
          <ul id="demo-paginator">
            <li id="demo-paginator-indicator"></li>
            <li class="active"><a href="#code-create"><span class="number">1</span>Create</a></li>
            <li><a href="#code-import"><span class="number">2</span>Import</a></li>
            <li><a href="#code-query"><span class="number">3</span>Query</a></li>
          </ul>
          <div id="code">
            <div id="code-create" class="demo-snippet">
              <p class="command">$ dydra create foaf</p>
              <p class="output">
                Username: jhacker<br />
                Created http://dydra.com/jhacker/foaf
              </p>
            </div>
            <div id="code-import" class="demo-snippet" style="display:none">
              <p class="command">$ dydra import foaf &lt;br/&gt;http://datagraph.org/jhacker/foaf.nt</p>
              <p class="output">Imported 10 triples into http://dydra.com/jhacker/foaf</p>
            </div>
            <div id="code-query" class="demo-snippet" style="display:none">
              <p class="command">$ dydra query foaf &lt;br/&gt;'select distinct ?s where { ?s ?p ?o }'</p>
              <p class="output">&laquo;http://dydra.com/jhacker/#self&raquo;</p>
            </div>
          </div>
        </div>
      </div>
      <div id="main">
        <div id="main-0">
          <div class="wrapper">
            <div id="content">
              <div id="mainteinability" class="block">
                <h5>Hassle-free operations</h5>
                <p>We take care of system administration and maintenance. You just use it.</p>
              </div>
              <div id="reliability" class="block">
                <h5>Reliability comes standard</h5>
                <p>We focus on data integrity and availability. You focus on your business.</p>
              </div>
              <div id="scalability" class="block">
                <h5>Always in balance</h5>
                <p>Dydra grows with your data. Worrying about scaling is a thing of the past.</p>
              </div>
              <div id="affordability" class="block">
                <h5>Saves you money</h5>
                <p>The basic plan is free. We'll offer more powerful paid tiers after the beta period.</p>
              </div>
            </div>
            <div id="aside">
              <form id="join-beta" onsubmit="return false;">
                <h3>Get an Account</h3>
                <p>Enter your email address and we'll<br />send you an access code.</p>
                <p class="textfield">
                  <input id="invitation_email" name="invitation[email]" type="text" value="Your email address..." />
                  <a class="disabled submit" href="#">Notify Me</a>
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
    const loginContent = buildLoginContent(this.state);
    const hasOpenAccounts = this.state.listOpenAccounts().length > 0;

    const accountPanes = await buildAccountPanes(this.state);
    const repositoryPanes = await buildRepositoryPanes(this.state);
    const viewPanes = await buildViewPanes(this.state);
    // Include intro pane only if not logged in (no open accounts)
    // After auth, the intro tab is hidden and only login + account tabs remain
    return `
      ${!hasOpenAccounts ? `<div id="tab-info" class="pane" style="display:none">${infoContent}</div>` : ""}
      <div id="tab-login" class="pane" style="display:block">
        ${loginContent}
      </div>
      ${accountPanes.join("")}
      ${repositoryPanes.join("")}
      ${viewPanes.join("")}
    `;
  }

  async afterRender() {
    const app = this.context?.app;
    await setupInlineLogin(app);
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    initializeViewPanes(app);
  }

  async getPaneTabs() {
    // Include intro tab only if no open accounts (not authenticated yet)
    const hasOpenAccounts = this.state.listOpenAccounts().length > 0;
    const tabs = await buildGlobalTabs(this.state, { includeInfo: !hasOpenAccounts });
    return {
      defaultTab: "#tab-login",
      bar: renderPaneTabsBar({ tabs }),
    };
  }
}

export class LoginPage extends BasePage {
  getTitle() {
    return "Login";
  }

  getBodyClass() {
    return "devise sessions new";
  }

  useHomeLayout() {
    console.log("[LoginPage] useHomeLayout() called, returning false");
    return false;
  }

  async renderContent() {
    console.log("[LoginPage] renderContent() called");
    const { navLinks, session } = this.context || {};
    const loginContent = buildLoginContent(this.state);
    const accountPanes = await buildAccountPanes(this.state);
    const repositoryPanes = await buildRepositoryPanes(this.state);
    
    // Build info pane (intro content) - always render it
    const navigation = new NavigationView();
    const infoContent = `
      <div id="feature">
        <div class="wrapper">
          <div id="feature-0">
            <div id="feature-1">
              <div id="feature-2">
                <h1 id="logo">Dydra</h1>
                ${navigation.render({ navLinks, session })}
                <div id="intro">
                  <h1>Networks Made Friendly</h1>
                  <p>
                    <strong>Dydra&nbsp;</strong>
                    is a powerful&nbsp;
                    <strong>graph database&nbsp;</strong>
                    in the cloud,
                    allowing your business to make the most of highly connected data, such as social networks.
                    <br />
                    It's fast, easy to use and affordable.
                    <a href="http://${APP_CONFIG.docsHost}/dydra">Learn more&nbsp;&raquo;</a>
                    <br />
                    <a href="${BASE_PATH}/account/jhacker">Visit a sample account</a>
                  </p>
                </div>
                <div id="datatree"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="demo">
        <div class="wrapper">
          <div id="demo-intro">
            <h2>Here's what we've been up to</h2>
            <ul>
              <li><a href="http://blog.dydra.com/2015/10/08/nxp-data-hub">NXP Wins the EU Linked data Award</a></li>
              <li><a href="http://blog.dydra.com/2015/09/15/rdf-patches">Looking for an RDF Patch Format</a></li>
            </ul>
          </div>
          <ul id="demo-paginator">
            <li id="demo-paginator-indicator"></li>
            <li class="active"><a href="#code-create"><span class="number">1</span>Create</a></li>
            <li><a href="#code-import"><span class="number">2</span>Import</a></li>
            <li><a href="#code-query"><span class="number">3</span>Query</a></li>
          </ul>
          <div id="code">
            <div id="code-create" class="demo-snippet">
              <p class="command">$ dydra create foaf</p>
              <p class="output">
                Username: jhacker<br />
                Created http://dydra.com/jhacker/foaf
              </p>
            </div>
            <div id="code-import" class="demo-snippet" style="display:none">
              <p class="command">$ dydra import foaf &lt;br/&gt;http://datagraph.org/jhacker/foaf.nt</p>
              <p class="output">Imported 10 triples into http://dydra.com/jhacker/foaf</p>
            </div>
            <div id="code-query" class="demo-snippet" style="display:none">
              <p class="command">$ dydra query foaf &lt;br/&gt;'select distinct ?s where { ?s ?p ?o }'</p>
              <p class="output">&laquo;http://dydra.com/jhacker/#self&raquo;</p>
            </div>
          </div>
        </div>
      </div>
      <div id="main">
        <div id="main-0">
          <div class="wrapper">
            <div id="content">
              <div id="mainteinability" class="block">
                <h5>Hassle-free operations</h5>
                <p>We take care of system administration and maintenance. You just use it.</p>
              </div>
              <div id="reliability" class="block">
                <h5>Reliability comes standard</h5>
                <p>We focus on data integrity and availability. You focus on your business.</p>
              </div>
              <div id="scalability" class="block">
                <h5>Always in balance</h5>
                <p>Dydra grows with your data. Worrying about scaling is a thing of the past.</p>
              </div>
              <div id="affordability" class="block">
                <h5>Saves you money</h5>
                <p>The basic plan is free. We'll offer more powerful paid tiers after the beta period.</p>
              </div>
            </div>
            <div id="aside">
              <form id="join-beta" onsubmit="return false;">
                <h3>Get an Account</h3>
                <p>Enter your email address and we'll<br />send you an access code.</p>
                <p class="textfield">
                  <input id="invitation_email" name="invitation[email]" type="text" value="Your email address..." />
                  <a class="disabled submit" href="#">Notify Me</a>
                </p>
      </form>
            </div>
          </div>
        </div>
      </div>
    `;

    const isLoggedIn = this.state.session?.isLoggedIn();
    const hasOpenAccounts = this.state.listOpenAccounts().length > 0;
    
    const viewPanes = await buildViewPanes(this.state);
    // Include intro pane only if not logged in (no open accounts)
    // After auth, the intro tab is hidden and only login + account tabs remain
    return `
      ${!hasOpenAccounts ? `<div id="tab-info" class="pane" style="display:none">${infoContent}</div>` : ""}
      <div id="tab-login" class="pane" style="display:block">
        ${loginContent}
      </div>
      ${accountPanes.join("")}
      ${repositoryPanes.join("")}
      ${viewPanes.join("")}
    `;
  }

  async renderSidebar() {
    return "";
  }

  async afterRender() {
    const app = this.context?.app;
    await setupInlineLogin(app);
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    initializeViewPanes(app);
  }

  async getPaneTabs() {
    // Include intro tab only if no open accounts (not authenticated yet)
    const hasOpenAccounts = this.state.listOpenAccounts().length > 0;
    const tabs = await buildGlobalTabs(this.state, { includeInfo: !hasOpenAccounts });
    return {
      defaultTab: "#tab-login",
      bar: renderPaneTabsBar({ tabs }),
    };
  }
}

export class SignupPage extends BasePage {
  getTitle() {
    return "Sign Up";
  }

  getBodyClass() {
    return "devise registrations new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Get Started with Dydra</h1>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            ${APP_CONFIG.requireSignupInvite ? `<li class="string optional"><label>Invite code</label><input type="text" name="invite_code" /></li>` : ""}
            <li class="string optional"><label>Username</label><input type="text" name="name" /></li>
            <li class="email optional"><label>Email</label><input type="email" name="email" /></li>
            <li class="password optional"><label>Password</label><input type="password" name="password" /></li>
            <li class="password optional"><label>Confirm Password</label><input type="password" name="password_confirmation" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Sign up" /></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async renderSidebar() {
    return `
      <a class="login" id="aside-link" href="/login">Already have an account? <strong>Log in</strong></a>
      <h5>Don't have an invite code?</h5>
      <p>Dydra is currently in closed beta and only accepting signups using invite codes.</p>
      <form id="join-beta" onsubmit="return false;">
        <h3>Request an invite</h3>
        <p>Enter your email address and we'll<br />let you know when a slot is available.</p>
        <p class="textfield">
          <input name="invitation[email]" type="text" value="Your email address..." />
          <a class="disabled submit" href="#">Notify Me</a>
        </p>
      </form>
    `;
  }
}

export class ResetPasswordPage extends BasePage {
  getTitle() {
    return "Forgot your password?";
  }

  getBodyClass() {
    return "devise passwords new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Forgot your password?</h1>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            <li class="email optional"><label>Email address</label><input type="email" name="email" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Submit" /></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async renderSidebar() {
    return deviseLinks();
  }
}

export class ConfirmationsPage extends BasePage {
  getTitle() {
    return "Resend confirmation instructions";
  }

  getBodyClass() {
    return "devise confirmations new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Resend confirmation instructions</h1>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            <li class="email optional"><label>Email</label><input type="email" name="email" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Change my password" /></li>
            <li class="cancel">or <a href="#">Cancel</a></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async renderSidebar() {
    return deviseLinks();
  }
}

export class UnlocksPage extends BasePage {
  getTitle() {
    return "Resend unlock instructions";
  }

  getBodyClass() {
    return "devise unlocks new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Resend unlock instructions</h1>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            <li class="email optional"><label>Email address</label><input type="email" name="email" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Resend" /></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async renderSidebar() {
    return deviseLinks();
  }
}

export class AccountRoute extends BasePage {
  getBodyClass() {
    return "accounts show";
  }

  async renderContent() {
    const account = await this.state.getAccount(this.params.account_name);
    const repos = await fetchAccountRepositories(this.state, this.params.account_name);
    this.state.addOpenAccount(this.params.account_name);
    const accountPanes = await buildAccountPanes(this.state);
    const repositoryPanes = await buildRepositoryPanes(this.state);
    const viewPanes = await buildViewPanes(this.state);
    const loginContent = buildLoginContent(this.state);
    // Login pane is always available so users can authenticate additional accounts
    // It starts hidden and is shown when user clicks the Login tab
    return `
      <div id="tab-login" class="pane" style="display:none">
        ${loginContent}
      </div>
      ${accountPanes.join("")}
      ${repositoryPanes.join("")}
      ${viewPanes.join("")}
    `;
  }

  async renderSidebar() {
    return "";
  }

  async afterRender() {
    const app = this.context?.app;
    await setupInlineLogin(app);
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    initializeViewPanes(app);
  }

  async getPaneTabs() {
    const account = await this.state.getAccount(this.params.account_name);
    this.state.addOpenAccount(this.params.account_name);
    const tabs = await buildGlobalTabs(this.state, { includeInfo: false });
    return {
      defaultTab: `#${paneIdAccount(this.params.account_name)}`,
      bar: renderPaneTabsBar({
        avatarUrl: account?.gravatarUrl(48) || "",
        tabs,
      }),
    };
  }
}

export class AccountEditPage extends BasePage {
  getTitle() {
    return "Edit Your Profile";
  }

  getBodyClass() {
    return "accounts edit";
  }

  async renderContent() {
    const accountName = escapeHtml(this.params.account_name || "");
    return `
      <h1 id="content-title">Account Settings</h1>
      ${errorMessages()}
      <div id="account-settings-tabs" data-tabs>
        <ul>
          <li><a href="#account-profile">Profile</a></li>
          <li><a href="#account-password">Password</a></li>
          <li><a href="#account-settings">Settings</a></li>
          <li><a href="#account-repository">Prefixes</a></li>
          <li><a href="#account-admin">Admin</a></li>
        </ul>
        <div id="account-profile">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="string optional"><label>Your real name</label><input type="text" /></li>
                <li class="email optional"><label>Email</label><input type="email" /></li>
                <li class="url optional"><label>Homepage</label><input type="url" /></li>
                <li class="url optional"><label>Blog</label><input type="url" /></li>
                <li class="string optional"><label>Organization</label><input type="text" /></li>
                <li class="string optional"><label>Location</label><input type="text" /></li>
                <li class="string optional"><label>Phone</label><input type="text" /></li>
                <li class="string optional"><label>Skype ID</label><input type="text" /></li>
                <li class="string optional"><label>Jabber ID</label><input type="text" /></li>
                <li class="string optional">
                  <label>Avatar</label>
                  <div class="avatar clearfix">
                    <div class="image"><img src="https://secure.gravatar.com/avatar/00000000000000000000000000000000?s=48&d=mm" alt="avatar" /></div>
                    <div class="info">
                      Change your avatar at <a href="http://gravatar.com">Gravatar.com</a>
                      <div class="email">We are using user@example.com</div>
                    </div>
                  </div>
                </li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Save" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${accountName}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="account-password">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="password optional"><label>Password</label><input type="password" /></li>
                <li class="password optional"><label>Confirm Password</label><input type="password" /></li>
                <li class="password optional"><label>Current password</label><input type="password" /></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Save" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${accountName}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="account-settings">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="select optional"><label>Region</label><select><option>US-East</option></select></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Save" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${accountName}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="account-repository">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="text optional"><label>Default repository prefixes</label><textarea rows="7"></textarea></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Save" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${accountName}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
          <p><strong>The following prefixes are automatically included for all repositories.</strong></p>
          <pre>PREFIX foaf: &lt;http://xmlns.com/foaf/0.1/&gt;</pre>
        </div>
        <div id="account-admin">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="boolean optional"><label><input type="checkbox" /> Admin?</label></li>
                <li class="string optional"><label>Timeout</label><input type="text" /></li>
                <li class="string optional"><label>Host</label><input type="text" /></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Save" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${accountName}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
      </div>
    `;
  }

  async renderSidebar() {
    const accountName = escapeHtml(this.params.account_name || "");
    return `
      <div class="admin-links">
        <a class="inline-icon hover-state" href="${BASE_PATH}/account/${accountName}">
          <span class="icon icon-circle-arrow-w"></span><span class="text">Back to account</span>
        </a>
      </div>
      <h5>Want to delete your account?</h5>
      <p>Please <a href="mailto:support@dydra.com">contact support</a>.</p>
    `;
  }
}

export class AccountNewPage extends BasePage {
  getTitle() {
    return "Sign Up";
  }

  getBodyClass() {
    return "accounts new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">New Account</h1>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            <li class="string optional"><label>Username</label><input type="text" /></li>
            <li class="email optional"><label>Email</label><input type="email" /></li>
            <li class="password optional"><label>Password</label><input type="password" /></li>
            <li class="password optional"><label>Confirm Password</label><input type="password" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Create" /></li>
            <li class="cancel">or <a href="${BASE_PATH}/account">Cancel</a></li>
          </ol>
        </fieldset>
      </form>
    `;
  }
}

export class AccountAuthTokenPage extends BasePage {
  getBodyClass() {
    return "accounts auth_token";
  }

  async renderContent() {
    const account = await this.state.getAccount(this.params.account_name);
    return `
      <p>Your API Key is shown below. You will need this to access your account via the command line tools.</p>
      <textarea id="auth_token">${escapeHtml(account?.authenticationToken || "")}</textarea>
    `;
  }
}

export class RepositoriesIndexPage extends BasePage {
  getBodyClass() {
    return "repositories index";
  }

  async renderContent() {
    const repos = await this.state.listRepositories(this.params.account_name);
    if (!repos.length) {
      return `<h1 id="content-title">Repositories</h1><p>No repositories found.</p>`;
    }
    const grouped = repos.reduce((groups, repo) => {
      const key = repo.accountId || 0;
      if (!groups[key]) groups[key] = [];
      groups[key].push(repo);
      return groups;
    }, {});
    return `
      <h1 id="content-title">Repositories</h1>
      ${joinHtml(Object.values(grouped).map((group) => `
        <h3><a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name || "jhacker")}">${escapeHtml(this.params.account_name || "jhacker")}</a></h3>
        ${joinHtml(group.map((repo) => `
          <ul><li><a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name || "jhacker")}/repositories/${escapeHtml(repo.friendlyId)}">${escapeHtml(repo.name)}</a></li></ul>
        `))}
      `))}
    `;
  }
}

export class RepositoryRoute extends BasePage {
  getBodyClass() {
    return "repositories show";
  }

  async renderContent() {
    const { account_name, repository_name } = this.params;
    this.state.addOpenAccount(account_name);
    this.state.addOpenRepository(account_name, repository_name);
    const accountPanes = await buildAccountPanes(this.state);
    const repositoryPanes = await buildRepositoryPanes(this.state);
    const viewPanes = await buildViewPanes(this.state);
    // Login pane is available for additional account authentication, starts hidden
    return `
      <div id="tab-login" class="pane" style="display:none">${buildLoginContent(this.state)}</div>
      ${accountPanes.join("")}
      ${repositoryPanes.join("")}
      ${viewPanes.join("")}
    `;
  }

  async renderSidebar() {
    const { account_name, repository_name } = this.params;
    const repository = await this.state.getRepository(account_name, repository_name);
    // Try to get config from tracker first (if pane was already rendered), otherwise fetch it
    const tracker = this.state.getRepositoryTracker(account_name, repository_name);
    let config = tracker?.config;
    if (!config) {
      config = await fetchRepositoryConfig(this.state, account_name, repository_name);
    }
    const fields = [
      { label: "Homepage", value: config?.homepage || repository?.homepage, isLink: true },
      { label: "Description", value: config?.description || repository?.description },
      { label: "Abstract", value: config?.abstract },
      { label: "Privacy", value: config?.privacySetting || config?.privacy_setting },
      { label: "Permissible IPs", value: config?.permissible_ip_addresses },
      { label: "License", value: config?.license || repository?.license },
      { label: "Statements", value: repository?.quadCount ? `${repository.quadCount} triples` : "" },
      { label: "Size", value: repository?.diskSize },
    ].filter((field) => field.value);
    return `
      <div id="repository-stats" class="block">
        ${fields.length ? fields.map((field) => `
          <p class="field">
            <span class="label">${escapeHtml(field.label)}:</span>
            <span class="data">
              ${field.isLink ? `<a href="${escapeHtml(field.value)}">${escapeHtml(field.value)}</a>` : escapeHtml(String(field.value))}
            </span>
          </p>
        `).join("") : `<p>No repository metadata available.</p>`}
      </div>
    `;
  }

  async afterRender() {
    const app = this.context?.app;
    await setupInlineLogin(app);
    const paneList = Array.from(document.querySelectorAll(".repository-pane"));
    if (!paneList.length || typeof window.createSparqlEditor !== "function") {
      return;
    }
    paneList.forEach(async (pane) => {
      const accountName = pane.dataset.account;
      const repositoryName = pane.dataset.repository;
      if (!accountName || !repositoryName) return;
      const container = pane.querySelector(".view-editors-container");
      if (!container) return;
      const auth = this.state.getAuthContext(accountName);
      const sparqlEndpoint = `${auth?.host || window.location.origin}/${accountName}/${repositoryName}/sparql`;
      const accessToken = this.state.getAuthToken(accountName);
      
      // Map to track editors currently in this container (prevents duplicates within this container only)
      // Check DOM for existing editors and populate the map (in case we're re-initializing after tab switch)
      const openViews = new Map();
      const existingEditors = container.querySelectorAll(".view-editor");
      existingEditors.forEach((editor) => {
        const viewName = editor.dataset.viewName;
        if (viewName) {
          openViews.set(viewName, editor);
        }
      });
      
      const repoClass = pane.dataset.class || '';
      const revisionsEndpoint = /revisioned/i.test(repoClass)
        ? `${auth?.host || window.location.origin}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/revisions`
        : '';

      const createEditorPanel = async (view) => {
        // Ensure we always use just the base name for the view
        const baseViewName = ensureBaseViewName(view.friendlyId);
        if (openViews.has(view.friendlyId)) {
          const existing = openViews.get(view.friendlyId);
          existing.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "view-editor";
        wrapper.draggable = true;
        wrapper.dataset.viewName = baseViewName;

        const body = document.createElement("div");
        body.className = "view-editor-body";

        // Prevent drag from starting when interacting with editor content (textarea, CodeMirror)
        // Use dragstart event which is more reliable than mousedown for preventing unwanted drags
        wrapper.addEventListener("dragstart", (event) => {
          const target = event.target;
          // Only allow drag if it starts on the wrapper itself or its title bar
          // Cancel drag if it starts within editor content
          if (target.closest("textarea, .CodeMirror, .yasqe, .CodeMirror-scroll, .sparql-editor-content, input, select")) {
            event.preventDefault();
          }
        });

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        openViews.set(view.friendlyId, wrapper);

        const viewUrl = `${auth?.host || window.location.origin}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/views/${encodeURIComponent(baseViewName)}`;
        // Fetch view text based on queryText value:
        // - null: new view, don't fetch (use default)
        // - undefined: existing view, fetch it
        // - string: use provided value
        let viewText;
        if (view.queryText === null) {
          // New view - don't fetch
          viewText = null;
        } else if (view.queryText !== undefined) {
          // queryText was explicitly provided
          viewText = view.queryText;
        } else {
          // queryText is undefined - fetch it for existing view
          viewText = await fetchViewText({
          auth,
          accountName,
          repositoryName,
            viewName: baseViewName,
        });
        }
        const editorApi = window.createSparqlEditor({
          container: body,
          viewUrl,
          sparqlEndpoint,
          accessToken,
          accountName,
          repositoryName,
          repositoryClass: repoClass,
          revisionsEndpoint,
          viewName: baseViewName,
          sparql: viewText !== null ? (viewText || "SELECT * WHERE { ?s ?p ?o } LIMIT 10") : "SELECT * WHERE { ?s ?p ?o } LIMIT 10",
          options: {
            title: `/${accountName}/${repositoryName}/${baseViewName}`,
            initialState: "open",
            showEventLog: true,
            showEditorToggle: true,
            showMediaTypeSelector: true,
            showSaveButton: true,
            showResetButton: true,
            showCloseButton: true,
            onQueryBlur: (queryText) => {
              // Synchronize query text to all other editors for this view
              const otherEditors = findEditorsForView(app, accountName, repositoryName, baseViewName).filter(e => e !== editorApi);
              otherEditors.forEach((otherEditor) => {
                if (otherEditor && otherEditor.setQuery) {
                  try {
                    otherEditor.setQuery(queryText);
                  } catch (e) {
                    console.warn("[ViewEditor] Failed to synchronize query text:", e);
                  }
                }
              });
            },
            onClose: () => {
              openViews.delete(view.friendlyId);
              // Remove editor instance from map if app is available
              // Use a different key for repository pane editors to avoid conflicts with separate pane editors
              if (app && app.editorInstances) {
                const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
                app.editorInstances.delete(repoEditorId);
              }
              wrapper.remove();
            },
          },
        });
        
        // Store editor API instance if app is available
        // Use a different key for repository pane editors to avoid conflicts with separate pane editors
        if (app && app.editorInstances) {
          const repoEditorId = `repo-editor-${accountName.replace(/[^a-z0-9_-]/gi, "-")}-${repositoryName.replace(/[^a-z0-9_-]/gi, "-")}-${baseViewName.replace(/[^a-z0-9_-]/gi, "-")}`;
          app.editorInstances.set(repoEditorId, editorApi);
        }
      };

      const getDragAfterElement = (containerEl, y) => {
        const elements = [...containerEl.querySelectorAll(".view-editor:not(.dragging)")];
        return elements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
          }
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      };

      container.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = container.querySelector(".view-editor.dragging");
        if (!dragging) return;
        const afterElement = getDragAfterElement(container, event.clientY);
        if (!afterElement) {
          container.appendChild(dragging);
        } else {
          container.insertBefore(dragging, afterElement);
        }
      });

      container.addEventListener("dragstart", (event) => {
        const target = event.target.closest(".view-editor");
        if (!target) return;
        target.classList.add("dragging");
      });

      container.addEventListener("dragend", (event) => {
        const target = event.target.closest(".view-editor");
        if (!target) return;
        target.classList.remove("dragging");
      });

      const catalog = pane.querySelector(".query-catalog");
      if (catalog) {
        // Attach explicit handlers to all view buttons in existing entries
        // view-edit handlers
        const viewEditLinks = catalog.querySelectorAll(".view-edit");
        console.log("[RepositoryRoute] Found", viewEditLinks.length, "view-edit links in catalog", accountName, repositoryName);
        viewEditLinks.forEach((link) => {
          // Prevent duplicate handlers
          if (link.dataset.viewEditHandlerAttached === "true") {
            console.log("[RepositoryRoute] Handler already attached to view-edit link, skipping");
            return;
          }
          link.dataset.viewEditHandlerAttached = "true";
          console.log("[RepositoryRoute] Attaching handler to view-edit link", {
            viewName: link.dataset.viewName,
            text: link.textContent.trim()
          });
          link.addEventListener("click", async (event) => {
            console.log("[RepositoryRoute] view-edit link clicked", {
              viewName: link.dataset.viewName,
              target: event.target,
              currentTarget: event.currentTarget
            });
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const viewName = link.dataset.viewName;
            if (!viewName) {
              console.warn("[RepositoryRoute] view-edit clicked but no viewName in dataset");
            return;
          }
            // Create a minimal view object from the view name (similar to initializePaneEditing)
            // The view text will be fetched by createEditorPanel
            console.log("[RepositoryRoute] Creating editor panel for view:", viewName);
            const view = {
              friendlyId: viewName,
              name: link.textContent.trim(),
              // Don't set queryText - let createEditorPanel fetch it for existing views
            };
            await createEditorPanel(view);
            console.log("[RepositoryRoute] Editor panel created");
          }, true);
        });

        // view-pane-btn handlers
        catalog.querySelectorAll(".view-pane-btn:not([data-handler-bound])").forEach((btn) => {
          btn.dataset.handlerBound = "true";
          btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const viewAcct = btn.dataset.account;
            const viewRepo = btn.dataset.repository;
            const viewName = btn.dataset.view;
            if (!viewAcct || !viewRepo || !viewName) return;
            await openViewPane(this.context?.app, viewAcct, viewRepo, viewName);
          }, true);
        });

        // view-window-button handlers
        catalog.querySelectorAll(".view-window-button:not([data-handler-bound])").forEach((btn) => {
          btn.dataset.handlerBound = "true";
          btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const viewName = btn.dataset.view;
            if (!viewName) return;
            const auth = this.state.getAuthContext(accountName);
            const host = auth?.host || window.location.origin;
            const accessToken = this.state.getAuthToken(accountName);
            const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(viewName)}.html`;
            
            try {
              const response = await fetch(viewHtmlUrl, {
                headers: {
                  'Accept': 'text/html',
                  'Authorization': `Bearer ${accessToken}`
                }
              });
              
              if (!response.ok) {
                const errorText = await getResponseText(response);
                alert(`Failed to load view: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
            return;
          }
              
              const htmlContent = await response.text();
              const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
              if (newWindow) {
                newWindow.document.title = `Dydra View: ${accountName}/${repositoryName}/${viewName}`;
                newWindow.document.write(htmlContent);
                newWindow.document.close();
                newWindow.focus();
              } else {
                alert("Popup blocked. Please allow popups for this site to open view in new window.");
              }
            } catch (error) {
              let errorMessage = error.message;
              // If error has a response, try to get its text
              if (error.response) {
                try {
                  const errorText = await getResponseText(error.response);
                  errorMessage += errorText ? ` - ${errorText}` : "";
                } catch (e) {
                  // Ignore errors reading response
                }
              }
              alert(`Failed to load view: ${errorMessage}`);
            }
          }, true);
        });

        // view-delete-btn handlers
        catalog.querySelectorAll(".view-delete-btn:not([data-handler-bound])").forEach((btn) => {
          btn.dataset.handlerBound = "true";
          btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const viewAcct = btn.dataset.account;
            const viewRepo = btn.dataset.repository;
            const viewName = btn.dataset.view;
            if (!viewAcct || !viewRepo || !viewName) return;
            await handleViewDelete(this.context?.app, viewAcct, viewRepo, viewName, btn);
          }, true);
        });

        const newBtn = catalog.querySelector(".view-new-btn:not([data-handler-bound])");
        if (newBtn) {
          newBtn.dataset.handlerBound = "true";
          newBtn.addEventListener("click", () => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;";
            dialog.innerHTML = `
              <h3 style="margin:0 0 12px 0;">New View</h3>
              <input type="text" placeholder="View name" style="width:100%;padding:6px;box-sizing:border-box;font-size:14px;" />
              <div style="margin-top:12px;text-align:right;">
                <button class="new-view-cancel" style="padding:6px 12px;margin-right:8px;cursor:pointer;">Cancel</button>
                <button class="new-view-ok" style="padding:6px 12px;cursor:pointer;">Create</button>
              </div>
            `;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            const input = dialog.querySelector("input");
            const okBtn = dialog.querySelector(".new-view-ok");
            const cancelBtn = dialog.querySelector(".new-view-cancel");
            input.focus();

            // Add error message element to dialog
            const errorDiv = document.createElement("div");
            errorDiv.style.cssText = "color: #dc3545; font-size: 12px; margin-top: 8px; display: none;";
            dialog.querySelector("h3").after(errorDiv);

            const close = () => overlay.remove();
            cancelBtn.addEventListener("click", close);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
            const submit = async () => {
              const name = input.value.trim();
              if (!name) return;

              const queryContainer = catalog.querySelector(".query-container");
              if (!queryContainer) {
                close();
                return;
              }

              // Check if view already exists
              const existingViews = await fetchRepositoryViews(this.state, accountName, repositoryName);
              const existingView = existingViews.find(v => v.name === name || v.friendlyId === name || ensureBaseViewName(v.friendlyId) === name);
              if (existingView) {
                errorDiv.textContent = `View "${name}" already exists.`;
                errorDiv.style.display = "block";
                // Close dialog after a brief delay and open existing view in editor
                setTimeout(() => {
                  close();
                  // Open the existing view - click on the view-edit link
                  const viewEditLink = queryContainer.querySelector(`.view-edit[data-view-name="${escapeHtml(name)}"]`);
                  if (viewEditLink) {
                    viewEditLink.click();
                  }
                }, 1500);
                return;
              }

              const placeholder = queryContainer.querySelector("p");
              if (placeholder) placeholder.closest(".query")?.remove();
              const entry = document.createElement("div");
              entry.className = "query";
              const host = auth?.host || window.location.origin;
              entry.innerHTML = `
                <a class="view-edit" data-view-name="${escapeHtml(name)}" data-action="open-view" href="#">${escapeHtml(name)}</a>
                <span style="float: right; display: flex; align-items: center; gap: 4px;">
                  <span class="owner"> <a href="${BASE_PATH}/account/${encodeURIComponent(accountName)}">${escapeHtml(accountName)}</a> </span>
                  <button type="button" class="view-pane-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" style="
                    background: transparent;
                    border: none;
                    padding: 2px;
                    cursor: pointer;"
                    title="Open view in new pane">
                    <img src="${BASE_PATH}/images/folder-plus.svg" alt="Edit Pane" style="width: 16px; height: 16px; opacity: 0.6;" />
                  </button>
                  <button type="button" class="view-window-button" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" style="
                    background: transparent;
                    border: none;
                    padding: 2px;
                    cursor: pointer;
                  " title="Open view results in new window">
                    <img src="${BASE_PATH}/images/link.svg" alt="Open in window" style="width: 16px; height: 16px; opacity: 0.6;" />
                  </button>
                  <button type="button" class="view-delete-btn" data-account="${escapeHtml(accountName)}" data-repository="${escapeHtml(repositoryName)}" data-view="${escapeHtml(name)}" style="
                    background: transparent;
                    border: none;
                    padding: 2px;
                    cursor: pointer;
                  " title="Delete View">
                    <img src="${BASE_PATH}/images/trash.svg" alt="Delete" style="width: 16px; height: 16px; opacity: 0.6;" />
                  </button>
                </span>
              `;
              const entries = Array.from(queryContainer.querySelectorAll(".query"));
              const insertBefore = entries.find((el) => {
                const l = el.querySelector(".view-edit");
                return l && l.textContent.trim().localeCompare(name) > 0;
              });
              if (insertBefore) {
                queryContainer.insertBefore(entry, insertBefore);
              } else {
                queryContainer.appendChild(entry);
              }
              queryContainer.querySelectorAll(".query").forEach((el, i) => {
                el.className = `query ${i % 2 === 0 ? "even" : "odd"}`;
              });
              
              // Attach handlers for the new entry - all explicit handlers
              // Attach view-edit handler
              const editLink = entry.querySelector(".view-edit");
              if (editLink) {
                // Prevent duplicate handlers
                if (editLink.dataset.viewEditHandlerAttached === "true") {
                  console.log("[RepositoryRoute] Handler already attached to dynamically created view-edit link, skipping");
                } else {
                  editLink.dataset.viewEditHandlerAttached = "true";
                  editLink.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  const viewName = editLink.dataset.viewName;
                  if (!viewName) return;
                  // Create a minimal view object from the view name (similar to initializePaneEditing)
                  // The view text will be fetched by createEditorPanel
                  const view = {
                    friendlyId: viewName,
                    name: editLink.textContent.trim(),
                    queryText: null,
                  };
                  await createEditorPanel(view);
                  }, true);
                }
              }
              
              // Attach view-pane-btn handler
              const paneBtn = entry.querySelector(".view-pane-btn");
              if (paneBtn) {
                paneBtn.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  const app = this.context?.app;
                  if (app) {
                    await openViewPane(app, accountName, repositoryName, name);
                  }
                }, true);
              }
              
              // Attach view-window-button handler
              const windowBtn = entry.querySelector(".view-window-button");
              if (windowBtn) {
                windowBtn.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(name)}.html`;
                  
                  try {
                    const response = await fetch(viewHtmlUrl, {
                      headers: {
                        'Accept': 'text/html',
                        'Authorization': `Bearer ${accessToken}`
                      }
                    });
                    
                    if (!response.ok) {
                      const errorText = await getResponseText(response);
                      alert(`Failed to load view: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
                      return;
                    }
                    
                    const htmlContent = await response.text();
                    const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
                    if (newWindow) {
                      newWindow.document.title = `Dydra View: ${accountName}/${repositoryName}/${name}`;
                      newWindow.document.write(htmlContent);
                      newWindow.document.close();
                      newWindow.focus();
                    } else {
                      alert("Popup blocked. Please allow popups for this site to open view in new window.");
                    }
                  } catch (error) {
                    let errorMessage = error.message;
                    // If error has a response, try to get its text
                    if (error.response) {
                      try {
                        const errorText = await getResponseText(error.response);
                        errorMessage += errorText ? ` - ${errorText}` : "";
                      } catch (e) {
                        // Ignore errors reading response
                      }
                    }
                    alert(`Failed to load view: ${errorMessage}`);
                  }
                }, true);
              }
              
              // Attach view-delete-btn handler
              const deleteBtn = entry.querySelector(".view-delete-btn");
              if (deleteBtn) {
                deleteBtn.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  await handleViewDelete(this.context?.app, accountName, repositoryName, name, deleteBtn);
                }, true);
              }
              
              const editorBtn = entry.querySelector(".view-editor-btn");
              if (editorBtn) {
                editorBtn.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const viewHtmlUrl = `${host}/${encodeURIComponent(accountName)}/${encodeURIComponent(repositoryName)}/${encodeURIComponent(name)}.html`;
                  window.open(viewHtmlUrl, '_blank');
                });
              }
              
              // Close dialog
              close();
              
              // Show confirmation popup indicating the view needs to be edited and saved
              const confirmOverlay = document.createElement("div");
              confirmOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;";
              const confirmDialog = document.createElement("div");
              confirmDialog.style.cssText = "background:#fff;border-radius:6px;padding:20px;min-width:300px;max-width:500px;";
              confirmDialog.innerHTML = `
                <h3 style="margin:0 0 12px 0;">View Created</h3>
                <p style="margin:0 0 16px 0;line-height:1.5;">The view "${escapeHtml(name)}" has been created. Please edit the query text and save it to persist the view.</p>
                <div style="text-align:right;">
                  <button class="view-created-ok" data-testid="view-created-ok-btn" style="padding:6px 12px;cursor:pointer;">OK</button>
                </div>
              `;
              confirmOverlay.appendChild(confirmDialog);
              document.body.appendChild(confirmOverlay);
              
              const confirmOkBtn = confirmDialog.querySelector(".view-created-ok");
              const closeConfirm = () => confirmOverlay.remove();
              confirmOkBtn.addEventListener("click", closeConfirm);
              confirmOverlay.addEventListener("click", (e) => { if (e.target === confirmOverlay) closeConfirm(); });
              confirmOkBtn.focus();
              
              // Create editor panel with null queryText to indicate it's a new view (don't fetch)
              // Ensure name is just the base name (should already be, but be defensive)
              const baseName = ensureBaseViewName(name);
              await createEditorPanel({ friendlyId: baseName, name: baseName, queryText: null });
            };
            okBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.stopPropagation(); submit(); }
              if (e.key === "Escape") close();
            });
          });
        }
      }

      // Pane-level revision selector for execute links
      const paneRevSelect = pane.querySelector('.pane-revision-select');
      if (paneRevSelect) {
        let paneRevsLoaded = false;
        const loadPaneRevisions = () => {
          if (paneRevsLoaded) return;
          paneRevsLoaded = true;
          const revAcct = paneRevSelect.dataset.account;
          const revRepo = paneRevSelect.dataset.repository;
          const revAuth = this.state.getAuthContext(revAcct);
          if (!revAuth?.token || !revAuth?.host) return;
          const revEndpoint = `${revAuth.host}/system/accounts/${encodeURIComponent(revAcct)}/repositories/${encodeURIComponent(revRepo)}/revisions`;
          fetch(revEndpoint, {
            headers: { 'Accept': 'text/plain', 'Authorization': `Bearer ${revAuth.token}` }
          })
          .then(r => r.ok ? r.text() : Promise.reject('Failed'))
          .then(text => {
            text.trim().split('\n').filter(Boolean).forEach(rev => {
              const opt = document.createElement('option');
              opt.value = rev.trim();
              opt.textContent = rev.trim();
              paneRevSelect.appendChild(opt);
            });
          })
          .catch(err => console.warn('Could not load pane revisions:', err));
        };
        paneRevSelect.addEventListener('mousedown', loadPaneRevisions);
        paneRevSelect.addEventListener('focus', loadPaneRevisions);

        paneRevSelect.addEventListener('change', () => {
          const selectedRev = paneRevSelect.value;
          pane.querySelectorAll('a[data-external]').forEach(link => {
            const baseUrl = link.href.split('?')[0];
            link.href = selectedRev === 'HEAD' ? baseUrl : baseUrl + '?revision=' + encodeURIComponent(selectedRev);
          });
        });
      }
    });

    const gutter = document.getElementById("sidebar-gutter");
    const aside = document.getElementById("aside");
    if (gutter && aside) {
      let startX = 0;
      let startWidth = 0;
      const onMove = (event) => {
        const delta = event.clientX - startX;
        const newWidth = Math.max(180, Math.min(420, startWidth - delta));
        aside.style.width = `${newWidth}px`;
      };
      const onUp = () => {
        gutter.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      gutter.addEventListener("mousedown", (event) => {
        startX = event.clientX;
        startWidth = aside.getBoundingClientRect().width;
        gutter.classList.add("dragging");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
    initializeViewPanes(app);
  }

  async getPaneTabs() {
    const { account_name, repository_name } = this.params;
    const account = await this.state.getAccount(account_name);
    const repository = await this.state.getRepository(account_name, repository_name);
    const accountLabel = escapeHtml(account?.friendlyId || account_name);
    const repositoryLabel = escapeHtml(repository?.friendlyId || repository_name);
    const accountPath = encodeURIComponent(account_name);
    const repositoryPath = encodeURIComponent(repository_name);
    this.state.addOpenAccount(account_name);
    this.state.addOpenRepository(account_name, repository_name);
    const tabs = await buildGlobalTabs(this.state, { includeInfo: false });
    return {
      defaultTab: `#${paneIdRepository(account_name, repository_name)}`,
      bar: renderPaneTabsBar({
        tabs,
      }),
    };
  }
}

export class RepositoryEditPage extends BasePage {
  getTitle() {
    return `Edit ${this.params.account_name}/${this.params.repository_name}`;
  }

  getBodyClass() {
    return "repositories edit";
  }

  async renderContent() {
    return `
      <h1 id="content-title">
        <span id="account-name">
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}">${escapeHtml(this.params.account_name)}</a> /
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">${escapeHtml(this.params.repository_name)}</a>
        </span>
      </h1>
      ${errorMessages()}
      <div id="repository-settings-tabs" data-tabs>
        <ul>
          <li><a href="#repository-settings">About</a></li>
          <li><a href="#repository-privacy">Privacy</a></li>
          <li><a href="#repository-prefixes">Prefixes</a></li>
          <li><a href="#repository-collaborators">Collaborators</a></li>
        </ul>
        <div id="repository-settings">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="string optional"><label>Name</label><input type="text" /></li>
                <li class="url optional"><label>Homepage</label><input type="url" /></li>
                <li class="text optional"><label>Summary</label><textarea rows="2"></textarea></li>
                <li class="text optional"><label>Description</label><textarea rows="15"></textarea></li>
                <li class="select optional"><label>License</label><select><option>Unspecified</option></select></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Update" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="repository-privacy">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="radio optional"><label>Permissions</label><div class="radio-option"><input type="radio" /> Public</div></li>
                <li class="text optional"><label>&nbsp;</label><textarea rows="2" placeholder="List one IP address per line"></textarea></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Update" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="repository-prefixes">
          <form class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="text optional"><label>Default repository prefixes</label><textarea rows="7"></textarea></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Update" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
          <p><strong>The following prefixes are automatically included for all repositories.</strong></p>
          <pre>PREFIX foaf: &lt;http://xmlns.com/foaf/0.1/&gt;</pre>
        </div>
        <div id="repository-collaborators">
          <table id="repository_collaborations" class="admin">
            <thead>
              <tr>
                <th>Account Name</th>
                <th align="center">Read</th>
                <th align="center">Write</th>
                <th>&nbsp;</th>
              </tr>
            </thead>
            <tbody id="collaboration_list">
              <tr id="no_collaborators_msg">
                <td colspan="4"><em>No collaborators found for this repository.</em></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td><input type="text" id="new_collaboration_account_name" size="35" /></td>
                <td align="center"><input type="checkbox" id="new_collaboration_read" /></td>
                <td align="center"><input type="checkbox" id="new_collaboration_write" /></td>
                <td align="center"><input type="submit" value="Add" id="add_collaboration" /></td>
              </tr>
            </tfoot>
          </table>
          <p class="collaborator_instructions"><em><small>You can add collaborators to this repository using the form above.</small></em></p>
        </div>
      </div>
    `;
  }

  async renderSidebar() {
    return `
      <div class="admin-links">
        <a class="inline-icon hover-state" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">
          <span class="icon icon-circle-arrow-w"></span><span class="text">Back to repository</span>
        </a>
      </div>
      <p>Or you can <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">delete this repository.</a></p>
    `;
  }
}

export class RepositoryImportPage extends BasePage {
  getBodyClass() {
    return "repository_imports new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">
        <span id="account-name">
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}">${escapeHtml(this.params.account_name)}</a> /
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">${escapeHtml(this.params.repository_name)}</a>
        </span>
      </h1>
      <h4 class="repository-import-ask-how">Import Your Data</h4>
      <div id="repository-import-tabs" data-tabs>
        <ul>
          <li><a href="#repository-import-download">Import RDF from the web</a></li>
          <li><a href="#repository-import-upload">Upload a local file</a></li>
          <li><a href="#repository-import-download-hdt">Import HDT from the web</a></li>
        </ul>
        <div id="repository-import-download" title="Import an existing file">
          <form id="repository-import-download-form" class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="string required"><label>Please provide the URL where we can fetch your data</label><input type="text" /></li>
                <li class="string optional"><label>Specify an optional base URI for this data</label><input type="text" /></li>
                <li class="string optional"><label>Specify an optional MIME content type for your data</label><input type="text" disabled /></li>
                <li class="radio optional">
                  <fieldset>
                    <legend class="label"><label>Enter a context for this repository <abbr title="required">*</abbr></label></legend>
                    <ol>
                      <li><label><input type="radio" checked /> None</label></li>
                      <li><label><input type="radio" /> Same as Import URL</label></li>
                      <li><label><input type="radio" /> Custom</label></li>
                    </ol>
                  </fieldset>
                </li>
                <li id="repository-import-download-context-wrapper" class="string" style="display:none;">
                  <label>Custom repository context</label><input type="text" />
                </li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Import" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
        <div id="repository-import-upload">
          <form id="repository-import-upload-form" class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="file required"><label>Please select the file you would like to import.</label><input type="file" /></li>
                <li class="string required"><label>Specify the base URI to use for this import (required).</label><input type="text" /></li>
                <li class="string optional"><label>Enter an optional context for this repository</label><input type="text" /></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Import" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
            <div id="wait-msg" style="display:none;">
              <h4><img src="/images/form-loading.gif" alt="loading" /> Please wait. Your file is being uploaded.</h4>
              <p>This could take a while depending on the size of the file.</p>
            </div>
          </form>
        </div>
        <div id="repository-import-download-hdt" title="Import an HDT file from the web">
          <form id="repository-hdt-download-form" class="formtastic" onsubmit="return false;">
            <fieldset class="inputs">
              <ol>
                <li class="string required"><label>Please provide the URL where we can fetch your data</label><input type="text" /></li>
                <li class="string optional"><label>Specify an optional base URI for this data</label><input type="text" /></li>
                <li class="string optional"><label>Specify an optional MIME content type for your data</label><input type="text" disabled /></li>
              </ol>
            </fieldset>
            <fieldset class="buttons">
              <ol>
                <li class="commit"><input type="submit" value="Import" /></li>
                <li class="cancel">or <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">Cancel</a></li>
              </ol>
            </fieldset>
          </form>
        </div>
      </div>
      <iframe id="upload_target" name="upload_target" style="display:none;"></iframe>
    `;
  }

  async renderSidebar() {
    return `
      <div class="admin-links">
        <a class="inline-icon hover-state" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">
          <span class="icon icon-circle-arrow-w"></span><span class="text">Back to repository</span>
        </a>
      </div>
      <h4>Importing data</h4>
      <p>You can import your data in one of two ways.</p>
      <ol>
        <li><strong>Fetch from the web</strong><br />If your data is already published on the web in RDF form, just provide us with the URL.</li>
        <li><strong>Upload a local file</strong><br />If you have a copy of your data stored locally, you can upload it to our servers.</li>
      </ol>
      <h4>Supported file formats</h4>
      <ul>
        <li>Turtle (<strong>.ttl</strong>)</li>
        <li>N-Triples (<strong>.nt</strong>)</li>
        <li>N-Quads (<strong>.nq</strong>)</li>
        <li>RDF/JSON (<strong>.rj</strong>)</li>
        <li>RDF/XML (<strong>.rdf</strong>, <strong>.owl</strong>)</li>
        <li>RDFa (<strong>.html</strong>)</li>
      </ul>
      <p>Please note that the Notation3 (<strong>.n3</strong>) format is <strong>not</strong> supported at this time.</p>
    `;
  }
}

export class SparqlPage extends BasePage {
  getTitle() {
    return `SPARQL browser for ${this.params.repository_name}`;
  }

  getBodyClass() {
    return "sparql index";
  }

  async renderContent() {
    return `
      <h1 id="content-title">
        <span id="account-name">
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}">${escapeHtml(this.params.account_name)}</a> /
          <a href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">${escapeHtml(this.params.repository_name)}</a>
        </span>
      </h1>
      <div id="query-editor-loading">
        <img src="/images/loading.gif" alt="loading" /> Loading...
      </div>
      <div id="query-editor" style="display:none;">
        <div id="layout-main" class="layout-center">
          <div id="query-form" class="layout-north">
            <div class="layout-north">
              <h2>
                <div class="action-bar">
                  <button id="run"><span class="icon icon-play"></span><span class="text">Run</span></button>
                  <button id="save"><span class="icon icon-disk"></span><span class="text">Save</span></button>
                  <button id="save-as"><span class="icon icon-disk"></span><span class="text">Save as</span></button>
                  <button id="clear"><span class="icon icon-trash"></span><span class="text">Clear</span></button>
                </div>
                Name:&nbsp;<input id="query-title" value="Untitled View *" />
              </h2>
            </div>
            <div id="query-text" class="layout-center" tabindex="0"></div>
          </div>
          <div id="query-name-form" style="display:none;">
            <input type="text" id="new-query-name" />
          </div>
          <div id="query-results" class="layout-center"></div>
        </div>
        <div id="side-panel" class="layout-west">
          <div id="side-panel-accordion">
            <h3>
              <span class="action-bar"><button id="new"><span class="icon icon-plusthick"></span></button></span>
              <a href="#">Views</a>
            </h3>
            <div id="saved-queries-wrapper"><div id="query-list"></div></div>
            <h3>
              <span class="action-bar"><button id="prefix-help"><span class="icon icon-help"></span></button></span>
              <a href="#">Default Prefixes</a>
            </h3>
            <div id="default-prefixes-wrapper">
              <table>
                <tr><td class="prefix odd"><strong>foaf</strong>:</td><td>http://xmlns.com/foaf/0.1/</td></tr>
                <tr><td class="prefix even"><strong>rdf</strong>:</td><td>http://www.w3.org/1999/02/22-rdf-syntax-ns#</td></tr>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div id="default-prefixes-help" title="Default Prefixes" style="display:none;">
        <p>Default prefixes are automatically available to you without having to explicitly define them in your query.</p>
        <p><a href="http://${APP_CONFIG.docsHost}/prefixes">Learn more about default prefixes here.</a></p>
      </div>
    `;
  }

  async renderSidebar() {
    return `
      <div class="admin-links">
        <a class="button query-logs" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}/query_logs">Query Log</a>
        <a class="inline-icon hover-state" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}">
          <span class="icon icon-circle-arrow-w"></span><span class="text">Back to repository</span>
        </a>
      </div>
    `;
  }
}

export class ViewRoute extends BasePage {
  getBodyClass() {
    return "queries show";
  }

  async renderContent() {
    const viewName = this.params.view_name || this.params.query_name || "";
    const accountName = this.params.account_name;
    const repositoryName = this.params.repository_name;
    
    // Add the view to open views state
    this.state.addOpenView(accountName, repositoryName, viewName);
    
    // Build panes including view panes
    const accountPanes = await buildAccountPanes(this.state);
    const repositoryPanes = await buildRepositoryPanes(this.state);
    const viewPanes = await buildViewPanes(this.state);
    const loginContent = buildLoginContent(this.state);
    
    // Login pane is available for additional account authentication, starts hidden
    return `
      <div id="tab-login" class="pane" style="display:none">${loginContent}</div>
      ${accountPanes.join("")}
      ${repositoryPanes.join("")}
      ${viewPanes.join("")}
    `;
  }
  
  async getPaneTabs() {
    const { account_name, repository_name, view_name } = this.params;
    const viewName = view_name || this.params.query_name || "";
    const account = await this.state.getAccount(account_name);
    const repository = await this.state.getRepository(account_name, repository_name);
    const accountLabel = escapeHtml(account?.friendlyId || account_name);
    const repositoryLabel = escapeHtml(repository?.friendlyId || repository_name);
    const accountPath = encodeURIComponent(account_name);
    const repositoryPath = encodeURIComponent(repository_name);
    
    // Add to open state
    this.state.addOpenAccount(account_name);
    this.state.addOpenRepository(account_name, repository_name);
    this.state.addOpenView(account_name, repository_name, viewName);
    
    const tabs = await buildGlobalTabs(this.state, { includeInfo: false });
    return {
      defaultTab: `#${paneIdView(account_name, repository_name, viewName)}`,
      bar: renderPaneTabsBar({
        tabs,
        avatarUrl: account?.gravatarUrl(48) || "",
      }),
    };
  }

  async renderSidebar() {
    const viewName = this.params.view_name || this.params.query_name || "";
    return `
      <div class="admin-links">
        <a class="button" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}/views/${escapeHtml(viewName)}/edit">Edit</a>
        <a class="button execute done" href="${BASE_PATH}/account/${escapeHtml(this.params.account_name)}/repositories/${escapeHtml(this.params.repository_name)}/views/${escapeHtml(viewName)}/execute" id="job-execution-link">Execute</a>
      </div>
    `;
  }

  async afterRender() {
    const app = this.context?.app;
    if (!app) return;

    // Initialize login form handler
    await setupInlineLogin(app);
    
    // Initialize view panes (which will create the SPARQL editor in the view pane)
    await initializeViewPanes(app);
    
    // Also initialize account sidebar handlers and pane editing for repository panes
    attachAccountSidebarHandlers(app);
    initializePaneEditing(app);
  }
}

export class InvitationsNewPage extends BasePage {
  getBodyClass() {
    return "invitations new";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Beta Invite Request</h1>
      <p>Dydra is currently in closed beta testing. If you would like to participate in our beta program, please submit your email address below and we'll let you know when we are ready for new users.</p>
      ${errorMessages()}
      <form class="formtastic" onsubmit="return false;">
        <fieldset class="inputs">
          <ol>
            <li class="email optional"><label>Email address</label><input type="email" name="email" /></li>
          </ol>
        </fieldset>
        <fieldset class="buttons">
          <ol>
            <li class="commit"><input type="submit" value="Sign up!" /></li>
          </ol>
        </fieldset>
      </form>
    `;
  }

  async renderSidebar() {
    return `
      <h5>Already have an invite code?</h5>
      <p><a href="/signup">Sign up</a> now.</p>
    `;
  }
}

export class InvitationsSuccessPage extends BasePage {
  getBodyClass() {
    return "invitations success";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Thank you!</h1>
      <p>We have received your account request. Your will hear from us shortly as to how to proceed.</p>
      <p>Please note that requests from providers known to be spam relays will be discarded without consideration.</p>
    `;
  }
}

export class InvitationsIndexPage extends BasePage {
  getBodyClass() {
    return "invitations index no-aside";
  }

  async renderContent() {
    const invitations = await this.state.listInvitations();
    return `
      <h1 id="content-title">Invite Requests</h1>
      <div class="pagination_top"></div>
      <table class="admin">
        <colgroup>
          <col />
          <col width="200px" />
          <col width="80px" />
          <col width="160px" />
          <col width="150px" />
        </colgroup>
        <tr>
          <th>Email</th>
          <th>Referred Via</th>
          <th>Invite Code</th>
          <th>Account</th>
          <th>&nbsp;</th>
        </tr>
        ${joinHtml(invitations.map((invitation, index) => `
          <tr class="${index % 2 === 0 ? "even" : "odd"}">
            <td>${escapeHtml(invitation.email)}</td>
            <td>${escapeHtml(invitation.httpReferrer)}</td>
            <td>${escapeHtml(invitation.inviteCode)}</td>
            <td>${invitation.accountName ? `<a href="/${escapeHtml(invitation.accountName)}">${escapeHtml(invitation.accountName)}</a>` : ""}</td>
            <td class="actions"><a href="#">Send Invite</a> | <a href="#">Delete</a></td>
          </tr>
        `))}
      </table>
      <div class="pagination_bottom"></div>
    `;
  }

  async renderSidebar() {
    return `
      <div class="admin-links">
        <span class="total">Total Invites: <strong>1</strong></span>
      </div>
    `;
  }
}

export class MaintenancePage extends BasePage {
  getBodyClass() {
    return "application maintenance";
  }

  async renderContent() {
    return `
      <div class="skinny-column content">
        <div class="form-wrapper">
          <h2>Sorry! We're doing some routine maintenance.</h2>
          <p>We apologize for the inconvenience. We should be back online shortly.</p>
        </div>
      </div>
    `;
  }
}

export class RpcTestPage extends BasePage {
  getBodyClass() {
    return "application rpc_test";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Test JSON RPC 2.0 Interface</h1>
      <div>
        <textarea id="toRun" cols="75" rows="12">$.jsonRPC.request('test', null, {
  success: function(result) {
    console.log(result);
  },
  failure: function(result) {
    console.log(result);
  }
});</textarea>
      </div>
      <button onclick="void 0">Run!</button>
    `;
  }
}

export class RepositoryQueryLogsPage extends BasePage {
  constructor(options) {
    super(options);
    this.sort = { column: "timestamp", ascending: false };
  }

  getTitle() {
    const { account_name, repository_name } = this.params;
    return `Query History - ${account_name}/${repository_name}`;
  }

  getBodyClass() {
    return "application repositories query_logs";
  }

  async renderContent() {
    const accountName = this.params.account_name;
    const repositoryName = this.params.repository_name;
    if (!accountName || !repositoryName) return "<p>Missing account or repository.</p>";

    const auth = this.state.getAuthContext(accountName);
    if (!auth?.token || !auth?.host) return "<p>Not authenticated.</p>";

    let entries = [];
    try {
      const url = `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}/service_history?_=${Date.now()}`;
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
          entries = Array.isArray(data) ? data : (data.data || []);
        }
      }
    } catch (e) { /* ignore */ }

    // Sort entries
    const { column, ascending } = this.sort;
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

    const sortIndicator = (col) => {
      if (this.sort.column !== col) return "";
      return this.sort.ascending ? " \u25B2" : " \u25BC";
    };

    return `
      <h1>${escapeHtml(accountName)}/${escapeHtml(repositoryName)} - Query History</h1>
      <div class="scrollable-list" style="max-height:600px;overflow-y:auto;border:1px solid #ccc;">
        <table class="admin" style="width:100%;">
          <thead style="position:sticky;top:0;background:#eee;z-index:1;">
            <tr>
              <th class="ql-sortable" data-sort-col="timestamp" style="cursor:pointer;">Timestamp${sortIndicator("timestamp")}</th>
              <th class="ql-sortable" data-sort-col="elapsed_time" style="cursor:pointer;">Elapsed${sortIndicator("elapsed_time")}</th>
              <th class="ql-sortable" data-sort-col="run_time" style="cursor:pointer;">Run Time${sortIndicator("run_time")}</th>
              <th class="ql-sortable" data-sort-col="signature" style="cursor:pointer;">Signature${sortIndicator("signature")}</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry, i) => `
              <tr class="${i % 2 === 0 ? "even" : "odd"}">
                <td>${escapeHtml(String(entry.timestamp || ""))}</td>
                <td style="text-align:right;">${escapeHtml(String(entry.elapsed_time ?? ""))}</td>
                <td style="text-align:right;">${escapeHtml(String(entry.run_time ?? ""))}</td>
                <td style="font-family:monospace;font-size:11px;">${escapeHtml(String(entry.signature || ""))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${entries.length === 0 ? "<p>No query history data available.</p>" : ""}
    `;
  }

  async afterRender() {
    const page = this;
    document.querySelectorAll(".ql-sortable").forEach((th) => {
      th.addEventListener("click", async () => {
        const col = th.dataset.sortCol;
        if (page.sort.column === col) {
          page.sort.ascending = !page.sort.ascending;
        } else {
          page.sort.column = col;
          page.sort.ascending = true;
        }
        const app = page.context?.app;
        if (app) await app.renderPage(page);
      });
    });
  }
}

export class TemplatePage extends BasePage {
  getBodyClass() {
    return "application template";
  }

  async renderContent() {
    return `
      [INSERT CONTENT HERE]
    `;
  }

  async renderSidebar() {
    return `[INSERT SIDEBAR CONTENT HERE]`;
  }
}

export class StandaloneEditorPage extends BasePage {
  getBodyClass() {
    return "standalone-editor";
  }

  getTitle() {
    return "SPARQL Editor";
  }

  async renderContent() {
    return `
      <div id="standalone-editor-container" style="width: 100%; height: 100vh; padding: 20px; box-sizing: border-box;">
        <div id="sparql-editor-standalone"></div>
      </div>
    `;
  }

  async renderSidebar() {
    return ""; // No sidebar for standalone editor
  }

  async getPaneTabs() {
    return null; // No tabs bar for standalone editor
  }

  async afterRender() {
    // Extract data from URL hash
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const sessionId = params.get("sessionId");
    const token = params.get("token");

    if (!sessionId) {
      document.getElementById("sparql-editor-standalone").innerHTML = 
        "<p style='color: red;'>Error: No session ID provided.</p>";
      return;
    }

    // Read data from sessionStorage
    let editorData;
    try {
      const storedData = sessionStorage.getItem(`editor-session-${sessionId}`);
      if (!storedData) {
        document.getElementById("sparql-editor-standalone").innerHTML = 
          "<p style='color: red;'>Error: Session data not found. The data may have expired.</p>";
        return;
      }
      editorData = JSON.parse(storedData);
    } catch (e) {
      console.error("[StandaloneEditor] Failed to parse session data:", e);
      document.getElementById("sparql-editor-standalone").innerHTML = 
        "<p style='color: red;'>Error: Failed to load editor data.</p>";
      return;
    }

    // Use token from URL if provided, otherwise use token from stored data
    const accessToken = token ? decodeURIComponent(token) : editorData.accessToken;

    if (!accessToken) {
      document.getElementById("sparql-editor-standalone").innerHTML = 
        "<p style='color: red;'>Error: No authentication token provided.</p>";
      return;
    }

    // Clean up sessionStorage
    try {
      sessionStorage.removeItem(`editor-session-${sessionId}`);
    } catch (e) {
      console.warn("[StandaloneEditor] Failed to clean up sessionStorage:", e);
    }

    // Initialize editor
    if (typeof window.createSparqlEditor !== "function") {
      document.getElementById("sparql-editor-standalone").innerHTML = 
        "<p style='color: red;'>Error: SPARQL editor not available.</p>";
      return;
    }

    const container = document.getElementById("sparql-editor-standalone");
    const host = new URL(editorData.viewUrl).origin;
    const sparqlEndpoint = `${host}/${editorData.accountName}/${editorData.repositoryName}/sparql`;

    // Fetch repository config for revision support
    let repoClass = "";
    let revisionsEndpoint = "";
    try {
      const repoConfig = await fetch(`${host}/system/accounts/${encodeURIComponent(editorData.accountName)}/repositories/${encodeURIComponent(editorData.repositoryName)}/configuration`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (repoConfig.ok) {
        const config = await repoConfig.json();
        repoClass = config.class || "";
        if (/revisioned/i.test(repoClass)) {
          revisionsEndpoint = `${host}/system/accounts/${encodeURIComponent(editorData.accountName)}/repositories/${encodeURIComponent(editorData.repositoryName)}/revisions`;
        }
      }
    } catch (e) {
      console.warn("[StandaloneEditor] Failed to fetch repository config:", e);
    }

    const editorApi = window.createSparqlEditor({
      container,
      viewUrl: editorData.viewUrl,
      sparqlEndpoint,
      accessToken,
      accountName: editorData.accountName,
      repositoryName: editorData.repositoryName,
      repositoryClass: repoClass,
      revisionsEndpoint,
      viewName: editorData.viewName,
      sparql: editorData.queryText || "SELECT * WHERE { ?s ?p ?o } LIMIT 10",
      options: {
        title: `/${editorData.accountName}/${editorData.repositoryName}/${editorData.viewName}`,
        initialState: "open",
        showEventLog: true,
        showEditorToggle: true,
        showMediaTypeSelector: true,
        showSaveButton: true,
        showResetButton: true,
        showCloseButton: false, // No close button in standalone window
      },
    });

    // Restore query tabs if any
    if (editorData.results && Array.isArray(editorData.results) && editorData.results.length > 0) {
      if (editorApi.restoreQueryTabs) {
        editorApi.restoreQueryTabs(editorData.results, editorData.currentTabId);
      }
    }
  }
}

export class NotFoundPage extends BasePage {
  getBodyClass() {
    return "shared not_found";
  }

  async renderContent() {
    return `
      <h1 id="content-title">Oops, we're sorry....</h1>
      <h4>The page you were looking for doesn't exist.</h4>
      <p>You may have mistyped the address or the page may have moved.</p>
    `;
  }

  async renderSidebar() {
    return `
      <h4>Need help?</h4>
      <p><a href="http://${APP_CONFIG.docsHost}/">Try our docs site.</a></p>
    `;
  }
}
