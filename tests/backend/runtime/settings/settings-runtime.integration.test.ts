import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { randomUUID as randomUUID_m0,randomUUID as randomUUID_m1 } from "node:crypto";
import { existsSync as existsSync_m0,existsSync as existsSync_m1,mkdirSync as mkdirSync_m0,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m0,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1,writeFileSync as writeFileSync_m0,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0,resolveConfigWithProvenance as resolveConfigWithProvenance_m1,type ResolvedConfig as ResolvedConfig_m0 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand as executeSettingsCommand_m0,executeSettingsCommand as executeSettingsCommand_m1,type CommandAuthority as CommandAuthority_m0,type CommandAuthority as CommandAuthority_m1 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor as createSettingsApplicationExecutor_m0,createSettingsApplicationExecutor as createSettingsApplicationExecutor_m1 } from "../../../../src/backend/runs/commands/settings-service.js";
import { buildSettingsEditor as buildSettingsEditor_m0 } from "../../../../src/backend/runs/queries/settings-editor.js";
import { activeSettingsConfig as activeSettingsConfig_m0,activeSettingsRuntimeIdentity as activeSettingsRuntimeIdentity_m0,createCredentialSecretSource as createCredentialSecretSource_m0,createProtectedSettingsRuntimeReader as createProtectedSettingsRuntimeReader_m0,createSettingsRuntimeReader as createSettingsRuntimeReader_m0,readSettings as readSettings_m0,readSettings as readSettings_m1 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import type { RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore_m1 } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { hostConfigFacts as hostConfigFacts_m0 } from "../../../../src/models/config/host-display.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0,ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m0,ProtectedSettingsReadbackSchema as ProtectedSettingsReadbackSchema_m0 } from "../../../../src/models/config/protected-settings.js";
import { requireSecret as requireSecret_m0 } from "../../../../src/models/config/secrets.js";
import { SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m0,SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m1,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m0,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m1,settingsRuntimeIdentity as settingsRuntimeIdentity_m0,type SettingsFileRecord as SettingsFileRecord_m0,type SettingsPatch as SettingsPatch_m0 } from "../../../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema as ProtectedSettingsCommandRequestSchema_m0,deriveSettingsCommandFingerprint as deriveSettingsCommandFingerprint_m0 } from "../../../../src/rules/commands/commands.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1,type Clock as Clock_m0 } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1,createCredentialStore as createCredentialStore_m0,createCredentialStore as createCredentialStore_m1,type CredentialStoreHooks as CredentialStoreHooks_m1 } from "../../../support/helpers/synthetic-storage-admission.js";

