import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { foundationFixture, id } from "../unit/database-foundation/fixtures.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";

const empty=()=>({statements:0,returnedRows:0,summaryRows:0,summaryWrites:0,sourceReconstruction:0});
let active:ReturnType<typeof empty>|undefined;
const prepare:unknown=Reflect.get(DatabaseSync.prototype,"prepare");
if(typeof prepare!=="function")throw new Error("SQLite prepare unavailable");
// Count executions and actual returned/materialized rows on the real SQLite path.
// Node exposes no sqlite3_stmt_scanstatus: rows visited must not be called measured.
DatabaseSync.prototype.prepare=function(sql){
  const statement:unknown=Reflect.apply(prepare,this,[sql]);
  if(!(statement instanceof StatementSync))throw new Error("SQLite statement unavailable");
  return new Proxy(statement,{get(target,key){
    const value:unknown=Reflect.get(target,key,target);
    if(typeof value!=="function")return value;
    return (...args:unknown[])=>{
      const result:unknown=Reflect.apply(value,target,args);
      if(active!==undefined && ["all","get","run"].includes(String(key))){
        active.statements++;
        const returned=Array.isArray(result)?result.length:key==="get"&&result!==undefined?1:0;
        active.returnedRows+=returned;
        if(/SELECT record_json FROM run_summaries/u.test(sql))active.summaryRows+=returned;
        if(/INSERT INTO run_summaries/u.test(sql))active.summaryWrites++;
        if(/FROM (run_receipts|run_failures|checkpoint_payloads|run_results)/u.test(sql))active.sourceReconstruction++;
      }
      return result;
    };
  }});
};
function measure<T>(work:()=>T){
  const counts=empty();active=counts;const start=performance.now();
  try{return {result:work(),counts,ms:performance.now()-start};}finally{active=undefined;}
}
try{
  for(const outside of [100,1000]){
    const f=foundationFixture();try{
      f.db.withAuthorityTransaction(()=>{
        for(let i=0;i<outside+20;i++){
          const enqueuedAt=i<outside?"2025-01-01T12:00:00.000Z":"2026-09-09T12:00:00.000Z";
          f.db.authority.runs.enqueue(RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:id(10000+i),itemId:id(10000+i),enqueuedAt},lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:enqueuedAt,updatedAt:enqueuedAt}));
        }
      });
      const rebuild=measure(()=>f.db.refreshRunSummaries());
      const baseline=measure(()=>f.db.readRunSummaries());
      const selected=baseline.result.filter(row=>row.localDay==="2026-09-09");
      const indexed=measure(()=>f.db.queryRunSummaries({workflow:"person-lookup",fromDay:"2026-09-09",toDay:"2026-09-09",limit:10}));
      assert.deepEqual(indexed.result.items.map(row=>row.runId),selected.slice(0,10).map(row=>row.runId));
      assert.equal(indexed.counts.summaryRows,11);assert.equal(indexed.counts.sourceReconstruction,0);
      const before=f.db.readRunSummaries();
      if(f.run.lifecycle.state!=="running")throw new Error("fixture-state");
      const workerId=f.run.lifecycle.workerId;
      const heartbeat=measure(()=>f.db.authority.runs.renewClaim({runId:f.run.envelope.runId,claim:{workerId,claimGeneration:f.run.claimGeneration},now:"2026-09-09T12:00:01.000Z"}));
      assert.equal(heartbeat.result.state,"renewed");assert.equal(heartbeat.counts.summaryWrites,0);
      assert.deepEqual(f.db.readRunSummaries(),before);
      const current=f.db.authority.runs.get(f.run.envelope.runId);assert.ok(current);
      const update=measure(()=>f.db.authority.runs.updatePresentation({runId:current.envelope.runId,expectedVersion:current.version,displayName:"Synthetic updated",now:"2026-09-09T12:00:02.000Z"}));
      assert.equal(update.counts.summaryWrites,1);
      const raw=new DatabaseSync(f.path,{readOnly:true});let plans:unknown;
      try{plans={page:raw.prepare("EXPLAIN QUERY PLAN SELECT record_json FROM run_summaries WHERE workflow=? AND local_day>=? AND local_day<=? AND state>=? AND state<=? ORDER BY local_day,state,record_key LIMIT ?").all("person-lookup","2026-09-09","2026-09-09","queued","queued",11),parent:raw.prepare("EXPLAIN QUERY PLAN SELECT record_json FROM workflow_runs WHERE parent_run_id=? ORDER BY record_key").all(id(9999))};}finally{raw.close();}
      const compact=(value:{counts:ReturnType<typeof empty>;ms:number})=>({counts:value.counts,ms:value.ms});
      console.log(JSON.stringify({outside,selected:selected.length,page:10,baseline:compact(baseline),indexed:compact(indexed),rebuild:compact(rebuild),heartbeat:compact(heartbeat),update:compact(update),rowsVisited:"unavailable (Node SQLite has no scan-status API); returned rows are measured; EXPLAIN is a plan, not a visit count",plans}));
    }finally{f.dispose();}
  }
}finally{Reflect.set(DatabaseSync.prototype,"prepare",prepare);}
