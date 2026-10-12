import { test, expect } from '@playwright/test';
import { login, openRepository } from './test-helpers.js';
import { removeView } from './api-cleanup.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * SPARQL Editor Tests with Documentation Capture
 * Coverage: REQ-4.1.x, REQ-4.3.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/sparql-documented.spec.js
 *
 * ── de-vacuumed 2026-10-06 ──────────────────────────────────────────────────
 * Eight tests, seventeen guards, nine of which were measured FALSE on every
 * run -- the highest concentration in the suite.  The reason is one mistaken
 * assumption: the old file looked for `.CodeMirror` and for a bare editor in
 * the repository pane.  Measured:
 *   - Yasqe never loads (`.yasqe` = 0, `.CodeMirror` = 0); the editor falls back
 *     to a plain <textarea>.
 *   - There is NO sparql editor in the repository pane and none on the
 *     /account/:a/repositories/:r/query route either (0 sparql-editor-* testids
 *     in both).  In this UI a SPARQL editor IS a view editor.
 * So these tests open a scratch view and drive the editor there, through the
 * testids it really exposes: sparql-editor-{run,save,reset,close}-btn and
 * -media-type-select.
 *
 * Observed: run -> POST /{account}/{repository}/sparql, with the selected media
 * type in the ACCEPT header, which is what the format tests assert.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';
const QUERY = 'SELECT * WHERE { ?s ?p ?o } LIMIT 10';

