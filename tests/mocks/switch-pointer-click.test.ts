import { expect, test } from "@playwright/test";
import { Hono } from "hono";
import type { DashboardApp } from "../../src/backend/transports/http/routes/api-types.js";
import { FrontendBootstrapWireSchema } from "../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { startSweepOverlay } from "./helpers/sweep-fixtures-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";

const day = DashboardDayWireSchema.parse({ ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [], attemptHistory: [], monthCounts: [], workflowCounts: [], statusCounts: [], notifications: [] });
const bootstrap = FrontendBootstrapWireSchema.parse(FIXTURE_START_PICKER_BOOTSTRAP);

test("a pointer click on a Run dialog switch toggles it", async ({ page }) => {
  const server = await startSweepOverlay(new Hono() as DashboardApp, { bootstrap, descriptorHash: day.descriptorHash, day });
  try {
    const view = { workflow: "emergency-contact", launchServed: "emergency-contact", launchStage: "Options" };
    await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${day.day}&start=1&view=${encodeURIComponent(JSON.stringify(view))}`);
    const dialog = page.getByRole("dialog");
    for (const name of ["Customize steps", "Priority"]) {
      const control = dialog.getByRole("switch", { name });
      const before = await control.isChecked();
      await control.click({ timeout: 5000 });
      expect(await control.isChecked()).toBe(!before);
      await control.click({ timeout: 5000 });
      expect(await control.isChecked()).toBe(before);
    }
  } finally { await server.close(); }
});
