import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import files, { type FileHandle } from "node:fs/promises";
import { type OfflineMaintenanceOperation, RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { assertRuntimeLifetimeHeld } from "../../../support/helpers/backend/runtime-lifetime.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const { fixture, adoptSynthetic, cleanup } = createInstallationControlTestWorld();
afterEach(cleanup);

for (const failOpen of [false, true]) it(failOpen
  ? "releases deferred-IO admission after initial open rejection with the exact primary error"
  : "pins the exact exclusive lease and root across deferred owned IO, then permits replacement only after completion", async () => {
  const f = await fixture(), lease = adoptSynthetic(f.workspace, f.pair, f.lifetime);
  const openFailure = new Error("fixture-initial-IO-open-refused");
  const opening = failOpen ? vi.spyOn(files, "open").mockRejectedValueOnce(openFailure) : undefined;
  let operation: OfflineMaintenanceOperation | undefined, file: FileHandle | undefined;
  let child: ChildProcess | undefined, closed: Promise<unknown[]> | undefined, io: Promise<void> | undefined;
  let finish: (() => void) | undefined;
  let primary: { error: unknown } | undefined;
  try {
    const heldOperation = lease.beginOfflineMaintenance(); operation = heldOperation;
    file = await files.open(join(f.workspace, "owned-offline-io"), "wx", 0o600);
    const ownedFile = file, ownedOperation = heldOperation;
    child = spawn(process.execPath, ["-e", "process.once('message',()=>process.disconnect());process.send('ready')"],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const ownedChild = child;
    closed = once(ownedChild, "close");
    const gate = new Promise<void>(resolve => { finish = resolve; });
    io = (async () => { await gate; ownedOperation.assertHeld(); await ownedFile.writeFile("settled"); await ownedFile.close(); file = undefined; })();
    assert.deepEqual((await once(ownedChild, "message"))[0], "ready");
    const before = storageTree(f.workspace), send = vi.spyOn(ownedChild, "send");
    try {
      assert.throws(() => lease.beginOfflineMaintenance(), /offline-maintenance-busy/u);
      assert.throws(() => lease.release(), /offline-maintenance-busy/u);
      assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime), /offline-maintenance-unissued/u);
      assert.throws(() => f.lifetime.share(ownedChild), /exclusive-lease-held/u);
      assert.equal(send.mock.calls.length, 0);
      lease.assertOfflineMaintenance(heldOperation);
      assert.throws(() => lease.assertOfflineMaintenance({ ...heldOperation }), /offline-maintenance-unissued/u);
      assert.deepEqual(storageTree(f.workspace), before);
    } finally { send.mockRestore(); }
    let rootClosed = false;
    const closing = f.lifetime.close().then(() => { rootClosed = true; });
    await Promise.resolve();
    assert.equal(rootClosed, false);
    assert.throws(() => acquireInstallation(f.workspace, "shared", f.lifetime), /runtime-lifetime-closing/u);
    assert.throws(() => lease.beginOfflineMaintenance(), /offline-maintenance-busy/u);
    await assertRuntimeLifetimeHeld(f.lifetime);
    assert.ok(finish); finish(); await io;
    heldOperation.release();
    assert.throws(() => heldOperation.assertHeld(), /offline-maintenance-unissued/u);
    lease.release();
    await closing;
    assert.equal(rootClosed, true);
    const successor = await RuntimeLifetimeLock.acquire(f.lifetime.port);
    try {
      const next = acquireInstallation(f.workspace, "exclusive", successor);
      try { next.assertHeld(); } finally { next.release(); }
    } finally { await successor.close(); }
  } catch (error) { primary = { error }; }
  opening?.mockRestore();
  const failures: unknown[] = [];
  finish?.();
  if (io !== undefined) try { await io; } catch (error) { failures.push(error); }
  if (file !== undefined) try { await file.close(); file = undefined; } catch (error) { failures.push(error); }
  if (child !== undefined && closed !== undefined) try {
    if (child.connected) child.send("close");
    assert.deepEqual(await closed, [0, null]); child = undefined;
  } catch (error) { failures.push(error); }
  if (file === undefined && child === undefined) {
    try { operation?.release(); lease.release(); await f.lifetime.close(); } catch (error) { failures.push(error); }
  }
  if (failOpen && failures.length === 0) {
    assert.equal(primary?.error, openFailure);
    assert.throws(() => f.lifetime.assertHeld());
    const successor = await RuntimeLifetimeLock.acquire(f.lifetime.port);
    await successor.close();
    return;
  }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "offline IO and owned cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "offline IO cleanup failed", { cause: failures[0] });
});

