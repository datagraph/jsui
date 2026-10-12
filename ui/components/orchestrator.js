/**
 * Orchestrator exploration pane component.
 *
 * Provides an interactive tree-based exploration interface for SPARQL graph
 * data via the orchestration API.  Renders as an overlay in the repository
 * sidebar when the "Explore" tab is active.
 *
 * Entry point: initOrchestrator(app, pane, accountName, repositoryName)
 */

/* global fetch */

// ── State ───────────────────────────────────────────────────────────────────

class OrchestratorState {
  constructor(accountName, repositoryName, authToken, host) {
    this.accountName = accountName;
    this.repositoryName = repositoryName;
    this.authToken = authToken;
    this.host = host;
    this.sessionId = null;
    this.nodes = new Map();         // id → node object
    this.aliases = new Map();       // alias → id
    this.reverseAliases = new Map(); // id → alias
    this.rootId = null;
    this.activeNodeId = null;
    this.selectedField = null;      // for shape-overlap highlighting
    this.connected = false;
    this.pendingOp = null;          // { op, sourceId } for two-node gestures
    this.nodePositions = new Map(); // id → {x, y} for drag repositioning
    this.error = null;
  }
}

// ── API layer ───────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

async function orchPost(state, operation, body = {}) {
  const url = `${state.host}/orchestration/${enc(state.accountName)}/${enc(state.repositoryName)}/${operation}`;
  const payload = { ...body };
  if (state.sessionId) payload.session = state.sessionId;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${state.authToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (resp.status === 410) {
    state.connected = false;
    state.sessionId = null;
    throw new Error("Session expired");
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return resp.json();
}


// ── Rendering helpers ───────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createSVG(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}


// ── Node card rendering ─────────────────────────────────────────────────────

function renderNodeClosed(state, node) {
  const alias = state.reverseAliases.get(node.id);
  const aliasStr = alias ? `<span class="orch-node-alias">[${escHtml(alias)}]</span> ` : "";
  const badge = node.resultCount != null ? `<span class="orch-node-badge">${node.resultCount}</span>` : "";
  return `<span class="orch-node-id">${escHtml(node.id)}</span> ${aliasStr}<span class="orch-node-op">${escHtml(node.operation)}</span>${badge}`;
}

function renderNodeOpen(state, node) {
  let html = renderNodeClosed(state, node);
  html += `<div class="orch-node-detail">`;

  // Shape section
  if (node.shape) {
    const type = node.shape["@type"];
    if (type) html += `<div class="orch-section-label">type</div><div>${escHtml(type)}</div>`;
    const shapeArr = node.shape["@shape"];
    if (shapeArr && shapeArr.length > 0) {
      html += `<div class="orch-section-label">shape</div><div>`;
      for (const field of shapeArr) {
        const name = typeof field === "string" ? field : (field && Object.keys(field)[0]) || "?";
        const cls = state.selectedField === name ? "orch-shape-field orch-field-selected" : "orch-shape-field";
        html += `<span class="${cls}" data-field="${escHtml(name)}">${escHtml(name)}</span> `;
      }
      html += `</div>`;
    }
    const opts = node.shape["@options"];
    if (opts) html += `<div class="orch-section-label">options</div><div>${escHtml(JSON.stringify(opts))}</div>`;
  }

  // Algebra
  if (node.algebra) {
    html += `<div class="orch-section-label">algebra</div><div class="orch-algebra-text">${escHtml(node.algebra)}</div>`;
  }

  // Results table (truncated)
  if (node.results && node.results.length > 0) {
    html += `<div class="orch-section-label">results</div>`;
    html += `<table class="orch-results-table">`;
    // Header from first result keys
    const first = node.results[0];
    if (typeof first === "object" && first !== null && !Array.isArray(first)) {
      const keys = Object.keys(first);
      html += `<tr>${keys.map(k => `<th>${escHtml(k)}</th>`).join("")}</tr>`;
      const rows = node.results.slice(0, 10);
      for (const row of rows) {
        html += `<tr>${keys.map(k => `<td>${escHtml(row[k])}</td>`).join("")}</tr>`;
      }
    } else {
      // Array-format results
      const rows = node.results.slice(0, 10);
      for (const row of rows) {
        html += `<tr><td>${escHtml(JSON.stringify(row))}</td></tr>`;
      }
    }
    if (node.results.length > 10) {
      html += `<tr><td colspan="99" style="color:#999">... (${node.results.length} total)</td></tr>`;
    }
    html += `</table>`;
  }

  html += `</div>`;
  return html;
}


// ── Tree rendering ──────────────────────────────────────────────────────────

function getDepthFirst(state, nodeId, depth) {
  const entries = [];
  const node = state.nodes.get(nodeId);
  if (!node) return entries;
  entries.push({ node, depth });
  if (node.childIds) {
    for (const childId of node.childIds) {
      entries.push(...getDepthFirst(state, childId, depth + 1));
    }
  }
  return entries;
}

function renderTree(state, container) {
  container.innerHTML = "";

  if (!state.rootId || !state.nodes.has(state.rootId)) {
    container.innerHTML = `<div class="orch-tree-empty">No exploration tree yet. Start with Survey.</div>`;
    return;
  }

  // SVG layer for connector lines
  const svg = createSVG("svg", { class: "orch-tree-lines" });
  container.appendChild(svg);

  const entries = getDepthFirst(state, state.rootId, 0);
  const nodeEls = new Map();

  for (const { node, depth } of entries) {
    const card = document.createElement("div");
    card.className = "orch-node";
    card.dataset.nodeId = node.id;
    card.style.setProperty("--depth", depth);

    // Status classes
    if (node.id === state.activeNodeId) card.classList.add("orch-node-active");
    if (node.status === "pending" || node.status === "evaluating" || node.status === "compiling")
      card.classList.add("orch-node-pending");
    if (node.status === "error") card.classList.add("orch-node-error");

    // Relationship highlighting
    if (state.activeNodeId) {
      const activeNode = state.nodes.get(state.activeNodeId);
      if (activeNode) {
        if (activeNode.parentId === node.id) card.classList.add("orch-node-parent");
        if (activeNode.childIds && activeNode.childIds.includes(node.id))
          card.classList.add("orch-node-child");
        // Also highlight if this node is a child of active
        if (node.parentId === state.activeNodeId) card.classList.add("orch-node-child");
      }
    }

    // Shape-overlap highlighting
    if (state.selectedField && node.shape) {
      const shapeArr = node.shape["@shape"];
      if (shapeArr) {
        const fieldNames = shapeArr.map(f => typeof f === "string" ? f : (f && Object.keys(f)[0]) || "");
        if (fieldNames.includes(state.selectedField) && node.id !== state.activeNodeId) {
          card.classList.add("orch-node-shape-overlap");
        }
      }
    }

    // Gesture target
    if (state.pendingOp) card.classList.add("gesture-target");

    // Content
    card.innerHTML = node.uiOpen ? renderNodeOpen(state, node) : renderNodeClosed(state, node);

    // Click handler (with drag disambiguation)
    let dragStartX = 0, dragStartY = 0, isDragging = false;
    card.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      isDragging = false;
    });
    card.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      const dx = Math.abs(e.clientX - dragStartX);
      const dy = Math.abs(e.clientY - dragStartY);
      if (dx < 5 && dy < 5) {
        // Click, not drag
        if (state.pendingOp) {
          completePendingOp(state, node.id, container);
        } else {
          selectNode(state, node.id, container);
        }
      }
    });
    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      toggleNodeOpen(state, node.id, container);
    });

    // Shape field click delegation
    card.addEventListener("click", (e) => {
      const fieldEl = e.target.closest(".orch-shape-field");
      if (fieldEl) {
        e.stopPropagation();
        const fieldName = fieldEl.dataset.field;
        state.selectedField = state.selectedField === fieldName ? null : fieldName;
        renderTree(state, container);
      }
    });

    container.appendChild(card);
    nodeEls.set(node.id, card);
  }

  // Draw connector lines
  requestAnimationFrame(() => drawConnectors(svg, state, nodeEls, container));
}


