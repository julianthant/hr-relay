import { z } from "zod";
import { JsonValueSchema } from "./canonical-json.js";
import {
  ArtifactIdSchema,
  EvidenceRefSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "./ids.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";

/**
 * The identity a write is fenced against (doc 09 beat ③).
 *
 * It lives in the browser-safe half for the same reason `TransactionOutcome`
 * does (D144): a descriptor closure has to be able to hash a schema that embeds
 * it, and `write-safety.ts` imports `node:crypto`. Doc 09's module re-exports
 * it, so its address is unchanged.
 */
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

/**
 * The DURABLE settlement of one transaction node (doc 09 §3 beat ⑦ / §14), and
 * the exact schema a `run_checkpoints` row for a transaction node is bound to.
 *
 * It lives in this browser-safe half rather than beside the rest of doc 09's
 * write-safety records because a workflow descriptor's terminal `build` must
 * hash it (D144), and a descriptor closure may not reach a Node built-in —
 * `write-safety.ts` imports `node:crypto`. `write-safety.ts` re-exports it, so
 * doc 09's module stays the name every write-lane caller reads.
 *
 * `output` and `proof` are schema-bound canonical values: the commit contract's
 * own output/proof schema hashes live INSIDE this envelope, one level down.
 * That nesting is why the checkpoint row carries THIS schema's hash and the
 * commit contract's identity is still checked — see `projectTransactionOutcome`.
 */
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

/**
 * D210 — what a dry run of a transaction node actually observed.
 *
 * Every field is a fact the preview GATHERED: the prepare arm's own parsed
 * output under its contract's schema hash, and the beat-③ subject observation
 * taken on the staged page. There is deliberately no `disposition` and no commit
 * output, because a preview settles nothing — and inventing either to make a
 * terminal derive fold is exactly the fabrication D144 refused.
 *
 * It lives here, beside `TransactionOutcome`, because the descriptor factory
 * hashes it when a previewed run is terminalized.
 */
export const TransactionDryRunPreviewSchema = z.strictObject({
  kind: z.literal("transaction-dry-run-preview"),
  nodeId: z.string().min(1),
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
  observedAt: IsoInstantSchema,
});
export type TransactionDryRunPreview = z.infer<typeof TransactionDryRunPreviewSchema>;

export type ProbeVerdict<ProofSchema extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<ProofSchema>>>;
export type NegativeSettlementPolicy = z.infer<typeof NegativeSettlementPolicySchema>;
export type TransactionOutcome = z.infer<typeof TransactionOutcomeSchema>;
