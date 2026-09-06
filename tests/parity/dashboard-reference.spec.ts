/**
 * The ref frontend-backend-integration §7.1 reference set.
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
import { startSeededServer, SEEDED_APP_VERSION, SEEDED_DAY, type SeededServer } from "./helpers/seeded-bff.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import {
  FIXTURE_APP_VERSION,
  FIXTURE_DAY,
  FIXTURE_DAY_WIRE,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_IDS,
  FIXTURE_IDENTITY_GATE,
  FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,
  FIXTURE_START_PICKER_BOOTSTRAP,
  FIXTURE_START_PICKER_DAY_WIRE,
  FIXTURE_START_PICKER_DESCRIPTOR_HASH,
  FIXTURE_SEPARATIONS_START_PLAN,
} from "./helpers/fixture-day.js";
import {
  PARITY_THEMES,
  PARITY_VIEWPORTS,
  assertThemeApplied,
  captureParityPair,
  installTheme,
  type ParityTheme,
} from "./helpers/capture.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { FIXTURE_INTAKE_IDS } from "./helpers/fixture-intake.js";
import {
  FIXTURE_CATALOG_QUERY,
  FIXTURE_EXPLORER_WORKFLOW_ID,
} from "./helpers/fixture-explorer.js";
import {
  FIXTURE_ACTIVITY_RANGE,
  FIXTURE_ACTIVITY_UNAVAILABLE_RANGE,
  FIXTURE_ARCHIVED_RUN_ID,
} from "./helpers/fixture-archive.js";
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
  /*
    The parked write (W2, ref write-safety §4.1). The corpus has photographed this run's
    `blocked` QUEUE ROW since it was written and had never once opened it — so
    the panel behind the one lifecycle the kernel refuses generic retry for was
    unphotographed while its two typed resolutions sat implemented, tested and
    unreachable. This is the reference that makes the resolution copy, the
    served fence facts and the `resolve-write-present` refusal all readable.
  */
  { id: "run-parked-write", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.parkedRun } },
  // groupOf13 is the group the corpus gives a `group` panel detail to; the
  // smaller groups exist to exercise the QUEUE's well sizing, not the panel.
  { id: "run-group", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.groupOf13 } },
  { id: "run-member", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.memberRun } },
  { id: "start-run", route: { day: FIXTURE_DAY, start: true } },
  // The intake workspace's four points (2i-E3). `intake-mapping` is the one
  // that matters most: a bound column and an unbound one with a live proposal
  // beside it, which is the whole proposed-against-decided axis in one frame.
  // `intake-upload` LEFT with the upload page (D298) — the zone it photographed
  // is now the Run Modal's spreadsheet arm, which `start-run-spreadsheet`
  // photographs.
  { id: "intake-mapping", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.mapping } },
  { id: "intake-review", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.validated } },
  { id: "intake-manifest", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.manifest } },
  { id: "intake-rerun", route: { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.rerun } },
  /*
    The two read-only reference takeovers (2i-G). `explorer-graph` is the
    Phase-2 exit criterion's own picture — the as-built person-lookup graph,
    served from the REAL projection — and `explorer-transaction` is the one
    node kind that can change a live HR system, so it is the state where the
    page's single saturated mark has to earn itself. `catalog-search` shows the
    catalog narrowed, which is both the search in use and the provenance a
    selector must never be read without — inside Settings since D295, which is
    where the catalog lives now.
  */
  { id: "explorer-graph", route: { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID } },
  { id: "explorer-transaction", route: { day: FIXTURE_DAY, explore: "separations-kuali-finalization" } },
  {
    id: "catalog-search",
    route: { day: FIXTURE_DAY, settings: "ui-catalog", catalog: FIXTURE_CATALOG_QUERY },
  },
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
  {
    id: "activity-report-unavailable",
    route: {
      day: FIXTURE_DAY,
      activity: `${FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from}..${FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to}`,
    },
  },
  /*
    THE SETTINGS TAKEOVER (D274 item 6). The gear has been in the top bar of
    every reference in this corpus since it was written, and what it opens had
    never been photographed once — while the fixture served a single invented
    `general` section, so the only page reachable behind it was the "this build
    has no renderer for it" gap. The bootstrap now lists the SERVER's own three
    sections and the lane serves `settings/facts`, so this opens on the first
    one exactly as the operator's gear does.
  */
  { id: "settings", route: { day: FIXTURE_DAY, settings: "" } },
];

let server: FixtureServer;
let startPickerServer: FixtureServer;
let separationsStartServer: FixtureServer;
let storageServer: FixtureServer;
/**
 * Adapter #2, started for exactly one state (2j). The reference corpus is
 * otherwise the deterministic fixture adapter, and the whole reason this one
 * server exists here is that a RECEIPT cannot be authored: it is DERIVED from
 * authority rows (D141), and adapter #1 truthfully holds none. Until now the
 * `run-done` reference therefore photographs the receipt's `missing`
 * arm, so the panel that carries D82's whole acceptance bar — "the operator
 * completes the double-check without opening UCPath" — had never been
 * photographed with anything in it.
 *
 * The seeded adapter is byte-stable for the same reasons the fixture one is:
 * a `manualClock` at `SEEDED_AT` and ids from a seed function, never
 * `randomUUID` or the wall clock.
 */
