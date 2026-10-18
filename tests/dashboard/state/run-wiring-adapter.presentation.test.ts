import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../src/models/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../support/fixtures/plan1-operation-workflows.js";
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
  it("shows an identical field from several observation sources once and retains its first time", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const repeated = { ...source, native: native(6), logId: id(106), sequence: 6, at: "2026-08-03T17:01:00.000Z",
      points: [{ ...source.points[0], field: "selection.selected.name" }] };
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), repeated] });
    const fields = projectRunLogs({ ...original, logs }, client).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    assert.deepEqual(fields.filter(field => field.label === "Name").map(field => [field.id, field.time, field.value]),
      [[`${id(104)}:0`, "10:00:00", "Quillan, Petra A."]]);
    assert.equal(logs.rows?.filter(row => row.kind === "observed").length, 3);
    assert.deepEqual(logs.rows?.at(-1), repeated);
  });
  it("keeps different values within a step and the same field in another step", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const different = { ...source, native: native(6), logId: id(106), sequence: 6,
      displayFields: [{ direction: "read", label: "Name", value: "Fable, Rowan B." }] };
    const otherStep = { ...source, native: native(7, "cross-verify"), logId: id(107), sequence: 7,
      spanPath: `${TRACE}/cross-verify#1`, producer: { ...source.producer, nodeId: "cross-verify", step: "Cross-check identity", system: "crm" } };
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), different, otherStep] });
    const detail = RunDetailWireSchema.parse({ ...original.detail, timeline: { ...original.detail.timeline,
      steps: [...(original.detail.timeline.steps ?? []), { key: "cross-verify", label: "Cross-check identity", state: "done",
        members: [{ nodeId: "cross-verify", categoryKey: "cross-verify", label: "Cross-check identity", state: "done" }] }] } });
    const projected = projectRunLogs({ ...original, detail, logs }, client);
    assert.deepEqual(projected.steps.map(step => [step.title, step.entries.flatMap(entry => entry.kind === "fields"
      ? entry.fields.filter(field => field.label === "Name").map(field => field.value) : [])]),
      [["Search for person", ["Quillan, Petra A.", "Fable, Rowan B."]], ["Cross-check identity", ["Quillan, Petra A."]]]);
  });
  it("retains a verified screenshot when all fields in its observation collapse", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const definition = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay,
      workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint });
    assert.ok(definition);
    const occurrence = { runId: RUN, attempt: 1, claimGeneration: 1, taskAttempt: 1, definitionFingerprint: definition.definitionFingerprint,
      invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page",
      logicalActionId: "consume-text", logicalSessionId: "plan1-local", occurrence: 1, state: "completed" };
    const repeated = { ...source, native: native(6, "first"), logId: id(106), sequence: 6, at: "2026-08-03T17:01:00.000Z", spanPath: `${TRACE}/first#1`,
      producer: { ...source.producer, nodeId: "first", taskId: "ocr/extract-form-page" } };
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), repeated],
      operationStructure: { state: "observed", runId: RUN, definition,
        observations: [{ logId: repeated.logId, at: AT, action: "read", targetId: "consume-text", occurrence: { ...occurrence, value: { slot: "text", fieldPath: "text",
          producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } } }] } });
    const category = original.detail.timeline.steps?.[0]; assert.ok(category);
    const detail = RunDetailWireSchema.parse({ ...original.detail, timeline: { ...original.detail.timeline,
      steps: [{ ...category, members: [...category.members, { nodeId: "first", categoryKey: "searching", label: "Read", state: "done" }] }] } });
    const capture = original.sections[0]; assert.ok(capture.section === "captures");
    const captures = RunDetailSectionResponseSchema.parse({ ...capture, payload: { ...capture.payload,
      artifacts: capture.payload.artifacts.map(artifact => ({ ...artifact,
        origins: artifact.origins.map(origin => ({ ...origin, operation: occurrence })) })) } });
    const projected = projectRunLogs({ ...original, detail, logs, sections: [captures] }, client);
    const entries = projected.steps.flatMap(step => step.entries);
    assert.equal(entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []).filter(field => field.label === "Name").length, 1);
    const screenshot = entries.find(entry => entry.id === `${repeated.logId}:captures`);
    assert.ok(screenshot?.kind === "decision");
    assert.equal(screenshot.time, "10:01:00");
    assert.deepEqual(screenshot.decision.screenshots?.map(shot => [shot.src, shot.time, shot.width, shot.height]),
      [[`/artifacts/${id(501)}`, "10:00:00", 1280, 720]]);
    assert.equal(entries.filter(entry => entry.kind === "click").length, 1);
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
