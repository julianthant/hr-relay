import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test("a saved theme survives reload", async ({ dashboard, page }) => {
  await dashboard.open();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dark = page.getByRole("radio", { name: "Dark", exact: true });
  const light = page.getByRole("radio", { name: "Light", exact: true });
  await expect(dark).toBeChecked();

  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v1/commands" && response.request().method() === "POST");
  await page.getByText("Light", { exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ state: "applied" });

  await page.reload();
  await expect(light).toBeChecked();
  await expect(page.locator("[data-app-root]")).toHaveAttribute("data-demo-theme", "light");
});
