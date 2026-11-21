/** Browser smoke checks for the built dashboard on the seeded backend. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  testMatch: "**/*.smoke.ts",
  outputDir: "tests/smoke/.output",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    headless: true,
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1280, height: 720 },
  },
  reporter: [["list"]],
});