import { default as assert_m2,default as assert_m3 } from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m3,readFileSync as readFileSync_m3,realpathSync as realpathSync_m3,rmSync as rmSync_m3,writeFileSync as writeFileSync_m3 } from "node:fs";
import { tmpdir as tmpdir_m3 } from "node:os";
import { join as join_m3 } from "node:path";
import { DatabaseSync as DatabaseSync_m2 } from "node:sqlite";
import { afterEach as afterEach_m3,describe as describe_m3,it as it_m2,it as it_m3 } from "vitest";
import { selectActiveRunSettings as selectActiveRunSettings_m2 } from "../../../../src/backend/runs/settings/run-settings.js";
import { readSettings as readSettings_m2,readSettings as readSettings_m3 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS as MIGRATED_SETTINGS_ENVIRONMENT_KEYS_m3 } from "../../../../src/models/config/catalog.js";
import { manualClock as manualClock_m3 } from "../../../../src/rules/time/clock.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m1 } from "../../../support/fixtures/operator-command-fixtures.js";
import { settingsFixture as settingsFixture_m2 } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { credentialTrap as credentialTrap_m3,storageTree as storageTree_m3 } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m2,AuthorityDatabase as AuthorityDatabase_m3,upgradeStorage as upgradeStorage_m3 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };
function readerFor(database: CommandAuthority_m0, input: Parameters<typeof createSettingsRuntimeReader_m0>[0]) {
  const reader = createSettingsRuntimeReader_m0(input);
  return { read: () => database.withAuthorityTransaction(repositories => reader.read(repositories)) };
}
function activate(database: AuthorityDatabase_m0, record: SettingsFileRecord_m0, clock: Clock_m0) {
  const resolved = resolveConfigWithProvenance_m0(record.settings, hostConfigFacts_m0({}), clock);
  database.withAuthorityTransaction((repositories) => {
    const configSnapshotId = randomUUID_m0();
    const snapshot = { configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
      capturedAt: clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance };
    if (repositories.runtimeConfig.get() === undefined) {
      repositories.runtimeConfig.initialize(snapshot);
      return;
    }
    repositories.configSnapshots.insert(snapshot);
    repositories.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
      configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString() });
  });
  return settingsRuntimeIdentity_m0(record, resolved.fingerprint);
}
function fixture(probe: () => void = () => {}) {
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "hrauto-settings-reader-")); cleanups.push(() => rmSync_m0(root, { recursive: true, force: true }));
  const clock = manualClock_m0(new Date("2026-08-28T12:00:00.000Z"));
  const databasePath = join_m0(root, "state.db");
  const database = AuthorityDatabase_m0.open({ path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock); cleanups.push(() => database.close());
  const store = createCredentialStore_m0({ stateRoot: root });
  const initial = readSettings_m0(database.authority); const active = activate(database, initial, clock);
  let reads = 0;
  const authority: CommandAuthority_m0 = { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
    settingsCurrent: { ...repositories.settingsCurrent, get: () => { reads += 1; probe(); return repositories.settingsCurrent.get(); } },
  })) };
  const reader = readerFor(authority, { hostFacts: hostConfigFacts_m0({}), clock, active: activeSettingsRuntimeIdentity_m0 });
  const settings = createSettingsApplicationExecutor_m0((value) => resolveConfigWithProvenance_m0(value, hostConfigFacts_m0({}), clock), store);
  const execute = (command: unknown) => executeSettingsCommand_m0({ authority: database, clock, ids: { uuid: randomUUID_m0 }, settings }, command);
  const apply = () => {
    const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } };
    const result = execute({ family: "settings", type: "apply-settings", commandId: randomUUID_m0(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: readSettings_m0(database.authority).revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch } });
    assert_m0.equal(result.state, "applied"); return readSettings_m0(database.authority);
  };
  const protectedCommand = (value: string) => ProtectedSettingsCommandRequestSchema_m0.parse({ family: "settings", type: "apply-protected-settings", commandId: randomUUID_m0(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: store.read().revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0, writeId: randomUUID_m0(), entries: { ucpathPassword: { set: value } } } });
  return { root, database, databasePath, clock, store, initial, active, reader, execute, apply, protectedCommand, reads: () => reads,
    protectedReader: createProtectedSettingsRuntimeReader_m0(store) };
}