// ── Connector lines ─────────────────────────────────────────────────────────

function drawConnectors(svg, state, nodeEls, container) {
  svg.innerHTML = "";
  const containerRect = container.getBoundingClientRect();
  svg.setAttribute("width", container.scrollWidth);
  svg.setAttribute("height", container.scrollHeight);

  for (const [id, el] of nodeEls) {
    const node = state.nodes.get(id);
    if (!node || !node.parentId) continue;
    const parentEl = nodeEls.get(node.parentId);
    if (!parentEl) continue;

    const parentRect = parentEl.getBoundingClientRect();
    const childRect = el.getBoundingClientRect();

    const x1 = parentRect.left - containerRect.left + 10;
    const y1 = parentRect.bottom - containerRect.top;
    const x2 = childRect.left - containerRect.left + 10;
    const y2 = childRect.top - containerRect.top;

    const path = createSVG("path", {
      d: `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`,
      class: "orch-tree-line",
    });

    // Highlight connectors for active node relationships
    if (state.activeNodeId) {
      if ((node.id === state.activeNodeId && node.parentId) ||
          (node.parentId === state.activeNodeId)) {
        path.setAttribute("class", "orch-tree-line orch-line-highlighted");
      }
    }

    svg.appendChild(path);
  }
}


// ── Node interactions ───────────────────────────────────────────────────────

