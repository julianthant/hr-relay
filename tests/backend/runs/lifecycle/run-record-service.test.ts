import assert_m2 from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import { existsSync as existsSync_m0,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m0,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0,DatabaseSync as DatabaseSync_m1,DatabaseSync as DatabaseSync_m2 } from "node:sqlite";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,describe as describe_m2,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1,it as it_m2 } from "vitest";
import { createCommandKernel as createCommandKernel_m1,type WriteResolutionContext as WriteResolutionContext_m1 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService as RunRecordService_m0,RunRecordService as RunRecordService_m1,RunRecordService as RunRecordService_m2,runContinuationPort as runContinuationPort_m1 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createItemAttemptHistoryQuery as createItemAttemptHistoryQuery_m0 } from "../../../../src/backend/runs/queries/item-attempt-history.js";
import { createReceiptService as createReceiptService_m2 } from "../../../../src/backend/runs/trust/receipt-service.js";
import { RuntimeAdmission as RuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m0 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1,inspectNormalAuthority as inspectNormalAuthority_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { deletedRunFromRow as deletedRunFromRow_m0 } from "../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { admitDirectWorker as admitDirectWorker_m1 } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { reconstructConfirmedOperation as reconstructConfirmedOperation_m1 } from "../../../../src/models/events/confirmed-operation.js";
import { RunRecordSchema as RunRecordSchema_m0,RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema as RunResultRecordSchema_m2,deriveRunResultDigest as deriveRunResultDigest_m2,terminalEvidenceResult as terminalEvidenceResult_m2 } from "../../../../src/models/run/result.js";
import { deriveSchemaHash as deriveSchemaHash_m1 } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema as RunCheckpointRecordSchema_m1 } from "../../../../src/models/workflow/checkpoint.js";
import { CommandRequestSchema as CommandRequestSchema_m1 } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock as capturedInstantClock_m0,capturedInstantClock as capturedInstantClock_m1 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1,canonicalJsonStringify as canonicalJsonStringify_m2 } from "../../../../src/rules/validation/canonical-json.js";
import { authenticateAuditedParkedWriteResolution as authenticateAuditedParkedWriteResolution_m1 } from "../../../../src/rules/write-safety/parked-resolution.js";
import { TransactionOutcomeSchema as TransactionOutcomeSchema_m1,WriteIntentRecordSchema as WriteIntentRecordSchema_m1,deriveIdempotencyKeyDigest as deriveIdempotencyKeyDigest_m1,deriveWriteAuthorityReason as deriveWriteAuthorityReason_m1,deriveWriteBindingProofDigest as deriveWriteBindingProofDigest_m1 } from "../../../../src/rules/write-safety/write-safety.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m1,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m1 } from "../../../support/fixtures/intake-kernel-seams.js";
import { COMMITTED_OUTCOME as COMMITTED_OUTCOME_m1,CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m0,CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1,HASH_A as HASH_A_m0,LATER as LATER_m1,LATEST as LATEST_m1,LEDGER_PAYLOAD as LEDGER_PAYLOAD_m1,NOW as NOW_m0,NOW as NOW_m1,SPAN_OUTBOX_PAYLOAD as SPAN_OUTBOX_PAYLOAD_m1,UUID_1 as UUID_1_m0,UUID_3 as UUID_3_m0,UUID_5 as UUID_5_m0,UUID_5 as UUID_5_m1,UUID_6 as UUID_6_m1,UUID_7 as UUID_7_m1,UUID_8 as UUID_8_m1,WRITE_ATTEMPT as WRITE_ATTEMPT_m1,WRITE_INTENT_ATTEMPTING as WRITE_INTENT_ATTEMPTING_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0,QUEUED_RUN as QUEUED_RUN_m1,sequentialIdFactory as sequentialIdFactory_m0,sequentialIdFactory as sequentialIdFactory_m1,sequentialIdFactory as sequentialIdFactory_m2 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { sqliteRunReader as sqliteRunReader_m2 } from "../../../support/helpers/canonical-run-reader.js";
import { NOW as NOW_m2,foundationFixture as baseFoundationFixture_m2,failure as failure_m2,id as id_m2,terminalizeFixtureFailure as terminalizeFixtureFailure_m2 } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m2 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m2 } from "../../../support/helpers/synthetic-storage-admission.js";

import { RunRecordSchema as RunRecordSchema_m2 } from "../../../../src/models/run/record.js";
import { deriveSchemaHash as deriveSchemaHash_m2 } from "../../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput as PersonLookupCanonicalInput_m2 } from "../../../../src/workflows/person-lookup/workflow.js";
import { QUEUED_RUN as QUEUED_RUN_m2 } from "../../../support/fixtures/phase1f-run-fixtures.js";


