import { selectActiveRunSettings } from "../../../../../src/backend/runs/settings/run-settings.js";
import { workflowPreflightScope } from "../../../../../src/backend/runs/start/preflight-scope.js";
import type { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/index.js";
import type { PreflightReadinessWire, PreflightSelection } from "../../../../../src/models/preflight/preflight-contract.js";
import { buildPreflightReport, PreflightRerunCommandRequestSchema, PreflightRerunCommandResultSchema, requiredPreflightChecks, type BuildPreflightReportInput } from "../../../../../src/models/preflight/preflight.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";

export function createSeededPreflight({ database, clock, workflows, scenario, descriptorSetHash }: {
  database: AuthorityDatabase;
  clock: Clock;
  workflows: readonly AnyWorkflowDescriptor[];
  scenario?: "ready" | "failed";
  descriptorSetHash: string;
}) {
  function read(selection?: PreflightSelection): PreflightReadinessWire {
    const active = database.withAuthorityReadSnapshot(() => selectActiveRunSettings(database.authority));
    const dashboardScope = { configFingerprint: active.fingerprint, descriptorFingerprint: descriptorSetHash,
      requestedCapabilities: ["dashboard.serve"] as const };
    let scope: Pick<BuildPreflightReportInput, "configFingerprint" | "descriptorFingerprint" | "requestedCapabilities"> = dashboardScope;
    if (selection !== undefined) {
      const descriptor = workflows.find(workflow => workflow.id === selection.workflowId);
      if (descriptor === undefined) return { state: "unavailable", reason: "Preflight workflow is not registered." };
      scope = workflowPreflightScope(descriptor, {
        configSnapshotId: active.configSnapshotId,
        configFingerprint: active.fingerprint,
        ...(selection.requestedInstance === undefined ? {} : { resolvedInstance: selection.requestedInstance }),
      });
    }
    const observations = requiredPreflightChecks(scope.requestedCapabilities).map(check =>
      scenario === "failed" && check === "authority.health"
        ? { check, state: "unhealthy" as const, summary: "Saved runs are unavailable.", impact: "A run cannot start." }
        : { check, state: "healthy" as const, summary: `${check} is healthy` });
    return { state: "present", report: buildPreflightReport({ ...scope, clock, observations }) };
  }

  function report() {
    const readiness = read();
    if (readiness.state !== "present") throw new Error(readiness.reason);
    return readiness.report;
  }

  return {
    read,
    report,
    async execute(raw: unknown) {
      const command = PreflightRerunCommandRequestSchema.parse(raw);
      const readiness = read(command.target.selection);
      if (readiness.state !== "present") throw new Error(readiness.reason);
      return PreflightRerunCommandResultSchema.parse({ state: "completed", commandId: command.commandId, report: readiness.report });
    },
  };
}
