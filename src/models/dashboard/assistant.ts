import { AssistantCallUsageSchema, AssistantTurnUsageSchema } from "./assistant-usage.js";
import { AssistantCommandAttributionSchema, StartCommandRequestSchema } from "../../rules/commands/commands.js";
import { ActionDescriptorWireSchema } from "./actions.js";
import { QueueStatusSchema, TERMINAL_QUEUE_STATUSES } from "./projection.js";
import { RowRevisionSchema, RunDetailSectionSchema } from "./primitives.js";
import { CrossDateSearchQuerySchema } from "./search.js";
import { WorkbookCellChangeSchema, WorkbookIdSchema, WorkbookRevisionSchema } from "./workbooks.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { OcrFormTypeSchema } from "../ocr/form-registry.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../failures/error-catalog.js";
import { z } from "zod";
import { CommandIdSchema, FingerprintSchema, IsoInstantSchema, LocalDateSchema, PositiveIntSchema, RunIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "./start-plan.js";
import { AssistantModelPreferenceSchema, AssistantModelSlugSchema } from "../config/assistant-model-preference.js";

export const ASSISTANT_DEFAULT_MODEL = "gpt-6.1-sol";
export const ASSISTANT_ATTACHMENTS_PER_SEND = 4;
export const ASSISTANT_DEFAULT_EFFORT = "medium";
export const ASSISTANT_MODEL_COMMAND = '/assistant-model';
export const AssistantModelPreferenceViewSchema = z.strictObject({
  profileId: z.uuid(), epoch: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  preference: AssistantModelPreferenceSchema,
});
export type AssistantModelPreferenceView = z.infer<typeof AssistantModelPreferenceViewSchema>;
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
const Base64 = z.string().min(4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/u);
const MediaUrl = (prefix: RegExp) => z.string().refine(url => { const match = prefix.exec(url); return match !== null && Base64.safeParse(url.slice(match[0].length)).success; });
/** Attachment content parts: original images and PDFs as data URLs, text as text. */
export const AssistantUserContentPartSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("input_text"), text: z.string().min(1).max(80_000) }),
  z.strictObject({ type: z.literal("input_image"), image_url: MediaUrl(/^data:image\/(?:png|jpeg|webp);base64,/u), detail: z.literal("high") }),
  z.strictObject({ type: z.literal("input_file"), filename: z.string().regex(/^attachment-[1-9][0-9]{0,3}\.pdf$/u), file_data: MediaUrl(/^data:application\/pdf;base64,/u) }),
]);
export type AssistantUserContentPart = z.infer<typeof AssistantUserContentPartSchema>;
export const AssistantInputItemSchema = z.union([
  z.strictObject({ role: z.enum(["user", "developer"]), content: z.string().min(1).max(80_000) }),
  z.strictObject({ role: z.literal("user"), content: z.array(AssistantUserContentPartSchema).min(2).max(1 + ASSISTANT_ATTACHMENTS_PER_SEND * 2) }),
  AssistantResponseItemSchema, AssistantFunctionOutputSchema,
]);
export type AssistantInputItem = z.infer<typeof AssistantInputItemSchema>;
/** Context bounds for attachments, replay included: decoded media, attachment text, and the complete outbound request. */
export const ASSISTANT_CONTEXT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const ASSISTANT_CONTEXT_TEXT_MAX_BYTES = 48 * 1024;
export const ASSISTANT_REQUEST_MAX_BYTES = 28 * 1024 * 1024;
/** The content parts of a user turn that carries attachments; empty for every other item. */
export const assistantUserParts = (item: AssistantInputItem): readonly AssistantUserContentPart[] =>
  "type" in item || item.role !== "user" || typeof item.content === "string" ? [] : item.content;
