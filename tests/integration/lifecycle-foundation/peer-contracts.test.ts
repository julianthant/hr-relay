import { deriveWriteBindingProofDigest } from "../../../src/domain/write-safety.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { captureArchiveReport } from "../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/backend/storage/archive-transfer.js";
import { createRunLifecycleStorage } from "../../../src/backend/storage/run-lifecycle-storage.js";
import { failure, terminalizeFixtureFailure } from "../../helpers/database-foundation/fixtures.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { foundationFixture, NOW, HASH, id } from "../../helpers/database-foundation/fixtures.js";
import { ArchiveDatabase } from "../../helpers/synthetic-storage-admission.js";
import { sealArchiveReport } from "../../../src/domain/archive/report.js";
import { projectArchiveReport, readArchiveReport } from "../../../src/backend/runs/dashboard/queries/archive-reports.js";
import { sha256Hex } from "../../../src/domain/sha256.js";

describe("L independent baseline capabilities", () => {
  for (const order of ["archive-first", "summary-first"] as const) it(order, () => {
    const f = foundationFixture();
    const archive = new ArchiveDatabase(join(f.root,"archive.sqlite"));
    try {
      const report = sealArchiveReport({ schemaVersion:1,runId:f.run.envelope.runId,transferId:id(701),
        workflow:"person-lookup",itemId:f.run.envelope.itemId,attempt:1,runNumber:1,title:"Synthetic run",descriptorVersion:"1",
        outcome:"failed",completedAt:NOW,capturedAt:NOW,sourceDigest:HASH,
        sources:[{kind:"historical-projection",json:'{"retired":true}',digest:sha256Hex('{"retired":true}')}],
        sections:[{kind:"text",title:"Result",text:"Frozen result"}],files:[] });
      const capture = () => {
        archive.capture(report);
        assert.equal(projectArchiveReport(archive.readPublished(report.content.runId)).state,"unavailable");
        archive.verify(report.content.runId,report.digest);
        archive.publish(report.content.runId,report.digest);
        assert.deepEqual(archive.readPublished(report.content.runId),report);
      };
      if (order === "archive-first") { capture(); f.db.refreshRunSummaries(); }
      else { f.db.refreshRunSummaries(); capture(); }
      assert.equal(f.db.readRunSummaries().length,1);
      const view = projectArchiveReport(archive.readPublished(report.content.runId));
      assert.equal(view.state,"available");
      assert.equal("sources" in view,false);
      assert.throws(() => archive.capture(sealArchiveReport({...report.content,title:"Changed"})), /replay-conflict/u);
      assert.equal(f.db.authority.deletedRuns.get(report.content.runId),undefined);
    } finally { archive.close(); f.dispose(); }
  });
});

describe("L composed transfer and summary independence", () => {
  for (const order of ["archive-first","summary-first"] as const) it(order, () => {
    const f=foundationFixture();
    try {
      terminalizeFixtureFailure(f,f.run,failure());
      const storage=createRunLifecycleStorage(f.db),runId=f.run.envelope.runId;
      const snapshot=storage.capture(runId);
      const report=captureArchiveReport({snapshot,transferId:id(702),capturedAt:NOW,sections:[],files:[]});
      if(order==="summary-first")storage.refreshSummaries();
      assert.throws(()=>storage.publishReport(runId,report.digest),/progress-missing/u);
      assert.deepEqual(transferArchiveReport(storage,report,snapshot.run.version),report);
      assert.equal(f.db.authority.runs.get(runId),undefined);
      assert.equal(f.db.authority.deletedRuns.get(runId),undefined);
      assert.equal(f.db.transferredRun(runId)?.run.envelope.runId,runId);
      assert.deepEqual(transferArchiveReport(storage,report,snapshot.run.version),report);
      if(order==="archive-first")storage.refreshSummaries();
      assert.deepEqual(storage.summaries(),[]);
      assert.equal(f.db.authority.runs.nextItemAttempt({workflow:snapshot.run.envelope.workflow,itemId:snapshot.run.envelope.itemId}),2);
      const receipt=f.db.authority.runs.delete({runId,origin:"archive",commandId:id(703),now:NOW});
      assert.equal(receipt.origin,"archive");
      f.db.settleArchivedDeletion(runId);
      assert.equal(f.db.lifecycleArchive().state(runId),"deleted");
      assert.equal(f.db.transferredRun(runId),undefined);
      assert.equal(readArchiveReport(storage,runId).state,"unavailable");
    } finally {f.dispose();}
  });
});

