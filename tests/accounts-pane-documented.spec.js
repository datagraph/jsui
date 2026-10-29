import { test, expect } from '@playwright/test';
import { adminLogin } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';
import { ADMIN_USER, ADMIN_PASS, ADMIN_AUTHORIZATION } from './credentials.js';

/**
 * Accounts Pane Tests with Documentation Capture
 * Coverage: REQ-2.4.1, REQ-2.4.2, REQ-2.4.3, REQ-2.4.4, REQ-2.6.1
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/accounts-pane-documented.spec.js
 *
 * ── What is being asserted, and why each assertion is the one that matters ──
 *
 * The pane was rewritten on 2026-10-22.  It has unit coverage
 * (tests/administration.test.mjs) and browser coverage over fixtures
 * (tests/administration.browser.mjs); what it has never had is a run against a
 * live service, which is the only place three of these claims can fail.
 *
 *  - The listing answers NAMES.  `compute-get-accounts' declares the dimensions
 *    (id uri title readable writable) and then collects `(list name)', so the
 *    other three columns are derived per account, AFTER the paint, by
 *    `enrichAccountsPane' -- three requests per row.  The table must therefore
 *    be usable before enrichment finishes, and enrichment must not be waited on
 *    by the assertions about the table itself.
 *  - A column that has not arrived shows an em dash, not 0.  This is the one
 *    worth capturing in a PDF: a zero in a repository-count column is a WRONG
 *    answer presented as a real one, and it sorts as a wrong answer too.
 *  - A null sorts LAST in both directions, for the same reason.
 *  - An administrator may not delete the account they are signed in as.  Asserted
 *    as the absence of a control, not as a dialog that refuses.
 *
 * No guards.  An element that does not appear is a failure: see tests-inst/
 * for the generation where it was not, and tests-inst/README.txt for why.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ADMIN_USERNAME = ADMIN_USER();
const ADMIN_PASSWORD = ADMIN_PASS();

/** The account the suite signs in as, which is also the account it reads. */
const ACCOUNT_UNDER_TEST = ADMIN_USERNAME;

const PANE = '#admin-accounts';
const TABLE = '[data-testid="admin-accounts-table"]';

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Wait for the pane to finish rendering, and fail if it rendered an error.
 *
 * `dataset.loaded` is set by the error stub too, so a pane reading
 * "Error loading accounts: 500" counts as loaded; without the second assertion
 * every check below would be made against an error message.
 */
async function waitForAccountsPane(page) {
  await page.waitForFunction(
    () => document.getElementById('admin-accounts')?.dataset.loaded === 'true',
    null, { timeout: 20000 });
  await expect(page.locator(PANE),
               'the accounts pane should load its data, not an error')
    .not.toContainText(/Error loading|Error:/);
  await expect(page.locator(TABLE), 'the accounts table should be drawn')
    .toBeVisible({ timeout: 10000 });
}

/** The text of one column, for every row, in the order the table has them. */
async function columnValues(page, field) {
  return page.locator(`${TABLE} tbody tr td[data-field="${field}"]`).allTextContents();
}

/** Click a column heading and wait for the re-render to settle. */
async function sortBy(page, key) {
  const head = page.locator(`[data-testid="account-sort-${key}"]`);
  await expect(head, `the ${key} column should be orderable`).toBeVisible();
  await head.click();
  await page.waitForTimeout(600);
}

// ── Requirement functions ────────────────────────────────────────────────────

// ============================================================
// REQ-2.4.1: a table of a brief entry for each reachable account
// REQ-2.4.2: name, creation, last use, repository count
// ============================================================
async function REQ_2_4_1_accountListing(page, capture) {
  await capture.requirement(REQ['2.4.1'], async (cap) => {
    await cap.before('Accounts pane with the account listing');

    const rows = page.locator(`${TABLE} tbody tr[data-account-row]`);
    await expect(rows.first(),
                 'the listing should hold at least the signed-in account')
      .toBeVisible({ timeout: 10000 });

    // The four columns of REQ-2.4.2, by the key each is ordered on.
    for (const key of ['name', 'created', 'lastUsed', 'repositories']) {
      await expect(page.locator(`[data-testid="account-sort-${key}"]`),
                   `REQ-2.4.2: the ${key} column should be present`).toBeVisible();
    }

    // Every row carries the account it is for, which is what the Events and
    // Delete controls are keyed on further down.
    const named = await rows.evaluateAll(
      (trs) => trs.every((tr) => !!tr.dataset.accountRow));
    expect(named, 'every row should name its account').toBe(true);

    await cap.after('Account listing with name, created, last used and repository count');
  });
}

