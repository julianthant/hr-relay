import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { SYNC_THEMES, SYNC_WIDTHS } from "./helpers/sheets-sync-status-scenes.js";

// Spreadsheets sync-status frames in the parity mock harness; frames are evidence for the operator, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, "tests/mocks/.output/sheets-sync-status-fixture");
const OUT = process.env.SHEETS_SYNC_STATUS_MOCK_OUT;
if (OUT === undefined) throw new Error("SHEETS_SYNC_STATUS_MOCK_OUT must name the frame output folder");

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Sheets sync status</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountSyncStatusScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/sheets-sync-status-scenes.tsx"))};\nimport "./style.css";\nmountSyncStatusScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n@source ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/sheets-sync-status-scenes.tsx"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("sheets-sync-status-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of SYNC_THEMES) for (const width of SYNC_WIDTHS) test(`sync status frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${baseUrl}/?theme=${theme}${width === 1024 ? "&narrow=1" : ""}`);

  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(6);
  // Every state is shown beside the SharePoint link; the local-only row has none.
  await expect(page.locator('[data-sync="idle"]')).toHaveCount(2);
  await expect(page.locator('[data-sync="running"]')).toContainText("Syncing…");
  await expect(page.locator('[data-sync="failed"]')).toContainText("Sync failed");
  await expect(page.locator('[data-sync="never"]')).toContainText("Not synced yet");
  await expect(rows.nth(5).locator("[data-sync]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "horizontal overflow").toBe(false);
  await page.screenshot({ path: join(OUT, `rows-${theme}-${width}.png`) });

  // Retry sync is in the failed row's menu only.
  await page.getByRole("button", { name: /^Actions for Work study awards/ }).click();
  await expect(page.getByRole("menuitem", { name: "Retry sync" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sync now" })).toHaveCount(0);
  await page.screenshot({ path: join(OUT, `failed-menu-${theme}-${width}.png`) });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Actions for Onboarding roster/ }).click();
  await expect(page.getByRole("menuitem", { name: "Sync now" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Retry sync" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
