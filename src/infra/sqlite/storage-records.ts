import { z } from "zod";
import type { AuthorityTableName } from "../../domain/authority.js";
import { IntakePlanManifestSchema } from "../../domain/intake/manifest.js";
import { AdmittedExtractionSchema } from "../../domain/ocr/extraction.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../domain/commands.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  ArtifactIdSchema,
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";
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
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../domain/write-safety.js";
import {
  DiagnosticAttachmentSchema,
  DiagnosticBundleSchema,
} from "../../domain/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";
import { FixRecordSchema, KnowledgeRecordSchema } from "../../domain/trust/knowledge.js";

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
  state: z.enum(["planned", "applied", "rejected"]),
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
});

export const ArtifactOutboxStorageRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  artifactId: ArtifactIdSchema,
  stableKeyFingerprint: FingerprintSchema,
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  state: z.enum(["pending", "projected"]),
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
});

/**
 * A diagnostic attachment is stored beside its bundle so a content-addressed
 * artifact can be found without scanning every bundle's JSON array. The row
 * retains the bundle id explicitly; the attachment arm itself is doc 12 §2.2's
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
  // Doc 03 §2.3 names `tasks` and `leases` the task/claim store. Schema v4 gave
  // both their typed columns, so neither is an opaque payload any more: a row
  // that predates the typing fails validation at boot rather than being
  // reinterpreted as a run or a worker it was never written as.
  tasks: RunRecordSchema,
  run_terminal_authorizations: TerminalAuthorizationRecordSchema,
  failures: FailureRecordSchema,
  run_results: RunResultRecordSchema,
  run_terminal_outbox: RunTerminalOutboxRecordSchema,
  diagnostic_bundles: DiagnosticBundleSchema,
  diagnostic_attachments: DiagnosticAttachmentStorageRecordSchema,
  evidence_receipts: RunEvidenceReceiptSchema,
  knowledge_records: KnowledgeRecordSchema,
  fix_records: FixRecordSchema,
  ledger_partitions: LedgerPartitionRecordSchema,
  ledger_projections: LedgerProjectionRecordSchema,
  provider_budget_counters: ProviderBudgetCounterSchema,
  provider_admissions: ProviderAdmissionRecordSchema,
  leases: WorkerLeaseRecordSchema,
  dependencies: DependencyRecordSchema,
  delegation_manifests: DelegationManifestSchema,
  commands: CommandRequestSchema,
  command_audits: CommandAuditRecordSchema,
  notifications: NotificationRecordSchema,
  config_snapshots: ConfigSnapshotRecordSchema,
  version_plans: VersionPlanStorageRecordSchema,
  checkpoint_payloads: GateResultRecordSchema,
  run_checkpoints: RunCheckpointRecordSchema,
  start_plans: StartPlanRecordSchema,
  ocr_approvals: OpaqueAuthorityRecordSchema,
  capture_sessions: OpaqueAuthorityRecordSchema,
  capture_photo_order: OpaqueAuthorityRecordSchema,
  capture_finalization_outboxes: OpaqueAuthorityRecordSchema,
  write_intents: WriteIntentRecordSchema,
  write_attempts: WriteAttemptRecordSchema,
  durable_outbox: AtomicOutboxRecordSchema,
  artifact_outbox: ArtifactOutboxStorageRecordSchema,
  artifact_sink_heads: OpaqueAuthorityRecordSchema,
  /** Doc 06 §5's immutable plan manifest (D159). */
  intake_manifests: IntakePlanManifestSchema,
  /** Doc 06 §4.3's admitted page extraction (D159). */
  ocr_extractions: AdmittedExtractionSchema,
} satisfies Record<AuthorityRecordTableName, z.ZodType>);

export type DiagnosticAttachmentStorageRecord = z.infer<typeof DiagnosticAttachmentStorageRecordSchema>;
export type OpaqueAuthorityRecord = z.infer<typeof OpaqueAuthorityRecordSchema>;
export type VersionPlanStorageRecord = z.infer<typeof VersionPlanStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ProjectionStorageRecord = z.infer<typeof ProjectionStorageRecordSchema>;
