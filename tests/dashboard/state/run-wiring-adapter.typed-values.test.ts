import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, usesTypedLine } from "../../../src/models/dashboard/run-detail.js";

const RUN = "00000000-0000-4000-8000-000000000071", TRACE = "tv-100000-0071", AT = "2026-08-03T17:00:00.000Z";
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const native = (order: number, nodeId: string) => NativeRunEventWireSchema.parse({ eventId: id(order), order, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath: `${TRACE}/${nodeId}#1` });

type Typed = { readonly typedValues?: unknown; readonly usesTyped?: unknown };
function snapshot(typed: Typed, uses: Typed, reason = "operator-asserted"): RunLogSnapshot {
  const row = { kind: "observed" as const, native: native(20, "search"), logId: id(120), sequence: 0, at: AT, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/search#1`,
    producer: { nodeId: "search", step: "Search", taskId: "ucpath/search-person-org", system: "ucpath" },
    displayFields: [{ direction: "read" as const, label: "Name", value: "Lee, Jordan" }],
    points: [{ direction: "read" as const, field: "name", values: [{ key: "name", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "Lee, Jordan" }] }] };
  const detail = RunDetailWireSchema.parse({ runId: RUN, rowRevision: 1, panelKind: "run",
    header: { runId: RUN, traceId: TRACE, workflowId: "onboarding", title: "Fixture", status: "done", attempt: 1 },
    timeline: { steps: [
      { key: "crm", label: "Read CRM", state: "skipped", ...typed, members: [{ nodeId: "crm", categoryKey: "crm", label: "Read CRM", state: "skipped" }] },
      { key: "search", label: "Search", state: "done", ...uses, members: [{ nodeId: "search", categoryKey: "search", label: "Search", state: "done" }] },
    ], events: [{ native: native(10, "crm"), categoryKey: "crm", noteId: id(110), sequence: 0, at: AT, label: "Read CRM", state: "skipped", notRun: { state: "present", reason } }] },
    gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "fixture" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs"] });
  return { detail, logs: NotePageSchema.parse({ runId: RUN, rows: [row], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } }), sections: [], unavailableEvidence: [] };
}
const group = (fields: readonly unknown[]) => ({ typedValues: { title: "Operator-entered values", reading: "Not run, typed by hand", fields } });
const uses = (labels: readonly string[]) => ({ usesTyped: { line: usesTypedLine(labels), labels } });
const client = { artifactUrl: () => "unused" };
const typedFields = [
  { key: "stage", label: "Process stage", value: "Onboarding complete", mark: "Typed by hand" },
  { key: "start", label: "First day of service", value: "10/06/2026", mark: "From the earlier run" },
];

describe("typed values in Logs", () => {
  it("draws the value group as the step's first entry with labels, values and marks in served order", () => {
    const step = projectRunLogs(snapshot(group(typedFields), {}), client).steps.find(candidate => candidate.title === "Read CRM");
    assert.ok(step);
    const first = step.entries[0];
    assert.ok(first.kind === "fields");
    assert.equal(first.title, "Operator-entered values");
    assert.deepEqual(first.fields.map(field => [field.label, field.value, field.mark]), [
      ["Process stage", "Onboarding complete", "Typed by hand"], ["First day of service", "10/06/2026", "From the earlier run"]]);
  });

  it("says the automatic reading was replaced, not that the step was skipped", () => {
    const text = logPlainText(projectRunLogs(snapshot(group(typedFields), {}), client).steps);
    assert.match(text, /Automatic reading replaced with operator-entered values\./u);
    assert.doesNotMatch(text, /Skipped · Manual values/u);
  });

  it("names a withheld value without showing it", () => {
    const text = logPlainText(projectRunLogs(snapshot(group([{ key: "id", label: "Employee ID", withheld: true, mark: "Typed by hand" }]), {}), client).steps);
    assert.match(text, /Employee ID: Not shown · Typed by hand/u);
  });

  it("shows the uses line on a step that reads typed values, ahead of its own entries", () => {
    const step = projectRunLogs(snapshot(group(typedFields), uses(["Process stage", "First day of service"])), client).steps.find(candidate => candidate.title === "Search");
    assert.ok(step);
    assert.ok(step.entries[0].kind === "note");
    assert.equal(step.entries[0].message, "Uses values typed by hand: Process stage, First day of service");
    assert.ok(step.entries[1].kind === "fields");
  });

  it("draws a run with nothing typed as before", () => {
    const steps = projectRunLogs(snapshot({}, {}), client).steps;
    const text = logPlainText(steps);
    assert.match(text, /Skipped · Manual values/u);
    assert.doesNotMatch(text, /Operator-entered|Typed by hand|Uses values typed/u);
    assert.deepEqual(steps.map(step => step.entries.map(entry => entry.kind)), [["note"], ["fields"]]);
  });
});
