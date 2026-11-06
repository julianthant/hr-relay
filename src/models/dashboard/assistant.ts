import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import { z } from "zod";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import { AssistantPermissionModeSchema } from "../profiles/assistant-permission-mode.js";
import { StartPlanWireSchema } from "./start-plan.js";
import { AssistantModelPreferenceSchema, AssistantModelSlugSchema } from "../config/assistant-model-preference.js";

export const ASSISTANT_DEFAULT_MODEL = "gpt-6.1-sol";
export const ASSISTANT_DEFAULT_EFFORT = "medium";
export const ASSISTANT_VERIFY_COMMAND = '/verify-assistant';
export const ASSISTANT_MODEL_COMMAND = '/assistant-model';
export const AssistantModelPreferenceViewSchema = z.strictObject({
  profileId: z.uuid(), epoch: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  preference: AssistantModelPreferenceSchema,
});
export type AssistantModelPreferenceView = z.infer<typeof AssistantModelPreferenceViewSchema>;
const AssistantPermissionIdentitySchema = z.strictObject({
  profileId: z.uuid(), epoch: z.number().int().nonnegative(), mode: AssistantPermissionModeSchema,
  settingsRevision: z.number().int().positive(), settingsSchemaHash: FingerprintSchema,
});
export const AssistantPermissionViewSchema = z.discriminatedUnion("state", [
  AssistantPermissionIdentitySchema.extend({ state: z.literal("grant-required"), policyRevision: z.literal(0) }),
  AssistantPermissionIdentitySchema.extend({ state: z.literal("granted"), policyRevision: z.number().int().positive() }),
]);
export type AssistantPermissionView = z.infer<typeof AssistantPermissionViewSchema>;
export const AssistantModelPreferenceRecordSchema = z.strictObject({
  format: z.literal(1), id: z.literal("current"), profileId: z.uuid(), revision: z.number().int().positive(),
  preference: AssistantModelPreferenceSchema, commandId: z.uuid(), auditId: z.uuid(), updatedAt: z.iso.datetime(),
});
export type AssistantModelPreferenceRecord = z.infer<typeof AssistantModelPreferenceRecordSchema>;
const FunctionNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
export const AssistantModelCatalogSchema = z.strictObject({
  models: z.array(z.strictObject({ slug: AssistantModelSlugSchema, displayName: z.string().min(1).max(256) })).max(256),
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
export const AssistantInferenceResultSchema = z.strictObject({ responseId: z.string().min(1).max(256), model: AssistantModelSlugSchema,
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
export const AssistantInferenceRequestSchema = z.strictObject({ model: AssistantModelSlugSchema,
  reasoning: z.strictObject({ effort: z.enum(["low", "medium", "high", "xhigh", "max"]) }),
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
  conversationId: z.uuid(), expectedRevision: z.number().int().positive(), messageId: z.uuid(),
  message: z.string().min(1).max(4000), subjectRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u).optional(),
});
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;
export const ASSISTANT_FAILURES = Object.freeze({
  CHATGPT_AUTH_BUSY: ERROR_CATALOG.CHATGPT_AUTH_BUSY.text,
  CHATGPT_AUTH_CANCELLED: ERROR_CATALOG.CHATGPT_AUTH_CANCELLED.text,
  CHATGPT_AUTH_EXPIRED: ERROR_CATALOG.CHATGPT_AUTH_EXPIRED.text,
  CHATGPT_AUTH_INVALID: ERROR_CATALOG.CHATGPT_AUTH_INVALID.text,
  CHATGPT_AUTH_UNAVAILABLE: ERROR_CATALOG.CHATGPT_AUTH_UNAVAILABLE.text,
  CHATGPT_USAGE_UNAVAILABLE: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text,
  CHATGPT_MODEL_UNAVAILABLE: ERROR_CATALOG.CHATGPT_MODEL_UNAVAILABLE.text,
  CHATGPT_MODELS_UNAVAILABLE: ERROR_CATALOG.CHATGPT_MODELS_UNAVAILABLE.text,
  CHATGPT_REQUEST_REJECTED: ERROR_CATALOG.CHATGPT_REQUEST_REJECTED.text,
  CHATGPT_RATE_LIMITED: ERROR_CATALOG.CHATGPT_RATE_LIMITED.text,
  CHATGPT_DIAGNOSTICS_UNAVAILABLE: ERROR_CATALOG.CHATGPT_DIAGNOSTICS_UNAVAILABLE.text,
  CHATGPT_SERVICE_CLOSED: ERROR_CATALOG.CHATGPT_SERVICE_CLOSED.text,
  ASSISTANT_VERIFICATION_FAILED: ERROR_CATALOG.ASSISTANT_VERIFICATION_FAILED.text,
  ASSISTANT_CAPABILITY_FAILED: ERROR_CATALOG.ASSISTANT_CAPABILITY_FAILED.text,
  ASSISTANT_READ_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_READ_UNAVAILABLE.text,
  ASSISTANT_READ_STALE: ERROR_CATALOG.ASSISTANT_READ_STALE.text,
  ASSISTANT_HISTORY_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_HISTORY_UNAVAILABLE.text,
  ASSISTANT_HISTORY_UNSAVED: ERROR_CATALOG.ASSISTANT_HISTORY_UNSAVED.text,
  ASSISTANT_CHAT_FULL: ERROR_CATALOG.ASSISTANT_CHAT_FULL.text,
  ASSISTANT_CHAT_LIMIT: ERROR_CATALOG.ASSISTANT_CHAT_LIMIT.text,
  ASSISTANT_HISTORY_FULL: ERROR_CATALOG.ASSISTANT_HISTORY_FULL.text,
  ASSISTANT_CONVERSATION_STALE: ERROR_CATALOG.ASSISTANT_CONVERSATION_STALE.text,
  ASSISTANT_CONVERSATION_BUSY: ERROR_CATALOG.ASSISTANT_CONVERSATION_BUSY.text,
  CHATGPT_RESOURCE_CLOSURE_UNPROVED: ERROR_CATALOG.CHATGPT_RESOURCE_CLOSURE_UNPROVED.text,
  ASSISTANT_INVALID: ERROR_CATALOG.ASSISTANT_INVALID.text,
  ASSISTANT_CONTEXT_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_CONTEXT_UNAVAILABLE.text,
  ASSISTANT_CONTEXT_STALE: ERROR_CATALOG.ASSISTANT_CONTEXT_STALE.text,
  ASSISTANT_MODEL_UNVERIFIED: ERROR_CATALOG.ASSISTANT_MODEL_UNVERIFIED.text,
  ASSISTANT_MODEL_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_MODEL_UNAVAILABLE.text,
  ASSISTANT_RESPONSE_REFUSED: ERROR_CATALOG.ASSISTANT_RESPONSE_REFUSED.text,
  ASSISTANT_RESPONSE_INCOMPLETE: ERROR_CATALOG.ASSISTANT_RESPONSE_INCOMPLETE.text,
  ASSISTANT_RESPONSE_FAILED: ERROR_CATALOG.ASSISTANT_RESPONSE_FAILED.text,
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
export const AssistantActionIdentitySchema = z.strictObject({ chatId: z.uuid(), actionId: z.uuid(), revision: z.number().int().positive() });
export type AssistantActionIdentity = z.infer<typeof AssistantActionIdentitySchema>;
const AssistantActionProposalFields = {
  ...AssistantActionIdentitySchema.shape,
  expiresAt: z.string().datetime(), label: z.string().min(1).max(160), targetLabel: z.string().min(1).max(160),
};
/** At most this many planned rows on one start card. */
export const ASSISTANT_START_ROWS_MAX = 20;
/** What one planned row shows, derived on the server from the planned canonical input, never from model text. */
export const AssistantRowDisplaySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("person"), name: z.string().min(1).max(160).optional(), employeeId: z.string().regex(/^\d{8}$/u).optional() }),
  z.strictObject({ kind: z.literal("document"), documentNumber: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("request") }),
]);
export const AssistantProposalRowSchema = z.strictObject({ title: z.string().min(1), subtitle: z.string().min(1).optional(), display: AssistantRowDisplaySchema })
  .refine(row => row.display.kind !== "person" || row.display.name !== undefined || row.display.employeeId !== undefined, "a person row shows a name or an EID");
export type AssistantProposalRow = z.infer<typeof AssistantProposalRowSchema>;
export const AssistantActionProposalSchema = z.discriminatedUnion("effect", [
  z.strictObject({ ...AssistantActionProposalFields, effect: z.literal("local-write") }),
  z.strictObject({ ...AssistantActionProposalFields, effect: z.literal("workflow-start"), source: z.enum(["entries", "run", "rerun"]),
    workflowId: z.string().min(1), dryRun: z.boolean(),
    startPlan: StartPlanWireSchema.pick({
      startPlanId: true, workflowId: true, expectedVersion: true, expiresAt: true, dryRun: true,
      browserMode: true, captureBrowserScreenshots: true, fingerprints: true,
    }).extend({
      browserMode: StartPlanWireSchema.shape.browserMode.unwrap(), captureBrowserScreenshots: z.literal(true),
      planned: z.array(AssistantProposalRowSchema).min(1).max(ASSISTANT_START_ROWS_MAX),
    }),
  }).refine(value => value.startPlan.workflowId === value.workflowId && value.startPlan.dryRun === value.dryRun
    && (value.source === "entries" || value.startPlan.planned.length === 1)
    && Date.parse(value.expiresAt) <= Date.parse(value.startPlan.expiresAt), "assistant start must bind one accepted current plan"),
  z.strictObject({ ...AssistantActionProposalFields, effect: z.literal("run-action"), action: z.enum(["pause", "resume", "cancel"]),
    workflowId: z.string().min(1), run: z.strictObject({ runId: z.uuid(), expectedVersion: z.number().int().positive() }), row: AssistantProposalRowSchema }),
]);
export type AssistantActionProposal = z.infer<typeof AssistantActionProposalSchema>;
/** Confirm carries the SHA-256 of the canonical JSON of the exact proposal the operator reviewed; Cancel is identity only. */
export const AssistantActionDecisionSchema = AssistantActionIdentitySchema.extend({ decision: z.enum(["confirm", "cancel"]), reviewedDigest: FingerprintSchema.optional() })
  .refine(value => (value.decision === "confirm") === (value.reviewedDigest !== undefined), "a confirm carries the reviewed proposal digest; a cancel carries none");
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
  z.strictObject({ state: z.literal("answered"), text: z.string().max(8000) }),
  z.strictObject({ state: z.literal("action-proposal"), proposal: AssistantActionProposalSchema }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]), message: z.string() }),
]);
export type AssistantResult = z.infer<typeof AssistantResultSchema>;

