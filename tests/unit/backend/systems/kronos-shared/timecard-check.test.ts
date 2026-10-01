import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../../src/domain/clock.js";
import type { VisibleTimecardMonthDays } from "../../../../../src/domain/timecard-period.js";
import { runTimecardCheck } from "../../../../../src/backend/systems/kronos-shared/timecard.js";
import type {
  SemanticTimecardDriver,
  TimecardPeriodSwitch,
} from "../../../../../src/backend/systems/kronos-shared/timecard.js";

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function visible(
  firstMonth: number, firstDay: number, lastMonth: number, lastDay: number,
): VisibleTimecardMonthDays {
  return { first: { month: firstMonth, day: firstDay }, last: { month: lastMonth, day: lastDay } };
}

interface StubOptions {
  readonly currentLast?: string | null;
  readonly previousLast?: string | null;
  readonly switchOutcome?: TimecardPeriodSwitch;
  readonly navigationError?: string;
}

function stubDriver(options: StubOptions): {
  driver: SemanticTimecardDriver;
  calls: string[];
} {
  const calls: string[] = [];
  let switched = false;
  const driver: SemanticTimecardDriver = {
    async goToTimecard() {
      calls.push("goTo");
      if (options.navigationError !== undefined) throw new Error(options.navigationError);
      return Promise.resolve();
    },
    async switchToPreviousPeriod() {
      calls.push("switch");
      switched = true;
      return Promise.resolve(
        options.switchOutcome
          ?? { kind: "switched", beforeLabel: "Current Pay Period", afterLabel: "03/01/2026 - 03/15/2026" },
      );
    },
    async readVisibleMonthDays() {
      calls.push(switched ? "visible:previous" : "visible:current");
      return Promise.resolve(switched ? visible(3, 1, 3, 15) : visible(3, 16, 3, 31));
    },
    async readLastDate() {
      calls.push(switched ? "last:previous" : "last:current");
      return Promise.resolve(switched ? options.previousLast ?? null : options.currentLast ?? null);
    },
  };
  return { driver, calls };
}

describe("runTimecardCheck", () => {
  const clock = manualClock(localDate(2026, 3, 20));

  it("returns the current period's last date without switching", async () => {
    const { driver, calls } = stubDriver({ currentLast: "03/18/2026" });
    assert.equal(await runTimecardCheck(driver, clock), "03/18/2026");
    assert.deepEqual(calls, ["goTo", "visible:current", "last:current"]);
  });

  it("falls back to the previous period only when the current one is empty", async () => {
    const { driver, calls } = stubDriver({ currentLast: null, previousLast: "03/13/2026" });
    assert.equal(await runTimecardCheck(driver, clock), "03/13/2026");
    assert.deepEqual(calls, [
      "goTo", "visible:current", "last:current", "switch", "visible:previous", "last:previous",
    ]);
  });

  it("returns null when neither period has entries", async () => {
    const { driver } = stubDriver({ currentLast: null, previousLast: null });
    assert.equal(await runTimecardCheck(driver, clock), null);
  });

  it("returns null for a declared absent previous period, without reading further", async () => {
    const { driver, calls } = stubDriver({
      currentLast: null,
      switchOutcome: { kind: "no-previous-period", reason: "hire date is inside the current period" },
    });
    assert.equal(await runTimecardCheck(driver, clock), null);
    assert.deepEqual(calls, ["goTo", "visible:current", "last:current", "switch"]);
  });

  it("propagates a navigation failure instead of reporting no entries", async () => {
    const { driver } = stubDriver({ navigationError: "timecard tab never rendered" });
    await assert.rejects(runTimecardCheck(driver, clock), /timecard tab never rendered/);
  });

  it("rejects a malformed grid read at the driver boundary", async () => {
    const { driver } = stubDriver({ currentLast: "03/18/2026" });
    const malformed: SemanticTimecardDriver = {
      ...driver,
      readVisibleMonthDays: () =>
        Promise.resolve({ first: { month: 3, day: 16, raw: "Mon 3/16" }, last: { month: 3, day: 31 } } as unknown as VisibleTimecardMonthDays),
    };
    await assert.rejects(runTimecardCheck(malformed, clock), /unrecognized_keys|Unrecognized key/i);
  });

  it("throws when the period label did not verifiably change", async () => {
    const { driver } = stubDriver({
      currentLast: null,
      switchOutcome: {
        kind: "switched",
        beforeLabel: "Current Pay Period",
        afterLabel: "Current Pay Period",
      },
    });
    await assert.rejects(runTimecardCheck(driver, clock), /switch is unverified/);
  });

  it("honours a store's current-period label pattern", async () => {
    const { driver } = stubDriver({
      currentLast: null,
      switchOutcome: {
        kind: "switched",
        beforeLabel: "Current Pay Period (3/16 - 3/31)",
        afterLabel: "Current Pay Period",
      },
    });
    await assert.rejects(
      runTimecardCheck(driver, clock, /current pay period/i),
      /switch is unverified/,
    );
  });
})