import { currentAtomicWriteFixture, atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../fixtures/phase1c-contract-fixtures.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { DatabaseSync } from "node:sqlite";

describe("L retained retry ownership",()=>{
  for(const refenced of [false,true]) for(const archiveFirst of [true,false])it(`releases shared evidence only at last deletion; archived first=${String(archiveFirst)}, two attempt owners=${String(refenced)}`,()=>{
    const base=foundationFixture(),path=join(base.root,"ownership.db");
    const db=AuthorityDatabase.open({path,busyTimeoutMs:500,migrationOwner:"archive-owner-proof"},base.clock);
    const f={...base,db,path,dispose:()=>{db.close();base.dispose();}};
    try{
      const commit=currentAtomicWriteFixture(HISTORICAL_COMMIT);
      seedAtomicWriteOwner(f.db,commit);
      f.db.authority.writeIntents.fenceAttempt({intent:WRITE_INTENT_ATTEMPTING,attempt:WRITE_ATTEMPT});
      if(!refenced)f.db.commitWriteAttempt(commit,atomicWriteCheckpoint(commit));
      else f.db.authority.writeIntents.settleRetryable({writeIntentId:WRITE_INTENT_ATTEMPTING.writeIntentId,generation:1,expectedVersion:1,
        settlement:{state:"operator-confirmed-absent",writeIntentId:WRITE_INTENT_ATTEMPTING.writeIntentId,generation:1,operator:"local-operator",confirmedAt:NOW,evidenceNote:"Synthetic absent proof"},now:NOW});
      const source=f.db.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);if(source===undefined)throw new Error("source missing");
      f.db.authority.runs.transition({runId:source.envelope.runId,expectedVersion:source.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
      const retry=RunRecordSchema.parse({...source,envelope:{...source.envelope,runId:id(740),attempt:2,retryOf:source.envelope.runId,enqueuedAt:NOW},lifecycle:{state:"queued"},version:1,createdAt:NOW,updatedAt:NOW});
      f.db.authority.runs.enqueue(retry);
      if(refenced) {
        const bindingProof={...WRITE_ATTEMPT.bindingProof,proofId:id(746),runId:retry.envelope.runId,attempt:2,observedAt:NOW};
        const bindingProofDigest=deriveWriteBindingProofDigest(bindingProof),writeAttemptId=id(747);
        f.db.authority.writeIntents.refenceRetryable({expectedVersion:2,
          intent:{...WRITE_INTENT_ATTEMPTING,runId:retry.envelope.runId,runAttempt:2,generation:2,version:3,currentAttemptId:writeAttemptId,bindingProof,bindingProofDigest},
          attempt:{...WRITE_ATTEMPT,writeAttemptId,runId:retry.envelope.runId,runAttempt:2,generation:2,bindingProof,bindingProofDigest}});
      }
      f.db.authority.runs.transition({runId:retry.envelope.runId,expectedVersion:1,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
      const storage=createRunLifecycleStorage(f.db),snapshot=storage.capture(source.envelope.runId);
      const report=captureArchiveReport({snapshot,transferId:id(741),capturedAt:NOW,sections:[],files:[]});
      transferArchiveReport(storage,report,snapshot.run.version);
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:{uuid:()=>id(745)},publishQueued:()=>{throw new Error("unexpected publication");}});
      assert.equal(service.read(source.envelope.runId).state,"present");
      const removeArchive=()=>service.deleteArchived({runId:source.envelope.runId,archiveFingerprint:report.digest,commandId:id(742)});
      const removeLive=()=>service.delete({runId:retry.envelope.runId,expectedVersion:2,commandId:id(743)});
      assert.equal((archiveFirst?removeArchive():removeLive()).state,"deleted");
      assert.ok(f.db.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId));
      assert.equal((archiveFirst?removeLive():removeArchive()).state,"deleted");
      assert.equal(f.db.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),undefined);
      const raw=new DatabaseSync(f.path,{readOnly:true});try{assert.equal(raw.prepare("SELECT count(*) AS count FROM run_operation_attempts").get()?.count,0);}finally{raw.close();}
      assert.equal(service.read(source.envelope.runId).state,"deleted");
    }finally{f.dispose();}
  });
});

