import { type RunResultRecord, readRunPreviewResult, terminalEvidenceResult } from "../../../models/run/result.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { DelegationManifest } from "../../../rules/workflow/dependencies.js";
import { z } from "zod";
import { ProfileDisplayNameSchema } from "../../../models/profiles/profile-identity.js";
import { KualiSavedFinalizationProofSchema } from "../../../models/ui/kuali-separation-finalization.js";
import { KualiSaveSeparationFinalizationOutputSchema, kualiFinalizationIdempotencyKey } from "../../../models/systems/kuali/save-separation-finalization.js";
import { type RunRecord } from "../../../models/run/record.js";
import { checkpointRecordKey, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { EvidenceSchemaAdmissionSchema, EvidenceSchemaRetirementSchema, RETIRED_INPUT_GENERATIONS, type EvidenceSchemaAdmission, type EvidenceSchemaOwner, type EvidenceSchemaRetirement,
  evidenceSchemaSourceDigest } from "../../../models/storage/evidence-schema-admission.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue, type JsonObject } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";

const predecessorName = z.string().min(1).max(64).regex(/^[\x20-\x7E]+$/u).refine(value => value.trim() === value);
const shape = (schema: z.ZodType): JsonValue => {
  const { $schema: _dialect, ...projection } = z.toJSONSchema(schema, { io: "output", unrepresentable: "any", cycles: "ref" });
  return JsonValueSchema.parse(projection);
};
const isObject = (node: JsonValue): node is JsonObject => node !== null && typeof node === "object" && !Array.isArray(node);
const isProfileBinding = (node: JsonValue): boolean => isObject(node) && isObject(node.properties)
  && isObject(node.properties.kind) && node.properties.kind.const === "profile"
  && isObject(node.properties.inputPath) && node.properties.inputPath.const === "timekeeperName"
  && "profileId" in node.properties && "sessionEpoch" in node.properties;
const currentNameShape = canonicalJsonStringify(shape(ProfileDisplayNameSchema));

/** The stopped predecessor differs only in the name domain and admitted profile provenance. */
export function predecessorEvidenceSchemaHash(schema: z.ZodType, io: "input" | "output" = "output"): string {
  const rewrite = (node: JsonValue): JsonValue => {
    if (canonicalJsonStringify(node) === currentNameShape) return shape(predecessorName);
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isObject(node)) return node;
    const options = node.oneOf ?? node.anyOf;
    if (Array.isArray(options) && options.some(isProfileBinding)) {
      const key = node.oneOf === undefined ? "anyOf" : "oneOf";
      return Object.fromEntries(Object.entries(node).map(([field, value]) => [field, field === key
        ? options.filter((option: JsonValue) => !isProfileBinding(option)).map(rewrite) : rewrite(value)]));
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, rewrite(value)]));
  };
  const projection = JsonValueSchema.parse(z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref" }));
  return sha256Hex(`hrauto:schema-identity:v1\0${io}\0${canonicalJsonStringify(rewrite(projection))}`);
}

