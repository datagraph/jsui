// Housekeeping: remove repositories named test-repo-<digits> from the test
// account.  The repository specs create them; cleanup inside a test is awkward
// because .repo-delete-btn lives in the account pane, which is rendered twice
// under one id.  Run: npm run clean:test-repos
import { chromium } from '@playwright/test';

const ORIGIN = process.env.JSUI_ORIGIN || 'https://dydra.com';
const USER = process.env.JSUI_USER || 'playwright';
const PASSWORD = process.env.JSUI_PASSWORD || 'shakespear';

const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true });
await page.goto(`${ORIGIN}/ui/user`);
await page.getByTestId('login-username-input').fill(USER);
await page.getByTestId('login-password-input').fill(PASSWORD);
await page.getByTestId('login-submit').click();
await page.waitForTimeout(3000);

// Accept every confirmation for the duration: a `once` handler only covers the
// first delete, and the list re-renders after each one, so locators must be
// re-queried by name rather than held across iterations.
page.on('dialog', (d) => d.accept().catch(() => {}));

// One pass removes one repository: the account list re-renders after each
// delete, which invalidates every other locator taken from the same query.  So
// the list is re-read each pass and the loop runs until nothing is left.
let removed = 0;
for (let pass = 0; pass < 30; pass++) {
  const names = await page.locator('.repo-delete-btn[data-repository^="test-repo-"]')
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-repository')))]);
  if (!names.length) break;
  const name = names[0];
  const btn = page.locator(`.repo-delete-btn[data-repository="${name}"]`).locator('visible=true').first();
  if (!(await btn.count())) { console.log('not visible: ' + name); break; }
  if (!(await btn.click({ timeout: 15000 }).then(() => true).catch(() => false))) {
    console.log('could not click ' + name); break;
  }
  await page.waitForTimeout(3000);
  console.log('removed ' + name);
  removed++;
}
console.log(removed ? `${removed} removed` : 'nothing to remove');

await browser.close();
