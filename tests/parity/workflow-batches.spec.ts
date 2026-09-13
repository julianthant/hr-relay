import { expect,test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied,installTheme,PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY,uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";

for (const theme of ["light", "dark"] as const) {
  test(`workflow batches: grouped and separate, ${theme}`, async ({ page }, testInfo) => {
    ensureParityBundle();
    await page.setViewportSize({ width: 1440, height: 900 });
    const chosen = FIXTURE_DAY_WIRE.queueSurfaces.filter((row) => row.containment === "root" && (row.surfaceKind === "single" || row.surfaceKind === "preview")).slice(0, 3);
    expect(chosen).toHaveLength(3);
    const ids = new Set(chosen.map((row) => row.runId));
    for (const grouped of [true, false]) {
      const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,
        queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => ids.has(row.runId) ? { ...row,
          session: { state: "present", sessionId: uuidOf(700), presentation: { groupInQueue: grouped, version: 4, startedAt: chosen[0].startedAt } },
        } : row),
      });
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
      try {
        const palette = PARITY_THEMES.find((entry) => entry.attribute === theme);
        if (palette === undefined) throw new Error("missing parity theme");
        await installTheme(page, palette);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
        await assertThemeApplied(page, palette);
        await page.getByRole("button", { name: "Minimise the Workflow Panel to an icon", exact: true }).click();
        const queue = page.getByRole("region", { name: "Queue", exact: true });
        const batch = queue.locator('section[aria-label$=" batch"]');
        if (grouped) {
          await expect(batch).toHaveCount(1);
          const disclosure = batch.getByRole("button", { name: /3 items/u });
          await disclosure.focus();
          await page.keyboard.press("Enter");
          await expect(disclosure).toHaveAttribute("aria-expanded", "true");
          for (const row of chosen) await expect(batch.getByText(row.title, { exact: true }).first()).toBeVisible();
        } else {
          await expect(batch).toHaveCount(0);
          await expect(queue.getByRole("button", { name: "Group batch · 3 items", exact: true })).toBeVisible();
          for (const row of chosen) await expect(queue.getByText(row.title, { exact: true }).first()).toBeVisible();
        }
        const screenshot = testInfo.outputPath(`${theme}-${grouped ? "grouped" : "separate"}.png`);
        await queue.screenshot({ path: screenshot });
        await testInfo.attach(`${theme} ${grouped ? "grouped" : "separate"}`, { path: screenshot, contentType: "image/png" });
        const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/commands"));
        await queue.getByRole("button", { name: grouped ? "Show separately" : "Group batch · 3 items", exact: true }).click();
        const request = await requestPromise;
        expect(request.postDataJSON()).toMatchObject({ family: "workflow-batch", type: "set-batch-grouping", target: { batchId: uuidOf(700), expectedVersion: 4 }, payload: { groupInQueue: !grouped } });
      } finally { await server.close(); }
    }
  });
}
