import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Design lane renders (never merged): SHEETS_DESIGN_OUT=<folder> SHEETS_DESIGN_THEME=light|dark SHEETS_DESIGN_WIDTH=1440|1024 SHEETS_DESIGN_VARIANTS=a,b,c
const OUT = process.env.SHEETS_DESIGN_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-spreadsheets/screens";
const THEME = { attribute: process.env.SHEETS_DESIGN_THEME === "dark" ? "dark" : "light" };
const WIDTH = Number(process.env.SHEETS_DESIGN_WIDTH ?? 1440);
const VARIANTS = (process.env.SHEETS_DESIGN_VARIANTS ?? "a,b,c").split(",");
const SCENARIOS = ["empty", "all", "missing", "many"] as const;

const url = (base: string, query: Record<string, string>) => `${base}/?settings=spreadsheets&${new URLSearchParams(query)}`;
const ready = async (page: Page) => expect(page.getByRole("region", { name: "Spreadsheets", exact: true }).getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();

test(`sheets design renders @ ${THEME.attribute} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  page.on("pageerror", error => console.log(`PAGEERROR ${error.message.slice(0, 300)}`));
  mkdirSync(OUT, { recursive: true });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const shot = async (id: string, dialog?: ReturnType<Page["getByRole"]>) => { await page.waitForTimeout(400); await (dialog ?? page).screenshot({ path: join(OUT, `${THEME.attribute}-${WIDTH}-${id}.png`) }); };
  try {
    await page.addInitScript(attribute => { Reflect.set(window, "relayParityTheme", attribute); }, THEME.attribute);
    for (const variant of VARIANTS) for (const scenario of SCENARIOS) {
      await page.setViewportSize({ width: WIDTH, height: scenario === "many" ? 2400 : 1300 });
      await page.goto(url(server.baseUrl, { relaySheetsDesign: variant, relaySheetsScenario: scenario }));
      await ready(page);
      await shot(`${variant}-${scenario}`);
    }
    // Import flow, variant A chrome, library with one reference missing.
    await page.setViewportSize({ width: WIDTH, height: 900 });
    for (const step of ["pick", "purpose", "columns"]) {
      await page.goto(url(server.baseUrl, { relaySheetsDesign: "a", relaySheetsScenario: "missing", relaySheetsStep: step }));
      const dialog = page.getByRole("dialog").first(); await expect(dialog).toBeVisible();
      await shot(`import-${step}`, dialog);
    }
    // 11-02 capabilities stay reachable: versions drawer from a reference card.
    for (const variant of VARIANTS) {
      await page.goto(url(server.baseUrl, { relaySheetsDesign: variant, relaySheetsScenario: "all" }));
      await ready(page);
      await page.getByRole("button", { name: "Actions for Example contact roster.xlsx" }).first().click();
      await page.getByRole("menuitem", { name: "Versions" }).click();
      const drawer = page.getByRole("dialog", { name: "Versions", exact: true }); await expect(drawer).toBeVisible();
      await shot(`${variant}-versions`, drawer);
    }
  } finally { await server.close(); }
});