let seeded: SeededServer;

test.beforeAll(async () => {
  // Build (or prove the reuse of) the bundle under test before anything serves
  // it: a reference captured from a stale `dist/dashboard` documents code that
  // is not in the working tree.
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  startPickerServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
      day: FIXTURE_START_PICKER_DAY_WIRE,
      descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    },
  });
  separationsStartServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
      day: FIXTURE_START_PICKER_DAY_WIRE,
      descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
      startPlan: FIXTURE_SEPARATIONS_START_PLAN,
    },
  });
  storageServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,
      day: FIXTURE_DAY_WIRE,
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    },
  });
  seeded = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
  await startPickerServer.close();
  await separationsStartServer.close();
  await storageServer.close();
  await seeded.close();
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

/**
 * The ordinary Start Run fixture stays intentionally small: it proves the
 * Person Lookup input/plan flow. This profile proves the OTHER thing the
 * picker owns — the served registry's composition and its unavailable harness
 * steps — with the real seven modules, including the timekeeping-category
 * Kronos harness. Separations has its typed-input door, while the harnesses
 * honestly disclose below it: none has enough independent input for this
 * dialog to invent a box. Their parent is therefore absent from that filtered
 * list and every row keeps the explicit raw composition id rather than
 * fabricating a label the filtered list does not supply (the grouping rule's
 * orphan arm).
 */
test.describe("start-run picker hierarchy", () => {
  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, startPickerServer.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);
        await page.waitForTimeout(120);

        const picker = page.getByRole("navigation", { name: "Workflow" });
        await expect(picker.getByRole("button", { name: "Separations sp" })).toBeVisible();
        const unavailable = page.getByRole("button", { name: "5 not startable" });
        await expect(unavailable).toHaveAttribute("aria-expanded", "false");
        await unavailable.click();
        await expect(unavailable).toHaveAttribute("aria-expanded", "true");

        for (const label of [
          "Separation Timecard",
          "Separation Document",
          "Identity Check",
          "UCPath Termination",
          "Kuali Finalization",
        ]) {
          await expect(page.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(
          page.getByTitle("A proving harness of separations — a step of that workflow, not a workflow of its own"),
        ).toHaveCount(5);
        // The parent is startable while its harnesses are not, so the blocked
        // list is an honest orphan view. Kronos retains its own HR category
        // instead of pretending a missing blocked-list parent exists.
        await expect(page.getByText("Timekeeping", { exact: true })).toBeVisible();
        // The blocked disclosure has a deliberate fixed height. Keep the
        // semantic reference over every harness above, then photograph its
        // lower edge too: this puts the cross-category Kronos step in pixels,
        // rather than leaving the most important row only in the a11y tree.
        await page.getByText("Separation Timecard", { exact: true }).scrollIntoViewIfNeeded();

        await assertShellGeometry(page, `start-run-separations @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations picker").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "start-run-separations",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "start-run-separations",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });
      });
    }
  }
});

/** D296 — the arm is one dialog region; the desktop pair is the whole of it. */
const SPREADSHEET_HANDOFF_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900",
);

/**
 * D296/D298: the Run Modal's SECOND door, photographed — and since D298 it is
 * the intake's dropzone rather than a paragraph about one.
 *
 * `Import spreadsheet` left the queue toolbar in D296's commit and the
 * workspace's own upload page left in D298's, so this tab is the intake's ONLY
 * entry — a surface with no reference is a surface nobody can tell has broken,
 * and this reference now carries the zone the retired `intake-upload` state
 * used to hold. Person Lookup is the one registered module declaring an intake
 * projection, which is exactly why the base fixture serves the tabs and the
 * separations picker above does not: that pair, not a fixture flag, is the
 * negative control.
 */
test.describe("start-run spreadsheet handoff", () => {
  for (const viewport of SPREADSHEET_HANDOFF_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);

        const tabs = page.getByRole("tablist", { name: "How to start this run" });
        await expect(tabs.getByRole("tab", { name: "Type values" })).toHaveAttribute("aria-selected", "true");
        await tabs.getByRole("tab", { name: "Import a spreadsheet" }).click();
        await expect(tabs.getByRole("tab", { name: "Import a spreadsheet" }))
          .toHaveAttribute("aria-selected", "true");

        // The rail collapses to the one stage this arm reaches, and the stage
        // IS the zone. All of it is asserted before the pixels: a `Next` under
        // a one-stage rail, or a lingering `Open the intake…` primary, is the
        // defect this arm exists to avoid and it photographs indistinguishably
        // from a correct frame.
        await expect(page.getByRole("list", { name: "Run configuration path" })
          .getByRole("listitem")).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Open the intake…" })).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: /employee IDs/u })).toHaveCount(0);
        // D298 — a real `<input type="file">`, which is what makes the zone
        // reachable by keyboard, screen reader and touch alike.
        await expect(page.locator('.fixed input[type="file"]')).toHaveCount(1);
        await expect(page.getByText(/Drop a spreadsheet of people for/u)).toBeVisible();

        await assertShellGeometry(page, `start-run-spreadsheet @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the spreadsheet handoff").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "start-run-spreadsheet",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "start-run-spreadsheet",
          descriptorHash: FIXTURE_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // The DROP is the whole point of the door (D298): it uploads, and the
        // dialog closes on the workspace for the workflow the picker had
        // selected, with the file already read.
        await page.locator('.fixed input[type="file"]').setInputFiles({
          name: "roster.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("Employee ID,Legal Name\n10873698,Ada Lovelace\n", "utf8"),
        });
        await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toBeVisible();
        // Landed ON the session the upload opened, not on an empty workspace:
        // the source band names the file the fixture served back.
        await expect(page.getByRole("region", { name: "Source file" })).toBeVisible();
        expect(errors, "page errors while opening the intake workspace").toEqual([]);
      });
    }
  }
});

