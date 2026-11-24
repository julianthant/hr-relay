/** Browser smoke checks for the built dashboard on the seeded backend and the state gallery's check loop. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  outputDir: "tests/smoke/.output",
  fullyParallel: false,
  workers: Math.min(3, availableParallelism()),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    headless: true,
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // Keep each gallery shard's ordered story references and frame collection on one worker.
    { name: "gallery", testMatch: "**/*.gallery.ts", workers: 1 },
    { name: "smoke", testMatch: "**/*.smoke.ts", workers: 2 },
  ],
  reporter: [["list"], ["json", { outputFile: "tests/smoke/.output/results.json" }]],
});
