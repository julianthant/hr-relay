import { createJsonlWriterTestWorld } from "../../../support/helpers/backend/jsonl-writer-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { NoteWireSchema, projectNoteForOperator } from "../../../../src/models/events/types.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { localDatePart, manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { DeclaredActionOccurrenceSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { freezeWorkflowOperationDisplaySnapshot, WorkflowOperationDisplaySnapshotSchema } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const {repositoryOf, nativeLines, stateRoot, RUN_ID, TRACE, AT, cleanup } = createJsonlWriterTestWorld();


function boundBrowserRun() {
  const run = RunRecordSchema.parse(personLookupQueuedRun());
  const frozen = freezeWorkflowOperationDisplaySnapshot({ workflowId: run.envelope.workflow,
    definitionFingerprint: run.envelope.contractFingerprint, display: plan1Leaf.descriptor.operationDisplay });
  assert.ok(frozen);
  const original = frozen.invocations[0];
  const snapshot = WorkflowOperationDisplaySnapshotSchema.parse({ ...frozen, invocations: [{ ...original,
    id: "search-operation", taskId: "ucpath/search-person-org",
    bindings: [{ slot: "empl-id", value: { kind: "run-input", path: "emplId" } }],
    operation: { ...original.operation, system: "ucpath",
      session: { kind: "browser", id: "ucpath-worker", system: "ucpath" },
      actions: [{ id: "fill-eid", kind: "fill-field", target: "ucpath.person-org.eid-input", valueSlot: "empl-id" }],
      values: [{ id: "empl-id", presentation: "local-operator", source: { kind: "contract-input", path: "emplId" } }] } }] });
  return { ...run, envelope: { ...run.envelope, operationDisplaySnapshot: snapshot } };
}


afterEach(cleanup);

describe("native note writer and classified fields", () => {
  it("retains classified values and counts invalid fields", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
    const canaryPassword = "hunter2-canary-password";
    const canarySsn = "902-48-1357";
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
      { key: "ssn", kind: "text", value: "[SSN masked]" },
      { key: "resultCount", kind: "text", value: "3" },
      { key: "invalidFields", kind: "count", value: 2 },
    ]);
    const bytes = nativeLines(root, "notes")[0].text;
    assert.equal(bytes.includes(canaryPassword), false);
    assert.equal(bytes.includes(canarySsn), false);
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
    const run = boundBrowserRun();
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
      action: { kind: "typed", targetId: "ucpath.person-org.eid-input", value: "902-48-1357", at: clock.now().toISOString(),
        operation: DeclaredActionOccurrenceSchema.parse({ runId: run.envelope.runId,
          definitionFingerprint: run.envelope.contractFingerprint, nodeId: run.envelope.operationDisplaySnapshot.invocations[0].entryId,
          taskId: "ucpath/search-person-org", attempt: 1, claimGeneration: 1, taskAttempt: 1,
          invocationId: "search-operation", occurrencePath: run.envelope.operationDisplaySnapshot.invocations[0].occurrencePath,
          logicalActionId: "fill-eid", occurrence: 1, logicalSessionId: "ucpath-worker",
          physicalSessionId: "00000000-0000-4000-8000-000000000001",
          value: { slot: "empl-id", fieldPath: "emplId", producer: { kind: "run-input", path: "emplId" },
            consumed: { state: "observed", value: "902-48-1357" } } }) },
    }, run);
    assert.equal(note.message, 'Typed "[SSN masked]" into ucpath person org eid input');
    assert.equal(projectNoteForOperator(note, true).message, note.message);
    const bytes = nativeLines(root, "notes")[0].text;
    assert.equal(bytes.includes("902-48-1357"), false);
    assert.equal(bytes.includes("ucpath.person-org.eid-input"), true);
  });

  it("masks SSN leaves in persisted admitted actions and keeps ordinary HR values", () => {
    const root = stateRoot();
    const run = boundBrowserRun();
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
    for (const value of ["902-48-1357", "902481357", { nested: ["902 48 1357", "10873698"] }, "10873698"]) {
      const operation = DeclaredActionOccurrenceSchema.parse({ runId: run.envelope.runId,
        definitionFingerprint: run.envelope.contractFingerprint,
        nodeId: run.envelope.operationDisplaySnapshot.invocations[0].entryId,
        taskId: "ucpath/search-person-org", attempt: 1, claimGeneration: 1, taskAttempt: 1,
        invocationId: "search-operation", occurrencePath: run.envelope.operationDisplaySnapshot.invocations[0].occurrencePath,
        logicalActionId: "fill-eid", occurrence: 1, logicalSessionId: "ucpath-worker",
        physicalSessionId: "00000000-0000-4000-8000-000000000001",
        value: { slot: "empl-id", fieldPath: "emplId", producer: { kind: "run-input", path: "emplId" },
          consumed: { state: "observed", value } },
      });
      const note = writer.emitRunAction({ workflow: run.envelope.workflow,
        address: { runId: run.envelope.runId, attempt: run.envelope.attempt,
          traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/searching#1` },
        action: { kind: "typed", targetId: "ucpath.person-org.eid-input", at: clock.now().toISOString(), operation,
          ...(typeof value === "string" ? { value } : {}) },
      }, run);
      for (const ssn of ["902-48-1357", "902481357", "902 48 1357"]) assert.equal(JSON.stringify(note).includes(ssn), false);
      if (value === "10873698" || typeof value === "object") assert.equal(JSON.stringify(note).includes("10873698"), true);
      assert.deepEqual(note.action?.operation?.value?.producer, operation.value?.producer);
    }
    const persisted = nativeLines(root, "notes").map(line => line.text).join("\n");
    for (const ssn of ["902-48-1357", "902481357", "902 48 1357"]) assert.equal(persisted.includes(ssn), false);
    assert.equal(persisted.includes("10873698"), true);
  });

  it("refuses malformed screenshot artifact associations before durability", () => {
    const root = stateRoot();
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const clock = manualClock(new Date(run.updatedAt));
    const writer = createNoteTimelineWriter({ repository: repositoryOf(root), clock, pid: 7 });
    for (const value of [undefined, "private screenshot text", "not-a-uuid:not-a-uuid"]) {
      assert.throws(() => writer.emitRunAction({
        workflow: run.envelope.workflow,
        address: { runId: run.envelope.runId, attempt: run.envelope.attempt,
          traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/searching#1` },
        action: { kind: "screenshot", targetId: "ucpath.browser-capture", at: clock.now().toISOString(), value },
      }, run));
    }
    assert.deepEqual(nativeLines(root, "notes"), []);
    const association = "aaaaaaaa-aaaa-4aaa-8aaa-a902481357aa:bbbbbbbb-bbbb-4bbb-8bbb-b902481357bb";
    const note = writer.emitRunAction({ workflow: run.envelope.workflow,
      address: { runId: run.envelope.runId, attempt: run.envelope.attempt,
        traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/searching#1` },
      action: { kind: "screenshot", targetId: "ucpath.browser-capture", at: clock.now().toISOString(), value: association },
    }, run);
    assert.equal(note.action?.value, association, "validated structural artifact identity remains exact");
  });

  it("drops a protected declared action value again at the durable note boundary", () => {
    const root = stateRoot();
    const run = boundBrowserRun();
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
          definitionFingerprint: run.envelope.contractFingerprint,
          nodeId: run.envelope.operationDisplaySnapshot.invocations[0].entryId,
          taskId: "ucpath/search-person-org",
          attempt: 1,
          claimGeneration: 1,
          taskAttempt: 1,
          invocationId: "search-operation",
          occurrencePath: run.envelope.operationDisplaySnapshot.invocations[0].occurrencePath,
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
