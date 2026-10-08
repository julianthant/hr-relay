import { expect, type Locator } from "@playwright/test";

/** Select a value through the public keyboard/popup interaction. */
export async function chooseSelect(control: Locator, value: string): Promise<void> {
  if (await control.evaluate(node => node.tagName === "SELECT")) { await control.selectOption(value); return; }
  await control.click();
  const popup = control.page().locator('[data-slot="select-content"][data-open]');
  await popup.waitFor();
  const direct = popup.locator(`[role="option"][data-value=${JSON.stringify(value)}]`);
  if (await direct.count()) await direct.click();
  else await popup.getByRole("option", { name: value, exact: true }).click();
  await expect(control).toHaveAttribute("aria-expanded", "false");
}
