import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  FingerprintSchema,
  NodeIdSchema,
  ScenarioIdSchema,
  WorkflowIdSchema,
  slugSchema,
} from "../ids.js";
import { deepFreeze } from "../immutability.js";
import { sha256Hex } from "../sha256.js";
import { DryRunSubjectLabelSchema } from "./dry-run-scenario-result.js";

export const DryRunSubjectKindSchema = z.enum([
  "ordinary",
  "already-present",
  "no-active-job",
  "ambiguous-name",
  "subject-mismatch",
  "name-differs",
  "concurrent-jobs",
]);

export const DryRunWriteSafetyCountsSchema = z.strictObject({
  writeIntents: z.number().int().nonnegative(),
  writeAttempts: z.number().int().nonnegative(),
  durableOutbox: z.number().int().nonnegative(),
});

const CheckpointKeyPartSchema = z.enum([
  "workflow",
  "item",
  "node",
  "attempt",
  "claimGeneration",
]);

export const DryRunCheckpointExpectationSchema = z.strictObject({
  node: NodeIdSchema,
  attempt: z.number().int().positive(),
  keyedBy: z.array(CheckpointKeyPartSchema).min(1),
});

export const DryRunGateExpectationSchema = z.strictObject({
  gate: NodeIdSchema,
  decision: slugSchema("dry-run gate decision must be kebab-case"),
  resolvedBy: slugSchema("dry-run gate resolver must be kebab-case"),
  leaf: z.string().min(1),
});

export const DryRunReceiptExpectationSchema = z.strictObject({
  result: z.enum(["partial", "done-with-warnings", "failed", "cancelled"]),
  confidence: z.enum(["partial", "unknown"]),
  verification: z.array(z.strictObject({
    node: NodeIdSchema,
    verdict: z.enum(["present", "absent", "unknown", "ambiguous"]),
    mandatory: z.boolean(),
  })),
  obligations: z.array(z.strictObject({
    obligation: slugSchema("dry-run receipt obligation must be kebab-case"),
    verdict: z.enum(["met", "unmet", "unknown"]),
    why: z.string().min(1),
  })),
});

export const DryRunTerminalExpectationSchema = z.discriminatedUnion("lifecycle", [
  z.strictObject({
    lifecycle: z.literal("done"),
    resultSchema: z.literal("RunDryRunPreviewResultSchema"),
    kind: z.literal("dry-run-preview"),
    externalCommit: z.literal("none"),
    stoppedAtNodeId: NodeIdSchema,
  }),
  z.strictObject({
    lifecycle: z.literal("failed"),
    reason: z.string().min(1),
    openItem: z.string().min(1),
  }),
]);

export const DryRunPreviewExpectationSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("would-prepare"),
    subject: z.enum(["match", "not-observed"]),
    staged: z.boolean(),
  }),
  z.strictObject({
    outcome: z.literal("already-present"),
    proofSource: z.enum(["durable-intent", "live-probe"]),
  }),
  z.strictObject({
    outcome: z.literal("not-reached"),
    reason: z.string().min(1),
  }),
]);

export const DryRunScenarioCaseSchema = z.strictObject({
  caseId: slugSchema("dry-run case id must be kebab-case"),
  subjectLabel: DryRunSubjectLabelSchema,
  subjectKind: DryRunSubjectKindSchema,
  why: z.string().min(1),
  nodesReached: z.array(NodeIdSchema),
  nodesExcluded: z.array(NodeIdSchema),
  checkpoints: z.array(DryRunCheckpointExpectationSchema),
  gateResults: z.array(DryRunGateExpectationSchema),
  durableDeltas: z.strictObject({
    writeIntents: z.literal(0),
    writeAttempts: z.literal(0),
    durableOutbox: z.literal(0),
  }),
  receipt: DryRunReceiptExpectationSchema,
  terminal: DryRunTerminalExpectationSchema,
  preview: DryRunPreviewExpectationSchema,
});

export const DryRunScenarioManifestSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  workflow: WorkflowIdSchema,
  transactionNode: NodeIdSchema,
  recordedBy: z.string().min(1),
  cases: z.array(DryRunScenarioCaseSchema).min(1),
}).superRefine((manifest, context) => {
  for (const [field, values] of [
    ["caseId", manifest.cases.map(({ caseId }) => caseId)],
    ["subjectLabel", manifest.cases.map(({ subjectLabel }) => subjectLabel)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: `dry-run manifest ${manifest.workflow} repeats a ${field}`,
      });
    }
  }
});

export type DryRunScenarioManifest = z.infer<typeof DryRunScenarioManifestSchema>;
export type DryRunScenarioCase = z.infer<typeof DryRunScenarioCaseSchema>;
export type DryRunCheckpointExpectation = z.infer<typeof DryRunCheckpointExpectationSchema>;
export type DryRunGateExpectation = z.infer<typeof DryRunGateExpectationSchema>;
export type DryRunWriteSafetyCounts = z.infer<typeof DryRunWriteSafetyCountsSchema>;

export function parseDryRunScenarioManifest(input: unknown): DryRunScenarioManifest {
  return deepFreeze(DryRunScenarioManifestSchema.parse(input));
}

export function deriveDryRunScenarioManifestDigest(manifest: unknown): string {
  const parsed = DryRunScenarioManifestSchema.parse(manifest);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:dry-run-scenario-manifest:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}
