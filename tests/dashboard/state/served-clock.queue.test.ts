// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { createServedClock, ServedClockContext, useServedNow } from "../../../src/dashboard/state/served-clock.js";
import { useQueueWiring } from "../../../src/dashboard/state/queue-wiring-adapter.js";
import { QueuePanel } from "../../../src/dashboard/surfaces/queue/queue.js";
import { FIXTURE_DAY, FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../support/fixtures/dashboard/fixture-day.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("ten ticks re-render no queue row while the running rows' elapsed text advances each second", async () => {
  let monotonic = 0;
  const performanceNow = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const rows = FIXTURE_DAY_WIRE.queueSurfaces;
  const running = rows.find(row => row.parent === null && row.status === "running" && row.endedAt.state === "absent");
  assert.ok(running, "the fixture day needs a running top-level row");
  const clock = createServedClock(FIXTURE_NOW);
  let rowRenders = 0;
  const workflowLabelOf = (): string => { rowRenders += 1; return "Workflow"; };
  // Stable props, as the app memoizes them.
  const input: Parameters<typeof useQueueWiring>[0] = { allRows: rows, rows, activeWorkflowId: running.workflowId, filter: ["all"], selectedRunId: undefined,
    openWells: new Set<string>(), now: clock.now, selectRun: () => undefined, openRelatedRun: () => undefined, onWells: () => undefined,
    setBatchGrouping: async () => undefined, runQueueAction: () => undefined };
  let parentRenders = 0;
  function Queue() {
    // The parent ticks as the whole app once did; the rows must still stay put.
    useServedNow(FIXTURE_NOW);
    parentRenders += 1;
    const wiring = useQueueWiring(input);
    return createElement(QueuePanel, { surfaces: wiring.surfaces, state: wiring.viewState, handlers: wiring.queueHandlers,
      actionsOf: wiring.actionsOf, workflowLabelOf, panelLabel: "Workflow", day: FIXTURE_DAY });
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  const footers = (): string => [...host.querySelectorAll("[data-queue-row-footer]")].map(footer => footer.textContent).join("\n");
  const gateNames = (): string => [...host.querySelectorAll("[data-queue-open]")].map(open => open.getAttribute("aria-label")).filter(name => name !== null && /\d+s/.test(name)).join("\n");
  try {
    await act(async () => root.render(createElement(ServedClockContext.Provider, { value: clock }, createElement(Queue))));
    const drawn = rowRenders, parentDrawn = parentRenders;
    assert.ok(drawn > 0);
    const named = [gateNames()];
    assert.notEqual(named[0], "", "the fixture day needs a row whose name carries a gate age");
    const seen = [footers()];
    for (let tick = 0; tick < 10; tick += 1) {
      monotonic += 1000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      seen.push(footers()); named.push(gateNames());
    }
    assert.equal(parentRenders - parentDrawn, 10);
    assert.equal(rowRenders, drawn, "a tick re-rendered a queue row whose data did not change");
    assert.equal(new Set(seen).size, seen.length, "the elapsed text did not advance on every tick");
    assert.equal(new Set(named).size, named.length, "the rows' accessible names did not advance with their gate age");
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    performanceNow.mockRestore();
  }
});

it("reads the instant afresh for commands and stops ticking once nothing listens", () => {
  let monotonic = 5;
  const performanceNow = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const clock = createServedClock(FIXTURE_NOW);
    monotonic += 2500;
    assert.equal(clock.now(), new Date(Date.parse(FIXTURE_NOW) + 2500).toISOString());
    let heard = 0;
    const stop = clock.subscribe(() => { heard += 1; });
    vi.advanceTimersByTime(3000);
    assert.equal(heard, 3);
    stop();
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    vi.useRealTimers();
    performanceNow.mockRestore();
  }
});
