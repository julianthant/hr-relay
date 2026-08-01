import { z } from "zod";
import {
  ArtifactIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  VersionPlanIdSchema,
} from "../../domain/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";

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

export type OpaqueAuthorityRecord = z.infer<typeof OpaqueAuthorityRecordSchema>;
export type VersionPlanStorageRecord = z.infer<typeof VersionPlanStorageRecordSchema>;
export type ArtifactOutboxStorageRecord = z.infer<typeof ArtifactOutboxStorageRecordSchema>;
export type ProjectionStorageRecord = z.infer<typeof ProjectionStorageRecordSchema>;
