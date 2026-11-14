/** Dashboard smoke: every sidebar page renders on the seeded backend with a clean console. */
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
  use: { browserName: "chromium", headless: true, viewport: { width: 1280, height: 720 } },
  reporter: [["list"]],
});
