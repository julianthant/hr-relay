/**
 * Durable terminal workflow results and the exact checkpoint identities from
 * which they were derived (doc 02 §5.7, D114).
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import type { Fingerprint } from "../ids.js";
import { SchemaBoundCanonicalValueSchema } from "../schema-bound-value.js";
import { sha256Hex } from "../sha256.js";
import { RunCheckpointRecordSchema } from "../workflow/checkpoint.js";

export const TerminalNotRunReasonSchema = z.enum([
  "condition-false",
  "branch-not-selected",
]);

export const ResolvedTerminalDependencySchema = z.strictObject({
  state: z.literal("resolved"),
  nodeId: NodeIdSchema,
  checkpoint: z.strictObject({
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema,
    runId: RunIdSchema,
  }),
  outputSchemaHash: FingerprintSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  implFingerprint: FingerprintSchema,
  outputDigest: FingerprintSchema,
  provenanceDigest: FingerprintSchema,
});

export const NotRunTerminalDependencySchema = z.strictObject({
  state: z.literal("not-run"),
  nodeId: NodeIdSchema,
  reason: TerminalNotRunReasonSchema,
});

export const TerminalDependencyRecordSchema = z.discriminatedUnion("state", [
  ResolvedTerminalDependencySchema,
  NotRunTerminalDependencySchema,
]);

/** Exact executor evidence consumed by the factory-owned terminal derive. */
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

export function deriveRunResultDigest(result: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:run-result:v1\0${canonicalJsonStringify(result)}`,
  ));
}

export function deriveTerminalDependencyDigest(dependencies: unknown): Fingerprint {
  const parsed = z.array(TerminalDependencyRecordSchema).parse(dependencies);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:run-result-dependencies:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export function deriveCheckpointOutputDigest(output: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:checkpoint-output:v1\0${canonicalJsonStringify(output)}`,
  ));
}

export function deriveCheckpointProvenanceDigest(provenance: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:checkpoint-provenance:v1\0${canonicalJsonStringify(provenance)}`,
  ));
}

export const RunResultRecordSchema = z.strictObject({
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  workflowId: WorkflowIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  resultSchemaHash: FingerprintSchema,
  result: SchemaBoundCanonicalValueSchema,
  resultDigest: FingerprintSchema,
  dependencies: z.array(TerminalDependencyRecordSchema),
  dependencyDigest: FingerprintSchema,
  createdAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.result.schemaHash !== record.resultSchemaHash) {
    context.addIssue({
      code: "custom",
      path: ["result", "schemaHash"],
      message: "terminal result schema hash must equal resultSchemaHash",
    });
  }
  if (record.resultDigest !== deriveRunResultDigest(record.result)) {
    context.addIssue({
      code: "custom",
      path: ["resultDigest"],
      message: "terminal result digest must match the exact schema-bound canonical result",
    });
  }
  if (record.dependencyDigest !== deriveTerminalDependencyDigest(record.dependencies)) {
    context.addIssue({
      code: "custom",
      path: ["dependencyDigest"],
      message: "terminal dependency digest must match the ordered dependency identities",
    });
  }
  const nodeIds = record.dependencies.map(({ nodeId }) => nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) {
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message: "terminal dependencies must contain each node identity exactly once",
    });
  }
  const resolved = record.dependencies.filter((dependency) => dependency.state === "resolved");
  const itemIds = new Set(resolved.map(({ checkpoint }) => checkpoint.itemId));
  if (itemIds.size > 1) {
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message: "resolved terminal dependencies must belong to one logical item",
    });
  }
  for (const [index, dependency] of resolved.entries()) {
    if (dependency.checkpoint.workflowId !== record.workflowId) {
      context.addIssue({
        code: "custom",
        path: ["dependencies", index, "checkpoint", "workflowId"],
        message: "resolved terminal dependency workflow must equal the result workflow",
      });
    }
    if (dependency.checkpoint.attempt > record.attempt) {
      context.addIssue({
        code: "custom",
        path: ["dependencies", index, "checkpoint", "attempt"],
        message: "resolved terminal dependency cannot come from a future attempt",
      });
    }
  }
});

export type TerminalNotRunReason = z.infer<typeof TerminalNotRunReasonSchema>;
export type TerminalDependencyRecord = z.infer<typeof TerminalDependencyRecordSchema>;
export type TerminalDependencyEvidence = z.infer<typeof TerminalDependencyEvidenceSchema>;
export type RunResultRecord = z.infer<typeof RunResultRecordSchema>;
