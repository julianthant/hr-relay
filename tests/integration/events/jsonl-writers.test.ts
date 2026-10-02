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
import { ObservedDataPointSchema } from "../../../src/backend/logs/span-emitter.js";
import { localDatePart, manualClock, type Clock } from "../../../src/domain/clock.js";
import { RedactedFieldSchema } from "../../../src/domain/redaction.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { DeclaredActionOccurrenceSchema } from "../../../src/domain/task-provenance.js";
import { NoteWireSchema, SpanEventWireSchema, projectNoteForOperator } from "../../../src/domain/events/types.js";
import {
  appendEventStreamLine,
  listEventStreamFiles,
  pruneEventStreams,
  readEventStreamLines,
  readEventStreamLinesFrom,
  readScopedEventStreamLines,
  scopedEventStreamFiles,
} from "../../../src/backend/storage/events/jsonl-streams.js";
import { createNoteJsonlWriter } from "../../../src/backend/storage/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../../src/backend/storage/events/span-jsonl-writer.js";
import { personLookupQueuedRun } from "../../helpers/phase1f-executor-harness.js";

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
const CLASSIFICATIONS = [
  "secret", "credential-file", "direct-identifier", "sensitive-hr", "safe-diagnostic",
] as const;
const TRANSFORMS = ["drop", "digest", "last4", "basename", "count", "allow"] as const;
type Classification = typeof CLASSIFICATIONS[number];
type Transform = typeof TRANSFORMS[number];

/** Independent expected table — never derived from the production policy it verifies. */
const EXPECTED_ALLOWED_TRANSFORMS = {
  secret: new Set<Transform>(["drop", "digest", "allow"]),
  "credential-file": new Set<Transform>(["drop", "digest", "allow"]),
  "direct-identifier": new Set<Transform>(["drop", "digest", "last4", "allow"]),
  "sensitive-hr": new Set<Transform>(["drop", "digest", "count", "allow"]),
  "safe-diagnostic": new Set<Transform>(["allow", "count", "basename"]),
} satisfies Record<Classification, ReadonlySet<Transform>>;

function redactedPairValue(classification: Classification, transform: Transform): Record<string, unknown> {
  const base = { key: "selection.value", classification, transform };
  switch (transform) {
    case "drop": return { ...base, state: "redacted" };
    case "digest": return { ...base, state: "transformed", value: "a".repeat(64) };
    case "last4": return { ...base, state: "transformed", value: "cret" };
    case "basename": return {
      ...base,
      state: "transformed",
      value: classification === "safe-diagnostic" ? "report.txt" : "RAW_SECRET_CANARY.txt",
    };
    case "count": return { ...base, state: "transformed", value: 7 };
    case "allow": return {
      ...base,
      state: "allowed",
      value: classification === "safe-diagnostic" ? "healthy" : "RAW_SECRET_CANARY",
    };
  }
}

