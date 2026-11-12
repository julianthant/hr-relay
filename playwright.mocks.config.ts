/** Renders /ui-mock scenes from the mock dashboard build against isolated fixture servers. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";
import { scaledMs } from "./tests/support/time-scale.js";

const keychainPreload = new URL("./tests/support/helpers/credential-keychain-process-preload.mjs", import.meta.url).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${keychainPreload}`;
process.env.TZ = "America/Los_Angeles";

export default defineConfig({
  testDir: "tests/mocks",
  outputDir: "tests/mocks/.output",
  globalSetup: "./tests/mocks/helpers/global-setup.ts",
  fullyParallel: true,
  workers: Math.min(4, availableParallelism()),
  retries: 0,
  timeout: scaledMs(120_000),
  expect: {
    timeout: scaledMs(5_000),
  },
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    hasTouch: false,
    headless: true,
    timezoneId: "America/Los_Angeles",
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "tests/mocks/.output/results.json" }],
  ],
});