/** The Base64 payload of every image and PDF part: its characters are exempt from structure budgets, its decoded bytes count toward the media bound. */
export function assistantInputMedia(input: readonly AssistantInputItem[]): Readonly<{ base64Chars: number; bytes: number }> {
  let base64Chars = 0, bytes = 0;
  for (const item of input) {
    for (const part of assistantUserParts(item)) {
      if (part.type === "input_text") continue;
      const url = part.type === "input_image" ? part.image_url : part.file_data, payload = url.slice(url.indexOf(",") + 1);
      base64Chars += payload.length;
      bytes += payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
    }
  }
  return { base64Chars, bytes };
}
export const AssistantInferenceResultSchema = z.strictObject({ responseId: z.string().min(1).max(256), model: AssistantModelSlugSchema,
  output: z.array(AssistantResponseItemSchema).min(1).max(32), usage: AssistantCallUsageSchema,
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
  /** Staged attachment IDs in send order; the server record supplies every name, type and size. */
  attachments: z.array(z.uuid()).min(1).max(ASSISTANT_ATTACHMENTS_PER_SEND).refine(ids => new Set(ids).size === ids.length).optional(),
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
  ASSISTANT_READ_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_READ_UNAVAILABLE.text,
  ASSISTANT_READ_STALE: ERROR_CATALOG.ASSISTANT_READ_STALE.text,
  ASSISTANT_HISTORY_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_HISTORY_UNAVAILABLE.text,
  ASSISTANT_HISTORY_UNSAVED: ERROR_CATALOG.ASSISTANT_HISTORY_UNSAVED.text,
  ASSISTANT_CHAT_FULL: ERROR_CATALOG.ASSISTANT_CHAT_FULL.text,
  ASSISTANT_CHAT_LIMIT: ERROR_CATALOG.ASSISTANT_CHAT_LIMIT.text,
  ASSISTANT_HISTORY_FULL: ERROR_CATALOG.ASSISTANT_HISTORY_FULL.text,
  ASSISTANT_CONVERSATION_STALE: ERROR_CATALOG.ASSISTANT_CONVERSATION_STALE.text,
  ASSISTANT_CONVERSATION_BUSY: ERROR_CATALOG.ASSISTANT_CONVERSATION_BUSY.text,
  ASSISTANT_ATTACHMENT_UNSUPPORTED: ERROR_CATALOG.ASSISTANT_ATTACHMENT_UNSUPPORTED.text,
  ASSISTANT_ATTACHMENT_INVALID: ERROR_CATALOG.ASSISTANT_ATTACHMENT_INVALID.text,
  ASSISTANT_ATTACHMENT_TOO_LARGE: ERROR_CATALOG.ASSISTANT_ATTACHMENT_TOO_LARGE.text,
  ASSISTANT_ATTACHMENT_BUSY: ERROR_CATALOG.ASSISTANT_ATTACHMENT_BUSY.text,
  ASSISTANT_ATTACHMENT_TIMEOUT: ERROR_CATALOG.ASSISTANT_ATTACHMENT_TIMEOUT.text,
  ASSISTANT_ATTACHMENT_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_ATTACHMENT_UNAVAILABLE.text,
  ASSISTANT_ATTACHMENT_STORAGE_LIMIT: ERROR_CATALOG.ASSISTANT_ATTACHMENT_STORAGE_LIMIT.text,
  CHATGPT_RESOURCE_CLOSURE_UNPROVED: ERROR_CATALOG.CHATGPT_RESOURCE_CLOSURE_UNPROVED.text,
  ASSISTANT_INVALID: ERROR_CATALOG.ASSISTANT_INVALID.text,
  ASSISTANT_CONTEXT_UNAVAILABLE: ERROR_CATALOG.ASSISTANT_CONTEXT_UNAVAILABLE.text,
  ASSISTANT_CONTEXT_STALE: ERROR_CATALOG.ASSISTANT_CONTEXT_STALE.text,
  ASSISTANT_MODEL_CHANGED: ERROR_CATALOG.ASSISTANT_MODEL_CHANGED.text,
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
  ASSISTANT_PROPOSAL_EXPIRED: ERROR_CATALOG.ASSISTANT_PROPOSAL_EXPIRED.text,
  ASSISTANT_PROPOSAL_CHANGED: ERROR_CATALOG.ASSISTANT_PROPOSAL_CHANGED.text,
  ASSISTANT_SPREADSHEET_REFUSED: ERROR_CATALOG.ASSISTANT_SPREADSHEET_REFUSED.text,
  ASSISTANT_AUTHORITY_INVALID: ERROR_CATALOG.ASSISTANT_AUTHORITY_INVALID.text,
  ASSISTANT_MODEL_PROPOSAL_REFUSED: ERROR_CATALOG.ASSISTANT_MODEL_PROPOSAL_REFUSED.text,
  ASSISTANT_PROPOSAL_MISMATCH: ERROR_CATALOG.ASSISTANT_PROPOSAL_MISMATCH.text,
  ASSISTANT_UNCLASSIFIED: ERROR_CATALOG.ASSISTANT_UNCLASSIFIED.text,
  ASSISTANT_OPTIONS_UNBOUND: ERROR_CATALOG.ASSISTANT_OPTIONS_UNBOUND.text,
  ASSISTANT_SUBJECT_MISMATCH: ERROR_CATALOG.ASSISTANT_SUBJECT_MISMATCH.text,
  ASSISTANT_BINDING_STALE: ERROR_CATALOG.ASSISTANT_BINDING_STALE.text,
  ASSISTANT_UNKNOWN_NOT_REPLAYABLE: ERROR_CATALOG.ASSISTANT_UNKNOWN_NOT_REPLAYABLE.text,
  ASSISTANT_EFFECT_UNDERSTATED: ERROR_CATALOG.ASSISTANT_EFFECT_UNDERSTATED.text,
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
  z.strictObject({ kind: z.literal("file"), fileName: z.string().min(1).max(255), formType: OcrFormTypeSchema }),
  z.strictObject({ kind: z.literal("request") }),
]);
export const AssistantProposalRowSchema = z.strictObject({ title: z.string().min(1), subtitle: z.string().min(1).optional(), display: AssistantRowDisplaySchema })
  .refine(row => row.display.kind !== "person" || row.display.name !== undefined || row.display.employeeId !== undefined, "a person row shows a name or an EID");
