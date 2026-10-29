import { test, expect } from '@playwright/test';
import { login } from './test-helpers.js';
import { DocCapture, REQ } from './doc-capture.js';
import { ACCOUNT as ACCOUNT_NAME, PASSWORD as ACCOUNT_PASSWORD,
         AUTHORIZATION } from './credentials.js';

/**
 * Collaboration Tests with Documentation Capture
 * Coverage: REQ-2.1.2, REQ-3.7.1, REQ-3.7.2, REQ-3.7.3, REQ-3.7.4, REQ-3.7.5,
 *           REQ-3.7.6
 *
 * Run with documentation:
 *   CAPTURE_DOCS=true npx playwright test tests/collaboration-documented.spec.js
 *
 * ── The removal protocol, which is the whole reason this file is careful ────
 *
 * The pane has NO delete control, and that is deliberate.  A collaborator is
 * removed by clearing both checkboxes and saving: the pane posts EVERY row it
 * is showing, including the ones whose permissions have just been cleared, and
 * the service deletes the row for each named account that asks for no access.
 *
 * The consequence, and the thing asserted here: an entry that is OMITTED from
 * the payload is left untouched.  A client that "helpfully" dropped removed
 * rows before posting would silently stop removing anyone, and the pane would
 * look exactly the same until the next read.  So this file asserts on the
 * REQUEST BODY -- that a cleared row is still in it -- and not only on what the
 * table shows afterwards.
 *
 * ── The read path ──────────────────────────────────────────────────────────
 *
 * REQ-2.1.2 is the other direction: the repositories an account reaches but
 * does not own.  Its Access column is drawn only when the service reports a
 * `mode'.  Against a service that does not, the column is omitted with a note
 * saying so -- never drawn and filled with a guess, which would read as
 * "read only" and be wrong in exactly the cases that matter.
 *
 * Both halves are exercised: the service answers both, and REQ-S-2/S-3 in
 * jsui-project-requirements.md are the endpoints behind them.
 */

const CAPTURE_ENABLED = process.env.CAPTURE_DOCS === 'true';
const ACCOUNT = ACCOUNT_NAME();
const PASSWORD = ACCOUNT_PASSWORD();
const REPOSITORY = process.env.JSUI_REPOSITORY || 'test';

// An account that certainly does not exist, for REQ-3.7.6.
const ABSENT_ACCOUNT = `no-such-account-${Date.now()}`;

/**
 * The account used as the subject of the write path.
 *
 * It must EXIST: naming one that does not is REQ-3.7.6's case, and the service
 * refuses the whole save, so using a non-existent account here would make the
 * add/modify/remove sequence fail for the wrong reason.  Checked before the
 * test runs rather than assumed -- `dydra', the obvious guess, is 404.
 */
const COLLABORATOR = process.env.JSUI_COLLABORATOR || 'demo';

/**
 * Make sure this account is NOT a collaborator on the repository under test.
 *
 * Uses the removal protocol itself (REQ-3.7.4): read the current list, post it
 * back with the subject asking for no access.  A no-op when it is not there.
 */
async function ensureNotCollaborator(page, subject) {
  return page.evaluate(async ({ account, repository, subject, authorization }) => {
    const base = `/system/accounts/${encodeURIComponent(account)}`
               + `/repositories/${encodeURIComponent(repository)}/collaboration`;
    const current = await fetch(base,
      { headers: { Accept: 'application/json', Authorization: authorization },
        cache: 'no-store' });
    if (!current.ok) return 'could not read';
    const rows = await current.json();
    if (!rows.some((c) => (c.account ?? c.name) === subject)) return 'absent';
    const payload = rows.map((c) => ((c.account ?? c.name) === subject
      ? { account: subject, read: false, write: false }
      : { account: c.account ?? c.name, read: !!c.read, write: !!c.write }));
    const resp = await fetch(base,
      { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify(payload) });
    return `removed (${resp.status})`;
  }, { account: ACCOUNT, repository: REPOSITORY, subject,
       authorization: AUTHORIZATION() });
}

/** Does this account exist on the service under test? */
async function accountExists(page, name) {
  return page.evaluate(async ({ name, authorization }) => {
    const resp = await fetch(`/${encodeURIComponent(name)}`,
      { headers: { Authorization: authorization }, cache: 'no-store' });
    return resp.status !== 404;
  }, { name, authorization: AUTHORIZATION() });
}

