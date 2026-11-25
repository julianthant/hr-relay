/** Opening History from the keyboard keeps the focus in the Assistant panel: one Tab after Enter lands on a control inside it. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";

test("History opened with Enter then one Tab focuses an Assistant control", async ({ mount, page }) => {
  await mount("assistant/chats/listed");
  const history = page.locator('#hub-shell-assistant [aria-label="History"]');
  await expect(history).toBeVisible();
  await history.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hub-slot-title", { hasText: "History" })).toBeVisible();
  await page.keyboard.press("Tab");
  const inPanel = await page.evaluate(() => {
    const active = document.activeElement;
    return active !== null && active !== document.body && active.closest("#hub-shell-assistant") !== null && active.matches("button, input, [href], [tabindex]:not([tabindex='-1'])");
  });
  expect(inPanel, "focus left the Assistant panel after Enter then Tab").toBe(true);
});
