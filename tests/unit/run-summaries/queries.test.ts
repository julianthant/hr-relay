import assert from "node:assert/strict";
import { it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { foundationFixture,id,NOW } from "../database-foundation/fixtures.js";
import { queryQueueSummaries,queryActivitySummaries } from "../../../src/server/dashboard/queries/run-summaries.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { makeWorld } from "../server/helpers/dashboard-harness.js";

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
    const actual=queryActivitySummaries(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:expected.generatedAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>expected.ledger}});
    assert.equal(actual.totalRuns,3);assert.equal(actual.terminalRuns,1);assert.equal(actual.durations.totalMs,5000);
    assert.deepEqual(actual,expected);
  }finally{world.dispose();f.dispose();}
});
