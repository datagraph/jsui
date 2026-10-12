/**
 * Open the exploration pane against a live dev server and photograph it.
 *
 * Not part of `npm run test:unit': it needs a server on :8099 and a real
 * account.  The pane is reached from the Explore button in the Views header
 * -- the former prompt tab, moved there and renamed -- and opens as a peer of
 * the view editors rather than as a panel in the repository sidebar.
 */
import { test } from '@playwright/test';
test('open the exploration pane', async ({ page }) => {
  test.setTimeout(120000);
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
  await page.goto('http://localhost:8099/ui/user');
  await page.waitForTimeout(1500);
  await page.locator('[name="host"]').fill('http://localhost:8099');
  await page.getByTestId('login-username-input').fill('playwright');
  await page.getByTestId('login-password-input').fill('shakespear');
  await page.getByTestId('login-submit').click();
  await page.waitForTimeout(3500);
  console.log('logged in: ' + await page.locator('[data-tab-type="account"]').first().isVisible().catch(() => false));
  await page.getByRole('link', { name: 'test', exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(2500);
  console.log('explore button: ' + await page.getByTestId('view-explore-btn').count());
  await page.getByTestId('view-explore-btn').first().click();
  await page.waitForTimeout(1500);
  console.log('pane visible: ' + await page.getByTestId('exploration-pane').isVisible().catch(() => false));
  console.log('connection: ' + await page.getByTestId('exploration-chip').textContent().catch(() => '—'));
  await page.getByTestId('exploration-prompt').click();
  await page.keyboard.type('samples with a temperature above 20 — see https://dydra.com/playwright/test');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/exploration-pane.png' });
  console.log('errors: ' + JSON.stringify(errs.slice(0, 3)));
});
