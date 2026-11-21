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
      test(`${key} opens its timeline and logs`, async ({ dashboard, page }) => {
        await dashboard.open();
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

for (const key of REFUSED_RUNS) {
  test(`${key} opens its panel and shows the known logs refusal`, async ({ dashboard, failures }) => {
    const runId = dashboard.runId(key);
    if (key === "openGateRun") {
      const conflict = new RegExp(String.raw`^(?:http 409: GET |console: Failed to load resource: the server responded with a status of 409 \(Conflict\) )http://127\.0\.0\.1:\d+/api/v1/runs/${runId}$`, "u");
      failures.allow(conflict, "The seeded open-gate run refuses its detail read with a conflict.");
    }
    await dashboard.open();
    await dashboard.openRun(runId);
    const refusal = dashboard.runPanel.getByText("Couldn't load logs.", { exact: true });
    await expect(refusal, "known refusal; move this run to OPENABLE_RUNS once its logs load").toBeVisible();
    await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeHidden();
  });
}

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