const PANEL = '.repository-meta-panel[data-panel="collaboration"]';
const CONTENT = '.collaboration-content';
const TABLE = '.collaboration-table';

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Open a repository pane by clicking its link in the account pane.
 *
 * NOT `openRepository' from test-helpers.js: that one navigates to a hardcoded
 * `https://dydra.com/<account>/<repository>', which leaves the dev server
 * entirely and lands on the deployed client -- and it is guarded, so when the
 * navigation produces no pane it returns quietly.  The link in the account
 * pane is what a user clicks, and it is the thing to assert on.
 */
async function openRepositoryPane(page, account, repository) {
  const link = page.locator(
    `a[href$="/account/${account}/repositories/${repository}"]`).first();
  await expect(link, `the account pane should list the ${repository} repository`)
    .toBeVisible({ timeout: 15000 });
  await link.click();
  await expect(page.locator(`#tab-repository-${account}-${repository}`),
               `the ${repository} pane should open`)
    .toBeVisible({ timeout: 15000 });
}

/**
 * Open the collaboration panel, asserted.
 *
 * NOT `openCollaborationPanel' from test-helpers.js: that one is from the
 * guarded generation -- it logs "Tab not visible" and returns, so a missing
 * tab produces a test that checks an empty page.
 */
async function openCollaboration(page) {
  const tab = page.getByTestId('repo-tab-collaboration').first();
  await expect(tab, 'the repository pane should offer a Collaboration tab')
    .toBeVisible({ timeout: 15000 });
  await tab.click();
  await expect(page.locator(PANEL), 'the collaboration panel should open')
    .toBeVisible({ timeout: 10000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('.collaboration-content');
    return c && c.dataset.collaborationState !== 'loading';
  }, null, { timeout: 20000 });
  await expect(page.locator(TABLE), 'the collaboration table should be drawn')
    .toBeVisible({ timeout: 10000 });
}

/**
 * Re-read the collaboration panel from the service, WITHOUT reloading the page.
 *
 * `page.reload()` cannot be used: the client holds its token in memory
 * (REQ-1.1.3), so a reload signs the session out and the account pane is gone.
 * Leaving and re-entering the tab is what re-reads it -- the handler clears a
 * `needs-reload' state and calls `loadRepositoryCollaboration' again.
 */
async function reopenCollaboration(page) {
  await page.getByTestId('repo-tab-profile').first().click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const c = document.querySelector('.collaboration-content');
    if (c) c.dataset.collaborationState = 'needs-reload';
  });
  await openCollaboration(page);
}

/** The rows as the table holds them: account, read, write. */
async function tableRows(page) {
  return page.locator(`${TABLE} tbody tr`).evaluateAll((trs) => trs
    .filter((tr) => !tr.querySelector('td[colspan]'))
    .map((tr) => ({
      account: tr.querySelector('.collab-account-input')?.value ?? null,
      read: !!tr.querySelector('.collab-read-checkbox')?.checked,
      write: !!tr.querySelector('.collab-write-checkbox')?.checked,
    })));
}

const saveButton = (page) => page.locator('[data-testid="collab-save-btn"]');

/**
 * The row whose account input holds this name.
 *
 * `input[value="demo"]` does NOT work: `value' in a CSS selector matches the
 * ATTRIBUTE, which for a row the test typed into is still the empty string the
 * row was created with.  Only the property changes.  So the index is found by
 * reading the live values and the row is addressed by position.
 */
async function rowFor(page, account) {
  const index = await page.locator(`${TABLE} tbody tr`).evaluateAll((trs, name) =>
    trs.findIndex((tr) => tr.querySelector('.collab-account-input')?.value === name),
    account);
  expect(index, `a row for ${account} should be in the table`).toBeGreaterThan(-1);
  return page.locator(`${TABLE} tbody tr`).nth(index);
}

/**
 * Click save, and return the body that was actually posted.
 *
 * Waits for the RESPONSE, not a fixed delay: the save sets the button to
 * "Saving…" and the pane will not re-evaluate it until the request finishes,
 * so a step that begins before then is operating on a control that is still
 * mid-save.  A timeout here reads as "the service did not answer", which is a
 * finding in its own right -- see the dev server's note on this endpoint's
 * Content-Length.
 */
