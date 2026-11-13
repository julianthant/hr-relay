import { AssistantTurnUsageSchema } from "../dashboard/assistant-usage.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { RunCheckpointRecord } from "../workflow/checkpoint.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { FingerprintSchema, IsoInstantSchema, ItemIdSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema,
  WorkerIdSchema, WorkflowIdSchema, WriteIntentIdSchema, TraceIdSchema, WriteAttemptIdSchema, FailureIdSchema, CommandIdSchema, ActorIdSchema, GateIdSchema } from "../../rules/identity/ids.js";
import { LedgerEntryPayloadSchema } from "../../rules/runs/ledger.js";
import { NoteWireSchema, SpanEventWireSchema } from "./types.js";
import { RecoveryActivitySchema } from "../run/recovery-activity.js";

/** A reference preserves the original observation; replay never rewrites its clock. */
export const TimelineCheckpointReferenceSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  nodeId: NodeIdSchema,
  attempt: PositiveIntSchema,
  claimGeneration: PositiveIntSchema,
  runId: RunIdSchema,
  outputDigest: FingerprintSchema,
  writtenAt: IsoInstantSchema,
});

// Resolve the proof from its exact immutable attempt.
const { proof: _proof, ...ledgerFields } = LedgerEntryPayloadSchema.shape;
const ConfirmedOperationFactsSchema = z.strictObject(ledgerFields);

const ChatGptContentTypeSchema = z.enum(["text/event-stream", "application/json", "text/plain", "text/html", "missing", "other"]);
export const ChatGptStreamEventTypeSchema = z.enum(["unknown", "error", "response.created", "response.in_progress", "response.queued",
  "response.completed", "response.failed", "response.incomplete", "response.output_item.added", "response.output_item.done",
  "response.content_part.added", "response.content_part.done", "response.output_text.delta", "response.output_text.done",
  "response.refusal.delta", "response.refusal.done", "response.function_call_arguments.delta", "response.function_call_arguments.done",
  "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done",
  "response.reasoning_text.delta", "response.reasoning_text.done", "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done",
  "response.output_text.annotation.added", "response.file_search_call.in_progress", "response.file_search_call.searching", "response.file_search_call.completed",
  "response.web_search_call.in_progress", "response.web_search_call.searching", "response.web_search_call.completed", "response.image_generation_call.completed",
  "response.image_generation_call.generating", "response.image_generation_call.in_progress", "response.image_generation_call.partial_image",
  "response.mcp_call_arguments.delta", "response.mcp_call_arguments.done", "response.mcp_call.completed", "response.mcp_call.failed", "response.mcp_call.in_progress",
  "response.mcp_list_tools.completed", "response.mcp_list_tools.failed", "response.mcp_list_tools.in_progress", "response.code_interpreter_call.in_progress",
  "response.code_interpreter_call.interpreting", "response.code_interpreter_call.completed", "response.code_interpreter_call_code.delta", "response.code_interpreter_call_code.done",
  "response.audio.delta", "response.audio.done", "response.audio.transcript.delta", "response.audio.transcript.done", "response.compaction.compacting",
  "response.shell_call_command.added", "response.shell_call_command.delta", "response.shell_call_command.done", "response.shell_call_output_content.delta", "response.shell_call_output_content.done"]);
export const ChatGptShapeKeySchema = z.enum(["*", "[]", "type", "sequence_number", "response", "id", "object", "status", "model", "output",
  "error", "code", "message", "incomplete_details", "reason", "created_at", "completed_at", "content", "role", "text", "annotations", "logprobs",
  "summary", "encrypted_content", "call_id", "name", "namespace", "arguments", "caller", "usage", "input_tokens", "output_tokens", "total_tokens",
  "input_tokens_details", "output_tokens_details", "reasoning_tokens", "cached_tokens", "cache_write_tokens", "instructions", "metadata", "tools",
  "tool_choice", "parallel_tool_calls", "previous_response_id", "store", "temperature", "top_p", "truncation", "reasoning", "effort", "format",
  "verbosity", "max_output_tokens", "max_tool_calls", "user", "service_tier", "background", "conversation", "access_programs", "cyber"]);