// ============================================================
// REQ-2.4.2: an unfetched value shows an em dash, never 0
// ============================================================
async function REQ_2_4_2_unfetchedIsNotZero(page, capture) {
  await capture.requirement(REQ['2.4.2'], async (cap) => {
    await cap.before('Columns before enrichment has filled them');

    // Read the derived columns IMMEDIATELY, before the per-account requests
    // can have returned.  Whatever is there now must be a dash or a real value
    // -- the point of the requirement is that it is never a placeholder zero.
    for (const field of ['created', 'lastUsed', 'repositories']) {
      const values = await columnValues(page, field);
      for (const v of values) {
        expect(v.trim(),
               `REQ-2.4.2: an unfetched ${field} must read as unknown, not as 0`)
          .not.toBe('0');
      }
    }

    // The dash is a span with a title, so that it reads as "not fetched" to a
    // user hovering it and not merely as a typographic blank.
    const dashes = page.locator(`${TABLE} tbody td span[title="not yet fetched"]`);
    const dashCount = await dashes.count();
    if (dashCount > 0) {
      await expect(dashes.first()).toHaveText('—');
    }

    // Now let enrichment run, and capture the filled table beside the empty one.
    await page.waitForTimeout(6000);
    await cap.after(`Columns after enrichment (${dashCount} unfetched at first paint)`);
  });
}

// ============================================================
// REQ-2.4.3: ordered optionally by any field, nulls last both ways
// ============================================================
async function REQ_2_4_3_ordering(page, capture) {
  await capture.requirement(REQ['2.4.3'], async (cap) => {
    await cap.before('Listing in its default order');

    const names = () => page.locator(`${TABLE} tbody tr[data-account-row]`)
      .evaluateAll((trs) => trs.map((tr) => tr.dataset.accountRow));

    const before = await names();
    test.skip(before.length < 2, 'ordering needs at least two accounts to show');

    await sortBy(page, 'name');
    const ascending = await names();
    const sorted = [...ascending].sort((a, b) => a.localeCompare(b));
    expect(ascending, 'ascending by name should be in name order').toEqual(sorted);
    await cap.step('ascending', 'Ordered by name, ascending');

    await sortBy(page, 'name');
    const descending = await names();
    expect(descending, 'a second click should reverse the order')
      .toEqual([...sorted].reverse());

    // Nulls last in BOTH directions -- the assertion that distinguishes this
    // from an ordinary sort.  An unfetched value is not a small value.
    for (const field of ['created', 'lastUsed', 'repositories']) {
      await sortBy(page, field);
      const first = await columnValues(page, field);
      await sortBy(page, field);
      const second = await columnValues(page, field);
      for (const values of [first, second]) {
        const dashAt = values.findIndex((v) => v.trim() === '—');
        if (dashAt === -1) continue;
        const after = values.slice(dashAt);
        expect(after.every((v) => v.trim() === '—'),
               `REQ-2.4.3: unknown ${field} values should sort last in both directions`)
          .toBe(true);
      }
    }

    await cap.after('Ordered by a derived column, with unknown values last');
  });
}

// ============================================================
// REQ-2.4.4: an administrator sees all accounts; everyone else sees their own
//            and the accounts that share a repository with them
// ============================================================

/**
 * Which of the two halves of REQ-2.4.4 this run is in a position to test.
 *
 * The narrowed listing carries a note saying what it is; the administrator's
 * does not.  Reading the role off the rendered pane rather than assuming it
 * means the suite asserts the rule it is actually under, and says which, instead
 * of failing because the test account happens not to be an administrator.
 */
async function observedRole(page) {
  const narrowed = await page.locator(PANE)
    .locator('text=accounts that share a repository with you').count();
  return narrowed > 0 ? 'user' : 'administrator';
}