/**
 * DCF6: Start Run is a three-stage interaction, not only the initial picker.
 * These references deliberately use the real Separations typed-input surface
 * and its locked shape. The fixture plan row is generic layout evidence (see
 * `FIXTURE_SEPARATIONS_START_PLAN`), never a claim about the composition's
 * planner semantics. The final press proves the Close exit returns focus to
 * the still-visible typed document; conflict remains unit-only because this
 * fixture does not have a truthful stale-envelope command path.
 */
const SEPARATIONS_START_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900" || viewport.name === "narrow-1024x768",
);


test.describe("separations start-run continuity", () => {
  for (const viewport of SEPARATIONS_START_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, separationsStartServer.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await page.getByRole("navigation", { name: "Workflow" })
          .getByRole("button", { name: "Separations sp" })
          .click();
        // D296's negative control, and it belongs HERE because the picker
        // opens on Person Lookup, which DOES declare an intake projection.
        // Separations declares none, so its method set is a set of one and the
        // strip is not drawn at all — the demo's own condition. A strip on this
        // workflow would mean the door came from somewhere other than the
        // served `spreadsheetIntake`, and it would offer an intake the kernel
        // refuses by name.
        await expect(page.getByRole("tablist", { name: "How to start this run" })).toHaveCount(0);
        const typedDocument = page.getByPlaceholder(
          "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
        );
        await typedDocument.fill("4502");
        await expect(typedDocument).toHaveValue("4502");
        await assertShellGeometry(page, `separations-start-input @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run input").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-input",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-input",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("checkbox", { name: "Customize steps" })).toBeVisible();

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-options",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-options",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("checkbox", { name: "Customize steps" }).check();
        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();
        await expect(page.getByText("6 of 6 included", { exact: true })).toBeVisible();

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-steps",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-steps",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // D307 — the omission itself. Unchecking an omittable step draws the
        // step folder's OWN declared form inline, and the run reads what is
        // typed there instead of the step. Separations is the only workflow
        // that declares omissions, and Kronos timecard is the one whose form
        // has fields to photograph.
        await page.getByRole("checkbox", { name: "Kronos timecard" }).uncheck();
        await expect(page.getByText("5 of 6 included", { exact: true })).toBeVisible();
        await page.getByLabel("Last day worked").fill("06/30/2026");
        await page.getByLabel("Separation date").fill("07/01/2026");
        await expect(page.getByLabel("Separation date")).toHaveValue("07/01/2026");
        expect(errors, "page errors while rendering the omitted separations step").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-steps-omitted",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-steps-omitted",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // Put it back, so the plan capture below photographs the same request
        // it always did: the drafts leave with the omission.
        await page.getByRole("checkbox", { name: "Kronos timecard" }).check();
        await expect(page.getByText("6 of 6 included", { exact: true })).toBeVisible();

        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByText("Fixture plan row", { exact: true })).toBeVisible();
        await expect(page.getByText("4502", { exact: true })).toBeVisible();
        await expect(page.getByText(/Julian Zaw/u)).toBeVisible();
        await assertShellGeometry(page, `separations-start-plan @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run plan").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-plan",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-plan",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByText("Start applied", { exact: true })).toBeVisible();
        await expect(page.getByText("4502", { exact: true })).toBeVisible();
        await expect(page.getByText(/Julian Zaw/u)).toBeVisible();
        await assertShellGeometry(page, `separations-start-result @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run result").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-result",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-result",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByText("Close", { exact: true }).click();
        await expect(typedDocument).toBeFocused();
        await expect(typedDocument).toHaveValue("4502");
      });
    }
  }
});

/**
 * Dismiss the window on a QUEUE view — where `y=100` is a live control.
 *
 * On a takeover the queue and its bands are gone, so the press above lands in
 * empty chrome. On the queue view it lands on the STATUS FILTER ROW, and the
 * first `panel-dismissed` reference minted with it photographed the queue
 * filtered to `Done 2` while claiming to be the day queue — a harness that
 * changed the state it was supposed to reveal. (`run-receipt-populated` already
 * found this once and worked around it locally; this is the same finding with a
 * post-condition attached so it cannot happen a third time.)
 *
 * The press goes into the panel region instead, which is inert on both views:
 * the `No run open` empty state with nothing selected, the log stream with a
 * run open. And it ASSERTS its own post-condition — the window gone AND the
 * status filter untouched — because a dismissal that quietly changes the
 * subject is exactly the check that cannot fail.
 */
async function dismissWorkflowWindowOverQueue(page: import("@playwright/test").Page): Promise<void> {
  const filters = page.getByRole("group", { name: "Filter the queue by status" });
  const pressedBefore = await filters.getByRole("button", { pressed: true }).allInnerTexts();
  await page.mouse.click(500, 500);
  await page.waitForTimeout(120);
  await expect(
    page.getByRole("region", { name: "Workflow Panel" }),
    "the workflow window is still on screen; the reference would photograph it",
  ).toHaveCount(0);
  expect(
    await filters.getByRole("button", { pressed: true }).allInnerTexts(),
    "dismissing the window changed the queue's status filter — the reference would show a different queue",
  ).toEqual(pressedBefore);
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

/**
 * Per-scene anchors, asserted BEFORE capture. A reference minted from a page
 * that silently fell back — a Timeline on its per-event arm because the wire
 * dropped `timeline.steps`, a Settings pane on its "no renderer" gap arm —
 * records the regression and then passes forever. Each anchor is a fact only
 * the intended arm can render, so the NEXT `PARITY_UPDATE=1` mint fails loud
 * instead of photographing the fallback.
 */
const SCENE_ANCHORS: Record<string, (page: import("@playwright/test").Page) => Promise<void>> = {
  "activity-report": async (page) => {
    await expect(page.getByText("8 distinct people touched", { exact: true })).toBeVisible();
    const workflowTable = page.getByRole("table", { name: "Activity by workflow, grouped by category" });
    await expect(workflowTable.getByRole("columnheader", { name: "Unread", exact: true })).toBeVisible();
  },
  "activity-report-unavailable": async (page) => {
    await expect(page.getByText("Distinct people unavailable", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "How runs is counted" }).click();
    await expect(page.getByText(/mixed pseudonym key generations/u)).toBeVisible();
    const workflowTable = page.getByRole("table", { name: "Activity by workflow, grouped by category" });
    await expect(workflowTable.getByRole("columnheader", { name: "Unread", exact: true })).toBeVisible();
  },
  "run-group": async (page) => {
    // D225's categorical strip: the segment disclosure button exists only on
    // the categorical arm, and its name carries the replay count.
    await expect(
      page.getByRole("button", { name: "UCPath termination — done, took 2m 48s, a step in it ran 2 times" }),
    ).toBeVisible();
  },
  "intake-rerun": async (page) => {
    const rerunTab = page.getByRole("tab", { name: "Rerun diff" });
    await rerunTab.click();
    await expect(rerunTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(
      "This file has run before, and the plan has changed since. The exact changed axes and membership are below.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("table", { name: "Changed input hashes" })).toBeVisible();
  },
  "settings": async (page) => {
    // DCC3's server-listed editor resolves the blank route to General. Waiting
    // on its real form control prevents a loading/no-renderer arm from being
    // deliberately re-frozen as the editable Settings reference.
    await expect(page.getByRole("textbox", { name: "Operator label" })).toBeVisible();
  },
};

for (const viewport of PARITY_VIEWPORTS) {
  for (const theme of PARITY_THEMES) {
    test.describe(`${theme.name} @ ${viewport.name}`, () => {
      for (const state of STATES) {
        test(state.id, async ({ page }) => {
          const errors = failOnPageErrors(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          // BEFORE navigation: the theme is selected through the product's own
          // stored preference, so React seeds its state from it (D187).
          await installTheme(page, theme satisfies ParityTheme);
          await gotoAppState(page, server.baseUrl, state.route);
          // Every TAKEOVER dismisses the floating window for the same reason
          // the intake workspace does: it sits over the surface under test,
          // and the operator's first act on a takeover is a click into it.
          if (
            state.route.intake !== undefined
            || state.route.explore !== undefined
            || state.route.archive !== undefined
            || state.route.activity !== undefined
            || state.route.settings !== undefined
          ) await dismissWorkflowWindow(page);
          await assertThemeApplied(page, theme satisfies ParityTheme);
          await page.waitForTimeout(120);

          // The third representation (D195). Runs BEFORE the capture, because a
          // reference minted from a region with a hole in it records the bug
          // and then passes forever.
          await assertShellGeometry(page, `${state.id} @ ${viewport.name} ${theme.name}`);

          await SCENE_ANCHORS[state.id]?.(page);
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
 * D281 item 7: the storage hazard is its own degraded-fixture family. The
 * ordinary corpus stays healthy; these references prove the same app-wide site
 * on the queue and above a takeover without degrading an operator runtime.
 */
async function assertStorageBandGeometry(
  page: import("@playwright/test").Page,
  viewportWidth: number,
): Promise<void> {
  const band = page.getByRole("alert").filter({ hasText: "Authority storage is unavailable" });
  await expect(band).toBeVisible();
  const geometry = await band.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      width: rect.width,
      borderTop: style.borderTopWidth,
      borderRight: style.borderRightWidth,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      borderRadius: style.borderRadius,
    };
  });
  expect(geometry).toEqual({
    x: 0,
    width: viewportWidth,
    borderTop: "0px",
    borderRight: "0px",
    borderBottom: "1px",
    borderLeft: "0px",
    borderRadius: "0px",
  });
}

test.describe("storage band", () => {
  const STORAGE_STATES: readonly { id: string; route: AppRoute }[] = [
    { id: "storage-queue", route: { day: FIXTURE_DAY } },
    { id: "storage-settings", route: { day: FIXTURE_DAY, settings: "" } },
  ];

  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      for (const state of STORAGE_STATES) {
        test(`${state.id} @ ${theme.name} @ ${viewport.name}`, async ({ page }) => {
          const errors = failOnPageErrors(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await installTheme(page, theme satisfies ParityTheme);
          await gotoAppState(page, storageServer.baseUrl, state.route);
          if (state.route.settings === undefined) {
            await dismissWorkflowWindowOverQueue(page);
          } else {
            await dismissWorkflowWindow(page);
          }
          await assertThemeApplied(page, theme satisfies ParityTheme);
          await assertStorageBandGeometry(page, viewport.width);

          await assertShellGeometry(page, `${state.id} @ ${viewport.name} ${theme.name}`);
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
    }
  }

  test("storage-queue @ graphite-warm @ 1440x900 @ sidebar", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("hr-dashboard.workflow-panel", "sidebar");
    });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, storageServer.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[0]);
    await expect(page.getByRole("navigation", { name: "Workflow Panel" })).toBeVisible();
    await assertStorageBandGeometry(page, 1440);
    await assertShellGeometry(page, "storage-queue @ 1440x900 graphite-warm sidebar");
    expect(errors, "page errors while rendering storage-queue in sidebar mode").toEqual([]);

    await captureParityPair(page, REFERENCES, {
      stateId: "storage-queue",
      viewport: "1440x900",
      theme: PARITY_THEMES[0].name,
      adapter: "fixture",
      fixtureId: "storage-queue",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "sidebar",
    });
  });
});

const STORAGE_DOCTOR_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900" || viewport.name === "narrow-1024x768",
);

test.describe("loaded storage doctor", () => {
  for (const viewport of STORAGE_DOCTOR_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "storage" });
        await dismissWorkflowWindow(page);
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await page.getByRole("button", { name: "Run the read-only storage doctor" }).click();
        const heading = page.getByRole("heading", { name: "Span authority degraded" });
        await expect(heading).toBeVisible();
        await expect(page.getByRole("list", { name: "Span authority problems" }).getByRole("listitem"))
          .toHaveCount(4);
        await page.getByText("1 archived run", { exact: true }).click();
        await expect(page.getByRole("list", { name: "Archived span-authority runs" })).toBeVisible();
        await heading.scrollIntoViewIfNeeded();

        await assertShellGeometry(page, `storage-doctor-degraded @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the loaded storage doctor").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "storage-doctor-degraded",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "storage-doctor-degraded",
          descriptorHash: FIXTURE_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });
      });
    }
  }
});