export type AssistantProposalRow = z.infer<typeof AssistantProposalRowSchema>;
/** The Spreadsheets library changes the assistant may propose; each wraps one existing library owner call. */
export const AssistantSpreadsheetActionSchema = z.enum(["import", "new-version", "set-type", "sync", "link", "unlink", "rename", "create-version", "use-version", "rename-version"]);
export const AssistantActionProposalSchema = z.discriminatedUnion("effect", [
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
  z.strictObject({ ...AssistantActionProposalFields, effect: z.literal("spreadsheet"), action: AssistantSpreadsheetActionSchema,
    facts: z.array(z.strictObject({ label: z.string().min(1).max(40), value: z.string().min(1).max(320) })).min(1).max(6) }),
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
/** Gate 50 attachments: images and PDFs reach the model as originals, text as text; spreadsheets stay local. */
export const ASSISTANT_ATTACHMENT_TYPES = Object.freeze({
  "image/png": { extensions: ["png"], maxBytes: 5 * 1024 * 1024, content: "image" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], maxBytes: 5 * 1024 * 1024, content: "image" },
  "image/webp": { extensions: ["webp"], maxBytes: 5 * 1024 * 1024, content: "image" },
  "application/pdf": { extensions: ["pdf"], maxBytes: 10 * 1024 * 1024, content: "file" },
  "text/plain": { extensions: ["txt"], maxBytes: 32 * 1024, content: "text" },
  "text/markdown": { extensions: ["md"], maxBytes: 32 * 1024, content: "text" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: ["xlsx"], maxBytes: 10 * 1024 * 1024, content: "none" },
  "text/csv": { extensions: ["csv"], maxBytes: 2 * 1024 * 1024, content: "none" },
} as const);
export type AssistantAttachmentMediaType = keyof typeof ASSISTANT_ATTACHMENT_TYPES;
export const AssistantAttachmentMediaTypeSchema = z.enum(Object.keys(ASSISTANT_ATTACHMENT_TYPES) as [AssistantAttachmentMediaType, ...AssistantAttachmentMediaType[]]);
export const ASSISTANT_ATTACHMENT_STAGE_TTL_MS = 15 * 60 * 1000;
export const ASSISTANT_ATTACHMENT_UPLOAD_MS = 30_000;
export const ASSISTANT_ATTACHMENT_PROFILE_MAX_BYTES = 256 * 1024 * 1024;
/** A display-only basename: no separators or controls, at most 160 UTF-16 units and 640 UTF-8 bytes. */
export const AssistantAttachmentNameSchema = z.string().min(1).max(160).refine(name => !/[\\/\p{Cc}]/u.test(name) && name.isWellFormed()
  && new TextEncoder().encode(name).byteLength <= 640 && name.trim() === name && name !== "." && name !== "..", "assistant-attachment-name-invalid");
export const AssistantAttachmentRecordSchema = z.strictObject({
  id: z.uuid(), conversationId: z.uuid(), messageId: z.uuid().nullable(), ordinal: z.number().int().min(1).max(ASSISTANT_ATTACHMENTS_PER_SEND).nullable(),
  mediaType: AssistantAttachmentMediaTypeSchema, name: AssistantAttachmentNameSchema, byteLength: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).refine(record => (record.messageId === null) === (record.ordinal === null), "assistant-attachment-membership-invalid")
  .refine(record => record.byteLength <= ASSISTANT_ATTACHMENT_TYPES[record.mediaType].maxBytes, "assistant-attachment-too-large");
export type AssistantAttachmentRecord = z.infer<typeof AssistantAttachmentRecordSchema>;
/** The stage route's answer: the server-owned descriptor the composer shows and sends back by ID, or a fixed refusal. */
export const AssistantStageResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("staged"), attachment: z.strictObject({ id: z.uuid(), mediaType: AssistantAttachmentMediaTypeSchema, name: AssistantAttachmentNameSchema,
    byteLength: z.number().int().positive(), expiresAt: z.iso.datetime() }) }),
  z.strictObject({ state: z.literal("refused"), code: FailureCode }),
]);
export type AssistantStageResult = z.infer<typeof AssistantStageResultSchema>;
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
  attachments: z.array(z.strictObject({ id: z.uuid(), name: AssistantAttachmentNameSchema })).max(ASSISTANT_ATTACHMENTS_PER_SEND),
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


