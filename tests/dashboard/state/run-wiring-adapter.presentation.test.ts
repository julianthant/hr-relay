import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectRunLogs, type RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { NativeRunEventWireSchema, NotePageSchema, RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { browserActionMessage } from "../../../src/models/events/types.js";
import { PERSON_LOOKUP_LOG_SCENARIOS, personLookupLogSnapshot } from "../../support/fixtures/person-lookup-log-snapshots.js";

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
  const logs = NotePageSchema.parse({ runId: RUN, rows, notes: rows.flatMap(row => row.kind === "note" ? [row.note] : []), nextCursor: { state: "absent", reason: "end-of-page" } });
  const detail = RunDetailWireSchema.parse({ runId: RUN, rowRevision: 1, panelKind: "run", header: { runId: RUN, traceId: TRACE, workflowId: "person-lookup", title: "Quillan, Petra A.", status: "done", attempt: 1 },
    timeline: { steps: [{ key: "searching", label: "Search for person", state: "done", members: [{ nodeId: "searching", categoryKey: "searching", label: "Search for person", state: "done" }] }],
      events: [{ native: native(1), categoryKey: "searching", noteId: id(101), sequence: 0, at: AT, label: "Search for person", state: "done", notRun: { state: "absent", reason: "ran" } }] },
    gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "fixture has no receipt section" }, context: { dataFacts: 2, evidenceFacts: 1, attempts: 1 }, availableSections: ["logs", "captures"] });
  const captures = RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: [{
    artifact: { mediaKind: "image", mediaType: "image/png", artifactId: association.artifactId, sha256: "a".repeat(64), byteLength: 1, sensitivity: "restricted", redaction: "restricted-access", width: 1280, height: 720 },
    origins: [{ bundleId: association.bundleId, originKind: "operator-request", capturedAt: AT, browserCapture: { nodeId: "searching", attempt: 1, sessionId: association.sessionId } }],
  }] } });
  return { detail, logs, sections: [captures], unavailableEvidence: [] };
}
const client = { artifactUrl: (artifactId: string) => `/artifacts/${artifactId}` };
describe("served Person Lookup Logs operator presentation", () => {
  it("nests native-order Fill, Read and Screenshot entries under their step and system and keeps gestures out", () => {
    const logs = projectRunLogs(snapshot(), client);
    assert.deepEqual(logs.steps.map(step => [step.title, step.system?.toLowerCase()]), [["Search for person", "ucpath"]]);
    const entries = logs.steps[0].entries;
    assert.deepEqual(entries.map(entry => entry.kind), ["fields", "fields", "decision"]);
    assert.equal(entries[0].kind === "fields" && entries[0].fields[0].kind, "fill");
    assert.equal(entries[1].kind === "fields" && entries[1].fields[0].kind, "read");
    const capture = entries[2]; assert.ok(capture.kind === "decision");
    assert.deepEqual(capture.decision.screenshots?.map(shot => [shot.src, shot.width, shot.height]), [[`/artifacts/${id(501)}`, 1280, 720]]);
  });
  it("retains distinct native observations with equal labels and values in chronological order", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const repeated = { ...source, native: native(6), logId: id(106), sequence: 6, at: "2026-08-03T17:01:00.000Z",
      points: [{ ...source.points[0], field: "selection.selected.name" }] };
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), repeated] });
    const fields = projectRunLogs({ ...original, logs }, client).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    assert.deepEqual(fields.filter(field => field.label === "Name").map(field => [field.id, field.time, field.value]),
      [[`${id(104)}:0`, "10:00:00", "Quillan, Petra A."], [`${id(106)}:0`, "10:01:00", "Quillan, Petra A."]]);
    assert.equal(logs.rows?.filter(row => row.kind === "observed").length, 3);
    assert.deepEqual(logs.rows?.at(-1), repeated);
  });
  it("retains equal fill and read values and separate task invocations in one category", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const fill = { ...source, native: native(6), logId: id(106), sequence: 6,
      displayFields: [{ direction: "write", label: "Name", value: "Quillan, Petra A." }] };
    const otherTask = { ...source, native: native(7, "verify-person"), logId: id(107), sequence: 7,
      spanPath: `${TRACE}/verify-person#1`, producer: { ...source.producer, nodeId: "verify-person", taskId: "ucpath/verify-person" } };
    const category = original.detail.timeline.steps?.[0]; assert.ok(category);
    const detail = RunDetailWireSchema.parse({ ...original.detail, timeline: { ...original.detail.timeline,
      steps: [{ ...category, members: [...category.members, { nodeId: "verify-person", categoryKey: "searching", label: "Verify person", state: "done" }] }] } });
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), fill, otherTask] });
    const fields = projectRunLogs({ ...original, detail, logs }, client).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    assert.deepEqual(fields.filter(field => field.label === "Name").map(field => [field.id, field.kind, field.value]), [
      [`${id(104)}:0`, "read", "Quillan, Petra A."], [`${id(106)}:0`, "fill", "Quillan, Petra A."], [`${id(107)}:0`, "read", "Quillan, Petra A."],
    ]);
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
  it("shows a value Relay failed to read as Couldn't read, flagged unread", () => {
    const original = snapshot();
    const source = original.logs.rows?.find(row => row.kind === "observed" && row.sequence === 4);
    assert.ok(source?.kind === "observed");
    const unread = { ...source, native: native(6), logId: id(106), sequence: 6, displayFields: [{ direction: "read", label: "Status", unread: true }] };
    const logs = NotePageSchema.parse({ ...original.logs, rows: [...(original.logs.rows ?? []), unread] });
    const fields = projectRunLogs({ ...original, logs }, client).steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []);
    assert.deepEqual(fields.filter(field => field.label === "Status").map(field => [field.kind, field.value, field.unread]), [["read", "Couldn't read", true]]);
  });
  it("keeps an unassociated screenshot explicitly unavailable", () => {
    const original = snapshot();
    const rows = original.logs.rows?.flatMap(row => row.kind === "note" && row.note.screenshot !== undefined
      ? [{ ...row, note: { ...row.note, screenshot: undefined, operatorAction: { kind: "screenshot" as const, label: "Screenshot" } } }] : []);
    assert.ok(rows);
    const logs = NotePageSchema.parse({ ...original.logs, rows, notes: rows.map(row => row.note) });
    const text = logPlainText(projectRunLogs({ ...original, logs, sections: [] }, client).steps);
    assert.match(text, /No screenshot: it could not be saved\./u);
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

it("collapses only explicit same-cause aliases across Run notes while retaining transitions, systems and actions", () => {
  const original=snapshot(),source=original.logs.rows?.find(row=>row.kind==='observed'&&row.sequence===4);assert.ok(source?.kind==='observed');
  const origin={runId:RUN,attempt:1,spanPath:`${TRACE}/searching#1`,nodeId:'searching',taskId:'ucpath/search-person-org',field:'results',path:[0,'name']};
  const declaration='person-lookup/searching/1';
  const observed={...source,displayFields:source.displayFields?.map(field=>({...field,causal:{declaration,origin}}))};
  const unbound=NativeRunEventWireSchema.parse({eventId:id(6),order:6,runId:RUN,attempt:1,traceId:TRACE,spanPath:TRACE});
  const note={kind:'note',native:unbound,logId:id(106),sequence:6,note:{native:unbound,noteId:id(106),runId:RUN,sequence:6,at:AT,level:'info',message:'Synthetic run note'}};
  const alias={...observed,native:native(7,'search-identity'),logId:id(107),sequence:7,spanPath:`${TRACE}/search-identity#1`,producer:{...source.producer,nodeId:'search-identity',taskId:'workflow:person-lookup/read-resolved-identity'}};
  const independent={...observed,native:native(8,'cross-verify'),logId:id(108),sequence:8,spanPath:`${TRACE}/cross-verify#1`,producer:{...source.producer,nodeId:'cross-verify',taskId:'crm/search-onboarding-records',system:'crm'},displayFields:observed.displayFields?.map(field=>({...field,causal:{declaration,origin:{...origin,nodeId:'cross-verify',taskId:'crm/search-onboarding-records',spanPath:`${TRACE}/cross-verify#1`}}}))};
  const states=['Active','Inactive','Active'].map((value,index)=>({...source,native:native(9+index),logId:id(109+index),sequence:9+index,displayFields:[{direction:'read',label:'HR status',value,causal:{declaration:'person-lookup/searching/4',origin:{...origin,spanPath:`${TRACE}/searching#2.${index+2}`,field:'hrStatus',path:[]}}}]}));
  const click=original.logs.rows?.find(row=>row.kind==='note'&&row.note.operatorAction?.kind==='click');assert.ok(click?.kind==='note');
  const laterClick={...click,native:native(12),logId:id(112),sequence:12,note:{...click.note,native:native(12),noteId:id(112),sequence:12}};
  const category=original.detail.timeline.steps?.[0];assert.ok(category);
  const detail=RunDetailWireSchema.parse({...original.detail,timeline:{...original.detail.timeline,steps:[{...category,members:[...category.members,{nodeId:'search-identity',categoryKey:'searching',label:'Resolve identity',state:'done'}]},{key:'cross-verify',label:'Cross-check identity',state:'done',system:'crm',members:[{nodeId:'cross-verify',categoryKey:'cross-verify',label:'Cross-check identity',state:'done'}]}]}});
  const logs=NotePageSchema.parse({...original.logs,rows:[...(original.logs.rows??[]).map(row=>row.logId===source.logId?observed:row),note,alias,independent,...states,laterClick],notes:[...original.logs.notes,note.note,laterClick.note]});
  const result=projectRunLogs({...original,detail,logs},client),fields=result.steps.flatMap(step=>step.entries.flatMap(entry=>entry.kind==='fields'?entry.fields:[]));
  assert.deepEqual(fields.filter(field=>field.label==='Name').map(field=>field.id),[`${id(104)}:0`,`${id(108)}:0`]);
  assert.deepEqual(fields.filter(field=>field.label==='HR status').map(field=>field.value),['Active','Inactive','Active']);
  assert.equal(result.steps.flatMap(step=>step.entries).filter(entry=>entry.kind==='click').length,0);
  assert.match(logPlainText(result.steps),/Synthetic run note/u);
  const captured=result.steps.flatMap(step=>step.entries).find(entry=>entry.id===`${id(105)}:captures`);assert.ok(captured?.kind==='decision');assert.deepEqual(captured.decision.screenshots?.map(shot=>[shot.src,shot.width,shot.height]),[[`/artifacts/${id(501)}`,1280,720]]);
});

it("shows before- and after-submit captures as their own screenshot entries", () => {
  const base = snapshot();
  const captureRow = base.logs.rows?.find(row => row.kind === "note" && row.note.screenshot !== undefined);
  assert.ok(captureRow?.kind === "note" && captureRow.note.screenshot);
  const after = { ...captureRow, native: native(7), logId: id(107), sequence: 7,
    note: { ...captureRow.note, native: native(7), noteId: id(107), sequence: 7,
      screenshot: { ...captureRow.note.screenshot, bundleId: id(600), artifactId: id(601) } } };
  const captureSection = base.sections[0]; assert.ok(captureSection.section === "captures");
  const original = captureSection.payload.artifacts[0];
  const sections = [RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: [
    { ...original, origins: original.origins.map(origin => ({ ...origin, browserCapture: { ...origin.browserCapture, boundary: "before-submit" } })) },
    { ...original, artifact: { ...original.artifact, artifactId: id(601) }, origins: original.origins.map(origin => ({ ...origin,
      bundleId: id(600), browserCapture: { ...origin.browserCapture, boundary: "after-submit" } })) },
  ] } })];
  const rows = [...(base.logs.rows ?? []), after];
  const entries = projectRunLogs({ ...base, sections, logs: NotePageSchema.parse({ ...base.logs, rows,
    notes: rows.flatMap(row => row.kind === "note" ? [row.note] : []) }) }, client).steps.flatMap(step => step.entries);
  assert.equal(entries.filter(entry => entry.kind === "decision" && entry.decision.screenshots).length, 2);
});

