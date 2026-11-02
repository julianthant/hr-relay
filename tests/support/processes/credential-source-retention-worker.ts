import type { ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import type { RuntimeAdmission as RuntimeAdmissionType } from "../../../src/backend/storage/admission/admission.js";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, sep } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";

const actualEntry: unknown = Entry;
if (actualEntry !== FakeKeyringEntry || process.env.RELAY_TEST_KEYCHAIN === undefined
  || !process.env.NODE_OPTIONS?.includes("credential-keychain-process-preload.mjs")) throw new Error("retention-worker-fake-keychain-required");
if (!process.connected || process.send === undefined) throw new Error("retention-worker-ipc-required");
const { z } = await import("zod");
const [port, workspace, profileId, scenario, crashNonce] = z.tuple([z.coerce.number().int().positive().max(65535), z.string().min(1), z.uuid(),
  z.enum(["readonly-native-close", "worker-native-open", "writer-close", "duo-read-first", "duo-read-second", "stopped-head-close", "protected-source", "chatgpt-source", "account-projection", "stopped-control-snapshot-disposal", "setup-protected-close", "authenticated-upgrade-key-close", "authenticated-upgrade-service-inspection", "authenticated-upgrade-binding-consume", "authenticated-upgrade-unproved-close", "authenticated-upgrade-closed-publication-refusal", "protected-crash-before", "protected-crash-after", "logout-prepared", "logout-commit-intent", "logout-after-commit", "logout-done", "logout-ready", "logout-unlink", "logout-writer-close", "logout-third-image", "logout-resume", "logout-unknown-copy", "logout-live-process", "logout-browser-root", "logout-key-replacement", "logout-snapshot-disposal", "logout-process-observation", "logout-seed", "logout-seed-unknown", "logout-unknown", "logout-browser-busy", "logout-browser-unproved", "logout-process-root-copy", "logout-exited-process", "logout-exit-only"]), z.uuid().optional()]).parse(process.argv.slice(2));
