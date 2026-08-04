/**
 * The doc 13 §7 parity lane: seeded backend (or fixture BFF) + built React +
 * headless Chromium, both themes, reference viewports, screenshot + a11y
 * snapshot pairs. Run with `npm run test:parity`.
 *
 * Every reference is an EXPECTATION. `updateSnapshots: "none"` means a missing
 * or changed screenshot fails instead of being written, and the SAME
 * PARITY_UPDATE switch drives the a11y/provenance half in
 * `tests/parity/helpers/reference-store.ts` — so the two halves of a pair can
 * only ever be refreshed together, and only by the deliberate
 * `npm run test:parity:update`.
 *
 * The lane rebuilds `dist/dashboard` (or proves the existing build matches the
 * working tree) before any server serves it; see `helpers/bundle.ts`.
 *
 * The lane builds its own servers per worker (ephemeral ports) — it never
 * touches the real 3938/5174 isolation ports, so it can run beside a live
 * rebuild runtime.
 */
import { defineConfig } from "@playwright/test";
import { parityUpdateRequested } from "./tests/parity/helpers/reference-store.js";

export default defineConfig({
  testDir: "tests/parity",
  outputDir: "tests/parity/.output",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  // "none": a missing baseline is a failure, never a silently minted one.
  // "changed" (under PARITY_UPDATE=1): refresh only what actually differs, so
  // a deliberate re-freeze produces a reviewable diff rather than re-encoding
  // every unchanged PNG.
  updateSnapshots: parityUpdateRequested() ? "changed" : "none",
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
