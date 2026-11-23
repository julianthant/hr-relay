/** Browser smoke checks for the built dashboard on the seeded backend, then the state gallery's check loop. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
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
  // One worker runs projects in this order: the smoke files, then the state gallery.
  projects: [
    { name: "smoke", testMatch: "**/*.smoke.ts" },
    { name: "gallery", testMatch: "**/*.gallery.ts" },
  ],
  reporter: [["list"]],
});
