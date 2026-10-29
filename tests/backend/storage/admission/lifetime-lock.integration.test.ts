import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { createAdmissionChildFixtures } from "../../../support/helpers/storage/admission-child-fixtures.js";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { access, lstat, mkdtemp, realpath, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { it, vi } from "vitest";
import { acquireRuntimeLifetimeLock, RuntimeAlreadyRunningError, RuntimeLifetimeLock, RuntimeLifetimeLockReleasedError, WorkerRuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { runOfflineAuthorityRestoreRecovery } from "../../../../src/backend/app/composition/storage-compose.js";
import { runOfflineStorageRelocation } from "../../../../src/backend/app/composition/storage/relocate.js";
import { runOfflineQueuedRunCancellation } from "../../../../src/backend/storage/maintenance/cancel-queued-runs.js";

const ReadySchema = z.strictObject({ kind: z.literal("held"), port: z.number().int().positive(), workerPid: z.number().int().positive() });

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "relay-lifetime-")));
  const path = join(directory, "lifetime.mjs");
  const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
  await writeFile(path, `
import { spawn } from 'node:child_process';
import { acquireRuntimeLifetimeLock, receiveRuntimeLifetimeLock, RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from ${JSON.stringify(source)};
if (process.argv[2] === 'worker') {
  const lock = await receiveRuntimeLifetimeLock(Number(process.argv[3]), () => {
    void lock.close().then(() => process.exit(0));
  });
  if (lock instanceof RuntimeLifetimeLock || !(lock instanceof WorkerRuntimeLifetimeLock)) throw new Error('worker lock type is not distinct');
  process.send({ kind: 'held' });
} else {
  const lock = await acquireRuntimeLifetimeLock(0);
  lock.initializeWorkspace(${JSON.stringify(directory)}, () => {});
  const port = lock.port;
  const child = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'worker', String(port)], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('error', error => { throw error; });
  child.on('message', () => process.send({ kind: 'held', port, workerPid: child.pid }));
  await lock.share(child);
}
`);
  const parent = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path, "parent"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  parent.stderr?.on("data", chunk => { stderr += String(chunk); });
  let workerPid: number | undefined;
  try {
    const ready = await Promise.race([
      once(parent, "message").then(values => ReadySchema.parse(values[0])),
      once(parent, "exit").then(values => { const [code] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(values); throw new Error(`lifetime fixture exited ${String(code)}: ${stderr}`); }),
    ]);
    workerPid = ready.workerPid;
    return { parent, ...ready, async close() {
      killOwned(workerPid);
      await stop(parent);
      await rm(directory, { recursive: true });
    } };
  } catch (error) {
    killOwned(workerPid);
    await stop(parent);
    await rm(directory, { recursive: true });
    throw error;
  }
}

function killOwned(pid: number | undefined): void {
  if (pid === undefined) return;
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error; }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