const ReplyTextSchema = z.string().min(1).max(8000);
const ReplyLabelSchema = z.string().min(1).max(160);
const WorkbookCellLocationSchema = WorkbookCellChangeSchema.pick({ sheetId: true, rowId: true, fieldId: true });
export const AssistantWorkbookLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("master") }),
  z.strictObject({ kind: z.literal("sheet"), sheetId: WorkbookIdSchema }),
  WorkbookCellLocationSchema.extend({ kind: z.literal("cell") }),
]);
const PersonRunIdentitySchema = z.strictObject({ runId: RunIdSchema, inputSchemaHash: FingerprintSchema, inputFingerprint: FingerprintSchema });
export const AssistantDataTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema, day: LocalDateSchema, section: RunDetailSectionSchema }),
  z.strictObject({ kind: z.literal("person"), identityRef: PersonRunIdentitySchema }),
  z.strictObject({ kind: z.literal("queue"), query: CrossDateSearchQuerySchema.pick({ q: true, scope: true, facets: true }) }),
  z.strictObject({ kind: z.literal("workbook"), libraryId: WorkbookIdSchema, revision: WorkbookRevisionSchema, location: AssistantWorkbookLocationSchema }),
  z.strictObject({ kind: z.literal("attachment"), attachmentId: z.uuid(), sha256: FingerprintSchema, page: PositiveIntSchema.optional() }),
]).refine(target => !/\[\[[A-Za-z][0-9]+\.g[0-9]+\]\]/u.test(JSON.stringify(target)), "reply-target-must-be-stable");
export type AssistantDataTarget = z.infer<typeof AssistantDataTargetSchema>;
export const AssistantValueSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("operator"), profileId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid(), at: IsoInstantSchema, valueFingerprint: FingerprintSchema }),
  z.strictObject({ kind: z.literal("attachment"), attachmentId: z.uuid(), sha256: FingerprintSchema, page: PositiveIntSchema, valueFingerprint: FingerprintSchema }),
  WorkbookCellLocationSchema.extend({ kind: z.literal("workbook"), libraryId: WorkbookIdSchema, revision: WorkbookRevisionSchema, valueFingerprint: FingerprintSchema }),
  PersonRunIdentitySchema.extend({ kind: z.literal("run-input"), fieldPath: z.array(z.string().min(1).max(128)).min(1).max(16), valueFingerprint: FingerprintSchema }),
]);
export type AssistantValueSource = z.infer<typeof AssistantValueSourceSchema>;
export const AssistantInlineSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("plain"), text: ReplyTextSchema }),
  z.strictObject({ kind: z.literal("bold"), text: ReplyTextSchema }),
  z.strictObject({ kind: z.literal("value"), value: ReplyTextSchema, previous: ReplyTextSchema.optional(), source: AssistantValueSourceSchema.optional() }),
  z.strictObject({ kind: z.literal("failure"), code: ErrorCatalogCodeSchema, text: z.literal("Failed") }),
  z.strictObject({ kind: z.literal("link"), label: ReplyLabelSchema, target: AssistantDataTargetSchema }),
]);
export type AssistantInline = z.infer<typeof AssistantInlineSchema>;
export const AssistantAcceptedTurnSchema = z.strictObject({
  conversationId: z.uuid(), messageId: z.uuid(), ordinal: PositiveIntSchema, acceptedRevision: PositiveIntSchema, acceptedAt: IsoInstantSchema,
  profileId: z.uuid(), epoch: PositiveIntSchema,
  proposalAnswer: z.strictObject({ proposalId: z.uuid(), proposalRevision: PositiveIntSchema, renderedMessageId: z.uuid(), renderedDigest: FingerprintSchema }).nullable(),
});
export type AssistantAcceptedTurn = z.infer<typeof AssistantAcceptedTurnSchema>;
export const AssistantSessionPartSchema = z.strictObject({ kind: z.literal("session"), runId: RunIdSchema, label: ReplyLabelSchema, meta: z.string().min(1).max(500) });
export const AssistantReplyPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), runs: z.array(AssistantInlineSchema).min(1).max(500) }),
  z.strictObject({ kind: z.literal("bullets"), items: z.array(z.array(AssistantInlineSchema).min(1).max(500)).min(1).max(20) }),
  AssistantSessionPartSchema,
  z.strictObject({ kind: z.literal("answered"), attribution: AssistantCommandAttributionSchema, at: IsoInstantSchema }),
]);
export type AssistantReplyPart = z.infer<typeof AssistantReplyPartSchema>;
/** Semantic UTF-16 shown text; metadata and model replay are not display units. */
export function assistantReplyDisplayUnits(parts: readonly AssistantReplyPart[]): number {
  let display = 0;
  for (const part of parts) {
    if (part.kind === "session") display += part.label.length + part.meta.length;
    if (part.kind === "text" || part.kind === "bullets") for (const run of part.kind === "text" ? part.runs : part.items.flat())
      display += run.kind === "link" ? run.label.length : run.kind === "value" ? run.value.length + (run.previous?.length ?? 0) : run.text.length;
  }
  return display;
}
export const AssistantReplyPartsSchema = z.array(AssistantReplyPartSchema).min(1).max(40).superRefine((parts, context) => {
  if (assistantReplyDisplayUnits(parts) > 8000 || new TextEncoder().encode(JSON.stringify(parts)).byteLength > 80_000) context.addIssue({ code: "custom", message: "assistant-reply-budget-exceeded" });
});
export const AssistantReplySchema = z.strictObject({ parts: AssistantReplyPartsSchema, acceptedTurn: AssistantAcceptedTurnSchema, usage: AssistantTurnUsageSchema }).refine(reply => new TextEncoder().encode(JSON.stringify(reply)).byteLength <= 80_000, "assistant-reply-budget-exceeded");
const AssistantStopDescriptorSchema = ActionDescriptorWireSchema.transform((action, context) => {
  if (action.kind === "command" && action.command === "cancel") return { ...action, command: "cancel" as const };
  context.addIssue({ code: "custom", message: "assistant-session-requires-cancel-descriptor" });
  return z.NEVER;
});
export const AssistantSessionViewSchema = AssistantSessionPartSchema.omit({ kind: true }).extend({ rowRevision: RowRevisionSchema, state: QueueStatusSchema,
  stop: z.strictObject({ runId: RunIdSchema, descriptor: AssistantStopDescriptorSchema }).nullable(),
}).refine(view => view.stop === null || !TERMINAL_QUEUE_STATUSES.has(view.state) && view.state !== "cancelling"
  && view.stop.runId === view.runId && view.stop.descriptor.kind === "command" && view.stop.descriptor.expectedVersion === view.rowRevision);
