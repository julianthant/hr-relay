import { fsyncPath } from "../../../../src/backend/storage/private-path.js";
import { createHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withOperationProof, readPrivateFile } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { retainAuthoritySourceClosure, AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createReadonlyAuthoritySnapshot, withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { countUcsdLoginRows, readProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";

const digest = (path: string) => createHash("sha256").update(fs.readFileSync(path)).digest("hex");

it("uses a physical owned snapshot under an aliased temp root without admitting source aliases", async () => {
  const f = await createBoundProfileFixture();
  await using _profile = { async [Symbol.asyncDispose]() { await f.close(); } };
  const workspace = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "readonly-temp-alias-"));
  using _workspace = { [Symbol.dispose]() { fs.rmSync(workspace, { recursive: true }); } };
  const priorTemp = process.env.TMPDIR;
  using _environment = { [Symbol.dispose]() {
    if (priorTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTemp;
  } };
  const physical = join(workspace, "physical"), alias = join(workspace, "alias");
  fs.mkdirSync(physical, { mode: 0o700 });
  fs.symlinkSync(physical, alias, "dir");
  process.env.TMPDIR = alias;
  const snapshot = createReadonlyAuthoritySnapshot(f.path);
  using _snapshot = { [Symbol.dispose]() { snapshot.dispose(); } };
  assert.equal(dirname(dirname(snapshot.path)), physical);
  assert.equal(fs.realpathSync(snapshot.path), snapshot.path);
  assert.deepEqual(readProfileDatabaseBinding(snapshot.path), readProfileDatabaseBinding(f.path));
  const sourceAlias = join(workspace, "source-alias.db");
  fs.symlinkSync(f.path, sourceAlias);
  assert.throws(() => readProfileDatabaseBinding(sourceAlias), /source-integrity/u);
});

it("snapshot disposal keeps the same uncertainty and never retries physical removal", async () => {
  const f = await createBoundProfileFixture(), before = digest(f.path);
  const snapshot = createReadonlyAuthoritySnapshot(f.path), directory = dirname(snapshot.path);
  const actualRemove = fs.rmSync, injected = new Error("snapshot-removal-refused");
  let attempts = 0, proved = false;
  const remove = vi.spyOn(fs, "rmSync").mockImplementation(path => {
    assert.equal(path, directory); attempts++; throw injected;
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { snapshot.dispose(); } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(failure.errors, [injected]); assert.equal(failure.cause, injected);
    for (let index = 0; index < 2; index++) {
      assert.throws(() => snapshot.dispose(), error => error === failure);
      assert.throws(() => snapshot.assertUnchanged(), error => error === failure);
      assert.equal(fs.existsSync(snapshot.path), true);
    }
    assert.equal(attempts, 1); assert.equal(digest(f.path), before);
    const retained = fs.lstatSync(directory), members = fs.readdirSync(directory).sort();
    const hashes = members.map(name => [name, digest(join(directory, name))]);
    remove.mockRestore(); syncBuiltinESMExports();
    const current = fs.lstatSync(directory);
    assert.equal(current.dev, retained.dev); assert.equal(current.ino, retained.ino); assert.equal(current.mode, retained.mode);
    assert.deepEqual(fs.readdirSync(directory).sort(), members);
    assert.deepEqual(members.map(name => [name, digest(join(directory, name))]), hashes);
    actualRemove(directory, { recursive: true }); assert.equal(fs.existsSync(directory), false);
    assert.throws(() => snapshot.dispose(), error => error === failure);
    assert.throws(() => snapshot.assertUnchanged(), error => error === failure);
    assert.equal(attempts, 1); assert.equal(digest(f.path), before);
    proved = true;
  } finally { remove.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});

it("snapshot creation preserves the source failure and failed cleanup with its exact directory", async () => {
  const f = await createBoundProfileFixture(), before = digest(f.path);
  const actualCreate = fs.mkdtempSync, actualRemove = fs.rmSync;
  const injected = new Error("snapshot-creation-cleanup-refused");
  let directory: string | undefined, proved = false;
  const create = vi.spyOn(fs, "mkdtempSync").mockImplementation((prefix, options) => {
    assert.equal(options, undefined);
    const created = actualCreate(prefix); assert.ok(typeof created === "string"); directory = created; return created;
  });
  syncBuiltinESMExports();
  const remove = vi.spyOn(fs, "rmSync").mockImplementation(path => { assert.equal(path, directory); throw injected; });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { createReadonlyAuthoritySnapshot(join(f.stateRoot, "missing.db")); } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError); assert.equal(failure.errors.length, 2);
    assert.ok(failure.errors[0] instanceof Error); assert.equal(failure.cause, failure.errors[0]);
    const cleanup: unknown = failure.errors[1]; assert.ok(cleanup instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(cleanup.errors, [injected]); assert.equal(cleanup.cause, injected);
    assert.ok(directory); assert.equal(fs.existsSync(directory), true); assert.deepEqual(fs.readdirSync(directory), []);
    const retained = fs.lstatSync(directory);
    remove.mockRestore(); syncBuiltinESMExports(); create.mockRestore(); syncBuiltinESMExports();
    const current = fs.lstatSync(directory);
    assert.equal(current.dev, retained.dev); assert.equal(current.ino, retained.ino); assert.equal(current.mode, retained.mode);
    actualRemove(directory, { recursive: true });
    assert.equal(fs.existsSync(directory), false); assert.equal(digest(f.path), before);
    proved = true;
  } finally { create.mockRestore(); syncBuiltinESMExports(); remove.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});

for (const reader of ["read-only", "binding", "login-copy"] as const) it(`retains the actual ${reader} database on failed close without removing its snapshot`, async () => {
  const f = await createBoundProfileFixture(), before = digest(f.path);
  const actualCreate = fs.mkdtempSync;
  const primary = new Error("read-callback-refused"), cleanup = new Error("native-copy-close-refused");
  const retainedOwner: { database?: DatabaseSync } = {};
  let directory: string | undefined, closes = 0, proved = false;
  const create = vi.spyOn(fs, "mkdtempSync").mockImplementation((prefix, options) => {
    assert.equal(options, undefined);
    const created = actualCreate(prefix); assert.ok(typeof created === "string"); directory = created; return created;
  });
  syncBuiltinESMExports();
  const close = vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (this: DatabaseSync) {
    retainedOwner.database = this; closes++; throw cleanup;
  });
  try {
    let failure: unknown;
    try {
      if (reader === "read-only") withAuthorityDatabaseReadOnly(f.admission, f.path, () => { throw primary; });
      else if (reader === "binding") readProfileDatabaseBinding(f.path);
      else countUcsdLoginRows(f.path);
    } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    const inner = reader === "binding" ? failure.cause : failure;
    assert.ok(inner instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(inner.errors.at(-1), cleanup); assert.equal(inner.cause, inner.errors[0]);
    if (reader === "read-only") { assert.equal(inner.errors.length, 2); assert.equal(inner.errors[0], primary); }
    else if (reader === "binding") assert.deepEqual(inner.errors, [cleanup]);
    else { assert.equal(inner.errors.length, 2); assert.ok(inner.errors[0] instanceof Error); }
    const retained = retainedOwner.database;
    assert.equal(closes, 1); assert.ok(retained);
    assert.equal(retained.prepare("SELECT 1 AS live").get()?.live, 1);
    if (reader !== "login-copy") { assert.ok(directory); assert.equal(fs.existsSync(directory), true); }
    else assert.equal(directory, undefined);
    assert.equal(digest(f.path), before);
    close.mockRestore(); create.mockRestore(); syncBuiltinESMExports();
    retained.close();
    if (directory !== undefined) {
      const identity = fs.lstatSync(directory); assert.equal(identity.isDirectory(), true);
      fs.rmSync(directory, { recursive: true }); assert.equal(fs.existsSync(directory), false);
    }
    assert.equal(digest(f.path), before); proved = true;
  } finally { close.mockRestore(); create.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});

it("ordinary read refusal and unreadable login copy stay ordinary after proved cleanup", async () => {
  const f = await createBoundProfileFixture(), before = digest(f.path), primary = new Error("ordinary-read-refused");
  try {
    assert.throws(() => withAuthorityDatabaseReadOnly(f.admission, f.path, () => { throw primary; }), error => error === primary);
    assert.equal(countUcsdLoginRows(f.path), "unreadable");
    assert.equal(digest(f.path), before);
    assert.equal(readProfileDatabaseBinding(f.path).state, "bound");
  } finally { await f.close(); }
});

for (const invalid of [false, true]) it(`retains a private source descriptor and its primary failure on close refusal ${invalid}`, async () => {
  const f = await createBoundProfileFixture(), path = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  f.admission.assertProfileRuntime(); f.machine.assertStateRoot(path);
  const before = digest(path), identity = fs.lstatSync(path), actualClose = fs.closeSync;
  const injected = new Error("private-source-descriptor-close-refused");
  let descriptor: number | undefined, attempts = 0, proved = false;
  const close = vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    const current = fs.fstatSync(fd);
    if (current.dev === identity.dev && current.ino === identity.ino) { descriptor = fd; attempts++; throw injected; }
    return actualClose(fd);
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { readPrivateFile(path, { label: "protected.json", maxBytes: invalid ? 1 : 1_048_576 }); } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(failure.errors.length, invalid ? 2 : 1); assert.equal(failure.errors.at(-1), injected);
    assert.equal(failure.cause, failure.errors[0]);
    if (invalid) assert.ok(failure.errors[0] instanceof Error); else assert.equal(failure.cause, injected);
    assert.equal(attempts, 1); assert.ok(descriptor !== undefined);
    assert.equal(fs.fstatSync(descriptor).dev, identity.dev); assert.equal(fs.fstatSync(descriptor).ino, identity.ino);
    close.mockRestore(); syncBuiltinESMExports();
    assert.equal(digest(path), before);
    const heldDescriptor = descriptor;
    actualClose(heldDescriptor);
    assert.throws(() => fs.fstatSync(heldDescriptor), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    assert.equal(digest(path), before); proved = true;
  } finally { close.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});

for (const failSync of [false, true]) it(`retains the real sync descriptor and primary error after close refusal ${failSync}`, async () => {
  const f = await createBoundProfileFixture(), path = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  f.admission.assertProfileRuntime(); f.machine.assertStateRoot(path);
  const before = digest(path);
  const actualClose = fs.closeSync, actualSync = fs.fsyncSync;
  const primary = new Error("source-sync-refused"), cleanup = new Error("source-sync-close-refused");
  let descriptor: number | undefined, synchronizations = 0, closes = 0, proved = false;
  const sync = vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
    descriptor = fd; synchronizations++;
    if (failSync) throw primary;
    actualSync(fd);
  });
  syncBuiltinESMExports();
  const close = vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    assert.equal(fd, descriptor); closes++; throw cleanup;
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { fsyncPath(path); } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(failure.errors, failSync ? [primary, cleanup] : [cleanup]);
    assert.equal(failure.cause, failSync ? primary : cleanup);
    assert.equal(synchronizations, 1); assert.equal(closes, 1); assert.ok(descriptor !== undefined);
    const held = descriptor, identity = fs.lstatSync(path);
    assert.equal(fs.fstatSync(held).dev, identity.dev); assert.equal(fs.fstatSync(held).ino, identity.ino);
    sync.mockRestore(); syncBuiltinESMExports(); close.mockRestore(); syncBuiltinESMExports();
    assert.equal(digest(path), before);
    actualClose(held);
    assert.throws(() => fs.fstatSync(held), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    assert.equal(digest(path), before); proved = true;
  } finally { sync.mockRestore(); syncBuiltinESMExports(); close.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});

it("reads a closed incomplete profile inventory without changing source database identity", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  await using _fixture = { async [Symbol.asyncDispose]() { await f.close(); } };
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  using _machine = { [Symbol.dispose]() { machine.release(); } };
  const admission = machine.forStoppedIncompleteProfileInventory(f.profileId);
  using _admission = { [Symbol.dispose]() { admission.release(); } };
  const identity = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
    const value = fs.lstatSync(f.databasePath + suffix, { bigint: true, throwIfNoEntry: false });
    return { suffix, ...(value === undefined ? { absent: true } : {
      device: String(value.dev), inode: String(value.ino), mode: String(value.mode), size: String(value.size),
      modified: String(value.mtimeNs), changed: String(value.ctimeNs) }) };
  });
  const before = identity(), failures: unknown[] = [];
  try { assert.equal(AuthorityDatabase.readIncompleteOnboardingInventory(admission).empty, true); }
  catch (error) { failures.push(error); }
  try { assert.deepEqual(identity(), before); }
  catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "incomplete profile readonly source stability");
});