async function saveAndCaptureBody(page) {
  const isSave = (x) => /\/collaboration$/.test(x.url())
    && (x.request ? x.request() : x).method() === 'POST';
  const [response] = await Promise.all([
    page.waitForResponse(isSave, { timeout: 30000 }),
    saveButton(page).click(),
  ]);
  const request = response.request();
  let body = null;
  try { body = JSON.parse(request.postData() || 'null'); } catch { /* reported below */ }
  // The pane updates its record of what is saved after the response resolves.
  await page.waitForTimeout(500);
  return { request, response, body };
}

// ── Requirement functions ────────────────────────────────────────────────────

// ============================================================
// REQ-3.7.1: manage collaborators with read/write permissions
// ============================================================
async function REQ_3_7_1_readCollaborators(page, capture) {
  await capture.requirement(REQ['3.7.1'], async (cap) => {
    await cap.before('Collaboration panel for a repository');

    const headings = await page.locator(`${TABLE} thead th`).allTextContents();
    expect(headings.map((h) => h.trim()),
           'REQ-3.7.1: account, read and write')
      .toEqual(['Account', 'Read', 'Write']);

    // There is no delete control, and its absence is the protocol (REQ-3.7.4),
    // not an omission.  Asserted so that adding one later fails here and the
    // requirement gets revisited rather than quietly contradicted.
    await expect(page.locator(`${PANEL} .collab-delete-btn`),
                 'REQ-3.7.4: removal is by clearing access, so there is no delete control')
      .toHaveCount(0);

    await expect(page.locator('[data-testid="collab-new-btn"]'),
                 'REQ-3.7.2: a collaborator can be added').toBeVisible();
    await expect(saveButton(page), 'REQ-3.7.3: changes are saved explicitly')
      .toBeVisible();
    await expect(saveButton(page),
                 'with nothing changed, saving should not be offered')
      .toBeDisabled();

    const rows = await tableRows(page);
    await cap.after(`Collaboration table: ${rows.length} collaborator(s)`);
  });
}

// ============================================================
// REQ-3.7.2 / REQ-3.7.3: add a collaborator and save it
// ============================================================
async function REQ_3_7_2_addCollaborator(page, capture, subject) {
  await capture.requirement(REQ['3.7.2'], async (cap) => {
    const before = await tableRows(page);
    await cap.before(`Collaboration table with ${before.length} collaborator(s)`);

    await page.locator('[data-testid="collab-new-btn"]').click();
    const row = page.locator(`${TABLE} tbody tr`).last();
    await row.locator('.collab-account-input').fill(subject);
    await row.locator('.collab-read-checkbox').check();

    await expect(saveButton(page), 'a change should enable the save control')
      .toBeEnabled();
    await cap.step('form-filled', `Collaborator ${subject} entered with read access`);

    const { request, response, body } = await saveAndCaptureBody(page);
    expect(request.url(),
           'REQ-3.7.3: saved to the repository collaboration resource')
      .toMatch(/\/system\/accounts\/[^/]+\/repositories\/[^/]+\/collaboration$/);
    expect(Array.isArray(body), 'the payload should be the collaborator list')
      .toBe(true);
    const posted = body.find((c) => (c.account ?? c.name) === subject);
    expect(posted, `the new collaborator ${subject} should be in the payload`)
      .toBeTruthy();
    expect(posted.read, 'with the access that was asked for').toBe(true);

    expect(response.status(),
           'the save should be accepted').toBeLessThan(300);
    await cap.after(`Collaborator ${subject} saved with read access`);
  });
}

// ============================================================
// REQ-3.7.5: editing preserves the row; saving twice changes nothing
// ============================================================
async function REQ_3_7_5_modifyCollaborator(page, capture, subject) {
  await capture.requirement(REQ['3.7.5'], async (cap) => {
    await cap.before(`Collaborator ${subject} with read access`);

    const row = await rowFor(page, subject);

    await row.locator('.collab-write-checkbox').check();
    await expect(saveButton(page)).toBeEnabled();

    const { body, response } = await saveAndCaptureBody(page);
    expect(response.status(), 'the save should be accepted').toBeLessThan(300);
    const posted = body.find((c) => (c.account ?? c.name) === subject);
    expect(posted, 'the modified collaborator should be posted').toBeTruthy();
    expect(posted.read, 'read should be preserved by a write change').toBe(true);
    expect(posted.write, 'and write should now be asked for').toBe(true);

    await cap.after(`Collaborator ${subject} now has read and write`);
  });
}

