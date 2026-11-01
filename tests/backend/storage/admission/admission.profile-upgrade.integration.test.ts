import { CanonicalCredentialError, CredentialMaintenanceHold, initializeCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { withOfflineMaintenance } from "../../../support/helpers/admission-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { storageRecoveryFixture, credentialTrap, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, AUTHORITY_APPLICATION_ID } from "../../../../src/backend/storage/sqlite/migrations.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { createCredentialStore, initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { createHash } from "node:crypto";

it.each([6, 7])("keeps pending setup database-only until canonical binding, then upgrades disposable schema%s and scans its retained backup before explicit v4 initialization", async version => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-stopped-upgrade-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  try {
    const operation = machine.beginProfileSignUp({ emailKey: "a".repeat(64), firstName: "Alex", lastName: "Rivera",
      createdAt: IsoInstantSchema.parse("2026-09-06T12:00:00.000Z"), commandFingerprint: "b".repeat(64) });
    const setup = machine.admitProfile(operation.profileId);
    const path = join(setup.stateRoot, "state.db");
    const store = createCredentialStore({ admission: setup, stateRoot: setup.stateRoot });
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
      commandFingerprint: operation.commandFingerprint, expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      updatedAt: operation.createdAt, entries: { ucpathPassword: { set: "disposable-profile-password" } } });
    const assertUninitialized = () => {
      const source = storageTree(workspace);
      const keys = createHash("sha256").update(JSON.stringify(FakeKeyringEntry.snapshot())).digest("hex");
      for (const attempt of [() => store.read(), () => store.apply(request)]) {
        assert.throws(attempt, error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNAVAILABLE"
          && error.cause instanceof CredentialMaintenanceHold && error.cause.code === "CREDENTIAL_CONVERSION_REQUIRED");
        assert.deepEqual(storageTree(workspace), source);
        assert.equal(createHash("sha256").update(JSON.stringify(FakeKeyringEntry.snapshot())).digest("hex"), keys);
      }
    };
    assertUninitialized();
    const raw = new DatabaseSync(path);
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= version)) for (const statement of migration.statements) raw.exec(statement);
      if (version === 7) raw.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,7,7,?,NULL,'unbuilt',?,?)")
        .run(operation.createdAt, setup.profileBinding.installationId, setup.profileBinding.profileId);
      else raw.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state) VALUES(1,6,7,?,NULL,'unbuilt')").run(operation.createdAt);
      raw.exec(`PRAGMA user_version=${version}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID}`);
    } finally { raw.close(); }
    const before = readFileSync(path);
    assertUninitialized();
    assert.deepEqual(readFileSync(path), before);
    assert.throws(() => AuthorityDatabase.open(setup, { path, busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const input = { stateRoot: setup.stateRoot, processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot), plan: false };
    const upgraded = await withOfflineMaintenance(setup, operation => upgradeStorage(profileBrowserClosure, setup, input, systemClock, operation));
    assert.equal(upgraded.state, "upgraded");
    assert.equal(upgraded.fromSchemaVersion, version);
    assert.equal(upgraded.toSchemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const initial = initialDocument();
    initializeCanonicalCredentials(machine, setup, operation, { revision: initial.record.revision, value: initial });
    machine.publishProfileOperation({ ...operation, credentials: { ...operation.credentials, phase: "ready", protectedRevision: initial.record.revision } });
    assert.equal(store.read().revision, request.expectedRevision);
    assert.equal(store.apply(request).state, "applied");
    setup.release();
    assert.throws(() => setup.forStoppedProfileUpgrade(), /released admission/u);
  } finally { machine.release(); rmSync(workspace, { recursive: true, force: true }); }
});

it.each([1, 2, 3, 4, 5, 6, 7])("upgrades supported stopped native schema%s under genuine pending setup without reading independent credentials", async version => {
  const f = await storageRecoveryFixture(version);
  try {
    credentialTrap(f.root);
    writeFileSync(f.input.environmentFile, "malformed-disposable-environment", { mode: 0o600 });
    writeFileSync(join(f.root, "settings.json"), "malformed-disposable-settings", { mode: 0o600 });
    const bytes = readFileSync(f.path);
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.throws(() => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const report = await f.run();
    assert.equal(report.state, "upgraded");
    assert.equal(report.fromSchemaVersion, version);
    assert.equal(report.toSchemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(readFileSync(f.input.environmentFile, "utf8"), "malformed-disposable-environment");
    assert.equal(readFileSync(join(f.root, "settings.json"), "utf8"), "malformed-disposable-settings");
    assert.equal(lstatSync(join(f.root, "credentials", "protected.json")).isDirectory(), true);
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const meta = raw.prepare("SELECT authority_generation,installation_id,profile_id FROM database_states WHERE id=1").get();
      assert.equal(meta?.authority_generation, 7);
      assert.equal(meta?.installation_id, f.admission.profileBinding.installationId);
      assert.equal(meta?.profile_id, f.admission.profileBinding.profileId);
      assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM database_upgrades").get()?.count, 1);
    } finally { raw.close(); }
  } finally { await f.dispose(); }
});

it("rejects unsupported stopped native version at canonical inspection without touching trapped credentials or source bytes", async () => {
  const f = await storageRecoveryFixture(CURRENT_AUTHORITY_SCHEMA_VERSION + 1);
  try {
    credentialTrap(f.root);
    const before = readFileSync(f.path);
    await assert.rejects(f.run(), error => error instanceof AuthoritySchemaVersionError && error.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION + 1);
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal(lstatSync(join(f.root, "credentials", "protected.json")).isDirectory(), true);
  } finally { await f.dispose(); }
});