it("refuses workers without a parent IPC channel before storage admission", async () => {
  const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
  await promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const { receiveRuntimeLifetimeLock } = await import(${JSON.stringify(source)});
    await assert.rejects(receiveRuntimeLifetimeLock(12345, () => assert.fail('no parent exists')), /runtime-parent-channel-required/);
  `]);
});

it("retains exclusion after parent SIGKILL while its child is blocked, then permits rapid restarts", async () => {
  const world = await fixture();
  try {
    await assert.rejects(acquireRuntimeLifetimeLock(world.port), RuntimeAlreadyRunningError);
    process.kill(world.workerPid, "SIGSTOP");
    await stop(world.parent);
    await assert.rejects(acquireRuntimeLifetimeLock(world.port), RuntimeAlreadyRunningError);
    killOwned(world.workerPid);
    await vi.waitFor(async () => {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      await successor.close();
    });
    for (let index = 0; index < 3; index += 1) {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      await successor.close();
    }
  } finally { await world.close(); }
});

it("lets a cooperative worker close its shared handle on parent disconnect", async () => {
  const world = await fixture();
  try {
    await stop(world.parent);
    await vi.waitFor(async () => {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      await successor.close();
    });
  } finally { await world.close(); }
});

it("uses the configured singleton port for production parents and refuses busy roots before admission", async () => {
  const lock = await acquireRuntimeLifetimeLock(0);
  assert.ok(lock instanceof RuntimeLifetimeLock);
  try {
    const config = z.object({ rebuild: z.object({ lockPort: z.number().int().positive() }) }).parse(JSON.parse(
      await readFile(new URL("../../../../config/runtime-isolation.json", import.meta.url), "utf8")));
    for (const args of [["cli", "dashboard"], ["cli", "dashboard", "--prod"], ["cli", "storage", "backup"],
      ["cli", "storage", "restore"], ["cli", "storage", "recover-restore"], ["cli", "storage", "relocate"],
      ["cli", "storage", "cancel-queued-runs"], ["test-target-document-number"]]) {
      await assert.rejects(runSecureEnvironmentBootstrap(args, {
        acquireLifetimeLock: port => { assert.equal(port, config.rebuild.lockPort); return acquireRuntimeLifetimeLock(lock.port); },
        validateDashboardBundle: () => {},
        acquireAdmission: () => assert.fail("busy lifetime reached storage admission"),
      }), RuntimeAlreadyRunningError);
    }
    const bootstrap = await readFile(new URL("../../../../src/backend/app/bootstrap/secure-env-bootstrap.ts", import.meta.url), "utf8");
    assert.match(bootstrap, /receiveRuntimeLifetimeLock\(rebuildRuntimeIsolation\.lockPort,/u);
    const verification = await readFile(new URL("../../../../scripts/verify/browser-login.ts", import.meta.url), "utf8");
    assert.match(verification, /acquireRuntimeLifetimeLock\(rebuildRuntimeIsolation\.lockPort\)/u);
  } finally {
    await lock.close();
  }
});

it("validates the production bundle before acquiring the lifetime listener", async () => {
  await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard", "--prod"], {
    validateDashboardBundle: () => { throw new Error("invalid-bundle-fixture"); },
    acquireLifetimeLock: () => assert.fail("invalid bundle acquired lifetime listener"),
    acquireAdmission: () => assert.fail("invalid bundle reached storage admission"),
  }), /invalid-bundle-fixture/);
});

it("keeps machine publication with the controller and creates no PID lease or admission mutex", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "relay-machine-control-")));
  const lock = await RuntimeLifetimeLock.acquire(0);
  let controller: RuntimeAdmission | undefined;
  let worker: ChildProcess | undefined;
  let closed: Promise<unknown[]> | undefined;
  let primary: { error: unknown } | undefined;
  try {
    controller = acquireEntrypointAdmission(directory, "exclusive", lock);
    assert.deepEqual(controller.readProfileRegistry().profiles, []);
    controller.release(); controller = undefined;
    const lockSource = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
    const admissionSource = new URL("../../../../src/backend/storage/admission/admission.ts", import.meta.url).href;
    worker = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(lockSource)};
      import { RuntimeAdmission } from ${JSON.stringify(admissionSource)};
      const lock = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
      const worker = RuntimeAdmission.acquireWorker(process.argv[2], lock);
      assert.deepEqual(worker.readProfileRegistry().profiles, []);
      assert.throws(() => worker.publishProfileOperation("00000000-0000-4000-8000-000000000001"), /worker-machine-control-read-only/);
      process.send({ kind: "verified", profiles: 0, publication: "refused" });
      worker.release(); await lock.close(); process.disconnect();
    `, String(lock.port), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    worker.stderr?.resume();
    closed = once(worker, "close");
    const verified = once(worker, "message");
    await lock.share(worker);
    assert.deepEqual((await verified)[0], { kind: "verified", profiles: 0, publication: "refused" });
    assert.deepEqual(await closed, [0, null]);
    for (const name of ["admission-mutex", "leases", ".installation-mutation.lock"]) {
      await assert.rejects(access(join(directory, ".tracker", "control", name)), { code: "ENOENT" });
    }
  } catch (error) { primary = { error }; }
  const failures: unknown[] = [];
  if (worker !== undefined && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
  if (closed !== undefined) { try { await closed; } catch (error) { failures.push(error); } }
  if (failures.length === 0) {
    try { controller?.release(); await lock.close(); await rm(directory, { recursive: true }); }
    catch (error) { failures.push(error); }
  }
  if (failures.length !== 0) throw new AggregateError(primary === undefined ? failures : [primary.error, ...failures],
    "machine publication fixture ownership closure unproved", { cause: primary?.error ?? failures[0] });
  if (primary !== undefined) throw primary.error;
});

it("revokes controller authority as soon as close starts and keeps repeated close idempotent", async () => {
  const lock = await acquireRuntimeLifetimeLock(0);
  assert.ok(lock instanceof RuntimeLifetimeLock);
  assert.ok(!(lock instanceof WorkerRuntimeLifetimeLock));
  lock.assertHeld();
  const closing = lock.close();
  assert.throws(() => lock.assertHeld(), RuntimeLifetimeLockReleasedError);
  assert.equal(lock.close(), closing);
  await closing;
  assert.throws(() => lock.assertHeld(), RuntimeLifetimeLockReleasedError);
});

