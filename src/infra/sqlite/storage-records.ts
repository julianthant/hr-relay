import { HistoricalProtectedSettingsAuditSchema, HistoricalProtectedSettingsCommandSchema, PreFloorCommandSchema, PreFloorCommandAuditSchema } from "../../domain/commands-history.js";
import { z } from "zod";
import { OperatorXlsxExportEvidenceSchema } from "../../domain/dashboard/xlsx-export.js";
import { DuoCeremonyLeaseRecordSchema } from "../../domain/duo-ceremony-lease.js";
import { RunSessionRecordSchema } from "../../domain/run/session.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import { WorkerPoolRecordSchema } from "../../domain/run/worker-pool.js";
import {
  AuthorityUpgradeRecordSchema,
  type AuthorityTableName,
} from "../../domain/authority.js";
import { IntakePlanManifestSchema } from "../../domain/intake/manifest.js";
import { IntakeSessionSchema } from "../../domain/intake/session.js";
import { AdmittedExtractionSchema } from "../../domain/ocr/extraction.js";
import {
  AuthorityCommandAuditRecordSchema,
  AuthorityCommandRecordSchema,
  BulkRunCommandAcceptanceRecordSchema,
} from "../../domain/commands.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { ActiveRuntimeConfigRecordSchema } from "../../domain/config/runtime-generation.js";
import { SettingsCurrentRecordSchema } from "../../domain/config/settings-current.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  ArtifactIdSchema,
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";
import { ArtifactProjectionKeyValueSchema } from "../../domain/workflow/artifact-projection.js";
import {
  LedgerPartitionRecordSchema,
  LedgerProjectionRecordSchema,
} from "../../domain/ledger-projection.js";
import { NotificationRecordSchema } from "../../domain/notifications.js";
import {
  ProviderAdmissionRecordSchema,
  ProviderBudgetCounterSchema,
} from "../../domain/provider-admission.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { RunRecordSchema } from "../../domain/run/record.js";
import { RunResultRecordSchema } from "../../domain/run/result.js";
import { TerminalAuthorizationRecordSchema } from "../../domain/run/terminal-authorization.js";
import { StartPlanRecordSchema } from "../../domain/run/start-plan.js";
import { RunTerminalOutboxRecordSchema } from "../../domain/run/terminal-outbox.js";
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
import { FixRecordSchema, KnowledgeRecordSchema } from "../../domain/trust/knowledge.js";
import {
  ActivityPersonPseudonymEvidenceSchema,
  ActivityPersonPseudonymGenerationBindingSchema,
} from "../../domain/trust/activity-person-pseudonym.js";

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
export const ArtifactOutboxStorageRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  artifactId: ArtifactIdSchema,
  projectionId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  stableKeyFingerprint: FingerprintSchema,
  /** Ordered declared-key pairs, never an open map (ref data-intake-and-edit-data §2's own rule). */
  keyValues: ArtifactProjectionKeyValueSchema.array().min(1),
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sourceRunId: RunIdSchema,
  sourceNodeId: NodeIdSchema,
  state: z.enum(["pending", "projected"]),
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
  projectedAt: IsoInstantSchema.optional(),
});

/**
 * Ref data-intake-and-edit-data §4.1's sink head: the last content hash this projector recorded for
 * a sink's workbook. One row per sink, updated with `generation + 1` under a
 * CAS — the same one-row-updated discipline notifications follow (v10's
 * lesson). A workbook whose bytes do not hash to `contentSha256` was changed
 * by someone else, and the projector parks rather than overwriting them.
 */
export const ArtifactSinkHeadRecordSchema = z.strictObject({
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  contentSha256: FingerprintSchema,
  generation: PositiveIntSchema,
  lastOutboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});

/** The repository ack: CAS `pending → projected`, stamping the instant. */
export const ArtifactOutboxAckRequestSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});

/** The repository head upsert; `generation` is assigned by the repository. */
export const ArtifactSinkHeadRecordRequestSchema = z.strictObject({
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  contentSha256: FingerprintSchema,
  lastOutboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});

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

type AuthorityRecordTableName = Exclude<AuthorityTableName, "authority_meta">;

