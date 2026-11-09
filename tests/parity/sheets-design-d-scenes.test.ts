import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Design lane renders (never merged): variant D scenes. SHEETS_DESIGN_OUT=<folder> SHEETS_DESIGN_ONLY=<frame ids, default all>
const OUT = process.env.SHEETS_DESIGN_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-spreadsheets/screens";
const ONLY = process.env.SHEETS_DESIGN_ONLY?.split(",");
const file = { name: "Example contacts export.xlsx", mimeType: "text/csv", buffer: Buffer.from("Employee ID,Full name\n10482917,Example Person") };

test("sheets design D scenes @ light 1440", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("pageerror", error => console.log(`PAGEERROR ${error.message.slice(0, 300)}`));
  mkdirSync(OUT, { recursive: true });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.addInitScript(() => { Reflect.set(window, "relayParityTheme", "light"); });
  const shot = async (id: string, target?: Locator) => { await page.waitForTimeout(500); await (target ?? page).screenshot({ path: join(OUT, `light-1440-${id}.png`) }); };
  const open = async (query: Record<string, string>, height = 1000) => {
    await page.setViewportSize({ width: 1440, height });
    await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: "spreadsheets", relaySheetsDesign: "d", ...query })}`);
    await expect(page.getByRole("region", { name: "Spreadsheets", exact: true }).getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();
  };
  const dialog = () => page.getByRole("dialog").first();
  const rowMenu = async (name: string, item: string) => { await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click(); await page.getByRole("menuitem", { name: item, exact: true }).click(); };
  const scenes: Record<string, () => Promise<void>> = {
    "d-all": async () => { await open({ relaySheetsScenario: "all" }); await shot("d1-all"); },
    "d2-all": async () => { await open({ relaySheetsScenario: "all", relaySheetsProblem: "d2" }); await shot("d2-all"); },
    "d-many": async () => { await open({ relaySheetsScenario: "many" }, 2000); await shot("d-many"); },
    "d-many-expanded": async () => { await open({ relaySheetsScenario: "many" }, 2000); await page.getByRole("button", { name: "2 earlier results", exact: true }).click(); await shot("d-many-expanded"); },
    "drawer": async () => { await open({ relaySheetsScenario: "all" }); await page.getByRole("button", { name: "OCR roster", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("drawer", dialog()); },
    "fix-columns": async () => {
      await open({ relaySheetsScenario: "all" }); await page.getByRole("button", { name: "I-9 action history", exact: true }).click(); await expect(dialog()).toBeVisible();
      await dialog().getByLabel("Sheet columns").getByText("Employee", { exact: true }).click(); await shot("fix-columns", dialog());
      await dialog().getByRole("button", { name: "Save columns", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shot("fix-columns-after");
    },
    "import-1-file": async () => {
      await open({ relaySheetsScenario: "all", relaySheetsMissing: "ocr-roster" }); await shot("missing-ocr");
      await page.getByRole("button", { name: "Import a roster", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("import-1-file", dialog());
      await dialog().locator('input[type="file"]').setInputFiles(file); await expect(dialog().getByText("What is this for?")).toBeVisible(); await shot("import-2-purpose", dialog());
      await dialog().getByRole("button", { name: "Next", exact: true }).click(); await shot("import-3-columns", dialog());
      await dialog().getByRole("button", { name: /^Import OCR roster$/ }).click(); await expect(dialog()).toHaveCount(0); await shot("import-4-done");
    },
    "replace-1-file": async () => {
      await open({ relaySheetsScenario: "all" }); await rowMenu("Example contact roster.xlsx", "Replace"); await expect(dialog()).toBeVisible(); await shot("replace-1-file", dialog());
      await dialog().locator('input[type="file"]').setInputFiles(file); await shot("replace-2-check", dialog());
      await dialog().getByRole("button", { name: "Replace file", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shot("replace-3-done");
    },
    "versions-use": async () => {
      await open({ relaySheetsScenario: "all" }); await rowMenu("Example contact roster.xlsx", "Versions");
      await page.getByRole("dialog", { name: "Versions", exact: true }).getByRole("button", { name: "Use", exact: true }).first().click();
      await shot("versions-use", page.getByRole("dialog", { name: "Use this version?", exact: true }));
    },
    "other-merge": async () => {
      await open({ relaySheetsScenario: "many" }, 1400);
      await page.getByRole("checkbox", { name: "Select Example student applicants.xlsx" }).check(); await page.getByRole("checkbox", { name: "Select Example parking permits.csv" }).check();
      await page.getByRole("button", { name: "Merge", exact: true }).click(); await shot("other-merge", dialog()); await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Remove", exact: true }).click(); await shot("other-remove", dialog());
    },
    "sync-ok": async () => { await open({ relaySheetsScenario: "many", relaySheetsSync: "ok" }, 1800); await shot("sync-ok"); },
    "sync-failed": async () => { await open({ relaySheetsScenario: "many", relaySheetsSync: "failed" }, 1800); await page.waitForTimeout(600); await shot("sync-failed"); },
    "empty": async () => { await open({ relaySheetsScenario: "empty" }); await shot("empty"); },
  };
  try { for (const [id, run] of Object.entries(scenes)) if (ONLY === undefined || ONLY.includes(id)) await run(); }
  finally { await server.close(); }
});
