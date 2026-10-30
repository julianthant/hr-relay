import type { WorkerLeaseRecord } from "../../../../models/run/worker.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";

import { createRunQueueProjection } from "../../../runs/projections/run-queue-projection.js";

export function createOperatorProjection(input: Omit<Parameters<typeof createRunQueueProjection>[0], "authority" | "timeline"> & { database: AuthorityDatabase; ownsWorker?: (lease: WorkerLeaseRecord) => boolean; reader: Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot"> }) {
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
      latestNotificationSource: (notificationId) => database.authority.notificationPublications.latest(notificationId),
      listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => database.authority.gateResults.listByRun(runId),
      listWorkerSlots: () => database.authority.workerSlots.list(),
      listWorkerRuns: workerId => database.authority.runs.listByWorker(workerId),
      workerOwnerAlive: lease => input.ownsWorker?.(lease) === true,
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId) => database.authority.workerLeases.get(workerId),
      workerBrowsers: workerId => database.authority.workerControls.browsers(workerId),
      workerControls: () => database.authority.workerControls.list(),
      ownsWorker: lease => input.ownsWorker?.(lease) === true,
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
      canonicalPerson: (runId) => database.canonicalPerson(runId),
      // Ref dashboard-surfaces: the one stored node output a queue row reads — the
      // subject's name, at the leaf the descriptor declares.
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
  });
}
