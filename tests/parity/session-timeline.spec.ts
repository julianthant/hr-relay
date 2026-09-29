import { expect, test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { PARITY_THEMES, assertThemeApplied, installTheme } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { dismissWorkflowWindowOverQueue } from "./helpers/reference-harness.js";

test("queue row renders one progress mark per served workflow step", async ({ page }, info) => {
  ensureParityBundle();
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
    const progress = queueRow.locator('span[aria-label^="Steps:"]');
    await expect(progress).toHaveAttribute("aria-label", `Steps: ${steps.map((step) => `${step.label} ${step.state}`).join(", ")}`);
    await expect(progress.locator('span[aria-hidden="true"]')).toHaveCount(6);
    await queueRow.screenshot({ path: info.outputPath("queue-six-steps.png") });
  } finally { await server.close(); }
});

for (const theme of PARITY_THEMES) {
  test(`session timeline shows the claimed run's served steps — ${theme.name}`, async ({ page }, info) => {
    ensureParityBundle();
    const worker = FIXTURE_DAY_WIRE.workerCards.find((card) => card.currentRun.state === "present");
    expect(worker?.currentRun.state).toBe("present");
    if (worker?.currentRun.state !== "present") throw new Error("missing working worker fixture");
    const runId = worker.currentRun.runId;
    const row = FIXTURE_DAY_WIRE.queueSurfaces.find((surface) => surface.runId === runId);
    expect(row?.pipeline.length).toBeGreaterThan(0);
    if (row === undefined) throw new Error("missing claimed run fixture");
    const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards: FIXTURE_DAY_WIRE.workerCards.map((card) => card.workerId === worker.workerId ? {
      ...card,
      controls: { basis: { state: "present", value: { leaseGeneration: 2, controlRevision: 1 } }, ownership: { state: "owned" } },
    } : card) });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
      await assertThemeApplied(page, theme);
      await page.getByRole("button", { name: /^Sessions/ }).click();
      const card = page.getByTitle(`Worker ${worker.workerId}`, { exact: true });
      const timeline = card.getByRole("group", { name: /^Run timeline:/ });
      await expect(timeline).toBeVisible();
      await expect(timeline.locator("span[title]")).toHaveCount(row.pipeline.length);
      await expect(timeline).toHaveAttribute("aria-label", `Run timeline: ${row.pipeline.map((step) => `${step.label} ${step.state}`).join(", ")}`);
      await expect(card.getByRole("button", { name: "Reopen UCPATH" })).toBeDisabled();
      await expect(card.getByText("Browser control unavailable while a run is active.")).toBeVisible();
      await expect(card.getByText(/queued/i)).toHaveCount(0);
      await card.screenshot({ path: info.outputPath(`session-timeline-${theme.name}.png`) });
      await card.getByRole("button", { name: "Show worker details for Person Lookup" }).click();
      const details = page.getByRole("dialog", { name: "Worker details" });
      await expect(details.getByText("Queued in workflow").locator("..").locator("dd")).toHaveText("2");
      await expect(details.getByText("Browser controls")).toHaveCount(0);
      await details.screenshot({ path: info.outputPath(`session-details-${theme.name}.png`) });
      const idle = FIXTURE_DAY_WIRE.workerCards.find((entry) => entry.state === "idle" && entry.currentRun.state === "absent");
      expect(idle).toBeDefined();
      if (idle !== undefined) await expect(page.getByTitle(`Worker ${idle.workerId}`, { exact: true }).getByRole("group", { name: /^Run timeline:/ })).toHaveCount(0);
    } finally { await server.close(); }
  });
}
