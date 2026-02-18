/**
 * Unified SPARQL Editor Component
 * 
 * A SPARQL query editor that can be embedded standalone or integrated with DydraClient.
 * Consolidates observable-sparql-editor.js and client.js createSparqlPanel implementations.
 * 
 * Features:
 * - Comprehensive media type support (JSON, XML, SVG, HTML, CSV, TSV, Turtle, N-Triples, RDF/XML, JSON-LD, SSE)
 * - Parameter management with dynamic input fields
 * - Event logging with timestamps
 * - Collapsible editor and results sections
 * - Query save functionality
 * - Optional breadcrumb navigation (DydraClient integration)
 * - Unified authentication via accountAuth.apiClient
 * 
 * Usage (Standalone - with accessToken):
 *   import { createSparqlEditor } from './sparql-editor.js';
 *   createSparqlEditor({
 *     viewUrl: 'https://host/system/accounts/account/repositories/repo/views/view',
 *     accessToken: 'bearer-token',  // Will auto-create accountAuth wrapper
 *     container: document.getElementById('editor-container'),
 *     options: {
 *       title: 'My SPARQL Editor',
 *       initialState: 'open',
 *       showEventLog: true,
 *       parameters: ['param1', 'param2'],
 *       onQueryExecuted: (results) => console.log(results)
 *     }
 *   });
 * 
 * Usage (Standalone - with accountAuth):
 *   createSparqlEditor({
 *     viewUrl: 'https://host/account/repo/view',
 *     accountAuth: { apiClient, token },  // Pass accountAuth directly
 *     container: document.getElementById('editor-container'),
 *     options: { title: 'My Editor' }
 *   });
 * 
 * Usage (DydraClient Integration):
 *   createSparqlEditor({
 *     container: containerElement,
 *     viewUrl: viewUrl,
 *     accountName: 'account',
 *     repositoryName: 'repo',
 *     viewName: 'view',
 *     accountAuth: { apiClient, token },  // Required for both modes
 *     dydraClient: this,                   // DydraClient instance
 *     dialog: dialogElement,               // Parent dialog
 *     options: {
 *       initialState: 'open',
 *       showBreadcrumbs: true,             // Breadcrumbs override options.title
 *       showCloseButton: true
 *     }
 *   });
 */

// Utility functions
function ensureBearerTokenPrefix(accessToken) {
    if (!accessToken) return null;
    var token = String(accessToken).trim();
    if (token.length === 0) return null;
    if (/^Bearer\s/i.test(token)) return token;
    return "Bearer " + token;
}

function createElement(tagName, props, children) {
    var el = document.createElement(tagName);
    if (props) {
    for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var value = props[key];
        if (key === "style" && value && typeof value === "object") {
            for (var styleKey in value) {
                if (!Object.prototype.hasOwnProperty.call(value, styleKey)) continue;
                el.style[styleKey] = value[styleKey];
            }
        } else if (key === "dataset" && value && typeof value === "object") {
            for (var dataKey in value) {
                if (!Object.prototype.hasOwnProperty.call(value, dataKey)) continue;
                el.dataset[dataKey] = value[dataKey];
            }
        } else if (key.startsWith("data-")) {
            el.setAttribute(key, value);
        } else if (key in el) {
            el[key] = value;
        } else {
            el.setAttribute(key, value);
        }
    }
    }
    if (children && children.length) {
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child == null) continue;
        el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    }
    return el;
}

