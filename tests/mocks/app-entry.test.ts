import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";

test("a known fixture renders its control preview", async ({ page, hubServer }) => {
  await page.goto(`${hubServer.baseUrl}/?fixture=ucpath-found`);
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true })).toBeVisible();
  await expect(page.getByText("Write outcome unknown. The original submit remains held.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByRole("button", { name: "Check again", exact: true })).toBeVisible();
});

for (const fixture of ["unknown-preview", "constructor", "__proto__", "toString"]) {
  test(`fixture ${fixture} renders the normal dashboard`, async ({ page, hubServer }) => {
    await page.goto(`${hubServer.baseUrl}/?fixture=${fixture}`);
    await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    await expect(page.getByText("Write outcome unknown. The original submit remains held.", { exact: true })).toHaveCount(0);
  });
}
