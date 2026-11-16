import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { validateSamePersonRestoreCandidate } from "../../../../src/backend/storage/sqlite/same-person-restore-candidate.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

it("admits a current profile backup and refuses foreign profile, path and inconsistent logical identity without changing evidence", async () => {
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(profile.admission,
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "profile-restore-candidate" }, undefined,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
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
    assert.equal(validateSamePersonRestoreCandidate(input), undefined);
    assert.throws(() => validateSamePersonRestoreCandidate({ ...input,
      activeAuthorityPath: join(profile.stateRoot, "foreign.db") }), /active authority path differs from issued profile/u);
    assert.throws(() => validateSamePersonRestoreCandidate({ ...input,
      verifiedBackup: { ...verifiedBackup, manifest: { ...manifest, profileId: randomUUID() } } }), /backup profile binding differs/u);
    assert.throws(() => validateSamePersonRestoreCandidate({ ...input,
      verifiedBackup: { ...verifiedBackup, manifest: { ...manifest, sourceDatabaseIdentity: FingerprintSchema.parse("f".repeat(64)) } } }), /logical authority identity differs/u);
    assert.deepEqual(readFileSync(verifiedBackup.backupPath), before);
  } finally { database.close(); await profile.close(); }
});