function selectNode(state, nodeId, container) {
  state.activeNodeId = nodeId;
  state.selectedField = null;
  // Navigate on server
  orchPost(state, "navigate", { node: nodeId }).catch(() => {});
  renderTree(state, container);
}

function toggleNodeOpen(state, nodeId, container) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  if (!node.uiOpen && !node.results) {
    // Fetch full node detail on first open
    orchPost(state, "node", { node: nodeId }).then((detail) => {
      mergeNodeDetail(state, detail);
      node.uiOpen = true;
      renderTree(state, container);
    }).catch((err) => {
      showStatus(state, err.message, true);
    });
    return;
  }
  node.uiOpen = !node.uiOpen;
  renderTree(state, container);
}

function mergeNodeDetail(state, detail) {
  const node = state.nodes.get(detail.id);
  if (!node) return;
  if (detail.shape) node.shape = detail.shape;
  if (detail.algebra) node.algebra = detail.algebra;
  if (detail.results) node.results = detail.results;
  if (detail.result_count != null) node.resultCount = detail.result_count;
  if (detail.status) node.status = detail.status;
  if (detail.suggestions) node.suggestions = detail.suggestions;
  if (detail.alias) {
    state.aliases.set(detail.alias, detail.id);
    state.reverseAliases.set(detail.id, detail.alias);
  }
}


// ── Pending two-node gestures (join, walk) ──────────────────────────────────

function startPendingOp(state, op, overlay) {
  state.pendingOp = { op, sourceId: state.activeNodeId };
  const prompt = overlay.querySelector(".orch-gesture-prompt");
  if (prompt) {
    prompt.textContent = `Click target node for ${op}...  (Esc to cancel)`;
    prompt.classList.add("visible");
  }
  const container = overlay.querySelector(".orch-tree-container");
  if (container) renderTree(state, container);
}

function cancelPendingOp(state, overlay) {
  state.pendingOp = null;
  const prompt = overlay.querySelector(".orch-gesture-prompt");
  if (prompt) prompt.classList.remove("visible");
  const container = overlay.querySelector(".orch-tree-container");
  if (container) renderTree(state, container);
}

