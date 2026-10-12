import { test, expect } from '@playwright/test';
import { login, openRepository, waitForNetworkIdle } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Import/Export Tests with Documentation Capture
 * Coverage: REQ-3.4.x, REQ-3.5.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/import-export-documented.spec.js
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';

test.describe('Import/Export', () => {

  // ── the import flow, as it actually is ──────────────────────────────────────
  //
  // These specs predate a change to it, and because every step below used to sit
  // behind `if (await x.isVisible().catch(() => false))`, the change did not fail
  // them -- it silently emptied them.  Three of the four file-import tests were
  // asserting nothing at all.  The guards are gone from this file: a dialog that
  // does not appear is now a failure, which is the only way a test can report
  // that the thing it covers has moved.
  //
  // The flow is three dialogs:
  //   1. Import Source      local | remote   -> [data-testid=import-source-continue]
  //   2. local:  a NATIVE FILE CHOOSER.  The input is created in JS, left
  //              detached and display:none, so there is no element to call
  //              setInputFiles on -- it has to be taken as a 'filechooser' event.
  //      remote: [data-testid=import-remote-url-input] + -continue
  //   3. Import options     media type, async -> [data-testid=import-confirm-btn]

  async function openImportSource(page, source) {
    await page.getByTestId('repo-import-btn').first().click();
    const continueBtn = page.getByTestId('import-source-continue');
    await expect(continueBtn, 'the Import Source dialog should open').toBeVisible();
    if (source === 'remote') {
      await page.locator('input[name="import-source"][value="remote"]').check();
    }
    return continueBtn;
  }

  // Returns the media type the UI detected, so a caller can assert on it.
  async function confirmImportOptions(page, { expectMediaType } = {}) {
    const confirmBtn = page.getByTestId('import-confirm-btn');
    await expect(confirmBtn, 'the import options popup should open').toBeVisible();
    const mediaSelect = page.getByTestId('import-media-type-select');
    const detected = await mediaSelect.inputValue().catch(() => null);
    if (expectMediaType) {
      expect(detected, 'media type auto-detected from the file extension').toBe(expectMediaType);
    }
    const posted = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/playwright/test'),
      { timeout: 30000 }
    ).catch(() => null);
    await confirmBtn.click();
    return { detected, response: await posted };
  }

  async function importLocalFile(page, filePath, { expectMediaType } = {}) {
    const continueBtn = await openImportSource(page, 'local');
    const chooserPromise = page.waitForEvent('filechooser');
    await continueBtn.click();
    (await chooserPromise).setFiles(filePath);
    return confirmImportOptions(page, { expectMediaType });
  }

  async function importRemoteUrl(page, url) {
    const continueBtn = await openImportSource(page, 'remote');
    await continueBtn.click();
    const urlInput = page.getByTestId('import-remote-url-input');
    await expect(urlInput, 'the remote URL dialog should open').toBeVisible();
    await urlInput.fill(url);
    await page.getByTestId('import-remote-url-continue').click();
    return confirmImportOptions(page);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    await openRepository(page, 'playwright', 'test');
  });

  // ============================================================
  // REQ-3.4.3: Import from URL
  // ============================================================
  async function REQ_3_4_3_importFromURL(page, capture, url) {
    await capture.requirement(REQ['3.4.3'], async (cap) => {
      await cap.before('Repository with import button');
      const { response } = await importRemoteUrl(page, url);
      await cap.step('url-entered', 'Import URL entered and submitted');
      if (response) {
        expect([200, 201, 202, 204]).toContain(response.status());
      }
      await waitForNetworkIdle(page);
      await cap.after('URL import initiated');
    });
  }

  // ============================================================
  // REQ-3.4.4: Import from File Upload
  // ============================================================
  async function REQ_3_4_4_importFromFile(page, capture, filePath, format) {
    await capture.requirement(REQ['3.4.4'], async (cap) => {
      await cap.before('Repository ready for file import');
      const { response } = await importLocalFile(page, filePath);
      await cap.step('file-selected', `${format} file selected for import`);
      if (response) {
        expect([200, 201, 202, 204]).toContain(response.status());
      }
      await waitForNetworkIdle(page);
      await cap.after('File import completed');
    });
  }

  // ============================================================
  // REQ-3.4.6: Import Progress Display
  // ============================================================
  async function REQ_3_4_6_importProgressDisplay(page, capture, filePath) {
    await capture.requirement(REQ['3.4.6'], async (cap) => {
      await cap.before('Repository before a larger import');
      // There is no progress element to assert on -- no .progress, no
      // [data-progress], nothing the old guard could ever have found -- so what
      // is asserted is that a larger import is accepted and completes.  Giving
      // the import a progress hook is the fix; until then this is the honest
      // extent of the coverage.
      const { response } = await importLocalFile(page, filePath);
      if (response) {
        expect([200, 201, 202, 204], 'a larger import should be accepted').toContain(response.status());
      }
      await waitForNetworkIdle(page);
      await cap.after('Larger import completed');
    });
  }

  // ============================================================
  // REQ-3.4.7: Auto-detect File Format
  // ============================================================
  async function REQ_3_4_7_autoDetectFormat(page, capture, filePath, expectedFormat) {
    await capture.requirement(REQ['3.4.7'], async (cap) => {
      await cap.before('Import dialog before file selection');
      // The assertion lives in confirmImportOptions: the media type the UI put
      // in the select must be the one the extension implies.
      const { detected } = await importLocalFile(page, filePath,
                                                 { expectMediaType: expectedFormat });
      await cap.step('format-detected', `format auto-detected as ${detected}`);
      await waitForNetworkIdle(page);
      await cap.after('Import with auto-detected format completed');
    });
  }

  // ============================================================
  // REQ-3.5.1: Export Repository Data
  // ============================================================
  // `format` is the MEDIA TYPE, which is both what the select's options carry as
  // values and what the request must end up asking for -- so one argument serves
  // the action and the assertion, with no label-to-type mapping to drift.
  async function REQ_3_5_1_exportRepositoryData(page, capture, format) {
    await capture.requirement(REQ['3.5.1'], async (cap) => {
      await cap.before('Repository before export');
      // Export opens #export-data-form-<account>-<repository>, whose media-type
      // select drives an ACCEPT header on GET /<account>/<repository>/service.
      // The export control disables itself for the duration of an export and is
      // re-enabled by restoreButtonState(), so a second export in the same test
      // can arrive while it is still disabled -- which surfaces as a click
      // timeout, not as a visible failure.  Wait for it rather than race it.
      const exportBtn = page.getByTestId('repo-export-btn').first();
      await expect(exportBtn, 'the export control should be ready').toBeEnabled({ timeout: 25000 });
      await exportBtn.click();
      const form = page.locator(`#export-data-form-${ACCOUNT}-${REPOSITORY}`);
      await expect(form, 'the export form should open').toBeVisible({ timeout: 15000 });

      await form.locator('select').first().selectOption(format);
      await cap.step('format', `Export format set to ${format}`);

      const got = page.waitForResponse(
        (r) => r.request().method() === 'GET' &&
               r.url().includes(`/${ACCOUNT}/${REPOSITORY}/service`),
        { timeout: 30000 });
      await page.getByTestId('export-confirm-btn').click();
      const res = await got;
      expect(res.status(), 'the export request should succeed').toBe(200);
      expect(res.request().headers()['accept'],
             `export should request ${format}`).toContain(format);
      await cap.after('Export completed');
    });
  }

  // ============================================================
  // REQ-3.5.2: Direct Download URL
  // ============================================================
  async function REQ_3_5_2_directDownloadURL(page, capture) {
    await capture.requirement(REQ['3.5.2'], async (cap) => {
      await cap.before('Repository before a direct download');
      // The export hands the bytes to the browser as a blob download, so the
      // evidence is a download event with a filename, not a link in the page.
      // The export control disables itself for the duration of an export and is
      // re-enabled by restoreButtonState(), so a second export in the same test
      // can arrive while it is still disabled -- which surfaces as a click
      // timeout, not as a visible failure.  Wait for it rather than race it.
      const exportBtn = page.getByTestId('repo-export-btn').first();
      await expect(exportBtn, 'the export control should be ready').toBeEnabled({ timeout: 25000 });
      await exportBtn.click();
      const form = page.locator(`#export-data-form-${ACCOUNT}-${REPOSITORY}`);
      await expect(form).toBeVisible({ timeout: 15000 });
      const download = page.waitForEvent('download', { timeout: 30000 });
      await page.getByTestId('export-confirm-btn').click();
      const file = await download;
      expect(file.suggestedFilename(),
             'the download should be named after the repository').toContain(REPOSITORY);
      await cap.after('Export downloaded');
    });
  }

  // ============================================================
  // Helper: Create temp file
  // ============================================================
  function createTempFile(filename, content) {
    const tempPath = path.join('/tmp', filename);
    fs.writeFileSync(tempPath, content);
    return tempPath;
  }

  function cleanupTempFile(tempPath) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  // ============================================================
  // Combined Tests
  // ============================================================

  test('import Turtle file [REQ-3.4.4, REQ-3.4.7]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/import', { enabled: CAPTURE_ENABLED });

    const tempFile = createTempFile('test-import.ttl',
      '@prefix ex: <http://example.org/> .\nex:subject ex:predicate ex:object .');

    try {
      await REQ_3_4_4_importFromFile(page, capture, tempFile, 'Turtle');
      await REQ_3_4_7_autoDetectFormat(page, capture, tempFile, 'text/turtle');
    } finally {
      cleanupTempFile(tempFile);
    }

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('import N-Triples file [REQ-3.4.4, REQ-3.4.7]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/import', { enabled: CAPTURE_ENABLED });

    // The terminating newline is load-bearing: the N-Triples and N-Quads
    // importer rejects a document whose last statement is not followed by one
    // (400, "Graph import failed: 65: invalid input"), where Turtle accepts it.
    // RDF 1.1 makes the final EOL optional -- ntriplesDoc ::= triple? (EOL triple?)*
    // -- so that is a server-side conformance gap, recorded in the plan; these
    // fixtures end with a newline because real files do.
    const tempFile = createTempFile('test-import.nt',
      '<http://example.org/subject> <http://example.org/predicate> <http://example.org/object> .\n');

    try {
      await REQ_3_4_4_importFromFile(page, capture, tempFile, 'N-Triples');
    } finally {
      cleanupTempFile(tempFile);
    }

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('import N-Quads file [REQ-3.4.4, REQ-3.4.7]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/import', { enabled: CAPTURE_ENABLED });

    const tempFile = createTempFile('test-import.nq',
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> <http://example.org/g> .\n');

    try {
      await REQ_3_4_4_importFromFile(page, capture, tempFile, 'N-Quads');
    } finally {
      cleanupTempFile(tempFile);
    }

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('import from URL [REQ-3.4.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/import', { enabled: CAPTURE_ENABLED });

    await REQ_3_4_3_importFromURL(page, capture, 'https://www.w3.org/1999/02/22-rdf-syntax-ns');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('import progress display [REQ-3.4.6]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/import', { enabled: CAPTURE_ENABLED });

    // Create larger file to see progress
    let content = '@prefix ex: <http://example.org/> .\n';
    for (let i = 0; i < 100; i++) {
      content += `ex:subject${i} ex:predicate ex:object${i} .\n`;
    }
    const tempFile = createTempFile('test-import-large.ttl', content);

    try {
      await REQ_3_4_6_importProgressDisplay(page, capture, tempFile);
    } finally {
      cleanupTempFile(tempFile);
    }

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('export Turtle format [REQ-3.5.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/export', { enabled: CAPTURE_ENABLED });

    await REQ_3_5_1_exportRepositoryData(page, capture, 'text/turtle');

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

  test('export N-Triples format [REQ-3.5.1, REQ-3.5.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/export', { enabled: CAPTURE_ENABLED });

    await REQ_3_5_1_exportRepositoryData(page, capture, 'application/n-triples');
    await REQ_3_5_2_directDownloadURL(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
    await page.close();
  });

});
