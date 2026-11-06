import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectUcpathFindings, retainedUcpathFindings } from "../../../../../src/backend/runs/queries/run-detail/ucpath-findings.js";
import { LogIdentityRefusedError } from "../../../../../src/backend/runs/commands/refusals.js";
import type { RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail-types.js";
import { UcpathReadTransactionFindings } from "../../../../../src/models/systems/ucpath/read-transaction-findings.js";
import { UcpathCreateTermination, ucpathTerminationIdempotencyKey } from "../../../../../src/models/systems/ucpath/create-termination.js";
import { UcpathStageTermination } from "../../../../../src/models/systems/ucpath/stage-termination.js";
import { UcpathTerminationTargetSchema } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema } from "../../../../../src/models/ui/ucpath-transaction-findings.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { WorkerEffectAcknowledgementSchema, type WorkerControlRecord } from "../../../../../src/models/run/worker-control.js";
import { defineCanonicalInput } from "../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/models/workflow/presentation.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { deriveStableUuid } from "../../../../../src/rules/identity/identifiers.js";
import { ParkedWriteCheckResultSchema, ParkedWriteCheckTargetSchema } from "../../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../../../../../src/models/validation/schema-bound-value.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest, WriteIntentRecordSchema } from "../../../../../src/rules/write-safety/write-safety.js";
import { flow } from "../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { taskImplFingerprint } from "../../../../../src/workflow-kit/fingerprints.js";
import { FIXTURE_PARKED_WRITE_INTENT } from "../../../../support/fixtures/dashboard/run-detail/gates-park.js";
import { runRecordOf, uuidOf } from "../../../../support/helpers/backend/dashboard-harness.js";

const NOW = "2026-11-01T21:03:00.000Z";
const target = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Fixture, Jordan", emplRecord: "0",
  effectiveDate: "11/01/2026", template: "UC_VOL_TERM", reasonCode: "Attend School", lastDateWorked: "10/31/2026", initiatorComments: "Fixture" });
const row = { transactionId: "T123456", emplId: target.emplId, displayedName: target.expectedName,
  action: "Terminatn", approvalStatus: "Pending", startDate: target.effectiveDate,
  submittedAt: "11/01/26 1:02:03.123456PM", detailVerified: true };
function scanOf(rows: readonly unknown[] = [row]) {
  return UcpathTransactionFindingsReadSchema.parse({ state: "read", emplId: target.emplId, rows, scannedRowCount: rows.length,
    completeness: rows.length === 300 ? { state: "incomplete", reason: "search-cap", reportedRowCount: 300 }
      : { state: "complete", reportedRowCount: rows.length }, observedAt: NOW, source: "ss-smart-hr-list-and-detail" });
}
const descriptor = defineWorkflowDescriptor({ id: "findings-fixture", version: 1, contractFingerprint: "e".repeat(64), code: "ff",
  label: "Findings fixture", icon: "Search", category: "operations",
  canonicalInput: defineCanonicalInput(UcpathTerminationTargetSchema, UcpathTerminationTargetSchema, [target]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: input => input.emplId }, presentation: { title: input => input.expectedName },
  scenarios: ["separations-ucpath-termination/dry-run-preview"],
  flow: flow(UcpathTerminationTargetSchema).transaction("file-termination", { dependsOn: [],
    prepare: { uses: UcpathStageTermination, bind: ({ input }) => input },
    commit: { uses: UcpathCreateTermination, bind: ({ input }) => input },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
  }).build({ schema: UcpathCreateTermination.output, dependsOn: ["file-termination"], derive: ({ outputs }) => outputs["file-termination"].output }),
});

