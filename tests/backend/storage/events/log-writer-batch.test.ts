import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { createLogWriterBatch } from "../../../../src/backend/storage/events/log-writer-batch.js";
import type { LogMutation } from "../../../../src/backend/storage/events/log-mutations.js";

afterEach(() => { vi.useRealTimers(); });
const removal: LogMutation = { kind: "remove", table: "timeline_events", cursors: [1] };

it("commits on the oldest note deadline and performs no idle commits", () => {
  vi.useFakeTimers();
  const written: number[] = [];
  const batch = createLogWriterBatch(250, rows => written.push(rows.length), () => {});
  batch.append(1, removal, false);
  vi.advanceTimersByTime(240);
  batch.append(2, removal, false);
  vi.advanceTimersByTime(9);
  assert.deepEqual(written, []);
  vi.advanceTimersByTime(1);
  vi.advanceTimersByTime(250);
  assert.deepEqual(written, [2]);
});

it("forces a batch at capacity, step end, or a confirmed write barrier and acknowledges after commit", () => {
  vi.useFakeTimers();
  const ordered: string[] = [];
  const batch = createLogWriterBatch(250, rows => ordered.push(`commit ${rows.length}`), through => ordered.push(`ack ${through}`));
  for (let i = 1; i <= 49; i++) batch.append(i, removal, false);
  assert.deepEqual(ordered, []);
  batch.append(50, removal, false);
  batch.append(51, removal, false);
  batch.append(52, removal, true);
  batch.append(53, removal, false);
  batch.flush(54);
  batch.flush(55);
  assert.deepEqual(ordered, ["commit 50", "ack 50", "commit 2", "ack 52", "commit 1", "ack 54", "ack 55"]);
});
