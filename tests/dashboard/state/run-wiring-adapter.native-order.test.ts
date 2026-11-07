import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
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
        at: "2026-08-03T23:00:00.000Z", label: "Same label", state: "skipped", notRun: { state: "present", reason: "condition-false" } }] },
      gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "running" },
      context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs"] }),
    logs: NotePageSchema.parse({ runId: RUN, rows: [
      { kind: "transaction-fenced", native: native(7), logId: id(107), sequence: 0,
        at: AT, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/first#1`, producer: { nodeId: "first", step: "Same label", taskId: "ucpath/create-termination", system: "ucpath" } },
      { kind: "note", native: note.native, logId: note.noteId, sequence: 1, note },
      { kind: "transaction-fenced", native: native(3, "crm"), logId: id(103), sequence: 2,
        at: "2026-08-03T22:00:00.000Z", attempt: 1, traceId: TRACE, spanPath: `${TRACE}/crm#1`, producer: { nodeId: "crm", step: "Same label", taskId: "crm/read-onboarding-dates", system: "crm" } },
    ], notes: [note], nextCursor: { state: "absent", reason: "end-of-page" } }),
    sections: [], unavailableEvidence: [],
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
