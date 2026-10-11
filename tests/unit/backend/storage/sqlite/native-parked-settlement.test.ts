import { admitDirectWorker } from "../../../../../src/backend/storage/sqlite/worker-slots.js";
import { createCommandKernel,type WriteResolutionContext } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { UNWIRED_INTAKE_PARSER,NO_INTAKE_PROJECTIONS } from "../../../../support/fixtures/intake-kernel-seams.js";
import { RunCheckpointRecordSchema } from "../../../../../src/models/workflow/checkpoint.js";
import { TransactionOutcomeSchema } from "../../../../../src/rules/write-safety/write-safety.js";
import { reconstructConfirmedOperation } from "../../../../../src/models/events/confirmed-operation.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { AuthorityDatabase, inspectNormalAuthority } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { RunRecordService,runContinuationPort } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { WriteIntentRecordSchema,deriveWriteBindingProofDigest,deriveWriteAuthorityReason,deriveIdempotencyKeyDigest } from "../../../../../src/rules/write-safety/write-safety.js";
import { authenticateAuditedParkedWriteResolution } from "../../../../../src/rules/write-safety/parked-resolution.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { QUEUED_RUN,sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { LEDGER_PAYLOAD,SPAN_OUTBOX_PAYLOAD,COMMITTED_OUTCOME,CONFIG_SNAPSHOT,WRITE_INTENT_ATTEMPTING,WRITE_ATTEMPT,NOW,LATER,LATEST,UUID_5,UUID_6,UUID_7,UUID_8 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
function fixture(faultStep?:string) {
  let activeFault=faultStep;
  const root=realpathSync(mkdtempSync(join(tmpdir(),"relay-native-parked-")));const path=join(root,"authority.sqlite");
  const admission=RuntimeAdmission.syntheticFixture(path);
  const open=()=>AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,{afterStorageStep:step=>{if(step === activeFault)throw new Error("resolution-storage-fault");}});
  let db=open();cleanups.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const run=RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,workflow:WRITE_INTENT_ATTEMPTING.workflowId,
    configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT.fingerprint},version:5,claimGeneration:1,
    lifecycle:{state:"parked-write",writeIntentId:WRITE_INTENT_ATTEMPTING.writeIntentId,intentGeneration:1,
      parkedAt:NOW,code:"unknown",message:"offline indeterminate probe"}});
  const worker=db.withAuthorityTransaction(repositories=>{
    const slot=admitDirectWorker(repositories,{commandId:"80000000-0000-4000-8000-000000000001",workflow:run.envelope.workflow,
      poolIndex:1,expectedPoolVersion:0,processId:process.pid,processAcquisitionId:"80000000-0000-4000-8000-000000000002",
      authorityPath:path,processLockRoot:join(root,"locks"),now:NOW},"80000000-0000-4000-8000-000000000003");
    expect(repositories.workerLeases.start({workerId:slot.workerId,workflow:run.envelope.workflow,browserSystems:[],
      processId:process.pid,requestedBy:"local-operator",now:NOW}).state).toBe("started");
    return slot.workerId;
  });
  db.authority.runs.enqueue({...run,version:1,claimGeneration:0,lifecycle:{state:"queued"}});
  const claim=db.authority.runs.claimNext({workflow:run.envelope.workflow,workerId:worker,now:NOW});
  expect(claim.state).toBe("claimed");
  if(claim.state !== "claimed")throw new Error("fixture claim failed");
  const validating=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:claim.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"validating",workerId:worker,claimedAt:NOW,heartbeatAt:NOW},now:NOW});
  expect(validating.state).toBe("applied");
  if(validating.state !== "applied")throw new Error("fixture validation failed");
  const running=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:validating.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:{state:"running",workerId:worker,claimedAt:NOW,heartbeatAt:NOW,currentNodeId:"termination"},now:NOW});
  expect(running.state).toBe("applied");
  if(running.state !== "applied")throw new Error("fixture run failed");
  const parkedRun=db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:running.run.version,
    claim:{workerId:worker,claimGeneration:1},lifecycle:run.lifecycle,now:NOW});
  expect(parkedRun.state).toBe("applied");
  if(parkedRun.state !== "applied")throw new Error("fixture park admission failed");
  expect(parkedRun.run).toEqual(run);
  db.authority.writeIntents.fenceAttempt({intent:WRITE_INTENT_ATTEMPTING,attempt:WRITE_ATTEMPT});
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
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    f.restart();
    expect(f.db.authority.runs.get(f.run.envelope.runId)?.version).toBe(6);
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
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    const outcome={...COMMITTED_OUTCOME,confirmedAt:LATEST};
    const transaction={...LEDGER_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER,confirmedAt:LATEST};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST,outcome};
    const patch=fault === "run" ? {runId:UUID_8}:fault === "workflow" ? {workflowId:"other-workflow"}:fault === "item" ? {itemId:UUID_8}
      :fault === "attempt" ? {attempt:2}:fault === "execution-generation" ? {claimGeneration:2}:fault === "descriptor" ? {descriptorVersion:2}:{contractFingerprint:"b".repeat(64)};
    const checkpoint=RunCheckpointRecordSchema.parse({...positive(f).checkpoint,...patch,output:{schemaHash:deriveSchemaHash(TransactionOutcomeSchema,"output"),value:outcome},writtenAt:LATEST});
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
    f.db.authority.writeIntents.refenceRetryable({expectedVersion:3,intent,attempt});
    const outcome={...COMMITTED_OUTCOME,confirmedAt:LATEST};
    const transaction={...LEDGER_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,fencedAt:LATER,confirmedAt:LATEST};
    const committedSpan={...SPAN_OUTBOX_PAYLOAD,traceId:f.run.envelope.traceId,intentGeneration:2,bindingProofDigest:digest,occurredAt:LATEST,outcome};
    const checkpoint=RunCheckpointRecordSchema.parse({...positive(f).checkpoint,output:{schemaHash:deriveSchemaHash(TransactionOutcomeSchema,"output"),value:outcome},writtenAt:LATEST});
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
      const worker=f.db.withAuthorityTransaction(repositories=>{
        const slot=admitDirectWorker(repositories,{commandId:"90000000-0000-4000-8000-000000000010",workflow:f.run.envelope.workflow,
          poolIndex:2,expectedPoolVersion:repositories.workerPools.get(f.run.envelope.workflow)?.version??0,processId:process.pid,processAcquisitionId:"90000000-0000-4000-8000-000000000011",
          authorityPath:f.path,processLockRoot:join(f.path,"..","locks"),now:LATEST},"90000000-0000-4000-8000-000000000012");
        expect(repositories.workerLeases.start({workerId:slot.workerId,workflow:f.run.envelope.workflow,browserSystems:[],
          processId:process.pid,requestedBy:"local-operator",now:LATEST}).state).toBe("started");
        return slot.workerId;
      });
      const claim=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:worker,now:LATEST});
      expect(claim.state).toBe("claimed");
      if(claim.state !== "claimed")throw new Error("later current claim failed");
      expect(claim.run.claimGeneration).toBe(2);f.restart();
      expect(f.db.authority.writeIntents.getPublication(intent.writeIntentId)).toEqual(publication);
      expect(reconstructConfirmedOperation(f.db.authority,publication.timeline)).toEqual({ledger:transaction,span:committedSpan});
      expect(f.db.authority.writeAttempts.get(f.original.writeAttemptId)).toEqual(f.original);
      expect(authenticateAuditedParkedWriteResolution(f.original,f.db.authority.commands.get(UUID_5),f.db.authority.commandAudits.get(UUID_6)).intent).toEqual(f.audit.writeResolution);
      expect(f.inspect().invariants.state).toBe("valid");
    }
  });
});
