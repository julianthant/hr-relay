import { deriveSchemaHash } from "../../domain/schema-bound-value.js";
import { TransactionOutcomeSchema } from "../../domain/write-safety-primitives.js";
import type { StepOmissions } from "../../domain/workflow/step-omission.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../base/workflow.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../domain/canonical-json.js";
import { BrowserSystemIdSchema } from "../../domain/ids.js";
import { RerunPlanSchema, RepeatWarningSchema, repeatEvidenceDigest, type RerunPlan, type RerunSource, type RepeatWarning } from "../../domain/run/rerun.js";
import type { PlannedRun } from "../../domain/run/start-plan.js";
import { sha256Hex } from "../../domain/sha256.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../domain/write-safety.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";

export class RerunRefusedError extends Error {
  constructor(readonly code: "target-deleted" | "target-not-found" | "source-stale" | "invalid-state" | "schema-mismatch" | "invalid-value", message: string) {
    super(message); this.name = "RerunRefusedError";
  }
}


function field(value: unknown, path: string): JsonValue {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new RerunRefusedError("invalid-value", "copied-value coordinates do not resolve");
    }
    current = Reflect.get(current, part);
  }
  return JsonValueSchema.parse(current);
}

/** Read-only warning context. Historical outputs here never enter the new run's input. */
export function buildRerunPlan(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource, planned: readonly PlannedRun[], acknowledgment?: string, stepOmissions?: StepOmissions): RerunPlan {
  if (repositories.deletedRuns.get(source.runId) !== undefined) throw new RerunRefusedError("target-deleted", "Rerun source was deleted");
  const run = repositories.runs.get(source.runId);
  if (run === undefined) throw new RerunRefusedError("target-not-found", "Rerun source does not exist");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Rerun source revision changed; replan");
  if (run.envelope.workflow !== descriptor.id || run.envelope.contractFingerprint !== descriptor.contractFingerprint
    || run.envelope.descriptorVersion !== descriptor.version) throw new RerunRefusedError("schema-mismatch", "Rerun source descriptor changed");
  if (run.lifecycle.state !== "terminal" || repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0
    || repositories.writeIntents.listByRun(source.runId).some((intent) => intent.status === "parked")) {
    throw new RerunRefusedError("invalid-state", "Rerun requires a terminal source without uncertain writes");
  }
  if (planned.length !== 1) throw new RerunRefusedError("invalid-state", "Rerun requires exactly one accepted submission");
  const selectedKeys = source.selectedStepKeys;
  if (new Set(selectedKeys).size !== selectedKeys.length || selectedKeys.some((key) => !descriptor.timeline.some((step) => step.key === key))) {
    throw new RerunRefusedError("invalid-value", "Rerun selection is not eligible in this descriptor");
  }
  const entry = planned[0];
  const checkpoints = repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId)
    .filter((checkpoint) => checkpoint.runId === source.runId);
  const latest = new Map(checkpoints.map((checkpoint) => [String(checkpoint.nodeId), checkpoint]));
  for (const coordinate of source.copiedFrom ?? []) {
    const checkpoint = latest.get(coordinate.nodeId);
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => candidate.id === coordinate.nodeId);
    const outputSchema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
    if (checkpoint === undefined || outputSchema === undefined || checkpoint.output.schemaHash !== deriveSchemaHash(outputSchema, "output")
      || !outputSchema.safeParse(checkpoint.output.value).success) {
      throw new RerunRefusedError("schema-mismatch", "copied-value source does not match its descriptor output");
    }
    const target = coordinate.targetStepKey === undefined ? entry.rawInput
      : stepOmissions?.find((omission) => omission.step === coordinate.targetStepKey)?.facts;

    if (checkpoint === undefined || checkpoint.contractFingerprint !== descriptor.contractFingerprint
      || canonicalJsonStringify(field(checkpoint.output.value, coordinate.fieldPath))
        !== canonicalJsonStringify(field(target, coordinate.targetFieldPath))) {
      throw new RerunRefusedError("invalid-value", "copied value does not match its source coordinates");
    }
  }
  const selected = new Set(source.selectedStepKeys);
  const nodes = new Set(descriptor.timeline.filter((step) => selected.has(step.key)).flatMap((step) => step.nodes.map((node) => String(node.id))));
  const warnings: RepeatWarning[] = [];
  for (const node of descriptorRuntimeNodes(descriptor)) {
    if (node.kind !== "transaction" || !nodes.has(String(node.id))) continue;
    const outputs: Record<string, JsonValue> = {};
    for (const dependency of node.dependsOn) {
      const checkpoint = latest.get(String(dependency));
      if (checkpoint !== undefined) outputs[String(dependency)] = checkpoint.output.value;
    }
    // Missing fresh upstream facts cannot authorize a repeat. Execution must
    // obtain renewed consent if its eventual natural key is not in this set.
    if (node.dependsOn.some((dependency) => !Object.hasOwn(outputs, String(dependency)))) continue;
    const commitInput = node.commit.uses.input.parse(node.commit.bind({ input: entry.input.value, outputs }));
    const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [commitInput]));
    const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
    const digest = deriveIdempotencyKeyDigest(system, key);
    for (const intent of repositories.writeIntents.listByBusinessKey(system, digest)) {
      if (intent.status !== "committed" && intent.status !== "observed-present") continue;
      warnings.push(RepeatWarningSchema.parse({ nodeId: node.id, taskId: node.commit.uses.id, system, businessKeyDigest: digest,
        writeIntentId: intent.writeIntentId, evidenceDigest: repeatEvidenceDigest(intent) }));
    }
  }
  warnings.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.writeIntentId.localeCompare(b.writeIntentId));
  const warningDigest = sha256Hex(`hrauto:rerun-warnings:v1\0${canonicalJsonStringify({
    runId: source.runId, expectedVersion: source.expectedVersion, descriptorFingerprint: descriptor.contractFingerprint,
    selectedStepKeys: [...selected].sort(), warnings,
  })}`);
  return RerunPlanSchema.parse({ source, warnings, warningDigest, ...(acknowledgment === undefined ? {} : { acknowledgment }) });
}
