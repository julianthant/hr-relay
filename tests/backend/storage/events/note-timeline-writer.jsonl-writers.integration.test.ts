
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { timelineNoteLocation,timelineSpanLocation,type TimelineLine } from "../../../../src/backend/storage/events/timeline-reader.js";
import { TimelineEventRecordSchema,timelineAppendContent,type TimelineEventRecord,type TimelineRepository } from "../../../../src/models/events/timeline.js";
import { NoteWireSchema,projectNoteForOperator } from "../../../../src/models/events/types.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { localDatePart,manualClock,type Clock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { DeclaredActionOccurrenceSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const roots: string[] = [];
const repositories = new Map<string, TimelineRepository>();
function repositoryOf(root: string): TimelineRepository {
  let repository = repositories.get(root);
  if (repository === undefined) {
    const records: TimelineEventRecord[] = [];
    repository = { withReadSnapshot: read => read(), get: id => records.find(record => record.eventId === id),
      page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0,
      append(input) {
        const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
        const previous = records.find(row => row.eventId === record.eventId);
        if (previous !== undefined) {
          if (timelineAppendContent(previous) !== timelineAppendContent(record)) throw new Error("timeline-event-identity-conflict");
          return { state: "existing", record: previous };
        }
        canonicalJsonStringify(record); records.push(record); return { state: "inserted", record };
      } };
    repositories.set(root, repository);
  }
  return repository;
}
function nativeLines(root: string, kind: "spans" | "notes"): readonly TimelineLine[] {
  return repositoryOf(root).page({}).flatMap(record => {
    if (kind === "spans" && record.payload.kind === "span") return [timelineSpanLocation(record)];
    if (kind === "notes" && record.payload.kind === "note") return [timelineNoteLocation(record)];
    return [];
  });
}

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-events-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  repositories.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TRACE = "pl-104233-3b8f";
const AT = new Date("2026-08-03T10:42:33.000-07:00");

describe("native note writer and classified fields", () => {
  it("retains classified values and counts invalid fields", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
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
      { key: "ssn", kind: "text", value: canarySsn },
      { key: "resultCount", kind: "text", value: "3" },
      { key: "invalidFields", kind: "count", value: 2 },
    ]);
    const bytes = nativeLines(root, "notes")[0].text;
    assert.equal(bytes.includes(canaryPassword), false);
    assert.equal(bytes.includes(canarySsn), true);
  });

  it("keeps generic note ingress append-at-now without authority scoping", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
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

    assert.deepEqual([...new Set(nativeLines(root, "notes").map(line => line.file.date))], ["2026-08-03", "2026-08-06"]);
  });

  it("uses one instant for run-scope validation, note timestamp, and append retention date", () => {
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
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
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

    const files = nativeLines(root, "notes").map(line => line.file);
    assert.equal(calls, 1);
    assert.equal(files.length, 1);
    const noteFile = files[0];
    assert.ok(noteFile);
    assert.equal(noteFile.date, localDatePart(noteAt));
    const stored = NoteWireSchema.parse(JSON.parse(nativeLines(root, "notes")[0].text));
    assert.equal(note.ts, noteAt.toISOString());
    assert.equal(stored.ts, noteAt.toISOString());
    assert.equal(stored.message, "roster match completed");
  });

  it("records typed values with action verbs and targets in protected-run Logs", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
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
    const bytes = nativeLines(root, "notes")[0].text;
    assert.equal(bytes.includes("951-57-1700"), true);
    assert.equal(bytes.includes("ucpath.person-org.eid-input"), true);
  });

  it("drops a protected declared action value again at the durable note boundary", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
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
                kind: "test-data-local",
                inputPath: "emplId",
                name: "personLookupCanaryEid",
                sourceId: "00000000-0000-4000-8000-000000000001",
              },
            },
          },
        }),
      },
    }, run);
    assert.equal(note.action?.value, undefined);
    assert.doesNotMatch(note.message, /RAW_PROTECTED_BROWSER_VALUE/u);
    const line = nativeLines(root, "notes")[0];
    assert.ok(line);
    const bytes = line.text;
    assert.equal(bytes.includes(rawProtectedValue), false);
  });

  it("refuses arbitrary run-task note text at the writer boundary", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock: manualClock(new Date(run.updatedAt)), pid: 7 });
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
    assert.deepEqual(nativeLines(root, "notes"), []);
  });

  it("refuses a non-note ingress instead of writing a best guess", () => {
    const writer = createNoteTimelineWriter({ repository: repositoryOf(stateRoot()), clock: manualClock(AT), pid: 7 });
    assert.throws(() => writer.emitNote({ workflow: "person-lookup", level: "step", message: "no address" }));
    assert.throws(() => writer.emitNote({
      workflow: "person-lookup",
      address: { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE },
      level: "step",
      message: "",
    }));
  });
});
