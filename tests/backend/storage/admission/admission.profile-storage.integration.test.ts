import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { deriveProfileNames, SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { finishProfileOnboarding, readyProfileOnboarding } from "../../../support/helpers/admission-fixture.js";
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
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createProfileVerifiers } from "../../../../src/backend/storage/configuration/verifier-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createSyntheticProfileSession as createProfileSession } from "../../../support/helpers/admission-fixture.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../../src/rules/time/clock.js";


async function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-admission-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  fs.mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  let busy = false;
  const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot,
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
    activity: { hasUnquiescedWork: () => busy }, backupPaths: () => [], loginDataPaths: () => [] });
  const registry = createProfileRegistry(machine);
  const fields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "fixture-password", createdAt: "2026-09-06T12:00:00.000Z" };
  return { workspace, lifetime, machine, session, registry, fields, busy() { busy = true; }, async cleanup() { await session.close(); machine.release(); rmSync(workspace, { recursive: true, force: true }); } };
}

it("boots a genuine machine without a dummy database, then creates a bound canonical profile through registered intent", async () => {
  const f = await fixture();
  try {
    assert.equal(existsSync(join(f.machine.stateRoot, "state.db")), false);
    assert.equal(f.registry.read().activeProfileId, null);
    assert.throws(() => AuthorityDatabase.open(f.machine, { path: join(f.machine.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-bound-authority-required/u);
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields));
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
  } finally { await f.cleanup(); }
});

it("does not mint a new child from a ready claim after logout starts while retaining existing drain custody", async () => {
  const f = await fixture();
  try {
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields)); assert.ok(active.state === "active");
    const claim = f.registry.storageClaim(active.profileId), child = f.machine.admitProfile(claim);
    f.busy();
    assert.equal(f.session.logOut(active.token, { at: "2026-09-06T12:01:00.000Z" }).state, "cancelling");
    assert.throws(() => f.machine.admitProfile(claim), /profile-storage-claim-generation-changed/u);
    child.assertLive();
    assert.throws(() => child.assertCredentialRead(), /profile-storage-claim-generation-changed/u);
    assert.throws(() => child.assertWritable(), /profile-storage-claim-generation-changed/u);
    assert.throws(() => AuthorityDatabase.open(child, { path: join(child.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" }), /profile-storage-claim-generation-changed/u);
    const refused = f.session.readFile(active.token, "absent");
    assert.ok("state" in refused && refused.state === "refused");
    assert.equal((await finishProfileOnboarding(f.session, f.session.signUp({ ...f.fields, email: "sam@ucsd.edu" }))).state, "refused");
    child.release();
  } finally { await f.cleanup(); }
});

it("rejects restored registry bytes against installation control continuity", async () => {
  const f = await fixture();
  try {
    const path = join(f.machine.stateRoot, "machine", "profiles.json");
    const initial = readFileSync(path);
    assert.equal((await finishProfileOnboarding(f.session, f.session.signUp(f.fields))).state, "active");
    writeFileSync(path, initial, { mode: 0o600 });
    assert.throws(() => f.machine.readProfileRegistry(), /profile-registry-continuity-mismatch/u);
  } finally { await f.cleanup(); }
});


it("rejects fabricated pending operations and modified persisted setup fields before profile roots", async () => {
  const f = await fixture();
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
  } finally { await f.cleanup(); }
});

it("rejects foreign canonical binding and hardlink or symlink database substitution before writable opening", async () => {
  const f = await fixture();
  try {
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields)); assert.ok(active.state === "active");
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
  } finally { await f.cleanup(); }
});

it("reissues only exact pending logout settlement after restart and rejects forged, changed or completed custody", async () => {
  const f = await fixture();
  try {
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields)); assert.ok(active.state === "active");
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
  } finally { await f.cleanup(); }
});

