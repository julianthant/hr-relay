import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { z } from "zod";
import { AssistantActionManifestSchema, AssistantApprovalBindingSchema, AssistantPermissionPolicySchema } from "./assistant-permissions.js";
import { CommandRequestSchema, CommandResultSchema } from "../../rules/commands/commands.js";
import { FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";

export const AssistantGrantRecordSchema = z.strictObject({
  id: z.literal("current"), profileId: z.uuid(), policy: AssistantPermissionPolicySchema,
  commandId: z.uuid(), updatedAt: IsoInstantSchema,
}).refine(record => record.policy.grant.profileId === record.profileId, "assistant-grant-profile-mismatch");
export const AssistantChatRecordSchema = z.strictObject({
  id: z.uuid(), profileId: z.uuid(), epoch: PositiveIntSchema,
  createdAt: IsoInstantSchema, expiresAt: IsoInstantSchema,
}).refine(record => Date.parse(record.createdAt) < Date.parse(record.expiresAt), "assistant-chat-expiry-invalid");
export const AssistantPlanBindingSchema = z.strictObject({
  startPlanId: z.uuid(), version: PositiveIntSchema, descriptorFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema, ingressSchemaHash: FingerprintSchema,
  canonicalInputSchemaHash: FingerprintSchema, inputFingerprint: FingerprintSchema, expiresAt: IsoInstantSchema,
});
export const AssistantStoredCommandSchema = CommandRequestSchema.superRefine((command, context) => {
  let admitted = command.family === "notification" || command.family === "workflow-batch"
    || (command.family === "worker-browser" && command.type === "spawn-worker");
  if (command.type === "apply-settings") admitted = command.payload.assistantPermission === undefined && Object.entries(command.payload.patch).every(([, operation]) =>
    ("clear" in operation || typeof operation.set === "boolean" || typeof operation.set === "number"));
  if (!admitted) context.addIssue({ code: "custom", message: "assistant-command-values-unbound" });
});
export const AssistantActionRecordSchema = z.strictObject({
  id: z.uuid(), chatId: z.uuid(), manifest: AssistantActionManifestSchema, binding: AssistantApprovalBindingSchema,
  command: AssistantStoredCommandSchema, plan: AssistantPlanBindingSchema.nullable(),
  revision: PositiveIntSchema, state: z.enum(["prepared", "approved", "claimed", "settled", "unknown", "cancelled"]),
  result: CommandResultSchema.nullable(), createdAt: IsoInstantSchema, expiresAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.command.family === "start" && record.plan === null) context.addIssue({ code: "custom", message: "assistant-start-plan-required" });
  if (canonicalJsonStringify(record.command.target) !== canonicalJsonStringify(record.binding.target)) context.addIssue({ code: "custom", message: "assistant-command-target-mismatch" });
  if (record.command.commandId !== record.binding.commandId || record.command.type !== record.binding.action
    || record.command.family !== record.binding.family) context.addIssue({ code: "custom", message: "assistant-command-binding-mismatch" });
  if ((record.state === "settled") !== (record.result !== null)) context.addIssue({ code: "custom", message: "assistant-result-state-mismatch" });
  if (record.result !== null && record.result.commandId !== record.command.commandId) context.addIssue({ code: "custom", message: "assistant-result-command-mismatch" });
  if (Date.parse(record.expiresAt) <= Date.parse(record.createdAt)) context.addIssue({ code: "custom", message: "assistant-action-expiry-invalid" });
});
export type AssistantActionRecord = z.infer<typeof AssistantActionRecordSchema>;
