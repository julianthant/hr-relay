import { tmpdir } from 'node:os';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { AuthorityDatabase } from '../../../../src/backend/storage/sqlite/authority-database.js';
import { AuthoritySourceClosureUnprovedError } from '../../../../src/backend/storage/source-closure.js';
import { acquireRuntimeRestoreAdmission, assertRuntimeRestoreAdmission } from '../../../../src/backend/storage/sqlite/runtime-process-locks.js';
import { composeStorageCommand } from '../../../../src/backend/app/composition/storage-compose.js';
import { rebuildRuntimeIsolation } from '../../../../src/backend/app/config/runtime-isolation.js';
import { systemClock } from '../../../../src/rules/time/clock.js';
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { mkdirSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("native authority backup", () => {
  it("plans a fresh native root without creating authority and initializes only behind stopped admission",async()=>{
    const fixture=await createBoundProfileFixture({pending:"storage"}),root=fixture.stateRoot,path=fixture.path;
    cleanups.push(async ()=>await fixture.close());const admission=fixture.admission,processLockRoot=join(root,"locks"),clock=capturedInstantClock(NOW);
    mkdirSync(processLockRoot,{mode:0o700});
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:true},clock)).resolves.toMatchObject({state:"planned",fromSchemaVersion:0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION});
    expect(()=>readFileSync(path)).toThrow();
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:false},clock)).resolves.toMatchObject({state:"initialized"});
    expect(inspectAuthorityBackupReadOnly(admission,path).tables).toHaveLength(39);
  });

});

for (const entry of ['service', 'command'] as const) it(`retains actual stopped source custody through ${entry} upgrade failure`, async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  AuthorityDatabase.initializeProfile(f.admission, systemClock);
  const root = join(f.workspace, rebuildRuntimeIsolation.processLockRoot), before = fs.readFileSync(f.path);
  const actualRemove = fs.rmSync, actualCreate = fs.mkdtempSync;
  const snapshotPrefix = join(tmpdir(), "relay-readonly-authority-");
  const injected = new Error('upgrade-snapshot-remove-refused');
  let armed = entry === 'command', directory: string | undefined, removals = 0;
  let restore: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined, proved = false;
  const created = vi.spyOn(fs, 'mkdtempSync').mockImplementation((...args) => {
    const value = actualCreate(...args);
    if (armed && args[0] === snapshotPrefix) { assert.equal(directory, undefined); assert.ok(typeof value === 'string'); directory = value; }
    return value;
  });
  const removed = vi.spyOn(fs, 'rmSync').mockImplementation((...args) => {
    if (directory !== undefined && args[0] === directory) { removals++; throw injected; }
    actualRemove(...args);
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try {
      if (entry === 'command') await composeStorageCommand(rebuildRuntimeIsolation, ['upgrade', '--json'], systemClock, f.workspace, f.admission);
      else await upgradeStorage(f.admission, { stateRoot: f.stateRoot, processLockRoot: root, plan: false }, systemClock, (input, clock) => {
        const owner = acquireRuntimeRestoreAdmission(input, clock); restore = owner; armed = true; return owner;
      });
    } catch (error) { failure = error; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    const inspected = entry === 'service' ? failure.cause : failure;
    assert.ok(inspected instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(inspected.errors.length, 1); assert.equal(inspected.errors[0], inspected.cause);
    assert.ok(inspected.cause instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(inspected.cause.errors, [injected]); assert.equal(inspected.cause.cause, injected);
    if (entry === 'service') {
      assert.equal(failure.errors.length, 1); assert.equal(failure.errors[0], inspected);
      assert.ok(restore); assertRuntimeRestoreAdmission(restore, root);
    } else assert.equal(restore, undefined);
    assert.ok(directory); assert.equal(removals, 1); assert.equal(fs.existsSync(directory), true);
    assert.deepEqual(fs.readFileSync(f.path), before); f.admission.assertLive(); f.machine.assertLive();
    created.mockRestore(); removed.mockRestore(); syncBuiltinESMExports();
    actualRemove(directory, { recursive: true }); assert.equal(fs.existsSync(directory), false);
    restore?.release(); proved = true;
  } finally {
    created.mockRestore(); removed.mockRestore(); syncBuiltinESMExports();
    if (proved) await f.close();
  }
});

for (const entry of ['service', 'command'] as const) it(`releases proved upgrade owners after an ordinary ${entry} snapshot creation refusal`, async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  AuthorityDatabase.initializeProfile(f.admission, systemClock);
  const root = join(f.workspace, rebuildRuntimeIsolation.processLockRoot), before = fs.readFileSync(f.path);
  const actualCreate = fs.mkdtempSync, injected = new Error('upgrade-source-create-unavailable');
  const snapshotPrefix = join(tmpdir(), "relay-readonly-authority-");
  let armed = entry === 'command', refused = 0, restore: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined;
  const creation = vi.spyOn(fs, 'mkdtempSync').mockImplementation((...args) => {
    if (armed && args[0] === snapshotPrefix) { refused++; throw injected; }
    return actualCreate(...args);
  });
  syncBuiltinESMExports();
  let proved = false;
  try {
    if (entry === 'service') {
      await assert.rejects(upgradeStorage(f.admission, { stateRoot: f.stateRoot, processLockRoot: root, plan: false }, systemClock, (input, clock) => {
        const owner = acquireRuntimeRestoreAdmission(input, clock); restore = owner; armed = true; return owner;
      }), error => error === injected);
      const releasedRestore = restore; assert.ok(releasedRestore);
      assert.throws(() => assertRuntimeRestoreAdmission(releasedRestore, root));
    } else {
      const result = await composeStorageCommand(rebuildRuntimeIsolation, ['upgrade', '--json'], systemClock, f.workspace, f.admission);
      assert.equal(result.exitCode, 1);
      const parsed: unknown = JSON.parse(result.output);
      assert.ok(typeof parsed === 'object' && parsed !== null);
      assert.equal(typeof Reflect.get(parsed, 'code'), 'string');
    }
    assert.equal(refused, 1); assert.deepEqual(fs.readFileSync(f.path), before);
    f.admission.assertLive(); f.machine.assertLive(); proved = true;
  } finally { creation.mockRestore(); syncBuiltinESMExports(); if (proved) await f.close(); }
});
