import { test, expect } from '@playwright/test';
import { adminLogin } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';
import { ADMIN_USER, ADMIN_PASS, ADMIN_AUTHORIZATION } from './credentials.js';

/**
 * Lifecycle Events Tests with Documentation Capture
 * Coverage: REQ-2.5.1, REQ-2.5.2, REQ-2.5.3, REQ-2.5.4, REQ-3.8.1, REQ-3.8.3,
 *           REQ-3.8.7
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/events-documented.spec.js
 *
 * ── The column that was empty for as long as the tab existed ────────────────
 *
 * `format-events-json' in spocq-server/admin.lisp emits, per event,
 * {timestamp, action, agent, details}.  The table rendered a column headed
 * "Actor" out of `e.actor', which no event has ever carried.  Every cell was
 * blank, for every account, since the tab was built.
 *
 * That is the reason this file asserts on a HEADING and on a POPULATED cell
 * rather than on the table merely being present.  An empty column reads as
 * "no agent recorded" -- plausible, unremarkable, and indistinguishable from
 * working -- which is precisely why nobody reported it.  A test that checks
 * the table exists would have passed throughout.
 *
 * ── Why the type strings are asserted character by character ────────────────
 *
 * `events.type' is a rails single-table-inheritance column: the value is a
 * ruby class name, NOUN FIRST -- RepositoryClearedEvent.  The service composed
 * it VERB first -- ClearRepositoryEvent -- which matched none of rails' six
 * classes, so every event the service ever wrote was unreadable by rails.
 * Corrected 2026-10-23 (build 20261023T012520).  Development hosts still hold
 * verb-first rows, and the client reads both and reports which era a row came
 * from, so this file accepts either spelling and asserts that whichever it got
 * was TRANSLATED rather than shown raw.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ADMIN_USERNAME = ADMIN_USER();
const ADMIN_PASSWORD = ADMIN_PASS();

const TABLE = '[data-testid="admin-accounts-table"]';
const HISTORY = '[data-testid="history-table"]';

/** Both spellings of a lifecycle event type. */
const NOUN_FIRST = /^(Account|Repository|Query)(Created|Updated|Deleted|Cleared|Imported)Event$/;
const VERB_FIRST = /^(Create|Update|Delete)(Account|Repository|Query)Event$/;

// ── Shared helpers ───────────────────────────────────────────────────────────

async function waitForAccountsPane(page) {
  await page.waitForFunction(
    () => document.getElementById('admin-accounts')?.dataset.loaded === 'true',
    null, { timeout: 20000 });
  await expect(page.locator('#admin-accounts')).not.toContainText(/Error loading|Error:/);
  await expect(page.locator(TABLE)).toBeVisible({ timeout: 10000 });
}

/** Expand one account's events and return the locator for the holder row. */
async function expandEvents(page, account) {
  const link = page.locator(`[data-testid="account-events-${account}"]`);
  await expect(link, `the ${account} row should offer an Events control`).toBeVisible();
  await link.click();
  const holder = page.locator(`[data-testid="account-events-row-${account}"]`);
  await expect(holder, 'the events row should open under the account row')
    .toBeVisible({ timeout: 15000 });
  // The row appears immediately with "Loading events…"; wait for it to resolve
  // into either a table or the empty note, and fail on the read error.
  await expect(holder, 'the events fetch should not report an error')
    .not.toContainText('Could not read events', { timeout: 15000 });
  await page.waitForFunction(
    (acct) => {
      const row = document.querySelector(`[data-testid="account-events-row-${acct}"]`);
      return row && !row.textContent.includes('Loading events');
    }, account, { timeout: 20000 });
  return holder;
}

// ── Requirement functions ────────────────────────────────────────────────────

