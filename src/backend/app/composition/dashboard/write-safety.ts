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
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import { createTrustReadDependencies } from "./trust.js";

import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";

export function prepareWriteSafety(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "admission" | "lifecycle" | "descriptors" | "ids">) {
  const { database, admission, lifecycle, descriptors, ids } = input;
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
  return { writeResolution, artifacts };
}

export function composeWriteSafety(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "database" | "lifecycle" | "stateRoot"> & { projection: ReturnType<typeof createOperatorProjection>; workerMembers: () => readonly WorkerMemberView[]; artifacts: ReturnType<typeof createContentAddressedArtifactWriter>; artifactReader: ReturnType<typeof createServerVerifiedArtifactReader> }) {
  const { database, lifecycle, stateRoot, projection, workerMembers, artifacts, artifactReader } = input;
  const intakeParser = createIntakeParser({ artifacts });
  const intakeProjections = {
    resolve: (workflowId: string) => INTAKE_PROJECTIONS[workflowId],
  };

  const trustReads = createTrustReadDependencies({ database, artifactReader, reader: lifecycle });
  const runDetailDeps = createOperatorRunDetail({ stateRoot, projection, database, workerMembers, runReader: lifecycle, canonical: { reader: lifecycle, database, descriptors: { resolve: (workflowId) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor ?? stepProofDescriptorOf(workflowId) } }, trust: trustReads.trust, captures: trustReads.captures });

  return { intakeParser, intakeProjections, trustReads, runDetailDeps };
}
