/**
 * The doc 13 §7.1 reference set.
 *
 * Every ported state, in both themes, at the reference viewports, captured as a
 * screenshot AND its a11y snapshot. The corpus is the deterministic fixture
 * adapter, so a capture is a pure function of the served payloads: the same
 * state photographed twice is byte-identical, and a diff therefore means the
 * UI changed, never that the clock moved.
 *
 * Every reference is ASSERTED — the pixels against Playwright's baseline, the
 * a11y tree and provenance record against their stored files. Re-freeze the
 * whole set deliberately with `npm run test:parity:update`.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
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
import { FIXTURE_INTAKE_IDS } from "./helpers/fixture-intake.js";
import {
  FIXTURE_CATALOG_QUERY,
  FIXTURE_EXPLORER_WORKFLOW_ID,
} from "./helpers/fixture-explorer.js";
import { FIXTURE_ACTIVITY_RANGE, FIXTURE_ARCHIVED_RUN_ID } from "./helpers/fixture-archive.js";
import { gotoAppState, type AppRoute } from "./helpers/app-driver.js";

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
  // The intake workspace's three points (2i-E3). `intake-mapping` is the one
  // that matters most: a bound column and an unbound one with a live proposal
  // beside it, which is the whole proposed-against-decided axis in one frame.
  { id: "intake-upload", route: { day: FIXTURE_DAY, intake: "new" } },
  { id: "intake-mapping", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.mapping } },
  { id: "intake-review", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.validated } },
  /*
    The two read-only reference takeovers (2i-G). `explorer-graph` is the
    Phase-2 exit criterion's own picture — the as-built person-lookup graph,
    served from the REAL projection — and `explorer-transaction` is the one
    node kind that can change a live HR system, so it is the state where the
    page's single saturated mark has to earn itself. `catalog-search` shows the
    catalog narrowed, which is both the search in use and the provenance a
    selector must never be read without.
  */
  { id: "explorer-graph", route: { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID } },
  { id: "explorer-transaction", route: { day: FIXTURE_DAY, explore: "kuali-timekeeper-annotation" } },
  { id: "catalog-search", route: { day: FIXTURE_DAY, catalog: FIXTURE_CATALOG_QUERY } },
  /*
    The archive model's three operator states (2i-G, D179). `archive-ledger`
    is the sweep-grouped record with the version-bump flow beneath it, and it
    carries a BLOCKER on purpose — a refusal surface photographed only in its
    happy state proves nothing. `archive-run` is the read-only detail, whose
    whole claim is that it renders with no descriptor behind it.
  */
  { id: "archive-ledger", route: { day: FIXTURE_DAY, archive: "" } },
  { id: "archive-run", route: { day: FIXTURE_DAY, archive: FIXTURE_ARCHIVED_RUN_ID } },
  /*
    The Activity report (2i-G, D180) over a fixed range, including the
    unregistered-workflow row and the unmeasured-duration warning — the two
    places the report has to be honest rather than tidy.
  */
  {
    id: "activity-report",
    route: { day: FIXTURE_DAY, activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}` },
  },
];

let server: FixtureServer;

test.beforeAll(async () => {
  // Build (or prove the reuse of) the bundle under test before anything serves
  // it: a reference captured from a stale `dist/dashboard` documents code that
  // is not in the working tree.
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

/**
 * The workflow panel opens as a FLOATING window that dismisses on the first
 * click outside it, and at these viewports it sits over the intake workspace's
 * left edge — its target-field column and its stage tabs.
 *
 * The queue's references keep the window because the queue is what the window
 * is FOR: you pick a workflow, you read its rows. The intake workspace is a
 * takeover, so the operator's very first act is a click into it, and a
 * reference photographed before that click documents a window rather than the
 * surface under test. The press lands on the panel header — deliberately not
 * the body, where the dropzone would open a file chooser instead.
 */
async function dismissWorkflowWindow(page: import("@playwright/test").Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("the parity lane always sets a viewport before navigating");
  // Horizontally centred so it lands in the header's empty middle at every
  // reference viewport — at 1024 the trailing controls reach x≈900.
  await page.mouse.click(viewport.width / 2, 100);
  await page.waitForTimeout(120);
}

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
          // Every TAKEOVER dismisses the floating window for the same reason
          // the intake workspace does: it sits over the surface under test,
          // and the operator's first act on a takeover is a click into it.
          if (
            state.route.intake !== undefined
            || state.route.explore !== undefined
            || state.route.catalog !== undefined
            || state.route.archive !== undefined
            || state.route.activity !== undefined
          ) await dismissWorkflowWindow(page);
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