it("withdraws a genuine incomplete profile while preserving safe SQLite 0644 custody", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  await using _fixture = { async [Symbol.asyncDispose]() { await f.close(); } };
  fs.chmodSync(f.databasePath, 0o644);
  const capture = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
    const path = f.databasePath + suffix, value = fs.lstatSync(path, { bigint: true, throwIfNoEntry: false });
    return { suffix, ...(value === undefined ? { absent: true } : {
      device: String(value.dev), inode: String(value.ino), mode: String(value.mode), size: String(value.size),
      modified: String(value.mtimeNs), changed: String(value.ctimeNs), digest: digest(path) }) };
  });
  const before = capture(), key = digest(f.keyPath), protectedDocument = digest(f.protectedPath);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  using _machine = { [Symbol.dispose]() { machine.release(); } };
  await machine.reclassifyIncompleteProfileAsDraft(f.profileId);
  assert.equal(machine.readProfileRegistry().profiles.length, 0);
  assert.equal(fs.lstatSync(f.databasePath).mode & 0o777, 0o644);
  assert.deepEqual(capture(), before);
  assert.equal(digest(f.keyPath), key);
  assert.equal(digest(f.protectedPath), protectedDocument);
});

it("lets the owner dispose a retained snapshot after unproved operation closure", async () => {
  const profile = await createBoundProfileFixture();
  let snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot> | undefined;
  let cached: ReturnType<typeof createReadonlyAuthoritySnapshot> | undefined;
  const failure = retainAuthoritySourceClosure([new Error("retained source")], { database: {} });
  try {
    assert.throws(() => withOperationProof(() => {
      snapshot = createReadonlyAuthoritySnapshot(profile.path);
      cached = createReadonlyAuthoritySnapshot(profile.path);
      assert.equal(cached.path, snapshot.path);
      snapshot.dispose(); cached.dispose();
      assert.equal(fs.existsSync(snapshot.path), true);
      throw failure;
    }), error => error === failure);
    assert.ok(snapshot && cached);
    assert.equal(fs.existsSync(snapshot.path), true);
    snapshot.dispose(); cached.dispose(); snapshot.dispose();
    assert.equal(fs.existsSync(dirname(snapshot.path)), false);
  } finally { await profile.close(); }
});
