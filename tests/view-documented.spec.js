import { test, expect } from '@playwright/test';
import { login, openRepository } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * View Management Tests with Documentation Capture
 * Coverage: REQ-4.2.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/view-documented.spec.js
 *
 * ── de-vacuumed 2026-10-06 ──────────────────────────────────────────────────
 * This file had FIVE tests and ZERO expect() calls.  Every step sat behind
 * `if (await x.isVisible().catch(() => false))`, several steps had a second
 * "alt" selector behind a second guard, and the test bodies wrapped whole
 * requirements in `try {} catch (e) { console.log(...) }`.  Nothing could fail.
 *
 * Measured against the live UI, the selectors it was reaching for were wrong:
 *   - `.CodeMirror` and `.sparql-editor textarea` never matched.  Yasqe does not
 *     load at all (`.yasqe` = 0, `.CodeMirror` = 0); the editor falls back to a
 *     plain textarea, the only visible one inside `.view-editor`.
 *   - `button:has-text("Save")` never matched: the save control is an ICON
 *     button with no text, `[data-testid=sparql-editor-save-btn]`.
 * So "edit view" never edited and "save view query via PUT" never saved.
 *
 * The editor exposes a full testid vocabulary -- sparql-editor-{run,save,reset,
 * close,settings}-btn, -media-type-select, -revision-select -- which none of
 * these specs used.  They are used here, and the guards are gone: an element
 * that does not appear is now a failure.
 *
 * Observed endpoints, asserted below:
 *   save -> PUT  /system/accounts/{a}/repositories/{r}/views/{view}  200
 *   run  -> POST /{a}/{r}/sparql                                     200
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';

