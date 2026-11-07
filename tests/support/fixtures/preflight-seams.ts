import type { Clock } from "../../../src/rules/time/clock.js";
import { createTimeoutDeadlineScheduler } from "../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import {
  buildPreflightReport,
  requiredPreflightChecks,
  type PreflightDeadlineScheduler,
} from "../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../src/models/runtime/runtime-dependencies.js";
import { createPreflightAuthority } from "../../../src/models/preflight/preflight.js";

/** Real strict authority plus the equivalent initial report for synchronous BFF harnesses. */
export function createPreflightHarness(
  clock: Clock,
  configFingerprint: string,
  beforeRun?: () => Promise<void>,
  scheduler: PreflightDeadlineScheduler = createTimeoutDeadlineScheduler(clock),
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
    scheduler,
  });
  const report = buildPreflightReport({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    observations,
    clock,
  });
  return Object.freeze({ authority, report });
}

import {
  PreflightRerunCommandRequestSchema,
  PreflightRerunCommandResultSchema,
} from "../../../src/models/preflight/preflight.js";

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

/** Controlled detector inputs for production admission composition; never a stubbed admission gate. */
export const healthyRuntimePreflightRunners: import("../../../src/backend/app/preflight/runtime-runners.js").RuntimePreflightRunnerFactory = input =>
  requiredPreflightChecks(input.scope.requestedCapabilities).map(check => {
    const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
    if (spec === undefined) throw new Error(`fixture cannot find registered check ${check}`);
    return { check, kind: spec.runner, async run() { return { check, state: "healthy" as const, summary: `${check} controlled healthy observation` }; } };
  });
