import { expect, test, type Page } from "@playwright/test";
import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { PreflightSelectionSchema, PreflightReadinessWireSchema, PreflightReportWireSchema } from "../../src/models/preflight/preflight-contract.js";
import { expectedPreflightChecks, mandatoryCapabilitiesForPreflightCheck, type RuntimeCapability } from "../../src/rules/preflight/preflight-semantics.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";
import { startSweepOverlay } from "./helpers/sweep-fixtures-server.js";

const out = process.env.CHECK_FIX_OUT ?? "tests/mocks/.output/check-fix-destinations";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });
const day = DashboardDayWireSchema.parse({ ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [], attemptHistory: [], monthCounts: [], workflowCounts: [], statusCounts: [], notifications: [] });
const LANDS: Record<string, string> = { "fiscal.current": `annualDates.FY${String(new Date(day.day).getUTCFullYear() + 1)}.jobEndDate`, "secrets.ucpath-sso": "protected.ucpathPassword", "profile.identity": "profile.displayName" };
const FAILED = new Set(["config.valid", "filesystem.health", "fiscal.current", "secrets.ucpath-sso", "profile.identity", "secrets.sharepoint-roster", "endpoint.ucpath.prod", "endpoint.crm.prod"]);

function report(workflowId: string | undefined) {
  const workflow = WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_START_PICKER_BOOTSTRAP.workflows).find(row => row.id === workflowId);
  if (workflow === undefined) throw new Error(`unknown workflow ${String(workflowId)}`);
  const capabilities: RuntimeCapability[] = ["dashboard.serve", "executor.run", "workflow.kuali-fill", "workflow.sharepoint-download", "system.ucpath.prod", "system.crm.prod", "system.sharepoint.prod", "provider.census"];
  return PreflightReportWireSchema.parse({
    configFingerprint: "c".repeat(64), descriptorFingerprint: workflow.descriptorFingerprint, checkedAt: "2026-11-17T18:00:00.000Z", requestedCapabilities: capabilities,
    results: expectedPreflightChecks(capabilities).map(check => FAILED.has(check.id)
      ? { status: "fail", check: check.id, summary: "Forced failure for this screenshot.", blocks: mandatoryCapabilitiesForPreflightCheck(check.id, capabilities), remediation: "See the check." }
      : check.id === "provider.census" ? { status: "warning", check: check.id, summary: "Forced warning.", impact: "None.", remediation: "None." }
      : { status: "pass", check: check.id, summary: "Check passed for this scope." }),
  });
}

async function openChecks(page: Page, baseUrl: string) {
  const view = { workflow: "work-study", launchServed: "work-study", launchStage: "Input" };
  await page.goto(`${baseUrl}/?fixture=product-workflows&day=${day.day}&start=1&view=${encodeURIComponent(JSON.stringify(view))}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Effective date", exact: true }).fill("08/03/2026");
  await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).fill("10800000");
  await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).press("Tab");
  for (let i = 0; i < 2; i++) await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Check results" }).or(dialog.getByLabel("Check results"))).toBeVisible();
  return dialog;
}

test("every Fix lands on a focused row and Escape returns to the dialog", async ({ page }) => {
  const app = new Hono();
  app.get("/api/v1/preflight", c => c.json(PreflightReadinessWireSchema.parse({ state: "present", report: report(PreflightSelectionSchema.parse(JSON.parse(c.req.query("selection") ?? "{}")).workflowId) })));
  const server = await startSweepOverlay(app, { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, descriptorHash: day.descriptorHash, day });
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    let dialog = await openChecks(page, server.baseUrl);
    await page.screenshot({ path: `${out}/after-checks-fail-1280.png` });
    const fixes = await dialog.locator("[data-run-check-fix]").evaluateAll(nodes => nodes.map(n => [n.getAttribute("data-run-check-fix"), n.textContent]));
    expect(fixes).toEqual([["fiscal.current", "Set fiscal year"], ["secrets.ucpath-sso", "Add password"], ["profile.identity", "Set timekeeper name"]]);
    for (const [check] of fixes) {
      await dialog.locator(`[data-run-check-fix="${check}"]`).click();
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
      await expect(page.getByText(/Opened for the .* check/u)).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-settings-path") ?? "none")).not.toBe("none");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-settings-path"));
      expect(focused).toBe(LANDS[check as string]);
      await page.screenshot({ path: `${out}/after-fix-${check}-1280.png` });
      await page.keyboard.press("Escape");
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Check results")).toBeVisible();
    }
    await page.screenshot({ path: `${out}/after-escape-back-1280.png` });
  } finally { await page.goto("about:blank"); await server.close(); }
});