const ChatGptShapePathSchema = z.array(ChatGptShapeKeySchema).max(8);
export const ChatGptInferenceDiagnosticSchema = z.strictObject({
  operation: z.enum(["ocr", "assistant", "account"]),
  path: z.enum(["transport", "http-error-body", "http-error", "content-type", "stream-read", "stream-decode", "stream-json", "stream-schema",
    "stream-error", "stream-refusal", "response-failed", "response-incomplete", "stream-delta", "stream-done", "terminal-schema", "output-schema", "stream-incomplete", "usage-persistence", "resource-closure",
    "auth-account", "auth-refresh", "auth-refresh-rotation", "auth-refresh-subject", "auth-token-http", "auth-token-body", "auth-token-schema", "auth-discovery", "auth-jwks", "auth-id-token-header", "auth-id-token-signature", "auth-id-token-claims", "auth-id-token-audience", "auth-id-token-time", "auth-id-token-nonce",
    "catalog-request", "catalog-body", "catalog-schema"]),
  jsonFailure: z.enum(["missing-body", "read", "too-large", "decode", "parse"]).optional(),
  contentType: ChatGptContentTypeSchema,
  hasBody: z.boolean().optional(),
  transport: z.strictObject({ source: z.enum(["native", "injected"]), status: z.number().int().min(100).max(599),
    contentType: ChatGptContentTypeSchema, hasBody: z.boolean(), redirected: z.boolean(), target: z.enum(["expected", "other", "missing"]) }).optional(),
  events: z.strictObject({ types: z.array(ChatGptStreamEventTypeSchema).max(256), truncated: z.boolean() }).optional(),
  terminalShape: z.strictObject({ fields: z.array(z.strictObject({ path: ChatGptShapePathSchema,
    type: z.enum(["object", "array", "null", "string", "number", "boolean"]) })).max(128), truncated: z.boolean() }).optional(),
  terminalIssues: z.strictObject({ issues: z.array(z.strictObject({ path: ChatGptShapePathSchema,
    code: z.enum(["invalid_type", "too_big", "too_small", "invalid_format", "invalid_value", "custom", "invalid_union", "invalid_key", "invalid_element", "not_multiple_of", "unrecognized_keys"]) })).max(16),
    truncated: z.boolean() }).optional(),
  providerCode: z.enum(["none", "unknown", "subscription_sharing_user_not_eligible", "subscription_sharing_usage_limit_exceeded",
    "subscription_sharing_usage_unavailable", "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported",
    "subscription_sharing_invalid_user", "subscription_sharing_user_unavailable", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context",
    "model_not_found", "invalid_request_error", "unsupported_value", "unsupported_parameter", "missing_required_parameter", "invalid_value", "invalid_type",
    "rate_limit_exceeded", "insufficient_quota", "server_error", "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated", "invalid_client"]),
});
export type ChatGptInferenceDiagnostic = z.infer<typeof ChatGptInferenceDiagnosticSchema>;

export const DebugEventSchema = z.strictObject({
  category: z.enum(["session", "duo", "worker", "http", "sse", "client", "boot"]),
  phase: z.enum(["started", "settled", "failed", "reset", "acquired", "renewed", "released", "expired"]),
  correlationId: z.string().min(1).max(128),
  code: z.string().max(128).optional(),
  area: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/u).optional(),
  reason: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/u).optional(),
  message: z.string().max(65536).optional(),
  stack: z.string().max(65536).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  route: z.string().max(512).optional(),
  status: z.number().int().min(100).max(599).optional(),
  chatGptInference: ChatGptInferenceDiagnosticSchema.optional(),
  assistantUsage: AssistantTurnUsageSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  cursor: z.string().max(256).optional(),
  pending: z.number().int().nonnegative().optional(),
  omitted: z.number().int().nonnegative().optional(),
  release: z.string().min(1).max(128).optional(),
  surface: z.string().min(1).max(128).optional(),
  build: z.string().min(1).max(128),
  pid: PositiveIntSchema,
  pinned: z.boolean().default(false),
});
export type DebugEvent = z.infer<typeof DebugEventSchema>;

export function debugEventLevel(event: Pick<DebugEvent, "phase" | "reason" | "status"> & Partial<Pick<DebugEvent, "code">>): "error" | "warn" | "info" {
  // A request the page closed, or a ChatGPT call it cancelled, is a cancellation, not a failure.
  if (event.code === "CHATGPT_OCR_CANCELLED" || event.reason === "request-disconnected") return "info";
  if (event.reason === "outcome-unknown" || event.status !== undefined && event.status >= 500) return "error";
  if (event.reason === "operation-refused" || event.reason === "remote-revocation-unconfirmed"
    || event.phase === "expired" || event.phase === "reset" || event.status !== undefined && event.status >= 400) return "warn";
  return event.phase === "failed" ? "error" : "info";
}

