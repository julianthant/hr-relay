import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { PARITY_THEMES, installTheme } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { dismissWorkflowWindowOverQueue } from "./helpers/reference-harness.js";


test("queue row renders one progress mark per served workflow step", async ({ page }, _info) => {
  const row = FIXTURE_DAY_WIRE.queueSurfaces.find((surface) => surface.status === "running" && surface.surfaceKind !== "operation");
  if (row === undefined) throw new Error("missing running queue fixture");
  const steps = [
    { id: "kuali-extraction", label: "Kuali extraction", state: "active" },
    { id: "identity-check", label: "Identity check", state: "pending" },
    { id: "job-summary", label: "Job summary", state: "pending" },
    { id: "kronos-timecard", label: "Kronos timecard", state: "pending" },
    { id: "ucpath-transaction", label: "UCPath transaction", state: "pending" },
    { id: "kuali-finalization", label: "Kuali finalization", state: "pending" },
  ] as const;
  const dayWire = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((surface) => surface.runId === row.runId
      ? { ...surface, pipeline: steps }
      : surface),
  });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await dismissWorkflowWindowOverQueue(page);
    const queueRow = page.locator(`[data-demo-row-id='${row.runId}']`).first();
    const progress = queueRow.locator('[data-queue-progress]');
    await expect(progress).toHaveAttribute("aria-label", `Steps: ${steps.map((step) => `${step.label} (${step.state})`).join(", ")}`);
    await expect(progress.locator(':scope > span[title]')).toHaveCount(6);
  } finally { await server.close(); }
});
