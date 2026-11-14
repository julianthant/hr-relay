import { batchMemberRetryAvailable } from "../../../runs/queries/run-retry.js";
import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";

import { createRunQueueProjection } from "../../../runs/projections/run-queue-projection.js";
import { hostedOcrRun, readQueueRecordMembers } from "../../../runs/queries/ocr-record-members.js";
import { readOcrReviewAuthority } from "../../../runs/lifecycle/ocr-review-authority.js";
import { workflowQueueCapabilities } from "../../registries/workflow-registry.js";

export function createOperatorProjection(input: Omit<Parameters<typeof createRunQueueProjection>[0], "authority" | "timeline"> & { database: AuthorityDatabase; workerMembers?: () => readonly WorkerMemberView[];
  workerStartupPending?: (workflowId: string) => boolean; reader: Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot"> }) {
  const { stateRoot, clock, appVersion, descriptorSetHash, ledger, database, descriptors } = input;
  return createRunQueueProjection({
    timeline: database.authority.timelineEvents,
    stateRoot,
    clock,
    appVersion,
    descriptorSetHash,
    ledger,
    reader: input.reader,
    queueCapabilities: workflowQueueCapabilities,
    authority: {
      batchMemberRetryAvailable: run => batchMemberRetryAvailable(database.authority, run, descriptors.resolve(run.envelope.workflow), workflowQueueCapabilities(run.envelope.workflow)),
      queueParents: envelopes => database.authority.dependencies.parents(envelopes),
      recordMembers: (run, children) => database.withAuthorityReadSnapshot(() => readQueueRecordMembers(database.authority, input.reader,
        run, children, id => descriptors.resolve(id))),
      reviewAvailable: runId => database.withAuthorityReadSnapshot(() => {
        const current = input.reader.read(runId);
        if (current.state !== "present" || current.disposition !== "live") return false;
        const ocr = current.run.envelope.workflow === "ocr" ? current.run : hostedOcrRun(database.authority, current.run);
        return ocr !== undefined && readOcrReviewAuthority(database.authority, input.reader, ocr.envelope.runId) !== undefined;
      }),
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      command: (commandId) => database.authority.commands.get(commandId),
      latestNotificationSource: (notificationId) => database.authority.notificationPublications.latest(notificationId),
      listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => database.authority.gateResults.listByRun(runId),
      listWorkerSlots: () => database.authority.workerSlots.list(),
      listWorkerRuns: workerId => database.authority.runs.listByWorker(workerId),
      ...(input.workerMembers === undefined ? {} : { workerMembers: input.workerMembers }),
      ...(input.workerStartupPending === undefined ? {} : { workerStartupPending: input.workerStartupPending }),
      heldDuoSystems: workerId => database.heldDuoSystems(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      writeInFlight: runId => database.authority.writeIntents.listByRun(runId).some(intent => intent.status === "attempting"),
      changeKey: () => database.changeKey(),
      delegationWait: runId => database.authority.dependencies.waitState(runId),
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
