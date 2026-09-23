import {
  WORKFLOW_MODULES,
} from "../../../control/workflow-registry.js";

import {
  AuthorityDatabase,
} from "../../../infra/sqlite/index.js";

import type {
  RunDetailQueryDeps,
} from "../queries/run-detail.js";
import { gateNodeViewsOf, writeContractViewsOf, dataOriginViewsOf } from "./run-detail-descriptors.js";
import { createItemAttemptHistoryQuery } from "../queries/item-attempt-history.js";

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
      // D237: the SAME `listByRun` read D204 gave the receipt, so the panel and
      // the receipt name one approver for one gate.
      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      /**
       * The descriptor itself, plus the gate view the identity-gate section
       * needs. The gate facts are DERIVED from the runtime graph here rather
       * than in the query, for the same reason the receipt service lives here:
       * `src/server/dashboard/queries` never reaches the descriptor builders,
       * and a query that re-derived a schema hash would be a second copy of the
       * descriptor's identity.
       */
      resolve: (workflowId) => {
        // D252 reads the MODULE, not the descriptor alone: a task's system is
        // the store's, and `src/workflows/<id>/descriptor.ts` may not reach a
        // store (D106). The tuple is the same one every other registry derives
        // from, so there is no second list to keep in step.
        const module = WORKFLOW_MODULES.find((candidate) => candidate.descriptor.id === workflowId);
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
    // D140/D142: the receipt and failure sections serve CONTENT through the
    // one authority-backed derivation, the same one `explain run` reads.
    ...(trust === undefined ? {} : { trust }),
    // DCA3: the initial capability and lazy section both verify this exact
    // run-indexed diagnostic authority before advertising capture artifacts.
    ...(captures === undefined ? {} : { captures }),
  };
}
