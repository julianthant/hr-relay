import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { Server } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { dirname,join,sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RegisteredPersonUpgradeRefusedError,upgradeRegisteredPersonStores } from "../../../src/backend/app/composition/storage-compose.js";
import { RuntimeAdmission,acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { RuntimeAlreadyRunningError,RuntimeLifetimeLock,isOfflineMaintenanceOperationActive,type OfflineMaintenanceOperation } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError,hasUnprovedSourceClosure } from "../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createHistoricalRegisteredProfileFixture } from "../fixtures/storage/historical-incomplete-profile-fixture.js";

function chain(error: unknown): Set<unknown> {
  const seen = new Set<unknown>(), pending = [error];
  while (pending.length) {
    const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error) pending.push(value.cause);
  }
  return seen;
}
function tree(root: string): unknown {
  return fs.readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = fs.lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false);
    return [name, stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink,
      stat.isDirectory() ? tree(path) : createHash("sha256").update(fs.readFileSync(path)).digest("hex")];
  });
}
const retained = new Set<object>();

export async function runStartupUpgradeRetentionCase(input: { scenario: string; workspace: string; nonce: string }): Promise<void> {
  const workspace = fs.realpathSync(join(input.workspace, `.${input.scenario}-${input.nonce}`));
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion: 8, workspace, lifetime });
  const machineRoot = join(workspace, ".tracker", "data");
  retained.add({ profile, lifetime });
  const keyFault = input.scenario === "startup-upgrade-key-close";
  const bindingFault = input.scenario === "startup-upgrade-binding-inspection";
  const unprovedClose = input.scenario === "startup-upgrade-unproved-close";
  const publicationFault = input.scenario === "startup-upgrade-closed-publication-refusal";
  const injected = new Error(`native-${input.scenario}`), primary = new Error("source-publication-refused");
  let phase: "service-inspection" | "binding-inspection" | undefined, keyFaultArmed = false;
  let originalClosure: unknown, lifetimeClosure: unknown;
  let descriptor: number | undefined, closeAttempts = 0, disposalAttempts = 0, acquisitions = 0, starts = 0, closes = 0;
  let exclusive: RuntimeAdmission | undefined, operation: OfflineMaintenanceOperation | undefined;
  let snapshotDirectory: string | undefined, snapshotIdentity: fs.Stats | undefined, snapshotBytes: Buffer | undefined;
  let native: { database: DatabaseSync } | undefined, nativeClosed = false;
  const keyPath = join(machineRoot, "machine", "credential-keys", `${profile.binding.profileId}.json`);
  const keyIdentity = fs.lstatSync(keyPath), keyBytes = fs.readFileSync(keyPath);
  const close = fs.closeSync, remove = fs.rmSync;
  const fromLease = Object.getOwnPropertyDescriptors(RuntimeAdmission).fromInstallationLease.value; assert.ok(fromLease);
  RuntimeAdmission.fromInstallationLease = function (this: typeof RuntimeAdmission, lease) {
    const owner = fromLease.call(this, lease);
    if (lease.mode === "exclusive") { acquisitions++; exclusive = owner; }
    return owner;
  };
  const retainedAdmissions = new Set<RuntimeAdmission>();
  const retain = Object.getOwnPropertyDescriptors(RuntimeLifetimeLock.prototype).retainSourceClosure.value; assert.ok(retain);
  RuntimeLifetimeLock.prototype.retainSourceClosure = function (this: RuntimeLifetimeLock, error) {
    if (this === lifetime && chain(error).has(injected)) {
      lifetimeClosure ??= error;
      originalClosure ??= [...chain(error)].find(value => value instanceof AuthoritySourceClosureUnprovedError && value.cause === injected);
    }
    retain.call(this, error);
  };
  const inspect = Object.getOwnPropertyDescriptors(AuthorityDatabase).inspectStoppedUpgrade.value; assert.ok(inspect);
  AuthorityDatabase.inspectStoppedUpgrade = function (this: typeof AuthorityDatabase, ...args) {
    phase = "service-inspection";
    try { return inspect.apply(this, args); }
    catch (error) {
      if (chain(error).has(injected)) retainedAdmissions.add(args[0]);
      throw error;
    } finally { phase = undefined; }
  };
  const inspectBinding = Object.getOwnPropertyDescriptors(AuthorityDatabase).inspectRegisteredPersonAtStartup.value; assert.ok(inspectBinding);
  AuthorityDatabase.inspectRegisteredPersonAtStartup = function (this: typeof AuthorityDatabase, ...args) {
    phase = "binding-inspection";
    try { return inspectBinding.apply(this, args); } finally { phase = undefined; }
  };
  const begin = Object.getOwnPropertyDescriptors(RuntimeLifetimeLock.prototype).beginOfflineMaintenance.value; assert.ok(begin);
  RuntimeLifetimeLock.prototype.beginOfflineMaintenance = function (this: RuntimeLifetimeLock, path) {
    const result = begin.call(this, path); if (this === lifetime) operation = result; return result;
  };
  const emit = Object.getOwnPropertyDescriptors(EventEmitter.prototype).emit.value; assert.ok(emit);
  Server.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
    if (event === "listening") starts++;
    if (event === "close") closes++;
    return emit.call(this, event, ...args);
  };
  const prepare = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).prepare.value; assert.ok(prepare);
  const databaseClose = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close.value; assert.ok(databaseClose);
  const snapshotConnection = (database: DatabaseSync) => {
    const rows = prepare.call(database, "PRAGMA database_list").all();
    return rows.some(row => typeof row.file === "string" && row.file.includes(`${sep}relay-readonly-authority-`));
  };
  DatabaseSync.prototype.prepare = function (this: DatabaseSync, ...args) {
    if (!keyFault && !bindingFault && phase === "service-inspection" && native === undefined && snapshotConnection(this)) {
      native = { database: this };
      const row = prepare.call(this, "PRAGMA database_list").all().find(item => typeof item.file === "string" && item.file.includes(`${sep}relay-readonly-authority-`));
      assert.ok(row && typeof row.file === "string"); snapshotDirectory = dirname(row.file);
      snapshotIdentity = fs.lstatSync(row.file); snapshotBytes = fs.readFileSync(row.file);
      if (publicationFault) throw primary;
    }
    return prepare.apply(this, args);
  };
  DatabaseSync.prototype.close = function (this: DatabaseSync) {
    if (this === native?.database) {
      closeAttempts++;
      if (unprovedClose) throw injected;
      databaseClose.call(this); nativeClosed = true; return;
    }
    return databaseClose.call(this);
  };
  fs.closeSync = fd => {
    if (keyFault && keyFaultArmed && descriptor === undefined) {
      const opened = fs.fstatSync(fd);
      if (opened.dev === keyIdentity.dev && opened.ino === keyIdentity.ino) { descriptor = fd; closeAttempts++; throw injected; }
    }
    close(fd);
  };
  fs.rmSync = (path, options) => {
    const selected = phase === (bindingFault ? "binding-inspection" : "service-inspection");
    if (!keyFault && !unprovedClose && selected && String(path).includes(`${sep}relay-readonly-authority-`)
      && (snapshotDirectory === undefined || snapshotDirectory === String(path))) {
      snapshotDirectory = String(path);
      const source = join(snapshotDirectory, "authority.sqlite");
      snapshotIdentity ??= fs.lstatSync(source); snapshotBytes ??= fs.readFileSync(source);
      disposalAttempts++; throw injected;
    }
    remove(path, options);
  };
  syncBuiltinESMExports();
  const before = tree(profile.stateRoot), databaseBefore = fs.readFileSync(profile.path);
  const canonicalSources = () => ["credential-keys", "credential-operations", "duo-credentials"].map(name => {
    const path = join(machineRoot, "machine", name); return [name, fs.existsSync(path) ? tree(path) : null];
  });
  const canonicalBefore = canonicalSources();
  const controlPath = join(workspace, ".tracker", "control", "profile-registry.json"), controlBefore = fs.readFileSync(controlPath);
  const registryPath = join(machineRoot, "machine", "profiles.json"), registryBefore = fs.readFileSync(registryPath);
  keyFaultArmed = true;
  let failure: unknown;
  try { await upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null }); } catch (error) { failure = error; }
  assert.ok(failure instanceof RegisteredPersonUpgradeRefusedError);
  if (keyFault) { assert.ok(descriptor !== undefined); assert.equal(closeAttempts, 1); }
  else { assert.ok(exclusive); exclusive.assertExclusive(); assert.equal(acquisitions, bindingFault ? 1 : 2); }
  assert.ok(operation);
  const retainedOperation: OfflineMaintenanceOperation = operation;
  assert.equal(isOfflineMaintenanceOperationActive(retainedOperation), true);
  assert.throws(() => retainedOperation.assertHeld(), error => hasUnprovedSourceClosure(error) && chain(error).has(injected));
  assert.equal(hasUnprovedSourceClosure(failure), true); assert.equal(chain(failure).has(injected), true);
  if (!keyFault && !bindingFault) {
    const source = [...retainedAdmissions].find(owner => owner !== exclusive); assert.ok(source);
    assert.throws(() => source.release(), error => hasUnprovedSourceClosure(error) && chain(error).has(injected));
  }
  if (keyFault) {
    assert.ok(originalClosure instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(originalClosure.errors, [injected]); assert.equal(originalClosure.cause, injected);
    assert.ok(lifetimeClosure instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(chain(lifetimeClosure).has(originalClosure), true); assert.equal(chain(failure).has(lifetimeClosure), true);
    assert.equal(chain(failure).has(originalClosure), true);
  }
  const exact = [...chain(failure)].find(value => value instanceof AuthoritySourceClosureUnprovedError && value.cause === injected);
  assert.ok(exact instanceof AuthoritySourceClosureUnprovedError); assert.deepEqual(exact.errors, [injected]);
  const leaves = [...chain(failure)].filter(value => value instanceof Error && !(value instanceof AggregateError) && value.cause === undefined);
  assert.deepEqual(new Set(leaves), new Set(publicationFault ? [primary, injected] : [injected]));
  if (publicationFault) {
    const ordered = [...chain(failure)].find(value => value instanceof AggregateError && value.errors[0] === primary);
    assert.ok(ordered instanceof AggregateError); assert.deepEqual(ordered.errors, [primary, exact]); assert.equal(ordered.cause, exact);
    assert.equal(nativeClosed, true); assert.equal(closeAttempts, 1);
  }
  if (unprovedClose) { assert.ok(native); assert.equal(nativeClosed, false); assert.equal(closeAttempts, 1); assert.equal(disposalAttempts, 0); }
  else if (!keyFault) assert.equal(disposalAttempts, 1);
  assert.equal(starts, 0); assert.equal(closes, 0);
  if (descriptor !== undefined) {
    assert.deepEqual([fs.fstatSync(descriptor).dev, fs.fstatSync(descriptor).ino], [keyIdentity.dev, keyIdentity.ino]);
    const bytes = Buffer.alloc(keyBytes.length); assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, 0), bytes.length); assert.deepEqual(bytes, keyBytes);
  }
  if (native !== undefined) {
    const database = native.database;
    if (nativeClosed) assert.throws(() => prepare.call(database, "SELECT 1"));
    else assert.equal(prepare.call(database, "SELECT 1 AS held").get()?.held, 1);
  }
  if (snapshotDirectory !== undefined) {
    const source = join(snapshotDirectory, "authority.sqlite"); assert.ok(snapshotIdentity && snapshotBytes);
    const stat = fs.lstatSync(source);
    assert.deepEqual([stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs],
      [snapshotIdentity.dev, snapshotIdentity.ino, snapshotIdentity.mode, snapshotIdentity.uid, snapshotIdentity.nlink, snapshotIdentity.size, snapshotIdentity.mtimeMs, snapshotIdentity.ctimeMs]);
    assert.deepEqual(fs.readFileSync(source), snapshotBytes);
  }
  assert.deepEqual(tree(profile.stateRoot), before); assert.deepEqual(fs.readFileSync(profile.path), databaseBefore); assert.deepEqual(fs.readFileSync(keyPath), keyBytes);
  assert.equal(fs.existsSync(join(profile.stateRoot, "backups")), false);
  if (exclusive !== undefined) { const owner: RuntimeAdmission = exclusive; owner.assertExclusive(); assert.throws(() => owner.release(), error => hasUnprovedSourceClosure(error)); }
  assert.throws(() => acquireSharedRuntimeAdmission(workspace, lifetime));
  assert.throws(() => lifetime.beginOfflineMaintenance(workspace));
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(lifetime.close(), error => hasUnprovedSourceClosure(error) && chain(error).has(injected));
    lifetime.assertHeld();
    if (operation !== undefined) { const held: OfflineMaintenanceOperation = operation; assert.equal(isOfflineMaintenanceOperationActive(held), true); assert.throws(() => held.assertHeld(), error => hasUnprovedSourceClosure(error) && chain(error).has(injected)); }
    if (exclusive !== undefined) exclusive.assertExclusive();
    await assert.rejects(async () => {
      const successor = await RuntimeLifetimeLock.acquire(lifetime.port); retained.add(successor);
    }, RuntimeAlreadyRunningError);
  }
  assert.deepEqual(tree(profile.stateRoot), before); assert.deepEqual(fs.readFileSync(keyPath), keyBytes);
  assert.deepEqual(canonicalSources(), canonicalBefore); assert.deepEqual(fs.readFileSync(controlPath), controlBefore); assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
  assert.equal(starts, 0); assert.equal(closes, 0);
  assert.equal(closeAttempts, keyFault || native !== undefined ? 1 : 0);
  assert.equal(disposalAttempts, keyFault || unprovedClose ? 0 : 1);
  if (descriptor !== undefined) {
    assert.deepEqual([fs.fstatSync(descriptor).dev, fs.fstatSync(descriptor).ino], [keyIdentity.dev, keyIdentity.ino]);
  }
  if (snapshotDirectory !== undefined) {
    assert.ok(snapshotIdentity && snapshotBytes);
    const source = join(snapshotDirectory, "authority.sqlite"), current = fs.lstatSync(source);
    assert.deepEqual([current.dev, current.ino], [snapshotIdentity.dev, snapshotIdentity.ino]); assert.deepEqual(fs.readFileSync(source), snapshotBytes);
    process.send?.({ ownedSnapshot: snapshotDirectory });
  }
}
