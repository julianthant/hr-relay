import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupModule } from "../../../support/helpers/registered-workflows.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

for (const full of [false, true]) it(`preserves causal observation identity through ${full ? "full" : "compact"} origins in served Logs`, async () => {
  const w = await world();
  queuedEventOf(w, { seed: 90, descriptor: personLookupModule.descriptor });
  const run = w.authority.records.get(uuidOf(90));
  assert.ok(run);
  const at = w.clock.now().toISOString();
  const identity = { runId: run.envelope.runId, attempt: 1, spanPath: `${run.envelope.traceId}/searching#1.1`, nodeId: "searching", taskId: "ucpath/search-person-org" };
  const native = { ...identity, field: "results", path: [0, "name"] };
  const forwarded = { ...native, spanPath: `${run.envelope.traceId}/searching#1.0`, path: [7, "name"] };
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: "person-lookup", traceId: run.envelope.traceId, ...identity,
    points: [{ direction: "read", field: "results", values: [{ key: "results", state: "allowed", classification: "safe-diagnostic", transform: "allow",
      value: [{ name: "Fictional Person" }, { name: "Fictional Person" }] }], origins: [
      ...(full ? [{ path: [0, "name"], origin: native }] : []), { path: [1, "name"], origin: forwarded },
    ] }] });
  w.projection.ingestFromTimeline();
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(personLookupModule) }) } };
  const section = buildRunLogsSection(deps, run.envelope.runId, undefined, run);
  assert.ok(section.section === "logs");
  const row = section.payload.rows?.find(row => row.kind === "observed");
  assert.ok(row?.kind === "observed");
  const names = row.displayFields?.filter(field => field.label === "Name");
  assert.deepEqual(names?.map(field => "causal" in field ? field.causal?.origin : undefined), [native, forwarded]);
});