function createSvgIcon(pathData, width, height) {
    var svg = createElement('svg', {
    width: width || 16,
    height: height || 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1',
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
    });
    
    var path = createElement('path', { d: pathData });
    svg.appendChild(path);
    return svg;
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatXml(xmlText) {
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    var serializer = new XMLSerializer();
    return serializer.serializeToString(xmlDoc);
}

// Main SPARQL Editor function
function createSparqlEditor(config) {
    console.log('🔧 createSparqlEditor called with config:', config);
    
    // Validate required parameters
    if (!config) {
        throw new Error('createSparqlEditor: configuration object is required');
    }
    if (!config.viewUrl && !config.sparql) {
        console.error('❌ Missing viewUrl and sparql:', { viewUrl: config.viewUrl, sparql: config.sparql });
        throw new Error('createSparqlEditor: either viewUrl or sparql must be provided');
    }
    if (!config.container && !config.dialog) {
        console.error('❌ Missing container and dialog:', { container: config.container, dialog: config.dialog });
        throw new Error('createSparqlEditor: either container or dialog element is required');
    }
    
    console.log('✅ Validation passed, creating SPARQL editor...');

    // Accept accountAuth directly, or create minimal wrapper for standalone mode
    // This allows both API modes to use accountAuth consistently
    if (!config.accountAuth) {
        if (config.viewUrl && config.accessToken) {
            // Standalone mode: create minimal accountAuth wrapper
            var standaloneAccessToken = ensureBearerTokenPrefix(config.accessToken);
            config.accountAuth = {
                token: standaloneAccessToken,
                apiClient: {
                    executeSparqlQuery: function(account, repo, view, query, mediaType) {
                        return fetch(config.viewUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': standaloneAccessToken,
                                'Accept': mediaType || 'application/sparql-results+json',
                                'Content-Type': 'application/sparql-query'
                            },
                            body: query
                        });
                    }
                }
            };
        } else {
            console.warn('createSparqlEditor: Neither accountAuth nor (viewUrl + accessToken) provided');
        }
    }
    // If accountAuth is provided directly (both standalone and DydraClient modes), use it as-is

    // Default configuration
    var options = {
        title: '',
        initialState: 'open',
        height: 'auto', // Use auto height instead of fixed 400px
        fontSize: '14px',
        onQueryExecuted: null,
        onQuerySaved: null,
        onQueryChanged: null,
        showMediaTypeSelector: true,
        showSaveButton: true,
        showResetButton: true,
        useYasqe: true, // Enable Yasqe editor by default
        enableAutocomplete: true, // Enable autocomplete by default
        showCloseButton: false,
        showEventLog: true,
        eventLogHeight: '200px',
        showEditorToggle: true,
        showBreadcrumbs: false,     // Enable for DydraClient integration
        parameters: [],
        ...(config.options || {})
    };

    var viewUrl = config.viewUrl;
    var accessToken = config.accessToken ? ensureBearerTokenPrefix(config.accessToken) : null;
    var container = config.container;
    var initialQuery = config.sparql || '';
    
    // DydraClient-specific parameters
    var dydraClient = config.dydraClient || null;
    var accountName = config.accountName || '';
    var repositoryName = config.repositoryName || '';
    var viewName = config.viewName || '';
    var accountAuth = config.accountAuth || null;
    var dialog = config.dialog || null;
    var repositoryClass = config.repositoryClass || '';
    var revisionsEndpoint = config.revisionsEndpoint || '';

    // Use accountAuth token if available, otherwise use accessToken
    var effectiveToken = accountAuth ? accountAuth.token : accessToken;

    // Use the existing dialog element as the panel - don't create a new one
    var panel = dialog || container;
    
    // If we have a dialog, use it directly; if not, create a simple container
    if (!panel) {
        panel = createElement('div', {
            className: 'dialog',
            style: {
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '0',
                margin: '0',
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
                height: 'auto',
                minHeight: '200px',
                maxHeight: '80vh',
                overflow: 'visible',
                cursor: 'default'
            }
        });
    }

    // SIMPLE SIZE CALCULATION: Collapsed = header only, Expanded = header + query editor + results + log
    function adjustEditorSize() {
        var height = header.scrollHeight; // Always include header
        
        if (isContentVisible) {
            // Expanded: add query editor + results + log
            height += queryEditorContainer.scrollHeight;
            if (resultsTabsContainer && resultsTabsContainer.style.display !== 'none') {
                // Use scrollHeight since we removed maxHeight restriction
                height += resultsTabsContainer.scrollHeight;
            }
            if (eventLogContainer && eventLogContainer.style.display !== 'none') {
                height += eventLogContainer.scrollHeight;
            }
            // Restore minHeight when expanded
            panel.style.minHeight = '200px';
        } else {
            // Remove minHeight when collapsed to allow smaller size
            panel.style.minHeight = '0px';
        }
        
        panel.style.height = height + 'px';
        console.log('Panel height set to:', height + 'px', isContentVisible ? '(expanded)' : '(collapsed)');
    }
    
    // Tab management functions
    function createQueryTab(query, results, executionTime, etag) {
        var tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        var timestamp = new Date().toLocaleTimeString();
        
        // Calculate result count
        var resultCount = 0;
        if (results.error) {
            resultCount = 'Error';
        } else if (results.results && results.results.bindings) {
            resultCount = results.results.bindings.length;
        } else if (results.boolean !== undefined) {
            resultCount = 'Boolean';
        } else {
            resultCount = 'Unknown';
        }
        
        var tab = {
            id: tabId,
            label: timestamp,
            query: query,
            results: results,
            executionTime: executionTime,
            resultCount: resultCount,
            etag: etag || '',
            createdAt: new Date()
        };
        
        queryTabs.push(tab);
        
        // Create tab button using direct DOM manipulation (like client.js)
        var tabButton = document.createElement('button');
        tabButton.type = 'button';
        tabButton.className = 'query-tab';
        tabButton.dataset.tabId = tabId;
        tabButton.title = 'Executed: ' + tab.createdAt.toLocaleString() + '\nTime: ' + executionTime + 'ms\nResults: ' + resultCount + (etag ? '\nRevision: ' + etag : '');
        tabButton.style.cssText = 'background: #007bff; color: white; border: none; padding: 4px 8px; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 12px; margin-right: 2px; display: flex; align-items: center; gap: 4px;';
        
        // Avoid nested button inside button to preserve drag behavior
        tabButton.innerHTML = '<span>' + timestamp + '</span><span class="close-tab" style="display:inline-block; color: white; cursor: pointer; padding: 0; margin-left: 4px; font-size: 14px; line-height: 1; user-select: none;" title="Close Tab">×</span>';
        
        // Add event listeners (like client.js)
        tabButton.addEventListener('click', function(e) {
            if (e.target.classList.contains('close-tab')) {
                e.stopPropagation();
                closeTab(tabId);
            } else {
                activateTab(tabId);
            }
        });
        
        // Enable dragging to external result sheet drop zone
        tabButton.draggable = true;
        tabButton.setAttribute('draggable', 'true');
        console.log('🧲 [editor] Enabling drag on tab', { tabId: tabId, draggable: tabButton.draggable });
        tabButton.addEventListener('mousedown', function(e) {
            console.log('🖱️ [editor] mousedown on tab', { tabId: tabId, button: e.button, target: e.target.className });
        });
        tabButton.addEventListener('dragstart', function(e) {
            e.stopPropagation();
            console.log('🚚 [editor] dragstart on tab', { tabId: tabId, hasDataTransfer: !!e.dataTransfer });
            var rootDialog = null;
            try {
                // panel is the container/div or dialog; find nearest dialog id
                var root = panel && panel.closest ? panel.closest('[id^="view-dialog-"]') : null;
                rootDialog = root ? root.id : null;
            } catch (_) {}
            var dragData = {
                type: 'result-sheet',
                viewName: viewName,
                accountName: accountName,
                repositoryName: repositoryName,
                timestamp: Date.now(),
                tabId: tabId,
                tab: tab,
                dialogId: rootDialog,
                key: `view:${accountName}/${repositoryName}/${viewName}`
                // No dialog id here; external handler can use these fields
            };
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copy';
                try {
                    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
                } catch (err) {
                    console.warn('⚠️ [editor] Failed to set drag data (application/json), retry text/plain', err);
                    try { e.dataTransfer.setData('text/plain', JSON.stringify(dragData)); } catch (err2) {}
                }
            } else {
                console.warn('⚠️ [editor] No dataTransfer on dragstart');
            }
            var dropZone = document.getElementById('result-sheet-drop-zone');
            if (dropZone) {
                dropZone.classList.add('drag-active');
                console.log('🎯 [editor] Drop zone activated from tab drag');
            }
        });
        tabButton.addEventListener('drag', function() {
            console.log('🚚 [editor] dragging tab', { tabId: tabId });
        });
        tabButton.addEventListener('dragend', function(e) {
            console.log('🧲 [editor] dragend on tab', { tabId: tabId, dropEffect: e.dataTransfer ? e.dataTransfer.dropEffect : undefined });
        });

        // Add to tabs list
        tabsList.appendChild(tabButton);
        
        // Activate this tab
        activateTab(tabId);
        
        return tabId;
    }
    
    function activateTab(tabId) {
        var tab = queryTabs.find(function(t) { return t.id === tabId; });
        if (!tab) return;
        
        // Update active tab
        activeTabId = tabId;
        
        // Update tab button styles
        var tabButtons = tabsList.querySelectorAll('.query-tab');
        tabButtons.forEach(function(btn) {
            if (btn.dataset.tabId === tabId) {
                btn.style.background = '#007bff';
                btn.style.borderBottom = 'none';
            } else {
                btn.style.background = '#6c757d';
                btn.style.borderBottom = '1px solid #e5e7eb';
            }
        });
        
        // Restore query text
        textarea.value = tab.query;
        
        // Display results
        displayQueryResults(tab.results, tab.executionTime);
    }
    
    function closeTab(tabId) {
        var tabIndex = queryTabs.findIndex(function(t) { return t.id === tabId; });
        if (tabIndex === -1) return;
        
        // Remove tab from array
        queryTabs.splice(tabIndex, 1);
        
        // Remove tab button
        var tabButton = tabsList.querySelector('[data-tab-id="' + tabId + '"]');
        if (tabButton) {
            tabButton.remove();
        }
        
        // If this was the active tab, activate another one or clear results
        if (activeTabId === tabId) {
            if (queryTabs.length > 0) {
                activateTab(queryTabs[queryTabs.length - 1].id);
            } else {
                activeTabId = null;
                resultsTabsContainer.style.display = 'none';
            }
        }
    }
    
    function displayQueryResults(results, executionTime) {
        // Safety check: ensure resultsContent exists
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display results');
            return;
        }
        
        // Clear previous results
        resultsContent.innerHTML = '';
        
        // Show the results container
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        if (results.error) {
            showResults('Error: ' + results.error, 'error');
            return;
        }
        
        // Display results based on type
        if (results.results && results.results.bindings) {
            // JSON table results
            displayJsonResultsAsTable(results, executionTime);
        } else if (results.type === 'xml') {
            // XML results
            displayXmlResults(results.content, executionTime);
        } else if (results.type === 'svg') {
            // SVG results
            displaySvgResults(results.content, executionTime);
        } else if (results.type === 'async') {
            // Asynchronous request accepted
            showResults(results.message, 'info');
        } else if (results.boolean !== undefined) {
            // ASK query result
            showResults('Result: ' + results.boolean, results.boolean ? 'success' : 'error');
        } else {
            // Other result types
            showResults(JSON.stringify(results, null, 2), 'info');
        }
    }
    
    function displayJsonResultsAsTable(data, executionTime) {
        console.log('displayJsonResultsAsTable called with executionTime:', executionTime);
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        logEvent('JSON results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        if (!data.results || !data.results.bindings) {
            showResults('No results found', 'info');
            return;
        }
        
        var bindings = data.results.bindings;
        var variables = data.head.vars;
        
        if (bindings.length === 0) {
            showResults('No results found', 'info');
            return;
        }
        
        // Create table container
        var tableContainer = document.createElement('div');
        try {
            tableContainer.setAttribute('data-testid', 'query-results-table');
            // Also mark as types results for tests that target types specifically
            tableContainer.setAttribute('data-testid-types', 'types-results-table');
        } catch (e) {}
        tableContainer.style.cssText = 'position: relative; padding: 0px; border: none; background: white; max-height: 400px; overflow: auto;';
        
        // Create table
        var html = '<table style="width: 100%; border-collapse: collapse; font-size: 11px; margin: 0px; padding: 0px;">';
        
        // Header
        html += '<thead><tr>';
        variables.forEach(function(variable) {
            html += '<th style="border: 1px solid #ddd; padding: 4px; background: #f0f0f0; text-align: left; margin: 0px;">' + variable + '</th>';
        });
        html += '</tr></thead>';
        
        // Rows
        html += '<tbody>';
        bindings.forEach(function(binding) {
            html += '<tr>';
            variables.forEach(function(variable) {
                var value = binding[variable];
                var displayValue = value ? (value.value || value) : '';
                html += '<td style="border: 1px solid #ddd; padding: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; margin: 0px;">' + escapeHtml(displayValue) + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        
        tableContainer.innerHTML = html;
        
        // Add save button
        var saveButton = createSaveButton(tableContainer, 'query-result.json', JSON.stringify(data, null, 2), 'application/json');
        tableContainer.appendChild(saveButton);
        
        // Display results
        resultsContent.appendChild(tableContainer);
        resultsTabsContainer.style.display = 'block';
        
        // Adjust editor size
        setTimeout(adjustEditorSize, 10);
    }

    // Create header
    var header = createElement('div', {
        className: 'dialog-header',
        style: {
            display: 'flex',
            alignItems: 'flex-start',
            marginBottom: '0',
            gap: '2px',
            overflow: 'visible',
            zIndex: '1000',
            position: 'relative',
            padding: '0px 12px 4px 4px', // Reduced top padding by 4px to move elements up
            borderBottom: '1px solid var(--forest-light)',
            background: '#f9fafb',
            height: '22px', // Match other panels
            minHeight: '22px'
        }
    });

    // Header text - either breadcrumb navigation or simple title
    var headerText = createElement('div', {
        style: {
            fontWeight: 'normal',
            color: '#111827',
            fontSize: '14px',
            lineHeight: '1',
            flex: '1',
            minWidth: '0',
            display: 'flex',
            alignItems: 'center',
            cursor: options.showEditorToggle ? 'pointer' : 'default',
            userSelect: 'none'
        }
    });

    if (options.showBreadcrumbs && dydraClient && accountName && repositoryName && viewName) {
        // Create clickable breadcrumb navigation (DydraClient mode)
        // Breadcrumbs always take precedence over options.title when showBreadcrumbs is true
        var accountSpan = createElement('span', {
            className: 'clickable-account-name-sparql',
            dataset: { account: accountName },
            style: { cursor: 'pointer' },
            title: 'Show account panel for ' + accountName
        }, [dydraClient.getAccountHostname(accountName) + '/' + accountName]);
        
        var repoSpan = createElement('span', {
            className: 'clickable-repository-name-sparql',
            dataset: { account: accountName, repository: repositoryName },
            style: { cursor: 'pointer' },
            title: 'Show repository panel for ' + accountName + '/' + repositoryName
        }, [repositoryName]);
        
        headerText.appendChild(accountSpan);
        headerText.appendChild(document.createTextNode('/'));
        headerText.appendChild(repoSpan);
        headerText.appendChild(document.createTextNode('/' + viewName));
        
        // Add click handlers for breadcrumb navigation
        accountSpan.addEventListener('click', function(e) {
            e.stopPropagation();
            dydraClient.showOrReuseAccountDialog(accountName, e);
        });
        
        repoSpan.addEventListener('click', function(e) {
            e.stopPropagation();
            dydraClient.openRepositoryViewWithAccount(accountName, repositoryName, e);
        });
    } else {
        // Simple title text (standalone mode)
        // Priority: 1) explicit options.title, 2) parsed from viewUrl, 3) empty string
        var titleText = options.title;
        if (!titleText && viewUrl && options.showEditorToggle) {
            // Try to extract account/repo/view from viewUrl
            try {
                var url = new URL(viewUrl);
                var pathParts = url.pathname.split('/').filter(function(part) { return part; });
                
                // Try to extract account/repo/view from URL
                var accountsIndex = pathParts.indexOf('accounts');
                var repositoriesIndex = pathParts.indexOf('repositories');
                var viewsIndex = pathParts.indexOf('views');
                
                if (accountsIndex !== -1 && repositoriesIndex !== -1 && viewsIndex !== -1) {
                    var urlAccountName = pathParts[accountsIndex + 1];
                    var urlRepositoryName = pathParts[repositoriesIndex + 1];
                    var urlViewName = pathParts[viewsIndex + 1];
                    titleText = '/' + urlAccountName + '/' + urlRepositoryName + '/' + urlViewName;
                } else if (pathParts.length >= 3) {
                    // Direct path format: account/repo/view
                    titleText = '/' + pathParts[0] + '/' + pathParts[1] + '/' + pathParts[2];
                }
            } catch (error) {
                // Fall back to empty string if URL parsing fails
                titleText = '';
            }
        }
        headerText.appendChild(document.createTextNode(titleText || ''));
    }

    // Button bar
    var buttonBar = createElement('div', {
        style: {
            display: options.initialState === 'open' ? 'flex' : 'none',
            gap: '4px',
            marginLeft: 'auto',
            overflow: 'visible',
            zIndex: '1000',
            position: 'relative'
        }
    });

    // Toggle button
    var toggleButton = createElement('button', {
        type: 'button',
        title: 'Show/Hide SPARQL editor',
        'data-testid': 'sparql-editor-toggle-btn',
        style: {
            padding: '1px',
            border: '1px solid #e5e7eb',
            background: '#f9fafb',
            color: '#111827',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px'
        }
    });

    // Create SVG icons for toggle (same as client.js)
    var caretDownSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    caretDownSvg.setAttribute("width", "12");
    caretDownSvg.setAttribute("height", "12");
    caretDownSvg.setAttribute("viewBox", "0 0 24 24");
    caretDownSvg.setAttribute("fill", "none");
    caretDownSvg.setAttribute("stroke", "currentColor");
    caretDownSvg.setAttribute("stroke-width", "1");
    caretDownSvg.setAttribute("stroke-linecap", "round");
    caretDownSvg.setAttribute("stroke-linejoin", "round");
    
    var caretDownPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    caretDownPath.setAttribute("d", "M6 10l6 6l6 -6h-12");
    caretDownSvg.appendChild(caretDownPath);
    
    var caretRightSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    caretRightSvg.setAttribute("width", "12");
    caretRightSvg.setAttribute("height", "12");
    caretRightSvg.setAttribute("viewBox", "0 0 24 24");
    caretRightSvg.setAttribute("fill", "none");
    caretRightSvg.setAttribute("stroke", "currentColor");
    caretRightSvg.setAttribute("stroke-width", "1");
    caretRightSvg.setAttribute("stroke-linecap", "round");
    caretRightSvg.setAttribute("stroke-linejoin", "round");
    
    var caretRightPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    caretRightPath.setAttribute("d", "M10 18l6 -6l-6 -6v12");
    caretRightSvg.appendChild(caretRightPath);

    toggleButton.appendChild(options.initialState === 'open' ? caretDownSvg : caretRightSvg);

    // Event log toggle button (only if event log is enabled and not undefined)
    var eventLogToggleButton = null;
    var eventLogVisible = options.showEventLog === true; // Only true if explicitly true
    
    // Only create the log toggle button if showEventLog is not undefined
    if (options.showEventLog !== undefined) {
        eventLogToggleButton = createElement('button', {
            type: 'button',
            title: eventLogVisible ? 'Hide event log' : 'Show event log',
            'data-testid': 'sparql-editor-eventlog-toggle-btn',
            style: {
                padding: '1px',
                border: '1px solid #6b7280',
                background: eventLogVisible ? '#6b7280' : '#ffffff',
                color: eventLogVisible ? '#ffffff' : '#6b7280',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '8px',
                fontWeight: '600',
                width: '16px',
                height: '16px'
            }
        }, [eventLogVisible ? 'LOG' : 'LOG']);

        buttonBar.appendChild(eventLogToggleButton);
    }

    // Media type selector
    var mediaTypeSelect = null;
    if (options.showMediaTypeSelector) {
        mediaTypeSelect = createElement('select', {
            id: 'media-type-select',
            title: 'Select response media type',
            tabIndex: '0',
            'data-testid': 'sparql-editor-media-type-select',
            style: {
                padding: '2px 4px',
                border: '1px solid #d1d5db',
                background: '#ffffff',
                color: '#111827',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                height: '16px'
            }
        });

        var mediaTypes = [
            { value: 'application/sparql-results+json', text: 'JSON' },
            { value: 'application/sparql-results+xml', text: 'XML' },
            { value: 'image/vnd.dydra.SPARQL-RESULTS+GRAPHVIZ+SVG+XML', text: 'SVG' },
            { value: 'text/html', text: 'HTML' },
            { value: '---', text: '───────────────', disabled: true }, // Separator
            { value: 'text/csv', text: 'CSV', fileType: 'csv' },
            { value: 'text/tab-separated-values', text: 'TSV', fileType: 'tsv' },
            { value: 'text/turtle', text: 'Turtle', fileType: 'ttl' },
            { value: 'application/n-triples', text: 'N-Triples', fileType: 'nt' },
            { value: 'application/rdf+xml', text: 'RDF/XML', fileType: 'rdf' },
            { value: 'application/ld+json', text: 'JSON-LD', fileType: 'jsonld' },
            { value: '---', text: '───────────────', disabled: true }, // Separator
            { value: 'application/sparql-query+sse', text: 'SSE' }
        ];

        mediaTypes.forEach(function(type) {
            var option = createElement('option', { value: type.value }, [type.text]);
            if (type.disabled) {
                option.disabled = true;
                option.style.cssText = 'font-size: 1px; line-height: 1px; padding: 0; margin: 0;';
            }
            mediaTypeSelect.appendChild(option);
        });

        mediaTypeSelect.value = 'application/sparql-results+json';
        buttonBar.appendChild(mediaTypeSelect);
    }

    // Revision selector (only for REVISIONED repositories)
    var revisionSelect = null;
    var revisionsLoaded = false;
    if (repositoryClass && /revisioned/i.test(repositoryClass)) {
        revisionSelect = createElement('select', {
            title: 'Select repository revision',
            'data-testid': 'sparql-editor-revision-select',
            style: {
                padding: '2px 4px',
                border: '1px solid #d1d5db',
                background: '#ffffff',
                color: '#111827',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                height: '16px'
            }
        });
        var headOption = createElement('option', { value: 'HEAD' }, ['HEAD']);
        revisionSelect.appendChild(headOption);

        // Lazy-load revisions on first interaction
        var loadRevisions = function() {
            if (revisionsLoaded || !revisionsEndpoint) return;
            revisionsLoaded = true;
            var revHeaders = { 'Accept': 'text/plain' };
            if (effectiveToken) { revHeaders['Authorization'] = effectiveToken; }
            fetch(revisionsEndpoint, { method: 'GET', headers: revHeaders })
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to fetch revisions');
                return response.text();
            })
            .then(function(text) {
                var revisions = text.trim().split('\n').filter(function(r) { return r.trim(); });
                revisions.forEach(function(rev) {
                    var opt = createElement('option', { value: rev.trim() }, [rev.trim()]);
                    revisionSelect.appendChild(opt);
                });
            })
            .catch(function(err) {
                console.warn('Could not load revisions:', err.message);
            });
        };

        revisionSelect.addEventListener('mousedown', loadRevisions);
        revisionSelect.addEventListener('focus', loadRevisions);
        buttonBar.appendChild(revisionSelect);
    }

    // Settings gear button with async popover
    var asyncEnabled = false;
    var asyncNotificationUrl = '';

    var gearButton = createElement('button', {
        type: 'button',
        title: 'Query settings',
        'data-testid': 'sparql-editor-settings-btn',
        style: {
            padding: '2px',
            border: '1px solid #6b7280',
            background: '#f9fafb',
            color: '#6b7280',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px'
        }
    });

    // Create gear SVG icon
    var gearSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    gearSvg.setAttribute("width", "12");
    gearSvg.setAttribute("height", "12");
    gearSvg.setAttribute("viewBox", "0 0 24 24");
    gearSvg.setAttribute("fill", "none");
    gearSvg.setAttribute("stroke", "currentColor");
    gearSvg.setAttribute("stroke-width", "1");
    gearSvg.setAttribute("stroke-linecap", "round");
    gearSvg.setAttribute("stroke-linejoin", "round");

    var gearPath1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    gearPath1.setAttribute("d", "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.573c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.573 1.066c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.066 -2.573c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z");
    var gearPath2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    gearPath2.setAttribute("d", "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0");

    gearSvg.appendChild(gearPath1);
    gearSvg.appendChild(gearPath2);
    gearButton.appendChild(gearSvg);

    // Create settings popover
    var settingsPopover = createElement('div', {
        style: {
            display: 'none',
            position: 'fixed',
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
            fontSize: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: '10001',
            minWidth: '200px'
        }
    });

    // Async checkbox
    var asyncCheckboxContainer = createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px' }
    });
    var asyncCheckbox = document.createElement('input');
    asyncCheckbox.type = 'checkbox';
    asyncCheckbox.id = 'settings-async-' + Date.now();
    asyncCheckbox.setAttribute('data-testid', 'sparql-editor-async-checkbox');
    asyncCheckbox.style.cssText = 'margin: 0;';
    var asyncLabel = document.createElement('label');
    asyncLabel.htmlFor = asyncCheckbox.id;
    asyncLabel.textContent = 'Asynchronous';
    asyncLabel.style.cssText = 'font-size: 12px; color: #333; margin: 0; cursor: pointer;';
    asyncCheckboxContainer.appendChild(asyncCheckbox);
    asyncCheckboxContainer.appendChild(asyncLabel);

    // Notification URL field (hidden until async checked)
    var notifyContainer = createElement('div', {
        style: { display: 'none', flexDirection: 'column', gap: '2px', marginTop: '8px' }
    });
    var notifyLabel = document.createElement('label');
    notifyLabel.textContent = 'Notification URL';
    notifyLabel.style.cssText = 'font-size: 11px; font-weight: bold; color: #333; margin: 0;';
    var notifyInput = document.createElement('input');
    notifyInput.type = 'url';
    notifyInput.placeholder = 'https://...';
    notifyInput.setAttribute('data-testid', 'sparql-editor-notify-url-input');
    notifyInput.style.cssText = 'width: 180px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 11px;';
    notifyContainer.appendChild(notifyLabel);
    notifyContainer.appendChild(notifyInput);

    asyncCheckbox.addEventListener('change', function() {
        asyncEnabled = asyncCheckbox.checked;
        notifyContainer.style.display = asyncEnabled ? 'flex' : 'none';
        if (!asyncEnabled) {
            notifyInput.value = '';
            asyncNotificationUrl = '';
        }
    });

    notifyInput.addEventListener('input', function() {
        asyncNotificationUrl = notifyInput.value.trim();
    });

    settingsPopover.appendChild(asyncCheckboxContainer);
    settingsPopover.appendChild(notifyContainer);
    document.body.appendChild(settingsPopover);

    // Toggle popover on gear button click
    gearButton.addEventListener('click', function(e) {
        e.stopPropagation();
        if (settingsPopover.style.display === 'none') {
            var rect = gearButton.getBoundingClientRect();
            settingsPopover.style.left = rect.left + 'px';
            settingsPopover.style.top = (rect.bottom + 4) + 'px';
            settingsPopover.style.display = 'block';
        } else {
            settingsPopover.style.display = 'none';
        }
    });

    // Close popover on outside click
    document.addEventListener('click', function(e) {
        if (settingsPopover.style.display !== 'none' &&
            !settingsPopover.contains(e.target) &&
            !gearButton.contains(e.target)) {
            settingsPopover.style.display = 'none';
        }
    });

    buttonBar.appendChild(gearButton);

    // Run button
    var runButton = createElement('button', {
        id: 'execute-query-existing', // Add ID so executeViewQuery can find it
        type: 'button',
        title: 'Execute SPARQL query',
        'data-testid': 'sparql-editor-run-btn',
        style: {
            padding: '2px',
            border: '1px solid #2563eb',
            background: '#2563eb',
            color: '#fff',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px'
        }
    });

    // Create stopwatch SVG (same as client.js)
    var runSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    runSvg.setAttribute("width", "12");
    runSvg.setAttribute("height", "12");
    runSvg.setAttribute("viewBox", "0 0 24 24");
    runSvg.setAttribute("fill", "none");
    runSvg.setAttribute("stroke", "currentColor");
    runSvg.setAttribute("stroke-width", "1");
    runSvg.setAttribute("stroke-linecap", "round");
    runSvg.setAttribute("stroke-linejoin", "round");
    
    var runPath1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    runPath1.setAttribute("d", "M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0z");
    var runPath2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    runPath2.setAttribute("d", "M14.5 10.5l-2.5 2.5");
    var runPath3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    runPath3.setAttribute("d", "M17 8l1 -1");
    var runPath4 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    runPath4.setAttribute("d", "M14 3h-4");
    
    runSvg.appendChild(runPath1);
    runSvg.appendChild(runPath2);
    runSvg.appendChild(runPath3);
    runSvg.appendChild(runPath4);
    runButton.appendChild(runSvg);

    // Save button
    var saveButton = null;
    if (options.showSaveButton && viewUrl) {
        saveButton = createElement('button', {
            type: 'button',
            title: 'Save query to view',
            'data-testid': 'sparql-editor-save-btn',
            style: {
                padding: '2px',
                border: '1px solid #059669',
                background: "#059669 url('images/file-upload.svg') no-repeat center",
                backgroundSize: '12px 12px',
                color: '#fff',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px'
            }
        });
    }

    // Reset button
    var resetButton = null;
    if (options.showResetButton) {
        resetButton = createElement('button', {
            type: 'button',
            title: 'Reset to original query',
            'data-testid': 'sparql-editor-reset-btn',
            style: {
                padding: '2px',
                border: '1px solid #dc2626',
                background: '#dc2626',
                color: '#fff',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px'
            }
        });

        // Create rotate SVG (same as client.js)
        var resetSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        resetSvg.setAttribute("width", "12");
        resetSvg.setAttribute("height", "12");
        resetSvg.setAttribute("viewBox", "0 0 24 24");
        resetSvg.setAttribute("fill", "none");
        resetSvg.setAttribute("stroke", "currentColor");
        resetSvg.setAttribute("stroke-width", "1");
        resetSvg.setAttribute("stroke-linecap", "round");
        resetSvg.setAttribute("stroke-linejoin", "round");
        
        var resetPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        resetPath.setAttribute("d", "M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5");
        
        resetSvg.appendChild(resetPath);
        resetButton.appendChild(resetSvg);
        buttonBar.appendChild(resetButton);
    }

    // Close button (for DydraClient integration)
    var closeButton = null;
    if (options.showCloseButton) {
        closeButton = createElement('button', {
            type: 'button',
            title: 'Close view dialog',
            'data-testid': 'sparql-editor-close-btn',
            style: {
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                padding: '0',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        });
        
        // Create close SVG
        var closeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        closeSvg.setAttribute("width", "20");
        closeSvg.setAttribute("height", "20");
        closeSvg.setAttribute("viewBox", "0 0 24 24");
        closeSvg.setAttribute("fill", "none");
        closeSvg.setAttribute("stroke", "currentColor");
        closeSvg.setAttribute("stroke-width", "1");
        closeSvg.setAttribute("stroke-linecap", "round");
        closeSvg.setAttribute("stroke-linejoin", "round");
        
        var closePath1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        closePath1.setAttribute("d", "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z");
        var closePath2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        closePath2.setAttribute("d", "M9 9l6 6m0 -6l-6 6");
        
        closeSvg.appendChild(closePath1);
        closeSvg.appendChild(closePath2);
        closeButton.appendChild(closeSvg);
        
        // Add close event handler
        closeButton.addEventListener('click', function() {
            if (dialog && dialog.closeViewDialog) {
                dialog.closeViewDialog();
            } else if (options.onClose) {
                options.onClose();
            }
        });
        
        buttonBar.appendChild(closeButton);
    }

    // Assemble button bar
    buttonBar.appendChild(runButton);
    if (saveButton) {
        buttonBar.appendChild(saveButton);
    }
    if (resetButton) {
        buttonBar.appendChild(resetButton);
    }
    if (closeButton) {
        buttonBar.appendChild(closeButton);
    }

    // Assemble header
    header.appendChild(toggleButton);
    header.appendChild(headerText);
    header.appendChild(buttonBar);
    
    // Ensure cursor is only on header, not inherited by children
    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    
    // Reset cursor for interactive elements within header
    const interactiveElements = header.querySelectorAll('button, select, input, a');
    interactiveElements.forEach(el => {
        el.style.cursor = 'pointer';
    });

    // Query editor (Yasqe or textarea fallback)
    var queryEditorContainer = createElement('div', {
        id: 'view-query-container',
        style: {
            width: '100%',
            margin: '0px',
            boxSizing: 'border-box'
        }
    });


    // SIMPLE DOUBLE-CLICK: Same as toggle button
    if (options.showEditorToggle) {
        headerText.addEventListener('dblclick', function() {
            isContentVisible = !isContentVisible;
            
            // Show/hide query editor and results (always together)
            queryEditorContainer.style.display = isContentVisible ? 'block' : 'none';
            if (resultsTabsContainer) {
                resultsTabsContainer.style.display = isContentVisible ? 'block' : 'none';
            }
            
            // Show/hide log if it exists
            if (eventLogContainer) {
                eventLogContainer.style.display = isContentVisible ? 'block' : 'none';
            }
            
            // Update toggle button icon
            toggleButton.innerHTML = '';
            toggleButton.appendChild(isContentVisible ? caretDownSvg.cloneNode(true) : caretRightSvg.cloneNode(true));
            
            // Adjust panel size
            setTimeout(adjustEditorSize, 10);
        });
    }

    // Extract schema for autocomplete if DydraClient is available
    var schemaData = {};
    if (dydraClient && accountName && repositoryName) {
        try {
            // Try to get schema data synchronously from cached data
            const repoData = dydraClient.getRepositoryDataFromCatalog(accountName, repositoryName);
            if (repoData && repoData.prefixes) {
                schemaData.prefixes = repoData.prefixes;
            }
        } catch (error) {
            console.log('Schema data not available:', error.message);
        }
    }
    
    // Defer YASQE initialization until after container is in the DOM and visible
    var queryEditor = null;
    var hiddenQueryInput = null;
    var textarea = null;

    // Parameters container
    var parametersContainer = null;
    var parameterInputs = {};
    
    if (options.parameters && options.parameters.length > 0) {
        parametersContainer = createElement('div', {
            style: {
                id: 'parameters',
                marginTop: '0px',
                marginBottom: '0px',
                paddingTop: '0px',
                paddingBottom: '0px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb'
            }
        });
        
        // Create parameter inputs
        options.parameters.forEach(function(paramName) {
            var paramRow = createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: '0px',
                    marginBottom: '0px',
                    gap: '8px'
                }
            });
            
            var paramLabel = createElement('label', {
                style: {
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#374151',
                    minWidth: '80px',
                    textAlign: 'right'
                }
            }, [paramName + ':']);
            
            var paramInput = createElement('input', {
                type: 'text',
                placeholder: 'Enter value for ' + paramName,
                'data-testid': 'sparql-editor-param-input-' + paramName,
                style: {
                    flex: '1',
                    padding: '4px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                    outline: 'none'
                }
            });
            
            paramRow.appendChild(paramLabel);
            paramRow.appendChild(paramInput);
            parametersContainer.appendChild(paramRow);
            
            // Store reference to input for later use
            parameterInputs[paramName] = paramInput;
        });
    }

    // Results container
    // Use existing results-tabs-container from dialog if available, otherwise create one
    var resultsTabsContainer = null;
    var createdResultsContainer = false;
    
    if (dialog) {
        // Try to find existing results container in the dialog
        resultsTabsContainer = dialog.querySelector('#results-tabs-container');
        console.log('Looking for existing results container in dialog:', !!resultsTabsContainer);
    }
    
    if (!resultsTabsContainer) {
        // Create tabbed results system if not found in dialog
        console.log('Creating new results container');
        resultsTabsContainer = createElement('div', {
            id: 'results-tabs-container',
            style: {
                marginTop: '1px',
                minHeight: '100px',
                maxHeight: 'none', // Remove height restriction to allow content to determine size
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb',
                display: 'none',
                cursor: 'default', // Ensure no drag cursor inheritance
                overflow: 'visible' // Allow content to extend naturally
            }
        });
        createdResultsContainer = true;
    }
    
    console.log('Results container final state:', { 
        exists: !!resultsTabsContainer, 
        created: createdResultsContainer,
        id: resultsTabsContainer ? resultsTabsContainer.id : 'null'
    });
    
    // Create tabs list
    var tabsList = createElement('div', {
        id: 'results-tabs-list',
        style: {
            display: 'flex',
            padding: '8px 8px 0 8px',
            borderBottom: '1px solid #e5e7eb',
            background: '#f8f9fa',
            borderRadius: '6px 6px 0 0',
            overflowX: 'auto'
        }
    });
    
    // Create results content area
    var resultsContent = createElement('div', {
        id: 'results-tabs-content',
        style: {
            padding: '0px',
            minHeight: '100px',
            maxHeight: '400px',
            overflow: 'auto'
        }
    });
    
    resultsTabsContainer.appendChild(tabsList);
    resultsTabsContainer.appendChild(resultsContent);
    
    // Keep the old resultsContainer for backward compatibility
    var resultsContainer = resultsContent;


    // Event log container (optional)
    var eventLogContainer = null;
    var eventLogDiv = null;
    
    // Only create the event log container if showEventLog is not undefined
    if (options.showEventLog !== undefined) {
        eventLogContainer = createElement('div', {
            style: {
                marginTop: '1px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb',
                height: options.eventLogHeight,
                display: eventLogVisible ? 'flex' : 'none',
                flexDirection: 'column',
                resize: 'vertical',
                overflow: 'hidden',
                minHeight: '100px',
                maxHeight: '400px'
            }
        });

        // Event log header
        var eventLogHeader = createElement('div', {
            style: {
                padding: '8px 12px',
                borderBottom: '1px solid #e5e7eb',
                background: '#f3f4f6',
                fontSize: '12px',
                fontWeight: '600',
                color: '#374151',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }
        });

        var eventLogTitle = createElement('span', {}, ['Event Log']);
        var clearLogButton = createElement('button', {
            type: 'button',
            title: 'Clear event log',
            style: {
                padding: '2px 6px',
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#6b7280',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
            }
        }, ['Clear']);

        eventLogHeader.appendChild(eventLogTitle);
        eventLogHeader.appendChild(clearLogButton);

        // Event log content - must be scrollable
        eventLogDiv = createElement('div', {
            style: {
                flex: '1',
                minHeight: '0',  // Required for flex child to scroll properly
                padding: '8px 12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#374151',
                overflowY: 'auto',
                overflowX: 'auto',
                background: '#fff'
            }
        });

        eventLogContainer.appendChild(eventLogHeader);
        eventLogContainer.appendChild(eventLogDiv);

        // Clear log functionality
        clearLogButton.addEventListener('click', function() {
            eventLogDiv.innerHTML = '';
        });

        // Double-click header to hide log
        eventLogHeader.addEventListener('dblclick', function() {
            if (eventLogContainer.style.display === 'none') {
                eventLogContainer.style.display = 'block';
                if (eventLogToggleButton) {
                    eventLogToggleButton.textContent = 'Hide Log';
                }
            } else {
                eventLogContainer.style.display = 'none';
                if (eventLogToggleButton) {
                    eventLogToggleButton.textContent = 'Show Log';
                }
            }
            setTimeout(adjustEditorSize, 10);
        });

    }

    // Event log toggle functionality (only if event log exists)
    if (eventLogToggleButton) {
        eventLogToggleButton.addEventListener('click', function() {
            eventLogVisible = !eventLogVisible;
            
            // Update button appearance
            eventLogToggleButton.style.background = eventLogVisible ? '#6b7280' : '#ffffff';
            eventLogToggleButton.style.color = eventLogVisible ? '#ffffff' : '#6b7280';
            eventLogToggleButton.title = eventLogVisible ? 'Hide event log' : 'Show event log';
            
            // Show/hide event log container
            eventLogContainer.style.display = eventLogVisible ? 'flex' : 'none';
            
            // Adjust editor size after toggling event log
            setTimeout(adjustEditorSize, 10);
        });
    }

    // SIMPLE STRUCTURE: Exactly as requested
    // 1. Header at the top
    panel.appendChild(header);
    
    // 2. Query editor element under that (Yasqe or textarea)
    panel.appendChild(queryEditorContainer);
    
    // Initialize query editor only after panel and container are attached and visible
    // Ensure visibility before initializing to avoid CodeMirror gutter mis-measurement
    setTimeout(function() {
        try {
            var isVisible = panel.offsetParent !== null && queryEditorContainer.offsetWidth > 0;
            if (!isVisible) {
                // Temporarily force visibility for measurement
                var prevDisplay = queryEditorContainer.style.display;
                queryEditorContainer.style.display = 'block';
                isVisible = queryEditorContainer.offsetWidth > 0;
                queryEditorContainer.style.display = prevDisplay || '';
            }
            console.log("initialQuery", initialQuery);
            // Create query editor using Yasqe wrapper
            queryEditor = createQueryEditor(queryEditorContainer, {
                useYasqe: options.useYasqe !== false,
                initialQuery: initialQuery,
                readOnly: false,
                enableAutocomplete: options.enableAutocomplete !== false,
                prefixes: schemaData.prefixes || {},
                endpoint: viewUrl,
                schema: schemaData
            });
            
            // Create hidden input and wire change sync
            hiddenQueryInput = createElement('input', {
                id: 'view-query',
                type: 'hidden',
                value: queryEditor.getValue()
            });
            panel.appendChild(hiddenQueryInput);
            
            queryEditor.on('change', function() {
                hiddenQueryInput.value = queryEditor.getValue();
            });
            
            // Add blur event listener for synchronization
            queryEditor.on('blur', function() {
                if (options.onQueryBlur) {
                    options.onQueryBlur(queryEditor.getValue());
                }
            });
            
            // Proxy for compatibility
            textarea = {
                value: queryEditor.getValue(),
                get value() { return queryEditor.getValue(); },
                set value(val) {
                    queryEditor.setValue(val);
                    hiddenQueryInput.value = val;
                },
                addEventListener: function(event, callback) { queryEditor.on(event, callback); },
                focus: function() { queryEditor.focus(); },
                style: queryEditorContainer.style,
                id: 'view-query'
            };
            
            // Attach listeners now that textarea proxy is defined
            if (textarea && textarea.addEventListener) {
                textarea.addEventListener('input', function() {
                    currentQuery = textarea.value;
                    if (options.onQueryChanged) {
                        options.onQueryChanged(currentQuery);
                    }
                });
                textarea.addEventListener('blur', function() {
                    if (options.onQueryBlur) {
                        options.onQueryBlur(textarea.value);
                    }
                });
                textarea.addEventListener('keydown', function(e) {
                    if (e.ctrlKey || e.metaKey) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            executeQuery();
                        }
                    }
                });
            }
            
            // After first layout, force refresh to recompute gutters
            setTimeout(function() {
                if (queryEditor && queryEditor.refresh) {
                    queryEditor.refresh();
                }
            }, 0);
        } catch (e) {
            console.error('Failed to initialize query editor after attach:', e);
        }
    }, 0);
    
    // 3. Hidden input for compatibility with executeViewQuery is added after editor init
    
    // 4. Results tabs element under that (always present)
    if (resultsTabsContainer) {
        panel.appendChild(resultsTabsContainer);
    }
    
    // 5. Log element last (if included)
    if (eventLogContainer) {
        panel.appendChild(eventLogContainer);
    }
    
    // Set initial visibility - collapsed shows only header, expanded shows all
    var isExpanded = options.initialState === 'open';
    queryEditorContainer.style.display = isExpanded ? 'block' : 'none';
    if (resultsTabsContainer) {
        resultsTabsContainer.style.display = isExpanded ? 'block' : 'none';
    }
    if (eventLogContainer) {
        eventLogContainer.style.display = isExpanded ? 'block' : 'none';
    }

    // Event logging function
    function logEvent(message, type) {
        // Always log to console
        console.log(message);
        
        if (options.showEventLog === undefined) {
            // Use notification buffer when showEventLog is undefined
            if (typeof Utils !== 'undefined' && Utils.eventBus) {
                Utils.eventBus.emit('notification', {
                    type: type || 'info',
                    title: 'SPARQL Editor',
                    message: message
                });
            }
        } else if (eventLogDiv) {
            // Log to event log if available
            var timestamp = new Date().toLocaleTimeString();
            var logEntry = createElement('div', {
                style: {
                    marginBottom: '2px',
                    padding: '2px 0',
                    borderBottom: '1px solid #f3f4f6',
                    color: type === 'error' ? '#dc2626' : type === 'warning' ? '#f59e0b' : '#374151'
                }
            }, [`[${timestamp}] ${message}`]);
            
            eventLogDiv.appendChild(logEntry);
            
            // Auto-scroll to bottom
            eventLogDiv.scrollTop = eventLogDiv.scrollHeight;
            
            // Limit log entries to prevent memory issues
            var maxEntries = 100;
            while (eventLogDiv.children.length > maxEntries) {
                eventLogDiv.removeChild(eventLogDiv.firstChild);
            }
        }
    }

    // State management
    var isContentVisible = options.initialState === 'open';
    var currentQuery = initialQuery;
    var isExecuting = false;
    var hasLoadedInitial = false;
    
    // Tab management for execution results
    var queryTabs = [];
    var activeTabId = null;

    // SIMPLE TOGGLE: Collapsed = header only, Expanded = header + textarea + results + log
    toggleButton.addEventListener('click', function() {
        isContentVisible = !isContentVisible;
        
        // Show/hide editor container and results (always together)
        if (textarea) {
            textarea.style.display = isContentVisible ? 'block' : 'none';
        }
        if (queryEditorContainer) {
            queryEditorContainer.style.display = isContentVisible ? 'block' : 'none';
        }
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = isContentVisible ? 'block' : 'none';
        }
        
        // Show/hide log if it exists
        if (eventLogContainer) {
            eventLogContainer.style.display = isContentVisible ? 'block' : 'none';
        }
        
        // Update toggle button icon
        toggleButton.innerHTML = '';
        toggleButton.appendChild(isContentVisible ? caretDownSvg.cloneNode(true) : caretRightSvg.cloneNode(true));
        
        // Adjust panel size
        setTimeout(function() {
            if (isContentVisible && queryEditor && queryEditor.refresh) {
                queryEditor.refresh();
            }
            adjustEditorSize();
        }, 10);
    });

    // Execute query functionality (copied from client.js)
    function executeQuery() {
        logEvent('=== EXECUTE QUERY START ===');
        logEvent('isExecuting: ' + isExecuting);
        
        if (isExecuting) return;
        
        var query = textarea ? textarea.value.trim() : '';
        logEvent('Query length: ' + query.length);
        logEvent('Query preview: ' + query.substring(0, 100));
        
        if (!query) {
            logEvent('No query provided, showing error', 'warning');
            logEvent('Please enter a SPARQL query');
            return;
        }
        
        isExecuting = true;
        setExecuteButtonState('executing');
        
        var startTime = Date.now();
        logEvent('Execution started at: ' + startTime);
        
        // Extract account and repository from viewUrl if available
        var accountName = null;
        var repositoryName = null;
        if (viewUrl) {
            var urlParts = viewUrl.split('/');
            var sparqlIndex = urlParts.indexOf('sparql');
            if (sparqlIndex >= 2) {
                accountName = urlParts[sparqlIndex - 2];
                repositoryName = urlParts[sparqlIndex - 1];
            }
        }
        logEvent('Extracted account/repo: ' + accountName + ', ' + repositoryName);
        
        // Use the provided sparqlEndpoint or construct from viewUrl
        var endpoint = config.sparqlEndpoint;
        if (!endpoint && viewUrl) {
            // Extract host from viewUrl
            var url = new URL(viewUrl);
            var pathParts = url.pathname.split('/').filter(function(part) { return part; });
            if (pathParts.length >= 2) {
                endpoint = url.origin + '/' + pathParts[0] + '/' + pathParts[1] + '/sparql';
            }
        }
        
        logEvent('SPARQL endpoint: ' + endpoint);
        
        // Add parameters to endpoint URL if any are provided
        if (options.parameters && options.parameters.length > 0) {
            var urlParams = new URLSearchParams();
            var hasParams = false;
            
            options.parameters.forEach(function(paramName) {
                var input = parameterInputs[paramName];
                if (input && input.value && input.value.trim()) {
                    var paramValue = input.value.trim();
                    urlParams.append('$' + paramName, paramValue);
                    hasParams = true;
                    logEvent('Added parameter: $' + paramName + ' = ' + paramValue);
                }
            });
            
            if (hasParams) {
                endpoint += (endpoint.includes('?') ? '&' : '?') + urlParams.toString();
                logEvent('Updated endpoint with parameters: ' + endpoint);
            }
        }
        
        // Add revision parameter if selected
        if (revisionSelect && revisionSelect.value && revisionSelect.value !== 'HEAD') {
            endpoint += (endpoint.includes('?') ? '&' : '?') + 'revision=' + encodeURIComponent(revisionSelect.value);
            logEvent('Added revision parameter: ' + revisionSelect.value);
        }

        if (!endpoint) {
            logEvent('No endpoint available, showing error', 'error');
            logEvent('No SPARQL endpoint configured');
            isExecuting = false;
            setExecuteButtonState('ready');
            return;
        }

        logEvent('Executing query against endpoint: ' + endpoint);

        var headers = {
            'Content-Type': 'application/sparql-query',
            'Accept': mediaTypeSelect ? mediaTypeSelect.value : 'application/sparql-results+json'
        };
        
        if (effectiveToken) {
            headers['Authorization'] = effectiveToken;
        }
        if (asyncEnabled) {
            headers['AcceptAsynchronous'] = 'notify';
            logEvent('Async mode enabled');
        }
        if (asyncNotificationUrl) {
            headers['Asynchronous-Location'] = asyncNotificationUrl;
            logEvent('Notification URL: ' + asyncNotificationUrl);
        }

        console.log('Fetch request details:', {
            url: endpoint,
            method: 'POST',
            headers: headers,
            bodyLength: query.length
        });
        
        fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: query
        })
        .then(function(response) {
            console.log('Fetch request completed. Response status:', response.status, response.statusText);
            console.log('Response headers:', [...response.headers.entries()]);
            
            if (!response.ok) {
                return response.text().then(function(errorText) {
                    var errorMessage = 'Query failed: ' + response.status + ' ' + response.statusText;
                    if (errorText && errorText.trim()) {
                        try {
                            var errorData = JSON.parse(errorText);
                            if (errorData.message) {
                                errorMessage = errorData.message;
                            } else if (errorData.error) {
                                errorMessage = errorData.error;
                            } else {
                                errorMessage = errorText;
                            }
                        } catch (parseError) {
                            errorMessage = errorText;
                        }
                    }
                    throw new Error(errorMessage);
                });
            }
            
            var executionTime = Date.now() - startTime;
            var responseEtag = response.headers.get('etag') || '';

            // Handle 202 Accepted (asynchronous request)
            if (response.status === 202) {
                var jobLocation = response.headers.get('Location') || '';
                logEvent('Asynchronous request accepted. Job: ' + jobLocation);
                createQueryTab(query, { type: 'async', message: 'Asynchronous request accepted.\nJob location: ' + jobLocation }, executionTime, responseEtag);
                isExecuting = false;
                setExecuteButtonState('ready');
                return;
            }

            var contentType = response.headers.get('content-type') || '';
            console.log('Response OK, processing response... Content-Type:', contentType);

            // Handle different media types based on selected media type, not response content type
            var selectedMediaType = mediaTypeSelect ? mediaTypeSelect.value : 'application/sparql-results+json';
            console.log('Selected media type:', selectedMediaType);
            console.log('Response content type:', contentType);
            
            if (selectedMediaType === 'application/sparql-results+json' || selectedMediaType === 'application/json') {
                console.log('=== JSON PROCESSING START ===');
                console.log('Content-Type:', contentType);
                console.log('Response status:', response.status);
                
                return response.json().then(function(data) {
                    console.log('JSON parsing successful, results:', data);
                    console.log('Data structure:', {
                        hasResults: !!data.results,
                        hasBindings: !!(data.results && data.results.bindings),
                        hasHead: !!data.head,
                        hasVars: !!(data.head && data.head.vars),
                        bindingsCount: data.results?.bindings?.length || 0,
                        variables: data.head?.vars || []
                    });
                    
                    // Call custom callback if provided
                    if (options.onQueryExecuted) {
                        console.log('Using custom onQueryExecuted callback');
                        options.onQueryExecuted({
                            query: query,
                            results: data,
                            mediaType: contentType,
                            executionTime: executionTime
                        });
                    }
                    
                    // Create tab for this execution
                    console.log('Creating tab for JSON results');
                    createQueryTab(query, data, executionTime, responseEtag);
                });
            } else if (selectedMediaType === 'application/sparql-results+xml') {
                return response.text().then(function(text) {
                    console.log('XML response received, length:', text.length);

                    // Create tab for XML results
                    console.log('Creating tab for XML results');
                    var xmlResults = {
                        type: 'xml',
                        content: text,
                        formatted: formatXml(text)
                    };
                    createQueryTab(query, xmlResults, executionTime, responseEtag);
                });
            } else if (selectedMediaType === 'image/vnd.dydra.SPARQL-RESULTS+GRAPHVIZ+SVG+XML') {
                return response.text().then(function(text) {
                    console.log('SVG response received, length:', text.length);

                    // Create tab for SVG results
                    console.log('Creating tab for SVG results');
                    var svgResults = {
                        type: 'svg',
                        content: text
                    };
                    createQueryTab(query, svgResults, executionTime, responseEtag);
                });
            } else if (selectedMediaType === 'text/html') {
                console.log('=== HTML PROCESSING START ===');
                console.log('Selected media type:', selectedMediaType);
                console.log('View URL:', viewUrl);
                
                // HTML results - fetch view HTML page and open in new window
                // Extract account, repository, and view from viewUrl
                var accountName = null;
                var repositoryName = null;
                var viewName = 'unknown';
                
                if (viewUrl) {
                    try {
                        var url = new URL(viewUrl);
                        var pathParts = url.pathname.split('/').filter(function(part) { return part; });
                        console.log('URL path parts:', pathParts);
                        
                        // Try to find the pattern: system/accounts/account/repositories/repo/views/view
                        var accountsIndex = pathParts.indexOf('accounts');
                        var repositoriesIndex = pathParts.indexOf('repositories');
                        var viewsIndex = pathParts.indexOf('views');
                        
                        if (accountsIndex !== -1 && repositoriesIndex !== -1 && viewsIndex !== -1) {
                            // Full system path format
                            accountName = pathParts[accountsIndex + 1];
                            repositoryName = pathParts[repositoriesIndex + 1];
                            viewName = pathParts[viewsIndex + 1];
                            
                            console.log('Extracted from system path - account:', accountName, 'repo:', repositoryName, 'view:', viewName);
                        } else if (pathParts.length >= 3) {
                            // Direct path format: account/repo/view
                            accountName = pathParts[0];
                            repositoryName = pathParts[1];
                            viewName = pathParts[2];
                            
                            console.log('Extracted from direct path - account:', accountName, 'repo:', repositoryName, 'view:', viewName);
                        } else {
                            throw new Error('Cannot extract account/repo/view from URL - insufficient path parts');
                        }
                    } catch (error) {
                        console.error('Error parsing viewUrl:', error);
                        throw new Error('Invalid viewUrl format: ' + viewUrl);
                    }
                } else {
                    throw new Error('No viewUrl provided for HTML request');
                }
                
                // Construct HTML URL: host/account/repo/view.html
                var host = url.origin;
                var viewHtmlUrl = host + '/' + accountName + '/' + repositoryName + '/' + viewName + '.html';
                
                console.log('Fetching HTML page from:', viewHtmlUrl);
                
                return fetch(viewHtmlUrl, {
                    headers: {
                        'Authorization': accessToken
                    }
                })
                .then(function(htmlResponse) {
                    console.log('HTML fetch response status:', htmlResponse.status, htmlResponse.statusText);
                    
                    if (!htmlResponse.ok) {
                        throw new Error('Failed to fetch HTML page: ' + htmlResponse.status + ' ' + htmlResponse.statusText);
                    }
                    return htmlResponse.text();
                })
                .then(function(htmlContent) {
                    console.log('HTML response received, length:', htmlContent.length);
                    console.log('HTML content preview (first 500 chars):', htmlContent.substring(0, 500));
                    
                    var viewPath = accountName + '/' + repositoryName + '/' + viewName;
                    console.log('Opening HTML in new window with path:', viewPath);
                    createHtmlResultsWindow(htmlContent, viewPath);
                    console.log('=== HTML PROCESSING COMPLETE ===');
                })
                .catch(function(error) {
                    console.error('Error fetching HTML page:', error);
                    showResults('Failed to fetch HTML page: ' + error.message, 'error');
                });
            } else {
                return response.text().then(function(text) {
                    console.log('Text response received, length:', text.length);
                    showResults('<div style="font-family: monospace; font-size:12px; white-space:pre-wrap; background:#f8f9fa; padding:12px; border-radius:4px; border:1px solid #e9ecef;">' + escapeHtml(text) + '</div>', 'info');
                });
            }
        })
        .catch(function(error) {
            console.error('Query execution error:', error);
            logEvent('Query execution error: ' + error.message);
        })
        .finally(function() {
            isExecuting = false;
            setExecuteButtonState('ready');
        });
    }

    // Save query functionality
    function saveQuery() {
        if (!viewUrl || !effectiveToken) {
            logEvent('Cannot save: No view URL or access token provided.');
            return;
        }

        var query = textarea.value.trim();
        if (!query) {
            logEvent('Cannot save empty query.');
            return;
        }

        var headers = {
            'Content-Type': 'application/sparql-query',
            'Accept': 'application/n-quads',
            'Authorization': effectiveToken
        };

        fetch(viewUrl, {
            method: 'PUT',
            headers: headers,
            body: query
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(errorText) {
                    throw new Error(response.status + ' ' + response.statusText + ': ' + errorText);
                });
            }
            logEvent('Query saved successfully!');
            
            if (options.onQuerySaved) {
                options.onQuerySaved(query);
            }
        })
        .catch(function(error) {
            logEvent('Failed to save query: ' + error.message);
            console.error('Save error:', error);
        });
    }

    // Display results
    function displayResults(resultText, mediaType, executionTime) {
        resultsContainer.style.display = 'block';
        
        if (mediaType === 'application/sparql-results+json') {
            try {
                var data = JSON.parse(resultText);
                if (data.head && data.results) {
                    displayJsonResults(data, executionTime);
                } else {
                    showResults(resultText, 'text');
                }
            } catch (e) {
                showResults(resultText, 'text');
            }
        } else if (mediaType === 'application/sparql-results+xml') {
            displayXmlResults(resultText, executionTime);
        } else if (mediaType === 'image/vnd.dydra.SPARQL-RESULTS+GRAPHVIZ+SVG+XML') {
            displaySvgResults(resultText, executionTime);
        } else if (mediaType === 'text/html') {
            displayHtmlResults(resultText, executionTime);
        } else if (mediaType === 'text/csv' || mediaType === 'text/tab-separated-values') {
            displayCsvTsvResults(resultText, mediaType, executionTime);
        } else if (mediaType === 'text/turtle' || mediaType === 'application/n-triples' || 
                   mediaType === 'application/rdf+xml' || mediaType === 'application/ld+json') {
            displayRdfResults(resultText, mediaType, executionTime);
        } else if (mediaType === 'application/sparql-query+sse') {
            displaySseResults(resultText, executionTime);
        } else {
            showResults(resultText, 'text');
        }
    }

    function displayJsonResults(data, executionTime) {
        var html = '<div style="margin-bottom: 8px; font-size: 12px; color: #6b7280;">';
        html += 'Execution time: ' + executionTime + 'ms | ';
        html += 'Results: ' + (data.results.bindings ? data.results.bindings.length : 0) + ' rows';
        html += '</div>';
        
        if (data.head && data.head.vars && data.results && data.results.bindings) {
            var headers = data.head.vars;
            html += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
            html += '<thead><tr style="background: #f3f4f6;">';
            headers.forEach(function(header) {
                html += '<th style="border: 1px solid #d1d5db; padding: 8px; text-align: left;">' + escapeHtml(header) + '</th>';
            });
            html += '</tr></thead><tbody>';
            
            data.results.bindings.forEach(function(binding) {
                html += '<tr>';
                headers.forEach(function(header) {
                    var value = binding[header] ? binding[header].value : '';
                    html += '<td style="border: 1px solid #d1d5db; padding: 8px;">' + escapeHtml(value) + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
        } else {
            html += '<pre style="white-space: pre-wrap;">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
        }
        
        resultsContainer.innerHTML = html;
        
        // Adjust editor size after displaying results
        setTimeout(adjustEditorSize, 10);
    }

    function displayXmlResults(xmlText, executionTime) {
        console.log('displayXmlResults called with executionTime:', executionTime);
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        logEvent('XML results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px;">' + escapeHtml(formatXml(xmlText)) + '</pre>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display XML results');
            return;
        }
        
        resultsContent.innerHTML = html;
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        // Adjust editor size after displaying XML results
        setTimeout(adjustEditorSize, 10);
    }

    function displaySvgResults(svgText, executionTime) {
        console.log('displaySvgResults called with executionTime:', executionTime);
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        logEvent('SVG results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<div style="text-align: center; max-height: 400px; overflow: auto;">' + svgText + '</div>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display SVG results');
            return;
        }
        
        resultsContent.innerHTML = html;
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        // Adjust editor size after displaying SVG results
        setTimeout(adjustEditorSize, 10);
    }

    function displayHtmlResults(htmlText, executionTime) {
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        logEvent('HTML results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px; background: white;">' + htmlText + '</div>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display HTML results');
            return;
        }
        
        resultsContent.innerHTML = html;
        
        // Adjust editor size after displaying HTML results
        setTimeout(adjustEditorSize, 10);
    }

    function displayCsvTsvResults(text, mediaType, executionTime) {
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        var formatName = mediaType === 'text/csv' ? 'CSV' : 'TSV';
        logEvent(formatName + ' results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<div style="margin-bottom: 8px; font-size: 12px; color: #6b7280;">';
        html += 'Execution time: ' + executionTime + 'ms | Format: ' + formatName;
        html += '</div>';
        html += '<pre style="font-family: monospace; font-size: 12px; line-height: 1.4; background: #f9fafb; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre;">';
        html += escapeHtml(text);
        html += '</pre>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display CSV/TSV results');
            return;
        }
        
        resultsContent.innerHTML = html;
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        // Adjust editor size
        setTimeout(adjustEditorSize, 10);
    }

    function displayRdfResults(text, mediaType, executionTime) {
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        var formatMap = {
            'text/turtle': 'Turtle',
            'application/n-triples': 'N-Triples',
            'application/rdf+xml': 'RDF/XML',
            'application/ld+json': 'JSON-LD'
        };
        var formatName = formatMap[mediaType] || 'RDF';
        logEvent(formatName + ' results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<div style="margin-bottom: 8px; font-size: 12px; color: #6b7280;">';
        html += 'Execution time: ' + executionTime + 'ms | Format: ' + formatName;
        html += '</div>';
        html += '<pre style="font-family: monospace; font-size: 12px; line-height: 1.4; background: #f9fafb; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">';
        html += escapeHtml(text);
        html += '</pre>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display RDF results');
            return;
        }
        
        resultsContent.innerHTML = html;
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        // Adjust editor size
        setTimeout(adjustEditorSize, 10);
    }

    function displaySseResults(text, executionTime) {
        // Log completion timestamp and elapsed time
        var completionTime = new Date().toLocaleTimeString();
        logEvent('SSE results completed at: ' + completionTime + ', elapsed time: ' + executionTime + 'ms');
        
        var html = '<div style="margin-bottom: 8px; font-size: 12px; color: #6b7280;">';
        html += 'Execution time: ' + executionTime + 'ms | Format: SSE (SPARQL S-Expressions)';
        html += '</div>';
        html += '<pre style="font-family: monospace; font-size: 12px; line-height: 1.4; background: #f9fafb; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">';
        html += escapeHtml(text);
        html += '</pre>';
        
        if (!resultsContent) {
            console.error('resultsContent is null - cannot display SSE results');
            return;
        }
        
        resultsContent.innerHTML = html;
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        
        // Adjust editor size
        setTimeout(adjustEditorSize, 10);
    }

    function showResults(message, type) {
        if (!resultsContent) {
            console.error('resultsContent is null - cannot show results');
            return;
        }
        
        if (resultsTabsContainer) {
            resultsTabsContainer.style.display = 'block';
        }
        var color = type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#374151';
        var background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#f9fafb';
        
        resultsContent.innerHTML = '<div style="color: ' + color + '; background: ' + background + '; padding: 12px; border-radius: 6px; font-size: 14px;">' + escapeHtml(message) + '</div>';
        
        // Adjust editor size after showing results
        setTimeout(adjustEditorSize, 10);
    }

    function setExecuteButtonState(state) {
        if (state === 'executing') {
            runButton.disabled = true;
            runButton.style.opacity = '0.6';
            runButton.innerHTML = '';
            
            // Create spinner SVG (same as client.js)
            var spinnerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            spinnerSvg.setAttribute("width", "16");
            spinnerSvg.setAttribute("height", "16");
            spinnerSvg.setAttribute("viewBox", "0 0 24 24");
            spinnerSvg.setAttribute("fill", "none");
            spinnerSvg.setAttribute("stroke", "currentColor");
            spinnerSvg.setAttribute("stroke-width", "1");
            spinnerSvg.setAttribute("stroke-linecap", "round");
            spinnerSvg.setAttribute("stroke-linejoin", "round");
            
            var spinnerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            spinnerPath.setAttribute("d", "M21 12a9 9 0 11-6.219-8.56");
            
            spinnerSvg.appendChild(spinnerPath);
            runButton.appendChild(spinnerSvg);
        } else {
            runButton.disabled = false;
            runButton.style.opacity = '1';
            runButton.innerHTML = '';
            runButton.appendChild(runSvg.cloneNode(true));
        }
    }

    // Load initial query if viewUrl is provided
    function loadInitialQuery() {
        if (!viewUrl || !effectiveToken) return;
        
        fetch(viewUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/sparql-query',
                'Authorization': effectiveToken
            }
        })
        .then(function(response) {
            if (response.ok) {
                return response.text();
            }
            throw new Error('Failed to load query: ' + response.status + ' ' + response.statusText);
        })
        .then(function(queryText) {
            textarea.value = queryText;
            currentQuery = queryText;
            hasLoadedInitial = true;
            if (options.onQueryChanged) {
                options.onQueryChanged(queryText);
            }
        })
        .catch(function(error) {
            console.warn('Could not load initial query:', error.message);
            hasLoadedInitial = true; // Mark as attempted even if failed
        });
    }

    // Event listeners
    runButton.addEventListener('click', function() {
        if (!isContentVisible) {
            showResults('Please show the content first.', 'warning');
            return;
        }
        
        // Use DydraClient's executeViewQuery if available (integrated mode)
        if (dydraClient && dialog && accountName && repositoryName && viewName) {
            console.log('Using DydraClient.executeViewQuery');
            dydraClient.executeViewQuery(dialog, accountName, repositoryName, viewName);
        } else {
            // Use standalone execution
            executeQuery();
        }
    });
    
    if (saveButton) {
        saveButton.addEventListener('click', function() {
            if (!isContentVisible) {
                showResults('Please show the content first.', 'warning');
                return;
            }
            saveQuery();
        });
    }
    
    if (resetButton) {
        resetButton.addEventListener('click', function() {
            if (!isContentVisible) {
                showResults('Please show the content first.', 'warning');
                return;
            }
            
            // Refresh query from view location
            if (viewUrl && effectiveToken) {
                logEvent('Refreshing query from view location...');
                loadInitialQuery();
            } else {
                logEvent('Cannot refresh: no view URL or access token available', 'warning');
                showResults('Cannot refresh: no view URL or access token available', 'warning');
            }
            
            // Hide results
            resultsContainer.style.display = 'none';
        });
    }
    
    // Listener attachment moved after editor initialization below

    // Helper functions (copied from client.js)
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatXml(xml) {
        // Simple XML formatting
        var formatted = '';
        var indent = 0;
        var tab = '  ';
        
        // Split by tags but preserve the content
        var parts = xml.split(/(<[^>]*>)/);
        
        parts.forEach(function(part) {
            if (part.startsWith('</')) {
                // Closing tag
                indent--;
                formatted += tab.repeat(Math.max(0, indent)) + part + '\n';
            } else if (part.startsWith('<') && !part.startsWith('</')) {
                // Opening tag
                formatted += tab.repeat(indent) + part + '\n';
                if (!part.includes('/>')) {
                    indent++;
                }
            } else if (part.trim()) {
                // Text content
                formatted += tab.repeat(indent) + part;
            }
        });
        
        return formatted.trim();
    }

    function createSaveButton(container, filename, content, mimeType) {
        var saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.title = 'Save ' + filename;
        saveButton.style.cssText = 
            'position: absolute; top: 8px; right: 8px; padding: 4px; ' +
            'border: 1px solid #28a745; background: #28a745; color: #fff; ' +
            'border-radius: 4px; cursor: pointer; display: flex; ' +
            'align-items: center; justify-content: center; z-index: 10;';
        
        // Create save SVG (same as client.js)
        var saveSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        saveSvg.setAttribute("width", "16");
        saveSvg.setAttribute("height", "16");
        saveSvg.setAttribute("viewBox", "0 0 24 24");
        saveSvg.setAttribute("fill", "none");
        saveSvg.setAttribute("stroke", "currentColor");
        saveSvg.setAttribute("stroke-width", "1");
        saveSvg.setAttribute("stroke-linecap", "round");
        saveSvg.setAttribute("stroke-linejoin", "round");
        
        var savePath1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        savePath1.setAttribute("d", "M14 3v4a1 1 0 0 0 1 1h4");
        var savePath2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        savePath2.setAttribute("d", "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z");
        var savePath3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        savePath3.setAttribute("d", "M12 11v6");
        var savePath4 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        savePath4.setAttribute("d", "M9.5 13.5l2.5 -2.5l2.5 2.5");
        
        saveSvg.appendChild(savePath1);
        saveSvg.appendChild(savePath2);
        saveSvg.appendChild(savePath3);
        saveSvg.appendChild(savePath4);
        saveButton.appendChild(saveSvg);
        
        // Add click handler
        saveButton.addEventListener('click', function() {
            saveFileDialog(filename, content, mimeType);
        });
        
        return saveButton;
    }

    function saveFileDialog(filename, content, mimeType) {
        // Create a blob with the content
        var blob = new Blob([content], { type: mimeType });
        var url = URL.createObjectURL(blob);
        
        // Create a temporary download link
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        
        // Trigger download
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up
        URL.revokeObjectURL(url);
    }

    function createHtmlResultsWindow(htmlContent, viewPath) {
        console.log('=== createHtmlResultsWindow START ===');
        console.log('HTML content length:', htmlContent.length);
        console.log('View path:', viewPath);
        
        // Open window and write HTML content directly (avoiding data URL)
        try {
            console.log('Opening window and writing HTML content');
            
            var newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
            console.log('New window opened:', !!newWindow);
            
            if (newWindow) {
                console.log('Writing HTML content to window');
                newWindow.document.title = 'Dydra View: ' + viewPath;
                newWindow.document.write(htmlContent);
                newWindow.document.close();
                newWindow.focus();
                console.log('HTML content written and window focused');
            } else {
                console.warn('Failed to open new window - popup blocked?');
                // Fallback: show error message
                showResults('Failed to open HTML window - popup may be blocked', 'error');
            }
        } catch (error) {
            console.error('Error opening HTML window:', error);
            // Fallback: show error message
            showResults('Failed to open HTML window: ' + error.message, 'error');
        }
        console.log('=== createHtmlResultsWindow COMPLETE ===');
    }

    // Load initial query if needed (only when starting in open state)
    if (options.initialState === 'open' && viewUrl && !initialQuery && effectiveToken) {
        loadInitialQuery();
    }

    // No need to append to container - we're using the existing dialog element
    console.log('✅ Using existing dialog element as panel:', panel);
    console.log('✅ Panel structure:', panel.outerHTML.substring(0, 500));
    
    // Add drag functionality to header after panel structure is assembled
    if (dialog && dydraClient && typeof dydraClient.makeDialogDraggableWithLanes === 'function') {
        console.log('Setting up drag handler for dialog:', dialog);
        console.log('Header found in dialog:', dialog.querySelector('.dialog-header'));
        
        dydraClient.makeDialogDraggableWithLanes(dialog, '.dialog-header');
        console.log('Drag handler registered successfully');
    }
    
    // Adjust editor size to initial state
    setTimeout(adjustEditorSize, 10);

    // Return API object
    console.log('🎁 Returning API object with panel');
    return {
        panel: panel,
        getQuery: function() { return textarea.value; },
        setQuery: function(query) { 
            textarea.value = query; 
            currentQuery = query;
            if (options.onQueryChanged) {
                options.onQueryChanged(query);
            }
        },
        execute: executeQuery,
        save: saveQuery,
        getQueryTabs: function() {
            // Return a copy of query tabs array with serializable data
            return queryTabs.map(function(tab) {
                return {
                    id: tab.id,
                    label: tab.label,
                    query: tab.query,
                    results: tab.results,
                    executionTime: tab.executionTime,
                    resultCount: tab.resultCount,
                    etag: tab.etag,
                    createdAt: tab.createdAt ? tab.createdAt.toISOString() : null
                };
            });
        },
        getCurrentTabId: function() {
            return activeTabId;
        },
        restoreQueryTabs: function(tabsData, currentTabIdToActivate) {
            // Clear existing tabs
            queryTabs = [];
            if (resultsTabsContainer) {
                resultsTabsContainer.innerHTML = '';
            }
            
            // Restore tabs from data
            tabsData.forEach(function(tabData) {
                var tabId = tabData.id || ('tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
                var label = tabData.label || new Date(tabData.createdAt || Date.now()).toLocaleTimeString();
                
                var tab = {
                    id: tabId,
                    label: label,
                    query: tabData.query,
                    results: tabData.results,
                    executionTime: tabData.executionTime,
                    resultCount: tabData.resultCount,
                    etag: tabData.etag || '',
                    createdAt: tabData.createdAt ? new Date(tabData.createdAt) : new Date()
                };
                queryTabs.push(tab);
                
                // Create tab button manually to preserve the original tab ID
                var tabButton = document.createElement('button');
                tabButton.type = 'button';
                tabButton.className = 'query-tab';
                tabButton.dataset.tabId = tabId;
                tabButton.title = 'Executed: ' + tab.createdAt.toLocaleString() + '\nTime: ' + tab.executionTime + 'ms\nResults: ' + tab.resultCount + (tab.etag ? '\nRevision: ' + tab.etag : '');
                tabButton.style.cssText = 'background: #6c757d; color: white; border: none; padding: 4px 8px; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 12px; margin-right: 2px; display: flex; align-items: center; gap: 4px;';
                tabButton.innerHTML = '<span>' + label + '</span><span class="close-tab" style="display:inline-block; color: white; cursor: pointer; padding: 0; margin-left: 4px; font-size: 14px; line-height: 1; user-select: none;" title="Close Tab">×</span>';
                
                // Add event listeners
                tabButton.addEventListener('click', function(e) {
                    if (e.target.classList.contains('close-tab')) {
                        e.stopPropagation();
                        closeTab(tabId);
                    } else {
                        activateTab(tabId);
                    }
                });
                
                if (tabsList) {
                    tabsList.appendChild(tabButton);
                }
            });
            
            // Activate the current tab if specified
            var tabIdToActivate = currentTabIdToActivate || (tabsData.length > 0 ? tabsData[tabsData.length - 1].id : null);
            if (tabIdToActivate && queryTabs.length > 0) {
                var tabToActivate = queryTabs.find(function(t) { return t.id === tabIdToActivate; });
                if (tabToActivate) {
                    activateTab(tabIdToActivate);
                } else if (queryTabs.length > 0) {
                    activateTab(queryTabs[queryTabs.length - 1].id);
                }
            } else if (queryTabs.length > 0) {
                // Activate the last tab if no specific tab is specified
                activateTab(queryTabs[queryTabs.length - 1].id);
            }
        },
        show: function() { 
            isContentVisible = true;
            
            // Show query editor and results (always together)
            queryEditorContainer.style.display = 'block';
            if (resultsTabsContainer) {
                resultsTabsContainer.style.display = 'block';
            }
            
            // Show log if it exists
            if (eventLogContainer) {
                eventLogContainer.style.display = 'block';
            }
            
            // Update toggle button icon
            toggleButton.innerHTML = '';
            toggleButton.appendChild(caretDownSvg.cloneNode(true));
            
            // Adjust panel size
            setTimeout(adjustEditorSize, 10);
        },
        hide: function() { 
            isContentVisible = false;
            
            // Hide query editor and results (always together)
            queryEditorContainer.style.display = 'none';
            if (resultsTabsContainer) {
                resultsTabsContainer.style.display = 'none';
            }
            
            // Hide log if it exists
            if (eventLogContainer) {
                eventLogContainer.style.display = 'none';
            }
            
            // Update toggle button icon
            toggleButton.innerHTML = '';
            toggleButton.appendChild(caretRightSvg.cloneNode(true));
            
            // Adjust panel size
            setTimeout(adjustEditorSize, 10);
        },
        destroy: function() { panel.remove(); }
    };
    }

// Export the function for multiple environments (aligned with sparql-panel.js)
if (typeof window !== 'undefined') {
    // Browser environment - attach to window
    window.createSparqlEditor = createSparqlEditor;
} else if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS environment - export via module.exports
    module.exports = createSparqlEditor;
} else if (typeof define === 'function' && define.amd) {
    // AMD environment - define as AMD module
    define(function() {
        return createSparqlEditor;
    });
} else if (typeof global !== 'undefined') {
    // Node.js global environment
    global.createSparqlEditor = createSparqlEditor;
}
