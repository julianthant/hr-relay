import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { Clock } from "./clock.js";
import { deepFreeze } from "./immutability.js";
import {
  ArtifactIdSchema,
  BrowserSystemIdSchema,
  EvidenceRefSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  LeaseIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
  WriteAttemptIdSchema,
  WriteBindingProofIdSchema,
  WriteIntentIdSchema,
} from "./ids.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";

export const SpanPathSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
  "span path must be slash-delimited kebab-case",
);

export const SubjectEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person"),
    identifierKind: z.enum(["eid", "kuali-id", "email"]),
    bindingDigest: FingerprintSchema,
    displaySuffix: z.string().regex(/^[A-Za-z0-9*@._-]{2,32}$/),
  }),
  z.strictObject({
    kind: z.literal("artifact"),
    artifactId: ArtifactIdSchema,
    bindingDigest: FingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("catalog"),
    catalogKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    bindingDigest: FingerprintSchema,
  }),
]);

export const SubjectProofSchema = z.strictObject({
  kind: z.literal("subject-match"),
  version: z.literal(1),
  proofId: WriteBindingProofIdSchema,
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  taskId: TaskIdSchema,
  observationId: ObservationIdSchema,
  pageStateId: PageStateIdSchema,
  expected: SubjectEvidenceSchema,
  observed: SubjectEvidenceSchema,
  match: z.literal("match"),
  observedAt: IsoInstantSchema,
  afterPrepareSpanPath: SpanPathSchema,
}).superRefine((proof, context) => {
  if (canonicalJsonStringify(proof.expected) !== canonicalJsonStringify(proof.observed)) {
    context.addIssue({ code: "custom", path: ["observed"], message: "subject-match proof requires identical expected and observed binding evidence" });
  }
});

export const UnscopedCommitReasonIdSchema = z.enum([
  "catalog-global-write",
  "system-global-configuration",
  "document-without-person-scope",
]);

export const UnscopedCommitReasonSpecSchema = z.strictObject({
  id: UnscopedCommitReasonIdSchema,
  reviewed: z.literal(true),
  rationale: z.string().min(1),
});

export const UNSCOPED_COMMIT_REASON_REGISTRY = deepFreeze(UnscopedCommitReasonSpecSchema.array().parse([
  { id: "catalog-global-write", reviewed: true, rationale: "The target is an explicitly global catalog record with no person or artifact subject." },
  { id: "system-global-configuration", reviewed: true, rationale: "The target is a reviewed system-wide configuration surface." },
  { id: "document-without-person-scope", reviewed: true, rationale: "The destination accepts one document whose staged page exposes no stronger subject identity." },
]));

export const UnscopedBindingProofSchema = z.strictObject({
  kind: z.literal("unscoped"),
  version: z.literal(1),
  proofId: WriteBindingProofIdSchema,
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  taskId: TaskIdSchema,
  pageStateId: PageStateIdSchema,
  reviewedReasonId: UnscopedCommitReasonIdSchema,
  observedAt: IsoInstantSchema,
  afterPrepareSpanPath: SpanPathSchema,
});

export const WriteBindingProofSchema = z.discriminatedUnion("kind", [
  SubjectProofSchema,
  UnscopedBindingProofSchema,
]);

export const AbsentEvidenceSchema = z.strictObject({
  idempotencyKeyDigest: FingerprintSchema,
  source: ObservationIdSchema,
  sourceState: PageStateIdSchema,
  observedAt: IsoInstantSchema,
  queryDigest: FingerprintSchema,
  evidenceRef: EvidenceRefSchema,
});

export function probeVerdictSchema<ProofSchema extends z.ZodType>(proofSchema: ProofSchema) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), proof: proofSchema }),
    z.strictObject({ state: z.literal("absent"), evidence: AbsentEvidenceSchema }),
    z.strictObject({ state: z.literal("ambiguous"), matches: z.number().int().min(2), observedAt: IsoInstantSchema, queryDigest: FingerprintSchema, evidence: z.array(EvidenceRefSchema).min(2) }),
    z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1), observedAt: IsoInstantSchema }),
  ]);
}

