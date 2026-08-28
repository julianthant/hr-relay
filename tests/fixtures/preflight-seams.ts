import type { Clock } from "../../src/domain/clock.js";
import { createTimeoutDeadlineScheduler } from "../../src/server/scheduling/timeout-deadline-scheduler.js";
import {
  buildPreflightReport,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";
import { PREFLIGHT_CHECKS } from "../../src/domain/runtime-dependencies.js";
import { createPreflightAuthority } from "../../src/server/dashboard/preflight-authority.js";

/** Real strict authority plus the equivalent initial report for synchronous BFF harnesses. */
export function createPreflightHarness(
  clock: Clock,
  configFingerprint: string,
  beforeRun?: () => Promise<void>,
) {
  const selected = requiredPreflightChecks(["dashboard.serve"]);
  const observations = selected.map((check) => ({
    check,
    state: "healthy" as const,
    summary: `${check} healthy in the test harness`,
  }));
  const authority = createPreflightAuthority({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    runners: selected.map((check) => ({
      check,
      kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
      async run() {
        await beforeRun?.();
        return observations.find((observation) => observation.check === check)
          ?? { check, state: "healthy" as const, summary: `${check} healthy in the test harness` };
      },
    })),
    clock,
    deadlineScheduler: createTimeoutDeadlineScheduler(clock),
  });
  const report = buildPreflightReport({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    observations,
    clock,
  });
  return Object.freeze({ authority, report });
}