// ============================================================
// REQ-3.7.4: removal is clearing both boxes, and the row is still posted
// ============================================================
async function REQ_3_7_4_removeCollaborator(page, capture, subject) {
  await capture.requirement(REQ['3.7.4'], async (cap) => {
    await cap.before(`Collaborator ${subject} before removal`);

    const row = await rowFor(page, subject);

    await row.locator('.collab-read-checkbox').uncheck();
    await row.locator('.collab-write-checkbox').uncheck();
    await expect(saveButton(page), 'clearing access is a change').toBeEnabled();
    await cap.step('form-filled', 'Both access boxes cleared -- this is the removal');

    const { body } = await saveAndCaptureBody(page);

    // THE assertion of this file.  The cleared row must still be in the
    // payload: that is what tells the service to delete it.  Omitting it
    // leaves it untouched, and the interface would show a removal that never
    // happened.
    const posted = body.find((c) => (c.account ?? c.name) === subject);
    expect(posted,
           'REQ-3.7.4: a collaborator being removed must STILL be posted -- the '
           + 'service removes the rows it is sent with no access, and leaves '
           + 'omitted entries untouched')
      .toBeTruthy();
    expect(posted.read, 'posted with read cleared').toBe(false);
    expect(posted.write, 'posted with write cleared').toBe(false);

    // And it is gone when the panel is read again -- the read path confirming
    // what the write path asked for.
    await reopenCollaboration(page);
    const after = await tableRows(page);
    expect(after.some((r) => r.account === subject),
           `${subject} should be gone after a re-read`).toBe(false);

    await cap.after(`Collaborator ${subject} removed and confirmed by re-reading`);
  });
}

// ============================================================
// REQ-3.7.6: an account that does not exist is refused, by name
// ============================================================
async function REQ_3_7_6_unknownAccount(page, capture) {
  await capture.requirement(REQ['3.7.6'], async (cap) => {
    await cap.before('Collaboration panel before naming an unknown account');

    // Asserted at the resource.  The pane reports a failure through alert(),
    // which is awkward to assert on and tells us nothing about what the
    // SERVICE did; the requirement is about the service's answer.
    // Bounded.  A service that does not answer is a distinct outcome from one
    // that answers wrongly, and without the abort it presents as a 150-second
    // test timeout with nothing to read.
    const result = await page.evaluate(async ({ account, repository, subject, authorization, ms }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        const resp = await fetch(
          `/system/accounts/${encodeURIComponent(account)}`
          + `/repositories/${encodeURIComponent(repository)}/collaboration`,
          { method: 'POST',
            headers: { 'Content-Type': 'application/json',
                       Authorization: authorization },
            body: JSON.stringify([{ account: subject, read: true, write: false }]),
            signal: controller.signal });
        return { status: resp.status, text: (await resp.text()).slice(0, 400) };
      } catch (e) {
        return { status: null, text: `no answer within ${ms}ms (${e.name})` };
      } finally {
        clearTimeout(timer);
      }
    }, { account: ACCOUNT, repository: REPOSITORY, subject: ABSENT_ACCOUNT,
         authorization: AUTHORIZATION(), ms: 30000 });

    expect(result.status,
           'REQ-3.7.6: naming an account that does not exist should be REFUSED -- '
           + 'an answer is required, and not answering is its own failure '
           + `(got: ${result.text})`)
      .not.toBeNull();
    expect(result.status,
           'REQ-3.7.6: the refusal should be 400, not a success and not a 500')
      .toBe(400);
    expect(result.text,
           'and the refusal should name the account that was not found')
      .toContain(ABSENT_ACCOUNT);

    await cap.after(`Refused with ${result.status}, naming ${ABSENT_ACCOUNT}`);
  });
}