async function completePendingOp(state, targetId, container) {
  const op = state.pendingOp;
  if (!op) return;
  state.pendingOp = null;
  const overlay = container.closest(".orch-overlay");
  if (overlay) {
    const prompt = overlay.querySelector(".orch-gesture-prompt");
    if (prompt) prompt.classList.remove("visible");
  }

  try {
    let result;
    if (op.op === "join") {
      result = await orchPost(state, "join", { node1: op.sourceId, node2: targetId });
    } else if (op.op === "walk") {
      result = await orchPost(state, "walk", { source: op.sourceId, target: targetId });
    }
    if (result) await refreshTree(state, container);
  } catch (err) {
    showStatus(state, err.message, true);
  }
}


// ── Tree data sync ──────────────────────────────────────────────────────────

function populateFromHistory(state, history) {
  state.sessionId = history.session;
  state.activeNodeId = history.active_node || null;
  if (history.tree) {
    populateNode(state, history.tree, null);
    state.rootId = history.tree.id;
  }
}

function populateNode(state, data, parentId) {
  const node = {
    id: data.id,
    operation: data.operation,
    status: data.status,
    resultCount: data.result_count || 0,
    parentId: parentId,
    childIds: [],
    shape: null,
    algebra: null,
    results: null,
    suggestions: null,
    uiOpen: false,
  };
  state.nodes.set(data.id, node);
  if (data.children) {
    for (const child of data.children) {
      node.childIds.push(child.id);
      populateNode(state, child, data.id);
    }
  }
}

function addNodeFromResult(state, result) {
  // Result from an operation contains at minimum { node: "nX" }
  if (!result || !result.node) return;
  const nodeId = result.node;
  if (!state.nodes.has(nodeId)) {
    // We need a full tree refresh
    return false;
  }
  return true;
}

async function refreshTree(state, container) {
  try {
    const history = await orchPost(state, "history");
    state.nodes.clear();
    state.rootId = null;
    populateFromHistory(state, history);
    renderTree(state, container);
  } catch (err) {
    showStatus(state, err.message, true);
  }
}


// ── Status display ──────────────────────────────────────────────────────────

let _statusEl = null;

function showStatus(state, message, isError = false) {
  state.error = isError ? message : null;
  if (_statusEl) {
    _statusEl.textContent = message;
    _statusEl.className = isError ? "orch-status error" : "orch-status";
    // Auto-clear after 5s for non-errors
    if (!isError) setTimeout(() => { if (_statusEl.textContent === message) _statusEl.textContent = ""; }, 5000);
  }
}


// ── Toolbar operations ──────────────────────────────────────────────────────

const OPERATIONS = [
  { id: "survey",      label: "Survey",      input: "optional", hint: "scope (types/predicates/graphs)" },
  { id: "profile",     label: "Profile",     input: "text",     hint: "type QName (e.g. foaf:Person)" },
  { id: "select",      label: "Select",      input: "textarea", hint: '{ @type: foaf:Person, @shape: [foaf:name] }' },
  { id: "branch",      label: "Branch",      input: "textarea", hint: '{ @type: ..., @shape: [...] }' },
  { id: "join",        label: "Join",        input: "gesture" },
  { id: "walk",        label: "Walk",        input: "gesture-or-text", hint: "predicate QName (or click target)" },
  { id: "shape",       label: "Shape",       input: "textarea", hint: '{ @shape: [new:field], @options: { limit: 20 } }' },
  { id: "narrow",      label: "Narrow",      input: "textarea", hint: 'filter expression' },
  { id: "expand",      label: "Expand",      input: "text",     hint: "predicate QName to add" },
  { id: "nl",          label: "NL",          input: "text",     hint: "natural language query" },
  { id: "materialize", label: "Materialize", input: "optional", hint: "target: sparql or shape" },
  { id: "name",        label: "Name",        input: "text",     hint: "alias for current node" },
  { id: "disconnect",  label: "Disconnect",  input: "none" },
];

