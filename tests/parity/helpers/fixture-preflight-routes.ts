import { WorkflowBootstrapPrimitiveSchema } from "../../../src/models/dashboard/bootstrap.js";
import type { Hono } from "hono";
import { PreflightReadinessWireSchema, PreflightRerunCommandRequestSchema, PreflightRerunCommandResultWireSchema, PreflightReportWireSchema, PreflightSelectionSchema } from "../../../src/models/preflight/preflight-contract.js";
import { expectedPreflightChecks, type RuntimeCapability } from "../../../src/rules/preflight/preflight-semantics.js";
import type { FixtureDashboardProfile } from "./fixture-profile.js";
import { FIXTURE_EDITABLE_SETTINGS } from "./fixture-settings.js";

/** Explicit presentation fixture; never a report from production runtime detectors. */
export function fixturePreflightReport(profile: FixtureDashboardProfile, workflowId?: string, warning = false) {
  const workflow = workflowId === undefined ? undefined : WorkflowBootstrapPrimitiveSchema.array().parse(profile.bootstrap.workflows).find(row => row.id === workflowId);
  if (workflowId !== undefined && !workflow) throw new Error("PREFLIGHT_FIXTURE_SCOPE_UNKNOWN");
  const capabilities: RuntimeCapability[] = workflow ? ["executor.run", "system.ucpath.prod", "system.crm.prod"] : ["dashboard.serve"];
  return PreflightReportWireSchema.parse({
    configFingerprint: FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint,
    descriptorFingerprint: workflow?.descriptorFingerprint ?? profile.bootstrap.descriptorHash,
    checkedAt: profile.bootstrap.serverClock.now, requestedCapabilities: capabilities,
    results: expectedPreflightChecks(capabilities).map(check => warning && check.id === "process.orphans"
      ? { status: "warning", check: check.id, summary: "An unused worker process is still present.", impact: "No active run is blocked.", remediation: "Review unused workers in Sessions." }
      : { status: "pass", check: check.id, summary: "Check passed for this scope." }),
  });
}
export function registerFixturePreflightRoutes(app: Hono, profile: FixtureDashboardProfile, scenario: "ready" | "warning") {
  app.get("/api/v1/preflight", c => {
    const selection = c.req.query("selection");
    const workflowId = selection === undefined ? undefined : PreflightSelectionSchema.parse(JSON.parse(selection)).workflowId;
    return c.json(PreflightReadinessWireSchema.parse({ state: "present", report: fixturePreflightReport(profile, workflowId, scenario === "warning") }));
  });
  app.post("/api/v1/preflight/rerun", async c => {
    const command = PreflightRerunCommandRequestSchema.parse(await c.req.json());
    const report = fixturePreflightReport(profile, command.target.selection?.workflowId, scenario === "warning");
    if (command.target.expectedConfigFingerprint !== report.configFingerprint || command.target.expectedDescriptorFingerprint !== report.descriptorFingerprint) {
      return c.json({ state: "error", code: "PREFLIGHT_FIXTURE_IDENTITY_CHANGED", message: "Reload Settings and choose the current scope.", retryable: false }, 409);
    }
    return c.json(PreflightRerunCommandResultWireSchema.parse({ state: "completed", commandId: command.commandId, report }));
  });
}
