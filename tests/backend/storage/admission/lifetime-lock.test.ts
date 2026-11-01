import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer, Server } from "node:net";
import { afterEach, it, vi } from "vitest";
import { assertOfflineMaintenanceOperation, isOfflineMaintenanceOperationActive, offlineMaintenanceWorkspace,
  OfflineMaintenanceOperationUnavailableError, RuntimeLifetimeLock, RuntimeLifetimeLockReleasedError,
  type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";

vi.mock("node:net", async importOriginal => {
  const net = await importOriginal<typeof import("node:net")>();
  return { ...net, createServer: vi.fn() };
});
afterEach(() => { vi.restoreAllMocks(); });

async function heldLock() {
  const server = new Server();
  let listening = false, closes = 0;
  Object.defineProperty(server, "listening", { get: () => listening });
  vi.spyOn(server, "listen").mockImplementation(() => {
    listening = true;
    queueMicrotask(() => server.emit("listening"));
    return server;
  });
  vi.spyOn(server, "address").mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 12345 });
  vi.spyOn(server, "close").mockImplementation(callback => {
    listening = false; closes++;
    queueMicrotask(() => callback?.());
    return server;
  });
  vi.mocked(createServer).mockReturnValue(server);
  const lock = await RuntimeLifetimeLock.acquire(0);
  const workspace = realpathSync(process.cwd());
  lock.initializeWorkspace(workspace, () => {});
  return { lock, workspace, closes: () => closes };
}

it("rejects structural maintenance authority before invoking supplied methods", () => {
  let calls = 0;
  const forged: OfflineMaintenanceOperation = Object.freeze({
    operationId: "11111111-1111-4111-8111-111111111111",
    assertHeld() { calls++; }, assertAvailable() { calls++; }, consume() { calls++; }, release() { calls++; },
  });
  assert.equal(isOfflineMaintenanceOperationActive(forged), false);
  assert.throws(() => offlineMaintenanceWorkspace(forged), OfflineMaintenanceOperationUnavailableError);
  assert.throws(() => assertOfflineMaintenanceOperation(forged, "/fixture"), OfflineMaintenanceOperationUnavailableError);
  assert.equal(calls, 0);
});

it("excludes runtime effects during exact maintenance and drains before releasing the listener", async () => {
  const f = await heldLock();
  const operation = f.lock.beginOfflineMaintenance(f.workspace);
  assert.equal(Object.isFrozen(operation), true);
  assert.equal(isOfflineMaintenanceOperationActive(operation), true);
  assert.equal(offlineMaintenanceWorkspace(operation), f.workspace);
  assert.throws(() => f.lock.assertRuntimeAvailable(), OfflineMaintenanceOperationUnavailableError);
  operation.consume();
  assert.throws(() => operation.consume(), { reason: "offline-maintenance-already-consumed" });
  assert.throws(() => assertOfflineMaintenanceOperation({ ...operation }, f.workspace), OfflineMaintenanceOperationUnavailableError);
  const closing = f.lock.close();
  await Promise.resolve();
  assert.equal(f.closes(), 0);
  operation.assertHeld();
  operation.release();
  operation.release();
  await closing;
  assert.equal(f.closes(), 1);
  assert.equal(isOfflineMaintenanceOperationActive(operation), false);
  assert.throws(() => operation.assertHeld(), OfflineMaintenanceOperationUnavailableError);
  assert.throws(() => f.lock.assertRuntimeAvailable(), RuntimeLifetimeLockReleasedError);
});

it("waits for child close rather than child exit or disconnect", async () => {
  const f = await heldLock();
  const child = new ChildProcess();
  Object.defineProperty(child, "connected", { value: true });
  Object.defineProperty(child, "send", { value: (_message: unknown, handle: unknown, sent: (error: Error | null) => void) => {
    assert.ok(handle instanceof Server);
    sent(null);
  } });
  await f.lock.share(child);
  const closing = f.lock.close();
  assert.throws(() => f.lock.share(child), /runtime-lifetime-closing/u);
  assert.throws(() => f.lock.assertRuntimeAvailable(), RuntimeLifetimeLockReleasedError);
  child.emit("exit", 0, null);
  child.emit("disconnect");
  await Promise.resolve();
  assert.equal(f.closes(), 0);
  f.lock.assertHeld();
  child.emit("close", 0, null);
  await closing;
  assert.equal(f.closes(), 1);
});
