import { test, expect } from '@playwright/test';
import { login, openRepository, USER_URL } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * UI Component Tests with Documentation Capture
 * Coverage: REQ-6.2.x, REQ-9.1.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/ui-components-documented.spec.js
 *
 * ── de-vacuumed 2026-10-06 ──────────────────────────────────────────────────
 * Nine tests, twenty guards, and the suite's one outright tautology:
 *
 *     expect(notFoundVisible || loginVisible || homeVisible || errorVisible || true)
 *       .toBeTruthy();
 *
 * -- which cannot fail for any input, by construction.
 *
 * The old file also looked for `.flash`, `.toast`, `.notification`, `.loading`
 * and `.spinner`.  None of them exist anywhere in this UI.  What does exist:
 *   - transient messages go through app.showLocationMessage(text, duration),
 *     which writes textContent into the location bar and clears it on a timer;
 *   - loading states are plain text ("Loading collaboration data...");
 *   - the 404 is NotFoundPage, "The page you were looking for doesn't exist.";
 *   - login failures render into #login-error-text.
 * Each test below drives the mechanism that is actually implemented.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';
const BASE = process.env.JSUI_ORIGIN || 'https://dydra.com';

test.describe('UI Components', () => {

  // ── REQ-6.2.1 flash messages ────────────────────────────────────────────────
  test('flash message display [REQ-6.2.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['6.2.1'], async (cap) => {
      await cap.before('Before a transient message');
      // showLocationMessage writes into #location-bar > #location-display
      // specifically (ui/app.js:331), restoring the previous text on a timer.
      const bar = page.locator('#location-display');
      await expect(bar).toBeVisible({ timeout: 15000 });

      // The mechanism is app.showLocationMessage: there is no .flash or .toast
      // element in this UI, which is why the old selectors never matched.
      await page.evaluate(() => window.appInstance.showLocationMessage('probe message', 2000));
      await expect(bar, 'a transient message should be shown').toContainText('probe message',
                                                                            { timeout: 10000 });
      await cap.step('shown', 'Transient message displayed');

      // ...and it must clear itself again.
      await expect(bar, 'the message should clear on its own').not.toContainText('probe message',
                                                                                { timeout: 15000 });
      await cap.after('Message cleared');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-6.2.2 loading indicators ────────────────────────────────────────────
  test('loading indicator [REQ-6.2.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });

    // Hold the collaboration request open so the loading state is observable
    // rather than raced against.  Without this the fetch finishes long before an
    // assertion can see it, which is why the old test could only shrug.
    await page.route('**/collaboration**', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });

    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['6.2.2'], async (cap) => {
      await cap.before('Repository pane before loading collaboration');
      await page.locator(`#tab-repository-${ACCOUNT}-${REPOSITORY} [data-tab="collaboration"]`)
                .first().click();
      await expect(page.getByText(/Loading collaboration data/i),
                   'a loading state should be shown while the request is open')
        .toBeVisible({ timeout: 10000 });
      await cap.step('loading', 'Loading indicator while data is fetched');

      await expect(page.getByTestId('collab-new-btn').first(),
                   'the section should finish loading').toBeVisible({ timeout: 25000 });
      await cap.after('Loaded');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-9.1.2 error messages ────────────────────────────────────────────────
  test('error message display [REQ-9.1.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });

    await capture.requirement(REQ['9.1.2'], async (cap) => {
      await page.goto(USER_URL);
      await expect(page.getByTestId('login-username-input')).toBeVisible({ timeout: 15000 });
      await cap.before('Login form before a failed attempt');

      await page.getByTestId('login-username-input').fill(ACCOUNT);
      await page.getByTestId('login-password-input').fill('wrong-password-on-purpose');
      await page.getByTestId('login-submit').click();

      // A rejected API call must say so, in #login-error-text.
      const errorText = page.locator('#login-error-text');
      await expect(errorText, 'a failed login should report an error').toBeVisible({ timeout: 20000 });
      expect((await errorText.textContent() || '').trim().length,
             'the error message should not be empty').toBeGreaterThan(0);
      await cap.after('Error message displayed');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-9.1.3 404 ───────────────────────────────────────────────────────────
  test('404 page [REQ-9.1.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['9.1.3'], async (cap) => {
      await cap.before('Before navigating to an unknown route');
      // Routed in-app rather than by page.goto: a full load would drop the
      // in-memory session and show the login page, which is not a 404.
      await page.evaluate(() => window.appInstance.router.navigate('/no/such/route/at/all'));
      await expect(page.getByText(/page you were looking for doesn't exist/i),
                   'an unknown route should render the not-found page').toBeVisible({ timeout: 15000 });
      await cap.after('Not-found page displayed');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-6.2.3 modal ─────────────────────────────────────────────────────────
  test('modal dialog behavior [REQ-6.2.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['6.2.3'], async (cap) => {
      await cap.before('Repository pane before opening a dialog');
      await page.getByTestId('view-new-btn').first().click();
      const nameInput = page.getByTestId('new-view-name-input');
      await expect(nameInput, 'the dialog should open').toBeVisible({ timeout: 15000 });
      await cap.step('open', 'Modal dialog open');

      await page.getByTestId('new-view-cancel-btn').click();
      await expect(nameInput, 'Cancel should dismiss the dialog').toBeHidden({ timeout: 10000 });
      await cap.after('Modal dialog dismissed');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-6.2.3 confirmation ──────────────────────────────────────────────────
  test('confirmation dialog [REQ-6.2.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['6.2.3'], async (cap) => {
      await cap.before('Before a destructive action');
      let asked = null;
      // Dismissed, not accepted: this repository is the fixture the rest of the
      // suite reads from.  What is asserted is that the guard exists.
      page.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
      await page.getByTestId('repo-clear-btn').first().click();
      await page.waitForTimeout(2000);
      expect(asked, 'a destructive action should ask for confirmation').toContain('clear');
      await cap.after('Confirmation requested and declined');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── responsive ──────────────────────────────────────────────────────────────
  test('responsive layout elements', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);
    const tabs = page.locator('[data-tab-link]').first();

    await capture.requirement(REQ['6.2.1'], async (cap) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(tabs, 'tabs should be usable at desktop width').toBeVisible();
      await cap.before('Desktop layout');

      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(800);
      // The navigation must survive the narrow viewport rather than vanish.
      await expect(tabs, 'tabs should still be usable at mobile width').toBeVisible();
      await expect(page.locator(`#tab-repository-${ACCOUNT}-${REPOSITORY}`)).toBeVisible();
      await cap.after('Mobile layout');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── keyboard navigation ─────────────────────────────────────────────────────
  test('keyboard navigation', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await page.goto(USER_URL);
    await expect(page.getByTestId('login-username-input')).toBeVisible({ timeout: 15000 });

    await capture.requirement(REQ['6.2.1'], async (cap) => {
      await cap.before('Login form before keyboard navigation');
      await page.getByTestId('login-username-input').focus();
      const first = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      await page.keyboard.press('Tab');
      const second = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      // Tab must move focus somewhere else: a form that traps focus is unusable
      // from the keyboard.
      expect(second, 'Tab should move focus off the first field').not.toBe(first);
      await cap.after('Focus moved by keyboard');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── tooltips ────────────────────────────────────────────────────────────────
  test('tooltip display', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/ui-components', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['6.2.1'], async (cap) => {
      await cap.before('Repository controls');
      // Tooltips here are title attributes on the icon controls; the import and
      // clear buttons carry them and are the ones a user needs explained.
      await expect(page.getByTestId('repo-import-btn').first()).toHaveAttribute('title', /import/i);
      await expect(page.getByTestId('repo-clear-btn').first()).toHaveAttribute('title', /clear/i);
      await cap.after('Controls carry explanatory titles');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });
});
