import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { upgradeReadyProfileStorage, backupStoppedAuthority } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { SettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { readSettings, readBootSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { migrationTableNames, SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { FingerprintSchema, IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createProfileVerifiers } from "../../../../src/backend/storage/configuration/verifier-store.js";
import { InstanceSelectionSchema } from "../../../../src/models/run/envelope.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectActiveRunSettings, selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const hostFacts = { primaryDisplay: null };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function readyBoundEight(work: "idle" | "queued" = "idle", sourceVersion: 8 | 9 | 10 = 8) {
  const profile = await createBoundProfileFixture();
  const binding = profile.admission.profileBinding;
  const credentials = boundProfileCredentials(profile.admission);
  const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
    undefined, undefined, undefined, credentials);
  const patch = { "actor.label": { set: "ready-upgrade-proof" } };
  let command: ReturnType<typeof SettingsCommandRequestSchema.parse>;
  let saved: ReturnType<typeof executeSettingsCommand>;
  try {
    const resolveSettings = (value: unknown) => resolveConfigWithProvenance(value, hostFacts, systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    database.withAuthorityTransaction(repositories => {
      const initial = readBootSettings(repositories);
      assert.equal(repositories.runtimeConfig.get(), undefined);
      const resolved = resolveSettings(initial.settings);
      repositories.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: initial.revision,
        fingerprint: resolved.fingerprint, capturedAt: systemClock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID,
        config: resolved.config, provenance: resolved.provenance });
    });
    command = SettingsCommandRequestSchema.parse({ commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: systemClock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "settings-surface", target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const settings = createSettingsApplicationExecutor(resolveSettings, credentials);
    saved = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings }, command);
    assert.equal(saved.state, "applied");
    const nextPatch = { "actor.label": { set: "ready-upgrade-proof-next" } };
    const nextCommand = { ...command, commandId: randomUUID(), target: { expectedRevision: readSettings(database.authority).revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(nextPatch), patch: nextPatch } };
    assert.equal(executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings }, nextCommand).state, "applied");
    if (work === "queued") {
      const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: systemClock });
      const service = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID },
        publishQueued: run => { emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Upgrade custody proof" })); } });
      const snapshot = selectActiveRunSettings(database.authority);
      const resolvedInstance = InstanceSelectionSchema.parse(QUEUED_RUN.envelope.resolvedInstance);
      assert.ok(resolvedInstance);
      const run = requireLifecycleApplied(service.create({ commandId: randomUUID(), code: "pl", matchKey: "ready-upgrade-custody",
        workflow: "person-lookup", descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
        configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint,
        resolvedInstance, input: QUEUED_RUN.input, priority: "bulk", shape: "single", dryRun: true,
        runtimeConfig: selectRunRuntime(database.authority) }));
      assert.equal(run.lifecycle.state, "queued");
    }
  } finally { database.close(); }
  const row = profile.machine.readProfileRegistry().profiles.find(value => value.profileId === binding.profileId);
  assert.ok(row);
  assert.equal(row.lifecycle, "ready");
  assert.equal(row.credentialState, "saved");
  assert.ok(existsSync(join(profile.machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`)));
  assert.equal(profile.machine.readProfileRegistry().profiles.find(value => value.profileId === binding.profileId)?.credentialState, "saved");
  profile.admission.release();
  const raw = new DatabaseSync(profile.path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    for (const table of ["assistant_actions", "assistant_chats", "assistant_grants"]) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    raw.exec("BEGIN EXCLUSIVE");
    if (sourceVersion < 10) {
      const editorDdl = SQLITE_MIGRATIONS[0].statements.join("\n").match(/CREATE TABLE explorer_overrides \([\s\S]*?\n\) STRICT;/u)?.[0];
      assert.ok(editorDdl);
      raw.exec(editorDdl);
    }
    if (sourceVersion < 9) raw.exec("DROP TABLE assistant_model_preference");
    raw.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(sourceVersion);
    raw.exec(`PRAGMA user_version=${sourceVersion}; COMMIT`);
    const prior = inspectNativeAuthority(raw, sourceVersion);
    assert.equal(prior.schemaVersion, sourceVersion);
    assert.equal(prior.installationId, binding.installationId);
    assert.equal(prior.profileId, binding.profileId);
  } finally { raw.close(); }
  const claim = binding.profileId;
  const processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  return { ...profile, binding, claim, command, saved, processLockRoot,
    acquireRestore: () => profile.machine.acquireOfflineMaintenance() };
}

function rawEight(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(migrationTableNames(8).filter(table => table !== "explorer_overrides").map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { raw.close(); }
}

it("upgrades a genuinely READY bound profile with unchanged historical rows, credentials and replay", async () => {
  const f = await readyBoundEight();
  try {
    const before = rawEight(f.path), protectedBefore = digest(join(f.stateRoot, "credentials", "protected.json"));
    const machineBefore = storageTree(join(f.machine.stateRoot, "machine"));
    assert.ok((before.commands?.length ?? 0) >= 2);
    assert.ok((before.command_audits?.length ?? 0) >= 2);
    assert.throws(() => f.machine.admitProfile(f.claim), { message: "profile-database-schema-mismatch" });
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: true, hostFacts }, systemClock)).state, "planned");
    assert.deepEqual(rawEight(f.path), before);
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: 8, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    const after = rawEight(f.path);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else assert.deepEqual(after[table], rows);
    }
    assert.equal(after.database_upgrades?.length, (before.database_upgrades?.length ?? 0) + 1);
    assert.equal(digest(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
    assert.deepEqual(storageTree(join(f.machine.stateRoot, "machine")), machineBefore);
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try {
      const credentials = createCredentialStore({ admission: fresh, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${f.binding.profileId}.json`) });
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock, undefined, undefined, undefined, credentials);
      try {
        assert.equal(database.authority.assistantModelPreference.get(), undefined);
        for (const table of ["assistant_grants", "assistant_chats", "assistant_actions"]) {
          const raw = new DatabaseSync(f.path, { readOnly: true });
          try { assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0); } finally { raw.close(); }
        }
        const replay = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID },
          settings: createSettingsApplicationExecutor(() => { throw new Error("ready-upgrade-replay-reapplied"); }, credentials) }, f.command);
        assert.deepEqual(replay, { ...f.saved, state: "already-applied" });
      } finally { database.close(); }
    } finally { fresh.release(); }
    const currentBefore = storageTree(f.stateRoot);
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.binding.profileId, { plan: false, hostFacts }, systemClock)).state, "already-upgraded");
    assert.deepEqual(storageTree(f.stateRoot), currentBefore);
  } finally { await f.close(); }
});

