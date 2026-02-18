/**
 * Yasqe Wrapper Module
 * 
 * Provides a unified interface for both Yasqe editor and fallback textarea.
 * Allows seamless switching between advanced SPARQL editor and simple textarea.
 * 
 * Features:
 * - Yasqe integration with syntax highlighting and autocomplete
 * - Fallback to textarea when Yasqe is not available
 * - Consistent API for query manipulation
 * - Schema support for DydraClient integration
 * - Prefix management
 * - Event handling abstraction
 */

/**
 * Create a query editor (either Yasqe or textarea)
 * @param {HTMLElement} container - Container element for the editor
 * @param {Object} config - Configuration object
 * @param {boolean} config.useYasqe - Whether to use Yasqe (default: true)
 * @param {string} config.initialQuery - Initial query text
 * @param {boolean} config.readOnly - Whether editor is read-only
 * @param {boolean} config.enableAutocomplete - Enable autocomplete features
 * @param {Object} config.prefixes - SPARQL prefixes object
 * @param {string} config.endpoint - SPARQL endpoint URL for schema introspection
 * @param {Object} config.schema - Schema data for autocomplete
 * @returns {Object} Editor API object
 */
function createQueryEditor(container, config = {}) {
    // Default configuration
    const defaultConfig = {
        useYasqe: true,
        initialQuery: '',
        readOnly: false,
        enableAutocomplete: true,
        prefixes: {},
        endpoint: null,
        schema: null
    };
    
    const editorConfig = Object.assign({}, defaultConfig, config);
    
    // Check if Yasqe is available and requested
    if (editorConfig.useYasqe && typeof Yasqe !== 'undefined') {
        return createYasqeEditor(container, editorConfig);
    } else {
        return createTextareaEditor(container, editorConfig);
    }
}

/**
 * Create Yasqe editor instance
 * @param {HTMLElement} container - Container element
 * @param {Object} config - Configuration
 * @returns {Object} Editor API
 */
function createYasqeEditor(container, config) {
    console.log('Creating Yasqe editor with config:', config);
    
    // Yasqe configuration
    const yasqeConfig = {
        value: config.initialQuery || '',
        readOnly: config.readOnly || false,
        lineNumbers: true, // Re-enable; we'll initialize post-visibility and refresh
        lineWrapping: true,
        placeholder: 'Enter your SPARQL query here...',
        
        // Disable built-in buttons since we have our own in the header
        showQueryButton: false,
        showShareButton: false,
        
        // Autocomplete configuration
        autocompleters: config.enableAutocomplete ? [
            'prefixes',
            'variables'
        ] : [],
        
        // Custom prefixes
        prefixes: config.prefixes || {},
        
        // Endpoint for schema introspection
        sparql: {
            endpoint: config.endpoint
        },
        
        // Schema data for autocomplete
        schema: config.schema || {},
        
        // Editor styling
        theme: 'default',
        height: 'auto',
        minHeight: '120px',
        maxHeight: '400px',
        // Disable Yasqe persistence to avoid cross-instance localStorage cache overriding remote
        persistence: { enabled: false }
    };
    
    try {
        // Best-effort: ensure any previous Yasqe local cache does not override remote value
        try {
            // Remove common Yasqe persistence keys
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k === 'yasqe_query' || k.startsWith('yasqe') || k.startsWith('YASQE')) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        const yasqe = new Yasqe(container, yasqeConfig);
        
        // Ensure proper layout: refresh after first paint
        requestAnimationFrame(() => {
            try { yasqe.refresh(); } catch (e) {}
        });
        
        // Hide Yasqe's built-in buttons since we have our own in the header
        setTimeout(() => {
            const shareButton = container.querySelector('.yasqe_queryButton');
            const runButton = container.querySelector('.yasqe_shareButton');
            
            if (shareButton) {
                shareButton.style.display = 'none';
                console.log('Hidden Yasqe share button');
            }
            if (runButton) {
                runButton.style.display = 'none';
                console.log('Hidden Yasqe run button');
            }
            
            // Also try to hide by class names that might be used
            const buttons = container.querySelectorAll('.yasqe_button, .yasqe_queryButton, .yasqe_shareButton, [title*="Share"], [title*="Run"]');
            buttons.forEach(button => {
                if (button.textContent.includes('Share') || button.textContent.includes('Run') || 
                    button.title.includes('Share') || button.title.includes('Run')) {
                    button.style.display = 'none';
                    console.log('Hidden Yasqe button:', button);
                }
            });
        }, 100);
        
        // Ensure remote initial query wins over any internal persistence logic
        try { if (typeof config.initialQuery === 'string') yasqe.setValue(config.initialQuery); } catch (e) {}
        
        // Return unified API
        return {
            getValue: () => yasqe.getValue(),
            setValue: (value) => yasqe.setValue(value),
            on: (event, callback) => yasqe.on(event, callback),
            refresh: () => yasqe.refresh(),
            destroy: () => {
                if (yasqe && yasqe.destroy) {
                    yasqe.destroy();
                }
            },
            focus: () => yasqe.focus(),
            getCursor: () => yasqe.getCursor(),
            setCursor: (pos) => yasqe.setCursor(pos),
            getSelection: () => yasqe.getSelection(),
            setSelection: (range) => yasqe.setSelection(range),
            replaceSelection: (text) => yasqe.replaceSelection(text),
            getLine: (line) => yasqe.getLine(line),
            setLine: (line, text) => yasqe.setLine(line, text),
            getLineCount: () => yasqe.lineCount(),
            insertText: (text) => yasqe.insertText(text),
            undo: () => yasqe.undo(),
            redo: () => yasqe.redo(),
            clearHistory: () => yasqe.clearHistory(),
            markClean: () => yasqe.markClean(),
            isClean: () => yasqe.isClean(),
            getEditor: () => yasqe, // Access to underlying Yasqe instance
            type: 'yasqe'
        };
    } catch (error) {
        console.error('Failed to create Yasqe editor, falling back to textarea:', error);
        return createTextareaEditor(container, config);
    }
}