function renderToolbar(state, overlay) {
  const toolbar = overlay.querySelector(".orch-toolbar");
  if (!toolbar) return;
  toolbar.innerHTML = "";
  for (const op of OPERATIONS) {
    const btn = document.createElement("button");
    btn.textContent = op.label;
    btn.dataset.op = op.id;
    if (!state.connected && op.id !== "disconnect") btn.disabled = true;
    if (op.id === "disconnect" && !state.connected) btn.disabled = true;
    btn.addEventListener("click", () => handleToolbarClick(state, op, overlay));
    toolbar.appendChild(btn);
  }
}

function handleToolbarClick(state, op, overlay) {
  const inputArea = overlay.querySelector(".orch-input-area");
  const treeContainer = overlay.querySelector(".orch-tree-container");

  if (op.input === "none") {
    // Execute immediately
    executeOp(state, op.id, {}, overlay);
    return;
  }

  if (op.input === "gesture") {
    if (!state.activeNodeId) {
      showStatus(state, `${op.label} requires an active node — click a node first`, true);
      return;
    }
    startPendingOp(state, op.id, overlay);
    return;
  }

  if (op.input === "optional" && !op.hint) {
    executeOp(state, op.id, {}, overlay);
    return;
  }

  // Show input area
  if (inputArea) {
    inputArea.classList.add("visible");
    const isTextarea = op.input === "textarea";
    inputArea.innerHTML = `
      <div class="orch-input-label">${escHtml(op.label)}${op.hint ? ": " + escHtml(op.hint) : ""}</div>
      ${isTextarea
        ? `<textarea class="orch-input" rows="3" placeholder="${escHtml(op.hint || "")}"></textarea>`
        : `<input class="orch-input" type="text" placeholder="${escHtml(op.hint || "")}" />`}
      <div class="orch-input-actions">
        <button class="orch-exec-btn">Execute</button>
        <button class="orch-cancel-btn">Cancel</button>
      </div>
    `;
    const input = inputArea.querySelector(".orch-input");
    if (input) input.focus();
    inputArea.querySelector(".orch-exec-btn").addEventListener("click", () => {
      const value = input.value.trim();
      inputArea.classList.remove("visible");
      if (value) {
        const body = buildOpBody(op.id, value);
        executeOp(state, op.id, body, overlay);
      }
    });
    inputArea.querySelector(".orch-cancel-btn").addEventListener("click", () => {
      inputArea.classList.remove("visible");
    });
    // Enter key for single-line inputs
    if (!isTextarea && input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputArea.querySelector(".orch-exec-btn").click();
        }
      });
    }
  }
}

function buildOpBody(opId, value) {
  switch (opId) {
    case "survey": return { scope: value || "types" };
    case "profile": return { type: value };
    case "select":
    case "branch":
      try { return { shape: JSON.parse(value) }; } catch { return { shape: value }; }
    case "shape":
      try { return { modifier: JSON.parse(value) }; } catch { return { modifier: value }; }
    case "narrow": return { where: value };
    case "expand": return { predicate: value };
    case "nl": return { text: value };
    case "materialize": return { as: value || "sparql" };
    case "name": return { alias: value };
    case "walk": return { predicate: value };
    default: return {};
  }
}

async function executeOp(state, opId, body, overlay) {
  const treeContainer = overlay.querySelector(".orch-tree-container");
  showStatus(state, `Executing ${opId}...`);

  try {
    if (opId === "disconnect") {
      await orchPost(state, "disconnect");
      state.connected = false;
      state.sessionId = null;
      state.nodes.clear();
      state.rootId = null;
      state.activeNodeId = null;
      showStatus(state, "Disconnected");
      renderToolbar(state, overlay);
      if (treeContainer) renderTree(state, treeContainer);
      return;
    }

    const result = await orchPost(state, opId, body);
    showStatus(state, `${opId} complete`);

    // For materialize, show the query in the status or a detail area
    if (opId === "materialize" && result && result.query) {
      showStatus(state, `Materialized ${result.format || "sparql"} query`);
    }

    // Refresh tree to pick up new nodes
    if (treeContainer) await refreshTree(state, treeContainer);
  } catch (err) {
    showStatus(state, err.message, true);
    if (!state.connected) {
      renderToolbar(state, overlay);
    }
  }
}


