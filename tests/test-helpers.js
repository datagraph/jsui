/**
 * Common test helper functions for Dydra JSUI Playwright tests
 *
 * Field name mappings are derived from REPOSITORY_FIELD_DEFS and ACCOUNT_FIELD_DEFS
 * in ui/pages/index.js. The test ID is based on the 'field' property, not the key.
 */

/**
 * Login to the application
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {string} password
 */
export async function login(page, username = 'playwright', password = 'shakespear') {
  await page.goto('https://dydra.com/ui/user');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
  await page.getByTestId('login-username-input').click();
  await page.getByTestId('login-username-input').fill(username);
  await page.getByTestId('login-username-input').press('Tab');
  await page.getByTestId('login-password-input').fill(password);
  await page.getByTestId('login-password-input').press('Enter');
  await page.getByTestId('login-submit').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
}

/**
 * Logout from the application
 * @param {import('@playwright/test').Page} page
 */
export async function logout(page) {
  await page.goto('https://dydra.com/logout');
  await page.waitForLoadState('networkidle');
}

/**
 * Open or create a repository
 * @param {import('@playwright/test').Page} page
 * @param {string} accountName
 * @param {string} repositoryName
 */
export async function openRepository(page, accountName, repositoryName) {
  // First try navigating directly to the repository URL
  const repoUrl = `https://dydra.com/${accountName}/${repositoryName}`;

  // Check if we're already on a repository pane
  const repoPane = page.locator('.repository-pane');
  if (await repoPane.isVisible({ timeout: 1000 }).catch(() => false)) {
    return; // Already on a repository
  }

  // Try clicking an existing repository link
  const repoLink = page.locator(`a[href*="/${repositoryName}"], [data-repository="${repositoryName}"]`).first();
  if (await repoLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await repoLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.repository-pane', { state: 'visible', timeout: 5000 }).catch(() => {});
    return;
  }

  // Try creating a new repository
  const repoNewBtn = page.getByTestId('repo-new-btn').first();
  if (await repoNewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await repoNewBtn.click();
      await page.getByRole('textbox', { name: 'Repository name' }).fill(repositoryName, { timeout: 2000 });
      await page.getByRole('button', { name: 'Create' }).click({ timeout: 2000 });
      await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('.repository-pane', { state: 'visible', timeout: 5000 }).catch(() => {});
    } catch (e) {
      console.log('openRepository note:', e.message);
      // Navigate directly as fallback
      await page.goto(repoUrl);
      await page.waitForLoadState('networkidle');
    }
  } else {
    // Direct navigation fallback
    await page.goto(repoUrl);
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Delete a repository via API (more reliable for test cleanup)
 * @param {import('@playwright/test').Page} page
 * @param {string} accountName
 * @param {string} repositoryName
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteRepositoryViaAPI(page, accountName, repositoryName) {
  const result = await page.evaluate(async ({ accountName, repositoryName }) => {
    try {
      const appState = window.appState || window.app?.state;
      if (!appState) {
        return { success: false, error: 'No app state found' };
      }

      const auth = appState.getAuthContext?.(accountName);
      if (!auth?.token || !auth?.host) {
        return { success: false, error: 'No auth context found' };
      }

      const response = await fetch(
        `${auth.host}/system/accounts/${encodeURIComponent(accountName)}/repositories/${encodeURIComponent(repositoryName)}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${auth.token}` },
        }
      );

      if (response.ok || response.status === 204) {
        return { success: true };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, { accountName, repositoryName });

  if (result.success) {
    console.log(`Deleted repository ${accountName}/${repositoryName} via API`);
  } else {
    console.log(`Failed to delete repository ${accountName}/${repositoryName}: ${result.error}`);
  }
  return result;
}

/**
 * Delete a repository via UI
 * @param {import('@playwright/test').Page} page
 * @param {string} accountName
 * @param {string} repositoryName
 */
export async function deleteRepository(page, accountName, repositoryName) {
  // Navigate to account page
  const accountLink = page.getByRole('link', { name: accountName, exact: true }).first();
  if (await accountLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accountLink.click();
    await page.waitForLoadState('networkidle');
  }

  // Set up dialog handler for confirmation
  page.once('dialog', async dialog => {
    await dialog.accept();
  });

  // Click delete button
  const deleteBtn = page.getByRole('button', { name: 'Delete' }).first();
  if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await deleteBtn.click();
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Create a new view
 * @param {import('@playwright/test').Page} page
 * @param {string} viewName
 * @param {string} queryText
 */
export async function createView(page, viewName, queryText) {
  // Wait for any existing modal to close
  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 3000 }).catch(() => {});

  // Try multiple selectors for the new view button
  const viewNewBtn = page.getByTestId('view-new-btn').first();
  const altNewBtn = page.locator('.view-new-btn, button:has-text("New View")').first();

  if (await viewNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await viewNewBtn.click();
  } else if (await altNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await altNewBtn.click();
  }

  await page.waitForTimeout(500);

  // Try multiple selectors for the name input
  const nameInput = page.getByTestId('new-view-name-input');
  const altNameInput = page.locator('input[placeholder*="name"], input[name="viewName"], .new-view-name').first();

  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nameInput.fill(viewName);
  } else if (await altNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await altNameInput.fill(viewName);
  }

  // Try multiple selectors for the OK button
  const okBtn = page.getByTestId('new-view-ok-btn');
  const altOkBtn = page.locator('button:has-text("Create"), button:has-text("OK"), button:has-text("Save")').first();

  if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await okBtn.click();
  } else if (await altOkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await altOkBtn.click();
  }

  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Click OK if visible (appears after successful view creation)
  const confirmButton = page.getByRole('button', { name: 'OK' });
  if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await confirmButton.click();
  }
}

