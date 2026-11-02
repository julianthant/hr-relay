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
import { RunCheckpointRecordSchema, checkpointLookupKey } from "../../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference } from "../../../../../src/models/events/timeline.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/models/workflow/presentation.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { deriveStableUuid } from "../../../../../src/rules/identity/identifiers.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest, WriteIntentRecordSchema } from "../../../../../src/rules/write-safety/write-safety.js";
import { flow } from "../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../../src/workflow-kit/validation/build-manifest.js";
import { FIXTURE_PARKED_WRITE_INTENT } from "../../../../support/fixtures/dashboard/run-detail/gates-park.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { separationsDescriptor } from "../../../../support/helpers/registered-workflows.js";

const target = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Fixture, Jordan", emplRecord: "0",
  effectiveDate: "11/01/2026", template: "UC_VOL_TERM", reasonCode: "Attend School", lastDateWorked: "10/31/2026", initiatorComments: "Fixture" });
const row = { transactionId: "T123456", emplId: target.emplId, displayedName: target.expectedName,
  action: "Terminatn", approvalStatus: "Pending", startDate: target.effectiveDate,
  submittedAt: "11/01/26 1:02:03.123456PM", detailVerified: true };
function scanOf(rows: readonly unknown[] = [row]) {
  return UcpathTransactionFindingsReadSchema.parse({ state: "read", emplId: target.emplId, rows, scannedRowCount: rows.length,
    completeness: rows.length === 300 ? { state: "incomplete", reason: "search-cap", reportedRowCount: 300 }
      : { state: "complete", reportedRowCount: rows.length },
    observedAt: "2026-11-01T21:03:00.000Z", source: "ss-smart-hr-list-and-detail" });
}

function descriptorOf() {
  const first = flow(UcpathTerminationTargetSchema).step("findings", UcpathReadTransactionFindings, {
    dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ emplId: input.emplId, expectedName: input.expectedName }),
  });
  const reads = first.step("other-findings", UcpathReadTransactionFindings, {
    dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ emplId: input.emplId, expectedName: input.expectedName }),
  });
  return defineWorkflowDescriptor({ id: "findings-fixture", version: 1, contractFingerprint: "e".repeat(64), code: "ff",
    label: "Findings fixture", icon: "Search", category: "operations",
    canonicalInput: defineCanonicalInput(UcpathTerminationTargetSchema, UcpathTerminationTargetSchema, [target]),
    inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {}, details: [], identity: { matchKey: input => input.emplId }, presentation: { title: input => input.expectedName },
    scenarios: ["separations-ucpath-termination/dry-run-preview"],
    flow: reads.transaction("file-termination", { dependsOn: ["findings"],
      prepare: { uses: UcpathStageTermination, bind: ({ input }) => input },
      commit: { uses: UcpathCreateTermination, bind: ({ input }) => input },
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
    }).build({ schema: UcpathCreateTermination.output, dependsOn: ["file-termination"], derive: ({ outputs }) => outputs["file-termination"].output }),
  });
}

function fixture(duplicate = false) {
  const descriptor = descriptorOf();
  const original = WriteIntentRecordSchema.parse(FIXTURE_PARKED_WRITE_INTENT);
  assert.equal(original.status, "parked");
  const run = RunRecordSchema.parse({ ...runRecordOf({ seed: 1, workflow: descriptor.id, descriptor, claimGeneration: 1,
    lifecycle: { state: "parked-write", writeIntentId: original.writeIntentId, intentGeneration: 1,
      parkedAt: "2026-11-01T22:00:00.000Z", code: "unknown", message: "Uncertain" } }),
    input: { raw: target, ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
      parsed: { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: target, protectedBindings: [] } } });
  const bindingProof = { ...original.bindingProof, taskId: UcpathCreateTermination.id, runId: run.envelope.runId,
    afterPrepareSpanPath: `${run.envelope.traceId}/file-termination/prepare` };
  const key = ucpathTerminationIdempotencyKey(target);
  const intent = WriteIntentRecordSchema.parse({ ...original, taskId: UcpathCreateTermination.id,
    workflowId: descriptor.id, runId: run.envelope.runId, itemId: run.envelope.itemId,
    idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
    bindingProof, bindingProofDigest: deriveWriteBindingProofDigest(bindingProof) });
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: descriptor.id, itemId: run.envelope.itemId,
    nodeId: "findings", attempt: 1, claimGeneration: 1, runId: run.envelope.runId,
    descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, UcpathReadTransactionFindings.id),
    output: { schemaHash: deriveSchemaHash(UcpathReadTransactionFindings.output, "output"), value: scanOf() },
    provenance: [], writtenAt: "2026-11-01T21:04:00.000Z" });
  const checkpoints = new Map([["findings", checkpoint]]);
  if (duplicate) checkpoints.set("other-findings", RunCheckpointRecordSchema.parse({ ...checkpoint, nodeId: "other-findings" }));
  const eventOf = (stored: typeof checkpoint) => ({ payload: { kind: "checkpoint-recorded", runId: stored.runId,
    workflow: stored.workflowId, attempt: stored.attempt, claimGeneration: stored.claimGeneration, checkpoint: timelineCheckpointReference(stored) } });
  const idOf = (stored: typeof checkpoint) => deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
    stored.workflowId, stored.itemId, stored.nodeId, stored.attempt, stored.claimGeneration));
  const events = new Map([...checkpoints.values()].map(stored => [idOf(stored), eventOf(stored)]));
  const deps = { canonical: { descriptors: { resolve: () => descriptor }, database: { authority: {
    runCheckpoints: { latest: (_workflow: string, _item: string, nodeId: string) => checkpoints.get(nodeId) },
    timelineEvents: { get: (id: string) => events.get(id) }, gateResults: { get: () => undefined },
  } } } } as unknown as RunDetailQueryDeps;
  return { deps, run, intent, checkpoint, checkpoints, events, eventOf, idOf };
}

