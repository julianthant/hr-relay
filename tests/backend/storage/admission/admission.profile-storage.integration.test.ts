import * as fixtureAdmissions from '../../../support/helpers/synthetic-database-admission.js';
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { syncBuiltinESMExports } from "node:module";
import { createCredentialStore, captureCommittedCredentialReplay, readForErasure } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync, linkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createProfileVerifiers } from "../../../../src/backend/profiles/verifier-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-admission-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive");
  fs.mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  let busy = false;
  const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot,
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
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
        assert.equal(meta.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
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
      initializationInventory: (current, writer, copies) => composeProfileCredentialInitializationInventory({ machine: f.machine, admission: setup, clock: systemClock, hostFacts: { primaryDisplay: null } })(current, writer, copies),
      erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`) });
    store.migrateHistory({ operation });
    operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`), "utf8")));
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


it.each(["acquire", "release"] as const)("observes healthy profile evidence across a real peer lease %s mutex without writing a mutex", async operation => {
  const f = createBoundProfileFixture({ sharedMachine: true }), ready = join(f.workspace, "peer-ready"), finish = join(f.workspace, "peer-finish"), done = join(f.workspace, "peer-done");
  const profilesPath = join(f.machine.stateRoot, "machine", "profiles.json");
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { acquireEntrypointAdmission } from "./src/backend/storage/admission/bootstrap-admission.ts";
    const [root, operation, ready, finish, done] = process.argv.slice(1);
    const pause = () => {
      fs.writeFileSync(ready, "ready");
      const deadline = performance.now() + 10000;
      while (!fs.existsSync(finish)) {
        if (performance.now() > deadline) throw new Error("peer-lease-barrier-expired");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    };
    if (operation === "acquire") {
      const original = fs.readdirSync;
      let paused = false;
      fs.readdirSync = function(path, ...args) {
        if (!paused && String(path).endsWith("/leases")) { paused = true; pause(); }
        return original.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    }
    const machine = acquireEntrypointAdmission(root, "shared");
    if (operation === "release") {
      const original = fs.unlinkSync;
      fs.unlinkSync = function(path) { if (String(path).includes("/leases/")) pause(); return original.call(this, path); };
      syncBuiltinESMExports();
    }
    machine.release();
    fs.writeFileSync(done, "done");
  `, f.workspace, operation, ready, finish, done], { stdio: ["ignore", "ignore", "pipe"] });
  const exit = once(child, "exit"); let output = ""; child.stderr.on("data", value => { output += String(value); });
  try {
    const deadline = performance.now() + 10_000;
    while (!existsSync(ready)) {
      if (performance.now() > deadline) throw new Error("peer-lease-ready-unproved");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const registry = f.machine.readProfileRegistry();
    const realOpen = fs.openSync, realWrite = fs.writeFileSync;
    let crossed = false, mutexWrites = 0;
    vi.spyOn(fs, "writeFileSync").mockImplementation((path, data, options) => {
      if (String(path).includes("admission-mutex")) mutexWrites++;
      return realWrite(path, data, options);
    });
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (!crossed && path === profilesPath) {
        crossed = true; realWrite(finish, "finish");
        const bound = performance.now() + 10_000;
        while (!existsSync(done)) {
          if (performance.now() > bound) throw new Error("peer-lease-completion-unproved");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    assert.equal(crossed, true); assert.equal(mutexWrites, 0);
    assert.deepEqual(await exit, [0, null], output);
  } finally {
    vi.restoreAllMocks(); syncBuiltinESMExports(); writeFileSync(finish, "finish");
    try { assert.deepEqual(await exit, [0, null], output); } finally { f.close(); }
  }
});

it.each(["empty", "malformed", "unknown", "dead", "unsafe"] as const)("refuses %s admission mutex custody during healthy profile observation", async kind => {
  const f = createBoundProfileFixture(), mutex = join(f.workspace, ".tracker", "control", "admission-mutex");
  const sleeper = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });
  const exit = once(sleeper, "exit");
  try {
    assert.ok(sleeper.pid);
    const observation = observeProcessIdentity(sleeper.pid); assert.equal(observation.state, "alive");
    if (observation.state !== "alive") throw new Error("fixture-process-identity-required");
    sleeper.stdin.end(); assert.deepEqual(await exit, [0, null]);
    assert.ok(f.machine.readProfileRegistry().activeProfileId);
    fs.mkdirSync(mutex, { mode: 0o700 });
    if (kind !== "empty") {
      if (kind === "unsafe") symlinkSync(join(f.workspace, "package.json"), join(mutex, "owner.json"));
      else writeFileSync(join(mutex, "owner.json"), JSON.stringify(kind === "malformed" ? {} : {
        schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: kind === "dead" ? sleeper.pid : process.pid,
        processIdentity: kind === "dead" ? observation.identity : { ...observation.identity, startToken: "foreign-start-token" },
      }), { mode: 0o600 });
    }
    assert.throws(() => f.machine.readProfileRegistry(), (error: unknown) => kind === "malformed"
      ? error instanceof z.ZodError
      : error instanceof Error && error.message === (kind === "unsafe"
        ? "directory-integrity: credential lock permissions or identity are invalid"
        : "runtime-control: profile-registry-mutex-custody-unavailable"));
  } finally {
    if (sleeper.exitCode === null && sleeper.signalCode === null) { sleeper.kill("SIGKILL"); await exit; }
    rmSync(mutex, { recursive: true, force: true }); f.close();
  }
});



it.each(["owner-replacement", "extra-entry", "directory-mode"] as const)("refuses %s after a genuine mutex owner observation", kind => {
  const f = createBoundProfileFixture(), mutex = join(f.workspace, ".tracker", "control", "admission-mutex");
  const ownerPath = join(mutex, "owner.json");
  try {
    const registry = f.machine.readProfileRegistry();
    const observed = observeProcessIdentity(process.pid);
    assert.equal(observed.state, "alive");
    if (observed.state !== "alive") throw new Error("fixture-process-identity-required");
    fs.mkdirSync(mutex, { mode: 0o700 });
    const bytes = JSON.stringify({ schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid,
      processIdentity: observed.identity });
    writeFileSync(ownerPath, bytes, { mode: 0o600 });
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    const originalOpen = fs.openSync;
    let reads = 0, changed = false;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === ownerPath && ++reads === 2) {
        changed = true;
        if (kind === "owner-replacement") {
          const replacement = join(mutex, "replacement.json");
          writeFileSync(replacement, bytes, { mode: 0o600 }); renameSync(replacement, ownerPath);
        } else if (kind === "extra-entry") writeFileSync(join(mutex, "unexpected"), "fixture", { mode: 0o600 });
        else fs.chmodSync(mutex, 0o755);
      }
      return originalOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    assert.throws(() => f.machine.readProfileRegistry(), (error: unknown) => error instanceof Error && (kind === "directory-mode"
      ? error.message === `runtime-control: unsafe directory ${mutex}`
      : error.message === "runtime-control: profile-registry-observation-changed"));
    assert.equal(changed, true);
  } finally {
    vi.restoreAllMocks(); syncBuiltinESMExports(); rmSync(mutex, { recursive: true, force: true }); f.close();
  }
});


it("refuses actual pending profile operation publication crossing a healthy observation", () => {
  const f = fixture();
  try {
    const active = f.session.signUp(f.fields); assert.equal(active.state, "active");
    const profilesPath = join(f.machine.stateRoot, "machine", "profiles.json");
    const verifiers = createProfileVerifiers(f.machine.stateRoot);
    const emailKey = verifiers.emailKeyFor("second@example.edu");
    const realOpen = fs.openSync;
    let reads = 0, changed = false;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === profilesPath && ++reads === 2) {
        changed = true;
        f.machine.beginProfileSignUp({ firstName: "Second", lastName: "Fixture", createdAt: IsoInstantSchema.parse(f.fields.createdAt),
          emailKey, commandFingerprint: "b".repeat(64) });
      }
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    assert.throws(() => f.machine.readProfileRegistry(), /profile-registry-observation-changed/u);
    assert.equal(changed, true);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); f.cleanup(); }
});


it.each(["owner-file", "prepared-directory", "control-directory", "closed-with-cleanup-failure"] as const)("preserves mutex preparation failure at %s", stage => {
  const f = createBoundProfileFixture(), mutex = join(f.workspace, ".tracker", "control", "admission-mutex");
  const realOpen = fs.openSync, realClose = fs.closeSync, realRename = fs.renameSync;
  const realUnlink = fs.unlinkSync, realRmdir = fs.rmdirSync, realSync = fs.fsyncSync;
  const primary = new Error("fixture-mutex-preparation-primary"), cleanup = new Error("fixture-mutex-preparation-cleanup");
  const closedFailure = stage === "closed-with-cleanup-failure";
  let prepared: string | undefined, backing: string | undefined, descriptor: number | undefined;
  let identity: ReturnType<typeof fs.fstatSync> | undefined, bytes: Buffer | undefined;
  let closes = 0, removals = 0, acquisitions = 0, published = false, descriptorClosed = false, descriptorCloseFailed = false;
  const failures: unknown[] = [];
  let observed: unknown, actualCloseFailure: { error: unknown } | undefined;
  try {
    const registry = f.machine.readProfileRegistry();
    const registryBytes = fs.readFileSync(join(f.machine.stateRoot, "machine", "profiles.json"));
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      const fd = realOpen(path, flags, mode);
      if (typeof path !== "string") return fd;
      if (basename(dirname(path)).startsWith(".admission-mutex-tmp-")) prepared = dirname(path);
      if (basename(path).startsWith(".admission-mutex-tmp-")) prepared = path;
      const selected = prepared !== undefined && ((stage === "owner-file" || closedFailure)
        ? flags === "r" && dirname(path) === prepared && /^\.[0-9a-f-]{36}\.tmp$/u.test(basename(path))
        : stage === "prepared-directory" ? path === prepared && published
        : path === dirname(prepared) && published);
      if (selected && descriptor === undefined) {
        descriptor = fd; backing = path; identity = fs.fstatSync(fd);
        if (identity.isFile()) bytes = fs.readFileSync(fd);
      }
      return fd;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === mutex) acquisitions++;
      realRename(from, to);
      if (prepared !== undefined && typeof to === "string" && dirname(to) === prepared && basename(to) === "owner.json") published = true;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (closedFailure && fd === descriptor) throw primary; realSync(fd); });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      if (fd === descriptor) { closes++; if (!closedFailure) throw primary; }
      try { realClose(fd); }
      catch (error) {
        if (fd === descriptor) { descriptorCloseFailed = true; actualCloseFailure = { error }; }
        throw error;
      }
      if (fd === descriptor) descriptorClosed = true;
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
      if (prepared !== undefined && typeof path === "string" && dirname(path) === prepared) {
        removals++; if (closedFailure) throw cleanup;
      }
      realUnlink(path);
    });
    vi.spyOn(fs, "rmdirSync").mockImplementation(path => { if (path === prepared) removals++; realRmdir(path); });
    syncBuiltinESMExports();
    try { f.machine.publishProfileRegistry(registry, registry); } catch (error) { observed = error; }
    assert.ok(observed instanceof AggregateError);
    if (closedFailure) {
      assert.equal(observed instanceof AuthoritySourceClosureUnprovedError, false);
      assert.equal(observed.errors.length, 2);
      const first: unknown = observed.errors[0];
      assert.ok(first instanceof AggregateError);
      assert.deepEqual(first.errors, [primary, cleanup]); assert.equal(first.cause, primary);
      assert.equal(observed.errors[1], cleanup); assert.equal(observed.cause, first);
      assert.equal(removals, 2);
    } else {
      assert.ok(observed instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(observed.errors.length, 1);
      const first: unknown = observed.errors[0];
      assert.ok(first instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(observed.cause, first); assert.deepEqual(first.errors, [primary]); assert.equal(first.cause, primary);
      assert.equal(removals, 0);
    }
    assert.equal(closes, 1); assert.equal(acquisitions, 0);
    assert.ok(prepared !== undefined && backing !== undefined && descriptor !== undefined && identity !== undefined);
    assert.equal(fs.existsSync(mutex), false);
    assert.equal(fs.lstatSync(prepared).mode & 0o777, 0o700);
    const heldDescriptor = descriptor;
    if (closedFailure) assert.throws(() => fs.fstatSync(heldDescriptor));
    else {
      const held = fs.fstatSync(descriptor), physical = fs.lstatSync(backing);
      assert.equal(held.dev, identity.dev); assert.equal(held.ino, identity.ino);
      assert.equal(physical.dev, identity.dev); assert.equal(physical.ino, identity.ino);
      assert.equal(physical.mode & 0o777, identity.isFile() ? 0o600 : 0o700);
    }
    if (bytes !== undefined) assert.deepEqual(fs.readFileSync(backing), bytes);
    assert.equal(fs.existsSync(join(prepared, "owner.json")), stage === "prepared-directory" || stage === "control-directory");
    assert.deepEqual(fs.readFileSync(join(f.machine.stateRoot, "machine", "profiles.json")), registryBytes);
  } catch (error) { failures.push(error); }
  finally {
    vi.restoreAllMocks(); syncBuiltinESMExports();
    if (descriptor !== undefined && !descriptorClosed && !descriptorCloseFailed) {
      try { realClose(descriptor); descriptorClosed = true; } catch (error) { actualCloseFailure = { error }; }
    }
    if (descriptor === undefined || descriptorClosed) {
      if (prepared !== undefined) { try { fs.rmSync(prepared, { recursive: true }); } catch (error) { failures.push(error); } }
      try { f.close(); } catch (error) { failures.push(error); }
    }
  }
  if (descriptor !== undefined && !descriptorClosed) {
    throw retainAuthoritySourceClosure([...(observed === undefined ? [] : [observed]),
      ...(actualCloseFailure === undefined ? [] : [actualCloseFailure.error]), ...failures], {
      descriptor: { descriptor, ...(identity === undefined ? {} : { identity }) },
      directory: { path: prepared, fixture: f },
    });
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "fixture-mutex-preparation-cleanup", { cause: failures[0] });
});

for (const unproved of [false, true]) it(`only tolerates a vanished observation mutex when descriptor closure is ${unproved ? 'unproved' : 'proved'}`, () => {
  const f = createBoundProfileFixture(), mutex = join(f.workspace, ".tracker", "control", "admission-mutex");
  const ownerPath = join(mutex, "owner.json");
  const observed = observeProcessIdentity(process.pid);
  assert.ok(observed.state === 'alive');
  const bytes = JSON.stringify({ schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid,
      processIdentity: observed.identity });
  const realOpen = fs.openSync, realClose = fs.closeSync, realUnlink = fs.unlinkSync, realRmdir = fs.rmdirSync;
  let descriptor: number | undefined, closes = 0, removals = 0, proved = false;
  let missing: unknown;
  const registry = f.machine.readProfileRegistry();
  fs.mkdirSync(mutex, { mode: 0o700 }); writeFileSync(ownerPath, bytes, { mode: 0o600 });
  const ownerIdentity = fs.lstatSync(ownerPath);
  const removeOwner = () => {
    const current = fs.lstatSync(ownerPath);
    assert.equal(current.dev, ownerIdentity.dev); assert.equal(current.ino, ownerIdentity.ino);
    assert.equal(fs.readFileSync(ownerPath, 'utf8'), bytes);
    realUnlink(ownerPath); realRmdir(mutex); removals++;
  };
  const opened = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
    if (args[0] === ownerPath && !unproved && removals === 0) removeOwner();
    const fd = realOpen(...args);
    if (args[0] === ownerPath) { assert.equal(descriptor, undefined); descriptor = fd; }
    return fd;
  });
  const closed = vi.spyOn(fs, 'closeSync').mockImplementation(fd => {
    if (fd === descriptor) {
      closes++; removeOwner();
      try { fs.lstatSync(ownerPath); } catch (error) { missing = error; }
      assert.ok(missing instanceof Error); assert.equal(Reflect.get(missing, 'code'), 'ENOENT');
      throw missing;
    }
    realClose(fd);
  });
  syncBuiltinESMExports();
  try {
    if (unproved) {
      let failure: unknown;
      try { f.machine.readProfileRegistry(); } catch (error) { failure = error; }
      assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(failure.errors, [missing]); assert.equal(failure.cause, missing);
      assert.ok(descriptor !== undefined);
      const held = fs.fstatSync(descriptor); assert.equal(held.dev, ownerIdentity.dev); assert.equal(held.ino, ownerIdentity.ino);
      const heldBytes = Buffer.alloc(Buffer.byteLength(bytes));
      assert.equal(fs.readSync(descriptor, heldBytes, 0, heldBytes.length, 0), heldBytes.length);
      assert.equal(heldBytes.toString('utf8'), bytes);
      assert.equal(closes, 1);
    } else {
      assert.deepEqual(f.machine.readProfileRegistry(), registry);
      assert.equal(descriptor, undefined); assert.equal(closes, 0);
    }
    assert.equal(removals, 1); assert.equal(fs.existsSync(mutex), false);
    opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    if (descriptor !== undefined) {
      realClose(descriptor); const fd = descriptor;
      assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && Reflect.get(error, 'code') === 'EBADF');
    }
    proved = true;
  } finally { opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports(); if (proved) f.close(); }
});


it('retains genuine bound-profile setup custody after a native source close failure', () => {
  const actualOpen = fs.openSync, actualClose = fs.closeSync;
  const actualRegister = fixtureAdmissions.registerBoundProfile;
  const owned: { workspace?: string; source?: string; descriptor?: number;
    identity?: { dev: number | bigint; ino: number | bigint };
    profile?: Parameters<typeof actualRegister>[0]; machine?: Parameters<typeof actualRegister>[1]; sourceFailure?: unknown } = {};
  const primary = new Error('bound-profile-setup-native-close-refused');
  let injected = false, closes = 0, removalBaseline = 0;
  const restores: (() => void)[] = [];
  let testFailure: { error: unknown } | undefined;
  try {
    const temp = vi.spyOn(fs, 'mkdtempSync'); restores.push(() => temp.mockRestore());
    const removed = vi.spyOn(fs, 'rmSync'); restores.push(() => removed.mockRestore());
    const registered = vi.spyOn(fixtureAdmissions, 'registerBoundProfile').mockImplementation((profile, machine) => {
      owned.profile = profile; owned.machine = machine;
      try { actualRegister(profile, machine); }
      catch (error) { owned.sourceFailure = error; throw error; }
    });
    restores.push(() => registered.mockRestore());
    const opened = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const descriptor = actualOpen(...args), flags = args[1], source = args[0];
      const workspace: unknown = temp.mock.results[0]?.value;
      if (owned.workspace === undefined && typeof workspace === 'string') owned.workspace = realpathSync(workspace);
      const readOnly = flags === 'r' || typeof flags === 'number' && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0;
      if (owned.profile !== undefined && owned.machine !== undefined && owned.descriptor === undefined && readOnly && typeof source === 'string'
        && owned.workspace !== undefined && source.startsWith(owned.workspace + '/')) {
        const identity = fs.fstatSync(descriptor);
        if (identity.isFile()) { owned.descriptor = descriptor; owned.source = source; owned.identity = identity; }
      }
      return descriptor;
    });
    restores.push(() => opened.mockRestore());
    const closed = vi.spyOn(fs, 'closeSync').mockImplementation(descriptor => {
      if (descriptor === owned.descriptor) {
        if (!injected) removalBaseline = removed.mock.calls.length;
        injected = true; closes++; throw primary;
      }
      actualClose(descriptor);
    });
    restores.push(() => closed.mockRestore());
    syncBuiltinESMExports();
    let observed: unknown;
    try { createBoundProfileFixture(); } catch (error) { observed = error; }
    assert.ok(observed instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(observed, owned.sourceFailure);
    assert.deepEqual(observed.errors, [primary]); assert.equal(observed.cause, primary);
    assert.ok(owned.machine !== undefined && owned.profile !== undefined && owned.workspace !== undefined
      && owned.source !== undefined && owned.descriptor !== undefined && owned.identity !== undefined);
    const machine = owned.machine, profile = owned.profile;
    assert.equal(injected, true); assert.equal(closes, 1);
    assert.equal(removed.mock.calls.length, removalBaseline);
    assert.doesNotThrow(() => machine.assertLive()); assert.doesNotThrow(() => profile.assertLive());
    assert.equal(machine.stateRoot, join(owned.workspace, rebuildRuntimeIsolation.stateRoot));
    assert.equal(fs.existsSync(owned.workspace), true);
    const descriptor = fs.fstatSync(owned.descriptor), source = fs.lstatSync(owned.source);
    assert.equal(descriptor.dev, owned.identity.dev); assert.equal(descriptor.ino, owned.identity.ino);
    assert.equal(source.dev, owned.identity.dev); assert.equal(source.ino, owned.identity.ino);
    assert.equal(removed.mock.calls.length, removalBaseline); assert.equal(closes, 1);
  } catch (error) { testFailure = { error }; }
  const cleanupErrors: unknown[] = [];
  for (const restore of restores.reverse()) { try { restore(); } catch (error) { cleanupErrors.push(error); } }
  try { syncBuiltinESMExports(); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError([
    ...(testFailure === undefined ? [] : [testFailure.error]), ...cleanupErrors,
  ], 'bound-profile-setup-observation-restore-failed', { cause: testFailure === undefined ? cleanupErrors[0] : testFailure.error });

  if (testFailure !== undefined) {
    const error = testFailure.error;
    throw error instanceof Error ? error : new AggregateError([error], 'Fixture regression failed', { cause: error });
  }
});
