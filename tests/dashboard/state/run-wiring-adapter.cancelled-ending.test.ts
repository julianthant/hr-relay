import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { projectDecision } from "../../../src/backend/runs/decisions/project-decision.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { mockQueueSurface } from "../../support/fixtures/dashboard/workflow-mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../support/fixtures/dashboard/workflow-mocks/workflow-mock-model.js";
import { NotePageSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";

const RUN = "00000000-0000-4000-8000-000000000031";
const AT = "2026-08-03T10:58:45.000Z";
const row = QueueSurfaceWireSchema.parse({
  ...mockQueueSurface({ id: RUN, workflowId: "onboarding", title: "Served subject", subject: "Served subject", draft: initialMockDraft("onboarding"), approved: true, seeded: true }, "2026-08-03T10:57:54.000Z"),
  runId: RunIdSchema.parse(RUN), status: "cancelled", endedAt: { state: "present", value: AT } });
const logs = NotePageSchema.parse({ runId: RUN, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });

// A run cancelled before its first action: every planned step is served cancelled, nothing else is recorded.
const detail = (cancellation?: unknown) => RunDetailWireSchema.parse({ runId: RUN, rowRevision: row.rowRevision, panelKind: "run",
  header: { runId: RUN, workflowId: row.workflowId, traceId: row.traceId, title: row.title, status: "cancelled", attempt: row.attempt },
  timeline: { steps: [{ key: "crm-source", label: "Read hire data", state: "cancelled", system: "crm",
    members: [{ nodeId: "crm-source", categoryKey: "crm-source", label: "Read hire data", state: "cancelled" }] }], events: [] },
  gate: { state: "absent", reason: "no gate" }, outcome: { state: "terminal", result: "cancelled", completedAt: AT },
  context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, captures: { state: "absent", reason: "not-captured" }, availableSections: ["logs"],
  ...(cancellation === undefined ? {} : { cancellation }) });
const project = (cancellation?: unknown) => projectRunLogs({ detail: detail(cancellation), logs, sections: [], unavailableEvidence: [] }, { artifactUrl: id => id });

describe("a cancelled run's Logs ending", () => {
  it("draws the served Run cancelled step last, with its time and outcome sentence", () => {
    const { steps, timeline } = project({ title: "Run cancelled", at: AT, requestedBy: "operator", outcome: "You cancelled this run." });
    const last = steps.at(-1);
    assert.equal(last?.title, "Run cancelled");
    assert.ok(last?.time !== undefined && last.time !== "—");
    assert.match(logPlainText(steps), /You cancelled this run\./u);
    assert.equal(timeline[0]?.state, "cancelled");
  });
  it("invents no node id for the run-level ending", () => {
    const { steps, timeline } = project({ title: "Run cancelled", at: AT, requestedBy: "unavailable", outcome: "This run was cancelled." });
    assert.equal(steps.filter(step => step.title === "Run cancelled").length, 1);
    assert.deepEqual(timeline.flatMap(stage => stage.substeps.map(sub => sub.id)), ["crm-source"]);
  });
  it("draws as before without the cancellation field", () => {
    assert.equal(project().steps.some(step => step.title === "Run cancelled"), false);
  });
});

describe("a run paused before its first claim", () => {
  it("leads the Paused card with the recorded queue and pause times", () => {
    const served = RunDetailWireSchema.parse({ ...detail(), header: { ...detail().header, status: "queued" },
      outcome: { state: "absent", reason: "not complete" }, decision: projectDecision("paused", []),
      heldBeforeStart: { queuedAt: "2026-08-03T10:57:54.000Z", pausedAt: AT } });
    const { steps } = projectRunLogs({ detail: served, logs, sections: [], unavailableEvidence: [] }, { artifactUrl: id => id });
    assert.deepEqual(steps.map(step => step.title), ["Queued", "Paused", "Run paused"]);
    assert.ok(steps.every(step => step.time !== "—"));
  });
});
