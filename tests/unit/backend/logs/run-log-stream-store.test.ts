import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createRunLogStreamStore } from "../../../../src/backend/logs/run-log-stream.js";
import { readEventStreamLinesFrom, type EventStreamFileCursor, type EventStreamLine } from "../../../../src/backend/storage/events/jsonl-streams.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { localDatePart } from "../../../../src/rules/time/clock.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-02T12:00:00.000Z";
const authority = { envelope: { runId: RUN, workflow: "onboarding", traceId: "fpo-120000-0002",
  contractFingerprint: "a".repeat(64), attempt: 1 }, createdAt: AT, updatedAt: AT,
  lifecycle: { state: "running" } } as unknown as RunRecord;
function line(text: string, workflow = "onboarding"): EventStreamLine {
  return { file: { stream: "notes", workflow, date: "2026-10-02", path: "/fake/notes.jsonl" },
    lineNumber: 1, text };
}
function store(lines: readonly EventStreamLine[]) {
  return createRunLogStreamStore("unused", () => ({ lines, cursors: new Map(), hasMore: false, bytesRead: 0 }));
}

describe("run log source parsing", () => {
  it("scopes the initial snapshot and forwards bounded tail cursor reads", () => {
    const calls: Parameters<typeof readEventStreamLinesFrom>[] = [];
    const inputCursors = new Map<string, EventStreamFileCursor>([
      ["notes/onboarding/2026-10-02.jsonl", { bytesConsumed: 64, linesConsumed: 2 }],
    ]);
    const outputCursors = new Map<string, EventStreamFileCursor>([
      ["notes/onboarding/2026-10-02.jsonl", { bytesConsumed: 96, linesConsumed: 3 }],
    ]);
    const source = createRunLogStreamStore("state-root", (...args) => {
      calls.push(args);
      return { lines: [], cursors: outputCursors, hasMore: false, bytesRead: 0 };
    });

    const snapshot = source.snapshot(authority);
    const tail = source.tail(inputCursors);
    const snapshotCall = calls[0];
    const tailCall = calls[1];
    assert.ok(snapshotCall);
    assert.ok(tailCall);
    const runDay = localDatePart(new Date(AT));
    const nextDay = localDatePart(new Date(Date.parse(AT) + 24 * 60 * 60 * 1000));
    assert.deepEqual([snapshotCall[0], snapshotCall[1], snapshotCall[2]], ["state-root", "notes", new Map()]);
    assert.deepEqual(snapshotCall[3], { workflow: "onboarding", fromDate: runDay, toDate: nextDay });
    assert.deepEqual(snapshotCall[4], { maxBytes: 256 * 1024, maxLines: 200 });
    assert.equal(tailCall[0], "state-root");
    assert.equal(tailCall[1], "notes");
    assert.equal(tailCall[2], inputCursors);
    assert.equal(tailCall[3], undefined);
    assert.deepEqual(tailCall[4], { maxBytes: 256 * 1024, maxLines: 200 });
    assert.deepEqual([snapshot.parsedLines, tail.parsedLines, tail.bytesRead], [0, 0, 0]);
    assert.equal(tail.cursors, outputCursors);
  });

  it("refuses malformed complete lines with exact location", () => {
    assert.throws(() => store([line("{bad")]).snapshot(authority), /run-log-line-invalid:\/fake\/notes.jsonl:1/u);
  });

  it("refuses a note filed under a foreign workflow", () => {
    const note = { runId: RUN, attempt: 1, traceId: "fpo-120000-0002", spanPath: "task/first",
      ts: AT, workflow: "onboarding", pid: 1, level: "step", message: "Legacy note" };
    assert.throws(() => store([line(JSON.stringify(note), "other-workflow")]).snapshot(authority),
      /run-log-partition-owner-mismatch/u);
    const legacy = store([line(JSON.stringify(note))]).snapshot(authority);
    assert.deepEqual(legacy.events, []);
    assert.equal(legacy.parsedLines, 1);
  });
});
