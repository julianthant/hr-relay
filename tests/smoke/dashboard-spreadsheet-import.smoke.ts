import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test("imports both CSV sizes, opens their saved rows, and picks both as run references", async ({ dashboard, page, failures }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "The seeded server does not implement the selected workflow preference.");
  await dashboard.open();
  await dashboard.openDataPage("Spreadsheets");
  await expect(page.getByText("No spreadsheets yet", { exact: true })).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Import a spreadsheet" });
  const inputs = [{ name: "Small smoke roster", rows: 3 }, { name: "Large smoke roster", rows: 5_000 }];
  for (const { name, rows } of inputs) {
    const lastEid = String(10_000_000 + rows);
    const csv = ["Employee ID", ...Array.from({ length: rows }, (_, index) => String(10_000_001 + index))].join("\n");
    await page.getByRole("button", { name: "Import", exact: true }).first().click();
    await dialog.locator('input[type="file"]').setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(name);
    await dialog.getByRole("button", { name: "Next" }).click();

    const save = dialog.getByRole("button", { name: "Add to library" });
    await expect(save).toBeEnabled();
    const release = Promise.withResolvers<void>();
    let received = false;
    await page.route("**/api/v1/workbooks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      received = true;
      await release.promise;
      await route.continue();
    });
    try {
      await save.click();
      await expect(save).toBeDisabled();
      await expect.poll(() => received, { message: "The local CSV reached the workbook create route" }).toBe(true);
      await expect(page.getByText(`Added ${name}`, { exact: true })).toBeHidden();
    } finally {
      release.resolve();
    }

    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot="toast-title"]').filter({ hasText: `Added ${name}` })).toBeVisible();
    const entry = page.getByRole("listitem", { name, exact: true });
    await expect(entry).toHaveCount(1);
    await entry.click();
    await expect(dashboard.pageHeading(name)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(rows + 1);
    await page.getByRole("searchbox", { name: "Search this sheet" }).fill(lastEid);
    await expect(page.getByRole("cell", { name: lastEid, exact: true })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "Spreadsheets", exact: true }).click();
    await expect(dashboard.pageHeading("Spreadsheets")).toBeVisible();
  }

  await page.getByRole("button", { name: /^(Back to dashboard|Close settings)$/u }).click();
  await dashboard.openStartDialog();
  await dashboard.dialog.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name: "Person Lookup", exact: true }).click();
  const checks = dashboard.dialog.getByRole("region", { name: "Reference spreadsheets" });
  for (const { name } of inputs) {
    await checks.getByRole("button", { name: "Add spreadsheet" }).click();
    await page.getByRole("searchbox", { name: "Find a spreadsheet" }).fill(name);
    await page.getByRole("menuitem", { name: new RegExp(name, "u") }).click();
    await expect(checks.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
    await expect(checks.getByRole("button", { name: new RegExp(`${name} worksheets, (?!none chosen)`, "u") })).toBeEnabled();
  }
});
