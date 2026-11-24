import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createGateSourceRuntime, type GateSourcePort } from "../../../../src/backend/runtime/gates/gate-source-runtime.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

type Runtime = Parameters<typeof createGateSourceRuntime>[0];

function runtime(ports: readonly GateSourcePort[]) {
  return createGateSourceRuntime({
    database: {} as Runtime["database"],
    lifecycle: {} as Runtime["lifecycle"],
    descriptors: { resolve: () => undefined },
    ports,
    clock: manualClock(new Date(0)),
  });
}

function port(sourceId: string, subscribe: GateSourcePort["subscribe"]): GateSourcePort {
  return { kind: "external", sourceId, bindCorrelation: () => undefined, subscribe };
}

describe("gate source runtime cleanup", () => {
  it("reports a failed unsubscribe only after every sibling stop has finished", async () => {
    const stopped: string[] = [];
    const refusal = new Error("first unsubscribe refused");
    let releaseSlow: () => void = () => undefined;
    const ports = [
      port("a", () => Promise.resolve(() => Promise.reject(refusal))),
      port("b", () => Promise.resolve(() => new Promise<void>((resolve) => { releaseSlow = () => { stopped.push("b"); resolve(); }; }))),
      port("c", () => Promise.resolve(() => { stopped.push("c"); })),
    ];
    const stop = await runtime(ports).start(new AbortController().signal);
    let settled = false;
    const stopping = stop().finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "stop must wait for the slow sibling before reporting the refusal");
    releaseSlow();
    await assert.rejects(stopping, (error: unknown) => error === refusal);
    assert.deepEqual(stopped.sort(), ["b", "c"]);
  });

  it("keeps every unsubscribe failure together", async () => {
    const first = new Error("a refused"), second = new Error("b refused");
    const stop = await runtime([
      port("a", () => Promise.resolve(() => Promise.reject(first))),
      port("b", () => Promise.resolve(() => { throw second; })),
    ]).start(new AbortController().signal);
    await assert.rejects(stop(), (error: unknown) => error instanceof AggregateError && error.errors.includes(first) && error.errors.includes(second));
  });

  it("reports a partial-startup cleanup failure with the startup failure", async () => {
    const startup = new Error("subscribe refused"), cleanup = new Error("cleanup refused");
    const stopped: string[] = [];
    await assert.rejects(runtime([
      port("a", () => Promise.resolve(() => Promise.reject(cleanup))),
      port("b", () => Promise.resolve(() => { stopped.push("b"); })),
      port("c", () => Promise.reject(startup)),
    ]).start(new AbortController().signal), (error: unknown) => error instanceof AggregateError
      && error.cause === startup && error.errors.includes(startup) && error.errors.includes(cleanup));
    assert.deepEqual(stopped, ["b"]);
  });
});
