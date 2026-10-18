import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { buildRunLogsSection, runDataObservationsForRun } from "../../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupModule } from "../../../support/helpers/registered-workflows.js";
import { traceOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
it("labels every observed candidate by exact declared container paths while omitting null and undeclared fields", () => {
  const w = world();
  queuedEventOf(w, { seed: 80, descriptor: personLookupModule.descriptor });
  const run = w.authority.records.get(uuidOf(80)); assert.ok(run);
  const at = w.clock.now().toISOString();
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", runId: uuidOf(80), attempt: 1,
    traceId: traceOf(80), spanPath: `${traceOf(80)}/searching#1`, nodeId: "searching", taskId: "ucpath/search-person-org",
    points: [{ direction: "read", field: "results", values: [{ key: "results", state: "allowed", classification: "safe-diagnostic", transform: "allow",
      value: [{ emplId: "10000001", name: "Quillan, Petra A.", department: "CAMPUS DINING OPERATIONS", jobTitle: "Fictional analyst", hrStatus: "Active", internalKey: "not an operator field" },
        { emplId: "10000002", name: "Fable, Rowan B.", department: null, jobTitle: "Fictional assistant", hrStatus: "Inactive" }] }] }] });
  w.projection.ingestFromTimeline();
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority, descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(personLookupModule) }) } };
  const section = buildRunLogsSection(deps, run.envelope.runId, undefined, run);
  assert.ok(section.section === "logs");
  const row = section.payload.rows?.find(row => row.kind === "observed"); assert.ok(row?.kind === "observed");
  const fields = row.displayFields ?? [];
  assert.equal(fields.length, 9);
  for (const label of ["Employee ID", "Name", "Job title", "HR status"]) assert.equal(fields.filter(field => field.label === label).length, 2);
  assert.deepEqual(fields.filter(field => field.label === "Department").map(field => field.value), ["CAMPUS DINING OPERATIONS"]);
  assert.deepEqual(fields.filter(field => field.label === "Name").map(field => field.value), ["Quillan, Petra A.", "Fable, Rowan B."]);
  assert.doesNotMatch(JSON.stringify(fields), /results|selection\.|internalKey|null|input ·|output ·/u);
  assert.equal(row.points.length, 9);
  assert.doesNotMatch(JSON.stringify(row.points), /internalKey/u);
  assert.match(JSON.stringify(runDataObservationsForRun(deps, run, run.envelope.runId)[0].points), /internalKey/u);
  const unlabelled = buildRunLogsSection({ ...deps, descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(personLookupModule).map(origin => ({ ...origin, operatorFields: [] })) }) } }, run.envelope.runId, undefined, run);
  assert.ok(unlabelled.section === "logs");
  assert.equal(unlabelled.payload.rows?.some(row => row.kind === "observed"), false);
});

it("groups the normal registered Person Lookup helper nodes into four walkthrough headings including skipped dates", () => {
  const w = world();
  queuedEventOf(w, { seed: 81, descriptor: personLookupModule.descriptor });
  const run = w.authority.records.get(uuidOf(81)); assert.ok(run);
  const at = w.clock.now().toISOString();
  const observations = new Map([
    ["searching", { taskId: "ucpath/search-person-org", field: "results", value: [{ name: "Quillan, Petra A.", emplId: "10000001" }] }],
    ["cross-verify", { taskId: "crm/search-onboarding-records", field: "records", value: [{ name: "Quillan, Petra A.", emplId: "10000001" }] }],
    ["active-status", { taskId: "workflow:person-lookup/read-active-status", field: "state", value: "active" }],
  ]);
  for (const group of personLookupModule.descriptor.timeline) for (const node of group.nodes) {
    const base = { ts: at, workflow: "person-lookup", runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/${node.id}#1` };
    w.writer.emit({ ...base, t: "span.started", kind: "task", parentSpanPath: run.envelope.traceId, name: node.label });
    const observation = observations.get(node.id);
    if (observation !== undefined) w.writer.emit({ ...base, t: "data.observed", observedAt: at, nodeId: node.id,
      taskId: observation.taskId, points: [{ direction: "read", field: observation.field, values: [{ key: observation.field,
        state: "allowed", classification: "safe-diagnostic", transform: "allow", value: observation.value }] }] });
    const skipped = ["matching", "crm-results", "crm-only-recovery", "crm-dates"].includes(node.id);
    w.writer.emit({ ...base, t: "span.ended", kind: "task", outcome: skipped ? "skipped" : "done", ...(skipped ? { notRunReason: "condition-false" } : {}) });
  }
  w.projection.ingestFromTimeline();
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ ...personLookupModule.descriptor, dataOrigins: dataOriginViewsOf(personLookupModule) }) } };
  const detail = buildRunDetail(deps, run.envelope.runId);
  const section = buildRunLogsSection(deps, run.envelope.runId, w.projection.runFold(run.envelope.runId), run); assert.ok(section.section === "logs");
  const projected = projectRunLogs({ detail, logs: section.payload, sections: [], confirmedActionBindings: [],
    actionEvidence: { state: "available", events: [], missingPages: [] }, unavailableEvidence: [] }, { artifactUrl: () => "unused" });
  assert.deepEqual(projected.steps.map(step => [step.title, step.system]), [["Search for person", "ucpath"], ["Cross-check identity", "crm"],
    ["Read employment status", "local"], ["Read CRM dates", "crm"]]);
  assert.equal(projected.timeline[3].state, "skipped");
  assert.match(logPlainText(projected.steps), /Skipped · Not needed for this run/u);
  assert.doesNotMatch(logPlainText(projected.steps), /Run note|\bdone\b|condition-false|search-identity|crm-identity|crm-only-recovery|workflow:person-lookup/u);
});


