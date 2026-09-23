import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex } from "./sha256.js";
import {
  ActorIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "./ids.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";

const GateResultRecordFields = {
  runId: RunIdSchema,
  gateId: GateIdSchema,
  commandId: CommandIdSchema,
  expectedVersion: PositiveIntSchema,
  resolvedBy: ActorIdSchema,
  resolvedAt: IsoInstantSchema,
  checkpointFingerprint: FingerprintSchema,
} as const;

export const OperatorGateResultRecordSchema = z.strictObject({
  ...GateResultRecordFields,
  result: SchemaBoundCanonicalValueSchema,
});

/** A non-operator settlement keeps provider/event identity without inventing a person or command. */
export const SourceGateResultRecordSchema = z.strictObject({
  runId: RunIdSchema,
  gateId: GateIdSchema,
  expectedVersion: PositiveIntSchema,
  resolvedAt: IsoInstantSchema,
  checkpointFingerprint: FingerprintSchema,
  source: z.strictObject({
    kind: z.enum(["workflow", "external"]),
    sourceId: z.string().min(1),
    eventId: z.string().min(1),
    eventDigest: FingerprintSchema,
    correlationKey: z.string().min(1),
    correlationDigest: FingerprintSchema,
    attempt: PositiveIntSchema,
  }),
  result: SchemaBoundCanonicalValueSchema,
});

export const GateResultRecordSchema = z.union([OperatorGateResultRecordSchema, SourceGateResultRecordSchema]);
export const AnyGateResultRecordSchema = GateResultRecordSchema;

export function deriveGateResultCheckpointFingerprint(result: unknown): string {
  const parsed = SchemaBoundCanonicalValueSchema.parse(result);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:gate-result-checkpoint:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export function gateResultRecordSchema<ResultSchema extends z.ZodType>(
  resultSchema: ResultSchema,
  schemaHash: z.infer<typeof FingerprintSchema>,
) {
  return z.strictObject({
    ...GateResultRecordFields,
    result: z.strictObject({ schemaHash: z.literal(schemaHash), value: resultSchema }),
  });
}

export function sourceGateResultRecordSchema<ResultSchema extends z.ZodType>(
  resultSchema: ResultSchema,
  schemaHash: z.infer<typeof FingerprintSchema>,
) {
  return z.strictObject({
    runId: RunIdSchema,
    gateId: GateIdSchema,
    expectedVersion: PositiveIntSchema,
    resolvedAt: IsoInstantSchema,
    checkpointFingerprint: FingerprintSchema,
    source: SourceGateResultRecordSchema.shape.source,
    result: z.strictObject({ schemaHash: z.literal(schemaHash), value: resultSchema }),
  });
}

export type OperatorGateResultRecord = z.infer<typeof OperatorGateResultRecordSchema>;
export type SourceGateResultRecord = z.infer<typeof SourceGateResultRecordSchema>;
export type GateResultRecord = z.infer<typeof AnyGateResultRecordSchema>;
