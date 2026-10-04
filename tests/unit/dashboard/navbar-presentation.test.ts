import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { TopBar } from "../../../src/dashboard/surfaces/top-bar.js";
import { NAVBAR_SAMPLE } from "../../../src/dashboard/surfaces/navbar/navbar-fixture.js";
import { navbarCalendarKey, navbarDayLabel, navbarMonthCells, navbarMonthLabel, navbarSearch, navbarShiftDay, navbarShiftMonth } from "../../../src/dashboard/surfaces/navbar/navbar-view-model.js";

const noop = () => {};
describe("canonical frontend navbar", () => {
  it("renders all retained controls without a client provider or preflight", () => {
    const html = renderToStaticMarkup(createElement(TopBar, {
      onDashboard: noop, nav: { canBack: false, canForward: false, onBack: noop, onForward: noop },
      theme: "dark", onToggleTheme: noop, settingsOpen: false, onOpenSettings: noop,
    }));
    for (const label of ["RRSS HR", "Back", "Forward", "Dashboard", "Search runs", "Choose date", "Notifications, 4 unread", "Switch to light theme", "Settings"]) assert.ok(html.includes(label), label);
    assert.doesNotMatch(html, /HR Automation|lucide-shield|Preflight|doctor|Storage checks/);
    assert.match(html, /2026-09-26/);
    assert.doesNotMatch(html, /aria-label="Main navigation"|>Archive<|>Explorer<|>Activity</);
  });
  it("finds every requested word across the local run fields, with no empty-query loss", () => {
    assert.equal(navbarSearch(NAVBAR_SAMPLE.results, "").length, 3);
    assert.deepEqual(navbarSearch(NAVBAR_SAMPLE.results, "  JORDAN   waiting  ").map(result => result.id), ["sample-jordan"]);
    assert.deepEqual(navbarSearch(NAVBAR_SAMPLE.results, "2026-09-25 separations").map(result => result.subject), ["Casey Rivera"]);
    assert.equal(navbarSearch(NAVBAR_SAMPLE.results, "Jordan Completed").length, 0);
    assert.equal(navbarSearch(NAVBAR_SAMPLE.results, "missing person").length, 0);
  });
  it("preserves measured zero and an unavailable date count as separate values", () => {
    assert.equal(NAVBAR_SAMPLE.counts["2026-09-20"], 0);
    assert.equal(NAVBAR_SAMPLE.counts["2026-08-20"], undefined);
  });
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
    assert.equal(navbarDayLabel("2026-09-26"), "Sat, Sep 26");
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
