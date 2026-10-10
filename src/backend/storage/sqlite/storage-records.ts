import { HistoricalProviderKeysCommandSchema, HistoricalProviderKeysAuditSchema } from "../../../rules/commands/commands-history.js";
import { TransactionSelectionRecordSchema } from "../../../rules/write-safety/transaction-selection.js";
import { RuntimeVersionAdoptionSchema, RuntimeVersionAuthoritySchema } from "./runtime-versions.js";
import { RuntimeVersionChangeSchema } from "../../../models/archive/runtime-version-change.js";
import { RunSearchIndexRecordSchema, RunSearchPublicationSchema, RunSearchDeclarationSchema, RunSearchGramSchema, RunSearchActorLinkSchema } from "../../../models/dashboard/search-index.js";
import { WorkerControlRecordSchema, WorkerBrowserObservationSchema } from "../../../models/run/worker-control.js";
import { NotificationPublicationSchema, NotificationHealthSchema } from "./notification-publications.js";
import { ExplorerWorkflowOverrideSchema } from "../../../models/dashboard/explorer.js";
import { parsePendingCapture } from "../../../models/archive/pending-capture.js";
import { VersionChangeStorageSchema } from "../../../models/archive/change-record.js";
import { ArchiveTransferIdentitySchema } from "./run-evidence-ownership.js";
import { RunSummarySchema, SummaryPublicationSchema } from "../../../models/run/summary.js";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { GeneratedArtifactSchema, ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../../models/artifacts/generated-artifact.js";
import { ImportedArtifactSchema } from "../../../models/intake/imported-artifact.js";
import { HistoricalOperationSourceSchema, TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { HistoricalNotificationSnoozeAuditSchema, HistoricalNotificationSnoozeCommandSchema, HistoricalProtectedSettingsAuditSchema, HistoricalProtectedSettingsCommandSchema, PreFloorCommandSchema, PreFloorCommandAuditSchema } from "../../../rules/commands/commands-history.js";
import { z } from "zod";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { RunSessionRecordSchema } from "../../../models/run/session.js";
import { DeletedRunRecordSchema } from "../../../models/run/deleted-run.js";
import { WorkerPoolRecordSchema } from "../../../models/run/worker-pool.js";
import { AuthorityUpgradeRecordSchema, type AuthorityTableName } from "../../../models/config/authority.js";
import { AdmittedExtractionSchema } from "../../../models/ocr/extraction.js";
import { AuthorityCommandAuditRecordSchema, AuthorityCommandRecordSchema, BulkParentCommandRecordSchema } from "../../../rules/commands/commands.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { DiagnosticBundleIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, VersionPlanIdSchema } from "../../../rules/identity/ids.js";


import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";


import { RunRecordSchema } from "../../../models/run/record.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { StartPlanRecordSchema } from "../../../models/run/start-plan.js";
import { WorkerLeaseRecordSchema } from "../../../models/run/worker.js";
import { SchemaBoundCanonicalValueSchema } from "../../../models/validation/schema-bound-value.js";
import { ArchivedRunRecordSchema, ArchiveRelaunchRecordSchema, VersionBumpApplicationSchema, VersionBumpPlanSchema, versionBumpPlanFingerprint } from "../../../models/archive/model.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "../../../models/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../../models/trust/evidence.js";
import { DryRunScenarioResultSchema } from "../../../models/trust/dry-run-scenario-result.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";

export const SqliteStorageRecordIdSchema = z.string().uuid().brand<"SqliteStorageRecordId">();

export const OpaqueAuthorityRecordSchema = z.strictObject({
  recordId: SqliteStorageRecordIdSchema,
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
});


export const VersionPlanStorageRecordSchema = z.strictObject({
  versionPlanId: VersionPlanIdSchema,
  version: PositiveIntSchema,
  planFingerprint: FingerprintSchema,
  state: z.enum(["planned", "applied"]),
  plan: VersionBumpPlanSchema,
  createdAt: IsoInstantSchema,
  appliedAt: IsoInstantSchema.optional(),
}).superRefine((record, context) => {
  if ((record.state === "applied") !== (record.appliedAt !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["appliedAt"],
      message: "a version plan carries an applied instant exactly when it is applied",
    });
  }
  if (record.plan.versionPlanId !== record.versionPlanId) {
    context.addIssue({ code: "custom", path: ["plan"], message: "a version plan row and its plan must share one id" });
  }
  if (record.planFingerprint !== versionBumpPlanFingerprint(record.plan)) {
    context.addIssue({
      code: "custom",
      path: ["planFingerprint"],
      message: "a version plan's fingerprint must be the digest of the plan it stores",
    });
  }
});


export const VersionBumpApplicationStorageRecordSchema = VersionBumpApplicationSchema;


export const ArchivedRunStorageRecordSchema = ArchivedRunRecordSchema;


export const ArchiveRelaunchStorageRecordSchema = ArchiveRelaunchRecordSchema;

/** The CAS `apply-version-bump` presents to move a plan `planned → applied`. */
export const VersionPlanConsumeRequestSchema = z.strictObject({
  versionPlanId: VersionPlanIdSchema,
  expectedVersion: PositiveIntSchema,
  planFingerprint: FingerprintSchema,
  now: IsoInstantSchema,
});
export type VersionPlanConsumeRequest = z.infer<typeof VersionPlanConsumeRequestSchema>;

export const VersionPlanConsumeOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("consumed"), plan: VersionPlanStorageRecordSchema }),
  z.strictObject({ state: z.literal("already-consumed"), plan: VersionPlanStorageRecordSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: z.enum(["not-found", "version-mismatch", "fingerprint-mismatch"]),
    message: z.string().min(1),
  }),
]);
export type VersionPlanConsumeOutcome = z.infer<typeof VersionPlanConsumeOutcomeSchema>;


export { ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema, ArtifactOutboxAckRequestSchema, ArtifactSinkHeadRecordRequestSchema } from "../../../models/artifacts/generated-artifact.js";


export const DiagnosticAttachmentStorageRecordSchema = z.strictObject({
  bundleId: DiagnosticBundleIdSchema,
  attachment: DiagnosticAttachmentSchema,
  createdAt: IsoInstantSchema,
});

export const ProjectionStorageRecordSchema = z.strictObject({
  projectionKey: FingerprintSchema,
  payload: SchemaBoundCanonicalValueSchema,
  updatedAt: IsoInstantSchema,
});

// Retained review sources authorize exact replay only, never current execution.
export const HistoricalVersionChangeSchema = z.strictObject({
  schemaVersion: z.literal("historical-archive-v1"), state:z.literal("historical"), changeId: z.string().uuid(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  plan: VersionPlanStorageRecordSchema, application: VersionBumpApplicationStorageRecordSchema.nullable(),
  reports: z.array(z.strictObject({runId:z.string().uuid(), transferId:z.string().uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/u),reportDigest:z.string().regex(/^[a-f0-9]{64}$/u)})),
  absentRunIds: z.array(z.string().uuid()),
}).refine(row => row.changeId === row.plan.versionPlanId
  && (row.plan.state === "applied") === (row.application !== null)
  && (row.application === null || row.application.versionPlanId === row.changeId), "historical-version-change-identity-mismatch");
export const RetainedVersionChangeSchema = z.union([VersionChangeStorageSchema, HistoricalVersionChangeSchema]).superRefine((row, context) => {
  if ("schemaVersion" in row && row.schemaVersion === 2) {
    try { for (const capture of row.pendingCaptures ?? []) parsePendingCapture(row, capture); }
    catch { context.addIssue({code:"custom",message:"version-change-capture-invalid"}); }
  }
});

type AuthorityRecordTableName = Exclude<AuthorityTableName, "database_state" | "provider_requests" | "provider_usage">;

