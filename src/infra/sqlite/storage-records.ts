import { z } from "zod";
import type { AuthorityTableName } from "../../domain/authority.js";
import { IntakePlanManifestSchema } from "../../domain/intake/manifest.js";
import { IntakeSessionSchema } from "../../domain/intake/session.js";
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
  NodeIdSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";
import { CaptureFinalizationOutboxSchema, CaptureSessionSchema } from "../../domain/capture.js";
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

/**
 * Doc 03 §2.1 (D45) / doc 06 §4.1: one stable-keyed durable projection row,
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
  /** Ordered declared-key pairs, never an open map (doc 06 §2's own rule). */
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
 * Doc 06 §4.1's sink head: the last content hash this projector recorded for
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
  /** Typed at D167, when the durable capture core landed. */
  capture_sessions: CaptureSessionSchema,
  capture_photo_order: OpaqueAuthorityRecordSchema,
  capture_finalization_outboxes: CaptureFinalizationOutboxSchema,
  write_intents: WriteIntentRecordSchema,
  write_attempts: WriteAttemptRecordSchema,
  durable_outbox: AtomicOutboxRecordSchema,
  artifact_outbox: ArtifactOutboxStorageRecordSchema,
  /** Typed at D164, when the first sink projector landed. */
  artifact_sink_heads: ArtifactSinkHeadRecordSchema,
  /** Doc 06 §2.2's in-progress session (2i-E1). */
  intake_sessions: IntakeSessionSchema,
  /** Doc 06 §5's immutable plan manifest (D159). */
  intake_manifests: IntakePlanManifestSchema,
  /** Doc 06 §4.3's admitted page extraction (D159). */
  ocr_extractions: AdmittedExtractionSchema,
} satisfies Record<AuthorityRecordTableName, z.ZodType>);

export type DiagnosticAttachmentStorageRecord = z.infer<typeof DiagnosticAttachmentStorageRecordSchema>;
export type OpaqueAuthorityRecord = z.infer<typeof OpaqueAuthorityRecordSchema>;
export type VersionPlanStorageRecord = z.infer<typeof VersionPlanStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ArtifactSinkHeadRecord = z.infer<typeof ArtifactSinkHeadRecordSchema>;
export type ProjectionStorageRecord = z.infer<typeof ProjectionStorageRecordSchema>;
