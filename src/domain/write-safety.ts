import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { Clock } from "./clock.js";
import {
  ActorIdSchema,
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
import { UnscopedCommitReasonIdSchema } from "./unscoped-commit.js";
export {
  UNSCOPED_COMMIT_REASON_REGISTRY,
  UnscopedCommitReasonIdSchema,
  UnscopedCommitReasonSpecSchema,
} from "./unscoped-commit.js";
import {
  AbsentEvidenceSchema,
  NegativeSettlementPolicySchema,
  probeVerdictSchema,
} from "./write-safety-primitives.js";
export {
  AbsentEvidenceSchema,
  NegativeSettlementPolicySchema,
  probeVerdictSchema,
  // The durable transaction settlement lives in the browser-safe half so a
  // descriptor closure can hash it (D144); doc 09's module stays its address.
  TransactionOutcomeSchema,
} from "./write-safety-primitives.js";
export type {
  NegativeSettlementPolicy,
  ProbeVerdict,
  TransactionOutcome,
} from "./write-safety-primitives.js";

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

export const IdempotencyKeySchema = z.string().min(1).max(512).superRefine((key, context) => {
  if (key !== key.trim()) context.addIssue({ code: "custom", message: "idempotency key may not have leading or trailing whitespace" });
  if ([...key].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  })) {
    context.addIssue({ code: "custom", message: "idempotency key may not contain control characters" });
  }
});

export function deriveIdempotencyKeyDigest(systemInput: unknown, keyInput: unknown): string {
  const system = BrowserSystemIdSchema.parse(systemInput);
  const key = IdempotencyKeySchema.parse(keyInput);
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:permanent-write-key:v1\0")
    .update(system)
    .update("\0")
    .update(key)
    .digest("hex"));
}

export function deriveWriteBindingProofDigest(proofInput: unknown): string {
  const proof = WriteBindingProofSchema.parse(proofInput);
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:write-binding-proof:v1\0")
    .update(canonicalJsonStringify(proof))
    .digest("hex"));
}

export const PresentProofReferenceSchema = z.strictObject({
  proofSchemaHash: FingerprintSchema,
  proofFingerprint: FingerprintSchema,
  evidenceRef: EvidenceRefSchema,
});

export const RecoveryProbeVerdictSchema = probeVerdictSchema(PresentProofReferenceSchema);

export const NegativeSettlementEvaluationInputSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  idempotencyKeyDigest: FingerprintSchema,
  authoritativeSource: ObservationIdSchema,
  authoritativeSourceState: PageStateIdSchema,
  queryDigest: FingerprintSchema,
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

/**
 * Doc 09 §4.1.2 — the operator's typed confirmed-absent resolution. It is the
 * ONLY non-evidence path from `attempting`/`parked` to `retryable`: it records
 * who confirmed absence in the target system, when, and the non-empty evidence
 * note, scoped to the exact intent generation it resolves. It never deletes or
 * reopens committed history and it does not itself click — only the next fence
 * may create a new generation.
 */
export const OperatorAbsenceResolutionSchema = z.strictObject({
  state: z.literal("operator-confirmed-absent"),
  writeIntentId: WriteIntentIdSchema,
  /** The prior generation this resolution settles — never a future one. */
  generation: PositiveIntSchema,
  operator: ActorIdSchema,
  confirmedAt: IsoInstantSchema,
  evidenceNote: z.string().min(1),
});

/** Either D64/D69 stabilized negative evidence or a typed operator resolution. */
export const WriteRetrySettlementSchema = z.discriminatedUnion("state", [
  SafeToRetrySettlementSchema,
  OperatorAbsenceResolutionSchema,
]);

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
  if (absences.some((evidence) => (
    evidence.idempotencyKeyDigest !== parsed.idempotencyKeyDigest
    || evidence.queryDigest !== parsed.queryDigest
    || evidence.source !== parsed.authoritativeSource
    || evidence.sourceState !== parsed.authoritativeSourceState
  ))) {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence does not bind the exact fenced key, query, authoritative source, and source state" });
  }
  if (absences.some(({ observedAt }) => Date.parse(observedAt) > clock.nowMs())) {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence claims an observation after the settlement decision time" });
  }
  for (let index = 1; index < absences.length; index += 1) {
    if (Date.parse(absences[index].observedAt) < Date.parse(absences[index - 1].observedAt)) {
      return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative evidence is not in observation order" });
    }
  }

  const earliestQualifiedMs = Date.parse(parsed.fencedAt) + parsed.policy.minSinceFenceMs;
  const qualifying = absences.filter(({ observedAt }) => Date.parse(observedAt) >= earliestQualifiedMs);
  if (new Set(qualifying.map(({ evidenceRef }) => evidenceRef)).size !== qualifying.length) {
    return NegativeSettlementDecisionSchema.parse({ ...base, state: "parked", code: "inconsistent-evidence", reason: "negative settlement requires distinct qualifying observation evidence" });
  }
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
  idempotencyKey: IdempotencyKeySchema,
  idempotencyKeyDigest: FingerprintSchema,
} as const;