/**
 * THE QUEUE, UNOCCLUDED (W2).
 *
 * Every `queue-*` and `run-*` reference above keeps the floating Workflow
 * Panel, and at every reference viewport that window sits OVER the queue
 * column. That is the right default — the queue is what the window is FOR, and
 * a reference that dismissed it would document a state the operator only
 * reaches by clicking away. But it means the queue's own rows have never been
 * photographed with nothing on top of them: their status clusters, their
 * wrapping footers and the group wells behind the window are, in the corpus as
 * it stands, covered pixels. A defect there is invisible to the pixel half and
 * agreed with by the a11y half, which is the exact shape D187 and D195 each
 * found once.
 *
 * So this ADDS a second photograph of two states rather than moving either
 * one: the day queue at rest, and a queue with a run open beside it. One
 * viewport, both themes — the occlusion is a function of the layout, not of
 * the width, and 1440x900 is the width the window overlaps most.
 */
test.describe("panel dismissed", () => {
  const DISMISSED: readonly { id: string; route: AppRoute }[] = [
    { id: "queue-day", route: { day: FIXTURE_DAY } },
    { id: "run-running", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.runningRun } },
  ];
  for (const theme of PARITY_THEMES) {
    for (const state of DISMISSED) {
      test(`${state.id} @ ${theme.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, server.baseUrl, state.route);
        await dismissWorkflowWindowOverQueue(page);
        await assertThemeApplied(page, theme satisfies ParityTheme);
        await page.waitForTimeout(120);

        // The region must still tile with the window GONE. A hole that the
        // floating panel was covering is still a hole (D195).
        await assertShellGeometry(page, `${state.id} panel-dismissed @ 1440x900 ${theme.name}`);
        expect(errors, `page errors while rendering ${state.id} with the panel dismissed`).toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: state.id,
          viewport: "1440x900",
          theme: theme.name,
          adapter: "fixture",
          fixtureId: state.id,
          descriptorHash: FIXTURE_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "panel-dismissed",
        });
      });
    }
  }
});

/**
 * THE TWO TYPED RESOLUTIONS, OPEN (W2, ref write-safety §4.1).
 *
 * The `run-parked-write` reference above photographs the record; the copy that
 * decides a real HR write lives one click further in, in the confirm block the
 * SERVER authored. A dialog nobody photographs is a dialog whose wording is
 * reviewed once, by whoever wrote it.
 *
 * Both arms, because they are not two skins of one screen. `absent` carries the
 * evidence note the kernel requires; `present` carries that note AND the typed
 * PROOF FORM the section's `proofContract` describes — one control per
 * operator-supplied leaf of the commit contract's own completion proof schema,
 * with the literals the schema pins shown as chips rather than offered as
 * boxes (D245).
 *
 * **These two references were re-photographed for D245 and the change is the
 * point.** Until then the `present` arm was a REFUSAL — the wire served no
 * proof schema identity, so the surface offered the control disabled with its
 * reason — and the corpus was recording a defect rather than catching one
 * (D187's lesson, from the side where the defect finally got fixed).
 *
 * One viewport and one theme apiece: these are about the copy and the controls,
 * which are the same pixels at every width.
 */
test.describe("park resolutions", () => {
  const ARMS: readonly { variant: string; label: string }[] = [
    { variant: "resolve-absent", label: "I confirmed it is NOT there" },
    { variant: "resolve-present", label: "I confirmed it IS there" },
  ];
  for (const arm of ARMS) {
    test(`run-parked-write ${arm.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.parkedRun });
      await assertThemeApplied(page, PARITY_THEMES[0]);

      // The record's own control, by its SERVED label — a rename on the server
      // must fail this test rather than silently re-photograph a new word.
      //
      // ANCHORED, NOT EXACT, since R8's `ParkResolutions` port: the two
      // resolutions are no longer bare pills, they are the demo's tinted CARDS,
      // and each card's accessible name is now the label FOLLOWED BY the
      // server's own `detail` sentence — which is the whole reason they became
      // cards (a pill can carry a verb; what separates these two verbs is a
      // sentence about what each one unlocks). A leading-anchored regex keeps
      // the property this locator was written for — the served label must still
      // be the first thing the control says — without pinning the sentence
      // beside it, which the reference images already review.
      const control = new RegExp(`^${arm.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      await page.getByRole("button", { name: control }).click();
      // Radix moves focus into the dialog on open; wait for the surface itself
      // rather than a duration, so the capture is never of a half-mounted box.
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
      expect(errors, `page errors while opening ${arm.variant}`).toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "run-parked-write",
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: "run-parked-write",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: arm.variant,
      });
    });
  }
});

/**
 * THE IDENTITY-APPROVAL CEREMONIES, OPEN (ref write-safety §14.4/§14.6, D226).
 *
 * `run-open-gate` above photographs the decision CARD. The control that
 * actually authorises a real termination against a named human lives one click
 * further in, and until D226 it did not exist: the corpus served no
 * `identity-gate` section at all, so the card drew no way to answer it.
 *
 * The current name-only path uses the typed-EID ceremony. These references
 * show it with agreeing and disconfirming names, plus the rejection/refusal:
 *
 *  - **typed EID, names agree** — one exact-looking candidate still requires
 *    the EID to be stated because it came from a name search.
 *  - **typed EID, names differ** — the disagreement remains above the same
 *    empty field rather than changing the source-based trigger.
 *  - **reject** — the arm that ends the run, with the operator's own reason.
 *
 * And one refusal, because a surface photographed only in its happy state
 * proves nothing: the gated run is also the fixture BFF's conflict run, so
 * pressing the verb after typing the EID answers `409` and photographs the
 * "nothing was recorded" copy with the operator's answer still in the dialog.
 *
 * One viewport and one theme apiece: these are about the copy, the ceremony and
 * the refusal, which are the same pixels at every width.
 */
test.describe("identity gate ceremonies", () => {
  const CEREMONIES: readonly {
    variant: string;
    stateId: string;
    run: string;
    control: string;
  }[] = [
    {
      variant: "gate-choose",
      stateId: "run-open-gate",
      run: FIXTURE_IDS.openGateRun,
      control: "Approve the chosen EID",
    },
    {
      variant: "gate-reject",
      stateId: "run-open-gate",
      run: FIXTURE_IDS.openGateRun,
      control: "Reject — this is not the right person",
    },
    {
      variant: "gate-type-eid",
      stateId: "run-member-gate",
      run: FIXTURE_IDS.gateTypedEidRun,
      control: "Approve the chosen EID",
    },
  ];
  for (const ceremony of CEREMONIES) {
    test(`${ceremony.stateId} ${ceremony.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: ceremony.run });
      await assertThemeApplied(page, PARITY_THEMES[0]);

      // The decision card's own control, by its SERVED label — a rename on the
      // server must fail this test rather than silently re-photograph a new
      // word. Leading-anchored, since `BannerActions` may append the server's
      // `detail` sentence to the accessible name.
      const control = new RegExp(`^${ceremony.control.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`);
      await page.getByRole("button", { name: control }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
      expect(errors, `page errors while opening ${ceremony.variant}`).toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: ceremony.stateId,
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: ceremony.stateId,
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: ceremony.variant,
      });
    });
  }

  /**
   * THE REFUSAL, with the answer still in the dialog.
   *
   * The gated run is also the fixture BFF's `conflictRun`, so this is a real
   * round trip through the real command client that comes back `409`. The
   * reference is here because "nothing was recorded" is the sentence an
   * operator reads when a second tab moved the row under them, and a refusal
   * whose copy nobody photographs is copy reviewed once by whoever wrote it.
   */
  test("run-open-gate gate-refused", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.openGateRun });
    await assertThemeApplied(page, PARITY_THEMES[0]);

    await page.getByRole("button", { name: /^Approve the chosen EID/u }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The EID came from a name search, so D309 requires the operator to type
    // one of the candidates the packet actually showed.
    const candidate = FIXTURE_IDENTITY_GATE.options[0];
    if (candidate === undefined) throw new Error("the refusal fixture served no identity candidate");
    await page.getByRole("textbox", {
      name: "Type the employee ID this separation is about (required)",
    }).fill(candidate.eid);
    await page.getByRole("button", { name: "Approve" }).click();
    // The refusal lands in TWO places on purpose (a dialog can be scrolled), so
    // this waits on the one INSIDE the dialog — the record beside the answer it
    // refused, which is what the reference is of.
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.waitForTimeout(300);
    /*
      A 409 is a VALUE here, not a page error (ref frontend-backend-integration §3.4): the client reports
      it, the dialog keeps the answer, and Chromium logs the non-2xx response to
      the console because every non-2xx response is logged there.

      So the expectation is the EXACT one line, not a filter that would swallow
      anything shaped like it. Pinning it both ways is the point: an empty array
      would mean the refusal never round-tripped, and a second entry would mean
      the page threw something this reference is about to photograph as normal.
    */
    expect(errors, "page errors while photographing the refused approval").toEqual([
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);

    await captureParityPair(page, REFERENCES, {
      stateId: "run-open-gate",
      viewport: "1440x900",
      theme: PARITY_THEMES[0].name,
      adapter: "fixture",
      fixtureId: "run-open-gate",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "gate-refused",
    });
  });
});