function assertPredecessorValue(value: unknown, schema: z.ZodType, io: "input" | "output"): void {
  const root = JsonValueSchema.parse(z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref" }));
  const visit = (node: JsonValue, data: JsonValue): void => {
    if (!isObject(node)) return;
    if (canonicalJsonStringify(node) === currentNameShape) { predecessorName.parse(data); return; }
    if (typeof node.$ref === "string") {
      if (!node.$ref.startsWith("#/")) throw new Error("evidence-schema-reference-refused");
      let target = root;
      for (const key of node.$ref.slice(2).split("/").map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"))) {
        if (!isObject(target) || target[key] === undefined) throw new Error("evidence-schema-reference-missing");
        target = target[key];
      }
      visit(target, data); return;
    }
    if (isObject(node.properties) && isObject(data)) {
      if (Object.entries(node.properties).some(([key, constraint]) => isObject(constraint) && constraint.const !== undefined
        && data[key] !== undefined && canonicalJsonStringify(data[key]) !== canonicalJsonStringify(constraint.const))) return;
      if (isProfileBinding(node)) throw new Error("evidence-schema-predecessor-profile-binding-refused");
      for (const [key, child] of Object.entries(node.properties)) if (data[key] !== undefined) visit(child, data[key]);
    }
    const options = node.oneOf ?? node.anyOf;
    if (Array.isArray(options)) options.forEach((option: JsonValue) => visit(option, data));
    if (node.items !== undefined && Array.isArray(data)) data.forEach((value: JsonValue) => visit(node.items, value));
  };
  visit(root, JsonValueSchema.parse(value));
}

export type EvidenceSchemaPlan = Readonly<{ admissions: readonly EvidenceSchemaAdmission[]; retirements: readonly EvidenceSchemaRetirement[] }>;

export function collectEvidenceSchemaAdmissions(input: Readonly<{ runs: readonly RunRecord[]; writes: readonly WriteIntentRecord[];
  checkpoints: readonly RunCheckpointRecord[]; descriptors: readonly AnyWorkflowDescriptor[];
  results?: readonly RunResultRecord[]; gates?: readonly GateResultRecord[]; delegations?: readonly DelegationManifest[] }>): EvidenceSchemaPlan {
  const admissions: EvidenceSchemaAdmission[] = [], retirements: EvidenceSchemaRetirement[] = [];
  const admit = (owner: EvidenceSchemaOwner, source: unknown, schemaHash: string, value: unknown, schema: z.ZodType, io: "input" | "output" = "output") => {
    const currentSchemaHash = deriveSchemaHash(schema, io), predecessorHash = predecessorEvidenceSchemaHash(schema, io);
    if (currentSchemaHash === predecessorHash) return;
    if (value !== undefined) schema.parse(value);
    if (schemaHash === currentSchemaHash) return;
    if (schemaHash !== predecessorHash) throw new Error("evidence-schema-source-selector-refused");
    if (value !== undefined) assertPredecessorValue(value, schema, io);
    admissions.push(EvidenceSchemaAdmissionSchema.parse({ owner, sourceSchemaHash: schemaHash, currentSchemaHash, sourceDigest: evidenceSchemaSourceDigest(owner, source) }));
  };
  for (const run of input.runs) {
    const descriptor = input.descriptors.find(descriptor => descriptor.id === run.envelope.workflow);
    if (descriptor === undefined) {
      if (["separations", "separations-kuali-finalization"].includes(run.envelope.workflow)) throw new Error("evidence-schema-current-contract-required");
      continue;
    }
    const owner = { kind: "run-input" as const, id: run.envelope.runId }, stored = run.input.parsed.schemaHash;
    if (stored !== deriveSchemaHash(descriptor.canonicalInput, "output") && stored !== predecessorEvidenceSchemaHash(descriptor.canonicalInput)
      && RETIRED_INPUT_GENERATIONS[descriptor.id]?.includes(stored) === true) {
      retirements.push(EvidenceSchemaRetirementSchema.parse({ owner, workflowId: descriptor.id, sourceSchemaHash: stored, sourceDigest: evidenceSchemaSourceDigest(owner, run.input) }));
      continue;
    }
    admit(owner, run.input, stored, run.input.parsed.value, descriptor.canonicalInput);
  }
  for (const intent of input.writes) {
    if (intent.taskId !== "kuali/save-separation-finalization") continue;
    const proof = intent.status === "committed" ? intent.completionProof : intent.status === "observed-present" ? intent.observedProof : undefined;
    if (proof !== undefined) admit({ kind: "write-proof", id: intent.writeIntentId, generation: intent.generation }, intent,
      proof.schemaHash, proof.value, KualiSavedFinalizationProofSchema);
  }
  for (const checkpoint of input.checkpoints) {
    const descriptor = input.descriptors.find(descriptor => descriptor.id === checkpoint.workflowId);
    const node = descriptor === undefined ? undefined : descriptorRuntimeNodes(descriptor).find(node => node.id === checkpoint.nodeId);
    if (node?.kind === "task") admit({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint,
      checkpoint.output.schemaHash, checkpoint.output.value, node.uses.output);
    const parsed = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
    if (!parsed.success || !isObject(parsed.data.proof.value) || parsed.data.proof.value.kind !== "kuali-saved-finalization") continue;
    const outcome = parsed.data;
    const proof = KualiSavedFinalizationProofSchema.parse(outcome.proof.value);
    const key = kualiFinalizationIdempotencyKey({ documentNumber: proof.documentNumber, variables: { transactionNumber: proof.fields.transactionNumber } });
    const intent = input.writes.find(intent => intent.system === "kuali" && intent.taskId === "kuali/save-separation-finalization" && intent.idempotencyKey === key);
    const durable = intent?.status === "committed" ? intent.completionProof : intent?.status === "observed-present" ? intent.observedProof : undefined;
    const output = KualiSaveSeparationFinalizationOutputSchema.parse(outcome.output.value);
    if (durable === undefined || canonicalJsonStringify(durable.value) !== canonicalJsonStringify(proof)
      || canonicalJsonStringify(output.savedState) !== canonicalJsonStringify(proof)) throw new Error("evidence-schema-write-proof-link-changed");
    admit({ kind: "checkpoint-proof", id: checkpointRecordKey(checkpoint) }, checkpoint, outcome.proof.schemaHash, outcome.proof.value, KualiSavedFinalizationProofSchema);
    admit({ kind: "checkpoint-output", id: checkpointRecordKey(checkpoint) }, checkpoint, outcome.output.schemaHash, outcome.output.value, KualiSaveSeparationFinalizationOutputSchema);
  }
  for (const result of input.results ?? []) {
    if (readRunPreviewResult(result) !== undefined || terminalEvidenceResult(result) !== undefined) continue;
    const descriptor = input.descriptors.find(descriptor => descriptor.id === result.workflowId);
    if (descriptor === undefined) continue;
    admit({ kind: "run-result", id: result.runId }, result, result.resultSchemaHash, result.result.value, workflowTerminalResultExecution(descriptor).schema);
  }
  for (const gate of input.gates ?? []) {
    const run = input.runs.find(run => run.envelope.runId === gate.runId);
    const descriptor = input.descriptors.find(descriptor => descriptor.id === run?.envelope.workflow);
    const node = descriptor === undefined ? undefined : descriptorRuntimeNodes(descriptor).find(node => node.id === gate.nodeId);
    if (node?.kind === "gate") admit({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate,
      gate.result.schemaHash, gate.result.value, node.result);
  }
  for (const manifest of input.delegations ?? []) {
    const parent = input.runs.find(run => run.envelope.runId === manifest.parentRunId);
    const descriptor = input.descriptors.find(descriptor => descriptor.id === parent?.envelope.workflow);
    const node = descriptor === undefined ? undefined : descriptorRuntimeNodes(descriptor).find(node => node.kind === "child-run" && node.edgeId === manifest.edgeId);
    if (node?.kind !== "child-run") continue;
    admit({ kind: "delegation-input", id: manifest.manifestId }, manifest, manifest.inputSchemaHash, undefined, node.target.input, "input");
    admit({ kind: "delegation-result", id: manifest.manifestId }, manifest, manifest.resultSchemaHash, undefined, node.target.result);
  }
  const byOwner = (left: { owner: unknown }, right: { owner: unknown }) => canonicalJsonStringify(left.owner).localeCompare(canonicalJsonStringify(right.owner));
  return { admissions: admissions.sort(byOwner), retirements: retirements.sort(byOwner) };
}
