/** Desktop parity uses isolated servers and paired screenshot/a11y references. */
import "./tests/support/helpers/credential-keychain-process-preload.js";
import { defineConfig } from "@playwright/test";
import { parityUpdateRequested } from "./tests/parity/helpers/reference-store.js";

const keychainPreload = new URL("./tests/support/helpers/credential-keychain-process-preload.ts", import.meta.url).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${keychainPreload}`;

export default defineConfig({
  testDir: "tests/parity",
  outputDir: "tests/parity/.output",
  globalSetup: "./tests/parity/helpers/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 120_000,
  // Refresh reference pairs only in explicit update mode.
  updateSnapshots: parityUpdateRequested() ? "changed" : "none",
  expect: {
    toHaveScreenshot: {
      // Repeated captures counted zero differing pixels; allow none.
      maxDiffPixels: 0,
      // 0.2 covers measured 0.0682 YIQ noise; uniform sub-threshold color changes can escape.
      threshold: 0.2,
    },
  },
  snapshotPathTemplate: "{testDir}/references/{arg}{ext}",
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    hasTouch: false,
    headless: true,
    deviceScaleFactor: 1,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "tests/parity/.output/results.json" }],
  ],
});
