import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

async function openChecks(dashboard: DashboardPage): Promise<void> {
  await dashboard.open();
  await dashboard.openStartDialog();
  await dashboard.dialog.getByRole("textbox", { name: "Employee IDs or names" }).fill("Lee, Jordan");
  const advance = dashboard.dialog.getByRole("button", { name: "Continue", exact: true });
  await advance.click();
  await advance.click();
}

test("Start run Checks reaches Ready to start", async ({ dashboard }) => {
  await openChecks(dashboard);
  await expect(dashboard.dialog.getByRole("status").filter({ hasText: "Ready to start" })).toBeVisible();
  await expect(dashboard.dialog.getByRole("button", { name: "Start run", exact: true })).toBeEnabled();
});

test.describe("failed preflight", () => {
  test.use({ scenarios: { preflightScenario: "failed" } });

  test("a failed check keeps Start run disabled", async ({ dashboard }) => {
    await openChecks(dashboard);
    const results = dashboard.dialog.getByRole("region", { name: "Check results" });
    await expect(results.getByText("Saved runs", { exact: true })).toBeVisible();
    await expect(results.getByText("Failed", { exact: true })).toBeVisible();
    await expect(dashboard.dialog.getByRole("button", { name: "Start run", exact: true })).toBeDisabled();
  });
});
