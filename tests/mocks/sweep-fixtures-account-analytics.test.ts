import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import type { DashboardApp } from "../../src/backend/transports/http/routes/api-types.js";
import { SectionUnavailableError } from "../../src/backend/runs/commands/refusals.js";
import { startSweepOverlay } from "./helpers/sweep-fixtures-server.js";
import { startAccountSweepServer } from "./helpers/sweep-account-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";

const out = process.env.SWEEP_FIXTURES_OUT ?? "tests/mocks/.output/sweep-fixtures";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

for (const width of [1280, 1024]) {
  test(`served Analytics read failure at ${width}`, async ({ page, request }) => {
    const app: DashboardApp = new Hono();
    app.get("/api/v1/reports/activity/population", () => { throw new SectionUnavailableError("Synthetic Analytics read failure"); });
    const server = await startSweepOverlay(app, { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
      descriptorHash: FIXTURE_START_PICKER_DAY_WIRE.descriptorHash, day: FIXTURE_START_PICKER_DAY_WIRE });
    let responseOk: boolean | undefined;
    page.on("response", response => {
      if (response.url().includes("/api/v1/reports/activity/population?")) responseOk = response.ok();
    });
    try {
      expect((await request.get(`${server.baseUrl}/api/v1/reports/activity/population?from=2026-08-01&to=2026-08-03`)).ok()).toBe(false);
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&settings=activity&activity=`);
      await expect.poll(() => responseOk).toBe(false);
      await expect(page.getByText("Relay could not load Analytics.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    } finally {
      try {
        await page.screenshot({ path: `${out}/analytics-read-failure-${width}.png` });
        await writeFile(`${out}/analytics-read-failure-${width}.yaml`, await page.locator("body").ariaSnapshot());
      } finally { await page.goto("about:blank"); await server.close(); }
    }
  });

  test(`account lost while a served Assistant proposal waits at ${width}`, async ({ page }) => {
    const server = await startAccountSweepServer();
    try {
      await page.clock.install({ time: server.now });
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${server.baseUrl}/?fixture=hub-served&assistantOpen=1`);
      await page.getByRole("textbox", { name: "Message Relay", exact: true }).fill("Start Person Lookup for the fixture person");
      await page.locator("#hub-send").click();
      const confirm = page.getByRole("button", { name: "Confirm", exact: true });
      await expect(confirm).toBeEnabled();
      await page.screenshot({ path: `${out}/assistant-proposal-before-loss-${width}.png` });
      const before = server.reads();
      server.loseAccount();
      await page.clock.fastForward(60_000);
      await expect.poll(server.reads).toBeGreaterThan(before);
      await expect(confirm).toBeDisabled();
      expect(server.decisions()).toBe(0);
      await page.screenshot({ path: `${out}/assistant-proposal-account-lost-${width}.png` });
      await writeFile(`${out}/assistant-proposal-account-lost-${width}.yaml`, await page.locator("body").ariaSnapshot());
    } finally { await page.goto("about:blank"); await server.close(); }
  });
}