{

const cleanups:(()=>void)[]=[];
const _afterEachFixture0 = ()=>{for(const cleanup of cleanups.splice(0))cleanup();};
function fixture(fault?:string) {
  let activeFault=fault;
  const root=realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(),"relay-native-deletion-")));
  const path=join_m0(root,"authority.sqlite");const admission=RuntimeAdmission_m0.syntheticFixture(path);
  const open=()=>AuthorityDatabase_m0.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,undefined,undefined,
    {afterDeleteStep:({step})=>{if(step===activeFault)throw new Error("deletion-fault");},
      afterDeletionFileRemoved:()=>{if(activeFault === "file")throw new Error("deletion-file-fault");}});
  let db=open();cleanups.push(()=>{db.close();rmSync_m0(root,{recursive:true,force:true});});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
  const terminalTemplate=RunRecordSchema_m0.parse({...QUEUED_RUN_m0,envelope:{...QUEUED_RUN_m0.envelope,configSnapshotId:CONFIG_SNAPSHOT_m0.configSnapshotId,
    configFingerprint:CONFIG_SNAPSHOT_m0.fingerprint},lifecycle:{state:"terminal",outcome:"discarded",endedAt:NOW_m0}});
  const seed=(record:typeof terminalTemplate)=>{
    const queued=RunRecordSchema_m0.parse({...record,lifecycle:{state:"queued"},version:1,updatedAt:record.createdAt});
    db.authority.runs.enqueue(queued);
    const service=new RunRecordService_m0({database:db,clock:capturedInstantClock_m0(NOW_m0),ids:sequentialIdFactory_m0(),publishQueued:()=>{throw new Error("unexpected fixture publication");}});
    const settled=service.transition({commandId:randomUUID_m0(),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:record.lifecycle});
    if(settled.state!=="applied")throw new Error("genuine fixture terminal transition refused");
    return settled.run;
  };
  const run=seed(terminalTemplate);
  const makeService=()=>new RunRecordService_m0({database:db,clock:capturedInstantClock_m0(NOW_m0),ids:sequentialIdFactory_m0(),publishQueued:()=>{throw new Error("deletion cannot publish a queue event");}});
  const restart=()=>{db.close();db=open();return makeService();};
  const addDiagnostic=async()=>{
    const writer=createContentAddressedArtifactWriter_m0({admission});await writer.ready;
    const ref=await writer.put(Buffer.from('{"offline":true}'),{mediaType:"application/json"});
    db.authority.diagnosticBundles.insert({bundleId:UUID_3_m0,runId:run.envelope.runId,origin:{kind:"operator-request",requestedBy:"local-operator"},
      createdAt:NOW_m0,contentDigest:HASH_A_m0,configFingerprint:run.envelope.configFingerprint,descriptorFingerprint:run.envelope.contractFingerprint,
      redaction:{fields:[],warnings:[]},retention:{kind:"ordinary",purgeAfter:"2026-12-01T00:00:00.000Z"},
      attachments:[{kind:"console-summary",artifactId:ref.id,mediaType:ref.mediaType,byteLength:ref.bytes,digest:ref.sha256,sensitivity:"redacted"}]});
    return {ref,file:join_m0(admission.artifactRoot,`${ref.sha256}.artifact`)};
  };
  const deletionRow=()=>{const raw=new DatabaseSync_m0(path,{readOnly:true});try{return deletedRunFromRow_m0(raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(run.envelope.runId));}finally{raw.close();}};
  return {path,get db(){return db;},run,service:makeService(),restart,seed,addDiagnostic,deletionRow,clearFault:()=>{activeFault=undefined;}};
}
describe_m0("native lifecycle deletion command",()=>{
afterEach_m0(_afterEachFixture0);

  it_m0("reads bounded native same-item history across a tombstone and a later current attempt",()=>{
    const f=fixture();expect_m0(f.service.delete({commandId:UUID_5_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version}).state).toBe("deleted");
    const next=RunRecordSchema_m0.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_3_m0,attempt:2}});f.seed(next);
    const reader=f.restart();const query=createItemAttemptHistoryQuery_m0({database:f.db,reader});
    const first=query.read(f.run.envelope.runId,{limit:1});
    expect_m0(first.state).toBe("available");if(first.state !== "available")throw new Error("native history unavailable");
    expect_m0(first.page.totalEntries).toBe(2);expect_m0(first.page.entries.map(row=>row.disposition)).toEqual(["deleted"]);
    expect_m0(first.page.nextCursor).not.toBeNull();
    const second=query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!});
    expect_m0(second.state).toBe("available");if(second.state !== "available")throw new Error("native second history page unavailable");
    expect_m0(second.page.entries.map(row=>row.disposition)).toEqual(["live"]);expect_m0(second.page.entries[0]?.attempt).toBe(2);
    f.db.authority.runs.advanceRevision({runId:next.envelope.runId,expectedVersion:next.version,now:NOW_m0});
    expect_m0(query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!})).toMatchObject({state:"stale",reason:"authority-changed"});
  });

  it_m0("admits the genuine complete command before its tombstone, settles once and replays after restart",()=>{
    const f=fixture();const request={commandId:UUID_1_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    const result=f.service.delete(request);expect_m0(result.state).toBe("deleted");
    expect_m0(f.service.read(f.run.envelope.runId).state).toBe("deleted");
    const generation=f.db.getMeta().authorityGeneration;
    expect_m0(f.service.delete(request).state).toBe("applied-already");expect_m0(f.db.getMeta().authorityGeneration).toBe(generation);
    expect_m0(f.restart().delete(request).state).toBe("applied-already");
    const db=new DatabaseSync_m0(f.path,{readOnly:true});try {
      expect_m0(db.prepare("SELECT * FROM deleted_runs").all()).toHaveLength(1);
      expect_m0(db.prepare("SELECT * FROM commands WHERE id=?").all(UUID_1_m0)).toHaveLength(1);
      expect_m0(db.prepare("SELECT * FROM command_audits WHERE command_id=?").all(UUID_1_m0)).toHaveLength(1);
      expect_m0(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally{db.close();}
  });
  it_m0.each(["tombstone","runs","cascade-complete"])("rolls back command, audit and deletion after %s",step=>{
    const f=fixture(step);const before=f.db.getMeta().authorityGeneration;
    expect_m0(()=>f.service.delete({commandId:UUID_1_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version})).toThrow("deletion-fault");
    expect_m0(f.service.read(f.run.envelope.runId).state).toBe("present");
    expect_m0(f.db.authority.lifecycleJournal.getCommand(UUID_1_m0)).toBeUndefined();
    expect_m0(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_1_m0)).toBeUndefined();
    expect_m0(f.db.getMeta().authorityGeneration).toBe(before);
  });
  it_m0("captures exact bytes before deletion and refuses changed bytes without changing its immutable receipt",async()=>{
    const f=fixture();const artifact=await f.addDiagnostic();const original=readFileSync_m0(artifact.file);
    const command={commandId:UUID_1_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect_m0(f.service.delete(command).state).toBe("deleted");const before=f.deletionRow();
    expect_m0(before.cleanupState).toBe("pending");expect_m0(before.files).toHaveLength(1);
    expect_m0(before.receipt.removed).toContainEqual({table:"diagnostic_files",rows:1});
    expect_m0(before.receipt.removed).toContainEqual({table:"diagnostic_snapshots",rows:1});
    expect_m0(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_5_m0})).toThrow(/command-mismatch/u);
    expect_m0(()=>f.db.withAuthorityTransaction(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:command.commandId}))).toThrow(/requires-committed-receipt/u);
    writeFileSync_m0(artifact.file,Buffer.concat([original,Buffer.from("\n")]));
    expect_m0(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1_m0})).toThrow(/captured-bytes-mismatch/u);
    expect_m0(f.deletionRow()).toEqual(before);expect_m0(existsSync_m0(artifact.file)).toBe(true);
    writeFileSync_m0(artifact.file,original);
    expect_m0(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1_m0})).toBe("complete");
    expect_m0(f.deletionRow()).toEqual({...before,cleanupState:"complete"});expect_m0(existsSync_m0(artifact.file)).toBe(false);
    const generation=f.db.getMeta().authorityGeneration;
    expect_m0(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1_m0})).toBe("complete");expect_m0(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m0("resumes the original committed manifest after an unlink fault and restart",async()=>{
    const f=fixture("file");const artifact=await f.addDiagnostic();
    const request={commandId:UUID_1_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect_m0(f.service.delete(request).state).toBe("deleted");const before=f.deletionRow();
    expect_m0(()=>f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toThrow("deletion-file-fault");
    expect_m0(f.deletionRow()).toEqual(before);expect_m0(existsSync_m0(artifact.file)).toBe(false);
    f.clearFault();expect_m0(f.restart().delete(request).state).toBe("applied-already");
    expect_m0(f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toBe("complete");
    expect_m0(f.deletionRow()).toEqual({...before,cleanupState:"complete"});
  });
  it_m0("preflights and deletes a complete terminal child tree without renumbering permanent authority",()=>{
    const f=fixture();const child=RunRecordSchema_m0.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_5_m0,attempt:2,
      parent:{runId:f.run.envelope.runId,tracePrefix:f.run.envelope.traceId,edgeId:"child-probe"}}});
    f.seed(child);
    const result=f.restart().delete({commandId:UUID_1_m0,runId:f.run.envelope.runId,expectedVersion:f.run.version});
    expect_m0(result.state).toBe("deleted");if(result.state!=="deleted" || !("tombstones" in result))throw new Error("expected deletion");
    expect_m0(result.tombstones.map(receipt=>receipt.runId)).toEqual([UUID_5_m0,f.run.envelope.runId]);
    expect_m0(f.db.authority.runs.nextItemAttempt({workflow:f.run.envelope.workflow,itemId:f.run.envelope.itemId})).toBe(3);
  });
});
}

