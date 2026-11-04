import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createCanonicalCredentials, createStoppedProtectedSettingsStore } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { authenticateDocument, createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { inspectProtectedSettingsSource, STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/backend/storage/configuration/protected-settings-upgrade.js";
import { upgradeProtectedSettings } from "../../../../src/backend/storage/maintenance/protected-settings-upgrade.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

async function priorProfile() {
  const profile = await createBoundProfileFixture(), canonical = createCanonicalCredentials(profile.admission);
  const frame = canonical.readRecord("protected"); assert.ok(frame);
  const current = authenticateDocument(frame.value), at = systemClock.now().toISOString();
  const receipt = { commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "c".repeat(64),
    expectedRevision: current.record.revision, protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH };
  const timekeeper = { valueId: randomUUID(), value: "Old Fixture Signer", updatedAt: at };
  const pseudonym = { valueId: randomUUID(), value: { keyHex: "b".repeat(64), keyGeneration: "activity-person-upgrade" }, updatedAt: at };
  const prior = inspectProtectedSettingsSource({ ...current, schemaVersion: 4,
    record: { ...current.record, schemaVersion: 1, revision: current.record.revision + 1,
      protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH,
      entries: { ...current.record.entries, timekeeperName: timekeeper, activityPersonPseudonym: pseudonym }, lastApplied: receipt },
    history: [...current.history.map(entry => ({ ...entry, receipt: { ...entry.receipt, protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH } })),
      { receipt: { ...receipt, updatedAt: at }, marked: { timekeeperName: { set: "<set>" }, activityPersonPseudonym: { set: "<set>" } },
        setValueIds: { timekeeperName: timekeeper.valueId, activityPersonPseudonym: pseudonym.valueId } }],
    latestRequest: { kind: "apply", request: { ...receipt, updatedAt: at,
      entries: { timekeeperName: { set: timekeeper.value }, activityPersonPseudonym: { set: pseudonym.value } } } } });
  const saved = canonical.replaceRecord("protected", frame.revision, prior);
  assert.equal(saved.revision, prior.record.revision);
  assert.throws(() => createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot }).read(), { code: "CREDENTIAL_CONVERSION_REQUIRED" });
  return { profile, prior, timekeeper, pseudonym };
}

it("backs up stopped authority before converting credentials and preserves write evidence across reopen", async () => {
  const { profile, prior, timekeeper, pseudonym } = await priorProfile();
  const operation = profile.machine.acquireOfflineMaintenance();
  const owner = profile.machine.admitStoppedProfileSettingsUpgrade(profile.admission.profileBinding.profileId, operation);
  const root = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot), backupDirectory = join(profile.stateRoot, "backups", "authority");
  try {
    const inspector = createStoppedProtectedSettingsStore(owner), source = inspector.read(); assert.ok(source);
    const before = readFileSync(join(profile.stateRoot, "credentials", "protected.json"));
    await assert.rejects(inspector.convert(source, systemClock.now().toISOString()), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(join(profile.stateRoot, "credentials", "protected.json")), before);
    if (process.platform === "win32") {
      await assert.rejects(upgradeProtectedSettings(owner, profileBrowserClosure, operation, systemClock, root), { code: "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE" });
      assert.deepEqual(readFileSync(join(profile.stateRoot, "credentials", "protected.json")), before);
      assert.equal(existsSync(backupDirectory), false);
      assert.equal(inspector.read()?.revision, source.revision);
      return;
    }
    assert.equal(await upgradeProtectedSettings(owner, profileBrowserClosure, operation, systemClock, root), "upgraded");
    const frame = createStoppedProtectedSettingsStore(owner).read(); assert.ok(frame);
    const document = authenticateDocument(frame.value);
    assert.equal(frame.revision, prior.record.revision + 1);
    assert.deepEqual(document.record.entries.ucpathUserId, prior.record.entries.ucpathUserId);
    assert.deepEqual(document.record.entries.ucpathPassword, prior.record.entries.ucpathPassword);
    assert.equal(Object.hasOwn(document.record.entries, "timekeeperName"), false);
    assert.equal(Object.hasOwn(document.record.entries, "activityPersonPseudonym"), false);
    assert.deepEqual(document.history.slice(0, prior.history.length), prior.history);
    assert.equal(document.retiredLegacy.valueIds.includes(timekeeper.valueId), true);
    assert.equal(document.retiredLegacy.valueIds.includes(pseudonym.valueId), true);
    const manifests = readdirSync(backupDirectory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(manifests.length, 1);
    const manifest = verifyStoppedBackupManifestAtPath(owner, join(backupDirectory, manifests[0]));
    assert.equal(manifest.manifest.profileId, owner.profileBinding.profileId);
    assert.equal(manifest.manifest.manifestVersion, 4);
    const convertedBytes = readFileSync(join(profile.stateRoot, "credentials", "protected.json"));
    assert.equal(await upgradeProtectedSettings(owner, profileBrowserClosure, operation, systemClock, root), "current");
    assert.deepEqual(readFileSync(join(profile.stateRoot, "credentials", "protected.json")), convertedBytes);
    assert.deepEqual(readdirSync(backupDirectory).filter(name => name.endsWith(".manifest.json")), manifests);
  } finally { owner.release(); operation.release(); await profile.close(); }
});