function fixture() {
  const original = WriteIntentRecordSchema.parse(FIXTURE_PARKED_WRITE_INTENT);
  const run = RunRecordSchema.parse({ ...runRecordOf({ seed: 1, workflow: descriptor.id, descriptor, claimGeneration: 1,
    lifecycle: { state: "parked-write", writeIntentId: original.writeIntentId, intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "Uncertain" } }),
    input: { raw: target, ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
      parsed: { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: target, protectedBindings: [] } } });
  assert.equal(original.status, "parked");
  const bindingProof = { ...original.bindingProof, taskId: UcpathCreateTermination.id, runId: run.envelope.runId,
    afterPrepareSpanPath: `${run.envelope.traceId}/file-termination/prepare` };
  const key = ucpathTerminationIdempotencyKey(target);
  const intent = WriteIntentRecordSchema.parse({ ...original, taskId: UcpathCreateTermination.id,
    workflowId: descriptor.id, runId: run.envelope.runId, itemId: run.envelope.itemId,
    idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
    bindingProof, bindingProofDigest: deriveWriteBindingProofDigest(bindingProof) });
  assert.equal(intent.status, "parked");
  const scope = { installationId: uuidOf(10), profileId: uuidOf(11) };
  const checkTarget = ParkedWriteCheckTargetSchema.parse({ ...scope, workerId: "findings-worker-1", expectedVersion: 1,
    membershipRevision: 1, processId: 1234, startedAt: NOW, controlBasis: { leaseGeneration: 1, controlRevision: 1 },
    runId: run.envelope.runId, runVersion: run.version, workflowId: descriptor.id, itemId: run.envelope.itemId,
    runAttempt: 1, traceId: run.envelope.traceId, nodeId: "file-termination", writeIntentId: intent.writeIntentId,
    intentVersion: intent.version, intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId,
    bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
  const ack = WorkerEffectAcknowledgementSchema.parse({ kind: "parked-write-check",
    result: ParkedWriteCheckResultSchema.parse({ commandId: uuidOf(12), requestedBy: "local-operator", target: checkTarget,
      observedAt: NOW, held: true, provenance: "system-probe", state: "unknown", code: "PARKED_CHECK_UNKNOWN",
      probeTaskId: UcpathReadTransactionFindings.id, evidenceDigest: "0".repeat(64) }),
    evidence: { schemaHash: deriveSchemaHash(UcpathReadTransactionFindings.output, "output"), value: scanOf() },
    findingsIdentity: { activityId: uuidOf(13), descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
      claimGeneration: 1, implFingerprint: taskImplFingerprint(UcpathReadTransactionFindings) } });
  assert.ok(ack.kind === "parked-write-check" && ack.findingsIdentity);
  const activity = { activityId: uuidOf(13), operation: "parked-write-check", runId: run.envelope.runId, workflow: descriptor.id,
    attempt: 1, traceId: run.envelope.traceId, nodeId: "file-termination", writeIntentId: intent.writeIntentId,
    generation: 1, writeAttemptId: intent.currentAttemptId, openedAt: NOW };
  const events = new Map<string, unknown>([[uuidOf(13), { payload: { kind: "recovery-activity-started", ...activity } }],
    [deriveStableUuid("recovery-activity-ended", uuidOf(13)), { payload: { kind: "recovery-activity-ended", ...activity, endedAt: NOW } }]]);
  const record = { commandId: ack.result.commandId, request: { type: "check-parked-write", source: "run-detail", requestedBy: "local-operator", target: ack.result.target },
    phase: { state: "succeeded", acknowledgement: ack } };
  const deps = { authorityIdentity: scope, canonical: { descriptors: { resolve: () => descriptor }, database: { authority: {
    runCheckpoints: { latest: () => undefined }, timelineEvents: { get: (id: string) => events.get(id) }, gateResults: { get: () => undefined },
  } } } } as unknown as RunDetailQueryDeps;
  const seal = () => { ack.result.evidenceDigest = FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({ target: ack.result.target, state: ack.result.state,
    code: ack.result.code, evidence: ack.evidence, findingsIdentity: ack.findingsIdentity }))); };
  seal();
  return { ack, record, deps, run, intent, events, seal };
}
function read(f: ReturnType<typeof fixture>) { return retainedUcpathFindings(f.deps, f.run, f.intent, f.record as unknown as WorkerControlRecord); }
function refuses(read: () => unknown) {
  assert.throws(read, (error: unknown) => error instanceof LogIdentityRefusedError && error.code === "LOGS_IDENTITY_REFUSED");
}