/**
 * THE OTHER TWO SETTINGS PANES (D274 item 6, ledger 3 SE40–SE42).
 *
 * `settings` above opens on Storage, which is served by the bootstrap and needs
 * nothing else. These two are the `settings/facts` panes — the resolved config's
 * System hosts table, and the descriptor registry's Workflow capabilities table
 * — and each is a projection of an authority the process already composed, so
 * what they print is what a run would actually do. They are photographed
 * because they are exactly the pages that can go quietly wrong: a hosts table
 * that omits a `not-distinct` verdict, or a capability row that claims a dry
 * run a descriptor does not declare, is a screen that reads correct and is not.
 *
 * One viewport and one theme apiece: these are tables of served facts, the same
 * pixels at every width, and the nav that reaches them is already in `settings`.
 */
test.describe("settings panes", () => {
  const PANES: readonly { variant: string; section: string; table: string }[] = [
    { variant: "system-hosts", section: "system-hosts", table: "System entry hosts" },
    { variant: "capabilities", section: "workflow-capabilities", table: "Dry-run posture by workflow" },
  ];
  for (const pane of PANES) {
    test(`settings ${pane.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: pane.section });
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, PARITY_THEMES[0]);

      /*
        `useSettingsFacts` draws THREE states and only one of them is this
        reference. Waiting on the pane's own SERVED table — a table that exists
        on the `loaded` arm and on neither of the others — is what keeps a
        `loading` skeleton, or the `failed` arm the corpus would have
        photographed before the route existed, from being frozen here as if it
        were the loaded page. Named, not `.first()`: an unnamed wait would be
        satisfied by any table the takeover happened to draw.

        Deliberately NOT `getByRole("heading")`: `PanelHeader` renders its title
        as a styled `<span>`, so no Settings pane has a heading at all. That is
        a real finding and it belongs in a fidelity unit, not in a re-freeze —
        this reference photographs the surface as it ships.
      */
      await expect(page.getByRole("table", { name: pane.table })).toBeVisible();
      await page.waitForTimeout(120);
      expect(errors, `page errors while rendering the ${pane.variant} pane`).toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "settings",
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: "settings",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: pane.variant,
      });
    });
  }
});

/**
 * THE VERSION-BUMP AUTHORING DIALOG (D179, charter §25).
 *
 * `archive-ledger` photographs the RUNS view. The Archive's other half — the
 * version registry, and the change record the operator authors before a bump —
 * had never been photographed at all, and it is the surface where a wrong word
 * is most expensive: a MAJOR bump is what moves finished runs into the archive,
 * the record is the only place anyone says WHY, and the dialog's kind radio
 * decides which of those two things happens. Copy that nobody photographs is
 * copy reviewed once, by whoever wrote it.
 *
 * Both themes at one viewport: the dialog is a fixed-width box, and the tinted
 * effect line beneath the kind radio is a colour claim in both palettes.
 */
test.describe("version bump", () => {
  for (const theme of PARITY_THEMES) {
    test(`archive-version-bump @ ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, server.baseUrl, {
        day: FIXTURE_DAY,
        archive: "",
        archiveView: "versions",
      });
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, theme satisfies ParityTheme);

      // The registry must actually be on screen before the trigger is pressed:
      // a `Bump…` click against a still-loading table would either miss or
      // photograph a dialog over a skeleton.
      await expect(page.getByRole("table", { name: "Workflow version registry" })).toBeVisible();
      await page.getByRole("button", { name: "Bump…" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
      expect(errors, "page errors while opening the version-bump dialog").toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "archive-version-bump",
        viewport: "1440x900",
        theme: theme.name,
        adapter: "fixture",
        fixtureId: "archive-version-bump",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: "default",
      });
    });
  }
});

