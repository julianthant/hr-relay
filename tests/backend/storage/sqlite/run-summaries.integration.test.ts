import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture,id } from "../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

it("keeps a complete prior generation across rollback and independent-reader snapshots",async ()=>{
  const f=await foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    const before=f.db.readRunSummaries();
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:50,migrationOwner:"q-reader"},f.clock);
    peer.withAuthorityReadSnapshot(()=>{
      assert.deepEqual(peer?.readRunSummaries(),before);
      f.createRun(id(4000));
      assert.deepEqual(peer?.readRunSummaries(),before);
    });
    const current=f.db.readRunSummaries();assert.equal(current.length,2);
    const generation=f.db.getMeta().authorityGeneration;
    assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id(4001));throw new Error("interrupted");}),/interrupted/);
    assert.deepEqual(f.db.readRunSummaries(),current);
    assert.equal(f.db.getMeta().authorityGeneration,generation);
    f.db.withAuthorityTransaction(()=>{assert.throws(()=>peer?.authority.runs.updatePresentation({runId:f.run.envelope.runId,expectedVersion:f.run.version,displayName:"Must not commit",now:f.run.updatedAt}),/locked|busy/);});
    assert.deepEqual(f.db.readRunSummaries(),current);
    assert.equal(f.db.getMeta().authorityGeneration,generation);
    peer.close();peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:50,migrationOwner:"q-restart"},f.clock);
    assert.deepEqual(peer.readRunSummaries(),current);
  }finally{peer?.close();await f.dispose();}
});
