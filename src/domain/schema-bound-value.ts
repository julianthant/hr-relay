import { z } from "zod";
import { JsonValueSchema } from "./canonical-json.js";
import { FingerprintSchema, type Fingerprint } from "./ids.js";

export const SchemaBoundCanonicalValueSchema = z.strictObject({
  schemaHash: FingerprintSchema,
  value: JsonValueSchema,
});

export function schemaBoundValueSchema<ValueSchema extends z.ZodType>(
  valueSchema: ValueSchema,
  schemaHash: Fingerprint,
) {
  return z.strictObject({
    schemaHash: z.literal(schemaHash),
    value: valueSchema,
  });
}

export type SchemaBoundCanonicalValue = z.infer<typeof SchemaBoundCanonicalValueSchema>;
