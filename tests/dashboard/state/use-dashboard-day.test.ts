// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act,createElement,type ReactElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { DashboardClientError } from "../../../src/dashboard/client/errors.js";
import type { DashboardClient,SubscriptionState } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { useDashboardDay,type DashboardDayState } from "../../../src/dashboard/state/use-dashboard-day.js";
import { NotificationPublicationWireSchema } from "../../../src/models/dashboard/subscription.js";
import { DashboardDayWireSchema,type DashboardDayWire } from "../../../src/models/dashboard/projection.js";

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
  workerCards: [], workerAuthority: { state: "present", members: [] }, workerOperations: [],
  workerPools: [],
  notifications: [],
});

let mounted: Root | undefined;
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = undefined;
});

interface Driver {
  /** The hook's latest return value. */
  readonly latest: () => DashboardDayState;
  onDay(day: DashboardDayWire): Promise<void>;
  onState(state: SubscriptionState): Promise<void>;
}

async function mountHook(): Promise<Driver> {
  let deliverDay: ((day: DashboardDayWire) => void) | undefined;
  let deliverState: ((state: SubscriptionState) => void) | undefined;
  const served = {
    subscribeDay: (input: Parameters<DashboardClient["subscribeDay"]>[0]) => {
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
    observed = useDashboardDay(DAY);
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


it("isolates A -> B -> A days and actor epochs while retaining disconnected rows", async () => {
  const subscriptions: Parameters<DashboardClient["subscribeDay"]>[0][] = [];
  const client = { subscribeDay: (input: Parameters<DashboardClient["subscribeDay"]>[0]) => {
    subscriptions.push(input); return { close: () => undefined };
  } } as DashboardClient;
  const seen: DashboardDayState[] = [];
  function Probe({ day, epoch }: { day: string; epoch: object }) { seen.push(useDashboardDay(day, undefined, epoch)); return null; }
  const root = createRoot(document.createElement("div"));
  mounted = root;
  const render = async (day: string, epoch: object) => { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe, { day, epoch }) }))); };
  const actorA = {}, actorB = {};
  await render(DAY, actorA);
  const firstRequest = seen.at(-1)?.request;
  await act(async () => subscriptions[0].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.request, firstRequest);
  await act(async () => subscriptions[0].onState({ state: "reconnecting" }));
  assert.equal(seen.at(-1)?.day.state, "loaded");
  assert.equal(seen.at(-1)?.request, firstRequest);
  const start = seen.length;
  await render("2026-08-04", actorA);
  assert.ok(seen.slice(start).every(value => value.day.state === "loading"));
  await render(DAY, actorA);
  assert.notEqual(seen.at(-1)?.request, firstRequest);
  await act(async () => subscriptions[0].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loading");
  await act(async () => subscriptions[2].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loaded");
  await render(DAY, actorB);
  await act(async () => subscriptions[2].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loading");
  await act(async () => subscriptions[3].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loaded");
  const replacementClient = { ...client };
  await act(async () => root.render(createElement(DashboardClientProvider, { client: replacementClient, children: createElement(Probe, { day: DAY, epoch: actorB }) })));
  await act(async () => subscriptions[3].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loading");
  await act(async () => subscriptions[4].onDay(EMPTY_DAY));
  assert.equal(seen.at(-1)?.day.state, "loaded");
});

it("uses a stable token for settlements and ticks, replacing it on explicit same-day refresh", async () => {
  const h = await mountHook();
  const first = h.latest().request;
  await h.onDay(EMPTY_DAY); assert.equal(h.latest().request, first);
  await h.onState({ state: "reconnecting" }); assert.equal(h.latest().request, first);
  await act(async () => h.latest().refresh());
  assert.notEqual(h.latest().request, first);
  assert.equal(h.latest().day.state, "loading");
});

it("forwards only live publication callbacks belonging to the current day, actor epoch and client", async () => {
  const subscriptions: Parameters<DashboardClient["subscribeDay"]>[0][] = [];
  const client = { subscribeDay: (input: Parameters<DashboardClient["subscribeDay"]>[0]) => { subscriptions.push(input); return { close() {} }; } } as DashboardClient;
  let state: DashboardDayState | undefined;
  function Probe({ day, epoch, actor }: { day: string; epoch: object; actor: string }) { state = useDashboardDay(day, undefined, epoch, actor); return null; }
  const root = createRoot(document.createElement("div")); mounted = root;
  const epoch = {};
  const render = async (day: string, currentEpoch = epoch, currentClient = client, actor = "local-operator") => {
    await act(async () => root.render(createElement(DashboardClientProvider, { client: currentClient, children: createElement(Probe, { day, epoch: currentEpoch, actor }) })));
  };
  const publication = NotificationPublicationWireSchema.parse({ sourceId: "a".repeat(64), actorId: "local-operator", durable: "created", notification: {
    kind: "notification", notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "ping", count: 1,
    publicationId: "b".repeat(64), trigger: "storage", readState: "unread", state: "unread", severity: "warning", title: "Storage health degraded",
    occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "not-applicable" }, sourceEvent: { state: "available", kind: "storage-degraded" },
  } });
  await render(DAY);
  assert(state);
  const delivered: unknown[] = [];
  const unsubscribe = state.subscribePublications(value => delivered.push(value));
  await act(async () => subscriptions[0].onDay(EMPTY_DAY));
  assert.equal(delivered.length, 0);
  subscriptions[0].publications?.onPublication(publication);
  assert.equal(delivered.length, 1);
  unsubscribe(); subscriptions[0].publications?.onPublication(publication); assert.equal(delivered.length, 1);
  state.subscribePublications(value => delivered.push(value));
  await render("2026-08-04");
  subscriptions[0].publications?.onPublication(publication); assert.equal(delivered.length, 1);
  await render(DAY);
  state.subscribePublications(value => delivered.push(value));
  subscriptions[0].publications?.onPublication(publication); assert.equal(delivered.length, 1);
  subscriptions[2].publications?.onPublication(publication); assert.equal(delivered.length, 2);
  await render(DAY, {});
  subscriptions[2].publications?.onPublication(publication); assert.equal(delivered.length, 2);
  await render(DAY, epoch, { ...client });
  subscriptions[3].publications?.onPublication(publication); assert.equal(delivered.length, 2);
  await render(DAY, epoch, client, "other-operator");
  subscriptions[4].publications?.onPublication(publication); assert.equal(delivered.length, 2);
  await act(async () => root.unmount()); mounted = undefined;
  subscriptions[5].publications?.onPublication(publication); assert.equal(delivered.length, 2);
});
