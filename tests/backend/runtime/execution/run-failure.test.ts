import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { NotePageSchema, RunDetailSectionResponseSchema } from "../../../../src/models/dashboard/run-detail.js";
import { FIXTURE_RUN_DETAILS } from "../../../support/fixtures/dashboard/run-detail/timeline.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_IDS } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { DelegationConfigUnavailableError } from "../../../../src/backend/runs/lifecycle/delegation-admission.js";
import { ERROR_CATALOG, operatorFailureSentence, resolveErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { projectFailureForOperator } from "../../../../src/models/trust/failure.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildNodeFailureRecord, buildEntryValidationFailureRecord
} from "../../../../src/backend/runtime/execution/run-failure.js";
import { TaskError, wrapUnhandledTaskError } from "../../../../src/workflow-kit/errors.js";
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
    { name: "declared task code", error: new TaskError(TASK_ID, "subject-mismatch", "Synthetic failure"), expected: "SUBJECT_MISMATCH" },
    { name: "catalogued own code", error: Object.assign(new Error("Synthetic failure"), { code: "browser-profile-still-closing" }), expected: "BROWSER_PROFILE_STILL_CLOSING" },
    { name: "uncatalogued own code", error: Object.assign(new Error("Synthetic failure"), { code: "ECONNRESET" }), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "uncaught task error", error: wrapUnhandledTaskError(TASK_ID, new Error("Timeout 30000ms exceeded")), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "plain Error", error: new Error("Synthetic failure"), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "non-Error value", error: "Synthetic non-Error failure", expected: "TASK_UNHANDLED_FAILURE" },
  ])("records $expected for a $name", ({ error, expected }) => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error, occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(failure.code, expected);
    assert.equal(failure.causeChain[0]?.code, expected);
    assert.notEqual(operatorFailureSentence(failure.code), ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text);
  });

  it("serves an uncaught task error with the unclassified-failure sentence", () => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: wrapUnhandledTaskError(TASK_ID, new Error("Timeout 30000ms exceeded")), occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(projectFailureForOperator(failure).summary, "The task stopped with an unclassified failure. Review local diagnostic evidence.");
  });

  it("records each named secondary cause after the task's own primary cause", () => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: new TaskError(TASK_ID, "subject-mismatch", "Synthetic failure"), occurredAt: "2026-08-29T08:00:00.000Z",
      secondaryCauses: [{ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Failure screenshot not taken: page-closed" }] });
    assert.equal(failure.code, "SUBJECT_MISMATCH");
    assert.deepEqual(failure.causeChain.map(({ code, role }) => [code, role]),
      [["SUBJECT_MISMATCH", "primary"], ["BROWSER_SCREENSHOT_CAPTURE_FAILED", "secondary"]]);
    assert.equal(failure.causeChain[1]?.summary, "Failure screenshot not taken: page-closed");
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

it.each(["not-attempted", "committed", "verified"] as const)("maps retained delegation config failure with independent %s write evidence", writeState => {
  const cause = new Error("private retained config snapshot mismatch");
  const error = new DelegationConfigUnavailableError(cause);
  const failure = buildNodeFailureRecord({ run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID,
    error, occurredAt: "2026-08-29T08:00:00.000Z",
    writes: writeState === "not-attempted" ? [] : [{ status: writeState === "verified" ? "observed-present" : "committed" }] });
  assert.equal(error.cause, cause);
  assert.equal(failure.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(failure.causeChain[0]?.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(failure.writeState, writeState);
  assert.equal(failure.taskId, undefined, "a child control node owns no task");
  assert.ok(failure.debug?.causes.some(value => value.includes(cause.message)));
  const resolved = resolveErrorCatalogFailure({ code: failure.code, parameters: {}, summary: failure.summary }, "http-response");
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(resolved.text, "Relay could not verify this run's saved settings, so the child workflow did not start. Review the run evidence before continuing.");
  assert.equal(resolved.text.includes(cause.message), false);
});

it.each(["not-attempted", "unknown"] as const)("shows the registered delegation config sentence in Logs while preserving %s write state", writeState => {
  const original = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
  assert.ok(original.section === "failure" && original.payload.state === "available");
  const source = original.payload.value;
  const section = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
    ...source, code: "DELEGATION_CONFIG_UNAVAILABLE", writeState, summary: "private retained snapshot details",
  } } });
  const detail = FIXTURE_RUN_DETAILS[FIXTURE_IDS.failedRun]; assert.ok(detail);
  const logs = NotePageSchema.parse({ runId: detail.runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
  const projection = projectRunLogs({ detail, logs, sections: [section], unavailableEvidence: [] },
    { artifactUrl: () => { throw new Error("config failure must not request an artifact"); } });
  const entry = projection.steps.find(step => step.id === source.failureId)?.entries[0];
  assert.ok(entry?.kind === "decision");
  assert.equal(entry.decision.message, "Relay could not verify this run's saved settings, so the child workflow did not start. Review the run evidence before continuing.");
  assert.equal(entry.decision.state, writeState === "unknown" ? "unconfirmed" : "failed");
  assert.equal(entry.decision.message.includes("private retained snapshot details"), false);
  if (writeState === "unknown") assert.equal(entry.decision.caution, "The result is unknown. Check the system before continuing.");
});