// ── Overlay structure ───────────────────────────────────────────────────────

function renderOverlay(state, overlay) {
  overlay.innerHTML = `
    <div class="orch-header">
      <span>
        <span class="orch-header-title">Exploration</span>
        <span class="orch-header-session"></span>
      </span>
      <button class="orch-header-close" title="Close">&times;</button>
    </div>
    <div class="orch-toolbar"></div>
    <div class="orch-gesture-prompt"></div>
    <div class="orch-input-area"></div>
    <div class="orch-status"></div>
    <div class="orch-tree-container"></div>
  `;

  _statusEl = overlay.querySelector(".orch-status");

  // Close button
  overlay.querySelector(".orch-header-close").addEventListener("click", () => {
    overlay.style.display = "none";
    // Switch back to profile tab
    const pane = overlay.closest(".repository-pane");
    if (pane) {
      const profileTab = pane.querySelector('.manage-tab[data-tab="profile"]');
      if (profileTab) profileTab.click();
    }
  });

  // Escape key cancels pending gesture
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.pendingOp) {
      cancelPendingOp(state, overlay);
    }
  });
  // Make overlay focusable for keyboard events
  overlay.setAttribute("tabindex", "-1");

  renderToolbar(state, overlay);
}

function updateSessionDisplay(state, overlay) {
  const el = overlay.querySelector(".orch-header-session");
  if (el && state.sessionId) {
    el.textContent = state.sessionId.substring(0, 8) + "...";
  }
}


// ── Initialization ──────────────────────────────────────────────────────────

// Track state per pane to persist across tab switches
const _paneStates = new Map();

function getPaneKey(accountName, repositoryName) {
  return `${accountName}/${repositoryName}`;
}

async function initOrchestrator(app, pane, accountName, repositoryName) {
  const key = getPaneKey(accountName, repositoryName);
  const overlay = pane.querySelector(".orch-overlay");
  if (!overlay) return;

  // Reuse existing state if available
  let state = _paneStates.get(key);
  if (state && state.connected) {
    // Already connected, just re-render
    overlay.style.display = "flex";
    renderOverlay(state, overlay);
    updateSessionDisplay(state, overlay);
    const treeContainer = overlay.querySelector(".orch-tree-container");
    if (treeContainer) renderTree(state, treeContainer);
    return;
  }

  // Get auth token
  const auth = app.state?.getAuthContext?.(accountName);
  const token = auth?.token;
  const host = auth?.host || window.location.origin;
  if (!token) {
    overlay.innerHTML = `<div class="orch-connecting">Authentication required. Please log in first.</div>`;
    overlay.style.display = "flex";
    return;
  }

  state = new OrchestratorState(accountName, repositoryName, token, host);
  _paneStates.set(key, state);

  renderOverlay(state, overlay);
  overlay.style.display = "flex";

  // Auto-connect
  showStatus(state, "Connecting...");
  try {
    const result = await orchPost(state, "connect");
    state.sessionId = result.session;
    state.connected = true;
    updateSessionDisplay(state, overlay);
    showStatus(state, `Connected (${result.vocabulary?.types || 0} types, ${result.vocabulary?.prefixes || 0} prefixes)`);
    renderToolbar(state, overlay);
  } catch (err) {
    showStatus(state, `Connection failed: ${err.message}`, true);
  }
}


// ── Exports ─────────────────────────────────────────────────────────────────

export { initOrchestrator };