export const PresentProofReferenceSchema = z.strictObject({
  proofSchemaHash: FingerprintSchema,
  proofFingerprint: FingerprintSchema,
  evidenceRef: EvidenceRefSchema,
});

export const RecoveryProbeVerdictSchema = probeVerdictSchema(PresentProofReferenceSchema);

export const NegativeSettlementPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("stabilized"),
    minSinceFenceMs: z.number().int().positive(),
    consistentReads: z.union([z.literal(2), z.literal(3)]),
    minBetweenReadsMs: z.number().int().positive(),
    requireSameSourceState: z.literal(true),
  }),
  z.strictObject({ kind: z.literal("operator-only"), reason: z.string().min(1) }),
]);

export const NegativeSettlementEvaluationInputSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  idempotencyKeyDigest: FingerprintSchema,
  fencedAt: IsoInstantSchema,
  policy: NegativeSettlementPolicySchema,
  verdicts: z.array(RecoveryProbeVerdictSchema),
});

const SafeToRetrySettlementSchema = z.strictObject({
  state: z.literal("safe-to-retry"),
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  decidedAt: IsoInstantSchema,
  evidence: z.array(AbsentEvidenceSchema).min(2).max(3),
});

export const NegativeSettlementDecisionSchema = z.discriminatedUnion("state", [
  SafeToRetrySettlementSchema,
  z.strictObject({
    state: z.literal("wait"),
    writeIntentId: WriteIntentIdSchema,
    generation: PositiveIntSchema,
    decidedAt: IsoInstantSchema,
    notBefore: IsoInstantSchema,
    observationsNeeded: PositiveIntSchema,
  }),
  z.strictObject({
    state: z.literal("parked"),
    writeIntentId: WriteIntentIdSchema,
    generation: PositiveIntSchema,
    decidedAt: IsoInstantSchema,
    code: z.enum(["operator-only", "present", "ambiguous", "unknown", "inconsistent-evidence"]),
    reason: z.string().min(1),
  }),
]);

function decisionBase(
  input: z.infer<typeof NegativeSettlementEvaluationInputSchema>,
  clock: Clock,
) {
  return {
    writeIntentId: input.writeIntentId,
    generation: input.generation,
    decidedAt: IsoInstantSchema.parse(clock.now().toISOString()),
  };
}

export function evaluateNegativeSettlement(
  input: unknown,
  clock: Clock,
): z.infer<typeof NegativeSettlementDecisionSchema> {
  const parsed = NegativeSettlementEvaluationInputSchema.parse(input);
  const base = decisionBase(parsed, clock);
  if (parsed.policy.kind === "operator-only") {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "operator-only", reason: parsed.policy.reason });
  }

  for (const verdict of parsed.verdicts) {
    if (verdict.state === "present") {
      return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "present", reason: "the recovery probe found a present transaction; negative settlement cannot authorize retry" });
    }
    if (verdict.state === "ambiguous") {
      return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "ambiguous", reason: `the recovery probe found ${verdict.matches} matches` });
    }
    if (verdict.state === "unknown") {
      return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "unknown", reason: verdict.reason });
    }
  }

  const absences = parsed.verdicts.map((verdict) => verdict.state === "absent" ? verdict.evidence : undefined)
    .filter((evidence): evidence is z.infer<typeof AbsentEvidenceSchema> => evidence !== undefined);
  if (absences.some(({ idempotencyKeyDigest }) => idempotencyKeyDigest !== parsed.idempotencyKeyDigest)) {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence does not bind the fenced idempotency key" });
  }
  for (let index = 1; index < absences.length; index += 1) {
    if (Date.parse(absences[index].observedAt) < Date.parse(absences[index - 1].observedAt)) {
      return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence is not in observation order" });
    }
  }

  const earliestQualifiedMs = Date.parse(parsed.fencedAt) + parsed.policy.minSinceFenceMs;
  const qualifying = absences.filter(({ observedAt }) => Date.parse(observedAt) >= earliestQualifiedMs);
  const first = qualifying[0];
  if (first !== undefined && qualifying.some((evidence) => (
    evidence.queryDigest !== first.queryDigest
    || evidence.source !== first.source
    || evidence.sourceState !== first.sourceState
  ))) {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence disagrees on query, source, or source state" });
  }

  const selected: z.infer<typeof AbsentEvidenceSchema>[] = [];
  for (const evidence of qualifying) {
    const prior = selected.at(-1);
    if (prior === undefined || Date.parse(evidence.observedAt) - Date.parse(prior.observedAt) >= parsed.policy.minBetweenReadsMs) {
      selected.push(evidence);
    }
  }
  if (selected.length >= parsed.policy.consistentReads) {
    return NegativeSettlementDecisionSchema.parse({
      ...base,
      state: "safe-to-retry",
      evidence: selected.slice(0, parsed.policy.consistentReads),
    });
  }

  const lastSelected = selected.at(-1);
  const nextEvidenceMs = lastSelected === undefined
    ? earliestQualifiedMs
    : Date.parse(lastSelected.observedAt) + parsed.policy.minBetweenReadsMs;
  return NegativeSettlementDecisionSchema.parse({
    ...base,
    state: "wait",
    notBefore: IsoInstantSchema.parse(new Date(Math.max(clock.nowMs(), nextEvidenceMs)).toISOString()),
    observationsNeeded: parsed.policy.consistentReads - selected.length,
  });
}

