
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_EXPLORER_WORKFLOW_ID } from "./helpers/fixture-explorer.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_INTAKE_IDS } from "../support/fixtures/dashboard/fixture-intake.js";

let server: FixtureServer;

async function expectPanelHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

test.beforeAll(async () => {
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
  });
});

test.afterAll(async () => {
  await server.close();
});

test("production PanelHeaders use explicit semantic heading levels", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    settings: "activity",
  });
  await expect(page.getByRole("heading", { name: "Analytics", level: 1, exact: true })).toBeVisible();

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID });
  await expect(page.getByRole("heading", { name: "Explorer", level: 1, exact: true })).toBeVisible();
  await expectPanelHeading(page, "Open browser sessions");


  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.mapping });
  await expectPanelHeading(page, "Spreadsheet intake");

  for (const [section, title] of [
    ["", "General"],
    ["storage", "Storage checks"],
    ["keyboard", "Keyboard shortcuts"],
  ] as const) {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: section });
    await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toBeVisible();
  }

});
