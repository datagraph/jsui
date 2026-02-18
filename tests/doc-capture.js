/**
 * Documentation Capture Module
 *
 * Provides infrastructure for capturing PDF screenshots mapped to requirements.
 * Each requirement has a dedicated function that validates the requirement
 * and captures before/after states for documentation.
 *
 * Usage:
 *   const { DocCapture, REQ } = require('./doc-capture');
 *   const capture = new DocCapture(page, 'tests/pdfs');
 *   await capture.requirement(REQ['3.2.1'], async (cap) => {
 *     await cap.before('Form displayed with current values');
 *     // ... fill form ...
 *     await cap.after('Form submitted, changes saved');
 *   });
 */

const path = require('path');
const fs = require('fs');

/**
 * Requirements catalog with metadata for documentation
 */
const REQ = {
  // Section 1: Authentication
  '1.1.1': { id: 'REQ-1.1.1', title: 'Basic/Bearer Authentication', section: 'authentication' },
  '1.1.2': { id: 'REQ-1.1.2', title: 'Authenticate Against API', section: 'authentication' },
  '1.1.4': { id: 'REQ-1.1.4', title: 'Multiple Authenticated Accounts', section: 'authentication' },
  '1.2.1': { id: 'REQ-1.2.1', title: 'Session Persistence', section: 'authentication' },
  '1.2.2': { id: 'REQ-1.2.2', title: 'Logout Functionality', section: 'authentication' },
  '1.2.3': { id: 'REQ-1.2.3', title: 'Auth-Based Navigation Links', section: 'authentication' },

  // Section 2: Account Management
  '2.1.1': { id: 'REQ-2.1.1', title: 'Display Account Information', section: 'account' },
  '2.1.2': { id: 'REQ-2.1.2', title: 'View Current Account Details', section: 'account' },
  '2.1.3': { id: 'REQ-2.1.3', title: 'View Other Account Details', section: 'account' },
  '2.2.1': { id: 'REQ-2.2.1', title: 'Edit Account Profile Fields', section: 'account' },
  '2.2.3': { id: 'REQ-2.2.3', title: 'Save Account Configuration', section: 'account' },
  '2.2.4': { id: 'REQ-2.2.4', title: 'Display Authentication Token', section: 'account' },

  // Section 3: Repository Management
  '3.1.1': { id: 'REQ-3.1.1', title: 'Display Repository List', section: 'repository' },
  '3.1.2': { id: 'REQ-3.1.2', title: 'Display Repository Details', section: 'repository' },
  '3.2.1': { id: 'REQ-3.2.1', title: 'Edit Repository Metadata', section: 'repository' },
  '3.2.3': { id: 'REQ-3.2.3', title: 'Save Repository Configuration', section: 'repository' },
  '3.3.1': { id: 'REQ-3.3.1', title: 'Create Repository', section: 'repository' },
  '3.4.3': { id: 'REQ-3.4.3', title: 'Import from URL', section: 'import' },
  '3.4.4': { id: 'REQ-3.4.4', title: 'Import from File Upload', section: 'import' },
  '3.4.5': { id: 'REQ-3.4.5', title: 'Asynchronous Import', section: 'import' },
  '3.4.6': { id: 'REQ-3.4.6', title: 'Import Progress Display', section: 'import' },
  '3.4.7': { id: 'REQ-3.4.7', title: 'Auto-detect File Format', section: 'import' },
  '3.5.1': { id: 'REQ-3.5.1', title: 'Export Repository Data', section: 'export' },
  '3.5.2': { id: 'REQ-3.5.2', title: 'Direct Download URL', section: 'export' },
  '3.6.1': { id: 'REQ-3.6.1', title: 'Clear Repository', section: 'repository' },
  '3.7.1': { id: 'REQ-3.7.1', title: 'Manage Collaborators', section: 'collaboration' },
  '3.7.2': { id: 'REQ-3.7.2', title: 'Add/Edit/Remove Collaborators', section: 'collaboration' },
  '3.7.3': { id: 'REQ-3.7.3', title: 'Save Collaboration Changes', section: 'collaboration' },

  // Section 4: SPARQL Query Management
  '4.1.1': { id: 'REQ-4.1.1', title: 'SPARQL Editor with Syntax Highlighting', section: 'sparql' },
  '4.1.2': { id: 'REQ-4.1.2', title: 'Execute SPARQL Queries', section: 'sparql' },
  '4.1.3': { id: 'REQ-4.1.3', title: 'Multiple Response Media Types', section: 'sparql' },
  '4.1.4': { id: 'REQ-4.1.4', title: 'Display Query Results', section: 'sparql' },
  '4.1.5': { id: 'REQ-4.1.5', title: 'Parameterized Queries', section: 'sparql' },
  '4.1.6': { id: 'REQ-4.1.6', title: 'Query History', section: 'sparql' },
  '4.2.1': { id: 'REQ-4.2.1', title: 'CRUD SPARQL Views', section: 'view' },
  '4.2.2': { id: 'REQ-4.2.2', title: 'Load View Query Text', section: 'view' },
  '4.2.3': { id: 'REQ-4.2.3', title: 'Save View Query Text', section: 'view' },
  '4.2.5': { id: 'REQ-4.2.5', title: 'Open View in Pane Editor', section: 'view' },
  '4.2.6': { id: 'REQ-4.2.6', title: 'Open View in New Pane', section: 'view' },
  '4.2.7': { id: 'REQ-4.2.7', title: 'Open View in New Window', section: 'view' },
  '4.3.2': { id: 'REQ-4.3.2', title: 'Keyboard Shortcuts', section: 'sparql' },
  '4.3.3': { id: 'REQ-4.3.3', title: 'Query Reset', section: 'sparql' },
  '4.3.4': { id: 'REQ-4.3.4', title: 'Execution Time Display', section: 'sparql' },
  '4.3.6': { id: 'REQ-4.3.6', title: 'Multiple Query Tabs', section: 'sparql' },

  // Section 5: Navigation
  '5.1.1': { id: 'REQ-5.1.1', title: 'Client-Side Routing', section: 'navigation' },
  '5.1.2': { id: 'REQ-5.1.2', title: 'Browser Back/Forward', section: 'navigation' },
  '5.2.4': { id: 'REQ-5.2.4', title: 'Location Bar Display', section: 'navigation' },
  '5.2.5': { id: 'REQ-5.2.5', title: 'Tabbed Interface', section: 'navigation' },

  // Section 6: UI Components
  '6.2.1': { id: 'REQ-6.2.1', title: 'Flash Messages', section: 'ui' },
  '6.2.2': { id: 'REQ-6.2.2', title: 'Loading Indicators', section: 'ui' },
  '6.2.3': { id: 'REQ-6.2.3', title: 'Form Validation', section: 'ui' },
  '6.3.1': { id: 'REQ-6.3.1', title: 'Tab Management', section: 'ui' },
  '6.3.2': { id: 'REQ-6.3.2', title: 'Close Tabs', section: 'ui' },

  // Section 9: Error Handling
  '9.1.1': { id: 'REQ-9.1.1', title: 'Authentication Error Messages', section: 'error' },
  '9.1.2': { id: 'REQ-9.1.2', title: 'API Error Messages', section: 'error' },
  '9.1.3': { id: 'REQ-9.1.3', title: '404 Page', section: 'error' },
};