const WriteIntentIdentityFields = {
  writeIntentId: WriteIntentIdSchema,
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  taskId: TaskIdSchema,
  system: BrowserSystemIdSchema,
  idempotencyKeyDigest: FingerprintSchema,
} as const;

const WriteIntentAttemptFields = {
  ...WriteIntentIdentityFields,
  currentAttemptId: WriteAttemptIdSchema,
  generation: PositiveIntSchema,
  runId: RunIdSchema,
  runAttempt: PositiveIntSchema,
  bindingProof: WriteBindingProofSchema,
  fencedAt: IsoInstantSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
} as const;

export const WriteIntentRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...WriteIntentAttemptFields, status: z.literal("attempting") }),
  z.strictObject({ ...WriteIntentAttemptFields, status: z.literal("committed"), completionProof: SchemaBoundCanonicalValueSchema, confirmedAt: IsoInstantSchema }),
  z.strictObject({ ...WriteIntentAttemptFields, status: z.literal("retryable"), settlement: SafeToRetrySettlementSchema, resolvedAt: IsoInstantSchema }),
  z.strictObject({ ...WriteIntentAttemptFields, status: z.literal("parked"), parkedCode: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]), message: z.string().min(1) }),
]);

const WriteAttemptFields = {
  writeAttemptId: WriteAttemptIdSchema,
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  runId: RunIdSchema,
  runAttempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  bindingProof: WriteBindingProofSchema,
  fencedAt: IsoInstantSchema,
} as const;

export const WriteAttemptRecordSchema = z.strictObject({
  ...WriteAttemptFields,
  outcome: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("attempting") }),
    z.strictObject({ state: z.literal("committed"), completionProof: SchemaBoundCanonicalValueSchema, confirmedAt: IsoInstantSchema }),
    z.strictObject({ state: z.literal("safe-to-retry"), settlement: SafeToRetrySettlementSchema }),
    z.strictObject({ state: z.literal("parked"), code: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/), message: z.string().min(1) }),
  ]),
  recordedAt: IsoInstantSchema,
});

export type SubjectProof = z.infer<typeof SubjectProofSchema>;
export type UnscopedBindingProof = z.infer<typeof UnscopedBindingProofSchema>;
export type WriteBindingProof = z.infer<typeof WriteBindingProofSchema>;
export type AbsentEvidence = z.infer<typeof AbsentEvidenceSchema>;
export type ProbeVerdict<ProofSchema extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<ProofSchema>>>;
export type NegativeSettlementPolicy = z.infer<typeof NegativeSettlementPolicySchema>;
export type NegativeSettlementDecision = z.infer<typeof NegativeSettlementDecisionSchema>;
export type WriteIntentRecord = z.infer<typeof WriteIntentRecordSchema>;
export type WriteAttemptRecord = z.infer<typeof WriteAttemptRecordSchema>;
