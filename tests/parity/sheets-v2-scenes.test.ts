import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Design lane renders (never merged): Spreadsheets page v2. SHEETS_V2_OUT=<folder> SHEETS_V2_ONLY=<frame ids, default all>
const OUT = process.env.SHEETS_V2_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-spreadsheets/screens-v2";
const ONLY = process.env.SHEETS_V2_ONLY?.split(",");
const file = { name: "Contacts export.xlsx", mimeType: "text/csv", buffer: Buffer.from("Employee ID,Full name\n10482917,Example Person") };

for (const theme of ["light", "dark"] as const) {
  test(`sheets v2 scenes @ ${theme} 1280x720`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.log(`PAGEERROR ${error.message.slice(0, 300)}`); });
    mkdirSync(OUT, { recursive: true });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
    const shot = async (id: string) => { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${theme}-1280-${id}.png`) }); };
    // Whole dashboard at 1280x720; when the page scrolls inside the dashboard, a second `-more` frame shows the end.
    const shotPage = async (id: string) => {
      await shot(id);
      const scrolled = await page.getByRole("region", { name: "Spreadsheets", exact: true }).evaluate(element => {
        for (let node: Element | null = element; node instanceof HTMLElement; node = node.parentElement) {
          if (node.scrollHeight > node.clientHeight + 2 && /auto|scroll/u.test(getComputedStyle(node).overflowY)) { node.scrollTop = node.scrollHeight; return true; }
        }
        return false;
      });
      if (scrolled) await shot(`${id}-more`);
    };
    const open = async (query: Record<string, string> = {}) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: "spreadsheets", relaySheetsDesign: "v2", ...query })}`);
      await expect(page.getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();
    };
    const dialog = () => page.getByRole("dialog").first();
    const menu = async (name: string, item?: string) => { await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click(); if (item) await page.getByRole("menuitem", { name: item, exact: true }).click(); };
    const openSheet = async (name: string) => { await page.getByRole("row", { name, exact: true }).getByRole("cell").first().click(); await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible(); };
    const scenes: Record<string, () => Promise<void>> = {
      list: async () => { await open(); await shotPage("list"); },
      "list-filter": async () => {
        await open(); await page.getByRole("button", { name: "Filter by tag", exact: true }).click(); await page.getByRole("menuitemcheckbox", { name: "HR", exact: true }).click(); await shot("list-filter-menu");
        await page.keyboard.press("Escape"); await expect(page.getByRole("row", { name: "I-9 tracker", exact: true })).toHaveCount(0); await shotPage("list-filter");
      },
      menu: async () => { await open(); await menu("Contact roster"); await shot("menu-sharepoint"); await page.keyboard.press("Escape"); await menu("I-9 tracker"); await shot("menu-created"); },
      many: async () => {
        await open({ relaySheetsScenario: "many" }); await shotPage("many");
        await page.getByRole("button", { name: /^Show \d+ more$/u }).click(); await shotPage("many-expanded");
      },
      empty: async () => { await open({ relaySheetsScenario: "empty" }); await shotPage("empty"); },
      detail: async () => { await open(); await openSheet("Contact roster"); await shotPage("detail"); },
      "detail-picker": async () => { await open(); await openSheet("Contact roster"); await page.getByRole("button", { name: "Legal name column", exact: true }).click(); await shot("detail-picker"); },
      "detail-columns": async () => { await open(); await openSheet("Contact roster"); await page.getByRole("button", { name: "Columns", exact: true }).click(); await shot("detail-columns"); },
      "detail-range": async () => {
        await open(); await openSheet("Contact roster"); const cells = page.locator("tbody td"), from = (await cells.nth(2).boundingBox())!, to = (await cells.nth(10).boundingBox())!;
        await page.mouse.move(from.x + 8, from.y + 8); await page.mouse.down(); await page.mouse.move(to.x + 8, to.y + 8, { steps: 4 }); await page.mouse.up();
        await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible(); await shotPage("detail-range");
      },
      "import-file": async () => {
        await open(); await page.getByRole("button", { name: "Import", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("import-file-empty");
        await dialog().locator('input[type="file"]').setInputFiles(file); await dialog().getByRole("textbox", { name: "Add a tag" }).fill("HR"); await page.keyboard.press("Enter"); await shot("import-file");
      },
      "import-columns": async () => {
        await open(); await page.getByRole("button", { name: "Import", exact: true }).click(); await dialog().locator('input[type="file"]').setInputFiles(file);
        await dialog().getByRole("button", { name: "Next", exact: true }).click(); await expect(dialog().getByText("Step 2 of 2")).toBeVisible(); await shot("import-columns");
        await dialog().getByRole("button", { name: "Add to library", exact: true }).click(); await expect(dialog()).toHaveCount(0); await expect(page.getByRole("row", { name: "Contacts export", exact: true })).toBeVisible(); await shotPage("import-added");
      },
      link: async () => {
        await open(); await menu("I-9 tracker", "Link to SharePoint…"); await dialog().getByRole("textbox", { name: "Workbook link" }).fill("https://example.sharepoint.com/sites/hr/i9.xlsx"); await shot("link");
        await dialog().getByRole("button", { name: "Link", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shotPage("link-done");
      },
      merge: async () => {
        await open(); await menu("I-9 tracker", "Merge into…"); await dialog().getByRole("button", { name: "Target spreadsheet", exact: true }).click(); await page.getByRole("menuitemradio", { name: "Student applicants", exact: true }).click(); await expect(page.getByRole("menuitemradio")).toHaveCount(0); await shot("merge");
        await dialog().getByRole("button", { name: "Merge", exact: true }).click(); await expect(dialog()).toHaveCount(0);
      },
      rollback: async () => {
        await open(); await page.getByRole("button", { name: "Versions of Contact roster, now v6", exact: true }).click(); await dialog().getByRole("radio", { name: /^v3 /u }).click(); await shot("rollback");
        await dialog().getByRole("button", { name: "Roll back", exact: true }).click(); await expect(page.getByRole("button", { name: "Versions of Contact roster, now v7", exact: true })).toBeVisible();
      },
      clone: async () => { await open(); await menu("Contact roster", "Clone"); await expect(page.getByRole("row", { name: "Contact roster copy", exact: true })).toBeVisible(); await menu("EC51820377", "Clone"); await expect(page.getByRole("row", { name: "EC51820377 copy", exact: true })).toBeVisible(); await shotPage("clone"); },
      delete: async () => {
        await open(); await menu("Contact roster", "Delete"); await expect(dialog().getByText("Delete Contact roster?")).toBeVisible(); await shot("delete");
        await dialog().getByRole("button", { name: "Delete", exact: true }).click(); await expect(page.getByRole("row", { name: "Contact roster", exact: true })).toHaveCount(0);
      },
      "sync-failed": async () => { await open({ relaySheetsScenario: "all", relaySheetsSync: "failed" }); await page.waitForTimeout(600); await shot("sync-failed"); },
    };
    try { for (const [id, run] of Object.entries(scenes)) if (ONLY === undefined || ONLY.includes(id)) await run(); }
    finally { await server.close(); }
    expect(errors).toEqual([]);
  });
}
