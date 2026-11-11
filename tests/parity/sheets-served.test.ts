import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { disposeHttpRouteHarness } from "../support/helpers/backend/http-route-harness.js";
import { serveWorkbookLibrary } from "./helpers/served-workbook-library.js";

const OUT = "tests/parity/.output/sheets-served";

for (const theme of ["dark", "light"] as const) {
  test(`spreadsheets page on the served library ${theme} 1280x720`, async ({ page, hubServer }) => {
    mkdirSync(OUT, { recursive: true });
    try {
      await serveWorkbookLibrary(page, ["Contact roster", "I-9 tracker"], { requiredFields: true });
      await page.addInitScript(value => Reflect.set(window, "relayParityTheme", value), theme);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${hubServer.baseUrl}/?fixture=hub-integration&settings=spreadsheets`);
      const shot = async (id: string) => { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${theme}-${id}.png`) }); };
      await expect(page.getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();
      await expect(page.getByRole("listitem", { name: "Contact roster", exact: true })).toBeVisible();
      await expect(page.getByText("Your spreadsheets")).toHaveCount(0);
      await shot("list");

      await page.getByRole("button", { name: "Actions for Contact roster", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^(Pin|Unpin|Clone|Edit tags)$/ })).toHaveCount(0);
      await shot("row-menu");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /^Versions of Contact roster/ }).click();
      await expect(page.getByRole("dialog", { name: "Versions", exact: true })).toBeVisible();
      await shot("versions");
      await page.keyboard.press("Escape");

      await page.getByRole("listitem", { name: "Contact roster", exact: true }).locator("div").first().click();
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
      await shot("detail");
      await page.getByRole("button", { name: "Columns" }).click();
      await shot("detail-columns");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Spreadsheets", exact: true }).first().click();
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Import a spreadsheet" })).toBeVisible();
      await shot("import");
    } finally { await disposeHttpRouteHarness(); }
  });
}
