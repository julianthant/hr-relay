import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { HISTORY_NOW,historyClock,historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

async function peers(){
  const world=await historyWorld({terminalize:true}),fixture=world.commit(90);
  const source=world.database.authority.runs.get(fixture.commit.transaction.runId);assert.ok(source);
  const retry=RunRecordSchema.parse({envelope:{...source.envelope,runId:fixtureUuid("native-peer-retry"),attempt:2,retryOf:source.envelope.runId,enqueuedAt:HISTORY_NOW},
    input:source.input,lifecycle:{state:"queued"},claimGeneration:0,version:1,createdAt:HISTORY_NOW,updatedAt:HISTORY_NOW});
  world.database.authority.runs.enqueue(retry);
  const service=testRunService(world.database,historyClock);
  const terminal=service.transition({commandId:fixtureUuid("native-peer-discard"),runId:retry.envelope.runId,
    expectedVersion:retry.version,lifecycle:{state:"terminal",outcome:"discarded",endedAt:HISTORY_NOW}});
  assert.equal(terminal.state,"applied");
  return {world,fixture,source,retry,service};
}

describe("current peer run custody",()=>{
  it.each([true,false])("retains permanent confirmed evidence after both same-item run deletions, source first=%s",async sourceFirst=>{
    const f=await peers();
    try{
      const intent=f.world.database.authority.writeIntents.get(f.fixture.commit.writeIntentId);
      const attempts=f.world.database.authority.writeAttempts.listByIntent(f.fixture.commit.writeIntentId);
      assert.equal(intent?.status,"committed");assert.equal(attempts.length,1);
      const ids=sourceFirst?[f.source.envelope.runId,f.retry.envelope.runId]:[f.retry.envelope.runId,f.source.envelope.runId];
      for(const [index,runId] of ids.entries()){
        const run=f.world.database.authority.runs.get(runId);assert.ok(run);
        const commandId=fixtureUuid(`native-peer-delete-${String(sourceFirst)}-${String(index)}`);
        const request={runId,expectedVersion:run.version,commandId};
        assert.equal(f.service.delete(request).state,"deleted");
        assert.equal(f.service.delete(request).state,"applied-already");
        assert.equal(f.service.read(runId).state,"deleted");
        assert.deepEqual(f.world.database.authority.writeIntents.get(f.fixture.commit.writeIntentId),intent);
        assert.deepEqual(f.world.database.authority.writeAttempts.listByIntent(f.fixture.commit.writeIntentId),attempts);
      }
      f.world.reopen();
      assert.equal(f.world.database.authority.runs.nextItemAttempt({workflow:f.source.envelope.workflow,itemId:f.source.envelope.itemId}),3);
      assert.deepEqual(f.world.database.authority.writeIntents.get(f.fixture.commit.writeIntentId),intent);
      assert.deepEqual(f.world.database.authority.writeAttempts.listByIntent(f.fixture.commit.writeIntentId),attempts);
      assert.equal(f.world.database.authority.deletedRuns.get(f.source.envelope.runId)?.attempt,1);
      assert.equal(f.world.database.authority.deletedRuns.get(f.retry.envelope.runId)?.attempt,2);
    }finally{await f.world.dispose();}
  });

  it("clears two confirmed runs in one history command and keeps their confirmed history",async ()=>{
    const world=await historyWorld({terminalize:true});
    try{
      const fixtures=[world.commit(1),world.commit(2)],range={from:"2026-07-01",to:"2026-09-09"};
      const retained=()=>fixtures.map(f=>({intent:world.database.authority.writeIntents.get(f.commit.writeIntentId),
        attempts:world.database.authority.writeAttempts.listByIntent(f.commit.writeIntentId)}));
      const before=retained(),history=world.history.query(range);
      assert.equal(history.rows.length,2);
      const service=testRunService(world.database,historyClock);
      const seeded=world.database.authority.runs.listByWorkflow(personLookupDescriptor.id).filter(run=>run.lifecycle.state!=="terminal");
      for(const run of seeded){
        if(!("workerId" in run.lifecycle))throw new Error("seeded run is not claimed");
        const requested=service.transition({commandId:fixtureUuid(`seed-cancel-${run.envelope.runId}`),runId:run.envelope.runId,
          expectedVersion:run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:HISTORY_NOW}});
        if(requested.state!=="applied")throw new Error("seeded run cancellation refused");
        assert.equal(service.terminalize({kind:"cancelled",commandId:fixtureUuid(`seed-settle-${run.envelope.runId}`),runId:run.envelope.runId,
          expectedVersion:requested.run.version,claim:{workerId:run.lifecycle.workerId,claimGeneration:run.claimGeneration},endedAt:HISTORY_NOW},personLookupDescriptor).state,"applied");
      }
      const commandId=fixtureUuid("confirmed-history-clear");
      assert.deepEqual(service.clearHistory({commandId}),{state:"cleared",commandId,deletedRuns:2+seeded.length});
      for(const f of fixtures)assert.ok(world.database.authority.deletedRuns.get(f.commit.transaction.runId));
      assert.deepEqual(retained(),before);
      assert.deepEqual(world.history.query(range).rows.map(row=>row.eventId),history.rows.map(row=>row.eventId));
      world.reopen();
      assert.deepEqual(retained(),before);
      assert.deepEqual(world.history.query(range).rows.map(row=>row.eventId),history.rows.map(row=>row.eventId));
    }finally{await world.dispose();}
  });

  it("refuses a corrupt current peer before deleting a retry or writing a tombstone",async ()=>{
    const f=await peers();
    try{
      const retry=f.world.database.authority.runs.get(f.retry.envelope.runId);assert.ok(retry);
      const generation=f.world.database.getMeta().authorityGeneration;
      using raw=new DatabaseSync(f.world.path);
      const original=raw.prepare("SELECT lifecycle_json FROM runs WHERE id=?").get(f.source.envelope.runId)?.lifecycle_json;
      assert.ok(typeof original==="string");
      using _restore={ [Symbol.dispose]() { raw.prepare("UPDATE runs SET lifecycle_json=? WHERE id=?").run(original,f.source.envelope.runId); } };
      {
        const corrupt=JSON.stringify({...f.source.input,unexpectedField:true});
        assert.equal(raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,?,json(?)) WHERE id=?")
          .run("$.input",corrupt,f.source.envelope.runId).changes,1);
      }
      assert.throws(()=>f.service.delete({runId:retry.envelope.runId,expectedVersion:retry.version,commandId:fixtureUuid("corrupt-peer-delete")}),/unexpectedField/u);
      const checked=new DatabaseSync(f.world.path,{readOnly:true});
      try{
        assert.equal(checked.prepare("SELECT count(*) AS n FROM runs WHERE id=?").get(retry.envelope.runId)?.n,1);
        assert.equal(checked.prepare("SELECT count(*) AS n FROM deleted_runs WHERE run_id=?").get(retry.envelope.runId)?.n,0);
        assert.equal(checked.prepare("SELECT count(*) AS n FROM commands WHERE id=?").get(fixtureUuid("corrupt-peer-delete"))?.n,0);
        assert.equal(checked.prepare("SELECT authority_generation FROM database_states WHERE id=1").get()?.authority_generation,generation);
      }finally{checked.close();}
    }finally{await f.world.dispose();}
  });
});
