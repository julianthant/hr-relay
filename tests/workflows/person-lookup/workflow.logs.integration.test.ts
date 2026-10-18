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
    ["Employee ID", "10000001"], ["Employee ID", "10000002"], ...(crm === "Not checked" ? [] : [["CRM", crm], ["How found", "No match"]]),
    ["UCPath", "Found"], ["CRM", crm], ...(reason === "" ? [] : [["Status note", reason]]),
  ]);
  assert.doesNotMatch(JSON.stringify(fields), /multiple-matches|no-match|datesEid/u);
});

it.each([
  ...["search-identity", "crm-identity"].flatMap(nodeId => [
    ["ucpath", "UCPath search"], ["eid-match", "Employee ID agrees with CRM"], ["date-match", "Start dates within one week"],
    ["crm-only", "CRM only"], ["multiple-matches", "Multiple matches"], ["no-match", "No match"], ["match", "UCPath Match"],
  ].map(([value, text]) => ({ nodeId, taskId: "workflow:person-lookup/read-resolved-identity", field: "method", label: "How found", value, text }))),
  ...[["active", "Active"], ["inactive", "Inactive"], ["crm-only", "CRM only"], ["multiple-matches", "Multiple matches"], ["not-found", "Not found"], ["undetermined", "Undetermined"], ["found", "Found"], ["not-found-in-ucpath", "Not found in UCPath"]].map(([value, text]) => ({ nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", field: "state", label: "Employment status", value, text })),
  { nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", field: "hdh", label: "HDH department", value: true, text: "Yes" },
  { nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", field: "hdh", label: "HDH department", value: false, text: "No" },
  { nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status", field: "hdh", label: "HDH department", value: null, text: null },
  ...["Found", "Not found", "Not checked", "Check failed"].map(value => ({ nodeId: "crm-identity", taskId: "workflow:person-lookup/read-resolved-identity", field: "crmState", label: "CRM", value, text: value })),
])("maps only declared Person Lookup $nodeId.$field=$value at display", ({ nodeId, taskId, field, label, value, text }) => {
  const w=world();queuedEventOf(w,{seed:86,descriptor:personLookupModule.descriptor});const run=w.authority.records.get(uuidOf(86));assert.ok(run);
  const at=w.clock.now().toISOString();w.writer.emit({t:"data.observed",ts:at,observedAt:at,workflow:"person-lookup",runId:run.envelope.runId,attempt:1,traceId:run.envelope.traceId,spanPath:`${run.envelope.traceId}/${nodeId}#1.1`,nodeId,taskId,points:[{direction:"read",field,values:[{key:field,state:"allowed",classification:"safe-diagnostic",transform:"allow",value}]}]});w.projection.ingestFromTimeline();
  const deps={runReader:w.runReader,timeline:w.timeline,stateRoot:w.stateRoot,projection:w.projection,authority:w.authority,descriptors:{resolve:()=>({dataOrigins:dataOriginViewsOf(personLookupModule)})}};
  const section=buildRunLogsSection(deps,run.envelope.runId,undefined,run);assert.ok(section.section==="logs");
  const fields=section.payload.rows?.flatMap(row=>row.kind==="observed"?row.displayFields??[]:[])??[];
  assert.deepEqual(fields.map(field=>[field.label,field.value]),text===null?[]:[[label,text]]);
});
it.each([
 {field:"method",value:"unknown-method",redacted:false,refused:true},
 {field:"method",value:null,redacted:false,refused:false},
 {field:"method",value:"unknown-method",redacted:true,refused:false},
 {field:"hdh",value:"true",redacted:false,refused:true},
])("preserves PL null/redaction and refuses unmapped typed values $field=$value",({field,value,redacted,refused})=>{
 const w=world();queuedEventOf(w,{seed:87,descriptor:personLookupModule.descriptor});const run=w.authority.records.get(uuidOf(87));assert.ok(run);
 const nodeId=field==="method"?"search-identity":"active-status",taskId=field==="method"?"workflow:person-lookup/read-resolved-identity":"workflow:person-lookup/read-active-status";
 const at=w.clock.now().toISOString();
 w.writer.emit({t:"data.observed",ts:at,observedAt:at,workflow:"person-lookup",runId:run.envelope.runId,attempt:1,traceId:run.envelope.traceId,spanPath:`${run.envelope.traceId}/${nodeId}#1.1`,nodeId,taskId,points:[{direction:"read",field,values:[redacted?{key:field,state:"redacted",classification:"sensitive-hr",transform:"drop"}:{key:field,state:"allowed",classification:"safe-diagnostic",transform:"allow",value}]}]});
 w.projection.ingestFromTimeline();
 const deps={runReader:w.runReader,timeline:w.timeline,stateRoot:w.stateRoot,projection:w.projection,authority:w.authority,descriptors:{resolve:()=>({dataOrigins:dataOriginViewsOf(personLookupModule)})}};
 const read=()=>buildRunLogsSection(deps,run.envelope.runId,undefined,run);
 if(refused)assert.throws(read,{code:"RUN_LOG_DISPLAY_VALUE_UNMAPPED"});
 else {const section=read();assert.ok(section.section==="logs");assert.deepEqual(section.payload.rows?.flatMap(row=>row.kind==="observed"?row.displayFields?.map(field=>field.value)??[]:[]),redacted?["Redacted"]:[]);}
});
