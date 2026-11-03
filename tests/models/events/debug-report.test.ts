import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { debugFailureOutcome, debugFailureOutcomes, diagnosticRequestRoute } from "../../../src/models/events/debug-report.js";

describe("metadata-only failure reports", () => {
  it("recognizes refusals and unknown results even on HTTP 200", () => {
    assert.deepEqual(debugFailureOutcome({ state: "refused", code: "PROFILE_SESSION_STALE", name: "PRIVATE_NAME" }),
      { code: "PROFILE_SESSION_STALE", level: "warn", reason: "operation-refused" });
    assert.equal(debugFailureOutcome({ state: "unknown" })?.level, "error");
    assert.equal(debugFailureOutcome({ state: "applied" }), undefined);
    assert.equal(debugFailureOutcome({ state: "error", code: "PRIVATE_CODE" })?.code, "DASHBOARD_READ_FAILED");
    assert.equal(debugFailureOutcome("PRIVATE_BODY", 503)?.level, "error");
  });
  it("keeps request values out of diagnostic routes", () => {
    assert.equal(diagnosticRequestRoute("/api/v1/runs/PRIVATE_NAME/ocr?eid=PRIVATE_EID#token=PRIVATE_TOKEN"), "/api/v1/runs");
    assert.equal(diagnosticRequestRoute("/api/v1/PRIVATE_NAME/PRIVATE_EID"), "/api/v1");
  });
  it("records failed bulk children by command identity and warns when remote revocation is unconfirmed", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.deepEqual(debugFailureOutcomes({ state: "vector", bulkCommandId: id, type: "pause", requestedCount: 1,
      results: [{ outcome: "refused", runId: id, commandId: id, code: "invalid-state", detail: "PRIVATE_NAME" }] }),
    [{ code: "invalid-state", level: "warn", reason: "operation-refused", correlationId: id }]);
    assert.deepEqual(debugFailureOutcomes({ state: "signed-out", remoteRevocation: "unconfirmed" }),
      [{ code: "CHATGPT_AUTH_UNAVAILABLE", level: "warn", reason: "remote-revocation-unconfirmed" }]);
  });
});
