import { expect, test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";

for (const theme of ["light", "dark"] as const) {
  test(`workflow batches: separate rows for either served preference, ${theme}`, async ({ page }, testInfo) => {
    ensureParityBundle();
    await page.setViewportSize({ width: 1440, height: 900 });
    const chosen = FIXTURE_DAY_WIRE.queueSurfaces.filter((row) => row.containment === "root" && (row.surfaceKind === "single" || row.surfaceKind === "preview")).slice(0, 3);
    expect(chosen).toHaveLength(3);
    const ids = new Set(chosen.map((row) => row.runId));
    for (const grouped of [true, false]) {
      const requests: string[] = [];
      const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,
        queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => ids.has(row.runId) ? { ...row,
          session: { state: "present", sessionId: uuidOf(700), presentation: { groupInQueue: grouped, version: 4, startedAt: chosen[0].startedAt } },
        } : row),
      });
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
      const onRequest = (request: import("@playwright/test").Request) => { if (request.method() === "POST" && request.url().includes("/commands")) requests.push(request.url()); };
      page.on("request", onRequest);
      try {
        const palette = PARITY_THEMES.find((entry) => entry.attribute === theme);
        if (palette === undefined) throw new Error("missing parity theme");
        await installTheme(page, palette);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
        await assertThemeApplied(page, palette);
        await page.getByRole("button", { name: "Minimise the Workflow Panel to an icon", exact: true }).click();
        const queue = page.getByRole("region", { name: "Queue", exact: true });
        await expect(queue.locator('section[aria-label$=" batch"]')).toHaveCount(0);
        await expect(queue.getByRole("button", { name: /Group batch|Show separately/u })).toHaveCount(0);
        for (const row of chosen) await expect(queue.locator(`[data-demo-row-id='${row.runId}']`)).toHaveCount(1);
        const first = queue.locator(`[data-demo-row-id='${chosen[0].runId}']`);
        await first.scrollIntoViewIfNeeded();
        await first.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(chosen[0].runId);
        const screenshot = testInfo.outputPath(`${theme}-${grouped ? "grouped-preference" : "flat-preference"}.png`);
        await queue.screenshot({ path: screenshot });
        await testInfo.attach(`${theme} served ${grouped ? "grouped" : "flat"} preference`, { path: screenshot, contentType: "image/png" });
        expect(requests).toEqual([]);
      } finally { page.off("request", onRequest); await server.close(); }
    }
  });
}
