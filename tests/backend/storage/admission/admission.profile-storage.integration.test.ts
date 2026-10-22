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
import { join } from "node:path";
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
