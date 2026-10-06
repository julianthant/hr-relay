import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const name = `date-typing-${theme.attribute}-${width}`;
  test(`date typing retains month and day through every year digit @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `${name}.a11y.yml` }] }, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=general`);
      const month = page.getByRole("spinbutton", { name: "month, Job end date*", exact: true });
      const day = page.getByRole("spinbutton", { name: "day, Job end date*", exact: true });
      const year = page.getByRole("spinbutton", { name: "year, Job end date*", exact: true });
      const original = { month: await month.textContent(), day: await day.textContent(), year: await year.textContent() };
      await month.focus(); await page.keyboard.type("04");
      await day.focus(); await page.keyboard.type("27");
      await year.focus();
      for (const digit of "2026") {
        await page.keyboard.type(digit);
        await expect(month).toHaveText("04"); await expect(day).toHaveText("27");
      }
      await expect(year).toHaveText("2026");
      await expect(page.getByRole("button", { name: /^Undo/u })).toHaveCount(0);
      await year.press(width === 1024 ? "Control+z" : "Meta+z");
      await expect(month).toHaveText(original.month!); await expect(day).toHaveText(original.day!); await expect(year).toHaveText(original.year!);
      await month.focus(); await page.keyboard.type("04");
      await day.focus(); await page.keyboard.type("27");
      await year.focus(); await page.keyboard.type("2026");
      await page.getByRole("button", { name: "Choose job end date Job end date*", exact: true }).click();
      const calendar = page.getByRole("dialog", { name: "Choose job end date", exact: true });
      await expect(calendar.getByRole("button", { name: /Monday, April 27, 2026/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(month).toHaveText("04"); await expect(day).toHaveText("27"); await expect(year).toHaveText("2026");
      const a11y = await page.ariaSnapshot();
      await info.attach(`${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await info.attach(`${name}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
      info.annotations.push({ type: `a11y-attachment-sha256:${name}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
