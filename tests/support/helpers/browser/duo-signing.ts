import { runInNewContext } from "node:vm";
import type { Worker } from "playwright";
import type { DuoSigningSource } from "../../../../src/backend/storage/configuration/duo-signing.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";

export function fixtureDuoSigningSource(overrides: Partial<DuoSigningSource> = {}): DuoSigningSource {
  return { assertCurrent() {}, identity: () => FingerprintSchema.parse("d".repeat(64)), credentials: () => [],
    async sign() { throw new Error("unexpected synthetic signing"); }, ...overrides };
}

export function fixtureWorkflowWorker() {
  const installed: unknown[][] = [];
  let waiter: ((value: unknown) => void) | undefined;
  const requests: unknown[] = [];
  const owner = {
    install(...args: unknown[]) { installed.push(args); },
    next() { if (requests.length) return Promise.resolve(requests.shift()); return new Promise(resolve => { waiter = resolve; }); },
    assertContext(_id?: string) {}, reply(_id: string, _result: unknown) {},
    stop() { waiter?.(null); waiter = undefined; },
  };
  const worker = { url: () => `chrome-extension://${"a".repeat(32)}/src/workflow-background.js`,
    evaluate: (callback: (value: unknown) => unknown, value: unknown) => Promise.resolve(runInNewContext(`(${callback.toString()})(value)`, { value, relayWorkflow: owner })),
  } as unknown as Worker;
  return { worker, installed, owner,
    request(value: unknown) { if (waiter) { const resolve = waiter; waiter = undefined; resolve(value); } else requests.push(value); } };
}