export type AssistantSessionView = z.infer<typeof AssistantSessionViewSchema>;

/** What an offered tool's dispatch can do; the registry checks it against the tool kind. */
export const AssistantToolTierSchema = z.enum(["read", "session", "write-local", "leaves-machine"]);
export type AssistantToolTier = z.infer<typeof AssistantToolTierSchema>;
/** `full-access` lets a session start a supported dry run without typed yes; live saves always ask. */
export const AssistantApprovalModeSchema = z.enum(["ask", "full-access"]);
export type AssistantApprovalMode = z.infer<typeof AssistantApprovalModeSchema>;
/** The prepared M1 send: the composer's approval pick travels with the message, never through model arguments. */
export const AssistantM1RequestSchema = AssistantRequestSchema.extend({ approvalMode: AssistantApprovalModeSchema.default("ask") });
/** One accepted turn's claim on one session start; its command is the only one the claim admits. */
export const AssistantSessionClaimSchema = z.strictObject({
  actionId: z.uuid(), acceptedTurn: AssistantAcceptedTurnSchema, approvalMode: AssistantApprovalModeSchema, dryRun: z.boolean(),
  contractFingerprint: FingerprintSchema, requestDigest: FingerprintSchema, command: StartCommandRequestSchema, claimedAt: IsoInstantSchema,
}).refine(claim => claim.command.source === "assistant" && (claim.approvalMode === "full-access" || !claim.dryRun)
  && Date.parse(claim.claimedAt) >= Date.parse(claim.acceptedTurn.acceptedAt) && Date.parse(claim.command.requestedAt) >= Date.parse(claim.acceptedTurn.acceptedAt));
