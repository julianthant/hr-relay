import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildEntryValidationFailureRecord,
  buildNodeFailureRecord,
} from "../../src/core/run-failure.js";
import {
  CURRENT_DIAGNOSTIC_SAFETY_VERSION,
  projectFailureForOperator,
} from "../../src/domain/trust/failure.js";
import { FailureRecordSchema } from "../../src/domain/trust/failure.js";
import { NodeIdSchema, TaskIdSchema } from "../../src/domain/ids.js";
import { deriveWriteAuthorityReason } from "../../src/domain/write-safety.js";
import {
  NoteWireSchema,
  projectNoteForOperator,
} from "../../src/events/types.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";

const RAW = "ucpath:termination|10812345|2026-08-29";
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

describe("versioned diagnostic safety", () => {
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
    assert.equal(JSON.stringify(projectFailureForOperator(authority)).includes(RAW), false);
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
    assert.equal(JSON.stringify(projectFailureForOperator(authority)).includes(RAW), false);
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
    assert.deepEqual(projectFailureForOperator(authority), authority);
  });

  it("withholds every historical failure free-text field without rewriting authority", () => {
    const authority = failure();
    const before = JSON.stringify(authority);
    const projected = projectFailureForOperator(authority);
    assert.equal(JSON.stringify(projected).includes(RAW), false);
    assert.match(projected.summary, /UNHANDLED.*historical diagnostic text withheld/u);
    assert.equal(JSON.stringify(authority), before);
  });

  it("keeps current, stamped failure diagnostics useful", () => {
    const authority = failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION);
    assert.deepEqual(projectFailureForOperator(authority), authority);
  });

  it("withholds current write-authority detail while preserving its strict code and digest in authority", () => {
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
    assert.equal(projectedBytes.includes(RAW), false);
    assert.equal(projectedBytes.includes(reason.code), false);
    assert.equal(projectedBytes.includes(reason.evidence.digest), false);
    assert.equal(projected.writeAuthorityReason, undefined);
    assert.equal(JSON.stringify(authority), before);
  });

  it("withholds historical note text while retaining current stamped notes", () => {
    const legacy = NoteWireSchema.parse({
      ts: "2026-08-29T08:00:00.000Z",
      workflow: "person-lookup",
      pid: 123,
      level: "error",
      message: RAW,
      runId: "10000000-0000-4000-8000-000000000002",
      attempt: 1,
      traceId: "pl-010101-1000",
      spanPath: "pl-010101-1000/searching#1.1",
    });
    const current = NoteWireSchema.parse({
      ...legacy,
      diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
      message: "registered source could not be read",
    });
    assert.equal(JSON.stringify(projectNoteForOperator(legacy)).includes(RAW), false);
    assert.match(projectNoteForOperator(legacy).message, /historical note text withheld/u);
    assert.deepEqual(projectNoteForOperator(current), current);
  });
});
