import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { testRunLifecycle, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_RUN_ID, absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessions } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

const { roots, openDatabases, createHarness, runCommand } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("write resolution", () => {
  async function parkOnWrite(harness: Harness) {
    const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
    const world = createWriteFixtureWorld(), stores = buildWriteFixtureRegistry(world), sessions = writeFixtureSessions(world);
    const scheduler = new ManualScheduler(harness.clock), ids = sequentialIdFactory("b"), emitter = recordingEmitter().emitter, log = recordingLogger().log;
    harness.clock.advanceWall(Date.parse("2026-08-03T09:00:00.000Z") - harness.clock.nowMs());
    const run = RunRecordSchema.parse(writeFixtureQueuedRun());
    harness.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } });
    const ports = testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "kernel.sqlite"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
    const slot = harness.database.authority.workerSlots.list(writeFixtureDescriptor.id)[0];
    world.probeResults.push(absentProbeEvidence(NOW)); world.commitThrows = new Error("probe returned unknown");
    await runWorkerLoop({ ...ports, workflowId: writeFixtureDescriptor.id, workerId: slot.workerId, descriptor: writeFixtureDescriptor,
      stores, authority: harness.database, sessionFactory: sessions.factory, emitter, clock: harness.clock, ids, scheduler,
      taskDeadlineMs: 60_000, sessionAcquireMs: 20_000, duoCeremony: await fixtureDuoCeremonyGates(harness.clock), heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000, log, stopSignal: new AbortController().signal, exitWhenIdle: true,
      writeSequencerFor: manager => createWriteSequencer({ lifecycle: testRunLifecycle(harness.database, harness.clock), stores,
        authority: harness.database, sessions: manager, emitter, clock: harness.clock, ids, scheduler, taskDeadlineMs: 60_000,
        operator: "local-operator", log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT }) });
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(parked && parked.lifecycle.state === "parked-write");
    const intent = harness.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID)[0]; assert.ok(intent.status === "parked"); if (intent.status !== "parked") throw new Error("fixture intent must be parked");
    return { runId: WRITE_FIXTURE_RUN_ID, version: parked.version, intent };
  }

  it("resolves a parked write through the typed executor seam inside the command transaction", async () => {
    const harness = await createHarness();
    const parked = await parkOnWrite(harness);
    const result = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 1,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "Checked UCPath directly; the transaction is absent" },
    }));
    assert.equal(result.state, "applied");
    assert.deepEqual(harness.writeCalls, [`resolve-write-absent:${parked.runId}`]);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "queued");
  });

  it("CAS-conflicts on a stale version and rejects a stale intent generation", async () => {
    const harness = await createHarness();
    const parked = await parkOnWrite(harness);
    const stale = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version + 3, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version + 3,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 1,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "stale browser action" },
    }));
    assert.equal(stale.state, "conflict");

    const staleGeneration = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 4,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "stale generation" },
    }));
    assert.equal(staleGeneration.state, "rejected");
    if (staleGeneration.state === "rejected") assert.equal(staleGeneration.code, "invalid-state");
    assert.deepEqual(harness.writeCalls, []);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "parked-write");
  });
});
