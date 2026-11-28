import type { DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createIntakeParser } from "../../../processing/spreadsheet/intake-parser.js";
import { type WriteResolutionExecutor } from "../../../runs/commands/write-resolution-command.js";
import { runContinuationPort } from "../../../runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../runtime/writes/write-recovery.js";
import { createContentAddressedArtifactWriter } from "../../../storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";
import { INTAKE_PROJECTIONS } from "../../registries/workflow-registry.js";
import type { createOperatorProjection } from "./queue.js";
import { createOperatorRunDetail, detailDescriptors, runDetailLane } from "./run-detail.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import { createTrustReadDependencies } from "./trust.js";
import { bindRunDetailReadLane } from "../../../runs/queries/run-detail.js";

import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";

export function prepareWriteSafety(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "admission" | "lifecycle" | "descriptors" | "ids">) {
  const { admission, lifecycle, descriptors, ids } = input;

  const writeResolution: WriteResolutionExecutor = createWriteResolutionExecutor({
    continuation: runContinuationPort(lifecycle),
    descriptors,
    ids,
  });

  const artifacts = createContentAddressedArtifactWriter({
    admission,
  });
  return { writeResolution, artifacts };
}

export function composeWriteSafety(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "lifecycle" | "stateRoot"> & { history: AuthorityDatabase; reader: RunRecordService; projection: ReturnType<typeof createOperatorProjection>; workerMembers: () => readonly WorkerMemberView[]; operatorName: () => string; artifacts: ReturnType<typeof createContentAddressedArtifactWriter>; artifactReader: ReturnType<typeof createServerVerifiedArtifactReader>;
  /** Seam for the run detail, logs and run panel lane reads. */
  readLanes?: DashboardReadLanes }) {
  const { database, lifecycle, stateRoot, projection, workerMembers, operatorName, artifacts, artifactReader } = input;
  const intakeParser = createIntakeParser({ artifacts });
  const intakeProjections = {
    resolve: (workflowId: string) => INTAKE_PROJECTIONS[workflowId],
  };

  const trustReads = createTrustReadDependencies({ database, artifactReader, reader: lifecycle });
  const { history, reader } = input;
  const historicalReads = history === database ? trustReads : createTrustReadDependencies({ database: history, artifactReader, reader });
  const detailTrust = history === database ? trustReads.trust : {
    ...historicalReads.trust,
    receiptAvailable: (id: string) => database.authority.runs.get(id) !== undefined || history.authority.evidenceReceipts.findByRun(id) !== undefined,
    ensureReceipt: (id: string) => {
      if (database.authority.runs.get(id) !== undefined) return trustReads.trust.ensureReceipt(id);
      const receipt = history.authority.evidenceReceipts.findByRun(id);
      if (receipt === undefined) throw new Error("isolated-history-receipt-missing");
      return receipt;
    },
  };
  const runDetailDeps = createOperatorRunDetail({ stateRoot, projection, database: history, workerMembers, operatorName, runReader: reader, canonical: { reader, database: history, descriptors: detailDescriptors }, trust: detailTrust, captures: historicalReads.captures });
  if (input.readLanes !== undefined) bindRunDetailReadLane(runDetailDeps, input.readLanes, runDetailLane);

  return { intakeParser, intakeProjections, trustReads, runDetailDeps };
}