function observedPairEvent(value: Record<string, unknown>): Record<string, unknown> {
  return {
    t: "data.observed", ts: AT.toISOString(), workflow: "person-lookup",
    runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: AT.toISOString(),
    points: [{ direction: "read", field: "selection.value", values: [value] }],
  };
}

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

  it("writes classified observations and refuses unclassified leaf shapes (D270)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    const observed = (values: readonly unknown[]): Record<string, unknown> => ({
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection", values }],
    });
    writer.emit(observed([
      { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
      { key: "selection.eid", state: "transformed", classification: "direct-identifier", transform: "last4", value: "6712" },
      { key: "selection.eidDigest", state: "transformed", classification: "direct-identifier", transform: "digest", value: "c".repeat(64) },
    ]));
    // The point is emitted at RECORD time, so the arm must survive being
    // written many times under one span identity — unlike an open or a close,
    // an observation is not once-per-span.
    writer.emit(observed([
      { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "ambiguous" },
    ]));
    const lines = readEventStreamLines(root, "spans").filter((line) => line.text.includes("data.observed"));
    assert.equal(lines.length, 2);
    assert.match(lines[0]?.text ?? "", /"pid":1/);
    assert.match(lines[0]?.text ?? "", /"6712"/);
    assert.match(lines[0]?.text ?? "", new RegExp(`"${"c".repeat(64)}"`));
    assert.doesNotMatch(lines[0]?.text ?? "", /10456712/);

    // An unclassified value is refused BEFORE any byte reaches disk: the wire
    // leaf has no arm for a bare `{key, value}` without a classification.
    assert.throws(() => writer.emit(observed([{ key: "selection.eid", value: "10456712" }])));
    const after = readEventStreamLines(root, "spans").filter((line) => line.text.includes("data.observed"));
    assert.equal(after.length, 2);
  });

  it("refuses a raw EID disguised as a last4 value before appending it (D270)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    const disguised = {
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection.eid", values: [{
        key: "selection.eid",
        state: "transformed",
        classification: "direct-identifier",
        transform: "last4",
        value: "10456712",
      }] }],
    };

    assert.throws(() => writer.emit(disguised));
    assert.equal(readEventStreamLines(root, "spans").length, 0);
  });

  it("refuses a non-SHA-256 string disguised as a digest before appending it (D270)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    const disguised = {
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection.eid", values: [{
        key: "selection.eid",
        state: "transformed",
        classification: "direct-identifier",
        transform: "digest",
        value: "10456712",
      }] }],
    };

    assert.throws(() => writer.emit(disguised));
    assert.equal(readEventStreamLines(root, "spans").length, 0);
  });

  it("the durable redaction schema accepts exactly the canonical redaction pairs (D270)", () => {
    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const value = redactedPairValue(classification, transform);
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);

      assert.equal(RedactedFieldSchema.safeParse(value).success, expectedAllowed, pair);
      assert.equal(
        ObservedDataPointSchema.safeParse({ direction: "read", field: "selection.value", values: [value] }).success,
        expectedAllowed,
        `${pair} core schema`,
      );
    }
  });

  it("the observed-event wire twin accepts exactly the canonical redaction pairs (D270)", () => {
    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const event = observedPairEvent(redactedPairValue(classification, transform));
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);

      assert.equal(SpanEventWireSchema.safeParse({ ...event, pid: 1 }).success, expectedAllowed, pair);
    }
  });

  it("the JSONL writer refuses every forbidden redaction pair before append (D270)", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 1 });
    let allowedCount = 0;
    let forbiddenCount = 0;

    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const value = redactedPairValue(classification, transform);
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);
      const event = observedPairEvent(value);

      const before = readEventStreamLines(root, "spans").length;
      if (expectedAllowed) {
        assert.doesNotThrow(() => writer.emit(event), `${pair} writer`);
        allowedCount += 1;
      } else {
        assert.throws(() => writer.emit(event), /forbidden/u, `${pair} writer`);
        assert.equal(readEventStreamLines(root, "spans").length, before, `${pair} appended before refusal`);
        forbiddenCount += 1;
      }
    }

    const lines = readEventStreamLines(root, "spans");
    assert.equal(allowedCount, 17);
    assert.equal(forbiddenCount, 13);
    assert.equal(lines.length, allowedCount);
    assert.equal(lines.some(({ text }) => text.includes("RAW_SECRET_CANARY")), true);
    for (const classification of CLASSIFICATIONS) {
      const expected = redactedPairValue(classification, "allow");
      const retained = lines.map(({ text }) => SpanEventWireSchema.parse(JSON.parse(text)))
        .find(event => event.t === "data.observed" && event.points.some(point => point.values.some(value => value.classification === classification && value.transform === "allow")));
      assert.ok(retained?.t === "data.observed", `${classification} complete allowed value missing`);
      assert.deepEqual(retained.points[0]?.values, [expected]);
    }
    for (const invalid of [
      { key: "selection.value", state: "allowed", classification: "unknown", transform: "allow", value: "complete" },
      { key: "selection.value", state: "allowed", classification: "secret", transform: "unknown", value: "complete" },
      { key: "selection.value", state: "allowed", classification: "secret", transform: "allow", value: "complete", undeclared: true },
    ]) {
      assert.equal(RedactedFieldSchema.safeParse(invalid).success, false);
      assert.equal(SpanEventWireSchema.safeParse({ ...observedPairEvent(invalid), pid: 1 }).success, false);
      assert.throws(() => writer.emit(observedPairEvent(invalid)));
      assert.equal(readEventStreamLines(root, "spans").length, allowedCount);
    }
  });
});

