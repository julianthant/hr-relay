import type { Clock } from "../../src/domain/clock.js";
import { buildPreflightReport, requiredPreflightChecks } from "../../src/domain/preflight.js";

/** Healthy probe-boundary fixture; selection still comes from the production registry. */
export function healthyDashboardPreflightReport(clock: Clock) {
  return buildPreflightReport({
    configFingerprint: "a".repeat(64),
    requestedCapabilities: ["dashboard.serve"],
    observations: requiredPreflightChecks(["dashboard.serve"]).map((check) => ({
      check,
      state: "healthy" as const,
      summary: `${check} is healthy`,
    })),
    clock,
  });
}
