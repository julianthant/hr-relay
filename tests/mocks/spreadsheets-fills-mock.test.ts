import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startWorkbookSweepServer } from "./helpers/sweep-workbook-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";
import { mockOutDir } from "./helpers/out-dir.js";

// The Spreadsheets detail page for a workbook whose cells carry fills; frames are evidence, never test references.
const OUT = mockOutDir(process.env.SPREADSHEET_MOCK_OUT, "spreadsheets");
const THEMES = ["dark", "light"] as const;
const WIDTHS = [1280, 1024] as const;

for (const theme of THEMES) for (const width of WIDTHS) test(`spreadsheet detail with cell fills @ ${theme} ${width}`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const server = await startWorkbookSweepServer({ bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
    descriptorHash: FIXTURE_START_PICKER_DAY_WIRE.descriptorHash, day: FIXTURE_START_PICKER_DAY_WIRE });
  try {
    await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=spreadsheets`);
    await page.getByRole("listitem", { name: "Status board.xlsx", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preview", exact: true }), "Preview region of Status board.xlsx").toBeVisible();
    await expect(page.getByText("Fixture review", { exact: true }), "cell Fixture review").toBeVisible();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `spreadsheet-fills-${theme}-${width}.png`) });
  } finally { await page.goto("about:blank"); await server.close(); }
});
