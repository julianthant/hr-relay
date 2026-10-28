import { reconcileStartupCrash } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RunRecordService, lifecycleCommandId, runContinuationPort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { absentProbeEvidence, ambiguousProbeVerdict, unknownProbeVerdict, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_NODE_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";

const { cleanup, roundTrip, parkedIntent, resolutionCommand } = createParkedWriteRoundTripTestWorld();
afterEach(cleanup);

async function parked() {
  const h = await roundTrip(); await h.park();
  const intent = parkedIntent(h.database);
  assert.equal(intent.status, "parked"); if (intent.status !== "parked") throw new Error("park required");
  const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(run);
  const command = resolutionCommand("recheck-write", { runId: run.envelope.runId, expectedVersion: run.version,
    writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
  return { h, intent, run, command };
}

describe("parked write read-only recheck", () => {
  it("queues the audited request, then settles read proof and continues without another write", async () => {
    const { h, intent, run, command } = await parked();
    const attempt = h.database.authority.writeAttempts.get(intent.currentAttemptId);
    assert.equal(h.kernel.execute(command).state, "applied");
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    const requested = h.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(requested?.status === "parked" && requested.recheck?.commandId === command.commandId);
    h.world.events.length = 0;
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T998877" } });
    const report = await h.resume();
    assert.equal(report.outcomes[0]?.state, "done");
    const settled = h.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled?.status === "committed");
    assert.deepEqual(settled.completionProof.value, { transactionId: "T998877" });
    assert.deepEqual(h.database.authority.writeAttempts.get(intent.currentAttemptId), attempt);
    assert.equal(h.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);
    assert.equal(h.world.events.some(event => /prepare|stage|fence|commit-click/u.test(event)), false);
    const canonical = createTrustRunReader(h.database, h.clock).read(run.envelope.runId);
    assert.equal(canonical.state, "present");
    const confirmed = h.database.authority.timelineEvents.page({ runId: run.envelope.runId, limit: 100 })
      .find(event => event.payload.kind === "operation-confirmed");
    assert.ok(confirmed);
    const restored = reconstructConfirmedOperation(h.database.authority, confirmed);
    assert.equal(restored.ledger.proofSource, "recovery-probe");
    assert.equal(h.kernel.execute(command).state, "already-applied");
  });

  it.each(["absent", "ambiguous", "unknown", "throws"] as const)("re-parks %s without granting retry authority", async state => {
    const { h, intent, command } = await parked();
    assert.equal(h.kernel.execute(command).state, "applied");
    h.world.events.length = 0;
    if (state === "throws") h.world.probeResults.push(new Error("read failed"));
    else h.world.probeResults.push(state === "absent" ? absentProbeEvidence(h.clock.now().toISOString())
      : state === "ambiguous" ? ambiguousProbeVerdict(h.clock.now().toISOString()) : unknownProbeVerdict(h.clock.now().toISOString()));
    const report = await h.resume();
    assert.equal(report.outcomes[0]?.state, "parked-write");
    const after = h.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(after?.status === "parked"); assert.equal(after.recheck, undefined);
    assert.equal(after.generation, intent.generation); assert.ok(after.version > intent.version);
    assert.equal(h.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);
    assert.equal(h.world.events.some(event => /prepare|stage|fence|commit-click/u.test(event)), false);
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("refuses a parked continuation without the exact admitted recheck", async () => {
    const { h, intent, run, command } = await parked();
    const service = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("f"), publishQueued: () => {} });
    const port = runContinuationPort(service);
    const generation = h.database.getMeta().authorityGeneration;
    assert.throws(() => port.transition({ commandId: lifecycleCommandId("write-recheck", command.commandId), runId: run.envelope.runId,
      expectedVersion: run.version, lifecycle: { state: "queued" }, startAt: WRITE_FIXTURE_NODE_ID,
      writeResolution: { kind: "recheck", commandId: command.commandId, writeIntentId: intent.writeIntentId,
        generation: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest } }), /binding-mismatch/u);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });

  for (const mode of ["canonical", "startup"] as const) {
    it.each(["claimed", "validating", "running"] as const)(`${mode} crash recovery parks a lost %s recheck without changing its intent or attempt`, async state => {
      const { h, intent, run, command } = await parked();
      assert.equal(h.kernel.execute(command).state, "applied");
      const worker = testWorkerLifetime(h.database, run.envelope.workflow, 1);
      const claimed = h.database.authority.runs.claimNext({ workflow: run.envelope.workflow, workerId: worker.workerId,
        workerLifetime: worker.workerLifetime, now: h.clock.now().toISOString() });
      assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("claim required");
      const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
      let current = claimed.run;
      for (const phase of state === "claimed" ? [] : state === "validating" ? ["validating"] as const : ["validating", "running"] as const) {
        const next = h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: current.version,
          claim, lifecycle: { ...claimed.run.lifecycle, state: phase }, now: h.clock.now().toISOString() });
        assert.equal(next.state, "applied"); if (next.state !== "applied") throw new Error("transition required");
        current = next.run;
      }
      const attempt = h.database.authority.writeAttempts.get(intent.currentAttemptId);
      const interruptedIntent = h.database.authority.writeIntents.get(intent.writeIntentId);
      assert.ok(interruptedIntent?.status === "parked" && interruptedIntent.recheck?.commandId === command.commandId);
      const lock = h.profile.lifetime;
      const service = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("f"), publishQueued: () => {} });
      if (mode === "canonical") {
        const outcome = service.recoverCrash({ commandId: lifecycleCommandId("lost-recheck", { runId: run.envelope.runId, version: current.version }),
          runId: run.envelope.runId, expectedVersion: current.version, claim,
          ...h.database.crashRunRecoveryIdentity(run.envelope.runId), now: h.clock.now().toISOString() }, lock);
        assert.equal(outcome.state, "applied");
      } else reconcileStartupCrash({ machine: h.profile.machine, admission: h.profile.admission, database: h.database,
        clock: h.clock, lifecycle: service, lock });
      assert.deepEqual(h.database.authority.writeIntents.get(intent.writeIntentId), interruptedIntent);
      assert.deepEqual(h.database.authority.writeAttempts.get(intent.currentAttemptId), attempt);
      assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
    });
  }

  it("refuses stale versions, generations, unsupported transaction IDs and operator proof", async () => {
    const { h, intent, run, command } = await parked();
    assert.equal(h.kernel.execute({ ...command, target: { ...command.target, expectedVersion: run.version + 1 } }).state, "conflict");
    assert.equal(h.kernel.execute({ ...command, target: { ...command.target, intentGeneration: intent.generation + 1 } }).state, "rejected");
    assert.equal(h.kernel.execute({ ...command, payload: { ...command.payload, transactionId: "T998877" } }).state, "rejected");
    assert.throws(() => h.kernel.execute({ ...command, payload: { ...command.payload, proof: { schemaHash: "a".repeat(64), value: {} } } }));
    assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
    assert.equal(h.kernel.execute(command).state, "applied");
    assert.equal(h.kernel.execute({ ...command, commandId: "dddddddd-1234-4000-8000-123400000000", target: { ...command.target, expectedVersion: run.version + 1 } }).state, "rejected");
  });
});
