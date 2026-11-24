/** Toasts stay bottom centre and clear of the Sessions panel when the stack is expanded by the keyboard. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { STATE_RULES } from "../support/helpers/dashboard/smoke/state-rules.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const id = "sessions/toast/stack";

test("three toasts expanded by keyboard focus stay clear of the Sessions panel", async ({ mount, page, diagnostics }) => {
  const entry = CATALOGUE.find(item => item.id === id);
  if (entry === undefined) throw new Error(`the catalogue has no story ${id}`);
  await mount(id);
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(3);
  await page.locator('[data-slot="toast"]').first().focus();
  await expect(page.locator('[data-slot="toast"][data-expanded]').first()).toBeVisible();
  await page.waitForTimeout(600);
  const context = { page, storyId: id, story: entry.story, diagnostics, dialogShapes: new Map() };
  expect(await STATE_RULES["toast-placement"].check(context)).toEqual([]);
});
