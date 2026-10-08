import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { navbarCalendarKey, navbarDayLabel, navbarMonthCells, navbarMonthLabel, navbarShiftDay, navbarShiftMonth } from "../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";

describe("canonical workspace rail", () => {
  it("builds six complete Sunday-first weeks with future dates disabled", () => {
    const cells = navbarMonthCells("2026-09", "2026-09-26");
    assert.equal(cells.length, 42);
    assert.equal(cells[0].day, "2026-08-30");
    assert.equal(cells.at(-1)?.day, "2026-10-10");
    assert.equal(cells.filter(cell => cell.inMonth).length, 30);
    assert.equal(cells.find(cell => cell.day === "2026-09-26")?.available, true);
    assert.equal(cells.find(cell => cell.day === "2026-09-27")?.available, false);
    assert.equal(navbarMonthCells("2024-02", "2024-02-29").filter(cell => cell.inMonth).length, 29);
  });
  it("moves through day, month and keyboard boundaries without local timezone drift", () => {
    assert.equal(navbarShiftDay("2024-03-01", -1), "2024-02-29");
    assert.equal(navbarShiftDay("2026-12-31", 1), "2027-01-01");
    assert.equal(navbarShiftMonth("2026-12", 1), "2027-01");
    assert.equal(navbarMonthLabel("2026-09"), "September 2026");
    assert.equal(navbarDayLabel("2026-09-26"), "09/26/2026");
    for (const [key, expected] of [["ArrowLeft", "2026-09-22"], ["ArrowRight", "2026-09-24"], ["ArrowUp", "2026-09-16"], ["ArrowDown", "2026-09-30"], ["Home", "2026-09-20"], ["End", "2026-09-26"]]) assert.equal(navbarCalendarKey("2026-09-23", key), expected);
    assert.equal(navbarCalendarKey("2026-03-31", "PageUp"), "2026-02-28");
    assert.equal(navbarCalendarKey("2024-01-31", "PageDown"), "2024-02-29");
    assert.equal(navbarCalendarKey("2026-09-23", "Escape"), undefined);
  });
  it("refuses corrupt dates instead of normalizing them into a plausible selection", () => {
    for (const value of ["2026-02-30", "2026-13-01", "wrong", "2026-9-2"]) assert.throws(() => navbarDayLabel(value), /navbar-day-invalid/);
    assert.throws(() => navbarMonthCells("2026-00", "2026-09-26"), /navbar-day-invalid/);
    assert.throws(() => navbarMonthCells("2026-09", "missing"), /navbar-day-invalid/);
  });
});
