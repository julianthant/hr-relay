import { z } from "zod";
import { JsonValueSchema } from "../validation/canonical-json.js";
import {
  ArtifactIdSchema,
  EvidenceRefSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "../identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";

/** The identity a write is fenced against; it lives in the browser-safe half because a descriptor closure has to be able to hash a schema that embeds it. */
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
export type SubjectEvidence = z.infer<typeof SubjectEvidenceSchema>;

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
    z.strictObject({
      state: z.literal("ambiguous"),
      matches: z.number().int().min(2),
      observedAt: IsoInstantSchema,
      queryDigest: FingerprintSchema,
      evidence: z.array(EvidenceRefSchema).min(2),
    }),
    z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1), observedAt: IsoInstantSchema }),
  ]);
}

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

/** Keep settlement browser-safe for descriptor hashing; output/proof retain nested schema binding. */
export const TransactionOutcomeSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    disposition: z.literal("committed"),
    proofSource: z.enum(["normal-output", "recovery-probe", "operator-attestation"]),
    proof: SchemaBoundCanonicalValueSchema,
    output: SchemaBoundCanonicalValueSchema,
    confirmedAt: IsoInstantSchema,
  }),
  z.strictObject({
    disposition: z.literal("already-present"),
    proofSource: z.enum(["live-probe", "durable-intent"]),
    proof: SchemaBoundCanonicalValueSchema,
    output: SchemaBoundCanonicalValueSchema,
    observedAt: IsoInstantSchema,
  }),
]);

/** What a dry run of a transaction node actually observed: gathered facts only, with no `disposition` and no commit output, because a preview settles nothing. */
/** What beat ①'s READ-ONLY probes answered during a preview, so the preview rehearsed the path the real run takes; the refusal arms have no preview arm on purpose. */
export const DryRunProbeObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("durable-intent"),
    status: z.enum(["committed", "observed-present"]),
    proof: SchemaBoundCanonicalValueSchema,
    output: SchemaBoundCanonicalValueSchema,
  }),
  z.strictObject({
    state: z.literal("present"),
    proof: SchemaBoundCanonicalValueSchema,
    output: SchemaBoundCanonicalValueSchema,
  }),
  z.strictObject({ state: z.literal("absent"), evidence: AbsentEvidenceSchema }),
  z.strictObject({
    state: z.literal("not-required"),
    reason: z.enum(["policy-retries-and-recovery-only", "preview-only-sample"]),
  }),
]);
export type DryRunProbeObservation = z.infer<typeof DryRunProbeObservationSchema>;

export const TransactionDryRunPreviewSchema = z.strictObject({
  kind: z.literal("transaction-dry-run-preview"),
  nodeId: z.string().min(1),
  /** Beat ①, run BEFORE any staging, exactly as the real path runs it. */
  probe: DryRunProbeObservationSchema,
    /* What the preview reached: `prepare` and `subject` live INSIDE the `would-prepare` arm, so "no staged page" cannot be mistaken for an empty one. */
  outcome: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("would-prepare"),
      prepare: z.strictObject({ schemaHash: FingerprintSchema, value: JsonValueSchema }),
      subject: z.discriminatedUnion("state", [
        z.strictObject({ state: z.literal("match"), evidence: SubjectEvidenceSchema }),
        z.strictObject({
          state: z.literal("mismatch"),
          expected: SubjectEvidenceSchema,
          observed: SubjectEvidenceSchema,
        }),
        z.strictObject({ state: z.literal("unscoped"), reviewedReasonId: z.string().min(1) }),
      ]),
    }),
    z.strictObject({
      state: z.literal("already-present"),
      proofSource: z.enum(["live-probe", "durable-intent"]),
    }),
  ]),
  observedAt: IsoInstantSchema,
});
export type TransactionDryRunPreview = z.infer<typeof TransactionDryRunPreviewSchema>;

export type ProbeVerdict<ProofSchema extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<ProofSchema>>>;
export type NegativeSettlementPolicy = z.infer<typeof NegativeSettlementPolicySchema>;
export type TransactionOutcome = z.infer<typeof TransactionOutcomeSchema>;
