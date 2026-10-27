import nodeUrl from 'node:url';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { AuthorityDatabase } from '../../../../src/backend/storage/sqlite/authority-database.js';
import * as processLocks from '../../../../src/backend/storage/sqlite/runtime-process-locks.js';
import { readPrivateFile } from '../../../../src/backend/storage/configuration/credential-safe-file.js';
import { AuthoritySourceClosureUnprovedError } from '../../../../src/backend/storage/source-closure.js';
import { rebuildRuntimeIsolation } from '../../../../src/backend/app/config/runtime-isolation.js';
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const uncertain of [false, true]) it(`bootstrap ${uncertain ? "retains" : "releases"} actual parent custody after ${uncertain ? "unproved closure" : "ordinary refusal"}`, async () => {
  const f = await createBoundProfileFixture();
  const cause = new Error("synthetic runtime refusal");
  const failure = uncertain ? new RuntimeCustodyUncertainError([cause]) : cause;
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "doctor"], {
      acquireAdmission: () => f.machine,
      runCli: async admission => { assert.equal(admission, f.machine); throw failure; },
    }), error => error === failure);
    if (uncertain) { f.machine.assertLive(); f.admission.assertLive(); }
    else assert.throws(() => f.machine.assertLive());
  } finally { await f.close(); }
});

for (const unproved of [false, true]) it(`preserves actual source descriptor and pre-handoff worker custody when close is ${unproved ? 'unproved' : 'proved'}`, async () => {
  const f = await createBoundProfileFixture(), argv = [...process.argv];
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  const before = fs.readFileSync(keyPath), key = fs.lstatSync(keyPath);
  const realClose = fs.closeSync, realOpen = fs.openSync;
  const acquireProcess = processLocks.acquireRuntimeProcessLock, actualFileURLToPath = nodeUrl.fileURLToPath;
  const bootstrapWorkspaceUrl = new URL('../../../../', import.meta.url).href;
  const processRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
  const observeWorkers = () => processLocks.observeRuntimeLockSnapshot({ processLockRoot: processRoot, sourceDatabaseIdentity }).processLocks.workers;
  assert.deepEqual(observeWorkers(), { state: 'stopped', generation: 1 });
  let descriptor: number | undefined, processOwner: ReturnType<typeof acquireProcess> | undefined;
  let closure: unknown, closes = 0, proved = false, phase = false, routing = false, routed = 0;
  const injected = new Error('bootstrap-source-close-refused');
  const workspace = vi.spyOn(nodeUrl, 'fileURLToPath').mockImplementation((...args) => {
    const value = args[0];
    if (routing && (typeof value === 'string' ? value : value.href) === bootstrapWorkspaceUrl) { routed++; return f.workspace; }
    return actualFileURLToPath(...args);
  });
  const processHook = vi.spyOn(processLocks, 'acquireRuntimeProcessLock').mockImplementation((...args) => {
    assert.ok(typeof args[0] === 'object' && args[0] !== null);
    assert.equal(Reflect.get(args[0], 'processLockRoot'), processRoot);
    const owner = acquireProcess(...args);
    if (owner.name === 'workers') { assert.equal(processOwner, undefined); processOwner = owner; }
    return owner;
  });
  const opened = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
    const fd = realOpen(...args);
    if (phase && args[0] === keyPath && descriptor === undefined) descriptor = fd;
    return fd;
  });
  const closed = vi.spyOn(fs, 'closeSync').mockImplementation(fd => {
    if (phase && fd === descriptor) { closes++; if (unproved) throw injected; }
    realClose(fd);
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try {
      routing = true;
      await runSecureEnvironmentBootstrap(['cli', 'worker', 'run'], {
        acquireAdmission: () => f.machine,
        assertEnvironment: () => undefined,
        runCli: async (admission, take) => {
          assert.equal(admission, f.machine); assert.ok(take);
          phase = true;
          try { readPrivateFile(keyPath, { label: 'lock', maxBytes: unproved ? 65_536 : 0 }); }
          catch (error) { closure = error; throw error; }
          finally { phase = false; }
        },
      });
    } catch (error) { failure = error; }
    finally { routing = false; }
    assert.equal(routed, 1);
    const owner = processOwner; assert.ok(owner); assert.ok(descriptor !== undefined);
    const acquisitionId = owner.acquisitionId; assert.ok(acquisitionId);
    const custody = { processLockRoot: processRoot, acquisitionId, pid: process.pid, authorityPath: f.path };
    if (unproved) {
      assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(failure.errors, [closure]); assert.equal(failure.cause, closure);
      assert.ok(closure instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(closure.errors, [injected]); assert.equal(closure.cause, injected);
      f.machine.assertLive(); f.admission.assertLive();
      const held = fs.fstatSync(descriptor); assert.equal(held.dev, key.dev); assert.equal(held.ino, key.ino);
      assert.deepEqual(observeWorkers(), { state: 'active', generation: 2, pid: process.pid });
      processLocks.assertWorkerProcessCustody(custody);
    } else {
      assert.ok(failure instanceof Error); assert.equal(failure, closure);
      assert.equal(failure instanceof AuthoritySourceClosureUnprovedError, false);
      assert.throws(() => f.machine.assertLive());
      assert.deepEqual(observeWorkers(), { state: 'stopped', generation: 2 });
      assert.throws(() => processLocks.assertWorkerProcessCustody(custody), error => error instanceof Error && error.message === 'worker-process-custody-not-held');
      const fd = descriptor; assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && Reflect.get(error, 'code') === 'EBADF');
    }
    assert.equal(closes, 1); assert.deepEqual(fs.readFileSync(keyPath), before);
    workspace.mockRestore(); processHook.mockRestore(); opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports();
    if (unproved) {
      realClose(descriptor);
      const fd = descriptor; assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && Reflect.get(error, 'code') === 'EBADF');
      owner.release();
    }
    proved = true;
  } finally {
    workspace.mockRestore(); processHook.mockRestore(); opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports();
    process.argv.splice(0, process.argv.length, ...argv);
    if (proved) await f.close();
  }
});
