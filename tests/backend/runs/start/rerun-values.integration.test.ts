import { StartPlanRecordSchema } from "../../../../src/models/run/start-plan.js";
import { RunSessionRecordSchema } from "../../../../src/models/run/session.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema,type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety-primitives.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { mappedTransactionHarness,rerunValuesDeps,rerunValuesHarness,valueShapeHarness } from "../../../support/fixtures/rerun-values-fixtures.js";
import { absentProbeEvidence } from "../../../support/fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function harness(writes = false) { const h = writes ? sourceBoundHarness() : rerunValuesHarness(); disposers.push(h.dispose); return h; }
type Harness = ReturnType<typeof harness>;
async function completed(h: Harness) { const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "done"); return h.fresh(queued); }
function request(run: RunRecord) { return { runId: run.envelope.runId, expectedVersion: run.version }; }
function snapshot(h: Harness, run: RunRecord) {
  return canonicalJsonStringify({ generation: h.database.getMeta().authorityGeneration,
    runs: h.database.authority.runs.listByWorkflow(h.descriptor.id),
    checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId),
    gates: h.database.authority.gateResults.listByRun(run.envelope.runId),
    writes: h.database.authority.writeIntents.listByRun(run.envelope.runId),
    lifecycleIds: h.lifecycleIds.minted(), planIds: h.planIds.minted(), queueRoots: h.queueRoots });
}
function checkpointsDeps(h: Harness, rows: readonly RunCheckpointRecord[]) {
  const deps = rerunValuesDeps(h);
  return { ...deps, database: { withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database),
    authority: { ...h.database.authority, runCheckpoints: { ...h.database.authority.runCheckpoints, listByItem: () => rows } } } };
}
function firstCheckpoint(h: Harness, run: RunRecord) { const cp = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, run.envelope.itemId)[0]; assert.ok(cp); return cp; }