describe("note JSONL writer and classified fields", () => {
  it("retains classified values and counts invalid fields", () => {
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
    assert.deepEqual(fields, [
      { key: "password", kind: "text", value: canaryPassword },
      { key: "ssn", kind: "text", value: canarySsn },
      { key: "resultCount", kind: "text", value: "3" },
      { key: "invalidFields", kind: "count", value: 1 },
    ]);
    const bytes = readFileSync(readEventStreamLines(root, "notes")[0].file.path, "utf8");
    assert.equal(bytes.includes(canaryPassword), true);
    assert.equal(bytes.includes(canarySsn), true);
  });

  it("keeps generic note ingress append-at-now without authority scoping", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createNoteJsonlWriter({ stateRoot: root, clock, pid: 7 });
    const emit = (message: string): void => {
      writer.emitNote({
        workflow: "person-lookup",
        address: { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE },
        level: "step",
        message,
      });
    };
    emit("at the run's own day");
    clock.setWall(new Date(AT.getTime() + 3 * 24 * 60 * 60 * 1000));
    emit("three days later");
    // Generic `emitNote` is for callers that do not hold run authority. The
    // production task producer uses `emitRunNote` to assert the same append
    // instant against the run's partition scope.
    assert.deepEqual(listEventStreamFiles(root, "notes").map(({ date }) => date), ["2026-08-03", "2026-08-06"]);
  });

  it("uses one instant for run-scope validation, note timestamp, and append-day partition", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const noteAt = new Date(run.updatedAt);
    const nextDay = new Date(noteAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    let calls = 0;
    const base = manualClock(AT);
    const clock: Clock = {
      ...base,
      now: () => {
        calls += 1;
        return calls === 1 ? noteAt : nextDay;
      },
    };
    const writer = createNoteJsonlWriter({ stateRoot: root, clock, pid: 7 });
    const note = writer.emitRunNote({
      workflow: run.envelope.workflow,
      address: {
        runId: run.envelope.runId,
        attempt: run.envelope.attempt,
        traceId: run.envelope.traceId,
        spanPath: run.envelope.traceId,
      },
      kind: "roster-match-completed",
    }, run);

    const files = listEventStreamFiles(root, "notes");
    assert.equal(calls, 1);
    assert.equal(files.length, 1);
    const noteFile = files[0];
    assert.ok(noteFile);
    assert.equal(noteFile.date, localDatePart(noteAt));
    const stored = NoteWireSchema.parse(JSON.parse(readFileSync(noteFile.path, "utf8")));
    assert.equal(note.ts, noteAt.toISOString());
    assert.equal(stored.ts, noteAt.toISOString());
    assert.equal(stored.message, "roster match completed");
  });

  it("records typed values with action verbs and targets in protected-run Logs", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteJsonlWriter({ stateRoot: root, clock, pid: 7 });
    const note = writer.emitRunAction({
      workflow: run.envelope.workflow,
      address: {
        runId: run.envelope.runId,
        attempt: run.envelope.attempt,
        traceId: run.envelope.traceId,
        spanPath: run.envelope.traceId,
      },
      action: { kind: "typed", targetId: "ucpath.person-org.eid-input", value: "951-57-1700", at: clock.now().toISOString() },
    }, run);
    assert.equal(note.message, 'Typed "951-57-1700" into ucpath person org eid input');
    assert.equal(projectNoteForOperator(note, true).message, note.message);
    const bytes = readFileSync(readEventStreamLines(root, "notes")[0].file.path, "utf8");
    assert.equal(bytes.includes("951-57-1700"), true);
    assert.equal(bytes.includes("ucpath.person-org.eid-input"), true);
  });

  it("drops a protected declared action value again at the durable note boundary", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteJsonlWriter({ stateRoot: root, clock, pid: 7 });
    const rawProtectedValue = "RAW_PROTECTED_BROWSER_VALUE";
    const note = writer.emitRunAction({
      workflow: run.envelope.workflow,
      address: {
        runId: run.envelope.runId,
        attempt: run.envelope.attempt,
        traceId: run.envelope.traceId,
        spanPath: run.envelope.traceId,
      },
      action: {
        kind: "typed",
        targetId: "ucpath.person-org.eid-input",
        value: rawProtectedValue,
        at: clock.now().toISOString(),
        physicalSessionId: "00000000-0000-4000-8000-000000000001",
        operation: DeclaredActionOccurrenceSchema.parse({
          runId: run.envelope.runId,
          definitionFingerprint: "a".repeat(64),
          nodeId: "search",
          taskId: "ucpath/search-person-org",
          attempt: 1,
          claimGeneration: 1,
          taskAttempt: 1,
          invocationId: "search-operation",
          occurrencePath: ["search"],
          logicalActionId: "fill-eid",
          occurrence: 1,
          logicalSessionId: "ucpath-worker",
          physicalSessionId: "00000000-0000-4000-8000-000000000001",
          value: {
            slot: "empl-id",
            fieldPath: "emplId",
            producer: { kind: "run-input", path: "emplId" },
            consumed: {
              state: "redacted",
              binding: {
                kind: "legacy-protected-input",
                inputPath: "emplId",
                name: "personLookupCanaryEid",
              },
            },
          },
        }),
      },
    }, run);
    assert.equal(note.action?.value, undefined);
    assert.doesNotMatch(note.message, /RAW_PROTECTED_BROWSER_VALUE/u);
    const line = readEventStreamLines(root, "notes")[0];
    assert.ok(line);
    const bytes = readFileSync(line.file.path, "utf8");
    assert.equal(bytes.includes(rawProtectedValue), false);
  });

  it("refuses arbitrary run-task note text at the writer boundary", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const writer = createNoteJsonlWriter({ stateRoot: root, clock: manualClock(new Date(run.updatedAt)), pid: 7 });
    assert.throws(() => writer.emitRunNote({
      workflow: run.envelope.workflow,
      address: {
        runId: run.envelope.runId,
        attempt: run.envelope.attempt,
        traceId: run.envelope.traceId,
        spanPath: run.envelope.traceId,
      },
      kind: "roster-match-completed",
      message: "UNCLASSIFIED_NOTE_CANARY",
    } as never, run));
    assert.deepEqual(readEventStreamLines(root, "notes"), []);
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

describe("the D5 scoped reader — one workflow, one date range", () => {
  /** Four partitions across two workflows and three days, one line each. */
  function corpus(): string {
    const root = stateRoot();
    appendEventStreamLine(root, "notes", "person-lookup", "2026-08-10", `{"n":"pl-10"}`);
    appendEventStreamLine(root, "notes", "person-lookup", "2026-08-11", `{"n":"pl-11"}`);
    appendEventStreamLine(root, "notes", "person-lookup", "2026-08-12", `{"n":"pl-12"}`);
    appendEventStreamLine(root, "notes", "separations", "2026-08-11", `{"n":"sep-11"}`);
    return root;
  }

  it("opens only the partitions inside the scope", () => {
    const root = corpus();
    const files = scopedEventStreamFiles(root, "notes", {
      workflow: "person-lookup",
      fromDate: "2026-08-11",
      toDate: "2026-08-12",
    });
    assert.deepEqual(files.map(({ workflow, date }) => `${workflow}-${date}`), [
      "person-lookup-2026-08-11",
      "person-lookup-2026-08-12",
    ]);
  });

  it("serves a SUBSEQUENCE of the unscoped read, in the same order", () => {
    const root = corpus();
    const scoped = readScopedEventStreamLines(root, "notes", {
      workflow: "person-lookup",
      fromDate: "2026-08-10",
      toDate: "2026-08-12",
    });
    const unscoped = readEventStreamLines(root, "notes")
      .filter((line) => line.file.workflow === "person-lookup");
    assert.deepEqual(
      scoped.map(({ text, lineNumber, file }) => [file.path, lineNumber, text]),
      unscoped.map(({ text, lineNumber, file }) => [file.path, lineNumber, text]),
    );
  });

  it("includes both ends of the range", () => {
    const root = corpus();
    const lines = readScopedEventStreamLines(root, "notes", {
      workflow: "person-lookup",
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    assert.deepEqual(lines.map(({ text }) => text), [`{"n":"pl-10"}`]);
  });

  it("does not read a partition outside the scope — a corrupt one there cannot be observed", () => {
    const root = corpus();
    // Unreadable bytes on a day the scope excludes: a reader that opened it
    // would hand this to its caller's parse, so serving the in-scope lines is
    // proof the file was never touched.
    appendEventStreamLine(root, "notes", "person-lookup", "2026-08-13", "{ this is not json");
    const lines = readScopedEventStreamLines(root, "notes", {
      workflow: "person-lookup",
      fromDate: "2026-08-12",
      toDate: "2026-08-12",
    });
    assert.deepEqual(lines.map(({ text }) => text), [`{"n":"pl-12"}`]);
    // …and the same file INSIDE the scope is served verbatim for the caller to
    // refuse, exactly as the unscoped reader always did.
    const widened = readScopedEventStreamLines(root, "notes", {
      workflow: "person-lookup",
      fromDate: "2026-08-12",
      toDate: "2026-08-13",
    });
    assert.deepEqual(widened.map(({ text }) => text), [`{"n":"pl-12"}`, "{ this is not json"]);
  });

  it("refuses an inverted range by name rather than selecting nothing", () => {
    const root = corpus();
    assert.throws(
      () => scopedEventStreamFiles(root, "notes", {
        workflow: "person-lookup",
        fromDate: "2026-08-12",
        toDate: "2026-08-11",
      }),
      /the range is inverted/,
    );
  });

  it("refuses a workflow id no partition file could carry", () => {
    const root = corpus();
    assert.throws(
      () => scopedEventStreamFiles(root, "notes", {
        workflow: "Person_Lookup",
        fromDate: "2026-08-10",
        toDate: "2026-08-12",
      }),
      /no notes partition file can carry that id/,
    );
  });

  it("refuses a date that is not a date", () => {
    const root = corpus();
    assert.throws(() => scopedEventStreamFiles(root, "notes", {
      workflow: "person-lookup",
      fromDate: "yesterday",
      toDate: "2026-08-12",
    }));
  });

  it("serves nothing, without throwing, for a workflow that has written no partition", () => {
    const root = corpus();
    assert.deepEqual(readScopedEventStreamLines(root, "notes", {
      workflow: "kuali-timekeeper-annotation",
      fromDate: "2026-08-10",
      toDate: "2026-08-12",
    }), []);
  });
});