it("confines the issued READY purpose and its verified backup copy to their exact doors", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  let owner: RuntimeAdmission | undefined;
  try {
    const issued = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
    owner = issued;
    assert.equal(owner.isProfileInitialization(), false);
    assert.throws(() => issued.assertProfileInitialization(), { message: "profile-initialization-authority-required" });
    assert.throws(() => issued.assertCredentialRead(), { message: "profile-stopped-upgrade-credential-read-refused" });
    assert.throws(() => issued.assertWritable(), { message: "profile-stopped-upgrade-runtime-refused" });
    assert.throws(() => issued.assertExclusive(), { message: "profile-stopped-upgrade-exclusive-refused" });
    assert.throws(() => issued.assertReadOnlyAuthorityDatabase(":memory:"), { message: "profile-stopped-upgrade-path-refused" });
    assert.throws(() => issued.assertReadOnlyAuthorityDatabase(join(f.stateRoot, "credentials", "protected.json")), { message: "profile-stopped-upgrade-path-refused" });
    assert.throws(() => issued.assertAuthorityBackupWrite(f.path), { message: "profile-stopped-upgrade-backup-refused" });
    assert.throws(() => issued.admitProfile(f.claim), { message: "profile-stopped-upgrade-runtime-refused" });
    assert.throws(() => issued.forStoppedProfileUpgrade(), { message: "profile-stopped-upgrade-exclusive-refused" });
    assert.throws(() => AuthorityDatabase.open(issued, { path: f.path, migrationOwner: "selected-profile-runtime" }), { message: "profile-bound-authority-required" });
    assert.throws(() => AuthorityDatabase.initializeProfile(issued), { message: "profile-initialization-authority-required" });
    assert.throws(() => issued.verifiedReadOnlyCopy(f.path, digest(f.path)), { message: "profile-stopped-upgrade-copy-refused" });
    assert.throws(() => issued.stoppedStagedAuthority(join(f.stateRoot, `.restore-${randomUUID()}.sqlite.tmp`)), { message: "profile-stopped-upgrade-exclusive-refused" });
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, issued, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, issued, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(issued, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const copy = issued.verifiedReadOnlyCopy(verified.backupPath, verified.manifest.sha256);
    try {
      assert.equal(inspectAuthorityBackupReadOnly(copy, verified.backupPath, 8).schemaVersion, 8);
      assert.throws(() => copy.assertReadOnlyAuthorityDatabase(f.path), { message: "profile-stopped-upgrade-path-refused" });
      assert.throws(() => copy.assertCredentialRead(), { message: "profile-stopped-upgrade-credential-read-refused" });
      assert.throws(() => copy.verifiedReadOnlyCopy(verified.backupPath, verified.manifest.sha256), { message: "profile-stopped-upgrade-copy-refused" });
      issued.release();
      assert.throws(() => copy.assertLive(), { message: "runtime-admission: missing or released admission" });
    } finally { copy.release(); }
  } finally { owner?.release(); restore.release(); await f.close(); }
});

