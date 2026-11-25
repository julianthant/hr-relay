/** Queue layout smoke: the moved controls reach by keyboard and close back to their trigger, and frames of the page, the Options menu and the Start run dialog. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const FRAMES = join(import.meta.dirname, ".output/queue-layout-frames");
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1600, height: 900 }] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`queue layout at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test("Options closes on Escape and returns focus; the sidebar + shows on focus; Start run opens without a workflow list", async ({ dashboard, failures, page }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      mkdirSync(FRAMES, { recursive: true });
      await dashboard.open();
      const shot = (name: string) => page.screenshot({ path: join(FRAMES, `${name}-${String(viewport.width)}.png`), animations: "disabled" });
      await shot("main");

      const options = page.getByRole("button", { name: /^Options/ });
      await expect(page.getByRole("menu", { name: "Queue options" })).toHaveCount(0);
      await options.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "Queue options" });
      await expect(menu).toBeVisible();
      await shot("options");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(options).toBeFocused();

      const plus = page.locator(".workflow-rail-start").first();
      await plus.focus();
      await expect(plus).toBeVisible();
      await expect(plus).toBeFocused();

      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page.locator(".launch-workflow-rail")).toHaveCount(0);
      await shot("start-run");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  });
}
