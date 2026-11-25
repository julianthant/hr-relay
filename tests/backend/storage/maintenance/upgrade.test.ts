import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { withOfflineMaintenance, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { AuthorityDatabase } from '../../../../src/backend/storage/sqlite/authority-database.js';
import { composeStorageCommand } from '../../../../src/backend/app/composition/storage-compose.js';
import { rebuildRuntimeIsolation } from '../../../../src/backend/app/config/runtime-isolation.js';
import { systemClock, capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { mkdirSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("native authority backup", () => {
  it("plans a fresh native root without creating authority and initializes only behind stopped admission",async()=>{
    const fixture=await createBoundProfileFixture({pending:"storage"}),root=fixture.stateRoot,path=fixture.path;
    cleanups.push(async ()=>await fixture.close());const admission=fixture.admission,processLockRoot=join(fixture.workspace,rebuildRuntimeIsolation.processLockRoot),clock=capturedInstantClock(NOW);
    mkdirSync(processLockRoot,{recursive:true,mode:0o700});
    await expect(withOfflineMaintenance(admission, operation => upgradeStorage(profileBrowserClosure, admission, {stateRoot:root,processLockRoot,plan:true}, clock, operation))).resolves.toMatchObject({state:"planned",fromSchemaVersion:0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION});
    expect(()=>readFileSync(path)).toThrow();
    await expect(withOfflineMaintenance(admission, operation => upgradeStorage(profileBrowserClosure, admission, {stateRoot:root,processLockRoot,plan:false}, clock, operation))).resolves.toMatchObject({state:"initialized"});
    expect(inspectAuthorityBackupReadOnly(admission,path).tables).toEqual(AUTHORITY_TABLE_REGISTRY
      .map(({name,classification})=>({name,classification})).sort((left,right)=>left.name.localeCompare(right.name)));
  });

});

for (const entry of ['service', 'command'] as const) it(`retains actual stopped source custody through ${entry} upgrade failure`, async () => {
  await runCredentialSourceRetentionCase(`stopped-upgrade-${entry}`);
});

for (const entry of ['service', 'command'] as const) it(`releases proved upgrade owners after an ordinary ${entry} snapshot creation refusal`, async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  AuthorityDatabase.initializeProfile(f.admission, systemClock);
  const root = join(f.workspace, rebuildRuntimeIsolation.processLockRoot), before = fs.readFileSync(f.path);
  const actualCreate = fs.mkdtempSync, injected = new Error('upgrade-source-create-unavailable');
  const snapshotPrefix = join(fs.realpathSync(tmpdir()), `relay-readonly-authority-pid${String(process.pid)}-`);
  let snapshots = 0, refused = 0;
  const restore = entry === 'service' ? f.admission.acquireOfflineMaintenance() : undefined;
  const creation = vi.spyOn(fs, 'mkdtempSync').mockImplementation((...args) => {
    if (args[0] === snapshotPrefix && ++snapshots === (entry === 'service' ? 2 : 1)) { refused++; throw injected; }
    return actualCreate(...args);
  });
  syncBuiltinESMExports();
  let proved = false;
  try {
    if (entry === 'service') {
      assert.ok(restore);
      await assert.rejects(upgradeStorage(profileBrowserClosure, f.admission, { stateRoot: f.stateRoot, processLockRoot: root, plan: false }, systemClock, restore), error => error === injected);
      restore.assertHeld(); restore.release();
      assert.throws(() => restore.assertHeld(), /offline-maintenance-unissued/u);
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