it("refuses malformed or foreign profile selectors and copied, foreign or released restore custody without source effects", async () => {
  const f = await readyBoundEight(), foreign = await readyBoundEight(), restore = f.acquireRestore(), other = foreign.acquireRestore();
  try {
    const before = storageTree(f.stateRoot);
    // @ts-expect-error The runtime boundary must also refuse an untyped selector.
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, { profileId: f.claim }, restore, systemClock, hostFacts), /Invalid input: expected string/u);
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, { ...restore }, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, other, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, foreign.claim, restore, systemClock, hostFacts), { message: "profile-storage-claim-unregistered" });
    restore.release();
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { restore.release(); other.release(); await foreign.close(); await f.close(); }
});

it("refuses a genuine live server role and leaves every profile byte unchanged", async () => {
  const f = await readyBoundEight();
  const server = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid }, systemClock);
  try {
    const before = storageTree(f.stateRoot);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { server.release(); await f.close(); }
});

it("refuses a genuine canonical queued run despite stopped global process roles", async () => {
  const f = await readyBoundEight("queued");
  try {
    const rows = rawEight(f.path), before = storageTree(f.stateRoot);
    assert.ok((rows.runs?.length ?? 0) > 0);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { message: "credential-maintenance-custody-unproved" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.deepEqual(rawEight(f.path), rows);
  } finally { await f.close(); }
});

it("revokes the exact READY purpose on same-byte main-file substitution", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = readFileSync(f.path), replacement = join(f.stateRoot, "replacement.sqlite");
    copyFileSync(f.path, replacement); renameSync(replacement, f.path);
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
    assert.deepEqual(readFileSync(f.path), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("requires a real verified own backup before changing the ready source schema", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const inspection = AuthorityDatabase.inspectStoppedUpgrade(owner, f.path, f.processLockRoot, systemClock);
    const before = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock, inspection.authorityContentFingerprint),
      { message: "upgrade-verified-backup-required" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, owner, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, owner, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(owner, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const backedBefore = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock,
      inspection.authorityContentFingerprint, { ...verified, manifest: { ...verified.manifest, sha256: FingerprintSchema.parse("0".repeat(64)) } }, verifyStoppedBackupManifestAtPath),
    { message: "profile-stopped-upgrade-backup-changed" });
    assert.deepEqual(storageTree(f.stateRoot), backedBefore);
    const original = readFileSync(verified.backupPath), sourceBefore = rawEight(f.path);
    try {
      const changed = Buffer.from(original); changed[0] = (changed[0] ?? 0) ^ 1;
      writeFileSync(verified.backupPath, changed);
      assert.throws(() => verifyStoppedBackupManifestAtPath(owner, verified.manifestPath),
        { message: "profile-maintenance-backup-digest-mismatch" });
      assert.deepEqual(rawEight(f.path), sourceBefore);
    } finally { writeFileSync(verified.backupPath, original); }
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("refuses changed source content inside the real migration transaction and cannot revive its purpose", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const inspection = AuthorityDatabase.inspectStoppedUpgrade(owner, f.path, f.processLockRoot, systemClock);
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, owner, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, owner, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(owner, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const raw = new DatabaseSync(f.path);
    const original = raw.prepare("SELECT updated_at FROM database_states WHERE id=1").get()?.updated_at;
    assert.ok(typeof original === "string");
    try { assert.equal(raw.prepare("UPDATE database_states SET updated_at=? WHERE id=1").run(new Date(Date.now() + 1000).toISOString()).changes, 1); }
    finally { raw.close(); }
    const before = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock,
      inspection.authorityContentFingerprint, verified, verifyStoppedBackupManifestAtPath), { message: "profile-stopped-upgrade-source-changed" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    const restored = new DatabaseSync(f.path);
    try { assert.equal(restored.prepare("UPDATE database_states SET updated_at=? WHERE id=1").run(original).changes, 1); }
    finally { restored.close(); }
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("revokes READY custody on a same-byte key replacement even after exact original custody returns", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const key = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const saved = join(f.workspace, "owned-key-preimage");
  let moved = false;
  try {
    const before = readFileSync(key);
    renameSync(key, saved); moved = true; copyFileSync(saved, key);
    assert.throws(() => owner.assertLive(), { message: "credential-key-custody-changed" });
    assert.deepEqual(readFileSync(key), before);
    renameSync(saved, key); moved = false;
    assert.equal(f.machine.readProfileRegistry().profiles.find(value => value.profileId === f.binding.profileId)?.credentialState, "saved");
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    if (moved) renameSync(saved, key);
    owner.release(); restore.release(); await f.close();
  }
});

it("excludes registry session mutation while READY maintenance custody is held", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = storageTree(f.stateRoot), registry = f.machine.readProfileRegistry();
    assert.throws(() => f.machine.publishProfileRegistry(registry, { ...registry, activeProfileId: null, sessionGeneration: registry.sessionGeneration + 1 }), /offline-maintenance-busy/u);
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    owner.assertLive();
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("refuses loss of the authenticated never-erased head instead of treating it as a default", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const journal = join(f.machine.stateRoot, "machine", "erasures", `${f.binding.profileId}.json`);
  const existed = existsSync(dirname(journal));
  let planted = false;
  try {
    assert.equal(existsSync(journal), false); assert.equal(existsSync(`${journal}.authority`), false);
    const before = storageTree(f.stateRoot);
    mkdirSync(dirname(journal), { recursive: true, mode: 0o700 });
    writeFileSync(journal, "{}", { mode: 0o600, flag: "wx" }); planted = true;
    assert.throws(() => owner.assertLive(), { message: "credential-erasure-head-missing" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally {
    if (planted) unlinkSync(journal);
    if (!existed) { assert.deepEqual(readdirSync(dirname(journal)), []); rmdirSync(dirname(journal)); }
    owner.release(); restore.release(); await f.close();
  }
});

it("excludes a new signup operation while READY maintenance custody is held", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = storageTree(f.stateRoot);
    const emailKey = createProfileVerifiers(f.machine.stateRoot).emailKeyFor(`${randomUUID()}@example.invalid`);
    const registry = f.machine.readProfileRegistry();
    assert.throws(() => f.machine.beginProfileSignUp({ firstName: "Upgrade", lastName: "Pending", createdAt: IsoInstantSchema.parse(systemClock.now().toISOString()),
      emailKey, commandFingerprint: "a".repeat(64) }), /offline-maintenance-busy/u);
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    owner.assertLive();
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("cannot recreate a ready source removed after real stopped inspection and before native writable open", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const saved = join(f.workspace, "owned-source-preimage");
  const inspect = AuthorityDatabase.inspectStoppedUpgrade.bind(AuthorityDatabase);
  let crossed = false;
  const spy = vi.spyOn(AuthorityDatabase, "inspectStoppedUpgrade").mockImplementation((actual, path, root, clock) => {
    assert.equal(actual, owner); assert.equal(path, f.path); assert.equal(root, f.processLockRoot);
    const result = inspect(actual, path, root, clock);
    assert.equal(result.schemaVersion, 8);
    renameSync(f.path, saved); crossed = true;
    return result;
  });
  try {
    const before = storageTree(f.stateRoot);
    delete before["state.db"];
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock),
      error => error instanceof Error && Reflect.get(error, "code") === "ERR_SQLITE_ERROR" && Reflect.get(error, "errcode") === 14);
    assert.equal(crossed, true);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    spy.mockRestore();
    if (crossed) renameSync(saved, f.path);
    owner.release(); restore.release(); await f.close();
  }
});

it("refuses an unowned copy before issuing any READY migration or backup authority", async () => {
  const f = await readyBoundEight();
  try {
    writeFileSync(join(f.stateRoot, "owned-unclassified-copy"), "{}", { mode: 0o600, flag: "wx" });
    const before = storageTree(f.stateRoot);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { message: "profile-inventory-unowned-entry" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { await f.close(); }
});

it("revokes READY custody on exact artifact-root ancestry substitution", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const artifacts = join(f.stateRoot, "artifacts"), saved = join(f.workspace, "owned-artifacts-preimage");
  let moved = false;
  try {
    assert.deepEqual(readdirSync(artifacts), []);
    const before = storageTree(f.stateRoot);
    renameSync(artifacts, saved); moved = true; mkdirSync(artifacts, { mode: 0o700 });
    assert.throws(() => owner.assertLive(), { message: "directory-integrity: credential ancestor identity changed" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    rmdirSync(artifacts); renameSync(saved, artifacts); moved = false;
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    if (moved) { assert.deepEqual(readdirSync(artifacts), []); rmdirSync(artifacts); renameSync(saved, artifacts); }
    owner.release(); restore.release(); await f.close();
  }
});

it.each([9, 10] as const)("upgrades supported schema %s to the current version with exact source proof", async sourceVersion => {
  const f = await readyBoundEight("idle", sourceVersion);
  try {
    const before = rawEight(f.path);
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: sourceVersion, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    const after = rawEight(f.path);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else assert.deepEqual(after[table], rows);
    }
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try { assert.equal(fresh.profileMaintenanceSchemaVersion(), CURRENT_AUTHORITY_SCHEMA_VERSION); }
    finally { fresh.release(); }
  } finally { await f.close(); }
});
