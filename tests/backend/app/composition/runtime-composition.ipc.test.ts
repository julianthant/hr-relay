import assert from "node:assert/strict";
import { it } from "vitest";
import { startRebuildRuntime } from "../../../../src/backend/app/composition/runtime-composition.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

it("accepts only the exact parent stop message and retains ownership across an awaited drain", async () => {
  const listenersBefore = process.listenerCount("message");
  const existingListeners = process.listeners("message");
  let finish: (() => void) | undefined;
  const drained = new Promise<void>(resolve => { finish = resolve; });
  let stops = 0;
  let settled = false;
  const runtime = startRebuildRuntime({
    isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
    dashboard: async () => ({ port: 3938, stop: () => { stops++; return drained; } }),
    dashboardReady: () => undefined,
  });
  const observed = runtime.then(() => { settled = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(process.listenerCount("message"), listenersBefore + 1);
    const handlers = process.listeners("message").filter(listener => !existingListeners.includes(listener));
    for (const invalid of [null, {}, { type: "stop" }, { type: "relay-dashboard-stop", extra: true }]) {
      for (const handler of handlers) handler(invalid, undefined);
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(stops, 0);
    process.emit("message", { type: "relay-dashboard-stop" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(stops, 1);
    assert.equal(settled, false);
    process.emit("message", { type: "relay-dashboard-stop" });
    assert.equal(process.listenerCount("message"), listenersBefore + 1);
    assert.equal(stops, 1);
    finish?.();
    await observed;
    assert.equal(process.listenerCount("message"), listenersBefore);
  } finally {
    process.emit("SIGTERM");
    finish?.();
    await observed;
  }
});
