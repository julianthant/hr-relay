import assert from "node:assert/strict";
import { lifecycleSourceDigest } from "../../../src/core/run-lifecycle-storage.js";
import { describe, it } from "vitest";
import { foundationFixture, id, failure, terminalizeFixtureFailure, NOW } from "../database-foundation/fixtures.js";

describe("L summary publication and transaction hooks", () => {
  it("distinguishes absent publication, refreshes new runs atomically and rolls failed mutations back", () => {
    const fixture = foundationFixture();
    try {
      assert.throws(() => fixture.db.readRunSummaries(), /generation-unavailable/u);
      const publication = fixture.db.refreshRunSummaries();
      assert.equal(publication.rowCount, 1);
      const before = fixture.db.readRunSummaries();
      assert.throws(() => fixture.db.withAuthorityTransaction(() => {
        fixture.createRun(id(601));
        throw new Error("injected-lifecycle-rollback");
      }), /injected-lifecycle-rollback/u);
      assert.deepEqual(fixture.db.readRunSummaries(), before);
      fixture.createRun(id(602));
      const after = fixture.db.readRunSummaries();
      assert.equal(after.length, 2);
      assert.ok(after.every((row) => row.sourceGeneration === fixture.db.getMeta().authorityGeneration));
      assert.ok(after.every((row) => row.person.state === "unavailable"));
    } finally { fixture.dispose(); }
  });
  it("captures failure resolution changes and maintains the summary in the same transaction", () => {
    const f = foundationFixture();
    try {
      const record = failure();
      terminalizeFixtureFailure(f,f.run,record);
      f.db.refreshRunSummaries();
      const before = f.db.captureLifecycleSource(record.runId);
      assert.equal(before.records.length,20);
      f.db.authority.failureResolution.update({ runId:record.runId,failureId:record.failureId,expectedVersion:1,
        resolution:{status:"resolved",version:2,by:"local-operator",at:NOW} });
      const after = f.db.captureLifecycleSource(record.runId);
      assert.notEqual(lifecycleSourceDigest(before),lifecycleSourceDigest(after));
      assert.equal(f.db.readRunSummaries()[0]?.resolution?.status,"resolved");
      assert.equal(f.db.authority.failures.get(record.failureId)?.writeState,"unknown");
    } finally { f.dispose(); }
  });

});

import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { DatabaseSync } from "node:sqlite";
it("reads a consistent publication across an independent writer and refuses a corrupt generation after restart",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    f.db.refreshRunSummaries();peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-peer"},f.clock);
    const before=f.db.readRunSummaries();
    f.db.withAuthorityReadSnapshot(()=>{
      assert.deepEqual(f.db.readRunSummaries(),before);
      peer?.refreshRunSummaries();
      assert.deepEqual(f.db.readRunSummaries(),before);
    });
    assert.ok(f.db.readRunSummaries()[0].sourceGeneration>before[0].sourceGeneration);
    peer.close();peer=undefined;
    const raw=new DatabaseSync(f.path);try{raw.prepare("UPDATE summary_publication SET record_json=json_set(record_json,'$.sourceGeneration',0)").run();}finally{raw.close();}
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-restart"},f.clock);
    assert.throws(()=>peer?.readRunSummaries(),/generation-unavailable/u);
  }finally{peer?.close();f.dispose();}
});
