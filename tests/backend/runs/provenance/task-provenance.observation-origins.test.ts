import { expect, it } from "vitest";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

import type { RecordedDataPoint } from "../../../../src/rules/workflow/task-provenance.js";

const execution = { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "pl-180000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: SearchPersonOrg.id };
function collector(spanPath = "pl-180000-aaaa/searching#2.3") {
 const points: RecordedDataPoint[] = [];
 const created = createTaskProvenanceCollector({ descriptor: personLookupDescriptor, execution, observationSpanPath: spanPath, upstreamEvidence: { checkpoints: [] }, clock: manualClock(new Date("2026-08-02T18:00:00.000Z")), onRecord: batch => points.push(...batch.points) });
 return { ...created, points };
}
it("binds an explicitly forwarded nested array member to the original exact observation occurrence", () => {
 const c = collector();c.recordData({ direction: "read", field: "results", value: [{ name: "Same" }, { name: "Same" }] });
 c.recordData({ direction: "read", field: "selection", value: { selected: { name: "Same" } }, aliases: [{ path: ["selected"], source: { kind: "local", field: "results", path: [1] } }] });
 const result = c;
 expect(result.points[1].origins).toEqual([{ path: ["selected", "name"], origin: { runId: execution.runId, attempt: 1, spanPath: "pl-180000-aaaa/searching#2.3", nodeId: "searching", taskId: SearchPersonOrg.id, field: "results", path: [1, "name"] } }]);
 expect(result.points[0].origins?.map(entry => entry.origin.path)).toEqual([[0, "name"], [1, "name"]]);
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
 expect(a.points[0].origins).not.toEqual(b.points[0].origins);
});
it("rejects string indices for arrays and numeric indices for objects instead of coercing alias addresses", () => {
 for(const [value,path]of [[[{name:"A"}],["0"]],[{"0":{name:"A"}},[0]]] as const){
  const c=collector();c.recordData({direction:"read",field:"results",value});
  expect(()=>c.recordData({direction:"read",field:"selection",value:{selected:{name:"A"}},aliases:[{path:["selected"],source:{kind:"local",field:"results",path:[...path]}}]})).toThrow(/observation alias.*address type/u);
 }
});