export const AUTHORITY_RECORD_SCHEMA_REGISTRY = Object.freeze({
  // Ref dashboard-surfaces §2.3 names `workflow_runs` and `workflow_workers` the task/claim store. Schema v4 gave
  // both their typed columns, so neither is an opaque payload any more: a row
  // that predates the typing fails validation at boot rather than being
  // reinterpreted as a run or a worker it was never written as.
  workflow_runs: RunRecordSchema,
  run_terminal_authorizations: TerminalAuthorizationRecordSchema,
  failures: FailureRecordSchema,
  run_results: RunResultRecordSchema,
  run_terminal_outbox: RunTerminalOutboxRecordSchema,
  diagnostic_bundles: DiagnosticBundleSchema,
  diagnostic_attachments: DiagnosticAttachmentStorageRecordSchema,
  evidence_receipts: RunEvidenceReceiptSchema,
  dry_run_scenario_results: DryRunScenarioResultSchema,
  operator_xlsx_exports: OperatorXlsxExportEvidenceSchema,
  activity_person_pseudonyms: ActivityPersonPseudonymEvidenceSchema,
  activity_person_pseudonym_generations: ActivityPersonPseudonymGenerationBindingSchema,
  knowledge_records: KnowledgeRecordSchema,
  fix_records: FixRecordSchema,
  ledger_partitions: LedgerPartitionRecordSchema,
  ledger_projections: LedgerProjectionRecordSchema,
  provider_budget_counters: ProviderBudgetCounterSchema,
  provider_admissions: ProviderAdmissionRecordSchema,
  workflow_workers: WorkerLeaseRecordSchema,
  dependencies: DependencyRecordSchema,
  delegation_manifests: DelegationManifestSchema,
  // D341: pre-D341 protected commands/audits name retired entries; the frozen arm keeps them readable.
  commands: z.union([AuthorityCommandRecordSchema, PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema]),
  command_audits: z.union([AuthorityCommandAuditRecordSchema, PreFloorCommandAuditSchema, HistoricalProtectedSettingsAuditSchema]),
  bulk_command_acceptances: BulkRunCommandAcceptanceRecordSchema,
  notifications: NotificationRecordSchema,
  config_snapshots: ConfigSnapshotRecordSchema,
  settings_current: SettingsCurrentRecordSchema,
  runtime_config: ActiveRuntimeConfigRecordSchema,
  version_plans: VersionPlanStorageRecordSchema,
  checkpoint_payloads: GateResultRecordSchema,
  run_checkpoints: RunCheckpointRecordSchema,
  workflow_run_requests: StartPlanRecordSchema,
  ocr_approvals: OpaqueAuthorityRecordSchema,
  run_operations: WriteIntentRecordSchema,
  run_operation_attempts: WriteAttemptRecordSchema,
  operation_outbox: AtomicOutboxRecordSchema,
  artifact_outbox: ArtifactOutboxStorageRecordSchema,
  /** Typed at D164, when the first sink projector landed. */
  artifact_sink_heads: ArtifactSinkHeadRecordSchema,
  /** Ref data-intake-and-edit-data §2.2's in-progress session (2i-E1). */
  intake_sessions: IntakeSessionSchema,
  /** Ref data-intake-and-edit-data §5's immutable plan manifest (D159). */
  intake_manifests: IntakePlanManifestSchema,
  /** Ref data-intake-and-edit-data §4.3's admitted page extraction (D159). */
  ocr_extractions: AdmittedExtractionSchema,
  /** D179 / ref dashboard-surfaces §10.2 — the archive model's three durable facts. */
  version_bump_applications: VersionBumpApplicationStorageRecordSchema,
  archived_runs: ArchivedRunStorageRecordSchema,
  archive_relaunches: ArchiveRelaunchStorageRecordSchema,
  /** D267 / ref execution-and-sessions §10 — the per-credential Duo ceremony lease. */
  worker_auth: DuoCeremonyLeaseRecordSchema,
  /** D269 / ref execution-and-sessions §11 — the per-workflow pool declaration and the run session. */
  worker_pools: WorkerPoolRecordSchema,
  workflow_run_batches: RunSessionRecordSchema,
  /** D308 — the delete tombstone: the one row a deleted run leaves behind. */
  deleted_runs: DeletedRunRecordSchema,
  authority_upgrades: AuthorityUpgradeRecordSchema,
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
