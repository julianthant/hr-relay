import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { it, vi } from "vitest";
import { acquireRuntimeLifetimeLock, RuntimeAlreadyRunningError } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

const ReadySchema = z.strictObject({ kind: z.literal("held"), port: z.number().int().positive(), workerPid: z.number().int().positive() });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "relay-lifetime-"));
  const path = join(directory, "lifetime.mjs");
  const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
  await writeFile(path, `
import { spawn } from 'node:child_process';
import { acquireRuntimeLifetimeLock, receiveRuntimeLifetimeLock, shareRuntimeLifetimeLock } from ${JSON.stringify(source)};
if (process.argv[2] === 'worker') {
  const lock = await receiveRuntimeLifetimeLock(Number(process.argv[3]), () => {
    lock.close(() => process.exit(0));
  });
  process.send({ kind: 'held' });
} else {
  const lock = await acquireRuntimeLifetimeLock(0);
  const port = lock.address().port;
  const child = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'worker', String(port)], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('error', error => { throw error; });
  child.on('message', () => process.send({ kind: 'held', port, workerPid: child.pid }));
  await shareRuntimeLifetimeLock(lock, child);
}
`);
  const parent = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path, "parent"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  parent.stderr?.on("data", chunk => { stderr += String(chunk); });
  let workerPid: number | undefined;
  try {
    const [message] = await Promise.race([
      once(parent, "message"),
      once(parent, "exit").then(([code]) => { throw new Error(`lifetime fixture exited ${String(code)}: ${stderr}`); }),
    ]);
    const ready = ReadySchema.parse(message);
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
      const closed = once(successor, "close");
      successor.close();
      await closed;
    });
    for (let index = 0; index < 3; index += 1) {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      const closed = once(successor, "close");
      successor.close();
      await closed;
    }
  } finally { await world.close(); }
});

it("lets a cooperative worker close its shared handle on parent disconnect", async () => {
  const world = await fixture();
  try {
    await stop(world.parent);
    await vi.waitFor(async () => {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      const closed = once(successor, "close");
      successor.close();
      await closed;
    });
  } finally { await world.close(); }
});

it("refuses both dashboard and offline commands before admission when another lifetime holds the port", async () => {
  const lock = await acquireRuntimeLifetimeLock(0);
  const address = lock.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    for (const args of [["cli", "dashboard"], ["cli", "storage", "backup"]]) {
      await assert.rejects(runSecureEnvironmentBootstrap(args, {
        acquireLifetimeLock: () => acquireRuntimeLifetimeLock(address.port),
        acquireAdmission: () => assert.fail("busy lifetime reached storage admission"),
      }), RuntimeAlreadyRunningError);
    }
  } finally {
    const closed = once(lock, "close");
    lock.close();
    await closed;
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
  const directory = await mkdtemp(join(tmpdir(), "relay-machine-control-"));
  let controller: RuntimeAdmission | undefined;
  let worker: RuntimeAdmission | undefined;
  try {
    controller = acquireEntrypointAdmission(directory, "exclusive");
    assert.deepEqual(controller.readProfileRegistry().profiles, []);
    controller.release();
    worker = RuntimeAdmission.acquireWorker(directory);
    assert.deepEqual(worker.readProfileRegistry().profiles, []);
    assert.throws(() => worker?.publishProfileOperation("00000000-0000-4000-8000-000000000001"), /worker-machine-control-read-only/);
    for (const name of ["admission-mutex", "leases"]) {
      await assert.rejects(access(join(directory, ".tracker", "control", name)), { code: "ENOENT" });
    }
  } finally {
    worker?.release();
    controller?.release();
    await rm(directory, { recursive: true });
  }
});