const WriteIntentAttemptFields = {
  ...WriteIntentIdentityFields,
  currentAttemptId: WriteAttemptIdSchema,
  generation: PositiveIntSchema,
  runId: RunIdSchema,
  runAttempt: PositiveIntSchema,
  bindingProof: WriteBindingProofSchema,
  bindingProofDigest: FingerprintSchema,
  fencedAt: IsoInstantSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
} as const;

const WriteIntentObservedPresentFields = {
  ...WriteIntentIdentityFields,
  generation: PositiveIntSchema,
  status: z.literal("observed-present"),
  observedProof: SchemaBoundCanonicalValueSchema,
  observedAt: IsoInstantSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
} as const;

const ObservedPresentWriteIntentRecordSchema = z.strictObject(WriteIntentObservedPresentFields);
const AttemptingWriteIntentRecordSchema = z.strictObject({ ...WriteIntentAttemptFields, status: z.literal("attempting") });
const CommittedWriteIntentRecordSchema = z.strictObject({
  ...WriteIntentAttemptFields,
  status: z.literal("committed"),
  completionProof: SchemaBoundCanonicalValueSchema,
  confirmedAt: IsoInstantSchema,
});
const RetryableWriteIntentRecordSchema = z.strictObject({
  ...WriteIntentAttemptFields,
  status: z.literal("retryable"),
  settlement: WriteRetrySettlementSchema,
  resolvedAt: IsoInstantSchema,
});
const ParkedWriteIntentRecordSchema = z.strictObject({
  ...WriteIntentAttemptFields,
  status: z.literal("parked"),
  parkedCode: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
  message: z.string().min(1),
});

export const WriteIntentRecordSchema = z.discriminatedUnion("status", [
  ObservedPresentWriteIntentRecordSchema,
  AttemptingWriteIntentRecordSchema,
  CommittedWriteIntentRecordSchema,
  RetryableWriteIntentRecordSchema,
  ParkedWriteIntentRecordSchema,
]).superRefine((record, context) => {
  const expectedDigest = deriveIdempotencyKeyDigest(record.system, record.idempotencyKey);
  if (record.idempotencyKeyDigest !== expectedDigest) {
    context.addIssue({ code: "custom", path: ["idempotencyKeyDigest"], message: "idempotency key digest does not match the exact system and natural key" });
  }
  if (record.status !== "observed-present"
    && record.bindingProofDigest !== deriveWriteBindingProofDigest(record.bindingProof)) {
    context.addIssue({ code: "custom", path: ["bindingProofDigest"], message: "binding proof digest does not match the stored proof" });
  }
});

const WriteAttemptFields = {
  writeAttemptId: WriteAttemptIdSchema,
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  runId: RunIdSchema,
  runAttempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  bindingProof: WriteBindingProofSchema,
  bindingProofDigest: FingerprintSchema,
  fencedAt: IsoInstantSchema,
} as const;

export const WriteAttemptRecordSchema = z.strictObject({
  ...WriteAttemptFields,
  outcome: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("attempting") }),
    z.strictObject({ state: z.literal("committed"), completionProof: SchemaBoundCanonicalValueSchema, confirmedAt: IsoInstantSchema }),
    z.strictObject({ state: z.literal("safe-to-retry"), settlement: WriteRetrySettlementSchema }),
    z.strictObject({ state: z.literal("parked"), code: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/), message: z.string().min(1) }),
  ]),
  recordedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.bindingProofDigest !== deriveWriteBindingProofDigest(record.bindingProof)) {
    context.addIssue({ code: "custom", path: ["bindingProofDigest"], message: "binding proof digest does not match the stored proof" });
  }
});

export type OperatorAbsenceResolution = z.infer<typeof OperatorAbsenceResolutionSchema>;
export type WriteRetrySettlement = z.infer<typeof WriteRetrySettlementSchema>;
export type SubjectProof = z.infer<typeof SubjectProofSchema>;
export type UnscopedBindingProof = z.infer<typeof UnscopedBindingProofSchema>;
export type WriteBindingProof = z.infer<typeof WriteBindingProofSchema>;
export type AbsentEvidence = z.infer<typeof AbsentEvidenceSchema>;
export type NegativeSettlementDecision = z.infer<typeof NegativeSettlementDecisionSchema>;
export type WriteIntentRecord = z.infer<typeof WriteIntentRecordSchema>;
export type WriteAttemptRecord = z.infer<typeof WriteAttemptRecordSchema>;