/**
 * Delete a view
 * @param {import('@playwright/test').Page} page
 * @param {string} viewName
 */
export async function deleteView(page, viewName) {
  const deleteBtn = page.getByTestId(`view-delete-btn-${viewName}`).first();
  if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    page.once('dialog', async dialog => {
      await dialog.accept();
    });
    await deleteBtn.click();
  }
}

/**
 * Open view in the editor panel
 * @param {import('@playwright/test').Page} page
 * @param {string} viewName
 */
export async function openViewInEditor(page, viewName) {
  // Wait for any modal overlays to close
  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Try multiple selectors for the view edit link
  const viewEditLink = page.getByTestId(`view-edit-${viewName}`);
  const viewLink = page.locator(`a[data-view="${viewName}"], .view-edit[data-view="${viewName}"], a:has-text("${viewName}")`).first();

  if (await viewEditLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await viewEditLink.click();
  } else if (await viewLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await viewLink.click();
  } else {
    // Click on view name in the views list
    const viewItem = page.locator(`.view-item:has-text("${viewName}"), [data-view-name="${viewName}"]`).first();
    if (await viewItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await viewItem.click();
    }
  }
  await page.waitForTimeout(500);
}

/**
 * Open the collaboration panel
 * @param {import('@playwright/test').Page} page
 */
export async function openCollaborationPanel(page) {
  const collabTab = page.getByTestId('repo-tab-collaboration').first();
  if (await collabTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await collabTab.click();
    await page.waitForSelector('.repository-meta-panel[data-panel="collaboration"]', { state: 'visible', timeout: 3000 }).catch(() => {});
    // Wait for collaboration content to load
    await page.waitForFunction(() => {
      const content = document.querySelector('.collaboration-content');
      return content && content.getAttribute('data-collaboration-state') !== 'loading';
    }, { timeout: 5000 }).catch(() => {});
  } else {
    console.log('openCollaborationPanel: Tab not visible');
  }
}

/**
 * Open the profile panel
 * @param {import('@playwright/test').Page} page
 */
export async function openProfilePanel(page) {
  const profileTab = page.getByTestId('repo-tab-profile').first();
  if (await profileTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await profileTab.click();
    await page.waitForSelector('.repository-meta-panel[data-panel="profile"]', { state: 'visible', timeout: 3000 }).catch(() => {});
  } else {
    console.log('openProfilePanel: Tab not visible');
  }
}

