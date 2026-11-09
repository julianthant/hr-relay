import { expect, it } from "vitest";
import { createTaskProvenanceCollector, jsonLeafPaths } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

import type { DataPoint, RecordedDataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { resolveObservationOrigin, observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";
import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ReadResolvedIdentity } from "../../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { redactObservedDataPoints } from "../../../../src/backend/logs/observed-data.js";

const execution = { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "pl-180000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: SearchPersonOrg.id };
const spanPath = "pl-180000-aaaa/searching#2.3";
const identity = { ...execution, spanPath };
function collector(spanPath = "pl-180000-aaaa/searching#2.3") {
 const points: RecordedDataPoint[] = [];
 const created = createTaskProvenanceCollector({ descriptor: personLookupDescriptor, execution, observationSpanPath: spanPath, upstreamEvidence: { checkpoints: [] }, clock: manualClock(new Date("2026-08-02T18:00:00.000Z")), onRecord: batch => points.push(...batch.points) });
 return { ...created, points };
}
function observedEvent(points: readonly RecordedDataPoint[]) {
 const event = SpanEventWireSchema.parse({ t: "data.observed", pid: 1, ts: points[0].recordedAt, observedAt: points[0].recordedAt,
   workflow: execution.workflowId, runId: execution.runId, traceId: execution.traceId, attempt: execution.attempt, spanPath, nodeId: execution.nodeId, taskId: execution.taskId,
   points: redactObservedDataPoints(SearchPersonOrg.id, points) });
 if (event.t !== "data.observed") throw new Error("observation required");
 return event;
}
it("binds an explicitly forwarded nested array member to the original exact observation occurrence", () => {
 const c = collector();c.recordData({ direction: "read", field: "results", value: [{ name: "Same" }, { name: "Same" }] });
 c.recordData({ direction: "read", field: "selection", value: { selected: { name: "Same" }, status: "derived" }, aliases: [{ path: ["selected"], source: { kind: "local", field: "results", path: [1] } }] });
 const result = c;
 expect(result.points[1].origins).toEqual([{ path: ["selected", "name"], origin: { runId: execution.runId, attempt: 1, spanPath: "pl-180000-aaaa/searching#2.3", nodeId: "searching", taskId: SearchPersonOrg.id, field: "results", path: [1, "name"] } }]);
 expect(result.points[0].origins).toBeUndefined();
 expect(resolveObservationOrigin(identity, result.points[1], ["status"])).toMatchObject({ field: "selection", path: ["status"] });
 c.recordData({ direction: "read", field: "copied", value: "Same", aliases: [{ path: [], source: { kind: "local", field: "selection", path: ["selected", "name"] } }] });
 expect(c.points[2].origins?.[0].origin).toEqual(c.points[1].origins?.[0].origin);
});
it("refuses contradictory, unavailable and cyclic local aliases before emitting them", () => {
 for (const source of [{ kind: "local", field: "results", path: [0] }, { kind: "local", field: "missing", path: [] }, { kind: "local", field: "selection", path: ["selected"] }] as const) {
  const c=collector();c.recordData({direction:"read",field:"results",value:[{name:"Original"}]});
  expect(()=>c.recordData({direction:"read",field:"selection",value:{selected:{name:"Different"}},aliases:[{path:["selected"],source:{...source,path:[...source.path]}}]})).toThrow(/observation alias/u);
 }
});
it("keeps equal native observations distinct across task-attempt spans", () => {
 const first=collector(),second=collector("pl-180000-aaaa/searching#2.4");
 for(const c of [first,second])c.recordData({direction:"read",field:"results",value:[]});
 const a=first;
 const b=second;
 expect(resolveObservationOrigin(identity, a.points[0], [])).not.toEqual(resolveObservationOrigin({ ...identity, spanPath: "pl-180000-aaaa/searching#2.4" }, b.points[0], []));
});

it("omits default origins from the recorded event and reconstructs every typed leaf from its event identity", () => {
 const c = collector();
 const value = [{ name: "Same", nested: { "0": true }, empty: [] }, { name: "Same", nested: null, empty: {} }];
 c.recordData({ direction: "read", field: "results", value });
 expect(c.points[0].origins).toBeUndefined();
 const event = SpanEventWireSchema.parse(JSON.parse(JSON.stringify(observedEvent(c.points))));
 expect(event.t).toBe("data.observed");
 if (event.t !== "data.observed") throw new Error("observation required");
 expect(event.points[0].origins).toBeUndefined();
 for (const path of observationLeafPaths(value)) expect(resolveObservationOrigin(event, event.points[0], path)).toEqual({
   runId: execution.runId, attempt: execution.attempt, spanPath, nodeId: execution.nodeId, taskId: execution.taskId, field: "results", path,
 });
});

it("keeps a full-origin event's explicit native and forwarded occurrences exactly as stored", () => {
 const point = { field: "results", origins: [
   { path: [0, "name"], origin: { runId: execution.runId, attempt: 1, spanPath, nodeId: execution.nodeId, taskId: execution.taskId, field: "results", path: [0, "name"] } },
   { path: [1, "name"], origin: { runId: execution.runId, attempt: 1, spanPath: "pl-180000-aaaa/source#1.1", nodeId: "source", taskId: execution.taskId, field: "source", path: [7, "name"] } },
 ] };
 for (const entry of point.origins) expect(resolveObservationOrigin(identity, point, entry.path)).toEqual(entry.origin);
});

it("refuses payload-supplied execution identity and origins before recording", () => {
 const c = collector();
 const forged = { direction: "read" as const, field: "results", value: [], execution: { ...execution, runId: "foreign-run" },
   origins: [{ path: [], origin: { ...identity, field: "results", path: [] } }] };
 expect(() => c.recordData(forged)).toThrow(/[Uu]nrecognized key/u);
 expect(c.points).toEqual([]);
});

it("keeps a many-leaf observed event below the timeline event byte limit", () => {
 const c = collector();
 c.recordData({ direction: "read", field: "results", value: Array.from({ length: 2_000 }, () => ({ name: "Fictional" })) });
 expect(Buffer.byteLength(JSON.stringify(observedEvent(c.points)), "utf8")).toBeLessThan(128 * 1024);
});

it("forwards a dependency's native origin from its complete checkpoint instead of the current task", () => {
 const value = SearchPersonOrg.example;
 const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: execution.workflowId, itemId: "33333333-3333-4333-8333-333333333333",
   nodeId: execution.nodeId, runId: execution.runId, attempt: 1, claimGeneration: 2, output: { schemaHash: deriveSchemaHash(SearchPersonOrg.output, "output"), value },
   descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint, implFingerprint: "a".repeat(64),
   provenance: jsonLeafPaths(value).map(path => ({ path, source: "live", observedAt: "2026-08-02T18:00:00.000Z", originalObservedAt: "2026-08-02T18:00:00.000Z" })),
   observationOrigins: Object.entries(value).flatMap(([field, member]) => observationLeafPaths(member).map(path => ({ path: [field, ...path], origin: resolveObservationOrigin(identity, { field }, path) }))),
   writtenAt: "2026-08-02T18:00:00.000Z" });
 const points: RecordedDataPoint[] = [];
 const create = (source = checkpoint) => createTaskProvenanceCollector({ descriptor: personLookupDescriptor,
   execution: { ...execution, nodeId: "search-identity", taskId: ReadResolvedIdentity.id }, observationSpanPath: "pl-180000-aaaa/search-identity#4.1",
   canonicalInput: PersonLookupInput.parse({ name: "Fictional Person" }), upstreamEvidence: { checkpoints: [source], skippedTasks: ["matching"] },
   clock: manualClock(new Date("2026-08-02T18:00:00.000Z")), onRecord: batch => points.push(...batch.points) });
 const point: DataPoint = { direction: "read", field: "selected", value: value.results[0].name,
   aliases: [{ path: [], source: { kind: "dependency", nodeId: "searching", path: ["results", 0, "name"] } }] };
 create().recordData(point);
 expect(points[0].origins).toEqual([{ path: [], origin: resolveObservationOrigin(identity, { field: "results" }, [0, "name"]) }]);
 expect(() => create({ ...checkpoint, observationOrigins: undefined }).recordData(point)).toThrow(/observation alias source checkpoint.*origin/u);
});
it("rejects string indices for arrays and numeric indices for objects instead of coercing alias addresses", () => {
 for(const [value,path]of [[[{name:"A"}],["0"]],[{"0":{name:"A"}},[0]]] as const){
  const c=collector();c.recordData({direction:"read",field:"results",value});
  expect(()=>c.recordData({direction:"read",field:"selection",value:{selected:{name:"A"}},aliases:[{path:["selected"],source:{kind:"local",field:"results",path:[...path]}}]})).toThrow(/observation alias.*address type/u);
 }
});
