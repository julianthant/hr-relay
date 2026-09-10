import { QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { historicalFixture, withHistoricalAuthority } from "./historical-fixtures.js";
import { NOW, id } from "../database-foundation/fixtures.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../src/server/storage/upgrade.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { HistoricalVersionChangeSchema } from "../../../src/infra/sqlite/storage-records.js";
import { ARCHIVE_RELAUNCH } from "../../fixtures/archive-fixtures.js";
import { projectArchiveReport } from "../../../src/server/dashboard/queries/archive-reports.js";

for(const step of ["captured","verified","cleaned","published","retired","committed"] as const) it(`stopped populated retirement resumes after ${step} without transfer deletion`,async()=>{
  const f=historicalFixture();
  try {
    const original=withHistoricalAuthority(f,db=>createRunLifecycleStorage(db).historicalArchiveSource());
    await backupStoppedAuthority(f.root,f.clock);
    const input={stateRoot:f.root,processLockRoot:join(f.root,"locks"),environmentFile:join(f.root,".env"),plan:false};
    const before=readFileSync(f.path),names=readdirSync(f.root).sort();
    assert.equal((await upgradeStorage({...input,plan:true},f.clock)).state,"planned");
    assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readdirSync(f.root).sort(),names);
    await assert.rejects(upgradeStorage({...input,hooks:{archiveStep(at){if(at===step)throw new Error("retirement-interrupted");},afterCommit(){if(step==="committed")throw new Error("retirement-interrupted");}}},f.clock),/retirement-interrupted/u);
    assert.ok(existsSync(join(f.root,".archive-conversion.json")));
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/archive-conversion-incomplete/u);
    f.clock.advanceWall(1000);
    assert.equal((await upgradeStorage(input,f.clock)).state,"converted");
    assert.equal(existsSync(join(f.root,".archive-conversion.json")),false);
    const raw=new DatabaseSync(f.path);
    try {
      assert.throws(()=>raw.exec("UPDATE version_changes SET record_json=record_json"),/historical version change is immutable/u);
      assert.throws(()=>raw.exec("INSERT OR REPLACE INTO version_changes SELECT * FROM version_changes"),/historical version change is immutable/u);
      assert.throws(()=>raw.exec("DELETE FROM version_changes"),/historical version change is retained/u);
      for(const table of ["archived_runs","version_plans","version_bump_applications"])assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table),undefined);}
    finally{raw.close();}
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"readback"},f.clock);
    try {
      const storage=createRunLifecycleStorage(db),report=storage.readReport(f.run.envelope.runId);assert.ok(report);
      assert.equal(projectArchiveReport(report).state,"available");
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.equal(db.authority.runs.get(f.run.envelope.runId),undefined);
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.deepEqual(db.authority.archiveRelaunches.listByArchivedRun(f.run.envelope.runId),[ARCHIVE_RELAUNCH]);
      const history=db.historicalVersionChanges().map(row=>HistoricalVersionChangeSchema.parse(row));
      assert.deepEqual(history.map(row=>row.plan),original.source.plans);
      assert.deepEqual(history.map(row=>row.application),original.source.applications);
      assert.equal(history[0].sourceDigest,original.digest);
      assert.ok(report.content.sources[0].json.includes("archive_transactions"));
      assert.equal(db.authority.runs.listCurrentByWorkflow("person-lookup").length,1);
      assert.equal(db.readRunSummaries().length,1);
      const freshId=id(9901);
      db.authority.runs.enqueue({...QUEUED_RUN,runNumber:db.authority.runs.nextWorkflowRunNumber("person-lookup"),
        envelope:{...f.run.envelope,runId:freshId,itemId:freshId}});
      const claim=db.authority.runs.claimNext({workflow:"person-lookup",workerId:"free-worker",now:NOW});
      assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("post-retirement claim missing");
      assert.equal(claim.run.envelope.runId,freshId);
      db.authority.runs.transition({runId:freshId,expectedVersion:claim.run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
      assert.equal(db.authority.runs.delete({runId:freshId,origin:"queue",commandId:id(9902),now:NOW}).origin,"queue");
      assert.equal(db.readRunSummaries().length,1);
      const deletion=db.authority.runs.delete({runId:f.run.envelope.runId,origin:"archive",commandId:"00000000-0000-4000-8000-000000009999",now:NOW});
      assert.equal(deletion.origin,"archive");assert.equal(storage.readReport(f.run.envelope.runId),undefined);
    }finally{db.close();}
  } finally {f.dispose();}
});

import { restoreHistoricalStorage } from "../../../src/server/storage/historical-restore.js";
import { RecoveryStopProofStore } from "../../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { mkdirSync } from "node:fs";
for(const interruption of ["restored","quarantined","converted"] as const)it(`restores an old populated backup through conversion after ${interruption}`,async()=>{
  const f=historicalFixture();
  try {
    const backup=await backupStoppedAuthority(f.root,f.clock),manifest=backup.manifests.at(-1);assert.ok(manifest);
    const manifestPath=join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const processLockRoot=join(f.root,"locks");mkdirSync(processLockRoot,{recursive:true});
    await upgradeStorage({stateRoot:f.root,processLockRoot,environmentFile:join(f.root,".env"),plan:false},f.clock);
    const options={authorityPath:f.path,suspectDirectory:join(f.root,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000};
    const proof=()=>{
      const store=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.clock),sourceDatabaseIdentity=AuthorityDatabase.sourceDatabaseIdentity(f.path);
      store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity},f.clock));
      return store.issue({observedBy:"local-operator",sourceDatabaseIdentity});
    };
    await assert.rejects(restoreHistoricalStorage(options,{manifestPath,stoppedSystemProof:proof()},join(f.root,".env"),f.clock,step=>{if(step===interruption)throw new Error("restore-interrupted");}),/historical-restore-incomplete/u);
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/archive-conversion-incomplete/u);
    const result=await restoreHistoricalStorage(options,{manifestPath,stoppedSystemProof:proof()},join(f.root,".env"),f.clock);
    assert.equal(result.upgrade.state,"converted");assert.equal(result.upgrade.toSchemaVersion,49);
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"restore-readback"},f.clock);
    try{
      const storage=createRunLifecycleStorage(db);assert.ok(storage.readReport(f.run.envelope.runId));
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.equal(db.historicalVersionChanges().length,1);
      assert.deepEqual(db.authority.archiveRelaunches.listByArchivedRun(f.run.envelope.runId),[ARCHIVE_RELAUNCH]);
    }finally{db.close();}
    assert.ok(readdirSync(options.suspectDirectory).some(name=>name.startsWith("archive.sqlite.")));
  }finally{f.dispose();}
});
