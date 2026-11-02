import { removeSchema15RunPause, removeEmptyExclusiveSessionLeaseFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { restoreEmptyPreMasterWorkbookFixture } from '../../../support/helpers/workbooks/pre-master-schema.js';
import { restorePreReadingArtifactRetention } from "../../../support/fixtures/storage/pre-reading-artifact-retention.js";
import { DatabaseSync } from "node:sqlite";
import { inspectOpenDatabase } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { StoppedAuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it,vi } from "vitest";
import { z } from "zod";
import { prepareApplicationDataWorkspace,upgradeRegisteredPersonStores,composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { seedRegisteredSignupBrowser } from "../../../support/helpers/browser/browser-roots.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { fixedLayoutEntries,fixedLayoutOutputPaths,readFixedLayoutIntent } from "../../../../src/backend/storage/maintenance/fixed-layout.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createCredentialStore,stoppedProfileOwnsCredentialCommand } from "../../../../src/backend/storage/configuration/credential-store.js";
import { SETTINGS_SCHEMA_HASH,derivePersistedSettingsFingerprint,deriveRawSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { SettingsCommandRequestSchema,deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials,createBoundProfileFixture,readAuthenticatedCredentialFixture,syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { assertRuntimeLifetimeHeld } from "../../../support/helpers/backend/runtime-lifetime.js";

const hostFacts = { primaryDisplay: null };
async function predecessor(explicitBrowserRoot = false, sourceVersion: 10 | 11 | 12 | 13 | 14 | typeof CURRENT_AUTHORITY_SCHEMA_VERSION = CURRENT_AUTHORITY_SCHEMA_VERSION) {
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "fixed-layout-fixture" }, systemClock,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  const resolve = (settings: unknown) => resolveConfigWithProvenance(settings, hostFacts, systemClock, { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
  const now = systemClock.now().toISOString();
  try {
    database.withAuthorityTransaction(repositories => {
      const initial = resolve({});
      repositories.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1, fingerprint: initial.fingerprint,
        config: initial.config, provenance: initial.provenance, capturedAt: now, capturedBy: LOCAL_OPERATOR_ACTOR_ID });
      const settings = { actor: { label: "Retained layout operator" }, paths: { reportsDir: join(profile.workspace, "chosen-reports"),
        ...(explicitBrowserRoot ? { browserProfileRoot: join(profile.stateRoot, "browsers") } : {}) } };
      const patch = { "actor.label": { set: settings.actor.label }, "paths.reportsDir": { set: settings.paths.reportsDir },
        ...(explicitBrowserRoot ? { "paths.browserProfileRoot": { set: settings.paths.browserProfileRoot } } : {}) };
      const request = SettingsCommandRequestSchema.parse({ commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
        requestedAt: now, requestedBy: LOCAL_OPERATOR_ACTOR_ID, target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch } });
      const resolved = resolve(settings), configSnapshotId = randomUUID(), settingsFingerprint = derivePersistedSettingsFingerprint(settings), auditId = randomUUID();
      const target = { family: "settings", revision: 2 };
      repositories.commands.insert(request);
      repositories.configSnapshots.insert({ configSnapshotId, revision: 2, fingerprint: resolved.fingerprint, config: resolved.config,
        provenance: resolved.provenance, capturedAt: now, capturedBy: LOCAL_OPERATOR_ACTOR_ID });
      repositories.runtimeConfig.activate({ settingsRevision: 2, settingsFingerprint, configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: now });
      repositories.commandAudits.insert({ auditId, request, completedAt: now, result: { state: "applied", commandId: request.commandId,
        affectedTargets: [target], settingsRevision: 2, settingsFingerprint, restartRequired: false },
        versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [] });
      repositories.settingsCurrent.advance({ revision: 2, settings, settingsFingerprint, commandId: request.commandId,
        commandFingerprint: deriveSettingsCommandFingerprint(request), auditId, committedAt: now });
    });
    const binding = profile.admission.profileBinding, active = database.authority.runtimeConfig.get(); assert.ok(active);
    const currentSnapshot = database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(currentSnapshot);
    const protectedCommandId = z.looseObject({ record: z.looseObject({ lastApplied: z.looseObject({ commandId: z.uuid() }) }) })
      .parse(readAuthenticatedCredentialFixture(profile.machine.stateRoot, binding.profileId)).record.lastApplied.commandId;
    assert.throws(() => stoppedProfileOwnsCredentialCommand(profile.admission, "layout", protectedCommandId), /fixed-layout-admission-required/u);
    assert.throws(() => stoppedProfileOwnsCredentialCommand(profile.admission, "startup-recovery", protectedCommandId), /startup-recovery-admission-required/u);
    const before = { binding, protectedCommandId, meta: database.getMeta(), registry: profile.machine.readProfileRegistry(), snapshots: database.readProfileResourceCustody().configSnapshots,
      settings: readSettings(database.authority), config: currentSnapshot.config };
    database.close();
    mkdirSync(join(profile.stateRoot, "files", "downloads"), { recursive: true, mode: 0o700 });
    writeFileSync(join(profile.stateRoot, "files", "downloads", "preserved.txt"), "ordinary output bytes", { mode: 0o600 });
    const credentials = fixedLayoutEntries(join(profile.stateRoot, "credentials"));
    const keys = fixedLayoutEntries(join(profile.machine.stateRoot, "machine", "credential-keys"));
    await profile.closeController();
    if (sourceVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
      const native = new DatabaseSync(profile.path);
      try {
        native.exec("BEGIN EXCLUSIVE");
        removeSchema15RunPause(native);
        if (sourceVersion < 14) removeEmptyExclusiveSessionLeaseFixture(native);
        if (sourceVersion < 13) restoreEmptyPreMasterWorkbookFixture(native);
        if (sourceVersion < 12) restorePreReadingArtifactRetention(native);
        native.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(sourceVersion);
        native.exec(`PRAGMA user_version=${sourceVersion}; COMMIT`);
        assert.equal(inspectOpenDatabase(native, sourceVersion).schemaVersion, sourceVersion);
      } finally { native.close(); }
    }
    return { profile, before, credentials, keys };
  } catch (error) { database.close(); await profile.close(); throw error; }
}

it.each([[false, CURRENT_AUTHORITY_SCHEMA_VERSION], [true, CURRENT_AUTHORITY_SCHEMA_VERSION], [false, 11], [true, 11], [false, 10], [false, 12], [false, 13], [true, 13], [false, 14], [true, 14]] as const)("converts the stopped default layout, retains identities/settings/key inodes, and keeps one listener (saved browser: %s, schema: %s)", async (explicitBrowser, sourceVersion) => {
  const f = await predecessor(explicitBrowser, sourceVersion), target = realpathSync(mkdtempSync(join(tmpdir(), "relay-fixed-target-")));
  const lifetime = await RuntimeLifetimeLock.acquire(0), port = lifetime.port;
  const activate = AuthorityDatabase.publishFixedLayoutActivation.bind(AuthorityDatabase);
  const publication = vi.spyOn(AuthorityDatabase, "publishFixedLayoutActivation").mockImplementation(admission => {
    assert.throws(() => admission.assertWritable(), /fixed-layout-runtime-refused/u);
    assert.throws(() => admission.assertCredentialRead(), /fixed-layout-credential-read-refused/u);
    assert.throws(() => admission.assertArtifactRoot(admission.artifactRoot), /fixed-layout-artifact-mutation-refused/u);
    assert.throws(() => admission.assertBrowserRegistryCustody(), /fixed-layout-browser-mutation-refused/u);
    assert.equal(stoppedProfileOwnsCredentialCommand(admission, "layout", f.before.protectedCommandId), true);
    assert.equal(stoppedProfileOwnsCredentialCommand(admission, "layout", randomUUID()), false);
    return activate(admission);
  });
  let machine: RuntimeAdmission | undefined, profile: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
  try {
    if (explicitBrowser) {
      const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.profile.workspace, lifetime);
      try {
        if (sourceVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
          await assert.rejects(stopped.forStoppedProfileLayout(profileBrowserClosure, f.before.binding.profileId, stopped.maintenanceOperation(), systemClock, hostFacts),
            /fixed-layout-current-schema-required/u);
        } else {
          const source = await stopped.forStoppedProfileLayout(profileBrowserClosure, f.before.binding.profileId, stopped.maintenanceOperation(), systemClock, hostFacts);
          try {
            assert.throws(() => source.assertWritable(), /profile-stopped-upgrade-runtime-refused/u);
            assert.throws(() => source.assertProfileMigration(f.profile.path, CURRENT_AUTHORITY_SCHEMA_VERSION), /fixed-layout-schema-mutation-refused/u);
            assert.throws(() => source.assertReadyStoppedProfileUpgradeOwner(stopped), /owner-required/u);
          } finally { source.release(); }
        }
      } finally { stopped.release(); }
    }
    const locatorPath = join(f.profile.workspace, ".tracker", "control", "locator.json");
    writeFileSync(locatorPath, JSON.stringify({ schemaVersion: 2, installationId: f.before.binding.installationId, generation: 0, stateRootGeneration: 0, artifactRootGeneration: 0,
      stateRoot: join(f.profile.workspace, ".tracker", "data"), artifactRoot: join(f.profile.workspace, ".tracker", "data", "artifacts") }));
    await prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts);
    assert.equal(lifetime.port, port); lifetime.assertWorkspace(target);
    await assertRuntimeLifetimeHeld(lifetime);
    assert.equal(readFixedLayoutIntent(target)?.phase, "complete");
    assert.equal(existsSync(join(f.profile.workspace, ".tracker", "control")), false);
    assert.equal(existsSync(join(f.profile.workspace, ".tracker", "data", ".runtime-source-fence.json")), true);
    assert.deepEqual(JSON.parse(readFileSync(join(target, ".tracker", "control", "locator.json"), "utf8")), { schemaVersion: 3, installationId: f.before.binding.installationId, generation: 0 });
    machine = acquireEntrypointAdmission(target, "exclusive", lifetime);
    assert.deepEqual(machine.readProfileRegistry(), f.before.registry);
    assert.deepEqual(fixedLayoutEntries(join(machine.stateRoot, "machine", "credential-keys")), f.keys);
    profile = machine.admitProfile(f.before.binding.profileId);
    assert.deepEqual(fixedLayoutEntries(join(profile.stateRoot, "credentials")), f.credentials);
    database = AuthorityDatabase.open(profile, { path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "fixed-layout-readback" }, systemClock,
      undefined, undefined, undefined, createCredentialStore({ admission: profile, stateRoot: profile.stateRoot }));
    assert.equal(database.getMeta().authorityGeneration, f.before.meta.authorityGeneration + 1);
    const directory = join(profile.stateRoot, "backups", "authority");
    const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"))
      .map(name => StoppedAuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8"))));
    assert.deepEqual(manifests.map(manifest => manifest.schemaVersion).sort(), sourceVersion === CURRENT_AUTHORITY_SCHEMA_VERSION ? [CURRENT_AUTHORITY_SCHEMA_VERSION] : [sourceVersion, CURRENT_AUTHORITY_SCHEMA_VERSION]);
    for (const manifest of manifests) {
      assert.equal(manifest.installationId, f.before.binding.installationId); assert.equal(manifest.profileId, f.before.binding.profileId);
      assert.equal(manifest.verification.quickCheck, "ok"); assert.equal(manifest.verification.foreignKeyViolations, 0);
    }
    const current = readSettings(database.authority), active = database.authority.runtimeConfig.get(); assert.ok(active);
    assert.equal(current.revision, 3); assert.equal(current.settings.actor?.label, f.before.settings.settings.actor?.label);
    assert.equal(current.settings.paths?.reportsDir, f.before.settings.settings.paths?.reportsDir);
    const outputPaths = fixedLayoutOutputPaths(f.before.settings.settings, f.before.config.paths, f.profile.stateRoot, profile.stateRoot);
    for (const key of ["downloadsDir", "onboardingDocsDir", "i9CheckTrackerPath"] as const) assert.equal(current.settings.paths?.[key], outputPaths[key]);
    const snapshot = database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(snapshot);
    assert.equal(snapshot.config.paths.stateRoot, profile.stateRoot); assert.equal(snapshot.config.paths.browserProfileRoot, join(profile.stateRoot, "browsers"));
    assert.equal(readFileSync(join(snapshot.config.paths.downloadsDir, "preserved.txt"), "utf8"), "ordinary output bytes");
    for (const prior of f.before.snapshots) assert.deepEqual(database.authority.configSnapshots.get(prior.configSnapshotId), prior);
    const owner = machine;
    assert.throws(() => RuntimeAdmission.forFixedLayoutProfile(owner, { operationId: randomUUID(), profileId: f.before.binding.profileId }), /claim-unissued/u);
    database.close(); database = undefined; profile.release(); profile = undefined; machine.release(); machine = undefined;
    if (!explicitBrowser && sourceVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) {
      const sourceControl = join(f.profile.workspace, ".tracker", "control");
      mkdirSync(sourceControl, { mode: 0o700 });
      try { await assert.rejects(prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts), /fixed-layout-two-installations-present/u); }
      finally { rmSync(sourceControl, { recursive: true }); }
      const journalPath = join(target, ".tracker", "fixed-layout.json"), journal = readFileSync(journalPath);
      rmSync(journalPath);
      try { await assert.rejects(prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts), /fixed-layout-two-installations-present/u); }
      finally { writeFileSync(journalPath, journal, { mode: 0o600 }); }
    }
    await prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts);
    assert.equal(readFixedLayoutIntent(target)?.phase, "complete");
  } finally { publication.mockRestore(); database?.close(); profile?.release(); machine?.release(); await lifetime.close(); await f.profile.close(); rmSync(target, { recursive: true, force: true }); }
});

