/**
 * Teardown through the API, not through the UI.
 *
 * The specs create repositories and views through the panes, because that is
 * what they test.  They must not remove them that way: the delete control lives
 * in a pane that may be behind another one, the account pane is rendered twice
 * under one id, and a test that fails midway never reaches its cleanup at all.
 * Every one of those leaks a repository or a view into the account, and they
 * accumulate run after run.
 *
 * So creation stays in the UI and removal goes straight to the API with the
 * session's own token, which no pane state can affect.
 */

/** The bearer token the UI obtained at login, or null when not signed in. */
export async function sessionToken(page, account) {
  return page.evaluate((a) => {
    try { return window.appState?.authStore?.getAuth(a)?.token || null; } catch { return null; }
  }, account);
}

async function del(page, token, url) {
  const res = await page.request.delete(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    failOnStatusCode: false,
  });
  return res.status();
}

/** Remove a view.  Returns the HTTP status, or null when there is no token. */
export async function removeView(page, account, repository, view) {
  const token = await sessionToken(page, account);
  if (!token) return null;
  return del(page, token,
             `${new URL(page.url()).origin}/system/accounts/${encodeURIComponent(account)}` +
             `/repositories/${encodeURIComponent(repository)}/views/${encodeURIComponent(view)}`);
}

/** Remove a repository.  Returns the HTTP status, or null when there is no token. */
export async function removeRepository(page, account, repository) {
  const token = await sessionToken(page, account);
  if (!token) return null;
  return del(page, token,
             `${new URL(page.url()).origin}/system/accounts/${encodeURIComponent(account)}` +
             `/repositories/${encodeURIComponent(repository)}`);
}

/**
 * Remove every repository whose name matches the pattern the specs create with.
 * This is the backstop for runs that died before their own cleanup: it is safe
 * because it only ever matches <prefix>-<digits>, which no real repository uses.
 */
export async function removeStrayRepositories(page, account, pattern = /^(test-repo|zz-)[\w-]*\d+$/) {
  const token = await sessionToken(page, account);
  if (!token) return [];
  const origin = new URL(page.url()).origin;
  const res = await page.request.get(`${origin}/system/accounts/${encodeURIComponent(account)}/repositories`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    failOnStatusCode: false,
  });
  if (!res.ok()) return [];
  let listed = [];
  try { listed = await res.json(); } catch { return []; }
  const removed = [];
  for (const entry of Array.isArray(listed) ? listed : []) {
    const name = entry?.id;
    if (typeof name === 'string' && pattern.test(name)) {
      removed.push({ name, status: await removeRepository(page, account, name) });
    }
  }
  return removed;
}
