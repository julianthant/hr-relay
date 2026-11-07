import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FailureDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { failureDecision } from "../../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { failureDetailWireFixture } from "../../../support/helpers/trust/trust-wire-fixtures.js";

const RUN = "00000000-0000-4000-8000-000000000001", FAILURE = "00000000-0000-4000-8000-000000000004";
const base = failureDetailWireFixture({ runId: RUN, failureId: FAILURE, traceId: "sep-101500-0001", workflowId: "separations" });
const capable = { resolution: { capability: { state: "available" as const }, capture: { failureId: FAILURE, runId: RUN, resolution: { status: "unresolved" as const, version: 1 } } } };

function corrected() {
  return FailureDetailWireSchema.parse({ ...base, nodeId: "job-summary", code: "EMPLOYEE_NOT_FOUND",
    causeChain: [{ code: "EMPLOYEE_NOT_FOUND", summary: base.summary, role: "primary", transient: false }], recovery: {
      correction: { nodeId: "job-summary", code: "employee-not-found", inputField: "operatorEmployeeId", label: "Employee ID", actionLabel: "Enter EID", pattern: "^10\\d{6}$" },
      expectedVersion: 3, retry: { kind: "command", command: "retry", key: "check-again", label: "Check again", intent: "neutral", placement: ["banner"], expectedVersion: 3,
        confirm: { title: "Check again", confirmLabel: "Check again", tone: "neutral" } },
      confirm: { title: "Enter EID", confirmLabel: "Enter EID", tone: "neutral" },
      request: { workflowId: "separations", dryRun: true, browserMode: "headless", captureBrowserScreenshots: false, submissions: [{}], selectedStepKeys: ["job-summary"],
        rerunSource: { runId: RUN, expectedVersion: 3, intent: "rerun", selectedStepKeys: ["job-summary"], failureCorrection: { failureId: FAILURE, inputField: "operatorEmployeeId" } } },
    } });
}

describe("failureDecision", () => {
  it("serves a correction as D10: the start plan with the declared field, then the plain retry", () => {
    const decision = failureDecision(corrected());
    assert.equal(decision.type, "correct-value");
    assert.deepEqual(decision.options.map(({ id, label, send, recommended }) => [id, label, send, recommended]), [
      ["retry-with-value", "Enter EID", { via: "start-plan" }, true],
      ["check-again", "Check again", { via: "action", actionKey: "check-again" }, undefined],
    ]);
    assert.deepEqual(decision.options[0]?.input, { kind: "text", label: "Employee ID", pattern: "^10\\d{6}$" }, "no prefill: the run's typed input never crosses this wire");
    assert.deepEqual(decision.options.map(({ confirm }) => confirm?.title), ["Enter EID", "Check again"]);
  });

  it("serves a failure after a committed or verified write as D8 with only a note", () => {
    for (const writeState of ["committed", "verified"] as const) {
      const decision = failureDecision(FailureDetailWireSchema.parse({ ...base, ...capable, writeState }));
      assert.equal(decision.type, "failed-after-write");
      assert.deepEqual(decision.options.map(({ id, send }) => [id, send]), [["add-note", { via: "command", family: "failure-resolution", type: "annotate-failure" }]]);
    }
  });

  it("serves any other failure as D7 with no retry, because no retry is served without a correction", () => {
    const decision = failureDecision(FailureDetailWireSchema.parse({ ...base, ...capable }));
    assert.equal(decision.type, "failed-retryable");
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["add-note", true]]);
    assert.deepEqual(failureDecision(base).options, [], "no note option without the resolution capability");
  });
});
