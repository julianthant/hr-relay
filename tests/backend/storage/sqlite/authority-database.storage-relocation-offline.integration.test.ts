import assert from "node:assert/strict";
import { existsSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import {
cleanupFixtureRoots,clock,durableSnapshot,installation,
leaveStoppedWal,
plan,relocate
} from "../../../support/helpers/storage/storage-relocation-fixture.js";

afterEach(cleanupFixtureRoots);

function assertActivation(before: ReturnType<typeof durableSnapshot>, after: ReturnType<typeof durableSnapshot>,
  destination: Readonly<{ stateRoot: string; artifactRoot: string }>): void {
  assert.equal(before.appSettings.length, 1);
  assert.equal(after.appSettings.length, 1);
  const previous = AppSettingsSchema.parse(JSON.parse(before.appSettings[0] ?? "null") as unknown);
  const current = AppSettingsSchema.parse(JSON.parse(after.appSettings[0] ?? "null") as unknown);
  assert.equal(canonicalJsonStringify(current.saved), canonicalJsonStringify(previous.saved));
  assert.ok(current.saved);
  assert.ok(current.active);
  assert.equal(current.active.generation, (previous.active?.generation ?? 0) + 1);
  assert.equal(current.active.settingsRevision, current.saved.revision);
  assert.equal(current.active.settingsFingerprint, current.saved.settingsFingerprint);
  assert.equal(current.active.activatedAt, clock.now().toISOString());
  assert.equal(after.settingsSnapshots.length, before.settingsSnapshots.length + 1);
  assert.deepEqual(after.settingsSnapshots.slice(0, -1), before.settingsSnapshots);
  const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(after.settingsSnapshots.at(-1) ?? "null") as unknown);
  assert.equal(current.active.configSnapshotId, snapshot.configSnapshotId);
  assert.equal(current.active.configFingerprint, snapshot.fingerprint);
  const expected = resolveConfigWithProvenance(current.saved.settings, hostConfigFacts({}), clock, destination);
  assert.equal(snapshot.fingerprint, expected.fingerprint);
  assert.deepEqual(snapshot.config, expected.config);
  assert.deepEqual(snapshot.provenance, expected.provenance);
}

it("moves both roots with a stopped WAL-backed domain record and preserves managed bytes", async () => {
  const f = await installation();
  const destination = { stateRoot: join(f.root, "moved-state"), artifactRoot: join(f.root, "moved-artifacts") };
  const request = plan(f.workspace, f.lifetime, destination);
  await leaveStoppedWal(f.workspace, f.lifetime, f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  const outcome = await relocate(f.workspace, f.lifetime, request.commandId);
  assert.equal(outcome.generation, 1);
  const reopened = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    assert.equal(reopened.stateRoot, destination.stateRoot);
    assert.equal(reopened.artifactRoot, destination.artifactRoot);
    const after = durableSnapshot(join(destination.stateRoot, "state.db"),
      join(destination.stateRoot, "credentials", "protected.json"),
      join(destination.artifactRoot, `${f.artifact.sha256}.artifact`));
    assertActivation(before, after, destination);
    assert.deepEqual(after.commands, before.commands);
    assert.deepEqual(after.audits, before.audits);
    assert.deepEqual(after.notifications, before.notifications);
    assert.equal(after.credentialDigest, before.credentialDigest);
    assert.equal(after.artifactDigest, before.artifactDigest);
    const boot = AuthorityDatabase.open(reopened, { path: join(destination.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "offline-relocation-boot-readback" }, clock);
    try {
      assert.equal(readSettings(boot.authority).revision, 2);
    } finally { boot.close(); }
    const artifactReader = createServerVerifiedArtifactReader({ admission: reopened });
    await artifactReader.ready;
    await artifactReader.verify(f.artifact);
    const backupRoot = join(destination.stateRoot, "backups", "authority");
    const databaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(join(destination.stateRoot, "state.db"));
    const currentBackup = readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json"))
      .map(name => join(backupRoot, name))
      .find(path => parseBackupManifestFile(path).sourceDatabaseIdentity === databaseIdentity);
    assert.ok(currentBackup, "final-path backup must bind destination database identity");
    await verifyBackupManifestAtPath(reopened, currentBackup, databaseIdentity);
    assert.equal(existsSync(join(destination.stateRoot, "scratch")), true);
  } finally { reopened.release(); }
});
