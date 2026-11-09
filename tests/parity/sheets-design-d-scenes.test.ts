import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Design lane renders (never merged): variant D scenes. SHEETS_DESIGN_OUT=<folder> SHEETS_DESIGN_ONLY=<frame ids, default all>
const OUT = process.env.SHEETS_DESIGN_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-spreadsheets/screens";
const ONLY = process.env.SHEETS_DESIGN_ONLY?.split(",");
const file = { name: "Example contacts export.xlsx", mimeType: "text/csv", buffer: Buffer.from("Employee ID,Full name\n10482917,Example Person") };

test("sheets design D scenes @ light 1280x720", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("pageerror", error => console.log(`PAGEERROR ${error.message.slice(0, 300)}`));
  mkdirSync(OUT, { recursive: true });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.addInitScript(() => { Reflect.set(window, "relayParityTheme", "light"); });
  // Every frame is the whole dashboard at 1280x720; a long page is scrolled inside the dashboard, never cropped.
  const shot = async (id: string) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `light-1280-${id}.png`) }); };
  const open = async (query: Record<string, string>) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: "spreadsheets", relaySheetsDesign: "d", ...query })}`);
    await expect(page.getByRole("region", { name: "Spreadsheets", exact: true }).getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();
  };
  const section = (name: string) => page.getByRole("heading", { name, exact: true });
  const scrollTo = async (name: string) => { await section(name).evaluate(element => element.scrollIntoView({ block: "start" })); };
  const library = () => page.getByRole("table", { name: "Library", exact: true });
  const dialog = () => page.getByRole("dialog").first();
  const rowMenu = async (name: string, item: string) => { await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click(); await page.getByRole("menuitem", { name: item, exact: true }).click(); };
  const scenes: Record<string, () => Promise<void>> = {
    "d-all": async () => { await open({ relaySheetsScenario: "all" }); await shot("d-all"); await scrollTo("Results"); await shot("d-all-results"); },
    "d-many": async () => { await open({ relaySheetsScenario: "many" }); await shot("d-many"); await scrollTo("Results"); await shot("d-many-results"); },
    "d-many-earlier": async () => {
      await open({ relaySheetsScenario: "many" }); await scrollTo("Results");
      await page.getByRole("button", { name: "Actions for Emergency contacts 0412.xlsx", exact: true }).click(); await shot("d-many-results-menu");
      await page.getByRole("menuitem", { name: "Earlier results (2)", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("d-many-earlier-results");
    },
    "drawer": async () => { await open({ relaySheetsScenario: "all" }); await library().getByText("Example contact roster.xlsx", { exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("drawer"); },
    "fix-columns": async () => {
      await open({ relaySheetsScenario: "all" }); await library().getByText("Example I-9 actions.csv", { exact: true }).click(); await expect(dialog()).toBeVisible();
      await shot("fix-columns-before"); await dialog().getByRole("combobox", { name: "Name column", exact: true }).click(); await page.getByRole("option", { name: "Employee", exact: true }).click(); await shot("fix-columns");
      await dialog().getByRole("button", { name: "Save columns", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shot("fix-columns-after");
    },
    "import-1-file": async () => {
      await open({ relaySheetsScenario: "all", relaySheetsMissing: "ocr-roster" }); await shot("library-without-ocr");
      await page.getByRole("button", { name: "Import spreadsheet", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("import-1-file");
      await dialog().locator('input[type="file"]').setInputFiles(file); await expect(dialog().getByText("Check the columns")).toBeVisible(); await shot("import-2-columns");
      await dialog().getByRole("button", { name: "Import spreadsheet", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shot("import-3-done");
    },
    "replace-1-file": async () => {
      await open({ relaySheetsScenario: "all" }); await rowMenu("Example contact roster.xlsx", "Replace"); await expect(dialog()).toBeVisible(); await shot("replace-1-file");
      await dialog().locator('input[type="file"]').setInputFiles(file); await shot("replace-2-check");
      await dialog().getByRole("button", { name: "Replace file", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shot("replace-3-done");
    },
    "versions-use": async () => {
      await open({ relaySheetsScenario: "all" }); await rowMenu("Example contact roster.xlsx", "Versions");
      await page.getByRole("dialog", { name: "Versions", exact: true }).getByRole("button", { name: "Use", exact: true }).first().click();
      await expect(page.getByRole("dialog", { name: "Use this version?", exact: true })).toBeVisible(); await shot("versions-use");
    },
    "library-remove": async () => {
      await open({ relaySheetsScenario: "all" });
      await page.getByRole("checkbox", { name: "Select Example student applicants.xlsx" }).check(); await page.getByRole("checkbox", { name: "Select Example parking permits.csv" }).check();
      await page.getByRole("button", { name: "Remove", exact: true }).click(); await shot("library-remove");
    },
    "sync-ok": async () => { await open({ relaySheetsScenario: "all", relaySheetsSync: "ok" }); await shot("sync-ok"); },
    "sync-failed": async () => { await open({ relaySheetsScenario: "all", relaySheetsSync: "failed" }); await page.waitForTimeout(600); await shot("sync-failed"); },
    "empty": async () => { await open({ relaySheetsScenario: "empty" }); await shot("empty"); },
  };
  try { for (const [id, run] of Object.entries(scenes)) if (ONLY === undefined || ONLY.includes(id)) await run(); }
  finally { await server.close(); }
});
