import {
  WORKFLOW_MODULES,
} from "../../registries/workflow-registry.js";
import { historicalStepProofModuleOf } from "../../registries/step-proof-modules.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";

import type {
  RunDetailQueryDeps,
} from "../../../runs/queries/run-detail.js";
import { gateNodeViewsOf, writeContractViewsOf, dataOriginViewsOf } from "./run-detail-descriptors.js";
import { createItemAttemptHistoryQuery } from "../../../runs/queries/item-attempt-history.js";

export function createOperatorRunDetail(input: Pick<RunDetailQueryDeps, "stateRoot" | "projection" | "trust" | "captures" | "canonical" | "runReader"> & { database: AuthorityDatabase }): RunDetailQueryDeps {
  const { stateRoot, projection, database, trust, captures, canonical, runReader } = input;
  return {
    ...(canonical === undefined ? {} : { canonical }),
    ...(runReader === undefined ? {} : { runReader }),
    ...(runReader === undefined ? {} : { itemAttemptHistory: createItemAttemptHistoryQuery({ database, reader: runReader }) }),
    stateRoot,
    projection,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      // Ref write-safety §4.1: read straight off write-safety authority, per request.
      getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),

      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {

      resolve: (workflowId) => {

        const module = WORKFLOW_MODULES.find((candidate) => candidate.descriptor.id === workflowId)
          ?? historicalStepProofModuleOf(workflowId);
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
