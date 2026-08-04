/**
 * The doc 13 §7.1 reference set.
 *
 * Every ported state, in both themes, at the reference viewports, captured as a
 * screenshot AND its a11y snapshot. The corpus is the deterministic fixture
 * adapter, so a capture is a pure function of the served payloads: the same
 * state photographed twice is byte-identical, and a diff therefore means the
 * UI changed, never that the clock moved.
 *
 * Re-freeze with `PARITY_UPDATE=1 npm run test:parity -- --update-snapshots`.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import {
  FIXTURE_APP_VERSION,
  FIXTURE_DAY,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_IDS,
} from "./helpers/fixture-day.js";
import {
  PARITY_THEMES,
  PARITY_VIEWPORTS,
  applyTheme,
  captureParityPair,
  type ParityTheme,
} from "./helpers/capture.js";
import { gotoAppState, type AppRoute } from "./helpers/app-driver.js";

const DIST = resolve(import.meta.dirname, "../../dist/dashboard");
const REFERENCES = resolve(import.meta.dirname, "references");

/** Every state the 1i slice can actually show, and the route that shows it. */
const STATES: readonly { id: string; route: AppRoute }[] = [
  { id: "queue-day", route: { day: FIXTURE_DAY } },
  { id: "run-open-gate", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.openGateRun } },
  { id: "run-failed", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun } },
  { id: "run-running", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.runningRun } },
  { id: "run-done", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.doneRun } },
  { id: "run-queued", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.queuedRun } },
  // groupOf13 is the group the corpus gives a `group` panel detail to; the
  // smaller groups exist to exercise the QUEUE's well sizing, not the panel.
  { id: "run-group", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.groupOf13 } },
  { id: "run-member", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.memberRun } },
  { id: "run-receipt", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.doneRun, section: "receipt" } },
  { id: "start-run", route: { day: FIXTURE_DAY, start: true } },
];

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer({ distDir: DIST });
});

test.afterAll(async () => {
  await server.close();
});

/** A page that logged an uncaught error did not render the state under test. */
function failOnPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

for (const viewport of PARITY_VIEWPORTS) {
  for (const theme of PARITY_THEMES) {
    test.describe(`${theme.name} @ ${viewport.name}`, () => {
      for (const state of STATES) {
        test(state.id, async ({ page }) => {
          const errors = failOnPageErrors(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await gotoAppState(page, server.baseUrl, state.route);
          await applyTheme(page, theme satisfies ParityTheme);
          await page.waitForTimeout(120);

          expect(errors, `page errors while rendering ${state.id}`).toEqual([]);

          await captureParityPair(page, REFERENCES, {
            stateId: state.id,
            viewport: viewport.name,
            theme: theme.name,
            adapter: "fixture",
            fixtureId: state.id,
            descriptorHash: FIXTURE_DESCRIPTOR_HASH,
            appVersion: FIXTURE_APP_VERSION,
            capturedAt: FIXTURE_DAY,
            variant: "default",
          });
        });
      }
    });
  }
}

/**
 * The two access variants doc 13 §7.1 names. Both are captured at one viewport
 * and one theme: they are about behavior (where focus goes, whether motion
 * runs), and photographing them six more times would only add pixels to review.
 */
test.describe("access variants", () => {
  test("keyboard-only focus lands on the queue", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await applyTheme(page, PARITY_THEMES[1]);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(errors).toEqual([]);

    await captureParityPair(page, REFERENCES, {
      stateId: "queue-day",
      viewport: "1440x900",
      theme: PARITY_THEMES[1].name,
      adapter: "fixture",
      fixtureId: "queue-day",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "keyboard",
    });
  });

  test("reduced motion renders the resting state", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await applyTheme(page, PARITY_THEMES[1]);
    expect(errors).toEqual([]);

    await captureParityPair(page, REFERENCES, {
      stateId: "queue-day",
      viewport: "1440x900",
      theme: PARITY_THEMES[1].name,
      adapter: "fixture",
      fixtureId: "queue-day",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "reduced-motion",
    });
  });
});