export type AssistantSessionClaim = z.infer<typeof AssistantSessionClaimSchema>;
export const AssistantSessionOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("claimed") }),
  z.strictObject({ state: z.literal("started"), runIds: z.array(RunIdSchema).min(1).max(ASSISTANT_START_ROWS_MAX) }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema }),
  z.strictObject({ state: z.literal("unknown") }),
]);
export type AssistantSessionOutcome = z.infer<typeof AssistantSessionOutcomeSchema>;
/** One reviewed row's closed operation; Relay issues its command only after typed yes. */
export const AssistantM2ProposalOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-start"), workflowId: WorkflowIdSchema, submission: JsonValueSchema, reviewed: FingerprintSchema }),
  z.strictObject({ kind: z.literal("rerun"), runId: RunIdSchema, expectedVersion: PositiveIntSchema, selectedStepKeys: StartPlanRequestSchema.shape.selectedStepKeys.unwrap(), reviewed: FingerprintSchema }),
  z.strictObject({ kind: z.literal("run-action"), runId: RunIdSchema, expectedVersion: PositiveIntSchema, action: z.enum(["pause", "resume", "cancel"]) }),
]);
export const AssistantM2ProposalRowSchema = AssistantProposalRowSchema.safeExtend({ id: z.uuid(), ordinal: PositiveIntSchema, operation: AssistantM2ProposalOperationSchema });
export type AssistantM2ProposalRow = z.infer<typeof AssistantM2ProposalRowSchema>;
/** The reviewed start options every row's fresh plan must use and echo. */
export const AssistantM2ProposalOptionsSchema = StartPlanRequestSchema.pick({ browserMode: true, captureBrowserScreenshots: true })
  .extend({ priority: StartPlanWireSchema.shape.priority });
export type AssistantM2ProposalOptions = z.infer<typeof AssistantM2ProposalOptionsSchema>;
const AssistantM2ProposalShape = z.strictObject({
  id: z.uuid(), profileId: z.uuid(), conversationId: z.uuid(), revision: PositiveIntSchema, renderedMessageId: z.uuid(), renderedDigest: FingerprintSchema,
  sourceMessageId: z.uuid(), label: ReplyLabelSchema, dryRun: z.boolean(), options: AssistantM2ProposalOptionsSchema.nullable(), createdAt: IsoInstantSchema,
  rows: z.array(AssistantM2ProposalRowSchema).min(1).max(ASSISTANT_START_ROWS_MAX),
});
/** Digest of everything the operator saw, in order; yes binds to it. */
export function assistantM2ProposalDigest(snapshot: Omit<z.input<typeof AssistantM2ProposalShape>, "renderedDigest"> & { renderedDigest?: string }): string {
  const { renderedDigest: _digest, ...rendered } = snapshot;
  return sha256Hex(canonicalJsonStringify(JsonValueSchema.parse(rendered)));
}
/** The exact proposal the operator reviewed; it has no own timeout, only its conversation's retention. */
export const AssistantM2ProposalSnapshotSchema = AssistantM2ProposalShape.refine(snapshot => snapshot.rows.every((row, index) => row.ordinal === index + 1
  && row.operation.kind === snapshot.rows[0]?.operation.kind) && (snapshot.options === null) === (snapshot.rows[0]?.operation.kind === "run-action") && new Set(snapshot.rows.map(row => row.id)).size === snapshot.rows.length
  && snapshot.renderedDigest === assistantM2ProposalDigest(snapshot), "assistant-proposal-snapshot-invalid");
export type AssistantM2ProposalSnapshot = z.infer<typeof AssistantM2ProposalSnapshotSchema>;
/** A row's own result; UNKNOWN is terminal and never reclaimed. */
export const AssistantM2RowResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not-started") }),
  z.strictObject({ state: z.literal("claimed"), commandId: CommandIdSchema }),
  z.strictObject({ state: z.literal("applied"), commandId: CommandIdSchema, runIds: z.array(RunIdSchema).max(ASSISTANT_START_ROWS_MAX) }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema, commandId: CommandIdSchema.nullable() }),
  z.strictObject({ state: z.literal("unknown"), commandId: CommandIdSchema }),
]);
export type AssistantM2RowResult = z.infer<typeof AssistantM2RowResultSchema>;
export const AssistantM2ProposalStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("open") }),
  z.strictObject({ state: z.literal("answered"), answerMessageId: z.uuid() }),
  z.strictObject({ state: z.literal("superseded") }),
]);
export const AssistantM2ProposalRecordSchema = z.strictObject({ snapshot: AssistantM2ProposalSnapshotSchema, lifecycle: AssistantM2ProposalStateSchema,
  rows: z.array(z.strictObject({ rowId: z.uuid(), result: AssistantM2RowResultSchema })).min(1).max(ASSISTANT_START_ROWS_MAX) });
