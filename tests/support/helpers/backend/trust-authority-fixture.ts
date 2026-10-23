import { testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/models/config/runtime-generation.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { CONFIG_SNAPSHOT, HASH_A } from "../../fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { personLookupQueuedRun } from "../phase1f-executor-harness.js";
import { makeWorld, uuidOf } from "./dashboard-harness.js";

/** Trust acceptance uses actual SQLite service reads; the empty projector supplies evidence only. */
export function trustWorld() {
  const world = makeWorld();
  const database = AuthorityDatabase.open({ path: join(world.stateRoot, "trust.sqlite"),
    busyTimeoutMs: 250, migrationOwner: "trust-linkage-test" }, world.clock);
  testWorkerPorts(database, world.clock, { path: join(world.stateRoot, "trust.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  const active = database.authority.runtimeConfig.get();
  assert.ok(active);
  const slots = database.authority.workerSlots.list(personLookupDescriptor.id).filter(slot => slot.retiredAt === null && slot.poolIndex === 1);
  assert.equal(slots.length, 1);
  const workerId = slots[0]?.workerId;
  assert.ok(workerId);
  const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({ generation: active.generation, settingsRevision: active.settingsRevision,
    settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint });
  let next = 900;
  const service = new RunRecordService({ database, clock: world.clock,
    ids: { uuid: () => uuidOf(next++) }, publishQueued: () => {} });
  const reader = createTrustRunReader(database, world.clock);
  const receipts = createReceiptService({ database, runReader: reader, descriptors: [personLookupDescriptor] });
  const deps: RunDetailQueryDeps = { timeline: database.authority.timelineEvents, stateRoot: world.stateRoot, projection: world.projection, runReader: reader,
    authority: { getRun: () => { throw new Error("RAW_RUN_READ_FORBIDDEN"); },
      listCheckpoints: (workflow, item) => database.authority.runCheckpoints.listByItem(workflow, item),
      latestCheckpoint: (workflow, item, node) => database.authority.runCheckpoints.latest(workflow, item, node),
      getWriteIntent: id => database.authority.writeIntents.get(id),
      listGateResults: id => database.authority.gateResults.listByRun(id) },
    descriptors: { resolve: () => undefined }, trust: receipts };
  const create = (seed: number) => {
    const template = RunRecordSchema.parse(personLookupQueuedRun({ runId: uuidOf(seed) }));
    const outcome = service.create({ commandId: uuidOf(seed), code: personLookupDescriptor.code,
      matchKey: `trust-item-${String(seed)}`, workflow: personLookupDescriptor.id,
      descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
      configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: template.envelope.resolvedInstance, priority: "bulk", shape: "single", dryRun: true,
      input: template.input, runtimeConfig });
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("fixture create failed");
    return outcome.run;
  };
  const cancel = (run: RunRecord, seed: number) => {
    const outcome = service.transition({ commandId: uuidOf(seed), runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: world.clock.now().toISOString() } });
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("fixture cancel failed");
    return outcome.run;
  };
  const fail = (run: RunRecord, seed: number) => {
    const now = world.clock.now().toISOString();
    const claimMember1 = database.authority.workerSlots.get(workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, run.envelope.workflow, claimMember1.poolIndex).workerLifetime, workflow: run.envelope.workflow, workerId, now });
    assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("fixture claim failed");
    assert.equal(claimed.run.envelope.runId, run.envelope.runId);
    const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
    const validating = database.authority.runs.transition({ runId: run.envelope.runId,
      expectedVersion: claimed.run.version, claim, now,
      lifecycle: { state: "validating", workerId, claimedAt: now, heartbeatAt: now } });
    assert.equal(validating.state, "applied"); if (validating.state !== "applied") throw new Error("fixture validation failed");
    database.terminalizeFailure(personLookupDescriptor, {
      failure: { failureId: uuidOf(seed), fingerprint: HASH_A, runId: run.envelope.runId,
        traceId: run.envelope.traceId, attempt: run.envelope.attempt, workflowId: run.envelope.workflow,
        code: "INPUT_INVALID", summary: "trust fixture failed validation", transient: false,
        writeState: "not-attempted", occurredAt: now,
        causeChain: [{ code: "INPUT_INVALID", summary: "invalid input", role: "primary", transient: false }],
        remediation: [{ kind: "operator-action", message: "Correct the input" }] },
      authorization: { kind: "failed", runId: run.envelope.runId, workflowId: run.envelope.workflow,
        attempt: run.envelope.attempt, descriptorVersion: run.envelope.descriptorVersion,
        contractFingerprint: run.envelope.contractFingerprint, expectedVersion: validating.run.version,
        claim, authorizedAt: now, failureId: uuidOf(seed) },
    });
    const result = reader.read(run.envelope.runId);
    assert.equal(result.state, "present"); if (result.state !== "present") throw new Error("failed fixture run missing");
    return result.run;
  };
  return { world, database, workerId, service, reader, receipts, deps, runtimeConfig, create, cancel, fail,
    dispose() { database.close(); world.dispose(); } };
}

/** Real folded evidence deliberately contradicts the separate SQLite lifecycle oracle. */
export function foldTrustGate(world: ReturnType<typeof makeWorld>, run: RunRecord, state: "open" | "resolved") {
  // The fold's separate SQLite fixture still needs the exact retained owner;
  // its deliberately stale gate evidence does not fabricate a new run.
  world.authority.records.set(run.envelope.runId, run);
  const e = run.envelope; const ts = world.clock.now().toISOString();
  if (world.projection.runFold(e.runId) === undefined) world.writer.emit({ t: "run.queued", kind: "run", ts, workflow: e.workflow, runId: e.runId,
    attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId,
    shape: e.shape, priority: e.priority, dryRun: e.dryRun, actorId: "local-operator", title: "Trust fold fixture",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
  const address = { ts, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId, gate: "identity-approval" };
  world.writer.emit({ ...address, t: "gate.opened" });
  if (state === "resolved") world.writer.emit({ ...address, t: "gate.resolved", resolutionKey: "resolved", resultHash: HASH_A });
  const fold = world.projection.runFold(e.runId); assert.ok(fold);
  assert.equal(fold.openGates.length, state === "open" ? 1 : 0);
  if (state === "resolved") assert.ok(fold.resolvedGates.length > 0);
  return fold;
}
