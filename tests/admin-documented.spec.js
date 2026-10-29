import { test, expect } from '@playwright/test';
import { adminLogin, ADMIN_URL, API_HOST } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';
import { ADMIN_USER, ADMIN_PASS } from './credentials.js';
import path from 'path';
import fs from 'fs';

/**
 * Admin Console Tests with Documentation Capture
 * Coverage: REQ-A.1.x through REQ-A.6.x
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/admin-documented.spec.js
 *
 * Credentials come from tests/credentials.js: the environment, else
 * ~/.dydra/<host>.<account>.password -- the same convention as the shell
 * suites' ~/.dydra/<host>.<account>.token, and outside the working copy.
 * ADMIN_USERNAME defaults to the account name; ADMIN_PASSWORD has NO default
 * and raises when it is not configured.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ADMIN_USERNAME = ADMIN_USER();
const ADMIN_PASSWORD = ADMIN_PASS();

// Where the admin manual expects its screenshots
const MANUAL_IMAGES_DIR = path.join(process.cwd(), 'doc', 'admin-manual', 'images');
if (!fs.existsSync(MANUAL_IMAGES_DIR)) {
  fs.mkdirSync(MANUAL_IMAGES_DIR, { recursive: true });
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Save a screenshot at the exact path the admin manual HTML references. */
async function saveManualImage(page, name) {
  try {
    await page.screenshot({ path: path.join(MANUAL_IMAGES_DIR, name), fullPage: false });
    console.log(`[ManualImage] ${name}`);
  } catch (e) {
    console.warn(`[ManualImage] Could not save ${name}: ${e.message}`);
  }
}

/** Click a dashboard tab and wait briefly for its panel to render. */
async function clickTab(page, panelId) {
  // Asserted, not guarded.  This is the backbone of nearly every admin test: if
  // a tab is missing the old version returned quietly and the test carried on to
  // make its captures of whatever happened to be on screen.
  const link = page.locator(`[data-tab-link][href="#${panelId}"]`);
  await expect(link, `the ${panelId} tab should be offered`).toBeVisible({ timeout: 10000 });
  await link.click();
  await expect(page.locator(`#${panelId}`), `${panelId} should open`).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
}

/** Click the graph sub-tab within whichever history panel is active. */
async function clickGraphSubTab(page, panelId) {
  // Scoped to the panel.  An unscoped `[data-history-tab="graph"]`.first() picks
  // the QUERY-history pane's button -- it comes first in the DOM -- which is
  // hidden whenever another history pane is in front, so the click reports the
  // wrong panel as having no graph.
  const btn = page.locator(`#${panelId} [data-history-tab="graph"]`).first();
  await expect(btn, `${panelId} should offer a graph view`).toBeVisible({ timeout: 10000 });
  await btn.click();
  await page.waitForTimeout(800);
  return true;
}

/** Wait for a pane to contain something other than the Loading placeholder. */
async function waitForPaneLoaded(page, panelId) {
  // No .catch(() => {}) here: a pane that never finishes loading is the failure
  // this helper exists to detect, and swallowing the timeout turned every pane
  // test into a screenshot of a spinner.
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      return el && el.dataset.loaded === 'true';
    },
    panelId,
    { timeout: 20000 }
  );
  await page.waitForTimeout(400);
  // `loaded` only means the pane's render finished -- an error stub sets it too,
  // so a pane reading "Error loading ...: 500" counted as loaded and every
  // assertion below it was made against an error message.
  await expect(page.locator(`#${panelId}`),
               `${panelId} should load its data, not an error`).not.toContainText(/Error loading|Error:/);
}

/** Accept browser confirm() dialogs automatically for the duration of fn(). */
async function withAutoConfirm(page, fn) {
  const handler = (dialog) => dialog.accept();
  page.on('dialog', handler);
  try {
    await fn();
  } finally {
    page.off('dialog', handler);
  }
}

// ── Requirement functions ────────────────────────────────────────────────────

// ============================================================
// REQ-A.1.1: Admin Login as Administrator
// ============================================================
async function REQ_A_1_1_adminLogin(page, capture) {
  await capture.requirement(REQ['A.1.1'], async (cap) => {
    await page.goto(ADMIN_URL);
    await page.waitForLoadState('networkidle');

    await cap.before('Admin login form displayed');
    await saveManualImage(page, 'admin-login-form.png');

    const hostInput = page.getByTestId('login-host-input');
    if (await hostInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await hostInput.fill(API_HOST);
    }
    await page.getByTestId('login-username-input').fill(ADMIN_USERNAME);
    await page.getByTestId('login-password-input').fill(ADMIN_PASSWORD);

    await cap.step('form-filled', 'Credentials entered in login form');

    await page.getByTestId('login-submit').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await cap.after('Authenticated, dashboard loaded');
    await saveManualImage(page, 'admin-login-success.png');
  });
}

