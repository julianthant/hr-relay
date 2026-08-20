import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "./canonical-json.js";
import { FingerprintSchema, type Fingerprint } from "./ids.js";
import { sha256Hex } from "./sha256.js";

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

/**
 * A schema's own structural identity — what `schemaHash` binds a stored value to.
 *
 * Derived from the schema's JSON-Schema projection rather than from the source
 * file, so a refactor that does not change the accepted shape does not
 * invalidate every stored payload, while a changed field, default, or
 * constraint does. `io` matters: a workflow's ingress schema and its
 * transform-free canonical schema describe the same data at different points
 * (defaults applied or not) and must not hash alike, or ref workflow-model §2's separate
 * ingress and canonical hashes would be one hash written twice.
 */
export function deriveSchemaHash(schema: z.ZodType, io: "input" | "output"): Fingerprint {
  const projection = z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref" });
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:schema-identity:v1\0${io}\0${canonicalJsonStringify(projection)}`,
  ));
}

export type SchemaBoundCanonicalValue = z.infer<typeof SchemaBoundCanonicalValueSchema>;
