import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { assertRuntimeLifetimeHeld } from "../../../support/helpers/backend/runtime-lifetime.js";
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { readPrivateFile } from '../../../../src/backend/storage/configuration/credential-safe-file.js';
import { AuthoritySourceClosureUnprovedError } from '../../../../src/backend/storage/source-closure.js';
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

for (const unproved of [false, true]) it(`preserves actual source descriptor and parent kernel custody when close is ${unproved ? "unproved" : "proved"}`, async () => {
  const f = await createBoundProfileFixture(), argv = [...process.argv];
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
  const before = fs.readFileSync(keyPath), key = fs.lstatSync(keyPath);
  const realClose = fs.closeSync, realOpen = fs.openSync;
  let descriptor: number | undefined;
  let closure: unknown, closes = 0, proved = false, phase = false;
  const injected = new Error("bootstrap-source-close-refused");
  const opened = vi.spyOn(fs, "openSync").mockImplementation((...args) => {
    const fd = realOpen(...args);
    if (phase && args[0] === keyPath && descriptor === undefined) descriptor = fd;
    return fd;
  });
  const closed = vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    if (phase && fd === descriptor) { closes++; if (unproved) throw injected; }
    realClose(fd);
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try {
      await runSecureEnvironmentBootstrap(["cli", "storage", "doctor"], {
        acquireLifetimeLock: async () => f.lifetime,
        acquireAdmission: (_mode, lifetime) => { assert.equal(lifetime, f.lifetime); return f.machine; },
        assertEnvironment: () => undefined,
        runCli: async (admission, take, lifetime) => {
          assert.equal(admission, f.machine); assert.ok(take); assert.equal(lifetime.lock, f.lifetime);
          await assertRuntimeLifetimeHeld(f.lifetime);
          phase = true;
          try { readPrivateFile(keyPath, { label: "lock", maxBytes: unproved ? 65_536 : 0 }); }
          catch (error) { closure = error; throw error; }
          finally { phase = false; }
        },
      });
    } catch (error) { failure = error; }
    assert.ok(descriptor !== undefined);
    if (unproved) {
      assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(failure.errors, [closure]); assert.equal(failure.cause, closure);
      assert.ok(closure instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(closure.errors, [injected]); assert.equal(closure.cause, injected);
      f.machine.assertLive(); f.admission.assertLive();
      const held = fs.fstatSync(descriptor); assert.equal(held.dev, key.dev); assert.equal(held.ino, key.ino);
      await assertRuntimeLifetimeHeld(f.lifetime);
    } else {
      assert.ok(failure instanceof Error); assert.equal(failure, closure);
      assert.equal(failure instanceof AuthoritySourceClosureUnprovedError, false);
      assert.throws(() => f.machine.assertLive());
      assert.throws(() => f.lifetime.assertHeld());
      const replacement = await RuntimeLifetimeLock.acquire(f.lifetime.port);
      await replacement.close();
      const fd = descriptor; assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    }
    assert.equal(closes, 1); assert.deepEqual(fs.readFileSync(keyPath), before);
    opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports();
    if (unproved) {
      realClose(descriptor);
      const fd = descriptor; assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    }
    proved = true;
  } finally {
    opened.mockRestore(); closed.mockRestore(); syncBuiltinESMExports();
    process.argv.splice(0, process.argv.length, ...argv);
    if (proved) await f.close();
  }
});