{

const cleanups:(()=>void)[]=[];
const _afterEachFixture0 = ()=>{for(const cleanup of cleanups.splice(0))cleanup();};
function fixture(faultStep?:string) {
  let activeFault=faultStep;
  const root=realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(),"relay-native-parked-")));const path=join_m1(root,"authority.sqlite");
  const admission=RuntimeAdmission_m1.syntheticFixture(path);
  const open=()=>AuthorityDatabase_m1.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,{afterStorageStep:step=>{if(step === activeFault)throw new Error("resolution-storage-fault");}});
  let db=open();cleanups.push(()=>{db.close();rmSync_m1(root,{recursive:true,force:true});});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
  const run=RunRecordSchema_m1.parse({...QUEUED_RUN_m1,envelope:{...QUEUED_RUN_m1.envelope,workflow:WRITE_INTENT_ATTEMPTING_m1.workflowId,
    configSnapshotId:CONFIG_SNAPSHOT_m1.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT_m1.fingerprint},version:5,claimGeneration:1,
    lifecycle:{state:"parked-write",writeIntentId:WRITE_INTENT_ATTEMPTING_m1.writeIntentId,intentGeneration:1,
      parkedAt:NOW_m1,code:"unknown",message:"offline indeterminate probe"}});
  const worker=db.withAuthorityTransaction(repositories=>{
    const slot=admitDirectWorker_m1(repositories,{commandId:"80000000-0000-4000-8000-000000000001",workflow:run.envelope.workflow,
      poolIndex:1,expectedPoolVersion:0,processId:process.pid,processAcquisitionId:"80000000-0000-4000-8000-000000000002",
      authorityPath:path,processLockRoot:join_m1(root,"locks"),now:NOW_m1},"80000000-0000-4000-8000-000000000003");
    expect_m1(repositories.workerLeases.start({workerId:slot.workerId,workflow:run.envelope.workflow,browserSystems:[],
      processId:process.pid,requestedBy:"local-operator",now:NOW_m1}).state).toBe("started");
    return slot.workerId;
  });
  db.authority.runs.enqueue({...run,version:1,claimGeneration:0,lifecycle:{state:"queued"}});
  const claim=db.authority.runs.claimNext({workflow:run.envelope.workflow,workerId:worker,now:NOW_m1});
  expect_m1(claim.state).toBe("claimed");
  if(claim.state !== "claimed")throw new Error("fixture claim failed");
  const validating=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:claim.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"validating",workerId:worker,claimedAt:NOW_m1,heartbeatAt:NOW_m1},now:NOW_m1});
  expect_m1(validating.state).toBe("applied");
  if(validating.state !== "applied")throw new Error("fixture validation failed");
  const running=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:validating.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"running",workerId:worker,claimedAt:NOW_m1,heartbeatAt:NOW_m1,currentNodeId:"termination"},now:NOW_m1});
  expect_m1(running.state).toBe("applied");
  if(running.state !== "applied")throw new Error("fixture run failed");
  const parkedRun=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:running.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:run.lifecycle,now:NOW_m1});
  expect_m1(parkedRun.state).toBe("applied");
  if(parkedRun.state !== "applied")throw new Error("fixture park admission failed");
  expect_m1(parkedRun.run).toEqual(run);
  db.authority.writeIntents.fenceAttempt({intent:WRITE_INTENT_ATTEMPTING_m1,attempt:WRITE_ATTEMPT_m1});
  const reason=deriveWriteAuthorityReason_m1("recovery-probe-unknown","probe","offline indeterminate probe");
  db.authority.writeIntents.parkAttempt({writeIntentId:WRITE_INTENT_ATTEMPTING_m1.writeIntentId,generation:1,expectedVersion:1,
    code:"unknown",message:"offline indeterminate probe",authorityReason:reason,now:NOW_m1});
  const original=db.authority.writeAttempts.get(WRITE_ATTEMPT_m1.writeAttemptId)!;
  const parked=db.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING_m1.writeIntentId)!;
  if(parked.status !== "parked")throw new Error("fixture park failed");
  const resolution={commandId:UUID_5_m1,auditId:UUID_6_m1,writeIntentId:parked.writeIntentId,writeAttemptId:parked.currentAttemptId,
    generation:1,bindingProofDigest:parked.bindingProofDigest,idempotencyKeyDigest:parked.idempotencyKeyDigest,
    runId:run.envelope.runId,runAttempt:1,expectedRunVersion:5,decision:"absent" as const,resolvedAt:LATER_m1};
  const command={commandId:UUID_5_m1,family:"run",type:"resolve-write-absent",requestedAt:NOW_m1,requestedBy:"local-operator",source:"dashboard",
    target:{runId:run.envelope.runId,expectedVersion:5,writeIntentId:parked.writeIntentId,intentGeneration:1,
      writeAttemptId:parked.currentAttemptId,bindingProofDigest:parked.bindingProofDigest},
    payload:{occurrenceKeyDigest:parked.idempotencyKeyDigest,evidenceNote:"offline authenticated absence"}};
  const settlement={state:"operator-confirmed-absent" as const,writeIntentId:parked.writeIntentId,generation:1,
    operator:"local-operator",confirmedAt:LATER_m1,evidenceNote:command.payload.evidenceNote};
  const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=parked;
  const settled=WriteIntentRecordSchema_m1.parse({...base,status:"retryable",settlement,resolvedAt:LATER_m1,updatedAt:LATER_m1,version:3,resolution});
  const audit={auditId:UUID_6_m1,request:command,result:{state:"applied",commandId:UUID_5_m1,affectedTargets:[{family:"run",runId:run.envelope.runId}]},
    completedAt:LATER_m1,versionChanges:[{target:{family:"run",runId:run.envelope.runId},before:5,after:6}],affectedDependencyIds:[],writeResolution:settled};
  const apply=(fault?:"audit"|"intent"|"run")=>db.withAuthorityTransaction(repositories=>{
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    if(fault === "audit")throw new Error("resolution-fault");
    const result=db.settleResolvedParkedAbsence({writeIntentId:parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement,resolution});
    if(fault === "intent")throw new Error("resolution-fault");
    const service=new RunRecordService_m1({database:db,clock:capturedInstantClock_m1(LATER_m1),ids:sequentialIdFactory_m1(),publishQueued:()=>{}});
    const resumed=runContinuationPort_m1(service).transition({commandId:UUID_7_m1,runId:run.envelope.runId,expectedVersion:5,
      lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
    if(resumed.state !== "applied")throw new Error("fixture continuation failed");
    if(fault === "run")throw new Error("resolution-fault");
    expect_m1(result).toEqual(settled);return resumed.run;
  });
  const rawMutation=(work:(raw:DatabaseSync_m1)=>void)=>{const raw=new DatabaseSync_m1(path);try{work(raw);}finally{raw.close();}};
  const inspect=()=>{const raw=new DatabaseSync_m1(path,{readOnly:true});try{return inspectNormalAuthority_m1(raw);}finally{raw.close();}};
  return {path,get db(){return db;},run,parked,original,command,audit,settlement,resolution,apply,rawMutation,inspect,setFault:(step:string)=>{activeFault=step;},restart:()=>{db.close();db=open();}};
}
function positive(f:ReturnType<typeof fixture>) {
  const resolution={...f.resolution,decision:"present" as const};
  const proof=LEDGER_PAYLOAD_m1.proof;
  const command={...f.command,type:"resolve-write-present",payload:{occurrenceKeyDigest:f.parked.idempotencyKeyDigest,proof,evidenceNote:"offline exact receipt"}};
  const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=f.parked;
  const settled=WriteIntentRecordSchema_m1.parse({...base,status:"committed",completionProof:proof,confirmedAt:LATER_m1,version:3,updatedAt:LATER_m1,resolution});
  const audit={...f.audit,request:command,writeResolution:settled};
  const outcome={...COMMITTED_OUTCOME_m1,proofSource:"operator-attestation"};
  const transaction={...LEDGER_PAYLOAD_m1,traceId:f.run.envelope.traceId,proofSource:"operator-attestation"};
  const committedSpan={...SPAN_OUTBOX_PAYLOAD_m1,traceId:f.run.envelope.traceId,outcome};
  const checkpoint=RunCheckpointRecordSchema_m1.parse({workflowId:f.run.envelope.workflow,itemId:f.run.envelope.itemId,nodeId:"termination",
    runId:f.run.envelope.runId,attempt:1,claimGeneration:1,descriptorVersion:1,contractFingerprint:f.run.envelope.contractFingerprint,
    implFingerprint:f.run.envelope.contractFingerprint,output:{schemaHash:deriveSchemaHash_m1(TransactionOutcomeSchema_m1,"output"),value:outcome},
    provenance:[],writtenAt:LATER_m1});
  const commit={writeIntentId:f.parked.writeIntentId,generation:1,completionProof:proof,confirmedAt:LATER_m1,outcome,transaction,committedSpan};
  const apply=()=>f.db.withAuthorityTransaction(repositories=>{
    repositories.commands.insert(command);repositories.commandAudits.insert(audit);
    const report=f.db.commitResolvedParkedWrite({commit,checkpoint,expectedIntentVersion:2,resolution});
    const service=new RunRecordService_m1({database:f.db,clock:capturedInstantClock_m1(LATER_m1),ids:sequentialIdFactory_m1(),publishQueued:()=>{}});
    const resumed=runContinuationPort_m1(service).transition({commandId:UUID_7_m1,runId:f.run.envelope.runId,expectedVersion:5,
      lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
    if(resumed.state !== "applied")throw new Error("fixture continuation failed");
    return report;
  });
  return {apply,command,audit,checkpoint,transaction,committedSpan,commit};
}
function kernel(f:ReturnType<typeof fixture>,fault?:"audit"|"mismatch",present=false) {
  let preparations=0;
  const unused=():never=>{throw new Error("unused offline port");};
  const prepare=(repositories:typeof f.db.authority,context:WriteResolutionContext_m1)=>{
    preparations+=1;
    const positiveResult=present ? positive(f) : undefined;
    const resolution={...f.resolution,auditId:context.auditId,decision:present ? "present" as const : "absent" as const};
    const intent=WriteIntentRecordSchema_m1.parse({...positiveResult?.audit.writeResolution ?? f.audit.writeResolution,resolution});
    const run=RunRecordSchema_m1.parse({...f.run,envelope:{...f.run.envelope,startAt:"termination"},lifecycle:{state:"queued"},version:6,updatedAt:LATER_m1});
    expect_m1(repositories.commandAudits.get(context.auditId)).toBeUndefined();
    return {outcome:{run,intent},applyAfterAudit:()=>{
      expect_m1(repositories.commandAudits.get(context.auditId)).toBeDefined();
      if(fault === "audit")throw new Error("kernel-after-audit-fault");
      const actualIntent=positiveResult === undefined
        ? f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement:f.settlement,resolution})
        : f.db.commitResolvedParkedWrite({commit:positiveResult.commit,checkpoint:positiveResult.checkpoint,expectedIntentVersion:2,resolution}).intent;
      const service=new RunRecordService_m1({database:f.db,clock:capturedInstantClock_m1(LATER_m1),ids:sequentialIdFactory_m1("b"),publishQueued:()=>{}});
      const actual=runContinuationPort_m1(service).transition({commandId:UUID_7_m1,runId:f.run.envelope.runId,expectedVersion:5,
        lifecycle:{state:"queued"},startAt:"termination",writeResolution:{kind:"operator",binding:resolution}});
      if(actual.state !== "applied")throw new Error("fixture continuation failed");
      return {run:fault === "mismatch" ? RunRecordSchema_m1.parse({...actual.run,displayName:"mismatched actual result"}) : actual.run,intent:actualIntent};
    }};
  };
  const lifecycle=new RunRecordService_m1({database:f.db,clock:capturedInstantClock_m1(LATER_m1),ids:sequentialIdFactory_m1("b"),publishQueued:()=>{}});
  const instance=createCommandKernel_m1({authority:f.db,lifecycle,clock:capturedInstantClock_m1(LATER_m1),ids:sequentialIdFactory_m1(),appVersion:"1.0.0",
    descriptors:{resolve:()=>undefined},configIdentity:{configSnapshotId:CONFIG_SNAPSHOT_m1.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT_m1.fingerprint},
    intakeParser:UNWIRED_INTAKE_PARSER_m1,intakeProjections:NO_INTAKE_PROJECTIONS_m1,
    workerRuntime:{pool:{planPoolWorkerCount:unused,spawnPoolWorker:unused,refreshPoolBrowser:unused,reopenPoolBrowser:unused,stopPoolWorker:unused,pausePoolWorker:unused,resumePoolWorker:unused}},
    writeResolution:{resolvePresent:present ? prepare : unused,resolveAbsent:present ? unused : prepare}});
  return {instance,preparations:()=>preparations};
}
describe_m1("native parked command audit ordering",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1.each(["audit","mismatch"] as const)("rolls back the genuine audit and acknowledged effects after %s",fault=>{
    const f=fixture();const k=kernel(f,fault);const generation=f.db.getMeta().authorityGeneration;
    expect_m1(()=>k.instance.execute(f.command)).toThrow(fault === "audit" ? "kernel-after-audit-fault" : "acknowledged-effects-mismatch");
    expect_m1(f.db.authority.commands.get(UUID_5_m1)).toBeUndefined();expect_m1(f.db.authority.commandAudits.findByCommand(UUID_5_m1)).toBeUndefined();
    expect_m1(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1("replays the immutable complete command outcome after restart without repeating settlement",()=>{
    const f=fixture();let k=kernel(f);
    expect_m1(k.instance.execute(f.command).state).toBe("applied");expect_m1(k.preparations()).toBe(1);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST_m1});f.restart();k=kernel(f);
    const generation=f.db.getMeta().authorityGeneration;
    expect_m1(k.instance.execute(f.command).state).toBe("already-applied");expect_m1(k.preparations()).toBe(0);
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1("refuses a forged original attempt before preparing or inserting any audit",()=>{
    const f=fixture();const k=kernel(f);const request=CommandRequestSchema_m1.parse({...f.command,target:{...f.command.target,writeAttemptId:UUID_8_m1}});
    expect_m1(k.instance.execute(request).state).toBe("rejected");expect_m1(k.preparations()).toBe(0);
    expect_m1(f.db.authority.commands.get(UUID_5_m1)).toBeUndefined();expect_m1(f.db.authority.commandAudits.findByCommand(UUID_5_m1)).toBeUndefined();
  });
});
describe_m1("native immutable parked positive settlement",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1.each(["intent-state","transaction-checkpoint","timeline-event"])("rolls back genuine audit and all proof effects after %s",step=>{
    const f=fixture(step);const p=positive(f);const generation=f.db.getMeta().authorityGeneration;
    expect_m1(()=>p.apply()).toThrow("resolution-storage-fault");
    expect_m1(f.db.authority.commands.get(UUID_5_m1)).toBeUndefined();expect_m1(f.db.authority.commandAudits.get(UUID_6_m1)).toBeUndefined();
    expect_m1(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect_m1(f.db.authority.runCheckpoints.get(p.checkpoint.workflowId,p.checkpoint.itemId,p.checkpoint.nodeId,1,1)).toBeUndefined();
    expect_m1(f.db.authority.timelineEvents.page({runId:f.run.envelope.runId,limit:100})).toHaveLength(0);
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1("publishes exact proof and history while retaining the parked attempt after restart and later run advancement",()=>{
    const f=fixture();const p=positive(f);expect_m1(p.apply().attempt).toEqual(f.original);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST_m1});f.restart();
    const events=f.db.authority.timelineEvents.page({runId:f.run.envelope.runId,limit:100}).filter(event=>event.payload.kind === "operation-confirmed");
    expect_m1(events).toHaveLength(1);
    expect_m1(reconstructConfirmedOperation_m1(f.db.authority,events[0])).toEqual({ledger:p.transaction,span:p.committedSpan});
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    const generation=f.db.getMeta().authorityGeneration;
    f.db.withAuthorityTransaction(repositories=>{expect_m1(repositories.commands.insert(p.command).state).toBe("existing");repositories.commandAudits.insert(p.audit);});
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
});
describe_m1("native immutable parked absence settlement",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1.each(["audit","intent","run"] as const)("rolls back the complete command and run after %s",fault=>{
    const f=fixture();const generation=f.db.getMeta().authorityGeneration;
    expect_m1(()=>f.apply(fault)).toThrow("resolution-fault");
    expect_m1(f.db.authority.commands.get(UUID_5_m1)).toBeUndefined();expect_m1(f.db.authority.commandAudits.get(UUID_6_m1)).toBeUndefined();
    expect_m1(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1("requires the genuine final audit and admission CAS before settling",()=>{
    const f=fixture();expect_m1(()=>f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,
      settlement:f.settlement,resolution:f.resolution})).toThrow(/authority-missing/u);
    expect_m1(()=>f.db.withAuthorityTransaction(repositories=>{repositories.commands.insert(f.command);repositories.commandAudits.insert(f.audit);
      f.db.settleResolvedParkedAbsence({writeIntentId:f.parked.writeIntentId,generation:1,expectedIntentVersion:2,settlement:f.settlement,
        resolution:{...f.resolution,expectedRunVersion:3}});})).toThrow(/run-cas-mismatch/u);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
  });
  it_m1("retains and authenticates the original resolution after later run advancement and a real fresh N+1 fence",()=>{
    const f=fixture();const resumed=f.apply();
    f.db.authority.runs.advanceRevision({runId:resumed.envelope.runId,expectedVersion:5,now:LATEST_m1});
    const proof={...WRITE_INTENT_ATTEMPTING_m1.bindingProof,proofId:UUID_7_m1,observedAt:LATEST_m1};const digest=deriveWriteBindingProofDigest_m1(proof);
    const intent={...WRITE_INTENT_ATTEMPTING_m1,currentAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATEST_m1,version:4,updatedAt:LATEST_m1};
    const attempt={...WRITE_ATTEMPT_m1,writeAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATEST_m1,recordedAt:LATEST_m1};
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    f.restart();
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);
    expect_m1(f.db.authority.writeIntents.get(f.parked.writeIntentId)?.generation).toBe(2);
    expect_m1(canonicalJsonStringify_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId))).toBe(canonicalJsonStringify_m1(f.original));
    const audit=f.db.authority.commandAudits.get(UUID_6_m1);
    expect_m1(authenticateAuditedParkedWriteResolution_m1(f.original,f.db.authority.commands.get(UUID_5_m1),audit).intent).toEqual(f.audit.writeResolution);
    const generation=f.db.getMeta().authorityGeneration;
    f.db.withAuthorityTransaction(repositories=>{expect_m1(repositories.commands.insert(f.command).state).toBe("existing");repositories.commandAudits.insert(f.audit);});
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
});

describe_m1("native permanent confirmation publication",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1.each(["audit","mismatch"] as const)("rolls back positive command publication and complete audited result after %s",fault=>{
    const f=fixture();const command=positive(f).command;const k=kernel(f,fault,true);const generation=f.db.getMeta().authorityGeneration;
    expect_m1(()=>k.instance.execute(command)).toThrow(fault === "audit" ? "kernel-after-audit-fault" : "acknowledged-effects-mismatch");
    expect_m1(f.db.authority.writeIntents.get(f.parked.writeIntentId)).toEqual(f.parked);expect_m1(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toBeUndefined();
    expect_m1(f.db.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();expect_m1(f.db.authority.timelineEvents.page({limit:100})).toEqual([]);
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);expect_m1(f.db.authority.runs.get(f.run.envelope.runId)).toEqual(f.run);
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1("replays the exact positive audited command after restart and run advancement without repeating publication or continuation",()=>{
    const f=fixture();const command=positive(f).command;let k=kernel(f,undefined,true);
    const result=k.instance.execute(command);expect_m1(result.state).toBe("applied");expect_m1(k.preparations()).toBe(1);
    const publication=f.db.authority.writeIntents.getPublication(f.parked.writeIntentId);
    const audit=f.db.authority.commandAudits.findByCommand(command.commandId);
    f.db.authority.runs.advanceRevision({runId:f.run.envelope.runId,expectedVersion:5,now:LATEST_m1});f.restart();k=kernel(f,undefined,true);
    const generation=f.db.getMeta().authorityGeneration;
    expect_m1(k.instance.execute(command)).toEqual({...result,state:"already-applied"});expect_m1(k.preparations()).toBe(0);
    expect_m1(f.db.authority.commandAudits.findByCommand(command.commandId)).toEqual(audit);
    expect_m1(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toEqual(publication);
    expect_m1(f.db.authority.timelineEvents.page({limit:100}).filter(row=>row.payload.kind === "operation-confirmed")).toHaveLength(1);
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });

  it_m1("keeps genuine observed-present probe authority without inventing an attempt or confirmation publication",()=>{
    const f=fixture();const source=f.parked;const idempotencyKey="offline-observed-record";
    const observed=WriteIntentRecordSchema_m1.parse({writeIntentId:UUID_8_m1,workflowId:source.workflowId,itemId:source.itemId,taskId:source.taskId,
      system:source.system,idempotencyKey,idempotencyKeyDigest:deriveIdempotencyKeyDigest_m1(source.system,idempotencyKey),generation:1,
      status:"observed-present",observedProof:LEDGER_PAYLOAD_m1.proof,observedAt:LATER_m1,version:1,createdAt:LATER_m1,updatedAt:LATER_m1});
    expect_m1(f.db.authority.writeIntents.recordObservedPresent(observed).state).toBe("recorded-observed-present");f.restart();
    expect_m1(f.db.authority.writeIntents.get(UUID_8_m1)).toEqual(observed);expect_m1(f.db.authority.writeIntents.getPublication(UUID_8_m1)).toBeUndefined();
    expect_m1(f.db.authority.writeAttempts.listByIntent(UUID_8_m1)).toEqual([]);expect_m1(f.db.authority.timelineEvents.page({limit:100})).toEqual([]);
    expect_m1(f.inspect().invariants.state).toBe("valid");
  });

  it_m1.each(["missing","extra","timeline-time","checkpoint-output","checkpoint-run","checkpoint-workflow","checkpoint-item","checkpoint-attempt"])("refuses an altered whole publication on read and maintenance: %s",fault=>{
    const f=fixture();const p=positive(f);p.apply();
    f.rawMutation(raw=>{
      if(fault === "missing") {raw.prepare("UPDATE write_intents SET publication_json=NULL").run();return;}
      const row=raw.prepare("SELECT publication_json FROM write_intents").get()!;
      const publication=JSON.parse(String(row.publication_json)) as Record<string,unknown>;
      if(fault === "extra") publication.extra=true;
      else if(fault === "timeline-time") {
        const timeline=publication.timeline as Record<string,unknown>;timeline.recordedAt=LATEST_m1;
      } else {
        const checkpoint=publication.checkpoint as Record<string,unknown>;
        if(fault === "checkpoint-run") checkpoint.runId=UUID_8_m1;
        else if(fault === "checkpoint-workflow") checkpoint.workflowId="different-workflow";
        else if(fault === "checkpoint-item") checkpoint.itemId=UUID_8_m1;
        else if(fault === "checkpoint-attempt") checkpoint.attempt=2;
        else checkpoint.provenance=[{unexpected:true}];
      }
      raw.prepare("UPDATE write_intents SET publication_json=?").run(canonicalJsonStringify_m1(publication));
    });
    expect_m1(()=>f.db.authority.writeIntents.get(f.parked.writeIntentId)).toThrow();
    expect_m1(()=>f.inspect()).toThrow();
    expect_m1(()=>f.restart()).toThrow();
  });
  it_m1.each(["checkpoint","timeline","attempt","audit"])("refuses altered acknowledged authority: %s",fault=>{
    const f=fixture();positive(f).apply();
    f.rawMutation(raw=>{
      const table=fault === "checkpoint" ? "run_checkpoints" : fault === "timeline" ? "timeline_events" : fault === "attempt" ? "write_attempts" : "command_audits";
      for(const row of raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table)) raw.exec(`DROP TRIGGER ${String(row.name)}`);
      raw.prepare(`UPDATE ${table} SET payload_json=json_set(payload_json,?,?)`).run(
        fault === "checkpoint" ? "$.implFingerprint" : fault === "timeline" ? "$.payload.facts.traceId" : fault === "attempt" ? "$.bindingProofDigest" : "$.writeResolution.resolution.writeAttemptId",
        fault === "checkpoint" || fault === "attempt" ? "b".repeat(64) : fault === "timeline" ? "term-000000-abcd" : UUID_8_m1);
    });
    expect_m1(()=>f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toThrow();
  });
  it_m1("retains exact immutable publication and proof after authenticated terminal deletion, with no hidden run",()=>{
    const f=fixture();const p=positive(f);p.apply();
    const publication=f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)!;
    const service=new RunRecordService_m1({database:f.db,clock:capturedInstantClock_m1(LATEST_m1),ids:sequentialIdFactory_m1("c"),publishQueued:()=>{throw new Error("deletion cannot queue");}});
    const terminal=service.transition({commandId:UUID_8_m1,runId:f.run.envelope.runId,expectedVersion:6,
      lifecycle:{state:"terminal",outcome:"discarded",endedAt:LATEST_m1}});
    expect_m1(terminal.state).toBe("applied");
    const request={commandId:"90000000-0000-4000-8000-000000000001",runId:f.run.envelope.runId,expectedVersion:7};
    expect_m1(service.delete(request).state).toBe("deleted");f.restart();
    expect_m1(f.db.authority.runs.get(f.run.envelope.runId)).toBeUndefined();
    expect_m1(f.db.authority.timelineEvents.get(publication.timeline.eventId)).toBeUndefined();
    expect_m1(f.db.authority.runCheckpoints.get(p.checkpoint.workflowId,p.checkpoint.itemId,p.checkpoint.nodeId,1,1)).toBeUndefined();
    expect_m1(f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toEqual(publication);
    expect_m1(reconstructConfirmedOperation_m1(f.db.authority,publication.timeline)).toEqual({ledger:p.transaction,span:p.committedSpan});
    expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
    expect_m1(f.inspect().invariants.state).toBe("valid");
    const generation=f.db.getMeta().authorityGeneration;
    expect_m1(new RunRecordService_m1({database:f.db,clock:capturedInstantClock_m1(LATEST_m1),ids:sequentialIdFactory_m1("c"),publishQueued:()=>{}}).delete(request).state).toBe("applied-already");
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
    f.rawMutation(raw=>{raw.exec("DROP TRIGGER deleted_runs_identity");raw.prepare("UPDATE deleted_runs SET trace_id=?,receipt_json=json_set(receipt_json,'$.traceId',?)").run("term-000000-abcd","term-000000-abcd");});
    expect_m1(()=>f.db.authority.writeIntents.getPublication(f.parked.writeIntentId)).toThrow(/deletion-settlement-mismatch/u);
  });
  it_m1.each(["run","workflow","item","attempt","execution-generation","descriptor","contract"])("refuses ordinary confirmation checkpoint substitution before any mutation: %s",fault=>{
    const f=fixture();f.apply();
    const proof={...WRITE_INTENT_ATTEMPTING_m1.bindingProof,proofId:UUID_7_m1,observedAt:LATER_m1};const digest=deriveWriteBindingProofDigest_m1(proof);
    const intent={...WRITE_INTENT_ATTEMPTING_m1,currentAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATER_m1,version:4,updatedAt:LATER_m1};
    const attempt={...WRITE_ATTEMPT_m1,writeAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATER_m1,recordedAt:LATER_m1};
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    const outcome={...COMMITTED_OUTCOME_m1,confirmedAt:LATEST_m1};
    const transaction={...LEDGER_PAYLOAD_m1,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER_m1,confirmedAt:LATEST_m1};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD_m1,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST_m1,outcome};
    const patch=fault === "run" ? {runId:UUID_8_m1}:fault === "workflow" ? {workflowId:"other-workflow"}:fault === "item" ? {itemId:UUID_8_m1}
      :fault === "attempt" ? {attempt:2}:fault === "execution-generation" ? {claimGeneration:2}:fault === "descriptor" ? {descriptorVersion:2}:{contractFingerprint:"b".repeat(64)};
    const checkpoint=RunCheckpointRecordSchema_m1.parse({...positive(f).checkpoint,...patch,output:{schemaHash:deriveSchemaHash_m1(TransactionOutcomeSchema_m1,"output"),value:outcome},writtenAt:LATEST_m1});
    const commit={writeIntentId:intent.writeIntentId,generation:2,completionProof:LEDGER_PAYLOAD_m1.proof,confirmedAt:LATEST_m1,outcome,transaction,committedSpan};
    const generation=f.db.getMeta().authorityGeneration;
    expect_m1(()=>f.db.commitWriteAttempt(commit,checkpoint)).toThrow();
    expect_m1(f.db.authority.writeIntents.get(intent.writeIntentId)).toEqual(intent);
    expect_m1(f.db.authority.writeAttempts.get(UUID_8_m1)).toEqual(attempt);
    expect_m1(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toBeUndefined();
    expect_m1(f.db.authority.runCheckpoints.get(checkpoint.workflowId,checkpoint.itemId,checkpoint.nodeId,checkpoint.attempt,checkpoint.claimGeneration)).toBeUndefined();
    expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m1.each([undefined,"intent-state","attempt-state","transaction-checkpoint","timeline-event"])("binds ordinary N+1 confirmation and rolls back before acknowledgment after %s",fault=>{
    const f=fixture();f.apply();
    const proof={...WRITE_INTENT_ATTEMPTING_m1.bindingProof,proofId:UUID_7_m1,observedAt:LATER_m1};const digest=deriveWriteBindingProofDigest_m1(proof);
    const intent={...WRITE_INTENT_ATTEMPTING_m1,currentAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,
      fencedAt:LATER_m1,version:4,updatedAt:LATER_m1};
    const attempt={...WRITE_ATTEMPT_m1,writeAttemptId:UUID_8_m1,generation:2,bindingProof:proof,bindingProofDigest:digest,fencedAt:LATER_m1,recordedAt:LATER_m1};
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    const outcome={...COMMITTED_OUTCOME_m1,confirmedAt:LATEST_m1};
    const transaction={...LEDGER_PAYLOAD_m1,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER_m1,confirmedAt:LATEST_m1};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD_m1,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST_m1,outcome};
    const checkpoint=RunCheckpointRecordSchema_m1.parse({...positive(f).checkpoint,output:{schemaHash:deriveSchemaHash_m1(TransactionOutcomeSchema_m1,"output"),value:outcome},writtenAt:LATEST_m1});
    const commit={writeIntentId:intent.writeIntentId,generation:2,completionProof:LEDGER_PAYLOAD_m1.proof,confirmedAt:LATEST_m1,outcome,transaction,committedSpan};
    if(fault !== undefined)f.setFault(fault);
    const generation=f.db.getMeta().authorityGeneration;
    if(fault !== undefined) {
      expect_m1(()=>f.db.commitWriteAttempt(commit,checkpoint)).toThrow("resolution-storage-fault");
      expect_m1(f.db.authority.writeIntents.get(intent.writeIntentId)).toEqual(intent);expect_m1(f.db.authority.writeAttempts.get(UUID_8_m1)).toEqual(attempt);
      expect_m1(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toBeUndefined();expect_m1(f.db.getMeta().authorityGeneration).toBe(generation);
    } else {
      expect_m1(f.db.commitWriteAttempt(commit,checkpoint).state).toBe("committed");f.restart();
      const publication=f.db.authority.writeIntents.getPublication(intent.writeIntentId)!;
      expect_m1(publication.ledger).toEqual(transaction);expect_m1(publication.span).toEqual(committedSpan);
      expect_m1(f.db.authority.timelineEvents.get(publication.timeline.eventId)?.payload).toEqual(publication.timeline.payload);
      const worker=f.db.withAuthorityTransaction(repositories=>{
        const slot=admitDirectWorker_m1(repositories,{commandId:"90000000-0000-4000-8000-000000000010",workflow:f.run.envelope.workflow,
          poolIndex:2,expectedPoolVersion:repositories.workerPools.get(f.run.envelope.workflow)?.version??0,processId:process.pid,processAcquisitionId:"90000000-0000-4000-8000-000000000011",
          authorityPath:f.path,processLockRoot:join_m1(f.path,"..","locks"),now:LATEST_m1},"90000000-0000-4000-8000-000000000012");
        expect_m1(repositories.workerLeases.start({workerId:slot.workerId,workflow:f.run.envelope.workflow,browserSystems:[],
          processId:process.pid,requestedBy:"local-operator",now:LATEST_m1}).state).toBe("started");
        return slot.workerId;
      });
      const claim=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:worker,now:LATEST_m1});
      expect_m1(claim.state).toBe("claimed");
      if(claim.state !== "claimed")throw new Error("later current claim failed");
      expect_m1(claim.run.claimGeneration).toBe(2);f.restart();
      expect_m1(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toEqual(publication);
      expect_m1(reconstructConfirmedOperation_m1(f.db.authority,publication.timeline)).toEqual({ledger:transaction,span:committedSpan});
      expect_m1(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
      expect_m1(authenticateAuditedParkedWriteResolution_m1(f.original,f.db.authority.commands.get(UUID_5_m1),f.db.authority.commandAudits.get(UUID_6_m1)).intent).toEqual(f.audit.writeResolution);
      expect_m1(f.inspect().invariants.state).toBe("valid");
    }
  });
});
}

{

function foundationFixture(){return baseFoundationFixture_m2({input:RunRecordSchema_m2.shape.input.parse({...QUEUED_RUN_m2.input,parsed:{
  schemaHash:deriveSchemaHash_m2(PersonLookupCanonicalInput_m2,"output"),value:{emplId:"10873698",keepNonHdh:false,includeCrmDates:false},
  protectedBindings:[{kind:"test-data-local",inputPath:"emplId",name:"personLookupCanaryEid",sourceId:id_m2(89)}],
}})});}

function cancellation(f: ReturnType<typeof foundationFixture>) {
  const service = new RunRecordService_m2({ database: f.db, clock: f.clock, ids: sequentialIdFactory_m2(), publishQueued: () => {} });
  assert_m2.equal(service.transition({commandId:id_m2(180),runId:f.run.envelope.runId,expectedVersion:f.run.version,
    lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW_m2}}).state,"applied");
  const run=f.db.authority.runs.get(f.run.envelope.runId);assert_m2.ok(run);assert_m2.ok(run.cancelRequested);
  if(run.lifecycle.state!=="running")throw new Error("cancellation did not retain the held claim");
  const request={kind:"cancelled",commandId:id_m2(181),runId:run.envelope.runId,expectedVersion:run.version,
    claim:{workerId:run.lifecycle.workerId,claimGeneration:run.claimGeneration},endedAt:NOW_m2};
  return {service,request};
}
function rawState(path:string) {
  const db=new DatabaseSync_m2(path,{readOnly:true});try{return canonicalJsonStringify_m2(["runs","run_failures","run_results","run_receipts","commands","command_audits","timeline_events"].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));}finally{db.close();}
}
function trust(db:AuthorityDatabase_m2,f:ReturnType<typeof foundationFixture>){return createReceiptService_m2({database:db,
  runReader:sqliteRunReader_m2(db,f.clock),descriptors:[personLookupDescriptor_m2]});}

describe_m2("same-attempt native recovery",()=>{
  it_m2("releases the genuine primitive owner atomically without changing its immutable attempt",()=>{
    const f=foundationFixture();try{
      assert_m2.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery",now:NOW_m2};
      const before=rawState(f.path);
      assert_m2.throws(()=>f.db.withAuthorityTransaction(()=>{assert_m2.equal(f.db.authority.runs.requeue(request).state,"applied");throw new Error("primitive-release-fault");}),/primitive-release-fault/u);
      assert_m2.equal(rawState(f.path),before);
      const release=f.db.authority.runs.requeue(request);assert_m2.equal(release.state,"applied");
      if(release.state!=="applied")throw new Error("primitive release refused");
      assert_m2.deepEqual(release.run.envelope,f.run.envelope);assert_m2.deepEqual(release.run.input,f.run.input);
      assert_m2.equal(release.run.version,f.run.version+1);assert_m2.equal(release.run.claimGeneration,f.run.claimGeneration);
      assert_m2.equal(release.run.lifecycle.state,"queued");
      const next=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,now:NOW_m2});assert_m2.equal(next.state,"claimed");
      if(next.state!=="claimed")throw new Error("primitive release not claimable");
      assert_m2.deepEqual(next.run.envelope,f.run.envelope);assert_m2.equal(next.run.claimGeneration,claim.claimGeneration+1);
      const claimedBytes=rawState(f.path);
      assert_m2.deepEqual(f.db.authority.runs.requeue({...request,expectedVersion:next.run.version}),{state:"conflict",currentVersion:next.run.version,currentState:next.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
      assert_m2.equal(rawState(f.path),claimedBytes);
    }finally{f.dispose();}
  });

  it_m2("rolls release back, preserves immutable identity, reopens exact replay and fences the prior claim",()=>{
    const f=foundationFixture();try{
      assert_m2.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={commandId:id_m2(190),runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery"};
      const service=new RunRecordService_m2({database:f.db,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{}});
      const before=rawState(f.path);
      assert_m2.throws(()=>f.db.withAuthorityTransaction(()=>{assert_m2.equal(service.requeue(request).state,"applied");throw new Error("release-fault");}),/release-fault/u);
      assert_m2.equal(rawState(f.path),before);
      assert_m2.equal(service.requeue(request).state,"applied");
      const released=f.db.authority.runs.get(request.runId);assert_m2.ok(released);
      assert_m2.deepEqual(released.envelope,f.run.envelope);assert_m2.deepEqual(released.input,f.run.input);
      assert_m2.equal(released.claimGeneration,f.run.claimGeneration);assert_m2.equal(released.lifecycle.state,"queued");
      const settled=rawState(f.path);assert_m2.equal(service.requeue(request).state,"applied-already");assert_m2.equal(rawState(f.path),settled);
      f.db.close();const reopened=AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"same-attempt-reopen"},f.clock);
      try{
        const replay=new RunRecordService_m2({database:reopened,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{throw new Error("replayed queue publication");}});
        assert_m2.equal(replay.requeue(request).state,"applied-already");assert_m2.equal(rawState(f.path),settled);
        const claimed=reopened.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,now:NOW_m2});assert_m2.equal(claimed.state,"claimed");
        if(claimed.state!=="claimed")throw new Error("not reclaimed");
        assert_m2.deepEqual(claimed.run.envelope,f.run.envelope);assert_m2.equal(claimed.run.claimGeneration,claim.claimGeneration+1);
        const fenced=reopened.authority.runs.requeue({runId:request.runId,expectedVersion:claimed.run.version,claim,cause:"recovery",now:NOW_m2});assert_m2.deepEqual(fenced,{state:"conflict",currentVersion:claimed.run.version,currentState:claimed.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
        assert_m2.deepEqual(reopened.authority.runs.get(request.runId),claimed.run);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
});

describe_m2("truthful immutable final evidence",()=>{
  it_m2("rolls failure, evidence and run back together after result creation",()=>{
    const f=foundationFixture();try{const before=rawState(f.path);
      assert_m2.throws(()=>f.db.withAuthorityTransaction(()=>{terminalizeFixtureFailure_m2(f,f.run,failure_m2());assert_m2.ok(f.db.authority.runResults.get(f.run.envelope.runId));throw new Error("after-terminal-result");}),/after-terminal-result/u);
      assert_m2.equal(rawState(f.path),before);assert_m2.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it_m2("owns genuine cancellation evidence with its command/audit, rollback and exact reopen replay",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);const before=rawState(f.path);
      assert_m2.throws(()=>f.db.withAuthorityTransaction(()=>{assert_m2.equal(service.terminalize(request,personLookupDescriptor_m2).state,"applied");throw new Error("cancel-result-fault");}),/cancel-result-fault/u);assert_m2.equal(rawState(f.path),before);
      assert_m2.equal(service.terminalize(request,personLookupDescriptor_m2).state,"applied");
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert_m2.ok(result);
      const evidence=terminalEvidenceResult_m2(result);assert_m2.equal(evidence?.kind,"lifecycle-evidence");
      if(evidence?.kind!=="lifecycle-evidence")throw new Error("wrong cancellation owner");assert_m2.equal(evidence.commandId,request.commandId);assert_m2.equal(evidence.auditId,request.commandId);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert_m2.deepEqual(receipt.output,[]);
      const settled=rawState(f.path);assert_m2.equal(service.terminalize(request,personLookupDescriptor_m2).state,"applied-already");assert_m2.equal(rawState(f.path),settled);
      f.db.close();const reopened=AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-reopen"},f.clock);
      try{const replay=new RunRecordService_m2({database:reopened,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{throw new Error("unexpected publication");}});
        assert_m2.equal(replay.terminalize(request,personLookupDescriptor_m2).state,"applied-already");assert_m2.deepEqual(trust(reopened,f).ensureReceipt(result.runId),receipt);assert_m2.equal(rawState(f.path),settled);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
  it_m2.each(["cancelled","discarded","superseded"] as const)("owns final unclaimed %s evidence without worker success authorization",outcome=>{
    const f=foundationFixture();try{
      const queued={...QUEUED_RUN_m2,input:f.run.input,envelope:{...QUEUED_RUN_m2.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        contractFingerprint:f.run.envelope.contractFingerprint,runId:id_m2(220),itemId:id_m2(220)}};
      f.db.authority.runs.enqueue(queued);
      const service=new RunRecordService_m2({database:f.db,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{}});
      const request={commandId:id_m2(221),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:{state:"terminal",outcome,endedAt:NOW_m2}};
      assert_m2.equal(service.transition(request).state,"applied");
      const result=f.db.authority.runResults.get(queued.envelope.runId);assert_m2.ok(result);
      assert_m2.equal(terminalEvidenceResult_m2(result)?.kind,"lifecycle-evidence");
      assert_m2.equal(f.db.authority.runs.get(result.runId)?.completion,undefined);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert_m2.deepEqual(receipt.output,[]);
      const before=rawState(f.path);assert_m2.equal(service.transition(request).state,"applied-already");assert_m2.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it_m2("settles admitted cancellation through recovery with the genuine requeue audit",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);
      const recovery={commandId:id_m2(182),runId:request.runId,expectedVersion:request.expectedVersion,claim:request.claim,cause:"recovery"};
      assert_m2.equal(service.requeue(recovery).state,"applied");
      const result=f.db.authority.runResults.get(request.runId);assert_m2.ok(result);assert_m2.equal(terminalEvidenceResult_m2(result)?.kind,"lifecycle-evidence");
      assert_m2.deepEqual(trust(f.db,f).ensureReceipt(request.runId).output,[]);
      const before=rawState(f.path);assert_m2.equal(service.requeue(recovery).state,"applied-already");assert_m2.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it_m2("journals each actual cascade member and root with immutable cancellation evidence",()=>{
    const f=foundationFixture();try{
      const parent=RunRecordSchema_m2.parse({...QUEUED_RUN_m2,input:f.run.input,envelope:{...QUEUED_RUN_m2.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        contractFingerprint:f.run.envelope.contractFingerprint,runId:id_m2(230),itemId:id_m2(230),shape:"operation"}});
      const child=RunRecordSchema_m2.parse({...parent,envelope:{...parent.envelope,runId:id_m2(231),itemId:id_m2(231),shape:"operation-member",
        parent:{runId:parent.envelope.runId,tracePrefix:parent.envelope.traceId,edgeId:"synthetic-child"}}});
      f.db.authority.runs.enqueue(parent);f.db.authority.runs.enqueue(child);
      const service=new RunRecordService_m2({database:f.db,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{}});
      const request={commandId:id_m2(232),runId:parent.envelope.runId,expectedVersion:parent.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW_m2}};
      assert_m2.equal(service.transition(request).state,"applied");
      const owners=[parent,child].map(run=>{const record=f.db.authority.runResults.get(run.envelope.runId);assert_m2.ok(record);
        const evidence=terminalEvidenceResult_m2(record);assert_m2.equal(evidence?.kind,"lifecycle-evidence");
        if(evidence?.kind!=="lifecycle-evidence")throw new Error("missing member owner");
        assert_m2.ok(f.db.authority.lifecycleJournal.getCommand(evidence.commandId));assert_m2.ok(f.db.authority.lifecycleJournal.findAuditByCommand(evidence.commandId));
        return evidence.commandId;});
      assert_m2.notEqual(owners[0],owners[1]);
      const before=rawState(f.path);assert_m2.equal(service.transition(request).state,"applied-already");assert_m2.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it_m2("refuses a partial audited failed settlement without repairing or repeating it",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing admitted claim");
      const service=new RunRecordService_m2({database:f.db,clock:f.clock,ids:sequentialIdFactory_m2(),publishQueued:()=>{}});
      const request={kind:"failure",commandId:id_m2(240),terminal:{failure:failure_m2(),authorization:{kind:"failed",runId:f.run.envelope.runId,
        workflowId:f.run.envelope.workflow,attempt:f.run.envelope.attempt,descriptorVersion:f.run.envelope.descriptorVersion,
        contractFingerprint:f.run.envelope.contractFingerprint,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},authorizedAt:NOW_m2,failureId:failure_m2().failureId}}};
      assert_m2.equal(service.terminalize(request,personLookupDescriptor_m2).state,"applied");
      const settled=rawState(f.path);assert_m2.equal(service.terminalize(request,personLookupDescriptor_m2).state,"applied-already");assert_m2.equal(rawState(f.path),settled);
      assert_m2.equal(service.terminalize({...request,terminal:{...request.terminal,failure:{...failure_m2(),summary:"divergent synthetic failure"}}},personLookupDescriptor_m2).state,"refused");assert_m2.equal(rawState(f.path),settled);
      const db=new DatabaseSync_m2(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("DELETE FROM run_results WHERE run_id=?").run(f.run.envelope.runId);for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      const partial=rawState(f.path);assert_m2.throws(()=>service.terminalize(request,personLookupDescriptor_m2),/composite authority/u);assert_m2.equal(rawState(f.path),partial);
      f.db.close();assert_m2.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"partial-terminal"},f.clock),/run-completion-consequences|final-runs-bind-result-owner/u);
    }finally{f.dispose();}
  });
  it_m2("keeps interrupted recovery without immutable final evidence or receipt",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing held claim");
      assert_m2.equal(f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},
        lifecycle:{state:"terminal",outcome:"interrupted",endedAt:NOW_m2},now:NOW_m2}).state,"applied");
      assert_m2.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
      assert_m2.throws(()=>trust(f.db,f).ensureReceipt(f.run.envelope.runId),/ended interrupted/u);
      assert_m2.equal(f.db.authority.evidenceReceipts.findByRun(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it_m2("refuses corrupt result payload without exposing the stored private bytes",()=>{
    const f=foundationFixture();try{terminalizeFixtureFailure_m2(f,f.run,failure_m2());
      const db=new DatabaseSync_m2(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=? WHERE run_id=?").run(canonicalJsonStringify_m2({privateNote:"SYNTHETIC_PRIVATE_RESULT_INVALID_PAYLOAD"}),f.run.envelope.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert_m2.throws(()=>f.db.authority.runResults.get(f.run.envelope.runId),error=>error instanceof Error && error.message==="run-result-payload-invalid");
      f.db.close();assert_m2.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"private-result-refusal"},f.clock),error=>
        error instanceof Error && error.message.includes("run-result-payload-invalid") && !error.message.includes("SYNTHETIC_PRIVATE_RESULT"));
    }finally{f.dispose();}
  });
  it_m2.each(["failure-digest","failure-identity","cancel-command"] as const)("refuses altered %s proof on read and reopen",kind=>{
    const f=foundationFixture();try{
      if(kind==="cancel-command"){const {service,request}=cancellation(f);service.terminalize(request,personLookupDescriptor_m2);}else terminalizeFixtureFailure_m2(f,f.run,failure_m2());
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert_m2.ok(result);const evidence=terminalEvidenceResult_m2(result);assert_m2.ok(evidence);
      const altered=kind==="cancel-command"?{...evidence,commandId:id_m2(999)}:kind==="failure-digest"?{...evidence,failureDigest:"f".repeat(64)}:{...evidence,authorization:{...("authorization" in evidence?evidence.authorization:{}),failureId:id_m2(999)}};
      const changed=RunResultRecordSchema_m2.parse({...result,result:{...result.result,value:altered},resultDigest:deriveRunResultDigest_m2({...result.result,value:altered})});
      const db=new DatabaseSync_m2(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=?,result_digest=? WHERE run_id=?").run(canonicalJsonStringify_m2(changed),changed.resultDigest,changed.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert_m2.throws(()=>f.db.authority.runResults.get(result.runId),/terminal-(?:failure-result|evidence-command-audit)/u);
      f.db.close();assert_m2.throws(()=>AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-refusal"},f.clock),/terminal-(?:failure-result|evidence-command-audit)/u);
    }finally{f.dispose();}
  });
});
}