// ============================================================
// REQ-2.1.2: the repositories this account reaches but does not own
// ============================================================
async function REQ_2_1_2_collaborationsTab(page, capture) {
  await capture.requirement(REQ['2.1.2'], async (cap) => {
    await cap.before('Account pane');

    // The tab is an ICON button -- no text, only title="Collaborations" and an
    // img alt -- so a :has-text() selector never matches it.  The testid is
    // account-tab-collaboration (singular), and the panel it opens is
    // account-collaboration, which lazy-loads on first selection.
    const tab = page.getByTestId('account-tab-collaboration').first();
    await expect(tab, 'the account pane should offer a Collaborations tab')
      .toBeVisible({ timeout: 15000 });
    await tab.click();

    const box = page.getByTestId('account-collaboration').first();
    await expect(box, 'the collaborations panel should open').toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="account-collaboration"]');
      return el && el.dataset.loaded === 'true';
    }, null, { timeout: 20000 });

    const table = box.locator('[data-testid="collaboration-table"]');
    const empty = box.locator('text=No repositories are shared with this account');
    const hasTable = await table.count() > 0;
    const hasEmpty = await empty.count() > 0;
    expect(hasTable || hasEmpty,
           'the tab should answer either a table or the empty note, never nothing')
      .toBe(true);

    if (hasTable) {
      const headings = (await table.locator('thead th').allTextContents())
        .map((h) => h.trim());
      expect(headings.slice(0, 2), 'owner and repository are always shown')
        .toEqual(['Owner', 'Repository']);

      // The Access column is present only when the service reported a mode.
      // Where it is absent, the note must say why -- the two go together, and
      // a column drawn without a mode would be a guess.
      const withMode = headings.includes('Access');
      const note = box.locator(
        'text=reports which repositories are shared and not whether the access');
      if (withMode) {
        const modes = await table.locator('tbody td[data-mode]')
          .evaluateAll((tds) => tds.map((td) => td.dataset.mode));
        expect(modes.every((m) => m && m !== ''),
               'REQ-2.1.2: every row should carry the mode the service reported')
          .toBe(true);
        await expect(note, 'the explanatory note belongs only to the other case')
          .toHaveCount(0);
      } else {
        await expect(note,
                     'REQ-2.1.2: with no mode reported, the column is omitted and '
                     + 'the reason is stated -- never guessed')
          .toHaveCount(1);
      }
      await cap.after(`Collaborations: ${await table.locator('tbody tr').count()} `
                      + `repository/ies, access ${withMode ? 'reported' : 'not reported'}`);
    } else {
      await cap.after('No repositories are shared with this account');
    }
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Collaboration', () => {
  test.setTimeout(150000);

  test('read collaborators [REQ-3.7.1]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/collaboration', { enabled: CAPTURE_ENABLED });
    await login(page, ACCOUNT, PASSWORD);
    await openRepositoryPane(page, ACCOUNT, REPOSITORY);
    await openCollaboration(page);

    await REQ_3_7_1_readCollaborators(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('add, modify and remove a collaborator [REQ-3.7.2, REQ-3.7.3, REQ-3.7.4, REQ-3.7.5]',
       async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/collaboration', { enabled: CAPTURE_ENABLED });
    const subject = COLLABORATOR;

    await login(page, ACCOUNT, PASSWORD);
    test.skip(!(await accountExists(page, subject)),
              `the collaborator account "${subject}" does not exist on this service; `
              + 'set JSUI_COLLABORATOR to one that does');

    // Repeatable.  A previous run that failed part way leaves the subject as a
    // collaborator, and skipping on that would mean the sequence never ran
    // again without someone clearing it by hand.  So clear it FIRST -- before
    // the pane is opened, so its first read is already of the clean state --
    // through the same protocol the test is about to assert: post every
    // collaborator, the subject with no access.
    await ensureNotCollaborator(page, subject);

    await openRepositoryPane(page, ACCOUNT, REPOSITORY);
    await openCollaboration(page);
    const existing = await tableRows(page);
    expect(existing.some((r) => r.account === subject),
           `${subject} should not be a collaborator at the start of the sequence`)
      .toBe(false);

    // The three are one sequence on purpose: the row modified in the second is
    // the row created by the first, and the row removed by the third is that
    // same row.  Run apart they would each need their own fixture, and the
    // removal -- the assertion that matters -- would be made against a row the
    // test had not watched being created.
    await REQ_3_7_2_addCollaborator(page, capture, subject);
    await REQ_3_7_5_modifyCollaborator(page, capture, subject);
    await REQ_3_7_4_removeCollaborator(page, capture, subject);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('unknown account refused [REQ-3.7.6]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/collaboration', { enabled: CAPTURE_ENABLED });
    await login(page, ACCOUNT, PASSWORD);
    await openRepositoryPane(page, ACCOUNT, REPOSITORY);
    await openCollaboration(page);

    await REQ_3_7_6_unknownAccount(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });

  test('collaborations an account reaches [REQ-2.1.2]', async ({ page }) => {
    const capture = new DocCapture(page, 'tests/pdfs/collaboration', { enabled: CAPTURE_ENABLED });
    await login(page, ACCOUNT, PASSWORD);

    await REQ_2_1_2_collaborationsTab(page, capture);

    await capture.writeManifest();
    await capture.writeIndex();
  });
});
