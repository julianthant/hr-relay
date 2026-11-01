import { expect, type Locator } from "@playwright/test";

export async function setSwitchChecked(control: Locator, checked: boolean): Promise<void> {
  if (await control.isChecked() !== checked) await control.press("Space");
  await expect(control).toBeChecked({ checked });
}
