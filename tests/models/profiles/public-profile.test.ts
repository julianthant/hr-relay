import assert from "node:assert/strict";
import { it } from "vitest";
import { ProfileFirstRunCheckSchema, PublicProfileStateSchema } from "../../../src/models/profiles/public-profile.js";
import { PreflightReportWireSchema } from "../../../src/models/preflight/preflight-contract.js";
import { buildPreflightReport, requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { healthyDashboardPreflightReport } from "../../support/fixtures/preflight-seams.js";

const profileId = "00000000-0000-4000-8000-000000000001";
const report = healthyDashboardPreflightReport(manualClock(new Date("2026-11-08T12:00:00Z")));
const passed = { scope: "local-startup", profileId, epoch: 7, state: "passed", report } as const;
const failedReport = PreflightReportWireSchema.parse({ ...report, results: report.results.map(result => result.check !== "ports.available" ? result
  : { check: result.check, status: "fail", summary: "Reserved port is occupied", blocks: ["dashboard.serve"], remediation: "Close the conflicting process" }) });

it("binds first-run outcomes to the complete canonical local report", () => {
  const remoteReport = buildPreflightReport({ configFingerprint: report.configFingerprint, requestedCapabilities: ["dashboard.serve", "provider.census"],
    observations: requiredPreflightChecks(["dashboard.serve", "provider.census"]).map(check => ({ check, state: "healthy" as const, summary: "controlled healthy observation" })),
    clock: manualClock(new Date("2026-11-08T12:00:00Z")) });
  assert.deepEqual(ProfileFirstRunCheckSchema.parse(passed), passed);
  assert.equal(ProfileFirstRunCheckSchema.parse({ ...passed, state: "failed", report: failedReport }).state, "failed");
  for (const invalid of [
    { ...passed, state: "failed" }, { ...passed, report: failedReport },
    { ...passed, report: { ...report, requestedCapabilities: ["executor.run"] } },
    { ...passed, report: remoteReport },
    { ...passed, scope: "connection" }, { ...passed, epoch: 0 },
    { ...passed, report: { ...report, results: [] } }, { ...passed, token: "foreign" },
  ]) assert.equal(ProfileFirstRunCheckSchema.safeParse(invalid).success, false);
  assert.deepEqual(ProfileFirstRunCheckSchema.parse({ scope: "local-startup", profileId, epoch: 7, state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" }),
    { scope: "local-startup", profileId, epoch: 7, state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" });
  assert.equal(ProfileFirstRunCheckSchema.safeParse({ ...passed, state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" }).success, false);
});

it("accepts signup-only evidence on active and error responses without inventing active authority", () => {
  const active = { state: "active", profileId, epoch: 7, duoState: "ready", firstRunCheck: passed };
  assert.deepEqual(PublicProfileStateSchema.parse(active), active);
  for (const firstRunCheck of [
    { ...passed, profileId: "00000000-0000-4000-8000-000000000002" }, { ...passed, epoch: 8 },
    { ...passed, state: "failed", report: failedReport },
    { scope: "local-startup", profileId, epoch: 7, state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" },
  ]) assert.equal(PublicProfileStateSchema.safeParse({ ...active, firstRunCheck }).success, false);
  assert.equal(PublicProfileStateSchema.parse({ state: "error", code: "INTERNAL_FAILURE", firstRunCheck: passed }).state, "error");
  assert.equal(PublicProfileStateSchema.safeParse({ state: "signed-out", firstRunCheck: passed }).success, false);
});