// ============================================================
// REQ-2.5.1 / REQ-2.5.2: events are offered per account, and fetched on demand
// ============================================================
async function REQ_2_5_1_eventsPerAccount(page, capture) {
  await capture.requirement(REQ['2.5.1'], async (cap) => {
    await cap.before('Account listing, events not yet expanded');

    // S-6/S-7: there is no endpoint that answers events for several accounts
    // and the event JSON carries no target field, so the listing offers ONE
    // account's events at a time.  Assert that shape: a control per row.
    const rows = await page.locator(`${TABLE} tbody tr[data-account-row]`)
      .evaluateAll((trs) => trs.map((tr) => tr.dataset.accountRow));
    expect(rows.length, 'there should be an account to read events for')
      .toBeGreaterThan(0);
    for (const name of rows.slice(0, 5)) {
      await expect(page.locator(`[data-testid="account-events-${name}"]`),
                   `${name} should offer its own Events control`).toHaveCount(1);
    }

    // The request the control makes (REQ-2.5.2), captured as it happens.
    const [request] = await Promise.all([
      page.waitForRequest((r) => /\/system\/accounts\/[^/]+\/history/.test(r.url()),
                          { timeout: 20000 }),
      page.locator(`[data-testid="account-events-${ADMIN_USERNAME}"]`).click(),
    ]);
    expect(request.url(),
           'REQ-2.5.2: events come from /system/accounts/<account>/history')
      .toMatch(new RegExp(`/system/accounts/${ADMIN_USERNAME}/history`));

    const holder = page.locator(`[data-testid="account-events-row-${ADMIN_USERNAME}"]`);
    await expect(holder).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(
      (acct) => {
        const row = document.querySelector(`[data-testid="account-events-row-${acct}"]`);
        return row && !row.textContent.includes('Loading events');
      }, ADMIN_USERNAME, { timeout: 20000 });

    await cap.after('Events expanded in place beneath the account row');
  });
}

// ============================================================
// REQ-2.5.3 / REQ-3.8.3: Time, Action, Agent, Details -- and Agent populated
// ============================================================
async function REQ_2_5_3_eventTable(page, capture, account) {
  await capture.requirement(REQ['2.5.3'], async (cap) => {
    const holder = await expandEvents(page, account);
    await cap.before('Event table for one account');

    const table = holder.locator(HISTORY);
    const empty = await holder.textContent();
    test.skip(await table.count() === 0 && /No events recorded/.test(empty || ''),
              `${account} has no recorded events on this service`);

    await expect(table, 'the events should render as a table').toBeVisible();

    const headings = await table.locator('thead th').allTextContents();
    expect(headings.map((h) => h.trim()),
           'REQ-2.5.3: the four columns, with Agent -- not Actor, which the '
           + 'server has never sent')
      .toEqual(['Time', 'Action', 'Agent', 'Details']);

    const rows = table.locator('tbody tr');
    const n = await rows.count();
    expect(n, 'an event table should have rows').toBeGreaterThan(0);

    // The Agent column, populated.  This is the regression guard: the cell
    // carries data-agent, and at least one row must have a non-empty one.
    const agents = await table.locator('tbody td[data-agent]')
      .evaluateAll((tds) => tds.map((td) => td.dataset.agent));
    expect(agents.length, 'every row should carry an agent cell').toBe(n);
    expect(agents.some((a) => a && a.trim() !== ''),
           'REQ-2.5.3: at least one event should name its agent -- an entirely '
           + 'empty Agent column is the defect this assertion exists for')
      .toBe(true);

    // Newest first.
    const times = await table.locator('tbody td:nth-child(1)').allTextContents();
    const trimmed = times.map((t) => t.trim()).filter(Boolean);
    expect(trimmed, 'events should be ordered newest first')
      .toEqual([...trimmed].sort().reverse());

    await cap.after(`Event table: ${n} event(s), agent recorded`);
  });
}

