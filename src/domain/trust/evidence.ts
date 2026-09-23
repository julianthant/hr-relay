import { PublicTransactionKeyDigestSchema } from "../protected-input.js";
import { z } from "zod";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  BrowserSystemIdSchema,
  ErrorCodeSchema,
  EvidenceEntryIdSchema,
  EvidenceReceiptIdSchema,
  EvidenceRefSchema,
  FailureIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteBindingProofIdSchema,
} from "../ids.js";
import { RedactedFieldSchema } from "../redaction.js";
import { TimelineCategoryKeySchema } from "../workflow/presentation.js";
import { WriteStateSchema } from "./failure.js";

const EvidenceSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), inputFingerprint: FingerprintSchema }),
  z.strictObject({ kind: z.literal("system"), taskId: TaskIdSchema, observedAt: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("checkpoint"), taskId: TaskIdSchema, checkpointFingerprint: FingerprintSchema, observedAt: IsoInstantSchema }),
  /**
   * A GATE's fact: it came from a human, through the typed `resolve-gate`
   * command, and authority — not the payload — says who and when (D202/D204).
   *
   * It is its own arm rather than a `system` fact with a task id, because a
   * gate owns no task contract and never will: what it dates is a DECISION,
   * not an observation of a page. `resolvedBy`/`resolvedAt` are the kernel's
   * own values off the `gate_results` row, which is the whole point — a
   * caller-supplied approver beside them would be a claim sitting next to
   * authority.
   */
  z.strictObject({
    kind: z.literal("gate-result"),
    gateId: GateIdSchema,
    resolvedBy: ActorIdSchema,
    resolvedAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal("gate-source-event"),
    gateId: GateIdSchema,
    sourceKind: z.enum(["workflow", "external"]),
    sourceId: z.string().min(1),
    eventId: z.string().min(1),
    eventDigest: FingerprintSchema,
    correlationDigest: FingerprintSchema,
    attempt: PositiveIntSchema,
    resolvedAt: IsoInstantSchema,
  }),
  z.strictObject({ kind: z.literal("operator-correction"), supersedes: EvidenceEntryIdSchema }),
  z.strictObject({ kind: z.literal("derived"), evidence: z.array(EvidenceRefSchema).min(1) }),
  /**
   * D307 — an OPERATOR ASSERTION. The operator omitted this node's timeline
   * step at start and typed the facts the step would have read; the step's
   * producer rebuilt this node's output from them and the executor stored a
   * MARKED checkpoint row (every provenance leaf `operator`-sourced).
   *
   * It is its own arm, and NOT `system`/`checkpoint`, for the reason the whole
   * unit exists: those two arms say a task observed a page at an instant, and
   * this value was observed by nobody. `assertedAt` is when the assertion was
   * made, never when anything was seen, and `step` names the omitted step so
   * the sentence beside the fact is checkable against the run's own envelope.
   */
  z.strictObject({
    kind: z.literal("operator-assertion"),
    taskId: TaskIdSchema,
    step: TimelineCategoryKeySchema,
    assertedAt: IsoInstantSchema,
  }),
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
  /**
   * D307 adds `assertion`: the operator omitted a step at start and the step's
   * producer rebuilt this node's output from typed facts. It is not a `branch`
   * (no controller chose anything) and emphatically not a `gate` (nobody
   * approved an observation), so it is its own closed kind.
   */
  kind: z.enum(["branch", "gate", "identity", "dedupe", "assertion"]),
  outcome: z.enum(["taken", "not-taken", "blocked", "approved", "rejected"]),
  reason: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).min(1),
});

/**
 * What PROVED a commit — the fenced write's durable completion evidence,
 * carried BESIDE the action it proves (03a Track F's BE line, ledger 2
 * D16–D22). Every field is read from a durable authority row or from the
 * commit contract's own declaration; nothing here is observed at derivation:
 *
 * - `system` / `idempotencyKeyDigest` — the write intent's fence identity.
 *   The digest, never the raw key: the natural key embeds the person's EID
 *   (`ucpath:termination|{eid}|{date}`), and authority keeps the raw half.
 * - `completion` — the commit contract's declared completion arm. `receipt`
 *   means the system issued its own confirmation record at the click;
 *   `save-verify` / `upload-verify` mean an independent read-back is the proof.
 * - `proofSource` — the durable `TransactionOutcome`'s own account of where
 *   the proof came from (a fresh verify read, a recovery probe, an operator
 *   attestation, or an already-present observation).
 * - `values` — the completion proof's leaves, redacted through the declared
 *   `write-proof` classification scope. Undeclared leaves fail derivation
 *   loud; nothing crosses the wire that the table did not disposition.
 * - `recordedAt` — the outcome's `confirmedAt` / `observedAt`, the instant
 *   authority recorded the proof.
 *
 * OPTIONAL because receipts are durably persisted and immutable (D141/D199):
 * a composition-1 receipt row predates this field and must keep parsing and
 * re-deriving byte-identically. Producers at composition 2 emit it whenever a
 * settled outcome and its fenced intent exist; its absence there means "no
 * completion proof is in authority for this write", and the UI names that.
 */