test.describe('View Management', () => {

  const editorFor = (page, slug) => page.locator(`.view-editor[data-view-name="${slug}"]`);
  const queryArea = (page, slug) => editorFor(page, slug).locator('textarea').first();

  async function settle(page) {
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // Create a view and prove it exists: in the list, and as an open editor.
  async function createView(page, name) {
    await settle(page);
    await page.getByTestId('view-new-btn').first().click();
    const nameInput = page.getByTestId('new-view-name-input');
    await expect(nameInput, 'the New View dialog should open').toBeVisible();
    await nameInput.fill(name);
    await page.getByTestId('new-view-ok-btn').click();
    // The "View Created" confirmation must be dismissed or it covers the view
    // list and every later click is intercepted.  `.first()` is required: the
    // dialog is defined in both of index.js's parallel view-list renderers, so a
    // bare locator matches two elements and throws on strict mode -- which, with
    // a .catch(() => false) guard around it, is exactly how this suite used to
    // turn a real error into a silent skip.
    const confirmOk = page.locator('.view-created-ok').first();
    await expect(confirmOk, 'the view-created confirmation should appear').toBeVisible({ timeout: 10000 });
    await confirmOk.click();
    await expect(confirmOk).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId(`view-edit-${name}`),
                 'the new view should be listed').toBeVisible({ timeout: 10000 });
    await expect(editorFor(page, name),
                 'an editor should open for the new view').toBeVisible({ timeout: 10000 });
  }

  // Save whatever is in the editor, and assert the PUT the UI actually makes.
  async function saveView(page, slug) {
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes(`/views/${slug}`),
      { timeout: 20000 });
    await editorFor(page, slug).getByTestId('sparql-editor-save-btn').click();
    const res = await put;
    // 201 the first time a view's query is written, 200 on every later save.
    expect([200, 201], 'saving a view should succeed').toContain(res.status());
    return res;
  }

  // Only a SAVED view exists on the server: the New View dialog creates a list
  // entry and an editor, and the first save is what writes it.  Deleting an
  // unsaved view therefore DELETEs a name the server has never heard of, gets a
  // 404, and -- correctly -- leaves the entry where it is.  So every caller here
  // saves before it deletes, and this asserts the 200.
  async function deleteView(page, slug) {
    await settle(page);
    const btn = page.getByTestId(`view-delete-btn-${slug}`).first();
    await expect(btn, 'the delete control should be present').toBeVisible({ timeout: 10000 });
    const gone = page.waitForResponse(
      (r) => r.request().method() === 'DELETE' && r.url().includes(`/views/${slug}`),
      { timeout: 20000 });
    page.once('dialog', (d) => d.accept());
    await btn.click();
    const res = await gone;
    expect(res.status(), 'deleting a saved view should succeed').toBe(200);
    await expect(page.getByTestId(`view-edit-${slug}`),
                 'a deleted view should leave the list').toBeHidden({ timeout: 15000 });
    return true;
  }

  async function signIn(page) {
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);
    await page.waitForTimeout(500);
  }

  const newName = (prefix) => `${prefix}-${Date.now()}`;

  // ── REQ-4.2.1 create ────────────────────────────────────────────────────────
  test('create view [REQ-4.2.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/view', { enabled: CAPTURE_ENABLED });
    await signIn(page);
    const name = newName('test-view');

    await capture.requirement(REQ['4.2.1'], async (cap) => {
      await cap.before('Repository pane with views section');
      await createView(page, name);
      await cap.after('New view created and visible in list');
    });

    // A created view starts empty; it becomes a view with a query by being saved.
    await queryArea(page, name).fill('SELECT * WHERE { ?s ?p ?o } LIMIT 10');
    await saveView(page, name);

    await deleteView(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.2.2 / 4.2.3 / 4.2.5 edit ──────────────────────────────────────────
  test('edit view [REQ-4.2.2, REQ-4.2.3, REQ-4.2.5]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/view', { enabled: CAPTURE_ENABLED });
    await signIn(page);
    const name = newName('edit-view');
    const original = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';
    const modified = 'SELECT * WHERE { ?s ?p ?o } LIMIT 7';

    await createView(page, name);
    await queryArea(page, name).fill(original);
    await saveView(page, name);

    // REQ-4.2.5: the view opens in the pane editor.
    await capture.requirement(REQ['4.2.5'], async (cap) => {
      await cap.before('View listed in repository pane');
      await expect(editorFor(page, name)).toBeVisible();
      await cap.after('View opened in pane editor');
    });

    // REQ-4.2.2: the editor carries the view's query text, not an empty box.
    await capture.requirement(REQ['4.2.2'], async (cap) => {
      await cap.before('Views list showing saved view');
      await expect(queryArea(page, name)).toHaveValue(original);
      await cap.after('View query text loaded in editor');
    });

    // REQ-4.2.3: an edit is persisted by the save, and survives a reload.
    await capture.requirement(REQ['4.2.3'], async (cap) => {
      await cap.before('View query modified in editor');
      await queryArea(page, name).fill(modified);
      await saveView(page, name);
      await cap.after('View query saved via PUT request');
    });

    // Round-trip through the server WITHOUT page.reload(): AuthStore keeps its
    // tokens in memory only (lib/auth_store.js -- no localStorage), so a reload
    // logs the session out and the view list comes back empty.  Closing the
    // editor and re-opening the view is the real round trip anyway:
    // createEditorPanel fetches the text whenever queryText is undefined, which
    // is the path the view-edit link takes.
    await editorFor(page, name).getByTestId('sparql-editor-close-btn').click();
    await expect(editorFor(page, name)).toBeHidden({ timeout: 10000 });
    await settle(page);
    await page.getByTestId(`view-edit-${name}`).click();
    await expect(queryArea(page, name)).not.toHaveValue('', { timeout: 15000 });
    // Compared trimmed: the server returns the stored query with a trailing
    // newline appended, so an exact toHaveValue(modified) fails on one byte.
    expect((await queryArea(page, name).inputValue()).trim(),
           'the saved query should come back from the server').toBe(modified);

    await deleteView(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.2.1 delete ────────────────────────────────────────────────────────
  test('delete view [REQ-4.2.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/view', { enabled: CAPTURE_ENABLED });
    await signIn(page);
    const name = newName('delete-view');
    await createView(page, name);
    await queryArea(page, name).fill('SELECT * WHERE { ?s ?p ?o } LIMIT 1');
    await saveView(page, name);   // without this the view exists only in the page

    await capture.requirement(REQ['4.2.1'], async (cap) => {
      await cap.before('View listed with delete button');
      await deleteView(page, name);
      await cap.after('View removed from list after deletion');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.2.5 / 4.2.6 panes ─────────────────────────────────────────────────
  test('open view in pane editor [REQ-4.2.5, REQ-4.2.6]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/view', { enabled: CAPTURE_ENABLED });
    await signIn(page);
    const name = newName('pane-view');
    await createView(page, name);
    await queryArea(page, name).fill('SELECT * WHERE { ?s ?p ?o } LIMIT 1');
    await saveView(page, name);

    await capture.requirement(REQ['4.2.5'], async (cap) => {
      await cap.before('View listed in repository pane');
      await expect(editorFor(page, name)).toBeVisible();
      await expect(editorFor(page, name).getByTestId('sparql-editor-run-btn')).toBeVisible();
      await cap.after('View opened in pane editor');
    });

    // REQ-4.2.6: the view also opens as a pane of its own, which is a tab.
    await capture.requirement(REQ['4.2.6'], async (cap) => {
      await cap.before('View with open-in-pane button');
      await page.getByTestId(`view-pane-btn-${name}`).first().click();
      await expect(page.locator(`#tab-view-${ACCOUNT}-${REPOSITORY}-${name}`),
                   'opening a view in a pane should create its pane').toBeAttached({ timeout: 15000 });
      await cap.after('View opened in new pane');
    });

    // The view's own pane is in front and the delete control lives in the
    // repository pane behind it.  Closing the view pane is the way back:
    // closePane activates the neighbouring tab.  The close control is
    // [data-tab-action="close"] -- app.js reads it as `data-action` from the
    // element it already found, which is why grepping for that attribute finds
    // nothing in the markup.
    await page.locator(`[data-tab-action="close"][data-view="${name}"]`).first().click();
    await expect(page.locator(`#tab-view-${ACCOUNT}-${REPOSITORY}-${name}`)).toBeHidden({ timeout: 10000 });
    await settle(page);
    await deleteView(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-4.2.2 execute ───────────────────────────────────────────────────────
  test('execute view [REQ-4.2.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/view', { enabled: CAPTURE_ENABLED });
    await signIn(page);
    const name = newName('run-view');
    await createView(page, name);
    await queryArea(page, name).fill('SELECT * WHERE { ?s ?p ?o } LIMIT 3');
    await saveView(page, name);

    await capture.requirement(REQ['4.2.2'], async (cap) => {
      await cap.before('View ready to execute');
      const posted = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes(`/${ACCOUNT}/${REPOSITORY}/sparql`),
        { timeout: 30000 });
      await editorFor(page, name).getByTestId('sparql-editor-run-btn').click();
      const res = await posted;
      expect(res.status(), 'executing a view should succeed').toBe(200);
      await cap.after('View executed and results returned');
    });

    await deleteView(page, name);
    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });
});
