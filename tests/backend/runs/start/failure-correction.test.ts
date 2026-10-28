import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { z } from "zod";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { failureCorrectionSubmission } from "../../../../src/backend/runs/start/failure-correction.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { FailureDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { failureRecovery } from "../../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { PlannedRunSchema } from "../../../../src/models/run/start-plan.js";
import { SourceBoundRunSchema } from "../../../../src/models/run/rerun.js";
import { buildRerunPlan, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { StartPlanIngressSchema } from "../../../../src/models/dashboard/start-plan.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { SeparationsCanonicalInput } from "../../../../src/workflows/separations/workflow.js";
import { runRecordOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";

function fixture() {
  const original = { documentNumber: "4510", timekeeperName: "Synthetic Timekeeper", searchTimeoutMs: 15000, reRead: { ordinal: 1, reason: "corrected dates" } };
  const failureId = uuidOf(30);
  const base = runRecordOf({ seed: 1, workflow: "separations", descriptor: separationsDescriptor,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T19:00:00.000Z", failureId, errorSummary: "Employee absent" } });
  const run = RunRecordSchema.parse({ ...base, envelope: { ...base.envelope, itemId: deriveItemId(separationsDescriptor.id, "separations:4510#re-read-1") },
    input: { ...base.input, parsed: { ...base.input.parsed, value: original, protectedBindings: [{ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: uuidOf(90) }], schemaHash: deriveSchemaHash(SeparationsCanonicalInput, "output") } } });
  const failure = FailureRecordSchema.parse({ failureId, fingerprint: "a".repeat(64), runId: run.envelope.runId,
    traceId: run.envelope.traceId, attempt: 1, workflowId: "separations", nodeId: "job-summary", taskId: "ucpath/read-job-summary",
    code: "EMPLOYEE_NOT_FOUND", summary: "Employee absent", transient: false, writeState: "not-attempted",
    causeChain: [{ code: "EMPLOYEE_NOT_FOUND", summary: "Employee absent", role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "Enter an EID" }], occurredAt: run.updatedAt });
  const request = StartPlanIngressSchema.parse({ workflowId: "separations", submissions: [{ operatorEmployeeId: "10800001" }],
    dryRun: run.envelope.dryRun, selectedStepKeys: separationsDescriptor.timeline.map(step => step.key),
    rerunSource: { runId: run.envelope.runId, expectedVersion: run.version, intent: "rerun", selectedStepKeys: separationsDescriptor.timeline.map(step => step.key), failureCorrection: { failureId, inputField: "operatorEmployeeId" } } });
  return { original, run, failure, request };
}

describe("failed-run single-field rerun", () => {
  it("changes only the declared field and retains the exact failure provenance", () => {
    const { original, run, failure, request } = fixture();
    const submission = failureCorrectionSubmission(separationsDescriptor, run, failure, request);
    assert.deepEqual(submission, { documentNumber: original.documentNumber, searchTimeoutMs: original.searchTimeoutMs,
      reRead: original.reRead, operatorEmployeeId: "10800001" });
    assert.deepEqual(run.input.parsed.value, original);
    assert.deepEqual(request.rerunSource?.failureCorrection, { failureId: failure.failureId, inputField: "operatorEmployeeId" });
    // The normal planner restores the retained private field rather than accepting it from the browser.
    assert.equal(Object.hasOwn(submission, "timekeeperName"), false);
  });
  it("refuses stale revisions, invalid EIDs, extra changes and undeclared failures", () => {
    const { run, failure, request } = fixture();
    assert.throws(() => failureCorrectionSubmission(separationsDescriptor, run, failure,
      StartPlanIngressSchema.parse({ ...request, rerunSource: { ...request.rerunSource, expectedVersion: run.version + 1 } })),
    (error: unknown) => error instanceof RerunRefusedError && error.code === "source-stale");
    for (const submissions of [[{ operatorEmployeeId: "12345678" }], [{ operatorEmployeeId: "10800001", documentNumber: "4502" }], [{}]]) {
      assert.throws(() => failureCorrectionSubmission(separationsDescriptor, run, failure, { ...request, submissions }),
        (error: unknown) => error instanceof RerunRefusedError && error.code === "invalid-value");
    }
    for (const changed of [{ code: "document-unavailable" }, { nodeId: "other" }, { writeState: "unknown", action: { operation: "commit" } }, { runId: uuidOf(4) }]) {
      assert.throws(() => failureCorrectionSubmission(separationsDescriptor, run, FailureRecordSchema.parse({ ...failure, ...changed }), request));
    }
    assert.throws(() => failureCorrectionSubmission(separationsDescriptor, run, failure, { ...request, dryRun: !request.dryRun }));
  });
});


it("serves only the declared durable failure and carries its provenance through the normal rerun owner", () => {
  const { run, failure, request } = fixture();
  // In-memory read ports exercise the actual planner and projection without native admission.
  const repositories = { deletedRuns: { get: () => undefined }, runs: { get: () => run },
    writeIntents: { listAttemptingByItem: () => [], listByRun: () => [], listByBusinessKey: () => [] },
    runCheckpoints: { listByItem: () => [] }, gateResults: { listByRun: () => [] } } as unknown as AuthorityRepositories;
  const deps = { canonical: { descriptors: { resolve: () => separationsDescriptor }, database: { authority: repositories,
    withAuthorityReadSnapshot: <T>(read: () => T): T => read() } } } as unknown as RunDetailQueryDeps;
  const served = failureRecovery(deps, run, failure);
  const wire = FailureDetailWireSchema.parse({ ...failure, ...served, sameFingerprintSeen: 1,
    subject: { state: "absent", reason: "No subject" }, diagnosticBundle: { state: "absent", reason: "None" } });
  assert.equal(wire.recovery?.correction.code, "employee-not-found");
  assert.equal(wire.code, "EMPLOYEE_NOT_FOUND");
  assert.deepEqual(wire.recovery?.request.submissions, [{}]);
  for (const change of [{ code: "OTHER_FAILURE" }, { nodeId: "other" }, { writeState: "unknown", action: { operation: "commit" } }]) {
    assert.deepEqual(failureRecovery(deps, run, FailureRecordSchema.parse({ ...failure, ...change })), {});
  }
  const submission = failureCorrectionSubmission(separationsDescriptor, run, failure, request);
  const planned = PlannedRunSchema.parse({ itemId: run.envelope.itemId, title: "Separation 4510", rawInput: submission,
    input: { ...run.input.parsed, value: { ...z.record(z.string(), JsonValueSchema).parse(run.input.parsed.value), operatorEmployeeId: "10800001" } },
    canonicalInputDigest: "b".repeat(64), matchKey: "4510" });
  assert.ok(request.rerunSource);
  const rerun = buildRerunPlan(repositories, separationsDescriptor, request.rerunSource, [planned]);
  const consumed = SourceBoundRunSchema.parse({ ...rerun, confirmationCommandId: uuidOf(100) });
  assert.deepEqual(consumed.source, request.rerunSource);
  assert.equal(consumed.source.failureCorrection?.failureId, failure.failureId);
});

it("replans a missing Kuali document as the corrected item, preserving lineage and reading it afresh", () => {
  const { original, run, failure: priorFailure, request: priorRequest } = fixture();
  const failure = FailureRecordSchema.parse({ ...priorFailure, nodeId: "resolve-action", taskId: "kuali/search-separation-action",
    code: "DOCUMENT_NOT_IN_ACTION_LIST" });
  const request = StartPlanIngressSchema.parse({ ...priorRequest, submissions: [{ documentNumber: "4502" }],
    rerunSource: { ...priorRequest.rerunSource, failureCorrection: { failureId: failure.failureId, inputField: "documentNumber" } } });
  const repositories = { deletedRuns: { get: () => undefined }, runs: { get: () => run, listByItem: () => [] },
    writeIntents: { listAttemptingByItem: () => [], listByRun: () => [], listByBusinessKey: () => [] },
    runCheckpoints: { listByItem: () => [] }, gateResults: { listByRun: () => [] } } as unknown as AuthorityRepositories;
  const deps = { canonical: { descriptors: { resolve: () => separationsDescriptor }, database: { authority: repositories,
    withAuthorityReadSnapshot: <T>(read: () => T): T => read() } } } as unknown as RunDetailQueryDeps;
  const wire = FailureDetailWireSchema.parse({ ...failure, ...failureRecovery(deps, run, failure), sameFingerprintSeen: 1,
    subject: { state: "absent", reason: "No subject" }, diagnosticBundle: { state: "absent", reason: "None" } });
  assert.equal(wire.recovery?.correction.actionLabel, "Enter document number");
  assert.equal(wire.recovery?.retry.label, "Check again");
  assert.deepEqual(wire.recovery?.request.submissions, [{}]);
  for (const change of [{ code: "KUALI_UNAVAILABLE" }, { code: "UNEXPECTED_PAGE_STATE" },
    { code: "AMBIGUOUS_ACTION_LIST_MATCH" }, { code: "UNREADABLE_ACTION_LINK" },
    { nodeId: "document", code: "DOCUMENT_UNAVAILABLE" }]) {
    assert.deepEqual(failureRecovery(deps, run, FailureRecordSchema.parse({ ...failure, ...change })), {});
  }
  for (const submissions of [[{ documentNumber: "12" }], [{ documentNumber: "4502", operatorEmployeeId: "10800001" }], [{}]]) {
    assert.throws(() => failureCorrectionSubmission(separationsDescriptor, run, failure, { ...request, submissions }),
      (error: unknown) => error instanceof RerunRefusedError && error.code === "invalid-value");
  }

  const submission = failureCorrectionSubmission(separationsDescriptor, run, failure, request);
  assert.deepEqual(submission, { documentNumber: "4502", searchTimeoutMs: original.searchTimeoutMs, reRead: original.reRead });
  const plan = planStart({ authority: { authority: repositories }, clock: manualClock(new Date(run.updatedAt)),
    ids: { uuid: () => uuidOf(100) }, planTtlMs: 600_000 }, {
    descriptor: separationsDescriptor, submissions: [submission], retainedInputs: [run.input.parsed],
    dryRun: request.dryRun, priority: run.envelope.priority, shape: "single", plannedBy: "local-operator",
    configFingerprint: run.envelope.configFingerprint, configSnapshotId: run.envelope.configSnapshotId });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.planned.length, 1);
  const [planned] = plan.planned;
  assert.ok(planned);
  assert.equal(planned.matchKey, "separations:4502#re-read-1");
  assert.equal(planned.itemId, deriveItemId(separationsDescriptor.id, "separations:4502#re-read-1"));
  assert.notEqual(planned.itemId, run.envelope.itemId);
  assert.deepEqual(planned.input.value, { ...original, documentNumber: "4502" });
  assert.deepEqual(planned.input.protectedBindings, run.input.parsed.protectedBindings);
  assert.deepEqual(run.input.parsed.value, original);
  assert.ok(request.rerunSource);
  const rerun = buildRerunPlan(repositories, separationsDescriptor, request.rerunSource, plan.planned);
  assert.deepEqual(SourceBoundRunSchema.parse({ ...rerun, confirmationCommandId: uuidOf(101) }).source, request.rerunSource);
  assert.deepEqual(rerun.source.selectedStepKeys, separationsDescriptor.timeline.map(step => step.key));

  const nodes = descriptorRuntimeNodes(separationsDescriptor);
  const search = nodes.find(node => node.id === "resolve-action"), document = nodes.find(node => node.id === "document");
  assert.ok(search?.kind === "task" && document?.kind === "task");
  assert.deepEqual(search.bind({ input: planned.input.value, outputs: {} }), { documentNumber: "4502" });
  assert.deepEqual(document.bind({ input: planned.input.value, outputs: { "resolve-action": { actionId: "6a766ae6f0549046f7f0dc06" } } }),
    { documentNumber: "4502", actionId: "6a766ae6f0549046f7f0dc06" });
});
