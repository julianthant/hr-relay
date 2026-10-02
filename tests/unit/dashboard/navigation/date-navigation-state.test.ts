// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useDashboardDay, type DashboardDayState } from "../../../../src/dashboard/state/use-dashboard-day.js";
import { useCalendar } from "../../../../src/dashboard/state/use-calendar.js";
import { useServedNow } from "../../../../src/dashboard/state/served-clock.js";
import { resolveDateSelection } from "../../../../src/dashboard/app/date-state-model.js";
import { serverLocalDay } from "../../../../src/dashboard/surfaces/date-navigation-model.js";
import { CalendarWireSchema, type CalendarWire } from "../../../../src/domain/dashboard/calendar.js";
import { DashboardDayWireSchema } from "../../../../src/domain/dashboard/projection.js";
import type { AsyncResource } from "../../../../src/dashboard/state/async-resource.js";
import { FIXTURE_DAY_WIRE } from "../../../parity/helpers/fixture-day.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const failure = new DashboardClientError({ kind: "network", message: "old request failed" });
const calendar = (day: string, month = day.slice(0, 7)) => CalendarWireSchema.parse({ month, day, today: "2026-09-18", authorityGeneration: 1,
  monthCounts: [], firstDay: null, lastDay: null, previousDay: null, nextDay: "2026-09-18" });

it("binds intermediate day and calendar renders to request generation through A → B → A, failures, refresh and unmount", async () => {
  const subscriptions: Parameters<DashboardClient["subscribeDay"]>[0][] = [];
  const reads: { input: Parameters<DashboardClient["calendar"]>[0]; resolve(value: CalendarWire): void; reject(error: unknown): void }[] = [];
  let closes = 0;
  const client = { subscribeDay(input) { subscriptions.push(input); return { close() { closes++; } }; },
    calendar(input) { return new Promise((resolve, reject) => { reads.push({ input, resolve, reject }); }); } } as DashboardClient;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const renders: { requested?: string; day: DashboardDayState; calendar: AsyncResource<CalendarWire> }[] = [];
  function Probe({ day, month = "2026-08", revision }: { day?: string; month?: string; revision?: object }) {
    const result = useDashboardDay(day); const available = useCalendar(month, day, "2026-09-18", revision);
    renders.push({ requested: day, day: result, calendar: available }); return null;
  }
  const draw = async (day?: string, month?: string, revision?: object) => { await act(async () => { root.render(createElement(DashboardClientProvider,
    { client, children: createElement(Probe, { day, month, revision }) })); }); };
  const current = () => { const result = renders.at(-1); assert.ok(result); return result; };
  try {
    await draw("2026-08-03");
    await act(async () => { subscriptions[0].onDay(FIXTURE_DAY_WIRE); reads[0].resolve(calendar("2026-08-03")); });
    assert.equal(current().day.day.state, "loaded"); assert.equal(current().calendar.state, "loaded");
    const start = renders.length;
    await draw("2026-08-04"); await draw("2026-08-03");
    for (const render of renders.slice(start)) { assert.equal(render.day.day.state, "loading"); assert.equal(render.calendar.state, "loading"); }
    await act(async () => { subscriptions[0].onDay(FIXTURE_DAY_WIRE); subscriptions[0].onState({ state: "stopped", error: failure }); reads[1].reject(failure); });
    assert.equal(current().day.day.state, "loading"); assert.equal(current().calendar.state, "loading");
    await act(async () => { subscriptions[2].onDay(FIXTURE_DAY_WIRE); reads[2].resolve(calendar("2026-08-03")); });
    assert.equal(current().day.day.state, "loaded");
    await act(async () => { subscriptions[1].onDay(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: "2026-08-04" })); subscriptions[1].onState({ state: "stopped", error: failure }); });
    assert.equal(current().day.day.state, "loaded");
    await draw("2026-08-03", "2026-07");
    assert.equal(current().calendar.state, "loading");
    await act(async () => { reads[3].resolve(calendar("2026-08-03", "2026-08")); });
    assert.equal(current().calendar.state, "failed");
    await draw("2026-08-03", "2026-07", {});
    await act(async () => { reads[4].resolve(calendar("2026-08-03", "2026-07")); });
    assert.equal(current().calendar.state, "loaded");
    await act(async () => { subscriptions[2].onDay(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: "2026-08-04" })); });
    assert.equal(current().day.day.state, "failed");
    await draw(undefined);
    assert.equal(subscriptions.length, 3); assert.equal(current().day.day.state, "loading");
    await act(async () => root.unmount()); const count = renders.length;
    await act(async () => subscriptions[2].onState({ state: "stopped", error: failure }));
    assert.equal(renders.length, count); assert.equal(closes, 3);
  } finally { host.remove(); }
});

it("visibility refresh advances only live Today using the one monotonic calibration", async () => {
  let monotonic = 0;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const host = document.createElement("div"); const root = createRoot(host);
  let live = "", pinned = "";
  function Probe() {
    const now = useServedNow("2026-03-08T07:59:59.000Z", 60_000);
    const today = serverLocalDay({ now, zone: "America/Los_Angeles" });
    const a = resolveDateSelection(undefined, today), b = resolveDateSelection("2026-03-07", today);
    if (a.state === "valid") live = a.day;
    if (b.state === "valid") pinned = b.day;
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.equal(live, "2026-03-07");
    monotonic = 1000;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(live, "2026-03-08"); assert.equal(pinned, "2026-03-07");
  } finally { await act(async () => root.unmount()); spy.mockRestore(); }
});

it("the HTTP client rejects a schema-valid calendar for a different request", async () => {
  const { createShellQueries } = await import("../../../../src/dashboard/client/shell-queries.js");
  let result = calendar("2026-08-03");
  const client = createShellQueries({ requestJson: async () => result } as unknown as import("../../../../src/dashboard/client/transport.js").DashboardTransport);
  assert.equal((await client.calendar({ month: "2026-08", day: "2026-08-03" })).day, "2026-08-03");
  result = calendar("2026-08-04");
  await assert.rejects(client.calendar({ month: "2026-08", day: "2026-08-03" }), /calendar-request-identity-mismatch/u);
});

for (const late of ["success", "failure"] as const) it(`discards an unresolved first A ${late} after B and a new A calendar request`, async () => {
  const pending: { resolve(value: CalendarWire): void; reject(error: unknown): void }[] = [];
  const client = { calendar() { return new Promise<CalendarWire>((resolve, reject) => pending.push({ resolve, reject })); } } as unknown as DashboardClient;
  const host = document.createElement("div"); const root = createRoot(host);
  const renders: AsyncResource<CalendarWire>[] = [];
  const current = () => renders.at(-1);
  function Probe({ day }: { day: string }) { renders.push(useCalendar("2026-08", day, "2026-09-18")); return null; }
  const draw = async (day: string) => { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe, { day }) }))); };
  try {
    await draw("2026-08-03"); await draw("2026-08-04");
    await act(async () => pending[1].resolve(calendar("2026-08-04")));
    assert.equal(current()?.state, "loaded");
    await draw("2026-08-03"); assert.equal(current()?.state, "loading");
    await act(async () => { if (late === "success") pending[0].resolve(calendar("2026-08-03")); else pending[0].reject(failure); });
    assert.equal(current()?.state, "loading");
    await act(async () => pending[2].resolve(calendar("2026-08-03")));
    assert.equal(current()?.state, "loaded");
  } finally { await act(async () => root.unmount()); }
});
