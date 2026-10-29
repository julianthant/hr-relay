import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { existsSync,lstatSync,readFileSync,readdirSync,symlinkSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { credentialTrap,storageRecoveryFixture,storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { inspectAuthorityBackupReadOnly,upgradeStorage } from "../../../support/helpers/synthetic-storage-admission.js";

describe("current stopped authority initialization", () => {
  it.each([29, 31, 38, 46, 47, 48, 49, 56])("refuses noncurrent schema %s before credentials or rewriting bytes", async version => {
    const f = await storageRecoveryFixture(version);
    try {
      credentialTrap(f.root);
      writeFileSync(f.input.environmentFile, "malformed obsolete environment");
      const before = storageTree(f.root);
      const locksBefore = storageTree(f.input.processLockRoot);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), error => error instanceof AuthoritySchemaVersionError
        && error.code === "authority-schema-mismatch" && error.schemaVersion === version);
      assert.deepEqual(storageTree(f.root), before);
      assert.deepEqual(storageTree(f.input.processLockRoot), locksBefore);
    } finally { await f.dispose(); }
  });
  it("upgrades authenticated stopped schema 7 with its exact verified backup", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      credentialTrap(f.root);
      const trapPath = join(f.root, "credentials", "protected.json"), trap = lstatSync(trapPath);
      const before = storageTree(f.root), locksBefore = storageTree(f.input.processLockRoot);
      const sourceIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const source = AuthorityDatabase.inspectStoppedUpgrade(f.admission, f.path, f.input.processLockRoot, f.clock);
      assert.deepEqual(await f.run(true), { state: "planned", fromSchemaVersion: 7,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
      assert.deepEqual(storageTree(f.root), before);
      assert.deepEqual(storageTree(f.input.processLockRoot), locksBefore);
      assert.deepEqual(await f.run(), { state: "upgraded", fromSchemaVersion: 7,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
      const directory = join(f.root, "backups", "authority");
      const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
      assert.equal(manifests.length, 1);
      const backup = await verifyBackupManifestAtPath(f.admission, join(directory, manifests[0]), sourceIdentity);
      assert.equal(backup.manifest.schemaVersion, 7);
      assert.equal(backup.manifest.authorityGeneration, source.authorityGeneration);
      assert.equal(backup.manifest.authorityContentFingerprint, source.authorityContentFingerprint);
      const current = inspectAuthorityBackupReadOnly(f.path);
      assert.equal(current.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      assert.equal(current.authorityGeneration, source.authorityGeneration);
      assert.equal(current.installationId, f.admission.profileBinding.installationId);
      assert.equal(current.profileId, f.admission.profileBinding.profileId);
      const retainedTrap = lstatSync(trapPath);
      assert.equal(retainedTrap.isDirectory(), true);
      assert.equal(retainedTrap.dev, trap.dev);
      assert.equal(retainedTrap.ino, trap.ino);
      assert.equal(retainedTrap.mode, trap.mode);
    } finally { await f.dispose(); }
  });
  it("plans without writes, initializes directly, and repeats without changing authority or independent inputs", async () => {
    const f = await storageRecoveryFixture();
    try {
      writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
      writeFileSync(join(f.root, "settings.json"), "corrupt obsolete input");
      credentialTrap(f.root);
      const before = storageTree(f.root);
      assert.equal((await f.run(true)).state, "planned");
      assert.deepEqual(storageTree(f.root), before);
      assert.equal((await f.run()).state, "initialized");
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const initialized = storageTree(f.root);
      const initializedLocks = storageTree(f.input.processLockRoot);
      assert.equal((await f.run()).state, "already-upgraded");
      const repeated = storageTree(f.root);
      assert.deepEqual(repeated, initialized);
      const repeatedLocks = storageTree(f.input.processLockRoot);
      for (const [path, bytes] of Object.entries(initializedLocks)) assert.equal(repeatedLocks[path], bytes);
      const added = Object.keys(repeatedLocks).filter(path => !(path in initializedLocks));
      assert.equal(added.length, 1);
      assert.match(added[0] ?? "", /^restore-admission-history\/[^/]+\.lock\.json$/u);
      assert.equal(existsSync(join(f.input.processLockRoot, "restore-admission.lock.json")), false);
      assert.equal(readFileSync(f.input.environmentFile, "utf8"), "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
      assert.equal(readFileSync(join(f.root, "settings.json"), "utf8"), "corrupt obsolete input");
    } finally { await f.dispose(); }
  });
  it("preserves a fresh source after admission fails and admits the exact retry", async () => {
    const f = await storageRecoveryFixture();
    try {
      const before = storageTree(f.root);
      await assert.rejects(upgradeStorage(profileBrowserClosure, f.input, f.clock, () => { throw new Error("injected-admission-failure"); }), /injected-admission-failure/u);
      assert.deepEqual(storageTree(f.root), before);
      assert.equal(existsSync(f.path), false);
      assert.equal((await f.run()).state, "initialized");
    } finally { await f.dispose(); }
  });
  it("refuses an aliased database without changing its genuine current source", async () => {
    const f = await storageRecoveryFixture(), source = await storageRecoveryFixture();
    try {
      await source.run();
      symlinkSync(source.path, f.path);
      const before = storageTree(source.root);
      await assert.rejects(f.run(), /source-integrity/u);
      assert.deepEqual(storageTree(source.root), before);
    } finally { await f.dispose(); await source.dispose(); }
  });
});
