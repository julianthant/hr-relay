import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { foundationFixture, NOW, HASH, id } from "../database-foundation/fixtures.js";
import { ArchiveDatabase } from "../../../src/infra/sqlite/archive-database.js";
import { sealArchiveReport } from "../../../src/domain/archive/report.js";

describe("L archive report/file interruption", () => {
  it("retains the live source across missing files, resumes after restart and refuses changed custody", () => {
    const f = foundationFixture();
    const path = join(f.root,"archive.sqlite");
    let archive = new ArchiveDatabase(path);
    try {
      const bytes = Buffer.from("synthetic retained attachment");
      const file = { digest:createHash("sha256").update(bytes).digest("hex"), byteLength:bytes.length, name:"evidence.txt",mediaType:"text/plain" };
      const report = sealArchiveReport({ schemaVersion:1,runId:f.run.envelope.runId,transferId:id(801),workflow:"person-lookup",
        itemId:f.run.envelope.itemId,attempt:1,runNumber:1,title:"Synthetic run",descriptorVersion:"1",outcome:"failed",
        completedAt:NOW,capturedAt:NOW,sourceDigest:HASH,sources:[],sections:[],files:[file] });
      archive.capture(report);
      assert.throws(() => archive.verify(report.content.runId,report.digest), /file-unavailable/u);
      assert.equal(archive.state(report.content.runId),"captured");
      assert.ok(f.db.authority.runs.get(report.content.runId));
      archive.close(); archive = new ArchiveDatabase(path);
      archive.retainFile(file,bytes);
      archive.verify(report.content.runId,report.digest);
      archive.publish(report.content.runId,report.digest);
      assert.deepEqual(archive.readPublished(report.content.runId),report);
      writeFileSync(join(f.root,"archive-files",file.digest),"changed");
      assert.throws(() => archive.readPublished(report.content.runId), /integrity-mismatch/u);
      assert.ok(f.db.authority.runs.get(report.content.runId));
      assert.equal(f.db.authority.deletedRuns.get(report.content.runId),undefined);
    } finally { archive.close(); f.dispose(); }
  });
});

import { backupLifecyclePair, restoreLifecyclePair, createRunLifecycleStorage, verifyLifecyclePair } from "../../../src/core/run-lifecycle-storage.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";
import { failure, terminalizeFixtureFailure } from "../database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { RecoveryStopProofStore } from "../../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { existsSync, mkdirSync } from "node:fs";

describe("L paired recovery",()=>{
  for(const interruption of ["live","archive","files"] as const)it(`resumes after ${interruption} replacement with both authorities and retained bytes`,async()=>{
    const f=foundationFixture();let reopened:AuthorityDatabase|undefined;let closed=false;
    try{
      terminalizeFixtureFailure(f,f.run,failure());
      const storage=createRunLifecycleStorage(f.db),snapshot=storage.capture(f.run.envelope.runId);
      const bytes=Buffer.from([0,255,128,4]),file={digest:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.length,name:"capture.bin",mediaType:"application/octet-stream"};
      const report=captureArchiveReport({snapshot,transferId:id(820),capturedAt:NOW,sections:[],files:[file]});
      storage.retainFile(file,bytes);transferArchiveReport(storage,report,snapshot.run.version);storage.refreshSummaries();
      const review={changeId:id(826),actorId:"local-operator",reviewedAt:NOW,observedAppVersion:"1.0.0",blockers:[],
        change:{kind:"minor" as const,what:"Recovery metadata",why:"Preserve reviewed authority",commit:{state:"absent" as const,reason:"test"}},
        scope:{kind:"application" as const,applicationVersion:"1.0.0"},targetVersion:"1.1.0",targets:[],members:[],membershipDigest:createHash("sha256").update("[]").digest("hex")};
      const change={...review,schemaVersion:2 as const,reviewFingerprint:versionChangeReviewFingerprint(review),state:"planned" as const,completedRunIds:[]};
      storage.writeVersionChange(change);
      const backup=await backupLifecyclePair(f.db,f.root,f.clock);
      if(!("pairedManifestPath" in backup))throw new Error("paired manifest missing");
      await verifyLifecyclePair(backup.pairedManifestPath);
      const processLockRoot=join(f.root,"locks");mkdirSync(processLockRoot,{recursive:true});
      const options={authorityPath:f.path,suspectDirectory:join(f.root,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000};
      const proof=()=>{
        const store=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.clock);
        const sourceDatabaseIdentity=AuthorityDatabase.sourceDatabaseIdentity(f.path);
        store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity},f.clock));
        return store.issue({observedBy:"local-operator",sourceDatabaseIdentity});
      };
      f.db.close();closed=true;
      await assert.rejects(restoreLifecyclePair(options,{manifestPath:backup.pairedManifestPath,stoppedSystemProof:proof()},async()=>{},f.clock,
        step=>{if(step===interruption)throw new Error("injected-pair-interruption");}),/lifecycle-restore-incomplete/u);
      assert.equal(existsSync(join(f.root,".lifecycle-restore.json")),true);
      assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"pair-proof"},f.clock),/lifecycle-restore-incomplete/u);
      await restoreLifecyclePair(options,{manifestPath:backup.pairedManifestPath,stoppedSystemProof:proof()},async()=>{},f.clock);
      reopened=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"pair-proof"},f.clock);
      assert.equal(reopened.transferredRun(report.content.runId)?.reportDigest,report.digest);
      assert.deepEqual(createRunLifecycleStorage(reopened).readFile(report.content.runId,file.digest).bytes,bytes);
      assert.deepEqual(reopened.readRunSummaries(),[]);
      assert.deepEqual(reopened.readVersionChange(change.changeId),change);
      assert.equal(existsSync(join(f.root,".lifecycle-restore.json")),false);
    }finally{reopened?.close();if(closed){const {rmSync}=await import("node:fs");rmSync(f.root,{recursive:true,force:true});}else f.dispose();}
  });
});