/**
 * The two access variants ref frontend-backend-integration §7.1 names. Both are captured at one viewport
 * and one theme: they are about behavior (where focus goes, whether motion
 * runs), and photographing them six more times would only add pixels to review.
 */
test.describe("access variants", () => {
  test("keyboard-only focus lands on the queue", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[1]);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[1]);
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
    await installTheme(page, PARITY_THEMES[1]);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[1]);
    const reducedMotion = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        durations: [
          "--ds-dur-1",
          "--ds-dur-2",
          "--ds-dur-3",
          "--ds-dur-4",
          "--ds-dur-enter",
          "--ds-dur-exit",
          "--ds-dur-move",
        ].map((token) => styles.getPropertyValue(token).trim()),
        travel: ["--ds-travel-sm", "--ds-travel-md"]
          .map((token) => styles.getPropertyValue(token).trim()),
        scale: styles.getPropertyValue("--ds-scale-enter").trim(),
      };
    });
    expect(reducedMotion).toEqual({
      matches: true,
      durations: ["0s", "0s", "0s", "0s", "0s", "0s", "0s"],
      travel: ["0px", "0px"],
      scale: "1",
    });
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

// D340 is desktop-window resizing, not a mobile-device test variant.
for (const theme of PARITY_THEMES) {
  test(`desktop canvas holds its side-by-side floor — ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
    await dismissWorkflowWindow(page);
    const geometry = async () => page.evaluate(() => {
      const root = document.querySelector("[data-app-root]");
      const queue = document.querySelector('[aria-label="Queue"]');
      const detail = queue?.nextElementSibling;
      const header = document.querySelector("header");
      if (!root || !queue || !detail || !header) throw new Error("Desktop shell is incomplete");
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
      };
      return { root: box(root), queue: box(queue), detail: box(detail), header: box(header) };
    });
    const minimum = await geometry();
    expect(minimum.root.width).toBe(1024);
    expect(minimum.root.height).toBe(720);
    expect(minimum.queue.y).toBe(minimum.detail.y);
    expect(minimum.detail.x).toBeGreaterThanOrEqual(minimum.queue.x + minimum.queue.width);
    expect(minimum.detail.width).toBeGreaterThan(400);
    expect(minimum.queue.height).toBeGreaterThan(400);
    for (const viewport of [{ width: 800, height: 600 }, { width: 600, height: 400 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(geometry).toEqual(minimum);
      const scroll = await page.evaluate(() => {
        window.scrollTo(document.documentElement.scrollWidth, document.documentElement.scrollHeight);
        return { x: scrollX, y: scrollY };
      });
      expect(scroll.x).toBeGreaterThan(0);
      expect(scroll.y).toBeGreaterThan(0);
      await expect.poll(geometry).toEqual(minimum);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => (await geometry()).detail.width).toBeGreaterThan(minimum.detail.width);
  });
}

/**
 * Browser-local queue triage is deliberately outside the reference corpus:
 * its proof is the state transition and reload reset, not a second baseline
 * image whose default has no check marks. The day fixture supplies this group
 * and its three loaded members through the normal projection.
 */
test.describe("queue local triage", () => {
  test("checked by you updates the group tally and resets on reload", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[1]);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await dismissWorkflowWindow(page);

    const member = page.locator(`[data-demo-row-id='${FIXTURE_IDS.memberRun}']`).first();
    await member.getByRole("button", { name: /Mark .* checked by you/u }).click();
    await expect(page.getByLabel("1 of 3 checked by you")).toBeVisible();

    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await expect(page.getByLabel(/\d+ of \d+ checked by you/u)).toHaveCount(0);
    expect(errors, "page errors while toggling local queue triage").toEqual([]);
  });
});

/**
 * The populated receipt, from adapter #2 over a real authority database (2j).
 *
 * One viewport, both themes: the point is the receipt BODY — input,
 * observations, decisions, actions, verification, output, reuse, warnings, in
 * the schema's narrative order — and photographing it at three widths would
 * only add pixels to review. Its `missing` twin stays in the fixture corpus,
 * because "no authority rows" is a real state the panel must also render.
 */
test.describe("populated receipt (adapter #2)", () => {
  for (const theme of PARITY_THEMES) {
    test(`run-receipt-populated @ ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, seeded.baseUrl, {
        day: SEEDED_DAY,
        run: seeded.runIds["doneRun"] ?? "",
        section: "receipt",
      });
      // The floating workflow window opens over the queue's left column. The
      // takeover dismissal clicks at y=100, which on THIS layout is the status
      // filter row — it would change the queue's filter and reset the panel's
      // open section. The empty gutter between the queue and the panel is the
      // only inert target at this viewport.
      await page.mouse.click(500, 500);
      await page.waitForTimeout(120);
      await assertThemeApplied(page, theme satisfies ParityTheme);
      await page.waitForTimeout(120);
      expect(errors, "page errors while rendering the populated receipt").toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "run-receipt-populated",
        viewport: "1440x900",
        theme: theme.name,
        adapter: "seeded",
        fixtureId: "seeded-done-run",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: SEEDED_APP_VERSION,
        capturedAt: SEEDED_DAY,
        variant: "default",
      });
    });
  }
});
