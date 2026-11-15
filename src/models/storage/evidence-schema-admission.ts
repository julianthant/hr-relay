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
/** Canonical-input hashes of the Separations inputs from before the stored timekeeper initials: each workflow's last current hash and its profile-name-domain predecessor. */
export const RETIRED_INPUT_GENERATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  separations: Object.freeze([
    "9139ca6501ab707e3c47dfe55fcc89741dfc53dda0b783a7afb8ee2c2e1ee77d",
    "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc",
  ]),
  "separations-kuali-finalization": Object.freeze([
    "d881b2db363e3d2061b3729ade8bc59b22c95972c6a33ca22ab676be3b1bbc52",
    "5ab3b24512e81356add63761e2c0d6f16226e9ba39bb84b3f98aff28842e026d",
  ]),
});

/** A stored run input whose canonical-input generation this build no longer parses; it stays readable history, never current input. */
export const EvidenceSchemaRetirementSchema = z.strictObject({
  owner: z.strictObject({ kind: z.literal("run-input"), id: z.uuid() }),
  workflowId: z.string().min(1).max(128),
  sourceSchemaHash: FingerprintSchema,
  sourceDigest: FingerprintSchema,
});
export type EvidenceSchemaRetirement = z.infer<typeof EvidenceSchemaRetirementSchema>;
export const EvidenceSchemaConversionSchema = z.discriminatedUnion("id", [
  z.strictObject({
    id: z.literal("profile-name-domain"),
    installationId: z.uuid(), profileId: z.uuid(),
    admissions: z.array(EvidenceSchemaAdmissionSchema).min(1),
  }),
  z.strictObject({
    id: z.literal("retired-input-generation"),
    installationId: z.uuid(), profileId: z.uuid(),
    retirements: z.array(EvidenceSchemaRetirementSchema).min(1),
  }),
]).superRefine((value, context) => {
  const owners = (value.id === "profile-name-domain" ? value.admissions : value.retirements).map(entry => canonicalJsonStringify(entry.owner));
  if (new Set(owners).size !== owners.length) context.addIssue({ code: "custom", message: "evidence-schema-admission-owner-duplicate" });
});
export type EvidenceSchemaConversion = z.infer<typeof EvidenceSchemaConversionSchema>;
export function evidenceSchemaSourceDigest(owner: EvidenceSchemaOwner, source: unknown): string {
  return sha256Hex(`relay:evidence-schema-source:v1\0${canonicalJsonStringify({ owner: EvidenceSchemaOwnerSchema.parse(owner), source: JsonValueSchema.parse(source) })}`);
}
export type EvidenceSchemaReader = (owner: EvidenceSchemaOwner, source: unknown, sourceSchemaHash: string, currentSchemaHash: string) => string;
