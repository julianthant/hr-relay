import { RunRecordService } from "../../../core/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../infra/sqlite/index.js";

import { createRunQueueProjection } from "../projectors/run-queue-projection.js";

export function createOperatorProjection(input: Omit<Parameters<typeof createRunQueueProjection>[0], "authority" | "timeline"> & { database: AuthorityDatabase; reader: Pick<RunRecordService, "read" | "list"> }) {
  const { stateRoot, clock, appVersion, descriptorSetHash, ledger, database, descriptors } = input;
  return createRunQueueProjection({
    timeline: database.authority.timelineEvents,
    stateRoot,
    clock,
    appVersion,
    descriptorSetHash,
    ledger,
    reader: input.reader,
    authority: {
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
      canonicalPerson: (runId) => database.canonicalPerson(runId),
      // Ref dashboard-surfaces §1.2: the one stored node output a queue row reads — the
      // subject's name, at the leaf the descriptor declares.
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
  });
}
