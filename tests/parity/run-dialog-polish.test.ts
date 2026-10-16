
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY, traceOf } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Run and Cancel dialogs retain focus and served identity @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.openGateRun}`);
      const start = page.getByRole("button", { name: "Start a run", exact: true });
      await start.click();
      const run = page.getByRole("dialog", { name: "Start a run", exact: true });
      const input = run.getByRole("textbox", { name: "Employee IDs", exact: true });
      await expect(input).toBeFocused();
      await expect(run).toHaveCSS("opacity", "1");
      const bounds = (await run.boundingBox())!;
      expect(bounds.width).toBe(880); expect(bounds.height).toBe(628);
      expect(bounds.x).toBeGreaterThanOrEqual(24); expect(bounds.y).toBeGreaterThanOrEqual(24);
      const picker = run.getByRole("navigation", { name: "Workflow", exact: true });
      const lookup = picker.getByRole("button", { name: /Person Lookup/u });
      const separations = picker.getByRole("button", { name: /Separations/u });
      const typeStyle = (node: Element) => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight });
      expect((await lookup.evaluate(typeStyle)).size).toBe((await separations.evaluate(typeStyle)).size);
      expect((await lookup.evaluate(typeStyle)).weight).toBe("400");
      expect((await separations.evaluate(typeStyle)).weight).toBe("400");
      expect((await run.locator(":scope > header").boundingBox())!.height).toBe(73);
      expect((await run.locator(":scope > footer").boundingBox())!.height).toBe(57);
      expect((await run.locator(".launch-workflow-rail").boundingBox())!.width).toBe(190);
      expect((await run.locator(".launch-stagebar").boundingBox())!.height).toBe(54);
      expect((await run.locator('[data-slot="search-field-group"]').boundingBox())!.height).toBe(32);
      expect((await input.boundingBox())!.height).toBe(88);
      await expect(run.locator(":scope > header h2")).toHaveCSS("font-size", "16px");
      await expect(run.locator(".launch-stagebar > li").nth(1)).toHaveCSS("padding", "0px");
      await input.fill("10873698");
      await run.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(run.getByRole("region", { name: "Options", exact: true })).toBeVisible();
      const flagBounds = await run.locator(".launch-flags .ds-checkbox-row").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
      expect(new Set(flagBounds).size).toBe(1);
      expect((await run.getByRole("button", { name: "None Workbook · Optional", exact: true }).boundingBox())!.height).toBe(36);
      expect((await run.getByRole("button", { name: "Auto Workers", exact: true }).boundingBox())!.height).toBe(36);
      await run.getByRole("button", { name: "1 Input", exact: true }).click();
      await expect(input).toHaveValue("10873698");
      await run.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(run.getByRole("list", { name: "Run configuration path" }).locator('[aria-current="step"]')).toHaveText(/Options/u);

      await page.keyboard.press("Escape");
      await expect(run).toHaveCount(0); await expect(start).toBeFocused();

      const row = page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"]`);
      const cancel = row.getByRole("button", { name: "Cancel run", exact: true });
      await cancel.click();
      const confirmation = page.getByRole("dialog", { name: "Cancel this run", exact: true });
      const keep = confirmation.getByRole("button", { name: "Keep it as it is", exact: true });
      await expect(keep).toBeFocused();
      await expect(confirmation).toHaveCSS("opacity", "1");
      expect((await confirmation.boundingBox())!.width).toBe(440);
      await expect(confirmation.locator(".command-confirm-target")).toContainText("Morrow, Bea");
      await expect(confirmation.locator(".command-confirm-target")).toContainText("Person Lookup");
      await expect(confirmation.locator(".command-confirm-reference")).toHaveText(`${traceOf(5)} · revision 5`);
      await expect(confirmation).toContainText("Cancelling is final");
      await expect(confirmation.getByRole("button", { name: "Cancel the run", exact: true })).toBeEnabled();

      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0); await expect(cancel).toBeFocused();
      await cancel.click(); await keep.click();
      await expect(confirmation).toHaveCount(0); await expect(cancel).toBeFocused();
      const steps = page.getByRole("region", { name: "Selected run logs", exact: true }).locator("section[aria-labelledby]");
      expect(await steps.count()).toBeGreaterThan(1);
      await expect(steps.last()).toHaveCSS("border-bottom-width", "0px");
      await expect(steps.first()).toHaveCSS("border-bottom-width", "1px");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
