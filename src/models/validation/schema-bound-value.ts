import { ProtectedInputBindingsSchema } from "../write-safety/protected-input.js";
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { FingerprintSchema, type Fingerprint } from "../../rules/identity/ids.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

export const SchemaBoundCanonicalValueSchema = z.strictObject({
  schemaHash: FingerprintSchema,
  value: JsonValueSchema,
  protectedBindings: ProtectedInputBindingsSchema.optional(),
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

/** Hash accepted structure so shape-preserving refactors do not invalidate stored values. */
export function deriveSchemaHash(schema: z.ZodType, io: "input" | "output"): Fingerprint {
  const projection = z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref" });
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:schema-identity:v1\0${io}\0${canonicalJsonStringify(projection)}`,
  ));
}

export type SchemaBoundCanonicalValue = z.infer<typeof SchemaBoundCanonicalValueSchema>;
