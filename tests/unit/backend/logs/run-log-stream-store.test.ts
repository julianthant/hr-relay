import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createRunLogStreamStore } from "../../../../src/backend/logs/run-log-stream.js";
import type { EventStreamLine } from "../../../../src/backend/storage/events/jsonl-streams.js";
import type { RunRecord } from "../../../../src/models/run/record.js";

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
