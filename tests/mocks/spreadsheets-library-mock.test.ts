import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startWorkbookSweepServer } from "./helpers/sweep-workbook-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";
import { mockOutDir } from "./helpers/out-dir.js";

// The Spreadsheets list, its Import dialog, version history and actions menu; frames are evidence, never test references.
const OUT = mockOutDir(process.env.SPREADSHEET_MOCK_OUT, "spreadsheets");
const WIDTHS = [1280, 1024] as const;

for (const width of WIDTHS) test(`spreadsheet library list, import, versions and menu @ dark ${width}`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const server = await startWorkbookSweepServer({ bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
    descriptorHash: FIXTURE_START_PICKER_DAY_WIRE.descriptorHash, day: FIXTURE_START_PICKER_DAY_WIRE });
  try {
    await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, "dark");
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=spreadsheets`);
    await expect(page.getByRole("listitem", { name: "Status board.xlsx", exact: true })).toBeVisible();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `library-list-${width}.png`) });
    await page.getByRole("button", { name: "Actions for Status board.xlsx" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `library-menu-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden();
    await page.getByRole("button", { name: /^Versions of Status board\.xlsx/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `library-versions-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `library-import-${width}.png`) });
  } finally { await page.goto("about:blank"); await server.close(); }
});

for (const width of WIDTHS) test(`spreadsheet library empty @ dark ${width}`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const server = await startWorkbookSweepServer({ bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
    descriptorHash: FIXTURE_START_PICKER_DAY_WIRE.descriptorHash, day: FIXTURE_START_PICKER_DAY_WIRE }, { empty: true });
  try {
    await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, "dark");
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=spreadsheets`);
    await expect(page.getByText(/No spreadsheets yet/)).toBeVisible();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `library-empty-${width}.png`) });
  } finally { await page.goto("about:blank"); await server.close(); }
});