import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
it("binds version-change review membership, refuses changed sources and requires published transfer progress",()=>{
  const f=foundationFixture();
  try{
    terminalizeFixtureFailure(f,f.run,failure());
    const storage=createRunLifecycleStorage(f.db),snapshot=storage.capture(f.run.envelope.runId);
    const members=[{runId:snapshot.run.envelope.runId,version:snapshot.run.version,sourceDigest:lifecycleSourceDigest(snapshot)}];
    const review={changeId:id(771),actorId:"local-operator",reviewedAt:NOW,observedAppVersion:"1.0.0",blockers:[],
      change:{kind:"major" as const,what:"Synthetic change",why:"Contract proof",commit:{state:"absent" as const,reason:"test"}},
      scope:{kind:"workflows" as const,workflowIds:[snapshot.run.envelope.workflow]},targetVersion:"2.0.0",targets:[{workflow:snapshot.run.envelope.workflow,version:2,fingerprint:HASH}],members,membershipDigest:sha256Hex(canonicalJsonStringify(members))};
    const change={...review,schemaVersion:2 as const,reviewFingerprint:versionChangeReviewFingerprint(review),state:"planned" as const,completedRunIds:[]};
    storage.writeVersionChange(change);
    assert.throws(()=>storage.writeVersionChange({...change,actorId:"different"}),/contract-invalid/u);
    const application={commandId:id(772),actorId:"local-operator",startedAt:NOW,appVersion:"1.0.0",targets:review.targets};
    const applying=storage.claimVersionChange({changeId:change.changeId,reviewFingerprint:change.reviewFingerprint,application});
    assert.throws(()=>storage.claimVersionChange({changeId:change.changeId,reviewFingerprint:change.reviewFingerprint,application:{...application,commandId:id(773)}}),/claim-conflict/u);
    const report=captureArchiveReport({snapshot,transferId:id(770),capturedAt:NOW,sections:[],files:[],versionChange:archiveVersionChange(applying)});
    storage.saveReport(report);storage.verifyReport(snapshot.run.envelope.runId,report.digest);storage.transfer({runId:snapshot.run.envelope.runId,digest:report.digest,expectedVersion:snapshot.run.version});
    assert.throws(()=>storage.writeVersionChange({...applying,state:"applied",application:{...application,completedAt:NOW},completedRunIds:[members[0].runId]}),/progress-unverified/u);
    assert.equal(storage.readPendingReport(snapshot.run.envelope.runId,report.content.transferId)?.state,"verified");
    storage.publishReport(snapshot.run.envelope.runId,report.digest);
    storage.writeVersionChange({...applying,state:"applied",application:{...application,completedAt:NOW},completedRunIds:[members[0].runId]});
    assert.equal(storage.readVersionChange(change.changeId)?.state,"applied");
  }finally{f.dispose();}
});

