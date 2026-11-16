import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireRuntimeLifetimeLock, RuntimeAlreadyRunningError } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { testProcessImport } from "../../../support/compiled-process.js";

const ReadySchema = z.strictObject({
  kind: z.literal("held"),
  port: z.number().int().positive(),
  workerPid: z.number().int().positive(),
});

function killOwned(pid: number | undefined): void {
  if (pid === undefined) return;
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function heldChild() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "relay-handle-proof-")));
  const sentinel = join(directory, "child-exit");
  const path = join(directory, "lifetime.mjs");
  const source = new URL("../../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href;
  await writeFile(path, `
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { acquireRuntimeLifetimeLock, receiveRuntimeLifetimeLock } from ${JSON.stringify(source)};
if (process.argv[2] === 'worker') {
  await receiveRuntimeLifetimeLock(Number(process.argv[3]), () => {});
  process.send({ kind: 'held' });
  const sentinel = ${JSON.stringify(sentinel)};
  const timer = setInterval(() => {
    if (!existsSync(sentinel)) return;
    clearInterval(timer);
    process.exit(1);
  }, 20);
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
  const parent = spawn(process.execPath, ["--import", testProcessImport(), path, "parent"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  parent.stderr?.on("data", chunk => { stderr += String(chunk); });
  let workerPid: number | undefined;
  try {
    const ready = await Promise.race([
      once(parent, "message").then(values => ReadySchema.parse(values[0])),
      once(parent, "exit").then(values => {
        const [code] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(values);
        throw new Error(`handle proof fixture exited ${String(code)}: ${stderr}`);
      }),
    ]);
    workerPid = ready.workerPid;
    return { parent, sentinel, ...ready, async close() {
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

// Windows has no SIGSTOP, so the child stays up until a sentinel file and then process.exit without close().
it("keeps the inherited port until the child exits without closing its listener", async () => {
  const world = await heldChild();
  try {
    await assert.rejects(acquireRuntimeLifetimeLock(world.port), RuntimeAlreadyRunningError);
    await stop(world.parent);
    assert.equal(alive(world.workerPid), true);
    await assert.rejects(acquireRuntimeLifetimeLock(world.port), RuntimeAlreadyRunningError);
    await writeFile(world.sentinel, "exit", { mode: 0o600 });
    await vi.waitFor(() => { assert.equal(alive(world.workerPid), false); });
    await vi.waitFor(async () => {
      const successor = await acquireRuntimeLifetimeLock(world.port);
      await successor.close();
    });
  } finally { await world.close(); }
});