/**
 * Open the settings panel
 * @param {import('@playwright/test').Page} page
 */
export async function openSettingsPanel(page) {
  const settingsTab = page.getByTestId('repo-tab-settings').first();
  if (await settingsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await settingsTab.click();
    await page.waitForSelector('.repository-meta-panel[data-panel="settings"]', { state: 'visible', timeout: 3000 }).catch(() => {});
  } else {
    console.log('openSettingsPanel: Tab not visible');
  }
}

/**
 * Open the prefixes panel
 * @param {import('@playwright/test').Page} page
 */
export async function openPrefixesPanel(page) {
  const prefixesTab = page.getByTestId('repo-tab-prefixes').first();
  if (await prefixesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await prefixesTab.click();
    await page.waitForSelector('.repository-meta-panel[data-panel="prefixes"]', { state: 'visible', timeout: 3000 }).catch(() => {});
  } else {
    console.log('openPrefixesPanel: Tab not visible');
  }
}

/**
 * Wait for a save operation to complete
 * @param {import('@playwright/test').Page} page
 * @param {string} urlPattern - Pattern to match in the response URL
 * @param {string} method - HTTP method (default: POST)
 */
export async function waitForSaveComplete(page, urlPattern, method = 'POST') {
  const response = await page.waitForResponse(response =>
    response.url().includes(urlPattern) && response.request().method() === method
  );
  return response;
}

/**
 * Wait for network to be idle (with timeout fallback)
 * @param {import('@playwright/test').Page} page
 */
export async function waitForNetworkIdle(page) {
  // Use domcontentloaded + timeout instead of networkidle which can hang
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);
}

/**
 * Get the pane ID for a repository
 * @param {string} accountName
 * @param {string} repositoryName
 */
export function getPaneId(accountName, repositoryName) {
  return `tab-repository-${accountName.replace(/[^a-z0-9_-]/gi, '-')}-${repositoryName.replace(/[^a-z0-9_-]/gi, '-')}`;
}

/**
 * Activate a repository field for editing
 * Empty fields display "-" and need to be double-clicked to show input
 * @param {import('@playwright/test').Page} page
 * @param {string} testId - The data-testid of the field
 * @returns {Promise<import('@playwright/test').Locator>} The input/textarea element
 */
export async function activateRepoField(page, testId) {
  // Check if input/textarea/select is directly visible (field has value)
  const input = page.getByTestId(testId);
  if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
    return input;
  }
  // Empty field shows "-" span - double-click to activate
  const emptySpan = page.locator(`.value.empty[data-testid="${testId}"]`);
  if (await emptySpan.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emptySpan.dblclick();
    await page.waitForTimeout(200);
    // Find the input that was created in the same parent
    const parent = page.locator(`.repo-meta-field.editing`).last();
    const newInput = parent.locator('.repo-config-input').first();
    if (await newInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      return newInput;
    }
  }
  // Fallback to original selector
  return input;
}

/**
 * Activate an account profile field for editing
 * Empty fields display "-" and need to be double-clicked to show input
 * @param {import('@playwright/test').Page} page
 * @param {string} fieldName - The data-field name of the field
 * @returns {Promise<import('@playwright/test').Locator>} The input element
 */
export async function activateAccountField(page, fieldName) {
  // Check if input is already visible (already in edit mode)
  const existingInput = page.locator(`input.profile-input[data-field="${fieldName}"]`);
  if (await existingInput.isVisible({ timeout: 500 }).catch(() => false)) {
    return existingInput;
  }
  // Find the span and double-click to enter edit mode
  const field = page.locator(`.foaf-value[data-field="${fieldName}"][data-editable="true"]`);
  if (await field.isVisible({ timeout: 1000 }).catch(() => false)) {
    await field.dblclick();
    await page.waitForTimeout(200);
    // Return the new input
    const newInput = page.locator(`input.profile-input[data-field="${fieldName}"]`);
    if (await newInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      return newInput;
    }
  }
  // Fallback
  return existingInput;
}
