import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
import { SECRET_FAMILY_SPECS } from "./provider-family-specs.js";

export const ProviderKeySlotSchema = z.enum(SECRET_FAMILY_SPECS.flatMap(({ envPrefix, maximum }) =>
  Array.from({ length: maximum }, (_, index) => index === 0 ? envPrefix : `${envPrefix}${index + 1}`)));
export const ProviderKeyOperationSchema = z.union([
  z.strictObject({ set: z.string().min(1) }), z.strictObject({ clear: z.literal(true) }),
]);
export const ProviderKeyOperationsSchema = z.partialRecord(ProviderKeySlotSchema, ProviderKeyOperationSchema)
  .refine(operations => Object.keys(operations).length > 0, "at least one provider slot operation is required");
export const MarkedProviderKeyOperationSchema = z.union([
  z.strictObject({ set: z.literal("<set>") }), z.strictObject({ clear: z.literal(true) }),
]);
export const MarkedProviderKeyOperationsSchema = z.partialRecord(ProviderKeySlotSchema, MarkedProviderKeyOperationSchema);

export const PROVIDER_KEYS_SCHEMA_HASH = sha256Hex(canonicalJsonStringify({
  version: 1, slots: ProviderKeySlotSchema.options,
}));

export function markProviderKeyOperations(operations: z.infer<typeof ProviderKeyOperationsSchema>) {
  return MarkedProviderKeyOperationsSchema.parse(Object.fromEntries(Object.entries(operations).map(([slot, operation]) => {
    if (operation === undefined) throw new Error("provider key operation is missing");
    return [slot, "set" in operation ? { set: "<set>" } : { clear: true }];
  })));
}
