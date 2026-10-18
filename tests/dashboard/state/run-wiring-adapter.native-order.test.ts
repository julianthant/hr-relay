import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { ConfirmedActionEventSchema } from "../../../src/models/events/confirmed-action.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../src/models/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../support/fixtures/plan1-operation-workflows.js";
import { FIXTURE_IDENTITY_GATE, FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const TRACE = "pl-100000-0001";
const AT = "2026-08-03T12:00:00.000Z";
const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const native = (order: number, nodeId = "first", spanPath = `${TRACE}/${nodeId}#1`) => NativeRunEventWireSchema.parse({
  eventId: id(order), order, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath,
});
function snapshot(): RunLogSnapshot {
  const note = { native: native(5, "local"), noteId: id(105), runId: RUN, sequence: 1,
    at: AT, level: "info", message: "Same label" };
  return {
    detail: RunDetailWireSchema.parse({ runId: RUN, rowRevision: 1, panelKind: "run",
      header: { runId: RUN, traceId: TRACE, workflowId: "person-lookup", title: "Fixture", status: "running", attempt: 1 },
      timeline: { steps: ["first", "crm", "local"].map(nodeId => ({ key: nodeId, label: "Same label", state: "done",
        members: [{ nodeId, categoryKey: nodeId, label: "Same label", state: "done" }] })),
      events: [{ native: native(1), categoryKey: "first", noteId: id(101), sequence: 0,
        at: "2026-08-03T23:00:00.000Z", label: "Same label", state: "done", notRun: { state: "absent", reason: "ran" } }] },
      gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "running" },
      context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs"] }),
    logs: NotePageSchema.parse({ runId: RUN, rows: [
      { kind: "transaction-fenced", native: native(7), logId: id(107), sequence: 0,
        at: AT, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/first#1`, producer: { nodeId: "first", step: "Same label", taskId: "ucpath/create-termination", system: "ucpath" } },
      { kind: "note", native: note.native, logId: note.noteId, sequence: 1, note },
      { kind: "transaction-fenced", native: native(3, "crm"), logId: id(103), sequence: 2,
        at: "2026-08-03T22:00:00.000Z", attempt: 1, traceId: TRACE, spanPath: `${TRACE}/crm#1`, producer: { nodeId: "crm", step: "Same label", taskId: "crm/read-onboarding-dates", system: "crm" } },
    ], notes: [note], confirmedActions: [], confirmedActionBindings: [], nextCursor: { state: "absent", reason: "end-of-page" } }),
    sections: [], actionEvidence: { state: "available", events: [], missingPages: [] }, confirmedActionBindings: [], unavailableEvidence: [],
  };
}
const client = { artifactUrl: () => "unused" };

describe("native Logs chronology and exact joins", () => {
  it("orders interleaved UCPath, CRM and local history by native cursor despite clocks and repeated labels, focusing by key", () => {
    const projected = projectRunLogs(snapshot(), client);
    assert.deepEqual(projected.steps.map(step => step.id), [id(101), id(103), id(105), id(107)]);
    assert.deepEqual(projected.timeline.map(stage => [stage.id, stage.stepId]), [
      ["first", id(101)], ["crm", id(103)], ["local", id(105)],
    ]);
  });

  it("attaches a late confirmation to its exact row, preserving intervening actions and no standalone publication", () => {
    const base = snapshot();
    const definition = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay,
      workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint });
    assert.ok(definition);
    const event = ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "completed", eventId: "stream/1",
      workerId: "fixture-worker", workerStreamId: "stream", sequence: 1, traceId: TRACE,
      stepOccurrence: `${RUN}/1/1/1/first`, source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT,
      action: { runId: RUN, attempt: 1, claimGeneration: 1, taskAttempt: 1, definitionFingerprint: definition.definitionFingerprint,
        invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page",
        logicalActionId: "consume-text", logicalSessionId: "plan1-local", occurrence: 1, state: "completed" } });
    const target = { ...base.logs.notes[0], native: native(5) };
    const publication = { ...target, native: native(9, "first", "confirmed/first/ocr/extract-form-page/1"),
      noteId: id(109), sequence: 3, message: "Action lifecycle" };
    const logs = NotePageSchema.parse({ ...base.logs, rows: [
      ...(base.logs.rows ?? []).map(row => row.logId === target.noteId ? { ...row, native: target.native, note: target } : row),
      { kind: "note", logId: publication.noteId, native: publication.native, sequence: 3, note: publication },
    ], notes: [target, publication], confirmedActions: [event], operationStructure: { state: "observed", runId: RUN, definition,
      observations: [{ logId: target.noteId, at: AT, action: "read", targetId: "consume-text", occurrence: { ...event.action,
        value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } } }] } });
    const complete = { ...base, logs, confirmedActionBindings: [{ eventId: event.eventId, logId: target.noteId, native: publication.native }],
      actionEvidence: { state: "available" as const, events: [event], missingPages: [] } };
    const projected = projectRunLogs(complete, client);
    assert.deepEqual(projected.steps.map(step => step.id), [id(101), id(103), target.noteId, id(107)]);
    assert.equal(projected.steps.find(step => step.id === target.noteId)?.entries[1].id, event.eventId);
    assert.equal(projected.steps.flatMap(step => step.entries).filter(entry => entry.id === event.eventId).length, 1);
    const earlyNative = native(2, "first", publication.native.spanPath);
    const earlyLogs = NotePageSchema.parse({ ...logs,
      rows: logs.rows?.map(row => row.logId === publication.noteId
        ? { ...row, native: earlyNative, note: { ...publication, native: earlyNative } } : row),
      notes: [target, { ...publication, native: earlyNative }],
    });
    const early = projectRunLogs({ ...complete, logs: earlyLogs,
      confirmedActionBindings: [{ eventId: event.eventId, logId: target.noteId, native: earlyNative }] }, client);
    assert.deepEqual(early.steps.map(step => step.id), projected.steps.map(step => step.id));
    assert.equal(early.steps.find(step => step.id === target.noteId)?.entries[1].id, event.eventId);
    const second = ConfirmedActionEventSchema.parse({ ...event, eventId: "stream/2", sequence: 2 });
    const secondPublication = { ...publication, native: native(8, "first", publication.native.spanPath), noteId: id(108), sequence: 4 };
    const multipleLogs = NotePageSchema.parse({ ...logs, rows: [...(logs.rows ?? []),
      { kind: "note", logId: secondPublication.noteId, native: secondPublication.native, sequence: 4, note: secondPublication }],
      notes: [...logs.notes, secondPublication], confirmedActions: [event, second] });
    const multiple = projectRunLogs({ ...complete, logs: multipleLogs,
      actionEvidence: { state: "available", events: [event, second], missingPages: [] },
      confirmedActionBindings: [...complete.confirmedActionBindings,
        { eventId: second.eventId, logId: target.noteId, native: secondPublication.native }],
    }, client);
    assert.deepEqual(multiple.steps.find(step => step.id === target.noteId)?.entries.slice(1).map(entry => entry.id), [second.eventId, event.eventId]);
    const entryIds = multiple.steps.flatMap(step => step.entries.map(entry => entry.id));
    assert.equal(new Set(entryIds).size, entryIds.length);
    assert.equal(entryIds.filter(id => id === target.noteId).length, 1);
    for (const confirmation of [event, second]) assert.equal(entryIds.filter(id => id === confirmation.eventId).length, 1);
    assert.equal(entryIds.includes(publication.noteId), false);
    assert.equal(entryIds.includes(secondPublication.noteId), false);
    assert.throws(() => projectRunLogs({ ...complete, confirmedActionBindings: [{ ...complete.confirmedActionBindings[0], logId: base.logs.rows?.[0].logId }] } as RunLogSnapshot, client), /CONFIRMATION_TARGET_MISMATCH/);
  });

  it("enriches the exact gate-open mirror once and refuses a contradictory decision identity", () => {
    const base = snapshot();
    const gate = { ...FIXTURE_IDENTITY_GATE, runId: RUN, expectedVersion: 1,
      actions: FIXTURE_IDENTITY_GATE.actions.map(action => ({ ...action, expectedVersion: 1 })), native: native(6, "identity-approval") };
    const section = RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: { state: "available", value: gate } });
    const detail = RunDetailWireSchema.parse({ ...base.detail,
      gate: { state: "open", gateId: id(106), nodeId: "identity-approval", label: gate.label, openedAt: AT, revision: 1 },
      timeline: { steps: [...(base.detail.timeline.steps ?? []), { key: "identity", label: gate.label, state: "blocked",
        members: [{ nodeId: "identity-approval", categoryKey: "identity", label: gate.label, state: "blocked" }] }],
      events: [...base.detail.timeline.events, { noteId: id(106), sequence: 6, at: AT, label: gate.label, state: "blocked",
        native: gate.native, categoryKey: "identity", notRun: { state: "absent", reason: "operator gate" } }] },
    });
    const projected = projectRunLogs({ ...base, detail, sections: [section] }, client);
    assert.deepEqual(projected.steps.map(step => step.id), [id(101), id(103), id(105), gate.gateId, id(107)]);
    assert.equal(projected.timeline.find(stage => stage.id === "identity")?.stepId, gate.gateId);
    const contradictory = RunDetailSectionResponseSchema.parse({ section: "identity-gate", payload: {
      state: "available", value: { ...gate, native: { ...gate.native, order: 8 } } } });
    assert.throws(() => projectRunLogs({ ...base, detail, sections: [contradictory] }, client), /DECISION_IDENTITY_DUPLICATE/);
  });

  it("places a parked decision by its event and refuses missing native evidence", () => {
    const base = snapshot();
    const parked = RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE,
      runId: RUN, native: { ...native(6), spanPath: undefined } } });
    assert.deepEqual(projectRunLogs({ ...base, sections: [parked] }, client).steps.map(step => step.id),
      [id(101), id(103), id(105), FIXTURE_PARKED_WRITE.writeIntentId, id(107)]);
    const missing = RunDetailSectionResponseSchema.parse({ section: "parked-write", payload: { ...FIXTURE_PARKED_WRITE, runId: RUN, native: undefined } });
    assert.throws(() => projectRunLogs({ ...base, sections: [missing] }, client), /NATIVE_IDENTITY/);
  });

  it("refuses missing, duplicate and contradictory native/category identities", () => {
    const base = snapshot();
    for (const rows of [
      base.logs.rows?.map((row, index) => index === 0 ? { ...row, native: undefined } : row),
      base.logs.rows?.map((row, index) => index === 0 ? { ...row, native: native(3) } : row),
      base.logs.rows?.map((row, index) => index === 0 ? { ...row, native: { ...native(7), attempt: 2 } } : row),
    ]) assert.throws(() => projectRunLogs({ ...base, logs: { ...base.logs, rows } } as RunLogSnapshot, client), /IDENTITY/);
    assert.throws(() => projectRunLogs({ ...base, detail: { ...base.detail, timeline: { ...base.detail.timeline,
      steps: base.detail.timeline.steps?.map((step, index) => index === 0 ? { ...step, key: "crm" } : step) } } }, client), /CATEGORY/);
  });
});
