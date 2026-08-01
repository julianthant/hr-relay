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
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../domain/write-safety.js";

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
  tasks: OpaqueAuthorityRecordSchema,
  leases: OpaqueAuthorityRecordSchema,
  dependencies: DependencyRecordSchema,
  delegation_manifests: DelegationManifestSchema,
  commands: CommandRequestSchema,
  command_audits: CommandAuditRecordSchema,
  notifications: NotificationRecordSchema,
  config_snapshots: ConfigSnapshotRecordSchema,
  version_plans: VersionPlanStorageRecordSchema,
  checkpoint_payloads: GateResultRecordSchema,
  run_checkpoints: RunCheckpointRecordSchema,
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
