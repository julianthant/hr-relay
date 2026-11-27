import { AssistantAppliedEditRowSchema } from "./assistant-applied-edits.js";
import { ASSISTANT_START_ROWS_MAX, AssistantAttachmentRecordSchema, AssistantConversationRecordSchema, AssistantM1MessageRecordSchema, AssistantProposalSnapshotSchema,
  AssistantProposalStateSchema, AssistantRowResultSchema, AssistantMessageRecordSchema, AssistantModelPreferenceRecordSchema,
  AssistantSessionClaimSchema, AssistantSessionOutcomeSchema } from "../../../models/dashboard/assistant.js";
import { AssistantChatRecordSchema, AssistantActionRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { EditableWorkbookWireSchema, SavedWorkbookSchema, WorkbookTypeSchema, WorkbookOperationSchema } from "../../../models/dashboard/workbooks.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { NativeCommandRequestSchema, NativeCommandAuditSchema } from "./command-record-row.js";
import { WorkerSlotRecordSchema } from "../../../models/run/worker-slot.js";
import { RunSearchIndexRecordSchema } from "../../../models/dashboard/search-index.js";
import { NotificationHealthSchema } from "./notification-publications.js";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { GeneratedArtifactSchema, ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../../models/artifacts/generated-artifact.js";
import { ImportedArtifactSchema } from "../../../models/intake/imported-artifact.js";
import { ExclusiveSessionLeaseSchema } from "../../../models/sessions/exclusive-session-lease.js";
import { z } from "zod";
import { OcrReviewRevisionSchema, OcrApprovedSnapshotSchema, OcrSourceUploadSchema } from "../../../models/ocr/review.js";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { RunSessionRecordSchema } from "../../../models/run/session.js";
import { DeletedRunRecordSchema } from "../../../models/run/deleted-run.js";
import { WorkerPoolRecordSchema } from "../../../models/run/worker-pool.js";
import { AuthorityUpgradeRecordSchema, type AuthorityTableName } from "../../../models/config/authority.js";
import { StoredOcrExtractionSchema } from "../../../models/ocr/stored-extraction.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { CommandIdSchema, DiagnosticBundleIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../../rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import { RunRecordSchema } from "../../../models/run/record.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { StartPlanRecordSchema } from "../../../models/run/start-plan.js";
import { WorkflowWorkbookSelectionRecordSchema, WorkbookLibraryStateSchema, WorkbookLibraryActionRecordSchema, WorkbookLibrarySnapshotSchema } from "../../../models/dashboard/workbook-library.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "../../../models/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../../models/trust/evidence.js";
import { DryRunScenarioResultSchema } from "../../../models/trust/dry-run-scenario-result.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";

export { ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema, ArtifactOutboxAckRequestSchema, ArtifactSinkHeadRecordRequestSchema } from "../../../models/artifacts/generated-artifact.js";

export const DiagnosticAttachmentStorageRecordSchema = z.strictObject({
  bundleId: DiagnosticBundleIdSchema,
  attachment: DiagnosticAttachmentSchema,
  createdAt: IsoInstantSchema,
});

function storedJson<T extends z.ZodType>(schema: T) {
  return z.string().transform((text, context) => {
    try { const payload: unknown = JSON.parse(text); return payload; }
    catch { context.addIssue({ code: "custom", message: "assistant-storage-json-invalid" }); return z.NEVER; }
  }).pipe(schema);
}

const AssistantProposalStorageRowSchema = z.strictObject({
  id: z.uuid(), conversation_id: z.uuid(), revision: PositiveIntSchema, rendered_message_id: z.uuid(), rendered_digest: FingerprintSchema,
  state: z.string(), answer_message_id: z.uuid().nullable(), snapshot_json: storedJson(AssistantProposalSnapshotSchema), created_at: IsoInstantSchema,
}).refine(row => {
  const snapshot = row.snapshot_json;
  return row.id === snapshot.id && row.conversation_id === snapshot.conversationId && row.revision === snapshot.revision
    && row.rendered_message_id === snapshot.renderedMessageId && row.rendered_digest === snapshot.renderedDigest && row.created_at === snapshot.createdAt
    && AssistantProposalStateSchema.safeParse(row.answer_message_id === null ? { state: row.state } : { state: row.state, answerMessageId: row.answer_message_id }).success;
}, "assistant-proposal-storage-row-mismatch");

const AssistantProposalResultStorageRowSchema = z.strictObject({
  id: z.uuid(), proposal_id: z.uuid(), ordinal: PositiveIntSchema.max(ASSISTANT_START_ROWS_MAX), command_id: CommandIdSchema.nullable(),
  state: z.string(), result_json: storedJson(AssistantRowResultSchema),
}).refine(row => row.state === row.result_json.state && row.command_id === ("commandId" in row.result_json ? row.result_json.commandId : null),
  "assistant-proposal-result-storage-row-mismatch");

const AssistantSessionClaimStorageRowSchema = z.strictObject({
  action_id: z.uuid(), conversation_id: z.uuid(), accepted_message_id: z.uuid(), request_digest: FingerprintSchema,
  command_id: CommandIdSchema, state: z.string(), claim_json: storedJson(AssistantSessionClaimSchema), outcome_json: storedJson(AssistantSessionOutcomeSchema),
}).refine(row => {
  const claim = row.claim_json;
  return row.action_id === claim.actionId && row.conversation_id === claim.acceptedTurn.conversationId && row.accepted_message_id === claim.acceptedTurn.messageId
    && row.request_digest === claim.requestDigest && row.command_id === claim.command.commandId && row.state === row.outcome_json.state;
}, "assistant-session-claim-storage-row-mismatch");

export const AUTHORITY_RECORD_SCHEMA_REGISTRY = Object.freeze({
  assistant_model_preference: AssistantModelPreferenceRecordSchema,
  database_upgrades: AuthorityUpgradeRecordSchema,
  settings_snapshots: ConfigSnapshotRecordSchema,
  commands: NativeCommandRequestSchema,
  command_audits: NativeCommandAuditSchema,
  settings: AppSettingsSchema,
  assistant_chats: AssistantChatRecordSchema,
  assistant_actions: AssistantActionRecordSchema,
  assistant_conversations: AssistantConversationRecordSchema,
  assistant_messages: z.union([AssistantMessageRecordSchema, AssistantM1MessageRecordSchema]),
  assistant_attachments: AssistantAttachmentRecordSchema,
  assistant_proposals: AssistantProposalStorageRowSchema,
  assistant_proposal_rows: AssistantProposalResultStorageRowSchema,
  assistant_session_claims: AssistantSessionClaimStorageRowSchema,
  assistant_applied_edits: AssistantAppliedEditRowSchema,
  run_batches: RunSessionRecordSchema,
  deleted_runs: DeletedRunRecordSchema,
  runs: RunRecordSchema,
  run_requests: StartPlanRecordSchema,
  run_delegations: DelegationManifestSchema,
  delegation_dependencies: DependencyRecordSchema,
  run_checkpoints: RunCheckpointRecordSchema,
  gate_results: GateResultRecordSchema,
  run_results: RunResultRecordSchema,
  run_failures: FailureRecordSchema,
  run_receipts: RunEvidenceReceiptSchema,
  write_intents: WriteIntentRecordSchema,
  write_attempts: WriteAttemptRecordSchema,
  worker_pools: WorkerPoolRecordSchema,
  worker_slots: WorkerSlotRecordSchema,
  auth_leases: DuoCeremonyLeaseRecordSchema,
  exclusive_session_leases: ExclusiveSessionLeaseSchema,
  ocr_review_revisions: OcrReviewRevisionSchema,
  ocr_source_uploads: OcrSourceUploadSchema,
  ocr_approved_snapshots: OcrApprovedSnapshotSchema,
  notifications: NotificationRecordSchema,
  notification_states: NotificationHealthSchema,
  artifacts: z.union([ImportedArtifactSchema, StoredOcrExtractionSchema, GeneratedArtifactSchema]),
  timeline_events: TimelineEventRecordSchema,
  diagnostic_snapshots: DiagnosticBundleSchema,
  diagnostic_files: DiagnosticAttachmentStorageRecordSchema,
  dryrun_results: DryRunScenarioResultSchema,
  run_search: RunSearchIndexRecordSchema,
  workflow_workbook_selections: WorkflowWorkbookSelectionRecordSchema,
  workbook_creations: SavedWorkbookSchema,
  workbook_types: WorkbookTypeSchema,
  workbook_operations: WorkbookOperationSchema,
  workbook_library: SavedWorkbookSchema,
  workbook_library_history: SavedWorkbookSchema,
  workbook_library_state: WorkbookLibraryStateSchema,
  workbook_library_actions: WorkbookLibraryActionRecordSchema,
  workbook_library_snapshots: WorkbookLibrarySnapshotSchema,
  workbook_payloads: EditableWorkbookWireSchema,
  debug_events: TimelineEventRecordSchema,
} satisfies Record<Exclude<AuthorityTableName, "database_states">, z.ZodType>);

export type DiagnosticAttachmentStorageRecord = z.infer<typeof DiagnosticAttachmentStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ArtifactSinkHeadRecord = z.infer<typeof ArtifactSinkHeadRecordSchema>;
