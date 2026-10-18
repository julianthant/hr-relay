import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { browserActionMessage } from "../../../src/models/events/types.js";

const RUN = "00000000-0000-4000-8000-000000000080", TRACE = "pl-100000-0080", AT = "2026-08-03T17:00:00.000Z";
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const native = (order: number, nodeId = "searching") => NativeRunEventWireSchema.parse({ eventId: id(order), order, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath: `${TRACE}/${nodeId}#1` });
function snapshot(): RunLogSnapshot {
  const note = (order: number, message: string, screenshot?: { bundleId: string; artifactId: string; sessionId: string }) => ({
    kind: "note" as const, native: native(order), logId: id(order + 100), sequence: order,
    note: { native: native(order), noteId: id(order + 100), runId: RUN, sequence: order, at: AT, level: "info", message, ...(order === 3 ? { operatorAction: { kind: "click", label: "Person Org Search button", system: "ucpath" } } : {}), ...(screenshot === undefined ? {} : { screenshot }) },
  });
  const observed = (order: number, direction: "read" | "write", field: string, value: string) => ({
    kind: "observed" as const, native: native(order), logId: id(order + 100), sequence: order, at: AT, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1`,
    producer: { nodeId: "searching", step: "Search for person", taskId: "ucpath/search-person-org", system: "ucpath" },
    displayFields: [{ direction, label: field === "emplId" ? "Employee ID" : "Name", value }],
    points: [{ direction, field, values: [{ key: field, state: "allowed", classification: "safe-diagnostic", transform: "allow", value }] }],
  });
  const association = { bundleId: id(500), artifactId: id(501), sessionId: id(502) };
  const rows = [observed(2, "write", "emplId", "10000001"),
    note(3, browserActionMessage({ kind: "clicked", targetId: "ucpath.person-org.search-button" })),
    observed(4, "read", "name", "Quillan, Petra A."),
    note(5, browserActionMessage({ kind: "screenshot", targetId: "ucpath.task-capture", value: `${association.bundleId}:${association.artifactId}` }), association)];
  const logs = NotePageSchema.parse({ runId: RUN, rows, notes: rows.flatMap(row => row.kind === "note" ? [row.note] : []), confirmedActions: [], confirmedActionBindings: [], nextCursor: { state: "absent", reason: "end-of-page" } });
  const detail = RunDetailWireSchema.parse({ runId: RUN, rowRevision: 1, panelKind: "run", header: { runId: RUN, traceId: TRACE, workflowId: "person-lookup", title: "Quillan, Petra A.", status: "done", attempt: 1 },
    timeline: { steps: [{ key: "searching", label: "Search for person", state: "done", members: [{ nodeId: "searching", categoryKey: "searching", label: "Search for person", state: "done" }] }],
      events: [{ native: native(1), categoryKey: "searching", noteId: id(101), sequence: 0, at: AT, label: "Search for person", state: "done", notRun: { state: "absent", reason: "ran" } }] },
    gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "fixture has no receipt section" }, context: { dataFacts: 2, evidenceFacts: 1, attempts: 1 }, availableSections: ["logs", "captures"] });
  const captures = RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: [{
    artifact: { mediaKind: "image", mediaType: "image/png", artifactId: association.artifactId, sha256: "a".repeat(64), byteLength: 1, sensitivity: "restricted", redaction: "restricted-access", width: 1280, height: 720 },
    origins: [{ bundleId: association.bundleId, originKind: "operator-request", capturedAt: AT, browserCapture: { nodeId: "searching", attempt: 1, sessionId: association.sessionId } }],
  }] } });
  return { detail, logs, sections: [captures], actionEvidence: { state: "available", events: [], missingPages: [] }, confirmedActionBindings: [], unavailableEvidence: [] };
}
const client = { artifactUrl: (artifactId: string) => `/artifacts/${artifactId}` };
describe("served Person Lookup Logs operator presentation", () => {
  it("nests native-order Fill, Click, Read and Screenshot entries under their step and system", () => {
    const logs = projectRunLogs(snapshot(), client);
    assert.deepEqual(logs.steps.map(step => [step.title, step.system?.toLowerCase()]), [["Search for person", "ucpath"]]);
    const entries = logs.steps[0].entries;
    assert.deepEqual(entries.map(entry => entry.kind), ["fields", "click", "fields", "decision"]);
    assert.equal(entries[0].kind === "fields" && entries[0].fields[0].kind, "fill");
    assert.equal(entries[2].kind === "fields" && entries[2].fields[0].kind, "read");
    assert.equal(entries[1].kind === "click" && entries[1].label, "Person Org Search button");
    const capture = entries[3]; assert.ok(capture.kind === "decision");
    assert.deepEqual(capture.decision.screenshots?.map(shot => [shot.src, shot.width, shot.height]), [[`/artifacts/${id(501)}`, 1280, 720]]);
  });
  it("keeps an unassociated screenshot explicitly unavailable", () => {
    const original = snapshot();
    const rows = original.logs.rows?.flatMap(row => row.kind === "note" && row.note.screenshot !== undefined
      ? [{ ...row, note: { ...row.note, screenshot: undefined, operatorAction: { kind: "screenshot" as const, label: "Screenshot" } } }] : []);
    assert.ok(rows);
    const logs = NotePageSchema.parse({ ...original.logs, rows, notes: rows.map(row => row.note) });
    const text = logPlainText(projectRunLogs({ ...original, logs, sections: [] }, client).steps);
    assert.match(text, /Screenshot unavailable: no verified capture association/u);
    assert.doesNotMatch(text, /completed|recorded/u);
  });
  it("keeps internal capture labels, raw target IDs and bare completion states out of operator copy", () => {
    const logs = projectRunLogs(snapshot(), client);
    assert.doesNotMatch(logPlainText(logs.steps), /Run note|\bdone\b|ucpath\.|task capture|10000000-0000/u);
    const screenshots = logs.steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "decision" ? entry.decision.screenshots ?? [] : entry.kind === "fields" || entry.kind === "click" ? entry.screenshots ?? [] : []));
    assert.equal(screenshots.length, 1);
    assert.ok(screenshots.every(shot => shot.label === undefined || !shot.label.includes(id(500))));
  });
});
