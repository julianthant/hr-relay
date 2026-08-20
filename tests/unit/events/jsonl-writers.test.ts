/**
 * The JSONL span/note writers (ref dashboard-surfaces §2.1): O_APPEND lines under the state
 * root, append-at-now partitioning, write-once identity enforcement at emit,
 * schema-owned note redaction with visible drops, the D218 cursor-based tail
 * reader, and the D86 30-day prune.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  appendEventStreamLine,
  listEventStreamFiles,
  pruneEventStreams,
  readEventStreamLines,
  readEventStreamLinesFrom,
} from "../../../src/infra/events/jsonl-streams.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";

const roots: string[] = [];

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-events-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TRACE = "pl-104233-3b8f";
const AT = new Date("2026-08-03T10:42:33.000-07:00");

function queuedEvent(clock: { now(): Date }): Record<string, unknown> {
  return {
    t: "run.queued",
    kind: "run",
    ts: clock.now().toISOString(),
    workflow: "person-lookup",
    runId: RUN_ID,
    attempt: 1,
    traceId: TRACE,
    spanPath: TRACE,
    itemId: "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c",
    shape: "single",
    priority: "interactive",
    dryRun: false,
    actorId: "local-operator",
    title: "Ada Lovelace",
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    resolvedInstance: { ucpath: "prod" },
    configFingerprint: "b".repeat(64),
    configSnapshotId: "1a2b3c4d-5e6f-47a8-89ab-cdef01234567",
  };
}

describe("span JSONL writer", () => {
  it("appends one strict pid-stamped line per event and feeds NO projector — the fold reads disk (D218)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 4242 });
    writer.emit(queuedEvent(clock));
    writer.emit({
      t: "run.claimed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, workerId: "person-lookup-worker-1",
    });
    const lines = readEventStreamLines(root, "spans");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].file.workflow, "person-lookup");
    assert.equal(lines[0].file.date, "2026-08-03");
    const first: unknown = JSON.parse(lines[0].text);
    assert.equal((first as { pid: number }).pid, 4242);
  });

  it("partitions append-at-now: a midnight-crossing writer starts a new day file", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    clock.advanceWall(24 * 60 * 60 * 1000);
    writer.emit({
      t: "run.claimed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, workerId: "person-lookup-worker-1",
    });
    assert.deepEqual(listEventStreamFiles(root, "spans").map((file) => file.date), ["2026-08-03", "2026-08-04"]);
  });

  it("throws on a second run.queued, a re-open, and a re-end for the same identity", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    assert.throws(() => writer.emit(queuedEvent(clock)), /write-once/);
    const task = {
      t: "span.started", kind: "task", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1`, name: "searching",
    };
    writer.emit(task);
    assert.throws(() => writer.emit(task), /opens exactly once/);
    const ended = {
      t: "span.ended", kind: "task", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1`, outcome: "done",
    };
    writer.emit(ended);
    assert.throws(() => writer.emit(ended), /closes exactly once/);
    // A close for a span an earlier process opened is legal after a restart.
    writer.emit({
      t: "span.ended", kind: "worker", ts: clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", outcome: "done",
    });
  });

  /**
   * D254 — the writer's declared-detail-key enforcement retired WITH the
   * `span.patched` arm it guarded. What replaces it is the stronger statement:
   * the event does not parse at all, so no detail line can reach disk under
   * any key. The disk assertion is the load-bearing half — a schema that
   * refused after the append would still have written history nobody can fold.
   */
  it("refuses a span.patched event outright and writes nothing (D254 retirement)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    const patch = (key: string): Record<string, unknown> => ({
      t: "span.patched", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, updates: [{ key, value: "x" }],
    });
    assert.throws(() => writer.emit(patch("resolvedName")));
    assert.throws(() => writer.emit(patch("traceId")));
    const patched = readEventStreamLines(root, "spans").filter((line) => line.text.includes("span.patched"));
    assert.equal(patched.length, 0);
  });
});

