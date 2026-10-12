import assert from "node:assert/strict";
import { it } from "vitest";
import { resolveDateSelection } from "../../../../src/dashboard/app/navigation/date-state-model.js";
import { deriveServedNow } from "../../../../src/dashboard/state/served-clock.js";
import { buildCalendarMonth,calendarTabStop,moveCalendarFocus,serverLocalDay,shiftMonth } from "../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { DayCountWireSchema } from "../../../../src/models/dashboard/projection.js";

it("follows served Pacific midnight across both DST changes and year boundaries while pinned dates stay pinned", () => {
  for (const [instant, elapsed, expected] of [
    ["2026-03-08T07:59:59.000Z", 1000, "2026-03-08"],
    ["2026-03-08T09:59:59.000Z", 1000, "2026-03-08"],
    ["2026-11-01T06:59:59.000Z", 1000, "2026-11-01"],
    ["2026-11-01T08:59:59.000Z", 1000, "2026-11-01"],
    ["2027-01-01T07:59:59.000Z", 1000, "2027-01-01"],
  ] as const) {
    const today = serverLocalDay({ now: deriveServedNow(instant, elapsed), zone: "America/Los_Angeles" });
    assert.equal(today, expected);
    assert.deepEqual(resolveDateSelection(undefined, today), { state: "valid", day: expected, followToday: true });
    assert.deepEqual(resolveDateSelection("2024-02-29", today), { state: "valid", day: "2024-02-29", followToday: false });
  }
  assert.equal(serverLocalDay({ now: "2026-09-18T06:00:00Z", zone: "Asia/Tokyo" }), "2026-09-18");
  assert.equal(serverLocalDay({ now: "2026-09-18T06:00:00Z", zone: "America/Los_Angeles" }), "2026-09-17");
});

it("keeps one usable tab stop across empty dates, refuses future cells and handles month/year edges", () => {
  const counts = DayCountWireSchema.array().parse([{ day: "2026-08-03", count: 2 }, { day: "2026-08-07", count: 1 }, { day: "2026-08-25", count: 1 }]);
  const cells = buildCalendarMonth("2026-08", counts, "2026-08-10");
  assert.equal(cells.length, 42);
  const at = (day: string) => cells.findIndex(cell => cell.day === day);
  assert.equal(cells[at("2026-08-25")].available, false);
  assert.equal(cells[at("2026-08-10")].available, true);
  assert.equal(cells[at("2026-08-04")].available, true);
  assert.equal(calendarTabStop(cells, "2026-08-25", "2026-08-03"), at("2026-08-03"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-03"), "ArrowRight"), at("2026-08-04"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-07"), "ArrowLeft"), at("2026-08-06"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-03"), "ArrowDown"), at("2026-08-10"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-10"), "ArrowUp"), at("2026-08-03"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-07"), "Home"), at("2026-08-02"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-03"), "End"), at("2026-08-08"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-10"), "ArrowRight"), at("2026-08-10"));
  assert.equal(moveCalendarFocus(cells, at("2026-08-10"), "Enter"), null);
  const emptyMonth = buildCalendarMonth("2025-02", [], "2026-08-10");
  assert.equal(calendarTabStop(emptyMonth, undefined, "2025-02-03"), emptyMonth.findIndex(cell => cell.day === "2025-02-03"));
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  assert.equal(shiftMonth("0100-01", -1), "0099-12");
  assert.equal(shiftMonth("0000-02", -1), "0000-01");
});
