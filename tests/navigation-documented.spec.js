import { test, expect } from '@playwright/test';
import { login, openRepository } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';

/**
 * Navigation Tests with Documentation Capture
 * Coverage: REQ-5.1.x, REQ-5.2.x, REQ-6.3.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/navigation-documented.spec.js
 *
 * ── de-vacuumed 2026-10-06 ──────────────────────────────────────────────────
 * Seven tests, ZERO expect() calls, every step behind a visibility guard and
 * two whole requirements inside `try {} catch (e) { console.log(...) }`.
 *
 * Selectors confirmed against the live UI before being asserted on:
 *   [data-tab-type="account"|"repository"]  the tabs            (present)
 *   [data-tab-link][href="#<paneId>"]       the tab anchors     (present)
 *   [data-tab-action="close"]               the tab × control   (present)
 *   .repository-pane / .account-pane        the panes           (present)
 *   [data-location]                         the location bar    (present)
 * `.breadcrumb` and `[data-tab-action]`-less `.tab-close` spellings the old
 * file also tried do not exist, and `.account-pane` is in the DOM but NOT
 * visible while another pane is in front -- so it is asserted attached, not
 * visible, which is the distinction the old guards silently blurred.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = process.env.JSUI_ACCOUNT || 'playwright';
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';
const BASE = (process.env.JSUI_ORIGIN || 'https://dydra.com');

test.describe('Navigation', () => {

  const tab = (page, type) => page.locator(`[data-tab-type="${type}"]`).first();
  const repoPaneId = `#tab-repository-${ACCOUNT}-${REPOSITORY}`;

  // ── REQ-5.1.1 ───────────────────────────────────────────────────────────────
  test('client-side routing [REQ-5.1.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['5.1.1'], async (cap) => {
      await cap.before('Application after login');
      // Routing is client-side: opening a repository must not reload the
      // document.  A reload would reset this counter, since the app sets it on
      // the window object it is running in.
      await page.evaluate(() => { window.__navProbe = 'alive'; });
      await openRepository(page, ACCOUNT, REPOSITORY);
      await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 15000 });
      expect(await page.evaluate(() => window.__navProbe),
             'opening a repository must not reload the document').toBe('alive');
      await cap.after('Repository pane opened without a page load');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-5.1.2 ───────────────────────────────────────────────────────────────
  // REQ-5.1.2 IS UNDER REVIEW -- the requirement may be wrong for this UI, not
  // merely unimplemented, and the earlier note here overstated it as a defect.
  //
  // This is a single page whose panes accumulate on a canvas: opening a
  // repository does not replace the account, it puts another pane in front of
  // it.  "Back" in the page-navigation sense has nothing to undo, because
  // nothing was replaced.  What the router actually implements is narrower and
  // does fit: goBack() re-runs the PREVIOUS route's handler, which brings that
  // pane to the front again -- a pane-activation history.  It never closes
  // anything.  So the assertion below is "the previous pane comes forward", not
  // "the current pane disappears", which is what this test used to claim.
  //
  // Two things are true at once:
  //   - the mechanism exists: Router.historyStack + goBack/goForward, with
  //     updatePaneNav() enabling [data-action="nav-back"]/"nav-forward";
  //   - no such control is rendered anywhere (measured: 0 in the DOM), and
  //     updateLocation:false means the BROWSER's buttons are deliberately never
  //     driven either.
  // So nothing can exercise it, by either route, and whether anything should is
  // a product question: either expose the two controls and call the requirement
  // "pane activation history", or retire REQ-5.1.2 and delete this test.
  // test.fail() holds the question open without pretending either way.
  test('browser back/forward [REQ-5.1.2]', async ({ page }) => {
    test.fail();   // see the note above
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);
    await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 15000 });

    await capture.requirement(REQ['5.1.2'], async (cap) => {
      await cap.before('Repository open, before going back');
      // Back/Forward are the APP's, not the browser's.  app.js constructs the
      // Router with updateLocation:false, so nothing is ever pushed onto the
      // browser history: the router keeps its own historyStack and the UI drives
      // it through [data-action="nav-back"] / "nav-forward" (ui/app.js:358).
      // page.goBack() therefore leaves the application altogether, which is why
      // asserting on it could only ever have failed -- and did, until this test
      // was pointed at the mechanism that actually exists.
      await page.locator('[data-action="nav-back"]').first().click();
      // The ACCOUNT pane comes forward; the repository pane is not closed, and
      // asserting that it vanishes would be asserting the wrong model.
      await expect(page.locator(`#tab-account-${ACCOUNT}`).first(),
                   'Back should bring the previous pane forward').toBeVisible({ timeout: 15000 });
      await cap.step('back', 'After Back');

      await page.locator('[data-action="nav-forward"]').first().click();
      await expect(page.locator(repoPaneId),
                   'Forward should bring the repository pane forward again').toBeVisible({ timeout: 15000 });
      await cap.after('After Forward');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-6.3.1 / REQ-6.3.2 ───────────────────────────────────────────────────
  test('tab management [REQ-6.3.1, REQ-6.3.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['6.3.1'], async (cap) => {
      await cap.before('Tabs for account and repository');
      await expect(tab(page, 'account'), 'an account tab should exist').toBeVisible();
      await expect(tab(page, 'repository'), 'a repository tab should exist').toBeVisible();
      await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 15000 });
      await cap.after('Both tabs present, repository active');
    });

    await capture.requirement(REQ['6.3.2'], async (cap) => {
      await cap.before('Repository tab before closing');
      const before = await page.locator('[data-tab-link]').count();
      await page.locator(`[data-tab-action="close"][data-repository="${REPOSITORY}"]`).first().click();
      await expect(page.locator(repoPaneId),
                   'closing a tab should remove its pane').toBeHidden({ timeout: 15000 });
      expect(await page.locator('[data-tab-link]').count(),
             'closing a tab should remove exactly one tab').toBe(before - 1);
      await cap.after('Repository tab closed');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-5.2.4 ───────────────────────────────────────────────────────────────
  test('location bar display [REQ-5.2.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['5.2.4'], async (cap) => {
      await cap.before('Location bar after login');
      const bar = page.locator('[data-location]').last();
      await expect(bar, 'a location bar should be shown').toBeVisible();
      await openRepository(page, ACCOUNT, REPOSITORY);
      await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 15000 });
      // It is a LOCATION bar: opening the repository must be reflected in it.
      await expect(bar, 'the location bar should name the open repository')
        .toContainText(REPOSITORY, { timeout: 15000 });
      await cap.after('Location bar showing the repository');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-5.2.5 ───────────────────────────────────────────────────────────────
  test('tabbed interface [REQ-5.2.5]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);
    await openRepository(page, ACCOUNT, REPOSITORY);

    await capture.requirement(REQ['5.2.5'], async (cap) => {
      await cap.before('Tabbed interface');
      const links = page.locator('[data-tab-link]');
      expect(await links.count(), 'login, account and repository tabs').toBeGreaterThanOrEqual(3);
      await expect(page.locator(repoPaneId)).toBeVisible({ timeout: 15000 });
      // Exactly one pane is in front at a time: the account pane is still in the
      // DOM behind the repository pane, which is why it is checked attached.
      await expect(page.locator(`#tab-account-${ACCOUNT}`).first()).toBeAttached();
      await expect(page.locator(`#tab-account-${ACCOUNT}`).first()).toBeHidden();
      await cap.after('Repository pane in front, account pane behind');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-5.1.1 direct URL ────────────────────────────────────────────────────
  test('direct URL navigation [REQ-5.1.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['5.1.1'], async (cap) => {
      await cap.before('Before direct navigation');
      await page.goto(`${BASE}/${ACCOUNT}/${REPOSITORY}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
      // A direct URL must resolve to the repository, not to a 404 shell.  Note
      // that a full page load drops the in-memory AuthStore, so this asserts the
      // route resolved, not that the session survived.
      await expect(page.locator('body'), 'the app should render').not.toBeEmpty();
      expect(page.url(), 'the repository URL should be reachable directly').toContain(REPOSITORY);
      await cap.after('Direct URL navigation resolved');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });

  // ── REQ-5.2.5 account <-> repositories ──────────────────────────────────────
  // KNOWN DEFECT, same treatment.  Measured: while the repository pane is in
  // front, clicking the account tab leaves NEITHER pane visible -- the account
  // pane stays hidden and the repository pane is hidden too, so the user is left
  // facing an empty frame.  Related, and probably the cause: #tab-account-<name>
  // exists TWICE in the DOM (two div.account-pane with the same id, which is
  // invalid HTML), and one of the two is discarded on that click.
  test('navigation between account and repositories [REQ-5.2.5]', async ({ page }) => {
    test.fail();   // see the note above
    const capture = new DocCapture(page, 'tests/pdfs/navigation', { enabled: CAPTURE_ENABLED });
    await login(page);

    await capture.requirement(REQ['5.2.5'], async (cap) => {
      await cap.before('Account pane after login');
      await expect(page.locator(`#tab-account-${ACCOUNT}`).first()).toBeAttached({ timeout: 15000 });

      await openRepository(page, ACCOUNT, REPOSITORY);
      await expect(page.locator(repoPaneId),
                   'the repository pane should come forward').toBeVisible({ timeout: 15000 });
      await cap.step('repository', 'Repository pane in front');

      await tab(page, 'account').click();
      await expect(page.locator(`#tab-account-${ACCOUNT}`).first(),
                   'clicking the account tab should bring it back').toBeVisible({ timeout: 15000 });
      await cap.after('Account pane in front again');
    });

    await capture.writeManifest(); await capture.writeIndex(); await page.close();
  });
});
