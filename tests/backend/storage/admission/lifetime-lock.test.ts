import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer, Server } from "node:net";
import { afterEach, it, vi } from "vitest";
import { assertOfflineMaintenanceOperation, isOfflineMaintenanceOperationActive, offlineMaintenanceWorkspace,
  OfflineMaintenanceOperationUnavailableError, RuntimeLifetimeLock, RuntimeLifetimeLockReleasedError,
  WorkerRuntimeLifetimeLock, type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";

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

it("retains the exact source failure through repeated close attempts and ignores ordinary errors", async () => {
  const clean = await heldLock();
  clean.lock.retainSourceClosure(new Error("ordinary failure"));
  await clean.lock.close(); assert.equal(clean.closes(), 1);
  const held = await heldLock(), failure = new AuthoritySourceClosureUnprovedError([new Error("synthetic native source close")]);
  held.lock.retainSourceClosure(failure);
  held.lock.retainSourceClosure(new Error("safe projection wrapper", { cause: failure }));
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(held.lock.close(), error => error === failure);
  assert.throws(() => held.lock.assertRuntimeAvailable(), error => error === failure);
  assert.throws(() => held.lock.assertAdmissionOperation(undefined, held.workspace), error => error === failure);
  assert.throws(() => held.lock.beginOfflineMaintenance(held.workspace), error => error === failure);
  held.lock.assertHeld(); assert.equal(held.closes(), 0);
});

for (const drain of ["child", "maintenance"] as const) it(`retains a source failure arriving during ${drain} drain before closing the listener`, async () => {
  const held = await heldLock(), failure = new AuthoritySourceClosureUnprovedError([new Error("source close during drain")]);
  let finish: () => void;
  if (drain === "child") {
    const child = new ChildProcess(); Object.defineProperty(child, "connected", { value: true });
    Object.defineProperty(child, "send", { value: (_message: unknown, _handle: unknown, sent: (error: Error | null) => void) => sent(null) });
    await held.lock.share(child); finish = () => { child.emit("close", 0, null); };
  } else {
    const operation = held.lock.beginOfflineMaintenance(held.workspace);
    finish = () => {
      assert.throws(() => operation.release(), error => error === failure);
      assert.equal(isOfflineMaintenanceOperationActive(operation), true);
    };
  }
  const closing = held.lock.close(); await Promise.resolve();
  held.lock.retainSourceClosure(failure); finish();
  await assert.rejects(closing, error => error === failure);
  await assert.rejects(held.lock.close(), error => error === failure);
  held.lock.assertHeld(); assert.equal(held.closes(), 0);
});

it("keeps an inherited worker listener held after a private source failure", async () => {
  const held = await heldLock();
  const server: unknown = vi.mocked(createServer).mock.results.at(-1)?.value;
  assert.ok(server instanceof Server);
  const send = Object.getOwnPropertyDescriptor(process, "send"), connected = Object.getOwnPropertyDescriptor(process, "connected"), before = new Set(process.listeners("disconnect"));
  Object.defineProperty(process, "send", { value() {}, configurable: true });
  Object.defineProperty(process, "connected", { value: true, configurable: true });
  try {
    const receiving = WorkerRuntimeLifetimeLock.receive(12345, () => {});
    process.emit("message", { kind: "runtime-lifetime-lock", port: 12345, workspace: held.workspace }, server);
    const worker = await receiving, failure = new AuthoritySourceClosureUnprovedError([new Error("worker native source close")]);
    worker.retainSourceClosure(failure);
    await assert.rejects(worker.close(), error => error === failure);
    Object.defineProperty(process, "connected", { value: false, configurable: true });
    await assert.rejects(worker.close(), error => error === failure);
    worker.assertHeld(); assert.throws(() => worker.assertRuntimeAvailable(), error => error === failure);
    assert.equal(held.closes(), 0);
  } finally {
    for (const listener of process.listeners("disconnect")) if (!before.has(listener)) process.removeListener("disconnect", listener);
    if (send === undefined) Reflect.deleteProperty(process, "send"); else Object.defineProperty(process, "send", send);
    if (connected === undefined) Reflect.deleteProperty(process, "connected"); else Object.defineProperty(process, "connected", connected);
  }
});
