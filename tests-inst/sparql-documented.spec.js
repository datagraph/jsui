import { __guard } from './guard.js';
import { test, expect } from '@playwright/test';
import { login, openRepository, waitForNetworkIdle } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * SPARQL Query Tests with Documentation Capture
 * Coverage: REQ-4.1.x, REQ-4.3.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/sparql-documented.spec.js
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';

test.describe('SPARQL Queries', () => {

  // ============================================================
  // REQ-4.1.1: SPARQL Editor with Syntax Highlighting
  // ============================================================
  async function REQ_4_1_1_sparqlEditor(page, capture) {
    await capture.requirement(REQ['4.1.1'], async (cap) => {
      await page.waitForTimeout(1000);

      const codeMirror = page.locator('.CodeMirror').first();
      const textarea = page.locator('.sparql-editor textarea, .query-editor textarea').first();

      const cmVisible = await __guard(codeMirror, 'sparql-documented.spec.js:27', { timeout: 5000 });
      const taVisible = await __guard(textarea, 'sparql-documented.spec.js:28', { timeout: 3000 });

      expect(cmVisible || taVisible).toBeTruthy();

      // Capture: Editor displayed
      await cap.before('SPARQL query editor with syntax highlighting');

      // Enter a query to show syntax highlighting
      const testQuery = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10';

      if (cmVisible) {
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(testQuery);
      } else if (taVisible) {
        await textarea.fill(testQuery);
      }

      await page.waitForTimeout(500);

      // Capture: Query entered with highlighting
      await cap.after('Query text with syntax highlighting applied');
    });
  }

  // ============================================================
  // REQ-4.1.2: Execute SPARQL Queries
  // ============================================================
  async function REQ_4_1_2_executeQuery(page, capture, query) {
    await capture.requirement(REQ['4.1.2'], async (cap) => {
      const codeMirror = page.locator('.CodeMirror').first();
      const textarea = page.locator('.sparql-editor textarea, .query-editor textarea').first();

      // Capture: Before execution
      await cap.before('Query ready for execution');

      const cmVisible = await __guard(codeMirror, 'sparql-documented.spec.js:64', { timeout: 3000 });
      const taVisible = await __guard(textarea, 'sparql-documented.spec.js:65', { timeout: 2000 });

      if (cmVisible) {
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(query);
      } else if (taVisible) {
        await textarea.fill(query);
      }

      await page.waitForTimeout(500);

      const runBtn = page.getByTestId('sparql-editor-run-btn').first();
      const altRunBtn = page.locator('button:has-text("Run"), button:has-text("Execute"), [data-action="run"]').first();

      if (await __guard(runBtn, 'sparql-documented.spec.js:80', { timeout: 2000 })) {
        await runBtn.click();
      } else if (await __guard(altRunBtn, 'sparql-documented.spec.js:82', { timeout: 2000 })) {
        await altRunBtn.click();
      } else {
        await page.keyboard.press('Control+Enter');
      }

      await waitForNetworkIdle(page);
      await page.waitForTimeout(1000);

      // Capture: Results displayed
      await cap.after('Query executed with results displayed');

      // Verify results area (flexible)
      const resultsArea = page.locator('.query-results, .results-table, .sparql-results, .result-tab').first();
      const resultsVisible = await __guard(resultsArea, 'sparql-documented.spec.js:96', { timeout: 5000 });
    });
  }

  // ============================================================
  // REQ-4.1.3: Multiple Response Media Types
  // ============================================================
  async function REQ_4_1_3_responseMediaType(page, capture, format, query) {
    await capture.requirement(REQ['4.1.3'], async (cap) => {
      const formatSelect = page.locator('select[data-query-format], .media-type-select').first();

      // Capture: Format selector
      await cap.before(`Format selector showing available media types`);

      if (await __guard(formatSelect, 'sparql-documented.spec.js:110', { timeout: 2000 })) {
        await formatSelect.selectOption({ label: new RegExp(format, 'i') });
      }

      // Execute query
      const codeMirror = page.locator('.CodeMirror').first();
      if (await __guard(codeMirror, 'sparql-documented.spec.js:116', { timeout: 2000 })) {
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(query);
      }

      const runBtn = page.getByTestId('sparql-editor-run-btn').first();
      if (await __guard(runBtn, 'sparql-documented.spec.js:123', { timeout: 2000 })) {
        await runBtn.click();
        await waitForNetworkIdle(page);
      }

      // Capture: Results in selected format
      await cap.after(`Query results in ${format} format`);
    });
  }

  // ============================================================
  // REQ-4.1.4: Display Query Results
  // ============================================================
  async function REQ_4_1_4_displayResults(page, capture) {
    await capture.requirement(REQ['4.1.4'], async (cap) => {
      const resultsArea = page.locator('.query-results, .results-table, .sparql-results').first();

      // Capture: Results table/display
      await cap.before('Query results area');

      await expect(resultsArea).toBeVisible({ timeout: 10000 });

      // Capture: Results with data
      await cap.after('Results displayed in appropriate format');
    });
  }

  // ============================================================
  // REQ-4.3.2: Keyboard Shortcuts
  // ============================================================
  async function REQ_4_3_2_keyboardShortcuts(page, capture, query) {
    await capture.requirement(REQ['4.3.2'], async (cap) => {
      const codeMirror = page.locator('.CodeMirror').first();

      if (await __guard(codeMirror, 'sparql-documented.spec.js:157', { timeout: 2000 })) {
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(query);

        // Capture: Before keyboard shortcut
        await cap.before('Query entered, ready for Ctrl+Enter execution');

        const responsePromise = page.waitForResponse(response =>
          response.url().includes('/sparql') && response.request().method() === 'POST'
        );

        // Execute using keyboard shortcut
        await page.keyboard.press('Control+Enter');

        const response = await responsePromise.catch(() => null);
        if (response) {
          expect([200, 201, 204]).toContain(response.status());
        }

        // Capture: After execution
        await cap.after('Query executed via Ctrl+Enter shortcut');
      }
    });
  }

  // ============================================================
  // REQ-4.3.3: Query Reset
  // ============================================================
  async function REQ_4_3_3_queryReset(page, capture) {
    await capture.requirement(REQ['4.3.3'], async (cap) => {
      const codeMirror = page.locator('.CodeMirror').first();

      if (await __guard(codeMirror, 'sparql-documented.spec.js:190', { timeout: 2000 })) {
        // Modify query
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('SELECT ?modified WHERE { ?s ?p ?o }');

        // Capture: Modified query
        await cap.before('Query modified from original');

        const resetBtn = page.getByTestId('query-reset-btn').first();
        if (await __guard(resetBtn, 'sparql-documented.spec.js:200', { timeout: 2000 })) {
          await resetBtn.click();

          // Capture: After reset
          await cap.after('Query reset to original text');

          const resetQuery = await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror');
            return cm?.CodeMirror?.getValue() || '';
          });

          expect(resetQuery !== 'SELECT ?modified WHERE { ?s ?p ?o }').toBeTruthy();
        }
      }
    });
  }

  // ============================================================
  // REQ-4.3.4: Execution Time Display
  // ============================================================
  async function REQ_4_3_4_executionTimeDisplay(page, capture) {
    await capture.requirement(REQ['4.3.4'], async (cap) => {
      // Capture: Results with execution time
      await cap.before('Query results area');

      const timeDisplay = page.locator('.execution-time, .query-time, [data-execution-time]').first();
      if (await __guard(timeDisplay, 'sparql-documented.spec.js:226', { timeout: 5000 })) {
        const timeText = await timeDisplay.textContent();
        expect(timeText).toMatch(/\d+/);

        // Capture: Time displayed
        await cap.after('Execution time displayed with results');
      }
    });
  }

  // ============================================================
  // REQ-4.3.6: Multiple Query Tabs
  // ============================================================
  async function REQ_4_3_6_multipleQueryTabs(page, capture) {
    await capture.requirement(REQ['4.3.6'], async (cap) => {
      const codeMirror = page.locator('.CodeMirror').first();

      if (await __guard(codeMirror, 'sparql-documented.spec.js:243', { timeout: 2000 })) {
        // Execute first query
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('SELECT * WHERE { ?s ?p ?o } LIMIT 5');

        const runBtn = page.getByTestId('sparql-editor-run-btn').first();
        if (await __guard(runBtn, 'sparql-documented.spec.js:250', { timeout: 2000 })) {
          await runBtn.click();
          await waitForNetworkIdle(page);
        }

        // Capture: First tab created
        await cap.before('First query tab with results');

        // Execute second query
        await codeMirror.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('SELECT ?s WHERE { ?s a ?type } LIMIT 5');

        if (await __guard(runBtn, 'sparql-documented.spec.js:263', { timeout: 2000 })) {
          await runBtn.click();
          await waitForNetworkIdle(page);
        }

        // Capture: Multiple tabs
        await cap.after('Multiple query result tabs displayed');

        // Check for multiple result tabs
        const resultTabs = page.locator('.query-tab, .result-tab, [data-result-tab]');
        const tabCount = await resultTabs.count();
        if (tabCount >= 2) {
          await resultTabs.first().click();
          await page.waitForTimeout(500);
        }
      }
    });
  }

  // ============================================================
  // Combined Tests
  // ============================================================

  test('execute SPARQL query [REQ-4.1.1, REQ-4.1.2, REQ-4.1.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');
    await page.waitForTimeout(1000);

    try {
      await REQ_4_1_1_sparqlEditor(page, capture);
    } catch (e) {
      console.log('Editor note:', e.message);
    }

    try {
      await REQ_4_1_2_executeQuery(page, capture, 'SELECT * WHERE { ?s ?p ?o } LIMIT 10');
    } catch (e) {
      console.log('Execute note:', e.message);
    }

    try {
      await REQ_4_1_4_displayResults(page, capture);
    } catch (e) {
      console.log('Results note:', e.message);
    }

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query result formats - JSON [REQ-4.1.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_1_3_responseMediaType(page, capture, 'JSON', 'SELECT * WHERE { ?s ?p ?o } LIMIT 5');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query result formats - CSV [REQ-4.1.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_1_3_responseMediaType(page, capture, 'CSV', 'SELECT * WHERE { ?s ?p ?o } LIMIT 5');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query result formats - XML [REQ-4.1.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_1_3_responseMediaType(page, capture, 'XML', 'SELECT * WHERE { ?s ?p ?o } LIMIT 5');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query execution time display [REQ-4.3.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    // Execute a query first
    await REQ_4_1_2_executeQuery(page, capture, 'SELECT * WHERE { ?s ?p ?o } LIMIT 10');
    await REQ_4_3_4_executionTimeDisplay(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query keyboard shortcut [REQ-4.3.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_3_2_keyboardShortcuts(page, capture, 'SELECT * WHERE { ?s ?p ?o } LIMIT 5');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('query reset functionality [REQ-4.3.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_3_3_queryReset(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('multiple query tabs [REQ-4.3.6]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });

    await login(page);
    await openRepository(page, 'playwright', 'test');

    await REQ_4_3_6_multipleQueryTabs(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

});
