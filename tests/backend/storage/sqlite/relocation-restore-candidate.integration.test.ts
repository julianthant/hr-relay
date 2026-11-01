import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { validateStorageRelocationRestoreCandidate } from "../../../../src/backend/storage/sqlite/relocation-restore-candidate.js";

it("admits a current profile backup and refuses foreign profile, path and inconsistent logical identity without changing evidence", async () => {
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(profile.admission,
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "profile-restore-candidate" });
  try {
    const directory = join(profile.stateRoot, "backups", "authority");
    const report = await new AuthorityBackupService(profile.admission, database, { directory }).request({
      trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    const produced = report.manifests[0]; assert.ok(produced);
    const manifest = AuthorityBackupManifestSchema.parse(produced);
    const verifiedBackup = await verifyBackupManifestAtPath(profile.admission,
      join(directory, manifest.backupFileName + ".manifest.json"));
    const before = readFileSync(verifiedBackup.backupPath);
    const input = { admission: profile.admission, activeAuthorityPath: profile.path, verifiedBackup };
    assert.equal(validateStorageRelocationRestoreCandidate(input), undefined);
    assert.throws(() => validateStorageRelocationRestoreCandidate({ ...input,
      activeAuthorityPath: join(profile.stateRoot, "foreign.db") }), /active authority path differs from issued profile/u);
    assert.throws(() => validateStorageRelocationRestoreCandidate({ ...input,
      verifiedBackup: { ...verifiedBackup, manifest: { ...manifest, profileId: randomUUID() } } }), /backup profile binding differs/u);
    assert.throws(() => validateStorageRelocationRestoreCandidate({ ...input,
      verifiedBackup: { ...verifiedBackup, manifest: { ...manifest, sourceDatabaseIdentity: FingerprintSchema.parse("f".repeat(64)) } } }), /logical authority identity differs/u);
    assert.deepEqual(readFileSync(verifiedBackup.backupPath), before);
  } finally { database.close(); await profile.close(); }
});
