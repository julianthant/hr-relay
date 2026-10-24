import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import { z } from "zod";

const ReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
export const AssistantSubjectSchema = z.strictObject({
  subjectRef: ReferenceSchema, displayName: z.string().min(1).max(160), employeeId: z.string().regex(/^\d{8}$/u).optional(),
});
export type AssistantSubject = z.infer<typeof AssistantSubjectSchema>;
export const AssistantCitationSchema = z.strictObject({
  path: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{40}$/u),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(), quote: z.string().min(1).max(4000),
});
export const ASSISTANT_DEFAULT_MODEL = "gpt-6.1-sol";
export const ASSISTANT_DEFAULT_EFFORT = "medium";
const ModelSlugSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const FunctionNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
export const AssistantModelCatalogSchema = z.strictObject({
  models: z.array(z.strictObject({ slug: ModelSlugSchema, displayName: z.string().min(1).max(256) })).max(256),
}).refine(value => new Set(value.models.map(model => model.slug)).size === value.models.length);
export type AssistantModelCatalog = z.infer<typeof AssistantModelCatalogSchema>;
export const AssistantFunctionCallSchema = z.strictObject({ type: z.literal("function_call"), id: z.string().min(1).max(256).optional(),
  call_id: z.string().min(1).max(256), namespace: FunctionNameSchema, name: FunctionNameSchema,
  arguments: z.string().max(32_000), status: z.literal("completed").optional(), async: z.literal(false).optional(),
  caller: z.strictObject({ type: z.literal("direct") }).nullish(),
});
const AssistantMessageSchema = z.object({ type: z.literal("message"), id: z.string().min(1).max(256).optional(), role: z.literal("assistant"),
  status: z.literal("completed"), content: z.array(z.object({ type: z.literal("output_text"), text: z.string().min(1).max(8000) }).passthrough()).min(1).max(8),
}).passthrough();
export const AssistantResponseItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reasoning"), id: z.string().min(1).max(256), status: z.literal("completed").optional(),
    summary: z.array(z.object({ type: z.literal("summary_text"), text: z.string().max(32_000) }).passthrough()).max(32),
  }).passthrough(), AssistantMessageSchema, AssistantFunctionCallSchema,
]);
export type AssistantResponseItem = z.infer<typeof AssistantResponseItemSchema>;
export const AssistantFunctionOutputSchema = z.strictObject({ type: z.literal("function_call_output"), call_id: z.string().min(1).max(256), namespace: FunctionNameSchema, name: FunctionNameSchema,
  caller: z.strictObject({ type: z.literal("direct") }).nullish(), output: z.string().max(32_000) });
