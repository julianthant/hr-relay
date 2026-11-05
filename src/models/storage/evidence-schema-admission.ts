import { z } from "zod";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

export const EvidenceSchemaOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["run-input", "run-result", "delegation-input", "delegation-result"]), id: z.uuid() }),
  z.strictObject({ kind: z.literal("write-proof"), id: z.uuid(), generation: z.number().int().safe().positive() }),
  z.strictObject({ kind: z.enum(["checkpoint-proof", "checkpoint-output", "task-output", "gate-result"]), id: z.string().min(1) }),
]);
export type EvidenceSchemaOwner = z.infer<typeof EvidenceSchemaOwnerSchema>;
export const EvidenceSchemaAdmissionSchema = z.strictObject({
  owner: EvidenceSchemaOwnerSchema,
  sourceSchemaHash: FingerprintSchema,
  currentSchemaHash: FingerprintSchema,
  sourceDigest: FingerprintSchema,
});
export type EvidenceSchemaAdmission = z.infer<typeof EvidenceSchemaAdmissionSchema>;
export const EvidenceSchemaConversionSchema = z.strictObject({
  id: z.literal("profile-name-domain"),
  installationId: z.uuid(), profileId: z.uuid(),
  admissions: z.array(EvidenceSchemaAdmissionSchema).min(1),
}).superRefine((value, context) => {
  if (new Set(value.admissions.map(entry => canonicalJsonStringify(entry.owner))).size !== value.admissions.length)
    context.addIssue({ code: "custom", message: "evidence-schema-admission-owner-duplicate" });
});
export function evidenceSchemaSourceDigest(owner: EvidenceSchemaOwner, source: unknown): string {
  return sha256Hex(`relay:evidence-schema-source:v1\0${canonicalJsonStringify({ owner: EvidenceSchemaOwnerSchema.parse(owner), source: JsonValueSchema.parse(source) })}`);
}
export type EvidenceSchemaReader = (owner: EvidenceSchemaOwner, source: unknown, sourceSchemaHash: string, currentSchemaHash: string) => string;
