import type { Clock } from "../../src/domain/clock.js";
import {
  buildPreflightReport,
  createPreflightAuthority,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";
import { PREFLIGHT_CHECKS } from "../../src/domain/runtime-dependencies.js";

/** Real strict authority plus the equivalent initial report for synchronous BFF harnesses. */
export function createPreflightHarness(clock: Clock, configFingerprint: string) {
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
        return observations.find((observation) => observation.check === check)
          ?? { check, state: "healthy" as const, summary: `${check} healthy in the test harness` };
      },
    })),
    clock,
  });
  const report = buildPreflightReport({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    observations,
    clock,
  });
  return Object.freeze({ authority, report });
}
