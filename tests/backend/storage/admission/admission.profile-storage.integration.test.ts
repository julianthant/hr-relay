import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createCredentialStore, captureCommittedCredentialReplay, readForErasure } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync, linkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-admission-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive");
  let busy = false;
  const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot,
    activity: { hasUnquiescedWork: () => busy }, backupPaths: () => [], loginDataPaths: () => [] });
  const registry = createProfileRegistry(machine);
  const fields = { firstName: "Alex", lastName: "Rivera", email: "alex@example.edu", password: "fixture-password", createdAt: "2026-09-06T12:00:00.000Z" };
  return { workspace, machine, session, registry, fields, busy() { busy = true; }, cleanup() { machine.release(); rmSync(workspace, { recursive: true, force: true }); } };
}

it("boots a genuine machine without a dummy database, then creates a bound canonical profile through registered intent", () => {
  const f = fixture();
  try {
    assert.equal(existsSync(join(f.machine.stateRoot, "state.db")), false);
    assert.equal(f.registry.read().activeProfileId, null);
    assert.throws(() => AuthorityDatabase.open(f.machine, { path: join(f.machine.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const active = f.session.signUp(f.fields);
    assert.ok(active.state === "active");
    const claim = f.registry.storageClaim(active.profileId);
    assert.throws(() => f.machine.admitProfile({ ...claim }), /profile-storage-claim-unissued/u);
    const child = f.machine.admitProfile(claim);
    try {
      assert.throws(() => AuthorityDatabase.open(child, { path: ":memory:", busyTimeoutMs: 250, migrationOwner: "test" }), /outside admission/u);
      const database = AuthorityDatabase.open(child, { path: join(child.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" });
      try {
        const meta = database.getMeta();
        assert.equal(meta.schemaVersion, 7);
        assert.equal(meta.installationId, f.machine.locator.installationId);
        assert.equal(meta.profileId, active.profileId);
      } finally { database.close(); }
      child.release();
      assert.throws(() => child.assertLive(), /released admission/u);
      f.machine.assertLive();
    } finally { child.release(); }
  } finally { f.cleanup(); }
});

it("does not mint a new child from a ready claim after logout starts while retaining existing drain custody", () => {
  const f = fixture();
  try {
    const active = f.session.signUp(f.fields); assert.ok(active.state === "active");
    const claim = f.registry.storageClaim(active.profileId), child = f.machine.admitProfile(claim);
    f.busy();
    assert.equal(f.session.logOut(active.token, { at: "2026-09-06T12:01:00.000Z" }).state, "cancelling");
    assert.throws(() => f.machine.admitProfile(claim), /profile-storage-claim-generation-changed/u);
    child.assertLive();
    assert.throws(() => AuthorityDatabase.open(child, { path: join(child.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-storage-claim-generation-changed/u);
    const refused = f.session.readFile(active.token, "absent");
    assert.ok("state" in refused && refused.state === "refused");
    assert.equal(f.session.signUp({ ...f.fields, email: "sam@example.edu" }).state, "refused");
    child.release();
  } finally { f.cleanup(); }
});

it("rejects restored registry bytes against installation control continuity", () => {
  const f = fixture();
  try {
    const path = join(f.machine.stateRoot, "machine", "profiles.json");
    const initial = readFileSync(path);
    assert.equal(f.session.signUp(f.fields).state, "active");
    writeFileSync(path, initial, { mode: 0o600 });
    assert.throws(() => f.machine.readProfileRegistry(), /profile-registry-continuity-mismatch/u);
  } finally { f.cleanup(); }
});


it("rejects fabricated pending operations and modified persisted setup fields before profile roots", () => {
  const f = fixture();
  try {
    const operation = f.machine.beginProfileSignUp({ emailKey: "a".repeat(64), firstName: "Alex", lastName: "Rivera",
      createdAt: IsoInstantSchema.parse(f.fields.createdAt), commandFingerprint: "a".repeat(64) });
    const registry = f.registry;
    const claim = registry.storageClaim(operation.profileId);
    const setup = f.machine.admitProfile(claim);
    assert.throws(() => AuthorityDatabase.open(setup, { path: join(setup.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    assert.throws(() => setup.assertAuthorityDatabase(":memory:"), /outside admission/u);
    AuthorityDatabase.initializeProfile(setup);
    setup.release();
    const path = join(f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`);
    const bytes = readFileSync(path);
    for (const patch of [{ phase: "publishing" }, { expectedRevision: 2 }]) {
      writeFileSync(path, JSON.stringify({ ...operation, ...patch }), { mode: 0o600 });
      assert.throws(() => f.machine.admitProfile(claim), /profile-registry-continuity-mismatch/u);
      writeFileSync(path, bytes, { mode: 0o600 });
    }
    const fake = { ...operation, operationId: randomUUID(), profileId: randomUUID() };
    const fakePath = join(f.machine.stateRoot, "machine", "operations", `${fake.operationId}.json`);
    writeFileSync(fakePath, JSON.stringify(fake), { mode: 0o600 });
    assert.throws(() => registry.storageClaim(fake.profileId), /profile-registry-continuity-mismatch/u);
    assert.equal(existsSync(join(f.machine.stateRoot, "profiles", fake.profileId)), false);
  } finally { f.cleanup(); }
});

it("rejects foreign canonical binding and hardlink or symlink database substitution before writable opening", () => {
  const f = fixture();
  try {
    const active = f.session.signUp(f.fields); assert.ok(active.state === "active");
    const claim = f.registry.storageClaim(active.profileId), child = f.machine.admitProfile(claim);
    const path = join(child.stateRoot, "state.db"), held = `${path}.held`;
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID()), /profile-database-binding-immutable/u);
      raw.exec("DROP TRIGGER database_states_binding_immutable");
      raw.prepare("UPDATE database_states SET installation_id=? WHERE id=1").run(randomUUID());
    } finally { raw.close(); }
    assert.throws(() => f.machine.admitProfile(claim), /profile-database-binding-mismatch/u);
    renameSync(path, held);
    symlinkSync(held, path);
    assert.throws(() => f.machine.admitProfile(claim), /source-integrity/u);
    rmSync(path); linkSync(held, path);
    assert.throws(() => f.machine.admitProfile(claim), /profile-database-identity-invalid/u);
    child.release();
  } finally { f.cleanup(); }
});

it("reissues only exact pending logout settlement after restart and rejects forged, changed or completed custody", () => {
  const f = fixture();
  try {
    const active = f.session.signUp(f.fields); assert.ok(active.state === "active");
    f.busy();
    const result = f.session.logOut(active.token, { at: "2026-09-06T12:01:00.000Z" });
    assert.ok(result.state === "cancelling" && result.operationId !== undefined);
    const operationId = result.operationId;
    const claim = f.registry.settlementClaim(operationId);
    assert.throws(() => f.machine.admitProfile({ ...claim }), /profile-storage-claim-unissued/u);
    const child = f.machine.admitProfile(claim);
    try {
      child.assertLive();
      const store = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${active.profileId}.json`) });
      assert.equal(typeof readForErasure(store, operationId).revision, "number");
      assert.throws(() => readForErasure({ ...store }, operationId), /profile-erasure-credential-store-unissued/u);
      assert.throws(() => readForErasure(store, randomUUID()), /profile-settlement-operation-unavailable/u);
      assert.throws(() => store.read(), /profile-settlement-credential-read-refused/u);
      assert.throws(() => store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
        commandFingerprint: "d".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        updatedAt: f.fields.createdAt, entries: { ucpathPassword: { set: "disposable-forbidden-password" } } })), /profile-settlement-runtime-refused/u);
      assert.throws(() => child.assertWritable(), /profile-settlement-runtime-refused/u);
      assert.throws(() => AuthorityDatabase.open(child, { path: join(child.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
      const operationPath = join(f.machine.stateRoot, "machine", "operations", `${result.operationId}.json`);
      const before = readFileSync(operationPath);
      const changed = JSON.parse(before.toString()) as Record<string, unknown>;
      writeFileSync(operationPath, JSON.stringify({ ...changed, phase: "complete" }), { mode: 0o600 });
      assert.throws(() => child.assertLive(), /profile-registry-continuity-mismatch/u);
      writeFileSync(operationPath, before, { mode: 0o600 });
      const restarted = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
        activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
      assert.equal(restarted.resumeLogout(result.operationId).state, "wiped");
      assert.throws(() => f.registry.settlementClaim(operationId), /profile-settlement-operation-unavailable/u);
      assert.throws(() => child.assertLive(), /profile-settlement-operation-unavailable/u);
    } finally { child.release(); }
  } finally { f.cleanup(); }
});

it("publishes ready only from an exact actual credential witness and rechecks postcapture canonical binding and database identity", () => {
  const f = fixture();
  try {
    let operation = f.machine.beginProfileSignUp({ emailKey: "a".repeat(64), firstName: "Alex", lastName: "Rivera",
      createdAt: IsoInstantSchema.parse(f.fields.createdAt), commandFingerprint: "d".repeat(64) });
    const setup = f.machine.admitProfile(f.registry.storageClaim(operation.profileId));
    AuthorityDatabase.initializeProfile(setup);
    const store = createCredentialStore({ admission: setup, stateRoot: setup.stateRoot, erasureJournalAdmission: f.machine,
      erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`) });
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
      commandFingerprint: operation.commandFingerprint, expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      updatedAt: operation.createdAt, entries: { ucpathPassword: { set: "disposable-committed-password" } } });
    assert.equal(store.apply(request).state, "applied");
    operation = { ...operation, expectedRevision: 1, phase: "publishing" };
    f.machine.publishProfileOperation(operation);
    const witness = captureCommittedCredentialReplay(store, request);
    assert.throws(() => captureCommittedCredentialReplay({ ...store }, request), /profile-signup-credential-store-unissued/u);
    assert.throws(() => f.machine.publishProfileRegistration(operation, { ...witness }), /profile-signup-receipt-mismatch/u);
    assert.throws(() => f.machine.publishProfileRegistration({ ...operation, writeId: randomUUID() }, witness), /profile-signup-intent-mismatch/u);
    const path = join(setup.stateRoot, "state.db");
    const original = `${path}.held`;
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DROP TRIGGER database_states_binding_immutable");
      raw.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID());
    } finally { raw.close(); }
    assert.throws(() => f.machine.publishProfileRegistration(operation, witness), /profile-database-binding-mismatch/u);
    assert.equal(f.registry.read().profiles.length, 0);
    const restore = new DatabaseSync(path);
    try { restore.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(operation.profileId);
      restore.exec("CREATE TRIGGER database_states_binding_immutable BEFORE UPDATE OF installation_id,profile_id ON database_states BEGIN SELECT RAISE(ABORT,'profile-database-binding-immutable'); END;"); }
    finally { restore.close(); }
    renameSync(path, original);
    writeFileSync(path, readFileSync(original), { mode: 0o600 });
    assert.throws(() => f.machine.publishProfileRegistration(operation, witness), /profile-signup-database-changed/u);
    rmSync(path); renameSync(original, path);
    f.machine.publishProfileRegistration(operation, witness);
    assert.equal(f.registry.read().profiles[0]?.profileId, operation.profileId);
    const current = f.registry.read();
    const row = current.profiles[0]; assert.ok(row);
    assert.throws(() => f.machine.publishProfileRegistry(current, { ...current, profiles: [...current.profiles, { ...row, profileId: randomUUID() }] }), /profile-registry-registration-required/u);
    setup.release();
  } finally { f.cleanup(); }
});

it("refuses a concurrent healthy observation change and performs healthy registry reads without durable mutex writes", () => {
  const f = fixture();
  try {
    const active = f.session.signUp(f.fields); assert.ok(active.state === "active");
    const current = f.registry.read();
    const realOpen = fs.openSync;
    const realWrite = fs.writeFileSync;
    const profilePath = join(f.machine.stateRoot, "machine", "profiles.json");
    let reads = 0, changed = false, writes = 0;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === profilePath && typeof flags === "number") {
        reads++;
        if (reads === 2 && !changed) {
          changed = true;
          f.machine.publishProfileRegistry(current, { ...current, sessionGeneration: current.sessionGeneration + 1 });
        }
      }
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    assert.throws(() => f.machine.readProfileRegistry(), /profile-registry-observation-changed/u);
    assert.equal(changed, true);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    const before = f.registry.read();
    vi.spyOn(fs, "writeFileSync").mockImplementation((path, data, options) => {
      if (typeof path === "string" && path.includes("admission-mutex")) writes++;
      return realWrite(path, data, options);
    });
    syncBuiltinESMExports();
    const original = readFileSync(profilePath);
    const priorWrites = writes;
    assert.deepEqual(f.machine.readProfileRegistry(), before);
    assert.equal(writes, priorWrites);
    assert.deepEqual(readFileSync(profilePath), original);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    vi.spyOn(fs, "writeFileSync").mockImplementation((path, data, options) => {
      if (typeof path === "string" && path.includes("admission-mutex")) writes++;
      return realWrite(path, data, options);
    });
    syncBuiltinESMExports();
    f.machine.publishProfileRegistry(before, { ...before, sessionGeneration: before.sessionGeneration + 1 });
    assert.ok(writes > priorWrites);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); f.cleanup(); }
});
