import { onTestFinished } from "vitest";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";

export async function runtimeLifetimeLock(): Promise<RuntimeLifetimeLock> {
  const lock = await RuntimeLifetimeLock.acquire(0);
  onTestFinished(() => lock.close());
  return lock;
}
