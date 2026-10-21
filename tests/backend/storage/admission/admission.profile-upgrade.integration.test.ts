import { storageRecoveryFixture, credentialTrap } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

it("keeps pending setup database-only until canonical binding, then upgrades disposable schema6 only with stopped custody", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-stopped-upgrade-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive");
  try {
    const operation = machine.beginProfileSignUp({ emailKey: "a".repeat(64), firstName: "Alex", lastName: "Rivera",
      createdAt: IsoInstantSchema.parse("2026-09-06T12:00:00.000Z"), commandFingerprint: "b".repeat(64) });
    const setup = machine.admitProfile(machine.issueRegisteredProfileClaim(operation.profileId));
    const path = join(setup.stateRoot, "state.db");
    const journalPath = join(machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`);
    const store = createCredentialStore({ admission: setup, stateRoot: setup.stateRoot,
      erasureJournalAdmission: machine, erasureJournalPath: journalPath });
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
      commandFingerprint: operation.commandFingerprint, expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      updatedAt: operation.createdAt, entries: { ucpathPassword: { set: "disposable-profile-password" } } });
    assert.throws(() => store.apply(request), /profile-database-binding-required/u);
    AuthorityDatabase.initializeProfile(setup);
    assert.throws(() => AuthorityDatabase.open(setup, { path, busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DROP TRIGGER database_states_binding_immutable; ALTER TABLE database_states RENAME TO database_states_bound");
      const original = SQLITE_MIGRATIONS[0]?.statements[0]?.split("CREATE TABLE database_upgrades")[0];
      assert.ok(original !== undefined);
      raw.exec(original);
      raw.exec("INSERT INTO database_states SELECT id,6,authority_generation,updated_at,search_generation,search_state FROM database_states_bound; DROP TABLE database_states_bound; PRAGMA user_version=6");
    } finally { raw.close(); }
    const before = readFileSync(path);
    assert.throws(() => store.apply(request), /profile-database-binding-required/u);
    assert.deepEqual(readFileSync(path), before);
    assert.throws(() => AuthorityDatabase.open(setup, { path, busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const input = { stateRoot: setup.stateRoot, processLockRoot: join(setup.stateRoot, "locks"), plan: false };
    const upgraded = await upgradeStorage(setup, input, systemClock);
    assert.equal(upgraded.state, "upgraded");
    assert.equal(upgraded.fromSchemaVersion, 6);
    assert.equal(upgraded.toSchemaVersion, 7);
    assert.equal(store.apply(request).state, "applied");
    setup.release();
    assert.throws(() => setup.forStoppedProfileUpgrade(), /released admission/u);
  } finally { machine.release(); rmSync(workspace, { recursive: true, force: true }); }
});

it.each([1, 2, 3, 4, 5, 6])("upgrades supported stopped native schema%s under genuine pending setup without reading independent credentials", async version => {
  const f = storageRecoveryFixture(version);
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
    assert.equal(report.toSchemaVersion, 7);
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
  } finally { f.dispose(); }
});

it("rejects unsupported stopped native version at canonical inspection without touching trapped credentials or source bytes", async () => {
  const f = storageRecoveryFixture(8);
  try {
    credentialTrap(f.root);
    const before = readFileSync(f.path);
    await assert.rejects(f.run(), error => error instanceof AuthoritySchemaVersionError && error.schemaVersion === 8);
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal(lstatSync(join(f.root, "credentials", "protected.json")).isDirectory(), true);
  } finally { f.dispose(); }
});
