import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { assertRuntimeLifetimeHeld } from "../../../support/helpers/backend/runtime-lifetime.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const { fixture, adoptSynthetic, cleanup } = createInstallationControlTestWorld();
afterEach(cleanup);

it("pins the exact exclusive lease and root across deferred owned IO, then permits replacement only after completion", async () => {
  const f = await fixture(), lease = adoptSynthetic(f.workspace, f.pair, f.lifetime);
  const operation = lease.beginOfflineMaintenance();
  const file = await open(join(f.workspace, "owned-offline-io"), "wx", 0o600);
  const child = spawn(process.execPath, ["-e", "process.once('message',()=>process.disconnect());process.send('ready')"],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const closed = once(child, "close");
  let finish: () => void = () => { throw new Error("fixture-IO-not-issued"); };
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const io = (async () => { await gate; operation.assertHeld(); await file.writeFile("settled"); await file.close(); })();
  let primary: { error: unknown } | undefined;
  try {
    assert.deepEqual((await once(child, "message"))[0], "ready");
    const before = storageTree(f.workspace), send = vi.spyOn(child, "send");
    try {
      assert.throws(() => lease.beginOfflineMaintenance(), /offline-maintenance-busy/u);
      assert.throws(() => lease.release(), /offline-maintenance-busy/u);
      assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime), /lease busy/u);
      assert.throws(() => f.lifetime.share(child), /exclusive-lease-held/u);
      assert.equal(send.mock.calls.length, 0);
      lease.assertOfflineMaintenance(operation);
      assert.throws(() => lease.assertOfflineMaintenance({ ...operation }), /offline-maintenance-unissued/u);
      assert.deepEqual(storageTree(f.workspace), before);
    } finally { send.mockRestore(); }
    let rootClosed = false;
    const closing = f.lifetime.close().then(() => { rootClosed = true; });
    await Promise.resolve();
    assert.equal(rootClosed, false);
    assert.throws(() => acquireInstallation(f.workspace, "shared", f.lifetime), /runtime-lifetime-closing/u);
    assert.throws(() => lease.beginOfflineMaintenance(), /offline-maintenance-busy/u);
    await assertRuntimeLifetimeHeld(f.lifetime);
    finish(); await io;
    operation.release();
    assert.throws(() => operation.assertHeld(), /offline-maintenance-unissued/u);
    lease.release();
    await closing;
    assert.equal(rootClosed, true);
    const successor = await RuntimeLifetimeLock.acquire(f.lifetime.port);
    try {
      const next = acquireInstallation(f.workspace, "exclusive", successor);
      try { next.assertHeld(); } finally { next.release(); }
    } finally { await successor.close(); }
  } catch (error) { primary = { error }; }
  const failures: unknown[] = [];
  for (const close of [async () => { finish(); await io; }, () => file.close(), () => operation.release(), () => lease.release(),
    async () => { if (child.connected) child.send("close"); assert.deepEqual(await closed, [0, null]); }, () => f.lifetime.close()]) {
    try { await Promise.resolve(close()); } catch (error) { failures.push(error); }
  }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "offline IO and owned cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "offline IO cleanup failed", { cause: failures[0] });
});

it("retains the lease and root after an unproved owned close until that actual resource closes", async () => {
  const f = await fixture(), lease = adoptSynthetic(f.workspace, f.pair, f.lifetime);
  const operation = lease.beginOfflineMaintenance(), file = await open(join(f.workspace, "owned-offline-close"), "wx", 0o600);
  const unproved = new Error("fixture-owned-close-unproved"), close = vi.spyOn(file, "close").mockRejectedValueOnce(unproved);
  let primary: { error: unknown } | undefined;
  try {
    await assert.rejects(file.close(), error => error === unproved);
    assert.equal((await file.stat()).isFile(), true);
    assert.throws(() => lease.release(), /offline-maintenance-busy/u);
    assert.throws(() => acquireInstallation(f.workspace, "exclusive", f.lifetime), /lease busy/u);
    let rootClosed = false;
    const closing = f.lifetime.close().then(() => { rootClosed = true; });
    await Promise.resolve();
    assert.equal(rootClosed, false);
    await assertRuntimeLifetimeHeld(f.lifetime);
    lease.assertOfflineMaintenance(operation);
    close.mockRestore(); await file.close();
    operation.release(); lease.release(); await closing;
    assert.equal(rootClosed, true);
  } catch (error) { primary = { error }; }
  close.mockRestore();
  const failures: unknown[] = [];
  for (const cleanup of [() => file.close(), () => operation.release(), () => lease.release(), () => f.lifetime.close()]) {
    try { await Promise.resolve(cleanup()); } catch (error) { failures.push(error); }
  }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "unproved close and owned cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "owned close cleanup failed", { cause: failures[0] });
});
