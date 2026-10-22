import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

async function world() {
  vi.resetModules();
  const locks = await import("../../../../src/backend/storage/sqlite/runtime-process-locks.js");
  const actualObserver = locks.observeProcessIdentity;
  const observer = vi.spyOn(locks, "observeProcessIdentity");
  const { createInstallationControlTestWorld } = await import("../../../support/helpers/backend/installation-control-world.js");
  const fixture = createInstallationControlTestWorld();
  return { locks, actualObserver, observer, fixture };
}

it("reuses only the executing birth witness while checking every own lease row and release", async () => {
  const { locks, observer, fixture } = await world();
  const { workspace, pair } = fixture.fixture();
  const lease = fixture.adoptSynthetic(workspace, pair);
  const leases = join(workspace, ".tracker/control/leases");
  const name = readdirSync(leases)[0]; assert.ok(name);
  const path = join(leases, name);
  const original = readFileSync(path);
  try {
    const calls = observer.mock.calls.filter(([pid]) => pid === process.pid).length;
    for (let index = 0; index < 5; index++) lease.assertHeld();
    assert.equal(observer.mock.calls.filter(([pid]) => pid === process.pid).length, calls);
    const row = z.looseObject({ processIdentity: locks.ProcessStartIdentitySchema }).parse(JSON.parse(original.toString("utf8")));
    writeFileSync(path, JSON.stringify({ ...row,
      processIdentity: { ...row.processIdentity, startToken: "previous-process-birth" } }));
    assert.throws(() => lease.assertHeld(), /installation lease identity changed/u);
    writeFileSync(path, original);
    lease.assertHeld();
    lease.release();
    assert.throws(() => lease.assertHeld(), /installation lease released/u);
  } finally {
    if (existsSync(path)) writeFileSync(path, original);
    lease.release();
    fixture.cleanup();
  }
});

it("invalidates a genuine profile child when its witnessed parent is released", async () => {
  await world();
  const { createBoundProfileFixture } = await import("../../../support/helpers/admission-fixture.js");
  const profile = createBoundProfileFixture();
  try {
    profile.admission.assertProfileRuntime();
    profile.machine.release();
    assert.throws(() => profile.admission.assertLive(), /released/u);
  } finally { profile.close(); }
});

it("refuses an unavailable first self observation without inventing a birth witness", async () => {
  const { observer, fixture } = await world();
  const { workspace, pair } = fixture.fixture();
  observer.mockReturnValue({ state: "gone" });
  try { assert.throws(() => fixture.adoptSynthetic(workspace, pair), /current process identity unavailable/u); }
  finally { fixture.cleanup(); }
});

it("propagates an unknown first self observation", async () => {
  const { observer, fixture } = await world();
  const { workspace, pair } = fixture.fixture();
  const unknown = new Error("process identity observation unavailable");
  observer.mockImplementation(() => { throw unknown; });
  try { assert.throws(() => fixture.adoptSynthetic(workspace, pair), error => error === unknown); }
  finally { fixture.cleanup(); }
});

it("observes peers afresh, rejects unknown custody and distinguishes a reused PID birth", async () => {
  const { locks, actualObserver, observer, fixture } = await world();
  const { workspace, pair } = fixture.fixture();
  fixture.adoptSynthetic(workspace, pair).release();
  const peer = spawn(process.execPath, ["-e", "process.send('ready');process.on('message',()=>process.exit(0));"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const path = join(workspace, ".tracker/control/leases", `${randomUUID()}.json`);
  try {
    await once(peer, "message");
    assert.ok(peer.pid);
    const observed = locks.observeProcessIdentity(peer.pid);
    assert.equal(observed.state, "alive");
    if (observed.state !== "alive") throw new Error("peer identity unavailable");
    const row = { schemaVersion: 1, admissionId: randomUUID(), mode: "exclusive", pid: peer.pid,
      processIdentity: observed.identity };
    writeFileSync(path, JSON.stringify(row), { mode: 0o600 });
    const { acquireInstallation } = await import("../../../../src/backend/storage/admission/installation.js");
    const before = observer.mock.calls.filter(([pid]) => pid === peer.pid).length;
    for (let index = 0; index < 2; index++) {
      assert.throws(() => acquireInstallation(workspace, "shared"), /installation lease busy/u);
    }
    assert.equal(observer.mock.calls.filter(([pid]) => pid === peer.pid).length, before + 2);
    const unknown = new Error("peer identity unavailable");
    observer.mockImplementation(pid => {
      if (pid === peer.pid) throw unknown;
      return actualObserver(pid);
    });
    assert.throws(() => acquireInstallation(workspace, "shared"), error => error === unknown);
    observer.mockRestore();
    writeFileSync(path, JSON.stringify({ ...row,
      processIdentity: { ...row.processIdentity, startToken: "previous-process-birth" } }));
    const admitted = acquireInstallation(workspace, "shared");
    admitted.assertHeld();
    admitted.release();
  } finally {
    try {
      if (existsSync(path)) unlinkSync(path);
      if (peer.exitCode === null && peer.signalCode === null) {
        const exited = once(peer, "exit");
        peer.send("close");
        const [code, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await exited);
        assert.equal(code, 0);
        assert.equal(signal, null);
      }
    } finally { fixture.cleanup(); }
  }
});
