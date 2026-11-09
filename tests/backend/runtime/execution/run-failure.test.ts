import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildNodeFailureRecord, buildEntryValidationFailureRecord
} from "../../../../src/backend/runtime/execution/run-failure.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { DelegationOutcomePolicyUnsatisfiedError } from "../../../../src/models/run/result.js";
import { NodeIdSchema,TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
const NODE_ID = NodeIdSchema.parse("searching");
const TASK_ID = TaskIdSchema.parse("ucpath/search-person-org");

describe("diagnostic evidence projection", () => {

  it("sanitizes credentials and URL query values in Error stacks and nested causes", () => {
    const nested = new Error("nested source read failed");
    nested.stack = "Error: nested source read failed password=STACK_PASSWORD_CANARY https://example.test/read?subject=CAUSE_QUERY_CANARY";
    const error = new Error("source read failed", { cause: nested });
    error.stack = "Error: source read failed Authorization: Bearer STACK_TOKEN_CANARY https://example.test/read?token=STACK_QUERY_CANARY";
    const authority = buildNodeFailureRecord({ writes: [],
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error,
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.ok(authority.debug);
    assert.match(authority.debug.stack, /source read failed/u);
    assert.equal(authority.debug.causes.length, 1);
    assert.match(authority.debug.causes[0], /nested source read failed/u);
    const bytes = JSON.stringify(authority.debug);
    for (const canary of ["STACK_PASSWORD_CANARY", "CAUSE_QUERY_CANARY", "STACK_TOKEN_CANARY", "STACK_QUERY_CANARY"]) {
      assert.equal(bytes.includes(canary), false, "debug evidence must sanitize every untrusted secret leaf");
    }
  });
});

describe("node failure code selection", () => {
  it.each([
    { error: new TaskError(TASK_ID, "crm-unavailable", "Synthetic failure"), expected: "CRM_UNAVAILABLE" },
    { error: Object.assign(new Error("Synthetic failure"), { code: "custom-code" }), expected: "CUSTOM_CODE" },
    { error: new DelegationOutcomePolicyUnsatisfiedError(), expected: "DELEGATION_OUTCOME_POLICY_UNSATISFIED" },
    { error: new Error("Synthetic failure"), expected: "UNHANDLED" },
    { error: "Synthetic non-Error failure", expected: "UNHANDLED" },
  ])("maps $expected while preserving task and coded-error selection", ({ error, expected }) => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error, occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(failure.code, expected);
    assert.equal(failure.causeChain[0]?.code, expected);
  });
});

it.each([undefined, "RUN_CONTINUATION_REFUSED"] as const)("keeps entry validation code selection explicit for %s", code => {
  const failure = buildEntryValidationFailureRecord({ run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", problems: ["Synthetic validation failure"],
    occurredAt: "2026-08-29T08:00:00.000Z", ...(code === undefined ? {} : { code }) });
  assert.equal(failure.code, code === undefined ? "RESUME_VALIDATION_FAILED" : "RUN_CONTINUATION_REFUSED");
});

describe("node failure write state", () => {
  it("records a failure after a write this run settled as after that write, and anything else as not written", () => {
    const stateAfter = (writes: readonly Readonly<{ status: "committed" | "observed-present" | "retryable" }>[]) => buildNodeFailureRecord({ run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID, error: new Error("receipt refused"),
      occurredAt: "2026-08-29T08:00:00.000Z", writes }).writeState;
    assert.equal(stateAfter([]), "not-attempted");
    assert.equal(stateAfter([{ status: "retryable" }]), "not-attempted", "a confirmed-absent write was not written");
    assert.equal(stateAfter([{ status: "committed" }]), "committed");
    assert.equal(stateAfter([{ status: "committed" }, { status: "observed-present" }]), "verified");
  });
});
