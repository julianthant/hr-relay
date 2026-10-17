import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildEntryValidationFailureRecord,
buildNodeFailureRecord,
} from "../../../src/backend/runtime/execution/run-failure.js";
import {
CURRENT_DIAGNOSTIC_SAFETY_VERSION,
FailureRecordSchema,
projectFailureForOperator,
} from "../../../src/models/trust/failure.js";
import { NodeIdSchema,TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-safety.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

const RAW = "ucpath:termination|10812345|2026-08-29";
const UNREGISTERED = "This failure code is not in the current catalog. Review the recorded local evidence.";
const NODE_ID = NodeIdSchema.parse("searching");
const TASK_ID = TaskIdSchema.parse("ucpath/search-person-org");

function failure(diagnosticSafetyVersion?: 1) {
  return FailureRecordSchema.parse({
    failureId: "10000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
    runId: "10000000-0000-4000-8000-000000000002",
    traceId: "pl-010101-1000",
    attempt: 1,
    workflowId: "person-lookup",
    code: "UNHANDLED",
    summary: diagnosticSafetyVersion === undefined ? RAW : "registered source could not be read",
    transient: false,
    writeState: "not-attempted",
    causeChain: [{
      code: "UNHANDLED",
      summary: diagnosticSafetyVersion === undefined ? `primary ${RAW}` : "registered source unavailable",
      role: "primary",
      transient: false,
    }],
    remediation: [{
      kind: "operator-action",
      message: diagnosticSafetyVersion === undefined ? `repair ${RAW}` : "repair the registered source",
    }],
    occurredAt: "2026-08-29T08:00:00.000Z",
    ...(diagnosticSafetyVersion === undefined ? {} : { diagnosticSafetyVersion }),
  });
}

describe("diagnostic evidence projection", () => {
  it("keeps an arbitrary Error message in authority without stamping it safe for projection", () => {
    const authority = buildNodeFailureRecord({
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000004",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error: new Error(RAW),
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.summary, RAW, "authority retains the diagnostic detail for investigation");
    assert.equal(authority.diagnosticSafetyVersion, undefined);
    assert.equal(JSON.stringify(projectFailureForOperator(authority)).includes(RAW), true);
  });

  it("keeps caller-supplied entry-validation problems in authority without stamping them safe", () => {
    const authority = buildEntryValidationFailureRecord({
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000005",
      problems: [`the selected subject was ${RAW}`],
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.summary.includes(RAW), true, "authority retains every named validation problem");
    assert.equal(authority.diagnosticSafetyVersion, undefined);
    assert.equal(projectFailureForOperator(authority).summary.includes(RAW), false);
    assert.equal(JSON.stringify(projectFailureForOperator(authority, true)).includes(RAW), false);
  });

  it("stamps the closed non-Error fallback sentence because no thrown value is copied into it", () => {
    const authority = buildNodeFailureRecord({
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000006",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error: { opaque: RAW },
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.diagnosticSafetyVersion, CURRENT_DIAGNOSTIC_SAFETY_VERSION);
    assert.equal(authority.summary, "node searching threw a non-Error value");
    assert.equal(projectFailureForOperator(authority, false).summary, UNREGISTERED);
  });

  it("serves unstamped failure text without rewriting authority", () => {
    const authority = failure();
    const before = JSON.stringify(authority);
    const projected = projectFailureForOperator(authority);
    assert.equal(projected.summary, UNREGISTERED);
    assert.equal(JSON.stringify(authority), before);
  });

  it("keeps current, stamped failure diagnostics useful", () => {
    const authority = failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION);
    assert.equal(authority.summary, "registered source could not be read");
    assert.equal(projectFailureForOperator(authority, false).summary, UNREGISTERED);
  });

  it("serves protected and unstamped text from every source", () => {
    const authority = FailureRecordSchema.parse({ ...failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION),
      summary: RAW, causeChain: [{ code: "UNHANDLED", summary: RAW, role: "primary", transient: false }],
      remediation: [{ kind: "operator-action", message: RAW }] });
    const before = JSON.stringify(authority);
    assert.equal(JSON.stringify(projectFailureForOperator(authority, true)).includes(RAW), false);
    assert.equal(projectFailureForOperator(authority, undefined).summary, UNREGISTERED);
    assert.equal(projectFailureForOperator(failure(), false).summary, UNREGISTERED);
    assert.equal(JSON.stringify(authority), before);
  });

  it("serves current write-authority detail", () => {
    const reason = deriveWriteAuthorityReason(
      "preview-probe-exception",
      "exception",
      `Error: ${RAW}`,
    );
    const authority = FailureRecordSchema.parse({
      ...failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION),
      summary: RAW,
      causeChain: [{ code: "UNHANDLED", summary: RAW, role: "primary", transient: false }],
      writeAuthorityReason: reason,
    });
    const before = JSON.stringify(authority);
    const projected = projectFailureForOperator(authority);
    const projectedBytes = JSON.stringify(projected);
    assert.equal(projectedBytes.includes(RAW), true);
    assert.equal(projectedBytes.includes(reason.code), true);
    assert.equal(projectedBytes.includes(reason.evidence.digest), true);
    assert.deepEqual(projected.writeAuthorityReason, reason);
    assert.equal(JSON.stringify(authority), before);
  });
});
