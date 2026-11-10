import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Design lane renders (never merged): Spreadsheets page v2. SHEETS_V2_OUT=<folder> SHEETS_V2_ONLY=<frame ids, default all>
const OUT = process.env.SHEETS_V2_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-spreadsheets/screens-v2";
const ONLY = process.env.SHEETS_V2_ONLY?.split(",");
const file = { name: "Contacts export.xlsx", mimeType: "text/csv", buffer: Buffer.from("Employee ID,Full name\n10000006,Example Person") };

for (const theme of ["light", "dark"] as const) {
  test(`sheets v2 scenes @ ${theme} 1280x720`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.log(`PAGEERROR ${error.message.slice(0, 300)}`); });
    page.setDefaultTimeout(10_000);
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
      await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: "spreadsheets", statusMock: "general-a", ...query })}`);
      await expect(page.getByRole("heading", { name: "Spreadsheets", exact: true })).toBeVisible();
    };
    const dialog = () => page.getByRole("dialog").first();
    const menu = async (name: string, item?: string) => { await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click(); if (item) await page.getByRole("menuitem", { name: item, exact: true }).click(); };
    const openSheet = async (name: string) => { await page.getByRole("listitem", { name, exact: true }).locator("span").first().click(); await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible(); };
    const scenes: Record<string, () => Promise<void>> = {
      list: async () => { await open(); await shotPage("list"); },
      "list-filter": async () => {
        await open(); await page.getByRole("button", { name: "Filter by tag", exact: true }).click(); await page.getByRole("menuitemcheckbox", { name: "HR", exact: true }).click(); await shot("list-filter-menu");
        await page.keyboard.press("Escape"); await expect(page.getByRole("listitem", { name: "I-9 tracker", exact: true })).toHaveCount(0); await shotPage("list-filter");
      },
      "list-search": async () => { await open(); await page.getByRole("searchbox", { name: "Search spreadsheets" }).fill("roster"); await expect(page.getByRole("listitem", { name: "I-9 tracker", exact: true })).toHaveCount(0); await shot("list-search"); },
      "list-tags-menu": async () => {
        await open(); await page.getByRole("button", { name: "Filter by tag", exact: true }).click(); await expect(page.getByRole("searchbox", { name: "Find a tag" })).toBeVisible(); await shot("list-tags-menu");
        await page.getByRole("searchbox", { name: "Find a tag" }).fill("f"); await shot("list-tags-menu-search");
      },
      "list-tags": async () => { await open(); await page.getByRole("button", { name: /^\d+ more tags/u }).first().hover(); await expect(page.getByRole("tooltip")).toBeVisible(); await shot("list-tags-tooltip"); },
      menu: async () => { await open(); await menu("Contact roster"); await shot("menu-sharepoint"); await page.keyboard.press("Escape"); await menu("I-9 tracker"); await shot("menu-created"); },
      many: async () => {
        await open({ relaySheetsScenario: "many" }); await shotPage("many");
        await page.getByRole("button", { name: /^Show \d+ more$/u }).click(); await shotPage("many-expanded");
      },
      empty: async () => { await open({ relaySheetsScenario: "empty" }); await shotPage("empty"); },
      detail: async () => { await open(); await openSheet("Contact roster"); await shotPage("detail"); },
      "detail-toolbar": async () => { await open(); await openSheet("Contact roster"); await expect(page.getByRole("button", { name: "Worksheet", exact: true })).toContainText("Roster"); await expect(page.getByRole("button", { name: "Columns" })).toBeVisible(); await expect(page.getByRole("button", { name: /^Employee ID column/u })).toHaveCount(0); await shot("detail-toolbar"); },
      "detail-search": async () => {
        await open(); await openSheet("Contact roster"); await page.getByRole("searchbox", { name: "Search this sheet" }).fill("person1"); await expect(page.locator("mark").first()).toBeVisible(); await shot("detail-search");
      },
      "detail-worksheets": async () => {
        await open(); await openSheet("Contact roster"); await expect(page.getByRole("tab")).toHaveCount(0); await page.getByRole("button", { name: "Worksheet", exact: true }).click();
        await expect(page.getByRole("menuitemradio", { name: /^Roster/u })).not.toContainText("Runs"); await expect(page.getByText("Use for runs")).toHaveCount(0); await shot("detail-worksheets");
        await page.getByRole("menuitemradio", { name: /^Terminated/u }).click(); await expect(page.getByText(/View only/u)).toHaveCount(0); await expect(page.getByRole("button", { name: "Worksheet", exact: true })).toContainText("Terminated"); await shot("detail-sheet-terminated");
      },
      "detail-columns": async () => {
        await open(); await openSheet("Contact roster"); await page.getByRole("button", { name: "Columns" }).click(); await expect(page.getByRole("region", { name: "Fields" })).toBeVisible(); await expect(page.getByRole("region", { name: "Show columns" })).toBeVisible(); await shot("detail-columns");
        await page.getByRole("button", { name: /^Name column/u }).click(); await expect(page.getByRole("menuitemradio", { name: /^Full name/u })).toBeVisible(); await shot("detail-columns-pick"); await page.keyboard.press("Escape"); await expect(page.getByRole("menuitemradio", { name: /^Full name/u })).toHaveCount(0); await expect(page.getByRole("region", { name: "Fields" })).toBeVisible();
        await page.getByRole("button", { name: /^Employee ID column/u }).hover(); await shot("detail-columns-hover");
      },
      "detail-unmapped": async () => {
        await open(); await openSheet("Onboarding hires"); await expect(page.getByRole("button", { name: "Worksheet", exact: true })).toContainText("Aug 3 hires");
        await page.getByRole("button", { name: "Worksheet", exact: true }).click(); await expect(page.getByRole("menuitemradio", { name: /^Aug 17 hires/u })).toContainText("Employee ID not matched");
        await expect(page.getByRole("menuitemradio", { name: /^Aug 3 hires/u })).not.toContainText("not matched"); await shot("detail-worksheets-matched");
        await page.getByRole("menuitemradio", { name: /^Aug 17 hires/u }).click();
        const columns = page.getByRole("button", { name: "Columns" }); await columns.hover(); await expect(page.getByRole("tooltip")).toContainText("Employee ID isn't mapped"); await shot("detail-unmapped");
        await columns.click(); const pill = page.getByRole("button", { name: /^Employee ID column/u }); await expect(pill).toContainText("Choose column"); await shot("detail-unmapped-open");
        await pill.click(); await shot("detail-unmapped-pick");
        await page.getByRole("menuitemradio", { name: /^Emp #/u }).click(); await expect(pill).toContainText("Emp #"); await page.mouse.move(0, 0); await shot("detail-mapped");
        await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Worksheet", exact: true }).click(); await expect(page.getByText("not matched")).toHaveCount(0);
      },
      "detail-range": async () => {
        await open(); await openSheet("Contact roster"); const cells = page.locator("tbody td"), from = (await cells.nth(2).boundingBox())!, to = (await cells.nth(10).boundingBox())!;
        await page.mouse.move(from.x + 8, from.y + 8); await page.mouse.down(); await page.mouse.move(to.x + 8, to.y + 8, { steps: 4 }); await page.mouse.up();
        await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible(); await shotPage("detail-range");
      },
      "import-file": async () => {
        await open(); await page.getByRole("button", { name: "Import", exact: true }).click(); await expect(dialog()).toBeVisible(); await shot("import-file-empty");
        await dialog().locator('input[type="file"]').setInputFiles(file); await dialog().getByRole("textbox", { name: "Add a tag" }).fill("HR"); await page.keyboard.press("Enter"); await shot("import-file");
        await dialog().getByText("SharePoint", { exact: true }).click(); await expect(dialog().getByRole("button", { name: "Choose file" })).toHaveCount(0); await dialog().getByRole("textbox", { name: "SharePoint workbook link" }).fill("https://example.sharepoint.com/sites/hr/x.xlsx"); await shot("import-sharepoint");
      },
      "code-link": async () => {
        await open(); await page.getByRole("button", { name: "EC51820377, open run logs", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0); await shot("code-link");
      },
      "import-columns": async () => {
        await open(); await page.getByRole("button", { name: "Import", exact: true }).click(); await dialog().locator('input[type="file"]').setInputFiles(file);
        await dialog().getByRole("button", { name: "Next", exact: true }).click(); await expect(dialog().getByRole("button", { name: "Back", exact: true })).toBeVisible(); await shot("import-columns");
        await page.getByRole("button", { name: "Columns" }).click(); await expect(page.getByRole("region", { name: "Fields" })).toBeVisible(); const pill = page.getByRole("button", { name: /^Work email column/u }); await expect(pill).toContainText("Choose column");
        await page.keyboard.press("Escape"); await expect(page.getByRole("region", { name: "Fields" })).toHaveCount(0); await shot("import-columns-closed");
        await dialog().getByRole("button", { name: "Worksheet", exact: true }).click(); await shot("import-worksheets"); await page.getByRole("menuitemradio", { name: /^Archive/u }).click(); await shot("import-sheet-archive");
        await dialog().getByRole("button", { name: "Worksheet", exact: true }).click(); await page.getByRole("menuitemradio", { name: /^Contacts/u }).click();
        if (await page.getByRole("region", { name: "Fields" }).isVisible()) await page.keyboard.press("Escape");
        await dialog().getByRole("button", { name: "Add to library", exact: true }).click(); await expect(dialog()).toHaveCount(0); await expect(page.getByRole("listitem", { name: "Contacts export", exact: true })).toBeVisible(); await shotPage("import-added");
      },
      link: async () => {
        await open(); await menu("I-9 tracker", "Link to SharePoint…"); await dialog().getByRole("textbox", { name: "Workbook link" }).fill("https://example.sharepoint.com/sites/hr/i9.xlsx"); await shot("link");
        await dialog().getByRole("button", { name: "Link", exact: true }).click(); await expect(dialog()).toHaveCount(0); await shotPage("link-done");
      },
      "menu-run": async () => {
        await open(); await menu("PL33065442"); await expect(page.getByRole("menuitem", { name: "Merge into I-9 tracker", exact: true })).toBeVisible(); await shot("menu-run-merge"); await page.keyboard.press("Escape");
        await menu("EC51820377"); await expect(page.getByRole("menuitem", { name: /^Merge/u })).toHaveCount(0); await shot("menu-run-sharepoint"); await page.keyboard.press("Escape");
        await menu("I-9 tracker"); await expect(page.getByRole("menuitem", { name: /^Merge/u })).toHaveCount(0);
      },
      merge: async () => {
        await open(); await menu("PL33065442", "Merge into I-9 tracker"); await expect(dialog().getByText("Merge PL33065442 into I-9 tracker?")).toBeVisible(); await expect(dialog().getByText("12 added · 3 updated.", { exact: false })).toBeVisible(); await shot("merge");
        await dialog().getByRole("button", { name: "Merge", exact: true }).click(); await expect(dialog()).toHaveCount(0); await expect(page.getByRole("listitem", { name: "PL33065442", exact: true })).toHaveCount(1);
        await page.getByRole("button", { name: "Versions of I-9 tracker, now v4", exact: true }).click(); await expect(dialog().getByRole("radio", { name: /Merged from PL33065442/u })).toBeVisible(); await shot("rollback-merged");
      },
      "merge-delete": async () => {
        await open(); await menu("PL33065442", "Merge and delete"); await expect(dialog().getByText("PL33065442 is deleted after the merge.")).toBeVisible(); await shot("merge-delete");
        await dialog().getByRole("button", { name: "Merge and delete", exact: true }).click(); await expect(page.getByRole("listitem", { name: "PL33065442", exact: true })).toHaveCount(0); await shotPage("merge-delete-done");
      },
      rollback: async () => {
        await open(); await page.getByRole("button", { name: "Versions of Contact roster, now v6", exact: true }).click(); await dialog().getByRole("radio", { name: /^v3 /u }).click(); await shot("rollback");
        await dialog().getByRole("button", { name: "Roll back", exact: true }).click(); await expect(dialog().getByText("Roll back to v3?")).toBeVisible(); await shot("rollback-confirm");
        await dialog().getByRole("button", { name: "Roll back", exact: true }).click(); await expect(page.getByRole("button", { name: "Versions of Contact roster, now v7", exact: true })).toBeVisible();
      },
      clone: async () => { await open(); await menu("Contact roster", "Clone"); await expect(page.getByRole("listitem", { name: "Contact roster copy", exact: true })).toBeVisible(); await expect(page.getByRole("menuitem")).toHaveCount(0); await menu("EC51820377", "Clone"); await expect(page.getByRole("listitem", { name: "EC51820377 copy", exact: true })).toBeVisible(); await shotPage("clone"); },
      delete: async () => {
        await open(); await menu("Contact roster", "Delete"); await expect(dialog().getByText("Delete Contact roster?")).toBeVisible(); await shot("delete");
        await dialog().getByRole("button", { name: "Delete spreadsheet", exact: true }).click(); await expect(page.getByRole("listitem", { name: "Contact roster", exact: true })).toHaveCount(0);
      },
      "sync-failed": async () => { await open({ relaySheetsScenario: "all", relaySheetsSync: "failed" }); await page.waitForTimeout(600); await shot("sync-failed"); },
    };
    try { for (const [id, run] of Object.entries(scenes)) if (ONLY === undefined || ONLY.includes(id)) await run(); }
    finally { await server.close(); }
    expect(errors).toEqual([]);
  });
}
