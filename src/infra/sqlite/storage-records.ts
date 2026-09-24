import { TransactionSelectionRecordSchema } from "../../domain/transaction-selection.js";
import { RuntimeVersionAdoptionSchema, RuntimeVersionAuthoritySchema } from "./runtime-versions.js";
import { RuntimeVersionChangeSchema } from "../../domain/archive/runtime-version-change.js";
import { RunSearchIndexRecordSchema, RunSearchPublicationSchema, RunSearchDeclarationSchema, RunSearchGramSchema, RunSearchActorLinkSchema } from "../../domain/dashboard/search-index.js";
import { WorkerControlRecordSchema, WorkerBrowserObservationSchema } from "../../domain/worker-control.js";
import { NotificationPublicationSchema, NotificationHealthSchema } from "./notification-publications.js";
import { ExplorerWorkflowOverrideSchema } from "../../domain/dashboard/explorer.js";
import { parsePendingCapture } from "../../domain/archive/pending-capture.js";
import { VersionChangeStorageSchema } from "../../domain/archive/change-record.js";
import { ArchiveTransferIdentitySchema } from "./run-evidence-ownership.js";
import { RunSummarySchema, SummaryPublicationSchema } from "../../domain/run/summary.js";
import { AppSettingsSchema } from "../../domain/config/app-settings.js";
import { ProviderRequestStorageSchema, ProviderUsageStorageSchema } from "../../domain/provider-accounting.js";
import { GeneratedArtifactSchema, ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../domain/generated-artifact.js";
import { ImportedArtifactSchema } from "../../domain/intake/imported-artifact.js";
import { HistoricalOperationSourceSchema, TimelineEventRecordSchema } from "../../events/timeline.js";
import { HistoricalProtectedSettingsAuditSchema, HistoricalProtectedSettingsCommandSchema, PreFloorCommandSchema, PreFloorCommandAuditSchema } from "../../domain/commands-history.js";
import { z } from "zod";
import { DuoCeremonyLeaseRecordSchema } from "../../domain/duo-ceremony-lease.js";
import { RunSessionRecordSchema } from "../../domain/run/session.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import { WorkerPoolRecordSchema } from "../../domain/run/worker-pool.js";
import {
  AuthorityUpgradeRecordSchema,
  type AuthorityTableName,
} from "../../domain/authority.js";
import { AdmittedExtractionSchema } from "../../domain/ocr/extraction.js";
import {
  AuthorityCommandAuditRecordSchema,
  AuthorityCommandRecordSchema,
  BulkParentCommandRecordSchema,
} from "../../domain/commands.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";


import { NotificationRecordSchema } from "../../domain/notifications.js";


import { RunRecordSchema } from "../../domain/run/record.js";
import { RunResultRecordSchema } from "../../domain/run/result.js";
import { StartPlanRecordSchema } from "../../domain/run/start-plan.js";
import { WorkerLeaseRecordSchema } from "../../domain/run/worker.js";
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";
import {
  ArchivedRunRecordSchema,
  ArchiveRelaunchRecordSchema,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
  versionBumpPlanFingerprint,
} from "../../domain/archive/model.js";
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../domain/write-safety.js";
import {
  DiagnosticAttachmentSchema,
  DiagnosticBundleSchema,
} from "../../domain/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { DryRunScenarioResultSchema } from "../../domain/trust/dry-run-scenario-result.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";

export const SqliteStorageRecordIdSchema = z.string().uuid().brand<"SqliteStorageRecordId">();

export const OpaqueAuthorityRecordSchema = z.strictObject({
  recordId: SqliteStorageRecordIdSchema,
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
});

/**
 * The version-bump plan row (D179). The released v1 shell held an opaque
 * `payload` and a three-state enum; it had ZERO production rows because the
 * whole `version-archive` family was deferred, so this is the first real shape
 * rather than a migration of one — the same D164 precedent `artifact_outbox`
 * set when its first producer landed.
 *
 * Two shell corrections come with it. The payload is the exact
 * `VersionBumpPlan`, not a schema-bound blob, because the apply arm reads the
 * plan's own scope back and a blob would let a reader see whatever it parsed
 * the bytes as. And `rejected` is gone: a bump that meets a blocker leaves the
 * plan `planned` so the operator can clear the blocker and apply the SAME
 * reviewed plan — a rejected state would have been written by nothing and read
 * by nobody.
 */
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

/**
 * The applied bump (D179) — charter §25's change record, insert-only. It is a
 * separate row from the plan on purpose: the plan is what was REVIEWED, this
 * is what was DONE, and the archived runs reference this one.
 */
export const VersionBumpApplicationStorageRecordSchema = VersionBumpApplicationSchema;

/**
 * One archived run, self-contained (D179). The row is immutable in SQL, not
 * merely by convention: an archive that could be rewritten would be a worse
 * record than the live row it replaced.
 */
export const ArchivedRunStorageRecordSchema = ArchivedRunRecordSchema;

/** Relaunch provenance (D179) — insert-only, keyed by the FRESH run. */
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

/**
 * Ref dashboard-surfaces §2.1 (D45) / ref data-intake-and-edit-data §4.1: one stable-keyed durable projection row,
 * committed atomically with the producing node's checkpoint. `projectionId`,
 * `keyValues`, and the source identity joined the record at D164, when the
 * first producer landed — the released v1 shell had zero production rows, so
 * this is the first real shape, not a migration of one. `projectedAt` exists
 * exactly when `state` is `"projected"` (enforced by the repository's ack).
 */
export { ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema, ArtifactOutboxAckRequestSchema, ArtifactSinkHeadRecordRequestSchema } from "../../domain/generated-artifact.js";

/**
 * A diagnostic attachment is stored beside its bundle so a content-addressed
 * artifact can be found without scanning every bundle's JSON array. The row
 * retains the bundle id explicitly; the attachment arm itself is ref operator-trust §2.2's
 * exact union, never a loosened copy.
 */
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

/** Exact historical review/application sources, never executable current claims. */
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

type AuthorityRecordTableName = Exclude<AuthorityTableName, "database_state">;

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
  // Ref dashboard-surfaces §2.3 names `workflow_runs` and `workflow_workers` the task/claim store. Schema v4 gave
  // both their typed columns, so neither is an opaque payload any more: a row
  // that predates the typing fails validation at boot rather than being
  // reinterpreted as a run or a worker it was never written as.
  workflow_runs: RunRecordSchema,
  run_failures: FailureRecordSchema,
  run_results: RunResultRecordSchema,
  diagnostic_snapshots: DiagnosticBundleSchema,
  diagnostic_files: DiagnosticAttachmentStorageRecordSchema,
  run_receipts: RunEvidenceReceiptSchema,
  dryrun_results: DryRunScenarioResultSchema,
  generated_artifacts: GeneratedArtifactSchema,
  timeline_operation_sources: HistoricalOperationSourceSchema,
  provider_usage: ProviderUsageStorageSchema,
  provider_requests: ProviderRequestStorageSchema,
  workflow_workers: WorkerLeaseRecordSchema,
  delegation_dependencies: DependencyRecordSchema,
  run_delegations: DelegationManifestSchema,
  // D341: pre-D341 protected commands/audits name retired entries; the frozen arm keeps them readable.
  commands: z.union([BulkParentCommandRecordSchema, AuthorityCommandRecordSchema, PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema]),
  command_audits: z.union([AuthorityCommandAuditRecordSchema, PreFloorCommandAuditSchema, HistoricalProtectedSettingsAuditSchema]),
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
  /** Typed at D164, when the first sink projector landed. */
  /** Ref data-intake-and-edit-data §2.2's in-progress session (2i-E1). */
  imported_artifacts: ImportedArtifactSchema,
  /** Ref data-intake-and-edit-data §5's immutable plan manifest (D159). */

  /** Ref data-intake-and-edit-data §4.3's admitted page extraction (D159). */
  extracted_artifacts: AdmittedExtractionSchema,
  /** D179 / ref dashboard-surfaces §10.2 — the archive model's three durable facts. */
  version_bump_applications: VersionBumpApplicationStorageRecordSchema,
  archived_runs: ArchivedRunStorageRecordSchema,
  /** D267 / ref execution-and-sessions §10 — the per-credential Duo ceremony lease. */
  worker_auth: DuoCeremonyLeaseRecordSchema,
  /** D269 / ref execution-and-sessions §11 — the per-workflow pool declaration and the run session. */
  worker_pools: WorkerPoolRecordSchema,
  workflow_run_batches: RunSessionRecordSchema,
  /** D308 — the delete tombstone: the one row a deleted run leaves behind. */
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
