import { describe, expect, it } from "vitest";
import { AuthorityBackupManifestSchema, UnboundPredecessorBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";

const binding = { installationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002" };
const observed = { applicationId: AUTHORITY_APPLICATION_ID, schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, ...binding,
  pageCount: 1, authorityGeneration: 0, authorityContentFingerprint: "a".repeat(64) };
const manifest = { kind: "hrauto-authority-backup", manifestVersion: 4, backupFileName: "authority-test.sqlite",
  sourceDatabaseIdentity: authoritySourceDatabaseIdentity({ kind: "profile", binding }), ...observed,
  createdAt: "2026-11-01T00:00:00.000Z", byteSize: 4096, sha256: "b".repeat(64),
  verification: { state: "verified", observedFrom: "backup-copy", observedAt: "2026-11-01T00:00:00.000Z", ...observed,
    quickCheck: "ok", foreignKeyViolations: 0, invariantViolations: [], exactTableRegistry: true } };

describe("current and stopped predecessor backup formats", () => {
  it("requires v4 and both observed immutable IDs for a current profile", () => {
    expect(AuthorityBackupManifestSchema.safeParse(manifest).success).toBe(true);
    expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, manifestVersion: 3 }).success).toBe(false);
    for (const field of ["installationId", "profileId"] as const) {
      expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, [field]: undefined }).success).toBe(false);
      expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, verification: { ...manifest.verification, [field]: undefined } }).success).toBe(false);
      expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, verification: { ...manifest.verification,
        [field]: "00000000-0000-4000-8000-000000000003" } }).success).toBe(false);
    }
  });

  it("keeps native6 unbound v3 exclusively in the stopped predecessor format", () => {
    const predecessor = { ...manifest, manifestVersion: 3, schemaVersion: 6, installationId: undefined, profileId: undefined,
      sourceDatabaseIdentity: "c".repeat(64), verification: { ...manifest.verification, schemaVersion: 6, installationId: undefined, profileId: undefined } };
    expect(UnboundPredecessorBackupManifestSchema.safeParse(predecessor).success).toBe(true);
    expect(AuthorityBackupManifestSchema.safeParse(predecessor).success).toBe(false);
    expect(UnboundPredecessorBackupManifestSchema.safeParse({ ...predecessor, ...binding }).success).toBe(false);
    expect(UnboundPredecessorBackupManifestSchema.safeParse({ ...manifest, manifestVersion: 3 }).success).toBe(false);
  });
});