export const AUTHORITY_RECORD_SCHEMA_REGISTRY = Object.freeze({
  explorer_overrides: ExplorerWorkflowOverrideSchema,
  archive_transfers: ArchiveTransferIdentitySchema,
  version_changes: RetainedVersionChangeSchema,
  runtime_versions: RuntimeVersionAuthoritySchema,
  runtime_version_adoptions: RuntimeVersionAdoptionSchema,
  runtime_version_changes: RuntimeVersionChangeSchema,
  transaction_selection: TransactionSelectionRecordSchema,
  run_search_index: RunSearchIndexRecordSchema, run_search_grams: RunSearchGramSchema, run_search_publication: RunSearchPublicationSchema, run_search_declarations: RunSearchDeclarationSchema, run_search_actors: RunSearchActorLinkSchema,
  run_summaries: RunSummarySchema, summary_publication: SummaryPublicationSchema,

  workflow_runs: RunRecordSchema,
  run_failures: FailureRecordSchema,
  run_results: RunResultRecordSchema,
  diagnostic_snapshots: DiagnosticBundleSchema,
  diagnostic_files: DiagnosticAttachmentStorageRecordSchema,
  run_receipts: RunEvidenceReceiptSchema,
  dryrun_results: DryRunScenarioResultSchema,
  generated_artifacts: GeneratedArtifactSchema,
  timeline_operation_sources: HistoricalOperationSourceSchema,
  workflow_workers: WorkerLeaseRecordSchema,
  delegation_dependencies: DependencyRecordSchema,
  run_delegations: DelegationManifestSchema,
  // Read frozen protected command and audit representations through their matching schema family.
  commands: z.union([BulkParentCommandRecordSchema, AuthorityCommandRecordSchema, PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema, HistoricalNotificationSnoozeCommandSchema, HistoricalProviderKeysCommandSchema]),
  command_audits: z.union([AuthorityCommandAuditRecordSchema, PreFloorCommandAuditSchema, HistoricalProtectedSettingsAuditSchema, HistoricalNotificationSnoozeAuditSchema, HistoricalProviderKeysAuditSchema]),
  notifications: NotificationRecordSchema,
  notification_publications: NotificationPublicationSchema,
  notification_health: NotificationHealthSchema,
  worker_controls: WorkerControlRecordSchema,
  worker_browsers: WorkerBrowserObservationSchema,
  settings_snapshots: ConfigSnapshotRecordSchema,
  app_settings: AppSettingsSchema,
  version_plans: VersionPlanStorageRecordSchema,
  checkpoint_payloads: GateResultRecordSchema,
  run_checkpoints: RunCheckpointRecordSchema,
  workflow_run_requests: StartPlanRecordSchema,
  run_operations: WriteIntentRecordSchema,
  run_operation_attempts: WriteAttemptRecordSchema,


  imported_artifacts: ImportedArtifactSchema,



  extracted_artifacts: AdmittedExtractionSchema,

  version_bump_applications: VersionBumpApplicationStorageRecordSchema,
  archived_runs: ArchivedRunStorageRecordSchema,

  worker_auth: DuoCeremonyLeaseRecordSchema,

  worker_pools: WorkerPoolRecordSchema,
  workflow_run_batches: RunSessionRecordSchema,

  deleted_runs: DeletedRunRecordSchema,
  database_upgrades: AuthorityUpgradeRecordSchema,
  timeline_events: TimelineEventRecordSchema,
} satisfies Record<AuthorityRecordTableName, z.ZodType>);

export type DiagnosticAttachmentStorageRecord = z.infer<typeof DiagnosticAttachmentStorageRecordSchema>;
export type OpaqueAuthorityRecord = z.infer<typeof OpaqueAuthorityRecordSchema>;
export type VersionPlanStorageRecord = z.infer<typeof VersionPlanStorageRecordSchema>;
export type VersionBumpApplicationStorageRecord = z.infer<typeof VersionBumpApplicationStorageRecordSchema>;
export type ArchivedRunStorageRecord = z.infer<typeof ArchivedRunStorageRecordSchema>;
export type ArchiveRelaunchStorageRecord = z.infer<typeof ArchiveRelaunchStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ArtifactSinkHeadRecord = z.infer<typeof ArtifactSinkHeadRecordSchema>;
export type ProjectionStorageRecord = z.infer<typeof ProjectionStorageRecordSchema>;