// ============================================================
// REQ-A.1.3: Admin Logout
// ============================================================
async function REQ_A_1_3_adminLogout(page, capture) {
  await capture.requirement(REQ['A.1.3'], async (cap) => {
    await cap.before('Authenticated admin session');

    // handleLogout() clears in-memory auth and re-renders the login page —
    // no browser navigation occurs, so waitForLoadState is not applicable.
    // We click the link and wait for the login form to reappear in the DOM.
    await page.locator('#nav [data-action="logout"]').click();
    await page.waitForSelector('[data-testid="login-form"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    await cap.after('Login page displayed after logout');
  });
}

// ============================================================
// REQ-A.2.1: Dashboard Tab Navigation
// ============================================================
async function REQ_A_2_1_dashboardNavigation(page, capture) {
  await capture.requirement(REQ['A.2.1'], async (cap) => {
    await cap.before('Dashboard loaded, Accounts tab active by default');
    await saveManualImage(page, 'admin-dashboard-overview.png');

    // Capture the tab bar
    const tabBar = page.locator('#admin-tabs, .pane-tabs-bar').first();
    if (await tabBar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveManualImage(page, 'admin-dashboard-tabs.png');
    }

    // Exercise tab switching
    await clickTab(page, 'admin-repositories');
    await clickTab(page, 'admin-invitations');
    await clickTab(page, 'admin-accounts'); // return to accounts

    await cap.after('Navigated through dashboard tabs');
  });
}

// ============================================================
// REQ-A.2.2: Location Bar Navigation
// ============================================================
async function REQ_A_2_2_locationBar(page, capture) {
  await capture.requirement(REQ['A.2.2'], async (cap) => {
    const bar = page.locator('#location-bar');
    // Asserted, not skipped: the old block captured a "skipped" screenshot
    // and returned, so the requirement below it never ran.
    await expect(bar, 'this control should be present').toBeVisible({ timeout: 3000 });

    await cap.before('Location bar displaying current route');

    // Click to edit and navigate to invitations alias
    const display = page.locator('#location-display');
    await display.click();
    const input = page.locator('#location-input');
    await input.fill('/invitations');
    await input.press('Enter');
    await page.waitForTimeout(1000);

    await cap.after('Navigated via location bar to /invitations');

    // Return to dashboard root
    await display.click();
    await input.fill('/');
    await input.press('Enter');
    await page.waitForTimeout(500);
  });
}

// ============================================================
// REQ-A.3.1: View System Accounts
// ============================================================
async function REQ_A_3_1_viewAccounts(page, capture) {
  await capture.requirement(REQ['A.3.1'], async (cap) => {
    await cap.before('Accounts pane loading');

    await waitForPaneLoaded(page, 'admin-accounts');
    await page.waitForSelector('#admin-accounts table', { timeout: 10000 }).catch(() => {});

    await cap.after('Accounts list displayed');
    await saveManualImage(page, 'admin-accounts-list.png');
  });
}

// ============================================================
// REQ-A.3.2: Account Details Dialog
// ============================================================
async function REQ_A_3_2_accountDetails(page, capture) {
  await capture.requirement(REQ['A.3.2'], async (cap) => {
    // Target our own account's Details link for reliability
    const ownDetails = page.locator(`.account-details[data-account="${ADMIN_USERNAME}"]`);
    const anyDetails = page.locator('.account-details').first();
    const link = await ownDetails.isVisible({ timeout: 3000 }).catch(() => false)
      ? ownDetails
      : anyDetails;

    // Asserted, not skipped: the old block captured a "skipped" screenshot
    // and returned, so the requirement below it never ran.
    await expect(link, 'this control should be present').toBeVisible({ timeout: 3000 });

    await cap.before('Accounts list before opening details dialog');
    await link.click();
    await page.waitForTimeout(800);

    await cap.after('Account details dialog displayed');
    await saveManualImage(page, 'admin-account-details-dialog.png');

    // Close the dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
}

// ============================================================
// REQ-A.3.3: Create Account  (Admin only)
// REQ-A.3.4: Delete Account  (Admin only)
// ============================================================
async function REQ_A_3_3_createAccount(page, capture) {
  const newAccountName = `pw-admin-test-${Date.now()}`;

  await capture.requirement(REQ['A.3.3'], async (cap) => {
    const newBtn = page.getByTestId('admin-new-account-btn');
    // Asserted: the test.skip() above already established that this session
    // is an administrator, so the control must be here.
    await expect(newBtn, 'the New control should be present').toBeVisible({ timeout: 3000 });

    await cap.before('Accounts list before creating new account');
    await newBtn.click();
    await page.waitForTimeout(400);

    const input = page.locator('.new-account-name');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(newAccountName);
    await cap.step('dialog-filled', `New Account dialog with name: ${newAccountName}`);

    await page.locator('.new-account-ok').click();
    await page.waitForTimeout(1500);

    await cap.after('Account created, list updated');
  });

  return newAccountName;
}

async function REQ_A_3_4_deleteAccount(page, capture, accountName) {
  await capture.requirement(REQ['A.3.4'], async (cap) => {
    const deleteBtn = page.getByTestId(`admin-account-delete-btn-${accountName}`);
    // Asserted, not skipped: the old block captured a "skipped" screenshot
    // and returned, so the requirement below it never ran.
    await expect(deleteBtn, 'this control should be present').toBeVisible({ timeout: 5000 });

    await cap.before('Accounts list before deletion');

    await withAutoConfirm(page, async () => {
      await deleteBtn.click();
      // Capture the browser confirm dialog state before it is auto-accepted
      await page.waitForTimeout(300);
      await saveManualImage(page, 'admin-account-delete-confirmation.png');
    });

    await page.waitForTimeout(1500);
    await cap.after('Account deleted, list updated');
  });
}

// ============================================================
// REQ-A.4.1: View Account Repositories
// ============================================================
async function REQ_A_4_1_viewRepositories(page, capture) {
  await capture.requirement(REQ['A.4.1'], async (cap) => {
    // Ensure our own account is checked
    const ownCheckbox = page.locator(`.account-checkbox[data-account="${ADMIN_USERNAME}"]`);
    if (await ownCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!await ownCheckbox.isChecked()) await ownCheckbox.check();
    } else {
      const first = page.locator('.account-checkbox').first();
      if (await first.isVisible({ timeout: 3000 }).catch(() => false) && !await first.isChecked()) {
        await first.check();
      }
    }

    await cap.before('Account checked, navigating to Repositories tab');
    await clickTab(page, 'admin-repositories');
    await waitForPaneLoaded(page, 'admin-repositories');
    await page.waitForSelector('#admin-repositories table', { timeout: 10000 }).catch(() => {});

    await cap.after('Repositories list displayed');
    await saveManualImage(page, 'admin-repositories-list.png');
  });
}

// ============================================================
// REQ-A.4.2: Create Repository  (Admin only)
// REQ-A.4.3: Delete Repository  (Admin only)
// ============================================================
async function REQ_A_4_2_createRepository(page, capture, accountName) {
  const newRepoName = `pw-test-repo-${Date.now()}`;

  await capture.requirement(REQ['A.4.2'], async (cap) => {
    const newBtn = page.getByTestId('admin-new-repo-btn');
    // Asserted: the test.skip() above already established that this session
    // is an administrator, so the control must be here.
    await expect(newBtn, 'the New control should be present').toBeVisible({ timeout: 3000 });

    await cap.before('Repositories list before creating new repository');
    await newBtn.click();
    await page.waitForTimeout(500);

    await saveManualImage(page, 'admin-repository-new-dialog.png');

    // Select the target account in the dropdown
    const select = page.locator('.new-repo-account');
    if (await select.isVisible({ timeout: 3000 }).catch(() => false)) {
      await select.selectOption(accountName).catch(async () => {
        // Fall back to first non-empty option
        const opts = await select.locator('option').all();
        if (opts.length > 0) await select.selectOption({ index: 0 });
      });
    }

    const input = page.locator('.new-repo-name');
    await input.fill(newRepoName);
    await cap.step('dialog-filled', `New Repository dialog: ${accountName}/${newRepoName}`);

    await page.locator('.new-repo-ok').click();
    await page.waitForTimeout(1500);

    await cap.after('Repository created, list updated');
  });

  return newRepoName;
}

async function REQ_A_4_3_deleteRepository(page, capture, accountName, repoName) {
  await capture.requirement(REQ['A.4.3'], async (cap) => {
    const deleteBtn = page.getByTestId(`admin-repo-delete-btn-${accountName}-${repoName}`);
    // Asserted, not skipped: the old block captured a "skipped" screenshot
    // and returned, so the requirement below it never ran.
    await expect(deleteBtn, 'this control should be present').toBeVisible({ timeout: 5000 });

    await cap.before('Repositories list before deletion');

    await withAutoConfirm(page, async () => {
      await deleteBtn.click();
      await page.waitForTimeout(300);
      await saveManualImage(page, 'admin-repository-delete-confirmation.png');
    });

    await page.waitForTimeout(1500);
    await cap.after('Repository deleted, list updated');
  });
}

// ============================================================
// REQ-A.5.1: View Invitations
// ============================================================
async function REQ_A_5_1_viewInvitations(page, capture) {
  await capture.requirement(REQ['A.5.1'], async (cap) => {
    await cap.before('Navigating to Invitations tab');
    await clickTab(page, 'admin-invitations');
    await waitForPaneLoaded(page, 'admin-invitations');

    await cap.after('Invitations list displayed');
    await saveManualImage(page, 'admin-invitations-list.png');
  });
}

// ============================================================
// REQ-A.5.2: Create Invitation  (Admin only)
// REQ-A.5.3: Delete Invitation  (Admin only)
// ============================================================
async function REQ_A_5_2_createInvitation(page, capture) {
  const testEmail = `pw-test-${Date.now()}@example.com`;

  await capture.requirement(REQ['A.5.2'], async (cap) => {
    const newBtn = page.getByTestId('admin-new-invite-btn');
    // Asserted: the test.skip() above already established that this session
    // is an administrator, so the control must be here.
    await expect(newBtn, 'the New control should be present').toBeVisible({ timeout: 3000 });

    await cap.before('Invitations list before creating new invitation');
    await newBtn.click();
    await page.waitForTimeout(400);

    await saveManualImage(page, 'admin-invitation-new-dialog.png');

    const input = page.locator('.new-invite-email');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(testEmail);
    await cap.step('dialog-filled', `New Invitation dialog with email: ${testEmail}`);

    await page.locator('.new-invite-ok').click();
    await page.waitForTimeout(1500);

    await cap.after('Invitation created');
  });

  return testEmail;
}

async function REQ_A_5_3_deleteInvitation(page, capture, email) {
  await capture.requirement(REQ['A.5.3'], async (cap) => {
    const deleteLink = page.locator(`.invite-delete[data-email="${email}"]`);
    // Asserted, not skipped: the old block captured a "skipped" screenshot
    // and returned, so the requirement below it never ran.
    await expect(deleteLink, 'this control should be present').toBeVisible({ timeout: 5000 });

    await cap.before('Invitations list before deletion');

    await withAutoConfirm(page, async () => {
      await deleteLink.click();
    });

    await page.waitForTimeout(1500);
    await cap.after('Invitation deleted');
  });
}

// ============================================================
// REQ-A.6.1 / A.6.2: Query History (table + graph)
// ============================================================
async function REQ_A_6_1_queryHistoryTable(page, capture) {
  await capture.requirement(REQ['A.6.1'], async (cap) => {
    await cap.before('Navigating to Query History tab');
    await clickTab(page, 'admin-query-history');
    await waitForPaneLoaded(page, 'admin-query-history');

    await cap.after('Query history table displayed');
    await saveManualImage(page, 'admin-query-history-table.png');
  });
}

async function REQ_A_6_2_queryHistoryGraph(page, capture) {
  await capture.requirement(REQ['A.6.2'], async (cap) => {
    await cap.before('Query history table view');

    const switched = await clickGraphSubTab(page, 'admin-query-history');
    if (switched) {
      await cap.after('Query history graph displayed');
      await saveManualImage(page, 'admin-query-history-graph.png');
    } else {
      await cap.after('Graph sub-tab not available — skipped');
    }
  });
}

// ============================================================
// REQ-A.6.3: Transaction History
// ============================================================
async function REQ_A_6_3_transactionHistory(page, capture) {
  await capture.requirement(REQ['A.6.3'], async (cap) => {
    await cap.before('Navigating to Transaction History tab');
    await clickTab(page, 'admin-transaction-history');
    await waitForPaneLoaded(page, 'admin-transaction-history');

    await cap.after('Transaction history displayed');
    await saveManualImage(page, 'admin-transaction-history.png');
  });
}

// ============================================================
// REQ-A.6.4 / A.6.5: Import History (table + graph)
// ============================================================
async function REQ_A_6_4_importHistoryTable(page, capture) {
  await capture.requirement(REQ['A.6.4'], async (cap) => {
    await cap.before('Navigating to Import History tab');
    await clickTab(page, 'admin-import-history');
    await waitForPaneLoaded(page, 'admin-import-history');

    await cap.after('Import history table displayed');
    await saveManualImage(page, 'admin-import-history-table.png');
  });
}

async function REQ_A_6_5_importHistoryGraph(page, capture) {
  await capture.requirement(REQ['A.6.5'], async (cap) => {
    await cap.before('Import history table view');

    const switched = await clickGraphSubTab(page, 'admin-import-history');
    if (switched) {
      await cap.after('Import history graph displayed');
      await saveManualImage(page, 'admin-import-history-graph.png');
    } else {
      await cap.after('Graph sub-tab not available — skipped');
    }
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Admin Console', () => {
  test.setTimeout(90000); // Admin panes make real API calls; allow generous time.

  // ============================================================
  test('login as administrator [REQ-A.1.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });

    await REQ_A_1_1_adminLogin(page, capture);

    const dashboard = page.locator('#admin-accounts, #admin-tabs');
    // Asserted: this used to be a console.log, so a login that silently failed
    // to produce a dashboard still passed.
    await expect(dashboard.first(),
                 'the admin dashboard should load after login').toBeVisible({ timeout: 15000 });

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('logout [REQ-A.1.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await REQ_A_1_3_adminLogout(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('dashboard tab navigation [REQ-A.2.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForPaneLoaded(page, 'admin-accounts');

    await REQ_A_2_1_dashboardNavigation(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('location bar navigation [REQ-A.2.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForPaneLoaded(page, 'admin-accounts');

    await REQ_A_2_2_locationBar(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('view system accounts [REQ-A.3.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await REQ_A_3_1_viewAccounts(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('account details dialog [REQ-A.3.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForPaneLoaded(page, 'admin-accounts');
    await page.waitForSelector('#admin-accounts table', { timeout: 10000 }).catch(() => {});

    await REQ_A_3_2_accountDetails(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('create and delete account [REQ-A.3.3, REQ-A.3.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    // These three requirements need an ADMINISTRATOR.  ui/admin/pages.js renders
    // the New controls as `${isAdmin ? ... : ""}`, and the test account is not an
    // admin, so the control is absent -- not broken.  Measured: no
    // pw-admin-test-* account was ever created by the old suite's runs, because
    // its guard skipped the whole flow and reported a pass.  A stated skip says
    // what a silent pass could not: this is unverified, and why.
    test.skip(!(await page.getByTestId('admin-new-account-btn').isVisible().catch(() => false)),
              'requires an administrator account (the New control is rendered only when isAdmin)');
    await waitForPaneLoaded(page, 'admin-accounts');
    await page.waitForSelector('#admin-accounts table', { timeout: 10000 }).catch(() => {});

    const newName = await REQ_A_3_3_createAccount(page, capture);
    if (newName) {
      await waitForPaneLoaded(page, 'admin-accounts');
      await REQ_A_3_4_deleteAccount(page, capture, newName);
    }

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('view repositories for selected account [REQ-A.4.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForPaneLoaded(page, 'admin-accounts');

    await REQ_A_4_1_viewRepositories(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('create and delete repository [REQ-A.4.2, REQ-A.4.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    // These three requirements need an ADMINISTRATOR.  ui/admin/pages.js renders
    // the New controls as `${isAdmin ? ... : ""}`, and the test account is not an
    // admin, so the control is absent -- not broken.  Measured: no
    // pw-admin-test-* account was ever created by the old suite's runs, because
    // its guard skipped the whole flow and reported a pass.  A stated skip says
    // what a silent pass could not: this is unverified, and why.
    test.skip(!(await page.getByTestId('admin-new-repo-btn').isVisible().catch(() => false)),
              'requires an administrator account (the New control is rendered only when isAdmin)');
    await waitForPaneLoaded(page, 'admin-accounts');

    // Ensure our account is checked and the Repositories tab is loaded
    const ownCheckbox = page.locator(`.account-checkbox[data-account="${ADMIN_USERNAME}"]`);
    if (await ownCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!await ownCheckbox.isChecked()) await ownCheckbox.check();
    }
    await clickTab(page, 'admin-repositories');
    await waitForPaneLoaded(page, 'admin-repositories');

    const newRepo = await REQ_A_4_2_createRepository(page, capture, ADMIN_USERNAME);
    if (newRepo) {
      await waitForPaneLoaded(page, 'admin-repositories');
      await REQ_A_4_3_deleteRepository(page, capture, ADMIN_USERNAME, newRepo);
    }

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('view invitations [REQ-A.5.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await REQ_A_5_1_viewInvitations(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('create and delete invitation [REQ-A.5.2, REQ-A.5.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    // These three requirements need an ADMINISTRATOR.  ui/admin/pages.js renders
    // the New controls as `${isAdmin ? ... : ""}`, and the test account is not an
    // admin, so the control is absent -- not broken.  Measured: no
    // pw-admin-test-* account was ever created by the old suite's runs, because
    // its guard skipped the whole flow and reported a pass.  A stated skip says
    // what a silent pass could not: this is unverified, and why.
    test.skip(!(await page.getByTestId('admin-new-invite-btn').isVisible().catch(() => false)),
              'requires an administrator account (the New control is rendered only when isAdmin)');
    await clickTab(page, 'admin-invitations');
    await waitForPaneLoaded(page, 'admin-invitations');

    const testEmail = await REQ_A_5_2_createInvitation(page, capture);
    if (testEmail) {
      await waitForPaneLoaded(page, 'admin-invitations');
      await REQ_A_5_3_deleteInvitation(page, capture, testEmail);
    }

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('query history table and graph [REQ-A.6.1, REQ-A.6.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForPaneLoaded(page, 'admin-accounts');

    // Select own account and a repository to have a chance of query data
    const ownCheckbox = page.locator(`.account-checkbox[data-account="${ADMIN_USERNAME}"]`);
    if (await ownCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!await ownCheckbox.isChecked()) await ownCheckbox.check();
    }

    await clickTab(page, 'admin-repositories');
    await waitForPaneLoaded(page, 'admin-repositories');
    const firstRepoCheckbox = page.locator('.repo-checkbox').first();
    if (await firstRepoCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (!await firstRepoCheckbox.isChecked()) await firstRepoCheckbox.check();
    }

    await REQ_A_6_1_queryHistoryTable(page, capture);
    await REQ_A_6_2_queryHistoryGraph(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  test('transaction history [REQ-A.6.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    // Measured: this pane reports "Error loading transactions: 401" for a
    // non-administrator -- a permission boundary, not a defect -- so it is
    // skipped on the same ground as the create/delete tests rather than failed.
    test.skip(!(await page.getByTestId('admin-new-account-btn').isVisible().catch(() => false)),
              'requires an administrator account (the transactions endpoint answers 401 otherwise)');

    await REQ_A_6_3_transactionHistory(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  // ============================================================
  // The graph view IS implemented: renderImportHistoryPane plots quad_count
  // against timestamp on a log scale and renders the table/graph switch
  // unconditionally (ui/admin/pages.js:1022-1087).  An earlier note here claimed
  // it was missing; that was wrong -- clickGraphSubTab searched the whole page
  // and kept finding the QUERY pane's button, hidden behind the active pane.
  //
  // This is ADMIN-ONLY, like transaction history.  The handler's first branch is
  //     (cond ((not (dydra:administrator-p (http:request-agent request)))
  //            (http:not-found))   ; not unauthorized
  // so a non-administrator is meant to get a 404 that discloses nothing.  What
  // the test account actually receives is a 500 -- the 404 fails while being
  // produced:
  //   [NO-APPLICABLE-METHOD-ERROR] #<STANDARD-GENERIC-FUNCTION PURI:URI (5)>
  //   when called with (<http://dydra.com/system/service_history/imports>)
  // -- and the pane renders "Error loading import history: 500".  That
  // 500-instead-of-404 is a real but separate fault, and it is the reason this
  // test cannot simply be skipped on a clean refusal the way transaction history
  // is.
  //
  // So: skipped on the same administrator ground as its siblings.  Reinstate the
  // assertions once an admin session is available, and raise the
  // 500-instead-of-404 separately -- it affects every non-admin caller of this
  // endpoint, not just the tests.
  test('import history table and graph [REQ-A.6.4, REQ-A.6.5]', async ({ page }) => {
    test.fail();   // see the note above
    const capture = new DocCapture(page, 'tests/pdfs/admin', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    test.skip(!(await page.getByTestId('admin-new-account-btn').isVisible().catch(() => false)),
              'requires an administrator account (the endpoint answers non-admins with a 404 that currently 500s)');

    await REQ_A_6_4_importHistoryTable(page, capture);
    await REQ_A_6_5_importHistoryGraph(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

});
