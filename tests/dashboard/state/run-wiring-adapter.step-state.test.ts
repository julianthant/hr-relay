import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { projectDecision } from "../../../src/backend/runs/decisions/project-decision.js";
import { mockQueueSurface } from "../../support/fixtures/dashboard/workflow-mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../support/fixtures/dashboard/workflow-mocks/workflow-mock-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";

const RUN = "00000000-0000-4000-8000-000000000041";
const row = QueueSurfaceWireSchema.parse({
  ...mockQueueSurface({ id: RUN, workflowId: "onboarding", title: "Served subject", subject: "Served subject", draft: initialMockDraft("onboarding"), approved: true, seeded: true }, "2026-08-03T10:57:54.000Z"),
  runId: RunIdSchema.parse(RUN), status: "queued", endedAt: { state: "absent", reason: "still running" } });
const TRACE = row.traceId;
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const native = (order: number, nodeId: string) => NativeRunEventWireSchema.parse({ eventId: id(order), order, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath: `${TRACE}/${nodeId}#1` });
const logs = NotePageSchema.parse({ runId: RUN, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
const event = (order: number, nodeId: string, label: string, state: "done" | "failed", at: string) =>
  ({ native: native(order, nodeId), categoryKey: "crm", noteId: id(100 + order), sequence: order, at, label, state, notRun: { state: "absent", reason: "ran" } });
const detail = () => RunDetailWireSchema.parse({ runId: RUN, rowRevision: row.rowRevision, panelKind: "run",
  header: { runId: RUN, workflowId: row.workflowId, traceId: TRACE, title: row.title, status: "queued", attempt: row.attempt },
  timeline: { steps: [{ key: "crm", label: "Read hire data", state: "failed", system: "crm", members: [
    { nodeId: "a", categoryKey: "crm", label: "Read record", state: "done" }, { nodeId: "b", categoryKey: "crm", label: "Read dates", state: "failed" }] }],
    events: [event(1, "a", "Read record", "done", "2026-08-03T10:58:00.000Z"), event(2, "b", "Read dates", "failed", "2026-08-03T10:58:20.000Z")] },
  gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "not complete" }, decision: projectDecision("paused", []),
  pausedAt: "2026-08-03T10:58:40.000Z",
  context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"] });

describe("recorded step rows", () => {
  const { steps } = projectRunLogs({ detail: detail(), logs, sections: [], unavailableEvidence: [] }, { artifactUrl: i => i });
  const notes = steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "note" ? [entry] : []));
  it("names a failed step and its state, with its own state mark and danger tone", () => {
    const failed = notes.find(note => note.state === "failed");
    assert.equal(failed?.message, "Read dates · Failed");
    assert.equal(failed?.tone, "danger");
    assert.equal(notes.find(note => note.state === "done")?.message, "Read record · Done");
  });
  it("stamps the Paused card with the recorded pause, after the last step", () => {
    const card = steps.find(step => step.title === "Run paused");
    assert.match(card?.time ?? "", /:40/u);
  });
});
