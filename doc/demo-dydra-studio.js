const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = "https://dydra.com/ui/user";
const CREDS = { username: "playwright", password: "shakespear" };

const viewport = { width: 1280, height: 800 };

const OUT = {
  screens: path.resolve("artifacts/screens"),
  debug: path.resolve("artifacts/debug"),
  video: path.resolve("artifacts/video"),
  trace: path.resolve("artifacts/trace"),
};

for (const dir of Object.values(OUT)) fs.mkdirSync(dir, { recursive: true });

async function snap(page, name) {
  const safeUrl = page.url().replace(/[:/?#&=]+/g, "_").slice(0, 90);
  await page.screenshot({ path: path.join(OUT.screens, `${name}__${safeUrl}.png`) });
}

async function dumpDebug(page, name) {
  fs.writeFileSync(path.join(OUT.debug, `${name}.html`), await page.content(), "utf8");
}

async function stabilize(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(250);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);
}

async function clickFirst(page, locators, what) {
  for (const loc of locators) {
    if (await loc.count()) {
      await loc.first().click();
      return;
    }
  }
  throw new Error(`Could not find clickable UI element for: ${what}`);
}

async function fillByLabelOrFallback(page, labelRegex, fallbackSelectors, value, what) {
  // Try label first
  const byLabel = page.getByLabel(labelRegex);
  if (await byLabel.count()) {
    await byLabel.first().fill(value);
    return;
  }
  // Fallback selectors
  for (const sel of fallbackSelectors) {
    const loc = page.locator(sel);
    if (await loc.count()) {
      await loc.first().fill(value);
      return;
    }
  }
  throw new Error(`Could not find input for: ${what}`);
}

async function waitForAny(page, locators, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const loc of locators) {
      if (await loc.count()) return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/**
 * STEP 1: Login and verify authenticated UI.
 */
async function login(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await stabilize(page);
  await snap(page, "01-arrived");

  // If there is a "Login" link/button in a nav, click it; harmless if already on login.
  const maybeLogin = [
    page.getByRole("link", { name: /login/i }),
    page.getByRole("button", { name: /login/i }),
  ];
  if (await maybeLogin[0].count() || await maybeLogin[1].count()) {
    await clickFirst(page, maybeLogin, "Login entrypoint");
    await stabilize(page);
  }

  await fillByLabelOrFallback(
    page,
    /username/i,
    ['input[name="login"]', 'input[name="username"]', 'input#username', 'input[autocomplete="username"]', 'input[placeholder*="Username" i]'],
    CREDS.username,
    "Username"
  );

  await fillByLabelOrFallback(
    page,
    /password|token/i,
    ['input[name="password"]', 'input#password', 'input[type="password"]', 'input[placeholder*="Password" i]'],
    CREDS.password,
    "Password/Token"
  );

  await snap(page, "02-login-filled");

  // Submit
  const submitCandidates = [
    page.getByRole("button", { name: /sign in|log in|login/i }),
    page.locator('button[type="submit"]'),
  ];
  await clickFirst(page, submitCandidates, "Sign in / Submit");
  // Some forms require Enter anyway
  await page.keyboard.press("Enter").catch(() => {});

  await stabilize(page);

  // VERIFY authentication:
  // - logout present OR
  // - "Authenticated as" message OR
  // - URL no longer contains /login
  await waitForAny(
    page,
    [
      page.getByRole("link", { name: /logout/i }),
      page.getByRole("button", { name: /logout/i }),
      page.getByText(/authenticated as/i),
      page.locator("text=/Authenticated as/i"),
    ],
    15000,
    "authenticated UI signal (Logout link or Authenticated as...)"
  );

  // Also verify we left /login if the SPA uses routes
  // (Not required, but helps catch “auth succeeded but route didn’t change”)
  await snap(page, "03-authenticated");
}

/**
 * STEP 2: Ensure we are on the account page that lists repositories.
 */
async function goToAccountHome(page) {
  // Prefer “My Account”, else go by URL pattern
  const accountLink = page.getByRole("link", { name: /my account/i });
  if (await accountLink.count()) {
    await accountLink.first().click();
    await stabilize(page);
  }

  // VERIFY: repositories list or “New Repository” exists
  await waitForAny(
    page,
    [
      page.getByRole("button", { name: /new repository/i }),
      page.getByRole("link", { name: /new repository/i }),
      page.locator("text=/Repositories/i"),
    ],
    15000,
    "account home with repositories list"
  );

  await snap(page, "04-account-home");
}

/**
 * STEP 3: Open a repository pane by clicking the first repository link in the list.
 */
async function openFirstRepository(page) {
  // Heuristics: repo links usually live inside a list/table near “Repositories”
  // This tries a few common patterns rather than guessing a single selector.
  const repoLinkCandidates = [
    // a table of repos: any link inside table body
    page.locator("table tbody a").first(),
    // list of repos: any link inside a section containing "Repositories"
    page.locator("text=/Repositories/i").locator("xpath=..").locator("a").first(),
    // any repo-ish link (fallback)
    page.locator('a[href*="/repositories/"]').first(),
  ];

  // Find the first candidate that exists, then click it
  let clicked = false;
  for (const cand of repoLinkCandidates) {
    if (await cand.count()) {
      const name = (await cand.innerText().catch(() => "")).trim();
      await cand.click();
      clicked = true;

      await stabilize(page);

      // VERIFY: we’re in a repository route or see repository tabs like “About / Query / History”
      await waitForAny(
        page,
        [
          page.locator('a[href*="/repositories/"][aria-current="page"]'),
          page.getByRole("tab", { name: /about/i }),
          page.getByRole("tab", { name: /query/i }),
          page.locator("text=/Repository/i"),
        ],
        15000,
        "repository pane (tabs About/Query/History or repository route)"
      );

      await snap(page, `05-repo-opened${name ? "__" + name.replace(/\W+/g, "_").slice(0, 30) : ""}`);
      break;
    }
  }
  if (!clicked) throw new Error("Could not find any repository link to open.");
}

/**
 * STEP 4: Open the Query tab and run a query (optional).
 */
async function openQueryTab(page) {
  // Try tab role first; else link/button
  const queryTab = page.getByRole("tab", { name: /query/i });
  if (await queryTab.count()) {
    await queryTab.first().click();
  } else {
    await clickFirst(page, [page.getByRole("link", { name: /query/i }), page.getByRole("button", { name: /query/i })], "Query tab");
  }

  await stabilize(page);

  // VERIFY: editor-ish element exists
  await waitForAny(
    page,
    [page.locator("textarea"), page.locator("[contenteditable='true']"), page.getByText(/Ctrl\+Enter|Cmd\+Enter/i)],
    15000,
    "query editor UI"
  );

  await snap(page, "06-query-tab");
}

/**
 * STEP 5: Open a view editor.
 * Prefer: click first view in “Views” section (on repository page), else Save As to create one.
 */
async function openViewEditor(page) {
  // Go back to repo “About” (often where Views list is shown), but don’t assume tabs exist.
  const aboutTab = page.getByRole("tab", { name: /about/i });
  if (await aboutTab.count()) {
    await aboutTab.first().click();
    await stabilize(page);
  }

  // Try clicking a view name in a Views list
  const viewLinkCandidates = [
    page.locator("text=/Views/i").locator("xpath=..").locator("a").first(),
    page.locator('a[href*="/views/"]').first(),
  ];

  for (const cand of viewLinkCandidates) {
    if (await cand.count()) {
      const viewName = (await cand.innerText().catch(() => "")).trim();
      await cand.click();
      await stabilize(page);

      // VERIFY: editor present (textarea / contenteditable) AND something view-related visible
      await waitForAny(
        page,
        [page.locator("textarea"), page.locator("[contenteditable='true']"), page.getByText(/save as/i)],
        15000,
        "view editor UI"
      );

      await snap(page, `07-view-editor${viewName ? "__" + viewName.replace(/\W+/g, "_").slice(0, 30) : ""}`);
      return;
    }
  }

  // If no views exist, create one from query tab (Save As)
  await openQueryTab(page);

  // Fill editor with a small query if possible
  const editor = (await page.locator("textarea").count()) ? page.locator("textarea").first()
               : (await page.locator("[contenteditable='true']").count()) ? page.locator("[contenteditable='true']").first()
               : null;

  if (editor) {
    await editor.click();
    await editor.fill("SELECT * WHERE { ?s ?p ?o } LIMIT 10").catch(() => {});
  }

  // Click Save As (button or link)
  await clickFirst(page, [
    page.getByRole("button", { name: /save as/i }),
    page.getByRole("link", { name: /save as/i }),
    page.locator("text=/Save As/i"),
  ], "Save As");

  await stabilize(page);
  await snap(page, "07b-save-as-dialog");

  // Name field + Save
  // (If dialog uses a generic Name field)
  const nameFilled = await page.getByLabel(/name/i).first().fill("demo_view").then(() => true).catch(() => false);
  if (!nameFilled) {
    // fallback: first text input in dialog
    const dlgInput = page.locator("input[type='text']").first();
    if (await dlgInput.count()) await dlgInput.fill("demo_view");
  }

  await clickFirst(page, [
    page.getByRole("button", { name: /^save$/i }),
    page.getByRole("button", { name: /create|ok/i }),
  ], "Save view");

  await stabilize(page);
  await snap(page, "08-view-created");
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: OUT.video, size: viewport },
  });

  // Turn on tracing so if it “dies” you can open the trace in Playwright UI
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();

  try {
    await login(page);
    await goToAccountHome(page);
    await openFirstRepository(page);
    await openQueryTab(page);
    await openViewEditor(page);
  } catch (e) {
    // Always capture failure state
    await stabilize(page).catch(() => {});
    await snap(page, "ERROR").catch(() => {});
    await dumpDebug(page, "ERROR").catch(() => {});
    throw e;
  } finally {
    await context.tracing.stop({ path: path.join(OUT.trace, "run.zip") }).catch(() => {});
    await context.close();
    await browser.close();
  }

  console.log("Done. Check artifacts/screens, artifacts/video, artifacts/trace/run.zip");
})();
