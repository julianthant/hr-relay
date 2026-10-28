import { sha256Hex } from "../validation/sha256.js";
import { RepeatOccurrenceSchema, repeatOccurrenceKey } from "../../models/run/rerun.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import type { Clock } from "../time/clock.js";
import {
  ActorIdSchema,
  CommandIdSchema,
  CommandAuditIdSchema,
  BrowserSystemIdSchema,
  EvidenceRefSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  LeaseIdSchema,
  ObservationIdSchema,
  NodeIdSchema,
  PageStateIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
  WriteAttemptIdSchema,
  WriteBindingProofIdSchema,
  WriteIntentIdSchema,
} from "../identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";
import { WriteAuthorityReasonSchema } from "./write-authority-reason.js";
export {
  deriveWriteAuthorityReason,
  WriteAuthorityReasonCodeSchema,
  WriteAuthorityReasonSchema,
  WriteSafetyAuthorityError,
} from "./write-authority-reason.js";
export type {
  WriteAuthorityReason,
  WriteAuthorityReasonCode,
} from "./write-authority-reason.js";
import { UnscopedCommitReasonIdSchema } from "../../models/write-safety/unscoped-commit.js";
export {
  UNSCOPED_COMMIT_REASON_REGISTRY,
  UnscopedCommitReasonIdSchema,
  UnscopedCommitReasonSpecSchema,
} from "../../models/write-safety/unscoped-commit.js";
import {
  AbsentEvidenceSchema,
  NegativeSettlementPolicySchema,
  probeVerdictSchema,
  SubjectEvidenceSchema,
} from "./write-safety-primitives.js";
export {
  AbsentEvidenceSchema,
  NegativeSettlementPolicySchema,
  probeVerdictSchema,
  // Keep settlement, subject evidence and previews browser-safe for descriptor hashing.
  SubjectEvidenceSchema,
  TransactionDryRunPreviewSchema,
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
  return FingerprintSchema.parse(sha256Hex(`hrauto:permanent-write-key:v1\0${system}\0${key}`));
}

export function deriveWriteBindingProofDigest(proofInput: unknown): string {
  const proof = WriteBindingProofSchema.parse(proofInput);
  return FingerprintSchema.parse(sha256Hex(`hrauto:write-binding-proof:v1\0${canonicalJsonStringify(proof)}`));
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

/** Typed absence permits retry for this intent generation; it neither erases history nor submits. */
export const OperatorAbsenceResolutionSchema = z.strictObject({
  state: z.literal("operator-confirmed-absent"),
  writeIntentId: WriteIntentIdSchema,
  /** The prior generation this resolution settles — never a future one. */
  generation: PositiveIntSchema,
  operator: ActorIdSchema,
  confirmedAt: IsoInstantSchema,
});

/** Either stabilized negative evidence or a typed operator resolution. */
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

export const ParkedWriteResolutionBindingSchema = z.strictObject({
  commandId: CommandIdSchema,
  auditId: CommandAuditIdSchema,
  writeIntentId: WriteIntentIdSchema,
  writeAttemptId: WriteAttemptIdSchema,
  generation: PositiveIntSchema,
  bindingProofDigest: FingerprintSchema,
  idempotencyKeyDigest: FingerprintSchema,
  runId: RunIdSchema,
  runAttempt: PositiveIntSchema,
  expectedRunVersion: PositiveIntSchema,
  decision: z.enum(["present", "absent"]),
  resolvedAt: IsoInstantSchema,
});
export type ParkedWriteResolutionBinding = z.infer<typeof ParkedWriteResolutionBindingSchema>;

export const ParkedWriteRecheckSchema = z.strictObject({
  nodeId: NodeIdSchema,
  commandId: CommandIdSchema,
  auditId: CommandAuditIdSchema,
  expectedRunVersion: PositiveIntSchema,
  requestedAt: IsoInstantSchema,
  transactionId: z.string().regex(/^T\d+$/u).optional(),
});

const WriteIntentAttemptFields = {
  occurrence: RepeatOccurrenceSchema.optional(),
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
  resolution: ParkedWriteResolutionBindingSchema.optional(),
});
const RetryableWriteIntentRecordSchema = z.strictObject({
  ...WriteIntentAttemptFields,
  status: z.literal("retryable"),
  settlement: WriteRetrySettlementSchema,
  resolvedAt: IsoInstantSchema,
  resolution: ParkedWriteResolutionBindingSchema.optional(),
});
const ParkedWriteIntentRecordSchema = z.strictObject({
  ...WriteIntentAttemptFields,
  status: z.literal("parked"),
  recheck: ParkedWriteRecheckSchema.optional(),
  parkedCode: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
  message: z.string().min(1),
  authorityReason: WriteAuthorityReasonSchema,
});

export const WriteIntentRecordSchema = z.discriminatedUnion("status", [
  ObservedPresentWriteIntentRecordSchema,
  AttemptingWriteIntentRecordSchema,
  CommittedWriteIntentRecordSchema,
  RetryableWriteIntentRecordSchema,
  ParkedWriteIntentRecordSchema,
]).superRefine((record, context) => {
  if ((record.status === "committed" || record.status === "retryable") && record.resolution !== undefined) {
    const binding = record.resolution;
    if (binding.writeIntentId !== record.writeIntentId || binding.writeAttemptId !== record.currentAttemptId
      || binding.generation !== record.generation || binding.bindingProofDigest !== record.bindingProofDigest
      || binding.idempotencyKeyDigest !== record.idempotencyKeyDigest || binding.runId !== record.runId || binding.runAttempt !== record.runAttempt
      || binding.decision !== (record.status === "committed" ? "present" : "absent")
      || binding.resolvedAt !== (record.status === "committed" ? record.confirmedAt : record.resolvedAt)) {
      context.addIssue({code:"custom",path:["resolution"],message:"parked write resolution must bind the exact original attempt, proof and settlement"});
    }
  }
  const expectedDigest = deriveIdempotencyKeyDigest(record.system, record.idempotencyKey);
  if (record.idempotencyKeyDigest !== expectedDigest) {
    context.addIssue({ code: "custom", path: ["idempotencyKeyDigest"], message: "idempotency key digest does not match the exact system and natural key" });
  }
  if (record.status !== "observed-present" && record.occurrence !== undefined) {
    const occurrence = record.occurrence;
    if (occurrence.system !== record.system || occurrence.taskId !== record.taskId
      || record.idempotencyKey !== repeatOccurrenceKey(occurrence.businessKeyDigest, occurrence.confirmationCommandId, occurrence.nodeId)
      || !occurrence.baselineEvidence.some((proof) => proof.writeIntentId === occurrence.writeIntentId && proof.evidenceDigest === occurrence.evidenceDigest)
      || new Set(occurrence.baselineEvidence.map((proof) => proof.writeIntentId)).size !== occurrence.baselineEvidence.length) {
      context.addIssue({ code: "custom", path: ["occurrence"], message: "repeat occurrence identity or acknowledged evidence is inconsistent" });
    }
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
    z.strictObject({
      state: z.literal("parked"),
      code: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
      message: z.string().min(1),
      authorityReason: WriteAuthorityReasonSchema,
    }),
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
