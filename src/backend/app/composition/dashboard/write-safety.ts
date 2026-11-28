import { readFileSync } from "node:fs";
import { systemClock } from "../../../../rules/time/clock.js";
import type { DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createIntakeParser } from "../../../processing/spreadsheet/intake-parser.js";
import { type WriteResolutionExecutor } from "../../../runs/commands/write-resolution-command.js";
import { runContinuationPort } from "../../../runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../runtime/writes/write-recovery.js";
import { createContentAddressedArtifactWriter } from "../../../storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";
import { stepProofDescriptorOf } from "../../registries/step-proof-modules.js";
import { DESCRIPTORS, INTAKE_PROJECTIONS, READABLE_WORKFLOW_MODULES, descriptorSetHash } from "../../registries/workflow-registry.js";
import { createOperatorProjection } from "./queue.js";
import { createOperatorRunDetail } from "./run-detail.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import { createTrustReadDependencies } from "./trust.js";
import { bindRunDetailReadLane, defineRunDetailLaneRead, MissingLaneReceipt } from "../../../runs/queries/run-detail.js";
import { createRunReadLaneReader } from "../../../runs/queries/item-attempt-history.js";
import { createFailureResolutionQuery } from "../../../runs/queries/failure-resolution.js";
import { ProjectionDegradedError } from "../../../runs/commands/refusals.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { PackageVersionSchema } from "./runtime-contracts.js";

import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";

const resolveWorkflow = (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor;
const detailDescriptors = { resolve: (id: string) => resolveWorkflow(id) ?? stepProofDescriptorOf(id) };

const runDetailLane = defineRunDetailLaneRead(import.meta.url, ({ native, history, start }, initialFacts) => {
  let facts = initialFacts;
  const { stateRoot } = start;
  const reader = createRunReadLaneReader(history);
  const { authority } = history;
  const projection = createOperatorProjection({
    stateRoot, clock: systemClock,
    appVersion: PackageVersionSchema.parse(JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"))).version,
    descriptorSetHash: descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint)),
    ledger: createTransactionHistory(authority), database: history, descriptors: { resolve: resolveWorkflow }, reader,
  });
  const failureResolution = createFailureResolutionQuery(authority);
  const deps = createOperatorRunDetail({
    stateRoot, projection, database: history, runReader: reader, workerMembers: () => facts.workers, operatorName: () => facts.operatorName,
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
  return {
    deps,
    update(next, through) {
      facts = next;
      if (projection.position() > through || projection.health().state === "degraded") projection.rebuildFromTimeline();
      else if (projection.position() < through) projection.ingestFromTimeline();
      const health = projection.health();
      if (health.state === "degraded") throw new ProjectionDegradedError(health.lastError ?? "run read lane projection is degraded");
    },
  };
});

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