export type AssistantM2ProposalRecord = z.infer<typeof AssistantM2ProposalRecordSchema>;
export function assistantSessionAttribution(claim: AssistantSessionClaim): z.infer<typeof AssistantCommandAttributionSchema> {
  const { acceptedTurn: turn } = AssistantSessionClaimSchema.parse(claim);
  return AssistantCommandAttributionSchema.parse({ kind: "assistant", requestedBy: claim.command.requestedBy, profileId: turn.profileId,
    conversationId: turn.conversationId, acceptedMessageId: turn.messageId, binding: { kind: "session", actionId: claim.actionId } });
}


const AssistantUnrecordedPartsSchema = z.union([
  z.tuple([]),
  z.tuple([z.strictObject({ kind: z.literal("text"), runs: z.tuple([z.strictObject({ kind: z.literal("plain"), text: ReplyTextSchema })]) })]),
]);
export const AssistantM1MessagePayloadSchema = z.union([
  z.strictObject({ parts: AssistantUnrecordedPartsSchema, recording: z.strictObject({ kind: z.literal("unrecorded"), usage: z.strictObject({ state: z.literal("unrecorded") }) }) }),
  z.strictObject({ parts: AssistantReplyPartsSchema, recording: z.strictObject({ kind: z.literal("accepted-turn"), acceptedTurn: AssistantAcceptedTurnSchema,
    usage: z.union([z.strictObject({ state: z.literal("pending") }), AssistantTurnUsageSchema]),
  }) }),
  z.strictObject({ parts: AssistantReplyPartsSchema, recording: z.strictObject({ kind: z.literal("reply"), acceptedMessageId: z.uuid() }) }),
]).refine(payload => new TextEncoder().encode(JSON.stringify(payload)).byteLength <= 80_000, "assistant-message-payload-budget-exceeded");
export type AssistantM1MessagePayload = z.infer<typeof AssistantM1MessagePayloadSchema>;

const { text: _m1Text, ...M1MessageFields } = AssistantMessageRecordSchema.shape;
export const AssistantM1MessageRecordSchema = z.strictObject({ ...M1MessageFields, payload: AssistantM1MessagePayloadSchema }).superRefine((row, context) => {
  if ((row.kind === "inert") !== (row.modelText === null)
    || (row.kind === "turn") !== (row.role === "operator" && row.delivery !== "settled") || row.kind !== "turn" && row.delivery !== "settled"
    || (row.code !== null) !== (row.delivery === "refused") || row.subjectRef !== null && row.kind !== "turn"
    || (row.actionId !== null) !== (row.kind === "proposal" || row.kind === "decision")) context.addIssue({ code: "custom", message: "assistant-message-kind-mismatch" });
  const recording = row.payload.recording;
  if (recording.kind === "accepted-turn") {
    const turn = recording.acceptedTurn;
    if (row.kind !== "turn" || row.role !== "operator" || row.id !== turn.messageId || row.conversationId !== turn.conversationId
      || row.ordinal !== turn.ordinal || row.createdAt !== turn.acceptedAt
      || row.delivery === "sending" && recording.usage.state !== "pending"
      || (row.delivery === "answered" || row.delivery === "refused") && recording.usage.state === "pending") context.addIssue({ code: "custom", message: "assistant-accepted-turn-mismatch" });
  } else if (recording.kind === "reply" && (row.role !== "assistant" || row.kind === "turn" || row.kind === "inert")) {
    context.addIssue({ code: "custom", message: "assistant-reply-kind-mismatch" });
  }
});
export type AssistantM1MessageRecord = z.infer<typeof AssistantM1MessageRecordSchema>;
export const AssistantM1ConversationViewSchema = AssistantConversationViewSchema.extend({
  messages: z.array(AssistantStoredMessageSchema.omit({ text: true }).extend({ payload: AssistantM1MessagePayloadSchema })).max(ASSISTANT_MESSAGES_MAX),
});
export type AssistantM1ConversationView = z.infer<typeof AssistantM1ConversationViewSchema>;
export const AssistantM1SettlementSchema = z.strictObject({ delivery: AssistantDeliverySchema.extract(["answered", "refused", "delivery-unknown"]),
  code: FailureCode.optional(), usage: AssistantTurnUsageSchema,
  reply: z.strictObject({ id: z.uuid(), kind: z.enum(["answer", "proposal"]), parts: AssistantReplyPartsSchema, modelText: z.string().max(16_000), actionId: z.uuid().optional() }).optional(),
}).refine(value => (value.delivery === "refused") === (value.code !== undefined)
  && (value.reply === undefined || (value.reply.kind === "proposal") === (value.reply.actionId !== undefined)), "assistant-settlement-mismatch");
