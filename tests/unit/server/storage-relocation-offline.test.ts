import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { ArtifactRefSchema } from "../../../src/domain/artifacts.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { createStorageRelocationPlanReader } from "../../../src/core/storage-relocation-plans.js";
import { AppSettingsSchema } from "../../../src/domain/config/app-settings.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { ConfigSnapshotRecordSchema } from "../../../src/domain/config/snapshot.js";
import { NotificationRecordSchema } from "../../../src/domain/notifications.js";
import { ArchiveDatabase } from "../../../src/infra/sqlite/archive-database.js";
import { createServerVerifiedArtifactReader } from "../../../src/infra/artifacts/server-verified-artifact-reader.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "../../../src/infra/sqlite/backup-service.js";
import { acquireSharedRuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { readSettings } from "../../../src/server/settings-runtime.js";
import { cleanupFixtureRoots, clock, durableSnapshot, installation, interruptedRelocation, leaveStoppedWal,
  plan, relocate, WAL_NOTIFICATION_TITLE } from "./helpers/storage-relocation-fixture.js";

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

it("prepares a genuine offline relocation fixture with settings, protected data, archive and managed artifacts", async () => {
  const f = await installation();
  const request = plan(f.workspace, { stateRoot: join(f.root, "new-state"), artifactRoot: join(f.root, "new-artifacts") });
  const admission = acquireSharedRuntimeAdmission(f.workspace);
  try {
    const database = AuthorityDatabase.open(admission, { path: f.authorityPath, busyTimeoutMs: 250,
      migrationOwner: "offline-relocation-fixture" }, clock);
    try {
      const reader = createStorageRelocationPlanReader({ authority: database, admission, workspace: f.workspace });
      assert.equal(reader.read().pending?.commandId, request.commandId);
      assert.equal(readSettings(database.authority).revision, 2);
      assert.equal(ArtifactRefSchema.parse((JSON.parse(readFileSync(f.artifactFile, "utf8")) as { ref: unknown }).ref).sha256,
        f.artifact.sha256);
      assert.ok(readFileSync(f.credentialFile).byteLength > 0);
      const archive = new ArchiveDatabase(admission, f.archivePath, { readOnly: true });
      try {
        const report = archive.readPublished(f.archivedRunId);
        assert.ok(report);
        assert.equal(report.content.files.length, 1);
        const attachment = report.content.files[0];
        assert.ok(attachment);
        assert.equal(archive.readFile(attachment).toString("utf8"), "synthetic archived attachment");
      } finally { archive.close(); }
    } finally { database.close(); }
  } finally { admission.release(); }
  const walNotificationId = leaveStoppedWal(f.workspace, f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  assert.equal(before.notifications.length, 1);
  const notification = NotificationRecordSchema.parse(JSON.parse(before.notifications[0] ?? "null") as unknown);
  assert.equal(notification.notificationId, walNotificationId);
  assert.equal(notification.title, WAL_NOTIFICATION_TITLE);
  assert.equal(before.appSettings.length, 1);
  assert.equal(before.commands.length, 2);
  assert.equal(before.audits.length, 2);
});

it("moves both roots with a stopped WAL-backed domain record and preserves managed bytes", async () => {
  const f = await installation();
  const destination = { stateRoot: join(f.root, "moved-state"), artifactRoot: join(f.root, "moved-artifacts") };
  const request = plan(f.workspace, destination);
  leaveStoppedWal(f.workspace, f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  const outcome = await relocate(f.workspace, request.commandId);
  assert.equal(outcome.generation, 1);
  const reopened = acquireSharedRuntimeAdmission(f.workspace);
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
      const archive = new ArchiveDatabase(reopened, join(destination.stateRoot, "archive.sqlite"), { readOnly: true });
      try {
        const report = archive.readPublished(f.archivedRunId);
        assert.ok(report);
        assert.equal(report.content.files.length, 1);
        const attachment = report.content.files[0];
        assert.ok(attachment);
        assert.equal(archive.readFile(attachment).toString("utf8"), "synthetic archived attachment");
      }
      finally { archive.close(); }
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
    assert.equal(existsSync(join(destination.stateRoot, "verified-byte-scratch")), true);
  } finally { reopened.release(); }
});

it("moves artifacts first, then state under the prior receipt without changing settings history", async () => {
  const f = await installation();
  const artifactDestination = join(f.root, "artifact-first");
  const first = plan(f.workspace, { stateRoot: f.source.stateRoot, artifactRoot: artifactDestination });
  const firstOutcome = await relocate(f.workspace, first.commandId);
  assert.equal(firstOutcome.generation, 1);
  const afterArtifact = acquireSharedRuntimeAdmission(f.workspace);
  try {
    assert.equal(afterArtifact.stateRoot, f.source.stateRoot);
    assert.equal(afterArtifact.artifactRoot, artifactDestination);
    assert.equal(existsSync(join(artifactDestination, `${f.artifact.sha256}.artifact`)), true);
  } finally { afterArtifact.release(); }

  const stateDestination = join(f.root, "state-second");
  const second = plan(f.workspace, { stateRoot: stateDestination, artifactRoot: artifactDestination });
  const before = durableSnapshot(f.authorityPath, f.credentialFile,
    join(artifactDestination, `${f.artifact.sha256}.artifact`));
  const secondOutcome = await relocate(f.workspace, second.commandId);
  assert.equal(secondOutcome.generation, 2);
  const afterState = acquireSharedRuntimeAdmission(f.workspace);
  try {
    assert.equal(afterState.stateRoot, stateDestination);
    assert.equal(afterState.artifactRoot, artifactDestination);
    const after = durableSnapshot(join(stateDestination, "state.db"),
      join(stateDestination, "credentials", "protected.json"),
      join(artifactDestination, `${f.artifact.sha256}.artifact`));
    assertActivation(before, after, { stateRoot: stateDestination, artifactRoot: artifactDestination });
    assert.deepEqual(after.commands, before.commands);
    assert.deepEqual(after.audits, before.audits);
    assert.equal(after.credentialDigest, before.credentialDigest);
    assert.equal(after.artifactDigest, before.artifactDigest);
    assert.equal(existsSync(join(stateDestination, "verified-byte-scratch")), true);
  } finally { afterState.release(); }
});

it("upgrades a released v55 source before moving both roots and retains the pre-upgrade backup", async () => {
  const f = await installation(55);
  const destination = { stateRoot: join(f.root, "v55-moved-state"), artifactRoot: join(f.root, "v55-moved-artifacts") };
  const request = plan(f.workspace, destination);
  const source = new DatabaseSync(f.authorityPath, { readOnly: true });
  try { assert.equal(source.prepare("PRAGMA user_version").get()?.user_version, 55); }
  finally { source.close(); }
  const outcome = await relocate(f.workspace, request.commandId);
  assert.equal(outcome.generation, 1);
  const reopened = acquireSharedRuntimeAdmission(f.workspace);
  try {
    assert.equal(reopened.stateRoot, destination.stateRoot);
    const database = AuthorityDatabase.open(reopened, { path: join(destination.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "offline-relocation-v55-readback" }, clock);
    try { assert.equal(database.getMeta().schemaVersion, 56); }
    finally { database.close(); }
    const manifests = readdirSync(join(destination.stateRoot, "backups", "authority"))
      .filter(name => name.endsWith(".manifest.json"))
      .map(name => parseBackupManifestFile(join(destination.stateRoot, "backups", "authority", name)));
    assert.ok(manifests.some(manifest => manifest.schemaVersion === 55));
    assert.ok(manifests.some(manifest => manifest.schemaVersion === 56));
  } finally { reopened.release(); }
});

it.each(["afterNativePublish", "afterActivationIntent", "beforeActivationTransaction", "afterActivationWrite",
  "afterVerifiedStage", "afterFence",
  "afterRetention", "afterSwitch"] as const)("resumes an exact both-root relocation interrupted %s", async fault => {
  const f = await installation();
  const destination = { stateRoot: join(f.root, `resumed-state-${fault}`),
    artifactRoot: join(f.root, `resumed-artifacts-${fault}`) };
  const request = plan(f.workspace, destination);
  const outcome = await interruptedRelocation(f.workspace, request.commandId, fault);
  assert.equal(outcome.generation, 1);
  const admission = acquireSharedRuntimeAdmission(f.workspace);
  try {
    assert.equal(admission.stateRoot, destination.stateRoot);
    assert.equal(admission.artifactRoot, destination.artifactRoot);
    assert.equal(existsSync(join(destination.artifactRoot, `${f.artifact.sha256}.artifact`)), true);
  } finally { admission.release(); }
});

it("resumes artifact-only relocation after verified final backup, preserving one exact plan", async () => {
  const f = await installation();
  const destination = { stateRoot: f.source.stateRoot, artifactRoot: join(f.root, "artifact-resumed") };
  const request = plan(f.workspace, destination);
  const outcome = await interruptedRelocation(f.workspace, request.commandId, "afterFinalBackup");
  assert.equal(outcome.generation, 1);
  const admission = acquireSharedRuntimeAdmission(f.workspace);
  try {
    assert.equal(admission.stateRoot, f.source.stateRoot);
    assert.equal(admission.artifactRoot, destination.artifactRoot);
    assert.equal(existsSync(join(destination.artifactRoot, `${f.artifact.sha256}.artifact`)), true);
  } finally { admission.release(); }
});
