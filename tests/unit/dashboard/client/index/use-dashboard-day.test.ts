// @vitest-environment jsdom
/**
 * The hook's one authority duty: a subscription that STOPPED with an error has
 * no path back to fresh data, so the day it was holding may not stay on screen
 * dressed as live (ref frontend-backend-integration §3.5).
 *
 * `subscription.test.ts` pins which stream endings produce that state. This
 * file pins what the React side does with it, which is the half no fold can
 * see: the `day` resource must become `failed` carrying the SAME error, so
 * every surface reading it renders the failure rather than the last snapshot.
 * The negative control is the operator's own close — `{ state: "stopped" }`
 * with no error — which must leave the loaded day exactly where it is.
 */
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import type { DashboardClient, SubscriptionState } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientError } from "../../../../../src/dashboard/client/errors.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useDashboardDay, type DashboardDayState } from "../../../../../src/dashboard/state/use-dashboard-day.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);

const EMPTY_DAY: DashboardDayWire = DashboardDayWireSchema.parse({
  day: DAY,
  descriptorHash: HASH_D,
  projectionGeneration: 7,
  snapshotCursor: "pc:1",
  monthCounts: [{ day: DAY, count: 0 }],
  workflowCounts: [],
  statusCounts: [],
  queueSurfaces: [],
  workerCards: [],
  workerPools: [],
  notifications: [],
});

let mounted: Root | undefined;
afterEach(async () => {
  await act(async () => { mounted?.unmount(); });
  mounted = undefined;
  vi.useRealTimers();
});

interface Driver {
  /** The hook's latest return value. */
  readonly latest: () => DashboardDayState;
  readonly subscriptions: () => number;
  onDay(day: DashboardDayWire): Promise<void>;
  onState(state: SubscriptionState): Promise<void>;
}

async function mountHook(nowIso?: string): Promise<Driver> {
  let deliverDay: ((day: DashboardDayWire) => void) | undefined;
  let deliverState: ((state: SubscriptionState) => void) | undefined;
  let subscriptions = 0;
  const served = {
    subscribeDay: (input: Parameters<DashboardClient["subscribeDay"]>[0]) => {
      subscriptions += 1;
      deliverDay = input.onDay;
      deliverState = input.onState;
      return { close: (): void => undefined };
    },
  } as unknown as DashboardClient;
  const client = new Proxy(served, {
    get(target, property, receiver) {
      if (!(property in target)) {
        throw new Error(`the day-hook fixture does not serve DashboardClient.${String(property)}`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  let observed: DashboardDayState | undefined;
  function Probe(): ReactElement {
    observed = useDashboardDay(DAY, nowIso);
    return createElement("div");
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) }));
  });

  const require = <Value,>(value: Value | undefined, what: string): Value => {
    if (value === undefined) throw new Error(`the day hook never ${what}`);
    return value;
  };

  return {
    latest: () => require(observed, "rendered"),
    subscriptions: () => subscriptions,
    onDay: async (day) => {
      const deliver = require(deliverDay, "subscribed");
      await act(async () => { deliver(day); });
    },
    onState: async (state) => {
      const deliver = require(deliverState, "subscribed");
      await act(async () => { deliver(state); });
    },
  };
}

describe("useDashboardDay — a stopped subscription", () => {
  it("replaces the loaded day with the error the subscription stopped on", async () => {
    const driver = await mountHook();
    await driver.onDay(EMPTY_DAY);
    assert.equal(driver.latest().day.state, "loaded");

    const error = new DashboardClientError({
      kind: "http",
      status: 503,
      message: "the day projection is unavailable",
    });
    await driver.onState({ state: "stopped", error });

    const { day, connection } = driver.latest();
    assert.equal(day.state, "failed");
    if (day.state !== "failed") assert.fail("expected the day resource to fail");
    assert.equal(day.error, error);
    assert.deepEqual(connection, { state: "stopped", error });
  });

  it("keeps the loaded day when the operator's own close stops it with no error", async () => {
    const driver = await mountHook();
    await driver.onDay(EMPTY_DAY);
    await driver.onState({ state: "stopped" });

    const { day, connection } = driver.latest();
    assert.equal(day.state, "loaded");
    if (day.state !== "loaded") assert.fail("expected the day resource to stay loaded");
    assert.equal(day.value, EMPTY_DAY);
    assert.deepEqual(connection, { state: "stopped" });
  });
});

it("refreshes the one day resource at a server-projected snooze expiry", async () => {
  vi.useFakeTimers();
  const driver = await mountHook("2026-08-03T17:00:00.000Z");
  const row = { kind: "notification", channel: "ping", count: 1, publicationId: "a".repeat(64),
    trigger: "failed", readState: "unread", notificationId: "11111111-1111-4111-8111-111111111111",
    actorId: "local-operator", severity: "error", title: "Run failed", context: { state: "unavailable" },
    state: "snoozed", snoozedUntil: "2026-08-03T18:00:00.000Z", occurredAt: "2026-08-03T16:00:00.000Z", revision: 2 };
  await driver.onDay(DashboardDayWireSchema.parse({ ...EMPTY_DAY, notifications: [row] }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3_599_999); });
  assert.equal(driver.subscriptions(), 1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  assert.equal(driver.subscriptions(), 2);
  await driver.onDay(DashboardDayWireSchema.parse({ ...EMPTY_DAY, notifications: [{ ...row, state: "unread", snoozedUntil: undefined }] }));
  assert.equal(driver.latest().day.state, "loaded");
  await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
  assert.equal(driver.subscriptions(), 2);
});
