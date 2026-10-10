import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { foundationFixture, id, failure, terminalizeFixtureFailure, NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { queryRunSummarySource } from "../../../../../../src/backend/runs/queries/run-summaries.js";

const semanticRows=(rows:ReturnType<AuthorityDatabase["readRunSummaries"]>)=>rows.map(({sourceGeneration,...row})=>{void sourceGeneration;return row;});

describe("native summary snapshots and transaction hooks", () => {
  it("derives new runs atomically and rolls failed mutations back", () => {
    const fixture = foundationFixture();
    try {
      assert.equal(fixture.db.readRunSummaries().length,1);
      const before = fixture.db.readRunSummaries();
      const generation=fixture.db.getMeta().authorityGeneration;
      assert.throws(() => fixture.db.withAuthorityTransaction(() => {
        fixture.createRun(id(601));
        throw new Error("injected-lifecycle-rollback");
      }), /injected-lifecycle-rollback/u);
      assert.deepEqual(fixture.db.readRunSummaries(), before);
      assert.equal(fixture.db.getMeta().authorityGeneration,generation);
      fixture.createRun(id(602));
      const after = fixture.db.readRunSummaries();
      assert.equal(after.length, 2);
      assert.deepEqual(semanticRows(after.filter(row=>row.runId===before[0].runId)),semanticRows(before));
      assert.ok(after.every(row=>row.sourceGeneration===fixture.db.getMeta().authorityGeneration));
      assert.ok(after.every(row=>row.person.state==="unavailable"));
      assert.equal(fixture.db.authority.workerSlots.list("person-lookup").length,2);
    } finally { fixture.dispose(); }
  });

  it("notices resolution annotations without replacing immutable UNKNOWN failure evidence", () => {
    const f = foundationFixture();
    try {
      const record = failure();terminalizeFixtureFailure(f,f.run,record);
      const before=f.db.authority.failures.get(record.failureId);
      assert.ok(before);
      const beforeSummary=f.db.readRunSummaries()[0];assert.ok(beforeSummary);
      f.db.authority.failureResolution.update({ runId:record.runId,failureId:record.failureId,expectedVersion:1,
        resolution:{status:"resolved",version:2,by:"local-operator",at:NOW} });
      const afterSummary=f.db.readRunSummaries()[0];assert.ok(afterSummary);
      assert.equal(afterSummary.resolution?.status,"resolved");
      assert.notEqual(afterSummary.sourceDigest,beforeSummary.sourceDigest);
      assert.deepEqual(f.db.authority.failures.get(record.failureId),before);
      assert.equal(before.writeState,"unknown");
    } finally { f.dispose(); }
  });
});

it("reads a consistent admitted snapshot across an independent writer and refuses corrupt run mirrors after restart",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-peer"},f.clock);
    const before=f.db.readRunSummaries();
    f.db.withAuthorityReadSnapshot(()=>{
      assert.deepEqual(f.db.readRunSummaries(),before);
      peer?.authority.runs.updatePresentation({runId:f.run.envelope.runId,expectedVersion:f.run.version,displayName:"Concurrent title",now:NOW});
      assert.deepEqual(f.db.readRunSummaries(),before);
    });
    assert.equal(f.db.readRunSummaries()[0].title,"Concurrent title");
    assert.ok(f.db.readRunSummaries()[0].sourceGeneration>before[0].sourceGeneration);
    peer.close();peer=undefined;
    const raw=new DatabaseSync(f.path);try{raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(f.run.envelope.runId);}finally{raw.close();}
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-restart"},f.clock),/run row version does not match its whole-record JSON/u);
  }finally{peer?.close();f.dispose();}
});

it("keeps unrelated source facts unchanged, rolls nested mutations back and pages through the real query port",()=>{
  const f=foundationFixture();
  try {
    const before=f.db.readRunSummaries(),pool=f.db.authority.workerPools.get("person-lookup");assert.ok(pool);
    const beforeGeneration=f.db.getMeta().authorityGeneration;
    const planned=f.db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:pool.version,desiredWorkers:pool.desiredWorkers,requestedBy:"local-operator",now:NOW});
    assert.equal(planned.state,"applied");
    const afterPlan=f.db.readRunSummaries(),afterGeneration=f.db.getMeta().authorityGeneration;
    assert.ok(afterGeneration>beforeGeneration);
    assert.ok(afterPlan.every(row=>row.sourceGeneration===afterGeneration));
    assert.deepEqual(semanticRows(afterPlan),semanticRows(before));
    f.db.withAuthorityTransaction(()=>{
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id(810));throw new Error("savepoint-rollback");}),/savepoint-rollback/u);
      f.createRun(id(811));
    });
    assert.equal(f.db.authority.runs.get(id(810)),undefined);
    assert.deepEqual(semanticRows(f.db.readRunSummaries().filter(row=>row.runId===before[0].runId)),semanticRows(before));
    const read=f.db.readRunSummaries.bind(f.db);f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    try {
      const first=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1});
      assert.equal(first.items.length,1);assert.ok(first.next);
      const second=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1,after:first.next});
      assert.equal(second.items.length,1);assert.equal(second.next,null);
      assert.notEqual(first.items[0].runId,second.items[0].runId);
      assert.deepEqual(f.db.summaryWorkflows(),["person-lookup"]);
    }finally{f.db.readRunSummaries=read;}
  }finally{f.dispose();}
});
