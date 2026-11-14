import assert from "node:assert/strict";
import { it } from "vitest";
import { acquireLifetimeLockAfterShutdownBackup, SHUTDOWN_BACKUP_WAIT_MS } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { RuntimeAlreadyRunningError, type RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";

function waiting(busyAttempts: number, backendListening = false) {
  const lock = {} as RuntimeLifetimeLock, calls = { acquire: 0, sleeps: [] as number[], waits: 0 };
  let now = 0;
  const wait = {
    acquire: (port: number) => { assert.equal(port, 3939); calls.acquire++; return calls.acquire > busyAttempts ? Promise.resolve(lock) : Promise.reject(new RuntimeAlreadyRunningError(undefined)); },
    backendListening: () => Promise.resolve(backendListening),
    sleep: (ms: number) => { calls.sleeps.push(ms); now += ms; return Promise.resolve(); },
    nowMs: () => now,
    onWait: () => { calls.waits++; },
  };
  return { lock, calls, wait };
}

it("waits for a finishing quit-time backup to release the lifetime lock, announcing the wait once", async () => {
  const f = waiting(3);
  assert.equal(await acquireLifetimeLockAfterShutdownBackup(3939, f.wait), f.lock);
  assert.deepEqual(f.calls, { acquire: 4, sleeps: [1000, 1000, 1000], waits: 1 });
});

it("does not wait when the lock is free", async () => {
  const f = waiting(0);
  assert.equal(await acquireLifetimeLockAfterShutdownBackup(3939, f.wait), f.lock);
  assert.deepEqual(f.calls, { acquire: 1, sleeps: [], waits: 0 });
});

it("refuses at once while a dashboard is serving", async () => {
  const f = waiting(Infinity, true);
  await assert.rejects(acquireLifetimeLockAfterShutdownBackup(3939, f.wait), RuntimeAlreadyRunningError);
  assert.deepEqual(f.calls, { acquire: 1, sleeps: [], waits: 0 });
});

it("refuses once the wait limit passes", async () => {
  const f = waiting(Infinity);
  await assert.rejects(acquireLifetimeLockAfterShutdownBackup(3939, f.wait), RuntimeAlreadyRunningError);
  assert.equal(f.calls.sleeps.reduce((sum, ms) => sum + ms, 0), SHUTDOWN_BACKUP_WAIT_MS);
});

it("passes any other lock failure through without waiting", async () => {
  const f = waiting(0), failure = new Error("listen failed");
  await assert.rejects(acquireLifetimeLockAfterShutdownBackup(3939, { ...f.wait, acquire: () => Promise.reject(failure) }), error => error === failure);
  assert.deepEqual(f.calls.sleeps, []);
});
