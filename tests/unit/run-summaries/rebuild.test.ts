import assert from "node:assert/strict";
import { it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { foundationFixture,id } from "../database-foundation/fixtures.js";

it("keeps a complete prior generation across rollback and independent-reader snapshots",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    f.db.refreshRunSummaries();const before=f.db.readRunSummaries();
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:50,migrationOwner:"q-reader"},f.clock);
    peer.withAuthorityReadSnapshot(()=>{
      assert.deepEqual(peer?.readRunSummaries(),before);
      f.createRun(id(4000));f.db.refreshRunSummaries();
      assert.deepEqual(peer?.readRunSummaries(),before);
    });
    const current=f.db.readRunSummaries();assert.equal(current.length,2);
    assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.db.refreshRunSummaries();throw new Error("interrupted");}),/interrupted/);
    assert.deepEqual(f.db.readRunSummaries(),current);
    f.db.withAuthorityTransaction(()=>{assert.throws(()=>peer?.refreshRunSummaries(),/locked|busy/);});
    peer.close();peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:50,migrationOwner:"q-restart"},f.clock);
    assert.deepEqual(peer.readRunSummaries(),current);
  }finally{peer?.close();f.dispose();}
});

it("refuses stale publication after restart and unrelated writes cannot bless it; explicit rebuild repairs it",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    f.db.refreshRunSummaries();const raw=new DatabaseSync(f.path);
    try{raw.exec("UPDATE summary_publication SET record_json=json_set(record_json,'$.sourceGeneration',0)");}finally{raw.close();}
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:50,migrationOwner:"q-stale"},f.clock);
    assert.throws(()=>peer?.queryRunSummaries({workflow:"person-lookup",limit:1}),/generation-unavailable/);
    assert.throws(()=>f.db.authority.runs.updatePresentation({runId:f.run.envelope.runId,expectedVersion:f.run.version,displayName:"Must roll back",now:f.run.updatedAt}),/generation-unavailable/);
    assert.equal(f.db.authority.runs.get(f.run.envelope.runId)?.displayName,f.run.displayName);
    peer.refreshRunSummaries();assert.equal(peer.readRunSummaries().length,1);
  }finally{peer?.close();f.dispose();}
});

it("rolls back a rebuild interrupted after deletion and a first inserted row",()=>{
  const f=foundationFixture();try{
    f.createRun(id(4001));f.db.refreshRunSummaries();const before=f.db.readRunSummaries();
    const raw=new DatabaseSync(f.path);try{
      raw.exec("CREATE TRIGGER q_inject_rebuild BEFORE INSERT ON run_summaries WHEN (SELECT count(*) FROM run_summaries)=1 BEGIN SELECT RAISE(ABORT,'injected-rebuild-failure'); END");
      assert.throws(()=>f.db.refreshRunSummaries(),/injected-rebuild-failure/);
      assert.deepEqual(f.db.readRunSummaries(),before);
      raw.exec("DROP TRIGGER q_inject_rebuild");
      f.db.refreshRunSummaries();assert.equal(f.db.readRunSummaries().length,2);
      raw.exec("DELETE FROM run_summaries");
      assert.throws(()=>f.db.queryRunSummaries({workflow:"person-lookup",limit:1}),/generation-corrupt/);
      f.db.refreshRunSummaries();assert.equal(f.db.readRunSummaries().length,2);
    }finally{raw.close();}
  }finally{f.dispose();}
});

it("refuses old-format and corrupted row digests until an explicit full rebuild",()=>{
  const f=foundationFixture();try{
    f.db.refreshRunSummaries();const raw=new DatabaseSync(f.path);try{
      raw.exec("UPDATE run_summaries SET record_json=json_set(record_json,'$.sourceDigest',printf('%064d',0))");
      assert.throws(()=>f.db.queryRunSummaries({workflow:"person-lookup",limit:1}),/rebuild-required/);
      assert.throws(()=>f.db.readRunSummaries(),/rebuild-required/);
      f.db.refreshRunSummaries();assert.equal(f.db.readRunSummaries().length,1);
      raw.exec("UPDATE run_summaries SET record_json=json_set(record_json,'$.durationMs',123)");
      assert.throws(()=>f.db.queryRunSummaries({workflow:"person-lookup",limit:1}),/rebuild-required/);
      f.db.refreshRunSummaries();assert.equal(f.db.readRunSummaries()[0].durationMs,null);
    }finally{raw.close();}
  }finally{f.dispose();}
});
