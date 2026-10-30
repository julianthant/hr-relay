import { spawn, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import assert from "node:assert/strict";
import { onTestFinished } from "vitest";
import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";

export async function runtimeLifetimeLock(): Promise<RuntimeLifetimeLock> {
  const lock = await RuntimeLifetimeLock.acquire(0);
  onTestFinished(() => lock.close());
  return lock;
}

export async function assertRuntimeLifetimeHeld(lock:RuntimeLifetimeLock):Promise<void>{
  lock.assertHeld();
  await assert.rejects(async()=>{
    const competing=await RuntimeLifetimeLock.acquire(lock.port);
    try{assert.fail("retained controller must exclude another kernel listener");}
    finally{await competing.close();}
  },RuntimeAlreadyRunningError);
}

export async function runInheritedRuntimeChild(lock: RuntimeLifetimeLock, code: string, args: readonly string[], options: Pick<SpawnOptions, "cwd" | "env" | "timeout"> = {}) {
  lock.assertHeld();
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, String(lock.port), ...args],
    { cwd: process.cwd(), ...options, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  assert.ok(child.stdout && child.stderr);
  const output: Buffer[] = [], errors: Buffer[] = [];
  let outputBytes = 0, errorBytes = 0, overflow: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes <= 1_048_576) output.push(chunk);
    else { overflow ??= new Error("inherited fixture stdout exceeds its bound"); child.kill("SIGKILL"); }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errorBytes += chunk.length;
    if (errorBytes <= 1_048_576) errors.push(chunk);
    else { overflow ??= new Error("inherited fixture stderr exceeds its bound"); child.kill("SIGKILL"); }
  });
  const closed = once(child, "close");
  try {
    await lock.share(child);
    const [status, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await closed);
    if (overflow !== undefined) throw overflow;
    return { status, signal, stdout: Buffer.concat(output).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await closed; }
    catch (cleanup) { throw new AggregateError([error, cleanup], "inherited fixture and owned child closure failed", { cause: cleanup }); }
    throw error;
  }
}
