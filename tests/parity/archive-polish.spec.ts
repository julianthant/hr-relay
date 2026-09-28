import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { ARCHIVE_COMPARISON_REPORTS, ARCHIVE_COMPARISON_VERSIONS } from "./helpers/fixture-archive-comparison.js";
import { SavedArchiveReportWireSchema } from "../../src/domain/dashboard/archive.js";

const seed = ARCHIVE_COMPARISON_REPORTS.find(report => report.title === "Run 1");
if (seed === undefined) throw new Error("Rich Archive fixture must include Run 1");
for (const width of [1440, 1024]) for (const theme of ["dark", "light"] as const) for (const count of [19, 50, 100]) {
  const evidenceName = `archive-columns-${count}-${width}-${theme}.a11y.yml`;
  test(`keeps Columns heading, notice and keyboard final item inside viewport with ${count} fields at ${width} ${theme}`, { annotation: [{ type: "required-a11y-evidence", description: evidenceName }] }, async ({ page }) => {
    ensureParityBundle();
    const report = SavedArchiveReportWireSchema.parse({ ...seed, sections: [{ kind: "values", title: "Retained fields", values: Array.from({ length: count }, (_, index) => ({ label: index % 9 === 0 ? "Repeated" : `Field ${index}`, value: index })) }] });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveComparison: { reports: [report], versions: ARCHIVE_COMPARISON_VERSIONS } });
    try {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 720 });
      await page.goto(`${server.baseUrl}/?archive=&archiveDashboard=1.0&archiveWorkflow=separations`);
      if (theme === "light") await page.getByRole("button", { name: "Switch to Paper Ink" }).click();
      await page.getByRole("button", { name: "Columns", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "Workflow table columns" });
      const checkboxes = menu.getByRole("checkbox");
      await expect(checkboxes).toHaveCount(count);
      const last = checkboxes.last();
      for (let index = 0; index < count + 5; index += 1) {
        if (await last.evaluate(element => element === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(last).toBeFocused();
      await last.press("Space");
      await expect(last).toBeChecked();
      const geometry = await last.evaluate(element => {
        const menu = element.closest('[role="dialog"]');
        let list = element.parentElement;
        while (list !== null && getComputedStyle(list).overflowY !== "auto") list = list.parentElement;
        if (list === null || menu === null) throw new Error("Columns requires an internal scroll list");
        const header = menu.querySelector("header");
        const notice = menu.querySelector("p.m-0");
        if (header === null || notice === null) throw new Error("Columns heading and discovery notice required");
        const bounds = (node: Element) => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; };
        return { menu: bounds(menu), header: bounds(header), notice: bounds(notice), list: bounds(list), last: bounds(element), scrollTop: list.scrollTop, height: innerHeight, width: innerWidth };
      });
      expect(geometry.menu.top).toBeGreaterThanOrEqual(7);
      expect(geometry.menu.bottom).toBeLessThanOrEqual(geometry.height - 7);
      expect(geometry.menu.left).toBeGreaterThanOrEqual(7);
      expect(geometry.menu.right).toBeLessThanOrEqual(geometry.width - 7);
      expect(geometry.header.top).toBeGreaterThanOrEqual(geometry.menu.top);
      expect(geometry.notice.bottom).toBeLessThanOrEqual(geometry.list.top + 1);
      expect(geometry.last.top).toBeGreaterThanOrEqual(geometry.list.top - 1);
      expect(geometry.last.bottom).toBeLessThanOrEqual(geometry.list.bottom + 1);
      if (count >= 50) expect(geometry.scrollTop).toBeGreaterThan(0);
      const snapshot = await page.locator("body").ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidenceName, { body: snapshot, contentType: "text/yaml" });
      await test.info().attach("columns-keyboard-last.png", { body: await page.screenshot(), contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Columns", exact: true })).toBeFocused();
    } finally { await server.close(); }
  });
}
