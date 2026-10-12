import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createRunLogStreamStore } from "../../../src/backend/logs/run-log-stream.js";
import type { TimelineEventRecord,TimelineRepository } from "../../../src/models/events/timeline.js";
import type { RunRecord } from "../../../src/models/run/record.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const authority = { envelope: { runId: RUN, traceId: "fpo-120000-0002", attempt: 1, contractFingerprint: "a".repeat(64) } } as RunRecord;
function repository(records: readonly TimelineEventRecord[], calls: unknown[]): TimelineRepository {
  return { withReadSnapshot: read => read(), highWaterMark: () => records.at(-1)?.cursor ?? 0,
    page: request => { calls.push(request); return records.filter(record => record.cursor > (request.after ?? 0)).slice(0, request.limit ?? 500); },
    confirmedActionHeads: () => [], append: () => { throw new Error("read-only fixture"); }, get: () => undefined, pruneBefore: () => 0 };
}
describe("native run log source", () => {
  it("pages snapshots by exact run and resumes the authoritative cursor", () => {
    const calls: unknown[] = [];
    const source = createRunLogStreamStore(repository([], calls));
    assert.deepEqual(source.snapshot(authority), { events: [], hasEarlier: false, parsedLines: 0 });
    const tail = source.tail(new Map());
    assert.deepEqual(calls, [{ after: 0, through: 0, runId: RUN, limit: 200 }, { after: 0, through: 0, limit: 200 }]);
    assert.equal(tail.cursors.get("timeline")?.linesConsumed, 0);
  });
  it("refuses a cursor from a different database generation", () => {
    const source = createRunLogStreamStore(repository([], []));
    assert.throws(() => source.tail(new Map([["timeline", { linesConsumed: 1, bytesConsumed: 0 }]])), /cursor-reset-required/u);
  });
  it("propagates authoritative corruption instead of consulting another log home", () => {
    const database = repository([], []);
    database.page = () => { throw new Error("timeline-record-invalid"); };
    assert.throws(() => createRunLogStreamStore(database).snapshot(authority), /timeline-record-invalid/u);
  });
});
