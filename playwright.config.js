import { defineConfig, devices } from "@playwright/test";

// Reviving this suite needed a config for three reasons, all of them load-bearing:
//
//  1. With none, Playwright's default testMatch (**/*.@(spec|test).*) collected
//     tests/router-query.test.mjs -- a plain node test -- and RAN it during
//     collection, where its process.exit() killed the runner before it listed
//     anything.  testMatch below is narrowed to the documented specs.
//  2. tests-archive/ holds the superseded first generation of these specs and
//     was being collected too.
//  3. These specs log in as one shared account and create, rename and delete
//     repositories under known names.  Run in parallel they collide with each
//     other, so this pins one worker.  It is a correctness setting, not a
//     performance one.
//
// The target is parameterised (see tests/test-helpers.js).  JSUI_ORIGIN selects
// the server; it defaults to https://dydra.com, which is what the specs were
// written against and what they still assume for account and repository names.
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*-documented.spec.js",

  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The specs lean on fixed waitForTimeout() calls (1-3 s each) after login and
  // after navigation, so individual tests are slow by construction.
  timeout: 120_000,
  expect: { timeout: 15_000 },

  // NOTE: `npx playwright test --list` also writes this HTML report, with every
  // test present and NO results — which the report renders as "skipped".  A
  // report showing the whole suite skipped is therefore a collection artifact,
  // not a run: check its timestamp and whether it lists spec files that no
  // longer exist before believing it.
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/report" }]],

  use: {
    baseURL: process.env.JSUI_ORIGIN || "https://dydra.com",
    // The development hosts present a self-signed certificate.
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
