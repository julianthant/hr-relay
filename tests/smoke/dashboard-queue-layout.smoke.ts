/** Queue layout smoke: the moved controls reach by keyboard and close back to their trigger, and frames of the page, the Options menu and the Start run dialog. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const FRAMES = join(import.meta.dirname, ".output/states/queue-layout-frames");
const EMAIL = "a.very.long.ucpath.address@ucsd.edu";
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1600, height: 900 }] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`queue layout at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test("Options closes on Escape and returns focus; the sidebar + shows on focus; Start run opens without a workflow list", async ({ dashboard, failures, page }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      mkdirSync(FRAMES, { recursive: true });
      // The seeded profile stores no UCPath username; a long one shows the profile line truncating.
      await page.route("**/api/v1/profile/state", async route => {
        const response = await route.fetch(), body = await response.json() as { account?: object };
        await route.fulfill({ response, json: body.account === undefined ? body : { ...body, account: { ...body.account, ucpathUsername: EMAIL } } });
      });
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
      await expect(page.locator(".workspace-rail-profile")).toHaveAttribute("title", EMAIL);

      // Date by keyboard alone: open it, pick the day before, return to today, and leave.
      const date = menu.getByRole("menuitem", { name: /^Date/ });
      await date.focus();
      await page.keyboard.press("ArrowRight");
      const calendar = page.getByRole("menu", { name: "Pick a date" });
      await expect(calendar).toBeVisible();
      await expect(calendar.locator('[role="gridcell"] :focus, [role="gridcell"]:focus')).toHaveCount(1);
      await shot("options-date");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Enter");
      await expect(date).not.toContainText("Today");
      const today = calendar.getByRole("button", { name: "Today", exact: true });
      for (let press = 0; press < 4 && !await today.evaluate(node => node === document.activeElement); press += 1) await page.keyboard.press("Tab");
      await expect(today).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(date).toContainText("Today");
      await page.keyboard.press("Escape");
      await expect(calendar).toHaveCount(0);
      await expect(date).toBeFocused();

      for (const [name, label, frame] of [[/^Sort by/, "Sort by", "options-sort"], [/^Status/, "Filter by status", "options-status"]] as const) {
        if (await menu.count() === 0) { await options.focus(); await page.keyboard.press("Enter"); }
        await menu.getByRole("menuitem", { name }).focus();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("menu", { name: label })).toBeVisible();
        await shot(frame);
        if (frame === "options-status") await expect(page.getByRole("menuitemcheckbox", { name: /^Needs approval/ })).toBeVisible();
        if (frame === "options-sort") await page.getByRole("menu", { name: label }).getByRole("menuitemradio", { name: "Oldest first" }).click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu", { name: label })).toHaveCount(0);
      }
      if (await menu.count() === 0) { await options.focus(); await page.keyboard.press("Enter"); }
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(options).toBeFocused();

      await expect(options).toHaveAccessibleName("Options, 1 changed");
      await shot("options-badge");

      await options.press("Enter");
      await menu.getByRole("menuitem", { name: "Reset to defaults" }).click();
      await page.keyboard.press("Escape");
      await expect(options).toHaveAccessibleName("Options");

      await page.locator(".workflow-rail-item").first().hover();
      await shot("sidebar-hover");
      const plus = page.locator(".workflow-rail-start").first();
      await plus.focus();
      await expect(plus).toBeVisible();
      await expect(plus).toBeFocused();
      await shot("sidebar-focus");

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
