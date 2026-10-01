import { RunRecordService, workerRunLifecyclePort, runContinuationPort } from "../../src/backend/runs/run-record-service.js";
import type { Clock } from "../../src/domain/clock.js";
import type { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT, HASH_A, HASH_B, UUID_4, NOW } from "./phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";

export function testRunService(database: AuthorityDatabase, clock: Clock) {
  return new RunRecordService({ database, clock, ids: sequentialIdFactory("e"),
    publishQueued: () => { throw new Error("fixture lifecycle ports do not create runs"); },
  });
}

export function testRunLifecycle(database: AuthorityDatabase, clock: Clock) {
  return workerRunLifecyclePort(testRunService(database, clock));
}

export function testRunContinuation(database: AuthorityDatabase, clock: Clock) {
  return runContinuationPort(testRunService(database, clock));
}

export function testWorkerPorts(database: AuthorityDatabase, clock: Clock) {
  const snapshot = { ...CONFIG_SNAPSHOT, configSnapshotId: UUID_4, fingerprint: HASH_B };
  database.authority.configSnapshots.insert(snapshot);
  const runtimeConfig = database.authority.runtimeConfig.get() ?? database.authority.runtimeConfig.activate({
    settingsRevision: 1, settingsFingerprint: HASH_A,
    configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint,
    activatedAt: NOW,
  });
  const lifecycle = testRunLifecycle(database, clock);
  return { lifecycle, claimNext: (request: { commandId: string; workflow: string; workerId: string }) =>
    lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: request.workerId, runtimeConfig: {
      generation: runtimeConfig.generation, settingsRevision: runtimeConfig.settingsRevision,
      settingsFingerprint: runtimeConfig.settingsFingerprint, configFingerprint: runtimeConfig.configFingerprint,
    } }) };
}
