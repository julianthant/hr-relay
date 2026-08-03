/** Factory-authenticated construction of durable terminal workflow results. */
import { z } from "zod";
import {
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../base/workflow.js";
import { JsonValueSchema } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import { NodeIdSchema } from "../domain/ids.js";
import { RunRecordSchema } from "../domain/run/record.js";
import {
  RunResultRecordSchema,
  TerminalNotRunReasonSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalDependencyRecord,
} from "../domain/run/result.js";
import { RunCheckpointRecordSchema } from "../domain/workflow/checkpoint.js";

export const TerminalDependencyEvidenceSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    nodeId: NodeIdSchema,
    checkpoint: RunCheckpointRecordSchema,
  }),
  z.strictObject({
    state: z.literal("not-run"),
    nodeId: NodeIdSchema,
    reason: TerminalNotRunReasonSchema,
  }),
]);

function resolvedDependency(
  run: z.infer<typeof RunRecordSchema>,
  evidence: z.infer<typeof TerminalDependencyEvidenceSchema.options[0]>,
): TerminalDependencyRecord {
  const { checkpoint } = evidence;
  if (checkpoint.nodeId !== evidence.nodeId) {
    throw new Error(`terminal dependency ${evidence.nodeId} carries checkpoint ${checkpoint.nodeId}`);
  }
  if (checkpoint.workflowId !== run.envelope.workflow || checkpoint.itemId !== run.envelope.itemId) {
    throw new Error(
      `terminal dependency ${evidence.nodeId} checkpoint belongs to ${checkpoint.workflowId}/${checkpoint.itemId}, `
      + `not ${run.envelope.workflow}/${run.envelope.itemId}`,
    );
  }
  if (checkpoint.attempt > run.envelope.attempt) {
    throw new Error(
      `terminal dependency ${evidence.nodeId} checkpoint attempt ${String(checkpoint.attempt)} `
      + `is newer than run attempt ${String(run.envelope.attempt)}`,
    );
  }
  return {
    state: "resolved",
    nodeId: evidence.nodeId,
    checkpoint: {
      workflowId: checkpoint.workflowId,
      itemId: checkpoint.itemId,
      attempt: checkpoint.attempt,
      runId: checkpoint.runId,
    },
    outputSchemaHash: checkpoint.output.schemaHash,
    descriptorVersion: checkpoint.descriptorVersion,
    contractFingerprint: checkpoint.contractFingerprint,
    implFingerprint: checkpoint.implFingerprint,
    outputDigest: deriveCheckpointOutputDigest(checkpoint.output),
    provenanceDigest: deriveCheckpointProvenanceDigest(checkpoint.provenance),
  };
}

export function buildRunResult(
  descriptor: AnyWorkflowDescriptor,
  currentRunInput: unknown,
  evidenceInput: unknown,
  candidateResult: unknown,
  clock: Clock,
): RunResultRecord {
  const currentRun = RunRecordSchema.parse(currentRunInput);
  if (currentRun.lifecycle.state !== "running") {
    throw new Error(
      `run ${currentRun.envelope.runId} is ${currentRun.lifecycle.state}; only a running claimed run can build a terminal result`,
    );
  }
  if (currentRun.envelope.workflow !== descriptor.id
    || currentRun.envelope.descriptorVersion !== descriptor.version
    || currentRun.envelope.contractFingerprint !== descriptor.contractFingerprint) {
    throw new Error(`run ${currentRun.envelope.runId} is not bound to descriptor ${descriptor.id}`);
  }

  const execution = workflowTerminalResultExecution(descriptor);
  const evidence = z.array(TerminalDependencyEvidenceSchema).parse(evidenceInput);
  const evidenceNodeIds = evidence.map(({ nodeId }) => nodeId);
  if (new Set(evidenceNodeIds).size !== evidenceNodeIds.length) {
    throw new Error("terminal dependency evidence contains a duplicate node identity");
  }
  const expected = new Set(execution.dependsOn);
  const extras = evidenceNodeIds.filter((nodeId) => !expected.has(nodeId));
  const missing = execution.dependsOn.filter((nodeId) => !evidenceNodeIds.includes(nodeId));
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(
      `terminal dependency evidence does not match authenticated dependsOn; `
      + `missing=${missing.join(",") || "none"} extra=${extras.join(",") || "none"}`,
    );
  }

  const byNode = new Map(evidence.map((entry) => [entry.nodeId, entry]));
  const dependencies: TerminalDependencyRecord[] = execution.dependencies.map((expectedDependency) => {
    const entry = byNode.get(expectedDependency.nodeId);
    if (entry === undefined) throw new Error(`terminal dependency ${expectedDependency.nodeId} is missing`);
    if (entry.state === "not-run") {
      if (!expectedDependency.conditional) {
        throw new Error(`terminal dependency ${entry.nodeId} is unconditional and cannot be marked not-run`);
      }
      return { state: "not-run", nodeId: entry.nodeId, reason: entry.reason };
    }
    return resolvedDependency(currentRun, entry);
  });

  const parsedResult = JsonValueSchema.parse(execution.parseResult(candidateResult));
  const result = { schemaHash: execution.schemaHash, value: parsedResult };
  return RunResultRecordSchema.parse({
    runId: currentRun.envelope.runId,
    attempt: currentRun.envelope.attempt,
    workflowId: currentRun.envelope.workflow,
    descriptorVersion: currentRun.envelope.descriptorVersion,
    contractFingerprint: currentRun.envelope.contractFingerprint,
    configFingerprint: currentRun.envelope.configFingerprint,
    configSnapshotId: currentRun.envelope.configSnapshotId,
    resultSchemaHash: execution.schemaHash,
    result,
    resultDigest: deriveRunResultDigest(result),
    dependencies,
    dependencyDigest: deriveTerminalDependencyDigest(dependencies),
    createdAt: clock.now().toISOString(),
  });
}
