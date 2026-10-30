import { z } from "zod";
import { ProfileIdSchema } from "./profile.js";
import { COMMAND_FAMILY_REGISTRY, CommandActionSchema, CommandEffectClassSchema, CommandFamilySchema, CommandRequestSchema } from "../../rules/commands/commands.js";
import { CommandIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { SubjectEvidenceSchema } from "../../rules/write-safety/write-safety-primitives.js";

/** Settings may initialize this mode only together with an explicit operator grant. */
export const ASSISTANT_PERMISSION_INITIAL_MODE = "every-action" as const;

export { AssistantPermissionModeSchema, type AssistantPermissionMode } from "./assistant-permission-mode.js";
import { AssistantPermissionModeSchema, StoredAssistantPermissionModeSchema } from "./assistant-permission-mode.js";

export const AssistantOperatorGrantSchema = z.strictObject({
  grantId: z.uuid(),
  profileId: ProfileIdSchema,
  policyRevision: PositiveIntSchema,
  mode: StoredAssistantPermissionModeSchema,
  grantedAt: IsoInstantSchema,
});

export const AssistantPermissionPolicySchema = z.strictObject({
  revision: PositiveIntSchema,
  mode: StoredAssistantPermissionModeSchema,
  grant: AssistantOperatorGrantSchema,
}).superRefine((policy, context) => {
  if (policy.grant.policyRevision !== policy.revision || policy.grant.mode !== policy.mode) {
    context.addIssue({ code: "custom", message: "operator grant must match the policy revision and mode" });
  }
});

export const AssistantActionManifestEntrySchema = z.strictObject({
  family: CommandFamilySchema,
  action: CommandActionSchema,
  classification: CommandEffectClassSchema,
  subject: z.enum(["none", "classified"]),
}).superRefine((entry, context) => {
  const known = COMMAND_FAMILY_REGISTRY.find((candidate) => candidate.family === entry.family);
  if (known === undefined || !known.actions.some((action) => action === entry.action)) {
    context.addIssue({ code: "custom", message: "manifest action is not in its command family" });
  }
});

export const AssistantActionManifestSchema = z.strictObject({
  revision: PositiveIntSchema,
  entries: z.array(AssistantActionManifestEntrySchema),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    const key = `${entry.family}\0${entry.action}`;
    if (seen.has(key)) context.addIssue({ code: "custom", message: "manifest action is duplicated" });
    seen.add(key);
  }
});

export const AssistantAuthoritySchema = z.strictObject({
  profileId: ProfileIdSchema,
  accountSessionEpoch: PositiveIntSchema,
  policy: AssistantPermissionPolicySchema,
  manifest: AssistantActionManifestSchema,
}).superRefine((authority, context) => {
  if (authority.policy.grant.profileId !== authority.profileId) {
    context.addIssue({ code: "custom", message: "operator grant profile must match the active profile" });
  }
});
export type AssistantAuthority = z.infer<typeof AssistantAuthoritySchema>;

export const AssistantSubjectSchema = z.union([
  z.strictObject({ kind: z.literal("none") }),
  SubjectEvidenceSchema,
]);

export const AssistantOptionsIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("existing-fingerprint"), fingerprint: FingerprintSchema }),
  z.strictObject({ kind: z.literal("canonical-fields"), fields: JsonValueSchema }),
]);

export const AssistantConfigDescriptorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("present"),
    descriptorFingerprint: FingerprintSchema.optional(),
    configFingerprint: FingerprintSchema.optional(),
    settingsSchemaHash: FingerprintSchema.optional(),
    protectedSchemaHash: FingerprintSchema.optional(),
    ingressSchemaHash: FingerprintSchema.optional(),
    canonicalInputSchemaHash: FingerprintSchema.optional(),
    inputFingerprint: FingerprintSchema.optional(),
    contractFingerprint: FingerprintSchema.optional(),
    expectedRevision: PositiveIntSchema.optional(),
  }).refine((value) => Object.entries(value).some(([key, item]) => key !== "kind" && item !== undefined),
    "config descriptor needs an existing revision field"),
]);

export const AssistantApprovalBindingSchema = z.strictObject({
  profileId: ProfileIdSchema,
  accountSessionEpoch: PositiveIntSchema,
  policyRevision: PositiveIntSchema,
  mode: StoredAssistantPermissionModeSchema,
  grantId: z.uuid(),
  manifestRevision: PositiveIntSchema,
  family: CommandFamilySchema,
  action: CommandActionSchema,
  classification: CommandEffectClassSchema,
  commandId: CommandIdSchema,
  target: JsonValueSchema,
  subject: AssistantSubjectSchema,
  options: AssistantOptionsIdentitySchema,
  configDescriptor: AssistantConfigDescriptorSchema,
});
export type AssistantApprovalBinding = z.infer<typeof AssistantApprovalBindingSchema>;

