import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { ARCHIVE_COMPARISON_REPORTS, ARCHIVE_COMPARISON_VERSIONS } from "./helpers/fixture-archive-comparison.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";

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
    await expect(dialog.getByRole("button", { name: "Review change" })).toBeEnabled();
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

test("hidden technical section deep links keep the saved data sealed and show a visible section", async ({ page }) => {
  ensureParityBundle();
  const report = ARCHIVE_COMPARISON_REPORTS[0];
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: [report], versions: ARCHIVE_COMPARISON_VERSIONS } });
  try {
    await page.goto(`${server.baseUrl}/?archive=${report.runId}&archiveBrowse=${encodeURIComponent(JSON.stringify({ filters: {}, section: 3 }))}`);
    await expect(page.getByRole("alert")).toContainText("This view is no longer shown");
    const nav = page.getByRole("navigation", { name: "Run sections" });
    await expect(nav.getByRole("button", { name: "Record notes" })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "All fields" })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Workflow details" })).toHaveAttribute("aria-current", "page");
  } finally { await server.close(); }
});

for (const viewport of [{ width: 1024, height: 720 }, { width: 1440, height: 1000 }]) for (const theme of PARITY_THEMES) {
  test(`Archive filters and paired report fields fit ${viewport.width} ${theme.attribute}`, async ({ page }) => {
    ensureParityBundle();
    const report = ARCHIVE_COMPARISON_REPORTS[0];
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: ARCHIVE_COMPARISON_REPORTS, versions: ARCHIVE_COMPARISON_VERSIONS } });
    try {
      await page.setViewportSize(viewport);
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?archive=&archiveDashboard=1.0&archiveWorkflow=separations`);
      await expect(page.getByRole("table", { name: "Separations saved runs" })).toBeVisible();
      await assertThemeApplied(page, theme);
      const controls = page.getByRole("group", { name: "Filter version archives" });
      const bounds = await controls.boundingBox();
      expect(bounds).not.toBeNull();
      for (const field of await controls.locator("input, select").all()) {
        const fieldBounds = await field.boundingBox();
        expect(fieldBounds).not.toBeNull();
        expect(fieldBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(fieldBounds!.x + fieldBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      }
      await controls.getByRole("textbox", { name: "Search all public archive fields" }).focus();
      await page.keyboard.press("Tab");
      await expect(controls.getByRole("combobox", { name: "Dashboard version" })).toBeFocused();
      await page.goto(`${server.baseUrl}/?archive=${report.runId}`);
      const saved = page.getByRole("article", { name: "Saved archive report" });
      await expect(saved.getByRole("heading", { name: "Run summary", exact: true })).toBeVisible();
      const verification = await saved.getByText("Verification result", { exact: true }).boundingBox();
      const queued = await saved.getByText("Queued", { exact: true }).boundingBox();
      expect(verification).not.toBeNull(); expect(queued).not.toBeNull();
      if (viewport.width >= 1200) expect(queued!.y).toBe(verification!.y);
      else expect(queued!.y).toBeGreaterThan(verification!.y);
      await expect(saved).toContainText("40m 0s");
      await expect(saved).toContainText("DEMO-07");
      const path = page.getByRole("navigation", { name: "Archive path" });
      await expect(path.locator('[aria-current="page"]')).toHaveText("Saved run");
      await saved.evaluate(article => {
        let scroll = article.parentElement;
        while (scroll !== null && getComputedStyle(scroll).overflowY !== "auto") scroll = scroll.parentElement;
        if (scroll === null) throw new Error("Archive report has no scroll container");
        scroll.scrollTop = 320;
      });
      const sections = saved.getByRole("navigation", { name: "Run sections" });
      await expect(sections.getByRole("button", { name: "Retained files", exact: true })).toBeInViewport();
      await sections.getByRole("button", { name: "Retained files", exact: true }).click();
      await expect(sections.getByRole("button", { name: "Retained files", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(saved.getByRole("region", { name: "Retained attachments" })).toBeVisible();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width + 1);
    } finally { await server.close(); }
  });
}

test("Archive loading, empty and failed reads stay distinct and failed reads recover", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: ARCHIVE_COMPARISON_REPORTS, versions: ARCHIVE_COMPARISON_VERSIONS } });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let mode: "loading" | "empty" | "error" | "ready" = "loading";
  await page.route("**/api/v1/archive/groups*", async route => {
    if (mode === "loading") await waiting;
    if (mode === "empty") await route.fulfill({ json: { groups: [] } });
    else if (mode === "error") await route.abort("failed");
    else await route.fallback();
  });
  try {
    await page.goto(`${server.baseUrl}/?archive=`);
    await expect(page.getByRole("status").getByRole("heading", { name: "Loading version archives…" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading version archives…" })).toHaveAttribute("aria-busy", "true");
    mode = "empty"; release();
    await expect(page.getByRole("heading", { name: "No saved reports yet" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    mode = "error"; await page.reload();
    await expect(page.getByRole("alert")).toContainText("Version archives could not be loaded");
    await expect(page.getByRole("heading", { name: "No saved reports yet" })).toHaveCount(0);
    mode = "ready";
    await page.getByRole("button", { name: "Retry version archives", exact: true }).click();
    await expect(page.getByRole("region", { name: "Dashboard 2.0 archives" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { release(); await server.close(); }
});
