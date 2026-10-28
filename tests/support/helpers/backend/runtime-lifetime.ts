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
