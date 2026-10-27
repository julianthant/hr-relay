import assert from "node:assert/strict";
import { it } from "vitest";
import { deriveCanonicalPerson } from "../../../../src/backend/runs/projections/run-summary.js";
import { queryActivitySummaries } from "../../../../src/backend/runs/queries/run-summaries.js";
import { RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { TERMINAL_SEPARATIONS_RESULT,TERMINAL_SEPARATIONS_RUN } from "../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

it("refuses each canonical identity mismatch with a sanitized error",()=>{
  for(const patch of [{attempt:2},{workflowId:"other"},{configSnapshotId:"00000000-0000-4000-8000-000000009999"},{contractFingerprint:TERMINAL_SEPARATIONS_RESULT.contractFingerprint==="b".repeat(64)?"c".repeat(64):"b".repeat(64)},{descriptorVersion:99},{configFingerprint:TERMINAL_SEPARATIONS_RESULT.configFingerprint==="b".repeat(64)?"c".repeat(64):"b".repeat(64)}]) {
    assert.throws(()=>deriveCanonicalPerson(TERMINAL_SEPARATIONS_RUN,RunResultRecordSchema.parse({...TERMINAL_SEPARATIONS_RESULT,...patch})),error=>error instanceof Error && error.message==="summary-result-identity-mismatch");
  }
  assert.equal(deriveCanonicalPerson(TERMINAL_SEPARATIONS_RUN,null).state,"unavailable");
});

import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { activityPersonPseudonymResultRecord,CURRENT_SEPARATIONS_RESULT,seedSeparationsRunAuthority } from "../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { id,NOW } from "../../../support/helpers/database-foundation/fixtures.js";
it("deduplicates people across days and computes the lower selected median, matching the retained projector",async ()=>{
  const f=await foundationFixture(),world=await makeWorld();try{
    const identities=new Map<string,ReturnType<typeof deriveCanonicalPerson>>();
    Object.assign(world.authority,{canonicalPerson:(runId:string)=>identities.get(runId)??{state:"unavailable",reason:"fixture-unavailable"}});
    for(let n=0;n<6;n++){
      const enqueuedAt=n<2?"2026-09-08T12:00:00.000Z":NOW;
      const duration=[10,20,100,1000,30,40][n];
      const endedAt=new Date(Date.parse(enqueuedAt)+duration).toISOString();
      const base=TERMINAL_SEPARATIONS_RUN;
      const run=RunRecordSchema.parse({...base,envelope:{...base.envelope,runId:id(6000+n),itemId:n===1?id(6000):id(6000+n),attempt:n===1?2:1,...(n===1?{retryOf:id(6000)}:{}),...(n>=4?{shape:"operation-member",parent:{runId:id(6000),tracePrefix:base.envelope.traceId,edgeId:"member"}}:{}),enqueuedAt,configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint},lifecycle:{state:"terminal",outcome:"done",endedAt},createdAt:enqueuedAt,updatedAt:endedAt,completion:{...base.completion,authorizedAt:endedAt}});
      const result=activityPersonPseudonymResultRecord(run,CURRENT_SEPARATIONS_RESULT);
      seedSeparationsRunAuthority(f.db,f.path,run,result);
      identities.set(run.envelope.runId,deriveCanonicalPerson(run,result));world.authority.put(run);
    }
    
    const expected=world.projection.buildActivityReportWire("2026-09-08","2026-09-09");
    const report=queryActivitySummaries(f.db,{from:"2026-09-08",to:"2026-09-09",generatedAt:expected.generatedAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>expected.ledger}});
    assert.deepEqual(report.people,{state:"present",distinct:1,evidenceRows:6});
    assert.deepEqual(report.durations.medianMs,{state:"present",value:20});
    assert.equal(report.completion.warningsUnknown,4);
    const {volume,...reportWithoutVolume}=report;
    assert.deepEqual(reportWithoutVolume,expected);
    assert.ok(volume);
    assert.equal(volume.state,"complete");assert.equal(volume.coveredRuns,report.totalRuns);
    assert.equal(volume.buckets.reduce((total,bucket)=>total+bucket.runs,0),report.totalRuns);
    assert.ok(!JSON.stringify(report).includes(CURRENT_SEPARATIONS_RESULT.approved.emplId));
  }finally{await world.dispose();await f.dispose();}
});