it("leaves the old authenticated source unchanged when the required backup cannot be created", async () => {
  const { profile } = await priorProfile(), path = join(profile.stateRoot, "credentials", "protected.json");
  const before = readFileSync(path), backups = join(profile.stateRoot, "backups");
  assert.equal(existsSync(backups), false);
  writeFileSync(backups, "backup directory blocked by fixture", { mode: 0o600 });
  const operation = profile.machine.acquireOfflineMaintenance();
  const owner = profile.machine.admitStoppedProfileSettingsUpgrade(profile.admission.profileBinding.profileId, operation);
  try {
    await assert.rejects(upgradeProtectedSettings(owner, profileBrowserClosure, operation, systemClock, join(profile.workspace, rebuildRuntimeIsolation.processLockRoot)));
    assert.deepEqual(readFileSync(path), before);
  } finally { owner.release(); operation.release(); await profile.close(); }
});

it("authenticates an already-current profile without backup or credential mutation", async () => {
  const profile = await createBoundProfileFixture(), path = join(profile.stateRoot, "credentials", "protected.json");
  const before = readFileSync(path), operation = profile.machine.acquireOfflineMaintenance();
  const owner = profile.machine.admitStoppedProfileSettingsUpgrade(profile.admission.profileBinding.profileId, operation);
  try {
    assert.equal(await upgradeProtectedSettings(owner, profileBrowserClosure, operation, systemClock, join(profile.workspace, rebuildRuntimeIsolation.processLockRoot)), "current");
    assert.deepEqual(readFileSync(path), before);
    assert.equal(existsSync(join(profile.stateRoot, "backups")), false);
  } finally { owner.release(); operation.release(); await profile.close(); }
});

it("keeps ordinary backup admissions outside the credential conversion door", async () => {
  const profile = await createBoundProfileFixture(), operation = profile.machine.acquireOfflineMaintenance();
  try {
    assert.throws(() => createStoppedProtectedSettingsStore(profile.admission), /protected-settings-upgrade-stopped-owner-required/u);
    if (process.platform === "win32") {
      assert.throws(() => profile.machine.admitStoppedProfileBackup(profile.admission.profileBinding.profileId, operation), { code: "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE" });
    } else {
      const backup = profile.machine.admitStoppedProfileBackup(profile.admission.profileBinding.profileId, operation);
      try { assert.throws(() => createStoppedProtectedSettingsStore(backup), /protected-settings-upgrade-stopped-owner-required/u); }
      finally { backup.release(); }
    }
  } finally { operation.release(); await profile.close(); }
});