it("refuses handle sharing during exclusive admission and exclusive admission until owned child close", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "relay-exclusive-transfer-")));
  const lock = await RuntimeLifetimeLock.acquire(0);
  let admission: RuntimeAdmission | undefined;
  let child: ChildProcess | undefined;
  let closed: Promise<unknown[]> | undefined;
  let primary: { error: unknown } | undefined;
  try {
    admission = acquireEntrypointAdmission(directory, "exclusive", lock);
    const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
    const admissionSource = new URL("../../../../src/backend/storage/admission/admission.ts", import.meta.url).href;
    child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(source)};
      import { RuntimeAdmission } from ${JSON.stringify(admissionSource)};
      process.send({ kind: "waiting" });
      const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
      const admission = RuntimeAdmission.acquireWorker(process.argv[2], lifetime);
      const document = admission.readProfileRegistry();
      process.on("message", async input => {
        if (input !== "close") throw new Error("unexpected fixture command");
        admission.release(); await lifetime.close(); process.disconnect();
      });
      process.send({ kind: "admitted", profiles: document.profiles.length });
    `, String(lock.port), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    child.stderr?.resume();
    closed = once(child, "close");
    const waiting = once(child, "message");
    assert.deepEqual((await waiting)[0], { kind: "waiting" });
    const paths = (await readdir(directory, { recursive: true })).sort();
    const authorityPaths = [".tracker/control/installation.json", ".tracker/control/locator.json", ".tracker/control/profile-registry.json",
      ".tracker/data/machine/profiles.json", ".tracker/data/machine/profile-verifiers.json", ".tracker/data/machine/profile-pepper"];
    const before = await Promise.all(authorityPaths.map(path => readFile(join(directory, path))));
    const ownedChild = child;
    const send = vi.spyOn(ownedChild, "send");
    try {
      assert.throws(() => lock.share(ownedChild), /runtime-lifetime-exclusive-lease-held/u);
      assert.equal(send.mock.calls.length, 0);
    } finally { send.mockRestore(); }
    admission.assertLive();
    assert.deepEqual(await Promise.all(authorityPaths.map(path => readFile(join(directory, path)))), before);
    assert.deepEqual((await readdir(directory, { recursive: true })).sort(), paths);
    admission.release(); admission = undefined;
    const admitted = once(child, "message");
    await lock.share(child);
    assert.deepEqual((await admitted)[0], { kind: "admitted", profiles: 0 });
    assert.throws(() => { admission = acquireEntrypointAdmission(directory, "exclusive", lock); }, /runtime-lifetime-owned-children-unclosed/u);
    assert.deepEqual(await Promise.all(authorityPaths.map(path => readFile(join(directory, path)))), before);
    assert.deepEqual((await readdir(directory, { recursive: true })).sort(), paths);
    child.send("close");
    assert.deepEqual(await closed, [0, null]);
    admission = acquireEntrypointAdmission(directory, "exclusive", lock);
    admission.assertLive(); admission.release(); admission = undefined;
  } catch (error) { primary = { error }; }
  const failures: unknown[] = [];
  if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (closed !== undefined) {
    try { await closed; }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 0) {
    try { admission?.release(); await lock.close(); await rm(directory, { recursive: true }); }
    catch (error) { failures.push(error); }
  }
  if (failures.length !== 0) throw new AggregateError(primary === undefined ? failures : [primary.error, ...failures],
    "exclusive transfer fixture ownership closure unproved", { cause: primary?.error ?? failures[0] });
  if (primary !== undefined) throw primary.error;
});

it("admits exactly one of sixteen kernel singleton contenders and retains it through actual release", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "runtime-kernel-contention-")));
  const reservation = await RuntimeLifetimeLock.acquire(0), port = reservation.port;
  await reservation.close();
  const children: ChildProcess[] = [];
  const { launch } = createAdmissionChildFixtures(children);
  const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
  const code = `
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from ${JSON.stringify(source)};
    const root = process.argv[1], wait = new Int32Array(new SharedArrayBuffer(4));
    process.send({ state: "contender-ready" });
    while (!existsSync(join(root, "publish-contenders"))) Atomics.wait(wait, 0, 0, 10);
    try {
      const lock = await RuntimeLifetimeLock.acquire(${String(port)});
      process.once("message", () => {
        void lock.close().then(() => { process.send({ state: "released" }); process.disconnect(); })
          .catch(error => { setImmediate(() => { throw error; }); });
      });
      process.send({ state: "held", detail: String(lock.port) });
    } catch (error) {
      if (!(error instanceof RuntimeAlreadyRunningError)) throw error;
      process.send({ state: "refused", detail: error.code }); process.disconnect();
    }
  `;
  const contenders = Array.from({ length: 16 }, () => {
    const actor = launch(code, directory);
    return { ...actor, closed: once(actor.child, "close") };
  });
  let primary: { error: unknown } | undefined;
  try {
    assert.deepEqual((await Promise.all(contenders.map(actor => actor.next()))).map(value => value.state), Array.from({ length: 16 }, () => "contender-ready"));
    await writeFile(join(directory, "publish-contenders"), "publish", { mode: 0o600, flag: "wx" });
    const results = await Promise.all(contenders.map(actor => actor.next()));
    const winnerIndex = results.findIndex(value => value.state === "held"), winner = contenders[winnerIndex];
    assert.ok(winner);
    assert.equal(results.filter(value => value.state === "held").length, 1);
    assert.equal(results.filter(value => value.state === "refused").length, 15);
    assert.equal(results[winnerIndex]?.detail, String(port));
    assert.deepEqual(results.filter(value => value.state === "refused").map(value => value.detail), Array.from({ length: 15 }, () => "RUNTIME_ALREADY_RUNNING"));
    await assert.rejects(RuntimeLifetimeLock.acquire(port), RuntimeAlreadyRunningError);
    winner.child.send("release"); assert.equal((await winner.next()).state, "released");
    for (const actor of contenders) assert.deepEqual(await actor.closed, [0, null]);
    const successor = await RuntimeLifetimeLock.acquire(port);
    await successor.close();
  } catch (error) { primary = { error }; }
  for (const actor of contenders) if (actor.child.exitCode === null && actor.child.signalCode === null) actor.child.kill("SIGKILL");
  const outcomes = await Promise.allSettled(contenders.map(actor => actor.closed));
  const failures = outcomes.flatMap(result => {
    if (result.status !== "rejected") return [];
    const failure: unknown = result.reason;
    return [failure];
  });
  if (failures.length !== 0) throw new AggregateError(primary === undefined ? failures : [primary.error, ...failures],
    "kernel contention fixture closure unproved", { cause: primary?.error ?? failures[0] });
  await rm(directory, { recursive: true });
  if (primary !== undefined) throw primary.error;
}, 30_000);

for (const prior of ["valid", "malformed"] as const) it(`clears only authenticated ${prior} fixed locks during one root startup`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "runtime-fixed-lock-startup-")));
  const initial = await RuntimeLifetimeLock.acquire(0), port = initial.port;
  let successor: RuntimeLifetimeLock | undefined, admission: RuntimeAdmission | undefined;
  try {
    admission = acquireEntrypointAdmission(directory, "exclusive", initial);
    const machineRoot = admission.stateRoot;
    admission.release(); admission = undefined;
    const paths = [join(directory, ".tracker", "control", ".installation-mutation.lock"),
      join(machineRoot, "machine", ".profile-ops.lock"), join(machineRoot, "machine", ".profile-registry.lock")];
    const nonce = "10000000-0000-4000-8000-000000000001";
    const bytes = paths.map((_path, index) => JSON.stringify(prior === "malformed" && index === 1 ? { nonce, unknown: true } : { nonce }));
    for (const [index, path] of paths.entries()) {
      const value = bytes[index]; assert.ok(value);
      await writeFile(path, value, { mode: 0o600, flag: "wx" });
    }
    await initial.close();
    successor = await RuntimeLifetimeLock.acquire(port);
    const held = successor;

    if (prior === "malformed") {
      assert.throws(() => acquireEntrypointAdmission(directory, "shared", held));
      assert.deepEqual(await Promise.all(paths.map(path => readFile(path, "utf8"))), bytes);
    } else {
      admission = acquireEntrypointAdmission(directory, "shared", held);
      assert.equal(admission.readProfileRegistry().profiles.length, 0);
      for (const path of paths) await assert.rejects(access(path), { code: "ENOENT" });
      const sameLifetimeLock = paths[0]; assert.ok(sameLifetimeLock);
      await writeFile(sameLifetimeLock, JSON.stringify({ nonce }), { mode: 0o600, flag: "wx" });
      let repeatedStartup = false;
      successor.initializeWorkspace(directory, () => { repeatedStartup = true; });
      assert.equal(repeatedStartup, false);
      assert.equal(await readFile(sameLifetimeLock, "utf8"), JSON.stringify({ nonce }));
    }
  } finally { admission?.release(); await successor?.close(); await initial.close(); await rm(directory, { recursive: true }); }
});

for (const capability of ["missing", "released", "foreign-workspace"] as const) it(`refuses ${capability} root capability before creating target authority`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "runtime-unissued-admission-")));
  const foreign = await realpath(await mkdtemp(join(tmpdir(), "runtime-foreign-admission-")));
  const lock = await RuntimeLifetimeLock.acquire(0);
  try {
    if (capability === "foreign-workspace") {
      const admission = acquireEntrypointAdmission(foreign, "exclusive", lock);
      admission.release();
    } else if (capability === "released") await lock.close();
    const before = await readdir(directory, { recursive: true });

    assert.throws(() => Reflect.apply(acquireEntrypointAdmission, undefined,
      [directory, "exclusive", capability === "missing" ? undefined : lock]));

    assert.deepEqual(await readdir(directory, { recursive: true }), before);
    assert.deepEqual(before, []);
    await assert.rejects(access(join(directory, ".tracker")), { code: "ENOENT" });
  } finally { await lock.close(); await rm(directory, { recursive: true }); await rm(foreign, { recursive: true }); }
});

for (const capability of ["foreign-workspace", "retained-child"] as const) it(`refuses ${capability} before effects at every restore writer`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "restore-admission-target-")));
  const foreign = await realpath(await mkdtemp(join(tmpdir(), "restore-admission-foreign-")));
  const lock = await RuntimeLifetimeLock.acquire(0);
  let child: ChildProcess | undefined, closed: Promise<unknown[]> | undefined;
  let primary: { error: unknown } | undefined;
  try {
    const initial = acquireEntrypointAdmission(capability === "foreign-workspace" ? foreign : directory, "exclusive", lock);
    initial.release();
    if (capability === "retained-child") {
      const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
      child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(source)};
        const lock = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
        process.once("message", () => { void lock.close().then(() => process.disconnect()); });
        process.send({ state: "ready" });
      `, String(lock.port)], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      closed = once(child, "close");
      const ready = once(child, "message");
      await lock.share(child);
      assert.deepEqual((await ready)[0], { state: "ready" });
    }
    const snapshot = async () => Promise.all((await readdir(directory, { recursive: true })).sort().map(async name => {
      const path = join(directory, name), info = await lstat(path);
      return { name, device: info.dev, inode: info.ino, mode: info.mode,
        bytes: info.isFile() ? (await readFile(path)).toString("base64") : null };
    }));
    const before = await snapshot();
    const mutations = [vi.spyOn(fs, "mkdirSync"), vi.spyOn(fs, "openSync"), vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "unlinkSync"), vi.spyOn(fs, "renameSync"), vi.spyOn(fs, "linkSync")];
    syncBuiltinESMExports();
    const operationId = "11111111-1111-4111-8111-111111111111";
    const writers: (() => unknown)[] = [
      () => RuntimeAdmission.acquireStoppedMachineControlMaintenance(directory, lock),
      () => runOfflineAuthorityRestoreRecovery(directory, ["--operation", operationId, "--from", join(directory, "backup.json"), "--outcome", "unchanged"], lock),
      () => runOfflineStorageRelocation({ workspace: directory, lifetime: lock, command: { kind: "resume", id: operationId, json: true } }),
      () => runOfflineQueuedRunCancellation(profileBrowserClosure, directory, ["--apply", "--capture", "a".repeat(64)], lock),
    ];
    for (const writer of writers) {
      await assert.rejects(async () => { await writer(); }, capability === "foreign-workspace"
        ? /runtime-lifetime-workspace-unproved/u : /runtime-lifetime-owned-children-unclosed/u);
      for (const mutation of mutations) assert.equal(mutation.mock.calls.some(([path]) => typeof path === "string"
        && (path === directory || path.startsWith(`${directory}/`))), false);
      assert.deepEqual(await snapshot(), before);
    }
  } catch (error) { primary = { error }; }
  vi.restoreAllMocks(); syncBuiltinESMExports();
  const failures: unknown[] = [];
  try {
    if (child !== undefined && closed !== undefined) {
      child.send("close");
      assert.deepEqual(await closed, [0, null]);
    }
    await lock.close();
    await rm(directory, { recursive: true }); await rm(foreign, { recursive: true });
  } catch (error) { failures.push(error); }
  if (failures.length !== 0) throw new AggregateError(primary === undefined ? failures : [primary.error, ...failures],
    "restore admission refusal and owned cleanup failed", { cause: primary?.error ?? failures[0] });
  if (primary !== undefined) throw primary.error;
});