it("refuses a corrupt archived peer before deleting a live retry or writing a tombstone",()=>{
  const f=foundationFixture();
  try{
    f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    const storage=createRunLifecycleStorage(f.db),snapshot=storage.capture(f.run.envelope.runId);
    const retry=RunRecordSchema.parse({...snapshot.run,envelope:{...snapshot.run.envelope,runId:id(780),attempt:2,retryOf:snapshot.run.envelope.runId},lifecycle:{state:"queued"},version:1});
    f.db.authority.runs.enqueue(retry);
    f.db.authority.runs.transition({runId:retry.envelope.runId,expectedVersion:1,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    const report=captureArchiveReport({snapshot,transferId:id(781),capturedAt:NOW,sections:[],files:[]});
    transferArchiveReport(storage,report,snapshot.run.version);
    const raw=new DatabaseSync(f.path);
    try{
      const trigger=raw.prepare("SELECT sql FROM sqlite_master WHERE name='archive_transfers_immutable'").get()?.sql;
      if(typeof trigger!=="string")throw new Error("fixture trigger missing");
      raw.exec("DROP TRIGGER archive_transfers_immutable");
      raw.prepare("UPDATE archive_transfers SET record_json=json_set(record_json,'$.run.envelope.itemId',?) WHERE record_key=?").run(id(782),snapshot.run.envelope.runId);
      raw.exec(trigger);
    }finally{raw.close();}
    assert.throws(()=>f.db.authority.runs.delete({runId:retry.envelope.runId,origin:"queue",commandId:id(783),now:NOW}),/archive-identity-mismatch/u);
    assert.ok(f.db.authority.runs.get(retry.envelope.runId));
    assert.equal(f.db.authority.deletedRuns.get(retry.envelope.runId),undefined);
  }finally{f.dispose();}
});

import { versionChangeReviewFingerprint, archiveVersionChange } from "../../../src/domain/archive/change-record.js";
import { lifecycleSourceDigest } from "../../../src/backend/storage/run-lifecycle-storage.js";

it("reserves one apply across connections and supersedes reviews without letting old confirmations claim replacements",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try {
    const review={changeId:id(820),actorId:"local-operator",reviewedAt:NOW,observedAppVersion:"1.0.0",blockers:[],
      change:{kind:"minor" as const,what:"Synthetic",why:"Review replacement",commit:{state:"absent" as const,reason:"test"}},
      scope:{kind:"application" as const,applicationVersion:"1.0.0"},targetVersion:"1.1.0",targets:[],members:[],membershipDigest:sha256Hex("[]")};
    const planned={...review,schemaVersion:2 as const,reviewFingerprint:versionChangeReviewFingerprint(review),state:"planned" as const,completedRunIds:[]};
    f.db.writeVersionChange(planned);
    const replacementReview={...review,changeId:id(821),supersedes:review.changeId};
    const replacement={...replacementReview,schemaVersion:2 as const,reviewFingerprint:versionChangeReviewFingerprint(replacementReview),state:"planned" as const,completedRunIds:[]};
    f.db.replaceVersionChange(review.changeId,planned.reviewFingerprint,replacement);
    const application={commandId:id(822),actorId:"local-operator",startedAt:NOW,appVersion:"1.0.0",targets:[]};
    assert.throws(()=>f.db.claimVersionChange({changeId:review.changeId,reviewFingerprint:planned.reviewFingerprint,application}),/fence-conflict/u);
    assert.throws(()=>f.db.claimVersionChange({changeId:replacement.changeId,reviewFingerprint:planned.reviewFingerprint,application}),/review-required/u);
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"claim-peer"},f.clock);
    const request={changeId:replacement.changeId,reviewFingerprint:replacement.reviewFingerprint,application};
    const claimed=f.db.claimVersionChange(request);
    assert.deepEqual(peer.claimVersionChange(request),claimed);
    assert.throws(()=>peer?.claimVersionChange({...request,application:{...application,commandId:id(823)}}),/claim-conflict/u);
    assert.equal(f.db.readVersionChange(review.changeId)?.state,"superseded");
  }finally{peer?.close();f.dispose();}
});

it("exposes canonical list, pending replay and deletion through the production lifecycle service",()=>{
  const f=foundationFixture();
  try {
    terminalizeFixtureFailure(f,f.run,failure());
    const service=new RunRecordService({database:f.db,clock:f.clock,ids:{uuid:()=>id(831)},publishQueued:()=>{throw new Error("unexpected enqueue");}});
    const storage=service.lifecycleStorage(),snapshot=storage.capture(f.run.envelope.runId);
    const report=captureArchiveReport({snapshot,transferId:id(830),capturedAt:NOW,sections:[],files:[]});
    transferArchiveReport(storage,report,snapshot.run.version);
    assert.equal(storage.readPendingReport(report.content.runId,report.content.transferId)?.state,"published");
    assert.throws(()=>storage.readPendingReport(report.content.runId,id(839)),/replay-conflict/u);
    assert.deepEqual(storage.listReports({workflow:snapshot.run.envelope.workflow,limit:1}).items,[report]);
    assert.equal(storage.listReports({workflow:"other",limit:1}).items.length,0);
    assert.equal(storage.deleteArchive({commandId:id(832),runId:report.content.runId,archiveFingerprint:HASH}).state,"refused");
    const request={commandId:id(833),runId:report.content.runId,archiveFingerprint:report.digest};
    assert.equal(storage.deleteArchive(request).state,"deleted");
    assert.equal(storage.deleteArchive(request).state,"applied-already");
    assert.deepEqual(storage.listReports({workflow:snapshot.run.envelope.workflow,limit:1}).items,[]);
    assert.throws(()=>storage.readPendingReport(report.content.runId,report.content.transferId),/deleted/u);
  }finally{f.dispose();}
});