describe_m0("SQLite Settings reader snapshot", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("resolves the active physical pair without changing the saved ordinary revision", () => {
    const f = fixture();
    const prior = f.database.withAuthorityTransaction(activeSettingsConfig_m0);
    const pair = { stateRoot: join_m0(f.root, "moved-state"), artifactRoot: join_m0(f.root, "moved-artifacts") };
    const resolved = resolveConfigWithProvenance_m0(f.initial.settings, hostConfigFacts_m0({}), f.clock, pair);
    f.database.withAuthorityTransaction((repositories) => {
      const configSnapshotId = randomUUID_m0();
      repositories.configSnapshots.insert({ configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
        capturedAt: f.clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
      repositories.runtimeConfig.activate({ settingsRevision: f.initial.revision, settingsFingerprint: f.initial.settingsFingerprint,
        configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: f.clock.now().toISOString() });
    });
    const reader = readerFor(f.database, { hostFacts: hostConfigFacts_m0({}), clock: f.clock,
      runtimeStoragePair: pair, active: activeSettingsRuntimeIdentity_m0 });
    assert_m0.deepEqual(reader.read().runtimeStatus, { state: "current", identity: settingsRuntimeIdentity_m0(f.initial, resolved.fingerprint) });
    assert_m0.equal(readSettings_m0(f.database.authority).revision, f.initial.revision);
    assert_m0.deepEqual(f.database.withAuthorityTransaction(activeSettingsConfig_m0).paths, { ...prior.paths, ...pair, browserProfileRoot: join_m0(pair.stateRoot, "browsers") });
    assert_m0.notDeepEqual(prior.paths, pair);
  });
  it_m0("builds a current editor with exactly one authoritative read and no file authority", () => {
    const f = fixture();
    for (let count = 0; count < 2; count += 1) {
      const before = f.reads(); const editor = buildSettingsEditor_m0({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
      assert_m0.equal(f.reads() - before, 1); assert_m0.equal(editor.revision, 1);
      assert_m0.equal(editor.settingsFingerprint, f.initial.settingsFingerprint);
      assert_m0.deepEqual(editor.runtimeStatus, { state: "current", identity: f.active });
      assert_m0.equal(editor.sections.flatMap((section) => section.leaves).length, 60 - 5 - 2);
    }
    assert_m0.equal(existsSync_m0(join_m0(f.root, "settings")), false);
  });
  it_m0("pairs fresh values and current status without caching a previous read", () => {
    const f = fixture(); f.reader.read(); const record = f.apply();
    const persisted = settingsRuntimeIdentity_m0(record, resolveConfigWithProvenance_m0(record.settings, hostConfigFacts_m0({}), f.clock).fingerprint);
    const expectedStatus = { state: "current", identity: persisted };
    assert_m0.deepEqual(f.reader.read(), { record, runtimeStatus: expectedStatus });
    const editor = buildSettingsEditor_m0({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
    assert_m0.deepEqual(editor.runtimeStatus, expectedStatus);
    const width = editor.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert_m0.equal(width?.effectiveValue, 1980); assert_m0.equal(width?.settingsValue, 1980); assert_m0.equal(width?.source, "settings");
  });
  it_m0("refuses a stale process identity before reading settings after another activation", () => {
    const f = fixture(); const record = f.apply(); const active = activate(f.database, record, f.clock); const before = f.reads();
    const stale = readerFor(f.database, { hostFacts: hostConfigFacts_m0({}), clock: f.clock, active: f.active });
    assert_m0.throws(() => stale.read(), /are not dashboard-active; restart activation is required/u); assert_m0.equal(f.reads(), before);
    const reader = readerFor(f.database, { hostFacts: hostConfigFacts_m0({}), clock: f.clock, active });
    assert_m0.deepEqual(reader.read(), { record, runtimeStatus: { state: "current", identity: active } });
  });
  it_m0("cannot project a corrupt retired file as ordinary authority", () => {
    const f = fixture(); mkdirSync_m0(join_m0(f.root, "settings")); const path = join_m0(f.root, "settings", "settings.json");
    writeFileSync_m0(path, "malformed former authority", { mode: 0o600 }); const before = readFileSync_m0(path);
    assert_m0.equal(f.reader.read().record.revision, 1); const record = f.apply();
    assert_m0.deepEqual(f.reader.read().record, record); assert_m0.deepEqual(readFileSync_m0(path), before);
  });
  it_m0("holds real SQLite writer exclusion during its settings snapshot", () => {
    let probe = () => {}; const f = fixture(() => probe());
    const contender = AuthorityDatabase_m0.open({ path: f.databasePath, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock); cleanups.push(() => contender.close());
    probe = () => { assert_m0.throws(() => contender.withAuthorityTransaction(() => {}), /database is locked/u); };
    assert_m0.deepEqual(f.reader.read(), { record: f.initial, runtimeStatus: { state: "current", identity: f.active } });
  });
});

describe_m0("independent protected Settings reader", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("serves the stored credential value with the authenticated readback", () => {
    const f = fixture(); f.execute(f.protectedCommand("synthetic-protected-readback"));
    const snapshot = f.protectedReader.read(); assert_m0.equal(snapshot.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH_m0);
    ProtectedSettingsReadbackSchema_m0.parse(snapshot.readback); assert_m0.equal(snapshot.readback.revision, 2);
    assert_m0.equal(snapshot.record.entries.ucpathPassword?.value, "synthetic-protected-readback");
    assert_m0.equal(JSON.stringify(snapshot).includes("synthetic-protected-readback"), true);
  });
  it_m0("verifies exact retry and refuses value-divergent reuse", () => {
    const f = fixture(); const command = f.protectedCommand("synthetic-first-value"); f.execute(command);
    assert_m0.equal(f.execute(command).state, "already-applied");
    const divergent = structuredClone(command); divergent.payload.entries.ucpathPassword = { set: "synthetic-different-value" };
    assert_m0.equal(f.execute(divergent).state, "rejected");
    assert_m0.equal(requireSecret_m0("ucpathPassword", createCredentialSecretSource_m0(f.store)), "synthetic-first-value");
  });
  it_m0("independent committed credentials remain available without a SQLite audit", () => {
    const f = fixture(); const command = f.protectedCommand("synthetic-before-audit");
    const result = f.store.apply(ProtectedSettingsApplyInputSchema_m0.parse({ ...command.payload, commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint_m0(command), expectedRevision: command.target.expectedRevision, updatedAt: command.requestedAt }));
    assert_m0.equal(result.state, "applied"); assert_m0.equal(f.database.authority.commands.get(command.commandId), undefined);
    assert_m0.equal(f.protectedReader.read().readback.revision, 2);
  });
  it_m0("observes each credential at next use without changing ordinary runtime identity", () => {
    const f = fixture(); const before = f.reader.read(); const source = createCredentialSecretSource_m0(f.store);
    assert_m0.throws(() => requireSecret_m0("ucpathPassword", source), /ucpathPassword is missing/u);
    f.execute(f.protectedCommand("synthetic-next-use-one")); assert_m0.equal(requireSecret_m0("ucpathPassword", source), "synthetic-next-use-one");
    f.execute(f.protectedCommand("synthetic-next-use-two")); assert_m0.equal(requireSecret_m0("ucpathPassword", source), "synthetic-next-use-two");
    assert_m0.deepEqual(f.reader.read(), before);
  });
  it_m0("authenticates its own history even when SQLite is unavailable", () => {
    const f = fixture(); f.execute(f.protectedCommand("synthetic-owned-value")); f.database.close();
    assert_m0.equal(f.protectedReader.read().readback.revision, 2);
    const path = join_m0(f.root, "credentials", "protected.json");
    writeFileSync_m0(path, readFileSync_m0(path, "utf8").replace("synthetic-owned-value", "synthetic-altered-value"));
    assert_m0.throws(() => f.protectedReader.read(), /disagrees with its identity history/u);
  });
});


it_m0("S long-lived dashboard reader follows newly saved active settings", async () => {
try {


 const f = fixture();
 const reader = readerFor(f.database, { hostFacts: hostConfigFacts_m0({}), clock: f.clock,
  active: activeSettingsRuntimeIdentity_m0 });
 const original = reader.read();
 const originalConfig = f.database.withAuthorityTransaction(activeSettingsConfig_m0);
 const record = f.apply();
 assert_m0.equal(reader.read().runtimeStatus.state, "current");
 assert_m0.notDeepEqual(f.database.withAuthorityTransaction(activeSettingsConfig_m0), originalConfig);
 const active = activate(f.database, record, f.clock);
 assert_m0.deepEqual(reader.read(), { record, runtimeStatus: { state: "current", identity: active } });
 assert_m0.notDeepEqual(reader.read(), original);
 assert_m0.equal(f.database.withAuthorityTransaction(activeSettingsConfig_m0).display.screenWidth, 1980);

} finally {
_afterEachFixture0();
}
});


describe_m0("F settings resolver application port", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("refuses an incomplete resolver result before changing ordinary or active settings", () => {
    const f = fixture();
    const before = f.database.withAuthorityTransaction(activeSettingsConfig_m0);
    const generation = f.database.getMeta().authorityGeneration;
    const settings = createSettingsApplicationExecutor_m0((value) => {
      const resolved = resolveConfigWithProvenance_m0(value, hostConfigFacts_m0({}), f.clock);
      // Inject a malformed collaborator result without making the collaborator throw.
      Reflect.deleteProperty(resolved, "fingerprint");
      return resolved;
    }, f.store);
    const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } };
    const commandId = randomUUID_m0();
    const result = executeSettingsCommand_m0({ authority: f.database, clock: f.clock, ids: { uuid: randomUUID_m0 }, settings }, {
      family: "settings", type: "apply-settings", commandId, requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: f.initial.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch },
    });
    assert_m0.equal(result.state, "rejected");
    assert_m0.ok(result.state === "rejected");
    assert_m0.equal(result.code, "cross-field-invalid");
    assert_m0.deepEqual(readSettings_m0(f.database.authority), f.initial);
    assert_m0.deepEqual(f.database.withAuthorityTransaction(activeSettingsConfig_m0), before);
    assert_m0.equal(f.database.getMeta().authorityGeneration, generation);
    assert_m0.equal(f.database.authority.commands.get(commandId), undefined);
    assert_m0.equal(f.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it_m0("returns complete results and restores the established host default after clearing display overrides", () => {
    const f = fixture();
    const establishedHost = hostConfigFacts_m0({ HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" });
    const baseline = resolveConfigWithProvenance_m0({}, establishedHost, f.clock);
    const resolutions: ResolvedConfig_m0[] = [];
    const settings = createSettingsApplicationExecutor_m0((value) => {
      const resolved = resolveConfigWithProvenance_m0(value, establishedHost, f.clock);
      resolutions.push(resolved);
      return resolved;
    }, f.store);
    const execute = (patch: SettingsPatch_m0) => {
      const command = { family: "settings", type: "apply-settings", commandId: randomUUID_m0(),
        requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
        target: { expectedRevision: readSettings_m0(f.database.authority).revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch } };
      const dependencies = { authority: f.database, clock: f.clock, ids: { uuid: randomUUID_m0 }, settings };
      assert_m0.equal(executeSettingsCommand_m0(dependencies, command).state, "applied");
      const resolvedCount = resolutions.length;
      const resolved = resolutions.at(-1);
      assert_m0.deepEqual(resolved, resolveConfigWithProvenance_m0(readSettings_m0(f.database.authority).settings, establishedHost, f.clock));
      assert_m0.equal(executeSettingsCommand_m0(dependencies, command).state, "already-applied");
      assert_m0.equal(resolutions.length, resolvedCount, "exact command replay must not resolve again");
      return resolved;
    };
    const overridden = execute({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } });
    assert_m0.ok(overridden);
    const retained = structuredClone(overridden);
    assert_m0.equal(overridden.config.display.screenWidth, 1980);
    assert_m0.equal(overridden.provenance["display.screenWidth"], "settings");
    assert_m0.notEqual(overridden.fingerprint, baseline.fingerprint);
    const cleared = execute({ "display.screenWidth": { clear: true }, "display.screenHeight": { clear: true } });
    assert_m0.deepEqual(cleared, baseline);
    assert_m0.equal(cleared?.config.display.screenWidth, 2560);
    assert_m0.equal(cleared?.config.display.screenHeight, 1440);
    assert_m0.equal(cleared?.provenance["display.screenWidth"], "default");
    assert_m0.equal(cleared?.provenance["display.screenHeight"], "default");
    assert_m0.deepEqual(readSettings_m0(f.database.authority).settings, {}, "host defaults must not become persisted overrides");
    assert_m0.deepEqual(overridden, retained, "later settings must not rewrite a prior resolution");
  });
});
}

{


const roots: string[] = [];
const databases: AuthorityDatabase_m1[] = [];
const admissions: RuntimeAdmission_m1[] = [];
const _afterEachFixture0 = () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true }); };
function fixture(hooks?: CredentialStoreHooks_m1, exclusive = false) {
  const repoRoot = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission_m1(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join_m1(repoRoot, rebuildRuntimeIsolation_m1.stateRoot); mkdirSync_m1(root, { recursive: true, mode: 0o700 });
  writeFileSync_m1(join_m1(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock_m1(new Date("2026-09-06T12:00:00Z"));
  const path = join_m1(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase_m1.open(options, clock) : NativeAuthorityDatabase_m1.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig_m1(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore_m1(credentialOptions) : nativeCredentialStore_m1({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor_m1((value) => resolveConfigWithProvenance_m1(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority_m1 = database) => executeSettingsCommand_m1({ authority, clock, ids: { uuid: randomUUID_m1 }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID_m1(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m1, patchFingerprint: deriveSettingsPatchFingerprint_m1(patch), patch } };
}

describe_m1("SQLite settings authority", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("represents empty revision one without a file or current row", () => {
    const f = fixture();
    assert_m1.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert_m1.deepEqual(readSettings_m1(f.database.authority).settings, {});
    assert_m1.equal(readSettings_m1(f.database.authority).revision, 1);
    assert_m1.equal(existsSync_m1(join_m1(f.root, "settings")), false);
    assert_m1.equal(existsSync_m1(join_m1(f.root, "credentials")), false);
    const raw = new DatabaseSync_m1(f.path, { readOnly: true });
    try { assert_m1.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='protected_settings_current'").get(), undefined); }
    finally { raw.close(); }
  });
  it_m1("commits values, revision, command, audit and one authority generation together, then replays without writes", () => {
    const f = fixture(); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert_m1.equal(f.execute(request).state, "applied");
    assert_m1.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert_m1.equal(readSettings_m1(f.database.authority).settings.concurrency?.defaultWorkers, 3);
    assert_m1.equal(f.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "applied");
    assert_m1.equal(f.execute(request).state, "already-applied");
    assert_m1.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert_m1.equal(existsSync_m1(join_m1(f.root, "settings")), false);
  });
});
}

{

const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const close of cleanups.splice(0).reverse()) close(); };
function fixture() { const f = settingsFixture_m2(); cleanups.push(f.close); return f; }
function counts(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync_m2(f.path, { readOnly: true });
  try { return ["settings_snapshots", "commands", "command_audits", "runs"].map((table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get()); } finally { db.close(); }
}
it_m2("rolls snapshot, selection, journal, audit and generation back on an injected audit failure", async () => {
try {


  const f = fixture(); const before = counts(f); const active = f.database.authority.runtimeConfig.get();
  const generation = f.database.getMeta().authorityGeneration; const saved = readSettings_m2(f.database.authority);
  assert_m2.throws(() => f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }), {
    withAuthorityTransaction: (work) => f.database.withAuthorityTransaction((repositories) => work({ ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
    })),
  }), /injected audit failure/u);
  assert_m2.deepEqual(counts(f), before); assert_m2.deepEqual(f.database.authority.runtimeConfig.get(), active);
  assert_m2.deepEqual(readSettings_m2(f.database.authority), saved); assert_m2.equal(f.database.getMeta().authorityGeneration, generation);

} finally {
_afterEachFixture0();
}
});
it_m2("refuses invalid and revision-conflicting saves with no partial authority", async () => {
try {


  const f = fixture(); const before = counts(f); const generation = f.database.getMeta().authorityGeneration;
  assert_m2.equal(f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }, 2)).state, "conflict");
  assert_m2.equal(f.execute(f.command({ "display.screenWidth": { set: 1980 } })).state, "rejected");
  assert_m2.deepEqual(counts(f), before); assert_m2.equal(f.database.getMeta().authorityGeneration, generation);

} finally {
_afterEachFixture0();
}
});
it_m2("clears overrides to host defaults and survives a real authority reopen with historical references", async () => {
try {


  const f = fixture(); f.save({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } });
  const run = f.create(); const retained = selectActiveRunSettings_m2(f.database.authority);
  f.save({ "display.screenWidth": { clear: true }, "display.screenHeight": { clear: true } });
  assert_m2.deepEqual(readSettings_m2(f.database.authority).settings, {});
  const current = selectActiveRunSettings_m2(f.database.authority); assert_m2.equal(current.config.display.screenWidth, 2560);
  assert_m2.equal(current.fingerprint, f.snapshot.fingerprint);
  f.database.close(); const reopened = AuthorityDatabase_m2.open({ path: f.path, busyTimeoutMs: 10, migrationOwner: "reopen" }, f.clock);
  try {
    assert_m2.deepEqual(selectActiveRunSettings_m2(reopened.authority), current);
    assert_m2.deepEqual(reopened.authority.configSnapshots.get(retained.configSnapshotId), retained);
    assert_m2.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
  } finally { reopened.close(); }

} finally {
_afterEachFixture0();
}
});
}

{

const clock = manualClock_m3(new Date("2026-09-06T12:00:00.000Z"));
const roots: string[] = [];
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync_m3(root, { recursive: true, force: true }); };
const HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS = ["OCR_GEMINI_MODEL", "OCR_GEMINI_MODELS", "OCR_GROQ_MODEL", "OCR_GROQ_MODELS", "OCR_MISTRAL_MODEL", "OCR_MISTRAL_MODELS", "OCR_OPENROUTER_MODEL", "OCR_OPENROUTER_MODELS", "OCR_SAMBANOVA_MODEL", "OCR_SAMBANOVA_MODELS"];
const bindings = {
  HRAUTO_KUALI_TEST_URL: "https://fixture.invalid/kuali", HRAUTO_NEW_KRONOS_TEST_URL: "https://fixture.invalid/new-kronos",
  HRAUTO_CRM_TEST_URL: "https://fixture.invalid/crm", HRAUTO_ONBASE_TEST_URL: "https://fixture.invalid/onbase",
  HRAUTO_UCPATH_TEST_URL: "https://fixture.invalid/ucpath", HRAUTO_I9_TEST_URL: "https://fixture.invalid/i9",
  HRAUTO_OLD_KRONOS_TEST_URL: "https://fixture.invalid/old-kronos", HRAUTO_SERVICENOW_TEST_URL: "https://fixture.invalid/servicenow",
  HRAUTO_SHAREPOINT_TEST_URL: "https://fixture.invalid/sharepoint", HRAUTO_UKG_NAVIGATION_MS: "7000",
  ANNUAL_DATES_END: "06/30/2027", KRONOS_DEFAULT_END_DATE: "06/30/2027", KRONOS_DEFAULT_START_DATE: "07/01/2026",
  HRAUTO_NAVIGATION_RETRIES: "7", HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS: "7", OCR_SECOND_OPINION_MAX: "7",
  OCR_PAGE_MAX_WAIT_MS: "7000", OCR_TIER1_PATIENCE_MS: "7000", OCR_PAGE_CONCURRENCY: "7", OCR_DISAMBIG_CONCURRENCY: "7",
  OCR_SUGGEST_CONCURRENCY: "7", OCR_BACKOFF_BASE_MS: "7000", OCR_BACKOFF_CAP_MS: "7000", OCR_MAX_VALIDATION_RETRIES: "7",
  HRAUTO_HEALTH_MONITOR_TICK_MS: "7000", HRAUTO_HEALTH_MONITOR_MAX_REFRESH: "7", HRAUTO_HEALTH_MONITOR_MAX_REOPEN: "7",
  HRAUTO_DEFAULT_WORKERS: "7", HRAUTO_DAEMON_IDLE_MS: "7000", HRAUTO_DAEMON_IDLE_REPOLL_MS: "7000",
  DEBUG_SCREENSHOTS: "true", HR_AUTOMATION_DUO_WEBAUTHN: "0", OCR_GEMINI_MODELS: "fixture-model", OCR_GROQ_MODELS: "fixture-model",
  OCR_MISTRAL_MODELS: "fixture-model", OCR_OPENROUTER_MODELS: "fixture-model", OCR_SAMBANOVA_MODELS: "fixture-model",
  OCR_GEMINI_MODEL: "retired-model", OCR_GROQ_MODEL: "retired-model", OCR_MISTRAL_MODEL: "retired-model", OCR_OPENROUTER_MODEL: "retired-model", OCR_SAMBANOVA_MODEL: "retired-model",
  UCPATH_USER_ID: "synthetic-user", UCPATH_PASSWORD: "synthetic-private-password", TIMEKEEPER_NAME: "Synthetic Keeper",
  ONBOARDING_ROSTER_URL: "https://fixture.invalid/private-roster", HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: "ab".repeat(32),
  HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-fixture",
};

const RETIRED_TEST_TARGET_ENV = {
  HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: "12345678", HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID: "10123456",
};
function fixture(body: string) {
  const root = mkdtempSync_m3(join_m3(realpathSync_m3(tmpdir_m3()), "upgrade-env-")); roots.push(root);
  const environmentFile = join_m3(root, ".env"); writeFileSync_m3(environmentFile, body, { mode: 0o600 });
  return { root, environmentFile, input: { stateRoot: root, processLockRoot: join_m3(root, "locks"), environmentFile, plan: false } };
}
describe_m3("expired environment import refuses before access", () => {
afterEach_m3(_afterEachFixture0);

  it_m3("covers every former input while fresh authority and credentials remain independent", async () => {
    assert_m3.deepEqual([...Object.keys(bindings), ...Object.keys(RETIRED_TEST_TARGET_ENV)].sort(), [...MIGRATED_SETTINGS_ENVIRONMENT_KEYS_m3, ...HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS].sort());
    const retired = { I9_USER_ID: "synthetic-retired-id", I9_PASSWORD: "synthetic-retired-password", TELEGRAM_BOT_TOKEN: "synthetic-retired-token", TELEGRAM_CHAT_ID: "synthetic-retired-chat" };
    const body = Object.entries({ ...bindings, ...retired, GEMINI_API_KEY: "synthetic-provider-never-imported" }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    const f = fixture(body); credentialTrap_m3(f.root); const before = storageTree_m3(f.root);
    const plan = await upgradeStorage_m3({ ...f.input, plan: true }, clock);
    assert_m3.equal(plan.credentials, "unchanged");
    assert_m3.deepEqual(storageTree_m3(f.root), before);
    const applied = await upgradeStorage_m3(f.input, clock);
    assert_m3.equal(applied.credentials, "unchanged");
    const database = AuthorityDatabase_m3.open({ path: join_m3(f.root, "state.db"), busyTimeoutMs: 500, migrationOwner: "expired-env-proof" }, clock);
    try { assert_m3.deepEqual(readSettings_m3(database.authority).settings, {}); } finally { database.close(); }
    assert_m3.equal(readFileSync_m3(f.environmentFile, "utf8"), body);
    for (const value of [...Object.values(retired), bindings.UCPATH_PASSWORD, bindings.UCPATH_USER_ID, "synthetic-provider-never-imported"])
      assert_m3.equal(readFileSync_m3(join_m3(f.root, "state.db")).includes(Buffer.from(value)), false);
    const settled = storageTree_m3(f.root); assert_m3.equal((await upgradeStorage_m3(f.input, clock)).state, "already-upgraded");
    const after = storageTree_m3(f.root);
    for (const [path, bytes] of Object.entries(settled)) assert_m3.equal(after[path], bytes);
    assert_m3.equal(Object.keys(after).filter(path => !(path in settled)).every(path => path.startsWith("locks/restore-admission-history/")), true);
  });
  it_m3.each(Object.entries(RETIRED_TEST_TARGET_ENV))("does not read or adopt expired test-target key %s", async (key, value) => {
    const body = `${key}=${value}\n`; const f = fixture(body); credentialTrap_m3(f.root);
    const report = await upgradeStorage_m3(f.input, clock);
    assert_m3.equal(report.credentials, "unchanged"); assert_m3.equal(JSON.stringify(report).includes(value), false);
    assert_m3.equal(readFileSync_m3(f.environmentFile, "utf8"), body);
    assert_m3.equal(readFileSync_m3(join_m3(f.root,"state.db")).includes(Buffer.from(value)), false);
  });
  it_m3.each(["UNREGISTERED_SETTING=1", "I9_USER_ID_EXTRA=synthetic-private", "TELEGRAM_TOKEN=synthetic-private", "I9_USER_ID=one\nI9_USER_ID=two", "TELEGRAM_BOT_TOKEN=\"unterminated", "HRAUTO_DEFAULT_WORKERS=abc", "HRAUTO_KUALI_TEST_URL=not-a-url"])("does not parse expired environment bytes: %s", async body => {
    const f=fixture(body);credentialTrap_m3(f.root);const before=storageTree_m3(f.root);
    assert_m3.equal((await upgradeStorage_m3({...f.input,plan:true},clock)).state,"planned");assert_m3.deepEqual(storageTree_m3(f.root),before);
    const result=await upgradeStorage_m3(f.input,clock);assert_m3.equal(result.credentials,"unchanged");assert_m3.equal(readFileSync_m3(f.environmentFile,"utf8"),body);
  });
});
}
