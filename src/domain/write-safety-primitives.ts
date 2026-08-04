import { z } from "zod";
import {
  EvidenceRefSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "./ids.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";

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

export type ProbeVerdict<ProofSchema extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<ProofSchema>>>;
export type NegativeSettlementPolicy = z.infer<typeof NegativeSettlementPolicySchema>;
export type TransactionOutcome = z.infer<typeof TransactionOutcomeSchema>;