export type AssistantM1Settlement = z.infer<typeof AssistantM1SettlementSchema>;

const AssistantM1UsageSnapshotSchema = z.union([z.strictObject({ state: z.literal("pending") }), AssistantTurnUsageSchema]);
const AssistantM1DiagnosticSchema = z.union([
  z.strictObject({ code: z.literal("ASSISTANT_USAGE_LOG_UNAVAILABLE") }),
  z.strictObject({ code: z.literal("CHATGPT_RESOURCE_CLOSURE_UNPROVED") }),
]);
export const ASSISTANT_M1_READ_RETRY_FAILURES = Object.freeze(["ASSISTANT_READ_UNAVAILABLE", "ASSISTANT_CONTEXT_UNAVAILABLE", "ASSISTANT_RESPONSE_FAILED",
  "ASSISTANT_RESPONSE_INCOMPLETE", "ASSISTANT_RESPONSE_REFUSED", "ASSISTANT_USAGE_LIMIT", "CHATGPT_RATE_LIMITED", "ASSISTANT_CANCELLED"] as const);
export const AssistantM1NoReplySchema = z.strictObject({ state: z.literal("no-reply"), reason: FailureCode, canRetry: z.boolean(),
  turn: z.strictObject({ acceptedTurn: AssistantAcceptedTurnSchema, usage: AssistantTurnUsageSchema }).nullable(),
}).refine(value => !value.canRetry || value.turn !== null && value.turn.acceptedTurn.proposalAnswer === null
  && ASSISTANT_M1_READ_RETRY_FAILURES.some(reason => reason === value.reason), "retry requires a recorded effect-free read refusal");
export const AssistantM1RespondEnvelopeSchema = z.union([
  z.strictObject({ kind: z.literal("result"), result: z.union([
    z.strictObject({ state: z.literal("answered"), reply: AssistantReplySchema }), AssistantM1NoReplySchema,
  ]), receipt: AssistantReceiptSchema.optional(), diagnostic: AssistantM1DiagnosticSchema.optional() }),
  z.strictObject({ kind: z.literal("delivery"), receipt: AssistantReceiptSchema, acceptedTurn: AssistantAcceptedTurnSchema,
    usage: AssistantM1UsageSnapshotSchema, history: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("observed") }), z.strictObject({ state: z.literal("unavailable"), code: FailureCode }),
    ]), diagnostic: AssistantM1DiagnosticSchema.optional() }),
]).superRefine((envelope, context) => {
  const accepted = envelope.kind === "delivery" ? envelope.acceptedTurn : envelope.result.state === "answered" ? envelope.result.reply.acceptedTurn : envelope.result.turn?.acceptedTurn;
  const receipt = envelope.receipt;
  if (accepted === undefined ? receipt !== undefined : receipt === undefined || receipt.conversationId !== accepted.conversationId
    || receipt.messageId !== accepted.messageId || receipt.ordinal !== accepted.ordinal || receipt.revision < accepted.acceptedRevision) {
    context.addIssue({ code: "custom", message: "assistant-receipt-identity-mismatch" });
  }
  if (envelope.kind === "result") {
    if (envelope.result.state === "answered" && receipt?.delivery !== "answered"
      || envelope.result.state === "no-reply" && envelope.result.turn !== null && receipt?.delivery !== "refused"
      || envelope.diagnostic !== undefined && envelope.result.state === "no-reply" && envelope.result.canRetry) context.addIssue({ code: "custom", message: "assistant-result-delivery-mismatch" });
  } else if (envelope.history.state === "unavailable" && envelope.receipt.delivery !== "delivery-unknown"
    || envelope.history.state === "observed" && (envelope.receipt.delivery === "sending" && envelope.usage.state !== "pending"
      || (envelope.receipt.delivery === "answered" || envelope.receipt.delivery === "refused") && envelope.usage.state === "pending")) {
    context.addIssue({ code: "custom", message: "assistant-usage-delivery-mismatch" });
  }
});
export type AssistantM1RespondEnvelope = z.infer<typeof AssistantM1RespondEnvelopeSchema>;
