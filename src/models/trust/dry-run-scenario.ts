import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FingerprintSchema,
  NodeIdSchema,
  ScenarioIdSchema,
  WorkflowIdSchema,
  slugSchema,
} from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { ObligationIdSchema } from "./evidence-obligations.js";
import { DryRunSubjectLabelSchema } from "./dry-run-scenario-result.js";

/**
 * What a manifest case's subject IS, across every workflow that has a T1b pair.
 *
 * The vocabulary is one closed list rather than one per workflow because a
 * manifest is parsed here, where no workflow is known. Which HALF a given
 * manifest may use is pinned one layer up, exactly: the test-target registry
 * types `kind` per workflow arm and refuses a manifest case whose kind
 * disagrees with its registered label, so `separations` cannot claim
 * `no-active-job` and `separations-kuali-finalization` cannot claim
 * `full-chain-dry-run`.
 */
export const DryRunSubjectKindSchema = z.enum([
  // `separations-kuali-finalization` — the scenario matrix's arms.
  "ordinary",
  "already-present",
  "no-active-job",
  "ambiguous-name",
  "subject-mismatch",
  "name-differs",
  "concurrent-jobs",
  // `separations` — the acceptance roles docs 03.2/03.3 map their targets into.
  "full-chain-dry-run",
  "future-dated",
  "controlled-commit-candidate",
  "pending-termination",
  // `person-lookup` — D318's transaction-free `live-read` arm: one search by EID.
  "search-by-eid",
]);

