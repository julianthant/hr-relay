import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { buildRunLogsSection, runDataObservationsForRun } from "../../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupModule } from "../../../support/helpers/registered-workflows.js";
import { failureRecordOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";

const { world, queuedEventOf, runRecordOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
it("projects a declaration's typed scalar text without changing raw values, missing fields or redaction", async () => {
  const w = await world(); queuedEventOf(w, { seed: 85, descriptor: personLookupModule.descriptor });
  const run = w.authority.records.get(uuidOf(85)); assert.ok(run); const at = w.clock.now().toISOString();
  const raw = { boolean: true, string: "true", number: 1, absent: null, unchanged: "active", protected: false };
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId,
    spanPath: `${run.envelope.traceId}/active-status#1`, nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", points: [
      ...Object.entries(raw).filter(([field]) => field !== "protected").map(([field, value]) => ({ direction: "read" as const, field, values: [{ key: field, state: "allowed" as const, classification: "safe-diagnostic" as const, transform: "allow" as const, value }] })),
      { direction: "read", field: "protected", values: [{ key: "protected", state: "redacted", classification: "sensitive-hr", transform: "drop" }] },
    ] });
  w.projection.ingestFromTimeline();
  const display = { cases: [{ value: true, text: "Boolean yes" }, { value: "true", text: "String true" }, { value: 1, text: "Number one" }] };
  const origins = dataOriginViewsOf(personLookupModule).map(origin => ({ ...origin, operatorFields: Object.keys({ ...raw, missing: undefined }).map(field => ({ label: field, kind: "output" as const, fieldPath: field, ...(field === "unchanged" ? {} : { display }) })) }));
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, descriptors: { resolve: () => ({ dataOrigins: origins }) } };
  const section = buildRunLogsSection(deps, run.envelope.runId, undefined, run); assert.equal(section.section, "logs"); if (section.section !== "logs") throw Error("logs required");
  const row = section.payload.rows?.find(row => row.kind === "observed"); assert.ok(row?.kind === "observed");
  assert.deepEqual(row.displayFields?.map(field => [field.label, "value" in field ? field.value : "unread"]), [["boolean", "Boolean yes"], ["string", "String true"], ["number", "Number one"], ["unchanged", "active"], ["protected", "Redacted"]]);
  assert.deepEqual(row.points.filter(point => point.field !== "protected").map(point => point.values[0].state === "allowed" ? point.values[0].value : null), [true, "true", 1, "active"]);
  assert.deepEqual(runDataObservationsForRun(deps, run, run.envelope.runId)[0].points.find(point => point.field === "absent")?.values[0], { key: "absent", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: null });
  const refused = { ...deps, descriptors: { resolve: () => ({ dataOrigins: origins.map(origin => ({ ...origin, operatorFields: origin.operatorFields.map(field => ({ ...field, display: { cases: [{ value: false, text: "No" }] } })) })) }) } };
  assert.throws(() => buildRunLogsSection(refused, run.envelope.runId, undefined, run), error => {
    assert.deepEqual(failureStatus(error), { status: 409, body: { state: "error", code: "RUN_LOG_DISPLAY_VALUE_UNMAPPED", message: "A retained value has no declared display text. Update the workflow declaration before reading these Logs.", retryable: false } }); return true;
  });
});

it("flags each declared field a failed read never observed, on the node's last observed row", async () => {
  const w = await world(); queuedEventOf(w, { seed: 86, descriptor: personLookupModule.descriptor });
  const queued = w.authority.records.get(uuidOf(86)); assert.ok(queued); const at = w.clock.now().toISOString();
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", runId: queued.envelope.runId, attempt: 1, traceId: queued.envelope.traceId,
    spanPath: `${queued.envelope.traceId}/active-status#1`, nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", points: [
      { direction: "read", field: "status", values: [{ key: "status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "active" }] },
    ] });
  w.projection.ingestFromTimeline();
  const origins = dataOriginViewsOf(personLookupModule).map(origin => ({ ...origin, operatorFields: ["status", "department"].map(field => ({ label: field, kind: "output" as const, fieldPath: field })) }));
  const failure = FailureRecordSchema.parse({ ...failureRecordOf({ seed: 86, code: "FIXTURE_READ_FAILED" }), nodeId: "active-status" });
  const read = (operation: "read" | "click") => {
    const run = runRecordOf({ seed: 86, descriptor: personLookupModule.descriptor, lifecycle: { state: "terminal", outcome: "failed", endedAt: at, failureId: failure.failureId } });
    const trust = { getFailure: () => FailureRecordSchema.parse({ ...failure, action: { operation } }), ensureReceipt: () => { throw new Error("unused"); }, countFailuresByFingerprint: () => 0 };
    const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority, trust, descriptors: { resolve: () => ({ dataOrigins: origins }) } };
    const section = buildRunLogsSection(deps, run.envelope.runId, undefined, run); assert.ok(section.section === "logs");
    const row = section.payload.rows?.find(candidate => candidate.kind === "observed"); assert.ok(row?.kind === "observed");
    return row.displayFields;
  };
  assert.deepEqual(read("read"), [{ direction: "read", label: "status", value: "active" }, { direction: "read", label: "department", unread: true }]);
  assert.deepEqual(read("click"), [{ direction: "read", label: "status", value: "active" }], "only a failed read flags unread fields");
});