it("publishes ready only from an exact actual credential witness and rechecks postcapture canonical binding and database identity", async () => {
  const f = await fixture();
  let setup: RuntimeAdmission | undefined;
  try {
    const draft = f.session.signUp(f.fields); assert.ok(draft.state === "onboarding");
    assert.equal(f.registry.read().profiles.length, 0);
    assert.equal(createProfileVerifiers(f.machine.stateRoot).identify(f.fields.email), "unknown");
    const ready = await readyProfileOnboarding(f.session, draft);
    assert.ok(ready.state === "onboarding" && ready.step === "ready");
    assert.equal(f.registry.read().profiles.length, 0);
    assert.equal(createProfileVerifiers(f.machine.stateRoot).identify(f.fields.email), "unknown");
    setup = f.machine.admitProfile(f.registry.storageClaim(draft.profileId));
    const path = join(setup.stateRoot, "state.db");
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DROP TRIGGER database_states_binding_immutable");
      raw.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID());
    } finally { raw.close(); }
    await assert.rejects(f.session.completeOnboarding(draft.token, draft.operationId), /profile-database-binding-mismatch/u);
    assert.equal(f.registry.read().profiles.length, 0);
    const restore = new DatabaseSync(path);
    try { restore.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(draft.profileId);
      restore.exec("CREATE TRIGGER database_states_binding_immutable BEFORE UPDATE OF installation_id,profile_id ON database_states BEGIN SELECT RAISE(ABORT,'profile-database-binding-immutable'); END;"); }
    finally { restore.close(); }

    assert.equal(createProfileVerifiers(f.machine.stateRoot).identify(f.fields.email), "unknown");
    const original = path + ".held";
    const store = createCredentialStore({ admission: setup, stateRoot: setup.stateRoot, erasureJournalAdmission: f.machine,
      erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${draft.profileId}.json`) });
    const operationPath = join(f.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
    const publicationBoundary = new Error("fixture actual registration publication boundary");
    const nativeRename = fs.renameSync;
    let publicationBoundaryObserved = false;
    const stopped = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      nativeRename(source, target);
      if (String(target) === operationPath && SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).phase === "publishing") {
        publicationBoundaryObserved = true;
        throw publicationBoundary;
      }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.session.completeOnboarding(draft.token, draft.operationId), error => error === publicationBoundary); }
    finally { stopped.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(publicationBoundaryObserved, true);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
      commandFingerprint: operation.commandFingerprint, expectedRevision: operation.expectedRevision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: operation.createdAt,
      entries: { ucpathUserId: { set: f.fields.email }, ucpathPassword: { set: f.fields.password },
        timekeeperName: { set: deriveProfileNames(f.fields.firstName, f.fields.lastName).timekeeperName } } });
    const witness = captureCommittedCredentialReplay(store, request);
    const verifier = createProfileVerifiers(f.machine.stateRoot).prepare(draft.profileId, f.fields.email, f.fields.password);
    const publish = f.machine.publishProfileRegistration.bind(f.machine);
    assert.throws(() => captureCommittedCredentialReplay({ ...store }, request), /profile-signup-credential-store-unissued/u);
    assert.throws(() => publish(operation, { ...witness }, verifier), /profile-signup-receipt-mismatch/u);
    assert.throws(() => publish({ ...operation, writeId: randomUUID() }, witness, verifier), /profile-signup-intent-mismatch/u);
    const changedBinding = new DatabaseSync(path);
    try {
      changedBinding.exec("DROP TRIGGER database_states_binding_immutable");
      changedBinding.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID());
    } finally { changedBinding.close(); }
    try { assert.throws(() => publish(operation, witness, verifier), /profile-database-binding-mismatch/u); }
    finally {
      const restoredBinding = new DatabaseSync(path);
      try {
        restoredBinding.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(draft.profileId);
        restoredBinding.exec("CREATE TRIGGER database_states_binding_immutable BEFORE UPDATE OF installation_id,profile_id ON database_states BEGIN SELECT RAISE(ABORT,'profile-database-binding-immutable'); END;");
      } finally { restoredBinding.close(); }
    }
    renameSync(path, original);
    writeFileSync(path, readFileSync(original), { mode: 0o600 });
    try {
      assert.throws(() => publish(operation, witness, verifier), /profile-signup-database-changed/u);
      assert.equal(f.registry.read().profiles.length, 0);
      assert.equal(createProfileVerifiers(f.machine.stateRoot).identify(f.fields.email), "unknown");
    } finally { if (existsSync(original)) { rmSync(path); renameSync(original, path); } }
    const active = await f.session.completeOnboarding(draft.token, draft.operationId);
    assert.equal(f.registry.read().profiles[0]?.profileId, active.profileId);
    const current = f.registry.read();
    const row = current.profiles[0]; assert.ok(row);
    assert.throws(() => f.machine.publishProfileRegistry(current, { ...current, profiles: [...current.profiles, { ...row, profileId: randomUUID() }] }), /profile-registry-registration-required/u);
  } finally { setup?.release(); await f.cleanup(); }
});

it("refuses a concurrent healthy observation change and performs healthy registry reads without durable mutex writes", async () => {
  const f = await fixture();
  try {
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields)); assert.ok(active.state === "active");
    const current = f.registry.read();
    const realOpen = fs.openSync;
    const profilePath = join(f.machine.stateRoot, "machine", "profiles.json");
    const mutexPath = join(f.workspace, ".tracker", "control", ".installation-mutation.lock");
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
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === mutexPath && typeof flags === "number" && (flags & fs.constants.O_EXCL) !== 0) writes++;
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    const original = readFileSync(profilePath);
    const priorWrites = writes;
    assert.deepEqual(f.machine.readProfileRegistry(), before);
    assert.equal(writes, priorWrites);
    assert.deepEqual(readFileSync(profilePath), original);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === mutexPath && typeof flags === "number" && (flags & fs.constants.O_EXCL) !== 0) writes++;
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    f.machine.publishProfileRegistry(before, { ...before, sessionGeneration: before.sessionGeneration + 1 });
    assert.ok(writes > priorWrites);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await f.cleanup(); }
});


it.each(["held", "released"] as const)("observes healthy profile evidence across a real peer C mutex %s without creating a mutex", async phase => {
  const f = await createBoundProfileFixture({ sharedMachine: true });
  const ready = join(f.workspace, "peer-ready"), finish = join(f.workspace, "peer-finish"), done = join(f.workspace, "peer-done");
  const profilesPath = join(f.machine.stateRoot, "machine", "profiles.json"), mutex = join(f.workspace, ".tracker", "control", ".installation-mutation.lock");
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import fs from "node:fs";
    import { join } from "node:path";
    import { WorkerRuntimeLifetimeLock } from "./src/backend/storage/admission/lifetime-lock.ts";
    import { acquireSharedRuntimeAdmission } from "./src/backend/storage/admission/admission.ts";
    import { withPrivateFileLock } from "./src/backend/storage/configuration/credential-safe-file.ts";
    const [root, phase, ready, finish, done, port] = process.argv.slice(1);
    const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(port), () => process.exit(1));
    const machine = acquireSharedRuntimeAdmission(root, lifetime);
    const pause = () => {
      fs.writeFileSync(ready, "ready");
      const deadline = performance.now() + 10000;
      while (!fs.existsSync(finish)) {
        if (performance.now() > deadline) throw new Error("peer-control-barrier-expired");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    };
    withPrivateFileLock(join(root, ".tracker", "control"), ".installation-mutation.lock", () => { if (phase === "held") pause(); });
    if (phase === "released") pause();
    machine.release(); fs.writeFileSync(done, "done");
    await lifetime.close(); process.disconnect();
  `, f.workspace, phase, ready, finish, done, String(f.lifetime.port)], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const closed = once(child, "close"); let output = "";
  assert.ok(child.stderr);
  child.stderr.on("data", value => { output += String(value); });
  let primary: { error: unknown } | undefined;
  try {
    await f.lifetime.share(child);
    const deadline = performance.now() + 10_000;
    while (!existsSync(ready)) {
      if (performance.now() > deadline) throw new Error("peer-control-ready-unproved");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const registry = f.machine.readProfileRegistry();
    const realOpen = fs.openSync, realWrite = fs.writeFileSync;
    let crossed = false, mutexWrites = 0;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === mutex && typeof flags === "number" && (flags & fs.constants.O_EXCL) !== 0) mutexWrites++;
      if (!crossed && path === profilesPath) {
        crossed = true; realWrite(finish, "finish");
        const bound = performance.now() + 10_000;
        while (!existsSync(done)) {
          if (performance.now() > bound) throw new Error("peer-control-completion-unproved");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      return realOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    assert.equal(crossed, true); assert.equal(mutexWrites, 0);
    assert.deepEqual(await closed, [0, null], output);
  } catch (error) { primary = { error }; }
  vi.restoreAllMocks(); syncBuiltinESMExports();
  const failures: unknown[] = [];
  let closureProved = false;
  try { writeFileSync(finish, "finish"); assert.deepEqual(await closed, [0, null], output); closureProved = true; }
  catch (error) { failures.push(error); }
  if (closureProved) { try { await f.close(); } catch (error) { failures.push(error); } }
  if (failures.length !== 0) throw new AggregateError(primary === undefined ? failures : [primary.error, ...failures],
    "peer control observation and owned closure failed", { cause: primary?.error ?? failures[0] });
  if (primary !== undefined) throw primary.error;
});

it("refuses actual pending profile operation publication crossing a healthy observation", async () => {
  const f = await fixture();
  try {
    const active = await finishProfileOnboarding(f.session, f.session.signUp(f.fields)); assert.equal(active.state, "active");
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
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await f.cleanup(); }
});


it('retains genuine bound-profile setup custody after a native source close failure', async () => {
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
    try { await createBoundProfileFixture(); } catch (error) { observed = error; }
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
