/**
 * The ref frontend-backend-integration §7 parity lane: seeded backend (or fixture BFF) + built React +
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
 * working tree) before any server serves it; see `helpers/bundle.ts`. The
 * build happens ONCE, in `globalSetup`, before any worker exists — every spec's
 * own `ensureParityBundle()` then only proves the stamp.
 *
 * The lane builds its own servers per worker (ephemeral ports, a `mkdtemp`
 * state root for the seeded adapter) — it never touches the real 3938/5174
 * isolation ports, so it can run beside a live rebuild runtime, and it is why
 * the files can run in parallel.
 *
 * D340: desktop-only proof. Unique image, receipt and notification assertions
 * use the existing narrow desktop viewport; phone/coarse-pointer variants are retired.
 */
import { defineConfig } from "@playwright/test";
import { parityUpdateRequested } from "./tests/parity/helpers/reference-store.js";

export default defineConfig({
  testDir: "tests/parity",
  outputDir: "tests/parity/.output",
  globalSetup: "./tests/parity/helpers/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 120_000,
  // "none": a missing baseline is a failure, never a silently minted one.
  // "changed" (under PARITY_UPDATE=1): refresh only what actually differs, so
  // a deliberate re-freeze produces a reviewable diff rather than re-encoding
  // every unchanged PNG.
  updateSnapshots: parityUpdateRequested() ? "changed" : "none",
  expect: {
    toHaveScreenshot: {
      // D145 — NO pixel may move. The old `maxDiffPixelRatio: 0.001` allowance
      // (786 px at 1024×768) was calibrated against nothing and was wide enough
      // to swallow real content: the stale descriptor stamp `wf dd705833` sat
      // under it at 112 px while the a11y half had already been refreshed to
      // `wf a3ea62a0`, leaving eight reference PAIRS self-contradictory on disk.
      // Worse, `updateSnapshots: "changed"` reuses this same comparison, so a
      // deliberate `test:parity:update` could not repair what it could not fail.
      //
      // Measured floor, 46 references captured twice through two independent
      // full lane runs (rebuild + fresh servers + fresh Chromium) on 2026-08-04:
      // COUNTED differing pixels 0/46, always. Raw byte wobble reached 24 px of
      // 786,432 (3.1e-5); the worst per-pixel YIQ delta from nondeterminism was
      // 0.0682 normalized. So the nondeterminism budget belongs entirely in the
      // PER-PIXEL colour tolerance, and the pixel COUNT allowance is zero.
      maxDiffPixels: 0,
      // Playwright's default, pinned explicitly because it is now the lane's
      // ONLY nondeterminism allowance: 2.9× the measured 0.0682 floor. What it
      // does not see is a colour change that stays under the tolerance on every
      // pixel it touches — ref frontend-backend-integration §7.1 names that residual and what covers it.
      threshold: 0.2,
    },
  },
  snapshotPathTemplate: "{testDir}/references/{arg}{ext}",
  use: {
    browserName: "chromium",
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
