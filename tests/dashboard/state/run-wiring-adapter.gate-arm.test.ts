import assert from "node:assert/strict";
import { it } from "vitest";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { RunDecisionWireSchema } from "../../../src/models/dashboard/run-decision.js";

const RUN = "00000000-0000-4000-8000-000000000090", TRACE = "ob-100000-0090", AT = "2026-08-03T17:00:00.000Z";
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const native = (order: number) => NativeRunEventWireSchema.parse({ eventId: id(order), order, runId: RUN, attempt: 1, traceId: TRACE, nodeId: "hire-review", spanPath: `${TRACE}/hire-review#1` });
const DECISION = RunDecisionWireSchema.parse({ type: "review-before-write", title: "Review before Relay writes", choiceLabel: "Next step",
  options: [{ id: "new-hire", label: "File as a new hire", hint: "Relay creates a new person.", send: { via: "gate-arm", gateNodeId: "hire-review", expectedVersion: 7, arm: "new-hire" } }] });
const logs = NotePageSchema.parse({ runId: RUN, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
function detail(gate: unknown, state: "blocked" | "done") {
  return RunDetailWireSchema.parse({ runId: RUN, rowRevision: 7, panelKind: "run", header: { runId: RUN, traceId: TRACE, workflowId: "onboarding", title: "Fixture Person", status: "running", attempt: 1 },
    timeline: { steps: [{ key: "hire-review", label: "Review the hire", state: "active", members: [{ nodeId: "hire-review", categoryKey: "hire-review", label: "Review the hire", state }] }],
      events: [{ native: native(1), categoryKey: "hire-review", noteId: id(101), sequence: 0, at: AT, label: "Review the hire", state, notRun: { state: "absent", reason: "ran" } }] },
    gate, outcome: { state: "absent", reason: "parked" }, context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs"] });
}
const decisions = (gate: unknown, state: "blocked" | "done") => projectRunLogs({ detail: detail(gate, state), logs, sections: [], unavailableEvidence: [] }, { artifactUrl: artifactId => `/artifacts/${artifactId}` })
  .steps.flatMap(step => step.entries);

it("puts the served hire-review decision on the open gate's line instead of a Waiting note", () => {
  const entries = decisions({ state: "open", gateId: id(200), nodeId: "hire-review", label: "Review the hire", openedAt: AT, revision: 7, decision: DECISION }, "blocked");
  assert.deepEqual(entries.map(entry => entry.kind), ["decision"]);
  const [entry] = entries;
  assert.ok(entry?.kind === "decision");
  assert.deepEqual(entry.decision, { state: "review", title: DECISION.title, served: DECISION });
});

it("prints the recorded answer on the resolved gate's line", () => {
  const answer = { optionId: "new-hire", label: "File as a new hire", at: AT, actor: { kind: "person", name: "Fixture Operator" } };
  const entries = decisions({ state: "resolved", gateId: id(200), nodeId: "hire-review", label: "Review the hire", resolution: "approved", resolvedBy: "local-operator",
    resolvedAt: AT, revision: 8, answer }, "done");
  assert.deepEqual(entries.map(entry => entry.kind), ["decision"]);
  const [entry] = entries;
  assert.ok(entry?.kind === "decision" && entry.decision.state === "review");
  assert.deepEqual(entry.decision.answered, answer);
});
