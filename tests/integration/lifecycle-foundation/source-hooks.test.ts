import { sha256Hex } from "../../../src/domain/sha256.js";
import assert from "node:assert/strict";
import { lifecycleSourceDigest } from "../../../src/backend/storage/run-lifecycle-storage.js";
import { describe, it } from "vitest";
import { foundationFixture, id, failure, terminalizeFixtureFailure, NOW } from "../../unit/database-foundation/fixtures.js";

describe("L summary publication and transaction hooks", () => {
  it("distinguishes absent publication, refreshes new runs atomically and rolls failed mutations back", () => {
    const fixture = foundationFixture();
    try {
      assert.equal(fixture.db.readRunSummaries().length,1,"fresh publication follows the initial run atomically");
      const raw=new DatabaseSync(fixture.path);
      try { raw.exec("DELETE FROM summary_publication"); } finally {raw.close();}
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
      assert.equal(after.find(row=>row.runId===before[0].runId)?.sourceGeneration,before[0].sourceGeneration);
      assert.equal(after.find(row=>row.runId===id(602))?.sourceGeneration,fixture.db.getMeta().authorityGeneration);
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
      assert.equal(before.records.length,24);
      assert.equal(before.records.some(group=>group.table === "archive_relaunches"),false);
      assert.ok(before.records.some(group => group.table === "provider_requests"));
      assert.ok(before.records.some(group => group.table === "provider_usage"));
      f.db.authority.failureResolution.update({ runId:record.runId,failureId:record.failureId,expectedVersion:1,
        resolution:{status:"resolved",version:2,by:"local-operator",at:NOW} });
      const after = f.db.captureLifecycleSource(record.runId);
      assert.notEqual(lifecycleSourceDigest(before),lifecycleSourceDigest(after));
      assert.equal(f.db.readRunSummaries()[0]?.resolution?.status,"resolved");
      assert.equal(f.db.authority.failures.get(record.failureId)?.writeState,"unknown");
    } finally { f.dispose(); }
  });

});

import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
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

import { versionChangeReviewFingerprint } from "../../../src/domain/archive/change-record.js";
import { queryRunSummarySource } from "../../../src/backend/runs/dashboard/queries/run-summaries.js";
it("keeps unrelated summaries unchanged, rolls nested notifications back, and pages through the real indexed port",()=>{
  const f=foundationFixture();
  try {
    f.db.refreshRunSummaries();const before=f.db.readRunSummaries();
    const review={changeId:id(820),actorId:"local-operator",reviewedAt:NOW,observedAppVersion:"1.0.0",blockers:[],
      change:{kind:"minor" as const,what:"Synthetic",why:"Unrelated source write",commit:{state:"absent" as const,reason:"test"}},
      scope:{kind:"application" as const,applicationVersion:"1.0.0"},targetVersion:"1.1.0",targets:[],members:[],membershipDigest:sha256Hex("[]")};
    f.db.writeVersionChange({...review,schemaVersion:2,reviewFingerprint:versionChangeReviewFingerprint(review),state:"planned",completedRunIds:[]});
    assert.deepEqual(f.db.readRunSummaries(),before);
    f.db.withAuthorityTransaction(()=>{
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id(810));throw new Error("savepoint-rollback");}),/savepoint-rollback/u);
      f.createRun(id(811));
    });
    assert.equal(f.db.authority.runs.get(id(810)),undefined);
    assert.deepEqual(f.db.readRunSummaries().find(row=>row.runId===before[0].runId),before[0]);
    const read=f.db.readRunSummaries.bind(f.db);f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    try {
      const first=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1});
      assert.equal(first.items.length,1);assert.ok(first.next);
      const second=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1,after:first.next});
      assert.equal(second.items.length,1);assert.equal(second.next,null);
      assert.notEqual(first.items[0].runId,second.items[0].runId);
      assert.deepEqual(f.db.summaryWorkflows(),["person-lookup"]);
    }finally{f.db.readRunSummaries=read;}
    const raw=new DatabaseSync(f.path,{readOnly:true});try{
      const plan=JSON.stringify(raw.prepare("EXPLAIN QUERY PLAN SELECT record_json FROM run_summaries WHERE workflow=? AND local_day>=? ORDER BY local_day,record_key LIMIT ?").all("person-lookup","2026-01-01",2));
      assert.match(plan,/USING INDEX/u);assert.doesNotMatch(plan,/SCAN run_summaries/u);
    }finally{raw.close();}
  }finally{f.dispose();}
});
