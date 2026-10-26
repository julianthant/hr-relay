import { AssistantModelPreferenceRecordSchema } from "../../../models/dashboard/assistant.js";
import { AssistantGrantRecordSchema, AssistantChatRecordSchema, AssistantActionRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { SavedWorkbookSchema } from "../../../models/dashboard/workbooks.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { NativeCommandRequestSchema, NativeCommandAuditSchema } from "./command-record-row.js";
import { WorkerSlotRecordSchema } from "../../../models/run/worker-slot.js";
import { RunSearchIndexRecordSchema } from "../../../models/dashboard/search-index.js";
import { WorkerControlRecordSchema, WorkerBrowserObservationSchema } from "../../../models/run/worker-control.js";
import { NotificationHealthSchema } from "./notification-publications.js";
import { ExplorerWorkflowOverrideSchema } from "../../../models/dashboard/explorer.js";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { GeneratedArtifactSchema, ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../../models/artifacts/generated-artifact.js";
import { ImportedArtifactSchema } from "../../../models/intake/imported-artifact.js";
import { z } from "zod";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { RunSessionRecordSchema } from "../../../models/run/session.js";
import { DeletedRunRecordSchema } from "../../../models/run/deleted-run.js";
import { WorkerPoolRecordSchema } from "../../../models/run/worker-pool.js";
import { AuthorityUpgradeRecordSchema, type AuthorityTableName } from "../../../models/config/authority.js";
import { AdmittedExtractionSchema } from "../../../models/ocr/extraction.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { DiagnosticBundleIdSchema, IsoInstantSchema } from "../../../rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import { RunRecordSchema } from "../../../models/run/record.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { StartPlanRecordSchema } from "../../../models/run/start-plan.js";
import { WorkerLeaseRecordSchema } from "../../../models/run/worker.js";
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

export const AUTHORITY_RECORD_SCHEMA_REGISTRY = Object.freeze({
  assistant_model_preference: AssistantModelPreferenceRecordSchema,
  database_upgrades: AuthorityUpgradeRecordSchema,
  settings_snapshots: ConfigSnapshotRecordSchema,
  commands: NativeCommandRequestSchema,
  command_audits: NativeCommandAuditSchema,
  settings: AppSettingsSchema,
  assistant_grants: AssistantGrantRecordSchema,
  assistant_chats: AssistantChatRecordSchema,
  assistant_actions: AssistantActionRecordSchema,
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
  worker_leases: WorkerLeaseRecordSchema,
  worker_controls: WorkerControlRecordSchema,
  browser_sessions: WorkerBrowserObservationSchema,
  auth_leases: DuoCeremonyLeaseRecordSchema,
  notifications: NotificationRecordSchema,
  notification_states: NotificationHealthSchema,
  explorer_overrides: ExplorerWorkflowOverrideSchema,
  artifacts: z.union([ImportedArtifactSchema, AdmittedExtractionSchema, GeneratedArtifactSchema]),
  timeline_events: TimelineEventRecordSchema,
  diagnostic_snapshots: DiagnosticBundleSchema,
  diagnostic_files: DiagnosticAttachmentStorageRecordSchema,
  dryrun_results: DryRunScenarioResultSchema,
  run_search: RunSearchIndexRecordSchema,
  workbook_library: SavedWorkbookSchema,
  workbook_library_history: SavedWorkbookSchema,
} satisfies Record<Exclude<AuthorityTableName, "database_states">, z.ZodType>);

export type DiagnosticAttachmentStorageRecord = z.infer<typeof DiagnosticAttachmentStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ArtifactSinkHeadRecord = z.infer<typeof ArtifactSinkHeadRecordSchema>;
