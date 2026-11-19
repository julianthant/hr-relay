/** Run panel smoke: each seeded run opens from its queue row, survives a reload and closes on Back. */
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const OPENABLE_RUNS = ["queuedRun", "runningRun", "doneRun", "cancelledRun"] as const;
/** Seeded runs whose logs the dashboard refuses today; each should open like the others. */
const REFUSED_RUNS = ["failedRun", "openGateRun", "parkedRun"] as const;

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`run panel at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const key of OPENABLE_RUNS) {
      test(`${key} opens its timeline and logs`, async ({ dashboard, page, seeded }) => {
        await dashboard.open();
        await expect(page.getByText("No run open")).toBeVisible();
        await dashboard.openRun(seeded.runIds[key]!);
        await expect(dashboard.runPanel.getByRole("heading", { level: 2 })).toBeVisible();
        await expect(dashboard.runPanel.getByRole("navigation", { name: "Run timeline" })).toBeVisible();
        await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
        await dashboard.expectNoSidewaysScroll();
      });
    }
  });
}

for (const key of REFUSED_RUNS) {
  test(`${key} opens its timeline and logs`, async ({ dashboard, seeded }) => {
    test.fail(true, "The seeded run's logs fail the dashboard's identity checks and the panel shows \"Couldn't load logs.\"");
    await dashboard.open();
    await dashboard.openRun(seeded.runIds[key]!);
    await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
  });
}

test("an open run survives Reload and closes on Back", async ({ dashboard, page, seeded }) => {
  await dashboard.open();
  await dashboard.openRun(seeded.runIds.doneRun!);
  await page.reload();
  await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("No run open")).toBeVisible();
});

test("switching runs replaces the panel with the newly chosen run", async ({ dashboard, seeded }) => {
  await dashboard.open();
  await dashboard.openRun(seeded.runIds.doneRun!);
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  await dashboard.openRun(seeded.runIds.cancelledRun!);
  await expect(dashboard.runPanel.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(dashboard.runPanel.getByText("Done", { exact: true })).toHaveCount(0);
});
