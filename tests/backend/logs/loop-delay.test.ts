import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import { composeLoopDelayMonitor, startLoopDelayMonitor } from "../../../src/backend/logs/loop-delay.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { debugTimelineFixture } from "../../support/helpers/backend/debug-timeline-fixture.js";

const histogram = vi.hoisted(() => ({
  max: 0,
  enable: vi.fn(),
  disable: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: () => histogram }));

describe("dashboard event-loop stalls", () => {
  let monitor: ReturnType<typeof startLoopDelayMonitor> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance", "Date"] });
    histogram.max = 0;
    vi.clearAllMocks();
    histogram.reset.mockImplementation(() => { histogram.max = 0; });
  });

  afterEach(() => {
    monitor?.stop();
    monitor = undefined;
    vi.useRealTimers();
  });

  it("starts the production monitor when the choice is unset", () => {
    const deps = { clock: systemClock, debugEvents: { emit() { return undefined; } } };
    monitor = composeLoopDelayMonitor(undefined, deps);
    expect(histogram.enable).toHaveBeenCalledOnce();
    monitor.stop();
    monitor = undefined;
    histogram.enable.mockClear();
    composeLoopDelayMonitor(false, deps).stop();
    expect(histogram.enable).not.toHaveBeenCalled();
    const injected = { stop: vi.fn() };
    expect(composeLoopDelayMonitor(injected, deps)).toBe(injected);
    expect(histogram.enable).not.toHaveBeenCalled();
    expect(injected.stop).not.toHaveBeenCalled();
  });

  it("records the largest stall over 200 ms through the debug writer", () => {
    const { records, repository } = debugTimelineFixture();
    const debugEvents = createDebugEventWriter({ repository, clock: systemClock, build: "test" });
    monitor = startLoopDelayMonitor({ clock: systemClock, debugEvents });
    histogram.max = 201_000_000;

    vi.advanceTimersByTime(1000);

    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toMatchObject({ kind: "debug", event: {
      category: "boot", area: "event-loop", reason: "event-loop-stall", durationMs: 201,
    } });
  });

  it("records at most one stall in ten seconds using monotonic time", () => {
    const { records, repository } = debugTimelineFixture();
    monitor = startLoopDelayMonitor({ clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) });
    histogram.max = 250_000_000;
    vi.advanceTimersByTime(1000);
    vi.setSystemTime(new Date("2035-01-01T00:00:00.000Z"));
    histogram.max = 600_000_000;
    vi.advanceTimersByTime(9000);
    expect(records).toHaveLength(1);

    histogram.max = 400_000_000;
    vi.advanceTimersByTime(1000);
    expect(records.map(record => record.payload.kind === "debug" ? record.payload.event.durationMs : undefined))
      .toEqual([250, 400]);
  });

  it("keeps empty samples and delays up to 200 ms quiet", () => {
    const { records, repository } = debugTimelineFixture();
    monitor = startLoopDelayMonitor({ clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) });
    for (const nanoseconds of [0, 199_000_000, 200_000_000]) {
      histogram.max = nanoseconds;
      vi.advanceTimersByTime(1000);
    }
    expect(records).toEqual([]);
  });

  it("discards each sampled window and stops sampling on shutdown", () => {
    const { records, repository } = debugTimelineFixture();
    monitor = startLoopDelayMonitor({ clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) });
    histogram.max = 300_000_000;
    vi.advanceTimersByTime(11_000);
    expect(records).toHaveLength(1);

    monitor.stop();
    expect(histogram.disable).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    histogram.max = 500_000_000;
    vi.advanceTimersByTime(20_000);
    expect(records).toHaveLength(1);
  });
});
