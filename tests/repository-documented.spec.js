import { test, expect } from '@playwright/test';
import { login, openRepository, activateRepoField } from './test-helpers.js';
import { removeRepository, removeStrayRepositories } from './api-cleanup.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * Repository Tests with Documentation Capture
 * Coverage: REQ-3.2.x, REQ-3.3.x, REQ-3.6.x, REQ-3.7.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/repository-documented.spec.js
 *
 * ── de-vacuumed 2026-10-06 ──────────────────────────────────────────────────
 * Four tests, three expect() calls, nine visibility guards.  Each requirement
 * ran inside a guard on its own first control, so a renamed button emptied the
 * test rather than failing it.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';

test.describe('Repository', () => {

  // Backstop: remove anything a previous run left behind.  A test that fails
  // midway never reaches its own cleanup, and the strays accumulate in the
  // account run after run.
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await login(page);
      const removed = await removeStrayRepositories(page, ACCOUNT);
      if (removed.length) console.log('[cleanup] removed strays: ' + JSON.stringify(removed));
    } catch { /* teardown must not fail the run */ } finally { await page.close(); }
  });

  const repoPaneId = `#tab-repository-${ACCOUNT}-${REPOSITORY}`;

  async function open(page) {
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);
    await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 20000 });
  }

  // ── REQ-3.2.1 / 3.2.3 ───────────────────────────────────────────────────────
  test('repository profile properties [REQ-3.2.1, REQ-3.2.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/repository', { enabled: CAPTURE_ENABLED });
    await open(page);
    const stamp = Date.now();

    await capture.requirement(REQ['3.2.1'], async (cap) => {
      await cap.before('Repository profile before editing');
      const summary = await activateRepoField(page, 'repo-field-abstract');
      await expect(summary, 'the summary field should become editable').toBeVisible({ timeout: 10000 });
      await summary.fill(`Test summary ${stamp}`);
      await expect(summary).toHaveValue(`Test summary ${stamp}`);
      await cap.after('Profile fields populated with new values');
    });

    await capture.requirement(REQ['3.2.3'], async (cap) => {
      await cap.before('Repository with unsaved changes');
      const saveBtn = page.locator(`[data-tab-action="save"][data-repository="${REPOSITORY}"]`).first();
      await expect(saveBtn, 'a save control should be offered').toBeVisible({ timeout: 10000 });
      const posted = page.waitForResponse(
        (r) => r.url().includes(`/repositories/${REPOSITORY}/configuration`) &&
               r.request().method() === 'POST',
        { timeout: 20000 });
      await saveBtn.click();
      const res = await posted;
      expect([200, 201, 202, 204], 'saving the repository should succeed').toContain(res.status());
      await cap.after('Repository configuration saved');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-3.7.x ───────────────────────────────────────────────────────────────
  test('repository collaboration [REQ-3.7.1, REQ-3.7.2, REQ-3.7.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/repository', { enabled: CAPTURE_ENABLED });
    await open(page);

    await capture.requirement(REQ['3.7.1'], async (cap) => {
      await cap.before('Collaboration section');
      // Collaboration is one of the repository pane's sections -- profile,
      // settings, ips, prefixes, collaboration, logs -- and has to
      // be selected first.  The old spec looked for collab-new-btn on the
      // profile section, never found it, and skipped all three requirements.
      await page.locator(`${repoPaneId} [data-tab="collaboration"]`).first().click();
      await page.waitForTimeout(1200);
      const collabNewBtn = page.getByTestId('collab-new-btn').first();
      await expect(collabNewBtn, 'a control to add a collaborator should be offered')
        .toBeVisible({ timeout: 15000 });
      await collabNewBtn.click();
      // Adding a collaborator must offer the account and the permissions.
      await expect(page.getByTestId('collab-account-input').first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('collab-read-checkbox-new').first()).toBeVisible();
      await cap.after('New collaborator row with permissions');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-3.3.1 ───────────────────────────────────────────────────────────────
  test('repository creation [REQ-3.3.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/repository', { enabled: CAPTURE_ENABLED });
    await login(page);
    await page.waitForTimeout(1500);
    const name = `test-repo-${Date.now()}`;

    await capture.requirement(REQ['3.3.1'], async (cap) => {
      await cap.before('Account pane before creating a repository');
      await page.getByTestId('repo-new-btn').first().click();
      const nameBox = page.getByRole('textbox', { name: 'Repository name' });
      await expect(nameBox, 'the new-repository dialog should open').toBeVisible({ timeout: 10000 });
      await nameBox.fill(name);
      await cap.step('dialog-open', 'New repository dialog displayed');
      await page.getByRole('button', { name: 'Create' }).click();
      // Creating a repository opens its pane; that pane -- addressed by the new
      // name -- is the evidence the repository exists.  The account LIST is not
      // usable for this: it is now behind the new pane, and it is rendered twice
      // under one id, so neither .first() nor :visible is dependable there.
      await expect(page.locator(`#tab-repository-${ACCOUNT}-${name}`),
                   'the new repository should open').toBeVisible({ timeout: 25000 });
      await cap.after('Repository created and open');
    });

    // Teardown through the API, not the panes.  Removing a repository from the
    // UI means closing the new pane, finding its row in the account pane -- which
    // is rendered twice under one id -- and clicking a control that may be behind
    // another pane.  That is why earlier runs leaked a repository each time.  The
    // API has none of those failure modes.
    const status = await removeRepository(page, ACCOUNT, name);
    expect([200, 202, 204], 'the repository created by this test must be removed').toContain(status);

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-3.6.1 ───────────────────────────────────────────────────────────────
  test('repository clear [REQ-3.6.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/repository', { enabled: CAPTURE_ENABLED });
    await open(page);

    await capture.requirement(REQ['3.6.1'], async (cap) => {
      await cap.before('Repository before clear');
      const clearBtn = page.getByTestId('repo-clear-btn').first();
      await expect(clearBtn, 'a clear control should be offered').toBeVisible({ timeout: 15000 });

      // Clearing is destructive, so the confirmation is part of the requirement:
      // this asserts the prompt happens, and then DISMISSES it.  The repository
      // is the shared fixture every other spec in this suite reads from, so the
      // test proves the guard exists rather than emptying it.
      let asked = null;
      page.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
      await clearBtn.click();
      await page.waitForTimeout(2000);
      expect(asked, 'clearing must ask for confirmation first').toContain('clear');
      await cap.after('Clear confirmation requested and declined');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });
});
