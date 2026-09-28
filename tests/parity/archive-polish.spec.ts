import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { ARCHIVE_COMPARISON_REPORTS, ARCHIVE_COMPARISON_VERSIONS } from "./helpers/fixture-archive-comparison.js";

test("workflow picker collapses to the selected scope and normalizes all selected workflows", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: ARCHIVE_COMPARISON_REPORTS, versions: ARCHIVE_COMPARISON_VERSIONS } });
  try {
    await page.goto(`${server.baseUrl}/?archive=&archiveDashboard=1.0&archiveWorkflow=person-lookup`);
    await page.getByRole("button", { name: "Plan a bump", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Plan a version bump" });
    const picker = dialog.getByRole("button", { name: "Workflow to bump" });
    await expect(picker).toContainText("Person lookup");
    await expect(dialog.getByRole("group", { name: "Workflows to bump" })).toHaveCount(0);
    await picker.click();
    const choices = page.getByRole("group", { name: "Workflows to bump" });
    await expect(choices.getByRole("checkbox", { name: /Person lookup/iu })).toBeChecked();
    await choices.getByRole("checkbox", { name: /Separations/iu }).check();
    await page.keyboard.press("Escape");
    await expect(picker).toContainText("2 workflows");
    await expect(dialog).toContainText("Every registered workflow selected: dashboard major bump");
    await expect(dialog.getByRole("button", { name: "Review affected runs" })).toBeEnabled();
  } finally { await server.close(); }
});
test("run-list filters retain the table without a visible column control or count", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: ARCHIVE_COMPARISON_REPORTS, versions: ARCHIVE_COMPARISON_VERSIONS } });
  try {
    await page.goto(`${server.baseUrl}/?archive=&archiveDashboard=1.0&archiveWorkflow=separations`);
    await expect(page.getByRole("table", { name: "Separations saved runs" })).toBeVisible();
    const controls = page.getByRole("group", { name: "Filter version archives" });
    await expect(controls.getByRole("textbox", { name: "Search all public archive fields" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Columns" })).toHaveCount(0);
    await expect(controls.getByText(/^\d+ runs?$/u)).toHaveCount(0);
  } finally { await server.close(); }
});
