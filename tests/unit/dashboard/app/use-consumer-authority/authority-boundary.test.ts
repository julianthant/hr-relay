// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { useConsumerAuthority } from "../../../../../src/dashboard/app/use-consumer-authority.js";
import type { AppRouteState } from "../../../../../src/dashboard/app/url-state.js";
import { ActorWireSchema, ServerClockWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { RunDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const DAY_A = "2026-10-01";
const DAY_B = "2026-10-02";
const RUN = "e1b8ae3e-0000-4000-8000-000000000001";
const boot = { actor: ActorWireSchema.parse({ id: "local-operator", label: "Operator" }),
  serverClock: ServerClockWireSchema.parse({ now: "2026-10-02T12:00:00.000Z", zone: "UTC" }) };
const dayWire = (day: string): DashboardDayWire => DashboardDayWireSchema.parse({
  day, descriptorHash: "d".repeat(64), projectionGeneration: 7, snapshotCursor: "pc:1",
  monthCounts: [{ day, count: 0 }], workflowCounts: [], statusCounts: [],
  queueSurfaces: [], workerCards: [], workerPools: [], notifications: [],
});

it("binds served actor, clock, exact day subscription and run selection without duplicate readers", async () => {
  const monotonic = vi.spyOn(performance, "now").mockReturnValue(100);
  const subscriptions: { day: string; onDay: (day: DashboardDayWire) => void; close: () => void }[] = [];
  const details: { runId: string; resolve: (value: RunDetailWire) => void }[] = [];
  let active = 0;
  const client = {
    subscribeDay: ({ day, onDay }: Parameters<DashboardClient["subscribeDay"]>[0]) => {
      active++;
      const subscription = { day, onDay, close: () => { active--; } };
      subscriptions.push(subscription);
      return { close: subscription.close };
    },
    runDetail: (runId: string) => new Promise<RunDetailWire>((resolve) => details.push({ runId, resolve })),
  } as DashboardClient;
  const host = document.createElement("div");
  const root = createRoot(host);
  let observed: ReturnType<typeof useConsumerAuthority> | undefined;
  function Probe({ route }: { route: AppRouteState }) {
    observed = useConsumerAuthority(boot, route, 0);
    return null;
  }
  const current = () => {
    if (observed === undefined) throw new Error("authority did not render");
    return observed;
  };
  const render = async (route: AppRouteState) => act(async () => {
    root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe, { route }) }));
  });
  try {
    await render({ start: false, day: DAY_A, run: RUN });
    assert.equal(active, 1);
    assert.equal(subscriptions[0]?.day, DAY_A);
    assert.equal(details[0]?.runId, RUN);
    assert.equal(current().actorId, boot.actor.id);
    assert.equal(current().today, DAY_B);
    assert.equal(current().nowIso, boot.serverClock.now);
    await act(async () => subscriptions[0].onDay(dayWire(DAY_A)));
    const stableDay = current().dayWire;
    assert.equal(stableDay?.day, DAY_A);
    await render({ start: false, day: DAY_A, run: RUN, section: "logs" });
    assert.equal(active, 1);
    assert.equal(subscriptions.length, 1);
    assert.equal(details.length, 1);
    assert.equal(current().dayWire, stableDay, "unrelated route renders retain the served day reference");
    await render({ start: false, day: DAY_B, run: RUN });
    assert.equal(active, 1);
    assert.equal(subscriptions.length, 2);
    assert.equal(details.length, 2, "same run on a new day is a new detail selection");
    assert.equal(current().dayWire, undefined);
    assert.equal(current().detail.state, "loading");
    await act(async () => subscriptions[0].onDay(dayWire(DAY_A)));
    assert.equal(current().dayWire, undefined, "closed day cannot publish a late snapshot");
    await act(async () => subscriptions[1].onDay(dayWire(DAY_B)));
    assert.equal(current().dayWire?.day, DAY_B);
  } finally {
    await act(async () => root.unmount());
    monotonic.mockRestore();
    assert.equal(active, 0);
  }
});