export const DryRunWriteSafetyCountsSchema = z.strictObject({
  writeIntents: z.number().int().nonnegative(),
  writeAttempts: z.number().int().nonnegative(),
  confirmedOperations: z.number().int().nonnegative(),
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

/**
 * Exactly the three facts `evaluateDryRunScenarioEvidence` compares. A fourth
 * (the resolver leaf) used to sit here and was never read — an expectation the
 * evaluator projects away is a claim nobody checks, so the boundary refuses it
 * rather than letting a manifest author believe it is asserted.
 */
export const DryRunGateExpectationSchema = z.strictObject({
  gate: NodeIdSchema,
  decision: slugSchema("dry-run gate decision must be kebab-case"),
  resolvedBy: slugSchema("dry-run gate resolver must be kebab-case"),
});

const ReceiptVerificationExpectationSchema = z.array(z.strictObject({
  obligation: ObligationIdSchema,
  verdict: z.enum(["verified", "present", "absent", "unknown", "ambiguous"]),
  mandatory: z.boolean(),
})).min(1);

/** A rehearsal derives `partial` / `unknown`, never `verified` (D237/D238). */
export const DryRunReceiptExpectationSchema = z.strictObject({
  result: z.enum(["partial", "done-with-warnings", "failed", "cancelled"]),
  confidence: z.enum(["partial", "unknown"]),
  verification: ReceiptVerificationExpectationSchema,
});

/**
 * D318 — a transaction-free live read previews no write, so its receipt may
 * truthfully reach `verified-done` / `verified` when its task evidence supports
 * that verdict. It is not forced to the preview arm's `partial|unknown`.
 */
export const LiveReadReceiptExpectationSchema = z.strictObject({
  result: z.enum(["verified-done", "done-with-warnings", "partial", "failed", "cancelled"]),
  confidence: z.enum(["verified", "partial", "unknown"]),
  verification: ReceiptVerificationExpectationSchema,
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
    code: ErrorCodeSchema,
    node: NodeIdSchema,
    fingerprint: FailureFingerprintSchema,
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

const CaseIdentityFields = {
  caseId: slugSchema("dry-run case id must be kebab-case"),
  subjectLabel: DryRunSubjectLabelSchema,
  subjectKind: DryRunSubjectKindSchema,
  why: z.string().min(1),
  nodesReached: z.array(NodeIdSchema),
  nodesExcluded: z.array(NodeIdSchema),
  checkpoints: z.array(DryRunCheckpointExpectationSchema),
  gateResults: z.array(DryRunGateExpectationSchema),
  /**
   * D85 part 4 — the positive no-write proof, as an exact zero delta over the
   * three write-authority tables. Both arms carry it: a preview mints no
   * intent, and a live read has no transaction to mint one.
   */
  durableDeltas: z.strictObject({
    writeIntents: z.literal(0),
    writeAttempts: z.literal(0),
    durableOutbox: z.literal(0),
  }),
} as const;

/** The transaction-preview arm's case: a preview terminal and the arm the transaction settled to. */
export const DryRunScenarioCaseSchema = z.strictObject({
  ...CaseIdentityFields,
  receipt: DryRunReceiptExpectationSchema,
  terminal: DryRunTerminalExpectationSchema,
  preview: DryRunPreviewExpectationSchema,
});

/**
 * D318 — the transaction-free arm's terminal: the ORDINARY workflow result,
 * bound to the descriptor's own declared result schema, or a node-bound
 * failure. There is no preview terminal, no `stoppedAtNodeId`, no staged page
 * and no `transaction.previewed` span because there is no transaction.
 */
export const LiveReadTerminalExpectationSchema = z.discriminatedUnion("lifecycle", [
  z.strictObject({
    lifecycle: z.literal("done"),
    resultSchema: z.literal("workflow-result"),
    kind: z.literal("live-read"),
  }),
  z.strictObject({
    lifecycle: z.literal("failed"),
    code: ErrorCodeSchema,
    node: NodeIdSchema,
    fingerprint: FailureFingerprintSchema,
  }),
]);

export const LiveReadScenarioCaseSchema = z.strictObject({
  ...CaseIdentityFields,
  receipt: LiveReadReceiptExpectationSchema,
  terminal: LiveReadTerminalExpectationSchema,
});

function refuseRepeatedCases(
  manifest: Readonly<{ workflow: string; cases: readonly Readonly<{ caseId: string; subjectLabel: string }>[] }>,
  context: z.RefinementCtx,
): void {
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
}

const ManifestIdentityFields = {
  scenarioId: ScenarioIdSchema,
  workflow: WorkflowIdSchema,
  recordedBy: z.string().min(1),
} as const;

/**
 * D318 — a T1b declaration chooses exactly ONE arm from the compiled graph:
 * `dry-run-preview` when the graph has a transaction node, `live-read` when
 * it has none. The runner refuses either mismatch before a browser or effect;
 * a no-op transaction added only to enter the preview arm is forbidden.
 */
export const DryRunPreviewManifestSchema = z.strictObject({
  ...ManifestIdentityFields,
  arm: z.literal("dry-run-preview"),
  transactionNode: NodeIdSchema,
  cases: z.array(DryRunScenarioCaseSchema).min(1),
});

export const LiveReadManifestSchema = z.strictObject({
  ...ManifestIdentityFields,
  arm: z.literal("live-read"),
  cases: z.array(LiveReadScenarioCaseSchema).min(1),
});

export const DryRunScenarioManifestSchema = z.discriminatedUnion("arm", [
  DryRunPreviewManifestSchema,
  LiveReadManifestSchema,
]).superRefine(refuseRepeatedCases);

export type DryRunScenarioManifest = z.infer<typeof DryRunScenarioManifestSchema>;
export type DryRunPreviewManifest = z.infer<typeof DryRunPreviewManifestSchema>;
export type LiveReadManifest = z.infer<typeof LiveReadManifestSchema>;
export type DryRunScenarioCase = z.infer<typeof DryRunScenarioCaseSchema>;
export type LiveReadScenarioCase = z.infer<typeof LiveReadScenarioCaseSchema>;
/** Either arm's case, as the runner and runtime select it by subject label. */
export const DryRunScenarioAnyCaseSchema = z.union([DryRunScenarioCaseSchema, LiveReadScenarioCaseSchema]);
export type DryRunScenarioAnyCase = z.infer<typeof DryRunScenarioAnyCaseSchema>;
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
