import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { ARCHIVE_COMPARISON_REPORTS, ARCHIVE_COMPARISON_VERSIONS } from "./helpers/fixture-archive-comparison.js";

for (const width of [1440, 1024]) for (const theme of ["dark", "light"] as const) {
  test(`Archive toolbar matches Dashboard frame and run filters sit above the table at ${width} ${theme}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: ARCHIVE_COMPARISON_REPORTS, versions: ARCHIVE_COMPARISON_VERSIONS } });
    try {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 720 });
      await page.goto(server.baseUrl);
      if (theme === "light") await page.getByRole("button", { name: "Switch to Paper Ink" }).click();
      await page.getByRole("button", { name: "Select", exact: true }).waitFor();
      const dashboard = await page.locator('select[aria-label="Sort the queue"]').evaluate(element => {
        let node: Element | null = element;
        while (node !== null && !String(node.className).includes("flex shrink-0 flex-col overflow-hidden")) node = node.parentElement;
        if (node === null) throw new Error("Dashboard queue toolbar not found");
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
      });
      await page.goto(`${server.baseUrl}/?archive=`);
      await page.getByRole("heading", { name: "Dashboard 2.0", exact: true }).waitFor();
      const header = page.getByRole("button", { name: "Version archives" }).locator("xpath=ancestor::header[1]");
      const frame = await header.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const root = element.parentElement;
        if (root === null) throw new Error("Archive root missing");
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, rootBackground: getComputedStyle(root).backgroundColor, bodyBackground: getComputedStyle(element.nextElementSibling!).backgroundColor, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
      });
      expect({ x: frame.x, y: frame.y, width: frame.width, height: frame.height, right: frame.right }).toEqual(dashboard);
      expect(frame.documentWidth).toBe(frame.viewportWidth);
      expect(frame.rootBackground).toBe(frame.bodyBackground);
      const actionLabels = await header.getByRole("button").allTextContents();
      expect(actionLabels.slice(0, 2)).toEqual(["Version archives", "Plan a bump"]);
      await expect(header.getByRole("button", { name: "Filters" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Filter version archives" })).toHaveCount(0);
      await page.getByRole("region", { name: "Dashboard 1.0 archives" }).getByRole("button", { name: /Separations/ }).click();
      const search = page.getByRole("textbox", { name: "Search all public archive fields" });
      await expect(search).toBeVisible();
      expect(await search.evaluate(element => element.getBoundingClientRect().height)).toBe(36);
      const filterGeometry = await page.getByRole("group", { name: "Filter version archives" }).evaluate(element => {
        const search = element.querySelector<HTMLInputElement>('input[aria-label="Search all public archive fields"]');
        const from = element.querySelector<HTMLInputElement>('input[type="date"]');
        const to = element.querySelectorAll<HTMLInputElement>('input[type="date"]')[1];
        if (search === null || from === null || to === undefined) throw new Error("Visible Archive filters are incomplete");
        return { searchWidth: search.getBoundingClientRect().width, searchY: search.getBoundingClientRect().y, fromY: from.getBoundingClientRect().y, toY: to.getBoundingClientRect().y };
      });
      expect(filterGeometry.searchWidth).toBeLessThanOrEqual(320);
      expect(filterGeometry.fromY).toBe(filterGeometry.toY);
      expect(filterGeometry.fromY).toBe(filterGeometry.searchY);
      await search.fill("Run");
      await expect(page.getByRole("button", { name: "Clear filters · 1" })).toBeVisible();
      await page.getByRole("button", { name: "Clear filters · 1" }).click();
      await expect(search).toHaveValue("");
      await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: "Archive" }).click();
      await expect(page.getByRole("group", { name: "Filter version archives" })).toHaveCount(0);
      await page.goto(`${server.baseUrl}/?archive=aa11bb22-0100-4000-8000-000000000001`);
      await page.getByRole("button", { name: "Workflow details" }).waitFor();
      await expect(page.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
    } finally { await server.close(); }
  });
}

test("shared navigation separates its four tabs across Dashboard, Archive, Explorer, Activity and Settings", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.goto(server.baseUrl);
    const banner = page.getByRole("banner");
    await banner.getByRole("button", { name: "Dashboard", exact: true }).waitFor();
    const tabs = banner.getByRole("button", { name: "Archive", exact: true }).locator("xpath=..");
    const separators = tabs.locator('span[aria-hidden="true"]');
    await expect(separators).toHaveCount(3);
    for (const name of ["Dashboard", "Archive", "Explorer", "Activity"] as const) {
      await banner.getByRole("button", { name, exact: true }).click();
      await expect(banner.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(separators).toHaveCount(3);
    }
    await banner.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(separators).toHaveCount(3);
  } finally { await server.close(); }
});
