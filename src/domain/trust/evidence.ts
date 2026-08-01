import { z } from "zod";
import {
  ArtifactIdSchema,
  ErrorCodeSchema,
  EvidenceEntryIdSchema,
  EvidenceReceiptIdSchema,
  EvidenceRefSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteBindingProofIdSchema,
} from "../ids.js";
import { RedactedFieldSchema } from "../redaction.js";
import { WriteStateSchema } from "./failure.js";

const EvidenceSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), inputFingerprint: FingerprintSchema }),
  z.strictObject({ kind: z.literal("system"), taskId: TaskIdSchema, observedAt: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("checkpoint"), taskId: TaskIdSchema, checkpointFingerprint: FingerprintSchema, observedAt: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("operator-correction"), supersedes: EvidenceEntryIdSchema }),
  z.strictObject({ kind: z.literal("derived"), evidence: z.array(EvidenceRefSchema).min(1) }),
]);

const EvidenceFactFields = {
  id: EvidenceEntryIdSchema,
  field: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  mandatory: z.boolean(),
  source: EvidenceSourceSchema,
} as const;

export const EvidenceFactSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...EvidenceFactFields, state: z.literal("satisfied"), value: RedactedFieldSchema }),
  z.strictObject({ ...EvidenceFactFields, state: z.literal("unresolved"), reason: z.string().min(1) }),
]);

export const DecisionEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  kind: z.enum(["branch", "gate", "identity", "dedupe"]),
  outcome: z.enum(["taken", "not-taken", "blocked", "approved", "rejected"]),
  reason: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).min(1),
});

export const ActionEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  taskId: TaskIdSchema,
  kind: z.enum(["external-read", "prepare", "commit", "local-projection"]),
  writeState: WriteStateSchema,
  proofRef: WriteBindingProofIdSchema.optional(),
  artifactId: ArtifactIdSchema.optional(),
  occurredAt: IsoInstantSchema,
}).superRefine((action, context) => {
  if (action.kind === "commit" && action.writeState === "not-attempted") {
    context.addIssue({ code: "custom", path: ["writeState"], message: "commit evidence cannot claim the write was not attempted" });
  }
  if (action.writeState === "verified" && action.proofRef === undefined) {
    context.addIssue({ code: "custom", path: ["proofRef"], message: "verified write evidence requires a binding proof" });
  }
});

export const VerificationEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  obligation: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
  mandatory: z.boolean(),
  verdict: z.enum(["verified", "present", "absent", "unknown", "ambiguous"]),
  evidence: z.array(EvidenceRefSchema),
}).superRefine((verification, context) => {
  if (verification.verdict === "verified" && verification.evidence.length === 0) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "verified obligations require evidence" });
  }
});

export const ReuseEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  kind: z.enum(["fresh-live", "checkpoint", "corrected", "prior-proof"]),
  source: EvidenceRefSchema,
  ageMs: z.number().int().nonnegative(),
  freshnessLimitMs: z.number().int().positive(),
});

export const UncertaintyEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  loadBearing: z.boolean(),
  evidence: z.array(EvidenceRefSchema),
});

const OptionalFailureIdSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), value: FailureIdSchema }),
]);

const OptionalRunIdSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), value: RunIdSchema }),
]);

export const RunEvidenceReceiptSchema = z.strictObject({
  receiptId: EvidenceReceiptIdSchema,
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  attempt: PositiveIntSchema,
  generatedAt: IsoInstantSchema,
  descriptorFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  retryOf: OptionalRunIdSchema,
  failure: OptionalFailureIdSchema,
  input: z.array(EvidenceFactSchema),
  observations: z.array(EvidenceFactSchema),
  decisions: z.array(DecisionEvidenceSchema),
  actions: z.array(ActionEvidenceSchema),
  verification: z.array(VerificationEvidenceSchema),
  output: z.array(EvidenceFactSchema),
  reuse: z.array(ReuseEvidenceSchema),
  warnings: z.array(UncertaintyEvidenceSchema),
  confidence: z.enum(["verified", "partial", "unknown"]),
  result: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]),
}).superRefine((receipt, context) => {
  const facts = [...receipt.input, ...receipt.observations, ...receipt.output];
  const evidenceIds = [
    ...facts.map(({ id }) => id),
    ...receipt.decisions.map(({ id }) => id),
    ...receipt.actions.map(({ id }) => id),
    ...receipt.verification.map(({ id }) => id),
    ...receipt.reuse.map(({ id }) => id),
    ...receipt.warnings.map(({ id }) => id),
  ];
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: "custom", message: "receipt evidence ids must be unique" });
  }
  const unresolvedMandatoryFact = facts.some((fact) => fact.mandatory && fact.state === "unresolved");
  const unresolvedMandatoryVerification = receipt.verification.some((verification) => (
    verification.mandatory && (verification.verdict === "unknown" || verification.verdict === "ambiguous")
  ));
  if (receipt.result === "verified-done") {
    if (receipt.confidence !== "verified") context.addIssue({ code: "custom", path: ["confidence"], message: "verified-done requires verified confidence" });
    if (unresolvedMandatoryFact || unresolvedMandatoryVerification) {
      context.addIssue({ code: "custom", path: ["verification"], message: "verified-done forbids unresolved mandatory evidence" });
    }
    if (receipt.warnings.length > 0) context.addIssue({ code: "custom", path: ["warnings"], message: "verified-done forbids warnings" });
    if (receipt.failure.state !== "absent") context.addIssue({ code: "custom", path: ["failure"], message: "verified-done forbids a failure" });
  }
  if (receipt.result === "done-with-warnings") {
    if (receipt.warnings.length === 0) context.addIssue({ code: "custom", path: ["warnings"], message: "done-with-warnings requires warnings" });
    if (receipt.warnings.some(({ loadBearing }) => loadBearing)) {
      context.addIssue({ code: "custom", path: ["warnings"], message: "done-with-warnings permits only non-load-bearing uncertainty" });
    }
    if (unresolvedMandatoryFact || unresolvedMandatoryVerification) {
      context.addIssue({ code: "custom", path: ["verification"], message: "done-with-warnings forbids unresolved mandatory evidence" });
    }
  }
  if (receipt.result === "failed" && receipt.failure.state !== "present") {
    context.addIssue({ code: "custom", path: ["failure"], message: "failed receipts require a failure id" });
  }
  if (receipt.result !== "failed" && receipt.failure.state !== "absent") {
    context.addIssue({ code: "custom", path: ["failure"], message: "only failed receipts may carry a failure id" });
  }
});

export type RunEvidenceReceipt = z.infer<typeof RunEvidenceReceiptSchema>;
