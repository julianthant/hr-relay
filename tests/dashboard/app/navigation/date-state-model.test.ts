// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it,vi } from "vitest";
import { resolveDateSelection } from "../../../../src/dashboard/app/navigation/date-state-model.js";
import { useServedNow } from "../../../../src/dashboard/state/served-clock.js";
import { serverLocalDay } from "../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { CalendarWireSchema } from "../../../../src/models/dashboard/calendar.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const calendar = (day: string, month = day.slice(0, 7)) => CalendarWireSchema.parse({ month, day, today: "2026-09-18", authorityGeneration: 1,
  monthCounts: [], firstDay: null, lastDay: null, previousDay: null, nextDay: "2026-09-18" });

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
  const { createShellQueries } = await import("../../../../src/dashboard/client/queries/shell-queries.js");
  let result = calendar("2026-08-03");
  const client = createShellQueries({ requestJson: async () => result } as unknown as import("../../../../src/dashboard/client/transport.js").DashboardTransport);
  assert.equal((await client.calendar({ month: "2026-08", day: "2026-08-03" })).day, "2026-08-03");
  result = calendar("2026-08-04");
  await assert.rejects(client.calendar({ month: "2026-08", day: "2026-08-03" }), /calendar-request-identity-mismatch/u);
});
