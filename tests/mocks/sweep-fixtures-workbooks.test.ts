import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { startWorkbookSweepServer } from "./helpers/sweep-workbook-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";

const out = process.env.SWEEP_FIXTURES_OUT ?? "tests/mocks/.output/sweep-fixtures";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

for (const width of [1280, 1024]) test(`served workbook library, General workbook and sync states at ${width}`, async ({ page, request }) => {
  const server = await startWorkbookSweepServer({ bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
    descriptorHash: FIXTURE_START_PICKER_DAY_WIRE.descriptorHash, day: FIXTURE_START_PICKER_DAY_WIRE });
  try {
    const catalog = await request.get(`${server.baseUrl}/api/v1/workbooks/catalog`);
    expect(catalog.status()).toBe(200);
    expect(await catalog.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "General workbook.xlsx" }), expect.objectContaining({ name: "Fixture roster.xlsx" })]));
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=spreadsheets`);
    await expect(page.getByRole("listitem", { name: "General workbook.xlsx", exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/workbooks-loaded-${width}.png` });
    await page.getByRole("listitem", { name: "General workbook.xlsx", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns", exact: false })).toBeVisible();
    await expect.soft(page.getByText("Fixture project", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/workbook-general-${width}.png` });
    await writeFile(`${out}/workbook-general-${width}.yaml`, await page.locator("body").ariaSnapshot());
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=spreadsheets`);
    const roster = page.getByRole("listitem", { name: "Fixture roster.xlsx", exact: true });
    await expect(roster).toBeVisible();
    await roster.getByRole("button", { name: "Actions for Fixture roster.xlsx", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sync now", exact: true }).click();
    await expect.poll(server.downloads).toBe(1);
    await expect(page.getByText("Syncing Fixture roster.xlsx isn't confirmed yet.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check result", exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/workbook-sync-running-${width}.png` });
    await writeFile(`${out}/workbook-sync-running-${width}.yaml`, await page.locator("body").ariaSnapshot());
    server.release();
    await expect(page.getByText(/cannot be imported/u)).toBeVisible();
    await page.screenshot({ path: `${out}/workbook-sync-failed-${width}.png` });
    await writeFile(`${out}/workbook-sync-failed-${width}.yaml`, await page.locator("body").ariaSnapshot());
  } finally { await page.goto("about:blank"); await server.close(); }
});
