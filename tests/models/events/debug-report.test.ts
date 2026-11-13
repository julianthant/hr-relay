import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DashboardErrorReportSchema, debugFailureOutcome, debugFailureOutcomes, diagnosticRequestRoute } from "../../../src/models/events/debug-report.js";
import { buildPreflightReport, requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../src/rules/time/clock.js";

describe("metadata-only failure reports", () => {
  it("keeps an explicitly expired readiness 200 distinct from failed or malformed reads", () => {
    const report = buildPreflightReport({ configFingerprint: "a".repeat(64), requestedCapabilities: ["dashboard.serve"],
      clock: manualClock(new Date("2026-11-04T00:00:00Z")),
      observations: requiredPreflightChecks(["dashboard.serve"]).map(check => ({ check, state: "healthy", summary: "Fixture healthy" })) });
    const expired = { state: "unavailable", code: "PREFLIGHT_EVIDENCE_EXPIRED", reason: "Readiness expired.", lastCompleted: report };
    assert.equal(debugFailureOutcome(expired, 200), undefined);
    assert.equal(debugFailureOutcomes(expired, 200).length, 0);
    for (const [body, status] of [[expired, 503], [{ ...expired, lastCompleted: {} }, 200],
      [{ state: "unavailable", reason: "Storage could not be read." }, 200], [{ ...expired, code: "PRIVATE_CODE" }, 200]] as const) {
      assert.equal(debugFailureOutcome(body, status)?.reason, "operation-failed");
    }
  });
  it("recognizes refusals and unknown results even on HTTP 200", () => {
    assert.deepEqual(debugFailureOutcome({ state: "refused", code: "PROFILE_SESSION_STALE", name: "PRIVATE_NAME" }),
      { code: "PROFILE_SESSION_STALE", reason: "operation-refused" });
    assert.equal(debugFailureOutcome({ state: "unknown" })?.reason, "outcome-unknown");
    assert.equal(debugFailureOutcome({ state: "applied" }), undefined);
    assert.equal(debugFailureOutcome({ state: "error", code: "PRIVATE_CODE" })?.code, "DASHBOARD_READ_FAILED");
    assert.equal(debugFailureOutcome("PRIVATE_BODY", 503)?.reason, "operation-failed");
  });
  it("keeps request values out of diagnostic routes", () => {
    assert.equal(diagnosticRequestRoute("/api/v1/runs/PRIVATE_NAME/ocr?eid=PRIVATE_EID#token=PRIVATE_TOKEN"), "/api/v1/runs");
    assert.equal(diagnosticRequestRoute("/api/v1/PRIVATE_NAME/PRIVATE_EID"), "/api/v1");
    assert.equal(diagnosticRequestRoute("/api/v1/dashboard?day=2026-11-07"), "/api/v1/dashboard");
  });
  it("records failed bulk children by command identity and warns when remote revocation is unconfirmed", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.deepEqual(debugFailureOutcomes({ state: "vector", bulkCommandId: id, type: "pause", requestedCount: 1,
      results: [{ outcome: "refused", runId: id, commandId: id, code: "invalid-state", detail: "PRIVATE_NAME" }] }),
    [{ code: "invalid-state", reason: "operation-refused", correlationId: id }]);
    assert.deepEqual(debugFailureOutcomes({ state: "signed-out", remoteRevocation: "unconfirmed" }),
      [{ code: "CHATGPT_AUTH_UNAVAILABLE", reason: "remote-revocation-unconfirmed" }]);
  });
  it("retains refused and uncertain worker startup diagnostics after a committed enqueue", () => {
    const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const state of ["refused", "unknown"] as const) {
      const response = { state: "applied", commandId, affectedTargets: [{ family: "run", runId: commandId }],
        workerStartup: { state, code: "RUN_QUEUED_WORKER_UNAVAILABLE", message: "Run queued. Do not start again.", detail: "Fixture refusal.", commandId: childId } };
      assert.deepEqual(debugFailureOutcomes(response, 200), [{ code: "RUN_QUEUED_WORKER_UNAVAILABLE",
        reason: state === "unknown" ? "outcome-unknown" : "operation-refused", correlationId: childId }]);
    }
  });
});

describe("dashboard report run identity", () => {
  const report = { reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientId: "browser", release: "test",
    route: "/", surface: "app", code: "DASHBOARD_UNHANDLED_ERROR", message: "Synthetic failure" };
  it("accepts an optional run UUID and rejects malformed or unknown fields", () => {
    assert.equal(DashboardErrorReportSchema.safeParse(report).success, true);
    assert.equal(DashboardErrorReportSchema.parse({ ...report, runId: report.reportId }).runId, report.reportId);
    assert.equal(DashboardErrorReportSchema.safeParse({ ...report, runId: "invalid" }).success, false);
    assert.equal(DashboardErrorReportSchema.safeParse({ ...report, unknown: "value" }).success, false);
  });
});
