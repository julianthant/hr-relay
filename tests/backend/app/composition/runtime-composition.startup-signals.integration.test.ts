import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { startRebuildRuntime } from "../../../../src/backend/app/composition/runtime-composition.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

describe("dashboard startup shutdown ownership", () => {
  it("honours a stop requested while the dashboard is composing", async () => {
    const events: string[] = [];
    let signal: (() => void) | undefined;
    await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => { events.push("listening"); },
      signals: { subscribe: handler => { signal = () => handler("SIGINT"); return () => { events.push("disposed"); }; } },
      dashboard: async () => {
        assert.ok(signal, "stop signals must be owned before composition starts");
        signal();
        return { port: 3938, stop: async () => { events.push("stopped"); } };
      },
      dashboardReady: () => { events.push("ready"); },
    });
    assert.deepEqual(events, ["listening", "stopped", "disposed"]);
  });

  it("stops the composed dashboard when its listening write throws", async () => {
    const refusal = new Error("stdout refused");
    const events: string[] = [];
    await assert.rejects(startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => { throw refusal; },
      signals: { subscribe: () => () => { events.push("disposed"); } },
      dashboard: async () => ({ port: 3938, stop: async () => { events.push("stopped"); } }),
      dashboardReady: () => { events.push("ready"); },
    }), (error: unknown) => error === refusal);
    assert.deepEqual(events, ["stopped", "disposed"]);
  });

  it("releases stop signals when composition fails", async () => {
    const refusal = new Error("bind refused");
    let disposed = false;
    await assert.rejects(startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      signals: { subscribe: () => () => { disposed = true; } },
      dashboard: async () => { throw refusal; },
    }), (error: unknown) => error === refusal);
    assert.equal(disposed, true);
  });

  it("starts the drain while readiness publication is still pending", async () => {
    const events: string[] = [];
    let signal: (() => void) | undefined;
    await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => { events.push("listening"); },
      signals: { subscribe: handler => { signal = () => handler("SIGTERM"); return () => { events.push("disposed"); }; } },
      dashboard: async () => ({ port: 3938, stop: async () => { events.push("stopped"); } }),
      dashboardReady: () => { setImmediate(() => signal?.()); return new Promise<void>(() => undefined); },
    });
    assert.deepEqual(events, ["listening", "stopped", "disposed"]);
  });

  it("composes nothing and releases its process listeners when the boot stop was already latched", async () => {
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    let composed = false;
    await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      stopSignal: AbortSignal.abort(new Error("dashboard-stop-requested")),
      dashboard: async () => { composed = true; return { port: 3938, stop: async () => undefined }; },
      dashboardReady: () => undefined,
    });
    assert.equal(composed, false);
    assert.equal(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM"), before);
  });
});
