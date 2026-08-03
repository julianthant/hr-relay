import { z } from "zod";
import type { AuthorityTableName } from "../../domain/authority.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../domain/commands.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  ArtifactIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";
import { NotificationRecordSchema } from "../../domain/notifications.js";
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
import { FailureRecordSchema } from "../../domain/trust/failure.js";

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
} satisfies Record<AuthorityRecordTableName, z.ZodType>);

export type OpaqueAuthorityRecord = z.infer<typeof OpaqueAuthorityRecordSchema>;
export type VersionPlanStorageRecord = z.infer<typeof VersionPlanStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ProjectionStorageRecord = z.infer<typeof ProjectionStorageRecordSchema>;