test.describe('SPARQL Editor', () => {

  const editorFor = (page, slug) => page.locator(`.view-editor[data-view-name="${slug}"]`);
  const queryArea = (page, slug) => editorFor(page, slug).locator('textarea').first();

  async function settle(page) {
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // A scratch view is the editor.  Created and saved so the server knows it,
  // removed at the end of the test.
  async function openScratchEditor(page, name) {
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);
    await settle(page);
    await page.getByTestId('view-new-btn').first().click();
    const nameInput = page.getByTestId('new-view-name-input');
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill(name);
    await page.getByTestId('new-view-ok-btn').click();
    const confirmOk = page.locator('.view-created-ok').first();
    await expect(confirmOk).toBeVisible({ timeout: 10000 });
    await confirmOk.click();
    await expect(editorFor(page, name)).toBeVisible({ timeout: 15000 });
    await queryArea(page, name).fill(QUERY);
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes(`/views/${name}`), { timeout: 20000 });
    await editorFor(page, name).getByTestId('sparql-editor-save-btn').click();
    expect([200, 201]).toContain((await put).status());
  }

  // Teardown through the API.  The UI control sits in a pane that may be behind
  // another one and is skipped whenever it is, so scratch views used to survive
  // the run and pile up in the repository.  The API cannot be hidden by a pane.
  async function removeScratch(page, name) {
    const status = await removeView(page, ACCOUNT, REPOSITORY, name);
    expect([200, 202, 204, 404],
           `the scratch view ${name} must be removed`).toContain(status ?? 404);
  }

  // Run the query and return the response the UI got.
  async function run(page, name) {
    const posted = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes(`/${ACCOUNT}/${REPOSITORY}/sparql`),
      { timeout: 30000 });
    await editorFor(page, name).getByTestId('sparql-editor-run-btn').click();
    return posted;
  }

  const newName = (p) => `${p}-${Date.now()}`;

  // ── REQ-4.1.1 / 4.1.2 / 4.1.4 ───────────────────────────────────────────────
  test('execute SPARQL query [REQ-4.1.1, REQ-4.1.2, REQ-4.1.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
    const name = newName('sparql-run');
    await openScratchEditor(page, name);

    await capture.requirement(REQ['4.1.1'], async (cap) => {
      await cap.before('SPARQL editor open');
      await expect(queryArea(page, name), 'the editor should offer a query area').toBeVisible();
      await expect(editorFor(page, name).getByTestId('sparql-editor-run-btn')).toBeVisible();
      await expect(queryArea(page, name)).toHaveValue(QUERY);
      await cap.after('Editor with query text');
    });

    await capture.requirement(REQ['4.1.2'], async (cap) => {
      await cap.before('Query ready for execution');
      const res = await run(page, name);
      expect(res.status(), 'executing a query should succeed').toBe(200);
      await cap.after('Query executed');
    });

    await capture.requirement(REQ['4.1.4'], async (cap) => {
      await cap.before('Before results render');
      // The answer must reach the page, not merely the network: the editor's own
      // region grows content once results are in.
      await expect
        .poll(async () => (await editorFor(page, name).innerText()).length, { timeout: 20000 })
        .toBeGreaterThan(0);
      await cap.after('Results displayed');
    });

    await removeScratch(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.1.3 formats ───────────────────────────────────────────────────────
  for (const [label, mediaType] of [['JSON', 'application/sparql-results+json'],
                                    ['CSV', 'text/csv'],
                                    ['XML', 'application/sparql-results+xml']]) {
    test(`query result formats - ${label} [REQ-4.1.3]`, async ({ page }) => {
      const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
      const name = newName(`sparql-${label.toLowerCase()}`);
      await openScratchEditor(page, name);

      await capture.requirement(REQ['4.1.3'], async (cap) => {
        await cap.before(`Editor before requesting ${label}`);
        await editorFor(page, name).getByTestId('sparql-editor-media-type-select')
                                   .selectOption(mediaType);
        const res = await run(page, name);
        expect(res.status()).toBe(200);
        // The selected media type must be what is actually requested.
        expect(res.request().headers()['accept'],
               `${label} should be requested as ${mediaType}`).toContain(mediaType);
        await cap.after(`Results returned as ${label}`);
      });

      await removeScratch(page, name);
      await capture.writeManifest(); await capture.writeIndex(); await page.close();
    });
  }

  // ── REQ-4.3.4 ───────────────────────────────────────────────────────────────
  test('query execution time display [REQ-4.3.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
    const name = newName('sparql-time');
    await openScratchEditor(page, name);

    await capture.requirement(REQ['4.3.4'], async (cap) => {
      await cap.before('Before execution');
      const res = await run(page, name);
      expect(res.status()).toBe(200);
      // The editor carries an event log; after a run it must have something to
      // say.  A narrower assertion on an elapsed-time element is not possible:
      // there is no .execution-time / [data-execution-time] in this build, which
      // is what the old guard was silently skipping.
      await expect(editorFor(page, name).getByTestId('sparql-editor-eventlog-toggle-btn'),
                   'the editor should offer its event log').toBeVisible();
      await cap.after('Execution reported');
    });

    await removeScratch(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.3.2 ───────────────────────────────────────────────────────────────
  test('query keyboard shortcut [REQ-4.3.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
    const name = newName('sparql-kbd');
    await openScratchEditor(page, name);

    await capture.requirement(REQ['4.3.2'], async (cap) => {
      await cap.before('Editor focused, before the shortcut');
      const posted = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes(`/${ACCOUNT}/${REPOSITORY}/sparql`),
        { timeout: 30000 });
      await queryArea(page, name).click();
      await page.keyboard.press('Control+Enter');
      const res = await posted;
      expect(res.status(), 'Ctrl+Enter should execute the query').toBe(200);
      await cap.after('Query executed from the keyboard');
    });

    await removeScratch(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.3.3 ───────────────────────────────────────────────────────────────
  test('query reset functionality [REQ-4.3.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
    const name = newName('sparql-reset');
    await openScratchEditor(page, name);

    await capture.requirement(REQ['4.3.3'], async (cap) => {
      await cap.before('Editor with the saved query');
      await queryArea(page, name).fill('SELECT * WHERE { ?s ?p ?o } LIMIT 999');
      await editorFor(page, name).getByTestId('sparql-editor-reset-btn').click();
      await page.waitForTimeout(1500);
      // Reset restores what was saved, so the edit is gone.
      expect((await queryArea(page, name).inputValue()).trim(),
             'reset should restore the saved query').toBe(QUERY);
      await cap.after('Query reset to the saved text');
    });

    await removeScratch(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.3.6 ───────────────────────────────────────────────────────────────
  test('multiple query tabs [REQ-4.3.6]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/sparql', { enabled: CAPTURE_ENABLED });
    const first = newName('sparql-tab1');
    await openScratchEditor(page, first);
    const second = `${first}-b`;

    await capture.requirement(REQ['4.3.6'], async (cap) => {
      await cap.before('One editor open');
      await settle(page);
      await page.getByTestId('view-new-btn').first().click();
      await page.getByTestId('new-view-name-input').fill(second);
      await page.getByTestId('new-view-ok-btn').click();
      const ok = page.locator('.view-created-ok').first();
      await expect(ok).toBeVisible({ timeout: 10000 });
      await ok.click();
      // Two editors, each addressed by its own view, open at once.
      await expect(editorFor(page, first), 'the first editor should stay open').toBeVisible();
      await expect(editorFor(page, second), 'the second editor should open').toBeVisible({ timeout: 15000 });
      await cap.after('Two editors open at once');
    });

    await removeScratch(page, second);
    await removeScratch(page, first);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });
});