/** Gate 50 history: 20 chats per profile, 200 messages per chat, absolute 30-day expiry. */
export const ASSISTANT_CHATS_MAX = 20;
export const ASSISTANT_MESSAGES_MAX = 200;
export const ASSISTANT_CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ASSISTANT_HISTORY_BODY_MAX_BYTES = 1024 * 1024;
/** Per-profile stored metadata (titles, drafts and message display text of unexpired chats), in UTF-16 units. */
export const ASSISTANT_HISTORY_METADATA_MAX_UNITS = 2_000_000;
const Revision = z.number().int().positive();
const Title = z.string().trim().min(1).max(200);
const Draft = z.string().max(4000);
const DisplayText = z.string().max(8000);
const FailureCode = z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]);
export const AssistantImportNoticeSchema = z.enum(["unknown", "proposal-expired"]);
export const AssistantDeliverySchema = z.enum(["sending", "answered", "refused", "delivery-unknown", "settled"]);
export const AssistantMessageKindSchema = z.enum(["turn", "answer", "proposal", "decision", "inert"]);
export const AssistantConversationRecordSchema = z.strictObject({
  id: z.uuid(), profileId: z.uuid(), revision: Revision, selectedAt: z.iso.datetime().nullable(), title: Title, draft: Draft, composer: Draft,
  importTotal: z.number().int().min(0).max(ASSISTANT_MESSAGES_MAX), importNotice: AssistantImportNoticeSchema.nullable(),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
});
export type AssistantConversationRecord = z.infer<typeof AssistantConversationRecordSchema>;
export const AssistantMessageRecordSchema = z.strictObject({
  id: z.uuid(), conversationId: z.uuid(), ordinal: z.number().int().min(1), role: z.enum(["operator", "assistant"]), kind: AssistantMessageKindSchema,
  modelText: z.string().max(16_000).nullable(), subjectRef: AssistantRequestSchema.shape.subjectRef.unwrap().nullable(), actionId: z.uuid().nullable(),
  delivery: AssistantDeliverySchema, code: FailureCode.nullable(), text: DisplayText, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).refine(value => (value.kind === "inert") === (value.modelText === null)
  && (value.kind === "turn") === (value.role === "operator" && value.delivery !== "settled") && (value.kind === "turn" || value.delivery === "settled")
  && (value.code !== null) === (value.delivery === "refused") && (value.subjectRef === null || value.kind === "turn")
  && (value.actionId !== null) === (value.kind === "proposal" || value.kind === "decision"), "assistant message fields disagree with its kind");
export type AssistantMessageRecord = z.infer<typeof AssistantMessageRecordSchema>;

/** What the browser reads: never replay text or the selected-run reference. */
export const AssistantChatSummarySchema = z.strictObject({ id: z.uuid(), title: Title, revision: Revision, createdAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
export const AssistantHistoryViewSchema = z.strictObject({ chats: z.array(AssistantChatSummarySchema).max(ASSISTANT_CHATS_MAX), selectedId: z.uuid().nullable() });
export type AssistantHistoryView = z.infer<typeof AssistantHistoryViewSchema>;
export const AssistantStoredMessageSchema = z.strictObject({
  id: z.uuid(), ordinal: z.number().int().min(1), role: z.enum(["operator", "assistant"]), kind: AssistantMessageKindSchema,
  text: DisplayText, delivery: AssistantDeliverySchema, code: FailureCode.nullable(), actionId: z.uuid().nullable(),
});
export type AssistantStoredMessage = z.infer<typeof AssistantStoredMessageSchema>;
export const AssistantConversationViewSchema = z.strictObject({
  id: z.uuid(), title: Title, revision: Revision, draft: Draft, composer: Draft,
  importTotal: z.number().int().min(0).max(ASSISTANT_MESSAGES_MAX), importNotice: AssistantImportNoticeSchema.nullable(),
  messages: z.array(AssistantStoredMessageSchema).max(ASSISTANT_MESSAGES_MAX),
});
export type AssistantConversationView = z.infer<typeof AssistantConversationViewSchema>;
const Target = { conversationId: z.uuid() };
const Cas = { ...Target, expectedRevision: Revision };
export const AssistantImportMessageSchema = z.strictObject({ messageId: z.uuid(), role: z.enum(["operator", "assistant"]), text: DisplayText });
export const AssistantHistoryOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create"), ...Target, title: Title }),
  z.strictObject({ operation: z.literal("rename"), ...Cas, title: Title }),
  z.strictObject({ operation: z.literal("select"), ...Cas }),
  z.strictObject({ operation: z.literal("clear"), ...Cas }),
  z.strictObject({ operation: z.literal("draft"), ...Target, draft: Draft, composer: Draft }),
  z.strictObject({ operation: z.literal("local"), ...Cas, messageId: z.uuid(), text: DisplayText.min(1) }),
  z.strictObject({ operation: z.literal("import"), ...Target, title: Title, draft: Draft, composer: Draft, notice: AssistantImportNoticeSchema.nullable(),
    total: z.number().int().min(0).max(ASSISTANT_MESSAGES_MAX), start: z.number().int().min(1),
    messages: z.array(AssistantImportMessageSchema).max(ASSISTANT_MESSAGES_MAX) })
    .refine(value => value.start + value.messages.length - 1 <= value.total && (value.messages.length > 0 || (value.total === 0 && value.start === 1)), "import batch outside its transcript"),
]);
export type AssistantHistoryOperation = z.infer<typeof AssistantHistoryOperationSchema>;
export const AssistantHistoryResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("saved"), conversationId: z.uuid(), revision: Revision }),
  z.strictObject({ state: z.literal("cleared"), conversationId: z.uuid(), transmissionMayHaveStarted: z.boolean() }),
  z.strictObject({ state: z.literal("refused"), code: FailureCode }),
]);
export type AssistantHistoryResult = z.infer<typeof AssistantHistoryResultSchema>;

export const AssistantReceiptSchema = z.strictObject({
  conversationId: z.uuid(), messageId: z.uuid(), ordinal: z.number().int().min(1), revision: Revision, delivery: AssistantDeliverySchema.exclude(["settled"]),
});
export type AssistantReceipt = z.infer<typeof AssistantReceiptSchema>;
/** `result` settles a turn this request accepted (receipt) or refused before acceptance; `delivery` reads an existing attempt and never carries an action. */
export const AssistantRespondEnvelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("result"), result: AssistantResultSchema, receipt: AssistantReceiptSchema.optional() }),
  z.strictObject({ kind: z.literal("delivery"), receipt: AssistantReceiptSchema }),
]);
export type AssistantRespondEnvelope = z.infer<typeof AssistantRespondEnvelopeSchema>;
