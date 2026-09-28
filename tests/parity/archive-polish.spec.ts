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

test("long retained section navigation scrolls independently of selected content", async ({ page }) => {
  ensureParityBundle();
  const report = { ...ARCHIVE_COMPARISON_REPORTS[0], sections: Array.from({ length: 26 }, (_, index) => ({
    kind: "text" as const, title: `Retained source ${index + 1}`, text: `Frozen content ${index + 1}`,
  })) };
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
    archiveComparison: { reports: [report], versions: ARCHIVE_COMPARISON_VERSIONS } });
  try {
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await page.goto(`${server.baseUrl}/?archive=${report.runId}`);
      const nav = page.getByRole("navigation", { name: "Run sections" });
      await nav.getByRole("button", { name: "Retained source 26", exact: true }).focus();
      await page.keyboard.press("Enter");
      const content = page.getByRole("region", { name: "Retained source 26", exact: true });
      await expect(content).toContainText("Frozen content 26");
      const contentBox = await content.boundingBox();
      expect(contentBox?.y).toBeGreaterThanOrEqual(0);
      expect(contentBox?.y).toBeLessThan(width === 1024 ? 650 : 830);
      expect(await nav.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await nav.getByRole("button", { name: "All fields", exact: true }).focus();
      await expect(nav.getByRole("button", { name: "All fields", exact: true })).toBeFocused();
      expect(await nav.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await page.goto(`${server.baseUrl}/?archive=${report.runId}&archiveBrowse=${encodeURIComponent(JSON.stringify({ filters: {}, section: 25 }))}`);
      const selected = nav.getByRole("button", { name: "Retained source 26", exact: true });
      await expect(selected).toHaveAttribute("aria-current", "page");
      await expect.poll(async () => {
        const item = await selected.boundingBox();
        const rail = await nav.boundingBox();
        return item !== null && rail !== null && item.y >= rail.y - 1 && item.y + item.height <= rail.y + rail.height + 1;
      }).toBe(true);
      expect((await content.boundingBox())?.y).toBeLessThan(width === 1024 ? 650 : 830);
    }
  } finally { await server.close(); }
});