describe("retained UCPath findings", () => {
  it("serves the confirmed held read without a workflow task node, preserving Requested and pending authority", () => {
    const detail = read(fixture()); assert.equal(detail.state, "found");
    if (detail.state !== "found") throw new Error("findings fixture not served");
    assert.equal(detail.findings.rows[0]?.submittedAt, "11/01/26 1:02:03.123456PM");
    assert.deepEqual(detail.matches, [{ transactionId: "T123456", match: "exact" }]);
    assert.equal(detail.authoritative, false); assert.equal(detail.selectorVerification, "pending-live-verification");
  });
  it("distinguishes no held read from an empty complete retained read", () => {
    const f = fixture(); assert.deepEqual(retainedUcpathFindings(f.deps, f.run, f.intent, undefined), { state: "unavailable" });
    f.ack.evidence = { schemaHash: deriveSchemaHash(UcpathReadTransactionFindings.output, "output"), value: scanOf([]) }; f.seal();
    const empty = read(f); assert.ok(empty.state === "found"); assert.equal(empty.findings.rows.length, 0); assert.equal(empty.authoritative, false);
  });
  for (const patch of [{ descriptorVersion: 2 }, { contractFingerprint: "a".repeat(64) }, { claimGeneration: 2 }, { implFingerprint: "a".repeat(64) }]) {
    it(`refuses mismatched retained ${Object.keys(patch)[0]} even when its digest agrees`, () => {
      const f = fixture(); Object.assign(f.ack.findingsIdentity!, patch); f.seal(); refuses(() => read(f));
    });
  }
  for (const patch of [{ runVersion: 2 }, { intentGeneration: 2 }, { writeAttemptId: uuidOf(14) }, { occurrenceKeyDigest: "a".repeat(64) },
    { runId: uuidOf(14) }, { profileId: uuidOf(14) }, { traceId: "foreign-trace" }, { nodeId: "foreign-node" }]) {
    it(`refuses a foreign ${Object.keys(patch)[0]} even with a matching request and digest`, () => {
      const f = fixture(); Object.assign(f.ack.result.target, patch); f.seal(); refuses(() => read(f));
    });
  }
  it("refuses missing activity closure and foreign activity membership", () => {
    const f = fixture(); f.events.delete(deriveStableUuid("recovery-activity-ended", uuidOf(13))); refuses(() => read(f));
    const other = fixture(); other.events.set(uuidOf(13), { payload: { kind: "recovery-activity-started", runId: uuidOf(14) } }); refuses(() => read(other));
  });
  it("refuses a changed digest, stale output schema and invalid retained output", () => {
    const f = fixture(); f.ack.result.evidenceDigest = FingerprintSchema.parse("a".repeat(64)); refuses(() => read(f));
    for (const evidence of [{ schemaHash: "a".repeat(64), value: scanOf() },
      { schemaHash: deriveSchemaHash(UcpathReadTransactionFindings.output, "output"), value: { state: "read" } }]) {
      const changed = fixture(); changed.ack.evidence = SchemaBoundCanonicalValueSchema.parse(evidence); changed.seal(); refuses(() => read(changed));
    }
  });
  it("preserves capped findings and distinguishes action/date mismatches", () => {
    const capped = projectUcpathFindings(scanOf(Array.from({ length: 300 }, (_, index) => ({ ...row, transactionId: `T${100000 + index}` }))), target);
    assert.ok(capped.state === "found"); assert.equal(capped.findings.completeness.state, "incomplete"); assert.equal(capped.authoritative, false);
    const different = projectUcpathFindings(scanOf([{ ...row, action: "Hire" }, { ...row, transactionId: "T123457", startDate: "11/02/2026" }]), target);
    assert.ok(different.state === "found"); assert.deepEqual(different.matches.map(match => match.match), ["different", "different"]);
  });
  it("refuses foreign employees/names and invalid targets", () => {
    refuses(() => projectUcpathFindings(scanOf(), { ...target, emplId: "10800001" }));
    refuses(() => projectUcpathFindings(scanOf([{ ...row, displayedName: "Foreign, Person" }]), target));
    refuses(() => projectUcpathFindings(scanOf(), {}));
    assert.equal(projectUcpathFindings(scanOf([{ ...row, displayedName: "  JORDAN   FIXTURE " }]), target).state, "found");
  });
});