// ============================================================
// REQ-3.8.7: rails-shaped type names, translated for display
// ============================================================
async function REQ_3_8_7_eventTypes(page, capture, account) {
  await capture.requirement(REQ['3.8.7'], async (cap) => {
    const holder = await expandEvents(page, account);
    const table = holder.locator(HISTORY);
    test.skip(await table.count() === 0, `${account} has no recorded events`);

    await cap.before('Event actions as displayed');

    // The raw token is kept on the cell so the interface can be checked
    // against the record; the cell TEXT is the translation.
    const cells = await table.locator('tbody td[data-action]')
      .evaluateAll((tds) => tds.map((td) => ({
        raw: td.dataset.action, shown: td.textContent.trim() })));
    expect(cells.length, 'every row should carry its raw action').toBeGreaterThan(0);

    const legacy = [];
    for (const { raw, shown } of cells) {
      const isNounFirst = NOUN_FIRST.test(raw);
      const isVerbFirst = VERB_FIRST.test(raw);
      expect(isNounFirst || isVerbFirst,
             `REQ-3.8.7: "${raw}" is neither the rails spelling nor the legacy one`)
        .toBe(true);
      if (isVerbFirst) legacy.push(raw);
      // Translated, not echoed: "Repository created", never the class name.
      expect(shown,
             `a known type should be translated for display, not shown raw (${raw})`)
        .not.toBe(raw);
      expect(shown,
             `the translation of ${raw} should name a subject and a past action`)
        .toMatch(/^(Account|Repository|View) (created|modified|deleted|cleared|imported into)$/);
    }

    if (legacy.length) {
      console.log(`[events] ${legacy.length} legacy verb-first row(s) on this `
                  + `service: ${[...new Set(legacy)].join(', ')}`);
    }

    await cap.after(`${cells.length} event(s), ${legacy.length} in the legacy spelling`);
  });
}

// ============================================================
// REQ-2.5.4: the history endpoint accepts type, first and last
// ============================================================
async function REQ_2_5_4_filters(page, capture) {
  await capture.requirement(REQ['2.5.4'], async (cap) => {
    await cap.before('Account listing before a filtered history request');

    // Asserted against the endpoint rather than through a control, because the
    // filter is a property of the resource (REQ-2.5.4) and the admin listing
    // has no filter UI.  A `*' is translated to the SQL `%' the server matches
    // with; both must be accepted.
    const result = await page.evaluate(async ({ account, authorization }) => {
      // Composed on the node side by `authorizationFor': the session's own
      // token lives in the admin app's auth store and is not reachable from
      // here, and REQ-1.1.1 says the service accepts either scheme.  It must
      // not be built in this scope -- the secret may be a token, and
      // `Basic btoa(user + ":" + token)' is a 401.  An unauthenticated probe
      // would also answer 401 and the assertions below would be testing the
      // login, not the filters.
      const probe = async (query) => {
        const resp = await fetch(
          `/system/accounts/${encodeURIComponent(account)}/history${query}`,
          { headers: { Accept: 'application/json', Authorization: authorization },
            cache: 'no-store' });
        let body = null;
        try { body = await resp.json(); } catch { /* a non-JSON body is the finding */ }
        return { query, status: resp.status, isArray: Array.isArray(body),
                 count: Array.isArray(body) ? body.length : null };
      };
      return {
        plain: await probe(''),
        byType: await probe('?type=%25Created%25'),
        byStar: await probe('?type=*Created*'),
        byDate: await probe('?first=2000-01-01'),
      };
    }, { account: ADMIN_USERNAME, authorization: ADMIN_AUTHORIZATION() });

    for (const [name, r] of Object.entries(result)) {
      expect(r.status, `REQ-2.5.4: the history endpoint should accept ${name} (${r.query})`)
        .toBe(200);
      expect(r.isArray, `${name} should answer a JSON array`).toBe(true);
    }
    expect(result.byType.count,
           'a type filter should not answer more than the unfiltered request')
      .toBeLessThanOrEqual(result.plain.count);
    expect(result.byStar.count,
           'REQ-2.5.4: `*` and `%` are the same wildcard')
      .toBe(result.byType.count);

    await cap.after(`Filters accepted: ${result.plain.count} unfiltered, `
                    + `${result.byType.count} matching a type pattern`);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Lifecycle Events', () => {
  test.setTimeout(120000);

  test('events offered and fetched per account [REQ-2.5.1, REQ-2.5.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/account-history', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_2_5_1_eventsPerAccount(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('event table columns and agent [REQ-2.5.3, REQ-3.8.3]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/account-history', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_2_5_3_eventTable(page, capture, ADMIN_USERNAME);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('event type names [REQ-3.8.1, REQ-3.8.7]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/account-history', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_3_8_7_eventTypes(page, capture, ADMIN_USERNAME);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('history filters [REQ-2.5.4]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/account-history', { enabled: CAPTURE_ENABLED });
    await adminLogin(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await waitForAccountsPane(page);

    await REQ_2_5_4_filters(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });
});