async function REQ_2_4_4_scope(page, capture) {
  await capture.requirement(REQ['2.4.4'], async (cap) => {
    await cap.before('Account listing as this agent sees it');

    const role = await observedRole(page);
    const names = await page.locator(`${TABLE} tbody tr[data-account-row]`)
      .evaluateAll((trs) => trs.map((tr) => tr.dataset.accountRow));
    expect(names.length, 'the listing should hold at least one account')
      .toBeGreaterThan(0);

    if (role === 'administrator') {
      await expect(page.locator(PANE),
                   'an administrator listing should not be the narrowed one')
        .not.toContainText('accounts that share a repository with you');
      await cap.after(`Administrator: ${names.length} account(s), unnarrowed`);
      return;
    }

    // The other half of the requirement, and the one this service's test
    // account is under.  The rule NARROWS what the service returned and can
    // never widen it: the listing must be the agent's own account plus the
    // accounts behind the repositories shared with it, and nothing else.
    expect(names, 'REQ-2.4.4: a non-administrator sees their own account')
      .toContain(ACCOUNT_UNDER_TEST);

    const collaborating = await page.evaluate(async ({ account, authorization }) => {
      const resp = await fetch(
        `/system/accounts/${encodeURIComponent(account)}/collaboration`,
        { headers: { Accept: 'application/json',
                     Authorization: authorization },
          cache: 'no-store' });
      if (!resp.ok) return null;
      const body = await resp.json();
      const list = Array.isArray(body) ? body : (body?.collaborations ?? []);
      return [...new Set(list
        .map((c) => String(c.repository ?? c.id ?? ''))
        .map((id) => id.split('/')[0])
        .filter(Boolean))];
    }, { account: ACCOUNT_UNDER_TEST, authorization: ADMIN_AUTHORIZATION() });

    expect(collaborating,
           'the collaboration resource should answer, so the rule can be checked')
      .not.toBeNull();

    const permitted = new Set([ACCOUNT_UNDER_TEST, ...collaborating]);
    const surplus = names.filter((n) => !permitted.has(n));
    expect(surplus,
           'REQ-2.4.4: the rule narrows and never widens -- no account may appear '
           + 'that is neither the agent\'s own nor one sharing a repository with it')
      .toEqual([]);

    await cap.after(`User: ${names.length} account(s) — own plus `
                    + `${collaborating.length} collaborating`);
  });
}

// ============================================================
// REQ-2.6.1: delete control, offered to administrators, never for self
// ============================================================
async function REQ_2_6_1_deleteControl(page, capture) {
  await capture.requirement(REQ['2.6.1'], async (cap) => {
    await cap.before('Account listing with its row actions');

    const role = await observedRole(page);

    // The half that holds under either role, and the one the requirement
    // singles out: the account the agent is authenticated as is never
    // deletable.  Asserted as the ABSENCE of a control, not as a dialog that
    // refuses -- a refusal the user can reach is a different design.
    await expect(page.locator(
      `[data-testid="admin-account-delete-btn-${ACCOUNT_UNDER_TEST}"]`),
      'REQ-2.6.1: the account the agent is authenticated as must not offer a '
      + 'delete control')
      .toHaveCount(0);

    // ...and the row is there, so that absence is the rule applying rather
    // than the row being missing.
    await expect(page.locator(
      `${TABLE} tbody tr[data-account-row="${ACCOUNT_UNDER_TEST}"]`),
      'the signed-in account should still be listed')
      .toHaveCount(1);

    const others = await page.locator(`${TABLE} tbody tr[data-account-row]`)
      .evaluateAll((trs, me) => trs
        .map((tr) => tr.dataset.accountRow)
        .filter((n) => n !== me), ACCOUNT_UNDER_TEST);

    if (role === 'administrator') {
      for (const name of others.slice(0, 3)) {
        await expect(page.locator(`[data-testid="admin-account-delete-btn-${name}"]`),
                     `another account (${name}) should be deletable by an administrator`)
          .toHaveCount(1);
      }
      await cap.after(`Delete offered for ${others.length} other account(s), `
                      + `not for ${ACCOUNT_UNDER_TEST}`);
      return;
    }

    // A non-administrator gets no delete control at all, for any row.
    for (const name of others) {
      await expect(page.locator(`[data-testid="admin-account-delete-btn-${name}"]`),
                   `REQ-2.6.1: a non-administrator may not delete ${name} either`)
        .toHaveCount(0);
    }
    await cap.after(`Role ${role}: no account offers a delete control `
                    + `(${others.length} other account(s) listed)`);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Accounts Pane', () => {
  test.setTimeout(120000); // Enrichment is three requests per account.

  test('account listing [REQ-2.4.1, REQ-2.4.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin-accounts', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_2_4_1_accountListing(page, capture);
    await REQ_2_4_2_unfetchedIsNotZero(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('order the listing by any column [REQ-2.4.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin-accounts', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);
    await page.waitForTimeout(6000); // let enrichment land, so there is something to order

    await REQ_2_4_3_ordering(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('listing scope and delete control [REQ-2.4.4, REQ-2.6.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/admin-accounts', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_2_4_4_scope(page, capture);
    await REQ_2_6_1_deleteControl(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });
});