export const TimelinePayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workbook-reference-row-selected"), runId: RunIdSchema, workflow: WorkflowIdSchema,
    attempt: PositiveIntSchema, traceId: TraceIdSchema, gateId: GateIdSchema, commandId: CommandIdSchema,
    referenceDigest: FingerprintSchema, checkpointDigest: FingerprintSchema, key: z.string().min(1),
    sheetId: z.string().min(1), rowId: z.string().min(1), at: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("workbook-write-recorded"), runId: RunIdSchema, workflow: WorkflowIdSchema,
    attempt: PositiveIntSchema, traceId: TraceIdSchema, claimGeneration: PositiveIntSchema, libraryId: z.string().min(1),
    operationId: z.string().min(1), receiptDigest: FingerprintSchema, at: IsoInstantSchema, resolvedBy: CommandIdSchema.optional() }),
  RecoveryActivitySchema.extend({ kind: z.literal("recovery-activity-started") }),
  RecoveryActivitySchema.extend({ kind: z.literal("recovery-activity-ended"), endedAt: IsoInstantSchema }),
  z.strictObject({
    kind: z.literal("write-parked"), runId: RunIdSchema, workflow: WorkflowIdSchema,
    attempt: PositiveIntSchema, traceId: TraceIdSchema, nodeId: NodeIdSchema,
    writeIntentId: WriteIntentIdSchema, generation: PositiveIntSchema,
  }),
  z.strictObject({
    kind: z.literal("failure-resolution"), runId: RunIdSchema, workflow: WorkflowIdSchema,
    failureId: FailureIdSchema, commandId: CommandIdSchema, actorId: ActorIdSchema,
    action: z.enum(["resolve", "reopen"]), annotationVersion: PositiveIntSchema.min(2),
    at: IsoInstantSchema,
  }),
  z.strictObject({ kind: z.literal("debug"), event: DebugEventSchema }),
  z.strictObject({ kind: z.literal("span"), event: SpanEventWireSchema }),
  z.strictObject({ kind: z.literal("note"), note: NoteWireSchema }),
  z.strictObject({
    kind: z.enum(["checkpoint-replayed", "checkpoint-recorded"]),
    runId: RunIdSchema,
    workflow: WorkflowIdSchema,
    attempt: PositiveIntSchema,
    claimGeneration: PositiveIntSchema,
    checkpoint: TimelineCheckpointReferenceSchema,
  }),
  z.strictObject({
    kind: z.literal("operation-confirmed"),
    facts: ConfirmedOperationFactsSchema,
    writeAttemptId: WriteAttemptIdSchema,
    proofDigest: FingerprintSchema,
    checkpoint: TimelineCheckpointReferenceSchema,
    /** Original committed-span time, which is not necessarily its delivery time. */
    spanOccurredAt: IsoInstantSchema,
  }),
]);

