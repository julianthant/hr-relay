import { z } from "zod";
import { AssistantApprovalBindingSchema, AssistantConfigDescriptorSchema, AssistantDecisionSchema, AssistantModelProposalSchema, AssistantResolvedActionSchema, readAssistantAuthority, type AssistantApprovalBinding, type AssistantDecision, type AssistantRefusalCode, type AssistantStaleField } from "../../models/profiles/assistant-permissions.js";
import { commandEffectClass, commandEffectIsWeaker, deriveSettingsCommandFingerprint, storageRelocationRequestFingerprint, type CommandRequest } from "../../rules/commands/commands.js";
import { FingerprintSchema, PositiveIntSchema, WorkerIdSchema } from "../../rules/identity/ids.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../rules/validation/immutability.js";

const CONFIG_KEYS = [
  "descriptorFingerprint",
  "configFingerprint",
  "settingsSchemaHash",
  "protectedSchemaHash",
  "ingressSchemaHash",
  "canonicalInputSchemaHash",
  "inputFingerprint",
  "contractFingerprint",
] as const;

const CheckInputSchema = z.strictObject({
  phase: z.enum(["prepare", "dispatch"]),
  authority: z.unknown(),
  proposal: z.unknown(),
  resolved: z.unknown(),
  approval: z.unknown().optional(),
});

type OptionIdentity = z.infer<typeof AssistantApprovalBindingSchema>["options"] | { readonly kind: "unbound" };

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

const FREEFORM_TEXT = new Set(["correctedValue", "displayName", "note", "reason", "value"]);

function safeString(key: string | undefined, value: string): string | undefined {
  if (FingerprintSchema.safeParse(value).success || z.uuid().safeParse(value).success) return value;
  if (key === "sheet") return value;
  if (key === "workerId" && WorkerIdSchema.safeParse(value).success) return value;
  if (key === "action" && (value === "reopen" || value === "resolve")) return value;
  return undefined;
}

