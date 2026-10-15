import assert from "node:assert/strict";
import { vi } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";

export function withSynchronousMutexDeadline<Result>(work: () => Result): Result {
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  let polls = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock.monotonicMs());
  const wait = vi.spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, timeout) => {
    assert.equal(timeout, 10);
    polls++;
    clock.advanceMonotonic(10);
    return "timed-out";
  });
  try {
    const result = work();
    assert.equal(clock.monotonicMs(), 5000);
    assert.equal(polls, 500);
    return result;
  } finally { wait.mockRestore(); now.mockRestore(); }
}
