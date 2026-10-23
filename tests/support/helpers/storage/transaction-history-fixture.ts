import { fenceWriteFixture } from "../write-fence-fixture.js";
import assert from "node:assert/strict";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { foundationFixture } from "../database-foundation/fixtures.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { testRunService, testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { separationsDescriptor } from "../registered-workflows.js";
import { HASH_A } from "../../fixtures/phase1c-contract-fixtures.js";
import { atomicWriteCheckpoint } from "../timeline-write-fixture.js";
import { ledgerCommitFixture, fixtureUuid } from "../../fixtures/ledger-projection-fixtures.js";
export const HISTORY_NOW = "2026-09-09T12:00:00.000Z";
export const historyClock = capturedInstantClock(HISTORY_NOW);
export function historyWorld(options: Readonly<{ terminalize?: boolean }> = {}) {
  const admitted = foundationFixture();
  const { root, path } = admitted;
  const open = () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "transaction-history-test" }, historyClock);
  let database = admitted.db;
  return { root, path, get database() { return database; }, get history() { return createTransactionHistory(database.authority); },
    commit(index: number, overrides: Parameters<typeof ledgerCommitFixture>[1] = {}) {
      const fixture = ledgerCommitFixture(index, { runId: fixtureUuid(`history-run-${String(index)}`), itemId: fixtureUuid(`history-item-${String(index)}`), ...overrides, workflowId: separationsDescriptor.id, configFingerprint: admitted.snapshot.fingerprint });
      const ledger = fixture.commit.transaction;
      database.authority.runs.enqueue(RunRecordSchema.parse({ envelope: { workflow:ledger.workflowId,runId:ledger.runId,itemId:ledger.itemId,
        traceId:ledger.traceId,descriptorVersion:separationsDescriptor.version,contractFingerprint:separationsDescriptor.contractFingerprint,resolvedInstance:{[ledger.system]:ledger.instance},
        configFingerprint:ledger.configFingerprint,configSnapshotId:admitted.snapshot.configSnapshotId,shape:"single",priority:"interactive",
        dryRun:false,attempt:ledger.attempt,enqueuedAt:ledger.fencedAt },
        input:{raw:{},parsed:{schemaHash:HASH_A,value:{},protectedBindings:[]},ingressSchemaHash:HASH_A},
        lifecycle:{state:"queued"},claimGeneration:0,version:1,createdAt:ledger.fencedAt,updatedAt:ledger.fencedAt }));
      const slots = database.authority.workerSlots.list(separationsDescriptor.id).filter(entry => entry.retiredAt === null);
      const free = slots.find(slot => !database.authority.runs.listByWorker(slot.workerId).some(run =>
        ["claimed", "validating", "running"].includes(run.lifecycle.state)));
      const poolIndex = free?.poolIndex ?? [1, 2, 3].find(index => !slots.some(slot => slot.poolIndex === index));
      assert.ok(poolIndex !== undefined, "history fixture has no unheld slot");
      if (free === undefined) testWorkerPorts(database, historyClock, { path, descriptor: separationsDescriptor, poolIndex });
      const slot = database.authority.workerSlots.list(separationsDescriptor.id).find(entry => entry.poolIndex === poolIndex && entry.retiredAt === null);
      assert.ok(slot);
      assert.equal(database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, separationsDescriptor.id, poolIndex).workerLifetime, workflow: separationsDescriptor.id, workerId: slot.workerId, now: ledger.fencedAt }).state,"claimed");
      assert.equal(fenceWriteFixture(database, { intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
      database.commitWriteAttempt(fixture.commit, { ...atomicWriteCheckpoint(fixture.commit), descriptorVersion:separationsDescriptor.version,contractFingerprint:separationsDescriptor.contractFingerprint });
      if (options.terminalize !== true) return fixture;
      const service = testRunService(database, historyClock);
      const held = database.authority.runs.get(ledger.runId); assert.ok(held);
      const requested = service.transition({ commandId: fixtureUuid(`history-cancel-${String(index)}`),
        runId: ledger.runId, expectedVersion: held.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW } });
      assert.equal(requested.state, "applied");
      if (requested.state !== "applied") throw new Error("history cancellation refused");
      assert.equal(service.terminalize({ kind: "cancelled", commandId: fixtureUuid(`history-cancel-settle-${String(index)}`),
        runId: ledger.runId, expectedVersion: requested.run.version,
        claim: { workerId: slot.workerId, claimGeneration: held.claimGeneration }, endedAt: HISTORY_NOW },
      separationsDescriptor).state, "applied");
      return fixture;
    },
    reopen() { database.close(); database = open(); },
    dispose() { database.close(); admitted.dispose(); },
  };
}

