import assert from "node:assert/strict";
import { it } from "vitest";
import { capturedInstantClock, manualClock, systemClock } from "../../src/domain/clock.js";
it("retains a captured wall instant without freezing elapsed budgets or sharing mutable Dates", () => {
  const elapsed = manualClock(new Date("2026-09-26T12:00:00.000Z"), 10);
  const clock = capturedInstantClock("2026-09-22T17:00:00.000Z", elapsed);
  const first = clock.now(); first.setUTCFullYear(2000);
  elapsed.advanceWall(60_000); elapsed.advanceMonotonic(25);
  assert.equal(clock.now().toISOString(), "2026-09-22T17:00:00.000Z");
  assert.equal(clock.nowMs(), Date.parse("2026-09-22T17:00:00.000Z"));
  assert.equal(clock.monotonicMs(), 35); assert.ok(Object.isFrozen(clock));
  assert.equal("advanceWall" in clock, false); assert.equal("advanceMonotonic" in clock, false); assert.equal("setWall" in clock, false);
  assert.equal(clock.timeOfDayCode(), systemClock.timeOfDayCode(clock.now()));
  assert.equal(clock.fiscalYear(), systemClock.fiscalYear(clock.now()));
});
for (const input of ["", "not-a-date", "2026-09-22", "2026-13-01T00:00:00.000Z"]) {
  it(`refuses invalid captured instant ${JSON.stringify(input)}`, () => {
    assert.throws(() => capturedInstantClock(input), /captured-instant-clock: invalid ISO instant/u);
  });
}