it("lists retained M1b hits and each dropped candidate with its reason through served Logs", () => {
  const w = world();
  queuedEventOf(w, { seed: 82, descriptor: personLookupModule.descriptor });
  const queued = w.authority.records.get(uuidOf(82)); assert.ok(queued);
  const input = PersonLookupInput.parse({ mode: "match", lastName: "Quillan", firstName: "Petra A.", dob: "2/19/2030" });
  const run = RunRecordSchema.parse({ ...queued, input: { ...queued.input, raw: input, parsed: { ...queued.input.parsed, value: input } } });
  w.authority.put(run);
  const at = w.clock.now().toISOString();
  const hits = [{ emplId: "10000001", name: "Quillan, Petra A." }, { emplId: "10000002", name: "Fable, Rowan B." }];
  const dropped = hits.map((hit, index) => ({ ...hit, reason: index === 0 ? "No Person Org record" : "Last name does not match" }));
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", runId: run.envelope.runId,
    attempt: 1, traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/matching#1`, nodeId: "matching", taskId: "ucpath/search-person-match",
    points: Object.entries({ hits, confirmed: [], dropped }).map(([field, value]) => ({ direction: "read" as const, field,
      values: [{ key: field, state: "allowed" as const, classification: "safe-diagnostic" as const, transform: "allow" as const, value }] })) });
  w.projection.ingestFromTimeline();
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ ...personLookupModule.descriptor, dataOrigins: dataOriginViewsOf(personLookupModule) }) } };
  const detail = buildRunDetail(deps, run.envelope.runId);
  const section = buildRunLogsSection(deps, run.envelope.runId, w.projection.runFold(run.envelope.runId), run); assert.ok(section.section === "logs");
  const row = section.payload.rows?.find(row => row.kind === "observed"); assert.ok(row?.kind === "observed", "retained M1b candidates must enter served Logs");
  assert.deepEqual(row.displayFields?.map(field => [field.label, field.value]), [
    ...hits.flatMap(hit => [["Employee ID", hit.emplId], ["Name", hit.name]]),
    ...dropped.flatMap(hit => [["Employee ID", hit.emplId], ["Name", hit.name], ["Drop reason", hit.reason]]),
  ]);
  const projected = projectRunLogs({ detail, logs: section.payload, sections: [], confirmedActionBindings: [],
    actionEvidence: { state: "available", events: [], missingPages: [] }, unavailableEvidence: [] }, { artifactUrl: () => "unused" });
  const text = logPlainText(projected.steps);
  for (const hit of dropped) {
    assert.match(text, new RegExp(`${hit.emplId}[\\s\\S]*${hit.name.replace(".", "\\.")}[\\s\\S]*${hit.reason}`, "u"));
    assert.equal(projected.steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []))
      .filter(field => field.label === "Employee ID" && field.value === hit.emplId).length, 1);
  }
  assert.doesNotMatch(text, /matching|confirmed|dropped|emplId|SSN|DOB|2\/19\/2030|ucpath\/search-person-match/u);
});