import { rmSync } from "node:fs";
describe("L transfer crash boundaries",()=>{
  for(const interruption of ["captured","verified","cleaned"] as const)it(`restarts after ${interruption} without recreating a source or a deletion receipt`,()=>{
    const f=foundationFixture();let database=f.db;
    try{
      terminalizeFixtureFailure(f,f.run,failure());
      let storage=createRunLifecycleStorage(database);const snapshot=storage.capture(f.run.envelope.runId);
      const report=captureArchiveReport({snapshot,transferId:id(850),capturedAt:NOW,sections:[],files:[]});
      assert.throws(()=>transferArchiveReport(storage,report,snapshot.run.version,step=>{if(step===interruption)throw new Error("transfer-interrupted");}),/transfer-interrupted/u);
      assert.equal(database.authority.runs.get(report.content.runId)!==undefined,interruption!=="cleaned");
      assert.equal(database.authority.deletedRuns.get(report.content.runId),undefined);
      database.close();database=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"transfer-restart"},f.clock);
      storage=createRunLifecycleStorage(database);
      assert.deepEqual(transferArchiveReport(storage,report,snapshot.run.version),report);
      assert.equal(database.authority.runs.get(report.content.runId),undefined);
      assert.equal(database.authority.deletedRuns.get(report.content.runId),undefined);
      assert.throws(()=>storage.readFile(report.content.runId,HASH),/membership-missing/u);
    }finally{database.close();rmSync(f.root,{recursive:true,force:true});}
  });
});

it("resumes file deletion after unlink and keeps a file referenced by another archived report",()=>{
  const f=foundationFixture();let reopened:ArchiveDatabase|undefined;
  try{
    terminalizeFixtureFailure(f,f.run,failure());
    const second=f.createRun(id(860));
    terminalizeFixtureFailure(f,second,{...failure(),failureId:id(861),runId:second.envelope.runId,traceId:second.envelope.traceId});
    const storage=createRunLifecycleStorage(f.db);
    const file=(text:string)=>{const bytes=Buffer.from(text);return {bytes,ref:{digest:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.length,name:"evidence.txt",mediaType:"text/plain"}};};
    const shared=file("shared retained bytes"),exclusive=file("first report only");
    storage.retainFile(shared.ref,shared.bytes);storage.retainFile(exclusive.ref,exclusive.bytes);
    const reports=[f.run.envelope.runId,second.envelope.runId].map((runId,index)=>{
      const snapshot=storage.capture(runId),report=captureArchiveReport({snapshot,transferId:id(862+index),capturedAt:NOW,sections:[],files:index===0?[exclusive.ref,shared.ref]:[shared.ref]});
      transferArchiveReport(storage,report,snapshot.run.version);return report;
    });
    const first=reports[0],receipt=f.db.authority.runs.delete({runId:first.content.runId,origin:"archive",commandId:id(864),now:NOW});
    const archive=f.db.lifecycleArchive();archive.beginDelete(receipt,first.digest);
    assert.throws(()=>archive.settleDelete(first.content.runId,()=>{throw new Error("unlink-interrupted");}),/unlink-interrupted/u);
    assert.equal(archive.state(first.content.runId),"deleting");
    reopened=new ArchiveDatabase(join(f.root,"archive.sqlite"));reopened.settleDelete(first.content.runId);reopened.settleDelete(first.content.runId);
    assert.equal(reopened.state(first.content.runId),"deleted");
    assert.equal(existsSync(join(f.root,"archive-files",exclusive.ref.digest)),false);
    assert.deepEqual(storage.readFile(second.envelope.runId,shared.ref.digest).bytes,shared.bytes);
    assert.equal(storage.readReport(first.content.runId),undefined);
  }finally{reopened?.close();f.dispose();}
});

import { versionChangeReviewFingerprint } from "../../../src/domain/archive/change-record.js";
