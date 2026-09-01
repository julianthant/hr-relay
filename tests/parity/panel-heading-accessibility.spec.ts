/**
 * Product panels are navigational landmarks inside their takeover or shell.
 * Their titles must therefore be semantic peer headings, not styled text. This
 * test uses the built dashboard and role queries so a title that looks right
 * while dropping out of the accessibility tree fails loud.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
} from "../../src/domain/dashboard/settings.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { FIXTURE_ARCHIVED_RUN_ID, FIXTURE_ACTIVITY_RANGE } from "./helpers/fixture-archive.js";
import { FIXTURE_CATALOG_QUERY, FIXTURE_EXPLORER_WORKFLOW_ID } from "./helpers/fixture-explorer.js";
import { FIXTURE_DAY, FIXTURE_IDS } from "./helpers/fixture-day.js";
import { FIXTURE_INTAKE_IDS } from "./helpers/fixture-intake.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";

let server: FixtureServer;

async function expectPanelHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
  });
});

test.afterAll(async () => {
  await server.close();
});

test("every production PanelHeader is an explicit level-two heading", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
  await expectPanelHeading(page, "Archived runs");

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: FIXTURE_ARCHIVED_RUN_ID });
  await expectPanelHeading(page, "EID 10873698");

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "", archiveView: "versions" });
  await expectPanelHeading(page, "Versions & bumps");

  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}`,
  });
  await expectPanelHeading(page, "Automation activity");

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID });
  await expectPanelHeading(page, "Workflows");
  await expectPanelHeading(page, /^Person Lookup v\d+$/u);
  await expectPanelHeading(page, "searching");

  // D298 — `?intake=` is always a session id; the upload page it used to open is gone.
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.mapping });
  await expectPanelHeading(page, "Spreadsheet intake");

  for (const [section, title] of [
    ["", "General"],
    ["storage", "Storage health"],
    ["keyboard", "Keyboard"],
    [SETTINGS_SYSTEM_HOSTS_SECTION_ID, "System hosts"],
    [SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, "Workflow capabilities"],
  ] as const) {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: section });
    await expectPanelHeading(page, title);
  }

  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    // D295: the catalog is the `ui-catalog` Settings section, so its heading is
    // reached through the Settings takeover rather than through `?catalog=`.
    settings: "ui-catalog",
    catalog: FIXTURE_CATALOG_QUERY,
  });
  await expectPanelHeading(page, "UI catalog");
});

test("the existing live run-detail workflow panel remains a level-two heading", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.runningRun });
  await expectPanelHeading(page, "Person Lookup");
});