it("resumes configuring at the next startup using the recorded backup and transaction identity", async () => {
  const f = await predecessor(true), target = realpathSync(mkdtempSync(join(tmpdir(), "relay-fixed-replay-")));
  let lifetime = await RuntimeLifetimeLock.acquire(0);
  const publish = vi.spyOn(AuthorityDatabase, "publishFixedLayoutActivation").mockImplementationOnce(() => { throw new Error("injected-before-layout-sql"); });
  try {
    await assert.rejects(prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts), /injected-before-layout-sql/u);
    publish.mockRestore();
    const pending = readFixedLayoutIntent(target); assert.equal(pending?.phase, "configuring"); assert.ok(pending);
    await lifetime.close(); lifetime = await RuntimeLifetimeLock.acquire(0);
    await prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts);
    const complete = readFixedLayoutIntent(target); assert.ok(complete); assert.equal(complete.phase, "complete");
    assert.deepEqual(complete.profiles, pending.profiles);
    const plan = complete.profiles[0]; assert.ok(plan);
    const backupDirectory = join(target, ".tracker", "data", "profiles", plan.profileId, "backups", "authority");
    assert.deepEqual(readdirSync(backupDirectory).sort(), [plan.backupFileName, `${plan.backupFileName}.manifest.json`].sort());
  } finally { publish.mockRestore(); await lifetime.close(); await f.profile.close(); rmSync(target, { recursive: true, force: true }); }
});