for (const failOpen of [false, true]) it(failOpen
  ? "releases close-proof admission after initial open rejection with the exact primary error"
  : "retains the lease and root after an unproved owned close until that actual resource closes", async () => {
  const f = await fixture(), lease = adoptSynthetic(f.workspace, f.pair, f.lifetime);
  const openFailure = new Error("fixture-initial-close-open-refused");
  const opening = failOpen ? vi.spyOn(files, "open").mockRejectedValueOnce(openFailure) : undefined;
  let operation: OfflineMaintenanceOperation | undefined, file: FileHandle | undefined;
  let restoreClose: (() => void) | undefined;
  const unproved = new Error("fixture-owned-close-unproved");
  let primary: { error: unknown } | undefined;
  try {
    const heldOperation = lease.beginOfflineMaintenance(); operation = heldOperation;
    file = await files.open(join(f.workspace, "owned-offline-close"), "wx", 0o600);
    const close = vi.spyOn(file, "close").mockRejectedValueOnce(unproved);
    restoreClose = () => close.mockRestore();
    await assert.rejects(file.close(), error => error === unproved);
    assert.equal((await file.stat()).isFile(), true);
    assert.throws(() => lease.release(), /offline-maintenance-busy/u);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime), /offline-maintenance-unissued/u);
    let rootClosed = false;
    const closing = f.lifetime.close().then(() => { rootClosed = true; });
    await Promise.resolve();
    assert.equal(rootClosed, false);
    await assertRuntimeLifetimeHeld(f.lifetime);
    lease.assertOfflineMaintenance(heldOperation);
    close.mockRestore(); await file.close(); file = undefined;
    heldOperation.release(); lease.release(); await closing;
    assert.equal(rootClosed, true);
  } catch (error) { primary = { error }; }
  opening?.mockRestore(); restoreClose?.();
  const failures: unknown[] = [];
  if (file !== undefined) try { await file.close(); file = undefined; } catch (error) { failures.push(error); }
  if (file === undefined) {
    try { operation?.release(); lease.release(); await f.lifetime.close(); } catch (error) { failures.push(error); }
  }
  if (failOpen && failures.length === 0) {
    assert.equal(primary?.error, openFailure);
    assert.throws(() => f.lifetime.assertHeld());
    const successor = await RuntimeLifetimeLock.acquire(f.lifetime.port);
    await successor.close();
    return;
  }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "unproved close and owned cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "owned close cleanup failed", { cause: failures[0] });
});

it("issues before first admission and requires the exact root and workspace through consumption and restart", async () => {
  const f = await fixture(), foreign = await fixture();
  const before = storageTree(f.workspace), foreignBefore = storageTree(foreign.workspace);
  const operation = f.lifetime.beginOfflineMaintenance(f.workspace);
  const otherRoot = await RuntimeLifetimeLock.acquire(0), otherOperation = otherRoot.beginOfflineMaintenance(f.workspace);
  let lease: ReturnType<typeof acquireInstallation> | undefined;
  try {
    operation.assertHeld();
    assert.deepEqual(storageTree(f.workspace), before);
    assert.throws(() => f.lifetime.beginOfflineMaintenance(f.workspace), /offline-maintenance-busy/u);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime), /offline-maintenance-unissued/u);
    assert.throws(() => acquireInstallation(f.workspace, "shared", f.lifetime), /offline-maintenance-unissued/u);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime, { offlineOperation: { ...operation } }), /offline-maintenance-unissued/u);
    assert.throws(() => acquireInstallation(foreign.workspace, "exclusive", foreign.lifetime, { offlineOperation: operation }), /offline-maintenance-unissued/u);
    assert.deepEqual(storageTree(f.workspace), before);
    assert.deepEqual(storageTree(foreign.workspace), foreignBefore);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime, { offlineOperation: otherOperation }), /offline-maintenance-unissued/u);
    assert.deepEqual(storageTree(f.workspace), before);
    lease = acquireInstallation(f.workspace, "exclusive", f.lifetime, { offlineOperation: operation });
    assert.equal(lease.offlineMaintenanceOperation(), operation);
    lease.assertOfflineMaintenance(operation);
    operation.consume();
    assert.throws(() => operation.consume(), /offline-maintenance-already-consumed/u);
    assert.throws(() => lease?.release(), /offline-maintenance-busy/u);
    await assertRuntimeLifetimeHeld(f.lifetime);
  } finally { otherOperation.release(); await otherRoot.close(); operation.release(); lease?.release(); await f.lifetime.close(); await foreign.lifetime.close(); }
  assert.throws(() => operation.assertHeld(), /offline-maintenance-unissued/u);
  const successor = await RuntimeLifetimeLock.acquire(f.lifetime.port);
  try {
    const unchanged = storageTree(f.workspace);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", successor, { offlineOperation: operation }), /offline-maintenance-unissued/u);
    assert.deepEqual(storageTree(f.workspace), unchanged);
    const next = successor.beginOfflineMaintenance(f.workspace);
    try {
      const admitted = acquireInstallation(f.workspace, "exclusive", successor, { offlineOperation: next });
      next.release(); admitted.release();
    } finally { next.release(); }
  } finally { await successor.close(); }
});
