import type { Clock } from "../../src/domain/clock.js";
import {
  buildPreflightReport,
  PreflightRerunCommandRequestSchema,
  PreflightRerunCommandResultSchema,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";

/** Healthy probe-boundary fixture; selection still comes from the production registry. */
export function healthyDashboardPreflightReport(clock: Clock) {
  return buildPreflightReport({
    configFingerprint: "a".repeat(64),
    descriptorFingerprint: "b".repeat(64),
    requestedCapabilities: ["dashboard.serve"],
    observations: requiredPreflightChecks(["dashboard.serve"]).map((check) => ({
      check,
      state: "healthy" as const,
      summary: `${check} is healthy`,
    })),
    clock,
  });
}

/** Transport adapter for BFF suites; authority semantics are pinned in the direct domain suite. */
export function healthyDashboardPreflightExecutor(clock: Clock) {
  return Object.freeze({
    async execute(input: unknown) {
      const command = PreflightRerunCommandRequestSchema.parse(input);
      return PreflightRerunCommandResultSchema.parse({
        state: "completed",
        commandId: command.commandId,
        report: healthyDashboardPreflightReport(clock),
      });
    },
  });
}
