import { createIntakeParser } from "../../../processing/spreadsheet/intake-parser.js";
import { type WriteResolutionExecutor } from "../../../runs/commands/command-kernel.js";
import { runContinuationPort } from "../../../runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../runtime/writes/write-recovery.js";
import { createContentAddressedArtifactWriter } from "../../../storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";
import { stepProofDescriptorOf } from "../../registries/step-proof-modules.js";
import { INTAKE_PROJECTIONS,READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import type { createOperatorProjection } from "./queue.js";
import { createOperatorRunDetail } from "./run-detail.js";
import type { prepareDashboardRuntime } from "./runtime-startup.js";
import { createTrustReadDependencies } from "./trust.js";

import type { WorkerLeaseRecord } from "../../../../models/run/worker.js";

export async function composeWriteSafety(input: Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "database" | "admission" | "lifecycle" | "descriptors" | "ids" | "stateRoot"> & { projection: ReturnType<typeof createOperatorProjection>; ownsWorker: (lease: WorkerLeaseRecord) => boolean }) {
  const { database, admission, lifecycle, descriptors, ids, stateRoot, projection, ownsWorker } = input;
  // Ref write-safety's typed operator resolutions, over the SAME AuthorityDatabase
  // instance as the kernel transaction (the executor's documented requirement).

  const writeResolution: WriteResolutionExecutor = createWriteResolutionExecutor({
    continuation: runContinuationPort(lifecycle),
    descriptors,
    authority: database,
    ids,
  });

  const artifacts = createContentAddressedArtifactWriter({
    admission,
  });
  await artifacts.ready;
  const artifactReader = createServerVerifiedArtifactReader({
    admission,
  });
  await artifactReader.ready;
  const intakeParser = createIntakeParser({ artifacts });
  const intakeProjections = {
    resolve: (workflowId: string) => INTAKE_PROJECTIONS[workflowId],
  };

  const trustReads = createTrustReadDependencies({ database, artifactReader, reader: lifecycle });
  const runDetailDeps = createOperatorRunDetail({ stateRoot, projection, database, ownsWorker, runReader: lifecycle, canonical: { reader: lifecycle, database, descriptors: { resolve: (workflowId) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor ?? stepProofDescriptorOf(workflowId) } }, trust: trustReads.trust, captures: trustReads.captures });

  return { writeResolution, artifacts, artifactReader, intakeParser, intakeProjections, trustReads, runDetailDeps };
}
