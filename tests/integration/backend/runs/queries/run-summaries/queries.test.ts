import assert from "node:assert/strict";
import { it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { foundationFixture,id,NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { queryQueueSummaries,queryActivitySummaries } from "../../../../../../src/backend/runs/queries/run-summaries.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { makeWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { runtimeTimeZone } from "../../../../../../src/rules/time/clock.js";
import { activityDatePartAtInstant } from "../../../../../../src/models/dashboard/activity-volume.js";

it("pages stable ties over real summary partitions, without whole-source reads",()=>{
  const f=foundationFixture();try {
    f.db.withAuthorityTransaction(()=>{for(let n=0;n<12;n++)f.db.authority.runs.enqueue(RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3000+n),itemId:id(3000+n)},lifecycle:{state:"queued"},version:1,claimGeneration:0}));});
    f.db.refreshRunSummaries();f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    const seen:string[]=[];let after:{localDay:string;runId:string}|undefined;
    do{const page=queryQueueSummaries(f.db,{limit:3,...(after===undefined?{}:{after})});seen.push(...page.items.map(row=>row.runId));after=page.next??undefined;}while(after!==undefined);
    assert.equal(seen.length,13);assert.equal(new Set(seen).size,13);assert.deepEqual(seen,[...seen].sort());
    assert.throws(()=>queryQueueSummaries(f.db,{limit:3,fromDay:"2026-09-10",toDay:"2026-09-09"}),/range-invalid/);
    const raw=new DatabaseSync(f.path,{readOnly:true});try{
      const plan=raw.prepare("EXPLAIN QUERY PLAN SELECT record_json FROM run_summaries WHERE workflow=? AND local_day>=? AND local_day<=? AND state>=? AND state<=? ORDER BY local_day,state,record_key LIMIT ?").all("person-lookup","2026-09-09","2026-09-09","queued","queued",4);
      assert.match(JSON.stringify(plan),/USING INDEX/);
      assert.doesNotMatch(JSON.stringify(plan),/SCAN run_summaries|TEMP B-TREE/);
    }finally{raw.close();}
  }finally{f.dispose();}
});

it("agrees with independent expected totals and the retained Activity projector on identical live authority",()=>{
  const f=foundationFixture(),world=makeWorld();try{
    for(let n=0;n<4;n++)f.db.authority.runs.enqueue(RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3100+n),itemId:id(3100+n),enqueuedAt:n===3?"2025-01-01T12:00:00.000Z":NOW},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:n===3?"2025-01-01T12:00:00.000Z":NOW}));
    const terminal=f.db.authority.runs.get(id(3100));assert.ok(terminal);
    f.db.authority.runs.transition({runId:terminal.envelope.runId,expectedVersion:terminal.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:"2026-09-09T12:00:05.000Z"},now:"2026-09-09T12:00:05.000Z"});
    f.db.refreshRunSummaries();
    for(const row of f.db.readRunSummaries()) {const run=f.db.authority.runs.get(row.runId);assert.ok(run);world.authority.put(run);}
    const expected=world.projection.buildActivityReportWire("2026-09-09","2026-09-09");
    const actual=queryActivitySummaries(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:expected.generatedAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>expected.ledger},timeZone:runtimeTimeZone()});
    assert.equal(actual.totalRuns,3);assert.equal(actual.terminalRuns,1);assert.equal(actual.durations.totalMs,5000);
    const {volume,...reportWithoutVolume}=actual;
    assert.deepEqual(reportWithoutVolume,expected);
    assert.ok(volume);
    assert.equal(volume.state,"complete");assert.equal(volume.coveredRuns,3);
    assert.equal(volume.buckets.reduce((sum,bucket)=>sum+bucket.runs,0),actual.totalRuns);
  }finally{world.dispose();f.dispose();}
});