it("leaves the source untouched when its required backup fails", async () => {
  const f = await predecessor(), target = realpathSync(mkdtempSync(join(tmpdir(), "relay-fixed-refusal-"))), lifetime = await RuntimeLifetimeLock.acquire(0);
  const bytes = readFileSync(f.profile.path), backup = vi.spyOn(AuthorityBackupService.prototype, "request").mockRejectedValueOnce(new Error("injected-layout-backup-failure"));
  try {
    await assert.rejects(prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, hostFacts), /injected-layout-backup-failure/u);
    assert.deepEqual(readFileSync(f.profile.path), bytes);
    assert.equal(readFixedLayoutIntent(target), undefined);
    assert.equal(existsSync(join(target, ".tracker", "data")), false);
    assert.equal(existsSync(join(f.profile.workspace, ".tracker", "control", "locator.json")), true);
  } finally { backup.mockRestore(); await lifetime.close(); await f.profile.close(); rmSync(target, { recursive: true, force: true }); }
});


it("moves an unfinished sign-up with no settings activation, preserving its operation and credentials", async () => {
  const lifetime = await RuntimeLifetimeLock.acquire(0), profile = await createBoundProfileFixture({ pending: "onboarding", lifetime });
  const draft = profile.draft; assert.ok(draft?.state === "onboarding");
  const operationPath = join(profile.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  const credentials = fixedLayoutEntries(join(profile.stateRoot, "credentials"));
  const target = realpathSync(mkdtempSync(join(tmpdir(), "fixed-layout-pending-signup-")));
  let machine: RuntimeAdmission | undefined, runtime: ReturnType<typeof composeProfileRuntime> | undefined;
  let observedLayoutOwner = false;
  const openSource = AuthorityDatabase.openFixedLayoutSource.bind(AuthorityDatabase);
  const layout = vi.spyOn(AuthorityDatabase, "openFixedLayoutSource").mockImplementation((owner, admission, clock) => {
    assert.equal(admission.hasCurrentBrowserRegistry(), true);
    const binding = admission.captureBrowserRegistryContext();
    const row = createBrowserRoots(admission).inventory().roots.find(value => value.owner.kind === "signup" && value.owner.operationId === operation.operationId);
    assert.ok(row); assert.equal(row.profileId, operation.profileId);
    assert.equal(row.launch.state, "closed"); assert.equal(row.native, undefined);
    assert.equal(existsSync(join(binding.machineRoot, row.directory)), true);
    observedLayoutOwner = true;
    return openSource(owner, admission, clock);
  });
  try {
    seedRegisteredSignupBrowser(profile.machine, operation);
    await profile.closeController();
    const source = new DatabaseSync(profile.path);
    try {
      source.exec("BEGIN EXCLUSIVE");
      removeSchema15RunPause(source);
      removeEmptyExclusiveSessionLeaseFixture(source);
      restoreEmptyPreMasterWorkbookFixture(source);
      restorePreReadingArtifactRetention(source);
      source.exec("UPDATE database_states SET schema_version=10 WHERE id=1; PRAGMA user_version=10; COMMIT");
    }
    finally { source.close(); }
    await prepareApplicationDataWorkspace(profile.workspace, target, lifetime, hostFacts);
    assert.equal(observedLayoutOwner, true);
    await upgradeRegisteredPersonStores(target, lifetime, hostFacts);
    const stateRoot = join(target, ".tracker", "data", "profiles", operation.profileId);
    assert.deepEqual(fixedLayoutEntries(join(stateRoot, "credentials")), credentials);
    const movedOperation = join(target, ".tracker", "data", "machine", "operations", `${operation.operationId}.json`);
    assert.deepEqual(SignUpOperationSchema.parse(JSON.parse(readFileSync(movedOperation, "utf8"))), operation);
    assert.equal(readFixedLayoutIntent(target)?.phase, "complete");
    const database = new DatabaseSync(join(stateRoot, "state.db"), { readOnly: true });
    try { assert.equal(inspectOpenDatabase(database, CURRENT_AUTHORITY_SCHEMA_VERSION).profileId, operation.profileId); } finally { database.close(); }
    machine = acquireEntrypointAdmission(target, "shared", lifetime);
    assert.equal(machine.readProfileRegistry().profiles.some(row => row.profileId === operation.profileId), false);
    runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts, onboardingDuo: syntheticOnboardingDuo(() => "fixture@ucsd.edu") });
    await runtime.session.recoverOnboarding();
    assert.equal(existsSync(movedOperation), false); assert.equal(existsSync(stateRoot), false);
    const resumed = runtime.session.signUp({ firstName: operation.firstName, lastName: operation.lastName, createdAt: operation.createdAt,
      email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(resumed.state, "onboarding");
    assert.notEqual("profileId" in resumed ? resumed.profileId : undefined, operation.profileId);
  } finally { layout.mockRestore(); await runtime?.close(); machine?.release(); await profile.close(); await lifetime.close(); rmSync(target, { recursive: true, force: true }); }
});
