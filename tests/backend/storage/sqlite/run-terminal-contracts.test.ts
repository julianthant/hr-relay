import assert from "node:assert/strict";
import { it } from "vitest";
import { FailureTerminalizationRequestSchema, SuccessTerminalizationRequestSchema } from "../../../../src/backend/storage/sqlite/run-terminal-contracts.js";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { FailureTerminalAuthorizationRecordSchema, SuccessTerminalAuthorizationRecordSchema } from "../../../../src/models/run/terminal-authorization.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";

const identity = {
  runId: "11111111-1111-4111-8111-111111111111",
  workflowId: "person-lookup",
  attempt: 1,
};
const contract = { descriptorVersion: 1, contractFingerprint: "a".repeat(64) };
const at = "2026-09-09T17:00:00.000Z";
const authority = { ...identity, ...contract, expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 }, authorizedAt: at };
const failure = FailureRecordSchema.parse({
  ...identity, failureId: "22222222-2222-4222-8222-222222222222", fingerprint: "b".repeat(64), traceId: "pl-000619-4ebf",
  nodeId: "search-person", taskId: "ucpath/search-person", code: "UNEXPECTED_PAGE_STATE", summary: "Synthetic page mismatch",
  transient: false, writeState: "not-attempted", occurredAt: at,
  causeChain: [{ code: "UNEXPECTED_PAGE_STATE", summary: "Synthetic page mismatch", role: "primary", transient: false }],
  remediation: [{ kind: "code-change", message: "Repair the state recipe" }],
});
const output = { schemaHash: "c".repeat(64), value: { complete: true } };
const result = RunResultRecordSchema.parse({
  ...identity, ...contract, configFingerprint: "d".repeat(64), configSnapshotId: "33333333-3333-4333-8333-333333333333",
  resultSchemaHash: output.schemaHash, result: output, resultDigest: deriveRunResultDigest(output),
  dependencies: [], dependencyDigest: deriveTerminalDependencyDigest([]), createdAt: at,
});

it.each([
  {
    label: "failure authorization for another run",
    schema: FailureTerminalizationRequestSchema,
    record: { failure },
    matching: FailureTerminalAuthorizationRecordSchema.parse({ ...authority, kind: "failed", failureId: failure.failureId }),
    mismatched: FailureTerminalAuthorizationRecordSchema.parse({
      ...authority, kind: "failed", failureId: failure.failureId, runId: "44444444-4444-4444-8444-444444444444",
    }),
    message: "failure authorization must bind the exact failure/run identity",
  },
  {
    label: "success authorization for another result digest",
    schema: SuccessTerminalizationRequestSchema,
    record: { result },
    matching: SuccessTerminalAuthorizationRecordSchema.parse({ ...authority, kind: "done", resultDigest: result.resultDigest }),
    mismatched: SuccessTerminalAuthorizationRecordSchema.parse({
      ...authority, kind: "done", resultDigest: deriveRunResultDigest({ ...output, value: { complete: false } }),
    }),
    message: "success authorization must bind the exact result identity",
  },
])("refuses $label", ({ schema, record, matching, mismatched, message }) => {
  assert.ok(schema.safeParse({ ...record, authorization: matching }).success);
  const parsed = schema.safeParse({ ...record, authorization: mismatched });
  assert.ok(!parsed.success);
  assert.deepEqual(parsed.error.issues, [{ code: "custom", path: ["authorization"], message }]);
});