function safeJson(value: unknown, key?: string): z.infer<typeof JsonValueSchema> | undefined {
  if (key !== undefined && FREEFORM_TEXT.has(key)) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeString(key, value);
  if (Array.isArray(value)) {
    const items: z.infer<typeof JsonValueSchema>[] = [];
    for (const item of value) {
      const safe = safeJson(item);
      if (safe === undefined) return undefined;
      items.push(safe);
    }
    return items;
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return undefined;
  const fields: { [key: string]: z.infer<typeof JsonValueSchema> } = {};
  for (const [child, item] of Object.entries(record.data)) {
    const safe = safeJson(item, child);
    if (safe === undefined) return undefined;
    fields[child] = safe;
  }
  return fields;
}

function optionIdentity(command: CommandRequest): OptionIdentity {
  // markProtectedSettingsPatch replaces every set value with "<set>", so that fingerprint cannot tell two passwords apart.
  if (command.type === "apply-protected-settings") return { kind: "unbound" };
  if (command.type === "apply-settings") {
    if (command.payload.assistantPermission !== undefined || safeJson(command.payload.patch) === undefined) return { kind: "unbound" };
    return { kind: "existing-fingerprint", fingerprint: FingerprintSchema.parse(deriveSettingsCommandFingerprint(command)) };
  }
  if (command.family === "storage-relocation") {
    return {
      kind: "existing-fingerprint",
      fingerprint: FingerprintSchema.parse(storageRelocationRequestFingerprint(command)),
    };
  }
  if (!("payload" in command)) return { kind: "none" };
  const fields = safeJson(command.payload);
  if (fields === undefined) return { kind: "unbound" };
  return { kind: "canonical-fields", fields };
}

function configDescriptor(command: CommandRequest): z.infer<typeof AssistantConfigDescriptorSchema> {
  const present: { [key: string]: string | number } = {};
  const sources = ["payload" in command ? command.payload : undefined, command.target];
  for (const source of sources) {
    const record = z.record(z.string(), z.unknown()).safeParse(source);
    if (!record.success) continue;
    for (const key of CONFIG_KEYS) {
      const parsed = FingerprintSchema.safeParse(record.data[key]);
      if (parsed.success) present[key] = parsed.data;
    }
    const revision = PositiveIntSchema.safeParse(record.data.expectedRevision);
    if (revision.success) present.expectedRevision = revision.data;
  }
  if (Object.keys(present).length === 0) return { kind: "none" };
  return AssistantConfigDescriptorSchema.parse({ kind: "present", ...present });
}

function staleField(required: AssistantApprovalBinding, presented: AssistantApprovalBinding): AssistantStaleField | undefined {
  if (presented.profileId !== required.profileId) return "profile";
  if (presented.accountSessionEpoch !== required.accountSessionEpoch) return "epoch";
  if (presented.grantId !== required.grantId) return "grant";
  if (presented.policyRevision !== required.policyRevision || presented.mode !== required.mode) return "policy";
  if (presented.manifestRevision !== required.manifestRevision || presented.classification !== required.classification) return "manifest";
  if (presented.commandId !== required.commandId || presented.family !== required.family || presented.action !== required.action) return "command";
  if (!sameJson(presented.target, required.target)) return "target";
  if (!sameJson(presented.subject, required.subject)) return "subject";
  if (!sameJson(presented.options, required.options)) return "options";
  if (!sameJson(presented.configDescriptor, required.configDescriptor)) return "configDescriptor";
  return undefined;
}

function refusal(
  phase: "prepare" | "dispatch" | "unparsed",
  code: AssistantRefusalCode,
  field?: AssistantStaleField,
): AssistantDecision {
  return deepFreeze(AssistantDecisionSchema.parse({
    state: "refused",
    phase,
    code,
    ...(field === undefined ? {} : { field }),
  }));
}

function finish(
  state: "assistant-clear" | "approval-required",
  phase: "prepare" | "dispatch",
  replay: "fresh" | "retained",
  binding: AssistantApprovalBinding,
): AssistantDecision {
  return deepFreeze(AssistantDecisionSchema.parse({
    state,
    phase,
    existingAppGates: "unchanged",
    replay,
    binding,
  }));
}

export function checkAssistantAction(input: unknown): AssistantDecision {
  const body = CheckInputSchema.safeParse(input);
  if (!body.success) return refusal("unparsed", "ASSISTANT_AUTHORITY_INVALID");
  const phase = body.data.phase;
  const authority = readAssistantAuthority(body.data.authority);
  if (!authority.ok) return refusal(phase, authority.code);
  const proposal = AssistantModelProposalSchema.safeParse(body.data.proposal);
  if (!proposal.success) return refusal(phase, "ASSISTANT_MODEL_PROPOSAL_REFUSED");
  const resolved = AssistantResolvedActionSchema.safeParse(body.data.resolved);
  if (!resolved.success) return refusal(phase, "ASSISTANT_AUTHORITY_INVALID");
  if (resolved.data.profileId !== authority.authority.profileId) return refusal(phase, "ASSISTANT_BINDING_STALE", "profile");
  if (resolved.data.accountSessionEpoch !== authority.authority.accountSessionEpoch) {
    return refusal(phase, "ASSISTANT_BINDING_STALE", "epoch");
  }
  const command = resolved.data.command;
  if (proposal.data.commandId !== command.commandId
    || proposal.data.family !== command.family
    || proposal.data.action !== command.type
    || !sameJson(proposal.data.target, command.target)) {
    return refusal(phase, "ASSISTANT_PROPOSAL_MISMATCH");
  }
  const entry = authority.authority.manifest.entries.find((candidate) =>
    candidate.family === command.family && candidate.action === command.type);
  if (entry === undefined) return refusal(phase, "ASSISTANT_UNCLASSIFIED");
  const effect = commandEffectClass(command);
  if (commandEffectIsWeaker(entry.classification, effect)) return refusal(phase, "ASSISTANT_EFFECT_UNDERSTATED");
  const options = optionIdentity(command);
  if (options.kind === "unbound") return refusal(phase, "ASSISTANT_OPTIONS_UNBOUND");
  const subjectOk = entry.subject === "none"
    ? resolved.data.subject.kind === "none"
    : resolved.data.subject.kind !== "none";
  if (!subjectOk) return refusal(phase, "ASSISTANT_SUBJECT_MISMATCH");
  const binding = AssistantApprovalBindingSchema.parse({
    profileId: authority.authority.profileId,
    accountSessionEpoch: authority.authority.accountSessionEpoch,
    policyRevision: authority.authority.policy.revision,
    mode: authority.authority.policy.mode,
    grantId: authority.authority.policy.grant.grantId,
    manifestRevision: authority.authority.manifest.revision,
    family: command.family,
    action: command.type,
    classification: entry.classification,
    commandId: command.commandId,
    target: JsonValueSchema.parse(command.target),
    subject: resolved.data.subject,
    options,
    configDescriptor: configDescriptor(command),
  });
  if (resolved.data.cancelled) return refusal(phase, "ASSISTANT_BINDING_STALE", "cancelled");
  const prior = resolved.data.checkOutcome;
  if (prior.state === "unknown") return refusal(phase, "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
  if (prior.state === "retained" && sameJson(prior.binding, binding)) {
    if (prior.outcome === "refused") {
      if (prior.code === undefined) return refusal(phase, "ASSISTANT_AUTHORITY_INVALID");
      return refusal(phase, prior.code, prior.field);
    }
  }
  if (body.data.approval !== undefined) {
    const approval = AssistantApprovalBindingSchema.safeParse(body.data.approval);
    if (!approval.success) return refusal(phase, "ASSISTANT_MODEL_PROPOSAL_REFUSED");
    const field = staleField(binding, approval.data);
    if (field !== undefined) return refusal(phase, "ASSISTANT_BINDING_STALE", field);
  }
  if (body.data.approval === undefined) {
    return finish("approval-required", phase, "fresh", binding);
  }
  return finish("assistant-clear", phase, prior.state === "retained" && sameJson(prior.binding, binding) ? "retained" : "fresh", binding);
}
