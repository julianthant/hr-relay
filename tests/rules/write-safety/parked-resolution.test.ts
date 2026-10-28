import { describe,expect,it } from "vitest";
import { authenticateAuditedParkedWriteResolution,authenticateParkedWriteResolution } from "../../../src/rules/write-safety/parked-resolution.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-authority-reason.js";
import { HASH_A,HASH_B,LATER,NOW,UUID_5,UUID_6,WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
const reason=deriveWriteAuthorityReason("recovery-probe-unknown","probe","offline indeterminate probe");
const attempt={...WRITE_ATTEMPT,outcome:{state:"parked",code:"unknown",message:"offline indeterminate probe",authorityReason:reason},recordedAt:NOW};
const binding={commandId:UUID_5,auditId:UUID_6,writeIntentId:attempt.writeIntentId,writeAttemptId:attempt.writeAttemptId,
  generation:attempt.generation,bindingProofDigest:attempt.bindingProofDigest,idempotencyKeyDigest:WRITE_INTENT_ATTEMPTING.idempotencyKeyDigest,
  runId:attempt.runId,runAttempt:attempt.runAttempt,expectedRunVersion:4,decision:"present",resolvedAt:LATER};
const proof={schemaHash:HASH_A,value:{confirmed:true}};
const command={commandId:UUID_5,family:"run",type:"recheck-write",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",
  target:{runId:binding.runId,expectedVersion:4,writeIntentId:binding.writeIntentId,intentGeneration:binding.generation,
    writeAttemptId:binding.writeAttemptId,bindingProofDigest:binding.bindingProofDigest},payload:{occurrenceKeyDigest:binding.idempotencyKeyDigest}};
const auditBase={auditId:UUID_6,request:command,result:{state:"applied",commandId:UUID_5,affectedTargets:[{family:"run",runId:binding.runId}]},completedAt:LATER,
  versionChanges:[{target:{family:"run",runId:binding.runId},before:4,after:5}],affectedDependencyIds:[]};
const intent={...WRITE_INTENT_ATTEMPTING,status:"committed",completionProof:proof,confirmedAt:LATER,version:3,updatedAt:LATER,resolution:binding};
const requested={...WRITE_INTENT_ATTEMPTING,status:"parked",parkedCode:"unknown",message:"offline indeterminate probe",authorityReason:reason,
  recheck:{commandId:UUID_5,auditId:UUID_6,expectedRunVersion:4,requestedAt:NOW,nodeId:"termination"},version:2,updatedAt:NOW};
const audit={...auditBase,completedAt:NOW,writeResolution:requested};
describe("authenticated immutable parked resolution",()=>{
  it("admits the exact original parked attempt and genuine final command/audit",()=>{
    expect(authenticateParkedWriteResolution(intent,attempt,command,audit).attempt).toEqual(attempt);
  });
  it.each(["writeAttemptId","generation","bindingProofDigest","idempotencyKeyDigest","runId","expectedRunVersion","auditId"])("refuses a forged resolution %s",field=>{
    expect(()=>authenticateParkedWriteResolution({...intent,resolution:{...binding,[field]:field === "generation" || field === "expectedRunVersion" ? 8 : HASH_B}},attempt,command,audit)).toThrow();
  });
  it("refuses rewritten attempts, stale run CAS, altered proof and incomplete audits",()=>{
    expect(()=>authenticateParkedWriteResolution(intent,{...attempt,outcome:{state:"attempting"}},command,audit)).toThrow();
    expect(()=>authenticateParkedWriteResolution(intent,attempt,command,{...audit,versionChanges:[{...audit.versionChanges[0],after:6}]})).toThrow(/audit-result-mismatch/u);
    expect(()=>authenticateParkedWriteResolution(intent,attempt,{...command,payload:{...command.payload,proof:{schemaHash:HASH_A,value:{confirmed:false}}}},audit)).toThrow();
    expect(()=>authenticateParkedWriteResolution(intent,attempt,command,{...audit,result:{state:"rejected",commandId:UUID_5,code:"invalid-state",message:"not applied"}})).toThrow();
  });
  it("authenticates retained settlement without depending on a later current run or intent",()=>{
    expect(authenticateAuditedParkedWriteResolution(attempt,command,audit).intent).toEqual(requested);
    expect(()=>authenticateAuditedParkedWriteResolution(attempt,command,{...audit,writeResolution:undefined})).toThrow();
  });
  it("authenticates explicit absence while retaining the same parked attempt",()=>{
    const absentBinding={...binding,decision:"absent"};
    const absentCommand={...command,type:"resolve-write-absent",payload:{occurrenceKeyDigest:binding.idempotencyKeyDigest}};
    const absentIntent={...WRITE_INTENT_ATTEMPTING,status:"retryable",settlement:{state:"operator-confirmed-absent",writeIntentId:binding.writeIntentId,
      generation:binding.generation,operator:"local-operator",confirmedAt:LATER},resolvedAt:LATER,version:3,updatedAt:LATER,resolution:absentBinding};
    expect(authenticateParkedWriteResolution(absentIntent,attempt,absentCommand,{...audit,completedAt:LATER,request:absentCommand,writeResolution:absentIntent}).attempt).toEqual(attempt);
    expect(()=>authenticateParkedWriteResolution({...absentIntent,settlement:{...absentIntent.settlement,confirmedAt:"2026-01-01T00:00:00.000Z"}},attempt,absentCommand,{...audit,completedAt:LATER,request:absentCommand,writeResolution:absentIntent})).toThrow(/audit-acknowledgement-mismatch/u);
  });
});