/**
 * Documentation capture state for a single requirement
 */
class CaptureContext {
  constructor(docCapture, req) {
    this.docCapture = docCapture;
    this.req = req;
    this.stepIndex = 0;
  }

  /**
   * Capture "before" state (e.g., form displayed, entity visible)
   * @param {string} description - Description of what is being captured
   */
  async before(description) {
    await this.docCapture._capture(this.req, 'before', description, this.stepIndex);
  }

  /**
   * Capture "after" state (e.g., form submitted, result displayed)
   * @param {string} description - Description of what is being captured
   */
  async after(description) {
    await this.docCapture._capture(this.req, 'after', description, this.stepIndex);
    this.stepIndex++;
  }

  /**
   * Capture an intermediate step
   * @param {string} stepName - Name of the step (e.g., 'form-filled', 'dialog-open')
   * @param {string} description - Description of what is being captured
   */
  async step(stepName, description) {
    await this.docCapture._capture(this.req, stepName, description, this.stepIndex);
  }
}

/**
 * Main documentation capture class
 */
class DocCapture {
  /**
   * @param {import('@playwright/test').Page} page - Playwright page object
   * @param {string} outputDir - Directory for PDF output
   * @param {object} options - Configuration options
   */
  constructor(page, outputDir = 'tests/pdfs', options = {}) {
    this.page = page;
    this.outputDir = outputDir;
    this.options = {
      viewport: { width: 1280, height: 800 },
      enabled: true,  // Set to false to disable captures (for fast test runs)
      ...options
    };
    this.manifest = [];  // Track all captures for index generation

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Execute a requirement test with documentation capture
   * @param {object} req - Requirement object from REQ catalog
   * @param {function} testFn - Async function receiving CaptureContext
   */
  async requirement(req, testFn) {
    const context = new CaptureContext(this, req);
    await testFn(context);
  }

  /**
   * Internal: Perform the actual PDF capture
   * Falls back to PNG screenshot if PDF generation fails (e.g., non-headless mode)
   */
  async _capture(req, phase, description, stepIndex) {
    if (!this.options.enabled) return;

    const baseFilename = this._generateFilename(req, phase, stepIndex);
    const pdfPath = path.join(this.outputDir, baseFilename);
    const pngPath = path.join(this.outputDir, baseFilename.replace('.pdf', '.png'));

    // Use shorter timeout for networkidle to avoid hanging
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(200); // Brief pause for rendering

    let filename = baseFilename;
    let captureType = 'pdf';

    try {
      await this.page.emulateMedia({ media: 'screen' });
      await this.page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

      const toIn = (px) => `${px / 96}in`;
      await this.page.pdf({
        path: pdfPath,
        printBackground: true,
        width: toIn(this.options.viewport.width),
        height: toIn(this.options.viewport.height),
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        pageRanges: '1'
      });
    } catch (pdfError) {
      // Fallback to PNG screenshot (works in headed mode)
      try {
        await this.page.screenshot({
          path: pngPath,
          fullPage: false
        });
        filename = baseFilename.replace('.pdf', '.png');
        captureType = 'png';
      } catch (screenshotError) {
        console.log(`[DocCapture] Warning: Could not capture ${req.id} ${phase}`);
        return;
      }
    }

    // Add to manifest
    this.manifest.push({
      requirement: req.id,
      title: req.title,
      section: req.section,
      phase,
      stepIndex,
      description,
      filename,
      captureType,
      timestamp: new Date().toISOString()
    });

    console.log(`[DocCapture] ${req.id} ${phase}: ${filename}`);
  }

  /**
   * Generate consistent filename from requirement and phase
   */
  _generateFilename(req, phase, stepIndex) {
    const reqSlug = req.id.toLowerCase().replace(/\./g, '-');
    const titleSlug = req.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');
    const stepSuffix = stepIndex > 0 ? `-${stepIndex}` : '';
    return `${reqSlug}-${titleSlug}-${phase}${stepSuffix}.pdf`;
  }

  /**
   * Write manifest file for documentation index
   */
  async writeManifest() {
    const manifestPath = path.join(this.outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));
    console.log(`[DocCapture] Manifest written: ${manifestPath}`);
  }

