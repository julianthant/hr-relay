import { expect, it } from "vitest";
import { personLookupServedProducer } from "../../../support/helpers/backend/person-lookup-served-producer.js";
import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";

it("retains fresh production PL task observations/checkpoints and collapses only their explicit forwarded aliases",async()=>{
 const p=await personLookupServedProducer();
 try{
  const {database}=p.harness.authority;
  const original=database.authority.runCheckpoints.latest("person-lookup",p.run.envelope.itemId,"searching");
  const forwarded=database.authority.runCheckpoints.latest("person-lookup",p.run.envelope.itemId,"search-identity");
  expect(original).toBeDefined();
  if (original === undefined) throw new Error("searching checkpoint required");
  const leaves = observationLeafPaths(original.output.value);
  expect(original.observationOrigins).toHaveLength(leaves.length);
  expect(new Set(original.observationOrigins?.map(entry => JSON.stringify(entry.path))))
    .toEqual(new Set(leaves.map(path => JSON.stringify(path))));
  const events = database.authority.timelineEvents.page({ runId: p.run.envelope.runId, after: 0, limit: 1000 });
  const search = events.flatMap(record => record.payload.kind === "span" && record.payload.event.t === "data.observed"
    && record.payload.event.nodeId === "searching" ? record.payload.event.points : []);
  expect(search.length).toBeGreaterThan(0);
  expect(search.find(point => point.field === "results")?.origins).toBeUndefined();
  expect(search.find(point => point.field === "selection")?.origins?.some(entry => entry.origin.field === "results")).toBe(true);
  const selected=forwarded?.observationOrigins?.find(row=>JSON.stringify(row.path)==='["selected","name"]');
  expect(selected?.origin).toMatchObject({runId:p.run.envelope.runId,nodeId:"searching",taskId:"ucpath/search-person-org",field:"results",path:[0,"name"]});
  expect(selected?.origin.spanPath).toMatch(/searching#1\.1$/u);
  const native=p.snapshot.logs.rows?.filter(row=>row.kind==="observed")??[];
  expect(native.some(row=>row.kind==="observed"&&row.producer.nodeId==="crm-selected-record")).toBe(true);
  const logs=projectRunLogs(p.snapshot,{artifactUrl:()=>"unused"});
  const names=logs.steps.flatMap(step=>step.entries.flatMap(entry=>entry.kind==="fields"?entry.fields.filter(field=>field.label==="Name"):[]));
  expect(names).toHaveLength(3);
  expect(new Set(names.map(field=>field.id)).size).toBe(3);
  expect(logPlainText(logs.steps)).toContain("How found");
  expect(logPlainText(logs.steps)).toContain("UCPath search");
  expect(logPlainText(logs.steps)).toContain("HDH department");
  expect(logPlainText(logs.steps)).toContain("Yes");
  expect(logs.steps.some(step=>step.title==="Run note")).toBe(false);
  expect(logPlainText(logs.steps)).not.toContain("Identity cross-check");
  expect(p.harness.sessions.opens("ucpath")).toBe(1);
  expect(p.harness.sessions.opens("crm")).toBe(1);
 }finally{await p.dispose();}
});
