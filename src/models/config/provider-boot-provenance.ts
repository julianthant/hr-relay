import { z } from "zod";
import { ProviderKeySlotSchema } from "./provider-keys.js";
import { deepFreeze } from "../../rules/validation/immutability.js";

export const ProviderBootProvenanceSchema = z.strictObject({
  parentSlotNames: z.array(ProviderKeySlotSchema),
  fileSlotNames: z.array(ProviderKeySlotSchema),
  fileRevision: z.number().int().positive(),
  fileSourceVersionToken: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type ProviderBootProvenance = z.infer<typeof ProviderBootProvenanceSchema>;

let admitted: ProviderBootProvenance | undefined;
export function normalizeProviderBootProvenance(value: ProviderBootProvenance): ProviderBootProvenance {
  return deepFreeze(ProviderBootProvenanceSchema.parse(value));
}
export function publishProviderBootProvenance(value: ProviderBootProvenance): void {
  if (admitted !== undefined) throw new Error("provider boot provenance already published");
  admitted = normalizeProviderBootProvenance(value);
}
export function providerBootProvenance(): ProviderBootProvenance | undefined { return admitted; }
