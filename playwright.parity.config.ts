/**
 * The doc 13 §7 parity lane: seeded backend (or fixture BFF) + built React +
 * headless Chromium, both themes, reference viewports, screenshot + a11y
 * snapshot pairs. Run with `npm run test:parity`; pass PARITY_UPDATE=1 to
 * (re)freeze the reference set under tests/parity/references/.
 *
 * The lane builds its own servers per worker (ephemeral ports) — it never
 * touches the real 3938/5174 isolation ports, so it can run beside a live
 * rebuild runtime.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/parity",
  outputDir: "tests/parity/.output",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    toHaveScreenshot: {
      // The two adapters must render the SAME pixels; the tiny allowance is
      // for antialiasing nondeterminism only, never for content drift.
      maxDiffPixelRatio: 0.001,
    },
  },
  snapshotPathTemplate: "{testDir}/references/{arg}{ext}",
  use: {
    browserName: "chromium",
    headless: true,
    deviceScaleFactor: 1,
  },
  reporter: [["list"]],
});
