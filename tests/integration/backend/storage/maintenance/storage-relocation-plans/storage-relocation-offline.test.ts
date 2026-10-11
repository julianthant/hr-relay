import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { ArtifactRefSchema } from "../../../../../../src/models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { createStorageRelocationPlanReader } from "../../../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { AppSettingsSchema } from "../../../../../../src/models/config/app-settings.js";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { ConfigSnapshotRecordSchema } from "../../../../../../src/models/config/snapshot.js";
import { NotificationRecordSchema } from "../../../../../../src/models/notifications/notifications.js";
import { createServerVerifiedArtifactReader } from "../../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "../../../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireSharedRuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { cleanupFixtureRoots, clock, durableSnapshot, installation, interruptedRelocation, leaveStoppedWal,
  plan, relocate, WAL_NOTIFICATION_TITLE } from "../../../../../support/helpers/storage/storage-relocation-fixture.js";

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

it("prepares a genuine offline relocation fixture with settings, protected data and managed artifacts", async () => {
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
    } finally { database.close(); }
  } finally { admission.release(); }
  const walNotificationId = leaveStoppedWal(f.workspace, f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  assert.equal(before.notifications.length, 1);
  const notification = NotificationRecordSchema.parse(JSON.parse(before.notifications[0] ?? "null") as unknown);
  assert.equal(notification.notificationId, walNotificationId);
  assert.equal(notification.title, WAL_NOTIFICATION_TITLE);
  assert.equal(before.appSettings.length, 1);
  assert.equal(before.commands.length, 3);
  assert.equal(before.audits.length, 3);
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
    const artifactReader = createServerVerifiedArtifactReader({ admission: afterState });
    await artifactReader.ready;
    await artifactReader.verify(f.artifact);
    assert.equal(existsSync(join(stateDestination, "scratch")), true);
  } finally { afterState.release(); }
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