describe("note JSONL writer and schema-owned redaction", () => {
  it("redacts classified fields, DROPS unclassified ones visibly, and never writes the raw value", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createNoteJsonlWriter({ stateRoot: root, clock, pid: 7 });
    const canaryPassword = "hunter2-canary-password";
    const canarySsn = "951-57-1700";
    const note = writer.emitNote({
      workflow: "person-lookup",
      address: { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1` },
      level: "step",
      message: "submitted person search",
      fields: [
        { key: "password", classification: "secret", transform: "digest", value: canaryPassword },
        { key: "ssn", classification: "direct-identifier", transform: "last4", value: canarySsn },
        { key: "resultCount", classification: "safe-diagnostic", transform: "allow", value: 3 },
        { key: "rawProfile", value: { ssn: canarySsn } }, // unclassified — must drop
      ],
    });
    const fields = note.fields ?? [];
    assert.deepEqual(fields.map(({ key }) => key), ["password", "ssn", "resultCount", "redactionWarnings"]);
    assert.deepEqual(fields.at(-1), { key: "redactionWarnings", kind: "count", value: 1 });
    const bytes = readFileSync(readEventStreamLines(root, "notes")[0].file.path, "utf8");
    assert.equal(bytes.includes(canaryPassword), false);
    assert.equal(bytes.includes(canarySsn), false);
    assert.equal(bytes.includes("6789"), true); // last4 survives, nothing more
  });

  it("refuses a non-note ingress instead of writing a best guess", () => {
    const writer = createNoteJsonlWriter({ stateRoot: stateRoot(), clock: manualClock(AT), pid: 7 });
    assert.throws(() => writer.emitNote({ workflow: "person-lookup", level: "step", message: "no address" }));
    assert.throws(() => writer.emitNote({
      workflow: "person-lookup",
      address: { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE },
      level: "step",
      message: "",
    }));
  });
});

describe("the D218 cursor-based tail reader", () => {
  it("reads only what landed since the cursors, and resumes without re-reading a line", () => {
    const root = stateRoot();
    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":1}`);
    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":2}`);
    const first = readEventStreamLinesFrom(root, "spans", new Map());
    assert.deepEqual(first.lines.map(({ text, lineNumber }) => ({ text, lineNumber })), [
      { text: `{"n":1}`, lineNumber: 1 },
      { text: `{"n":2}`, lineNumber: 2 },
    ]);

    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":3}`);
    // A new file (day roll / new workflow) is picked up from byte 0.
    appendEventStreamLine(root, "spans", "aa-flow", "2026-08-04", `{"n":4}`);
    const second = readEventStreamLinesFrom(root, "spans", first.cursors);
    assert.deepEqual(second.lines.map(({ text, lineNumber }) => ({ text, lineNumber })), [
      { text: `{"n":3}`, lineNumber: 3 },
      { text: `{"n":4}`, lineNumber: 1 },
    ]);

    const third = readEventStreamLinesFrom(root, "spans", second.cursors);
    assert.deepEqual(third.lines, []);
  });

  it("does not consume a torn trailing line until its newline lands", () => {
    const root = stateRoot();
    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":1}`);
    const path = join(root, "spans", "person-lookup-2026-08-03.jsonl");
    appendFileSync(path, `{"torn":`); // another process mid-append — no newline yet
    const first = readEventStreamLinesFrom(root, "spans", new Map());
    assert.deepEqual(first.lines.map(({ text }) => text), [`{"n":1}`]);

    appendFileSync(path, `true}\n`);
    const second = readEventStreamLinesFrom(root, "spans", first.cursors);
    assert.deepEqual(second.lines.map(({ text, lineNumber }) => ({ text, lineNumber })), [
      { text: `{"torn":true}`, lineNumber: 2 },
    ]);
  });

  it("fails loud when an append-only file shrank below its cursor", () => {
    const root = stateRoot();
    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":1}`);
    appendEventStreamLine(root, "spans", "person-lookup", "2026-08-03", `{"n":2}`);
    const { cursors } = readEventStreamLinesFrom(root, "spans", new Map());
    truncateSync(join(root, "spans", "person-lookup-2026-08-03.jsonl"), 4);
    assert.throws(() => readEventStreamLinesFrom(root, "spans", cursors), /shrank .* truncated/);
  });
});

describe("stream files and the D86 prune", () => {
  it("prunes span/note files strictly older than 30 days and fails loud on a foreign file", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    appendEventStreamLine(root, "spans", "person-lookup", "2026-07-01", "{}");
    appendEventStreamLine(root, "spans", "person-lookup", "2026-07-05", "{}");
    appendEventStreamLine(root, "notes", "person-lookup", "2026-06-30", "{}");
    appendEventStreamLine(root, "notes", "person-lookup", "2026-08-03", "{}");
    const report = pruneEventStreams({ stateRoot: root, clock });
    assert.equal(report.cutoffDate, "2026-07-04");
    assert.equal(report.removed.length, 2);
    assert.deepEqual(listEventStreamFiles(root, "spans").map((file) => file.date), ["2026-07-05"]);
    assert.deepEqual(listEventStreamFiles(root, "notes").map((file) => file.date), ["2026-08-03"]);

    mkdirSync(join(root, "spans"), { recursive: true });
    writeFileSync(join(root, "spans", "not-a-stream.txt"), "stray");
    assert.throws(() => listEventStreamFiles(root, "spans"), /not-a-stream\.txt/);
    assert.throws(() => pruneEventStreams({ stateRoot: root, clock }), /not-a-stream\.txt/);
  });

  it("refuses a multi-line append", () => {
    assert.throws(
      () => appendEventStreamLine(stateRoot(), "spans", "person-lookup", "2026-08-03", "{}\n{}"),
      /one line per event/,
    );
  });
});
