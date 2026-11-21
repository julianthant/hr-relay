/** Run panel smoke: each seeded run opens from its queue row, survives a reload and closes on Back. */
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

/** Each seeded run and the workflow queue that lists it; the scripted executor's runs are Work-Study runs. */
const OPENABLE_RUNS = [
  ["queuedRun", "Person Lookup"], ["runningRun", "Person Lookup"], ["doneRun", "Person Lookup"], ["cancelledRun", "Person Lookup"],
  ["interruptedRun", "Person Lookup"], ["failedRun", "Work-Study"], ["openGateRun", "Work-Study"], ["parkedRun", "Work-Study"],
  ["writtenRun", "Work-Study"],
] as const;

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`run panel at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const [key, workflow] of OPENABLE_RUNS) {
      test(`${key} opens its timeline and logs`, async ({ dashboard, page }) => {
        await dashboard.open();
        await dashboard.openWorkflow(workflow);
        await expect(page.getByText("No run open")).toBeVisible();
        await dashboard.openRun(dashboard.runId(key));
        await expect(dashboard.runPanel.getByRole("heading", { level: 2 })).toBeVisible();
        await expect(dashboard.runPanel.getByRole("navigation", { name: "Run timeline" })).toBeVisible();
        await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
        await dashboard.expectNoSidewaysScroll();
      });
    }
  });
}

test("the done run shows the steps it completed, none upcoming", async ({ dashboard }) => {
  await dashboard.open();
  await dashboard.openRun(dashboard.runId("doneRun"));
  const timeline = dashboard.runPanel.getByRole("navigation", { name: "Run timeline" });
  for (const step of ["Search for person", "Cross-check identity", "Read employment status"]) {
    await expect(timeline.getByText(step, { exact: true }).first()).toBeVisible();
  }
  await expect(timeline.getByText("Upcoming")).toHaveCount(0);
});

test("an open run survives Reload and closes on Back", async ({ dashboard, page }) => {
  await dashboard.open();
  const runId = dashboard.runId("doneRun");
  await dashboard.openRun(runId);
  await page.reload();
  await dashboard.expectRunOpen(runId);
  await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("No run open")).toBeVisible();
});

test("switching runs replaces the panel with the newly chosen run", async ({ dashboard }) => {
  await dashboard.open();
  await dashboard.openRun(dashboard.runId("doneRun"));
  await expect(dashboard.runPanel.getByText("Done", { exact: true }).first()).toBeVisible();
  await dashboard.openRun(dashboard.runId("cancelledRun"));
  await expect(dashboard.runPanel.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(dashboard.runPanel.getByText("Done", { exact: true })).toHaveCount(0);
});
