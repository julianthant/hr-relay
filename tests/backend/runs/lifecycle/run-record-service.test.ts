import { fenceWriteFixture, writeFenceFixtureInput } from "../../../support/helpers/write-fence-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandKernel, type WriteResolutionContext } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, runContinuationPort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createItemAttemptHistoryQuery } from "../../../../src/backend/runs/queries/item-attempt-history.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, detachBoundFixtureWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { deletedRunFromRow } from "../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema, deriveRunResultDigest, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { authenticateAuditedParkedWriteResolution } from "../../../../src/rules/write-safety/parked-resolution.js";
import { TransactionOutcomeSchema, WriteIntentRecordSchema, deriveIdempotencyKeyDigest, deriveWriteAuthorityReason, deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { COMMITTED_OUTCOME, CONFIG_SNAPSHOT, HASH_A, LATER, LATEST, LEDGER_PAYLOAD, NOW, SPAN_OUTBOX_PAYLOAD, UUID_1, UUID_3, UUID_5, UUID_6, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";
import { NOW as NOW_m2, foundationFixture as baseFoundationFixture_m2, failure as failure_m2, id as id_m2, terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m2 } from "../../../support/helpers/synthetic-storage-admission.js";

import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";

{

const cleanups:(()=>void)[]=[];
const _afterEachFixture0 = ()=>{for(const cleanup of cleanups.splice(0))cleanup();};
function fixture(fault?:string) {
  let activeFault=fault;
  const profile=createBoundProfileFixture();
  const path=profile.path;const admission=profile.admission;
  const open=()=>AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,undefined,undefined,
    {afterDeleteStep:({step})=>{if(step===activeFault)throw new Error("deletion-fault");},
      afterDeletionFileRemoved:()=>{if(activeFault === "file")throw new Error("deletion-file-fault");}});
  let db=open();cleanups.push(()=>{db.close();profile.close();});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const terminalTemplate=RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,
    configFingerprint:CONFIG_SNAPSHOT.fingerprint},lifecycle:{state:"terminal",outcome:"discarded",endedAt:NOW}});
  const seed=(record:typeof terminalTemplate)=>{
    const queued=RunRecordSchema.parse({...record,lifecycle:{state:"queued"},version:1,updatedAt:record.createdAt});
    db.authority.runs.enqueue(queued);
    const service=new RunRecordService({database:db,clock:capturedInstantClock(NOW),ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("unexpected fixture publication");}});
    const settled=service.transition({commandId:randomUUID(),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:record.lifecycle});
    if(settled.state!=="applied")throw new Error("genuine fixture terminal transition refused");
    return settled.run;
  };
  const run=seed(terminalTemplate);
  const makeService=()=>new RunRecordService({database:db,clock:capturedInstantClock(NOW),ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("deletion cannot publish a queue event");}});
  const restart=()=>{db.close();db=open();return makeService();};
  const addDiagnostic=async()=>{
    const writer=createContentAddressedArtifactWriter({admission});await writer.ready;
    const ref=await writer.put(Buffer.from('{"offline":true}'),{mediaType:"application/json"});
    db.authority.diagnosticBundles.insert({bundleId:UUID_3,runId:run.envelope.runId,origin:{kind:"operator-request",requestedBy:"local-operator"},
      createdAt:NOW,contentDigest:HASH_A,configFingerprint:run.envelope.configFingerprint,descriptorFingerprint:run.envelope.contractFingerprint,
      redaction:{fields:[],warnings:[]},retention:{kind:"ordinary",purgeAfter:"2026-12-01T00:00:00.000Z"},
      attachments:[{kind:"console-summary",artifactId:ref.id,mediaType:ref.mediaType,byteLength:ref.bytes,digest:ref.sha256,sensitivity:"redacted"}]});
    return {ref,file:join(admission.artifactRoot,`${ref.sha256}.artifact`)};
  };
  const deletionRow=()=>{const raw=new DatabaseSync(path,{readOnly:true});try{return deletedRunFromRow(raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(run.envelope.runId));}finally{raw.close();}};
  return {path,get db(){return db;},run,service:makeService(),restart,seed,addDiagnostic,deletionRow,clearFault:()=>{activeFault=undefined;}};
}
describe("native lifecycle deletion command",()=>{
afterEach(_afterEachFixture0);

  it("reads bounded native same-item history across a tombstone and a later current attempt",()=>{
    const f=fixture();expect(f.service.delete({commandId:UUID_5,runId:f.run.envelope.runId,expectedVersion:f.run.version}).state).toBe("deleted");
    const next=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_3,attempt:2}});f.seed(next);
    const reader=f.restart();const query=createItemAttemptHistoryQuery({database:f.db,reader});
    const first=query.read(f.run.envelope.runId,{limit:1});
    expect(first.state).toBe("available");if(first.state !== "available")throw new Error("native history unavailable");
    expect(first.page.totalEntries).toBe(2);expect(first.page.entries.map(row=>row.disposition)).toEqual(["deleted"]);
    expect(first.page.nextCursor).not.toBeNull();
    const second=query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!});
    expect(second.state).toBe("available");if(second.state !== "available")throw new Error("native second history page unavailable");
    expect(second.page.entries.map(row=>row.disposition)).toEqual(["live"]);expect(second.page.entries[0]?.attempt).toBe(2);
    f.db.authority.runs.advanceRevision({runId:next.envelope.runId,expectedVersion:next.version,now:NOW});
    expect(query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!})).toMatchObject({state:"stale",reason:"authority-changed"});
  });

  it("admits the genuine complete command before its tombstone, settles once and replays after restart",()=>{
    const f=fixture();const request={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    const result=f.service.delete(request);expect(result.state).toBe("deleted");
    expect(f.service.read(f.run.envelope.runId).state).toBe("deleted");
    const generation=f.db.getMeta().authorityGeneration;
    expect(f.service.delete(request).state).toBe("applied-already");expect(f.db.getMeta().authorityGeneration).toBe(generation);
    expect(f.restart().delete(request).state).toBe("applied-already");
    const db=new DatabaseSync(f.path,{readOnly:true});try {
      expect(db.prepare("SELECT * FROM deleted_runs").all()).toHaveLength(1);
      expect(db.prepare("SELECT * FROM commands WHERE id=?").all(UUID_1)).toHaveLength(1);
      expect(db.prepare("SELECT * FROM command_audits WHERE command_id=?").all(UUID_1)).toHaveLength(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally{db.close();}
  });
  it.each(["tombstone","runs","cascade-complete"])("rolls back command, audit and deletion after %s",step=>{
    const f=fixture(step);const before=f.db.getMeta().authorityGeneration;
    expect(()=>f.service.delete({commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version})).toThrow("deletion-fault");
    expect(f.service.read(f.run.envelope.runId).state).toBe("present");
    expect(f.db.authority.lifecycleJournal.getCommand(UUID_1)).toBeUndefined();
    expect(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_1)).toBeUndefined();
    expect(f.db.getMeta().authorityGeneration).toBe(before);
  });
  it("captures exact bytes before deletion and refuses changed bytes without changing its immutable receipt",async()=>{
    const f=fixture();const artifact=await f.addDiagnostic();const original=readFileSync(artifact.file);
    const command={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect(f.service.delete(command).state).toBe("deleted");const before=f.deletionRow();
    expect(before.cleanupState).toBe("pending");expect(before.files).toHaveLength(1);
    expect(before.receipt.removed).toContainEqual({table:"diagnostic_files",rows:1});
    expect(before.receipt.removed).toContainEqual({table:"diagnostic_snapshots",rows:1});
    expect(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_5})).toThrow(/command-mismatch/u);
    expect(()=>f.db.withAuthorityTransaction(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:command.commandId}))).toThrow(/requires-committed-receipt/u);
    writeFileSync(artifact.file,Buffer.concat([original,Buffer.from("\n")]));
    expect(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toThrow(/captured-bytes-mismatch/u);
    expect(f.deletionRow()).toEqual(before);expect(existsSync(artifact.file)).toBe(true);
    writeFileSync(artifact.file,original);
    expect(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toBe("complete");
    expect(f.deletionRow()).toEqual({...before,cleanupState:"complete"});expect(existsSync(artifact.file)).toBe(false);
    const generation=f.db.getMeta().authorityGeneration;
    expect(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toBe("complete");expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("resumes the original committed manifest after an unlink fault and restart",async()=>{
    const f=fixture("file");const artifact=await f.addDiagnostic();
    const request={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect(f.service.delete(request).state).toBe("deleted");const before=f.deletionRow();
    expect(()=>f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toThrow("deletion-file-fault");
    expect(f.deletionRow()).toEqual(before);expect(existsSync(artifact.file)).toBe(false);
    f.clearFault();expect(f.restart().delete(request).state).toBe("applied-already");
    expect(f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toBe("complete");
    expect(f.deletionRow()).toEqual({...before,cleanupState:"complete"});
  });
  it("preflights and deletes a complete terminal child tree without renumbering permanent authority",()=>{
    const f=fixture();const child=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_5,attempt:2,
      parent:{runId:f.run.envelope.runId,tracePrefix:f.run.envelope.traceId,edgeId:"child-probe"}}});
    f.seed(child);
    const result=f.restart().delete({commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version});
    expect(result.state).toBe("deleted");if(result.state!=="deleted" || !("tombstones" in result))throw new Error("expected deletion");
    expect(result.tombstones.map(receipt=>receipt.runId)).toEqual([UUID_5,f.run.envelope.runId]);
    expect(f.db.authority.runs.nextItemAttempt({workflow:f.run.envelope.workflow,itemId:f.run.envelope.itemId})).toBe(3);
  });
});
}

{

const cleanups:(()=>void)[]=[];
const _afterEachFixture0 = ()=>{for(const cleanup of cleanups.splice(0))cleanup();};
function fixture(faultStep?:string) {
  let activeFault=faultStep;
  const profile=createBoundProfileFixture();
  const path=profile.path;
  mkdirSync(join(profile.stateRoot,"locks"),{recursive:true,mode:0o700});
  const open=()=>AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,{afterStorageStep:step=>{if(step === activeFault)throw new Error("resolution-storage-fault");}});
  let db=open();cleanups.push(()=>{db.close();profile.close();});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const run=RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,workflow:WRITE_INTENT_ATTEMPTING.workflowId,
    configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT.fingerprint},version:5,claimGeneration:1,
    lifecycle:{state:"parked-write",writeIntentId:WRITE_INTENT_ATTEMPTING.writeIntentId,intentGeneration:1,
      parkedAt:NOW,code:"unknown",message:"offline indeterminate probe"}});
  const admitted=testAdmittedWorker(db,capturedInstantClock(NOW),{path,workflow:run.envelope.workflow,poolIndex:1,browserSystems:[]});
  const worker=admitted.workerId;
  const workerLifetime=admitted.workerLifetime;
  db.authority.runs.enqueue({...run,version:1,claimGeneration:0,lifecycle:{state:"queued"}});
  const claim=db.authority.runs.claimNext({workflow:run.envelope.workflow,workerId:worker,workerLifetime,now:NOW});
  expect(claim.state).toBe("claimed");
  if(claim.state !== "claimed")throw new Error("fixture claim failed");
  const validating=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:claim.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"validating",workerId:worker,workerLifetime,claimedAt:NOW,heartbeatAt:NOW},now:NOW});
  expect(validating.state).toBe("applied");
  if(validating.state !== "applied")throw new Error("fixture validation failed");
  const running=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:validating.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"running",workerId:worker,workerLifetime,claimedAt:NOW,heartbeatAt:NOW,currentNodeId:"termination"},now:NOW});
  expect(running.state).toBe("applied");
  if(running.state !== "applied")throw new Error("fixture run failed");
  fenceWriteFixture(db, {intent:WRITE_INTENT_ATTEMPTING,attempt:WRITE_ATTEMPT});
  const parkedRun=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:running.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:run.lifecycle,now:NOW});
  expect(parkedRun.state).toBe("applied");
  if(parkedRun.state !== "applied")throw new Error("fixture park admission failed");
  expect(parkedRun.run).toEqual(run);
  const reason=deriveWriteAuthorityReason("recovery-probe-unknown","probe","offline indeterminate probe");
  db.authority.writeIntents.parkAttempt({writeIntentId:WRITE_INTENT_ATTEMPTING.writeIntentId,generation:1,expectedVersion:1,
    code:"unknown",message:"offline indeterminate probe",authorityReason:reason,now:NOW});
  const original=db.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)!;
  const parked=db.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)!;
  if(parked.status !== "parked")throw new Error("fixture park failed");
  const resolution={commandId:UUID_5,auditId:UUID_6,writeIntentId:parked.writeIntentId,writeAttemptId:parked.currentAttemptId,
    generation:1,bindingProofDigest:parked.bindingProofDigest,idempotencyKeyDigest:parked.idempotencyKeyDigest,
    runId:run.envelope.runId,runAttempt:1,expectedRunVersion:5,decision:"absent" as const,resolvedAt:LATER};
  const command={commandId:UUID_5,family:"run",type:"resolve-write-absent",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",
    target:{runId:run.envelope.runId,expectedVersion:5,writeIntentId:parked.writeIntentId,intentGeneration:1,
      writeAttemptId:parked.currentAttemptId,bindingProofDigest:parked.bindingProofDigest},
    payload:{occurrenceKeyDigest:parked.idempotencyKeyDigest,evidenceNote:"offline authenticated absence"}};
  const settlement={state:"operator-confirmed-absent" as const,writeIntentId:parked.writeIntentId,generation:1,
    operator:"local-operator",confirmedAt:LATER,evidenceNote:command.payload.evidenceNote};
  const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=parked;
  const settled=WriteIntentRecordSchema.parse({...base,status:"retryable",settlement,resolvedAt:LATER,updatedAt:LATER,version:3,resolution});
  const audit={auditId:UUID_6,request:command,result:{state:"applied",commandId:UUID_5,affectedTargets:[{family:"run",runId:run.envelope.runId}]},
    completedAt:LATER,versionChanges:[{target:{family:"run",runId:run.envelope.runId},before:5,after:6}],affectedDependencyIds:[],writeResolution:settled};
  const apply=(fault?:"audit"|"intent"|"run")=>db.withAuthorityTransaction(repositories=>{
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    if(fault === "audit")throw new Error("resolution-fault");
    const result=db.settleResolvedParkedAbsence({writeIntentId:parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement,resolution});
    if(fault === "intent")throw new Error("resolution-fault");
    const service=new RunRecordService({database:db,clock:capturedInstantClock(LATER),ids:sequentialIdFactory(),publishQueued:()=>{}});
    const resumed=runContinuationPort(service).transition({commandId:UUID_7,runId:run.envelope.runId,expectedVersion:5,
      lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
    if(resumed.state !== "applied")throw new Error("fixture continuation failed");
    if(fault === "run")throw new Error("resolution-fault");
    expect(result).toEqual(settled);return resumed.run;
  });
  const rawMutation=(work:(raw:DatabaseSync)=>void)=>{const raw=new DatabaseSync(path);try{work(raw);}finally{raw.close();}};
  const inspect=()=>{const raw=new DatabaseSync(path,{readOnly:true});try{return inspectNormalAuthority(raw);}finally{raw.close();}};
  return {path,get db(){return db;},run,parked,original,command,audit,settlement,resolution,apply,rawMutation,inspect,setFault:(step:string)=>{activeFault=step;},restart:()=>{db.close();db=open();}};
}
function positive(f:ReturnType<typeof fixture>) {
  const resolution={...f.resolution,decision:"present" as const};
  const proof=LEDGER_PAYLOAD.proof;
  const command={...f.command,type:"resolve-write-present",payload:{occurrenceKeyDigest:f.parked.idempotencyKeyDigest,proof,evidenceNote:"offline exact receipt"}};
  const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=f.parked;
  const settled=WriteIntentRecordSchema.parse({...base,status:"committed",completionProof:proof,confirmedAt:LATER,version:3,updatedAt:LATER,resolution});
  const audit={...f.audit,request:command,writeResolution:settled};
  const outcome={...COMMITTED_OUTCOME,proofSource:"operator-attestation"};
  const transaction={...LEDGER_PAYLOAD,traceId:f.run.envelope.traceId,proofSource:"operator-attestation"};
  const committedSpan={...SPAN_OUTBOX_PAYLOAD,traceId:f.run.envelope.traceId,outcome};
  const checkpoint=RunCheckpointRecordSchema.parse({workflowId:f.run.envelope.workflow,itemId:f.run.envelope.itemId,nodeId:"termination",
    runId:f.run.envelope.runId,attempt:1,claimGeneration:1,descriptorVersion:1,contractFingerprint:f.run.envelope.contractFingerprint,
    implFingerprint:f.run.envelope.contractFingerprint,output:{schemaHash:deriveSchemaHash(TransactionOutcomeSchema,"output"),value:outcome},
    provenance:[],writtenAt:LATER});
  const commit={writeIntentId:f.parked.writeIntentId,generation:1,completionProof:proof,confirmedAt:LATER,outcome,transaction,committedSpan};
  const apply=()=>f.db.withAuthorityTransaction(repositories=>{
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    const report=f.db.commitResolvedParkedWrite({commit,checkpoint,expectedIntentVersion:2,resolution});
    const service=new RunRecordService({database:f.db,clock:capturedInstantClock(LATER),ids:sequentialIdFactory(),publishQueued:()=>{}});
    const resumed=runContinuationPort(service).transition({commandId:UUID_7,runId:f.run.envelope.runId,expectedVersion:5,
      lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
    if(resumed.state !== "applied")throw new Error("fixture continuation failed");
    return report;
  });
  return {apply,command,audit,checkpoint,transaction,committedSpan,commit};
}
function kernel(f:ReturnType<typeof fixture>,fault?:"audit"|"mismatch",present=false) {
  let preparations=0;
  const unused=():never=>{throw new Error("unused offline port");};
  const prepare=(repositories:typeof f.db.authority,context:WriteResolutionContext)=>{
    preparations+=1;
    const positiveResult=present ? positive(f) : undefined;
    const resolution={...f.resolution,auditId:context.auditId,decision:present ? "present" as const : "absent" as const};
    const intent=WriteIntentRecordSchema.parse({...positiveResult?.audit.writeResolution ?? f.audit.writeResolution,resolution});
    const run=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,startAt:"termination"},lifecycle:{state:"queued"},version:6,updatedAt:LATER});
    expect(repositories.commandAudits.get(context.auditId)).toBeUndefined();
    return {outcome:{run,intent},applyAfterAudit:()=>{
      expect(repositories.commandAudits.get(context.auditId)).toBeDefined();
      if(fault === "audit")throw new Error("kernel-after-audit-fault");
      const actualIntent=positiveResult === undefined
        ? f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement:f.settlement,resolution})
        : f.db.commitResolvedParkedWrite({commit:positiveResult.commit,checkpoint:positiveResult.checkpoint,expectedIntentVersion:2,resolution}).intent;
      const service=new RunRecordService({database:f.db,clock:capturedInstantClock(LATER),ids:sequentialIdFactory("b"),publishQueued:()=>{}});
      const actual=runContinuationPort(service).transition({commandId:UUID_7,runId:f.run.envelope.runId,expectedVersion:5,
        lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
      if(actual.state !== "applied")throw new Error("fixture continuation failed");
      return {run:fault === "mismatch" ? RunRecordSchema.parse({...actual.run,displayName:"mismatched actual result"}) : actual.run,intent:actualIntent};
    }};
  };
  const lifecycle=new RunRecordService({database:f.db,clock:capturedInstantClock(LATER),ids:sequentialIdFactory("b"),publishQueued:()=>{}});
  const instance=createCommandKernel({authority:f.db,lifecycle,clock:capturedInstantClock(LATER),ids:sequentialIdFactory(),appVersion:"1.0.0",
    descriptors:{resolve:()=>undefined},configIdentity:{configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT.fingerprint},
    intakeParser:UNWIRED_INTAKE_PARSER,intakeProjections:NO_INTAKE_PROJECTIONS,
    workerRuntime:{pool:{planPoolWorkerCount:unused,spawnPoolWorker:unused,refreshPoolBrowser:unused,reopenPoolBrowser:unused,stopPoolWorker:unused,pausePoolWorker:unused,resumePoolWorker:unused}},
    writeResolution:{resolvePresent:present ? prepare : unused,resolveAbsent:present ? unused : prepare}});
  return {instance,preparations:()=>preparations};
}
describe("native parked command audit ordering",()=>{
afterEach(_afterEachFixture0);

  it.each(["audit","mismatch"] as const)("rolls back the genuine audit and acknowledged effects after %s",fault=>{
    const f=fixture();const k=kernel(f,fault);const generation=f.db.getMeta().authorityGeneration;
    expect(()=>k.instance.execute(f.command)).toThrow(fault === "audit" ? "kernel-after-audit-fault" : "acknowledged-effects-mismatch");
    expect(f.db.authority.commands.get(UUID_5)).toBeUndefined();expect(f.db.authority.commandAudits.findByCommand(UUID_5)).toBeUndefined();
    expect(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("replays the immutable complete command outcome after restart without repeating settlement",()=>{
    const f=fixture();let k=kernel(f);
    expect(k.instance.execute(f.command).state).toBe("applied");expect(k.preparations()).toBe(1);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST});f.restart();k=kernel(f);
    const generation=f.db.getMeta().authorityGeneration;
    expect(k.instance.execute(f.command).state).toBe("already-applied");expect(k.preparations()).toBe(0);
    expect(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("refuses a forged original attempt before preparing or inserting any audit",()=>{
    const f=fixture();const k=kernel(f);const request=CommandRequestSchema.parse({...f.command,target:{...f.command.target,writeAttemptId:UUID_8}});
    expect(k.instance.execute(request).state).toBe("rejected");expect(k.preparations()).toBe(0);
    expect(f.db.authority.commands.get(UUID_5)).toBeUndefined();expect(f.db.authority.commandAudits.findByCommand(UUID_5)).toBeUndefined();
  });
});
describe("native immutable parked positive settlement",()=>{
afterEach(_afterEachFixture0);

  it.each(["intent-state","transaction-checkpoint","timeline-event"])("rolls back genuine audit and all proof effects after %s",step=>{
    const f=fixture(step);const p=positive(f);const generation=f.db.getMeta().authorityGeneration;
    expect(()=>p.apply()).toThrow("resolution-storage-fault");
    expect(f.db.authority.commands.get(UUID_5)).toBeUndefined();expect(f.db.authority.commandAudits.get(UUID_6)).toBeUndefined();
    expect(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect(f.db.authority.runCheckpoints.get(p.checkpoint.workflowId,p.checkpoint.itemId,p.checkpoint.nodeId,1,1)).toBeUndefined();
    expect(f.db.authority.timelineEvents.page({runId:f.run.envelope.runId,limit:100})).toHaveLength(0);
    expect(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("publishes exact proof and history while retaining the parked attempt after restart and later run advancement",()=>{
    const f=fixture();const p=positive(f);expect(p.apply().attempt).toEqual(f.original);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST});f.restart();
    const events=f.db.authority.timelineEvents.page({runId:f.run.envelope.runId,limit:100}).filter(event=>event.payload.kind === "operation-confirmed");
    expect(events).toHaveLength(1);
    expect(reconstructConfirmedOperation(f.db.authority,events[0])).toEqual({ledger:p.transaction,span:p.committedSpan});
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    const generation=f.db.getMeta().authorityGeneration;
    f.db.withAuthorityTransaction(repositories=>{expect(repositories.commands.insert(p.command).state).toBe("existing");repositories.commandAudits.insert(p.audit);});
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
});
describe("native immutable parked absence settlement",()=>{
afterEach(_afterEachFixture0);

  it.each(["audit","intent","run"] as const)("rolls back the complete command and run after %s",fault=>{
    const f=fixture();const generation=f.db.getMeta().authorityGeneration;
    expect(()=>f.apply(fault)).toThrow("resolution-fault");
    expect(f.db.authority.commands.get(UUID_5)).toBeUndefined();expect(f.db.authority.commandAudits.get(UUID_6)).toBeUndefined();
    expect(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("requires the genuine final audit and admission CAS before settling",()=>{
    const f=fixture();expect(()=>f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,
      settlement:f.settlement,resolution:f.resolution})).toThrow(/authority-missing/u);
    expect(()=>f.db.withAuthorityTransaction(repositories=>{repositories.commands.insert(f.command);repositories.commandAudits.insert(f.audit);
      f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement:f.settlement,
        resolution:{...f.resolution,expectedRunVersion:3}});})).toThrow(/run-cas-mismatch/u);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
  });
  it("retains and authenticates the original resolution after later run advancement and a real fresh N+1 fence",()=>{
    const f=fixture();const resumed=f.apply();
    f.db.authority.runs.advanceRevision({runId:resumed.envelope.runId,expectedVersion:5,now:LATEST});
    const proof={...WRITE_INTENT_ATTEMPTING.bindingProof,proofId:UUID_7,observedAt:LATEST};const digest=deriveWriteBindingProofDigest(proof);
    const intent={...WRITE_INTENT_ATTEMPTING,currentAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATEST,version:4,updatedAt:LATEST};
    const attempt={...WRITE_ATTEMPT,writeAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATEST,recordedAt:LATEST};
    f.db.authority.writeIntents.refenceRetryable({...writeFenceFixtureInput(f.db,{intent,attempt}),expectedVersion:3});
    f.restart();
    expect(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(9);
    expect(f.db.authority.writeIntents.get(f.parked.writeIntentId)?.generation).toBe(2);
    expect(canonicalJsonStringify(f.db.authority.writeAttempts.get(f.original.writeAttemptId))).toBe(canonicalJsonStringify(f.original));
    const audit=f.db.authority.commandAudits.get(UUID_6);
    expect(authenticateAuditedParkedWriteResolution(f.original,f.db.authority.commands.get(UUID_5),audit).intent).toEqual(f.audit.writeResolution);
    const generation=f.db.getMeta().authorityGeneration;
    f.db.withAuthorityTransaction(repositories=>{expect(repositories.commands.insert(f.command).state).toBe("existing");repositories.commandAudits.insert(f.audit);});
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
});

describe("native permanent confirmation publication",()=>{
afterEach(_afterEachFixture0);

  it.each(["audit","mismatch"] as const)("rolls back positive command publication and complete audited result after %s",fault=>{
    const f=fixture();const command=positive(f).command;const k=kernel(f,fault,true);const generation=f.db.getMeta().authorityGeneration;
    expect(()=>k.instance.execute(command)).toThrow(fault === "audit" ? "kernel-after-audit-fault" : "acknowledged-effects-mismatch");
    expect(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);expect(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toBeUndefined();
    expect(f.db.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();expect(f.db.authority.timelineEvents.page({limit:100})).toEqual([]);
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);expect(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("replays the exact positive audited command after restart and run advancement without repeating publication or continuation",()=>{
    const f=fixture();const command=positive(f).command;let k=kernel(f,undefined,true);
    const result=k.instance.execute(command);expect(result.state).toBe("applied");expect(k.preparations()).toBe(1);
    const publication=f.db.authority.writeIntents.getPublication(f.parked.writeIntentId);
    const audit=f.db.authority.commandAudits.findByCommand(command.commandId);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST});f.restart();k=kernel(f,undefined,true);
    const generation=f.db.getMeta().authorityGeneration;
    expect(k.instance.execute(command)).toEqual({...result,state:"already-applied"});expect(k.preparations()).toBe(0);
    expect(f.db.authority.commandAudits.findByCommand(command.commandId)).toEqual(audit);
    expect(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toEqual(publication);
    expect(f.db.authority.timelineEvents.page({limit:100}).filter(row=>row.payload.kind === "operation-confirmed")).toHaveLength(1);
    expect(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });

  it("keeps genuine observed-present probe authority without inventing an attempt or confirmation publication",()=>{
    const f=fixture();const source=f.parked;const idempotencyKey="offline-observed-record";
    const observed=WriteIntentRecordSchema.parse({writeIntentId:UUID_8,workflowId:source.workflowId,itemId:source.itemId,taskId:source.taskId,
      system:source.system,idempotencyKey,idempotencyKeyDigest:deriveIdempotencyKeyDigest(source.system,idempotencyKey),generation:1,
      status:"observed-present",observedProof:LEDGER_PAYLOAD.proof,observedAt:LATER,version:1,createdAt:LATER,updatedAt:LATER});
    expect(f.db.authority.writeIntents.recordObservedPresent(observed).state).toBe("recorded-observed-present");f.restart();
    expect(f.db.authority.writeIntents.get(UUID_8)).toEqual(observed);expect(f.db.authority.writeIntents.getPublication(UUID_8)).toBeUndefined();
    expect(f.db.authority.writeAttempts.listByIntent(UUID_8)).toEqual([]);expect(f.db.authority.timelineEvents.page({limit:100})).toEqual([]);
    expect(f.inspect().invariants.state).toBe("valid");
  });

  it.each(["missing","extra","timeline-time","checkpoint-output","checkpoint-run","checkpoint-workflow","checkpoint-item","checkpoint-attempt"])("refuses an altered whole publication on read and maintenance: %s",fault=>{
    const f=fixture();const p=positive(f);p.apply();
    f.rawMutation(raw=>{
      if(fault === "missing") {raw.prepare("UPDATE write_intents SET publication_json=NULL").run();return;}
      const row=raw.prepare("SELECT publication_json FROM write_intents").get()!;
      const publication=JSON.parse(String(row.publication_json)) as Record<string,unknown>;
      if(fault === "extra") publication.extra=true;
      else if(fault === "timeline-time") {
        const timeline=publication.timeline as Record<string,unknown>;timeline.recordedAt=LATEST;
      } else {
        const checkpoint=publication.checkpoint as Record<string,unknown>;
        if(fault === "checkpoint-run") checkpoint.runId=UUID_8;
        else if(fault === "checkpoint-workflow") checkpoint.workflowId="different-workflow";
        else if(fault === "checkpoint-item") checkpoint.itemId=UUID_8;
        else if(fault === "checkpoint-attempt") checkpoint.attempt=2;
        else checkpoint.provenance=[{unexpected:true}];
      }
      raw.prepare("UPDATE write_intents SET publication_json=?").run(canonicalJsonStringify(publication));
    });
    expect(()=>f.db.authority.writeIntents.get(f.parked.writeIntentId)).toThrow();
    expect(()=>f.inspect()).toThrow();
    expect(()=>f.restart()).toThrow();
  });
  it.each(["checkpoint","timeline","attempt","audit"])("refuses altered acknowledged authority: %s",fault=>{
    const f=fixture();positive(f).apply();
    f.rawMutation(raw=>{
      const table=fault === "checkpoint" ? "run_checkpoints" : fault === "timeline" ? "timeline_events" : fault === "attempt" ? "write_attempts" : "command_audits";
      for(const row of raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table)) raw.exec(`DROP TRIGGER ${String(row.name)}`);
      raw.prepare(`UPDATE ${table} SET payload_json=json_set(payload_json,?,?)`).run(
        fault === "checkpoint" ? "$.implFingerprint" : fault === "timeline" ? "$.payload.facts.traceId" : fault === "attempt" ? "$.bindingProofDigest" : "$.writeResolution.resolution.writeAttemptId",
        fault === "checkpoint" || fault === "attempt" ? "b".repeat(64) : fault === "timeline" ? "term-000000-abcd" : UUID_8);
    });
    expect(()=>f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toThrow();
  });
  it("retains exact immutable publication and proof after authenticated terminal deletion, with no hidden run",()=>{
    const f=fixture();const p=positive(f);p.apply();
    const publication=f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)!;
    const service=new RunRecordService({database:f.db,clock:capturedInstantClock(LATEST),ids:sequentialIdFactory("c"),publishQueued:()=>{throw new Error("deletion cannot queue");}});
    const terminal=service.transition({commandId:UUID_8,runId:f.run.envelope.runId,expectedVersion:6,
      lifecycle:{state:"terminal",outcome:"discarded",endedAt:LATEST}});
    expect(terminal.state).toBe("applied");
    const request={commandId:"90000000-0000-4000-8000-000000000001",runId:f.run.envelope.runId,expectedVersion:7};
    expect(service.delete(request).state).toBe("deleted");f.restart();
    expect(f.db.authority.runs.get(f.run.envelope.runId)).toBeUndefined();
    expect(f.db.authority.timelineEvents.get(publication.timeline.eventId)).toBeUndefined();
    expect(f.db.authority.runCheckpoints.get(p.checkpoint.workflowId,p.checkpoint.itemId,p.checkpoint.nodeId,1,1)).toBeUndefined();
    expect(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toEqual(publication);
    expect(reconstructConfirmedOperation(f.db.authority,publication.timeline)).toEqual({ledger:p.transaction,span:p.committedSpan});
    expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect(f.inspect().invariants.state).toBe("valid");
    const generation=f.db.getMeta().authorityGeneration;
    expect(new RunRecordService({database:f.db,clock:capturedInstantClock(LATEST),ids:sequentialIdFactory("c"),publishQueued:()=>{}}).delete(request).state).toBe("applied-already");
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
    f.rawMutation(raw=>{raw.exec("DROP TRIGGER deleted_runs_identity");raw.prepare("UPDATE deleted_runs SET trace_id=?,receipt_json=json_set(receipt_json,'$.traceId',?)").run("term-000000-abcd","term-000000-abcd");});
    expect(()=>f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toThrow(/deletion-settlement-mismatch/u);
  });
  it.each(["run","workflow","item","attempt","execution-generation","descriptor","contract"])("refuses ordinary confirmation checkpoint substitution before any mutation: %s",fault=>{
    const f=fixture();f.apply();
    const proof={...WRITE_INTENT_ATTEMPTING.bindingProof,proofId:UUID_7,observedAt:LATER};const digest=deriveWriteBindingProofDigest(proof);
    const intent={...WRITE_INTENT_ATTEMPTING,currentAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATER,version:4,updatedAt:LATER};
    const attempt={...WRITE_ATTEMPT,writeAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATER,recordedAt:LATER};
    f.db.authority.writeIntents.refenceRetryable({...writeFenceFixtureInput(f.db,{intent,attempt}),expectedVersion:3});
    const outcome={...COMMITTED_OUTCOME,confirmedAt:LATEST};
    const transaction={...LEDGER_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER,confirmedAt:LATEST};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST,outcome};
    const patch=fault === "run" ? {runId:UUID_8}:fault === "workflow" ? {workflowId:"other-workflow"}:fault === "item" ? {itemId:UUID_8}
      :fault === "attempt" ? {attempt:2}:fault === "execution-generation" ? {claimGeneration:3}:fault === "descriptor" ? {descriptorVersion:2}:{contractFingerprint:"b".repeat(64)};
    const checkpoint=RunCheckpointRecordSchema.parse({...positive(f).checkpoint,claimGeneration:2,...patch,output:{schemaHash:deriveSchemaHash(TransactionOutcomeSchema,"output"),value:outcome},writtenAt:LATEST});
    const commit={writeIntentId:intent.writeIntentId,generation:2,completionProof:LEDGER_PAYLOAD.proof,confirmedAt:LATEST,outcome,transaction,committedSpan};
    const generation=f.db.getMeta().authorityGeneration;
    expect(()=>f.db.commitWriteAttempt(commit,checkpoint)).toThrow();
    expect(f.db.authority.writeIntents.get(intent.writeIntentId)).toEqual(intent);
    expect(f.db.authority.writeAttempts.get(UUID_8)).toEqual(attempt);
    expect(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toBeUndefined();
    expect(f.db.authority.runCheckpoints.get(checkpoint.workflowId,checkpoint.itemId,checkpoint.nodeId,checkpoint.attempt,checkpoint.claimGeneration)).toBeUndefined();
    expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it.each([undefined,"intent-state","attempt-state","transaction-checkpoint","timeline-event"])("binds ordinary N+1 confirmation and rolls back before acknowledgment after %s",fault=>{
    const f=fixture();f.apply();
    const proof={...WRITE_INTENT_ATTEMPTING.bindingProof,proofId:UUID_7,observedAt:LATER};const digest=deriveWriteBindingProofDigest(proof);
    const intent={...WRITE_INTENT_ATTEMPTING,currentAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATER,version:4,updatedAt:LATER};
    const attempt={...WRITE_ATTEMPT,writeAttemptId:UUID_8,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATER,recordedAt:LATER};
    f.db.authority.writeIntents.refenceRetryable({...writeFenceFixtureInput(f.db,{intent,attempt}),expectedVersion:3});
    const outcome={...COMMITTED_OUTCOME,confirmedAt:LATEST};
    const transaction={...LEDGER_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER,confirmedAt:LATEST};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST,outcome};
    const checkpoint=RunCheckpointRecordSchema.parse({...positive(f).checkpoint,claimGeneration:2,output:{schemaHash:deriveSchemaHash(TransactionOutcomeSchema,"output"),value:outcome},writtenAt:LATEST});
    const commit={writeIntentId:intent.writeIntentId,generation:2,completionProof:LEDGER_PAYLOAD.proof,confirmedAt:LATEST,outcome,transaction,committedSpan};
    if(fault !== undefined)f.setFault(fault);
    const generation=f.db.getMeta().authorityGeneration;
    if(fault !== undefined) {
      expect(()=>f.db.commitWriteAttempt(commit,checkpoint)).toThrow("resolution-storage-fault");
      expect(f.db.authority.writeIntents.get(intent.writeIntentId)).toEqual(intent);expect(f.db.authority.writeAttempts.get(UUID_8)).toEqual(attempt);
      expect(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toBeUndefined();expect(f.db.getMeta().authorityGeneration).toBe(generation);
    } else {
      expect(f.db.commitWriteAttempt(commit,checkpoint).state).toBe("committed");f.restart();
      const publication=f.db.authority.writeIntents.getPublication(intent.writeIntentId)!;
      expect(publication.ledger).toEqual(transaction);expect(publication.span).toEqual(committedSpan);
      expect(f.db.authority.timelineEvents.get(publication.timeline.eventId)?.payload).toEqual(publication.timeline.payload);
      const worker=testAdmittedWorker(f.db,capturedInstantClock(LATEST),{path:f.path,workflow:f.run.envelope.workflow,poolIndex:2,browserSystems:[]}).workerId;
      const current=f.db.authority.runs.get(f.run.envelope.runId)!;
      expect(f.db.authority.runs.requeue({runId:current.envelope.runId,expectedVersion:current.version,
        cause:"recovery",now:LATEST}).state).toBe("applied");
      const claim=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:worker,workerLifetime:testWorkerLifetime(f.db,f.run.envelope.workflow,2).workerLifetime,now:LATEST});
      expect(claim.state).toBe("claimed");
      if(claim.state !== "claimed")throw new Error("later current claim failed");
      expect(claim.run.claimGeneration).toBe(3);f.restart();
      expect(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toEqual(publication);
      expect(reconstructConfirmedOperation(f.db.authority,publication.timeline)).toEqual({ledger:transaction,span:committedSpan});
      expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
      expect(authenticateAuditedParkedWriteResolution(f.original,f.db.authority.commands.get(UUID_5),f.db.authority.commandAudits.get(UUID_6)).intent).toEqual(f.audit.writeResolution);
      expect(f.inspect().invariants.state).toBe("valid");
    }
  });
});
}

{

function foundationFixture(){return baseFoundationFixture_m2({input:RunRecordSchema.shape.input.parse({...QUEUED_RUN.input,parsed:{
  schemaHash:deriveSchemaHash(PersonLookupCanonicalInput,"output"),value:{emplId:"10873698",keepNonHdh:false,includeCrmDates:false},
  protectedBindings:[{kind:"test-data-local",inputPath:"emplId",name:"personLookupCanaryEid",sourceId:id_m2(89)}],
}})});}

function cancellation(f: ReturnType<typeof foundationFixture>) {
  const service = new RunRecordService({ database: f.db, clock: f.clock, ids: sequentialIdFactory(), publishQueued: () => {} });
  assert.equal(service.transition({commandId:id_m2(180),runId:f.run.envelope.runId,expectedVersion:f.run.version,
    lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW_m2}}).state,"applied");
  const run=f.db.authority.runs.get(f.run.envelope.runId);assert.ok(run);assert.ok(run.cancelRequested);
  if(run.lifecycle.state!=="running")throw new Error("cancellation did not retain the held claim");
  const request={kind:"cancelled",commandId:id_m2(181),runId:run.envelope.runId,expectedVersion:run.version,
    claim:{workerId:run.lifecycle.workerId,claimGeneration:run.claimGeneration},endedAt:NOW_m2};
  return {service,request};
}
function rawState(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});try{return canonicalJsonStringify(["runs","run_failures","run_results","run_receipts","commands","command_audits","timeline_events"].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));}finally{db.close();}
}
function trust(db:AuthorityDatabase_m2,f:ReturnType<typeof foundationFixture>){return createReceiptService({database:db,
  runReader:sqliteRunReader(db,f.clock),descriptors:[personLookupDescriptor]});}

describe("same-attempt native recovery",()=>{
  it("releases the genuine primitive owner atomically without changing its immutable attempt",()=>{
    const f=foundationFixture();try{
      assert.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery",now:NOW_m2};
      const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(f.db.authority.runs.requeue(request).state,"applied");throw new Error("primitive-release-fault");}),/primitive-release-fault/u);
      assert.equal(rawState(f.path),before);
      const release=f.db.authority.runs.requeue(request);assert.equal(release.state,"applied");
      if(release.state!=="applied")throw new Error("primitive release refused");
      assert.deepEqual(release.run.envelope,f.run.envelope);assert.deepEqual(release.run.input,f.run.input);
      assert.equal(release.run.version,f.run.version+1);assert.equal(release.run.claimGeneration,f.run.claimGeneration);
      assert.equal(release.run.lifecycle.state,"queued");
      const next=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,workerLifetime:testWorkerLifetime(f.db,f.run.envelope.workflow,f.db.authority.workerSlots.get(claim.workerId)!.poolIndex).workerLifetime,now:NOW_m2});assert.equal(next.state,"claimed");
      if(next.state!=="claimed")throw new Error("primitive release not claimable");
      assert.deepEqual(next.run.envelope,f.run.envelope);assert.equal(next.run.claimGeneration,claim.claimGeneration+1);
      const claimedBytes=rawState(f.path);
      assert.deepEqual(f.db.authority.runs.requeue({...request,expectedVersion:next.run.version}),{state:"conflict",currentVersion:next.run.version,currentState:next.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
      assert.equal(rawState(f.path),claimedBytes);
    }finally{f.dispose();}
  });

  it("rolls release back, preserves immutable identity, reopens exact replay and fences the prior claim",()=>{
    const f=foundationFixture();try{
      assert.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={commandId:id_m2(190),runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery"};
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(service.requeue(request).state,"applied");throw new Error("release-fault");}),/release-fault/u);
      assert.equal(rawState(f.path),before);
      assert.equal(service.requeue(request).state,"applied");
      const released=f.db.authority.runs.get(request.runId);assert.ok(released);
      assert.deepEqual(released.envelope,f.run.envelope);assert.deepEqual(released.input,f.run.input);
      assert.equal(released.claimGeneration,f.run.claimGeneration);assert.equal(released.lifecycle.state,"queued");
      const settled=rawState(f.path);assert.equal(service.requeue(request).state,"applied-already");assert.equal(rawState(f.path),settled);
      detachBoundFixtureWorkers(f.db);f.db.close();const reopened=AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"same-attempt-reopen"},f.clock);
      try{
        const replay=new RunRecordService({database:reopened,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("replayed queue publication");}});
        assert.equal(replay.requeue(request).state,"applied-already");assert.equal(rawState(f.path),settled);
        const claimed=reopened.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,workerLifetime:testWorkerLifetime(reopened,f.run.envelope.workflow,reopened.authority.workerSlots.get(claim.workerId)!.poolIndex).workerLifetime,now:NOW_m2});assert.equal(claimed.state,"claimed");
        if(claimed.state!=="claimed")throw new Error("not reclaimed");
        assert.deepEqual(claimed.run.envelope,f.run.envelope);assert.equal(claimed.run.claimGeneration,claim.claimGeneration+1);
        const fenced=reopened.authority.runs.requeue({runId:request.runId,expectedVersion:claimed.run.version,claim,cause:"recovery",now:NOW_m2});assert.deepEqual(fenced,{state:"conflict",currentVersion:claimed.run.version,currentState:claimed.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
        assert.deepEqual(reopened.authority.runs.get(request.runId),claimed.run);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
});

describe("truthful immutable final evidence",()=>{
  it("rolls failure, evidence and run back together after result creation",()=>{
    const f=foundationFixture();try{const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{terminalizeFixtureFailure(f,f.run,failure_m2());assert.ok(f.db.authority.runResults.get(f.run.envelope.runId));throw new Error("after-terminal-result");}),/after-terminal-result/u);
      assert.equal(rawState(f.path),before);assert.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it("owns genuine cancellation evidence with its command/audit, rollback and exact reopen replay",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");throw new Error("cancel-result-fault");}),/cancel-result-fault/u);assert.equal(rawState(f.path),before);
      assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);
      const evidence=terminalEvidenceResult(result);assert.equal(evidence?.kind,"lifecycle-evidence");
      if(evidence?.kind!=="lifecycle-evidence")throw new Error("wrong cancellation owner");assert.equal(evidence.commandId,request.commandId);assert.equal(evidence.auditId,request.commandId);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const settled=rawState(f.path);assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied-already");assert.equal(rawState(f.path),settled);
      detachBoundFixtureWorkers(f.db);f.db.close();const reopened=AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-reopen"},f.clock);
      try{const replay=new RunRecordService({database:reopened,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("unexpected publication");}});
        assert.equal(replay.terminalize(request,personLookupDescriptor).state,"applied-already");assert.deepEqual(trust(reopened,f).ensureReceipt(result.runId),receipt);assert.equal(rawState(f.path),settled);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
  it.each(["cancelled","discarded","superseded"] as const)("owns final unclaimed %s evidence without worker success authorization",outcome=>{
    const f=foundationFixture();try{
      const queued={...QUEUED_RUN,input:f.run.input,envelope:{...QUEUED_RUN.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        descriptorVersion:f.run.envelope.descriptorVersion,contractFingerprint:f.run.envelope.contractFingerprint,runId:id_m2(220),itemId:id_m2(220)}};
      f.db.authority.runs.enqueue(queued);
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={commandId:id_m2(221),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:{state:"terminal",outcome,endedAt:NOW_m2}};
      assert.equal(service.transition(request).state,"applied");
      const result=f.db.authority.runResults.get(queued.envelope.runId);assert.ok(result);
      assert.equal(terminalEvidenceResult(result)?.kind,"lifecycle-evidence");
      assert.equal(f.db.authority.runs.get(result.runId)?.completion,undefined);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const before=rawState(f.path);assert.equal(service.transition(request).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("settles admitted cancellation through recovery with the genuine requeue audit",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);
      const recovery={commandId:id_m2(182),runId:request.runId,expectedVersion:request.expectedVersion,claim:request.claim,cause:"recovery"};
      assert.equal(service.requeue(recovery).state,"applied");
      const result=f.db.authority.runResults.get(request.runId);assert.ok(result);assert.equal(terminalEvidenceResult(result)?.kind,"lifecycle-evidence");
      assert.deepEqual(trust(f.db,f).ensureReceipt(request.runId).output,[]);
      const before=rawState(f.path);assert.equal(service.requeue(recovery).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("journals each actual cascade member and root with immutable cancellation evidence",()=>{
    const f=foundationFixture();try{
      const parent=RunRecordSchema.parse({...QUEUED_RUN,input:f.run.input,envelope:{...QUEUED_RUN.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        descriptorVersion:f.run.envelope.descriptorVersion,contractFingerprint:f.run.envelope.contractFingerprint,runId:id_m2(230),itemId:id_m2(230),shape:"operation"}});
      const child=RunRecordSchema.parse({...parent,envelope:{...parent.envelope,runId:id_m2(231),itemId:id_m2(231),shape:"operation-member",
        parent:{runId:parent.envelope.runId,tracePrefix:parent.envelope.traceId,edgeId:"synthetic-child"}}});
      f.db.authority.runs.enqueue(parent);f.db.authority.runs.enqueue(child);
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={commandId:id_m2(232),runId:parent.envelope.runId,expectedVersion:parent.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW_m2}};
      assert.equal(service.transition(request).state,"applied");
      const owners=[parent,child].map(run=>{const record=f.db.authority.runResults.get(run.envelope.runId);assert.ok(record);
        const evidence=terminalEvidenceResult(record);assert.equal(evidence?.kind,"lifecycle-evidence");
        if(evidence?.kind!=="lifecycle-evidence")throw new Error("missing member owner");
        assert.ok(f.db.authority.lifecycleJournal.getCommand(evidence.commandId));assert.ok(f.db.authority.lifecycleJournal.findAuditByCommand(evidence.commandId));
        return evidence.commandId;});
      assert.notEqual(owners[0],owners[1]);
      const before=rawState(f.path);assert.equal(service.transition(request).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("refuses a partial audited failed settlement without repairing or repeating it",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing admitted claim");
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={kind:"failure",commandId:id_m2(240),terminal:{failure:failure_m2(),authorization:{kind:"failed",runId:f.run.envelope.runId,
        workflowId:f.run.envelope.workflow,attempt:f.run.envelope.attempt,descriptorVersion:f.run.envelope.descriptorVersion,
        contractFingerprint:f.run.envelope.contractFingerprint,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},authorizedAt:NOW_m2,failureId:failure_m2().failureId}}};
      assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");
      const settled=rawState(f.path);assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied-already");assert.equal(rawState(f.path),settled);
      assert.equal(service.terminalize({...request,terminal:{...request.terminal,failure:{...failure_m2(),summary:"divergent synthetic failure"}}},personLookupDescriptor).state,"refused");assert.equal(rawState(f.path),settled);
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("DELETE FROM run_results WHERE run_id=?").run(f.run.envelope.runId);for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      const partial=rawState(f.path);assert.throws(()=>service.terminalize(request,personLookupDescriptor),/composite authority/u);assert.equal(rawState(f.path),partial);
      detachBoundFixtureWorkers(f.db);f.db.close();assert.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"partial-terminal"},f.clock),/run-completion-consequences|final-runs-bind-result-owner/u);
    }finally{f.dispose();}
  });
  it("keeps interrupted recovery without immutable final evidence or receipt",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing held claim");
      assert.equal(f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},
        lifecycle:{state:"terminal",outcome:"interrupted",endedAt:NOW_m2},now:NOW_m2}).state,"applied");
      assert.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
      assert.throws(()=>trust(f.db,f).ensureReceipt(f.run.envelope.runId),/ended interrupted/u);
      assert.equal(f.db.authority.evidenceReceipts.findByRun(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it("refuses corrupt result payload without exposing the stored private bytes",()=>{
    const f=foundationFixture();try{terminalizeFixtureFailure(f,f.run,failure_m2());
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=? WHERE run_id=?").run(canonicalJsonStringify({privateNote:"SYNTHETIC_PRIVATE_RESULT_INVALID_PAYLOAD"}),f.run.envelope.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert.throws(()=>f.db.authority.runResults.get(f.run.envelope.runId),error=>error instanceof Error && error.message==="run-result-payload-invalid");
      detachBoundFixtureWorkers(f.db);f.db.close();assert.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"private-result-refusal"},f.clock),error=>
        error instanceof Error && error.message.includes("run-result-payload-invalid") && !error.message.includes("SYNTHETIC_PRIVATE_RESULT"));
    }finally{f.dispose();}
  });
  it.each(["failure-digest","failure-identity","cancel-command"] as const)("refuses altered %s proof on read and reopen",kind=>{
    const f=foundationFixture();try{
      if(kind==="cancel-command"){const {service,request}=cancellation(f);service.terminalize(request,personLookupDescriptor);}else terminalizeFixtureFailure(f,f.run,failure_m2());
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);const evidence=terminalEvidenceResult(result);assert.ok(evidence);
      const altered=kind==="cancel-command"?{...evidence,commandId:id_m2(999)}:kind==="failure-digest"?{...evidence,failureDigest:"f".repeat(64)}:{...evidence,authorization:{...("authorization" in evidence?evidence.authorization:{}),failureId:id_m2(999)}};
      const changed=RunResultRecordSchema.parse({...result,result:{...result.result,value:altered},resultDigest:deriveRunResultDigest({...result.result,value:altered})});
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=?,result_digest=? WHERE run_id=?").run(canonicalJsonStringify(changed),changed.resultDigest,changed.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert.throws(()=>f.db.authority.runResults.get(result.runId),/terminal-(?:failure-result|evidence-command-audit)/u);
      detachBoundFixtureWorkers(f.db);f.db.close();assert.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-refusal"},f.clock),/terminal-(?:failure-result|evidence-command-audit)/u);
    }finally{f.dispose();}
  });
});
}
