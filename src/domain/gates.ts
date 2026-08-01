import { z } from "zod";
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

export const GateResultRecordSchema = z.strictObject({
  ...GateResultRecordFields,
  result: SchemaBoundCanonicalValueSchema,
});

export function gateResultRecordSchema<ResultSchema extends z.ZodType>(
  resultSchema: ResultSchema,
  schemaHash: z.infer<typeof FingerprintSchema>,
) {
  return z.strictObject({
    ...GateResultRecordFields,
    result: z.strictObject({ schemaHash: z.literal(schemaHash), value: resultSchema }),
  });
}

export type GateResultRecord = z.infer<typeof GateResultRecordSchema>;