it("renders capture failure from structured boundary facts and preserves independently proved write outcomes", () => {
  const base = snapshot();
  for (const state of ["pre-submit-failed", "post-submit-unknown", "post-submit-proved"] as const) {
    const note = { native: native(8), noteId: id(108), runId: RUN, sequence: 8, at: AT, level: "warning", message: "Capture unavailable.",
      fields: [{ key: "code", kind: "text", value: "BROWSER_SCREENSHOT_CAPTURE_FAILED" },
        { key: "boundary", kind: "text", value: state === "pre-submit-failed" ? "before-submit" : "after-submit" }] };
    const failure = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
      runId: RUN, traceId: TRACE, attempt: 1, workflowId: "person-lookup", nodeId: "searching", native: native(9), failureId: id(900), fingerprint: "a".repeat(64),
      code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Capture unavailable.", transient: false, writeState: "verified",
      subject: { state: "absent", reason: "fixture has no subject" },
      causeChain: [{ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Capture unavailable.", role: "primary", transient: false }],
      remediation: [{ kind: "operator-action", message: "Review recorded evidence." }], sameFingerprintSeen: 1,
      diagnosticBundle: { state: "absent", reason: "fixture has no bundle" }, occurredAt: AT,
    } } });
    const logs = NotePageSchema.parse({ ...base.logs, rows: [...(base.logs.rows ?? []), { kind: "note", logId: note.noteId, native: note.native, sequence: 8, note }], notes: [...base.logs.notes, note] });
    const result = projectRunLogs({ ...base, logs, sections: [...base.sections, ...(state === "post-submit-proved" ? [failure] : [])] }, client);
    const entry = result.steps.flatMap(step => step.entries).find(entry => entry.id === note.noteId);
    assert.ok(entry?.kind === "note");
    assert.equal(entry.captureFailure, state);
    if (state === "post-submit-proved" && failure.section === "failure" && failure.payload.state === "available") {
      const failureId = failure.payload.value.failureId;
      const decision = result.steps.flatMap(step => step.entries).find(entry => entry.id === failureId);
      assert.ok(decision?.kind === "decision");
      assert.equal(decision.decision.message, "The browser screenshot could not be captured or saved.");
      assert.equal(decision.decision.caution, "The change was saved and read back.");
      const laterFailure = RunDetailSectionResponseSchema.parse({ ...failure, payload: { ...failure.payload, value: { ...failure.payload.value,
        attempt: 2, native: { ...failure.payload.value.native, attempt: 2 } } } });
      const detail = RunDetailWireSchema.parse({ ...base.detail, header: { ...base.detail.header, attempt: 2 } });
      const earlier = projectRunLogs({ ...base, detail, logs, sections: [...base.sections, laterFailure] }, client).steps.flatMap(step => step.entries).find(entry => entry.id === note.noteId);
      assert.ok(earlier?.kind === "note");
      assert.equal(earlier.captureFailure, "post-submit-unknown");
    }
  }
});

