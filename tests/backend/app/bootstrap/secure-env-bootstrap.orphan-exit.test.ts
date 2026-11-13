import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { runSecureEnvironmentBootstrap, WORKER_ORPHAN_EXIT_MS } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { WorkerPoolError } from "../../../../src/backend/runtime/workers/worker-pool.js";

const originalArgv = [...process.argv];
afterEach(() => { vi.useRealTimers(); process.argv.splice(0, process.argv.length, ...originalArgv); });

it("stops an orphaned worker's run on parent disconnect and exits it after WORKER_ORPHAN_EXIT_MS", async () => {
  vi.useFakeTimers();
  let disconnect: (() => void) | undefined, signal: AbortSignal | undefined;
  const exits: number[] = [];
  void runSecureEnvironmentBootstrap(["cli", "worker"], {
    installCrashHandlers: () => undefined,
    receiveLifetimeLock: async (port, onDisconnect) => {
      assert.equal(port, rebuildRuntimeIsolation.lockPort);
      disconnect = onDisconnect;
      return {} as WorkerRuntimeLifetimeLock;
    },
    acquireAdmission: () => ({ release: () => undefined }) as unknown as RuntimeAdmission,
    assertEnvironment: () => undefined,
    // A run that never settles: only the orphan timer ends this process.
    runCli: async (_admission, _accept, lifetime) => { signal = lifetime.parentSignal; await new Promise(() => undefined); },
    exit: (code): never => { exits.push(code); return undefined as never; },
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.ok(disconnect !== undefined && signal !== undefined);
  assert.equal(signal.aborted, false);
  disconnect();
  assert.equal(signal.aborted, true);
  assert.match(String((signal.reason as Error).message), /runtime-parent-disconnected/u);
  await vi.advanceTimersByTimeAsync(WORKER_ORPHAN_EXIT_MS - 1);
  assert.deepEqual(exits, []);
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual(exits, [1]);
});

it.each(["WORKER_EXIT_UNOBSERVED", "WORKER_EXIT_SETTLEMENT_FAILED"] as const)("exits the root non-zero with its survivors after %s", async code => {
  const abandoned: unknown[] = [], exits: number[] = [];
  const failure = new AggregateError([new WorkerPoolError(code)], "shutdown failed");
  const lock = { assertHeld: () => undefined, close: async () => undefined,
    abandonUnexitedChildren: async (cause: unknown) => { abandoned.push(cause); return [4242]; } } as unknown as RuntimeLifetimeLock;
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await runSecureEnvironmentBootstrap(["cli", "worker-pool-fixture"], {
      acquireLifetimeLock: async () => lock,
      acquireAdmission: () => ({ release: () => undefined }) as unknown as RuntimeAdmission,
      assertEnvironment: () => undefined,
      runCli: async () => { throw failure; },
      exit: (status): never => { exits.push(status); return undefined as never; },
    });
    assert.deepEqual(exits, [1]);
    assert.deepEqual(abandoned, [failure]);
    assert.ok(stderr.mock.calls.some(([line]) => String(line) === `${JSON.stringify({ code: "WORKER_EXIT_UNOBSERVED", survivors: [4242] })}\n`));
  } finally { stderr.mockRestore(); }
});