export const TimelineAppendSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  workflow: WorkflowIdSchema.optional(),
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("run"), runId: RunIdSchema }),
    z.strictObject({ kind: z.literal("worker"), workerId: WorkerIdSchema }),
    z.strictObject({ kind: z.literal("transport"), connectionId: z.string().min(1).max(128) }),
    z.strictObject({ kind: z.literal("client"), clientId: z.string().min(1).max(128) }),
  ]),
  occurredAt: IsoInstantSchema,
  recordedAt: IsoInstantSchema,
  /** Local append day. */
  retentionDate: z.iso.date(),
  payload: TimelinePayloadSchema,
  source: z.strictObject({ kind: z.literal("native") }),
}).superRefine((record, context) => {
  const payload = record.payload;
  if (payload.kind === "debug") return;
  if (payload.kind === "workbook-reference-row-selected" && (record.occurredAt !== payload.at || record.recordedAt !== payload.at)) {
    context.addIssue({ code: "custom", message: "reference row choices must retain their exact recorded time" });
  }
  if (payload.kind === "recovery-activity-started" || payload.kind === "recovery-activity-ended") {
    const at = payload.kind === "recovery-activity-started" ? payload.openedAt : payload.endedAt;
    if (record.occurredAt !== at || record.recordedAt !== at || Date.parse(at) < Date.parse(payload.openedAt)
      || (payload.kind === "recovery-activity-started" && record.eventId !== payload.activityId)) {
      context.addIssue({ code: "custom", message: "recovery activity must bind its actual operation time and identity" });
    }
  }
  const runId = payload.kind === "note" ? ("runId" in payload.note ? payload.note.runId : undefined) : payload.kind === "span"
    ? ("runId" in payload.event ? payload.event.runId : undefined)
    : payload.kind === "operation-confirmed" ? payload.facts.runId : payload.runId;
  const workflow = payload.kind === "note" ? payload.note.workflow : payload.kind === "span" ? payload.event.workflow
    : payload.kind === "operation-confirmed" ? payload.facts.workflowId : payload.workflow;
  if (record.workflow !== workflow
    || (runId === undefined ? record.scope.kind !== "worker"
      : record.scope.kind !== "run" || record.scope.runId !== runId)) {
    context.addIssue({ code: "custom", message: "timeline scope must match its exact event identity" });
  }
  if (payload.kind === "failure-resolution" && (record.occurredAt !== payload.at
    || record.recordedAt !== payload.at || record.source.kind !== "native")) {
    context.addIssue({ code: "custom", message: "failure resolution must bind its command time and native source" });
  }
  if (payload.kind === "note" && (record.occurredAt !== payload.note.ts
    || (record.scope.kind === "worker" && (!("workerId" in payload.note) || record.scope.workerId !== payload.note.workerId)))) {
    context.addIssue({ code: "custom", message: "timeline note identity mismatch" });
  }
  if (payload.kind === "span") {
    if (record.occurredAt !== payload.event.ts || (record.scope.kind === "worker"
      && (!("workerId" in payload.event) || record.scope.workerId !== payload.event.workerId))) {
      context.addIssue({ code: "custom", message: "timeline time/worker must match its span" });
    }
  }
  if (payload.kind === "checkpoint-recorded" && (payload.checkpoint.runId !== payload.runId
    || payload.checkpoint.workflowId !== payload.workflow || payload.checkpoint.attempt !== payload.attempt
    || payload.checkpoint.claimGeneration !== payload.claimGeneration || record.occurredAt !== payload.checkpoint.writtenAt)) {
    context.addIssue({ code: "custom", message: "recorded checkpoint must bind its original execution and time" });
  }
  if (payload.kind === "checkpoint-replayed" && (payload.checkpoint.workflowId !== payload.workflow
    || payload.checkpoint.attempt > payload.attempt)) {
    context.addIssue({ code: "custom", message: "checkpoint replay must reference the same workflow and a prior or current attempt" });
  }
  if (payload.kind === "operation-confirmed") {
    if (record.occurredAt !== payload.facts.confirmedAt
      || payload.checkpoint.runId !== payload.facts.runId
      || payload.checkpoint.workflowId !== payload.facts.workflowId
      || payload.checkpoint.itemId !== payload.facts.itemId
      || payload.checkpoint.attempt !== payload.facts.attempt) {
      context.addIssue({ code: "custom", message: "confirmed history must bind its exact checkpoint and confirmation" });
    }
  }
});

/** The database assigns delivery order. It is not a cross-process causal clock. */
export const TimelineEventRecordSchema = TimelineAppendSchema.safeExtend({ cursor: PositiveIntSchema });
export type TimelineAppend = z.infer<typeof TimelineAppendSchema>;
export type TimelineEventRecord = z.infer<typeof TimelineEventRecordSchema>;

export function timelineAppendContent(record: TimelineEventRecord): string {
  const { cursor: _cursor, ...content } = record;
  return canonicalJsonStringify(content);
}

export const TimelinePageRequestSchema = z.strictObject({
  after: z.number().int().nonnegative().default(0),
  through: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
  runId: RunIdSchema.optional(),
  workflow: WorkflowIdSchema.optional(),
});

export interface TimelineRepository {
  withReadSnapshot<T>(read: () => T): T;
  append(input: unknown): Readonly<{ state: "inserted" | "existing"; record: TimelineEventRecord }>;
  get(eventId: string): TimelineEventRecord | undefined;
  page(input: z.input<typeof TimelinePageRequestSchema>): readonly TimelineEventRecord[];
  highWaterMark(): number;
  confirmedActionHeads(input: Readonly<{ workerStreamIds: readonly string[]; before: number }>): readonly TimelineEventRecord[];
  /** The newest `run.claimed` span naming this worker. */
  lastWorkerClaim(workerId: string): TimelineEventRecord | undefined;
  pruneBefore(retentionDate: string): number;
}

export function timelineCheckpointReference(checkpoint: RunCheckpointRecord) {
  return { workflowId: checkpoint.workflowId, itemId: checkpoint.itemId, nodeId: checkpoint.nodeId,
    attempt: checkpoint.attempt, claimGeneration: checkpoint.claimGeneration,
    runId: checkpoint.runId, outputDigest: sha256Hex(canonicalJsonStringify(checkpoint.output)), writtenAt: checkpoint.writtenAt };
}