export const ActionWriteProofSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  idempotencyKeyDigest: PublicTransactionKeyDigestSchema,
  completion: z.enum(["receipt", "save-verify", "upload-verify"]),
  proofSource: z.enum(["normal-output", "recovery-probe", "operator-attestation", "durable-intent", "live-probe"]),
  values: z.array(RedactedFieldSchema).min(1),
  recordedAt: IsoInstantSchema,
});
export type ActionWriteProof = z.infer<typeof ActionWriteProofSchema>;

export const ActionEvidenceSchema = z.strictObject({
  id: EvidenceEntryIdSchema,
  taskId: TaskIdSchema,
  kind: z.enum(["external-read", "prepare", "commit", "local-projection"]),
  writeState: WriteStateSchema,
  proofRef: WriteBindingProofIdSchema.optional(),
  artifactId: ArtifactIdSchema.optional(),
  occurredAt: IsoInstantSchema,
  proved: ActionWriteProofSchema.optional(),
}).superRefine((action, context) => {
  if (action.kind === "commit" && action.writeState === "not-attempted") {
    context.addIssue({ code: "custom", path: ["writeState"], message: "commit evidence cannot claim the write was not attempted" });
  }
  if (action.writeState === "verified" && action.proofRef === undefined) {
    context.addIssue({ code: "custom", path: ["proofRef"], message: "verified write evidence requires a binding proof" });
  }
  if (action.proved !== undefined && action.kind !== "commit") {
    context.addIssue({ code: "custom", path: ["proved"], message: "only a commit action proves a write; a read or prepare carries no completion proof" });
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
  /**
   * The derivation composition this receipt was built under. ABSENT means
   * composition 1 — the shape every receipt stored before the action write
   * proof existed. Composition 2 adds `actions[].proved`; composition 3 is the
   * first whose free diagnostic sentences are safe for operator projection. A stored receipt is
   * immutable and re-derives under ITS OWN composition (never upgraded in
   * place), so absence is a closed, documented state rather than a default.
   */
  composition: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
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

const DiagnosticSafeRunEvidenceReceiptSchema = z.intersection(
  RunEvidenceReceiptSchema,
  z.strictObject({ composition: z.union([z.literal(3), z.literal(4)]) }),
);

export const OperatorReceiptProjectionSchema = z.union([
  z.strictObject({
    state: z.literal("available"),
    value: DiagnosticSafeRunEvidenceReceiptSchema,
  }),
  z.strictObject({
    state: z.literal("withheld"),
    composition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    reason: z.string().min(1),
  }),
]);
export type OperatorReceiptProjection = z.infer<typeof OperatorReceiptProjectionSchema>;

/**
 * Immutable receipt rows predate the diagnostic-safety boundary. They remain
 * valid authority evidence and continue to re-derive under their own
 * composition, but their free-text decisions/warnings must never be replayed
 * onto an operator surface. Composition 3 is the explicit admission stamp.
 */
export function projectReceiptForOperator(receiptInput: unknown): OperatorReceiptProjection {
  const receipt = RunEvidenceReceiptSchema.parse(receiptInput);
  const protectedWorkflow = receipt.workflowId === "separations" || receipt.workflowId === "separations-kuali-finalization" || receipt.workflowId === "person-lookup";
  if (receipt.composition === 4 || (receipt.composition === 3 && !protectedWorkflow)) {
    return Object.freeze(OperatorReceiptProjectionSchema.parse({
      state: "available",
      value: receipt,
    }));
  }
  const composition = receipt.composition ?? 1;
  return Object.freeze(OperatorReceiptProjectionSchema.parse({
    state: "withheld",
    composition,
    reason: `immutable receipt composition ${String(composition)} predates the required protected-value projection; `
      + "its free-text projection is withheld and the authority row is unchanged",
  }));
}