describe("Person Lookup Logs show operator wording only", () => {
  it.each(PERSON_LOOKUP_LOG_SCENARIOS)("%s hides internal controls, diagnostics and state notes", scenario => {
    const { steps } = projectRunLogs(personLookupLogSnapshot(scenario), client);
    const text = logPlainText(steps);
    assert.doesNotMatch(text, /drill-in|View All toggle|Search button|EID input|Value not retained|Run note|Identity cross-check/u);
    assert.doesNotMatch(text, /Pending|In progress|Completed|completed\.|Write state|Resolution unavailable|annotation/u);
    assert.deepEqual([...new Set(steps.flatMap(step => step.system ?? []))].filter(system => !["UCPath", "CRM"].includes(system)), []);
    for (const step of steps) for (const entry of step.entries) for (const shot of entry.kind === "decision" ? entry.decision.screenshots ?? [] : []) assert.equal(shot.system, step.system);
  });
  it("states the write outcome of a failed step in operator words", () => {
    const decision = projectRunLogs(personLookupLogSnapshot("failed"), client).steps.flatMap(step => step.entries).find(entry => entry.kind === "decision" && entry.decision.state === "failed");
    assert.ok(decision?.kind === "decision");
    assert.equal(decision.decision.footer, "No changes were made.");
  });
  it("keeps a skipped step's reason and drops stage states the timeline already shows", () => {
    const text = logPlainText(projectRunLogs(personLookupLogSnapshot("crm-off"), client).steps);
    assert.equal(text.match(/Skipped · Not needed for this run/gu)?.length, 2);
  });
});