export const AssistantInputItemSchema = z.union([
  z.strictObject({ role: z.enum(["user", "developer"]), content: z.string().min(1).max(80_000) }),
  AssistantResponseItemSchema, AssistantFunctionOutputSchema,
]);
export type AssistantInputItem = z.infer<typeof AssistantInputItemSchema>;
export const AssistantInferenceResultSchema = z.strictObject({ responseId: z.string().min(1).max(256), model: ModelSlugSchema,
  output: z.array(AssistantResponseItemSchema).min(1).max(32),
});
export type AssistantInferenceResult = z.infer<typeof AssistantInferenceResultSchema>;
export const AssistantFunctionDefinitionSchema = z.strictObject({ type: z.literal("function"), name: FunctionNameSchema,
  description: z.string().min(1).max(4000), strict: z.literal(true), parameters: z.record(z.string(), JsonValueSchema).refine(value => {
    const strict = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.every(strict);
      if (typeof node !== "object" || node === null) return true;
      if ("type" in node && node.type === "object" || "properties" in node) {
        if (!("properties" in node) || typeof node.properties !== "object" || node.properties === null || Array.isArray(node.properties)
          || !("additionalProperties" in node) || node.additionalProperties !== false || !("required" in node) || !Array.isArray(node.required)
          || node.required.length !== Object.keys(node.properties).length) return false;
        const required = node.required;
        if (!Object.keys(node.properties).every(key => required.includes(key))) return false;
      }
      return Object.values(node).every(strict);
    };
    return value.type === "object" && strict(value);
  }),
});
export const AssistantFunctionNamespaceSchema = z.strictObject({ type: z.literal("namespace"), name: FunctionNameSchema,
  description: z.string().min(1).max(4000), tools: z.array(AssistantFunctionDefinitionSchema).min(1).max(16),
});
export type AssistantFunctionNamespace = z.infer<typeof AssistantFunctionNamespaceSchema>;
export const AssistantInferenceRequestSchema = z.strictObject({ model: ModelSlugSchema,
  reasoning: z.strictObject({ effort: z.enum(["low", "medium", "high"]) }),
  input: z.array(AssistantInputItemSchema).min(1).max(128), tools: z.array(AssistantFunctionNamespaceSchema).max(8),
}).superRefine((value, context) => {
  const namespaces = new Set<string>(), calls = new Map<string, { namespace: string; name: string; settled: boolean }>();
  for (const namespace of value.tools) {
    if (namespaces.has(namespace.name) || new Set(namespace.tools.map(tool => tool.name)).size !== namespace.tools.length) context.addIssue({ code: "custom", message: "Duplicate assistant function identity" });
    namespaces.add(namespace.name);
  }
  for (const item of value.input) {
    if (!("type" in item)) continue;
    if (item.type === "function_call") {
      const namespace = value.tools.find(namespace => namespace.name === item.namespace);
      if (namespace?.tools.filter(tool => tool.name === item.name).length !== 1) context.addIssue({ code: "custom", message: "Unknown assistant function identity" });
      if (calls.has(item.call_id)) context.addIssue({ code: "custom", message: "Duplicate assistant call identity" });
      calls.set(item.call_id, { namespace: item.namespace, name: item.name, settled: false });
    } else if (item.type === "function_call_output") {
      const call = calls.get(item.call_id);
      if (call === undefined || call.settled || call.namespace !== item.namespace || call.name !== item.name) context.addIssue({ code: "custom", message: "Unbound assistant function output" });
      else call.settled = true;
    }
  }
  if ([...calls.values()].some(call => !call.settled)) context.addIssue({ code: "custom", message: "Missing assistant function output" });
});
export type AssistantInferenceRequest = z.infer<typeof AssistantInferenceRequestSchema>;
export const AssistantRequestSchema = z.strictObject({
  message: z.string().min(1).max(4000), subjectRef: ReferenceSchema.optional(),
});
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;
export const ASSISTANT_FAILURES = Object.freeze({
  ASSISTANT_INVALID: ERROR_CATALOG.ASSISTANT_INVALID.text,
  ASSISTANT_CONTEXT_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_CONTEXT_UNAVAILABLE.text,
  ASSISTANT_CONTEXT_STALE: ERROR_CATALOG.ASSISTANT_CONTEXT_STALE.text,
  ASSISTANT_MODEL_UNVERIFIED: ERROR_CATALOG.ASSISTANT_MODEL_UNVERIFIED.text,
  ASSISTANT_MODEL_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_MODEL_UNAVAILABLE.text,
  ASSISTANT_RESPONSE_REFUSED: ERROR_CATALOG.ASSISTANT_RESPONSE_REFUSED.text,
  ASSISTANT_USAGE_LIMIT: ERROR_CATALOG.ASSISTANT_USAGE_LIMIT.text,
  ASSISTANT_PLAN_DISABLED: ERROR_CATALOG.ASSISTANT_PLAN_DISABLED.text,
  ASSISTANT_ACCOUNT_EXPIRED: ERROR_CATALOG.ASSISTANT_ACCOUNT_EXPIRED.text,
  ASSISTANT_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_UNAVAILABLE.text,
  ASSISTANT_CANCELLED: ERROR_CATALOG.ASSISTANT_CANCELLED.text,
  ASSISTANT_LIMIT: ERROR_CATALOG.ASSISTANT_LIMIT.text,
  ASSISTANT_SUBJECT_REQUIRED: ERROR_CATALOG.ASSISTANT_SUBJECT_REQUIRED.text,
  ASSISTANT_PROPOSAL_REFUSED: ERROR_CATALOG.ASSISTANT_PROPOSAL_REFUSED.text,
});
export type AssistantFailureCode = keyof typeof ASSISTANT_FAILURES;
export const AssistantProposalSchema = z.strictObject({
  workflowId: z.string(), subject: AssistantSubjectSchema, intent: z.literal("dry-run"),
  descriptorVersion: z.number().int().positive(), descriptorFingerprint: z.string(), configSnapshotId: z.string(),
  configFingerprint: z.string(), inputFingerprint: z.string(), optionsFingerprint: z.string(),
  expiresAt: z.string().datetime(), stopBefore: z.strictObject({ nodeId: z.string().min(1), phase: z.literal("commit"),
    afterPrepareTaskId: z.string().min(1), commitTaskId: z.string().min(1) }),
  effects: z.strictObject({ workflowExecuted: z.literal(false), transactionCommitted: z.literal(false) }), confirmation: z.literal("required-in-run"),
});
export const AssistantActionIdentitySchema = z.strictObject({ chatId: z.uuid(), actionId: z.uuid(), revision: z.number().int().positive() });
export type AssistantActionIdentity = z.infer<typeof AssistantActionIdentitySchema>;
export const AssistantActionProposalSchema = AssistantActionIdentitySchema.extend({
  expiresAt: z.string().datetime(), label: z.string().min(1).max(160), targetLabel: z.string().min(1).max(160),
  subject: z.literal("none"), effect: z.literal("local-write"),
});
export type AssistantActionProposal = z.infer<typeof AssistantActionProposalSchema>;
export const AssistantActionDecisionSchema = AssistantActionIdentitySchema.extend({ decision: z.enum(["confirm", "cancel"]) });
export type AssistantActionDecision = z.infer<typeof AssistantActionDecisionSchema>;
export const AssistantUnknownActionResultSchema = z.strictObject({ state: z.literal("unknown"), actionId: z.uuid() });
export const AssistantActionResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied"), actionId: z.uuid() }),
  z.strictObject({ state: z.literal("cancelled"), actionId: z.uuid() }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]) }),
  AssistantUnknownActionResultSchema,
]);
export type AssistantActionResult = z.infer<typeof AssistantActionResultSchema>;
export const AssistantResultSchema = z.discriminatedUnion("state", [
  AssistantUnknownActionResultSchema.extend({ action: AssistantActionProposalSchema }).refine(value => value.actionId === value.action.actionId, "assistant-action-response-mismatch"),
  z.strictObject({ state: z.literal("answered"), text: z.string().max(8000), citations: z.array(AssistantCitationSchema).max(8) }),
  z.strictObject({ state: z.literal("action-proposal"), proposal: AssistantActionProposalSchema }),
  z.strictObject({ state: z.literal("proposal"), proposal: AssistantProposalSchema }),
  z.strictObject({ state: z.literal("resolution-required"), candidates: z.array(AssistantSubjectSchema).max(20) }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]), message: z.string() }),
]);
export type AssistantResult = z.infer<typeof AssistantResultSchema>;