describe("source-bound Rerun value read", () => {
  it("offers exact completed values and provenance without changing authority or minting plans", async () => {
    const h = harness(); const run = await completed(h); const before = snapshot(h, run);
    const result = readRerunValues(rerunValuesDeps(h), request(run));
    assert.equal(result.state, "available"); if (result.state !== "available") throw new Error("valid source refused");
    const cp = firstCheckpoint(h, run);
    assert.equal(result.snapshot.source.runId, run.envelope.runId);
    assert.equal(result.snapshot.source.version, run.version);
    assert.deepEqual(result.snapshot.sourceInput, { state: "available", value: run.input.parsed.value });
    assert.equal(result.snapshot.values[0]?.state, "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available");
    assert.equal(value.value, "10812345");
    assert.equal(value.nodeId, cp.nodeId); assert.equal(value.fieldPath, "eid");
    assert.deepEqual(value.provenance, cp.provenance[0]);
    assert.deepEqual(value.checkpoint, { attempt: cp.attempt, claimGeneration: cp.claimGeneration, writtenAt: cp.writtenAt });
    assert.equal(result.snapshot.steps[0]?.state, "completed");
    assert.deepEqual(result.snapshot.transactions, []);
    assert.equal(snapshot(h, run), before);
  });
  it("inherits the source plan choice and honors explicit Auto and number overrides", async () => {
    const h = harness();
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }],
      dryRun: false, workers: 7, selectedStepKeys });
    const queued = h.start(plan); assert.equal((await h.execute(queued)).state, "done");
    const run = h.fresh(queued);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    assert.equal(result.snapshot.workers, 7);
    const input = { workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(run), intent: "rerun", selectedStepKeys } };
    assert.equal(h.planner.plan(input).workers, 7);
    assert.equal(h.planner.plan({ ...input, workers: "auto" }).workers, "auto");
    assert.equal(h.planner.plan({ ...input, workers: 2 }).workers, 2);
  });
  it.each(["session", "plan", "mismatch"] as const)("refuses a missing or mismatched source %s even with an explicit override", async missing => {
    const h = harness(); const run = await completed(h); const deps = rerunValuesDeps(h);
    const authority = { ...h.database.authority,
      ...(missing === "session" ? { runSessions: { ...h.database.authority.runSessions, get: () => undefined } }
        : { startPlans: { ...h.database.authority.startPlans, get: (id: string) => {
          const plan = h.database.authority.startPlans.get(id);
          return missing === "plan" || plan === undefined ? undefined : StartPlanRecordSchema.parse({ ...plan, workflowId: "wrong-workflow" });
        } } }),
    };
    assert.deepEqual(readRerunValues({ ...deps, database: { ...deps.database, authority,
      withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(run)),
    { state: "refused", code: "source-invalid" });
    const { createStartPlanService } = await import("../../../../src/backend/runs/commands/start-plan-service.js");
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const planner = createStartPlanService({ authority: { withAuthorityTransaction: work => h.database.withAuthorityTransaction(() => work(authority)) },
      authorityRead: h.database, descriptors: { resolve: () => h.descriptor }, clock: h.clock, ids: h.planIds,
      planTtlMs: 600_000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    assert.throws(() => planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false,
      workers: "auto", selectedStepKeys, rerunSource: { ...request(run), intent: "rerun", selectedStepKeys } }),
    error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
  });
  it.each(["sessionless", "intake"] as const)("uses Auto for a legitimate %s source without a start choice", async origin => {
    const h = harness(); const original = await completed(h); const deps = rerunValuesDeps(h);
    const { sessionId: _sessionId, ...sessionless } = original;
    const run = origin === "sessionless" ? RunRecordSchema.parse(sessionless) : original;
    const sessions = h.database.authority.runSessions;
    const result = readRerunValues({ ...deps, reader: { read: () => ({ state: "present", disposition: "live", run }) },
      database: { authority: { ...h.database.authority, runSessions: { ...sessions, get: (id: string) => {
        const session = sessions.get(id); assert.ok(session);
        return RunSessionRecordSchema.parse({ ...session, origin: { kind: "intake-manifest", intakeManifestId: h.ids.uuid(), actorId: "local-operator" } });
      } } }, withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database) } }, request(run));
    assert.ok(result.state === "available"); assert.equal(result.snapshot.workers, "auto");
  });
  it("round-trips attribution into the existing planner and rejects an edited value retaining attribution", async () => {
    const h = harness(); const run = await completed(h);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available");
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const input = { workflowId: h.descriptor.id, submissions: [{ eid: value.value }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(run), intent: "rerun", selectedStepKeys,
        copiedFrom: [{ nodeId: value.nodeId, fieldPath: value.fieldPath, targetFieldPath: value.targetFieldPath }] } };
    assert.ok(h.planner.plan(input).rerun?.source.copiedFrom?.length);
    assert.throws(() => h.planner.plan({ ...input, submissions: [{ eid: "10899999" }] }),
      (error) => error instanceof RerunRefusedError && error.code === "invalid-value");
    assert.ok(h.planner.plan({ ...input, submissions: [{ eid: "10899999" }], rerunSource: { ...input.rerunSource, copiedFrom: [] } }));
  });
  it("canonical absence and stale versions win over retained evidence", async () => {
    const h = harness(); const run = await completed(h); const before = snapshot(h, run);
    const deps = rerunValuesDeps(h);
    assert.deepEqual(readRerunValues({ ...deps, reader: { read: () => ({ state: "absent", runId: run.envelope.runId }) } }, request(run)), { state: "refused", code: "target-not-found" });
    assert.deepEqual(readRerunValues(deps, { ...request(run), expectedVersion: run.version - 1 }), { state: "refused", code: "source-stale" });
    assert.deepEqual(readRerunValues({ ...deps, descriptors: { resolve: () => undefined } }, request(run)), { state: "refused", code: "descriptor-mismatch" });
    assert.equal(snapshot(h, run), before);
  });
  it("refuses active and cancelled canonical sources", () => {
    const h = harness(); const queued = h.start(h.proposal());
    assert.deepEqual(readRerunValues(rerunValuesDeps(h), request(queued)), { state: "refused", code: "source-ineligible" });
    const cancelled = requireLifecycleApplied(h.lifecycle.transition({ commandId: h.ids.uuid(), ...request(queued),
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } }));
    assert.deepEqual(readRerunValues(rerunValuesDeps(h), request(cancelled)), { state: "refused", code: "source-ineligible" });
  });
  it("never borrows another run's checkpoint", async () => {
    const h = harness(); const run = await completed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [RunCheckpointRecordSchema.parse({ ...cp, runId: h.ids.uuid() })]);
    const result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.equal(result.snapshot.steps[0]?.state, "unfinished");
    assert.equal(result.snapshot.values[0]?.state, "unavailable");
  });
  for (const [name, patch] of [
    ["descriptor", { descriptorVersion: 99 }], ["attempt", { attempt: 99 }], ["future execution", { claimGeneration: 99 }],
    ["schema", { output: { schemaHash: "f".repeat(64), value: { eid: "10812345" } } }],
    ["payload", { output: { value: { eid: "bad" } } }],
  ] as const) it(`refuses mismatched checkpoint ${name}`, async () => {
    const h = harness(); const run = await completed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [RunCheckpointRecordSchema.parse({ ...cp, ...patch,
      output: "output" in patch ? { ...cp.output, ...patch.output } : cp.output })]);
    assert.deepEqual(readRerunValues(deps, request(run)), { state: "refused", code: "source-invalid" });
  });
  it("reports missing provenance rather than inventing an observation date", async () => {
    const h = harness(); const run = await completed(h); const cp = firstCheckpoint(h, run);
    const deps = checkpointsDeps(h, [{ ...cp, provenance: [] }]);
    const result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.equal(result.snapshot.values[0]?.state, "unavailable");
    assert.ok(result.snapshot.values[0]?.state === "unavailable" && result.snapshot.values[0].reason === "provenance-unavailable");
  });
  it("does not label operator assertions or later failed work as completed", async () => {
    const h = harness(); const run = await completed(h); const cp = firstCheckpoint(h, run);
    const asserted = RunCheckpointRecordSchema.parse({ ...cp, assertion: { step: "read", assertedAt: cp.writtenAt } });
    const deps = checkpointsDeps(h, [asserted]);
    let result = readRerunValues(deps, request(run)); assert.ok(result.state === "available");
    assert.deepEqual(result.snapshot.steps[0]?.nodes[0], { nodeId: "read", state: "unfinished", reason: "operator-asserted" });
    result = readRerunValues({ ...rerunValuesDeps(h), executions: () => [{ nodeId: "read", attempt: run.envelope.attempt, startedAt: "2099-01-01T00:00:00.000Z", outcome: "failed" }] }, request(run));
    assert.ok(result.state === "available"); assert.equal(result.snapshot.steps[0]?.state, "failed");
    result = readRerunValues({ ...rerunValuesDeps(h), executions: () => [{ nodeId: "read", attempt: run.envelope.attempt, startedAt: "2099-01-01T00:00:00.000Z" }] }, request(run));
    assert.ok(result.state === "available"); assert.equal(result.snapshot.steps[0]?.state, "unfinished");
  });
  for (const disposition of ["committed", "observed-present"] as const) it(`serves ${disposition} transaction coordinates without granting consent`, async () => {
    const h = harness(true);
    h.world.probeResults.push(disposition === "committed" ? absentProbeEvidence(h.clock.now().toISOString())
      : { state: "present", proof: { transactionId: "T123456" } });
    const run = await completed(h); const before = snapshot(h, run);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available", JSON.stringify(result));
    assert.ok(result.snapshot.transactions.length > 0);
    assert.equal(result.snapshot.transactions[0]?.disposition, disposition);
    assert.equal(/acknowledgment|confirmationCommandId|businessKeyDigest/u.test(JSON.stringify(result)), false);
    assert.equal(snapshot(h, run), before);
  });
  it("withholds captured protected values, embedded copies, absent leaves and invalid targets", async () => {
    const h = valueShapeHarness(); disposers.push(h.dispose);
    const queued = h.start(h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", documentNumber: "PRIVATE987" }],
      dryRun: false, selectedStepKeys: h.descriptor.timeline.map(({ key }) => key) }));
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const { workerId, workerLifetime } = testWorkerLifetime(h.database, h.descriptor.id, 1);
    const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id,
      workerId, workerLifetime, runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.equal(claimed.envelope.runId, queued.envelope.runId);
    const ended = h.database.authority.runs.transition({ ...request(claimed), now: h.clock.now().toISOString(),
      claim: { workerId, claimGeneration: claimed.claimGeneration }, lifecycle: { state: "terminal", outcome: "interrupted", endedAt: h.clock.now().toISOString() } });
    assert.equal(ended.state, "applied"); const run = h.fresh(claimed);
    const node = descriptorRuntimeNodes(h.descriptor).find(({ id }) => id === "read"); assert.ok(node?.kind === "task");
    const value = { eid: "10812345", documentNumber: "PRIVATE987", embedded: "record PRIVATE987", invalidEid: "invalid" };
    const now = h.clock.now().toISOString();
    h.database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ workflowId: h.descriptor.id,
      itemId: run.envelope.itemId, runId: run.envelope.runId, nodeId: "read", attempt: run.envelope.attempt, claimGeneration: 1,
      output: { schemaHash: deriveSchemaHash(node.uses.output, "output"), value }, descriptorVersion: h.descriptor.version,
      contractFingerprint: h.descriptor.contractFingerprint, implFingerprint: "b".repeat(64), writtenAt: now,
      provenance: Object.keys(value).map((path) => ({ path, source: "live", observedAt: now, originalObservedAt: now })),
    }));
    const protectedRun = { ...run, input: { ...run.input, parsed: { ...run.input.parsed, protectedBindings: [{
      kind: "test-data-local" as const, inputPath: "documentNumber" as const,
      name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: "10000000-0000-4000-8000-000000000001",
    }] } } };
    const result = readRerunValues({ ...rerunValuesDeps(h), reader: { read: () => ({ state: "present", disposition: "live", run: protectedRun }) } }, request(run));
    assert.ok(result.state === "available");
    assert.deepEqual(result.snapshot.values.map((value) => value.state === "available" ? "available" : value.reason),
      ["available", "protected", "protected", "not-recorded", "target-invalid"]);
    assert.equal(JSON.stringify(result).includes("PRIVATE987"), false);
    assert.deepEqual(result.snapshot.sourceInput, { state: "unavailable", reason: "protected" });
    assert.equal(result.snapshot.source.outcome, "interrupted");
    assert.deepEqual(result.snapshot.steps.map(({ state }) => state), ["completed", "unfinished"]);
  });
  it("deletion wins over retained checkpoints and never resurrects the source", async () => {
    const h = harness(); const run = await completed(h);
    const cp = firstCheckpoint(h, run);
    const deleted=h.kernel.execute({commandId:h.ids.uuid(),requestedAt:h.clock.now().toISOString(),requestedBy:"local-operator",
      source:"dashboard",family:"run",type:"delete",target:request(run)});
    assert.equal(deleted.state,"applied",JSON.stringify(deleted));
    assert.ok(h.database.authority.deletedRuns.get(run.envelope.runId));
    const before = snapshot(h, run);
    assert.deepEqual(readRerunValues(checkpointsDeps(h, [cp]), request(run)), { state: "refused", code: "target-deleted" });
    assert.equal(snapshot(h, run), before);
  });

  for (const kind of ["nested-schema", "proof-link"] as const) it(`refuses transaction ${kind} corruption`, async () => {
    const h = harness(true); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    const run = await completed(h); const cp = firstCheckpoint(h, run);
    const outcome = TransactionOutcomeSchema.parse(cp.output.value);
    const proof = kind === "nested-schema" ? { ...outcome.proof, schemaHash: "f".repeat(64) }
      : { ...outcome.proof, value: { transactionId: "T999999" } };
    const altered = RunCheckpointRecordSchema.parse({ ...cp, output: { ...cp.output, value: { ...outcome, proof } } });
    assert.deepEqual(readRerunValues(checkpointsDeps(h, [altered]), request(run)), { state: "refused", code: "source-invalid" });
  });

  it("classifies a real failed source from its retained failure without exposing its diagnostic text", async () => {
    const h = harness(true); h.world.subjectReadThrows = new Error("synthetic private diagnostic");
    const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "failed"); const run = h.fresh(queued);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available", JSON.stringify(result));
    assert.equal(result.snapshot.source.outcome, "failed"); assert.equal(result.snapshot.steps[0]?.state, "failed");
    assert.equal(JSON.stringify(result).includes("synthetic private diagnostic"), false);
  });

  it("refuses an otherwise eligible source while the same item has an attempting write", async () => {
    const h = harness(); const run = await completed(h); const deps = rerunValuesDeps(h);
    const attempting = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, workflowId: h.descriptor.id,
      itemId: run.envelope.itemId, runId: run.envelope.runId, runAttempt: run.envelope.attempt });
    const database = { withAuthorityReadSnapshot: h.database.withAuthorityReadSnapshot.bind(h.database),
      authority: { ...h.database.authority, writeIntents: { ...h.database.authority.writeIntents,
        listAttemptingByItem: () => [attempting] } } };
    assert.deepEqual(readRerunValues({ ...deps, database }, request(run)), { state: "refused", code: "source-ineligible" });
  });

  it("offers a transaction output as attributed input while the existing planner still requires repeat consent", async () => {
    const h = mappedTransactionHarness(); disposers.push(h.dispose);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString())); const run = await completed(h);
    const result = readRerunValues(rerunValuesDeps(h), request(run)); assert.ok(result.state === "available");
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available", JSON.stringify(value));
    assert.equal(value.value, "T123456"); assert.equal(value.fieldPath, "output.value.transactionId");
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", memo: value.value }], dryRun: false, selectedStepKeys,
      rerunSource: { ...request(run), intent: "rerun", selectedStepKeys,
        copiedFrom: [{ nodeId: value.nodeId, fieldPath: value.fieldPath, targetFieldPath: value.targetFieldPath }] } });
    assert.equal(plan.rerun?.warnings.length, 1); assert.equal(plan.rerun?.acknowledgment, undefined);
    assert.equal(h.kernel.execute(h.command(plan)).state, "confirmation-required");
  });

  it("never echoes malformed stored JSON and still propagates operational storage failures", async () => {
    const h = harness(); const run = await completed(h); const deps = rerunValuesDeps(h);
    assert.deepEqual(readRerunValues({ ...deps, reader: { read: () => { throw new SyntaxError("PRIVATE_SOURCE_TEXT"); } } }, request(run)),
      { state: "refused", code: "source-invalid" });
    const busy = new Error("SQLITE_BUSY");
    assert.throws(() => readRerunValues({ ...deps, reader: { read: () => { throw busy; } } }, request(run)), (error) => error === busy);
  });

  it("retains earlier same-run attempts and chooses the latest execution independently of repository order", async () => {
    const h = harness(); const source = await completed(h); const cp = firstCheckpoint(h, source);
    // Retained completed attempt 2 still exposes checkpoints from its earlier execution.
    const run = RunRecordSchema.parse({ ...source, envelope: { ...source.envelope, attempt: 2 }, claimGeneration: 2, completion: {...source.completion, claim: {...source.completion?.claim, claimGeneration: 2}} });
    const reader = { read: () => ({ state: "present" as const, disposition: "live" as const, run }) };
    const earlier = readRerunValues({ ...checkpointsDeps(h, [cp]), reader }, request(run)); assert.ok(earlier.state === "available");
    assert.ok(earlier.snapshot.values[0]?.state === "available"); assert.equal(earlier.snapshot.values[0].checkpoint.attempt, 1);
    const later = RunCheckpointRecordSchema.parse({ ...cp, attempt: 2, claimGeneration: 2,
      output: { ...cp.output, value: { eid: "10899999" } } });
    const newest = readRerunValues({ ...checkpointsDeps(h, [later, cp]), reader }, request(run)); assert.ok(newest.state === "available");
    assert.ok(newest.snapshot.values[0]?.state === "available"); assert.equal(newest.snapshot.values[0].value, "10899999");
    const interrupted = readRerunValues({ ...checkpointsDeps(h, [cp]), reader,
      executions: () => [{ nodeId: "read", attempt: 2, startedAt: cp.writtenAt }] }, request(run));
    assert.ok(interrupted.state === "available"); assert.equal(interrupted.snapshot.steps[0]?.state, "unfinished");
  });

});