it("bins the enqueue instant and refuses a timezone mismatch before an indexed day bound can hide a run",()=>{
  const f=foundationFixture();try{
    const enqueuedAt="2026-09-09T07:20:00.000Z";
    const queued=RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3200),itemId:id(3200),enqueuedAt},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:enqueuedAt,updatedAt:enqueuedAt});
    f.db.authority.runs.enqueue(queued);
    const claimTime="2026-09-09T08:20:00.000Z";
    const claim=f.db.authority.runs.claimNext({workflow:"person-lookup",workerId:"activity-volume-worker",now:claimTime});
    assert.equal(claim.state,"claimed");
    f.db.refreshRunSummaries();
    const timeZone=runtimeTimeZone(),day=activityDatePartAtInstant(enqueuedAt,timeZone);
    const report=queryActivitySummaries(f.db,{from:day,to:day,generatedAt:NOW},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone});
    const enqueueBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(enqueuedAt)&&Date.parse(enqueuedAt)<Date.parse(bucket.endExclusive));
    assert.equal(enqueueBucket?.runs,1);
    const claimBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(claimTime)&&Date.parse(claimTime)<Date.parse(bucket.endExclusive));
    assert.equal(claimBucket?.runs,0);
    assert.equal(report.volume?.coveredRuns,report.totalRuns);
    const mismatchTimeZone=activityDatePartAtInstant(enqueuedAt,"Etc/GMT+12")!==day?"Etc/GMT+12":"Pacific/Kiritimati";
    const mismatchDay=activityDatePartAtInstant(enqueuedAt,mismatchTimeZone);
    assert.notEqual(mismatchDay,day);
    assert.throws(()=>queryActivitySummaries(f.db,{from:mismatchDay,to:mismatchDay,generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:mismatchTimeZone}),
    /activity-summary-local-day-time-zone-mismatch/u);
  }finally{f.dispose();}
});

it("folds real summary rows into inclusive DST-day boundaries, distinct repeated hours, and known-zero days",()=>{
  const f=foundationFixture();try{
    const zone="America/Los_Angeles";
    const enqueuedAt=[
      "2026-03-08T07:59:59.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T08:30:00.000Z",
      "2026-03-08T09:30:00.000Z",
      "2026-03-08T10:30:00.000Z",
      "2026-03-09T07:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:30:00.000Z",
      "2026-11-01T09:30:00.000Z",
      "2026-11-01T10:30:00.000Z",
      "2026-11-02T08:00:00.000Z",
    ];
    for(const [index,at] of enqueuedAt.entries()) {
      const queued=RunRecordSchema.parse({...f.run,
        envelope:{...f.run.envelope,runId:id(3300+index),itemId:id(3300+index),enqueuedAt:at},
        lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:at,updatedAt:at});
      f.db.authority.runs.enqueue(queued);
    }
    f.db.refreshRunSummaries();
    const read=(day:string)=>queryActivitySummaries(f.db,{from:day,to:day,generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:zone});

    const spring=read("2026-03-08");
    assert.equal(spring.totalRuns,4);
    assert.equal(spring.volume?.granularity,"hourly");
    assert.equal(spring.volume?.buckets.length,23);
    assert.equal(spring.volume?.coveredRuns,spring.totalRuns);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T00:00:00.000-08:00")?.runs,2);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T01:00:00.000-08:00")?.runs,1);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T03:00:00.000-07:00")?.runs,1);
    assert.ok(!spring.volume?.buckets.some(bucket=>bucket.start.startsWith("2026-03-08T02:")));

    const fall=read("2026-11-01");
    const repeated=fall.volume?.buckets.filter(bucket=>bucket.start.startsWith("2026-11-01T01:00:00"))??[];
    assert.equal(fall.totalRuns,4);
    assert.equal(fall.volume?.buckets.length,25);
    assert.equal(fall.volume?.coveredRuns,fall.totalRuns);
    assert.deepEqual(repeated.map(bucket=>[bucket.start,bucket.runs]),[
      ["2026-11-01T01:00:00.000-07:00",1],
      ["2026-11-01T01:00:00.000-08:00",1],
    ]);

    const nextDay=read("2026-03-09");
    assert.equal(nextDay.totalRuns,1);
    assert.equal(nextDay.volume?.buckets.find(bucket=>bucket.start==="2026-03-09T00:00:00.000-07:00")?.runs,1);

    const knownZero=read("2026-03-10");
    assert.equal(knownZero.totalRuns,0);
    assert.equal(knownZero.volume?.state,"complete");
    assert.equal(knownZero.volume?.coveredRuns,0);
    assert.ok(knownZero.volume?.buckets.every(bucket=>bucket.runs===0));
  }finally{f.dispose();}
});

it("keeps the minimum supported date inside its indexed candidate range",()=>{
  const f=foundationFixture();try{
    const report=queryActivitySummaries(f.db,{from:"0000-02-29",to:"0000-02-29",generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:"UTC"});
    assert.equal(report.totalRuns,0);
    assert.equal(report.volume?.interval.start,"0000-02-29T00:00:00.000+00:00");
    assert.equal(report.volume?.interval.endExclusive,"0000-03-01T00:00:00.000+00:00");
  }finally{f.dispose();}
});
