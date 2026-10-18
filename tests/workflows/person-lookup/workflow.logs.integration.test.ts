import assert from "node:assert/strict";
import type { JsonObject } from "../../../src/rules/validation/canonical-json.js";
import { afterEach, it } from "vitest";
import { buildRunLogsSection } from "../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { createRunQueueProjectionTestWorld } from "../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupModule } from "../../support/helpers/registered-workflows.js";
import { traceOf, uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

it.each([
  { crm: "Check failed", reason: "" },
  { crm: "Not checked", reason: "UCPath HR status is blank" },
])("serves candidate EIDs, check states and the retained status note $reason", ({ crm, reason }) => {
  const w = world();
  queuedEventOf(w, { seed: 83, descriptor: personLookupModule.descriptor });
  const run = w.authority.records.get(uuidOf(83)); assert.ok(run);
  const at = w.clock.now().toISOString();
  const observations: readonly (readonly [string, string, JsonObject])[] = [
    ["searching", "ucpath/search-person-org", { results: [{ emplId: "10000001" }, { emplId: "10000002" }] }],
    ...(crm === "Not checked" ? [] : [["crm-identity", "workflow:person-lookup/read-resolved-identity", { crmState: crm, method: "no-match" }] as const]),
    ["active-status", "workflow:person-lookup/read-active-status", { details: { ucpath: "Found", crm }, reason, datesEid: "10000001" }],
  ];
  for (const [nodeId, taskId, values] of observations) w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", runId: run.envelope.runId,
    attempt: 1, traceId: traceOf(83), spanPath: `${traceOf(83)}/${nodeId}#1`, nodeId, taskId,
    points: Object.entries(values).map(([field, value]) => ({ direction: "read" as const, field,
      values: [{ key: field, state: "allowed" as const, classification: "safe-diagnostic" as const, transform: "allow" as const, value }] })) });
  w.projection.ingestFromTimeline();
  const section = buildRunLogsSection({ runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(personLookupModule) }) } }, run.envelope.runId, undefined, run);
  assert.ok(section.section === "logs");
  const fields = section.payload.rows?.flatMap(row => row.kind === "observed" ? row.displayFields ?? [] : []) ?? [];
  assert.deepEqual(fields.map(field => [field.label, field.value]), [
    ["Employee ID", "10000001"], ["Employee ID", "10000002"], ...(crm === "Not checked" ? [] : [["CRM", crm]]),
    ["UCPath", "Found"], ["CRM", crm], ...(reason === "" ? [] : [["Status note", reason]]),
  ]);
  assert.doesNotMatch(JSON.stringify(fields), /multiple-matches|no-match|datesEid/u);
});
