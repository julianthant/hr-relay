import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { startRebuildRuntime } from "../../../../src/backend/app/runtime-composition.js";
import { rebuildRuntimeIsolation } from "../../../../src/config/runtime-isolation.js";

describe("dashboard readiness publication", () => {
  it("publishes only after composition and shutdown subscription, so immediate frontend failure drains", async () => {
    const events: string[] = [];
    let shutdown: (() => void) | undefined;
    await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      dashboard: async () => { events.push("listening"); return { port: 3938, stop: async () => { events.push("stopped"); } }; },
      signals: { subscribe: handler => {
        events.push("subscribed"); shutdown = () => handler("SIGTERM");
        return () => { events.push("disposed"); };
      } },
      dashboardReady: () => { events.push("ready"); assert.ok(shutdown); shutdown(); },
    });
    assert.deepEqual(events, ["listening", "subscribed", "ready", "stopped", "disposed"]);
  });

  it("never announces readiness after failed composition", async () => {
    let published = false;
    await assert.rejects(startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"],
      dashboard: async () => { throw new Error("bind refused"); },
      dashboardReady: () => { published = true; },
    }), /bind refused/u);
    assert.equal(published, false);
  });

  it("drains and disposes listeners when readiness publication throws", async () => {
    let stopped = false; let disposed = false;
    await assert.rejects(startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      dashboard: async () => ({ port: 3938, stop: async () => { stopped = true; } }),
      signals: { subscribe: () => () => { disposed = true; } },
      dashboardReady: () => { throw new Error("IPC refused"); },
    }), /IPC refused/u);
    assert.equal(stopped, true); assert.equal(disposed, true);
  });
});