/**
 * Create fallback textarea editor
 * @param {HTMLElement} container - Container element
 * @param {Object} config - Configuration
 * @returns {Object} Editor API
 */
function createTextareaEditor(container, config) {
    console.log('Creating textarea editor with config:', config);
    
    // Create textarea element
    const textarea = document.createElement('textarea');
    textarea.value = config.initialQuery || '';
    textarea.readOnly = config.readOnly || false;
    textarea.placeholder = 'Enter your SPARQL query here...';
    textarea.style.cssText = `
        width: 100%;
        height: 200px;
        min-height: 120px;
        max-height: 400px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 12px;
        margin: 0px;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 14px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        background: #fff;
    `;
    
    // Append to container
    container.appendChild(textarea);
    
    // Return unified API
    return {
        getValue: () => textarea.value,
        setValue: (value) => {
            textarea.value = value;
            // Trigger change event
            const event = new Event('change', { bubbles: true });
            textarea.dispatchEvent(event);
        },
        on: (event, callback) => textarea.addEventListener(event, callback),
        refresh: () => {
            // Textarea doesn't need refresh, but we can trigger a resize
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        },
        destroy: () => {
            if (textarea && textarea.parentNode) {
                textarea.parentNode.removeChild(textarea);
            }
        },
        focus: () => textarea.focus(),
        getCursor: () => ({ line: 0, ch: textarea.selectionStart }),
        setCursor: (pos) => {
            textarea.selectionStart = pos.ch;
            textarea.selectionEnd = pos.ch;
        },
        getSelection: () => ({
            from: { line: 0, ch: textarea.selectionStart },
            to: { line: 0, ch: textarea.selectionEnd }
        }),
        setSelection: (range) => {
            textarea.selectionStart = range.from.ch;
            textarea.selectionEnd = range.to.ch;
        },
        replaceSelection: (text) => {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
        },
        getLine: (line) => textarea.value.split('\n')[line] || '',
        setLine: (line, text) => {
            const lines = textarea.value.split('\n');
            lines[line] = text;
            textarea.value = lines.join('\n');
        },
        getLineCount: () => textarea.value.split('\n').length,
        insertText: (text) => {
            const start = textarea.selectionStart;
            textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(textarea.selectionEnd);
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
        },
        undo: () => {
            // Textarea doesn't have built-in undo, but we can implement basic history
            console.log('Undo not available in textarea mode');
        },
        redo: () => {
            console.log('Redo not available in textarea mode');
        },
        clearHistory: () => {
            console.log('Clear history not available in textarea mode');
        },
        markClean: () => {
            console.log('Mark clean not available in textarea mode');
        },
        isClean: () => true, // Always consider textarea clean
        getEditor: () => textarea, // Access to underlying textarea element
        type: 'textarea'
    };
}

/**
 * Extract schema data from DydraClient for autocomplete
 * @param {Object} dydraClient - DydraClient instance
 * @param {string} accountName - Account name
 * @param {string} repositoryName - Repository name
 * @returns {Object} Schema data for Yasqe
 */
async function extractSchemaForAutocomplete(dydraClient, accountName, repositoryName) {
    try {
        if (!dydraClient || !accountName || !repositoryName) {
            return {};
        }
        
        // Get repository metadata
        const repoData = await dydraClient.getRepositoryData(accountName, repositoryName);
        
        // Extract prefixes
        const prefixes = {};
        if (repoData.prefixes) {
            Object.assign(prefixes, repoData.prefixes);
        }
        
        // Extract classes and properties (if available)
        const schema = {
            prefixes: prefixes,
            classes: [],
            properties: []
        };
        
        // Try to get schema from repository if available
        try {
            const schemaData = await dydraClient.getRepositorySchema(accountName, repositoryName);
            if (schemaData) {
                schema.classes = schemaData.classes || [];
                schema.properties = schemaData.properties || [];
            }
        } catch (error) {
            console.log('Schema data not available:', error.message);
        }
        
        return schema;
    } catch (error) {
        console.error('Failed to extract schema for autocomplete:', error);
        return {};
    }
}

// Export functions for global use
if (typeof window !== 'undefined') {
    window.createQueryEditor = createQueryEditor;
    window.extractSchemaForAutocomplete = extractSchemaForAutocomplete;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createQueryEditor,
        extractSchemaForAutocomplete
    };
}