  /**
   * Generate HTML index of all captures
   */
  async writeIndex() {
    const sections = {};
    for (const entry of this.manifest) {
      if (!sections[entry.section]) {
        sections[entry.section] = [];
      }
      sections[entry.section].push(entry);
    }

    let html = `<!DOCTYPE html>
<html>
<head>
  <title>Dydra JSUI - Requirements Documentation</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { color: #444; margin-top: 30px; }
    .requirement { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
    .requirement h3 { margin: 0 0 10px 0; }
    .captures { display: flex; flex-wrap: wrap; gap: 10px; }
    .capture { background: white; padding: 10px; border-radius: 3px; border: 1px solid #ddd; }
    .capture a { color: #0066cc; text-decoration: none; }
    .capture a:hover { text-decoration: underline; }
    .phase { font-size: 12px; color: #666; text-transform: uppercase; }
    .description { font-size: 14px; color: #333; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>Dydra JSUI - Requirements Documentation</h1>
  <p>Generated: ${new Date().toISOString()}</p>
`;

    for (const [section, entries] of Object.entries(sections)) {
      html += `  <h2>${section.charAt(0).toUpperCase() + section.slice(1)}</h2>\n`;

      // Group by requirement
      const byReq = {};
      for (const entry of entries) {
        if (!byReq[entry.requirement]) {
          byReq[entry.requirement] = { title: entry.title, captures: [] };
        }
        byReq[entry.requirement].captures.push(entry);
      }

      for (const [reqId, data] of Object.entries(byReq)) {
        html += `  <div class="requirement">
    <h3>${reqId}: ${data.title}</h3>
    <div class="captures">
`;
        for (const cap of data.captures) {
          html += `      <div class="capture">
        <div class="phase">${cap.phase}</div>
        <a href="${cap.filename}">${cap.filename}</a>
        <div class="description">${cap.description}</div>
      </div>
`;
        }
        html += `    </div>
  </div>
`;
      }
    }

    html += `</body>
</html>`;

    const indexPath = path.join(this.outputDir, 'index.html');
    fs.writeFileSync(indexPath, html);
    console.log(`[DocCapture] Index written: ${indexPath}`);
  }
}

module.exports = { DocCapture, CaptureContext, REQ };
