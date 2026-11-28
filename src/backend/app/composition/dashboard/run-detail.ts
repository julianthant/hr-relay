import { readFileSync } from "node:fs";
import { systemClock } from "../../../../rules/time/clock.js";
import { DESCRIPTORS, READABLE_WORKFLOW_MODULES, descriptorSetHash } from "../../registries/workflow-registry.js";
import { stepProofDescriptorOf, stepProofModuleOf } from "../../registries/step-proof-modules.js";

import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";

import { defineRunDetailLaneRead, MissingLaneReceipt, type RunDetailQueryDeps } from "../../../runs/queries/run-detail.js";
import { gateNodeViewsOf, writeContractViewsOf, dataOriginViewsOf } from "./run-detail-descriptors.js";
import { createItemAttemptHistoryQuery, createRunReadLaneReader } from "../../../runs/queries/item-attempt-history.js";
import { createFailureResolutionQuery } from "../../../runs/queries/failure-resolution.js";
import { ProjectionDegradedError } from "../../../runs/commands/refusals.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { createOperatorProjection } from "./queue.js";
import { PackageVersionSchema } from "./runtime-contracts.js";

export function createOperatorRunDetail(input: Pick<RunDetailQueryDeps, "stateRoot" | "projection" | "trust" | "captures" | "canonical" | "runReader" | "workerMembers" | "operatorName"> & { database: AuthorityDatabase; timeline?: RunDetailQueryDeps["timeline"] }): RunDetailQueryDeps {
  const { stateRoot, projection, database, trust, captures, canonical, runReader } = input;
  const identity = database.getMeta();
  return {
    ...(input.workerMembers === undefined ? {} : { workerMembers: input.workerMembers }),
    ...(input.operatorName === undefined ? {} : { operatorName: input.operatorName }),
    ...(identity.installationId === undefined || identity.profileId === undefined ? {} : { authorityIdentity: { installationId: identity.installationId, profileId: identity.profileId } }),
    ...(canonical === undefined ? {} : { canonical }),
    ...(runReader === undefined ? {} : { runReader }),
    ...(runReader === undefined ? {} : { itemAttemptHistory: createItemAttemptHistoryQuery({ database, reader: runReader }) }),
    timeline: input.timeline ?? database.authority.timelineEvents,
    stateRoot,
    projection,
    authority: {
      delegationWait: runId => database.authority.dependencies.waitState(runId),
      getRun: (runId) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      // Ref write-safety: read straight off write-safety authority, per request.
      getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),

      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {

      resolve: (workflowId) => {

        const module = READABLE_WORKFLOW_MODULES.find((candidate) => candidate.descriptor.id === workflowId)
          ?? stepProofModuleOf(workflowId);
        if (module === undefined) return undefined;
        const { descriptor } = module;
        return {
          ...descriptor,
          gateNodes: gateNodeViewsOf(descriptor),
          writeContracts: writeContractViewsOf(descriptor),
          dataOrigins: dataOriginViewsOf(module),
        };
      },
    },

    ...(trust === undefined ? {} : { trust }),
    // the initial capability and lazy section both verify this exact
    // run-indexed diagnostic authority before advertising capture artifacts.
    ...(captures === undefined ? {} : { captures }),
  };
}

const resolveWorkflow = (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor;
export const detailDescriptors = { resolve: (id: string) => resolveWorkflow(id) ?? stepProofDescriptorOf(id) };

export const runDetailLane = defineRunDetailLaneRead(import.meta.url, ({ native, history, start, logs }, initialFacts) => {
  let facts = initialFacts;
  const { stateRoot } = start;
  const reader = createRunReadLaneReader(history);
  const { authority } = history;
  const log = logs.timeline();
  const timeline = { ...authority.timelineEvents, page: log.page, highWaterMark: log.highWaterMark, withReadSnapshot: log.withReadSnapshot };
  const projection = createOperatorProjection({
    stateRoot, clock: systemClock, timeline,
    appVersion: PackageVersionSchema.parse(JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"))).version,
    descriptorSetHash: descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint)),
    ledger: createTransactionHistory(authority), database: history, descriptors: { resolve: resolveWorkflow }, reader,
  });
  const failureResolution = createFailureResolutionQuery(authority);
  const deps = createOperatorRunDetail({
    stateRoot, projection, database: history, timeline, runReader: reader, workerMembers: () => facts.workers, operatorName: () => facts.operatorName,
    canonical: { reader, database: history, descriptors: detailDescriptors },
    trust: {
      failureResolution, getFailure: failureResolution.getFailure,
      countFailuresByFingerprint: fingerprint => authority.failures.countByFingerprint(fingerprint),
      ...(history === native ? {} : { receiptAvailable: (id: string) =>
        authority.evidenceReceipts.findByRun(id) !== undefined || native.authority.runs.get(id) !== undefined }),
      ensureReceipt(id) {
        const receipt = authority.evidenceReceipts.findByRun(id);
        if (receipt === undefined) throw new MissingLaneReceipt();
        return receipt;
      },
    },
    // The failure section validates capture metadata. Byte verification stays with the server reader.
    captures: { runReader: reader, authority: authority.diagnosticBundles, artifactReader: {
      verify() { throw new Error("run-read-lane-capture-verification-refused"); },
      prepare() { throw new Error("run-read-lane-capture-verification-refused"); },
    } },
  });
  projection.rebuildFromTimeline();
  let revision = log.revision();
  return {
    deps,
    update(next, through) {
      facts = next;
      const current = log.revision();
      if (projection.position() > through || projection.health().state === "degraded"
        || (projection.position() === through && revision !== current)) projection.rebuildFromTimeline();
      else if (projection.position() < through) projection.ingestFromTimeline();
      revision = current;
      const health = projection.health();
      if (health.state === "degraded") throw new ProjectionDegradedError(health.lastError ?? "run read lane projection is degraded");
    },
  };
});