export const AssistantRefusalCodeSchema = z.enum([
  "ASSISTANT_AUTHORITY_INVALID",
  "ASSISTANT_GRANT_REQUIRED",
  "ASSISTANT_MODEL_PROPOSAL_REFUSED",
  "ASSISTANT_PROPOSAL_MISMATCH",
  "ASSISTANT_UNCLASSIFIED",
  "ASSISTANT_OPTIONS_UNBOUND",
  "ASSISTANT_SUBJECT_MISMATCH",
  "ASSISTANT_BINDING_STALE",
  "ASSISTANT_UNKNOWN_NOT_REPLAYABLE",
  "ASSISTANT_EFFECT_UNDERSTATED",
]);
export type AssistantRefusalCode = z.infer<typeof AssistantRefusalCodeSchema>;

export const AssistantStaleFieldSchema = z.enum([
  "profile",
  "epoch",
  "policy",
  "grant",
  "manifest",
  "target",
  "subject",
  "options",
  "configDescriptor",
  "cancelled",
  "command",
]);
export type AssistantStaleField = z.infer<typeof AssistantStaleFieldSchema>;

export const AssistantCheckOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none") }),
  z.strictObject({
    state: z.literal("retained"),
    outcome: z.enum(["assistant-clear", "approval-required", "refused"]),
    code: AssistantRefusalCodeSchema.optional(),
    field: AssistantStaleFieldSchema.optional(),
    binding: AssistantApprovalBindingSchema,
  }),
  z.strictObject({
    state: z.literal("unknown"),
    reason: z.string().min(1),
    observedAt: IsoInstantSchema,
    binding: AssistantApprovalBindingSchema,
  }),
]).superRefine((value, context) => {
  if (value.state !== "retained") return;
  if (value.outcome === "refused" && value.code === undefined) {
    context.addIssue({ code: "custom", message: "retained refusal needs its code" });
  }
  if (value.outcome !== "refused" && (value.code !== undefined || value.field !== undefined)) {
    context.addIssue({ code: "custom", message: "retained clearance has no refusal code" });
  }
});

export const AssistantResolvedActionSchema = z.strictObject({
  profileId: ProfileIdSchema,
  accountSessionEpoch: PositiveIntSchema,
  command: CommandRequestSchema,
  subject: AssistantSubjectSchema,
  cancelled: z.boolean(),
  checkOutcome: AssistantCheckOutcomeSchema,
});
export type AssistantResolvedAction = z.infer<typeof AssistantResolvedActionSchema>;

export const AssistantModelProposalSchema = z.strictObject({
  commandId: CommandIdSchema,
  family: CommandFamilySchema,
  action: CommandActionSchema,
  target: JsonValueSchema,
});

export const AssistantDecisionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("assistant-clear"),
    phase: z.enum(["prepare", "dispatch"]),
    existingAppGates: z.literal("unchanged"),
    replay: z.enum(["fresh", "retained"]),
    binding: AssistantApprovalBindingSchema,
  }),
  z.strictObject({
    state: z.literal("approval-required"),
    phase: z.enum(["prepare", "dispatch"]),
    existingAppGates: z.literal("unchanged"),
    replay: z.enum(["fresh", "retained"]),
    binding: AssistantApprovalBindingSchema,
  }),
  z.strictObject({
    state: z.literal("refused"),
    phase: z.enum(["prepare", "dispatch", "unparsed"]),
    code: AssistantRefusalCodeSchema,
    field: AssistantStaleFieldSchema.optional(),
  }),
]);
export type AssistantDecision = z.infer<typeof AssistantDecisionSchema>;

/** Canonical commands visible here. A trusted manifest classifies them; the action name does not. */
export const ASSISTANT_COMMAND_INVENTORY = deepFreeze(COMMAND_FAMILY_REGISTRY.flatMap((entry) =>
  entry.actions.map((action) => ({
    family: entry.family,
    action,
    support: "unclassified" as const,
  })),
));

const AuthorityShellSchema = z.strictObject({
  profileId: ProfileIdSchema,
  accountSessionEpoch: PositiveIntSchema,
  policy: z.strictObject({
    revision: PositiveIntSchema,
    mode: AssistantPermissionModeSchema,
    grant: z.unknown().optional(),
  }),
  manifest: AssistantActionManifestSchema,
});

export function readAssistantAuthority(input: unknown):
  | { readonly ok: true; readonly authority: AssistantAuthority }
  | { readonly ok: false; readonly code: "ASSISTANT_AUTHORITY_INVALID" | "ASSISTANT_GRANT_REQUIRED" } {
  const shell = AuthorityShellSchema.safeParse(input);
  if (!shell.success) return { ok: false, code: "ASSISTANT_AUTHORITY_INVALID" };
  if (shell.data.policy.grant === undefined) return { ok: false, code: "ASSISTANT_GRANT_REQUIRED" };
  const parsed = AssistantAuthoritySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "ASSISTANT_GRANT_REQUIRED" };
  return { ok: true, authority: parsed.data };
}