const { WorkerRuntimeLifetimeLock, isOfflineMaintenanceOperationActive } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
const { acquireSharedRuntimeAdmission, RuntimeAdmission } = await import("../../../src/backend/storage/admission/admission.js");
const { createCanonicalCredentials, captureStoppedCanonicalCredentialHead } = await import("../../../src/backend/storage/configuration/canonical-credential-store.js");
const { hasUnprovedSourceClosure, retainAuthoritySourceClosure, AuthoritySourceClosureUnprovedError } = await import("../../../src/backend/storage/source-closure.js");
const { createCredentialStore, CredentialStoreCommitUncertainError } = await import("../../../src/backend/storage/configuration/credential-store.js");
const { createChatGptCredentialRepository, ChatGptCredentialError } = await import("../../../src/backend/storage/configuration/chatgpt-credential-repository.js");
const { createChatGptAccountService } = await import("../../../src/backend/accounts/chatgpt-account-service.js");
const { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } = await import("../../../src/models/config/protected-settings.js");
const { manualClock } = await import("../../../src/rules/time/clock.js");
const { randomUUID } = await import("node:crypto");
if (scenario.startsWith("logout-")) {
  try { await runLogout(); }
  catch (error) {
    const name = error instanceof Error && ["AssertionError", "TypeError", "RangeError", "SyntaxError"].includes(error.name) ? error.name : "Error";
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause
      : error instanceof Error && "actual" in error && error.actual instanceof Error ? error.actual : error;
    const locations = [error, cause].flatMap(failure => failure instanceof Error ? (failure.stack ?? "").split("\n") : []).flatMap(line => {
      const match = /(?:^|\/)((?:tests|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?):[1-9]\d*:[1-9]\d*)\)?$/u.exec(line.replaceAll("\\", "/").trim());
      return match?.[1] === undefined ? [] : [match[1]];
    }).slice(0, 8);
    process.send({ scenario, assertionsComplete: false, failure: { name, locations } });
  }
  await new Promise<never>(() => { setInterval(() => {}, 1000); });
}
const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => { process.exit(91); });
const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
function contains(error: unknown, expected: unknown): boolean {
  const pending: unknown[] = [error], seen = new Set<unknown>();
  while (pending.length) {
    const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error) pending.push(value.cause);
  }
  return seen.has(expected);
}
function frameRevision(path: string): number {
  const value: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
  return z.object({ revision: z.number().int().nonnegative() }).parse(value).revision;
}
function caught(work: () => unknown): unknown {
  try { work(); } catch (error) { return error; }
  assert.fail("expected retained source failure");
}
async function assertRetained(admission: RuntimeAdmissionType, machine: RuntimeAdmissionType, owner: { assertHeld(): void; close(): Promise<void>; assertRuntimeAvailable(): void }, failure: unknown, source: unknown, stateRoot: string) {
  assert.equal(hasUnprovedSourceClosure(failure), true);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(hasUnprovedSourceClosure(caught(() => admission.release())), true);
    assert.equal(hasUnprovedSourceClosure(caught(() => machine.release())), true);
    await assert.rejects(owner.close(), error => hasUnprovedSourceClosure(error) && contains(error, source));
  }
  owner.assertHeld(); assert.throws(() => owner.assertRuntimeAvailable(), error => hasUnprovedSourceClosure(error));
  assert.equal(fs.existsSync(stateRoot), true);
}
async function runCurrent() {
  const machine = acquireSharedRuntimeAdmission(workspace, lifetime), admission = machine.admitProfile(profileId);
  const owner = createCanonicalCredentials(admission), path = join(admission.stateRoot, "credentials", "protected.json");
  if (scenario === "protected-crash-before" || scenario === "protected-crash-after") {
    const nonce = z.uuid().parse(crashNonce);
    const input = ProtectedSettingsApplyInputSchema.parse({ commandId: "11111111-1111-4111-8111-111111111111", writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      commandFingerprint: "1".repeat(64), expectedRevision: createCredentialStore({ admission, stateRoot: admission.stateRoot }).read().revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-09-06T12:00:00.000Z",
      entries: { ucpathPassword: { set: "credential-store-private-one" } } });
    const store = createCredentialStore({ admission, stateRoot: admission.stateRoot, hooks: {
      [scenario === "protected-crash-before" ? "beforeRename" : "afterRename"]() {
        fs.writeFileSync(join(workspace, `.credential-publication-${nonce}.json`), JSON.stringify({ nonce, scenario,
          commandId: input.commandId, expectedRevision: input.expectedRevision }), { mode: 0o600, flag: "wx", flush: true });
        process.kill(process.pid, "SIGKILL");
      }
    } });
    store.apply(input);
    assert.fail("publication crash boundary did not terminate the child");
  }
  if (scenario === "readonly-native-close") {
    const { DatabaseSync } = await import("node:sqlite");
    const { withAuthorityDatabaseReadOnly } = await import("../../../src/backend/storage/sqlite/readonly-authority-snapshot.js");
    const stateRoot = admission.stateRoot, path = join(stateRoot, "state.db"), before = fs.readFileSync(path);
    const primary = new Error("read-callback-refused"), cleanup = new Error("native-copy-close-refused");
    const close = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close.value;
    assert.ok(close);
    const owner: { database?: InstanceType<typeof DatabaseSync> } = {};
    let directory: string | undefined, closes = 0, failure: unknown;
    DatabaseSync.prototype.close = function (this: InstanceType<typeof DatabaseSync>) {
      const location = this.location(); assert.ok(location); assert.equal(location.endsWith(`${sep}authority.sqlite`), true);
      directory = dirname(location); owner.database = this; closes++; throw cleanup;
    };
    syncBuiltinESMExports();
    try { withAuthorityDatabaseReadOnly(admission, path, () => { throw primary; }); }
    catch (error) { failure = error; }
    finally { DatabaseSync.prototype.close = close; syncBuiltinESMExports(); }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(failure.errors, [primary, cleanup]); assert.equal(failure.cause, primary);
    const database = owner.database;
    assert.equal(closes, 1); assert.ok(database); assert.ok(directory);
    assert.equal(database.prepare("SELECT 1 AS live").get()?.live, 1);
    assert.equal(fs.lstatSync(directory).isDirectory(), true); assert.deepEqual(fs.readFileSync(path), before);
    await assertRetained(admission, machine, lifetime, failure, cleanup, stateRoot);
    assert.equal(database.prepare("SELECT 1 AS live").get()?.live, 1);
    assert.equal(fs.existsSync(directory), true); assert.deepEqual(fs.readFileSync(path), before);
    process.send?.({ ownedSnapshot: directory }); return;
  }
  if (scenario === "protected-source" || scenario === "chatgpt-source") {
    const source = retainAuthoritySourceClosure([new Error("synthetic private source closure")], {});
    if (scenario === "protected-source") {
      const store = createCredentialStore({ admission, stateRoot: admission.stateRoot, hooks: { afterRename() { throw source; } } });
      const before = store.read();
      const input = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "a".repeat(64),
        expectedRevision: before.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: clock.now().toISOString(), entries: {} });
      const error = caught(() => store.apply(input)); assert.ok(error instanceof CredentialStoreCommitUncertainError); assert.ok(contains(error, source));
      assert.equal(frameRevision(path), before.revision + 1);
      await assertRetained(admission, machine, lifetime, error, source, admission.stateRoot);
    } else {
      const repository = createChatGptCredentialRepository({ admission, stateRoot: admission.stateRoot, afterRename() { throw source; } });
      let error: unknown;
      try { await repository.withLock(async tx => tx.replace({ schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null }, null)); }
      catch (failure) { error = failure; }
      assert.ok(error instanceof ChatGptCredentialError); assert.equal(error.code, "CHATGPT_CREDENTIAL_UNCERTAIN");
      assert.equal(error.message.includes("synthetic private"), false); assert.ok(contains(error, source));
      assert.equal(frameRevision(join(admission.stateRoot, "credentials", "chatgpt-account.json")), 1);
      await assertRetained(admission, machine, lifetime, error, source, admission.stateRoot);
    }
    return;
  }
  const targetPath = scenario === "writer-close" ? join(machine.stateRoot, "machine", "credential-keys", `.${profileId}.writer.lock`)
    : scenario === "account-projection" ? join(admission.stateRoot, "credentials", "chatgpt-account.json")
      : join(machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`);
  const before = fs.readFileSync(scenario === "writer-close" ? path : targetPath), close = fs.closeSync, stat = fs.fstatSync, rename = fs.renameSync;
  let descriptor: number | undefined, hits = 0, published = false;
  const source = new Error("synthetic actual native close refusal");
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === path) published = true; };
  fs.closeSync = value => {
    const opened = stat(value), target = fs.lstatSync(targetPath, { throwIfNoEntry: false });
    if (descriptor === undefined && target !== undefined && opened.dev === target.dev && opened.ino === target.ino
      && (scenario !== "writer-close" || published) && ++hits === (scenario === "duo-read-second" ? 2 : 1)) { descriptor = value; throw source; }
    close(value);
  };
  syncBuiltinESMExports();
  const account = scenario === "account-projection" ? createChatGptAccountService({ admission, stateRoot: admission.stateRoot, clock }) : undefined;
  let failure: unknown;
  if (account !== undefined) {
    const state = account.readAccount();
    assert.deepEqual(state, { state: "unavailable", code: "CHATGPT_CREDENTIAL_UNAVAILABLE", message: "ChatGPT credentials could not be read or saved safely." });
    assert.equal(JSON.stringify(state).includes(source.message), false);
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(account.close(), error => {
      failure = error; return hasUnprovedSourceClosure(error) && contains(error, source);
    });
  } else if (scenario === "writer-close") {
    const current = owner.readRecord("protected"); assert.ok(current);
    failure = caught(() => owner.replaceRecord("protected", current.revision, current.value));
    assert.ok(failure instanceof Error && "code" in failure); assert.equal(failure.code, "CREDENTIAL_UNCERTAIN");
    assert.equal(frameRevision(path), current.revision + 1);
  } else {
    if (scenario === "duo-read-second") owner.readRecord("duo");
    failure = caught(() => owner.readRecord("duo"));
  }
  fs.closeSync = close; fs.renameSync = rename; syncBuiltinESMExports();
  assert.ok(descriptor !== undefined); assert.ok(contains(failure, source));
  const target = fs.lstatSync(targetPath); assert.equal(stat(descriptor).ino, target.ino); assert.equal(stat(descriptor).dev, target.dev);
  if (scenario === "writer-close") { assert.equal(target.nlink, 1); assert.notDeepEqual(fs.readFileSync(path), before); }
  else assert.deepEqual(fs.readFileSync(targetPath), before);
  await assertRetained(admission, machine, lifetime, failure, source, admission.stateRoot);
  assert.equal(stat(descriptor).ino, target.ino);
}
async function runWorkerNativeOpening() {
  const { DatabaseSync } = await import("node:sqlite");
  const { createBoundProfileFixture, boundProfileCredentials } = await import("../helpers/admission-fixture.js");
  const { composeWorkerRuntime } = await import("../../../src/backend/app/composition/worker-compose.js");
  const { composeSelectedProfileStorage, RuntimeCustodyUncertainError } = await import("../../../src/backend/app/composition/storage-compose.js");
  const { AuthorityDatabase } = await import("../../../src/backend/storage/sqlite/authority-database.js");
  const { AuthoritySourceClosureUnprovedError } = await import("../../../src/backend/storage/source-closure.js");
  const { rebuildRuntimeIsolation } = await import("../../../src/backend/app/config/runtime-isolation.js");
  const root = join(workspace, `.worker-native-open-${z.uuid().parse(crashNonce)}`);
  const f = await createBoundProfileFixture({ workspace: root });
  fs.copyFileSync("package.json", join(root, "package.json"));
  const initialized = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  await initialized.account.close(); initialized.database.close();
  const raw = new DatabaseSync(f.path);
  try { raw.exec("CREATE TABLE unowned_authority(id TEXT)"); } finally { raw.close(); }
  const before = fs.readFileSync(f.path), source = new Error("synthetic native opening close refusal");
  const open = AuthorityDatabase.open.bind(AuthorityDatabase), nativeClose = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close.value, fileOpen = fs.openSync;
  assert.ok(nativeClose);
  const owner: { native?: InstanceType<typeof DatabaseSync> } = {};
  let issued: RuntimeAdmissionType | undefined, credentialReads = 0, browsers = 0;
  AuthorityDatabase.open = (admission, ...args) => { issued = admission; return open(admission, ...args); };
  DatabaseSync.prototype.close = function (this: InstanceType<typeof DatabaseSync>) {
    if (this.location() === f.path) { owner.native = this; throw source; }
    return nativeClose.call(this);
  };
  fs.openSync = (...args) => { if (String(args[0]) === join(f.stateRoot, "credentials", "protected.json")) credentialReads++; return fileOpen(...args); };
  syncBuiltinESMExports();
  let failure: unknown;
  try {
    try { await composeWorkerRuntime({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation,
      args: ["person-lookup", "--pool-index", "1", "--drain"], repoRoot: root, clock, env: {},
      sessionFactory: { probeProfile: async () => undefined, open: async () => { browsers++; throw new Error("unrequested browser effect"); } } }); }
    catch (error) { failure = error; }
  } finally { AuthorityDatabase.open = open; DatabaseSync.prototype.close = nativeClose; fs.openSync = fileOpen; syncBuiltinESMExports(); }
  assert.ok(failure instanceof RuntimeCustodyUncertainError); assert.equal(failure.errors.length, 1);
  const closure: unknown = failure.errors[0];
  assert.ok(closure instanceof AuthoritySourceClosureUnprovedError); assert.equal(failure.cause, closure);
  const causes: readonly unknown[] = closure.errors;
  assert.equal(causes.length, 2); assert.ok(causes[0] instanceof Error);
  assert.match(causes[0].message, /authority-native-schema-shape-mismatch/u);
  assert.equal(closure.cause, causes[0]); assert.equal(causes[1], source);
  const native = owner.native;
  assert.equal(credentialReads, 0); assert.equal(browsers, 0); assert.ok(native); assert.ok(issued);
  assert.equal(native.prepare("SELECT 1 AS value").get()?.value, 1);
  assert.deepEqual(fs.readFileSync(f.path), before);
  assert.deepEqual(native.prepare("SELECT * FROM worker_slots").all(), []);
  assert.deepEqual(native.prepare("SELECT * FROM worker_leases").all(), []);
  issued.assertLive();
  await assertRetained(issued, f.machine, f.lifetime, failure, source, f.stateRoot);
  assert.equal(native.prepare("SELECT 1 AS value").get()?.value, 1);
}

async function runStoppedHead() {
  const { createBoundProfileFixture } = await import("../helpers/admission-fixture.js");
  const ownedWorkspace = join(workspace, "retention-stopped-head"); fs.mkdirSync(ownedWorkspace, { mode: 0o700 });
  const f = await createBoundProfileFixture({ workspace: ownedWorkspace });
  const path = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), before = fs.readFileSync(path), target = fs.lstatSync(path);
  const id = f.admission.profileBinding.profileId; f.admission.release();
  const operation = f.machine.beginOfflineMaintenance(), stopped = f.machine.admitStoppedProfile(id, operation);
  const close = fs.closeSync, stat = fs.fstatSync, source = new Error("synthetic stopped head close refusal"); let descriptor: number | undefined;
  fs.closeSync = value => { const opened = stat(value); if (descriptor === undefined && opened.dev === target.dev && opened.ino === target.ino) { descriptor = value; throw source; } close(value); };
  syncBuiltinESMExports();
  const failure = caught(() => captureStoppedCanonicalCredentialHead(stopped, operation));
  fs.closeSync = close; syncBuiltinESMExports();
  assert.ok(descriptor !== undefined); assert.equal(stat(descriptor).ino, target.ino);
  assert.throws(() => operation.assertHeld(), error => contains(error, source)); assert.throws(() => f.machine.beginOfflineMaintenance());
  assert.deepEqual(fs.readFileSync(path), before);
  await assertRetained(stopped, f.machine, f.lifetime, failure, source, f.stateRoot);
  assert.equal(stat(descriptor).dev, target.dev); assert.equal(stat(descriptor).ino, target.ino);
}
async function runStoppedSnapshot() {
  const { createHistoricalIncompleteProfileFixture } = await import("../fixtures/storage/historical-incomplete-profile-fixture.js");
  const { writeStoppedProfileControlPredecessor } = await import("../fixtures/storage/stopped-profile-control-predecessor.js");
  const { releaseStoppedMachineControlUpgrade } = await import("../../../src/backend/storage/maintenance/upgrade.js");
  const f = await createHistoricalIncompleteProfileFixture();
  process.send?.({ ownedWorkspace: f.workspace });
  writeStoppedProfileControlPredecessor(f, 1);
  const sources = [f.databasePath, f.controlPath].map(path => ({ path, bytes: fs.readFileSync(path) }));
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime), restore = maintenance.maintenanceOperation(); assert.ok(restore);
  const control = maintenance.beginStoppedMachineControlUpgrade(restore), id = control.registeredProfileIds()[0]; assert.ok(id);
  control.profileInventory(id);
  const remove = fs.rmSync; let snapshotDirectory: string | undefined, disposals = 0;
  const source = new Error("synthetic stopped snapshot disposal refusal");
  fs.rmSync = (path, options) => {
    if (String(path).includes("relay-readonly-authority-")) { snapshotDirectory = String(path); disposals++; throw source; }
    remove(path, options);
  };
  syncBuiltinESMExports();
  const failure = caught(() => releaseStoppedMachineControlUpgrade(control, restore, true));
  assert.equal(hasUnprovedSourceClosure(failure), true); assert.ok(contains(failure, source)); assert.ok(snapshotDirectory);
  const snapshotPath = join(snapshotDirectory, "authority.sqlite"), snapshotBytes = fs.readFileSync(snapshotPath), snapshotIdentity = fs.lstatSync(snapshotPath);
  assert.equal(isOfflineMaintenanceOperationActive(restore), true);
  assert.throws(() => restore.assertHeld(), error => contains(error, source)); f.lifetime.assertHeld();
  assert.throws(() => maintenance.beginOfflineMaintenance()); assert.throws(() => RuntimeAdmission.acquireMachine(f.workspace, "shared", f.lifetime));
  const repeated = caught(() => releaseStoppedMachineControlUpgrade(control, restore, true));
  assert.equal(hasUnprovedSourceClosure(repeated), true); assert.ok(contains(repeated, source));
  assert.equal(disposals, 1); assert.deepEqual(fs.readFileSync(snapshotPath), snapshotBytes); assert.equal(fs.lstatSync(snapshotPath).ino, snapshotIdentity.ino);
  for (const source of sources) assert.deepEqual(fs.readFileSync(source.path), source.bytes);
  process.send?.({ ownedSnapshot: snapshotDirectory });

}
const retainedSetupOwners = new Set<object>();
async function runSetupProtectedClose(): Promise<void> {
  const nonce = z.uuid().parse(crashNonce);
  const { RuntimeLifetimeLock, RuntimeAlreadyRunningError } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
  const { AuthoritySourceClosureUnprovedError } = await import("../../../src/backend/storage/source-closure.js");
  const { createBoundProfileFixture } = await import("../helpers/admission-fixture.js");
  const ownedWorkspace = fs.realpathSync(join(workspace, `.setup-protected-close-${nonce}`));
  type RuntimeInstanceType = Awaited<ReturnType<typeof RuntimeLifetimeLock.acquire>>;
  const owner = await RuntimeLifetimeLock.acquire(0), successors: RuntimeInstanceType[] = [];
  const held = { ownedWorkspace, owner, successors }; retainedSetupOwners.add(held);
  const open = fs.openSync, close = fs.closeSync, read = fs.readSync, remove = fs.rmSync;
  const fault = new Error("fixture-setup-protected-native-close-refused");
  let descriptor: number | undefined, source: string | undefined, before: Buffer | undefined;
  let identity: ReturnType<typeof fs.fstatSync> | undefined, closes = 0, removals = 0, removalBaseline: number | undefined;
  fs.openSync = (...args) => {
    const fd = open(...args), flags = args[1], path = args[0];
    const readOnly = flags === "r" || typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0;
    if (descriptor === undefined && readOnly && typeof path === "string" && path.startsWith(ownedWorkspace + sep) && path.endsWith(`${sep}credentials${sep}protected.json`)) {
      const opened = fs.fstatSync(fd);
      assert.equal(opened.isFile(), true); descriptor = fd; source = path; identity = opened;
      before = Buffer.alloc(opened.size); assert.equal(read(fd, before, 0, before.length, 0), before.length);
    }
    return fd;
  };
  fs.closeSync = fd => {
    if (fd === descriptor) { if (removalBaseline === undefined) removalBaseline = removals; closes++; throw fault; }
    close(fd);
  };
  fs.rmSync = (path, options) => {
    if (String(path) === ownedWorkspace || String(path).startsWith(ownedWorkspace + sep)) removals++;
    remove(path, options);
  };
  syncBuiltinESMExports();
  let failure: unknown;
  try { await createBoundProfileFixture({ workspace: ownedWorkspace, lifetime: owner }); }
  catch (error) { failure = error; }
  assert.ok(descriptor !== undefined && source !== undefined && before !== undefined && identity !== undefined && removalBaseline !== undefined);
  const retainedDescriptor = descriptor, retainedSource = source, originalBytes = before, originalIdentity = identity;
  assert.equal(closes, 1); assert.equal(removals, removalBaseline); assert.equal(hasUnprovedSourceClosure(failure), true); assert.equal(contains(failure, fault), true);
  const pending: unknown[] = [failure], seen = new Set<unknown>(); let exactClosure = false;
  while (pending.length) {
    const error = pending.pop(); if (seen.has(error)) continue; seen.add(error);
    if (error instanceof AuthoritySourceClosureUnprovedError && error.errors.length === 1 && error.errors[0] === fault && error.cause === fault) exactClosure = true;
    if (error instanceof AggregateError) { const errors: readonly unknown[] = error.errors; pending.push(...errors); }
    if (error instanceof Error) pending.push(error.cause);
  }
  assert.equal(exactClosure, true);
  const proveSource = () => {
    const fd = fs.fstatSync(retainedDescriptor), file = fs.lstatSync(retainedSource), bytes = Buffer.alloc(originalBytes.length);
    assert.equal(fd.dev, originalIdentity.dev); assert.equal(fd.ino, originalIdentity.ino); assert.equal(file.dev, originalIdentity.dev); assert.equal(file.ino, originalIdentity.ino);
    assert.equal(read(retainedDescriptor, bytes, 0, bytes.length, 0), bytes.length); assert.equal(bytes.equals(originalBytes), true); assert.equal(fs.readFileSync(retainedSource).equals(originalBytes), true);
    assert.equal(fs.existsSync(ownedWorkspace), true); assert.equal(closes, 1); assert.equal(removals, removalBaseline);
  };
  proveSource();
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(owner.close(), error => hasUnprovedSourceClosure(error) && contains(error, fault));
    owner.assertHeld(); assert.throws(() => owner.assertRuntimeAvailable(), error => hasUnprovedSourceClosure(error) && contains(error, fault));
    await assert.rejects(async () => { const successor = await RuntimeLifetimeLock.acquire(owner.port); successors.push(successor); },
      error => error instanceof RuntimeAlreadyRunningError && error.cause instanceof Error && "code" in error.cause && error.cause.code === "EADDRINUSE");
    proveSource();
  }
}

try {
  if (scenario.startsWith("authenticated-upgrade-")) {
    const { runAuthenticatedUpgradeRetentionCase } = await import("./authenticated-upgrade-retention-cases.js");
    await runAuthenticatedUpgradeRetentionCase({ scenario, workspace, nonce: z.uuid().parse(crashNonce) });
  } else if (scenario === "worker-native-open") await runWorkerNativeOpening();
  else if (scenario === "setup-protected-close") await runSetupProtectedClose();
  else if (scenario === "stopped-head-close") await runStoppedHead();
  else if (scenario === "stopped-control-snapshot-disposal") await runStoppedSnapshot();
  else await runCurrent();
  lifetime.assertHeld();
  process.send({ scenario, assertionsComplete: true, ...(scenario === "worker-native-open" || scenario === "setup-protected-close" || scenario.startsWith("authenticated-upgrade-") ? { nonce: z.uuid().parse(crashNonce) } : {}) });
} catch (error) {
  const name = error instanceof Error && ["AssertionError", "TypeError", "RangeError", "SyntaxError"].includes(error.name) ? error.name : "Error";
  const locations = error instanceof Error ? (error.stack ?? "").split("\n").slice(1).flatMap(line => {
    if (!line.trimStart().startsWith("at ")) return [];
    const match = /(?:^|\/)((?:tests|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?):[1-9]\d*:[1-9]\d*)\)?$/u.exec(line.replaceAll("\\", "/").trim());
    return match?.[1] === undefined || match[1].length > 240 ? [] : [match[1]];
  }).slice(0, 8) : [];
  process.send({ scenario, assertionsComplete: false, failure: { name, locations } });
}


async function runLogout(): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const { RuntimeLifetimeLock } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
  const { acquireEntrypointAdmission } = await import("../../../src/backend/storage/admission/bootstrap-admission.js");
  const { OldBuildRuntimeArtifactsError } = await import("../../../src/backend/storage/admission/process-root.js");
  const { composeProfileRuntime, composeSelectedProfileStorage } = await import("../../../src/backend/app/composition/storage-compose.js");
  const { AuthorityDatabase } = await import("../../../src/backend/storage/sqlite/authority-database.js");
  const { LogoutOperationSchema, LogoutSettlementSchema } = await import("../../../src/models/profiles/profile.js");
  const { rebuildRuntimeIsolation } = await import("../../../src/backend/app/config/runtime-isolation.js");
  const nonce = z.uuid().parse(crashNonce), marker = join(workspace, `.logout-publication-${nonce}.json`);
  const root = join(workspace, rebuildRuntimeIsolation.stateRoot), path = join(root, "profiles", profileId, "state.db");
  const operations = join(root, "machine", "operations");
  const retainedRegistry = () => z.object({ profiles: z.array(z.object({ profileId: z.uuid(), lifecycle: z.string() })) })
    .parse(JSON.parse(fs.readFileSync(join(root, "machine", "profiles.json"), "utf8")));
  const operationPath = () => {
    const names = fs.readdirSync(operations).filter(name => name.endsWith(".json"));
    assert.equal(names.length, 1); assert.ok(names[0]); return join(operations, names[0]);
  };
  const readOperation = () => LogoutOperationSchema.parse(JSON.parse(fs.readFileSync(operationPath(), "utf8")));
  if (scenario === "logout-exit-only") {
    process.once("disconnect", () => { process.exit(91); });
    process.send?.({ scenario, assertionsComplete: true });
    await new Promise<never>(() => { setInterval(() => {}, 1000); });
  }
  const controller = await RuntimeLifetimeLock.acquire(port), machine = acquireEntrypointAdmission(workspace, "exclusive", controller);
  const wall = manualClock(new Date("2026-10-21T12:01:00.000Z"));
  const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: wall.now().toISOString() };
  if (scenario === "logout-seed" || scenario === "logout-seed-unknown") {
    const { createProfileSession } = await import("../../../src/backend/profiles/profile-session.js");
    const { registerBoundProfile } = await import("../helpers/admission-fixture.js");
    const { testAdmittedWorker } = await import("../fixtures/run-lifecycle-fixtures.js");
    const { workerPoolMember } = await import("../../../src/models/run/worker-slot.js");
    const { QUEUED_RUN } = await import("../fixtures/phase1f-run-fixtures.js");
    const { RunEnvelopeSchema } = await import("../../../src/models/run/envelope.js");
    const { personLookupDescriptor } = await import("../helpers/registered-workflows.js");
    const { RunRecordService, requireLifecycleApplied } = await import("../../../src/backend/runs/lifecycle/run-record-service.js");
    const { createTimelineEmitter } = await import("../../../src/backend/storage/events/timeline-emitter.js");
    const { runQueuedSpanEvent } = await import("../../../src/backend/runs/commands/run-queued-span.js");
    const { protectedSubjectDisplay } = await import("../../../src/backend/runs/start/protected-input.js");
    const { retainedRunProtectedBindings } = await import("../../../src/models/write-safety/protected-input.js");
    const { LOCAL_OPERATOR_ACTOR_ID } = await import("../../../src/rules/identity/ids.js");
    const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine, clock: wall,
      activity: { hasUnquiescedWork: () => true }, prepareLogout: () => {
        assert.ok(database); return { source: database.capturePendingLogoutSource(), intentFailed(error: unknown): never { throw error; } };
      } });
    const active = session.signIn(fields); assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("source child sign-in refused");
    const admission = machine.admitProfile(profileId); registerBoundProfile(admission, machine);
    const context = composeSelectedProfileStorage({ machineAdmission: machine, admission,
      credentials: createCredentialStore({ admission, stateRoot: admission.stateRoot }), clock: wall, hostFacts: { primaryDisplay: null } });
    const database = context.database;
    const worker = testAdmittedWorker(database, wall, { path, workflow: personLookupDescriptor.id, poolIndex: 1, browserSystems: [] });
    assert.equal(worker.lease.processId, process.pid);
    const activeConfig = database.authority.runtimeConfig.get(); assert.ok(activeConfig);
    const runtimeConfig = { generation: activeConfig.generation, settingsRevision: activeConfig.settingsRevision,
      settingsFingerprint: activeConfig.settingsFingerprint, configFingerprint: activeConfig.configFingerprint };
    const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: wall });
    const lifecycle = new RunRecordService({ database, clock: wall, ids: { uuid: randomUUID }, publishQueued: run => {
      emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID,
        ...protectedSubjectDisplay(retainedRunProtectedBindings(run), () => ({ title: "Synthetic logout run" })) }));
    } });
    const created = requireLifecycleApplied(lifecycle.create({ commandId: randomUUID(), code: "pl", matchKey: "logout-source-child",
      workflow: personLookupDescriptor.id, descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
      configFingerprint: activeConfig.configFingerprint, configSnapshotId: activeConfig.configSnapshotId, resolvedInstance: RunEnvelopeSchema.parse(QUEUED_RUN.envelope).resolvedInstance,
      priority: "bulk", shape: "single", dryRun: true, input: QUEUED_RUN.input, runtimeConfig }));
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: randomUUID(), workflow: personLookupDescriptor.id,
      workerId: worker.workerId, workerLifetime: worker.workerLifetime, runtimeConfig }));
    assert.equal(claimed.envelope.runId, created.envelope.runId);
    const claim = { workerId: worker.workerId, claimGeneration: claimed.claimGeneration };
    requireLifecycleApplied(lifecycle.workerTransition({ commandId: randomUUID(), runId: claimed.envelope.runId, claim,
      lifecycle: { state: "validating", workerId: worker.workerId, claimedAt: fields.at, heartbeatAt: fields.at } }));
    const run = requireLifecycleApplied(lifecycle.workerTransition({ commandId: randomUUID(), runId: claimed.envelope.runId, claim,
      lifecycle: { state: "running", workerId: worker.workerId, claimedAt: fields.at, heartbeatAt: fields.at, currentNodeId: "crm-dates" } }));
    let intent: unknown;
    if (scenario === "logout-seed-unknown") {
      const { fenceWriteFixture } = await import("../helpers/write-fence-fixture.js");
      const { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } = await import("../fixtures/phase1c-contract-fixtures.js");
      const { deriveWriteBindingProofDigest } = await import("../../../src/rules/write-safety/write-safety.js");
      const proof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId, attempt: run.envelope.attempt,
        afterPrepareSpanPath: `${run.envelope.traceId}/crm-dates/prepare` }, bindingProofDigest = deriveWriteBindingProofDigest(proof);
      const input = { ...WRITE_INTENT_ATTEMPTING, writeIntentId: randomUUID(), workflowId: run.envelope.workflow,
        itemId: run.envelope.itemId, runId: run.envelope.runId, runAttempt: run.envelope.attempt, bindingProof: proof, bindingProofDigest,
        fencedAt: fields.at, createdAt: fields.at, updatedAt: fields.at };
      fenceWriteFixture(database, { intent: input, attempt: { ...WRITE_ATTEMPT, writeIntentId: input.writeIntentId, runId: input.runId,
        runAttempt: input.runAttempt, bindingProof: proof, bindingProofDigest, fencedAt: fields.at, recordedAt: fields.at } });
      const attempting = database.authority.writeIntents.get(input.writeIntentId); assert.ok(attempting);
      const { deriveWriteAuthorityReason } = await import("../../../src/rules/write-safety/write-authority-reason.js");
      intent = database.authority.writeIntents.parkAttempt({ writeIntentId: attempting.writeIntentId, generation: attempting.generation,
        expectedVersion: attempting.version, code: "unknown", message: "Synthetic unresolved logout write", now: fields.at,
        authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "Synthetic unresolved logout write") });
    }
    const pending = session.logOut(active.token, { at: fields.at }); assert.equal(pending.state, "cancelling");
    const operation = readOperation(); assert.equal(operation.sessionGeneration, active.epoch);
    fs.writeFileSync(join(workspace, `.logout-source-${nonce}.json`), JSON.stringify({ nonce, operationId: operation.operationId,
      runId: run.envelope.runId, workerId: worker.workerId, processId: process.pid, intent, epoch: active.epoch,
      version: run.version, claimGeneration: run.claimGeneration, workerLifetime: worker.workerLifetime, member: workerPoolMember(worker.member) }), { mode: 0o600, flag: "wx", flush: true });
    process.kill(process.pid, "SIGKILL"); throw new Error("source crash did not terminate child");
  }
  const runtime = composeProfileRuntime({ admission: machine, clock: wall, hostFacts: { primaryDisplay: null } });
  if (scenario === "logout-resume") {
    const receipt = z.strictObject({ nonce: z.uuid(), scenario: z.string(), operationId: z.uuid(), profileId: z.uuid(), phase: z.string(), settlement: LogoutSettlementSchema })
      .parse(JSON.parse(fs.readFileSync(marker, "utf8")));
    assert.equal(receipt.nonce, nonce); assert.equal(receipt.profileId, profileId);
    let settled = receipt.settlement;
    if (fs.readdirSync(operations).some(name => name.endsWith(".json"))) {
      const operation = readOperation(); assert.equal(operation.operationId, receipt.operationId);
      assert.deepEqual(operation.settlement, receipt.settlement);
      const captured = receipt.settlement;
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        rename(from, to);
        if (String(to) !== join(operations, `${operation.operationId}.json`)) return;
        const next = readOperation();
        assert.equal(next.operationId, operation.operationId); assert.equal(next.profileId, operation.profileId);
        assert.equal(next.sessionGeneration, operation.sessionGeneration); assert.deepEqual(next.source, operation.source); assert.equal(next.at, operation.at);
        assert.equal(next.phase, operation.phase);
        if (next.settlement === undefined) return;
        assert.deepEqual(next.settlement.requests, captured.requests); assert.deepEqual(next.settlement.workers, captured.workers);
        assert.equal(next.settlement.stoppedAt, captured.stoppedAt); assert.equal(next.settlement.processId, captured.processId);
        assert.equal(next.settlement.before, captured.before);
        if (captured.after !== undefined) assert.equal(next.settlement.after, captured.after);
        assert.ok(next.settlement.phase === "commit-intent" || next.settlement.phase === "done");
        settled = next.settlement;
      };
      syncBuiltinESMExports();
      const authorized = runtime.session.authorizeLogoutContinuation(fields);
      assert.equal(authorized.state, "authorized"); if (authorized.state !== "authorized") throw new Error("logout replay verifier refused");
      assert.equal(authorized.resume().state, "cancelling");
      assert.equal(authorized.resume().state, "refused");
      if (receipt.scenario === "logout-third-image") {
        const before = fs.readFileSync(path), operationBytes = fs.readFileSync(operationPath());
        await assert.rejects(runtime.awaitClosurePreparation(profileId), error => hasUnprovedSourceClosure(error));
        assert.deepEqual(fs.readFileSync(path), before); assert.deepEqual(fs.readFileSync(operationPath()), operationBytes);
        assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
        controller.assertHeld(); assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error));
        process.send?.({ scenario, assertionsComplete: true }); return;
      }
      await runtime.awaitClosurePreparation(profileId);
      assert.equal(runtime.session.resumeLogout(operation.operationId).state, "signed-out");
    }
    const registry = machine.readProfileRegistry();
    assert.equal(registry.activeProfileId, null); assert.equal(registry.profiles.find(row => row.profileId === profileId)?.lifecycle, "ready");
    assert.equal(registry.profiles.find(row => row.profileId === profileId)?.credentialState, "saved");
    assert.equal(fs.readdirSync(operations).some(name => name.endsWith(".json")), false);
    const { CanonicalCrashRecoveryRequestSchema } = await import("../../../src/models/run/worker.js");
    const { WorkerPoolMemberSchema, workerPoolMember } = await import("../../../src/models/run/worker-slot.js");
    const { lifecycleCommandId } = await import("../../../src/rules/identity/identifiers.js");
    const { canonicalJsonStringify } = await import("../../../src/rules/validation/canonical-json.js");
    const { sha256Hex } = await import("../../../src/rules/validation/sha256.js");
    const { RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } = await import("../../../src/rules/commands/commands.js");
    const { withAuthorityDatabaseReadOnly } = await import("../../../src/backend/storage/sqlite/readonly-authority-snapshot.js");
    const { inspectNativeAuthority } = await import("../../../src/backend/storage/sqlite/authority-database.js");
    const source = z.object({ nonce: z.uuid(), operationId: z.uuid(), runId: z.uuid(), workerId: z.string(), processId: z.number().int().positive(),
      epoch: z.number().int().nonnegative(), version: z.number().int().positive(), claimGeneration: z.number().int().positive(),
      workerLifetime: CanonicalCrashRecoveryRequestSchema.shape.workerLifetime, member: WorkerPoolMemberSchema })
      .parse(JSON.parse(fs.readFileSync(join(workspace, `.logout-source-${nonce}.json`), "utf8")));
    assert.equal(source.nonce, nonce); assert.equal(source.operationId, receipt.operationId);
    assert.equal(registry.sessionGeneration, source.epoch + 1);
    assert.equal(settled.phase, "done"); assert.ok(settled.after);
    const request = CanonicalCrashRecoveryRequestSchema.parse({
      commandId: lifecycleCommandId("logout-crash", { operationId: source.operationId, runId: source.runId, version: source.version, workerLifetime: source.workerLifetime }),
      runId: source.runId, expectedVersion: source.version, claim: { workerId: source.workerId, claimGeneration: source.claimGeneration },
      workerLifetime: source.workerLifetime, now: settled.stoppedAt });
    assert.deepEqual(settled.requests, [request]);
    assert.deepEqual(settled.workers, [{ member: source.member, processId: source.processId, leaseGeneration: source.workerLifetime.leaseGeneration }]);
    const fresh = runtime.session.signIn(fields);
    assert.equal(fresh.state, "active"); if (fresh.state !== "active") throw new Error("completed logout readback sign-in refused");
    assert.equal(fresh.profileId, profileId); assert.equal(fresh.epoch, source.epoch + 2);
    const admission = machine.admitProfile(fresh.profileId);
    const database = AuthorityDatabase.open(admission, { path, openMode: "storage-doctor-read-only-no-migrate", busyTimeoutMs: 250, migrationOwner: "logout-readback" }, wall,
      undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
    try {
      const command = RunLifecycleCommandRecordSchema.parse(database.authority.lifecycleJournal.getCommand(request.commandId));
      const expectedCommand = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId, operation: "recover-crash",
        requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0recover-crash\0${canonicalJsonStringify(request)}`), request,
        fence: { kind: "terminal", expectedVersion: source.version, workerId: source.workerId, claimGeneration: source.claimGeneration }, recordedAt: settled.stoppedAt });
      assert.deepEqual(command, expectedCommand);
      const audit = RunLifecycleCommandAuditRecordSchema.parse(database.authority.lifecycleJournal.findAuditByCommand(request.commandId));
      assert.deepEqual(audit, { kind: "run-lifecycle", auditId: request.commandId, request: expectedCommand,
        result: { kind: "run", runId: source.runId, appliedVersion: source.version + 1 }, completedAt: settled.stoppedAt });
      const run = database.authority.runs.get(source.runId); assert.ok(run);
      assert.equal(run.version, source.version + 1); assert.equal(run.claimGeneration, source.claimGeneration); assert.equal(run.updatedAt, settled.stoppedAt);
      assert.equal(run.lifecycle.state, "terminal"); if (run.lifecycle.state !== "terminal") throw new Error("logout recovery did not terminate source run");
      assert.equal(run.lifecycle.outcome, "failed"); assert.equal(run.lifecycle.endedAt, settled.stoppedAt);
      const failureId = lifecycleCommandId("crash-failure", request.commandId);
      assert.equal(run.lifecycle.failureId, failureId);
      assert.equal(database.authority.failures.get(failureId)?.code, "RUN_INTERRUPTED_BY_CRASH");
      assert.ok(database.authority.runResults.get(source.runId));
      const slot = database.authority.workerSlots.get(source.workerId), lease = database.authority.workerLeases.get(source.workerId); assert.ok(slot && lease);
      assert.deepEqual(workerPoolMember(slot), source.member); assert.equal(lease.processId, source.processId);
      assert.equal(lease.leaseGeneration, source.workerLifetime.leaseGeneration);
      assert.equal(lease.lifecycle.state, "stopped"); if (lease.lifecycle.state !== "stopped") throw new Error("logout recovery did not stop source worker");
      assert.equal(lease.lifecycle.reason, "crashed"); assert.equal(lease.lifecycle.stoppedAt, settled.stoppedAt);
      const eventId = lifecycleCommandId("timeline-lifecycle", request.commandId), event = database.authority.timelineEvents.get(eventId); assert.ok(event);
      assert.equal(event.occurredAt, settled.stoppedAt); assert.equal(event.recordedAt, settled.stoppedAt);
      assert.equal(event.payload.kind, "span"); if (event.payload.kind !== "span") throw new Error("logout recovery event is not a run span");
      assert.equal(event.payload.event.t, "span.ended"); assert.equal(event.payload.event.pid, settled.processId);
      assert.equal(event.payload.event.ts, settled.stoppedAt); assert.equal(event.payload.event.kind, "run");
      if (event.payload.event.kind !== "run") throw new Error("logout recovery event is not a run terminal span");
      assert.equal(event.payload.event.runId, source.runId);
      withAuthorityDatabaseReadOnly(admission, path, native => {
        assert.equal(inspectNativeAuthority(native).authorityContentFingerprint, settled.after);
        assert.deepEqual(native.prepare("SELECT id FROM runs ORDER BY id").all().map(row => row.id), [source.runId]);
        assert.deepEqual(native.prepare("SELECT id FROM worker_slots ORDER BY id").all().map(row => row.id), [source.workerId]);
        assert.deepEqual(native.prepare("SELECT id FROM worker_leases ORDER BY id").all().map(row => row.id), [source.workerId]);
        assert.deepEqual(native.prepare("SELECT id FROM commands WHERE family='run-lifecycle' AND json_extract(request_json,'$.operation')='recover-crash' AND json_extract(request_json,'$.request.runId')=? ORDER BY id").all(source.runId).map(row => row.id), [request.commandId]);
        assert.deepEqual(native.prepare("SELECT id FROM command_audits WHERE command_id=? ORDER BY id").all(request.commandId).map(row => row.id), [request.commandId]);
        assert.deepEqual(native.prepare("SELECT id FROM run_failures WHERE run_id=? ORDER BY id").all(source.runId).map(row => row.id), [failureId]);
        assert.deepEqual(native.prepare("SELECT run_id FROM run_results WHERE run_id=?").all(source.runId).map(row => row.run_id), [source.runId]);
        assert.deepEqual(native.prepare("SELECT id FROM timeline_events WHERE run_id=? AND json_extract(payload_json,'$.payload.kind')='span' AND json_extract(payload_json,'$.payload.event.t')='span.ended' ORDER BY id").all(source.runId).map(row => row.id), [eventId]);
      });
    } finally { database.close(); admission.release(); }
    process.send?.({ scenario, assertionsComplete: true }); return;
  }
  const cold = fs.readdirSync(operations).some(name => name.endsWith(".json"));
  const active = cold ? undefined : runtime.session.signIn(fields);
  if (active !== undefined && active.state !== "active") throw new Error("logout fixture sign-in refused");
  const context = active?.state === "active" ? runtime.selectedContext(active.token) : undefined;
  const settings = context?.settings.read().record;
  const browserRoot = context !== undefined && settings !== undefined
    ? context.resolveSettings(settings.settings).config.paths.browserProfileRoot : undefined;
  let currentPhase: string | undefined, writerCommitted = false, closeInjected = false;
  const checkpoint = (phase: string): never => {
    const operation = readOperation(); assert.ok(operation.settlement);
    fs.writeFileSync(marker, JSON.stringify({ nonce, scenario, operationId: operation.operationId, profileId, phase, settlement: operation.settlement }), { mode: 0o600, flag: "wx", flush: true });
    process.kill(process.pid, "SIGKILL"); throw new Error("logout crash boundary did not terminate child");
  };
  let originalOperation: ReturnType<typeof readOperation> | undefined = cold ? readOperation() : undefined;
  const observePublication = () => {
    const operation = readOperation(); originalOperation ??= operation;
    assert.equal(operation.operationId, originalOperation.operationId); assert.equal(operation.profileId, profileId);
    assert.equal(operation.sessionGeneration, originalOperation.sessionGeneration); assert.deepEqual(operation.source, originalOperation.source);
    assert.equal(operation.at, originalOperation.at);
    if (operation.settlement === undefined) return;
    assert.equal(operation.phase, "cancelling"); currentPhase = operation.settlement.phase;
    if (cold) {
      assert.equal(operation.settlement.requests.length, 1); assert.equal(operation.settlement.workers.length, 1);
      if (currentPhase === "commit-intent") assert.notEqual(operation.settlement.before, operation.settlement.after);
    }
  };
  const exec = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).exec.value;
  assert.ok(exec);
  DatabaseSync.prototype.exec = function (this: InstanceType<typeof DatabaseSync>, sql) {
    const result = exec.call(this, sql);
    if (currentPhase === "commit-intent" && sql === "COMMIT") {
      writerCommitted = true;
      if (scenario === "logout-after-commit") checkpoint("after-commit");
    }
    return result;
  };
  const close = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close.value;
  assert.ok(close);
  DatabaseSync.prototype.close = function (this: InstanceType<typeof DatabaseSync>) {
    if (scenario === "logout-writer-close" && currentPhase === "commit-intent" && writerCommitted && !closeInjected
      && this.prepare("PRAGMA database_list").all().some(row => row.file === path)) {
      closeInjected = true; throw new Error("synthetic actual logout writer close refusal");
    }
    return close.call(this);
  };
  const rename = fs.renameSync, unlink = fs.unlinkSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (dirname(String(to)) === operations && String(to).endsWith(".json")) observePublication();
    if (scenario === "logout-ready" && String(to) === join(root, "machine", "profiles.json")) {
      const document = z.object({ profiles: z.array(z.object({ profileId: z.uuid(), lifecycle: z.string() })) }).parse(JSON.parse(fs.readFileSync(String(to), "utf8")));
      if (currentPhase === "done" && document.profiles.find(row => row.profileId === profileId)?.lifecycle === "ready") checkpoint("ready");
    }
  };
  fs.unlinkSync = target => {
    const isOperation = dirname(String(target)) === operations && String(target).endsWith(".json");
    const operation = isOperation ? readOperation() : undefined;
    unlink(target);
    if (String(target) === join(workspace, ".tracker", "control", "profile-publication.json") && currentPhase !== undefined
      && (scenario === `logout-${currentPhase}` || scenario === "logout-third-image" && currentPhase === "commit-intent")) checkpoint(currentPhase);
    if (scenario === "logout-unlink" && operation !== undefined && currentPhase === "done") {
      fs.writeFileSync(marker, JSON.stringify({ nonce, scenario, operationId: operation.operationId, profileId, phase: "unlink", settlement: operation.settlement }), { mode: 0o600, flag: "wx", flush: true });
      process.kill(process.pid, "SIGKILL");
    }
  };
  syncBuiltinESMExports();
  const startLogout = () => {
    if (cold) {
      const authorized = runtime.session.authorizeLogoutContinuation(fields);
      assert.equal(authorized.state, "authorized"); if (authorized.state !== "authorized") throw new Error("cold fault verifier refused");
      assert.equal(authorized.resume().state, "cancelling");
    } else {
      assert.ok(active?.state === "active" && context !== undefined);
      assert.equal(runtime.session.logOut(active.token, { at: fields.at }).state, "cancelling");
      assert.throws(() => context.protectedSecrets.read()); assert.throws(() => runtime.selectedContext(active.token));
    }
  };
  if (scenario === "logout-browser-busy" || scenario === "logout-browser-unproved") {
    const { profileBrowserClosure, BrowserProfileStillClosingError, NativeBrowserClosureUnprovedError } = await import("../../../src/backend/runtime/browser/native-profile-probe.js");
    const refusal = scenario === "logout-browser-busy" ? new BrowserProfileStillClosingError(new Error("synthetic native busy"))
      : new NativeBrowserClosureUnprovedError([new Error("synthetic native close unproved")]);
    let probes = 0;
    profileBrowserClosure.probeClosed = async profiles => {
      probes++; assert.deepEqual(profiles, []);
      throw refusal;
    };
    startLogout();
    await assert.rejects(runtime.awaitClosurePreparation(profileId), error => hasUnprovedSourceClosure(error) && contains(error, refusal));
    assert.equal(probes, 1);
    const operation = readOperation(); assert.equal(operation.settlement, undefined);
    assert.equal("commandId" in operation, false); assert.equal("writeId" in operation, false); assert.equal("expectedRevision" in operation, false);
    assert.throws(() => runtime.session.resumeLogout(operation.operationId), error => hasUnprovedSourceClosure(error) && contains(error, refusal));
    assert.equal(fs.existsSync(join(root, "machine", "erasures", `${profileId}.json`)), false);
    assert.throws(() => runtime.session.close(), error => hasUnprovedSourceClosure(error) && contains(error, refusal));
    assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
    await assert.rejects(runtime.close()); await assert.rejects(controller.close()); controller.assertHeld();
    assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error));
    process.send?.({ scenario, assertionsComplete: true }); return;
  }
  let liveProcess: { child: ChildProcess; closed: Promise<unknown>; diagnostics: { stderrBytes: number } } | undefined;
  if (scenario === "logout-exited-process" || scenario === "logout-live-process" || scenario === "logout-process-observation") {
    const { fork } = await import("node:child_process");
    const { once } = await import("node:events");
    const { testProcessImport } = await import("../compiled-process.js");
    const { scaledMs } = await import("../time-scale.js");
    const { credentialKeychainTestEnvironment } = await import("../helpers/credential-keychain-fake.js");
    const { acquireRuntimeProcessLock } = await import("../../../src/backend/storage/sqlite/runtime-process-locks.js");
    const child = fork(import.meta.filename, [String(port), workspace, profileId, "logout-exit-only", nonce], {
      execArgv: ["--import", testProcessImport()], env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const closed = once(child, "close");
    const diagnostics = { stderrBytes: 0 };
    child.stderr?.on("data", (bytes: Buffer) => { diagnostics.stderrBytes += bytes.length; if (diagnostics.stderrBytes > 65_536) child.kill("SIGKILL"); });
    try {
      const ready = await Promise.race([once(child, "message", { signal: AbortSignal.timeout(scaledMs(15_000)) }), closed.then(() => { throw new Error("logout nested child closed before birth proof"); })]);
      assert.deepEqual(ready[0], { scenario: "logout-exit-only", assertionsComplete: true }); assert.ok(child.pid);
      acquireRuntimeProcessLock({ processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot), name: "workers", pid: child.pid,
        admission: { kind: "unbound-worker", authorityPath: path } }, wall);
      if (scenario === "logout-exited-process") { assert.equal(child.kill("SIGTERM"), true); assert.deepEqual(await closed, [null, "SIGTERM"]); }
      else liveProcess = { child, closed, diagnostics };
    } finally {
      if (liveProcess === undefined) {
        if (child.exitCode === null && child.signalCode === null) assert.equal(child.kill("SIGKILL"), true);
        await closed; assert.equal(child.connected, false); assert.equal(diagnostics.stderrBytes, 0);
      }
    }
  }
  await using _nestedProcessClosure = { async [Symbol.asyncDispose]() {
    if (liveProcess === undefined) return;
    if (liveProcess.child.exitCode === null && liveProcess.child.signalCode === null) assert.equal(liveProcess.child.kill("SIGTERM"), true);
    await liveProcess.closed; assert.equal(liveProcess.child.connected, false); assert.equal(liveProcess.diagnostics.stderrBytes, 0);
  } };
  let observationRefused = false;
  if (scenario !== "logout-snapshot-disposal") startLogout();
  if (scenario === "logout-process-root-copy") fs.writeFileSync(join(workspace, rebuildRuntimeIsolation.processLockRoot, "unexpected-copy"), "synthetic", { mode: 0o600 });
  if (scenario === "logout-unknown-copy") fs.writeFileSync(join(root, "profiles", profileId, "unexpected-copy"), "synthetic", { mode: 0o600 });
  if (scenario === "logout-process-observation") {
    const kill = process.kill.bind(process);
    const observed = liveProcess?.child.pid; assert.ok(observed);
    process.kill = (pid, signal) => { if (pid === observed && signal === 0) { observationRefused = true; throw new Error("synthetic OS process observation unavailable"); } return kill(pid, signal); };
  }
  if (scenario === "logout-snapshot-disposal") {
    const open = fs.openSync, remove = fs.rmSync;
    const injected = new Error("synthetic logout snapshot disposal refusal");
    let snapshot: string | undefined, source: string | undefined, identity: ReturnType<typeof fs.lstatSync> | undefined, bytes: Buffer | undefined;
    let nativeInspection = false, nativeClosed = false, disposals = 0;
    fs.openSync = (...args) => {
      const descriptor = open(...args);
      if (source === undefined && typeof args[0] === "string" && args[0].includes(`${sep}relay-readonly-authority-`)
        && args[0].endsWith(`${sep}authority.sqlite`) && new Error().stack?.includes("capturePendingLogoutSnapshot")) {
        source = args[0]; snapshot = dirname(source); identity = fs.fstatSync(descriptor); bytes = fs.readFileSync(source);
      }
      return descriptor;
    };
    const prepare = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).prepare.value; assert.ok(prepare);
    DatabaseSync.prototype.prepare = function (this: InstanceType<typeof DatabaseSync>, ...args) {
      if (source !== undefined && args[0] === "PRAGMA quick_check(1)"
        && prepare.call(this, "PRAGMA database_list").all().some(row => row.file === source)) {
        assert.equal(prepare.call(this, "PRAGMA quick_check(1)").get()?.quick_check, "ok"); nativeInspection = true;
      }
      return prepare.apply(this, args);
    };
    const nativeClose = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close.value; assert.ok(nativeClose);
    DatabaseSync.prototype.close = function (this: InstanceType<typeof DatabaseSync>) {
      const owned = source !== undefined && prepare.call(this, "PRAGMA database_list").all().some(row => row.file === source);
      nativeClose.call(this); if (owned) { assert.equal(nativeInspection, true); nativeClosed = true; }
    };
    fs.rmSync = (target, options) => {
      if (snapshot !== undefined && String(target) === snapshot) {
        assert.equal(nativeInspection, true); assert.equal(nativeClosed, true); disposals++; throw injected;
      }
      remove(target, options);
    };
    syncBuiltinESMExports();
    startLogout();
    await assert.rejects(runtime.awaitClosurePreparation(profileId), error => hasUnprovedSourceClosure(error) && contains(error, injected));
    assert.ok(snapshot && source && identity && bytes); assert.equal(source, join(snapshot, "authority.sqlite"));
    assert.equal(nativeInspection, true); assert.equal(nativeClosed, true); assert.equal(disposals, 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(runtime.close(), error => hasUnprovedSourceClosure(error) && contains(error, injected));
      assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error) && contains(error, injected));
      assert.throws(() => machine.beginOfflineMaintenance(), error => hasUnprovedSourceClosure(error) && contains(error, injected));
        assert.throws(() => RuntimeAdmission.acquireMachine(workspace, "shared", controller), error => hasUnprovedSourceClosure(error) && contains(error, injected));
      await assert.rejects(controller.close(), error => hasUnprovedSourceClosure(error) && contains(error, injected)); controller.assertHeld();
      const { RuntimeAlreadyRunningError } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
      await assert.rejects(async () => { const successor = await RuntimeLifetimeLock.acquire(controller.port); retainedSetupOwners.add(successor); }, RuntimeAlreadyRunningError);
      assert.deepEqual(fs.readFileSync(source), bytes);
      const observed: fs.Stats = fs.lstatSync(source); assert.deepEqual([observed.dev, observed.ino], [identity.dev, identity.ino]); assert.equal(disposals, 1);
      assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
      assert.equal(fs.existsSync(operationPath()), true); controller.assertHeld();
    }
    process.send?.({ ownedSnapshot: snapshot }); process.send?.({ scenario, assertionsComplete: true }); return;
  }
  if (scenario === "logout-browser-root") { assert.ok(browserRoot); fs.symlinkSync(join(root, "profiles", profileId, "credentials"), browserRoot, "dir"); }
  if (scenario === "logout-key-replacement") {
    const key = join(root, "machine", "credential-keys", `${profileId}.json`);
    fs.renameSync(key, `${key}.retained`); fs.copyFileSync(`${key}.retained`, key);
    const head = z.looseObject({ generation: z.number().int().positive() }).parse(JSON.parse(fs.readFileSync(key, "utf8")));
    fs.writeFileSync(key, JSON.stringify({ ...head, generation: head.generation + 1 }), { mode: 0o600 });
  }
  if (["logout-unknown-copy", "logout-live-process", "logout-browser-root", "logout-key-replacement", "logout-process-observation", "logout-process-root-copy", "logout-exited-process"].includes(scenario)) {
    const oldBuild = ["logout-live-process", "logout-process-observation", "logout-process-root-copy", "logout-exited-process"].includes(scenario);
    await assert.rejects(runtime.awaitClosurePreparation(profileId), error => hasUnprovedSourceClosure(error)
      && (!oldBuild || error instanceof AuthoritySourceClosureUnprovedError && error.cause instanceof OldBuildRuntimeArtifactsError));
    assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
    assert.equal(fs.existsSync(operationPath()), true); controller.assertHeld();
    assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error));
    await assert.rejects(runtime.close(), error => hasUnprovedSourceClosure(error));
    await assert.rejects(controller.close(), error => hasUnprovedSourceClosure(error)); controller.assertHeld();
    if (scenario === "logout-process-observation") assert.equal(observationRefused, false);
    if (scenario === "logout-key-replacement") {
      const key = join(root, "machine", "credential-keys", `${profileId}.json`);
      fs.renameSync(`${key}.retained`, key);
      assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error));
    }
    if (liveProcess !== undefined) {
      assert.equal(liveProcess.child.kill("SIGTERM"), true); assert.deepEqual(await liveProcess.closed, [null, "SIGTERM"]);
      assert.equal(liveProcess.child.connected, false); assert.equal(liveProcess.diagnostics.stderrBytes, 0);
    }
    process.send?.({ scenario, assertionsComplete: true }); return;
  }
  if (scenario === "logout-writer-close") {
    await assert.rejects(runtime.awaitClosurePreparation(profileId), error => hasUnprovedSourceClosure(error));
    assert.equal(closeInjected, true); assert.equal(readOperation().settlement?.phase, "commit-intent");
    assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
    assert.throws(() => machine.release(), error => hasUnprovedSourceClosure(error));
    await assert.rejects(runtime.close(), error => hasUnprovedSourceClosure(error));
    await assert.rejects(controller.close(), error => hasUnprovedSourceClosure(error)); controller.assertHeld();
    assert.equal(fs.existsSync(operationPath()), true); process.send?.({ scenario, assertionsComplete: true }); return;
  }
  await runtime.awaitClosurePreparation(profileId);
  if (scenario === "logout-unknown") {
    const operation = readOperation(); assert.equal(operation.settlement?.phase, "done");
    const source = z.object({ nonce: z.uuid(), runId: z.uuid(), workerId: z.string(), processId: z.number().int(), intent: z.unknown() })
      .parse(JSON.parse(fs.readFileSync(join(workspace, `.logout-source-${nonce}.json`), "utf8")));
    assert.equal(source.nonce, nonce); assert.ok(source.intent);
    const owner = machine.admitProfileSettlement(operation.operationId);
    const facts = AuthorityDatabase.readProfileMaintenanceInventory(owner);
    assert.deepEqual(facts.writeIntents.find(intent => "runId" in intent && intent.runId === source.runId), source.intent);
    assert.equal(facts.runs.find(run => run.envelope.runId === source.runId)?.lifecycle.state, "parked-write");
    assert.equal(facts.leases.find(lease => lease.workerId === source.workerId)?.lifecycle.state, "stopped");
    const operationBytes = fs.readFileSync(operationPath());
    assert.equal(runtime.session.resumeLogout(operation.operationId).state, "cancelling");
    assert.deepEqual(AuthorityDatabase.readProfileMaintenanceInventory(owner), facts);
    assert.deepEqual(fs.readFileSync(operationPath()), operationBytes);
    assert.equal(retainedRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
    owner.release(); process.send?.({ scenario, assertionsComplete: true }); return;
  }
  assert.fail("logout fault boundary was not reached");
}
