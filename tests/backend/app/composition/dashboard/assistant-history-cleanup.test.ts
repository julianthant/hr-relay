import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { startAssistantHistoryCleanup } from "../../../../../src/backend/app/composition/dashboard/assistant.js";

afterEach(() => { vi.useRealTimers(); });

it("reports every failed reclamation tick, retries on the next one and stops after disposal", () => {
  vi.useFakeTimers();
  const failure = new Error("synthetic reclamation failure"), reported: unknown[] = [];
  let ticks = 0;
  const timer = startAssistantHistoryCleanup(() => { ticks++; if (ticks < 3) throw failure; }, error => { reported.push(error); }, 1000);
  vi.advanceTimersByTime(999);
  assert.equal(ticks, 0);
  vi.advanceTimersByTime(1);
  assert.deepEqual([ticks, reported], [1, [failure]]);
  vi.advanceTimersByTime(2000);
  assert.deepEqual([ticks, reported], [3, [failure, failure]], "a success after failures reports nothing new");
  clearInterval(timer);
  vi.advanceTimersByTime(5000);
  assert.equal(ticks, 3);
});