function refuses(read: () => unknown) {
  assert.throws(read, (error: unknown) => error instanceof LogIdentityRefusedError && error.code === "LOGS_IDENTITY_REFUSED");
}

describe("retained UCPath findings", () => {
  it("serves exact confirmed task evidence, preserves Requested microseconds and never grants authority", () => {
    const f = fixture();
    const detail = retainedUcpathFindings(f.deps, f.run, f.intent);
    assert.equal(detail.state, "found");
    if (detail.state !== "found") throw new Error("findings fixture not served");
    assert.equal(detail.findings.rows[0]?.submittedAt, "11/01/26 1:02:03.123456PM");
    assert.deepEqual(detail.matches, [{ transactionId: "T123456", match: "exact" }]);
    assert.equal(detail.authoritative, false); assert.equal(detail.selectorVerification, "pending-live-verification");
  });

  it("distinguishes missing retained reads from a verified empty complete read", () => {
    const f = fixture(); f.checkpoints.clear();
    assert.deepEqual(retainedUcpathFindings(f.deps, f.run, f.intent), { state: "unavailable" });
    const empty = projectUcpathFindings(scanOf([]), target);
    assert.equal(empty.state, "found");
    if (empty.state === "found") { assert.equal(empty.findings.completeness.state, "complete"); assert.equal(empty.authoritative, false); }
  });

  it("does not manufacture a read for the current descriptor, which declares no findings task", () => {
    const f = fixture();
    const run = RunRecordSchema.parse({ ...f.run, envelope: { ...f.run.envelope, workflow: separationsDescriptor.id,
      descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint } });
    const deps = { ...f.deps, canonical: { ...f.deps.canonical!, descriptors: { resolve: () => separationsDescriptor } } };
    assert.deepEqual(retainedUcpathFindings(deps, run, f.intent), { state: "unavailable" });
  });

  for (const patch of [{ workflowId: "foreign" }, { itemId: "00000000-0000-4000-8000-000000000099" },
    { nodeId: "foreign" }, { runId: "00000000-0000-4000-8000-000000000099" }, { attempt: 2 }, { claimGeneration: 2 },
    { descriptorVersion: 2 }, { contractFingerprint: "a".repeat(64) }, { implFingerprint: "a".repeat(64) }]) {
    it(`refuses mismatched checkpoint ${Object.keys(patch)[0]} even with a matching confirmation`, () => {
      const f = fixture(); const changed = RunCheckpointRecordSchema.parse({ ...f.checkpoint, ...patch });
      f.checkpoints.set("findings", changed); f.events.set(f.idOf(changed), f.eventOf(changed));
      refuses(() => retainedUcpathFindings(f.deps, f.run, f.intent));
    });
  }

  it("refuses a missing confirmation and a confirmed event whose output digest moved", () => {
    const f = fixture(); f.events.clear();
    refuses(() => retainedUcpathFindings(f.deps, f.run, f.intent));
    const event = f.eventOf(f.checkpoint); event.payload.checkpoint.outputDigest = "0".repeat(64);
    f.events.set(f.idOf(f.checkpoint), event);
    refuses(() => retainedUcpathFindings(f.deps, f.run, f.intent));
  });

  it("refuses a stale output schema and invalid payload even when their stored event agrees", () => {
    for (const output of [{ ...fixture().checkpoint.output, schemaHash: "a".repeat(64) },
      { ...fixture().checkpoint.output, value: { state: "read" } }]) {
      const f = fixture(); const stored = RunCheckpointRecordSchema.parse({ ...f.checkpoint, output });
      f.checkpoints.set("findings", stored); f.events.set(f.idOf(stored), f.eventOf(stored));
      refuses(() => retainedUcpathFindings(f.deps, f.run, f.intent));
    }
  });

  it("refuses ambiguous retained task occurrences", () => {
    const f = fixture(true); refuses(() => retainedUcpathFindings(f.deps, f.run, f.intent));
  });

  it("preserves the cap and distinguishes action/date mismatches", () => {
    const capped = projectUcpathFindings(scanOf(Array.from({ length: 300 }, (_, index) => ({ ...row, transactionId: `T${100000 + index}` }))), target);
    assert.equal(capped.state, "found");
    if (capped.state === "found") { assert.equal(capped.findings.completeness.state, "incomplete"); assert.equal(capped.authoritative, false); }
    const different = projectUcpathFindings(scanOf([{ ...row, action: "Hire" }, { ...row, transactionId: "T123457", startDate: "11/02/2026" }]), target);
    if (different.state !== "found") throw new Error("findings fixture not served");
    assert.deepEqual(different.matches.map(match => match.match), ["different", "different"]);
  });

  it("refuses foreign employees/names and invalid target inputs", () => {
    refuses(() => projectUcpathFindings(scanOf(), { ...target, emplId: "10800001" }));
    refuses(() => projectUcpathFindings(scanOf([{ ...row, displayedName: "Foreign, Person" }]), target));
    refuses(() => projectUcpathFindings(scanOf(), {}));
    assert.equal(projectUcpathFindings(scanOf([{ ...row, displayedName: "  JORDAN   FIXTURE " }]), target).state, "found");
  });
});
