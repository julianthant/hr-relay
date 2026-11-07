
import { z } from "zod";
import { JsonValueSchema, type JsonObject, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { IsoInstantSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import {
  CheckpointPatchSchema,
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
  type CheckpointPatch,
  type FactProvenance,
  type RunCheckpointRecord,
} from "../../../models/workflow/checkpoint.js";

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Immutable set-at-dotted-path; every intermediate hop must be an object. */
function withValueAtPath(value: JsonValue, fieldPath: string, next: JsonValue): JsonValue {
  const segments = fieldPath.split(".");
  const rebuild = (current: JsonValue, index: number): JsonValue => {
    if (index === segments.length) return next;
    const segment = segments[index];
    if (segment === undefined) throw new Error(`field path ${fieldPath} has an empty segment`);
    if (!isJsonObject(current)) {
      throw new Error(
        `field path ${fieldPath} does not resolve through the checkpoint output: `
        + `segment "${segment}" is not reachable through an object`,
      );
    }
    const existing = current[segment];
    if (existing === undefined && index < segments.length - 1) {
      throw new Error(`field path ${fieldPath} names a hop ("${segment}") the checkpoint output does not carry`);
    }
    return { ...current, [segment]: rebuild(existing ?? next, index + 1) };
  };
  return rebuild(value, 0);
}

export interface AppliedCheckpointPatches {
  readonly record: RunCheckpointRecord;
  readonly changedPaths: readonly string[];
}


export function applyCheckpointPatches(input: Readonly<{
  replayed: RunCheckpointRecord;
  patches: readonly CheckpointPatch[];
  outputSchema: z.ZodType;
  attempt: number;
  // claimGeneration identifies the execution that minted this corrected checkpoint.
  claimGeneration: number;
  runId: string;
  writtenAt: string;
}>): AppliedCheckpointPatches {
  const replayed = RunCheckpointRecordSchema.parse(input.replayed);
  const patches = input.patches.map((patch) => CheckpointPatchSchema.parse(patch));
  if (patches.length === 0) throw new Error("applyCheckpointPatches called with zero patches");

  let value: JsonValue = replayed.output.value;
  for (const patch of patches) {
    if (String(patch.nodeId) !== String(replayed.nodeId)) {
      throw new Error(
        `patch for node "${patch.nodeId}" reached the applier for node "${replayed.nodeId}"`,
      );
    }
    value = withValueAtPath(value, patch.fieldPath, patch.value);
  }
  // The WHOLE post-patch output through the producing contract's full schema —
  // a corrupt edit cannot enter the run.
  const parsed: unknown = input.outputSchema.parse(value);

  const provenance: FactProvenance[] = replayed.provenance.map((fact) => {
    const patch = patches.find((candidate) =>
      String(candidate.fieldPath) === String(fact.path)
      || String(fact.path).startsWith(`${candidate.fieldPath}.`));
    if (patch === undefined) return fact;
    return FactProvenanceSchema.parse({
      path: fact.path,
      source: "operator",
      observedAt: patch.correctedAt,
      // NEVER refreshed: the correction does not assert current external truth.
      originalObservedAt: fact.originalObservedAt,
      correctedAt: patch.correctedAt,
      supersedes: fact.observedAt,
    });
  });
  for (const patch of patches) {
    const covered = replayed.provenance.some((fact) =>
      String(fact.path) === String(patch.fieldPath)
      || String(fact.path).startsWith(`${patch.fieldPath}.`)
      || String(patch.fieldPath).startsWith(`${fact.path}.`));
    if (!covered) {
      throw new Error(
        `patch path ${patch.fieldPath} has no provenance fact to supersede in node "${replayed.nodeId}"; `
        + "a correction must supersede a recorded fact, never invent one",
      );
    }
  }

  const record = RunCheckpointRecordSchema.parse({
    workflowId: replayed.workflowId,
    itemId: replayed.itemId,
    nodeId: replayed.nodeId,
    attempt: input.attempt,
    claimGeneration: input.claimGeneration,
    runId: RunIdSchema.parse(input.runId),
    output: { schemaHash: replayed.output.schemaHash, value: JsonValueSchema.parse(parsed) },
    descriptorVersion: replayed.descriptorVersion,
    contractFingerprint: replayed.contractFingerprint,
    implFingerprint: replayed.implFingerprint,
    provenance,
    writtenAt: IsoInstantSchema.parse(input.writtenAt),
  });
  return Object.freeze({
    record,
    changedPaths: Object.freeze(patches.map((patch) => String(patch.fieldPath))),
  });
}
