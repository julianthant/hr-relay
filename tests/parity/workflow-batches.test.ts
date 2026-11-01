import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";


for (const theme of ["light", "dark"] as const) {

test(`workflow batches: separate rows for either served preference, ${theme}`, async ({ page }, _testInfo) => {
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
        await page.addInitScript(value => localStorage.setItem("rebuild-demo.theme", value), theme);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
        await expect(page.locator("html")).toHaveAttribute("data-demo-theme", theme);
        await expect(page.locator("body")).toHaveAttribute("data-demo-theme", theme);
        await expect(page.locator("[data-app-root]" )).toHaveAttribute("data-demo-theme", theme);
        const queue = page.getByRole("region", { name: "Queue", exact: true });
        await expect(queue.locator('section[aria-label$=" batch"]')).toHaveCount(0);
        await expect(queue.getByRole("button", { name: /Group batch|Show separately/u })).toHaveCount(0);
        for (const row of chosen) await expect(queue.locator(`[data-demo-row-id='${row.runId}']`)).toHaveCount(1);
        const first = queue.locator(`[data-demo-row-id='${chosen[0].runId}']`);
        await first.scrollIntoViewIfNeeded();
        await first.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(chosen[0].runId);
        expect(requests).toEqual([]);
      } finally { page.off("request", onRequest); await server.close(); }
    }
  });
}
