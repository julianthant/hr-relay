import { expect, it } from "vitest";
import { personLookupServedProducer } from "../../../support/helpers/backend/person-lookup-served-producer.js";
import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";

it("retains fresh production PL task observations/checkpoints and collapses only their explicit forwarded aliases",async()=>{
 const p=await personLookupServedProducer();
 try{
  const {database}=p.harness.authority;
  const original=database.authority.runCheckpoints.latest("person-lookup",p.run.envelope.itemId,"searching");
  const forwarded=database.authority.runCheckpoints.latest("person-lookup",p.run.envelope.itemId,"search-identity");
  expect(original?.observationOrigins?.length).toBeGreaterThan(0);
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
  expect(logs.steps.some(step=>step.title==="Run note")).toBe(true);
  expect(p.harness.sessions.opens("ucpath")).toBe(1);
  expect(p.harness.sessions.opens("crm")).toBe(1);
 }finally{await p.dispose();}
});
