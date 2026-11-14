import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { readPendingShutdownBackup, removePendingShutdownBackup, writePendingShutdownBackup } from "../../../../src/backend/app/composition/storage-compose.js";
import { acquireLifetimeLockAfterShutdownBackup, completePendingShutdownBackup, SHUTDOWN_BACKUP_WAIT_MS } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
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

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";

function pending(record: string[] | undefined, backupError?: Error) {
  const calls = { backed: [] as string[][], removed: 0, warned: [] as unknown[] };
  const deps = {
    read: () => record === undefined ? undefined : new Set(record),
    backup: (people: ReadonlySet<string>) => { calls.backed.push([...people]); return backupError === undefined ? Promise.resolve() : Promise.reject(backupError); },
    remove: () => { calls.removed++; },
  };
  return { calls, deps, warn: (error: unknown) => { calls.warned.push(error); } };
}

it("round-trips, removes and refuses a malformed pending shutdown-backup record", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pending-backup-"));
  try {
    assert.equal(readPendingShutdownBackup(workspace), undefined);
    writePendingShutdownBackup(workspace, [A, B]);
    assert.deepEqual([...readPendingShutdownBackup(workspace) ?? []], [A, B]);
    const file = join(workspace, rebuildRuntimeIsolation.stateRoot, "shutdown-backup.pending.json");
    removePendingShutdownBackup(workspace);
    assert.equal(existsSync(file), false);
    assert.deepEqual(readdirSync(join(workspace, rebuildRuntimeIsolation.stateRoot)), []);
    writeFileSync(file, '{"people":["not-a-uuid"]}');
    assert.throws(() => readPendingShutdownBackup(workspace));
    writeFileSync(file, '{"people":[]}');
    assert.throws(() => readPendingShutdownBackup(workspace));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("a starting dashboard completes the pending backup once with the record people and removes the record", async () => {
  const f = pending([A, B]);
  await completePendingShutdownBackup({ ...f.deps, warn: f.warn });
  assert.deepEqual(f.calls, { backed: [[A, B]], removed: 1, warned: [] });
});

it("a failed completion at start keeps the record, warns and does not throw", async () => {
  const failure = new Error("boom"), f = pending([A], failure);
  await completePendingShutdownBackup({ ...f.deps, warn: f.warn });
  assert.deepEqual(f.calls, { backed: [[A]], removed: 0, warned: [failure] });
});

it("the finisher without a record takes no backup", async () => {
  const f = pending(undefined);
  await completePendingShutdownBackup({ ...f.deps, only: new Set([A]) });
  assert.deepEqual(f.calls, { backed: [], removed: 0, warned: [] });
});

it("the finisher backs up argv people in the record, then removes it; a failure keeps it and propagates", async () => {
  const f = pending([A, B]);
  await completePendingShutdownBackup({ ...f.deps, only: new Set([B]) });
  assert.deepEqual(f.calls, { backed: [[B]], removed: 1, warned: [] });
  const failure = new Error("boom"), g = pending([A], failure);
  await assert.rejects(completePendingShutdownBackup({ ...g.deps, only: new Set([A]) }), failure);
  assert.deepEqual(g.calls, { backed: [[A]], removed: 0, warned: [] });
  const h = pending([A]);
  await completePendingShutdownBackup({ ...h.deps, only: new Set([B]) });
  assert.deepEqual(h.calls, { backed: [], removed: 1, warned: [] });
});
